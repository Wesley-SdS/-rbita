"use client";

import { useId, useRef, useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { enviarComando } from "@/lib/financas/api";
import { excessoDoTeto, juntarOnde, plural, separarOnde } from "@/lib/financas/apresentacao";
import { QUALIDADE_JPEG, dimensoesReduzidas, escolherFotos } from "@/lib/financas/foto";
import type { ItemDeMeta, Meta } from "@/lib/financas/tipos";
import { useFinancas } from "../contexto";
import { BotaoApagar, BotaoPrincipal, Campo, CampoDinheiro, Duas, Folha, SeletorOnde, Texto } from "../primitivos";
import { Icone } from "@/components/presenca/icones";

type Status = ItemDeMeta["status"];
type Forma = ItemDeMeta["forma"];

const SITUACOES: { id: Status; rotulo: string }[] = [
  { id: "planejado", rotulo: "Planejado" },
  { id: "orcado", rotulo: "Orçado" },
  { id: "contratado", rotulo: "Contratado" },
  { id: "pago", rotulo: "Pago" },
];

const FORMAS: { id: Forma; rotulo: string }[] = [
  { id: "avista", rotulo: "À vista (conta ou Pix)" },
  { id: "cartao", rotulo: "Cartão de crédito" },
  { id: "boleto", rotulo: "Boleto" },
  { id: "carne", rotulo: "Carnê" },
];

/**
 * Reduz a foto no navegador (900 px no lado maior, JPEG 0,62): uma foto de
 * celular tem megabytes e a galeria só precisa reconhecê-la.
 */
async function reduzir(arquivo: File): Promise<string> {
  const bitmap = await createImageBitmap(arquivo);
  try {
    const { largura, altura } = dimensoesReduzidas(bitmap.width, bitmap.height);
    const canvas = document.createElement("canvas");
    canvas.width = largura;
    canvas.height = altura;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("Sem canvas.");
    ctx.drawImage(bitmap, 0, 0, largura, altura);
    return canvas.toDataURL("image/jpeg", QUALIDADE_JPEG);
  } finally {
    bitmap.close();
  }
}

/** Novo item / Editar item de meta, com as fotos de referência (PRD §7.12). */
export function FolhaItem({ meta, item }: { meta: Meta; item?: ItemDeMeta }) {
  const f = useFinancas();
  const cad = f.cad;
  const listaEtapas = useId();
  const [nome, setNome] = useState(item?.nome ?? "");
  const [valor, setValor] = useState(item?.valor ?? 0);
  const [grupo, setGrupo] = useState(item?.grupo ?? meta.etapas[0] ?? "");
  const [status, setStatus] = useState<Status>(item?.status ?? "planejado");
  const [forma, setForma] = useState<Forma>(item?.forma ?? "avista");
  const [parcelas, setParcelas] = useState(item?.parcelas ?? 1);
  const [primeiroVenc, setPrimeiroVenc] = useState(item?.primeiroVenc ?? f.hoje);
  const [conta, setConta] = useState(juntarOnde(item?.contaId ?? cad?.contas[0]?.id, null));
  const [cartao, setCartao] = useState(juntarOnde(null, item?.cartaoId ?? cad?.cartoes[0]?.id));
  const [obs, setObs] = useState(item?.obs ?? "");

  const chaveFotos = item ? `/api/financas/fotos?item=${item.id}` : null;
  const { dado: fotosSalvas } = useRecurso<{ fotos: { id: string; dado: string }[] }>(chaveFotos, { estavel: true });
  const [pendentes, setPendentes] = useState<string[]>([]);
  const [estadoFoto, setEstadoFoto] = useState<"" | "reduzindo" | "erro">("");
  const arquivoRef = useRef<HTMLInputElement>(null);

  const temPagamento = status === "contratado" || status === "pago";
  const semCartoes = forma === "cartao" && !(cad?.cartoes.length);
  const nFotos = (fotosSalvas?.fotos.length ?? 0) + pendentes.length;

  const dica = (() => {
    if (semCartoes) return "Nenhum cartão cadastrado ainda. Cadastre em Cartões ou escolha outra forma.";
    if (valor <= 0) return "Informe o valor para gerar as parcelas.";
    if (parcelas <= 1) return `Uma saída de ${brl(valor)} no extrato.`;
    return `${parcelas}x de ${brl(Math.floor(valor / parcelas))}, uma por mês, entrando no extrato e no comprometido dos próximos meses.`;
  })();

  async function adicionarFotos(lista: FileList | null) {
    const escolhidas = escolherFotos(Array.from(lista ?? []));
    if (!escolhidas.length) return;
    setEstadoFoto("reduzindo");
    let reduzidas: string[];
    try {
      reduzidas = await Promise.all(escolhidas.map(reduzir));
    } catch {
      setEstadoFoto("erro");
      return;
    }
    if (!item) {
      // item novo ainda não tem id: as fotos sobem logo depois de salvar
      setPendentes((p) => [...p, ...reduzidas]);
      setEstadoFoto("");
      return;
    }
    const r = await enviarComando({ tipo: "adicionar_fotos", itemId: item.id, fotos: reduzidas });
    setEstadoFoto("");
    if (!r.ok) return f.avisar(r.erro);
    invalidar(chaveFotos!);
    f.avisar(r.dado.mensagem);
  }

  async function removerFoto(id: string) {
    const r = await enviarComando({ tipo: "remover_foto", id });
    if (!r.ok) return f.avisar(r.erro);
    invalidar(chaveFotos!);
  }

  async function salvar() {
    if (!nome.trim()) return f.avisar("Dê um nome ao item.");
    const excesso = excessoDoTeto(meta.orcamento, meta.total, item?.valor ?? 0, valor);
    if (excesso !== null && !window.confirm(`Com este item a meta passa ${brl(excesso)} do teto de ${brl(meta.orcamento)}. Quer registrar mesmo assim?`)) return;
    const r = await f.executar(
      {
        tipo: "salvar_item", id: item?.id ?? null, metaId: meta.id, nome, valor, grupo: grupo.trim() || "Sem grupo", status, forma, parcelas,
        primeiroVenc, contaId: separarOnde(conta).contaId, cartaoId: forma === "cartao" ? separarOnde(cartao).cartaoId : null, obs: obs.trim() || null,
      },
      { manterAberta: pendentes.length > 0, silencioso: pendentes.length > 0 },
    );
    if (!r || !pendentes.length || !r.id) return;
    const fotos = await enviarComando({ tipo: "adicionar_fotos", itemId: r.id, fotos: pendentes.slice(0, 6) });
    f.fechar();
    f.avisar(fotos.ok ? r.mensagem : fotos.erro);
  }

  async function remover() {
    if (!window.confirm(`Remover ${item!.nome} da meta?`)) return;
    await f.executar({ tipo: "remover_item", id: item!.id });
  }

  return (
    <Folha titulo={item ? item.nome : "Novo item"} aoFechar={f.fechar}>
      <Campo rotulo="Item">
        <input type="text" placeholder="Porcelanato da sala" value={nome} maxLength={120} autoFocus={!item} onChange={(e) => setNome(e.target.value)} />
      </Campo>
      <Duas>
        <CampoDinheiro rotulo="Valor" valor={valor} aoMudar={setValor} />
        <Campo rotulo="Etapa">
          <input type="text" list={listaEtapas} placeholder="Revestimentos" value={grupo} maxLength={80} onChange={(e) => setGrupo(e.target.value)} />
          <datalist id={listaEtapas}>
            {meta.etapas.map((g) => <option key={g} value={g} />)}
          </datalist>
        </Campo>
      </Duas>
      <Campo rotulo="Situação">
        <select value={status} onChange={(e) => setStatus(e.target.value as Status)}>
          {SITUACOES.map((s) => <option key={s.id} value={s.id}>{s.rotulo}</option>)}
        </select>
      </Campo>
      {temPagamento && (
        <div className="fin-subbloco">
          <Campo rotulo="Como vai pagar">
            <select value={forma} onChange={(e) => setForma(e.target.value as Forma)}>
              {FORMAS.map((x) => <option key={x.id} value={x.id}>{x.rotulo}</option>)}
            </select>
          </Campo>
          <Duas>
            <Campo rotulo="Parcelas">
              <select value={parcelas} onChange={(e) => setParcelas(Number(e.target.value))}>
                {Array.from({ length: 48 }, (_, i) => i + 1).map((k) => <option key={k} value={k}>{k}x</option>)}
              </select>
            </Campo>
            <Campo rotulo="Primeira em">
              <input type="date" value={primeiroVenc} onChange={(e) => setPrimeiroVenc(e.target.value)} />
            </Campo>
          </Duas>
          {forma === "cartao" ? (
            cad?.cartoes.length ? (
              <Campo rotulo="Cartão">
                <select value={cartao} onChange={(e) => setCartao(e.target.value)}>
                  {cad.cartoes.map((c) => <option key={c.id} value={juntarOnde(null, c.id)}>{c.nome}</option>)}
                </select>
              </Campo>
            ) : null
          ) : (
            <SeletorOnde rotulo="Sai de" valor={conta} aoMudar={setConta} contas={cad?.contas ?? []} cartoes={[]} soContas />
          )}
          <p className="fin-dica">{dica}</p>
        </div>
      )}
      <Campo rotulo="Observação">
        <textarea placeholder="loja, contato, medida, prazo de entrega" value={obs} maxLength={2000} onChange={(e) => setObs(e.target.value)} />
      </Campo>
      <div className="field fin-campo">
        <span className="fin-rotulo">Fotos de referência</span>
        <div className="fin-fotos">
          {fotosSalvas?.fotos.map((ft) => (
            <span key={ft.id} className="fin-foto">
              <img src={ft.dado} alt="" />
              <button type="button" aria-label="Remover foto" onClick={() => void removerFoto(ft.id)}><Icone nome="close" /></button>
            </span>
          ))}
          {pendentes.map((d, i) => (
            <span key={i} className="fin-foto">
              <img src={d} alt="" />
              <button type="button" aria-label="Remover foto" onClick={() => setPendentes((p) => p.filter((_, j) => j !== i))}><Icone nome="close" /></button>
            </span>
          ))}
        </div>
        <input ref={arquivoRef} type="file" accept="image/*" multiple hidden onChange={(e) => { void adicionarFotos(e.target.files); e.target.value = ""; }} />
        <button type="button" className="button secondary compacto fin-auto" onClick={() => arquivoRef.current?.click()} disabled={estadoFoto === "reduzindo"}>
          Adicionar foto
        </button>
        <small className="fin-dica">
          {estadoFoto === "reduzindo"
            ? "Reduzindo…"
            : estadoFoto === "erro"
              ? "Não consegui ler alguma dessas imagens."
              : nFotos > 0
                ? `${nFotos} ${plural(nFotos, "foto", "fotos")} neste item.`
                : "As fotos ficam guardadas na sua conta e são reduzidas automaticamente."}
        </small>
      </div>
      {!item && pendentes.length > 0 && <Texto>As fotos sobem junto quando você adicionar o item.</Texto>}
      <BotaoPrincipal onClick={() => void salvar()}>{item ? "Salvar" : "Adicionar"}</BotaoPrincipal>
      {item && <BotaoApagar onClick={() => void remover()}>Remover item</BotaoApagar>}
    </Folha>
  );
}
