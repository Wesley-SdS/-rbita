"use client";

import { useEffect, useRef, useState } from "react";
import { brl, dataLonga, diaDaSemana, mesLongo } from "@orbita/core/finance/formato";
import { useFinancas, useVista, type FiltrosExtrato } from "./contexto";
import { Bloco, Carregando, LinhaLancamento, Vazio } from "./primitivos";
import { LinhaConta } from "./linha-conta";
import { DocumentosDaFila } from "./documentos-fila";
import { plural } from "@/lib/financas/apresentacao";
import type { Extrato as TExtrato } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";
import { Icone } from "@/components/presenca/icones";

/** Espera da busca enquanto digita (§6.2.1): filtra sem uma requisição por tecla. */
const ESPERA_DA_BUSCA_MS = 260;

export function Extrato() {
  const f = useFinancas();
  const filtros = f.ui.filtros;
  const mudar = (patch: Partial<FiltrosExtrato>) => f.mudarUi({ filtros: { ...filtros, ...patch } });

  // O texto do campo é local e só vai para o filtro depois da pausa. O campo
  // não é remontado, então o cursor e o foco ficam onde estavam.
  const [busca, setBusca] = useState(filtros.q);
  const mudarRef = useRef(mudar);
  mudarRef.current = mudar;
  useEffect(() => {
    if (busca === filtros.q) return;
    const t = setTimeout(() => mudarRef.current({ q: busca }), ESPERA_DA_BUSCA_MS);
    return () => clearTimeout(t);
  }, [busca, filtros.q]);

  const { dado: e, erro, recarregar } = useVista<TExtrato>("extrato", {
    mes: f.ui.mes,
    q: filtros.q.trim() || null,
    natureza: filtros.natureza || null,
    categoria: filtros.categoria || null,
    onde: filtros.onde || null,
  });
  const cad = f.cad;
  // o PDF sai com o MESMO mês e os mesmos filtros da tela: quem baixa leva o que está vendo
  const linkDoPdf = (() => {
    const q = new URLSearchParams({ formato: "pdf", mes: f.mes });
    if (filtros.q.trim()) q.set("q", filtros.q.trim());
    if (filtros.natureza) q.set("natureza", filtros.natureza);
    if (filtros.categoria) q.set("categoria", filtros.categoria);
    if (filtros.onde) q.set("onde", filtros.onde);
    return `/api/financas/exportar?${q.toString()}`;
  })();

  return (
    <div className="fin-pilha">
      <Bloco>
        <div className="fin-filtros">
          <input
            className="inline-input"
            type="search"
            placeholder="Buscar por descrição ou categoria"
            aria-label="Buscar por descrição ou categoria"
            value={busca}
            onChange={(ev) => setBusca(ev.target.value)}
          />
          <select className="inline-input" aria-label="Tipo" value={filtros.natureza} onChange={(ev) => mudar({ natureza: ev.target.value as FiltrosExtrato["natureza"] })}>
            <option value="">Tudo</option>
            <option value="despesa">Só saídas</option>
            <option value="receita">Só entradas</option>
          </select>
          <select className="inline-input" aria-label="Categoria" value={filtros.categoria} onChange={(ev) => mudar({ categoria: ev.target.value })}>
            <option value="">Todas as categorias</option>
            {cad?.categorias.map((c) => <option key={c.id} value={c.id}>{c.nome}{c.natureza === "receita" ? " (entrada)" : ""}</option>)}
          </select>
          <select className="inline-input" aria-label="Onde" value={filtros.onde} onChange={(ev) => mudar({ onde: ev.target.value })}>
            <option value="">Todas as contas e cartões</option>
            {cad?.contas.map((c) => <option key={c.id} value={`conta:${c.id}`}>{c.nome}</option>)}
            {cad?.cartoes.map((c) => <option key={c.id} value={`cartao:${c.id}`}>Cartão {c.nome}</option>)}
          </select>
        </div>
        {e && (
          <div className="fin-resumo">
            <a className="button secondary compacto fin-resumo-pdf" href={linkDoPdf} download={`extrato-${f.mes}.pdf`}>
              <Icone nome="download" />
              Baixar PDF
            </a>
            <p>
              <span>{e.resumo.n} {plural(e.resumo.n, "lançado", "lançados")}</span>
              <span className="fin-tom-saida">saídas {brl(e.resumo.saidas)}</span>
              <span className="fin-tom-entrada">entradas {brl(e.resumo.entradas)}</span>
            </p>
            {e.resumo.previstos > 0 && (
              <p>
                <span>{e.resumo.previstos} {plural(e.resumo.previstos, "previsto", "previstos")}</span>
                <span>a pagar {brl(e.resumo.aPagar)}</span>
                <span>a receber {brl(e.resumo.aReceber)}</span>
              </p>
            )}
          </div>
        )}
      </Bloco>

      {!e ? (
        erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />
      ) : (
        <>
          {e.previstos.length > 0 && (
            <Bloco titulo={`Previsto para ${mesLongo(f.mes)}`} direita={<small className="fin-dica">ainda não aconteceu</small>}>
              {e.previstos.map((c) => <LinhaConta key={c.id} c={c} />)}
            </Bloco>
          )}
          <Bloco titulo="Já lançado">
            {e.dias.length === 0 ? (
              e.previstos.length > 0 ? (
                <Vazio titulo="Nada lançado ainda neste mês." texto="As contas acima são previsões. Quando você pagar ou receber, toque no botão e elas viram lançamento aqui." />
              ) : (
                <Vazio titulo={`Nenhum lançamento em ${mesLongo(f.mes)} com esses filtros.`} />
              )
            ) : (
              e.dias.map((d) => (
                <div key={d.data} className="fin-dia">
                  <div className="fin-dia-topo">
                    <span>{diaDaSemana(d.data)}, {dataLonga(d.data)}</span>
                    {d.totalSaidas > 0 && <span className="fin-tom-saida">− {brl(d.totalSaidas)}</span>}
                  </div>
                  {d.itens.map((l) => <LinhaLancamento key={l.id} l={l} onClick={() => f.abrirLancamento(l)} />)}
                </div>
              ))
            )}
          </Bloco>
        </>
      )}

      <Bloco titulo="Trazer do papel">
        <DocumentosDaFila />
      </Bloco>
    </div>
  );
}
