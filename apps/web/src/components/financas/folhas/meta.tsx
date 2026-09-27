"use client";

import { useState } from "react";
import { MODELOS_DE_META, PALETA, itensDoModelo, type ModeloDeMeta } from "@orbita/core/finance/padroes";
import type { Meta } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Folha, Paleta } from "../primitivos";

type Modelo = "" | ModeloDeMeta;

/** Nova meta / Editar meta (PRD §7.11). Meta nova abre na hora. */
export function FolhaMeta({ meta, quantas = 0 }: { meta?: Pick<Meta, "id" | "nome" | "orcamento" | "descricao" | "cor">; quantas?: number }) {
  const f = useFinancas();
  const [nome, setNome] = useState(meta?.nome ?? "");
  const [orcamento, setOrcamento] = useState(meta?.orcamento ?? 0);
  const [descricao, setDescricao] = useState(meta?.descricao ?? "");
  const [cor, setCor] = useState<string>(meta?.cor ?? PALETA[quantas % PALETA.length]!);
  const [modelo, setModelo] = useState<Modelo>("");
  const nItens = modelo ? itensDoModelo(modelo).length : 0;

  async function salvar() {
    const r = await f.executar({ tipo: "salvar_meta", id: meta?.id ?? null, nome, orcamento, descricao: descricao.trim() || null, cor, modelo: modelo || null });
    if (r?.id && !meta) f.irPara("metas", { metaId: r.id });
  }

  async function apagar() {
    if (!window.confirm(`Apagar a meta ${meta!.nome}, seus itens e os lançamentos gerados por ela?`)) return;
    const r = await f.executar({ tipo: "apagar_meta", id: meta!.id });
    if (r) f.mudarUi({ metaAberta: null });
  }

  const chips: { id: Modelo; rotulo: string }[] = [
    { id: "", rotulo: "Em branco" },
    ...(Object.keys(MODELOS_DE_META) as ModeloDeMeta[]).map((k) => ({ id: k as Modelo, rotulo: MODELOS_DE_META[k].rotulo })),
  ];

  return (
    <Folha titulo={meta ? "Editar meta" : "Nova meta"} aoFechar={f.fechar}>
      <Campo rotulo="Nome da meta">
        <input type="text" placeholder="Reforma do apartamento" value={nome} maxLength={120} autoFocus={!meta} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <CampoDinheiro rotulo="Teto de orçamento" valor={orcamento} aoMudar={setOrcamento} />
      <Campo rotulo="Observação">
        <textarea placeholder="opcional" value={descricao} maxLength={2000} onChange={(e) => setDescricao(e.target.value)} />
      </Campo>
      {!meta && (
        <div className="field fin-campo">
          <span className="fin-rotulo">Começar de um modelo</span>
          <div className="fin-chips" role="group" aria-label="Começar de um modelo">
            {chips.map((c) => (
              <button key={c.id || "branco"} type="button" className={`fin-chip ${modelo === c.id ? "ativo" : ""}`} aria-pressed={modelo === c.id} onClick={() => setModelo(c.id)}>
                {c.rotulo}
              </button>
            ))}
          </div>
          {modelo && <small className="fin-dica">Entra com {nItens} itens zerados, agrupados por etapa. Você edita, apaga e acrescenta o que quiser.</small>}
        </div>
      )}
      <Paleta cores={PALETA} valor={cor} aoMudar={setCor} />
      <BotaoPrincipal onClick={() => void salvar()}>{meta ? "Salvar" : "Criar meta"}</BotaoPrincipal>
      {meta && <BotaoApagar onClick={() => void apagar()}>Apagar meta</BotaoApagar>}
    </Folha>
  );
}
