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
  "arena/match.created": {
    data: {
      match_id: string;
    };
  };
  "arena/match.judging": {
    data: {
      match_id: string;
    };
  };
  "analyst/pipeline.start": {
    data: {
      pipeline_run_id: string;
      dataset_id: string;
      owner_id: string;
      source_id: string;
      column_map: Record<string, { type: string; confidence: string }>;
      template_id: string | null;
    };
  };
  "dispute/escalated-t3": {
    data: {
      dispute_id: string;
      job_id: string;
    };
  };
};
