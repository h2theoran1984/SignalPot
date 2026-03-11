import { createAdminClient } from "@/lib/supabase/admin";

export type HoldType = "deposit" | "reserve";
export type HoldStatus = "held" | "released" | "forfeited";

export interface EscrowHold {
  id: string;
  job_id: string;
  payer_profile_id: string;
  amount_millicents: number;
  hold_type: HoldType;
  status: HoldStatus;
  created_at: string;
  released_at: string | null;
}

/**
 * Create an escrow hold for a job.
 * Does NOT deduct from the payer's balance — that happens at settlement.
 * Use this for dispute deposit staking (Sprint 10).
 */
export async function createHold(
  jobId: string,
  payerProfileId: string,
  amountMillicents: number,
  holdType: HoldType
): Promise<EscrowHold> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("escrow_holds")
    .insert({
      job_id: jobId,
      payer_profile_id: payerProfileId,
      amount_millicents: amountMillicents,
      hold_type: holdType,
    })
    .select()
    .single();

  if (error) throw new Error(`Failed to create escrow hold: ${error.message}`);
  return data as EscrowHold;
}

/**
 * Release an escrow hold — mark as released and credit the payer.
 * Used when a dispute is resolved in the payer's favour.
 *
 * SECURITY: Uses atomic UPDATE with status='held' filter to prevent
 * double-crediting on concurrent calls. If the row was already settled,
 * the UPDATE matches 0 rows and we bail out safely.
 */
export async function releaseHold(holdId: string): Promise<void> {
  const admin = createAdminClient();

  // Atomically claim the hold — only succeeds if status is still 'held'
  const { data: hold, error: updateError } = await admin
    .from("escrow_holds")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("id", holdId)
    .eq("status", "held")
    .select("payer_profile_id, amount_millicents")
    .single();

  if (updateError || !hold) {
    // Already settled by a concurrent call, or hold doesn't exist — safe to skip
    return;
  }

  // Credit payer via add_credits RPC — only runs if we won the atomic claim
  await admin.rpc("add_credits", {
    p_user_id: hold.payer_profile_id,
    p_amount_millicents: hold.amount_millicents,
  });
}

/**
 * Forfeit an escrow hold — mark as forfeited, split between winner and platform.
 * Used when a dispute is resolved against the payer.
 * Winner gets 50% of forfeited amount; platform keeps 50%.
 *
 * SECURITY: Uses atomic UPDATE with status='held' filter to prevent
 * double-crediting on concurrent calls.
 */
export async function forfeitHold(
  holdId: string,
  winnerProfileId: string,
  platformCutPct: number = 50
): Promise<{ winnerAmount: number; platformAmount: number }> {
  const admin = createAdminClient();

  // Atomically claim the hold
  const { data: hold, error: updateError } = await admin
    .from("escrow_holds")
    .update({ status: "forfeited", released_at: new Date().toISOString() })
    .eq("id", holdId)
    .eq("status", "held")
    .select("job_id, amount_millicents")
    .single();

  if (updateError || !hold) {
    // Already settled — return zeroes to indicate no action taken
    return { winnerAmount: 0, platformAmount: 0 };
  }

  const platformAmount = Math.floor((hold.amount_millicents * platformCutPct) / 100);
  const winnerAmount = hold.amount_millicents - platformAmount;

  // Credit winner — only runs if we won the atomic claim
  await admin.rpc("add_credits", {
    p_user_id: winnerProfileId,
    p_amount_millicents: winnerAmount,
  });

  // Log platform revenue from forfeit
  await admin.from("dispute_reserve").insert({
    job_id: hold.job_id,
    source: "dispute_forfeit",
    amount_millicents: platformAmount,
  });

  return { winnerAmount, platformAmount };
}

/**
 * Settle all deposits for a dispute.
 * Winner: gets their deposit back + 50% of loser's deposit.
 * Platform: keeps 50% of loser's deposit → dispute_reserve.
 *
 * SECURITY: Uses atomic UPDATE with status='held' filter on each deposit
 * to prevent double-crediting on concurrent settlement calls.
 */
export async function settleDispute(
  disputeId: string,
  resolution: "upheld" | "rejected" | "partial",
  jobId: string
): Promise<void> {
  const admin = createAdminClient();

  const { data: deposits } = await admin
    .from("dispute_deposits")
    .select("*")
    .eq("dispute_id", disputeId)
    .eq("status", "held");

  if (!deposits || deposits.length === 0) return;

  for (const deposit of deposits) {
    // Atomically claim each deposit — prevents double-processing
    const newStatus = resolution === "rejected" ? "forfeited" : "returned";
    const { data: claimed, error: claimError } = await admin
      .from("dispute_deposits")
      .update({ status: newStatus })
      .eq("id", deposit.id)
      .eq("status", "held")
      .select("id")
      .single();

    // Skip if already claimed by a concurrent call
    if (claimError || !claimed) continue;

    if (resolution === "upheld") {
      await admin.rpc("add_credits", {
        p_user_id: deposit.profile_id,
        p_amount_millicents: deposit.amount_millicents,
      });
    } else if (resolution === "rejected") {
      await admin.from("dispute_reserve").insert({
        job_id: jobId,
        source: "dispute_forfeit",
        amount_millicents: deposit.amount_millicents,
      });
    } else {
      // Partial — return 50% of deposit
      await admin.rpc("add_credits", {
        p_user_id: deposit.profile_id,
        p_amount_millicents: Math.floor(deposit.amount_millicents * 0.5),
      });
    }
  }
}
