"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRecurso, invalidar } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

/**
 * O MAPA DO QUE A ÓRBITA SABE, EM 3D.
 *
 * Canvas 2D com projeção própria, não three.js: o mapa é só ponto e linha, e
 * uma biblioteca 3D inteira no bundle pagaria por um renderizador de cenas que
 * não vamos usar. A matemática aqui cabe em vinte linhas.
 *
 * A simulação é a clássica de três forças (repulsão entre todos, mola nas
 * ligações, gravidade para o centro), agora nos três eixos, com amortecimento
 * crescente para o mapa PARAR de se reorganizar. O que continua girando é a
 * CÂMERA, não os pontos: grafo cujos nós nunca assentam é impossível de usar,
 * porque o ponto que você quer clicar foge do cursor.
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

/** Um nó com a física dentro, nos três eixos. Separado do dado do servidor de propósito. */
interface Ponto extends No {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  r: number;
}

/** O nó já projetado na tela, com a profundidade para ordenar o desenho. */
interface Projetado {
  p: Ponto;
  sx: number;
  sy: number;
  escala: number;
  profundidade: number;
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

/** Distância da câmera ao centro. Define a força da perspectiva. */
const DISTANCIA = 900;

/**
 * Espalha os pontos numa ESFERA, não num círculo.
 *
 * Espiral de Fibonacci: distribui quase uniformemente, sem os polos
 * amontoados que aparecem quando se sorteia latitude e longitude. Começar
 * aleatório às vezes nasce tudo empilhado e a repulsão explode no primeiro
 * quadro.
 */
function naEsfera(i: number, total: number, raio: number): { x: number; y: number; z: number } {
  const k = i + 0.5;
  const phi = Math.acos(1 - (2 * k) / total);
  const theta = Math.PI * (1 + Math.sqrt(5)) * k;
  return {
    x: Math.cos(theta) * Math.sin(phi) * raio,
    y: Math.sin(theta) * Math.sin(phi) * raio,
    z: Math.cos(phi) * raio,
  };
}

export function MapaConhecimento() {
  const [tipos, setTipos] = useState<TipoDeNo[]>(TODOS);
  const [parecidos, setParecidos] = useState(false);
  const [selecionado, setSelecionado] = useState<No | null>(null);
  const [apagando, setApagando] = useState(false);
  const [girando, setGirando] = useState(true);

  const query = useMemo(() => {
    const p = new URLSearchParams();
    // só manda o filtro quando ele REMOVE algo: mandar os seis seria a mesma
    // busca com outra chave de cache
    if (tipos.length !== TODOS.length) for (const t of tipos) p.append("tipo", t);
    if (parecidos) p.set("parecidos", "1");
    const s = p.toString();
    return `/api/knowledge/grafo${s ? `?${s}` : ""}`;
  }, [tipos, parecidos]);

  const { dado, carregando, erro, recarregar } = useRecurso<Grafo>(query);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pontosRef = useRef<Ponto[]>([]);
  const projetadosRef = useRef<Projetado[]>([]);
  /** Onde a câmera está: giro horizontal, inclinação e afastamento. */
  const camRef = useRef({ giro: 0.5, inclinacao: -0.3, zoom: 1 });
  const giraRef = useRef(true);
  const hoverRef = useRef<string | null>(null);
  const animRef = useRef<number | null>(null);
  const [hoverNome, setHoverNome] = useState<string | null>(null);

  useEffect(() => {
    giraRef.current = girando;
  }, [girando]);

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
      if (velho) return { ...no, x: velho.x, y: velho.y, z: velho.z, vx: 0, vy: 0, vz: 0, r: raioDe(no.grau) };
      const pos = naEsfera(i, n, 150 + (i % 5) * 20);
      return { ...no, ...pos, vx: 0, vy: 0, vz: 0, r: raioDe(no.grau) };
    });
  }, [dado]);

  // ── laço de simulação e desenho ───────────────────────────────────────────
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

      // amortecimento cresce com o tempo: os pontos assentam e param de fugir
      // do cursor. Quem continua em movimento é a câmera.
      const calma = Math.min(1, quadro / 300);
      const atrito = 0.86 - calma * 0.25;

      if (calma < 1) {
        const porId = new Map(pontos.map((p) => [p.id, p]));

        // repulsão entre todos os pares, agora nos três eixos
        for (let i = 0; i < pontos.length; i++) {
          const a = pontos[i]!;
          for (let j = i + 1; j < pontos.length; j++) {
            const b = pontos[j]!;
            let dx = b.x - a.x;
            let dy = b.y - a.y;
            let dz = b.z - a.z;
            let d2 = dx * dx + dy * dy + dz * dz;
            // dois nós exatamente no mesmo ponto dariam divisão por zero
            if (d2 < 0.01) {
              dx = (Math.random() - 0.5) * 0.1;
              dy = (Math.random() - 0.5) * 0.1;
              dz = (Math.random() - 0.5) * 0.1;
              d2 = 0.01;
            }
            const d = Math.sqrt(d2);
            const f = 1400 / d2;
            const fx = (dx / d) * f;
            const fy = (dy / d) * f;
            const fz = (dz / d) * f;
            a.vx -= fx;
            a.vy -= fy;
            a.vz -= fz;
            b.vx += fx;
            b.vy += fy;
            b.vz += fz;
          }
        }

        // mola nas ligações
        for (const e of arestas) {
          const a = porId.get(e.origem);
          const b = porId.get(e.destino);
          if (!a || !b) continue;
          const dx = b.x - a.x;
          const dy = b.y - a.y;
          const dz = b.z - a.z;
          const d = Math.max(1, Math.sqrt(dx * dx + dy * dy + dz * dz));
          // ligação fraca (parecido) puxa menos: ela não deve reorganizar o mapa
          const alvo = e.tipo === "parecido" ? 150 : 90;
          const k = (e.tipo === "parecido" ? 0.006 : 0.02) * (d - alvo);
          const fx = (dx / d) * k;
          const fy = (dy / d) * k;
          const fz = (dz / d) * k;
          a.vx += fx;
          a.vy += fy;
          a.vz += fz;
          b.vx -= fx;
          b.vy -= fy;
          b.vz -= fz;
        }

        // gravidade para o centro, para a nuvem não se desmanchar
        for (const p of pontos) {
          p.vx -= p.x * 0.0016;
          p.vy -= p.y * 0.0016;
          p.vz -= p.z * 0.0016;
          p.vx *= atrito;
          p.vy *= atrito;
          p.vz *= atrito;
          p.x += p.vx;
          p.y += p.vy;
          p.z += p.vz;
        }
        quadro++;
      }

      // ── câmera ───────────────────────────────────────────────────────────
      const cam = camRef.current;
      // gira sozinho devagar, para a forma 3D se ler sem ninguém tocar. Para
      // assim que a pessoa arrasta: girar debaixo do cursor é hostil.
      if (giraRef.current) cam.giro += 0.0022;

      const cosG = Math.cos(cam.giro);
      const senG = Math.sin(cam.giro);
      const cosI = Math.cos(cam.inclinacao);
      const senI = Math.sin(cam.inclinacao);
      const foco = DISTANCIA * cam.zoom;

      const projetados: Projetado[] = [];
      for (const p of pontos) {
        // gira em torno do eixo vertical, depois inclina
        const x1 = p.x * cosG - p.z * senG;
        const z1 = p.x * senG + p.z * cosG;
        const y2 = p.y * cosI - z1 * senI;
        const z2 = p.y * senI + z1 * cosI;
        // perspectiva: o que está longe encolhe. O `max` evita que um ponto
        // atrás da câmera vire uma escala negativa e apareça espelhado.
        const escala = foco / Math.max(60, foco + z2);
        projetados.push({ p, sx: x1 * escala, sy: y2 * escala, escala, profundidade: z2 });
      }
      // desenha do fundo para a frente: sem isso, um ponto distante cobriria
      // um próximo e a profundidade se perderia
      projetados.sort((a, b) => b.profundidade - a.profundidade);
      projetadosRef.current = projetados;

      // ── desenho ──────────────────────────────────────────────────────────
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, larg, alt);
      ctx.translate(larg / 2, alt / 2);

      const focoId = hoverRef.current ?? selecionado?.id ?? null;
      const ligados = new Set<string>();
      if (focoId) {
        ligados.add(focoId);
        for (const e of arestas) {
          if (e.origem === focoId) ligados.add(e.destino);
          else if (e.destino === focoId) ligados.add(e.origem);
        }
      }

      const porIdProj = new Map(projetados.map((q) => [q.p.id, q]));
      for (const e of arestas) {
        const a = porIdProj.get(e.origem);
        const b = porIdProj.get(e.destino);
        if (!a || !b) continue;
        const aceso = !focoId || (ligados.has(e.origem) && ligados.has(e.destino));
        // linha mais fraca quanto mais fundo: é o que dá noção de volume
        const media = (a.escala + b.escala) / 2;
        const alfa = aceso ? 0.1 + media * 0.34 : 0.05;
        ctx.strokeStyle = `rgba(200,200,200,${alfa.toFixed(3)})`;
        ctx.lineWidth = (e.tipo === "parecido" ? 0.4 : 0.8) * media;
        ctx.beginPath();
        ctx.moveTo(a.sx, a.sy);
        ctx.lineTo(b.sx, b.sy);
        ctx.stroke();
      }

      for (const q of projetados) {
        const p = q.p;
        const aceso = !focoId || ligados.has(p.id);
        const raio = Math.max(1.2, p.r * q.escala);
        // longe fica mais apagado, como neblina: é o segundo sinal de
        // profundidade, junto com o tamanho
        const neblina = Math.min(1, Math.max(0.28, q.escala * 0.95));
        ctx.globalAlpha = aceso ? neblina : 0.09;
        ctx.fillStyle = CORES[p.tipo] ?? "#999";
        ctx.beginPath();
        ctx.arc(q.sx, q.sy, raio, 0, Math.PI * 2);
        ctx.fill();

        if (p.id === selecionado?.id) {
          ctx.globalAlpha = 1;
          ctx.strokeStyle = "#fff";
          ctx.lineWidth = 1.8;
          ctx.stroke();
        }

        // o nome só aparece quando cabe: com tudo escrito o mapa vira uma
        // mancha de texto e não se enxerga mais a forma
        if (aceso && (raio > 7 || p.id === focoId)) {
          ctx.globalAlpha = Math.min(0.9, neblina);
          ctx.fillStyle = "#e8e8e8";
          ctx.font = `${Math.max(9, 11 * q.escala)}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.fillText(p.rotulo.slice(0, 28), q.sx, q.sy - raio - 4);
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

  /**
   * Qual nó está sob o cursor.
   *
   * Testa contra a posição PROJETADA, e do mais próximo para o mais distante:
   * em 3D dois pontos se sobrepõem na tela o tempo todo, e clicar tem de pegar
   * o da frente, que é o que a pessoa está vendo.
   */
  const noSobCursor = useCallback((ev: React.MouseEvent<HTMLCanvasElement>): Ponto | null => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const x = ev.clientX - rect.left - rect.width / 2;
    const y = ev.clientY - rect.top - rect.height / 2;
    const daFrente = [...projetadosRef.current].reverse();
    for (const q of daFrente) {
      const raio = Math.max(1.2, q.p.r * q.escala);
      // alvo um pouco maior que o desenho: ponto de 2px é impossível de acertar
      if (Math.hypot(q.sx - x, q.sy - y) < Math.max(raio + 5, 9)) return q.p;
    }
    return null;
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
        <button className={`filter-chip ${girando ? "active" : ""}`} onClick={() => setGirando((v) => !v)} title="Gira o mapa sozinho">
          Girar
        </button>
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
              const cam = camRef.current;
              cam.giro += (ev.clientX - arrastando.current.x) * 0.006;
              // trava a inclinação antes do polo: passar dele vira o mundo de
              // cabeça para baixo e a pessoa se perde
              cam.inclinacao = Math.max(-1.45, Math.min(1.45, cam.inclinacao + (ev.clientY - arrastando.current.y) * 0.006));
              arrastando.current = { x: ev.clientX, y: ev.clientY };
              return;
            }
            const p = noSobCursor(ev);
            hoverRef.current = p?.id ?? null;
            setHoverNome(p?.rotulo ?? null);
          }}
          onMouseDown={(ev) => {
            if (!noSobCursor(ev)) {
              arrastando.current = { x: ev.clientX, y: ev.clientY };
              setGirando(false); // girar debaixo do cursor enquanto se arrasta é hostil
            }
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
            cam.zoom = Math.min(4, Math.max(0.3, cam.zoom * (ev.deltaY > 0 ? 0.92 : 1.08)));
          }}
        />

        {carregando && !dado && <div className="mapa-recado">Montando o mapa…</div>}
        {erro && !dado && (
          // beco sem saída era o que estava aqui: o apps/api reiniciando por
          // segundos deixava a tela morta até um F5. Falha de leitura tem de
          // ter volta, como nos outros painéis.
          <div className="mapa-recado mapa-recado-acao">
            <p>Não consegui montar o mapa agora.</p>
            <button className="button secondary compacto" onClick={() => recarregar()}>
              Tentar de novo
            </button>
          </div>
        )}
        {dado && dado.nos.length === 0 && (
          <div className="mapa-recado">
            Nada guardado ainda. Conversas viram parte do mapa quando são arquivadas, e reuniões entram junto com o resumo.
          </div>
        )}
        {hoverNome && !selecionado && <div className="mapa-dica">{hoverNome}</div>}
        {dado && dado.nos.length > 0 && !selecionado && <div className="mapa-ajuda">arraste para girar · roda para aproximar</div>}
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
