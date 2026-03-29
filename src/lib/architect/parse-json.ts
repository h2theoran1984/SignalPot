/**
 * Robust JSON parsing with truncation repair.
 * Shared across all Architect generation steps.
 */

export function parseJsonResponse(raw: string): unknown {
  let text = raw.trim();

  // Strip markdown code blocks
  if (text.startsWith("```")) {
    text = text.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "");
  }

  // First try: direct parse
  try {
    return JSON.parse(text);
  } catch {
    // Fall through to repair
  }

  // Repair: close unclosed strings, brackets, braces
  let repaired = text;

  // Check for unterminated string — if odd number of unescaped quotes, close it
  let inString = false;
  let escaped = false;
  let openBraces = 0;
  let openBrackets = 0;

  for (const ch of repaired) {
    if (escaped) { escaped = false; continue; }
    if (ch === "\\") { escaped = true; continue; }
    if (ch === '"') { inString = !inString; continue; }
    if (inString) continue;
    if (ch === "{") openBraces++;
    if (ch === "}") openBraces--;
    if (ch === "[") openBrackets++;
    if (ch === "]") openBrackets--;
  }

  // If we're stuck inside a string, close it
  if (inString) {
    repaired += '"';
  }

  // Remove trailing comma before closing
  repaired = repaired.replace(/,\s*$/, "");

  // Close open brackets and braces
  for (let i = 0; i < openBrackets; i++) repaired += "]";
  for (let i = 0; i < openBraces; i++) repaired += "}";

  try {
    return JSON.parse(repaired);
  } catch {
    // Last resort: try to find the largest valid JSON prefix
    // by trimming from the end
    for (let i = repaired.length; i > 0; i--) {
      try {
        return JSON.parse(repaired.slice(0, i));
      } catch {
        continue;
      }
    }
    throw new Error(`Failed to parse JSON response (length ${raw.length})`);
  }
}
