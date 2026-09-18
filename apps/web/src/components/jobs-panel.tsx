"use client";

import { useEffect, useRef, useState } from "react";
import { Card, PanelTitle, ErrorRetry } from "@/components/ui";
import { JobProgress } from "@/components/job-progress";
import type { JobView } from "@/lib/jobs";

const dim = { color: "var(--color-ink-dim)" } as const;

// só usado quando o pedido do Retry-After (abaixo) falha: o servidor manda no
// ritmo sempre que responde, este é só o piso documentado para essa exceção.
const FALLBACK_POLL_MS = 3000;

/**
 * Trabalhos em segundo plano: reunião, extrato, comprovante, recalcular
 * biometria e indexação de documento aparecem aqui enquanto rodam, com
 * progresso e um botão para pedir parada. Um único polling para a lista
 * inteira (em vez de um por linha, que é o que os pontos de chamada fazem
 * individualmente via `JobProgress`), só enquanto algo estiver vivo.
 */
export function JobsPanel() {
  const [jobs, setJobs] = useState<JobView[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let alive = true;
    setErr(null);
    if (timerRef.current) clearTimeout(timerRef.current);

    (async () => {
      const r = await fetch("/api/jobs?limite=30").catch(() => null);
      if (!alive) return;
      if (!r || !r.ok) {
        const d = r ? await r.json().catch(() => ({})) : {};
        setErr((d as { error?: string }).error ?? "Não foi possível carregar os trabalhos.");
        setJobs([]);
        return;
      }
      const d = await r.json();
      if (!alive) return;
      const trabalhos: JobView[] = d.trabalhos ?? [];
      setJobs(trabalhos);

      const vivo = trabalhos.find((j) => j.status === "pendente" || j.status === "rodando");
      if (!vivo) return; // nada rodando: sem sentido continuar perguntando

      // o ritmo vem do Retry-After do recurso de status de um dos trabalhos
      // vivos (CLAUDE.md §5.6: nada de intervalo fixo escolhido no front);
      // 3s é só o piso se esse pedido falhar
      let esperaMs = FALLBACK_POLL_MS;
      const statusResp = await fetch(`/api/jobs/${vivo.id}`).catch(() => null);
      if (statusResp?.ok) {
        const retryAfter = Number(statusResp.headers.get("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) esperaMs = retryAfter * 1000;
      }
      if (!alive) return;
      timerRef.current = setTimeout(() => { if (alive) setReload((n) => n + 1); }, esperaMs);
    })();

    return () => { alive = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [reload]);

  function refresh() { setReload((n) => n + 1); }

  if (err) return <Card><PanelTitle className="mb-2">Trabalhos em segundo plano</PanelTitle><ErrorRetry message={err} onRetry={refresh} /></Card>;

  return (
    <Card>
      <PanelTitle className="mb-2">Trabalhos em segundo plano</PanelTitle>
      {!jobs ? (
        <p className="text-[12px]" style={dim}>Carregando…</p>
      ) : jobs.length === 0 ? (
        <p className="text-[12px]" style={dim}>
          Nada na fila agora. Reunião, extrato, comprovante, recalcular biometria e indexação de
          documento aparecem aqui enquanto rodam.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-[12px]">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
              <JobProgress job={j} onChange={refresh} live={false} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
