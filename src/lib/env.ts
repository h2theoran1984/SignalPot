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

function toUrl(value: string): URL | null {
  try {
    return new URL(value.startsWith("http://") || value.startsWith("https://") ? value : `https://${value}`);
  } catch {
    return null;
  }
}

export function getAppOrigin(fallbackUrl?: string): string {
  const configured = getEnv("NEXT_PUBLIC_SITE_URL");
  if (configured) {
    const parsed = toUrl(configured);
    if (parsed) return parsed.origin;
    warnOnce(
      "invalid-site-url",
      `[infra] NEXT_PUBLIC_SITE_URL is invalid: '${configured}'. Falling back to request origin.`
    );
  }
  if (fallbackUrl) {
    return new URL(fallbackUrl).origin;
  }
  return "https://www.signalpot.dev";
}
