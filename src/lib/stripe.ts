import Stripe from "stripe";
import { getEnv, requireEnv, warnOnce } from "@/lib/env";

let client: Stripe | null = null;

function getStripeClient(): Stripe {
  if (client) return client;

  const secretKey = requireEnv(
    "STRIPE_SECRET_KEY",
    "billing routes that call Stripe APIs"
  );
  if (!getEnv("STRIPE_WEBHOOK_SECRET")) {
    warnOnce(
      "stripe-webhook-secret-missing",
      "[infra] STRIPE_WEBHOOK_SECRET is not set. Stripe webhook signature verification will fail."
    );
  }

  client = new Stripe(secretKey, {
    apiVersion: "2026-02-25.clover",
  });
  return client;
}

export const stripe = new Proxy({} as Stripe, {
  get(_target, prop, receiver) {
    return Reflect.get(getStripeClient(), prop, receiver);
  },
});
