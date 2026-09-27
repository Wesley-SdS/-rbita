"use client";

import { dataCurta, iniciais } from "@orbita/core/finance/formato";
import { useFinancas } from "./contexto";
import { Etiqueta, Pastilha, Valor } from "./primitivos";
import type { LinhaDeConta } from "@/lib/financas/tipos";

/**
 * Linha de conta a pagar ou a receber (PRD §6.3.3), usada em Contas e no
 * "Previsto para o mês" do Extrato.
 */
export function LinhaConta({ c }: { c: LinhaDeConta }) {
  const f = useFinancas();
  const pagar = c.direcao === "pagar";
  const editar = () => f.abrir({ tipo: "compromisso", conta: c });
  const etiqueta = (() => {
    switch (c.situacao) {
      case "quitado":
        return <Etiqueta tom="entrada">{pagar ? "paga" : "recebido"}</Etiqueta>;
      case "vencido":
        return <Etiqueta tom="saida">{pagar ? "vencida" : "atrasado"}</Etiqueta>;
      case "perto":
        return <Etiqueta tom="alerta">{pagar ? "vence" : "recebe"} {dataCurta(c.vencimento)}</Etiqueta>;
      default:
        return <Etiqueta>{pagar ? "vence" : "recebe"} {dataCurta(c.vencimento)}</Etiqueta>;
    }
  })();
  return (
    <div className="fin-linha fin-linha-conta">
      <button type="button" className="fin-sem-estilo" onClick={editar} aria-label={`Editar ${c.descricao}`}>
        <Pastilha texto={c.categoria?.iniciais ?? iniciais(c.descricao)} cor={c.categoria?.cor} />
      </button>
      <button type="button" className="fin-sem-estilo fin-linha-corpo" onClick={editar}>
        <strong>{c.descricao}</strong>
        <span className="fin-etiquetas">
          {etiqueta}
          {c.fixa && <Etiqueta>fixa</Etiqueta>}
        </span>
      </button>
      <span className="fin-linha-direita">
        <Valor centavos={c.valor} natureza={pagar ? "despesa" : "receita"} />
        {c.situacao === "quitado" ? (
          <small>{c.quitadoEm ? dataCurta(c.quitadoEm) : ""}</small>
        ) : (
          <button type="button" className="button secondary mini" onClick={() => f.abrir({ tipo: "quitar", conta: c })}>
            {pagar ? "Pagar" : "Recebi"}
          </button>
        )}
      </span>
    </div>
  );
}
