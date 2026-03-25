"use client";

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";

export default function BlogViewTracker({ slug, title }: { slug: string; title: string }) {
  useEffect(() => {
    trackEvent("blog_post_viewed", { slug, title });
  }, [slug, title]);
  return null;
}
