"use client";

import { useEffect, useRef, useState } from "react";
import { acompanharJob, isJobTerminal, type JobView } from "@/lib/jobs";

const dim = { color: "var(--color-ink-dim)" } as const;
const danger = { color: "var(--color-danger)" } as const;
const gold = { color: "var(--color-gold)" } as const;

const STATUS_LABEL: Record<JobView["status"], string> = {
  pendente: "na fila",
  rodando: "rodando",
  feito: "concluído",
  falhou: "falhou",
  cancelado: "cancelado",
};

/**
 * Progresso de um trabalho em segundo plano (fila de trabalho pesado).
 *
 * Por padrão (`live`, o caso dos oito pontos de chamada) cuida do próprio
 * polling em `GET /api/jobs/:id`, respeitando o `Retry-After` de cada
 * resposta. Desmontar aborta só o ACOMPANHAMENTO: o trabalho continua rodando
 * no apps/api mesmo sem ninguém olhando a tela.
 *
 * Quando quem chama já mantém a lista inteira atualizada sozinho (o painel de
 * trabalhos, que faz um único polling para N linhas em vez de N pollings
 * paralelos), `live={false}` só desenha o `job` recebido.
 */
export function JobProgress({ job: jobProp, onChange, compact, live = true }: {
  job: JobView;
  /** chamado a cada atualização, inclusive a primeira: quem chama decide o que fazer quando o status vira terminal. */
  onChange?: (j: JobView) => void;
  /** esconde título e a mensagem final de "concluído" (o chamador já mostra o resultado do jeito dele). */
  compact?: boolean;
  live?: boolean;
}) {
  const [job, setJob] = useState(jobProp);
  const [stopping, setStopping] = useState(false);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // reflete trocas vindas de fora (ex.: o painel de trabalhos refez a lista)
  useEffect(() => { setJob(jobProp); }, [jobProp]);

  useEffect(() => {
    if (!live || isJobTerminal(jobProp.status)) return;
    const ctrl = new AbortController();
    acompanharJob(jobProp, (j) => { setJob(j); onChangeRef.current?.(j); }, ctrl.signal).catch((e) => {
      setJob((prev) => ({ ...prev, erro: { mensagem: e instanceof Error ? e.message : "Falha ao acompanhar o trabalho.", permanente: false } }));
    });
    return () => ctrl.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobProp.id, live]);

  async function parar() {
    setStopping(true);
    const r = await fetch(`/api/jobs/${job.id}`, { method: "DELETE" }).catch(() => null);
    setStopping(false);
    if (!r || !r.ok) {
      const d = (await r?.json().catch(() => ({}))) as { error?: string } | undefined;
      window.alert(d?.error ?? "Não foi possível pedir a parada.");
      return;
    }
    const d = (await r.json()) as JobView;
    setJob(d);
    onChangeRef.current?.(d);
  }

  const vivo = job.status === "pendente" || job.status === "rodando";
  const pct = job.progresso.total ? Math.min(100, Math.round((job.progresso.feito / job.progresso.total) * 100)) : null;

  return (
    <div className="flex flex-col gap-1 text-[14px]">
      {!compact && <p className="font-medium">{job.titulo}</p>}

      {vivo && (
        <div className="h-1.5 w-full overflow-hidden rounded-full" style={{ background: "var(--color-line)" }}>
          {pct !== null ? (
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: "var(--color-gold)" }} />
          ) : (
            <div className="h-full w-1/3 animate-pulse rounded-full" style={{ background: "var(--color-gold)" }} />
          )}
        </div>
      )}

      {vivo && (
        <p style={dim}>
          {job.progresso.passo ?? STATUS_LABEL[job.status]}
          {pct !== null ? ` · ${job.progresso.feito}/${job.progresso.total}` : ""}
        </p>
      )}

      {vivo && job.tentativas > 1 && <p style={dim}>tentativa {job.tentativas} de {job.maxTentativas}</p>}
      {job.proximaTentativaEm && <p style={dim}>esperando para tentar de novo…</p>}
      {job.status === "falhou" && <p style={danger}>{job.erro?.mensagem ?? "Falhou."}</p>}
      {job.status === "cancelado" && <p style={dim}>Cancelado.</p>}
      {job.status === "feito" && !compact && <p style={gold}>Concluído.</p>}

      {vivo && (
        <button
          onClick={() => void parar()}
          disabled={stopping || job.cancelamentoPedido}
          className="self-start underline disabled:opacity-50"
          style={dim}
        >
          {stopping || job.cancelamentoPedido ? "parando…" : "parar"}
        </button>
      )}
    </div>
  );
}
