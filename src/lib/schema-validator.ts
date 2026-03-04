// Output schema validation — lightweight JSON Schema-like checking without external deps.

export interface ValidationResult {
  valid: boolean;
  errors: string[];
}

/**
 * Validate job output against the agent's declared outputSchema.
 * Uses simple type/structure checking — not full JSON Schema.
 * Returns { valid: true, errors: [] } if no schema is defined.
 */
export function validateOutput(
  outputSchema: Record<string, unknown> | null | undefined,
  output: unknown
): ValidationResult {
  // No schema declared — pass by default
  if (!outputSchema || Object.keys(outputSchema).length === 0) {
    return { valid: true, errors: [] };
  }

  const errors: string[] = [];

  // Check type
  if (outputSchema.type) {
    const expectedType = outputSchema.type as string;
    const actualType = Array.isArray(output) ? "array" : typeof output;

    if (
      expectedType === "object" &&
      (typeof output !== "object" || output === null || Array.isArray(output))
    ) {
      errors.push(`Expected type "object", got "${actualType}"`);
    } else if (expectedType === "array" && !Array.isArray(output)) {
      errors.push(`Expected type "array", got "${actualType}"`);
    } else if (expectedType === "string" && typeof output !== "string") {
      errors.push(`Expected type "string", got "${actualType}"`);
    } else if (expectedType === "number" && typeof output !== "number") {
      errors.push(`Expected type "number", got "${actualType}"`);
    }
  }

  // Check required properties (if output is an object)
  if (
    outputSchema.type === "object" &&
    outputSchema.required &&
    Array.isArray(outputSchema.required) &&
    typeof output === "object" &&
    output !== null
  ) {
    for (const key of outputSchema.required as string[]) {
      if (!(key in (output as Record<string, unknown>))) {
        errors.push(`Missing required property: "${key}"`);
      }
    }
  }

  // Check properties exist and have correct types (shallow)
  if (
    outputSchema.type === "object" &&
    outputSchema.properties &&
    typeof output === "object" &&
    output !== null
  ) {
    const props = outputSchema.properties as Record<string, { type?: string }>;
    const outputObj = output as Record<string, unknown>;

    for (const [key, propSchema] of Object.entries(props)) {
      if (key in outputObj && propSchema.type) {
        const actualType = Array.isArray(outputObj[key])
          ? "array"
          : typeof outputObj[key];
        if (actualType !== propSchema.type && outputObj[key] !== null) {
          errors.push(
            `Property "${key}": expected type "${propSchema.type}", got "${actualType}"`
          );
        }
      }
    }
  }

  return {
    valid: errors.length === 0,
    errors,
  };
}
