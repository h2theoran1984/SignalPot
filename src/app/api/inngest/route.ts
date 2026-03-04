import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { settlePayment } from "@/lib/inngest/functions/settle-payment";
import { trustDecay } from "@/lib/inngest/functions/trust-decay";
import { resolveDisputeT1 } from "@/lib/inngest/functions/resolve-dispute-t1";

// Inngest webhook handler — receives events from Inngest cloud and executes functions.
// Vercel env vars needed: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [settlePayment, trustDecay, resolveDisputeT1],
});
