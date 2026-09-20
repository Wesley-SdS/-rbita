"use client";

import { useState } from "react";
import { useAtualizacaoPeriodica } from "@/lib/use-visible";
import { Icone } from "@/components/presenca/icones";

interface Action { id: string; kind: string; summary: string; createdAt: string }

/**
 * Ações a confirmar: propostas de ações com efeito (enviar e-mail, criar evento…)
 * criadas pela Órbita. Só são executadas quando o USUÁRIO aprova aqui — o LLM
 * nunca dispara sozinho (gate contra prompt-injection).
 */
export function ActionsPanel() {
  const [actions, setActions] = useState<Action[]>([]);
  const [busy, setBusy] = useState<string | null>(null);

  function load() {
    fetch("/api/actions").then((r) => r.json()).then((d) => setActions(d.actions ?? [])).catch(() => {});
  }
  // reflete propostas criadas no chat; pausa com a aba escondida e confere na
  // hora em que ela volta (proposta nova não pode esperar o próximo ciclo)
  useAtualizacaoPeriodica(load, 15000);

  async function approve(id: string) {
    setBusy(id);
    try { await fetch("/api/actions", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id }) }); load(); }
    finally { setBusy(null); }
  }
  async function reject(id: string) {
    await fetch(`/api/actions?id=${id}`, { method: "DELETE" });
    load();
  }

  if (actions.length === 0) return null; // só aparece quando há algo a confirmar

  return (
    <article className="panel aprovacoes">
      <span className="eyebrow">ESPERANDO SUA DECISÃO</span>
      <h3>
        {actions.length === 1 ? "Uma ação quer sua autorização." : `${actions.length} ações querem sua autorização.`}
      </h3>
      <p>Nada acontece antes de você dizer sim. Confira o que está escrito antes de aprovar.</p>

      {actions.map((a) => (
        <div key={a.id} className="aprovacao">
          <div className="approval-preview">{a.summary}</div>
          <div className="form-actions">
            <button className="button secondary compacto" onClick={() => reject(a.id)}>
              <Icone nome="close" />
              Agora não
            </button>
            <button className="button primary compacto" onClick={() => approve(a.id)} disabled={busy === a.id}>
              <Icone nome="check" />
              {busy === a.id ? "Executando…" : "Aprovar"}
            </button>
          </div>
        </div>
      ))}
    </article>
  );
}
