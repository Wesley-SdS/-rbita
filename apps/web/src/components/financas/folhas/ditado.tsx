"use client";

import { useEffect, useRef, useState } from "react";
import { brl } from "@orbita/core/finance/formato";
import type { Proposta } from "@orbita/core/finance/ditado";
import { getRecognitionCtor, type RecognitionLike } from "@/lib/voice/speech";
import { diagnosticarVoz } from "@/lib/voice/contexto-seguro";
import { entender } from "@/lib/financas/api";
import { falhaDeVoz, juntarDitado } from "@/lib/financas/voz";
import { juntarOnde, plural, separarOnde } from "@/lib/financas/apresentacao";
import { useFinancas } from "../contexto";
import { BotaoPrincipal, Campo, Duas, Faixa, Folha, SeletorCategoria, SeletorOnde, Texto, Valor } from "../primitivos";

/**
 * Ditar lançamentos (PRD §8.1). O texto é entendido pelo backend (regra e
 * regex, sem LLM) e volta como PROPOSTAS: nada grava antes de a pessoa
 * conferir e tocar em "Lançar".
 *
 * A voz é o Web Speech do navegador, no aparelho, contínuo e com parciais.
 * Onde ele não existe (ou em HTTP, onde o navegador não libera microfone), a
 * faixa manda para o microfone do teclado, que dita no campo e funciona sempre.
 */
