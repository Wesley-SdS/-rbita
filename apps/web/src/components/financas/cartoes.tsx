"use client";

import { brl, dataCurta, dataLonga } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { Barra, Bloco, Carregando, LinhaLancamento, Vazio } from "./primitivos";
import { nDias, plural, tomDaBarra } from "@/lib/financas/apresentacao";
import type { Cartoes as TCartoes } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** Cartões de crédito com a fatura aberta de cada um (PRD §6.4). */
export function Cartoes() {
  const f = useFinancas();
  const { dado, erro, recarregar } = useVista<TCartoes>("cartoes");
  if (!dado) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;
  const cartoes = dado.itens;

  return (
    <div className="fin-pilha">
      <button type="button" className="button primary compacto fin-auto" onClick={() => f.abrir({ tipo: "cartao" })}>
        + Cadastrar cartão
      </button>
      {cartoes.length === 0 ? (
        <Bloco>
          <Vazio titulo="Nenhum cartão cadastrado." texto="Cadastre seus cartões com dia de fechamento e vencimento: as compras entram na fatura certa automaticamente." />
        </Bloco>
      ) : (
        <div className="fin-grade-cartoes">
          {cartoes.map((c) => {
            const fat = c.fatura;
            const numero = fat.pago > 0 ? fat.restante : fat.total;
            const usoPct = c.limite > 0 ? (c.usado / c.limite) * 100 : 0;
            const cadastro = f.cad?.cartoes.find((x) => x.id === c.id);
            return (
              <Bloco key={c.id} className="fin-cartao">
                <header className="fin-cartao-topo">
                  <i className="fin-fita" style={{ background: c.cor }} />
                  <strong>{c.nome}</strong>
                  <button type="button" className="fin-link" onClick={() => cadastro && f.abrir({ tipo: "cartao", cartao: cadastro })} disabled={!cadastro}>
                    editar
                  </button>
                </header>
                <span className="fin-farol-rotulo">Fatura que fecha em {dataCurta(fat.fechamento)}</span>
                <strong className="fin-numero medio">{brl(numero)}</strong>
                {fat.pago > 0 && fat.restante > 0 && <small className="fin-dica">total {brl(fat.total)}, já pago {brl(fat.pago)}</small>}
                <p className="fin-nota">
                  {fat.diasParaVencer >= 0 ? (
                    <>Vence {dataLonga(fat.vencimento)}, em {nDias(fat.diasParaVencer)}</>
                  ) : (
                    <>Vence {dataLonga(fat.vencimento)}. <b className="fin-tom-saida">Vencida há {nDias(-fat.diasParaVencer)}</b></>
                  )}
                </p>
                {c.limite > 0 && (
                  <>
                    <Barra pct={usoPct} tom={tomDaBarra(usoPct, 70, 90)} rotulo="Limite usado" />
                    <small className="fin-dica">{brl(c.usado)} usados de {brl(c.limite)} · {brl(c.livre)} livres</small>
                  </>
                )}
                <div className="fin-botoes">
                  <button
                    type="button"
                    className="button secondary compacto"
                    onClick={() => (c.abertas.length ? f.abrir({ tipo: "fatura", cartao: c }) : f.avisar("Nenhuma fatura em aberto neste cartão."))}
                  >
                    Pagar fatura
                  </button>
                  <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "lancamento", cartaoId: c.id })}>
                    Lançar compra
                  </button>
                </div>
                <div className="fin-compras">
                  {c.compras.length === 0 ? (
                    <Vazio titulo="Fatura vazia." texto="Nenhuma compra neste ciclo." />
                  ) : (
                    <>
                      {c.compras.map((l) => <LinhaLancamento key={l.id} l={l} onClick={() => f.abrirLancamento(l)} />)}
                      {c.comprasAMais > 0 && (
                        <small className="fin-dica">+ {c.comprasAMais} {plural(c.comprasAMais, "compra", "compras")} a mais, veja no extrato</small>
                      )}
                    </>
                  )}
                </div>
              </Bloco>
            );
          })}
        </div>
      )}
    </div>
  );
}
