import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";

export default async function AppPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-6 px-6 text-center">
      <div
        className="h-14 w-14 rounded-full"
        style={{
          background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))",
          boxShadow: "0 0 34px rgba(245,181,68,0.5)",
        }}
      />
      <h1 className="text-2xl font-bold" style={{ color: "var(--color-gold)" }}>
        Olá, {s.user.name}
      </h1>
      <p style={{ color: "var(--color-ink-dim)" }}>
        Você está autenticado ({s.user.email}). Área do app protegida — aqui vai o chat + Orb (Fase 3).
      </p>
      <SignOutButton />
    </main>
  );
}
