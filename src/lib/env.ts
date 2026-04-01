const warnedKeys = new Set<string>();

export function getEnv(name: string): string | undefined {
  const value = process.env[name];
  if (!value) return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

export function requireEnv(name: string, context?: string): string {
  const value = getEnv(name);
  if (value) return value;
  const details = context ? ` Required for ${context}.` : "";
  throw new Error(`Missing environment variable: ${name}.${details}`);
}

export function warnOnce(key: string, message: string): void {
  if (warnedKeys.has(key)) return;
  warnedKeys.add(key);
  console.warn(message);
}
