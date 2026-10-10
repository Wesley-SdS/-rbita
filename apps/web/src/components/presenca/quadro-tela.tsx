"use client";

import { useEffect, useMemo, useState } from "react";
import { moverNoQuadro, type CardDoQuadro, type QualQuadro, type Quadro } from "@orbita/core/quadro/regras";
import { definirDado, invalidar, restaurarDado, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "./icones";

/**
 * O QUADRO da Adalink (pedido do dono, 09/10/2026): os cards como estão lá, nas
 * mesmas colunas, para ver e mover. Arrastar o card é o gesto do dono, então
 * move direto no sistema de origem (a tela mostra na hora e desfaz se ele
 * recusar). Pelo chat e pela voz o mesmo movimento vira proposta (`mover_card`).
 * Para quem não usa mouse, cada card tem o "Mover para".
 */

const ABAS: { id: QualQuadro; rotulo: string }[] = [
  { id: "chamados", rotulo: "Chamados" },
  { id: "gestao", rotulo: "Gestão" },
];

const iniciais = (nome: string) => nome.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");

function Card({ card, colunas, colunaAtual, aoMover, movendo }: { card: CardDoQuadro; colunas: { id: string; rotulo: string }[]; colunaAtual: string; aoMover: (cardId: string, colunaId: string) => void; movendo: boolean }) {
  return (
    <li
      className={`quadro-card${card.critico ? " critico" : ""}${movendo ? " movendo" : ""}`}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", card.id);
        e.dataTransfer.effectAllowed = "move";
      }}
    >
      <div className="quadro-card-topo">
        {card.codigo ? <span className="quadro-card-codigo">{card.codigo}</span> : null}
        {card.critico ? <span className="quadro-chip critico">crítico</span> : card.prioridade ? <span className={`quadro-chip prioridade-${card.prioridade}`}>{card.prioridade}</span> : null}
      </div>
      <strong className="quadro-card-titulo">{card.titulo}</strong>
      {card.subtitulo ? (
        <span className="quadro-card-sub">
          {card.cor ? <span className="quadro-card-ponto" style={{ background: card.cor }} aria-hidden="true" /> : null}
          {card.subtitulo}
        </span>
      ) : null}
      {card.prazo && card.prazo.estado !== "sem_prazo" ? <span className={`comigo-prazo ${card.prazo.estado}`}><b>{card.prazo.texto}</b></span> : null}
      <div className="quadro-card-rodape">
        <span className="quadro-card-pessoas">
          {card.responsaveis.length ? (
            card.responsaveis.slice(0, 3).map((r) => (
              <span key={r} className={`quadro-avatar${card.comVoce ? " voce" : ""}`} title={r}>{iniciais(r)}</span>
            ))
          ) : (
            <span className="quadro-sem-dono">sem responsável</span>
          )}
        </span>
        {card.horas ? <span className="quadro-card-horas" title="horas feitas de previstas">{card.horas.feitas}h / {card.horas.previstas}h</span> : null}
        <label className="quadro-mover">
          <span className="visualmente-oculto">Mover {card.codigo ?? card.titulo} para</span>
          <select value={colunaAtual} onChange={(e) => aoMover(card.id, e.target.value)} disabled={movendo}>
            {colunas.map((c) => (
              <option key={c.id} value={c.id}>{c.rotulo}</option>
            ))}
          </select>
        </label>
      </div>
    </li>
  );
}

/**
 * `inicial`: abre já neste quadro (o painel do chat abre no que a conversa
 * pediu). `noPainel`: o quadro dentro do painel lateral da Conversa, que ocupa
 * a altura do painel em vez da tela.
 */
