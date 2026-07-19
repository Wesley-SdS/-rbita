import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Console } from "@/components/console";

export default async function AppPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  return (
    <main className="flex min-h-screen w-full flex-col px-3 py-4 md:h-screen md:min-h-0">
      <Console userName={s.user.name} userEmail={s.user.email} />
    </main>
  );
}
