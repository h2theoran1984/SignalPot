import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { createAdminClient } from "@/lib/supabase/admin";
import type Stripe from "stripe";

// POST /api/billing/webhook — Stripe webhook handler
// App Router does NOT pre-parse the body, so we can read raw bytes directly.
export async function POST(request: Request) {
  const sig = request.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    return NextResponse.json({ error: "Missing signature or secret" }, { status: 400 });
  }

  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    console.error("Stripe webhook signature verification failed:", message);
    return NextResponse.json({ error: `Webhook Error: ${message}` }, { status: 400 });
  }

  const admin = createAdminClient();

  // Idempotency: atomically claim the event via INSERT ON CONFLICT
  const { data: claimed } = await admin
    .from("webhook_events")
    .upsert({ event_id: event.id }, { onConflict: "event_id", ignoreDuplicates: true })
    .select("event_id")
    .single();

  if (!claimed) {
    // Another request already claimed this event
    return NextResponse.json({ received: true, deduplicated: true });
  }

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;

        // Handle anonymous credit purchases (no user ID needed)
        if (session.metadata?.topup_type === "anonymous_credits") {
          const amountMillicents = (session.amount_total ?? 0) * 1000;
          if (amountMillicents > 0) {
            // Safety net: create session if token retrieval endpoint hasn't yet.
            // The UNIQUE constraint on stripe_session_id prevents duplicates.
            await admin
              .from("anonymous_sessions")
              .upsert(
                {
                  stripe_session_id: session.id,
                  credit_balance_millicents: amountMillicents,
                  ip_address: "0.0.0.0", // Webhook doesn't have caller IP
                },
                { onConflict: "stripe_session_id", ignoreDuplicates: true }
              );
          }
          break;
        }

        // Org subscription checkout
        const orgId = session.metadata?.org_id;
        if (orgId && session.mode === "subscription") {
          const plan = session.metadata?.plan as "pro" | "team" | undefined;
          if (!plan || !["pro", "team"].includes(plan)) break;

          await admin
            .from("organizations")
            .update({
              plan,
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
            })
            .eq("id", orgId);
          break;
        }

        // Personal billing
        const userId = session.metadata?.supabase_user_id;

        if (!userId) break;

        if (session.mode === "subscription") {
          // Subscription checkout — update plan + store Stripe IDs
          const plan = session.metadata?.plan as "pro" | "team" | undefined;
          if (!plan || !["pro", "team"].includes(plan)) break;

          await admin
            .from("profiles")
            .update({
              plan,
              stripe_customer_id: session.customer as string,
              stripe_subscription_id: session.subscription as string,
            })
            .eq("id", userId);

        } else if (session.mode === "payment") {
          // Credit top-up checkout — use Stripe's authoritative amount, not metadata
          const amountTotalCents = session.amount_total;
          if (!amountTotalCents || amountTotalCents <= 0) break;

          const amountMillicents = amountTotalCents * 1000;

          const { error } = await admin.rpc("add_credits", {
            p_user_id: userId,
            p_amount_millicents: amountMillicents,
          });

          if (error) {
            console.error("Failed to add credits:", error);
          }
        }
        break;
      }

      case "customer.subscription.deleted": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Check if this customer belongs to an org
        const { data: deletedOrg } = await admin
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        if (deletedOrg) {
          await admin
            .from("organizations")
            .update({ plan: "free", stripe_subscription_id: null })
            .eq("id", deletedOrg.id);
        } else {
          await admin
            .from("profiles")
            .update({ plan: "free", stripe_subscription_id: null })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Check if this customer belongs to an org
        const { data: updatedOrg } = await admin
          .from("organizations")
          .select("id")
          .eq("stripe_customer_id", customerId)
          .maybeSingle();

        // Determine plan from price ID
        const priceId = subscription.items.data[0]?.price?.id;
        const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
        const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID;
        const orgProPriceId = process.env.STRIPE_ORG_PRO_PRICE_ID;
        const orgTeamPriceId = process.env.STRIPE_ORG_TEAM_PRICE_ID;

        let plan: "free" | "pro" | "team" = "free";
        if (priceId === proPriceId || priceId === orgProPriceId) plan = "pro";
        else if (priceId === teamPriceId || priceId === orgTeamPriceId) plan = "team";

        if (updatedOrg) {
          await admin
            .from("organizations")
            .update({ plan })
            .eq("id", updatedOrg.id);
        } else {
          await admin
            .from("profiles")
            .update({ plan })
            .eq("stripe_customer_id", customerId);
        }
        break;
      }

      default:
        // Ignore unhandled event types
        break;
    }
  } catch (err) {
    console.error("Webhook handler error:", err);
    return NextResponse.json({ error: "Webhook handler failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
