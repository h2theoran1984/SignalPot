import SiteNav from "@/components/SiteNav";
import { getAllPosts, getAllTags } from "@/lib/blog";
import Link from "next/link";

export default async function BlogPage({ searchParams }: { searchParams: Promise<{ tag?: string }> }) {
  const { tag } = await searchParams;
  const allPosts = getAllPosts();
  const allTags = getAllTags();
  const posts = tag ? allPosts.filter((p) => p.tags.includes(tag)) : allPosts;

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-5xl mx-auto px-6 py-16">
        <h1 className="text-4xl font-bold mb-2">Blog</h1>
        <p className="text-gray-400 mb-10">Insights on AI agents, trust systems, and the agent economy.</p>

        <div className="flex flex-col md:flex-row gap-10">
          {/* Tag sidebar */}
          <aside className="md:w-48 shrink-0">
            <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400 mb-3">Tags</h3>
            <div className="flex flex-wrap md:flex-col gap-2">
              <Link
                href="/blog"
                className={`text-sm px-3 py-1 rounded-full transition-colors ${
                  !tag ? "bg-cyan-400/20 text-cyan-400" : "text-gray-500 hover:text-white"
                }`}
              >
                All
              </Link>
              {allTags.map((t) => (
                <Link
                  key={t}
                  href={`/blog?tag=${t}`}
                  className={`text-sm px-3 py-1 rounded-full transition-colors ${
                    tag === t ? "bg-cyan-400/20 text-cyan-400" : "text-gray-500 hover:text-white"
                  }`}
                >
                  {t}
                </Link>
              ))}
            </div>
          </aside>

          {/* Post list */}
          <div className="flex-1 space-y-6">
            {posts.length === 0 ? (
              <p className="text-gray-500">No posts found.</p>
            ) : (
              posts.map((post) => (
                <Link
                  key={post.slug}
                  href={`/blog/${post.slug}`}
                  className="block bg-[#111118] border border-[#1f2028] rounded-lg p-6 hover:border-cyan-400/30 transition-colors"
                >
                  <time className="text-xs text-gray-500">{new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}</time>
                  <h2 className="text-xl font-semibold text-white mt-1 mb-2">{post.title}</h2>
                  <p className="text-gray-400 text-sm mb-3">{post.description}</p>
                  <div className="flex gap-2">
                    {post.tags.map((t) => (
                      <span key={t} className="text-xs text-cyan-400/70 bg-cyan-400/10 px-2 py-0.5 rounded-full">{t}</span>
                    ))}
                  </div>
                </Link>
              ))
            )}
          </div>
        </div>
      </main>
    </div>
  );
}
