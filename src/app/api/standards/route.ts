import { NextRequest, NextResponse } from "next/server";
import { CAPABILITY_STANDARDS, getStandardsByCategory } from "@/lib/capability-standards";

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const category = searchParams.get("category");

  const standards = category
    ? getStandardsByCategory(category)
    : CAPABILITY_STANDARDS;

  return NextResponse.json({ standards, total: standards.length });
}
