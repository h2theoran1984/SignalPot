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
 */
export async function releaseHold(holdId: string): Promise<void> {
  const admin = createAdminClient();

  // Get the hold
  const { data: hold, error: fetchError } = await admin
    .from("escrow_holds")
    .select("*")
    .eq("id", holdId)
    .eq("status", "held")
    .single();

  if (fetchError || !hold) throw new Error(`Hold not found or already settled: ${holdId}`);

  // Mark released
  await admin
    .from("escrow_holds")
    .update({ status: "released", released_at: new Date().toISOString() })
    .eq("id", holdId);

  // Credit payer via add_credits RPC
  // add_credits params: p_user_id (UUID), p_amount_millicents (BIGINT)
  await admin.rpc("add_credits", {
    p_user_id: hold.payer_profile_id,
    p_amount_millicents: hold.amount_millicents,
  });
}

/**
 * Forfeit an escrow hold — mark as forfeited, split between winner and platform.
 * Used when a dispute is resolved against the payer.
 * Winner gets 50% of forfeited amount; platform keeps 50%.
 */
export async function forfeitHold(
  holdId: string,
  winnerProfileId: string,
  platformCutPct: number = 50
): Promise<{ winnerAmount: number; platformAmount: number }> {
  const admin = createAdminClient();

  // Get the hold
  const { data: hold, error: fetchError } = await admin
    .from("escrow_holds")
    .select("*")
    .eq("id", holdId)
    .eq("status", "held")
    .single();

  if (fetchError || !hold) throw new Error(`Hold not found or already settled: ${holdId}`);

  const platformAmount = Math.floor((hold.amount_millicents * platformCutPct) / 100);
  const winnerAmount = hold.amount_millicents - platformAmount;

  // Mark forfeited
  await admin
    .from("escrow_holds")
    .update({ status: "forfeited", released_at: new Date().toISOString() })
    .eq("id", holdId);

  // Credit winner via add_credits RPC
  // add_credits params: p_user_id (UUID), p_amount_millicents (BIGINT)
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
