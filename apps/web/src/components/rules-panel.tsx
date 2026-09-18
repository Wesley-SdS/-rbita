"use client";

import { useEffect, useState } from "react";
import { Card, PanelTitle, Input, Textarea, Button, ErrorRetry } from "@/components/ui";

/**
 * Regras proativas: evento (ou horário) → condições → ações. A validação de
 * verdade é do servidor (zod em rules/engine.ts); aqui só montamos o JSON.
 */
interface Rule {
  id: string; name: string; enabled: boolean; builtinKey: string | null; lastFiredAt: string | null;
  trigger: { kind: "event"; type: string } | { kind: "cron"; expr: string };
  conditions: { path: string; op: string; value?: unknown }[];
  actions: (
    | { kind: "notify"; title: string; body: string; avisarPersonId?: string | null }
    | { kind: "prompt"; prompt: string }
    | { kind: "whatsapp"; to: string; text: string }
    | { kind: "teams_chat"; chatId: string; text: string }
    | { kind: "teams_canal"; equipeId: string; canalId: string; text: string }
  )[];
}
const ACTION_LABEL: Record<Rule["actions"][number]["kind"], string> = {
  notify: "Notificar (use {{payload.campo}})",
  prompt: "Perguntar ao modelo, com ferramentas",
  whatsapp: "Enviar WhatsApp (pede aprovação)",
  teams_chat: "Enviar no Teams, chat (pede aprovação)",
  teams_canal: "Enviar no Teams, canal (pede aprovação)",
};

const OPS = ["eq", "neq", "gt", "gte", "lt", "lte", "contains", "exists", "not_exists"];
const EVENT_HINTS = [
  "finance.bill_due", "routine.finished", "connector.token_refreshed", "connector.refresh_failed", "setting.changed", "action.executed",
  "calendar.meeting_upcoming", "gmail.important_received", "home.state_changed", "camera.detected",
  // Fase 2 (identidade e percepção)
  "identity.seen", "identity.presence_changed", "identity.gesture",
  "identity.consent_granted", "identity.consent_revoked", "identity.voice_enrolled", "identity.face_enrolled",
  // fila de trabalho pesado e acompanhar tarefa passo a passo
  "job.enqueued", "job.finished", "guided.started", "guided.step", "guided.finished",
];
const dim = { color: "var(--color-ink-dim)" } as const;

