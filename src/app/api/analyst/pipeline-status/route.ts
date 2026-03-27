import { NextRequest, NextResponse } from "next/server";
import { getAuthContext } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * GET /api/analyst/pipeline-status?id=...
 * Get the current status of a pipeline run.
 *
 * GET /api/analyst/pipeline-status?dataset_id=...
 * Get the latest pipeline run for a dataset.
 */
export async function GET(request: NextRequest) {
  const auth = await getAuthContext(request);
  if (!auth) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const pipelineId = request.nextUrl.searchParams.get("id");
  const datasetId = request.nextUrl.searchParams.get("dataset_id");

  if (pipelineId) {
    const { data, error } = await admin
      .from("analyst_pipeline_runs")
      .select("*")
      .eq("id", pipelineId)
      .eq("owner_id", auth.profileId)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "Pipeline run not found" }, { status: 404 });
    }

    return NextResponse.json({ pipeline: data });
  }

  if (datasetId) {
    const { data, error } = await admin
      .from("analyst_pipeline_runs")
      .select("*")
      .eq("dataset_id", datasetId)
      .eq("owner_id", auth.profileId)
      .order("started_at", { ascending: false })
      .limit(1)
      .single();

    if (error || !data) {
      return NextResponse.json({ error: "No pipeline runs found" }, { status: 404 });
    }

    return NextResponse.json({ pipeline: data });
  }

  // List recent pipeline runs
  const { data, error } = await admin
    .from("analyst_pipeline_runs")
    .select("id, dataset_id, status, current_step, steps_completed, steps_total, file_name, row_count, started_at, completed_at")
    .eq("owner_id", auth.profileId)
    .order("started_at", { ascending: false })
    .limit(20);

  if (error) {
    return NextResponse.json({ error: "Failed to fetch pipeline runs" }, { status: 500 });
  }

  return NextResponse.json({ pipelines: data ?? [] });
}
