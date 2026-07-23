"use client";

import { memo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

// Constantes de módulo: recriar `components`/`remarkPlugins` a cada render
// invalidava qualquer memo interno do ReactMarkdown e forçava re-parse.
const REMARK_PLUGINS = [remarkGfm];
const COMPONENTS: Components = {
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
};

/**
 * Renderiza markdown (código, listas, tabelas, links) com o tema da Órbita.
 * `memo` pela string `children`: durante o streaming, só a mensagem que está
 * crescendo re-parseia — as anteriores ficam estáveis (antes, TODAS re-parseavam
 * a cada flush de 60ms, disputando a main-thread com a animação do Orb).
 */
export const Markdown = memo(function Markdown({ children }: { children: string }) {
  return (
    <div className="orbita-md text-sm leading-relaxed">
      <ReactMarkdown remarkPlugins={REMARK_PLUGINS} components={COMPONENTS}>
        {children}
      </ReactMarkdown>
    </div>
  );
});
