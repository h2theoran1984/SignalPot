import { Inngest } from "inngest";

export const inngest = new Inngest({
  id: "signalpot",
  name: "SignalPot",
});

// Typed event definitions for type-safe sends/triggers
export type SignalPotEvents = {
  "job/completed": {
    data: {
      job_id: string;
      platform_fee_pct: number;
    };
  };
  "dispute/filed": {
    data: {
      dispute_id: string;
      job_id: string;
    };
  };
  "dispute/escalated-t2": {
    data: {
      dispute_id: string;
      job_id: string;
    };
  };
};
