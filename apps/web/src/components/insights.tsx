"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";

interface Totals {
  conversations: number; messages: number; tokens: number; localTokens: number;
  avgLatencyMs: number; documents: number; memories: number; activeRoutines: number;
  notifications: number; connectors: number; expenseBRL: number; savedBRL: number;
}
interface ModelRow { model: string; n: number; tokens: number }
interface DailyRow { day: string; n: number }
interface GraphNode { id: string; label: string }
interface GraphEdge { source: string; target: string; sim: number }

const brl = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Insights() {
  const [totals, setTotals] = useState<Totals | null>(null);
  const [byModel, setByModel] = useState<ModelRow[]>([]);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [graph, setGraph] = useState<{ nodes: GraphNode[]; edges: GraphEdge[] }>({ nodes: [], edges: [] });

  useEffect(() => {
    fetch("/api/analytics").then((r) => r.json()).then((d) => {
      setTotals(d.totals); setByModel(d.byModel ?? []); setDaily(d.daily ?? []);
    }).catch(() => {});
    fetch("/api/knowledge/graph").then((r) => r.json()).then((d) => setGraph({ nodes: d.nodes ?? [], edges: d.edges ?? [] })).catch(() => {});
  }, []);

  const maxDaily = Math.max(1, ...daily.map((d) => d.n));

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center gap-3">
        <h1 className="font-mono text-lg tracking-widest" style={{ color: "var(--color-gold)" }}>INSIGHTS</h1>
        <Link href="/app" className="ml-auto text-sm" style={{ color: "var(--color-ink-dim)" }}>← voltar ao console</Link>
      </div>

      {/* cards de totais */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Conversas" value={totals?.conversations ?? "—"} />
        <Stat label="Mensagens" value={totals?.messages ?? "—"} />
        <Stat label="Tokens gerados" value={totals ? totals.tokens.toLocaleString("pt-BR") : "—"} />
        <Stat label="Latência média" value={totals ? `${totals.avgLatencyMs} ms` : "—"} />
        <Stat label="Economizou vs nuvem" value={totals ? brl(totals.savedBRL) : "—"} good />
        <Stat label="Gastos registrados" value={totals ? brl(totals.expenseBRL) : "—"} />
        <Stat label="Docs · Memórias" value={totals ? `${totals.documents} · ${totals.memories}` : "—"} />
        <Stat label="Rotinas · Conectores" value={totals ? `${totals.activeRoutines} · ${totals.connectors}` : "—"} />
      </div>

      {/* atividade diária (14 dias) */}
      <Card title="Atividade (14 dias)">
        {daily.length === 0 ? (
          <Empty />
        ) : (
          <div className="flex h-28 items-end gap-1">
            {daily.map((d) => (
              <div key={d.day} className="flex flex-1 flex-col items-center gap-1" title={`${d.day}: ${d.n}`}>
                <div className="w-full rounded-t" style={{ height: `${(d.n / maxDaily) * 100}%`, minHeight: 2, background: "linear-gradient(180deg, var(--color-gold), var(--color-amber))" }} />
                <span className="text-[8px]" style={{ color: "var(--color-ink-dim)" }}>{d.day.slice(8)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* uso por modelo */}
      <Card title="Uso por modelo">
        {byModel.length === 0 ? <Empty /> : (
          <div className="flex flex-col gap-1.5">
            {byModel.map((m) => (
              <div key={m.model} className="flex items-center gap-2 text-xs">
                <span className="w-40 truncate" style={{ color: "var(--color-ink)" }}>{m.model}</span>
                <div className="h-2 flex-1 overflow-hidden rounded" style={{ background: "var(--color-ground)" }}>
                  <div className="h-full rounded" style={{ width: `${(m.n / Math.max(...byModel.map((x) => x.n))) * 100}%`, background: "var(--color-gold)" }} />
                </div>
                <span style={{ color: "var(--color-ink-dim)" }}>{m.n}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* grafo de conhecimento */}
      <Card title={`Grafo de conhecimento (${graph.nodes.length} memórias, ${graph.edges.length} conexões)`}>
        {graph.nodes.length === 0 ? (
          <p className="text-xs" style={{ color: "var(--color-ink-dim)" }}>Salve memórias no chat (&quot;lembre que…&quot;) para ver o grafo.</p>
        ) : (
          <KnowledgeGraph nodes={graph.nodes} edges={graph.edges} />
        )}
      </Card>
    </div>
  );
}

function Stat({ label, value, good }: { label: string; value: string | number; good?: boolean }) {
  return (
    <div className="rounded-xl border p-3" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <div className="font-mono text-[10px] uppercase tracking-wide" style={{ color: "var(--color-ink-dim)" }}>{label}</div>
      <div className="mt-1 text-lg font-bold" style={{ color: good ? "var(--color-gold)" : "var(--color-ink)" }}>{value}</div>
    </div>
  );
}
function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>{title}</h3>
      {children}
    </div>
  );
}
function Empty() {
  return <p className="text-xs" style={{ color: "var(--color-ink-dim)" }}>sem dados ainda</p>;
}

/** Grafo force-directed simples em SVG (layout calculado no cliente, sem libs). */
function KnowledgeGraph({ nodes, edges }: { nodes: GraphNode[]; edges: GraphEdge[] }) {
  const W = 720, H = 380;
  const [hover, setHover] = useState<string | null>(null);
  const posRef = useRef<Record<string, { x: number; y: number }>>({});

  const positions = useMemo(() => {
    // inicializa em círculo (determinístico) e roda uma simulação de força leve
    const pos: Record<string, { x: number; y: number; vx: number; vy: number }> = {};
    const n = nodes.length;
    nodes.forEach((nd, i) => {
      const a = (i / n) * Math.PI * 2;
      pos[nd.id] = { x: W / 2 + Math.cos(a) * 140, y: H / 2 + Math.sin(a) * 140, vx: 0, vy: 0 };
    });
    const adj = edges.map((e) => [e.source, e.target, e.sim] as const);
    for (let iter = 0; iter < 200; iter++) {
      // repulsão entre todos os pares
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const a = pos[nodes[i].id], b = pos[nodes[j].id];
          let dx = a.x - b.x, dy = a.y - b.y;
          let d2 = dx * dx + dy * dy || 0.01;
          const f = 900 / d2;
          const d = Math.sqrt(d2);
          dx /= d; dy /= d;
          a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
        }
      }
      // atração pelas arestas (mais forte quanto maior a similaridade)
      for (const [s, t, sim] of adj) {
        const a = pos[s], b = pos[t]; if (!a || !b) continue;
        const dx = b.x - a.x, dy = b.y - a.y;
        const f = 0.012 * sim;
        a.vx += dx * f; a.vy += dy * f; b.vx -= dx * f; b.vy -= dy * f;
      }
      // centraliza + amortece + aplica
      for (const id in pos) {
        const p = pos[id];
        p.vx += (W / 2 - p.x) * 0.002; p.vy += (H / 2 - p.y) * 0.002;
        p.vx *= 0.85; p.vy *= 0.85;
        p.x = Math.max(20, Math.min(W - 20, p.x + p.vx));
        p.y = Math.max(20, Math.min(H - 20, p.y + p.vy));
      }
    }
    const out: Record<string, { x: number; y: number }> = {};
    for (const id in pos) out[id] = { x: pos[id].x, y: pos[id].y };
    posRef.current = out;
    return out;
  }, [nodes, edges]);

  return (
    <div className="overflow-x-auto">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxWidth: W }}>
        {edges.map((e, i) => {
          const a = positions[e.source], b = positions[e.target];
          if (!a || !b) return null;
          return <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="var(--color-line)" strokeWidth={e.sim > 0.75 ? 1.5 : 0.6} opacity={0.5} />;
        })}
        {nodes.map((nd) => {
          const p = positions[nd.id]; if (!p) return null;
          const active = hover === nd.id;
          return (
            <g key={nd.id} onMouseEnter={() => setHover(nd.id)} onMouseLeave={() => setHover(null)} style={{ cursor: "pointer" }}>
              <circle cx={p.x} cy={p.y} r={active ? 7 : 4} fill="var(--color-gold)" opacity={active ? 1 : 0.85} />
              {active && (
                <text x={p.x + 9} y={p.y + 3} fontSize={10} fill="var(--color-ink)" style={{ pointerEvents: "none" }}>
                  {nd.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
