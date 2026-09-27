"use client";

import { useState } from "react";
import type { LinhaDeConta } from "@/lib/financas/tipos";
import { useFinancas, type Preenchimento } from "../contexto";
import {
  Alternador, BotaoApagar, BotaoPrincipal, Caixa, Campo, CampoDinheiro, Duas, Folha, SeletorCategoria, primeiraCategoria,
} from "../primitivos";

type Direcao = "pagar" | "receber";

/**
 * Nova conta / Editar conta a pagar ou a receber (PRD §7.6). Também abre
 * preenchida depois de ler um boleto. Conta quitada ganha "Desfazer
 * pagamento" (ponto de atenção 4): volta para em aberto e o lançamento gerado
 * some.
 */
export function FolhaCompromisso({ conta, preenchido }: { conta?: LinhaDeConta; preenchido?: Preenchimento }) {
  const f = useFinancas();
  const cad = f.cad;
  const base = conta ?? preenchido;
  const [direcao, setDirecao] = useState<Direcao>(base?.direcao ?? "pagar");
  const [descricao, setDescricao] = useState(base?.descricao ?? "");
  const [valor, setValor] = useState(base?.valor ?? 0);
  const [vencimento, setVencimento] = useState(base?.vencimento ?? f.hoje);
  const [categoriaId, setCategoriaId] = useState(conta ? (conta.categoriaId ?? "") : (preenchido?.categoriaId ?? primeiraCategoria(cad?.categorias, "despesa")));
  const [recorrente, setRecorrente] = useState(conta?.fixa ?? false);

  function trocar(d: Direcao) {
    setDirecao(d);
    setCategoriaId(primeiraCategoria(cad?.categorias, d === "pagar" ? "despesa" : "receita"));
  }

  async function salvar() {
    await f.executar({
      tipo: "salvar_compromisso", id: conta?.id ?? null, direcao, descricao, valor, vencimento,
      categoriaId: categoriaId || null, contaId: conta?.contaId ?? null, recorrente,
    });
  }

  async function apagar() {
    if (!window.confirm("Apagar esta conta?")) return;
    await f.executar({ tipo: "apagar_compromisso", id: conta!.id });
  }

  async function desfazerPagamento() {
    await f.executar({ tipo: "desquitar", id: conta!.id });
  }

  return (
    <Folha titulo={conta ? "Editar conta" : "Nova conta"} aoFechar={f.fechar}>
      <Alternador<Direcao>
        rotulo="Direção"
        valor={direcao}
        aoMudar={trocar}
        opcoes={[{ id: "pagar", rotulo: "A pagar", tom: "saida" }, { id: "receber", rotulo: "A receber", tom: "entrada" }]}
      />
      <Campo rotulo="Descrição">
        <input type="text" placeholder="Aluguel, internet, fatura…" value={descricao} maxLength={120} autoFocus={!conta} onChange={(e) => setDescricao(e.target.value)} />
      </Campo>
      <Duas>
        <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
        <Campo rotulo="Vencimento">
          <input type="date" value={vencimento} onChange={(e) => setVencimento(e.target.value)} />
        </Campo>
      </Duas>
      <SeletorCategoria valor={categoriaId} aoMudar={setCategoriaId} categorias={cad?.categorias ?? []} natureza={direcao === "pagar" ? "despesa" : "receita"} />
      <Caixa rotulo="Repete todo mês" marcado={recorrente} aoMudar={setRecorrente} />
      <BotaoPrincipal onClick={() => void salvar()}>{conta ? "Salvar" : "Cadastrar"}</BotaoPrincipal>
      {conta?.situacao === "quitado" && (
        <button type="button" className="button secondary full-width" onClick={() => void desfazerPagamento()}>
          Desfazer pagamento
        </button>
      )}
      {conta && <BotaoApagar onClick={() => void apagar()}>Apagar</BotaoApagar>}
    </Folha>
  );
}