export function RulesPanel() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState<Partial<Rule> | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    fetch("/api/rules").then((r) => (r.ok ? r.json() : Promise.reject())).then((d) => { if (alive) setRules(d.rules ?? []); }).catch(() => { if (alive) setErr("Não foi possível carregar as regras."); });
    return () => { alive = false; };
  }, [reload]);

  async function toggle(r: Rule) {
    await fetch(`/api/rules/${r.id}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...strip(r), enabled: !r.enabled }) });
    setReload((n) => n + 1);
  }
  async function remove(id: string) {
    await fetch(`/api/rules/${id}`, { method: "DELETE" });
    setReload((n) => n + 1);
  }
  async function test(id: string) {
    setMsg(null);
    const r = await fetch(`/api/rules/${id}/test`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ payload: { quantidade: 1, resumo: "Teste da regra", provider: "teste", error: "teste" } }) });
    const d = await r.json().catch(() => ({}));
    setMsg(r.ok ? `Disparadas: ${d.disparadas}. Veja em notificações.` : d.error ?? "Falhou");
  }
  async function save() {
    if (!editing) return;
    setBusy(true);
    setMsg(null);
    const body = strip(editing as Rule);
    const isNew = !editing.id;
    const r = await fetch(isNew ? "/api/rules" : `/api/rules/${editing.id}`, { method: isNew ? "POST" : "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const d = await r.json().catch(() => ({}));
    setBusy(false);
    if (!r.ok) { setMsg(d.error ?? "Dados inválidos"); return; }
    setEditing(null);
    setReload((n) => n + 1);
  }

  if (err) return <Card><PanelTitle className="mb-2">Regras proativas</PanelTitle><ErrorRetry message={err} onRetry={() => setReload((n) => n + 1)} /></Card>;

  return (
    <Card>
      <div className="mb-2 flex items-baseline justify-between">
        <PanelTitle>Regras proativas</PanelTitle>
        {!editing && <button type="button" className="text-[11px] underline" style={dim} onClick={() => setEditing(novaRegra())}>nova regra</button>}
      </div>
      <p className="mb-3 text-[12px]" style={dim}>Evento ou horário, condições e ações. Rodam no processo da casa, com o navegador fechado.</p>

      {editing ? (
        <RuleEditor value={editing} onChange={setEditing} onSave={save} onCancel={() => { setEditing(null); setMsg(null); }} busy={busy} />
      ) : !rules ? (
        <p className="text-[12px]" style={dim}>Carregando…</p>
      ) : rules.length === 0 ? (
        <p className="text-[12px]" style={dim}>Nenhuma regra ainda. As regras padrão aparecem quando o processo da casa sobe.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-line)", opacity: r.enabled ? 1 : 0.6 }}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="truncate text-[13px] font-medium">{r.name} {r.builtinKey && <span className="text-[10px]" style={dim}>padrão</span>}</div>
                  <div className="text-[11px]" style={dim}>
                    {r.trigger.kind === "event" ? `evento ${r.trigger.type}` : `cron ${r.trigger.expr}`} · {r.actions.length} ação{r.actions.length > 1 ? "ões" : ""}
                    {r.lastFiredAt ? ` · último disparo ${new Date(r.lastFiredAt).toLocaleString("pt-BR")}` : ""}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2 text-[11px]">
                  <button type="button" className="underline" style={dim} onClick={() => toggle(r)}>{r.enabled ? "desligar" : "ligar"}</button>
                  <button type="button" className="underline" style={dim} onClick={() => setEditing(r)}>editar</button>
                  <button type="button" className="underline" style={dim} onClick={() => test(r.id)}>testar</button>
                  {!r.builtinKey && <button type="button" className="underline" style={dim} onClick={() => remove(r.id)}>apagar</button>}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="mt-2 text-[11px]" style={{ color: "var(--color-gold)" }}>{msg}</p>}
    </Card>
  );
}

function novaRegra(): Partial<Rule> {
  return { name: "", enabled: true, trigger: { kind: "event", type: "finance.bill_due" }, conditions: [], actions: [{ kind: "notify", title: "", body: "" }] };
}
function strip(r: Rule) {
  return { name: r.name, enabled: r.enabled, trigger: r.trigger, conditions: r.conditions ?? [], actions: r.actions };
}

interface PessoaOpcao { id: string; name: string }

function RuleEditor({ value, onChange, onSave, onCancel, busy }: { value: Partial<Rule>; onChange: (v: Partial<Rule>) => void; onSave: () => void; onCancel: () => void; busy: boolean }) {
  // "o mesmo gesto faz coisas diferentes para cada um" exigia digitar o uuid
  // da pessoa na condição; aqui ele vem de uma lista (fail-soft: sem a lista,
  // o campo de texto continua valendo)
  const [pessoas, setPessoas] = useState<PessoaOpcao[]>([]);
  useEffect(() => {
    let alive = true;
    fetch("/api/home/persons")
      .then((r) => (r.ok ? r.json() : { people: [] }))
      .then((d) => { if (alive) setPessoas((d.people ?? []).map((p: PessoaOpcao) => ({ id: p.id, name: p.name }))); })
      .catch(() => { if (alive) setPessoas([]); });
    return () => { alive = false; };
  }, []);
  const t = value.trigger ?? { kind: "event", type: "" };
  const conds = value.conditions ?? [];
  const acts = value.actions ?? [];
  const set = (patch: Partial<Rule>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-2 text-[12px]">
      <Input placeholder="Nome da regra" value={value.name ?? ""} onChange={(e) => set({ name: e.target.value })} />
      <div className="flex gap-2">
        <select value={t.kind} className="rounded-lg border px-2 py-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}
          onChange={(e) => set({ trigger: e.target.value === "cron" ? { kind: "cron", expr: "0 8 * * *" } : { kind: "event", type: "finance.bill_due" } })}>
          <option value="event">quando acontecer um evento</option>
          <option value="cron">em um horário (cron)</option>
        </select>
        {t.kind === "event" ? (
          <>
            <Input list="orbita-eventos" placeholder="tipo do evento" value={t.type} onChange={(e) => set({ trigger: { kind: "event", type: e.target.value } })} />
            <datalist id="orbita-eventos">{EVENT_HINTS.map((h) => <option key={h} value={h} />)}</datalist>
          </>
        ) : (
          <Input placeholder="min hora dia mês dia-da-semana" value={t.expr} onChange={(e) => set({ trigger: { kind: "cron", expr: e.target.value } })} />
        )}
      </div>

      <div className="flex items-center justify-between"><span style={dim}>Condições (todas precisam valer)</span>
        <button type="button" className="underline" style={dim} onClick={() => set({ conditions: [...conds, { path: "payload.", op: "eq", value: "" }] })}>+ condição</button></div>
      {conds.map((c, i) => (
        <div key={i} className="flex gap-1">
          <Input placeholder="payload.campo" value={c.path} onChange={(e) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, path: e.target.value } : x)) })} />
          <select value={c.op} className="rounded-lg border px-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}
            onChange={(e) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, op: e.target.value } : x)) })}>
            {OPS.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
          {c.path.toLowerCase().endsWith("personid") && pessoas.length ? (
            <select value={c.value === undefined ? "" : String(c.value)} className="min-w-0 flex-1 rounded-lg border px-1" style={{ borderColor: "var(--color-line)", background: "transparent" }}
              onChange={(e) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, value: e.target.value } : x)) })}>
              <option value="">escolha a pessoa</option>
              {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          ) : (
            <Input placeholder="valor" value={c.value === undefined ? "" : String(c.value)} onChange={(e) => set({ conditions: conds.map((x, j) => (j === i ? { ...x, value: coerce(e.target.value) } : x)) })} />
          )}
          <button type="button" style={dim} onClick={() => set({ conditions: conds.filter((_, j) => j !== i) })}>×</button>
        </div>
      ))}

      <div className="flex items-center justify-between"><span style={dim}>Ações</span>
        <span className="flex gap-2">
          <button type="button" className="underline" style={dim} onClick={() => set({ actions: [...acts, { kind: "notify", title: "", body: "" }] })}>+ notificar</button>
          <button type="button" className="underline" style={dim} onClick={() => set({ actions: [...acts, { kind: "prompt", prompt: "" }] })}>+ perguntar ao modelo</button>
          <button type="button" className="underline" style={dim} onClick={() => set({ actions: [...acts, { kind: "whatsapp", to: "", text: "" }] })}>+ WhatsApp</button>
          <button type="button" className="underline" style={dim} onClick={() => set({ actions: [...acts, { kind: "teams_chat", chatId: "", text: "" }] })}>+ Teams</button>
        </span></div>
      {acts.map((a, i) => {
        const upd = (patch: Partial<typeof a>) => set({ actions: acts.map((x, j) => (j === i ? ({ ...x, ...patch } as typeof x) : x)) });
        return (
          <div key={i} className="flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
            <div className="flex items-center justify-between"><span style={dim}>{ACTION_LABEL[a.kind]}</span>
              <button type="button" style={dim} onClick={() => set({ actions: acts.filter((_, j) => j !== i) })}>×</button></div>
            {a.kind === "notify" && (
              <>
                <Input placeholder="Título" value={a.title} onChange={(e) => upd({ title: e.target.value })} />
                <Textarea placeholder="Corpo" value={a.body} onChange={(e) => upd({ body: e.target.value })} />
                <label className="flex items-center gap-2" style={dim}>
                  avisar no aparelho de
                  <select value={a.avisarPersonId ?? ""} className="rounded-lg border px-1 py-0.5" style={{ borderColor: "var(--color-line)", background: "transparent" }}
                    onChange={(e) => upd({ avisarPersonId: e.target.value || null })}>
                    <option value="">todos os aparelhos</option>
                    {pessoas.map((p) => <option key={p.id} value={p.id}>{p.name}, onde ela estiver</option>)}
                  </select>
                </label>
              </>
            )}
            {a.kind === "prompt" && (
              <Textarea placeholder="O que pedir ao modelo" value={a.prompt} onChange={(e) => upd({ prompt: e.target.value })} />
            )}
            {a.kind === "whatsapp" && (
              <>
                <Input placeholder="Número (ex.: 5511999998888)" value={a.to} onChange={(e) => upd({ to: e.target.value })} />
                <Textarea placeholder="Texto (use {{payload.campo}})" value={a.text} onChange={(e) => upd({ text: e.target.value })} />
              </>
            )}
            {a.kind === "teams_chat" && (
              <>
                <Input placeholder="id do chat (Teams > listar_conversas_teams)" value={a.chatId} onChange={(e) => upd({ chatId: e.target.value })} />
                <Textarea placeholder="Texto (use {{payload.campo}})" value={a.text} onChange={(e) => upd({ text: e.target.value })} />
              </>
            )}
            {a.kind === "teams_canal" && (
              <>
                <Input placeholder="id da equipe" value={a.equipeId} onChange={(e) => upd({ equipeId: e.target.value })} />
                <Input placeholder="id do canal" value={a.canalId} onChange={(e) => upd({ canalId: e.target.value })} />
                <Textarea placeholder="Texto (use {{payload.campo}})" value={a.text} onChange={(e) => upd({ text: e.target.value })} />
              </>
            )}
          </div>
        );
      })}

      <div className="flex gap-2">
        <Button onClick={onSave} disabled={busy}>{busy ? "…" : "Salvar"}</Button>
        <Button onClick={onCancel} disabled={busy}>Cancelar</Button>
      </div>
    </div>
  );
}

/** "12" → 12, "true" → true, resto texto (o servidor valida o tipo) */
function coerce(s: string): unknown {
  if (s === "") return "";
  if (s === "true") return true;
  if (s === "false") return false;
  const n = Number(s);
  return Number.isFinite(n) && s.trim() !== "" ? n : s;
}
