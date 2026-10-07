"use client";

import { useState, type CSSProperties } from "react";
import { brl, mesCurto, mesLongo } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { Carregando, Vazio } from "./primitivos";
import type { Historico as THistorico } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/**
 * HISTÓRICO: para onde foi o dinheiro (redesenho de 07/10/2026, aprovado no
 * Claude Design). O dono achou a tela antiga "ridícula": um gráfico de doze
 * colunas com rótulos gigantes e uma barra só, e "para onde foi" dizendo 100%
 * em "Outros gastos". Agora:
 *
 * - o gráfico mostra entrada e saída lado a lado, com escala, e a sobra do mês;
 *   tocar num mês mostra o que pesou nele (categoria contra o normal);
 * - "Onde você mais gasta" é por LUGAR (iFood, mercado), que é o que o dono
 *   perguntou, e não por categoria (`finance/lugares.ts`).
 *
 * Todo número vem da visão (`finance/visoes.ts`, §9 "número de dinheiro só sai
 * do motor"); aqui só se escolhe o que mostrar e se desenha.
 */

type Mes = THistorico["meses"][number];
type Periodo = THistorico["periodos"][number];

/** "14,4 mil", "980": cabe em cima de uma coluna estreita. */
function curto(centavos: number): string {
  const reais = centavos / 100;
  const abs = Math.abs(reais);
  const txt = abs >= 1000 ? `${(abs / 1000).toLocaleString("pt-BR", { maximumFractionDigits: 1 })} mil` : Math.round(abs).toLocaleString("pt-BR");
  return reais < 0 ? `−${txt}` : txt;
}

/** O topo da escala, redondo: 15 mil e não 14.436,00. */
function topoDaEscala(maior: number): number {
  const reais = Math.max(1, maior / 100);
  const passo = reais > 20_000 ? 10_000 : reais > 5_000 ? 5_000 : reais > 1_000 ? 1_000 : 100;
  return Math.ceil(reais / passo) * passo * 100;
}

const primeiraMaiuscula = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const variacao = (pct: number | null) => (pct === null ? "" : `${pct > 0 ? "+" : pct < 0 ? "−" : ""}${Math.abs(pct)}%`);
const tomDaVariacao = (pct: number | null) => (pct === null || Math.abs(pct) <= 5 ? "neutro" : pct > 0 ? "subiu" : "desceu");

/** Cor de cada lugar no ranking: tons do tema, um por posição. */
const CORES_DOS_LUGARES = ["var(--fin-hist-l1)", "var(--fin-hist-l2)", "var(--fin-hist-l3)", "var(--fin-hist-l4)", "var(--fin-hist-l5)"];

