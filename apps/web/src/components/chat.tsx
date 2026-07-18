"use client";

import { useEffect, useRef, useState } from "react";

type Role = "user" | "assistant";
interface Msg {
  role: Role;
  content: string;
  model?: string;
}
interface ModelInfo {
  key: string;
  label: string;
  provider: string;
  billing: "free" | "subscription" | "paid";
}

const BILLING_PILL: Record<string, { text: string; color: string }> = {
  free: { text: "grátis", color: "#8ac98f" },
  subscription: { text: "assinatura", color: "#f5b544" },
  paid: { text: "pago", color: "#e0785a" },
};

export function Chat() {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => {
        setModels(d.models ?? []);
        setModelKey(d.defaultModel ?? d.models?.[0]?.key ?? "");
      })
      .catch(() => setError("Falha ao carregar modelos"));
  }, []);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || busy || !modelKey) return;
    setInput("");
    setError(null);
    setBusy(true);
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "", model: modelKey }]);

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, modelKey, conversationId: convId.current ?? undefined }),
      });

      const cid = res.headers.get("x-conversation-id");
      if (cid) convId.current = cid;

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erro no servidor" }));
        throw new Error(err.error ?? "Erro no servidor");
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        acc += dec.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", content: acc, model: modelKey };
          return copy;
        });
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Erro inesperado";
      setError(msg);
      setMessages((m) => {
        const copy = [...m];
        if (copy[copy.length - 1]?.role === "assistant" && !copy[copy.length - 1]?.content) copy.pop();
        return copy;
      });
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex h-[70vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--color-line)", background: "rgba(21,16,10,0.6)" }}>
      {/* header + seletor de modelo */}
      <div className="flex items-center gap-3 border-b px-4 py-3" style={{ borderColor: "var(--color-line)" }}>
        <span className="text-sm font-semibold" style={{ color: "var(--color-gold)" }}>ÓRBITA</span>
        <select
          value={modelKey}
          onChange={(e) => setModelKey(e.target.value)}
          className="ml-auto rounded-md border px-2 py-1 text-xs"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink)" }}
        >
          {models.map((m) => (
            <option key={m.key} value={m.key}>
              {m.label} · {BILLING_PILL[m.billing]?.text}
            </option>
          ))}
        </select>
      </div>

      {/* mensagens */}
      <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4">
        {messages.length === 0 && (
          <p className="mt-8 text-center text-sm" style={{ color: "var(--color-ink-dim)" }}>
            Converse com a Órbita — rodando no seu Qwen 2.5 local.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
            <div
              className="max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm"
              style={{
                background: m.role === "user" ? "color-mix(in oklab, var(--color-gold) 16%, var(--color-surface))" : "var(--color-surface)",
                border: "1px solid var(--color-line)",
                color: "var(--color-ink)",
              }}
            >
              {m.content || (busy && i === messages.length - 1 ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      {error && (
        <p className="px-4 pb-1 text-xs" style={{ color: "#e0705a" }}>{error}</p>
      )}

      {/* input */}
      <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: "var(--color-line)" }}>
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && send()}
          placeholder="Fale com a Órbita…"
          className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
          style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }}
        />
        <button
          onClick={send}
          disabled={busy || !input.trim()}
          className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
          style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}
        >
          {busy ? "…" : "Enviar"}
        </button>
      </div>
    </div>
  );
}
