"use client";

import { useMemo, useRef, useState } from "react";
import { useRecursos } from "@/lib/dados/recurso";

interface Totais {
  conversations: number; messages: number; tokens: number; localTokens: number;
  avgLatencyMs: number; documents: number; memories: number; activeRoutines: number;
  notifications: number; connectors: number; expenseBRL: number; savedBRL: number;
}
interface LinhaModelo { model: string; n: number; tokens: number }
interface LinhaDia { day: string; n: number }
interface GraphNode { id: string; label: string }
interface GraphEdge { source: string; target: string; sim: number }

const brl = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function Insights() {
  // As duas leituras mais pesadas do app: `/api/analytics` agrega a tabela de
  // mensagens inteira (já tem cache de 30s no servidor) e o grafo calcula
  // similaridade entre trechos. Estáveis, então voltar para esta aba não
  // refaz nenhuma das duas.
  const { dados } = useRecursos<{
    analytics: { totais: Totais | null; porModelo: LinhaModelo[]; diario: LinhaDia[] };
    grafoResp: { nodes: GraphNode[]; edges: GraphEdge[] };
  }>({ analytics: "/api/analytics", grafoResp: "/api/knowledge/grafo" }, { estavel: true });

  const totais = dados.analytics?.totais ?? null;
  const porModelo = dados.analytics?.porModelo ?? [];
  const diario = dados.analytics?.diario ?? [];
  const grafo = dados.grafoResp ?? { nodes: [], edges: [] };

  const maxDiario = Math.max(1, ...diario.map((d) => d.n));

  return (
    <>
      <div className="stat-grid quatro">
        <Numero rotulo="Conversas" valor={totais?.conversations ?? "—"} nota="Fios de assunto que você começou" />
        <Numero rotulo="Mensagens" valor={totais?.messages ?? "—"} nota="Tudo que foi dito de lado a lado" />
        <Numero rotulo="Latência média" valor={totais ? `${totais.avgLatencyMs} ms` : "—"} nota="Do envio ao primeiro pedaço da resposta" />
        <Numero rotulo="Economia vs. nuvem" valor={totais ? brl(totais.savedBRL) : "—"} nota="O que o modelo local deixou de custar" destaque />
      </div>

      <div className="two-columns">
        <article className="panel">
          <div className="section-heading">
            <h2>Seus últimos 14 dias</h2>
            <span className="tag">conversas por dia</span>
          </div>
          {diario.length === 0 ? (
            <div className="empty-state">Ainda não há histórico suficiente.</div>
          ) : (
            <div className="finance-chart" role="img" aria-label="Conversas por dia nos últimos 14 dias">
              {diario.map((d) => (
                <div key={d.day} className="chart-column" title={`${d.day}: ${d.n}`}>
                  <div className="chart-bar" style={{ ["--height" as string]: `${Math.max(4, (d.n / maxDiario) * 100)}%` }} />
                  <span>{d.day.slice(8)}</span>
                </div>
              ))}
            </div>
          )}
        </article>

        <article className="panel">
          <div className="section-heading">
            <h2>Quem respondeu</h2>
            <span className="tag">por modelo</span>
          </div>
          {porModelo.length === 0 ? (
            <div className="empty-state">Nenhuma resposta registrada ainda.</div>
          ) : (
            porModelo.map((m) => (
              <div key={m.model} className="barra-modelo">
                <span className="barra-nome">{m.model}</span>
                <span className="barra-trilho">
                  <span className="barra-preenchida" style={{ width: `${(m.n / Math.max(...porModelo.map((x) => x.n))) * 100}%` }} />
                </span>
                <b>{m.n}</b>
              </div>
            ))
          )}
        </article>
      </div>

      <article className="panel" style={{ marginTop: 22 }}>
        <div className="section-heading">
          <h2>O mapa do que você sabe</h2>
          <span className="tag">
            {grafo.nodes.length} {grafo.nodes.length === 1 ? "memória" : "memórias"} · {grafo.edges.length}{" "}
            {grafo.edges.length === 1 ? "conexão" : "conexões"}
          </span>
        </div>
        <p className="description">
          Cada ponto é uma memória; os fios ligam as que falam da mesma coisa. É assim que a Órbita
          puxa uma ideia antiga quando o assunto volta.
        </p>
        {grafo.nodes.length === 0 ? (
          <div className="empty-state">
            Peça à Órbita para lembrar de algo (&quot;lembre que eu prefiro…&quot;) e o mapa começa a se formar.
          </div>
        ) : (
          <div className="memory-grafo">
            <KnowledgeGraph nodes={grafo.nodes} edges={grafo.edges} />
          </div>
        )}
      </article>

      <div className="stat-grid" style={{ marginTop: 22 }}>
        <Numero rotulo="Documentos e memórias" valor={totais ? `${totais.documents} · ${totais.memories}` : "—"} nota="O acervo que a Órbita consulta" />
        <Numero rotulo="Rotinas e conexões" valor={totais ? `${totais.activeRoutines} · ${totais.connectors}` : "—"} nota="O que trabalha por você sozinho" />
        <Numero rotulo="Gastos registrados" valor={totais ? brl(totais.expenseBRL) : "—"} nota="O que passou por Finanças" />
      </div>
    </>
  );
}

function Numero({ rotulo, valor, nota, destaque }: { rotulo: string; valor: string | number; nota: string; destaque?: boolean }) {
  return (
    <article className="panel stat-card">
      <span>{rotulo}</span>
      <div className="stat-value" style={destaque ? { color: "var(--color-forest)" } : undefined}>
        {valor}
      </div>
      <small>{nota}</small>
    </article>
  );
}

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
