"use client";

import { useState } from "react";
import { jurosDoTexto, textoDosJuros } from "@/lib/financas/dinheiro";
import type { Divida } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, Texto } from "../primitivos";

const TIPOS: { id: Divida["natureza"]; rotulo: string }[] = [
  { id: "emprestimo", rotulo: "Empréstimo" },
  { id: "cartao-rotativo", rotulo: "Rotativo do cartão" },
  { id: "cheque-especial", rotulo: "Cheque especial" },
  { id: "crediario", rotulo: "Crediário ou carnê" },
  { id: "outro", rotulo: "Outra" },
];

/** Nova dívida / Editar dívida (PRD §7.9). */
export function FolhaDivida({ divida }: { divida?: Divida }) {
  const f = useFinancas();
  const [nome, setNome] = useState(divida?.nome ?? "");
  const [natureza, setNatureza] = useState<Divida["natureza"]>(divida?.natureza ?? "emprestimo");
  const [saldo, setSaldo] = useState(divida?.saldoInicial ?? 0);
  const [juros, setJuros] = useState(textoDosJuros(divida?.jurosMes ?? 0));
  const [parcela, setParcela] = useState(divida?.parcelaMensal ?? 0);

  async function salvar() {
    const jurosMes = jurosDoTexto(juros);
    if (jurosMes === null) return f.avisar("Escreva os juros como número, por exemplo 2,5.");
    await f.executar({ tipo: "salvar_divida", id: divida?.id ?? null, nome, natureza, saldo, jurosMes, parcelaMensal: parcela, contaId: divida?.contaId ?? null });
  }

  async function apagar() {
    if (!window.confirm("Apagar esta dívida e seu histórico de pagamentos?")) return;
    await f.executar({ tipo: "apagar_divida", id: divida!.id });
  }

  return (
    <Folha titulo={divida ? "Editar dívida" : "Nova dívida"} aoFechar={f.fechar}>
      <Campo rotulo="Nome">
        <input type="text" placeholder="Empréstimo Caixa, rotativo Nubank…" value={nome} maxLength={120} autoFocus={!divida} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <Campo rotulo="Tipo">
        <select value={natureza} onChange={(e) => setNatureza(e.target.value as Divida["natureza"])}>
          {TIPOS.map((t) => <option key={t.id} value={t.id}>{t.rotulo}</option>)}
        </select>
      </Campo>
      <CampoDinheiro rotulo="Saldo devedor hoje" valor={saldo} aoMudar={setSaldo} />
      <Duas>
        <Campo rotulo="Juros ao mês (%)">
          <input type="text" inputMode="decimal" placeholder="0,0" value={juros} maxLength={8} onChange={(e) => setJuros(e.target.value)} />
        </Campo>
        <CampoDinheiro rotulo="Parcela mensal" valor={parcela} aoMudar={setParcela} />
      </Duas>
      <Texto>Com juros e parcela preenchidos, o painel calcula em quantos meses isso acaba e quanto você vai pagar de juros no caminho.</Texto>
      <BotaoPrincipal onClick={() => void salvar()}>Salvar</BotaoPrincipal>
      {divida && <BotaoApagar onClick={() => void apagar()}>Apagar dívida</BotaoApagar>}
    </Folha>
  );
}
