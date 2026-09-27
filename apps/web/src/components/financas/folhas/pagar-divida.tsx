"use client";

import { useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { Divida } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, SeletorOnde, Texto } from "../primitivos";

/** Registrar pagamento de dívida (PRD §7.10). */
export function FolhaPagarDivida({ divida }: { divida: Divida }) {
  const f = useFinancas();
  const cad = f.cad;
  const [valor, setValor] = useState(divida.parcelaMensal);
  const [data, setData] = useState(f.hoje);
  const [onde, setOnde] = useState(juntarOnde(divida.contaId ?? cad?.contas[0]?.id, null));
  const [juros, setJuros] = useState(divida.jurosDoMes);

  async function registrar() {
    if (valor <= 0) return f.avisar("Informe o valor pago.");
    // juros maiores que o pagamento ficam iguais a ele (§7.10)
    await f.executar({ tipo: "pagar_divida", id: divida.id, valor, juros: Math.min(juros, valor), data, contaId: separarOnde(onde).contaId });
  }

  return (
    <Folha titulo={`Pagamento · ${divida.nome}`} aoFechar={f.fechar}>
      <Texto>
        Saldo devedor: <b>{brl(divida.saldo)}</b>.{divida.jurosDoMes > 0 ? <> Juros deste mês: <b>{brl(divida.jurosDoMes)}</b>.</> : null}
      </Texto>
      <CampoDinheiro rotulo="Valor pago" valor={valor} aoMudar={setValor} grande autoFocus />
      <Duas>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <SeletorOnde rotulo="Saiu de" valor={onde} aoMudar={setOnde} contas={cad?.contas ?? []} cartoes={[]} soContas />
      </Duas>
      <CampoDinheiro rotulo="Quanto disso foi juros" valor={juros} aoMudar={setJuros} />
      <Texto>O que não for juros abate o saldo devedor. O pagamento entra no extrato como saída da conta.</Texto>
      <BotaoPrincipal onClick={() => void registrar()}>Registrar pagamento</BotaoPrincipal>
    </Folha>
  );
}
