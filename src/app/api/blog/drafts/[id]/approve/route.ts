import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

// POST /api/blog/drafts/[id]/approve — publish draft to GitHub (triggers Vercel deploy)
export async function POST(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const admin = createAdminClient();

  // Fetch the draft
  const { data: draft, error: fetchErr } = await admin
    .from("blog_drafts")
    .select("*")
    .eq("id", id)
    .eq("status", "draft")
    .single();

  if (fetchErr || !draft) {
    return NextResponse.json(
      { error: "Draft not found or already processed" },
      { status: 404 }
    );
  }

  // Publish to GitHub
  const githubToken = process.env.GITHUB_TOKEN;
  const repoOwner = process.env.GITHUB_REPO_OWNER;
  const repoName = process.env.GITHUB_REPO_NAME;

  if (!githubToken || !repoOwner || !repoName) {
    return NextResponse.json(
      { error: "GitHub integration not configured. Set GITHUB_TOKEN, GITHUB_REPO_OWNER, GITHUB_REPO_NAME." },
      { status: 500 }
    );
  }

  const fileName = `${draft.slug}.mdx`;
  const filePath = `src/content/blog/${fileName}`;

  // Create file via GitHub Contents API
  const ghResponse = await fetch(
    `https://api.github.com/repos/${repoOwner}/${repoName}/contents/${filePath}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${githubToken}`,
        "Content-Type": "application/json",
        Accept: "application/vnd.github.v3+json",
      },
      body: JSON.stringify({
        message: `Add blog post: ${draft.title}`,
        content: Buffer.from(draft.content).toString("base64"),
        branch: "main",
      }),
    }
  );

  if (!ghResponse.ok) {
    const ghError = await ghResponse.text();
    console.error("[blog-approve] GitHub API error:", ghError);
    return NextResponse.json(
      { error: "Failed to publish to GitHub" },
      { status: 500 }
    );
  }

  // Update draft status
  await admin
    .from("blog_drafts")
    .update({
      status: "published",
      reviewed_at: new Date().toISOString(),
      published_at: new Date().toISOString(),
    })
    .eq("id", id);

  return NextResponse.json({
    status: "published",
    file: filePath,
    message: "Blog post published. Vercel will deploy automatically.",
  });
}
