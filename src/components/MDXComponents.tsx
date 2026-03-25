import type { MDXComponents } from "mdx/types";

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
};
