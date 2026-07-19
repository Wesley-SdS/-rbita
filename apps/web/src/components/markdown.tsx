"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

/** Renderiza markdown (código, listas, tabelas, links) com o tema da Órbita. */
export function Markdown({ children }: { children: string }) {
  return (
    <div className="orbita-md text-sm leading-relaxed">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          a: (p) => <a {...p} target="_blank" rel="noreferrer" style={{ color: "var(--color-gold)", textDecoration: "underline" }} />,
          code: ({ children, ...props }) => {
            const inline = !String(children).includes("\n");
            return inline ? (
              <code {...props} style={{ background: "var(--color-ground)", padding: "1px 4px", borderRadius: 4, fontSize: "0.85em" }}>{children}</code>
            ) : (
              <code {...props} className="block overflow-x-auto rounded-lg p-2" style={{ background: "var(--color-ground)", fontSize: "0.82em" }}>{children}</code>
            );
          },
          ul: (p) => <ul {...p} style={{ listStyle: "disc", paddingLeft: 18, margin: "4px 0" }} />,
          ol: (p) => <ol {...p} style={{ listStyle: "decimal", paddingLeft: 18, margin: "4px 0" }} />,
          table: (p) => <table {...p} className="my-1 border-collapse text-xs" />,
          th: (p) => <th {...p} style={{ border: "1px solid var(--color-line)", padding: "2px 6px" }} />,
          td: (p) => <td {...p} style={{ border: "1px solid var(--color-line)", padding: "2px 6px" }} />,
          p: (p) => <p {...p} style={{ margin: "4px 0" }} />,
        }}
      >
        {children}
      </ReactMarkdown>
    </div>
  );
}
