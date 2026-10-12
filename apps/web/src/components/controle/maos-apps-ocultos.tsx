"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, ErrorRetry } from "@/components/ui";
import { ListaDeAjuste, salvarAjuste } from "./lista-de-ajuste";

/**
 * Bloco "apps_ocultos" (frente A): os apps que a Órbita nunca vê. A janela
 * deles sai PINTADA DE PRETO na captura e some da árvore de acessibilidade, já
 * no serviço do Windows, antes de qualquer byte sair do PC. Mostra os apps
 * abertos agora para esconder com um clique (pelo nome do programa, não pelo
 * título da janela, que é conteúdo).
 */

interface Apps {
  apps: { app: string; exe: string; oculto: boolean; janelas: number }[];
  ocultos: string[];
  maosLigadas: boolean;
}

const URL = "/api/maos/apps";
const dim = { color: "var(--color-ink-dim)" } as const;

export function MaosAppsOcultos() {
  const { dado, erro, recarregar } = useRecurso<Apps>(URL);
  const [aviso, setAviso] = useState<string | null>(null);
  if (erro && !dado) return <ErrorRetry message={erro} onRetry={recarregar} />;
  if (!dado) return <p className="text-[14px]" style={dim}>Carregando…</p>;
  const mudou = () => invalidar(URL);

  async function ocultar(exe: string) {
    const nome = exe.replace(/\.exe$/i, "");
    if (dado!.ocultos.some((o) => o.toLowerCase() === nome.toLowerCase())) return;
    setAviso(await salvarAjuste("computador.appsOcultos", [...dado!.ocultos, nome]));
    mudou();
  }

  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <ListaDeAjuste chave="computador.appsOcultos" itens={dado.ocultos} placeholder="KeePass" aoMudar={mudou} />
      <div className="border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="mb-2 font-semibold">Abertos agora</p>
        {!dado.maosLigadas ? (
          <p className="text-[14px]" style={dim}>O serviço do Windows está desligado: não dá para ver o que está aberto.</p>
        ) : dado.apps.length ? (
          <ul className="flex flex-col gap-1">
            {dado.apps.map((a) => (
              <li key={a.exe || a.app} className="flex items-baseline justify-between gap-2">
                <span>
                  <b>{a.app}</b> <span style={dim}>· {a.exe} · {a.janelas} janela{a.janelas > 1 ? "s" : ""}</span>
                </span>
                {a.oculto ? (
                  <span className="text-[14px]" style={dim}>oculto</span>
                ) : (
                  <Button variant="subtle" size="sm" onClick={() => void ocultar(a.exe || a.app)}>
                    Ocultar
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px]" style={dim}>Nenhuma janela aberta.</p>
        )}
      </div>
      {aviso ? <p className="notice">{aviso}</p> : null}
    </div>
  );
}
