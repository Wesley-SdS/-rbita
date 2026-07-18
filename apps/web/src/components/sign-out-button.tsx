"use client";

import { useRouter } from "next/navigation";
import { signOut } from "@/lib/auth-client";

export function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await signOut();
        router.push("/login");
      }}
      className="rounded-lg border px-4 py-2 text-sm"
      style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}
    >
      Sair
    </button>
  );
}
