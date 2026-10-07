"use client";

import type { CSSProperties } from "react";
import type { FonteDaWeb } from "@/components/console/types";

/**
 * DE ONDE VEIO O QUE A ÓRBITA CONTOU, como um maço de cartas.
 *
 * O dono pediu assim: "vários cards empilhados como se fossem cartões, que ao
 * passar o mouse vão deslizando e vejo o título de cada um; se eu quiser,
 * clico e vou direto ao site". Fechada, a pilha ocupa o espaço de UMA carta
 * (a notícia fica em primeiro plano, não uma lista de links); ao passar o
 * mouse ou chegar pelo teclado, as cartas se abrem em leque.
 *
 * `para` diz para onde abrem: no canto da tela inicial ela está colada no
 * rodapé e abre para CIMA; na conversa abre para baixo, no fluxo do texto.
 * Cada carta é um link de verdade, em aba nova e sem `opener`: a página da
 * notícia não ganha acesso à Órbita.
 */
export function FontesPilha({ fontes, para = "baixo" }: { fontes: FonteDaWeb[]; para?: "cima" | "baixo" }) {
  if (!fontes.length) return null;
  const total = fontes.length;
  return (
    <nav
      className={`fontes-pilha abre-${para}`}
      style={{ "--total": total } as CSSProperties}
      aria-label={`${total} ${total === 1 ? "fonte" : "fontes"} da busca`}
    >
      <span className="fontes-pilha-rotulo">
        {total} {total === 1 ? "fonte" : "fontes"}
      </span>
      <ol>
        {fontes.map((f, i) => (
          <li key={f.url} style={{ "--i": i, zIndex: total - i } as CSSProperties}>
            <a href={f.url} target="_blank" rel="noopener noreferrer" title={f.titulo}>
              <span className="fonte-site">
                <span className="fonte-inicial" aria-hidden="true">{f.site.charAt(0).toUpperCase()}</span>
                {f.site}
              </span>
              <strong className="fonte-titulo">{f.titulo}</strong>
              {f.trecho ? <span className="fonte-trecho">{f.trecho}</span> : null}
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
