import Link from "next/link";
import { HealthBadge } from "@/components/health-badge";

export default function Home() {
  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div
        className="h-16 w-16 rounded-full"
        style={{
          background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))",
          boxShadow: "0 0 40px rgba(245,181,68,0.5)",
        }}
      />
      <h1 className="text-4xl font-bold tracking-tight" style={{ color: "var(--color-gold)" }}>
        ÓRBITA
      </h1>
      <p style={{ color: "var(--color-ink-dim)" }}>
        Assistente pessoal de IA · local-first. Fundação em pé.
      </p>
      <HealthBadge />
      <Link
        href="/login"
        prefetch
        className="rounded-lg px-5 py-3 text-sm font-semibold"
        style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}
      >
        Entrar →
      </Link>
    </main>
  );
}
