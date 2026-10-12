"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, Card, ErrorRetry, PanelTitle } from "@/components/ui";
import { BLOCOS } from "@/components/controle/blocos";

/**
 * "Controle do PC" (PRD-COMPUTADOR-E-NAVEGADOR F7): o estado das mãos (o
 * serviço local do Windows e a extensão do Chrome), a sessão aberta com o
 * botão Parar, as sessões com a trilha passo a passo, os blocos que cada
 * frente registrou e as chaves de configuração. Toda regra mora no servidor;
 * aqui só se mostra e se chama a rota.
 */

const SettingsPanel = dynamic(() => import("@/components/settings-panel").then((m) => m.SettingsPanel), { ssr: false });

interface EstadoDeMao {
  ligado: boolean;
  versao?: string | null;
  detalhe?: string | null;
  vistoEm?: string | null;
}
interface Sessao {
  id: string;
  alvo: string;
  objetivo: string;
  pedidoOriginal: string;
  pedidoLiteral: boolean;
  apps: string[];
  sites: string[];
  status: string;
  motivo: string | null;
  passosUsados: number;
  tetoPassos: number;
  expiraEm: string;
  canal: string;
  criadaEm: string;
  terminadaEm: string | null;
}
interface Estado {
  ativo: boolean;
  canais: string[];
  dono: boolean;
  maos: EstadoDeMao;
  extensao: EstadoDeMao;
  blocos: string[];
  aberta: { sessaoId: string; objetivo: string; status: string; passosUsados: number; tetoPassos: number; expiraEm: string } | null;
  atualizarEmSeg: number | null;
  sessoes: Sessao[];
}
interface Passo {
  id: string;
  tool: string;
  acao: string | null;
  alvo: Record<string, unknown>;
  risco: string;
  decisao: string;
  resultado: string | null;
  duracaoMs: number | null;
  temMiniatura: boolean;
  criadoEm: string;
}

const CHAVE = "/api/controle/estado";
const GRUPOS = ["controle", "maos", "terminal", "arquivos", "computador", "navegador"] as const;
const dim = { color: "var(--color-ink-dim)" } as const;

const DECISAO: Record<string, string> = {
  executando: "em andamento",
  executado: "feito",
  vetado: "vetado pelo crítico",
  recusado: "recusado",
  na_fila: "esperando aprovação",
  falhou: "falhou",
};
const STATUS: Record<string, string> = { ativa: "ativa", pausada: "pausada", encerrada: "encerrada", parada: "parada" };
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

function Mao({ nome, e }: { nome: string; e: EstadoDeMao }) {
  return (
    <li className="flex items-baseline justify-between gap-2">
      <span>
        <b>{nome}</b>
        {e.versao ? <span style={dim}> {e.versao}</span> : null}
        {e.detalhe ? <span className="block text-[13px]" style={dim}>{e.detalhe}</span> : null}
      </span>
      <span className="text-[14px]" style={{ color: e.ligado ? "var(--color-gold)" : "var(--color-ink-dim)" }}>{e.ligado ? "ligado" : "desligado"}</span>
    </li>
  );
}

function Trilha({ sessaoId }: { sessaoId: string }) {
  const { dado, erro, recarregar } = useRecurso<{ passos: Passo[] }>(`/api/controle/passos?sessao=${encodeURIComponent(sessaoId)}`);
  if (erro && !dado) return <ErrorRetry message={erro} onRetry={recarregar} />;
  if (!dado) return <p className="text-[14px]" style={dim}>Carregando…</p>;
  if (!dado.passos.length) return <p className="text-[14px]" style={dim}>Nenhum passo ainda.</p>;
  return (
    <ol className="flex flex-col gap-2">
      {[...dado.passos].reverse().map((p) => (
        <li key={p.id} className="rounded-lg border px-2 py-1 text-[14px]" style={{ borderColor: "var(--color-line)" }}>
          <div className="flex items-baseline justify-between gap-2">
            <span>
              <b>{p.tool.replace(/_/g, " ")}</b>
              {p.acao ? ` · ${p.acao}` : ""}
            </span>
            <span style={{ color: p.decisao === "vetado" || p.decisao === "falhou" || p.decisao === "recusado" ? "var(--color-danger)" : "var(--color-ink-dim)" }}>{DECISAO[p.decisao] ?? p.decisao}</span>
          </div>
          <div className="text-[13px]" style={dim}>
            {hora(p.criadoEm)} · risco {p.risco.replace("_", " ")}
            {p.duracaoMs !== null ? ` · ${p.duracaoMs} ms` : ""}
          </div>
          {Object.keys(p.alvo).length ? <code className="block break-all text-[12.5px]">{JSON.stringify(p.alvo)}</code> : null}
          {p.resultado ? <p className="text-[13px]">{p.resultado}</p> : null}
          {p.temMiniatura ? (
            // eslint-disable-next-line @next/next/no-img-element -- imagem do próprio passo, servida pelo api (uma por vez, sob demanda)
            <img src={`/api/controle/passos/${encodeURIComponent(p.id)}/miniatura`} loading="lazy" alt="A tela neste passo" className="mt-1 max-h-40 rounded" />
          ) : null}
        </li>
      ))}
    </ol>
  );
}

