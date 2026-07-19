"use client";

import { useEffect, useState } from "react";

interface W { id: string; type: string; title: string; config: Record<string, unknown> }

const brl = (n: number) => n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Cards do dashboard: cotação, clima, nota, checklist. */
export function Widgets() {
  const [widgets, setWidgets] = useState<W[]>([]);
  const [adding, setAdding] = useState(false);

  function load() {
    fetch("/api/widgets").then((r) => r.json()).then((d) => setWidgets(d.widgets ?? [])).catch(() => {});
  }
  useEffect(load, []);

  async function add(type: string, title: string, config: Record<string, unknown>) {
    await fetch("/api/widgets", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, title, config }) });
    setAdding(false); load();
  }
  async function remove(id: string) { await fetch(`/api/widgets?id=${id}`, { method: "DELETE" }); load(); }
  async function patch(id: string, config: Record<string, unknown>) {
    await fetch("/api/widgets", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id, config }) });
    load();
  }

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <div className="flex items-center">
        <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Meus cards</h3>
        <button onClick={() => setAdding(!adding)} className="ml-auto text-xs" style={{ color: "var(--color-gold)" }}>＋</button>
      </div>

      {adding && <AddWidget onAdd={add} />}

      <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
        {widgets.map((w) => <WidgetCard key={w.id} w={w} onRemove={() => remove(w.id)} onPatch={(c) => patch(w.id, c)} />)}
        {widgets.length === 0 && !adding && (
          <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>Nenhum card. Toque em ＋, ou peça à Órbita: &quot;pina a cotação do dólar&quot;.</span>
        )}
      </div>
    </div>
  );
}

function AddWidget({ onAdd }: { onAdd: (t: string, title: string, c: Record<string, unknown>) => void }) {
  const [type, setType] = useState("cotacao");
  const [param, setParam] = useState("");
  const input = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };
  function submit() {
    if (type === "cotacao") onAdd("cotacao", `Cotação ${param || "USD-BRL"}`, { par: (param || "USD-BRL").toUpperCase() });
    else if (type === "clima") onAdd("clima", `Clima ${param || "São Paulo"}`, { cidade: param || "São Paulo" });
    else if (type === "nota") onAdd("nota", param || "Nota", { text: "" });
    else onAdd("checklist", param || "Checklist", { items: [] });
  }
  return (
    <div className="mt-2 flex flex-col gap-1 rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
      <select value={type} onChange={(e) => setType(e.target.value)} className="rounded border px-2 py-1 text-xs" style={input}>
        <option value="cotacao">💱 Cotação de moeda</option>
        <option value="clima">🌤 Clima de cidade</option>
        <option value="nota">📝 Nota</option>
        <option value="checklist">✅ Checklist</option>
      </select>
      <input value={param} onChange={(e) => setParam(e.target.value)} placeholder={type === "cotacao" ? "USD-BRL, EUR-BRL, BTC-BRL…" : type === "clima" ? "cidade" : "título"} className="rounded border px-2 py-1 text-xs" style={input} />
      <button onClick={submit} className="rounded px-2 py-1 text-xs font-semibold" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>criar card</button>
    </div>
  );
}

function WidgetCard({ w, onRemove, onPatch }: { w: W; onRemove: () => void; onPatch: (c: Record<string, unknown>) => void }) {
  return (
    <div className="rounded-xl border p-2" style={{ borderColor: "var(--color-line)", background: "var(--color-ground)" }}>
      <div className="flex items-center">
        <span className="truncate text-[11px] font-semibold" style={{ color: "var(--color-ink)" }}>{w.title}</span>
        <button onClick={onRemove} className="ml-auto text-[11px]" style={{ color: "#e0705a" }}>×</button>
      </div>
      {w.type === "cotacao" && <LiveCard url={`/api/widgets/data?type=cotacao&par=${w.config.par ?? "USD-BRL"}`} render={(d) => (
        <div><span className="text-lg font-bold" style={{ color: "var(--color-gold)" }}>R${brl(d.valor)}</span>
          <span className="ml-1 text-[10px]" style={{ color: (d.variacao ?? 0) >= 0 ? "#7ad08a" : "#e0705a" }}>{(d.variacao ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(d.variacao ?? 0)}%</span></div>
      )} />}
      {w.type === "clima" && <LiveCard url={`/api/widgets/data?type=clima&cidade=${encodeURIComponent(String(w.config.cidade ?? "São Paulo"))}`} render={(d) => (
        d.agora ? <div><span className="text-lg font-bold" style={{ color: "var(--color-gold)" }}>{Math.round(d.agora.temperatura)}°</span>
          <span className="ml-1 text-[10px]" style={{ color: "var(--color-ink-dim)" }}>{d.agora.condicao} · {Math.round(d.hoje?.min)}°/{Math.round(d.hoje?.max)}°</span></div> : <span className="text-[10px]">sem dados</span>
      )} />}
      {w.type === "nota" && <NoteCard text={String(w.config.text ?? "")} onSave={(t) => onPatch({ ...w.config, text: t })} />}
      {w.type === "checklist" && <ChecklistCard items={(w.config.items as { text: string; done: boolean }[]) ?? []} onSave={(items) => onPatch({ ...w.config, items })} />}
    </div>
  );
}

function LiveCard({ url, render }: { url: string; render: (d: any) => React.ReactNode }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  useEffect(() => {
    let alive = true;
    const fetchData = () => fetch(url).then((r) => r.json()).then((d) => { if (alive) setData(d); }).catch(() => {});
    fetchData();
    const t = setInterval(fetchData, 120000); // atualiza a cada 2 min
    return () => { alive = false; clearInterval(t); };
  }, [url]);
  return <div className="mt-1">{data && !data.error ? render(data) : <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>…</span>}</div>;
}

function NoteCard({ text, onSave }: { text: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(text);
  return <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== text && onSave(v)} rows={2}
    className="mt-1 w-full rounded border px-1.5 py-1 text-[11px] outline-none" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }} placeholder="anote aqui…" />;
}

function ChecklistCard({ items, onSave }: { items: { text: string; done: boolean }[]; onSave: (i: { text: string; done: boolean }[]) => void }) {
  const [txt, setTxt] = useState("");
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1 text-[11px]">
          <button onClick={() => onSave(items.map((x, j) => j === i ? { ...x, done: !x.done } : x))}>{it.done ? "☑" : "☐"}</button>
          <span className="flex-1 truncate" style={{ textDecoration: it.done ? "line-through" : "none", color: "var(--color-ink)" }}>{it.text}</span>
          <button onClick={() => onSave(items.filter((_, j) => j !== i))} style={{ color: "#e0705a" }}>×</button>
        </div>
      ))}
      <input value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && txt.trim()) { onSave([...items, { text: txt.trim(), done: false }]); setTxt(""); } }}
        placeholder="+ item" className="rounded border px-1.5 py-0.5 text-[11px] outline-none" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
    </div>
  );
}
