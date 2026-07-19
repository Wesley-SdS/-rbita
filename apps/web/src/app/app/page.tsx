import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Console } from "@/components/console";

export default async function AppPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <main className="mx-auto flex min-h-screen max-w-6xl flex-col items-center px-4 py-6">
      <Console userName={s.user.name} userEmail={s.user.email} />
    </main>
  );
}
