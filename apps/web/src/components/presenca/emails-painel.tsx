"use client";

import { useEffect, useRef, useState } from "react";
import { quandoLegivel } from "@orbita/core/chat/cartoes-da-tela";
import { Icone } from "./icones";
import { invalidar, useRecurso } from "@/lib/dados/recurso";

/**
 * SEUS E-MAILS, na tela inicial: todas as caixas (os Gmails e o Outlook)
 * separadas em AÇÃO, ÚTEIS e RUÍDO pela triagem do servidor
 * (`emails/servico.ts`). Aqui só se mostra e se decide: resolver, mover de
 * aba, virar tarefa, lançar a movimentação do banco, confiar no banco.
 *
 * O link do e-mail abre a caixa em aba nova e sem `opener`.
 */

type Aba = "acao" | "util" | "ruido";

interface Email {
  id: string;
  de: string;
  assunto: string;
  trecho: string;
  resumo: string | null;
  recebidoEm: string;
  conta: string;
  categoria: Aba;
  oQueFazer: string | null;
  prazo: string | null;
  tarefaId: string | null;
  movimentacao: { natureza: "receita" | "despesa"; valor: number; contraparte: string | null; vencimento?: string } | null;
  lancamento: "lancado" | "quitado" | "agendado" | "no_cartao" | "repetido" | "pendente" | "nada" | null;
  autenticado: boolean;
  link: string | null;
}

interface Resposta {
  caixas: number;
  contagem: Record<Aba, number>;
  itens: Email[];
}

const ABAS: { id: Aba; rotulo: string; vazio: string }[] = [
  { id: "acao", rotulo: "Ação", vazio: "Nada pedindo você agora." },
  { id: "util", rotulo: "Úteis", vazio: "Nenhum e-mail útil novo." },
  { id: "ruido", rotulo: "Ruído", vazio: "Nenhum ruído. Que caixa limpa." },
];

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });
const chave = (aba: Aba) => `/api/emails?aba=${aba}`;
const nomeDe = (de: string) => de.replace(/<[^>]*>/, "").replace(/"/g, "").trim() || de;

async function agir(corpo: Record<string, unknown>): Promise<{ ok: boolean; erro?: string; mensagem?: string; dominio?: string }> {
  const r = await fetch("/api/emails/acao", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(corpo) });
  const d = await r.json().catch(() => ({}));
  return r.ok ? { ok: true, mensagem: d.mensagem, dominio: d.dominio } : { ok: false, erro: d.error ?? "Não deu certo." };
}

function Lancar({ email, aoFeito }: { email: Email; aoFeito: (msg: string) => void }) {
  const [contas, setContas] = useState<{ id: string; nome: string }[] | null>(null);
  const [conta, setConta] = useState("");
  const [ocupado, setOcupado] = useState(false);
  useEffect(() => {
    // as contas só são pedidas quando há algo para lançar
    fetch("/api/financas/cadastros")
      .then((r) => r.json())
      .then((d: { contas?: { id: string; nome: string }[] }) => {
        setContas(d.contas ?? []);
        setConta(d.contas?.[0]?.id ?? "");
      })
      .catch(() => setContas([]));
  }, []);
  if (!contas) return null;
  if (!contas.length) return <span className="email-nota">Cadastre uma conta em Finanças para lançar.</span>;
  return (
    <span className="email-lancar">
      <select className="inline-input" value={conta} onChange={(e) => setConta(e.target.value)} aria-label="Lançar em qual conta">
        {contas.map((c) => (
          <option key={c.id} value={c.id}>{c.nome}</option>
        ))}
      </select>
      <button
        type="button"
        className="button secondary compacto"
        disabled={ocupado || !conta}
        onClick={async () => {
          setOcupado(true);
          const r = await agir({ acao: "lancar", id: email.id, contaId: conta });
          setOcupado(false);
          aoFeito(r.ok ? r.mensagem ?? "Lançado." : r.erro ?? "Não consegui lançar.");
        }}
      >
        Lançar
      </button>
    </span>
  );
}

