"use client";

import dynamic from "next/dynamic";
import { TituloDaVista, Abas } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const RoutinesPanel = dynamic(() => import("@/components/routines-panel").then((m) => m.RoutinesPanel), { ssr: false, loading: Esqueleto });
const RulesPanel = dynamic(() => import("@/components/rules-panel").then((m) => m.RulesPanel), { ssr: false, loading: Esqueleto });

export default function PaginaRotinas() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="O COTIDIANO PODE SER MAIS LEVE"
        titulo="Pequenos rituais, grandes respiros"
        subtitulo="Você escolhe a intenção. A Órbita cuida da sequência."
      />
      <Abas
        abas={[
          { id: "rotinas", rotulo: "Rotinas", conteudo: <RoutinesPanel /> },
          { id: "regras", rotulo: "Regras proativas", conteudo: <RulesPanel /> },
        ]}
      />
    </section>
  );
}