export function ControlePanel() {
  const { dado, erro, recarregar } = useRecurso<Estado>(CHAVE);
  const [aberta, setAberta] = useState<string | null>(null);
  const [parando, setParando] = useState(false);
  const [aviso, setAviso] = useState<string | null>(null);

  // o ritmo vem do servidor (`controle.telaAtualizarSeg`), e só com sessão ativa
  useEffect(() => {
    const seg = dado?.atualizarEmSeg;
    if (!seg) return;
    const t = setTimeout(() => {
      invalidar(CHAVE);
      if (aberta) invalidar(`/api/controle/passos?sessao=${encodeURIComponent(aberta)}`);
    }, seg * 1000);
    return () => clearTimeout(t);
  }, [dado, aberta]);

  async function parar() {
    setParando(true);
    setAviso(null);
    try {
      const r = await fetch("/api/controle/parar", { method: "POST" });
      const d = (await r.json().catch(() => ({}))) as { sessoes?: number; propostas?: number; maos?: { nome: string; ok: boolean }[]; error?: string };
      if (!r.ok) setAviso(d.error ?? "Não consegui parar. Tente de novo.");
      else {
        const falhas = (d.maos ?? []).filter((m) => !m.ok).map((m) => m.nome);
        setAviso(`Parado. ${d.sessoes ?? 0} sessão(ões) encerrada(s), ${d.propostas ?? 0} proposta(s) cancelada(s).${falhas.length ? ` Sem confirmação de: ${falhas.join(", ")}.` : ""}`);
      }
    } catch {
      setAviso("Sem conexão com a Órbita. Use o atalho de parar no computador.");
    } finally {
      setParando(false);
      invalidar(CHAVE);
    }
  }

  if (erro && !dado) return <Card><PanelTitle className="mb-2">Controle do PC</PanelTitle><ErrorRetry message={erro} onRetry={recarregar} /></Card>;

  const blocos = (dado?.blocos ?? []).flatMap((id) => {
    const b = BLOCOS[id as keyof typeof BLOCOS];
    return b ? [{ id, ...b }] : [];
  });

  return (
    <div className="grid-stack">
      <Card>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <PanelTitle>Controle do PC</PanelTitle>
          <span className="text-[14px]" style={dim}>{dado ? (dado.ativo ? `ligado · ${dado.canais.join(", ") || "nenhum canal"}` : "desligado") : ""}</span>
        </div>
        <p className="text-[14px]" style={dim}>
          A Órbita só mexe no computador e no Chrome dentro de uma sessão que você aprova, com teto de passos e de tempo. O que tem efeito fora da
          tela continua pedindo aprovação. Ligue em &quot;Deixar a Órbita usar o computador e o Chrome&quot;, abaixo.
        </p>
        {dado ? (
          <ul className="mt-3 flex flex-col gap-2">
            <Mao nome="Serviço local do Windows" e={dado.maos} />
            <Mao nome="Extensão do Chrome" e={dado.extensao} />
          </ul>
        ) : (
          <p className="mt-3 text-[14px]" style={dim}>Carregando…</p>
        )}
      </Card>

      <Card>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <PanelTitle>Agora</PanelTitle>
          <Button variant="danger" size="sm" disabled={parando} onClick={() => void parar()}>
            {parando ? "Parando…" : "Parar tudo"}
          </Button>
        </div>
        {dado?.aberta ? (
          <p className="text-[15px]">
            <b>{dado.aberta.objetivo}</b>
            <span style={dim}>
              {" "}
              · {STATUS[dado.aberta.status] ?? dado.aberta.status} · passo {dado.aberta.passosUsados} de {dado.aberta.tetoPassos}
              {dado.aberta.status === "ativa" ? ` · até ${hora(dado.aberta.expiraEm)}` : ""}
            </span>
          </p>
        ) : (
          <p className="text-[14px]" style={dim}>Nenhuma sessão aberta. O Parar também corta comando e navegador que estejam rodando.</p>
        )}
        {aviso ? <p className="notice mt-2">{aviso}</p> : null}
      </Card>

      <Card>
        <PanelTitle className="mb-2">Sessões e trilha</PanelTitle>
        {!dado ? (
          <p className="text-[14px]" style={dim}>Carregando…</p>
        ) : (
          <ul className="flex flex-col gap-1">
            {[...dado.sessoes.map((s) => ({ ...s, avulsos: false as const })), { id: "avulsos", avulsos: true as const }].map((s) => (
              <li key={s.id} className="rounded-lg border" style={{ borderColor: "var(--color-line)" }}>
                <button type="button" className="flex w-full items-baseline justify-between gap-2 px-3 py-2 text-left text-[15px]" onClick={() => setAberta(aberta === s.id ? null : s.id)}>
                  {s.avulsos ? (
                    <span>Comandos avulsos (sem sessão)</span>
                  ) : (
                    <span>
                      <b>{s.objetivo}</b>
                      <span className="block text-[13px]" style={dim}>
                        {hora(s.criadaEm)} · {s.alvo} · {STATUS[s.status] ?? s.status}
                        {s.motivo ? ` (${s.motivo})` : ""} · {s.passosUsados}/{s.tetoPassos} passos · pedido {s.pedidoLiteral ? "" : "resumido "}pelo canal {s.canal}
                      </span>
                    </span>
                  )}
                  <span style={dim}>{aberta === s.id ? "▾" : "▸"}</span>
                </button>
                {aberta === s.id ? (
                  <div className="border-t px-3 py-2" style={{ borderColor: "var(--color-line)" }}>
                    {!s.avulsos ? (
                      <p className="mb-2 text-[13px]" style={dim}>
                        Pedido: &quot;{s.pedidoOriginal}&quot;
                        {s.apps.length ? ` · apps: ${s.apps.join(", ")}` : ""}
                        {s.sites.length ? ` · sites: ${s.sites.join(", ")}` : ""}
                      </p>
                    ) : null}
                    <Trilha sessaoId={s.id} />
                  </div>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {blocos.map(({ id, titulo, Componente }) => (
        <Card key={id}>
          <PanelTitle className="mb-2">{titulo}</PanelTitle>
          <Componente />
        </Card>
      ))}

      <SettingsPanel grupos={GRUPOS} titulo="Ajustes do controle do PC" />
    </div>
  );
}
