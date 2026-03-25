import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest/client";
import { settlePayment } from "@/lib/inngest/functions/settle-payment";
import { trustDecay } from "@/lib/inngest/functions/trust-decay";
import { resolveDisputeT1 } from "@/lib/inngest/functions/resolve-dispute-t1";
import { resolveDisputeT2 } from "@/lib/inngest/functions/resolve-dispute-t2";
import { computeTrustSignals } from "@/lib/inngest/functions/compute-trust-signals";
import { generateStatements } from "@/lib/inngest/functions/generate-statements";
import { dailySettlement } from "@/lib/inngest/functions/daily-settlement";
import { arenaExecuteMatch } from "@/lib/inngest/functions/arena-execute-match";
import { arenaJudgeMatch } from "@/lib/inngest/functions/arena-judge-match";
import { arenaChampionship } from "@/lib/inngest/functions/arena-championship";
import { resolveDisputeT3 } from "@/lib/inngest/functions/resolve-dispute-t3";
import { keykeeperAgeCheck } from "@/lib/inngest/functions/keykeeper-age-check";
import { keykeeperBreachWatch } from "@/lib/inngest/functions/keykeeper-breach-watch";
import { notifySignup } from "@/lib/inngest/functions/notify-signup";

// Inngest webhook handler — receives events from Inngest cloud and executes functions.
// Vercel env vars needed: INNGEST_EVENT_KEY, INNGEST_SIGNING_KEY
// Arena match execution calls agents (up to 30s each) + judging — needs more than 10s default.
export const maxDuration = 60;

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    settlePayment,
    trustDecay,
    resolveDisputeT1,
    resolveDisputeT2,
    resolveDisputeT3,
    computeTrustSignals,
    generateStatements,
    dailySettlement,
    arenaExecuteMatch,
    arenaJudgeMatch,
    arenaChampionship,
    keykeeperAgeCheck,
    keykeeperBreachWatch,
    notifySignup,
  ],
});
