"use client";

import { brl, iniciais } from "@orbita/core/finance/formato";
import { useRecurso } from "@/lib/dados/recurso";
import { useFinancas, useVista } from "./contexto";
import { Barra, Bloco, Carregando, Etiqueta, Indicador, Pastilha, Vazio } from "./primitivos";
import { plural, tomDaBarra } from "@/lib/financas/apresentacao";
import type { ItemDeMeta, Meta as TMeta, Metas as TMetas } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** Metas (PRD §6.5): a lista, ou a meta aberta quando há uma. */
export function Metas() {
  const f = useFinancas();
  return f.ui.metaAberta ? <MetaAberta id={f.ui.metaAberta} /> : <ListaDeMetas />;
}

function ListaDeMetas() {
  const f = useFinancas();
  const { dado, erro, recarregar } = useVista<TMetas>("metas");
  if (!dado) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;
  const metas = dado.itens;
  return (
    <div className="fin-pilha">
      <button type="button" className="button primary compacto fin-auto" onClick={() => f.abrir({ tipo: "meta", quantas: metas.length })}>
        + Nova meta
      </button>
      {metas.length === 0 ? (
        <Bloco>
          <Vazio
            titulo="Nenhuma meta ainda."
            texto="Uma meta é um projeto com teto próprio: a compra do apartamento, a reforma, a viagem. Você lista tudo que faz parte e o painel avisa quando a soma encosta no limite."
          />
        </Bloco>
      ) : (
        <div className="fin-grade-cartoes">
          {metas.map((m) => {
            const pct = m.orcamento > 0 ? (m.total / m.orcamento) * 100 : 0;
            const passou = m.orcamento > 0 && m.total > m.orcamento;
            return (
              <button key={m.id} type="button" className="panel fin-bloco fin-meta-cartao" onClick={() => f.mudarUi({ metaAberta: m.id })}>
                <span className="fin-cartao-topo">
                  <i className="fin-fita" style={{ background: m.cor }} />
                  <strong>{m.nome}</strong>
                  <small className="fin-dica">{m.itens} {plural(m.itens, "item", "itens")}</small>
                </span>
                <strong className={`fin-numero medio ${passou ? "fin-tom-saida" : ""}`}>{brl(m.total)}</strong>
                <small className="fin-dica">de um teto de {brl(m.orcamento)}</small>
                {m.orcamento > 0 && <Barra pct={pct} tom={tomDaBarra(pct, 85, 100.0001)} rotulo="Total sobre o teto" />}
                <span className="fin-nota">
                  {passou ? (
                    <span className="fin-tom-saida">Passou {brl(m.total - m.orcamento)} do teto.</span>
                  ) : m.orcamento > 0 ? (
                    `Cabem mais ${brl(m.orcamento - m.total)}.`
                  ) : (
                    "Sem teto definido."
                  )}{" "}
                  Já pago: {brl(m.jaPago)}.
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function MetaAberta({ id }: { id: string }) {
  const f = useFinancas();
  const { dado: m, erro, recarregar } = useVista<TMeta>("meta", { id });
  if (!m) {
    if (erro) {
      return (
        <div className="fin-pilha">
          <button type="button" className="button secondary compacto fin-auto" onClick={() => f.mudarUi({ metaAberta: null })}>‹ Todas as metas</button>
          <ErrorRetry message={erro} onRetry={recarregar} />
        </div>
      );
    }
    return <Carregando />;
  }
  const n = m.grupos.reduce((s, g) => s + g.itens.length, 0);
  const passou = m.orcamento > 0 && m.total > m.orcamento;
  const pct = m.orcamento > 0 ? (m.total / m.orcamento) * 100 : 0;
  return (
    <div className="fin-pilha">
      <div className="fin-botoes">
        <button type="button" className="button secondary compacto" onClick={() => f.mudarUi({ metaAberta: null })}>‹ Todas as metas</button>
        <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "meta", meta: m })}>Editar meta</button>
      </div>
      <Bloco className="fin-farol">
        <span className="fin-farol-rotulo">{m.nome}</span>
        <strong className={`fin-numero ${passou ? "fin-tom-saida" : ""}`}>{brl(m.total)}</strong>
        <p className="fin-farol-sub">somados os {n} {plural(n, "item", "itens")} da lista</p>
        {m.orcamento > 0 && (
          <>
            <Barra pct={pct} tom={tomDaBarra(pct, 85, 100.0001)} rotulo="Total sobre o teto" />
            <p className="fin-nota">
              {passou ? (
                <>Você passou <b>{brl(m.total - m.orcamento)}</b> do teto de {brl(m.orcamento)}. Corte ou aumente o teto.</>
              ) : (
                <>Ainda cabem <b>{brl(m.orcamento - m.total)}</b> dentro do teto de {brl(m.orcamento)}.</>
              )}
            </p>
          </>
        )}
        {m.descricao && <p className="fin-rodape">{m.descricao}</p>}
      </Bloco>
      <div className="fin-indicadores tres">
        <Indicador rotulo="Já pago" valor={m.jaPago} />
        <Indicador rotulo="Parcelas a vencer" valor={m.aVencer} tom={m.aVencer > 0 ? "saida" : null} />
        <Indicador rotulo="Ainda sem contratar" valor={m.semContratar} />
      </div>
      <button type="button" className="button primary compacto fin-auto" onClick={() => f.abrir({ tipo: "item", meta: m })}>
        + Adicionar item
      </button>
      {n === 0 ? (
        <Bloco>
          <Vazio titulo="Lista vazia." texto="Adicione os itens um a um, ou apague esta meta e crie outra a partir de um modelo pronto." />
        </Bloco>
      ) : (
        m.grupos.map((g) => (
          <Bloco key={g.grupo} titulo={g.grupo} direita={<span className="fin-valor">{brl(g.total)}</span>}>
            {g.itens.map((it) => <LinhaItem key={it.id} meta={m} item={it} />)}
          </Bloco>
        ))
      )}
    </div>
  );
}

const SITUACAO: Record<ItemDeMeta["status"], { texto: string; tom: "neutra" | "alerta" | "entrada" }> = {
  planejado: { texto: "Planejado", tom: "neutra" },
  orcado: { texto: "Orçado", tom: "alerta" },
  contratado: { texto: "Contratado", tom: "alerta" },
  pago: { texto: "Pago", tom: "entrada" },
};

function LinhaItem({ meta, item }: { meta: TMeta; item: ItemDeMeta }) {
  const f = useFinancas();
  const s = SITUACAO[item.status];
  const temPagamento = item.status === "contratado" || item.status === "pago";
  const forma = item.parcelas > 1
    ? `${item.parcelas}x de ${brl(Math.floor(item.valor / item.parcelas))} no ${item.formaTexto}`
    : `à vista no ${item.formaTexto}`;
  return (
    <button type="button" className="fin-linha" onClick={() => f.abrir({ tipo: "item", meta, item })}>
      <Miniatura item={item} cor={meta.cor} />
      <span className="fin-linha-corpo">
        <strong>{item.nome}</strong>
        <span className="fin-etiquetas">
          <Etiqueta tom={s.tom}>{s.texto}</Etiqueta>
          {temPagamento && item.valor > 0 && <small>{forma}</small>}
          {item.fotos > 1 && <Etiqueta>{item.fotos} fotos</Etiqueta>}
        </span>
      </span>
      {item.valor > 0 ? <span className="fin-valor">{brl(item.valor)}</span> : <span className="fin-dica">definir</span>}
    </button>
  );
}

/**
 * A primeira foto do item, buscada só quando ele TEM foto: a foto mora fora do
 * painel (pesa mais que o financeiro inteiro) e vem sob demanda.
 */
function Miniatura({ item, cor }: { item: ItemDeMeta; cor: string }) {
  const { dado } = useRecurso<{ fotos: { id: string; dado: string }[] }>(item.fotos > 0 ? `/api/financas/fotos?item=${item.id}` : null, { estavel: true });
  return <Pastilha texto={iniciais(item.nome)} cor={cor} foto={dado?.fotos[0]?.dado ?? null} />;
}
