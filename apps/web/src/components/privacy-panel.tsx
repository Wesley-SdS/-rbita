"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";
import { Card, PanelTitle, Input } from "@/components/ui";

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
    <Card>
      <PanelTitle className="mb-2">Privacidade (LGPD)</PanelTitle>
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
            <Input value={confirmText} onChange={(e) => setConfirmText(e.target.value)} placeholder="seu e-mail" />
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
    </Card>
  );
}
