"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { signIn, signUp } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [mode, setMode] = useState<"login" | "signup">("login");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const res =
        mode === "signup"
          ? await signUp.email({ name, email, password })
          : await signIn.email({ email, password });
      if (res.error) {
        setError(res.error.message ?? "Falha na autenticação");
      } else {
        router.push("/app");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Erro inesperado");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center gap-6 px-6">
      <div className="text-center">
        <h1 className="text-3xl font-bold" style={{ color: "var(--color-gold)" }}>
          ÓRBITA
        </h1>
        <p className="mt-1 text-sm" style={{ color: "var(--color-ink-dim)" }}>
          {mode === "login" ? "Entrar na sua conta" : "Criar sua conta"}
        </p>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-3">
        {mode === "signup" && (
          <input
            placeholder="Nome"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            className="rounded-lg border px-4 py-3 text-sm outline-none"
            style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }}
          />
        )}
        <input
          type="email"
          placeholder="Email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="rounded-lg border px-4 py-3 text-sm outline-none"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }}
        />
        <input
          type="password"
          placeholder="Senha (mín. 8)"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          minLength={8}
          className="rounded-lg border px-4 py-3 text-sm outline-none"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }}
        />

        {error && (
          <p className="text-sm" style={{ color: "var(--color-danger)" }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="rounded-lg px-4 py-3 text-sm font-semibold disabled:opacity-60"
          style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}
        >
          {busy ? "…" : mode === "login" ? "Entrar" : "Criar conta"}
        </button>
      </form>

      <button
        onClick={() => {
          setMode(mode === "login" ? "signup" : "login");
          setError(null);
        }}
        className="text-center text-sm underline"
        style={{ color: "var(--color-ink-dim)" }}
      >
        {mode === "login" ? "Não tem conta? Criar" : "Já tem conta? Entrar"}
      </button>
    </main>
  );
}
