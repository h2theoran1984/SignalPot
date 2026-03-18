// Arena Processor Registry — pluggable pre/post-processors for arena matches.
// Each processor can enrich prompts before agents see them and add
// verification context for the judge. AutoTune detects when a processor
// would help and activates it automatically.

import { dateResolverProcessor } from "./date-resolver";

/**
 * A pluggable arena processor that transforms prompts and/or adds
 * judge verification context for a specific class of problems.
 *
 * Processors are platform-side TypeScript modules — no dynamic code,
 * no eval, no user-submitted logic.
 */
export interface ArenaProcessor {
  /** Unique ID, e.g. "date-resolver" */
  id: string;

  /** Human-readable name */
  name: string;

  /** Which capabilities this processor is relevant to (matched against the verb portion) */
  applicable_capabilities: string[];

  /** Patterns that AutoTune uses to detect when this processor would help */
  detection_patterns: {
    /** Rubric criteria names to look for in the weakest criteria list */
    criteria_names: string[];
    /** Keywords to search for in loss reasons */
    loss_keywords: string[];
    /** Minimum loss rate (0-1) before this processor is recommended */
    min_loss_rate: number;
  };

  /**
   * Pre-process the prompt before sending to the agent.
   * Returns the enriched prompt (e.g., with date cheat sheet appended).
   */
  preProcess(prompt: Record<string, unknown>): Record<string, unknown>;

  /**
   * Build verification context for the judge prompt.
   * Returns a string to include in the "Verification Reference" section,
   * or null if no verification is applicable for this prompt.
   */
  buildVerification(
    prompt: Record<string, unknown>,
    responseA: Record<string, unknown>,
    responseB: Record<string, unknown>,
  ): string | null;
}

/**
 * All available processors. Adding a new processor is just:
 * 1. Create src/lib/arena/processors/my-processor.ts implementing ArenaProcessor
 * 2. Import and add it to this array
 * AutoTune will automatically detect and activate it when loss patterns match.
 */
export const PROCESSOR_REGISTRY: ArenaProcessor[] = [
  dateResolverProcessor,
];
