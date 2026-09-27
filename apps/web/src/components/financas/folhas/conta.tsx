"use client";

import { useState } from "react";
import type { ContaCarteira } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Caixa, Campo, CampoDinheiro, Folha, Texto } from "../primitivos";
import { corAleatoria } from "./cor";

/** Nova conta / Editar conta, a carteira (PRD §7.14). Apagar sem confirmação, como no PRD. */
export function FolhaConta({ conta }: { conta?: ContaCarteira }) {
  const f = useFinancas();
  const [nome, setNome] = useState(conta?.nome ?? "");
  const [saldo, setSaldo] = useState(Math.abs(conta?.saldoInicial ?? 0));
  // a máscara só digita número positivo; o cheque especial de quem já começa
  // no vermelho precisa de um jeito de dizer isso
  const [negativo, setNegativo] = useState((conta?.saldoInicial ?? 0) < 0);

  return (
    <Folha titulo={conta ? "Editar conta" : "Nova conta"} aoFechar={f.fechar}>
      <Campo rotulo="Nome">
        <input type="text" placeholder="Nubank, Caixa, Dinheiro…" value={nome} maxLength={120} autoFocus={!conta} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <CampoDinheiro rotulo="Saldo de hoje" valor={saldo} aoMudar={setSaldo} />
      <Caixa rotulo="Está no negativo" marcado={negativo} aoMudar={setNegativo} />
      <Texto>Este é o ponto de partida. Os lançamentos somam e subtraem daqui.</Texto>
      <BotaoPrincipal
        onClick={() => void f.executar({ tipo: "salvar_conta", id: conta?.id ?? null, nome, saldoInicial: negativo ? -saldo : saldo, cor: conta?.cor ?? corAleatoria() })}
      >
        Salvar
      </BotaoPrincipal>
      {conta && <BotaoApagar onClick={() => void f.executar({ tipo: "apagar_conta", id: conta.id })}>Apagar conta</BotaoApagar>}
    </Folha>
  );
}
