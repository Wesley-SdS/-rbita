import { useCallback, useRef, useState } from "react";
import type { Msg, Role } from "./types";

export interface ConversationSummary { id: string; title: string }

/**
 * Gerencia a lista de conversas e as mensagens da conversa ativa (carregar,
 * abrir, criar, apagar). Isola do componente toda a orquestração de conversas.
 */
export function useConversations(initialConvs: ConversationSummary[]) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [convs, setConvs] = useState<ConversationSummary[]>(initialConvs);
  const [activeId, setActiveId] = useState<string | null>(null);
  const convId = useRef<string | null>(null);

  const loadConvs = useCallback(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((d) => setConvs(d.conversations ?? []))
      .catch(() => {});
  }, []);

  const loadConversation = useCallback(async (id: string) => {
    const r = await fetch(`/api/conversations/${id}`);
    const d = await r.json();
    if (r.ok) {
      convId.current = id;
      setActiveId(id);
      setMessages((d.messages ?? []).map((m: { role: Role; content: string }) => ({ role: m.role, content: m.content })));
    }
  }, []);

  const newConversation = useCallback(() => {
    convId.current = null;
    setActiveId(null);
    setMessages([]);
  }, []);

  const deleteConv = useCallback(async (id: string) => {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (convId.current === id) newConversation();
    loadConvs();
  }, [newConversation, loadConvs]);

  return { messages, setMessages, convs, activeId, setActiveId, convId, loadConvs, loadConversation, newConversation, deleteConv };
}
