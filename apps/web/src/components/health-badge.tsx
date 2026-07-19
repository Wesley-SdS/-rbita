"use client";

import { useEffect, useState } from "react";

type Health = { status: string; db?: string };

export function HealthBadge() {
  const [h, setH] = useState<Health | null>(null);
  const [err, setErr] = useState(false);

  useEffect(() => {
    fetch("/api/health")
      .then((r) => r.json())
      .then(setH)
      .catch(() => setErr(true));
  }, []);

  const ok = h?.status === "ok";
  const color = err || h?.status === "error" ? "var(--color-danger)" : ok ? "#8ac98f" : "#b8a98d";
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
