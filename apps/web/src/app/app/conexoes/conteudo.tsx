"use client";

import dynamic from "next/dynamic";
import { TituloDaVista, Abas } from "@/components/presenca/vista";
import { useAdiantarRecursos } from "@/lib/dados/recurso";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const ConnectorsPanel = dynamic(() => import("@/components/connectors-panel").then((m) => m.ConnectorsPanel), { ssr: false, loading: Esqueleto });
const ExtensionsPanel = dynamic(() => import("@/components/extensions-panel").then((m) => m.ExtensionsPanel), { ssr: false, loading: Esqueleto });

export function Conteudo() {
  // O pedido sai agora, enquanto o JavaScript dos painéis ainda baixa.
  // Sem isto, baixar o código e buscar os dados aconteciam em fila.
  useAdiantarRecursos(["/api/connectors"], { estavel: true });

  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="TUDO MAIS PERTO. VOCÊ NO CONTROLE"
        titulo="Seu universo conectado"
        subtitulo="Escolha o que entra na conversa. Cada conexão tem um limite claro."
      />
      <Abas
        abas={[
          { id: "conectores", rotulo: "Conectores", conteudo: <ConnectorsPanel /> },
          { id: "extensoes", rotulo: "Extensões", conteudo: <ExtensionsPanel /> },
        ]}
      />
    </section>
  );
}
