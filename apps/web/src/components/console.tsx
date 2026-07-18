"use client";

import { useEffect, useRef, useState } from "react";
import { Orb, type OrbMode } from "@/components/orb";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

type Role = "user" | "assistant";
interface Msg { role: Role; content: string }
interface ModelInfo { key: string; label: string; provider: string; billing: "free" | "subscription" | "paid" }

const BRL = 5.35;
const GPT_PER_1K = 0.05; // R$/1k tokens saída (referência de nuvem)
const GEM_PER_1K = 0.01;

const STATUS: Record<OrbMode, string> = {
  standby: 'em espera · diga "Ei Órbita"',
  studying: "processando…",
  speaking: "respondendo…",
  searching: "pesquisando…",
  listening: "ouvindo…",
  connecting: "conectando…",
};

export function Console({ userName }: { userName: string }) {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<OrbMode>("standby");
  const [error, setError] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // métricas de sessão (reais / estimadas)
  const [stats, setStats] = useState({ requests: 0, tokens: 0, lastMs: 0, gpt: 0, gem: 0, saved: 0 });

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => { setModels(d.models ?? []); setModelKey(d.defaultModel ?? d.models?.[0]?.key ?? ""); })
      .catch(() => setError("Falha ao carregar modelos"));
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content || mode !== "standby" || !modelKey) return;
    setInput(""); setError(null); setMode("studying");
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "" }]);
    const started = Date.now();

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, modelKey, conversationId: convId.current ?? undefined }),
      });
      const cid = res.headers.get("x-conversation-id");
      if (cid) convId.current = cid;
      const usedModel = res.headers.get("x-model") ?? modelKey;

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erro no servidor" }));
        throw new Error(err.error ?? "Erro no servidor");
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let first = true;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (first) { setMode("speaking"); first = false; }
        acc += dec.decode(value, { stream: true });
        setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc }; return c; });
      }

      // métricas (tokens estimados por chars quando o provedor não envia usage)
      const outTokens = Math.max(1, Math.ceil(acc.length / 4));
      const isLocal = usedModel.startsWith("local/");
      const gptCost = (outTokens / 1000) * GPT_PER_1K * BRL;
      const gemCost = (outTokens / 1000) * GEM_PER_1K * BRL;
      setStats((s) => ({
        requests: s.requests + 1,
        tokens: s.tokens + outTokens,
        lastMs: Date.now() - started,
        gpt: s.gpt + gptCost,
        gem: s.gem + gemCost,
        saved: s.saved + (isLocal ? gptCost : 0),
      }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
      setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
    } finally {
      setMode("standby");
    }
  }

  const brl = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="grid w-full max-w-6xl gap-4 md:grid-cols-[210px_1fr_290px]">
      {/* LEFT RAIL */}
      <aside className="flex flex-col gap-4">
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full" style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", boxShadow: "0 0 22px rgba(245,181,68,.4)" }} />
            <div>
              <div className="font-semibold">Órbita</div>
              <div className="text-xs" style={{ color: "#8ac98f" }}>online · local</div>
            </div>
          </div>
          <p className="mt-3 text-xs" style={{ color: "var(--color-ink-dim)" }}>
            Olá, <b style={{ color: "var(--color-gold)" }}>{userName}</b>. Sua IA rodando na sua máquina.
          </p>
        </div>

        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Provedor de IA</h3>
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)} className="w-full rounded-lg border px-2 py-2 text-xs"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }}>
            {models.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
          </select>
          <p className="mt-2 font-mono text-[10px]" style={{ color: "var(--color-ink-dim)" }}>
            Gateway/Claude aparecem ao configurar as chaves no .env
          </p>
        </div>

        <button onClick={async () => { await signOut(); router.push("/login"); }}
          className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          Sair
        </button>
      </aside>

      {/* CENTER STAGE */}
      <main className="flex min-h-[640px] flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
        <div className="relative">
          <Orb mode={mode} height={300} />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-dim)" }}>
            {STATUS[mode]}
          </div>
        </div>

        <div ref={logRef} className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="mt-6 text-center text-sm" style={{ color: "var(--color-ink-dim)" }}>
              Converse com a Órbita — rodando no seu Qwen 2.5 local.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
              <div className="max-w-[85%] whitespace-pre-wrap rounded-xl px-3 py-2 text-sm"
                style={{ background: m.role === "user" ? "color-mix(in oklab, var(--color-gold) 16%, var(--color-surface))" : "var(--color-ground)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }}>
                {m.content || (mode !== "standby" && i === messages.length - 1 ? "…" : "")}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="px-4 pb-1 text-xs" style={{ color: "#e0705a" }}>{error}</p>}

        <div className="flex items-center gap-2 border-t p-3" style={{ borderColor: "var(--color-line)" }}>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Fale com a Órbita…" className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }} />
          <button onClick={send} disabled={mode !== "standby" || !input.trim()}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
            {mode !== "standby" ? "…" : "Enviar"}
          </button>
        </div>
      </main>

      {/* RIGHT RAIL */}
      <aside className="flex flex-col gap-4">
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Sessão</h3>
          <Stat label="Requisições" value={String(stats.requests)} />
          <Stat label="Tokens (~saída)" value={stats.tokens.toLocaleString("pt-BR")} />
          <Stat label="Latência (última)" value={stats.lastMs ? stats.lastMs + "ms" : "—"} accent />
        </div>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Custo vs. nuvem</h3>
          <Stat label="Órbita (local)" value="R$0,00" good />
          <Stat label="GPT-5 (ref.)" value={brl(stats.gpt)} />
          <Stat label="Gemini (ref.)" value={brl(stats.gem)} />
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--color-gold) 30%, transparent)", background: "color-mix(in oklab, var(--color-gold) 12%, transparent)" }}>
            <div className="font-mono text-[10px] uppercase" style={{ color: "var(--color-gold)" }}>você economizou</div>
            <div className="mt-1 text-xl font-bold">{brl(stats.saved)} <span className="text-xs" style={{ color: "var(--color-ink-dim)" }}>vs. nuvem</span></div>
          </div>
        </div>
      </aside>
    </div>
  );
}

function Stat({ label, value, accent, good }: { label: string; value: string; accent?: boolean; good?: boolean }) {
  return (
    <div className="flex items-baseline justify-between py-1 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
      <span>{label}</span>
      <b className="font-mono" style={{ color: good ? "#8ac98f" : accent ? "var(--color-gold)" : "var(--color-ink)" }}>{value}</b>
    </div>
  );
}
