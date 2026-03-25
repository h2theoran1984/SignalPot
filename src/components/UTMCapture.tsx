"use client";

import { useEffect } from "react";

const UTM_KEYS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
] as const;

const UTM_STORAGE_KEY = "sp_utm";

export default function UTMCapture() {
  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const utm: Record<string, string> = {};

      for (const key of UTM_KEYS) {
        const value = params.get(key);
        if (value) utm[key] = value;
      }

      if (Object.keys(utm).length > 0) {
        sessionStorage.setItem(UTM_STORAGE_KEY, JSON.stringify(utm));
      }
    } catch {
      // Silently ignore — sessionStorage may be unavailable in some contexts
    }
  }, []);

  return null;
}
