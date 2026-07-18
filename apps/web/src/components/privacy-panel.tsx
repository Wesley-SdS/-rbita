"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function PrivacyPanel() {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  async function del() {
    setBusy(true);
    try {
      await fetch("/api/account", { method: "DELETE" });
    } finally {
      await signOut().catch(() => {});
      router.push("/login");
    }
  }

  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>
        Privacidade (LGPD)
      </h3>
      <div className="flex flex-col gap-2">
        <a href="/api/account/export" download className="rounded-lg border px-3 py-1.5 text-center text-xs"
          style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          Exportar meus dados
        </a>

        {!confirming ? (
          <button onClick={() => setConfirming(true)} className="rounded-lg border px-3 py-1.5 text-xs"
            style={{ borderColor: "color-mix(in oklab, #e0705a 40%, var(--color-line))", color: "#e0705a" }}>
            Apagar minha conta
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
              Apaga sua conta e <b>todos</b> os dados. Irreversível.
            </p>
            <div className="flex gap-2">
              <button onClick={del} disabled={busy} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                style={{ background: "#e0705a", color: "#1a0a06" }}>
                {busy ? "…" : "Sim, apagar tudo"}
              </button>
              <button onClick={() => setConfirming(false)} className="rounded-lg border px-3 py-1.5 text-xs"
                style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
                Cancelar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
