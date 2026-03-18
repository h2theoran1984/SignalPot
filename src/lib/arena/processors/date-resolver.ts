// Date Resolver Processor — resolves relative day references in meeting
// transcripts to absolute ISO dates. Eliminates date arithmetic from the LLM.
//
// Two halves:
// - preProcess: appends a DATE REFERENCE cheat sheet to the prompt text
// - buildVerification: computes ground truth dates and scores both agents

import type { ArenaProcessor } from "./index";

// ============================================================
// Shared date utilities
// ============================================================

const MONTH_MAP: Record<string, number> = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

const DAY_NAMES = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

/** Parse a meeting date from transcript text. */
function parseMeetingDate(text: string): Date | null {
  const monthFirst = text.match(
    /\b(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{1,2}),?\s+(\d{4})\b/i
  );
  if (monthFirst) {
    return new Date(parseInt(monthFirst[3], 10), MONTH_MAP[monthFirst[1].toLowerCase()], parseInt(monthFirst[2], 10));
  }
  const dayFirst = text.match(
    /\b(\d{1,2})\s+(january|february|march|april|may|june|july|august|september|october|november|december)\s+(\d{4})\b/i
  );
  if (dayFirst) {
    return new Date(parseInt(dayFirst[3], 10), MONTH_MAP[dayFirst[2].toLowerCase()], parseInt(dayFirst[1], 10));
  }
  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) return new Date(parseInt(iso[1], 10), parseInt(iso[2], 10) - 1, parseInt(iso[3], 10));
  return null;
}

