/**
 * Step 5: Run a smoke test to verify the agent works.
 *
 * Calls the agent's universal endpoint with synthetic input,
 * verifies we get valid JSON back that loosely matches the schema.
 */

import type { RegisteredAgent } from "./register";
import type { CapabilitySchema } from "./schema";

export interface SmokeTestResult {
  passed: boolean;
  response: Record<string, unknown> | null;
  error: string | null;
  durationMs: number;
}

/**
 * Generate minimal synthetic input from an inputSchema.
 * Fills required fields with placeholder values so the agent has something to work with.
 */
function generateSyntheticInput(inputSchema: Record<string, unknown>): Record<string, unknown> {
  const properties = (inputSchema.properties ?? {}) as Record<string, Record<string, unknown>>;
  const required = (inputSchema.required ?? []) as string[];
  const result: Record<string, unknown> = {};

  for (const [key, prop] of Object.entries(properties)) {
    // Fill required fields and a few optional ones
    if (!required.includes(key) && Math.random() > 0.5) continue;

    const type = prop.type as string;
    switch (type) {
      case "string":
        if (prop.enum) {
          const options = prop.enum as string[];
          result[key] = options[0];
        } else {
          result[key] = `Sample ${key.replace(/_/g, " ")}`;
        }
        break;
      case "number":
        result[key] = 100;
        break;
      case "boolean":
        result[key] = true;
        break;
      case "array": {
        const items = prop.items as Record<string, unknown> | undefined;
        if (items?.type === "object") {
          const itemProps = (items.properties ?? {}) as Record<string, Record<string, unknown>>;
          const sampleItem: Record<string, unknown> = {};
          for (const [ik, iv] of Object.entries(itemProps)) {
            const itype = iv.type as string;
            if (itype === "string") sampleItem[ik] = `Sample ${ik}`;
            else if (itype === "number") sampleItem[ik] = 50;
            else if (itype === "boolean") sampleItem[ik] = true;
          }
          result[key] = [sampleItem, { ...sampleItem }];
        } else {
          result[key] = ["sample_1", "sample_2"];
        }
        break;
      }
      case "object":
        result[key] = { note: "sample data" };
        break;
      default:
        result[key] = `sample_${key}`;
    }
  }

  return result;
}

export async function runSmokeTest(
  agent: RegisteredAgent,
  schema: CapabilitySchema
): Promise<SmokeTestResult> {
  const start = Date.now();

  try {
    const syntheticInput = generateSyntheticInput(schema.inputSchema);

    const res = await fetch(agent.mcp_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: `smoke-test-${agent.slug}-${Date.now()}`,
        method: "message/send",
        params: {
          message: {
            role: "user",
            parts: [{ type: "data", data: syntheticInput }],
          },
          metadata: {
            capability_used: schema.name,
          },
        },
      }),
      signal: AbortSignal.timeout(60_000), // 60s timeout for smoke test
    });

    if (!res.ok) {
      return {
        passed: false,
        response: null,
        error: `Endpoint returned ${res.status}: ${await res.text().catch(() => "no body")}`,
        durationMs: Date.now() - start,
      };
    }

    const json = (await res.json()) as Record<string, unknown>;

    // Check for JSON-RPC error
    if (json.error) {
      const err = json.error as { message?: string };
      return {
        passed: false,
        response: null,
        error: `RPC error: ${err.message ?? JSON.stringify(json.error)}`,
        durationMs: Date.now() - start,
      };
    }

    // Extract response data from A2A format
    const result = (json.result ?? json) as Record<string, unknown>;
    const artifacts = result.artifacts as Array<{ parts: Array<{ data?: Record<string, unknown> }> }> | undefined;
    const data = artifacts?.[0]?.parts?.[0]?.data ?? null;

    if (!data || typeof data !== "object") {
      return {
        passed: false,
        response: data as Record<string, unknown> | null,
        error: "Agent returned empty or non-object response",
        durationMs: Date.now() - start,
      };
    }

    // Basic validation: check that at least some expected output keys exist
    const outputProps = Object.keys(
      (schema.outputSchema?.properties ?? {}) as Record<string, unknown>
    );
    const responseKeys = Object.keys(data);
    const matchingKeys = outputProps.filter((k) => responseKeys.includes(k));
    const matchRatio = outputProps.length > 0 ? matchingKeys.length / outputProps.length : 1;

    if (matchRatio < 0.3) {
      return {
        passed: false,
        response: data,
        error: `Response only matched ${matchingKeys.length}/${outputProps.length} expected output keys`,
        durationMs: Date.now() - start,
      };
    }

    return {
      passed: true,
      response: data,
      error: null,
      durationMs: Date.now() - start,
    };
  } catch (err) {
    return {
      passed: false,
      response: null,
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}
