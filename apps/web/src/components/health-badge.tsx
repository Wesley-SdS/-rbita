"use client";

import { useRecurso } from "@/lib/dados/recurso";

type Health = { status: string; db?: string };

export function HealthBadge() {
  // Validade curta (a padrão), não a de dado estável: um selo de saúde que
  // insiste por cinco minutos que o banco está de pé é pior do que não ter selo.
  // O cache aqui serve para o selo não repetir a chamada a cada tela.
  const { dado: h, erro } = useRecurso<Health>("/api/health");
  const err = !!erro;

  const ok = h?.status === "ok";
  const color = err || h?.status === "error" ? "var(--color-danger)" : ok ? "var(--color-good)" : "var(--color-ink-dim)";
  const label = err
    ? "API indisponível"
    : !h
      ? "verificando…"
      : ok
        ? "API + banco OK"
        : "banco indisponível";

  return (
    <div
      className="inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm"
      style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}
    >
      <span
        className="h-2 w-2 rounded-full"
        style={{ background: color, boxShadow: `0 0 8px ${color}` }}
      />
      <span style={{ color: "var(--color-ink-dim)", fontFamily: "ui-monospace, monospace" }}>
        {label}
      </span>
    </div>
  );
}
