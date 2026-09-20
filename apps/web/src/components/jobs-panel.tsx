"use client";

import { useEffect, useRef } from "react";
import { useRecurso } from "@/lib/dados/recurso";
import { Card, PanelTitle, ErrorRetry } from "@/components/ui";
import { JobProgress } from "@/components/job-progress";
import type { JobView } from "@/lib/jobs";
import { useVisivel } from "@/lib/use-visible";

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
  const visivel = useVisivel();
  // fora da tela ou com a aba escondida não consulta; ao voltar, atualiza na hora
  const { dado, erro: err, recarregar } = useRecurso<{ trabalhos: JobView[] }>("/api/jobs?limite=30", { ativo: visivel });
  const jobs = dado?.trabalhos ?? null;
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Enquanto houver trabalho vivo, pergunta de novo. O RITMO continua vindo do
  // `Retry-After` do próprio recurso de status (§5.6: nada de intervalo fixo
  // escolhido no front); 3s é só o piso se esse pedido falhar.
  //
  // O laço se realimenta pela identidade de `jobs`: cada leitura nova dispara
  // este efeito outra vez, e ele agenda a seguinte. Sem trabalho vivo, ele
  // simplesmente não agenda nada e o painel para de perguntar.
  useEffect(() => {
    if (!visivel || !jobs) return;
    const vivo = jobs.find((j) => j.status === "pendente" || j.status === "rodando");
    if (!vivo) return;

    let alive = true;
    void (async () => {
      let esperaMs = FALLBACK_POLL_MS;
      const statusResp = await fetch(`/api/jobs/${vivo.id}`).catch(() => null);
      if (statusResp?.ok) {
        const retryAfter = Number(statusResp.headers.get("Retry-After"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) esperaMs = retryAfter * 1000;
      }
      if (!alive) return;
      timerRef.current = setTimeout(() => { if (alive) recarregar(); }, esperaMs);
    })();

    return () => { alive = false; if (timerRef.current) clearTimeout(timerRef.current); };
  }, [jobs, visivel, recarregar]);

  if (err && !jobs) return <Card><PanelTitle className="mb-2">Trabalhos em segundo plano</PanelTitle><ErrorRetry message={err} onRetry={recarregar} /></Card>;

  return (
    <Card>
      <PanelTitle className="mb-2">Trabalhos em segundo plano</PanelTitle>
      {!jobs ? (
        <p className="text-[15px]" style={dim}>Carregando…</p>
      ) : jobs.length === 0 ? (
        <p className="text-[15px]" style={dim}>
          Nada na fila agora. Reunião, extrato, comprovante, recalcular biometria e indexação de
          documento aparecem aqui enquanto rodam.
        </p>
      ) : (
        <div className="flex flex-col gap-2 text-[15px]">
          {jobs.map((j) => (
            <div key={j.id} className="rounded-lg border p-2" style={{ borderColor: "var(--color-line)" }}>
              <JobProgress job={j} onChange={recarregar} live={false} />
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
