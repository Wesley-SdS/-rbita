"use client";

import { useState } from "react";
import { brl, dataCurta } from "@orbita/core/finance/formato";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { Cartao } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { Alternador, BotaoPrincipal, Campo, CampoDinheiro, Duas, Faixa, Folha, SeletorOnde, Texto } from "../primitivos";

type Resto = "rotativo" | "depois";

/** Pagar fatura, inclusive parcial com rotativo (PRD §7.8). */
export function FolhaFatura({ cartao }: { cartao: Cartao }) {
  const f = useFinancas();
  const cad = f.cad;
  const abertas = cartao.abertas;
  const [fechamento, setFechamento] = useState(abertas[0]?.fechamento ?? "");
  const fatura = abertas.find((x) => x.fechamento === fechamento) ?? null;
  const [valor, setValor] = useState(fatura?.restante ?? 0);
  const [data, setData] = useState(f.hoje);
  const [onde, setOnde] = useState(juntarOnde(cartao.contaPagamentoId ?? cad?.contas[0]?.id, null));
  const [resto, setResto] = useState<Resto>("rotativo");
  const falta = fatura && valor > 0 && valor < fatura.restante ? fatura.restante - valor : 0;

  function escolher(fech: string) {
    setFechamento(fech);
    // trocar de fatura preenche de novo com o que falta nela
    setValor(abertas.find((x) => x.fechamento === fech)?.restante ?? 0);
  }

  async function confirmar() {
    if (!fatura) return f.avisar("Escolha a fatura.");
    if (valor <= 0) return f.avisar("Informe o valor pago.");
    await f.executar({ tipo: "pagar_fatura", cartaoId: cartao.id, fechamento, valor, data, contaId: separarOnde(onde).contaId, resto });
  }

  return (
    <Folha titulo={`Pagar fatura · ${cartao.nome}`} aoFechar={f.fechar}>
      <Campo rotulo="Fatura">
        <select value={fechamento} onChange={(e) => escolher(e.target.value)}>
          {abertas.map((x) => (
            <option key={x.fechamento} value={x.fechamento}>
              fecha {dataCurta(x.fechamento)} · vence {dataCurta(x.vencimento)} · falta {brl(x.restante)}
            </option>
          ))}
        </select>
      </Campo>
      {fatura && <p className="fin-dica">Total {brl(fatura.total)}, já pago {brl(fatura.pago)}, falta {brl(fatura.restante)}.</p>}
      <CampoDinheiro rotulo="Valor pago" valor={valor} aoMudar={setValor} grande autoFocus />
      <Duas>
        <Campo rotulo="Data do pagamento">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <SeletorOnde rotulo="Saiu de" valor={onde} aoMudar={setOnde} contas={cad?.contas ?? []} cartoes={[]} soContas />
      </Duas>
      {falta > 0 && (
        <div className="fin-pilha curta">
          <Faixa tom="perto" icone="info">Faltam <b>{brl(falta)}</b> desta fatura.</Faixa>
          <Alternador<Resto>
            rotulo="O que fazer com o resto"
            valor={resto}
            aoMudar={setResto}
            opcoes={[{ id: "rotativo", rotulo: "Resto vira rotativo" }, { id: "depois", rotulo: "Pago o resto depois" }]}
          />
          <p className="fin-dica">
            {resto === "rotativo"
              ? "O que faltou entra como dívida de rotativo do cartão, rendendo juros até você quitar. A fatura fica fechada."
              : `A fatura continua em aberto com ${brl(falta)}. Nada vira dívida agora.`}
          </p>
        </div>
      )}
      <Texto>O pagamento sai do saldo da conta, mas não conta como gasto novo: as compras já foram contadas quando aconteceram.</Texto>
      <BotaoPrincipal onClick={() => void confirmar()}>Confirmar pagamento</BotaoPrincipal>
    </Folha>
  );
}
