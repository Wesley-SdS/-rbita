"use client";

import { useEffect, useState } from "react";
import { Icone } from "@/components/presenca/icones";
import { useVisivel } from "@/lib/use-visible";

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
    <>
      {adding && <AddWidget onAdd={add} aoFechar={() => setAdding(false)} />}

      <div className="quick-grid cards-do-dono">
        {widgets.map((w) => (
          <WidgetCard key={w.id} w={w} onRemove={() => remove(w.id)} onPatch={(c) => patch(w.id, c)} />
        ))}

        {!adding && (
          <button className="quick-card card-novo" onClick={() => setAdding(true)}>
            <span className="quick-icon mint-bg">
              <Icone nome="plus" />
            </span>
            <h3>Fixar algo aqui</h3>
            <p>
              {widgets.length === 0
                ? "Cotação, clima, uma nota ou uma lista. Você também pode pedir à Órbita."
                : "Mais um card para o que você olha todo dia."}
            </p>
          </button>
        )}
      </div>
    </>
  );
}

function AddWidget({ onAdd, aoFechar }: { onAdd: (t: string, title: string, c: Record<string, unknown>) => void; aoFechar: () => void }) {
  const [tipo, setTipo] = useState("cotacao");
  const [parametro, setParametro] = useState("");

  function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (tipo === "cotacao") onAdd("cotacao", `Cotação ${parametro || "USD-BRL"}`, { par: (parametro || "USD-BRL").toUpperCase() });
    else if (tipo === "clima") onAdd("clima", `Clima ${parametro || "São Paulo"}`, { cidade: parametro || "São Paulo" });
    else if (tipo === "nota") onAdd("nota", parametro || "Nota", { text: "" });
    else onAdd("checklist", parametro || "Checklist", { items: [] });
    aoFechar();
  }

  return (
    <form className="panel" onSubmit={enviar} style={{ marginBottom: 18 }}>
      <span className="eyebrow">UM CARD SÓ SEU</span>
      <label className="field">
        O que fixar
        <select value={tipo} onChange={(e) => setTipo(e.target.value)}>
          <option value="cotacao">Cotação de moeda</option>
          <option value="clima">Clima de uma cidade</option>
          <option value="nota">Uma nota</option>
          <option value="checklist">Uma lista</option>
        </select>
      </label>
      <label className="field">
        {tipo === "cotacao" ? "Qual par?" : tipo === "clima" ? "Qual cidade?" : "Como chamar?"}
        <input
          value={parametro}
          onChange={(e) => setParametro(e.target.value)}
          placeholder={tipo === "cotacao" ? "USD-BRL, EUR-BRL, BTC-BRL…" : tipo === "clima" ? "São Paulo" : "Um título curto"}
          maxLength={80}
        />
      </label>
      <div className="form-actions">
        <button type="button" className="button secondary" onClick={aoFechar}>
          Agora não
        </button>
        <button type="submit" className="button primary">
          <Icone nome="check" />
          Fixar
        </button>
      </div>
    </form>
  );
}

function WidgetCard({ w, onRemove, onPatch }: { w: W; onRemove: () => void; onPatch: (c: Record<string, unknown>) => void }) {
  return (
    <article className="quick-card card-fixado">
      <div className="card-fixado-topo">
        <h3>{w.title}</h3>
        <button className="icon-button" onClick={onRemove} aria-label={`Remover ${w.title}`} title="Remover card">
          <Icone nome="close" />
        </button>
      </div>

      {w.type === "cotacao" && (
        <LiveCard
          url={`/api/widgets/data?type=cotacao&par=${w.config.par ?? "USD-BRL"}`}
          render={(d) => (
            <div className="card-valor">
              <strong>R$ {brl(d.valor)}</strong>
              <span className={(d.variacao ?? 0) >= 0 ? "subiu" : "caiu"}>
                {(d.variacao ?? 0) >= 0 ? "▲" : "▼"} {Math.abs(Number(d.variacao ?? 0)).toFixed(2)}%
              </span>
            </div>
          )}
        />
      )}

      {w.type === "clima" && (
        <LiveCard
          url={`/api/widgets/data?type=clima&cidade=${encodeURIComponent(String(w.config.cidade ?? "São Paulo"))}`}
          render={(d) =>
            d.agora ? (
              <div className="card-valor">
                <strong>{Math.round(d.agora.temperatura)}°</strong>
                <span>
                  {d.agora.condicao} · {Math.round(d.hoje?.min)}° / {Math.round(d.hoje?.max)}°
                </span>
              </div>
            ) : null
          }
        />
      )}

      {w.type === "nota" && <NoteCard text={String(w.config.text ?? "")} onSave={(t) => onPatch({ ...w.config, text: t })} />}
      {w.type === "checklist" && (
        <ChecklistCard
          items={(w.config.items as { text: string; done: boolean }[]) ?? []}
          onSave={(items) => onPatch({ ...w.config, items })}
        />
      )}
    </article>
  );
}

function LiveCard({ url, render }: { url: string; render: (d: any) => React.ReactNode }) { // eslint-disable-line @typescript-eslint/no-explicit-any
  const [data, setData] = useState<any>(null); // eslint-disable-line @typescript-eslint/no-explicit-any
  const visivel = useVisivel();
  useEffect(() => {
    // fora da tela ou com a aba escondida não atualiza; ao voltar, busca na hora
    if (!visivel) return;
    let alive = true;
    const fetchData = () => fetch(url).then((r) => r.json()).then((d) => { if (alive) setData(d); }).catch(() => {});
    fetchData();
    const t = setInterval(fetchData, 120000); // atualiza a cada 2 min
    return () => { alive = false; clearInterval(t); };
  }, [url, visivel]);
  return <div className="mt-1">{data && !data.error ? render(data) : <span className="text-[13px]" style={{ color: "var(--color-ink-dim)" }}>…</span>}</div>;
}

function NoteCard({ text, onSave }: { text: string; onSave: (t: string) => void }) {
  const [v, setV] = useState(text);
  return <textarea value={v} onChange={(e) => setV(e.target.value)} onBlur={() => v !== text && onSave(v)} rows={2}
    className="mt-1 w-full rounded border px-1.5 py-1 text-[14px] outline-none" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }} placeholder="anote aqui…" />;
}

function ChecklistCard({ items, onSave }: { items: { text: string; done: boolean }[]; onSave: (i: { text: string; done: boolean }[]) => void }) {
  const [txt, setTxt] = useState("");
  return (
    <div className="mt-1 flex flex-col gap-0.5">
      {items.map((it, i) => (
        <div key={i} className="flex items-center gap-1 text-[14px]">
          <button className="icon-button" onClick={() => onSave(items.map((x, j) => (j === i ? { ...x, done: !x.done } : x)))} aria-label={it.done ? "Reabrir item" : "Concluir item"}><Icone nome={it.done ? "check" : "clock"} /></button>
          <span className="flex-1 truncate" style={{ textDecoration: it.done ? "line-through" : "none", color: "var(--color-ink)" }}>{it.text}</span>
          <button className="icon-button" onClick={() => onSave(items.filter((_, j) => j !== i))} aria-label="Remover item"><Icone nome="trash" /></button>
        </div>
      ))}
      <input value={txt} onChange={(e) => setTxt(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && txt.trim()) { onSave([...items, { text: txt.trim(), done: false }]); setTxt(""); } }}
        placeholder="+ item" className="rounded border px-1.5 py-0.5 text-[14px] outline-none" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }} />
    </div>
  );
}
