import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { db } from "@/lib/db";
import { conversation } from "@/lib/db/chat-schema";
import { availableModels, providerEnv, defaultModelKey } from "@orbita/llm";
import { Console } from "@/components/console";

export default async function AppPage() {
  const s = await getSession();
  if (!s) redirect("/login");

  // Pré-carrega no servidor os dados críticos do boot (models + conversas) e
  // passa como props → o chat já renderiza pronto, sem esperar fetch no cliente.
  const env = providerEnv();
  const models = availableModels(env);
  const convs = await db
    .select({ id: conversation.id, title: conversation.title })
    .from(conversation)
    .where(eq(conversation.userId, s.user.id))
    .orderBy(desc(conversation.updatedAt))
    .limit(50);

  return (
    <main className="flex min-h-screen w-full flex-col px-3 py-4 md:h-screen md:min-h-0">
      <Console
        userName={s.user.name}
        userEmail={s.user.email}
        initialModels={models}
        initialDefaultModel={defaultModelKey(env)}
        initialConvs={convs}
      />
    </main>
  );
}
