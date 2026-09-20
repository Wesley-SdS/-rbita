import { Suspense } from "react";
import { desc, eq } from "drizzle-orm";
import { getSession } from "@/lib/session";
import { db } from "@orbita/db";
import { conversation } from "@orbita/db/chat-schema";
import { availableModels, defaultModelKey } from "@orbita/llm";
import { Conversa } from "@/components/presenca/conversa";

export default async function PaginaConversa() {
  const sessao = await getSession();
  if (!sessao) return null; // o layout já redireciona; isto só contenta o tipo

  // Pré-carrega no servidor o que o chat precisa para renderizar pronto. Os
  // dois não dependem um do outro, então esperar em série seria desperdício.
  const [modelos, modeloPadrao, conversas] = await Promise.all([
    availableModels(),
    defaultModelKey(),
    db
      .select({ id: conversation.id, title: conversation.title })
      .from(conversation)
      .where(eq(conversation.userId, sessao.user.id))
      .orderBy(desc(conversation.updatedAt))
      .limit(50),
  ]);

  return (
    // `useSearchParams` (a intenção vinda da Visão geral) exige um limite de
    // Suspense, senão a rota inteira vira renderização sob demanda no cliente.
    <Suspense fallback={<div className="panel empty-state">Abrindo sua conversa…</div>}>
      <Conversa modelosIniciais={modelos} modeloPadrao={modeloPadrao} conversasIniciais={conversas} />
    </Suspense>
  );
}
