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

  // Idempotency: skip events we've already processed
  const { data: existing } = await admin
    .from("webhook_events")
    .select("event_id")
    .eq("event_id", event.id)
    .maybeSingle();

  if (existing) {
    return NextResponse.json({ received: true, deduplicated: true });
  }

  // Record event ID before processing to prevent concurrent duplicates
  await admin.from("webhook_events").insert({ event_id: event.id });

  try {
    switch (event.type) {
      case "checkout.session.completed": {
        const session = event.data.object as Stripe.Checkout.Session;
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

        await admin
          .from("profiles")
          .update({ plan: "free", stripe_subscription_id: null })
          .eq("stripe_customer_id", customerId);
        break;
      }

      case "customer.subscription.updated": {
        const subscription = event.data.object as Stripe.Subscription;
        const customerId = subscription.customer as string;

        // Determine plan from price ID
        const priceId = subscription.items.data[0]?.price?.id;
        const proPriceId = process.env.STRIPE_PRO_PRICE_ID;
        const teamPriceId = process.env.STRIPE_TEAM_PRICE_ID;

        let plan: "free" | "pro" | "team" = "free";
        if (priceId === proPriceId) plan = "pro";
        else if (priceId === teamPriceId) plan = "team";

        await admin
          .from("profiles")
          .update({ plan })
          .eq("stripe_customer_id", customerId);
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
