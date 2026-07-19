import { fetch as expoFetch } from "expo/fetch";
import * as SecureStore from "expo-secure-store";
import { getBaseUrl, api } from "./api";

/**
 * Envia uma mensagem e faz streaming da resposta (mesma API /api/chat do web).
 * Usa expo/fetch, que suporta leitura incremental do corpo no React Native.
 */
export async function streamChat(
  content: string,
  modelKey: string,
  conversationId: string | undefined,
  onChunk: (full: string) => void,
): Promise<{ conversationId: string | null; model: string | null }> {
  const base = await getBaseUrl();
  const cookie = await SecureStore.getItemAsync("orbita.cookie");
  const res = await expoFetch(base + "/api/chat", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookie ? { Cookie: cookie } : {}),
    },
    body: JSON.stringify({ content, modelKey, conversationId }),
  });

  if (!res.ok || !res.body) {
    throw new Error("Falha no chat");
  }

  const cid = res.headers.get("x-conversation-id");
  const model = res.headers.get("x-model");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let acc = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    acc += decoder.decode(value, { stream: true });
    onChunk(acc);
  }
  return { conversationId: cid, model };
}

export interface ModelOption {
  key: string;
  label: string;
}

export async function fetchModels(): Promise<{ models: ModelOption[]; defaultModel: string }> {
  const base = await getBaseUrl();
  const cookie = await SecureStore.getItemAsync("orbita.cookie");
  const res = await fetch(base + "/api/models", { headers: cookie ? { Cookie: cookie } : {} });
  const data = (await res.json()) as { models?: ModelOption[]; defaultModel?: string };
  return { models: data.models ?? [], defaultModel: data.defaultModel ?? "local/qwen2.5:7b" };
}

// ── Histórico de conversas (sincronizado com o web, mesma API) ──────────────
export interface ConversationSummary { id: string; title: string; modelKey: string; updatedAt: string }
export interface ChatMsg { role: "user" | "assistant"; content: string }

/** Lista as conversas do usuário (mais recentes primeiro). */
export async function fetchConversations(): Promise<ConversationSummary[]> {
  const { data } = await api<{ conversations?: ConversationSummary[] }>("/api/conversations");
  return data?.conversations ?? [];
}

/** Carrega as mensagens de uma conversa para retomá-la. */
export async function fetchConversationMessages(id: string): Promise<ChatMsg[]> {
  const { data } = await api<{ messages?: { role: string; content: string }[] }>(`/api/conversations/${id}`);
  return (data?.messages ?? [])
    .filter((m): m is ChatMsg => m.role === "user" || m.role === "assistant");
}

/** Apaga uma conversa. */
export async function deleteConversation(id: string): Promise<boolean> {
  const { ok } = await api(`/api/conversations/${id}`, { method: "DELETE" });
  return ok;
}
