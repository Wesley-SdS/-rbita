"use client";

import dynamic from "next/dynamic";
import { Icone } from "./icones";
import { AvisosLista } from "./avisos-lista";

const ActionsPanel = dynamic(() => import("@/components/actions-panel").then((m) => m.ActionsPanel), { ssr: false });

/**
 * Gaveta de atividade: o que está esperando você e o que já aconteceu.
 *
 * O topo é a fila de aprovações, que é a defesa do §5.1: a Órbita nunca envia
 * e-mail nem cria evento sozinha, só enfileira a proposta. Por isso ela abre
 * primeiro, antes do histórico.
 */
export function Atividade({ aberta, aoFechar }: { aberta: boolean; aoFechar: () => void }) {
  if (!aberta) return null;

  return (
    <div className="gaveta-fundo" onClick={aoFechar} role="presentation">
      <aside
        className="drawer aberta"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label="Atividade e aprovações"
      >
        <div className="drawer-head">
          <div>
            <span className="eyebrow">TRANSPARÊNCIA, SEM RUÍDO</span>
            <h2>O que está acontecendo.</h2>
          </div>
          <button className="icon-button" onClick={aoFechar} aria-label="Fechar atividade">
            <Icone nome="close" />
          </button>
        </div>

        <p className="drawer-intro">
          Um lugar para entender os passos da Órbita e escolher o que pode acontecer depois.
        </p>

        <ActionsPanel />

        <div className="panel-label" style={{ marginTop: 26, marginBottom: 8 }}>
          TRILHA DE ATIVIDADE
        </div>
        {/* A MESMA fonte que a tela de Rotinas lê (outra chave, mesmo prefixo):
            marcar como lido aqui risca lá também. */}
        <AvisosLista de="todos" ativo={aberta} aoNavegar={aoFechar} />
      </aside>
    </div>
  );
}