export function FolhaDitado() {
  const f = useFinancas();
  const cad = f.cad;
  const [texto, setTexto] = useState("");
  const [ouvindo, setOuvindo] = useState(false);
  const [podeOuvir, setPodeOuvir] = useState<"sim" | "nao" | "bloqueado">("sim");
  const [recado, setRecado] = useState<string | null>(null);
  const [propostas, setPropostas] = useState<Proposta[] | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const rec = useRef<RecognitionLike | null>(null);

  useEffect(() => {
    // decidido no efeito, não no render: no servidor não há `window`
    const ok = getRecognitionCtor() !== null && diagnosticarVoz(window).podeGravar;
    setPodeOuvir(ok ? "sim" : "nao");
    return () => rec.current?.abort();
  }, []);

  function parar() {
    try {
      rec.current?.stop();
    } catch {
      /* já parado */
    }
    setOuvindo(false);
  }

  function ouvir() {
    if (ouvindo) return parar();
    const Ctor = getRecognitionCtor();
    if (!Ctor) return setPodeOuvir("nao");
    const r = new Ctor();
    r.lang = "pt-BR";
    r.continuous = true;
    r.interimResults = true;
    const antes = texto;
    let final = "";
    r.onresult = (e) => {
      let parcial = "";
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const res = e.results[i]!;
        if (res.isFinal) final += `${res[0]!.transcript} `;
        else parcial += res[0]!.transcript;
      }
      setTexto(juntarDitado(antes, final + parcial));
    };
    r.onerror = (e) => {
      const falha = falhaDeVoz(e.error);
      if (falha.tipo === "bloqueado") setPodeOuvir("bloqueado");
      else if (falha.tipo === "recado") setRecado(falha.texto);
    };
    r.onend = () => setOuvindo(false);
    rec.current = r;
    setRecado(null);
    try {
      r.start();
      setOuvindo(true);
    } catch {
      f.avisar("Não consegui abrir o microfone.");
    }
  }

  async function entenderTexto() {
    parar();
    if (!texto.trim()) return f.avisar("Não achei valor nenhum nessa frase. Diga quanto foi.");
    setOcupado(true);
    const r = await entender(texto);
    setOcupado(false);
    if (!r.ok) return f.avisar(r.erro);
    setPropostas(r.dado.propostas.map((p) => (p.tipo === "transferencia" ? { ...p, origemId: p.origemId ?? cad?.contas[0]?.id ?? null, destinoId: p.destinoId ?? (cad?.contas[1] ?? cad?.contas[0])?.id ?? null } : p)));
  }

  function mudar(i: number, patch: Partial<Proposta>) {
    setPropostas((ps) => ps?.map((p, j) => (j === i ? ({ ...p, ...patch } as Proposta) : p)) ?? null);
  }

  async function lancar() {
    if (!propostas?.length) return;
    const itens = propostas.flatMap((p): Record<string, unknown>[] => {
      if (p.tipo === "transferencia") {
        // origem igual ao destino não move dinheiro nenhum: é pulada (§8.1.4)
        if (!p.origemId || !p.destinoId || p.origemId === p.destinoId) return [];
        return [{ tipo: "transferir", valor: p.valor, data: p.data, descricao: p.descricao || "Transferência", origemId: p.origemId, destinoId: p.destinoId }];
      }
      return [{
        tipo: "lancar", natureza: p.tipo, valor: p.valor, data: p.data, descricao: p.descricao || null, categoriaId: p.categoriaId,
        contaId: p.cartaoId ? null : p.contaId, cartaoId: p.cartaoId, estorno: p.estorno,
        // parcelas só valem no cartão; em conta vira lançamento único
        parcelas: p.cartaoId ? p.parcelas : 1,
      }];
    });
    if (!itens.length) return f.avisar("Nada para lançar.");
    await f.executar({ tipo: "lancar_varios", itens, origem: "ditado" });
  }

  const n = propostas?.length ?? 0;
  return (
    <Folha titulo="Ditar lançamentos" aoFechar={f.fechar}>
      <Texto>Fale ou escreva do seu jeito. Vale mais de um lançamento de uma vez, separando por ponto ou por &quot;e depois&quot;.</Texto>
      {podeOuvir === "sim" ? (
        <button type="button" className={`fin-falar ${ouvindo ? "ouvindo" : ""}`} onClick={ouvir} aria-pressed={ouvindo} aria-label="Ditar lançamento">
          <i aria-hidden="true" />
          {ouvindo ? "Ouvindo, toque para parar" : "Tocar para falar"}
        </button>
      ) : podeOuvir === "bloqueado" ? (
        <Faixa tom="perto" icone="mic">
          O navegador não liberou o microfone para esta página. Permita o microfone nas configurações do site, ou <b>use o microfone do teclado</b> e dite no campo abaixo: o resultado é o mesmo.
        </Faixa>
      ) : (
        <Faixa tom="perto" icone="mic">Este navegador não deixa ditar por voz aqui. Use o microfone do teclado e dite direto no campo abaixo.</Faixa>
      )}
      {recado && <p className="fin-dica">{recado}</p>}
      <Campo rotulo="O que aconteceu" dica="No celular, o microfone do teclado dita aqui dentro e funciona sempre.">
        <textarea
          placeholder="gastei 45,90 no mercado hoje e depois paguei 1200 de aluguel"
          value={texto}
          maxLength={4000}
          onChange={(e) => setTexto(e.target.value)}
        />
      </Campo>
      <div className="fin-botoes">
        <button type="button" className="button primary compacto fin-cresce" onClick={() => void entenderTexto()} disabled={ocupado}>Entender</button>
        <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "boleto" })}>Ler boleto</button>
      </div>

      {propostas && n > 0 && (
        <div className="fin-propostas">
          <h3>Entendi {n} {plural(n, "lançamento", "lançamentos")}, confira antes</h3>
          {propostas.map((p, i) => (
            <div key={i} className="fin-proposta">
              {p.tipo === "transferencia" ? (
                <>
                  <div className="fin-proposta-topo">
                    <strong>Transferência</strong>
                    <span className="fin-valor">{brl(p.valor)}</span>
                  </div>
                  <Duas>
                    <SeletorOnde rotulo="Sai de" valor={juntarOnde(p.origemId, null)} aoMudar={(v) => mudar(i, { origemId: separarOnde(v).contaId })} contas={cad?.contas ?? []} cartoes={[]} soContas />
                    <SeletorOnde rotulo="Entra em" valor={juntarOnde(p.destinoId, null)} aoMudar={(v) => mudar(i, { destinoId: separarOnde(v).contaId })} contas={cad?.contas ?? []} cartoes={[]} soContas />
                  </Duas>
                </>
              ) : (
                <>
                  <div className="fin-proposta-topo">
                    <strong>{p.descricao}</strong>
                    <Valor centavos={p.valor} natureza={p.tipo} />
                  </div>
                  <Duas>
                    <SeletorCategoria
                      valor={p.categoriaId ?? ""}
                      aoMudar={(v) => mudar(i, { categoriaId: v })}
                      categorias={cad?.categorias ?? []}
                      natureza={p.tipo === "receita" && !p.estorno ? "receita" : "despesa"}
                    />
                    <SeletorOnde
                      rotulo="Onde"
                      valor={juntarOnde(p.contaId, p.cartaoId)}
                      aoMudar={(v) => mudar(i, separarOnde(v))}
                      contas={cad?.contas ?? []}
                      cartoes={cad?.cartoes ?? []}
                    />
                  </Duas>
                  <Duas>
                    <Campo rotulo="Data">
                      <input type="date" value={p.data} onChange={(e) => mudar(i, { data: e.target.value })} />
                    </Campo>
                    <Campo rotulo="Descrição">
                      <input type="text" value={p.descricao} maxLength={200} onChange={(e) => mudar(i, { descricao: e.target.value })} />
                    </Campo>
                  </Duas>
                  {p.parcelas > 1 && <p className="fin-dica">{p.parcelas}x de {brl(Math.floor(p.valor / p.parcelas))}, só vale escolhendo um cartão</p>}
                  {p.estorno && <p className="fin-dica">entra como estorno e abate o gasto da categoria</p>}
                </>
              )}
              <button type="button" className="fin-link" onClick={() => setPropostas((ps) => ps?.filter((_, j) => j !== i) ?? null)}>remover</button>
            </div>
          ))}
          <BotaoPrincipal onClick={() => void lancar()}>Lançar {n} de uma vez</BotaoPrincipal>
        </div>
      )}
    </Folha>
  );
}
