"use client";

import { useRef, useState } from "react";
import { dataCurta } from "@orbita/core/finance/formato";
import type { LinhaParaImportar } from "@orbita/core/finance/entradas";
import { lerExtrato } from "@/lib/financas/api";
import { juntarOnde, plural, separarOnde } from "@/lib/financas/apresentacao";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Caixa, Campo, Folha, SeletorOnde, Texto, Valor } from "../primitivos";

interface Linha extends LinhaParaImportar {
  marcada: boolean;
}

/**
 * Importar extrato do banco em CSV ou OFX (PRD §8.4). O arquivo é lido NO
 * NAVEGADOR (FileReader) e só o texto vai para o backend, que entende as
 * colunas, tira as duplicatas e dá o palpite de categoria de cada linha.
 */
export function FolhaImportar() {
  const f = useFinancas();
  const cad = f.cad;
  const [conteudo, setConteudo] = useState("");
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const [repetidas, setRepetidas] = useState(0);
  const [destino, setDestino] = useState(juntarOnde(cad?.contas[0]?.id, null));
  const [lembrar, setLembrar] = useState(true);
  const [ocupado, setOcupado] = useState(false);
  const arquivoRef = useRef<HTMLInputElement>(null);

  async function ler(texto: string) {
    if (!texto.trim()) return f.avisar("Não encontrei lançamentos nesse conteúdo.");
    setOcupado(true);
    const r = await lerExtrato(texto);
    setOcupado(false);
    if (!r.ok) {
      // tudo repetido não é erro: a folha fecha e avisa (§8.4)
      if (r.erro === "Tudo desse arquivo já estava lançado.") f.fechar();
      return f.avisar(r.erro);
    }
    setLinhas(r.dado.linhas.map((l) => ({ ...l, marcada: true })));
    setRepetidas(r.dado.repetidas);
  }

  function lerArquivo(arquivo: File) {
    const leitor = new FileReader();
    leitor.onload = () => void ler(String(leitor.result ?? ""));
    leitor.onerror = () => f.avisar("Não consegui ler esse arquivo.");
    leitor.readAsText(arquivo);
  }

  function mudar(i: number, patch: Partial<Linha>) {
    setLinhas((ls) => ls?.map((l, j) => (j === i ? { ...l, ...patch } : l)) ?? null);
  }

  async function importar() {
    const marcadas = (linhas ?? []).filter((l) => l.marcada);
    if (!marcadas.length) return f.avisar("Nada para importar.");
    const { contaId, cartaoId } = separarOnde(destino);
    await f.executar({
      tipo: "importar",
      linhas: marcadas.map(({ natureza, data, valor, descricao, categoriaId, regra }) => ({ natureza, data, valor, descricao, categoriaId, regra })),
      contaId,
      cartaoId,
      lembrar,
    });
  }

  if (linhas) {
    return (
      <Folha titulo="Revisar importação" aoFechar={f.fechar}>
        <Texto>
          {linhas.length} {plural(linhas.length, "lançamento novo", "lançamentos novos")}, {repetidas} {plural(repetidas, "já existia e ficou", "já existiam e ficaram")} de fora. Confira a categoria de cada um antes de importar.
        </Texto>
        <SeletorOnde rotulo="Tudo isso saiu ou entrou em" valor={destino} aoMudar={setDestino} contas={cad?.contas ?? []} cartoes={cad?.cartoes ?? []} />
        <div className="fin-importar-lista">
          {linhas.map((l, i) => (
            <div key={i} className="fin-importar-linha">
              <input type="checkbox" checked={l.marcada} aria-label={`Importar ${l.descricao}`} onChange={(e) => mudar(i, { marcada: e.target.checked })} />
              <span className="fin-linha-corpo">
                <strong>{l.descricao}</strong>
                <small>{dataCurta(l.data)} · {l.natureza === "despesa" ? "saída" : "entrada"}</small>
                <select className="inline-input compacto" aria-label="Categoria" value={l.categoriaId ?? ""} onChange={(e) => mudar(i, { categoriaId: e.target.value || null })}>
                  <option value="">Sem categoria</option>
                  {cad?.categorias.filter((c) => c.natureza === l.natureza).map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
                </select>
              </span>
              <Valor centavos={l.valor} natureza={l.natureza} />
            </div>
          ))}
        </div>
        <Caixa rotulo="Lembrar destas categorias para as próximas importações" marcado={lembrar} aoMudar={setLembrar} />
        <BotaoPrincipal onClick={() => void importar()}>Importar selecionados</BotaoPrincipal>
      </Folha>
    );
  }

  return (
    <Folha titulo="Importar extrato" aoFechar={f.fechar}>
      <Texto>Exporte o extrato do banco ou a fatura do cartão em CSV ou OFX e escolha o arquivo. O arquivo é lido aqui no navegador e só o texto dele vai para a sua Órbita.</Texto>
      <input
        ref={arquivoRef}
        type="file"
        accept=".csv,.ofx,.txt,text/csv,text/plain"
        hidden
        onChange={(e) => {
          const arq = e.target.files?.[0];
          if (arq) lerArquivo(arq);
          e.target.value = "";
        }}
      />
      <button type="button" className="button secondary full-width" onClick={() => arquivoRef.current?.click()} disabled={ocupado}>
        Escolher arquivo
      </button>
      <Campo rotulo="Ou cole o conteúdo aqui">
        <textarea placeholder="data;descrição;valor" value={conteudo} onChange={(e) => setConteudo(e.target.value)} />
      </Campo>
      <BotaoPrincipal onClick={() => void ler(conteudo)} disabled={ocupado}>Ler lançamentos</BotaoPrincipal>
    </Folha>
  );
}
