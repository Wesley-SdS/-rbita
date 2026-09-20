"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Card, PanelTitle, ErrorRetry } from "@/components/ui";

/**
 * Catálogo de ferramentas (TL.5): o que a Órbita sabe fazer, por domínio, com
 * risco declarado e efetivo. Ligar/desligar e mudar o risco é dado (tool_config);
 * a existência da tool é código. Baixar de "perigoso"/"efeito_externo" para
 * leitura/escrita tira a aprovação humana: pede confirmação explícita.
 */
type Risk = "leitura" | "escrita" | "efeito_externo" | "perigoso";
interface ToolItem {
  name: string; domain: string; description: string;
  risk: Risk; riskOverride: Risk | null; effectiveRisk: Risk;
  enabled: boolean; requires: string | null; available: boolean;
}

const RISK_LABEL: Record<Risk, string> = { leitura: "leitura", escrita: "escrita", efeito_externo: "efeito externo (aprova)", perigoso: "perigoso (aprova)" };
const GATED: Risk[] = ["efeito_externo", "perigoso"];
const RISK_ORDER: Record<Risk, number> = { leitura: 0, escrita: 1, efeito_externo: 2, perigoso: 3 };
const dim = { color: "var(--color-ink-dim)" } as const;

export function ToolsPanel() {
  const { dado, erro: err, recarregar } = useRecurso<{ tools: ToolItem[]; isOwner?: boolean }>("/api/tools", { estavel: true });
  const tools = dado?.tools ?? null;
  const [msg, setMsg] = useState<string | null>(null);
  // o catálogo vale para a casa inteira: só o dono muda (RV.1)
  const isOwner = dado?.isOwner !== false;

  async function update(name: string, patch: { enabled?: boolean; risk?: Risk | null }) {
    setMsg(null);
    const r = await fetch(`/api/tools/${encodeURIComponent(name)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) { const d = await r.json().catch(() => ({})); setMsg(d.error ?? "Falhou"); return; }
    // Sem otimismo: mudar o risco de uma tool muda QUEM precisa aprovar o quê
    // (§5.1). A tela tem de mostrar o risco efetivo que o servidor calculou.
    invalidar("/api/tools");
  }
  function changeRisk(t: ToolItem, value: string) {
    const risk = value === "" ? null : (value as Risk);
    const target = risk ?? t.risk;
    if (GATED.includes(t.effectiveRisk) && !GATED.includes(target)) {
      if (!window.confirm(`"${t.name}" vai deixar de pedir aprovação antes de executar. Confirmar?`)) return;
    }
    void update(t.name, { risk });
  }

  if (err && !tools) return <Card><PanelTitle className="mb-2">Ferramentas</PanelTitle><ErrorRetry message={err} onRetry={recarregar} /></Card>;

  const domains = tools ? [...new Set(tools.map((t) => t.domain))] : [];
  const ativas = tools?.filter((t) => t.enabled && t.available).length ?? 0;

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between">
        <PanelTitle>Ferramentas</PanelTitle>
        {tools && <span className="text-[14px]" style={dim}>{ativas} ativas de {tools.length}</span>}
      </div>
      <p className="mb-3 text-[15px]" style={dim}>O que a Órbita sabe fazer. Risco com "aprova" passa pelo painel de ações antes de executar.{!isOwner && " Só o dono desta instância liga, desliga ou muda o risco."}</p>
      {!tools ? (
        <p className="text-[15px]" style={dim}>Carregando…</p>
      ) : (
        <div className="flex flex-col gap-3">
          {domains.map((d) => (
            <div key={d}>
              <div className="mb-1 text-[14px] uppercase tracking-wide" style={dim}>{d}</div>
              <ul className="flex flex-col gap-1">
                {tools.filter((t) => t.domain === d).map((t) => (
                  <li key={t.name} className="flex items-start gap-2 rounded-lg border px-2 py-1.5 text-[15px]" style={{ borderColor: "var(--color-line)", opacity: t.enabled ? 1 : 0.55 }}>
                    <input type="checkbox" className="mt-0.5" checked={t.enabled} disabled={!isOwner} onChange={(e) => void update(t.name, { enabled: e.target.checked })} title={t.enabled ? "desligar" : "ligar"} />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <code className="text-[15px]">{t.name}</code>
                        {!t.available && t.enabled && <span className="text-[13px]" style={dim}>{t.requires === "env" ? "sem configuração" : `precisa conectar ${t.requires}`}</span>}
                      </div>
                      <div className="text-[14px]" style={dim}>{t.description}</div>
                    </div>
                    <select value={t.riskOverride ?? ""} disabled={!isOwner} onChange={(e) => changeRisk(t, e.target.value)}
                      className="shrink-0 rounded-md border px-1 py-0.5 text-[14px]" style={{ borderColor: "var(--color-line)", background: "transparent", color: GATED.includes(t.effectiveRisk) ? "var(--color-gold)" : "inherit" }}
                      title="Risco efetivo. Vazio = o declarado no código.">
                      <option value="">{RISK_LABEL[t.risk]} (padrão)</option>
                      {/* só sobe: o servidor recusa rebaixar abaixo do risco declarado */}
                      {(Object.keys(RISK_LABEL) as Risk[]).filter((r) => RISK_ORDER[r] > RISK_ORDER[t.risk]).map((r) => <option key={r} value={r}>{RISK_LABEL[r]}</option>)}
                    </select>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}
      {msg && <p className="mt-2 text-[14px]" style={{ color: "var(--color-danger, var(--color-gold))" }}>{msg}</p>}
    </Card>
  );
}
