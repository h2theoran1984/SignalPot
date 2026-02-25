import type { MetadataRoute } from "next";
import { createClient } from "@supabase/supabase-js";

export const dynamic = "force-dynamic";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  let agentUrls: MetadataRoute.Sitemap = [];

  if (supabaseUrl && supabaseKey) {
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { data: agents } = await supabase
      .from("agents")
      .select("slug, updated_at")
      .eq("status", "active")
      .order("updated_at", { ascending: false })
      .limit(1000);

    agentUrls = (agents ?? []).map((agent) => ({
      url: `${baseUrl}/agents/${agent.slug}`,
      lastModified: agent.updated_at,
      changeFrequency: "weekly",
      priority: 0.8,
    }));
  }

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 1,
    },
    {
      url: `${baseUrl}/agents`,
      lastModified: new Date(),
      changeFrequency: "daily",
      priority: 0.9,
    },
    ...agentUrls,
  ];
}