function Item({ email, aba, aoMudar, avisar, variasCaixas }: { email: Email; aba: Aba; aoMudar: () => void; avisar: (t: string) => void; variasCaixas: boolean }) {
  const [ocupado, setOcupado] = useState(false);
  const mov = email.movimentacao;
  async function fazer(corpo: Record<string, unknown>, ok: string) {
    setOcupado(true);
    const r = await agir({ id: email.id, ...corpo });
    setOcupado(false);
    avisar(r.ok ? (r.dominio ? `Pronto: e-mails de ${r.dominio} agora lançam sozinhos.` : ok) : r.erro ?? "Não deu certo.");
    if (r.ok) aoMudar();
  }
  return (
    <li className={`email-item${ocupado ? " ocupado" : ""}`}>
      <div className="email-linha">
        <span className="email-de">{nomeDe(email.de)}</span>
        <span className="email-meta">
          {/* de qual caixa só importa quando há mais de uma */}
          {variasCaixas && email.conta ? <span className="email-conta">{email.conta}</span> : null}
          <span>{quandoLegivel(email.recebidoEm)}</span>
        </span>
      </div>
      {email.link ? (
        <a className="email-assunto" href={email.link} target="_blank" rel="noopener noreferrer">{email.assunto || "(sem assunto)"}</a>
      ) : (
        <strong className="email-assunto">{email.assunto || "(sem assunto)"}</strong>
      )}
      {email.resumo ? <p className="email-resumo">{email.resumo}</p> : null}

      {email.tarefaId ? (
        <span className="email-chip feito">
          <Icone nome="check" />
          Tarefa: {email.oQueFazer?.replace(/[.;,\s]+$/, "") ?? "criada"}
          {email.prazo ? `, até ${quandoLegivel(email.prazo)}` : ""}
        </span>
      ) : null}

      {mov ? (
        <div className="email-mov">
          <span className={`email-valor ${mov.natureza}`}>
            {mov.natureza === "receita" ? "+" : "-"} {BRL.format(mov.valor / 100)}
            {mov.contraparte ? <small> {mov.natureza === "receita" ? "de" : "para"} {mov.contraparte}</small> : null}
          </span>
          {mov.vencimento ? <span className="email-nota">vence {quandoLegivel(mov.vencimento)}</span> : null}
          {email.lancamento === "lancado" ? (
            <span className="email-chip feito"><Icone nome="check" /> No extrato</span>
          ) : email.lancamento === "quitado" ? (
            <span className="email-chip feito"><Icone nome="check" /> Conta dada como paga</span>
          ) : email.lancamento === "agendado" ? (
            <span className="email-chip feito"><Icone nome="check" /> Em contas a {mov.natureza === "despesa" ? "pagar" : "receber"}</span>
          ) : email.lancamento === "no_cartao" ? (
            <span className="email-chip feito"><Icone nome="check" /> Já está na fatura do cartão</span>
          ) : email.lancamento === "repetido" ? (
            <span className="email-nota">Já estava em Finanças, não lancei de novo.</span>
          ) : (
            <>
              {mov.vencimento ? (
                <button type="button" className="button secondary compacto" onClick={() => void fazer({ acao: "agendar" }, "Adicionado às contas.")}>
                  Adicionar às contas
                </button>
              ) : (
                <Lancar email={email} aoFeito={(m) => { avisar(m); aoMudar(); }} />
              )}
              {email.autenticado ? (
                <button type="button" className="text-button" onClick={() => void fazer({ acao: "confiar" }, "Banco marcado como confiável.")}>
                  Confiar neste banco
                </button>
              ) : (
                <span className="email-nota" title="Sem a assinatura do domínio, a Órbita nunca lança sozinha.">E-mail sem assinatura do banco: confira antes.</span>
              )}
            </>
          )}
        </div>
      ) : null}

      <div className="email-acoes">
        {aba === "acao" && !email.tarefaId ? (
          <button type="button" className="text-button" onClick={() => void fazer({ acao: "tarefa" }, "Virou tarefa para hoje.")}>
            <Icone nome="plus" /> Virar tarefa
          </button>
        ) : null}
        {aba !== "ruido" ? (
          <button type="button" className="text-button" onClick={() => void fazer({ acao: "resolver" }, "Resolvido.")}>
            <Icone nome="check" /> Resolvido
          </button>
        ) : null}
        <select
          className="email-mover"
          value=""
          aria-label="Mover para outra aba"
          onChange={(e) => e.target.value && void fazer({ acao: "mover", categoria: e.target.value }, "Movido.")}
        >
          <option value="">Mover para…</option>
          {ABAS.filter((a) => a.id !== aba).map((a) => (
            <option key={a.id} value={a.id}>{a.rotulo}</option>
          ))}
        </select>
      </div>
    </li>
  );
}

export function EmailsPainel() {
  const [aba, setAba] = useState<Aba>("acao");
  const { dado, erro } = useRecurso<Resposta>(chave(aba));
  const [recado, setRecado] = useState<string | null>(null);
  const recargas = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => () => recargas.current.forEach(clearTimeout), []);

  const recarregarTudo = () => ABAS.forEach((a) => invalidar(chave(a.id)));
  function avisar(t: string) {
    setRecado(t);
    setTimeout(() => setRecado(null), 6000);
  }
  async function atualizar() {
    const r = await fetch("/api/emails/atualizar", { method: "POST" });
    if (!r.ok && r.status !== 202) return avisar("Não consegui ler as caixas agora.");
    avisar("Lendo as suas caixas. O que chegou aparece aqui em instantes.");
    recargas.current.forEach(clearTimeout);
    recargas.current = [5_000, 15_000, 35_000, 70_000].map((ms) => setTimeout(recarregarTudo, ms));
  }

  if (dado && dado.caixas === 0) {
    return (
      <div className="panel empty-state noticias-vazio">
        <strong>Conecte seus e-mails e a Órbita separa o que pede você.</strong>
        <span>Gmail (quantas contas quiser) e Outlook, em Conexões. O que pede ação vira tarefa, e o Pix do banco vira lançamento.</span>
      </div>
    );
  }

  return (
    <div className="emails">
      <div className="emails-barra">
        <div className="cartao-abas emails-abas" role="tablist" aria-label="Separação dos e-mails">
          {ABAS.map((a) => (
            <button key={a.id} type="button" role="tab" aria-selected={aba === a.id} className={aba === a.id ? "ativa" : ""} onClick={() => setAba(a.id)}>
              {a.rotulo}
              <span className="cartao-aba-total">{dado?.contagem[a.id] ?? 0}</span>
            </button>
          ))}
        </div>
        <button type="button" className="text-button" onClick={() => void atualizar()}>
          Atualizar agora
        </button>
      </div>
      {recado && <p className="noticias-recado" role="status">{recado}</p>}
      {erro && !dado ? (
        <div className="panel empty-state">Não consegui carregar os e-mails agora.</div>
      ) : !dado ? (
        <div className="panel empty-state">Carregando…</div>
      ) : !dado.itens.length ? (
        <div className="panel empty-state">{ABAS.find((a) => a.id === aba)!.vazio}</div>
      ) : (
        <ul className="emails-lista">
          {dado.itens.map((e) => (
            <Item key={e.id} email={e} aba={aba} aoMudar={recarregarTudo} avisar={avisar} variasCaixas={dado.caixas > 1} />
          ))}
        </ul>
      )}
    </div>
  );
}
