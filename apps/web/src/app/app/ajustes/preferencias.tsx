"use client";

import dynamic from "next/dynamic";
import { Abas, TituloDaVista } from "@/components/presenca/vista";

function Esqueleto() {
  return <div className="panel empty-state">Carregando…</div>;
}

const SettingsPanel = dynamic(() => import("@/components/settings-panel").then((m) => m.SettingsPanel), { ssr: false, loading: Esqueleto });
const PersonaPanel = dynamic(() => import("@/components/side-panels").then((m) => m.PersonaPanel), { ssr: false, loading: Esqueleto });
const EconomyPanel = dynamic(() => import("@/components/side-panels").then((m) => m.EconomyPanel), { ssr: false, loading: Esqueleto });
const PushToggle = dynamic(() => import("@/components/side-panels").then((m) => m.PushToggle), { ssr: false, loading: Esqueleto });
const ToolsPanel = dynamic(() => import("@/components/tools-panel").then((m) => m.ToolsPanel), { ssr: false, loading: Esqueleto });
const JobsPanel = dynamic(() => import("@/components/jobs-panel").then((m) => m.JobsPanel), { ssr: false, loading: Esqueleto });
const PrivacyPanel = dynamic(() => import("@/components/privacy-panel").then((m) => m.PrivacyPanel), { ssr: false, loading: Esqueleto });

export function Preferencias({ email }: { email: string }) {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="NENHUMA PRESENÇA É IGUAL"
        titulo="Do seu jeito"
        subtitulo="A experiência se adapta ao seu ritmo, não o contrário."
      />
      <Abas
        abas={[
          { id: "geral", rotulo: "Ajustes", conteudo: <SettingsPanel /> },
          { id: "persona", rotulo: "Persona", conteudo: <PersonaPanel /> },
          { id: "ferramentas", rotulo: "Ferramentas", conteudo: <ToolsPanel /> },
          { id: "trabalhos", rotulo: "Trabalhos", conteudo: <JobsPanel /> },
          { id: "economia", rotulo: "Economia", conteudo: <EconomyPanel /> },
          {
            id: "privacidade",
            rotulo: "Privacidade",
            conteudo: (
              <div className="grid-stack">
                <PrivacyPanel email={email} />
                <PushToggle />
              </div>
            ),
          },
        ]}
      />
    </section>
  );
}
