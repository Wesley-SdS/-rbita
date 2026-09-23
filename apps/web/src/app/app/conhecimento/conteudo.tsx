"use client";

import dynamic from "next/dynamic";
import { TituloDaVista } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando o mapa…</div>;
}

// `ssr: false` porque o mapa é canvas puro: renderizar no servidor produziria
// uma tela em branco e o custo de hidratar por cima.
const MapaConhecimento = dynamic(() => import("@/components/mapa-conhecimento").then((m) => m.MapaConhecimento), {
  ssr: false,
  loading: Esqueleto,
});

export function Conteudo() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="O QUE EU GUARDEI, E DE ONDE VEIO"
        titulo="Seu segundo cérebro"
        subtitulo="Cada ponto é algo guardado. Cada linha é um vínculo real: a tarefa que nasceu daquela reunião, o que ficou daquela conversa."
      />
      <MapaConhecimento />
    </section>
  );
}
