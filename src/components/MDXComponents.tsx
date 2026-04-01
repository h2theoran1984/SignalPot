import type { MDXComponents } from "mdx/types";

function MatrixPills() {
  return (
    <div className="text-center py-12 mt-12 bg-[#050508] rounded-xl border border-[#1a1a2e]">
      <p className="text-gray-600 text-xs tracking-[0.3em] uppercase mb-6">
        Choose your path
      </p>
      <div className="flex justify-center items-center gap-8">
        <a
          href="https://signalpot.dev/build"
          className="group relative inline-block px-10 py-4 rounded-full font-bold text-sm tracking-[0.15em] uppercase no-underline transition-all duration-300 hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #dc2626 0%, #991b1b 50%, #7f1d1d 100%)",
            color: "#fecaca",
            boxShadow: "0 0 20px rgba(220, 38, 38, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
            border: "1px solid rgba(220, 38, 38, 0.4)",
          }}
        >
          BUILD
        </a>
        <a
          href="https://signalpot.dev/arena"
          className="group relative inline-block px-10 py-4 rounded-full font-bold text-sm tracking-[0.15em] uppercase no-underline transition-all duration-300 hover:scale-105"
          style={{
            background: "linear-gradient(135deg, #2563eb 0%, #1e40af 50%, #1e3a8a 100%)",
            color: "#bfdbfe",
            boxShadow: "0 0 20px rgba(37, 99, 235, 0.3), inset 0 1px 0 rgba(255,255,255,0.15)",
            border: "1px solid rgba(37, 99, 235, 0.4)",
          }}
        >
          EXPLORE
        </a>
      </div>
    </div>
  );
}

export const mdxComponents: MDXComponents = {
  h1: (props) => (
    <h1 className="text-3xl font-bold text-white mt-10 mb-4" {...props} />
  ),
  h2: (props) => (
    <h2 className="text-2xl font-semibold text-white mt-8 mb-3" {...props} />
  ),
  h3: (props) => (
    <h3 className="text-xl font-semibold text-white mt-6 mb-2" {...props} />
  ),
  p: (props) => (
    <p className="text-gray-300 leading-relaxed mb-4" {...props} />
  ),
  a: (props) => (
    <a className="text-cyan-400 hover:text-cyan-300 underline underline-offset-2" {...props} />
  ),
  ul: (props) => (
    <ul className="list-disc list-inside text-gray-300 mb-4 space-y-1" {...props} />
  ),
  ol: (props) => (
    <ol className="list-decimal list-inside text-gray-300 mb-4 space-y-1" {...props} />
  ),
  li: (props) => <li className="text-gray-300" {...props} />,
  blockquote: (props) => (
    <blockquote className="border-l-4 border-cyan-400 bg-[#111118] px-4 py-3 my-4 text-gray-400 italic" {...props} />
  ),
  code: (props) => (
    <code className="bg-[#1f2028] text-cyan-300 px-1.5 py-0.5 rounded text-sm font-mono" {...props} />
  ),
  pre: (props) => (
    <pre className="bg-[#111118] border border-[#1f2028] rounded-lg p-4 overflow-x-auto mb-4 text-sm" {...props} />
  ),
  hr: () => <hr className="border-[#1f2028] my-8" />,
  strong: (props) => <strong className="text-white font-semibold" {...props} />,
  MatrixPills: () => <MatrixPills />,
};
