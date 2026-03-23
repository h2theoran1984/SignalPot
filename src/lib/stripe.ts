import Stripe from 'stripe';

if (process.env.NODE_ENV === "production") {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("CRITICAL: STRIPE_SECRET_KEY is not set. Refusing to start without Stripe credentials.");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    console.error("CRITICAL: STRIPE_WEBHOOK_SECRET is not set. Billing webhooks will silently fail.");
  }
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});
