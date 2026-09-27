"use client";

import { useEffect, useRef, useState } from "react";
import { mesDe } from "@orbita/core/finance/calendario";
import { useRecurso } from "@/lib/dados/recurso";
import { urlDaVista } from "@/lib/financas/api";
import { juntarOnde, separarOnde } from "@/lib/financas/apresentacao";
import type { Extrato, LinhaDeLancamento } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, SeletorOnde, Texto } from "../primitivos";

/**
 * Transferência entre contas (PRD §7.3). Na edição, a perna tocada diz só um
 * lado; o outro vem do extrato do mesmo mês (as duas pernas têm a mesma data
 * e o mesmo grupo).
 */
export function FolhaTransferencia({ perna }: { perna?: LinhaDeLancamento }) {
  const f = useFinancas();
  const cad = f.cad;
  const contas = cad?.contas ?? [];
  const grupo = perna?.grupoTransferencia ?? null;
  const { dado: ext } = useRecurso<Extrato>(grupo ? urlDaVista("extrato", { mes: mesDe(perna!.data) }) : null);
  const pernas = ext?.dias.flatMap((d) => d.itens).filter((l) => l.grupoTransferencia === grupo) ?? [];
  const saida = pernas.find((l) => l.natureza === "despesa");
  const entrada = pernas.find((l) => l.natureza === "receita");

  const [valor, setValor] = useState(perna?.valor ?? 0);
  const [origem, setOrigem] = useState(juntarOnde(perna?.natureza === "despesa" ? perna.contaId : contas[0]?.id, null));
  const [destino, setDestino] = useState(juntarOnde(perna?.natureza === "receita" ? perna.contaId : (contas[1] ?? contas[0])?.id, null));
  const [data, setData] = useState(perna?.data ?? f.hoje);
  const [descricao, setDescricao] = useState(perna ? (perna.descricao ?? "") : "Transferência");
  const valorRef = useRef<HTMLInputElement>(null);

  const achou = `${saida?.id ?? ""}|${entrada?.id ?? ""}`;
  useEffect(() => {
    if (saida?.contaId) setOrigem(juntarOnde(saida.contaId, null));
    if (entrada?.contaId) setDestino(juntarOnde(entrada.contaId, null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [achou]);

  async function salvar() {
    if (valor <= 0) {
      valorRef.current?.focus();
      return f.avisar("Informe o valor.");
    }
    if (!origem || origem === destino) return f.avisar("Escolha duas contas diferentes.");
    await f.executar({
      tipo: "transferir", grupo, valor, data, descricao: descricao.trim() || "Transferência",
      origemId: separarOnde(origem).contaId, destinoId: separarOnde(destino).contaId,
    });
  }

  async function apagar() {
    if (!grupo || !window.confirm("Apagar esta transferência dos dois lados?")) return;
    await f.executar({ tipo: "apagar_transferencia", grupo });
  }

  return (
    <Folha titulo={grupo ? "Editar transferência" : "Transferência entre contas"} aoFechar={f.fechar}>
      <Texto>Dinheiro que muda de lugar, não some. Serve para saque, transferência entre suas contas e Pix para você mesmo. Não conta como gasto.</Texto>
      <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} grande autoFocus entrada={valorRef} />
      <Duas>
        <SeletorOnde rotulo="Sai de" valor={origem} aoMudar={setOrigem} contas={contas} cartoes={[]} soContas />
        <SeletorOnde rotulo="Entra em" valor={destino} aoMudar={setDestino} contas={contas} cartoes={[]} soContas />
      </Duas>
      <Duas>
        <Campo rotulo="Data">
          <input type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </Campo>
        <Campo rotulo="Descrição">
          <input type="text" placeholder="Saque, reserva…" value={descricao} maxLength={200} onChange={(e) => setDescricao(e.target.value)} />
        </Campo>
      </Duas>
      <BotaoPrincipal onClick={() => void salvar()}>{grupo ? "Salvar" : "Registrar"}</BotaoPrincipal>
      {grupo && <BotaoApagar onClick={() => void apagar()}>Apagar transferência</BotaoApagar>}
    </Folha>
  );
}