function Grafico({ meses, escolhido, aoEscolher }: { meses: Mes[]; escolhido: number; aoEscolher: (i: number) => void }) {
  const topo = topoDaEscala(Math.max(...meses.map((m) => Math.max(m.entrada, m.gasto))));
  const altura = (v: number) => `${Math.max(v > 0 ? 2 : 0, Math.round((Math.min(v, topo) / topo) * 100))}%`;
  return (
    <div className="fin-hist-grafico-rolagem">
      <div className="fin-hist-grafico" style={{ "--colunas": meses.length } as CSSProperties}>
        <div className="fin-hist-eixo" aria-hidden="true">
          {[1, 2 / 3, 1 / 3, 0].map((f) => (
            <span key={f}>{curto(topo * f)}</span>
          ))}
        </div>
        <div className="fin-hist-area">
          <div className="fin-hist-grade" aria-hidden="true">
            <i />
            <i />
            <i />
            <i />
          </div>
          <div className="fin-hist-colunas">
            {meses.map((m, i) => {
              const sobra = m.entrada - m.gasto;
              return (
                <button
                  key={m.mes}
                  type="button"
                  className={`fin-hist-coluna${i === escolhido ? " ativa" : ""}${m.temMovimento ? "" : " vazia"}`}
                  aria-pressed={i === escolhido}
                  aria-label={`${primeiraMaiuscula(mesLongo(m.mes))}: entrou ${brl(m.entrada)}, saiu ${brl(m.gasto)}`}
                  onClick={() => aoEscolher(i)}
                >
                  <span className={`fin-hist-sobra ${sobra >= 0 ? "pos" : "neg"}`}>{m.temMovimento ? `${sobra >= 0 ? "+" : ""}${curto(sobra)}` : ""}</span>
                  <span className="fin-hist-barras">
                    <span className="fin-hist-barra fin-hist-b-entrada" style={{ height: altura(m.entrada) }} />
                    <span className="fin-hist-barra fin-hist-b-saida" style={{ height: altura(m.gasto) }} />
                  </span>
                  <span className="fin-hist-mes">{mesCurto(m.mes)}</span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

function MesEscolhido({ m, atual }: { m: Mes; atual: boolean }) {
  const total = m.categorias.reduce((a, c) => a + c.total, 0);
  let acc = 0;
  const fatias = m.categorias.map((c) => {
    const ini = acc;
    acc += total ? (c.total / total) * 100 : 0;
    return `${c.categoria?.cor ?? "#c7cfc2"} ${ini.toFixed(2)}% ${acc.toFixed(2)}%`;
  });
  const sobra = m.entrada - m.gasto;
  // o que mais subiu em relação ao normal, entre as que pesam algo no mês
  const pesou = [...m.categorias].filter((c) => c.pctDoNormal !== null && c.pctDoNormal > 5).sort((a, b) => b.total * (b.pctDoNormal ?? 0) - a.total * (a.pctDoNormal ?? 0))[0];

  return (
    <section className="panel fin-hist-cartao" aria-label="O mês escolhido">
      <header className="fin-hist-cabeca">
        <span className="fin-hist-olho">{atual ? "ESTE MÊS" : "MÊS ESCOLHIDO"}</span>
        <h3>{primeiraMaiuscula(mesLongo(m.mes))}</h3>
        <p>
          Entrou {brl(m.entrada)} e saiu {brl(m.gasto)}
          {sobra >= 0 ? `, sobraram ${brl(sobra)}.` : `, faltaram ${brl(-sobra)}.`}
        </p>
      </header>
      {!m.categorias.length ? (
        <Vazio titulo="Nenhum gasto neste mês." />
      ) : (
        <>
          <div className="fin-hist-mes-corpo">
            <div className="fin-hist-rosca" style={{ background: `conic-gradient(${fatias.join(", ")})` }} aria-hidden="true">
              <span>
                <small>saiu</small>
                <strong>{curto(total)}</strong>
              </span>
            </div>
            <ul className="fin-hist-categorias">
              {m.categorias.map((c) => (
                <li key={c.categoriaId ?? "sem"}>
                  <i style={{ background: c.categoria?.cor ?? "#c7cfc2" }} />
                  <span>{c.categoria?.nome ?? "Sem categoria"}</span>
                  <strong>{brl(c.total)}</strong>
                  <small className={tomDaVariacao(c.pctDoNormal)} title="contra a média dos 3 meses anteriores">{variacao(c.pctDoNormal)}</small>
                </li>
              ))}
            </ul>
          </div>
          {pesou ? (
            <p className="fin-hist-destaque">
              <strong>O que mais pesou:</strong> {pesou.categoria?.nome ?? "Sem categoria"} ficou {variacao(pesou.pctDoNormal)} acima do seu normal, {brl(pesou.total)} no mês.
            </p>
          ) : m.categorias.length === 1 && !m.categorias[0]!.categoriaId ? (
            <p className="fin-hist-destaque">
              Quase tudo está sem categoria. Categorize os lançamentos (ou crie regras em Ajustes) para ver aqui para onde foi cada parte.
            </p>
          ) : null}
        </>
      )}
    </section>
  );
}

function Lugares({ p, meses, aoAbrir }: { p: Periodo; meses: Mes[]; aoAbrir: (lugar: string) => void }) {
  const topo = p.lugares[0]?.total ?? 1;
  return (
    <section className="panel fin-hist-cartao" aria-label="Onde você mais gasta">
      <header className="fin-hist-cabeca">
        <h3>Onde você mais gasta</h3>
        <p>Por lugar, nos últimos {p.meses} meses. O traço mostra mês a mês; toque para ver no extrato.</p>
      </header>
      {!p.lugares.length ? (
        <Vazio titulo="Nenhum gasto no período." />
      ) : (
        <ol className="fin-hist-lugares">
          {p.lugares.map((l, i) => {
            const cor = CORES_DOS_LUGARES[Math.min(i, CORES_DOS_LUGARES.length - 1)]!;
            const maiorMes = Math.max(...l.porMes, 1);
            return (
              <li key={l.lugar}>
                <button type="button" onClick={() => aoAbrir(l.lugar)} aria-label={`${l.lugar}: ${brl(l.total)} em ${l.vezes} ${l.vezes === 1 ? "vez" : "vezes"}. Ver no extrato`}>
                  <span className="fin-hist-inicial" style={{ "--cor": cor } as CSSProperties}>{l.lugar.charAt(0).toUpperCase()}</span>
                  <span className="fin-hist-lugar-meio">
                    <span className="fin-hist-lugar-nome">
                      <strong>{l.lugar}</strong>
                      <small>
                        {l.vezes} {l.vezes === 1 ? "vez" : "vezes"}
                        {l.vezes > 1 ? `, média ${brl(l.ticketMedio)}` : ""}
                      </small>
                    </span>
                    <span className="fin-hist-trilho">
                      <span style={{ width: `${Math.max(3, Math.round((l.total / topo) * 100))}%`, background: cor }} />
                    </span>
                  </span>
                  <span className="fin-hist-traco" aria-hidden="true">
                    {l.porMes.map((v, j) => (
                      <i key={meses[meses.length - l.porMes.length + j]?.mes ?? j} className={j === l.porMes.length - 1 ? "ultimo" : ""} style={{ height: `${Math.max(v > 0 ? 12 : 4, Math.round((v / maiorMes) * 100))}%`, ...(j === l.porMes.length - 1 ? { background: cor } : {}) }} />
                    ))}
                  </span>
                  <span className="fin-hist-lugar-total">
                    <strong>{brl(l.total)}</strong>
                    <small className={tomDaVariacao(l.pctUltimoMes)}>{l.pctUltimoMes === null ? "" : Math.abs(l.pctUltimoMes) <= 5 ? "no normal" : `${variacao(l.pctUltimoMes)} no último mês`}</small>
                  </span>
                </button>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

export function Historico() {
  const f = useFinancas();
  const { dado: h, erro, recarregar } = useVista<THistorico>("historico");
  const [nPeriodo, setNPeriodo] = useState<number | null>(null);
  const [escolhido, setEscolhido] = useState<number | null>(null);
  if (!h) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;

  const p = h.periodos.find((x) => x.meses === nPeriodo) ?? h.periodos[h.periodos.length - 1]!;
  const meses = h.meses.slice(-p.meses);
  const algum = meses.some((m) => m.temMovimento);
  const iAtual = meses.findIndex((m) => m.atual);
  const sel = escolhido !== null && escolhido < meses.length ? escolhido : iAtual >= 0 ? iAtual : meses.length - 1;

  const abrirNoExtrato = (lugar: string) => f.mudarUi({ aba: "extrato", mes: null, filtros: { ...f.ui.filtros, q: lugar, natureza: "despesa" } });

  return (
    <div className="fin-pilha fin-hist">
      <div className="fin-hist-topo">
        <div>
          <h2>Para onde foi o seu dinheiro</h2>
          <p>Entradas e saídas mês a mês. Toque num mês para ver o que pesou nele.</p>
        </div>
        <div className="fin-hist-periodo" role="group" aria-label="Período">
          {h.periodos.map((x) => (
            <button key={x.meses} type="button" aria-pressed={x.meses === p.meses} onClick={() => { setNPeriodo(x.meses); setEscolhido(null); }}>
              {x.meses} meses
            </button>
          ))}
        </div>
      </div>

      {!algum ? (
        <section className="panel fin-bloco">
          <Vazio titulo="Ainda não há histórico." texto="Depois de um ou dois meses lançando, esta tela mostra para onde vai o seu dinheiro." />
        </section>
      ) : (
        <>
          <div className="fin-hist-resumo">
            <div className="panel">
              <span>Gasto médio por mês</span>
              <strong>{brl(p.gastoMedio)}</strong>
              <small>nos últimos {p.meses} meses</small>
            </div>
            <div className="panel">
              <span>Entrada média</span>
              <strong>{brl(p.entradaMedia)}</strong>
              <small>salário e outras entradas</small>
            </div>
            <div className="panel">
              <span>Sobrou no período</span>
              <strong className={p.sobra >= 0 ? "fin-tom-entrada" : "fin-tom-saida"}>{brl(p.sobra)}</strong>
              <small>{p.sobra >= 0 ? "entrou mais do que saiu" : "saiu mais do que entrou"}</small>
            </div>
            {p.maisPesado ? (
              <div className="panel">
                <span>Mês mais pesado</span>
                <strong>{primeiraMaiuscula(mesLongo(p.maisPesado.mes).split(" de ")[0]!)}</strong>
                <small>{brl(p.maisPesado.gasto)} de saída</small>
              </div>
            ) : null}
          </div>

          <section className="panel fin-hist-cartao" aria-label="Entradas e saídas por mês">
            <div className="fin-hist-grafico-topo">
              <h3>Entradas e saídas, mês a mês</h3>
              <div className="fin-hist-legenda">
                <span><i className="fin-hist-b-entrada" />Entrou</span>
                <span><i className="fin-hist-b-saida" />Saiu</span>
                <span><b>+1,2 mil</b>sobra do mês</span>
              </div>
            </div>
            <Grafico meses={meses} escolhido={sel} aoEscolher={setEscolhido} />
          </section>

          <div className="fin-hist-dupla">
            <MesEscolhido m={meses[sel]!} atual={meses[sel]!.atual} />
            <Lugares p={p} meses={meses} aoAbrir={abrirNoExtrato} />
          </div>

          {h.comparacao.length ? (
            <section className="fin-hist-mudou" aria-label="O que mudou no último mês">
              <header className="fin-hist-cabeca">
                <h3>O que mudou no último mês</h3>
                <p>Comparado com a média dos três meses anteriores.</p>
              </header>
              <div className="fin-hist-mudancas">
                {h.comparacao.slice(0, 4).map((c) => {
                  const pct = Math.round(c.pct);
                  return (
                    <div key={c.categoriaId ?? "sem"} className="panel">
                      <div>
                        <strong>{c.categoria?.nome ?? "Sem categoria"}</strong>
                        <span className={`fin-hist-selo ${tomDaVariacao(pct)}`}>{variacao(pct)}</span>
                      </div>
                      <small>média {brl(c.media)}, agora {brl(c.agora)}</small>
                    </div>
                  );
                })}
              </div>
            </section>
          ) : null}
        </>
      )}
    </div>
  );
}
