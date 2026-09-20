"use client";

import dynamic from "next/dynamic";
import { TituloDaVista, Abas } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const ConnectorsPanel = dynamic(() => import("@/components/connectors-panel").then((m) => m.ConnectorsPanel), { ssr: false, loading: Esqueleto });
const ExtensionsPanel = dynamic(() => import("@/components/extensions-panel").then((m) => m.ExtensionsPanel), { ssr: false, loading: Esqueleto });

export default function PaginaConexoes() {
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
