import { notFound } from "next/navigation";
import { compileMDX } from "next-mdx-remote/rsc";
import SiteNav from "@/components/SiteNav";
import { getAllPosts, getPostBySlug } from "@/lib/blog";
import { mdxComponents } from "@/components/MDXComponents";
import Link from "next/link";
import type { Metadata } from "next";

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return getAllPosts().map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) return { title: "Post Not Found" };

  return {
    title: post.title,
    description: post.description,
    openGraph: {
      title: post.title,
      description: post.description,
      type: "article",
      publishedTime: post.date,
      authors: [post.author],
    },
    twitter: {
      card: "summary_large_image",
      title: post.title,
      description: post.description,
    },
  };
}

export default async function BlogPostPage({ params }: Props) {
  const { slug } = await params;
  const post = getPostBySlug(slug);
  if (!post) notFound();

  const { content } = await compileMDX({
    source: post.content,
    components: mdxComponents,
  });

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white">
      <SiteNav />
      <main className="max-w-3xl mx-auto px-6 py-16">
        <Link href="/blog" className="text-sm text-gray-500 hover:text-cyan-400 transition-colors mb-6 inline-block">
          &larr; Back to Blog
        </Link>

        <article>
          <header className="mb-8">
            <time className="text-sm text-gray-500">
              {new Date(post.date).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" })}
            </time>
            <h1 className="text-4xl font-bold text-white mt-2 mb-3">{post.title}</h1>
            <p className="text-gray-400 mb-4">{post.description}</p>
            <div className="flex items-center gap-4">
              <span className="text-sm text-gray-500">By {post.author}</span>
              <div className="flex gap-2">
                {post.tags.map((t) => (
                  <Link
                    key={t}
                    href={`/blog?tag=${t}`}
                    className="text-xs text-cyan-400/70 bg-cyan-400/10 px-2 py-0.5 rounded-full hover:bg-cyan-400/20 transition-colors"
                  >
                    {t}
                  </Link>
                ))}
              </div>
            </div>
          </header>

          <div className="prose-invert">{content}</div>
        </article>
      </main>
    </div>
  );
}
