// GET /api/agents/[slug]/a2a — A2A Agent Card for a specific agent
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildAgentCard } from "@/lib/a2a/handler";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ slug: string }> }
) {
  const { slug } = await params;
  const baseUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://signalpot.dev";

  const supabase = await createClient();
  const { data: agent, error } = await supabase
    .from("agents")
    .select("*")
    .eq("slug", slug)
    .eq("status", "active")
    .single();

  if (error || !agent) {
    return NextResponse.json(
      { error: "Agent not found" },
      { status: 404, headers: CORS }
    );
  }

  const card = buildAgentCard(agent, baseUrl);

  return NextResponse.json(card, { headers: CORS });
}
