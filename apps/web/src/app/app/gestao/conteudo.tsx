"use client";

import dynamic from "next/dynamic";
import { TituloDaVista } from "@/components/presenca/vista";
import { useAdiantarRecursos } from "@/lib/dados/recurso";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const GestaoPanel = dynamic(() => import("@/components/gestao-panel").then((m) => m.GestaoPanel), { ssr: false, loading: Esqueleto });

export function Conteudo() {
  useAdiantarRecursos(["/api/gestao?periodo=semana"]);

  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="SABER O QUE CUSTA É PARTE DE CONFIAR"
        titulo="Para onde o gasto está indo"
        subtitulo="Toda chamada paga da casa, de qualquer fluxo, num lugar só."
      />
      <GestaoPanel />
    </section>
  );
}
