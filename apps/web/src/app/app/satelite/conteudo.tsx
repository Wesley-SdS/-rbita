"use client";

import dynamic from "next/dynamic";
import { TituloDaVista } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

// `ssr: false` porque a tela decide tudo a partir do navegador (contexto
// seguro, Wake Lock, id do aparelho): renderizar no servidor daria a resposta
// errada e depois trocaria na cara do dono.
const SatelitePanel = dynamic(() => import("@/components/satelite-panel").then((m) => m.SatelitePanel), {
  ssr: false,
  loading: Esqueleto,
});

export function Conteudo() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="UM OUVIDO EM CADA CÔMODO"
        titulo="Modo satélite"
        subtitulo="Um aparelho antigo no carregador vira o ouvido de um cômodo, sem comprar nada."
      />
      <SatelitePanel />
    </section>
  );
}
