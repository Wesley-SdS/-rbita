import { redirect } from "next/navigation";
import { getSession } from "@/lib/session";
import { Insights } from "@/components/insights";

export default async function InsightsPage() {
  const s = await getSession();
  if (!s) redirect("/login");
  return (
    <main className="mx-auto flex min-h-screen max-w-5xl flex-col px-4 py-6">
      <Insights />
    </main>
  );
}
