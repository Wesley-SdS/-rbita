"use client";

import dynamic from "next/dynamic";
import { Abas, TituloDaVista } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const CasaConexao = dynamic(() => import("@/components/home-panel").then((m) => m.CasaConexao), { ssr: false, loading: Esqueleto });
const CasaComodos = dynamic(() => import("@/components/home-panel").then((m) => m.CasaComodos), { ssr: false, loading: Esqueleto });
const CasaDispositivos = dynamic(() => import("@/components/home-panel").then((m) => m.CasaDispositivos), { ssr: false, loading: Esqueleto });
const CasaAparelhos = dynamic(() => import("@/components/home-panel").then((m) => m.CasaAparelhos), { ssr: false, loading: Esqueleto });
const CasaRiscoPorTipo = dynamic(() => import("@/components/home-panel").then((m) => m.CasaRiscoPorTipo), { ssr: false, loading: Esqueleto });
const HomePeoplePanel = dynamic(() => import("@/components/home-people-panel").then((m) => m.HomePeoplePanel), { ssr: false, loading: Esqueleto });
const CameraPanel = dynamic(() => import("@/components/camera-panel").then((m) => m.CameraPanel), { ssr: false, loading: Esqueleto });
const GuidedPanel = dynamic(() => import("@/components/guided-panel").then((m) => m.GuidedPanel), { ssr: false, loading: Esqueleto });

export default function PaginaCasa() {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="TECNOLOGIA QUE SABE ACOLHER"
        titulo="Uma casa no seu ritmo"
        subtitulo="Ambientes que acompanham seu momento. Você continua no controle."
      />
      <Abas
        abas={[
          { id: "ambientes", rotulo: "Ambientes", conteudo: <CasaComodos /> },
          { id: "dispositivos", rotulo: "Dispositivos", conteudo: <CasaDispositivos /> },
          { id: "aparelhos", rotulo: "Aparelhos", conteudo: <CasaAparelhos /> },
          { id: "pessoas", rotulo: "Pessoas da casa", conteudo: <HomePeoplePanel /> },
          { id: "cameras", rotulo: "Câmeras", conteudo: <CameraPanel /> },
          { id: "acompanhar", rotulo: "Acompanhar tarefa", conteudo: <GuidedPanel /> },
          {
            id: "conexao",
            rotulo: "Conexão e risco",
            conteudo: (
              <div className="grid-stack">
                <CasaConexao />
                <CasaRiscoPorTipo />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
