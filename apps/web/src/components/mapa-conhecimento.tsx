"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecurso, invalidar } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

/**
 * O MAPA DO QUE A ÓRBITA SABE.
 *
 * Canvas, não SVG: com algumas centenas de pontos e uma simulação rodando a
 * cada quadro, um elemento do DOM por nó faz o navegador engasgar. Canvas
 * desenha tudo numa passada.
 *
 * A simulação é a clássica de três forças (repulsão entre todos, mola nas
 * ligações, gravidade para o centro), com amortecimento crescente para o mapa
 * PARAR. Grafo que nunca assenta é bonito no vídeo e impossível de usar: o
 * ponto que você quer clicar foge do cursor.
 */

type TipoDeNo = "conversa" | "documento" | "reuniao" | "tarefa" | "memoria" | "pessoa";

interface No {
  id: string;
  tipo: TipoDeNo;
  rotulo: string;
  grau: number;
  quando: string | null;
  href?: string;
}
interface Aresta {
  origem: string;
  destino: string;
  tipo: "veio_de" | "gerou" | "falou_em" | "parecido";
  forca?: number;
}
interface Grafo {
  nos: No[];
  arestas: Aresta[];
  omitidos: number;
}

/** Um nó com a física dentro. Separado do dado do servidor de propósito. */
interface Ponto extends No {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const CORES: Record<TipoDeNo, string> = {
  conversa: "#ef9bb4",
  documento: "#93c97d",
  reuniao: "#5a9fe8",
  tarefa: "#e8c65a",
  memoria: "#8ed2e8",
  pessoa: "#e8894f",
};

const NOMES: Record<TipoDeNo, string> = {
  conversa: "Conversas",
  documento: "Documentos",
  reuniao: "Reuniões",
  tarefa: "Tarefas",
  memoria: "Memórias",
  pessoa: "Pessoas",
};

const TODOS = Object.keys(CORES) as TipoDeNo[];

const RELACAO: Record<Aresta["tipo"], string> = {
  veio_de: "veio de",
  gerou: "gerou",
  falou_em: "falou em",
  parecido: "parecido com",
};

/** O raio cresce com o grau, mas devagar: senão um nó com 40 ligações vira uma bolha que tapa o mapa. */
const raioDe = (grau: number) => 4 + Math.sqrt(grau) * 2.6;

export function MapaConhecimento() {
  const [tipos, setTipos] = useState<TipoDeNo[]>(TODOS);
  const [parecidos, setParecidos] = useState(false);
  const [selecionado, setSelecionado] = useState<No | null>(null);
  const [apagando, setApagando] = useState(false);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    // só manda o filtro quando ele REMOVE algo: mandar os seis seria a mesma
    // busca com outra chave de cache
    if (tipos.length !== TODOS.length) for (const t of tipos) p.append("tipo", t);
    if (parecidos) p.set("parecidos", "1");
    const s = p.toString();
    return `/api/knowledge/grafo${s ? `?${s}` : ""}`;
  }, [tipos, parecidos]);

  const { dado, carregando, erro } = useRecurso<Grafo>(query);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pontosRef = useRef<Ponto[]>([]);
  const camRef = useRef({ x: 0, y: 0, zoom: 1 });
  const hoverRef = useRef<string | null>(null);
  const animRef = useRef<number | null>(null);
  const [hoverNome, setHoverNome] = useState<string | null>(null);

  /** Vizinhos do nó aberto, calculados no cliente (o grafo inteiro já está aqui). */
  const vizinhos = useMemo(() => {
    if (!selecionado || !dado) return [];
    const porId = new Map(dado.nos.map((n) => [n.id, n]));
    const out: { no: No; relacao: string }[] = [];
    for (const a of dado.arestas) {
      if (a.origem === selecionado.id && porId.has(a.destino)) out.push({ no: porId.get(a.destino)!, relacao: RELACAO[a.tipo] });
      else if (a.destino === selecionado.id && porId.has(a.origem)) {
        out.push({ no: porId.get(a.origem)!, relacao: a.tipo === "veio_de" ? "gerou" : RELACAO[a.tipo] });
      }
    }
    return out;
  }, [selecionado, dado]);

  // ── monta a física quando o grafo muda ────────────────────────────────────
  useEffect(() => {
    if (!dado) return;
    const antigos = new Map(pontosRef.current.map((p) => [p.id, p]));
    const n = dado.nos.length || 1;
    pontosRef.current = dado.nos.map((no, i) => {
      const velho = antigos.get(no.id);
      // quem já estava na tela fica onde estava: refiltrar não pode embaralhar
      // o mapa inteiro, senão o dono perde a referência do que estava olhando
      if (velho) return { ...no, x: velho.x, y: velho.y, vx: 0, vy: 0, r: raioDe(no.grau) };
      // começa num círculo, não aleatório: aleatório às vezes nasce tudo
      // empilhado e a repulsão explode no primeiro quadro
      const ang = (i / n) * Math.PI * 2;
      const raio = 120 + (i % 7) * 26;
      return { ...no, x: Math.cos(ang) * raio, y: Math.sin(ang) * raio, vx: 0, vy: 0, r: raioDe(no.grau) };
    });
  }, [dado]);

  // ── laço de desenho e simulação ───────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !dado) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let quadro = 0;
    const arestas = dado.arestas;

    function passo() {
      const pontos = pontosRef.current;
      const canvas = canvasRef.current;
      if (!canvas || !ctx) return;

      const dpr = window.devicePixelRatio || 1;
      const larg = canvas.clientWidth;
      const alt = canvas.clientHeight;
      if (canvas.width !== larg * dpr || canvas.height !== alt * dpr) {
        canvas.width = larg * dpr;
        canvas.height = alt * dpr;
      }

      // amortecimento cresce com o tempo: o mapa assenta e para de fugir do cursor
      const calma = Math.min(1, quadro / 260);
      const atrito = 0.86 - calma * 0.25;

      if (calma < 1) {
        const porId = new Map(pontos.map((p) => [p.id, p]));

        // repulsão entre todos os pares
        for (let i = 0; i < pontos.length; i++) {
          const a = pontos[i]!;
          for (let j = i + 1; j < pontos.length; j++) {
            const b = pontos[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let d2 = dx * dx + dy * dy;
            // dois nós exatamente no mesmo ponto dariam divisão por zero
            if (d2 < 0.01) {
              dx = (Math.random() - 0.5) * 0.1;
              dy = (Math.random() - 0.5) * 0.1;
              d2 = 0.01;
            }
            const f = 900 / d2;
            const d = Math.sqrt(d2);
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            a.vx -= fx;
            a.vy -= fy;
            b.vx += fx;
            b.vy += fy;
          }
        }

        // mola nas ligações
        for (const e of arestas) {
          const a = porId.get(e.origem);
          const b = porId.get(e.destino);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          // ligação fraca (parecido) puxa menos: ela não deve reorganizar o mapa
          const alvo = e.tipo === "parecido" ? 130 : 78;
          const k = (e.tipo === "parecido" ? 0.006 : 0.02) * (d - alvo);
          const fx = (dx / d) * k;
          const fy = (dy / d) * k;
          a.vx += fx;
          a.vy += fy;
          b.vx -= fx;
          b.vy -= fy;
        }

        // gravidade para o centro, para nada escapar da tela
        for (const p of pontos) {
          p.vx -= p.x * 0.0016;
          p.vy -= p.y * 0.0016;
          p.vx *= atrito;
          p.vy *= atrito;
          p.x += p.vx;
          p.y += p.vy;
        }
        quadro++;
      }

      // ── desenho ──────────────────────────────────────────────────────────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, larg, alt);
      const cam = camRef.current;
      ctx.translate(larg / 2 + cam.x, alt / 2 + cam.y);
      ctx.scale(cam.zoom, cam.zoom);

      const foco = hoverRef.current ?? selecionado?.id ?? null;
      const ligados = new Set<string>();
      if (foco) {
        ligados.add(foco);
        for (const e of arestas) {
          if (e.origem === foco) ligados.add(e.destino);
          else if (e.destino === foco) ligados.add(e.origem);
        }
      }

      const porId = new Map(pontos.map((p) => [p.id, p]));
      for (const e of arestas) {
        const a = porId.get(e.origem);
        const b = porId.get(e.destino);
        if (!a || !b) continue;
        const aceso = !foco || (ligados.has(e.origem) && ligados.has(e.destino));
        ctx.strokeStyle = aceso ? "rgba(190,190,190,0.42)" : "rgba(150,150,150,0.07)";
        ctx.lineWidth = e.tipo === "parecido" ? 0.5 : 0.9;
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      }

      for (const p of pontos) {
        const aceso = !foco || ligados.has(p.id);
        ctx.globalAlpha = aceso ? 1 : 0.16;
        ctx.fillStyle = CORES[p.tipo] ?? "#999";
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fill();
        if (p.id === selecionado?.id) {
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }
        // o nome só aparece quando cabe: com tudo escrito o mapa vira uma
        // mancha de texto e não se enxerga mais a forma
        const mostrarNome = aceso && (p.r > 7 || p.id === foco || cam.zoom > 1.7);
        if (mostrarNome) {
          ctx.globalAlpha = aceso ? 0.85 : 0.1;
          ctx.fillStyle = "#e8e8e8";
          ctx.font = `${Math.max(9, 11 / cam.zoom)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(p.rotulo.slice(0, 28), p.x, p.y - p.r - 4);
        }
        ctx.globalAlpha = 1;
      }

      animRef.current = requestAnimationFrame(passo);
    }

    animRef.current = requestAnimationFrame(passo);
    return () => {
      if (animRef.current !== null) cancelAnimationFrame(animRef.current);
    };
  }, [dado, selecionado]);

  /** Converte a posição do mouse para o espaço do grafo. */
  const noSobCursor = useCallback((ev: React.MouseEvent<HTMLCanvasElement>): Ponto | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const cam = camRef.current;
    const x = (ev.clientX - rect.left - rect.width / 2 - cam.x) / cam.zoom;
    const y = (ev.clientY - rect.top - rect.height / 2 - cam.y) / cam.zoom;
    let achado: Ponto | null = null;
    let menor = Infinity;
    for (const p of pontosRef.current) {
      const d = Math.hypot(p.x - x, p.y - y);
      // alvo um pouco maior que o desenho: ponto de 4px é impossível de acertar
      if (d < Math.max(p.r + 5, 10) && d < menor) {
        menor = d;
        achado = p;
      }
    }
    return achado;
  }, []);

  const arrastando = useRef<{ x: number; y: number } | null>(null);

  async function apagar(no: No) {
    setApagando(true);
    const r = await fetch(`/api/knowledge/grafo?tipo=${no.tipo}&id=${no.id}`, { method: "DELETE" });
    setApagando(false);
    if (r.ok) {
      setSelecionado(null);
      invalidar(query);
    }
  }

  function alternarTipo(t: TipoDeNo) {
    setTipos((atual) => (atual.includes(t) ? atual.filter((x) => x !== t) : [...atual, t]));
  }

  const contagem = useMemo(() => {
    const m = new Map<TipoDeNo, number>();
    for (const n of dado?.nos ?? []) m.set(n.tipo, (m.get(n.tipo) ?? 0) + 1);
    return m;
  }, [dado]);

  return (
    <>
      <div className="mapa-filtros">
        {TODOS.map((t) => (
          <button
            key={t}
            className={`mapa-chip ${tipos.includes(t) ? "ativo" : ""}`}
            onClick={() => alternarTipo(t)}
            style={{ "--cor": CORES[t] } as React.CSSProperties}
          >
            <span className="mapa-bolinha" />
            {NOMES[t]}
            {contagem.get(t) ? <em>{contagem.get(t)}</em> : null}
          </button>
        ))}
        <span className="tarefa-espacador" />
        <button className={`filter-chip ${parecidos ? "active" : ""}`} onClick={() => setParecidos((v) => !v)} title="Liga memórias parecidas entre si">
          Ligar por semelhança
        </button>
      </div>

      <div className="mapa-caixa">
        <canvas
          ref={canvasRef}
          className="mapa-canvas"
          onMouseMove={(ev) => {
            if (arrastando.current) {
              camRef.current.x += ev.clientX - arrastando.current.x;
              camRef.current.y += ev.clientY - arrastando.current.y;
              arrastando.current = { x: ev.clientX, y: ev.clientY };
              return;
            }
            const p = noSobCursor(ev);
            hoverRef.current = p?.id ?? null;
            setHoverNome(p?.rotulo ?? null);
          }}
          onMouseDown={(ev) => {
            if (!noSobCursor(ev)) arrastando.current = { x: ev.clientX, y: ev.clientY };
          }}
          onMouseUp={() => {
            arrastando.current = null;
          }}
          onMouseLeave={() => {
            arrastando.current = null;
            hoverRef.current = null;
            setHoverNome(null);
          }}
          onClick={(ev) => {
            const p = noSobCursor(ev);
            if (p) setSelecionado({ id: p.id, tipo: p.tipo, rotulo: p.rotulo, grau: p.grau, quando: p.quando, href: p.href });
          }}
          onWheel={(ev) => {
            const cam = camRef.current;
            cam.zoom = Math.min(4, Math.max(0.25, cam.zoom * (ev.deltaY > 0 ? 0.9 : 1.1)));
          }}
        />

        {carregando && !dado && <div className="mapa-recado">Montando o mapa…</div>}
        {erro && !dado && <div className="mapa-recado">Não consegui montar o mapa.</div>}
        {dado && dado.nos.length === 0 && (
          <div className="mapa-recado">
            Nada guardado ainda. Conversas viram parte do mapa quando são arquivadas, e reuniões entram junto com o resumo.
          </div>
        )}
        {hoverNome && !selecionado && <div className="mapa-dica">{hoverNome}</div>}
        {dado && dado.omitidos > 0 && (
          <div className="mapa-omitidos">
            {dado.omitidos} {dado.omitidos === 1 ? "item ficou" : "itens ficaram"} de fora do teto do mapa. Aumente em Preferências, Grafo de conhecimento.
          </div>
        )}

        {selecionado && (
          <aside className="mapa-detalhe">
            <div className="mapa-detalhe-topo">
              <span className="mapa-bolinha" style={{ "--cor": CORES[selecionado.tipo] } as React.CSSProperties} />
              <strong>{NOMES[selecionado.tipo]}</strong>
              <button className="icon-button" onClick={() => setSelecionado(null)} aria-label="Fechar">
                <Icone nome="close" />
              </button>
            </div>
            <p className="mapa-detalhe-titulo">{selecionado.rotulo}</p>
            {selecionado.quando && <small>{new Date(selecionado.quando).toLocaleDateString("pt-BR")}</small>}

            <p className="panel-label" style={{ marginTop: 18 }}>
              LIGAÇÕES ({vizinhos.length})
            </p>
            {vizinhos.length === 0 ? (
              <small>Nada ligado a isto ainda.</small>
            ) : (
              <ul className="mapa-vizinhos">
                {vizinhos.map((v, i) => (
                  <li key={`${v.no.id}-${i}`}>
                    <span className="mapa-bolinha" style={{ "--cor": CORES[v.no.tipo] } as React.CSSProperties} />
                    <em>{v.relacao}</em>
                    <button className="mapa-link" onClick={() => setSelecionado(v.no)}>
                      {v.no.rotulo}
                    </button>
                  </li>
                ))}
              </ul>
            )}

            <div className="mapa-detalhe-acoes">
              {selecionado.href && (
                <a className="button secondary compacto" href={selecionado.href}>
                  Abrir
                </a>
              )}
              {/* tarefa tem tela própria, com desfazer: apagar por aqui seria um caminho paralelo sem as mesmas defesas */}
              {selecionado.tipo !== "tarefa" && selecionado.tipo !== "pessoa" && (
                <button className="button danger compacto" onClick={() => apagar(selecionado)} disabled={apagando}>
                  <Icone nome="trash" />
                  Tirar da base
                </button>
              )}
            </div>
          </aside>
        )}
      </div>
    </>
  );
}
