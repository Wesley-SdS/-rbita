"use client";

import dynamic from "next/dynamic";
import { TituloDaVista } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const MeetingPanel = dynamic(() => import("@/components/meeting-panel").then((m) => m.MeetingPanel), { ssr: false, loading: Esqueleto });

export default function PaginaReunioes() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="ESTEJA NA CONVERSA"
        titulo="O que foi dito ganha um depois"
        subtitulo="Uma escuta atenta. Decisões claras. Próximos passos que não se perdem."
      />
      <MeetingPanel />
    </section>
  );
}