function toISO(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(d: Date, n: number): Date {
  const result = new Date(d);
  result.setDate(result.getDate() + n);
  return result;
}

// ============================================================
// Pre-process: Append date cheat sheet to prompt
// ============================================================

/**
 * Scan transcript text for relative day references and build a date cheat sheet.
 * Returns the original text with the cheat sheet appended.
 */
function resolveRelativeDates(text: string): string {
  const meetingDate = parseMeetingDate(text);
  if (!meetingDate) return text;

  const meetingDow = meetingDate.getDay();
  const lowerText = text.toLowerCase();
  const entries: string[] = [];
  const seen = new Set<string>();

  const add = (label: string, date: Date) => {
    const iso = toISO(date);
    const key = `${label}=${iso}`;
    if (!seen.has(key)) {
      seen.add(key);
      entries.push(`- "${label}" = ${iso}`);
    }
  };

  if (/\btoday\b|\bend of day\b|\bby eod\b|\beod\b/i.test(text)) {
    add("today / end of day / EOD", meetingDate);
  }
  if (/\btomorrow\b/i.test(text)) {
    add("tomorrow", addDays(meetingDate, 1));
  }
  for (let i = 0; i < 7; i++) {
    const dayName = DAY_NAMES[i];
    if (new RegExp(`\\b${dayName}\\b`, "i").test(lowerText)) {
      const offset = (i - meetingDow + 7) % 7;
      if (offset > 0) {
        add(dayName.charAt(0).toUpperCase() + dayName.slice(1), addDays(meetingDate, offset));
      }
    }
  }
  if (/\bnext week\b/i.test(text)) {
    add("next week (Monday)", addDays(meetingDate, 7 - meetingDow + 1));
  }

  if (entries.length === 0) return text;

  const cheatSheet = `\n\n---\nDATE REFERENCE (copy these resolved dates for the "due" field):\n${entries.join("\n")}\n---`;
  return text + cheatSheet;
}

// ============================================================
// Verification: Ground truth date accuracy report for judge
// ============================================================

/**
 * Compute ground truth dates from a transcript.
 * Returns a Map of label → correct ISO date.
 */
function computeGroundTruthDates(text: string): Map<string, string> {
  const meetingDate = parseMeetingDate(text);
  const dates = new Map<string, string>();
  if (!meetingDate) return dates;

  const meetingDow = meetingDate.getDay();
  const lowerText = text.toLowerCase();

  if (/\btoday\b|\bend of day\b|\bby eod\b|\beod\b/i.test(text)) {
    dates.set("today/EOD", toISO(meetingDate));
  }
  if (/\btomorrow\b/i.test(text)) {
    dates.set("tomorrow", toISO(addDays(meetingDate, 1)));
  }
  for (let i = 0; i < 7; i++) {
    const dayName = DAY_NAMES[i];
    if (new RegExp(`\\b${dayName}\\b`, "i").test(lowerText)) {
      const offset = (i - meetingDow + 7) % 7;
      if (offset > 0) {
        dates.set(dayName.charAt(0).toUpperCase() + dayName.slice(1), toISO(addDays(meetingDate, offset)));
      }
    }
  }
  if (/\bnext week\b/i.test(text)) {
    dates.set("next week", toISO(addDays(meetingDate, 7 - meetingDow + 1)));
  }
  return dates;
}

/** Extract all YYYY-MM-DD dates from an agent's response. */
function extractAgentDates(response: Record<string, unknown>): string[] {
  const dates: string[] = [];
  const text = JSON.stringify(response);
  const matches = text.match(/\d{4}-\d{2}-\d{2}/g);
  if (matches) {
    for (const m of matches) dates.push(m);
  }
  return Array.from(new Set(dates));
}

/** Check if an agent uses vague relative date text instead of ISO dates. */
function usesVagueDates(response: Record<string, unknown>): boolean {
  const text = JSON.stringify(response);
  return /\b(Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|Monday)\s+(EOD|at|by)\b/i.test(text)
    || /\b(End of day|Tomorrow noon|Tomorrow)\b/i.test(text);
}

/**
 * Build a DATE ACCURACY REPORT comparing both agents' dates against ground truth.
 */
function buildDateAccuracyReport(
  promptObj: Record<string, unknown>,
  responseA: Record<string, unknown>,
  responseB: Record<string, unknown>,
): string | null {
  const text = typeof promptObj.text === "string" ? promptObj.text : JSON.stringify(promptObj);
  const groundTruth = computeGroundTruthDates(text);
  if (groundTruth.size === 0) return null;

  const meetingDate = parseMeetingDate(text)!;
  const meetingDow = meetingDate.getDay();
  const dowName = DAY_NAMES[meetingDow].charAt(0).toUpperCase() + DAY_NAMES[meetingDow].slice(1);

  const gtValues = new Set(groundTruth.values());
  const gtEntries = Array.from(groundTruth.entries()).map(([k, v]) => `${k}=${v}`).join(", ");

  function scoreAgent(response: Record<string, unknown>): { correct: number; total: number; details: string[]; vague: boolean } {
    const agentDates = extractAgentDates(response);
    const vague = usesVagueDates(response);
    let correct = 0;
    const details: string[] = [];

    for (const d of agentDates) {
      if (gtValues.has(d)) {
        correct++;
        details.push(`${d} ✓`);
      } else {
        const closest = Array.from(gtValues).find(gt => Math.abs(
          new Date(d).getTime() - new Date(gt).getTime()
        ) <= 2 * 86400000);
        if (closest) {
          details.push(`${d} ✗ (should be ${closest})`);
        } else {
          details.push(`${d} ?`);
        }
      }
    }

    if (vague) {
      details.push("⚠ Uses vague text dates instead of YYYY-MM-DD");
    }

    return { correct, total: agentDates.length, details, vague };
  }

  const scoreA = scoreAgent(responseA);
  const scoreB = scoreAgent(responseB);

  return `DATE ACCURACY CHECK (computed from transcript using calendar arithmetic):
Meeting held: ${toISO(meetingDate)} (${dowName})
Ground truth dates: ${gtEntries}

Agent A: ${scoreA.correct}/${scoreA.total} dates correct${scoreA.vague ? " | uses vague text dates" : ""}
  ${scoreA.details.join("\n  ")}

Agent B: ${scoreB.correct}/${scoreB.total} dates correct${scoreB.vague ? " | uses vague text dates" : ""}
  ${scoreB.details.join("\n  ")}

Factor this into the accuracy criterion alongside other quality dimensions.`;
}

// ============================================================
// Processor definition
// ============================================================

export const dateResolverProcessor: ArenaProcessor = {
  id: "date-resolver",
  name: "Date Resolver",
  applicable_capabilities: ["meeting-summary", "action-items"],

  detection_patterns: {
    criteria_names: ["accuracy"],
    loss_keywords: ["date", "incorrect date", "wrong day", "wrong deadline", "due date", "deadline"],
    min_loss_rate: 0.3,
  },

  preProcess(prompt: Record<string, unknown>): Record<string, unknown> {
    if (typeof prompt.text === "string") {
      return { ...prompt, text: resolveRelativeDates(prompt.text) };
    }
    return prompt;
  },

  buildVerification(
    prompt: Record<string, unknown>,
    responseA: Record<string, unknown>,
    responseB: Record<string, unknown>,
  ): string | null {
    return buildDateAccuracyReport(prompt, responseA, responseB);
  },
};
