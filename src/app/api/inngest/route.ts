import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { settlePayment } from "@/lib/inngest/functions/settle-payment";

// Inngest webhook handler — receives events from Inngest cloud and executes functions.
// Vercel env vars needed: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [settlePayment],
});
