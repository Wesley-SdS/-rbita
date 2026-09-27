"use client";

import { useState } from "react";
import { PALETA } from "@orbita/core/finance/padroes";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { CartaoCadastro } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, Paleta, SeletorOnde } from "../primitivos";
import { corAleatoria } from "./cor";

const DIAS = Array.from({ length: 31 }, (_, i) => i + 1);

/** Novo cartão / Editar cartão (PRD §7.15). */
export function FolhaCartao({ cartao }: { cartao?: CartaoCadastro }) {
  const f = useFinancas();
  const cad = f.cad;
  const [nome, setNome] = useState(cartao?.nome ?? "");
  const [limite, setLimite] = useState(cartao?.limite ?? 0);
  const [fechamento, setFechamento] = useState(cartao?.fechamento ?? 1);
  const [vencimento, setVencimento] = useState(cartao?.vencimento ?? 10);
  const [paga, setPaga] = useState(juntarOnde(cartao?.contaPagamentoId ?? cad?.contas[0]?.id, null));
  const [cor, setCor] = useState(() => cartao?.cor ?? corAleatoria());

  return (
    <Folha titulo={cartao ? "Editar cartão" : "Novo cartão"} aoFechar={f.fechar}>
      <Campo rotulo="Nome do cartão">
        <input type="text" placeholder="Nubank, Itaú, Inter…" value={nome} maxLength={120} autoFocus={!cartao} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <CampoDinheiro rotulo="Limite" valor={limite} aoMudar={setLimite} />
      <Duas>
        <Campo rotulo="Fecha">
          <select value={fechamento} onChange={(e) => setFechamento(Number(e.target.value))}>
            {DIAS.map((d) => <option key={d} value={d}>dia {d}</option>)}
          </select>
        </Campo>
        <Campo rotulo="Vence">
          <select value={vencimento} onChange={(e) => setVencimento(Number(e.target.value))}>
            {DIAS.map((d) => <option key={d} value={d}>dia {d}</option>)}
          </select>
        </Campo>
      </Duas>
      <SeletorOnde rotulo="Fatura paga por" valor={paga} aoMudar={setPaga} contas={cad?.contas ?? []} cartoes={[]} soContas />
      <Paleta cores={PALETA} valor={cor} aoMudar={setCor} />
      <BotaoPrincipal
        onClick={() =>
          void f.executar({ tipo: "salvar_cartao", id: cartao?.id ?? null, nome, limite, fechamento, vencimento, contaPagamentoId: separarOnde(paga).contaId, cor })
        }
      >
        Salvar
      </BotaoPrincipal>
      {cartao && <BotaoApagar onClick={() => void f.executar({ tipo: "apagar_cartao", id: cartao.id })}>Apagar cartão</BotaoApagar>}
    </Folha>
  );
}