export function QuadroTela({ inicial, noPainel = false }: { inicial?: QualQuadro; noPainel?: boolean } = {}) {
  const [aba, setAba] = useState<QualQuadro>(inicial ?? "chamados");
  useEffect(() => {
    if (inicial) return;
    try {
      const salva = localStorage.getItem("orbita.quadro.aba");
      if (salva === "gestao" || salva === "chamados") setAba(salva);
    } catch {
      /* sem armazenamento: começa em Chamados */
    }
  }, [inicial]);
  const escolherAba = (q: QualQuadro) => {
    setAba(q);
    try {
      localStorage.setItem("orbita.quadro.aba", q);
    } catch {
      /* idem */
    }
  };

  const chave = `/api/quadro?qual=${aba}`;
  const { dado, erro, carregando } = useRecurso<Quadro>(chave);
  const [soMeus, setSoMeus] = useState(false);
  const [projeto, setProjeto] = useState("");
  const [sobre, setSobre] = useState<string | null>(null);
  const [movendo, setMovendo] = useState<string | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [lendo, setLendo] = useState(false);

  const projetos = useMemo(() => [...new Set((dado?.colunas ?? []).flatMap((c) => c.cards.map((k) => k.subtitulo ?? "")).filter(Boolean))].sort(), [dado]);
  const visivel = (k: CardDoQuadro) => (!soMeus || k.comVoce) && (!projeto || k.subtitulo === projeto);
  const colunas = (dado?.colunas ?? []).map((c) => ({ ...c, visiveis: c.cards.filter(visivel) }));

  async function mover(cardId: string, colunaId: string) {
    if (!dado || movendo) return;
    const card = dado.colunas.flatMap((c) => c.cards).find((k) => k.id === cardId);
    const destino = dado.colunas.find((c) => c.id === colunaId);
    if (!card || !destino || dado.colunas.find((c) => c.cards.some((k) => k.id === cardId))?.id === colunaId) return;
    setMovendo(cardId);
    // a tela muda na hora; se o sistema recusar, volta como estava
    const antes = definirDado<Quadro>(chave, (atual) => (atual ? moverNoQuadro(atual, cardId, colunaId) : atual!));
    try {
      const r = await fetch("/api/quadro/mover", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ qual: aba, cardId, colunaId }) });
      const corpo = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) throw new Error(corpo.error ?? "Não consegui mover.");
      setRecado(`${card.codigo ?? card.titulo} foi para "${destino.rotulo}".`);
    } catch (e) {
      if (antes) restaurarDado(chave, antes);
      setRecado(`Não movi ${card.codigo ?? card.titulo}: ${e instanceof Error ? e.message : "o sistema recusou"}.`);
    } finally {
      setMovendo(null);
      setTimeout(() => setRecado(null), 6000);
    }
  }

  async function atualizar() {
    setLendo(true);
    await fetch(`${chave}&fresco=1`).catch(() => undefined);
    invalidar(chave);
    setLendo(false);
  }

  return (
    <section className={`view view-quadro${noPainel ? " no-painel" : ""}`}>
      <div className="quadro-barra">
        <div className="cartao-abas quadro-abas" role="tablist" aria-label="Qual quadro">
          {ABAS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? "ativa" : ""} onClick={() => escolherAba(a.id)}>
              {a.rotulo}
              {aba === a.id && dado ? <span className="cartao-aba-total">{dado.colunas.reduce((s, c) => s + c.total, 0)}</span> : null}
            </button>
          ))}
        </div>
        <span className="quadro-filtros">
          <label className="chat-top-local">
            <input type="checkbox" checked={soMeus} onChange={(e) => setSoMeus(e.target.checked)} />
            <span>Só os meus</span>
          </label>
          {aba === "gestao" && projetos.length > 1 ? (
            <label className="quadro-projeto">
              <span className="visualmente-oculto">Projeto</span>
              <select value={projeto} onChange={(e) => setProjeto(e.target.value)}>
                <option value="">Todos os projetos</option>
                {projetos.map((p) => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </label>
          ) : null}
          <button type="button" className="button secondary compacto" onClick={() => void atualizar()} disabled={lendo}>
            <Icone nome="refresh" />
            {lendo ? "Lendo…" : "Atualizar"}
          </button>
        </span>
      </div>
      {recado ? <p className="noticias-recado" role="status">{recado}</p> : null}
      {erro && !dado ? <div className="panel empty-state">Não consegui ler o quadro: {erro}</div> : null}
      {carregando && !dado ? <div className="panel empty-state">Lendo o quadro da Adalink…</div> : null}

      {dado ? (
        <div className="quadro-colunas" aria-label={`Quadro de ${aba === "gestao" ? "gestão" : "chamados"}`}>
          {colunas.map((c) => (
            <section
              key={c.id}
              className={`quadro-coluna${sobre === c.id ? " alvo" : ""}${c.total === 0 ? " vazia" : ""}`}
              aria-label={`${c.rotulo}, ${c.total}`}
              onDragOver={(e) => {
                e.preventDefault();
                setSobre(c.id);
              }}
              onDragLeave={() => setSobre((s) => (s === c.id ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                setSobre(null);
                const id = e.dataTransfer.getData("text/plain");
                if (id) void mover(id, c.id);
              }}
            >
              <header className="quadro-coluna-topo">
                <strong>{c.rotulo}</strong>
                <span className="cartao-aba-total">{c.total}</span>
              </header>
              <ul className="quadro-cards">
                {c.visiveis.map((k) => (
                  <Card key={k.id} card={k} colunaAtual={c.id} colunas={dado.colunas.filter((x) => x.id !== "?")} aoMover={(id, col) => void mover(id, col)} movendo={movendo === k.id} />
                ))}
                {c.total > c.cards.length ? <li className="quadro-mais">e mais {c.total - c.cards.length} na Adalink</li> : null}
                {!c.visiveis.length && c.total <= c.cards.length ? <li className="quadro-vazio">Solte um card aqui</li> : null}
              </ul>
            </section>
          ))}
        </div>
      ) : null}
    </section>
  );
}
