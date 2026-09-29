"use client";

import { useState } from "react";
import { Icone } from "@/components/presenca/icones";
import type { PropostaPendente } from "@/components/console/types";
import { arrumarResultado } from "@/lib/resultado-da-acao";

/**
 * CONFIRMAR NA CONVERSA, e não em outra tela.
 *
 * O gate humano (§5.1) nunca vai embora: o modelo enfileira, a pessoa aprova, e
 * só o `POST /api/actions` executa. O que estava ruim era ONDE se aprovava. A
 * Órbita montava o evento e respondia "não consigo aprovar por você, abra o
 * painel Ações a confirmar" — tecnicamente correto e péssimo de usar, porque
 * quem acabou de ditar o evento tem de sair da conversa para terminá-lo.
 *
 * O dono pediu assim: "o ideal é aparecer um wizard mostrando como ficou, eu
 * podendo alterar e confirmar". Então o cartão mostra os campos como ficaram,
 * deixa corrigir e confirma ali mesmo.
 *
 * Os campos são DERIVADOS do payload, não escritos por tipo de ação. É o que
 * faz uma tool nova (§5.7) ganhar este cartão de graça, em vez de precisar de
 * um formulário próprio a cada vez. O servidor revalida com o schema da tool.
 */

/** Rótulo legível para uma chave do payload, sem tabela por tool. */
function rotulo(chave: string): string {
  const texto = chave
    .replace(/[_-]+/g, " ")
    .replace(/([a-z\d])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .trim();
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

/** Campo longo ganha área de texto: um corpo de e-mail não cabe numa linha. */
const ehLongo = (chave: string, valor: string) =>
  valor.length > 60 || valor.includes("\n") || /corpo|mensagem|texto|descricao|descrição|body/i.test(chave);

type Valores = Record<string, unknown>;

export function PropostaCard({
  proposta,
  aoDecidir,
}: {
  proposta: PropostaPendente;
  /** avisa a conversa do desfecho, para o cartão parar de pedir ação */
  aoDecidir: (id: string, estado: "confirmada" | "descartada", resultado?: string) => void;
}) {
  const [valores, setValores] = useState<Valores>(proposta.payload ?? {});
  const [editando, setEditando] = useState(false);
  const [ocupado, setOcupado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // só o que dá para editar como texto. Um campo aninhado (lista de anexos)
  // continua indo como veio: mostrar um JSON cru para editar seria pior do que
  // não mostrar, e o servidor valida o conjunto de qualquer jeito.
  const campos = Object.entries(valores).filter(([, v]) => v === null || ["string", "number", "boolean"].includes(typeof v));

  if (proposta.estado) {
    const feita = proposta.estado === "confirmada";
    const r = arrumarResultado(proposta.resultado);
    return (
      <div className={`proposta-cartao ${feita ? "feita" : "descartada"}`}>
        <p className="escolha-motivo">
          <Icone nome={feita ? "check" : "close"} />
          <strong>{feita ? "Feito." : "Descartado, nada foi enviado."}</strong>
          {r.texto && <span>{r.texto}</span>}
          {r.conta && <span className="proposta-conta" title={r.conta}>{r.conta}</span>}
        </p>
        {r.links.length > 0 && (
          <div className="proposta-links">
            {r.links.map((l) => (
              <a key={l.url} href={l.url} target="_blank" rel="noopener noreferrer">
                {l.rotulo}
              </a>
            ))}
          </div>
        )}
      </div>
    );
  }

  async function decidir(confirmar: boolean) {
    setOcupado(true);
    setErro(null);
    try {
      if (!confirmar) {
        await fetch(`/api/actions?id=${proposta.id}`, { method: "DELETE" });
        aoDecidir(proposta.id, "descartada");
        return;
      }
      const r = await fetch("/api/actions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // o payload só vai quando foi mexido: sem edição, quem vale é a
        // proposta que já está gravada na fila
        body: JSON.stringify({ id: proposta.id, ...(editando ? { payload: valores } : {}) }),
      });
      const d = (await r.json().catch(() => ({}))) as { error?: string; result?: string };
      if (!r.ok) {
        setErro(d.error ?? "Não consegui concluir.");
        return;
      }
      aoDecidir(proposta.id, "confirmada", d.result);
    } catch {
      setErro("Não consegui falar com o servidor.");
    } finally {
      setOcupado(false);
    }
  }

  return (
    <div className="proposta-cartao">
      <p className="escolha-motivo">
        <Icone nome="shield" />
        Isto ainda não aconteceu. Confira e confirme.
      </p>

      {campos.length > 0 ? (
        <dl className="proposta-campos">
          {campos.map(([chave, valor]) => {
            const texto = valor === null || valor === undefined ? "" : String(valor);
            return (
              <div key={chave} className="proposta-campo">
                <dt>{rotulo(chave)}</dt>
                <dd>
                  {editando ? (
                    ehLongo(chave, texto) ? (
                      <textarea
                        value={texto}
                        rows={Math.min(8, Math.max(2, texto.split("\n").length + 1))}
                        onChange={(e) => setValores((v) => ({ ...v, [chave]: e.target.value }))}
                        aria-label={rotulo(chave)}
                      />
                    ) : (
                      <input
                        value={texto}
                        onChange={(e) => setValores((v) => ({ ...v, [chave]: e.target.value }))}
                        aria-label={rotulo(chave)}
                      />
                    )
                  ) : (
                    <span>{texto || <em>vazio</em>}</span>
                  )}
                </dd>
              </div>
            );
          })}
        </dl>
      ) : (
        <p className="proposta-resumo">{proposta.resumo}</p>
      )}

      {erro && <p className="foco-erro">{erro}</p>}

      <div className="escolha-opcoes">
        <button type="button" className="button primary compacto" onClick={() => void decidir(true)} disabled={ocupado}>
          <Icone nome="check" />
          {ocupado ? "Enviando…" : "Confirmar"}
        </button>
        {campos.length > 0 && !editando && (
          <button type="button" className="button secondary compacto" onClick={() => setEditando(true)} disabled={ocupado}>
            <Icone nome="edit" />
            Alterar
          </button>
        )}
        <button type="button" className="button secondary compacto" onClick={() => void decidir(false)} disabled={ocupado}>
          <Icone nome="close" />
          Descartar
        </button>
      </div>
    </div>
  );
}
