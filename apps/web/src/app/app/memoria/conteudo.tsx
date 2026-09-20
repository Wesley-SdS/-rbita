"use client";

import dynamic from "next/dynamic";
import { TituloDaVista, Abas } from "@/components/presenca/vista";
import { useAdiantarRecursos } from "@/lib/dados/recurso";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const KnowledgePanel = dynamic(() => import("@/components/knowledge-panel").then((m) => m.KnowledgePanel), { ssr: false, loading: Esqueleto });
const MemoryCandidatesPanel = dynamic(() => import("@/components/memory-candidates-panel").then((m) => m.MemoryCandidatesPanel), { ssr: false, loading: Esqueleto });
const FolderPanel = dynamic(() => import("@/components/folder-panel").then((m) => m.FolderPanel), { ssr: false, loading: Esqueleto });
const Insights = dynamic(() => import("@/components/insights").then((m) => m.Insights), { ssr: false, loading: Esqueleto });

export function Conteudo() {
  // O pedido sai agora, enquanto o JavaScript dos painéis ainda baixa.
  // Sem isto, baixar o código e buscar os dados aconteciam em fila.
  useAdiantarRecursos(["/api/knowledge", "/api/memory", "/api/account/reindex"]);

  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="IDEIAS QUE SE ENCONTRAM"
        titulo="Sua segunda memória"
        subtitulo="Mais do que guardar. Conectar o que você sabe ao que está vivendo."
      />
      <Abas
        abas={[
          { id: "acervo", rotulo: "Memória e docs", conteudo: <KnowledgePanel /> },
          { id: "confirmar", rotulo: "A confirmar", conteudo: <MemoryCandidatesPanel visivel /> },
          { id: "arquivos", rotulo: "Arquivos", conteudo: <FolderPanel /> },
          { id: "conexoes", rotulo: "Ver conexões", conteudo: <Insights /> },
        ]}
      />
    </section>
  );
}
