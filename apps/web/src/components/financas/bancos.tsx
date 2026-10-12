"use client";

import { useState } from "react";
import { brl, iniciais } from "@orbita/core/finance/formato";
import type { VisaoDoBanco } from "@orbita/core/pluggy/servico";
import { JobProgress } from "@/components/job-progress";
import { useRecurso, invalidar } from "@/lib/dados/recurso";
import { enfileirar, isJobTerminal, type JobView } from "@/lib/jobs";
import { invalidarFinancas } from "@/lib/financas/api";
import { abrirWidget } from "@/lib/financas/pluggy-connect";
import type { CartaoCadastro, ContaCarteira } from "@/lib/financas/tipos";
import { useFinancas } from "./contexto";
import { Bloco, Etiqueta, Faixa, Link, Pastilha } from "./primitivos";

const URL_BANCOS = "/api/pluggy";

type ItemDoBanco = VisaoDoBanco["itens"][number];
type ContaDoBanco = ItemDoBanco["contas"][number];

interface ResultadoDaLeitura {
  lancadas?: number;
  transferencias?: number;
  faturasPagas?: number;
  jaExistiam?: number;
  avisos?: string[];
}

const quando = (iso: string | null) => (iso ? new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }) : "nunca");

async function pedir(url: string, metodo: "POST" | "DELETE", corpo?: unknown): Promise<{ ok: true; dado: Record<string, unknown> } | { ok: false; erro: string }> {
  try {
    const r = await fetch(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    const dado = (await r.json().catch(() => null)) as (Record<string, unknown> & { error?: string }) | null;
    if (!r.ok || !dado) return { ok: false, erro: dado?.error ?? "Não consegui falar com o servidor." };
    return { ok: true, dado };
  } catch {
    return { ok: false, erro: "Sem conexão com o servidor." };
  }
}

/**
 * Bancos conectados pela Pluggy (Open Finance). A tela só dirige: ler a Pluggy,
 * decidir o que é transferência entre as suas contas e gravar mora em `pluggy/`.
 * Cada conta ou cartão do banco precisa ser ligado a um da Órbita antes de
 * sincronizar, para a Órbita nunca escolher sozinha onde lançar o seu dinheiro.
 */
export function Bancos({ contas, cartoes }: { contas: ContaCarteira[]; cartoes: CartaoCadastro[] }) {
  const f = useFinancas();
  const { dado, erro, recarregar } = useRecurso<VisaoDoBanco>(URL_BANCOS);
  const [itemId, setItemId] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [trabalho, setTrabalho] = useState<JobView | null>(null);

  const atualizar = () => {
    invalidar(URL_BANCOS);
    invalidarFinancas();
    recarregar();
  };

  async function adicionar(id: string) {
    setOcupado(true);
    const r = await pedir(`${URL_BANCOS}/itens`, "POST", { itemId: id });
    setOcupado(false);
    if (!r.ok) return f.avisar(r.erro);
    setItemId("");
    f.avisar(`${String(r.dado.banco)}: ${String(r.dado.contas)} conta(s) encontrada(s). Escolha onde lançar cada uma.`);
    atualizar();
  }

  /** Conectar um banco novo ou, com `item`, renovar o login ou o consentimento dele, sem sair da Órbita. */
  async function conectar(item?: ItemDoBanco) {
    if (!dado) return;
    setOcupado(true);
    const t = await pedir(`${URL_BANCOS}/token`, "POST", item ? { id: item.id } : {});
    if (!t.ok) {
      setOcupado(false);
      return f.avisar(t.erro);
    }
    try {
      await abrirWidget({
        url: dado.widgetUrl,
        connectToken: String(t.dado.accessToken),
        updateItem: (t.dado.itemId as string | null) ?? null,
        aoConcluir: (id) => {
          setOcupado(false);
          void adicionar(id).then(() => void sincronizar());
        },
        aoFalhar: (m) => {
          setOcupado(false);
          f.avisar(m);
        },
      });
    } catch (e) {
      setOcupado(false);
      f.avisar(e instanceof Error ? e.message : "Não consegui abrir a conexão com o banco.");
    }
  }

  async function remover(item: ItemDoBanco) {
    if (!window.confirm(`Parar de acompanhar ${item.banco}? Os lançamentos que já entraram ficam.`)) return;
    const r = await pedir(`${URL_BANCOS}/itens?id=${item.id}`, "DELETE");
    if (!r.ok) return f.avisar(r.erro);
    atualizar();
  }

  async function sincronizar() {
    setOcupado(true);
    setTrabalho(null);
    try {
      setTrabalho(await enfileirar(await fetch(`${URL_BANCOS}/sincronizar`, { method: "POST" })));
    } catch (e) {
      setOcupado(false);
      f.avisar(e instanceof Error ? e.message : "Não consegui iniciar a leitura.");
    }
  }

  async function vincular(c: ContaDoBanco, escolha: string) {
    if (!escolha) return;
    const destino = escolha === "nova" ? { nova: true } : c.tipo === "CREDIT" ? { cartaoId: escolha } : { contaId: escolha };
    const r = await pedir(`${URL_BANCOS}/vincular`, "POST", { pluggyContaId: c.id, ...destino });
    if (!r.ok) return f.avisar(r.erro);
    atualizar();
    // o servidor já enfileirou a primeira leitura; pedir de novo devolve o mesmo trabalho para acompanhar
    void sincronizar();
  }

  async function alternar(c: ContaDoBanco) {
    const r = await pedir(`${URL_BANCOS}/ativa`, "POST", { pluggyContaId: c.id, ativa: !c.ativa });
    if (!r.ok) return f.avisar(r.erro);
    atualizar();
  }

  async function acertarSaldo(c: ContaDoBanco) {
    if (!window.confirm(`Acertar o saldo inicial de "${c.nome}" para o saldo da conta bater com o do banco (${c.saldoBanco === null ? "?" : brl(c.saldoBanco)})? Nenhum lançamento é criado nem apagado.`)) return;
    const r = await pedir(`${URL_BANCOS}/saldo`, "POST", { pluggyContaId: c.id });
    if (!r.ok) return f.avisar(r.erro);
    f.avisar("Saldo inicial acertado.");
    atualizar();
  }

  function aoMudarTrabalho(j: JobView) {
    setTrabalho(j);
    if (!isJobTerminal(j.status)) return;
    setOcupado(false);
    atualizar();
    if (j.status !== "feito") return f.avisar(j.erro?.mensagem ?? "A leitura dos bancos falhou.");
    const r = (j.resultado ?? {}) as ResultadoDaLeitura;
    const partes = [
      r.lancadas ? `${r.lancadas} lançamento(s)` : null,
      r.transferencias ? `${r.transferencias} transferência(s) entre suas contas` : null,
      r.faturasPagas ? `${r.faturasPagas} pagamento(s) de fatura` : null,
      r.jaExistiam ? `${r.jaExistiam} já estava(m) lançado(s)` : null,
    ].filter(Boolean);
    f.avisar(partes.length ? `Bancos lidos: ${partes.join(", ")}.` : "Bancos lidos: nada novo.");
  }

  return (
    <Bloco
      titulo="Bancos (Open Finance)"
      direita={dado?.conectado ? <Link onClick={() => void sincronizar()}>{ocupado ? "lendo…" : "sincronizar agora"}</Link> : undefined}
    >
      {erro && !dado ? <Faixa tom="perto" icone="info">{erro}</Faixa> : null}
      {dado && !dado.conectado && (
        <Faixa tom="perto" icone="info">
          Conecte a Pluggy em <a href="/app/conexoes">Conexões</a> (Client ID e Client Secret) para sincronizar os bancos sozinho.
        </Faixa>
      )}
      <p className="fin-nota">
        A Órbita lê o extrato pela Pluggy e lança o que for novo. Saída numa conta sua e entrada de mesmo valor em outra viram uma transferência: não contam como gasto nem como renda, só movem o saldo. A fatura do cartão é abatida quando você a paga pela conta.
      </p>

      {dado?.itens.map((item) => (
        <div key={item.id} className="fin-secao">
          <div className="fin-linha estatica">
            <Pastilha texto={iniciais(item.banco)} />
            <span className="fin-linha-corpo">
              <strong>{item.banco}</strong>
              <small>lido pelo banco em {quando(item.atualizadoNoBancoEm)} · lido aqui em {quando(item.sincronizadoEm)}</small>
            </span>
            <Link onClick={() => void conectar(item)}>renovar</Link>
            <Link onClick={() => void remover(item)}>remover</Link>
          </div>
          {(item.aviso || item.erro) && <Faixa tom="urgente" icone="info" onClick={() => void conectar(item)}>{item.aviso ?? item.erro}</Faixa>}
          {item.contas.map((c) => (
            <ContaDoBancoLinha
              key={c.id}
              c={c}
              contas={contas}
              cartoes={cartoes}
              aoVincular={(escolha) => void vincular(c, escolha)}
              aoAlternar={() => void alternar(c)}
              aoAcertarSaldo={() => void acertarSaldo(c)}
            />
          ))}
        </div>
      ))}

      {trabalho && !isJobTerminal(trabalho.status) && <JobProgress job={trabalho} onChange={aoMudarTrabalho} />}
      {trabalho && isJobTerminal(trabalho.status) && <AvisosDaLeitura j={trabalho} />}

      {dado?.conectado && (
        <>
          <div className="fin-botoes">
            <button type="button" className="button primary compacto" disabled={ocupado} onClick={() => void conectar()}>
              Conectar um banco
            </button>
          </div>
          <div className="fin-campo-acao">
            <label className="field">
              <span className="fin-rotulo">Ou cole o Item ID de um banco já conectado na Pluggy</span>
              <input value={itemId} onChange={(e) => setItemId(e.target.value)} placeholder="00000000-0000-0000-0000-000000000000" autoComplete="off" spellCheck={false} />
            </label>
            <button type="button" className="button secondary compacto" disabled={ocupado || itemId.trim().length < 10} onClick={() => void adicionar(itemId)}>
              Adicionar
            </button>
          </div>
        </>
      )}
    </Bloco>
  );
}

function ContaDoBancoLinha({
  c, contas, cartoes, aoVincular, aoAlternar, aoAcertarSaldo,
}: {
  c: ContaDoBanco;
  contas: ContaCarteira[];
  cartoes: CartaoCadastro[];
  aoVincular: (escolha: string) => void;
  aoAlternar: () => void;
  aoAcertarSaldo: () => void;
}) {
  const ehCartao = c.tipo === "CREDIT";
  const ligada = ehCartao ? c.cartaoId : c.contaId;
  const diferenca = c.saldoBanco !== null && c.saldoOrbita !== null ? c.saldoBanco - c.saldoOrbita : null;
  const podeCriarCartao = !!c.diaFechamento && !!c.diaVencimento;

  return (
    <div className="fin-linha estatica">
      <Pastilha texto={ehCartao ? "💳" : iniciais(c.nome)} />
      <span className="fin-linha-corpo">
        <strong>{c.nome}{c.numero ? ` · ${c.numero}` : ""}</strong>
        <small>
          {!ligada ? (
            ehCartao && c.diaFechamento && c.diaVencimento
              ? `cartão: fecha dia ${c.diaFechamento} · vence dia ${c.diaVencimento}${c.limite ? ` · limite ${brl(c.limite)}` : ""}`
              : "aguardando: escolha onde lançar"
          ) : ehCartao ? (
            "as compras entram na fatura que o banco emitiu"
          ) : (
            <>
              banco {c.saldoBanco === null ? "sem saldo" : brl(c.saldoBanco)} · Órbita {c.saldoOrbita === null ? "?" : brl(c.saldoOrbita)}{" "}
              {diferenca !== null && (diferenca === 0 ? <Etiqueta tom="entrada">confere</Etiqueta> : <Etiqueta tom="alerta">diferença de {brl(Math.abs(diferenca))}</Etiqueta>)}
            </>
          )}
        </small>
        <select value={ligada ?? ""} onChange={(e) => aoVincular(e.target.value)} aria-label={`${ehCartao ? "Cartão" : "Conta"} da Órbita para ${c.nome}`}>
          {!ligada && <option value="">Escolha {ehCartao ? "o cartão" : "a conta"} da Órbita…</option>}
          {(!ehCartao || podeCriarCartao) && <option value="nova">Criar {ehCartao ? "um cartão novo" : "uma conta nova"} para {ehCartao ? "ele" : "ela"}</option>}
          {ehCartao
            ? cartoes.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)
            : contas.map((x) => <option key={x.id} value={x.id}>{x.nome}</option>)}
        </select>
      </span>
      {!ehCartao && ligada && diferenca !== null && diferenca !== 0 && <Link onClick={aoAcertarSaldo}>acertar saldo</Link>}
      {ligada && <Link onClick={aoAlternar}>{c.ativa ? "pausar" : "retomar"}</Link>}
    </div>
  );
}

function AvisosDaLeitura({ j }: { j: JobView }) {
  const avisos = ((j.resultado ?? {}) as ResultadoDaLeitura).avisos ?? [];
  if (!avisos.length) return null;
  return <>{avisos.map((a) => <Faixa key={a} tom="perto" icone="info">{a}</Faixa>)}</>;
}
