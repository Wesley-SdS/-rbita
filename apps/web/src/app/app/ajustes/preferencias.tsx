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
const AnexosPanel = dynamic(() => import("@/components/anexos-panel").then((m) => m.AnexosPanel), { ssr: false, loading: Esqueleto });
const ControlePanel = dynamic(() => import("@/components/controle-panel").then((m) => m.ControlePanel), { ssr: false, loading: Esqueleto });

/** `aba`: abre direto numa aba (o cartão "Órbita no controle" leva a `?aba=controle`). */
export function Preferencias({ email, aba }: { email: string; aba?: string }) {
  return (
    <section className="view">
      <TituloDaVista
        sobrancelha="NENHUMA PRESENÇA É IGUAL"
        titulo="Do seu jeito"
        subtitulo="A experiência se adapta ao seu ritmo, não o contrário."
      />
      <Abas
        inicial={aba}
        abas={[
          { id: "geral", rotulo: "Ajustes", conteudo: <SettingsPanel /> },
          { id: "persona", rotulo: "Persona", conteudo: <PersonaPanel /> },
          { id: "ferramentas", rotulo: "Ferramentas", conteudo: <ToolsPanel /> },
          { id: "trabalhos", rotulo: "Trabalhos", conteudo: <JobsPanel /> },
          { id: "anexos", rotulo: "Anexos", conteudo: <AnexosPanel /> },
          { id: "controle", rotulo: "Controle do PC", conteudo: <ControlePanel /> },
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
