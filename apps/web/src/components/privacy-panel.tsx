"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function PrivacyPanel({ email }: { email: string }) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [confirmText, setConfirmText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function del() {
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch("/api/account", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirm: confirmText }),
      });
      if (!r.ok) { setErr((await r.json().catch(() => ({}))).error ?? "falha"); setBusy(false); return; }
      await signOut().catch(() => {});
      router.push("/login");
    } catch {
      setErr("falha ao apagar");
      setBusy(false);
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
            style={{ borderColor: "color-mix(in oklab, var(--color-danger) 40%, var(--color-line))", color: "var(--color-danger)" }}>
            Apagar minha conta
          </button>
        ) : (
          <div className="flex flex-col gap-1">
            <p className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>
              Apaga sua conta e <b>todos</b> os dados. Irreversível. Digite <b>{email}</b> para confirmar.
            </p>
            <input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="seu e-mail"
              className="rounded-lg border px-2 py-1 text-xs outline-none" style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }} />
            {err && <span className="text-[10px]" style={{ color: "var(--color-danger)" }}>{err}</span>}
            <div className="mt-1 flex gap-2">
              <button onClick={del} disabled={busy || confirmText.trim().toLowerCase() !== email.toLowerCase()} className="flex-1 rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-40"
                style={{ background: "var(--color-danger)", color: "#1a0a06" }}>
                {busy ? "…" : "Apagar tudo"}
              </button>
              <button onClick={() => { setConfirming(false); setConfirmText(""); setErr(null); }} className="rounded-lg border px-3 py-1.5 text-xs"
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
