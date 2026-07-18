import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { SignOutButton } from "@/components/sign-out-button";
import { Chat } from "@/components/chat";

export default async function AppPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center gap-4 px-6 py-8">
      <div className="flex w-full max-w-2xl items-center gap-3">
        <div>
          <div className="text-sm" style={{ color: "var(--color-ink-dim)" }}>Olá,</div>
          <div className="font-semibold" style={{ color: "var(--color-gold)" }}>{s.user.name}</div>
        </div>
        <div className="ml-auto">
          <SignOutButton />
        </div>
      </div>
      <Chat />
    </main>
  );
}
