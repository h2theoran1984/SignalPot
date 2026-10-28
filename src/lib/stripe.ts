import Stripe from 'stripe';
import { log } from "@/lib/logger";

if (process.env.NODE_ENV === "production") {
  if (!process.env.STRIPE_SECRET_KEY) {
    throw new Error("CRITICAL: STRIPE_SECRET_KEY is not set. Refusing to start without Stripe credentials.");
  }
  if (!process.env.STRIPE_WEBHOOK_SECRET) {
    log.critical("stripe_webhook_secret_missing", {
      impact: "billing webhooks will fail signature verification",
    });
  }
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: '2026-02-25.clover',
});
