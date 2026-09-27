"use client";

import { useState } from "react";
import { dataLonga } from "@orbita/core/finance/formato";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { LinhaDeConta } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, SeletorOnde, Texto } from "../primitivos";

/** Registrar pagamento / recebimento de uma conta (PRD §7.7). */
export function FolhaQuitar({ conta }: { conta: LinhaDeConta }) {
  const f = useFinancas();
  const cad = f.cad;
  const pagar = conta.direcao === "pagar";
  const [valor, setValor] = useState(conta.valor);
  const [data, setData] = useState(f.hoje);
  const [onde, setOnde] = useState(juntarOnde(conta.contaId ?? cad?.contas[0]?.id, null));

  async function confirmar() {
    const { contaId, cartaoId } = separarOnde(onde);
    await f.executar({ tipo: "quitar", id: conta.id, valor, data, contaId, cartaoId });
  }

  return (
    <Folha titulo={pagar ? "Registrar pagamento" : "Registrar recebimento"} aoFechar={f.fechar}>
      <Texto>{conta.descricao}, vencimento {dataLonga(conta.vencimento)}</Texto>
      <CampoDinheiro rotulo={pagar ? "Valor pago" : "Valor recebido"} valor={valor} aoMudar={setValor} grande autoFocus />
      <Duas>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <SeletorOnde rotulo={pagar ? "Saiu de" : "Entrou em"} valor={onde} aoMudar={setOnde} contas={cad?.contas ?? []} cartoes={pagar ? (cad?.cartoes ?? []) : []} />
      </Duas>
      <BotaoPrincipal onClick={() => void confirmar()}>Confirmar</BotaoPrincipal>
    </Folha>
  );
}
