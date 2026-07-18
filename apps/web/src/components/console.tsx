"use client";

import { useEffect, useRef, useState } from "react";
import { Orb, type OrbMode } from "@/components/orb";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { PrivacyPanel } from "@/components/privacy-panel";
import { RoutinesPanel } from "@/components/routines-panel";
import { ConnectorsPanel } from "@/components/connectors-panel";
import { LocalTTS, WakeListener } from "@/lib/voice/engine";
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
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<LocalTTS | null>(null);
  const wakeRef = useRef<WakeListener | null>(null);
  const ttsLocalOkRef = useRef<boolean>(true); // cai p/ navegador se o TTS local falhar
  const [focus, setFocus] = useState(false);
  const [convs, setConvs] = useState<{ id: string; title: string }[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  function loadConvs() {
    fetch("/api/conversations").then((r) => r.json()).then((d) => setConvs(d.conversations ?? [])).catch(() => {});
  }
  async function loadConversation(id: string) {
    const r = await fetch(`/api/conversations/${id}`);
    const d = await r.json();
    if (r.ok) {
      convId.current = id;
      setActiveId(id);
      setMessages((d.messages ?? []).map((m: { role: Role; content: string }) => ({ role: m.role, content: m.content })));
    }
  }
  function newConversation() {
    convId.current = null;
    setActiveId(null);
    setMessages([]);
    setError(null);
  }
  async function deleteConv(id: string) {
    await fetch(`/api/conversations/${id}`, { method: "DELETE" });
    if (convId.current === id) newConversation();
    loadConvs();
  }

  function speakBrowser(text: string) {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) { setMode("standby"); return; }
    try {
      speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text.replace(/[#*_`>]/g, ""));
      const v = speechSynthesis.getVoices().find((x) => /pt.?BR/i.test(x.lang)) ?? null;
      if (v) u.voice = v;
      u.lang = v?.lang ?? "pt-BR";
      u.rate = 1.03;
      u.onstart = () => setMode("speaking");
      u.onend = () => setMode("standby");
      speechSynthesis.speak(u);
    } catch {
      setMode("standby");
    }
  }

  /** Fala preferindo o TTS local (Piper); cai para o navegador se indisponível. */
  async function speak(text: string) {
    if (!voiceOn) { setMode("standby"); return; }
    if (ttsLocalOkRef.current) {
      try {
        if (!ttsRef.current) ttsRef.current = new LocalTTS();
        await ttsRef.current.speak(text, { onStart: () => setMode("speaking"), onEnd: () => setMode("standby") });
        return;
      } catch {
        ttsLocalOkRef.current = false; // uma falha → usa navegador daqui pra frente
      }
    }
    speakBrowser(text);
  }

  /** Para a fala imediatamente (barge-in). */
  function stopSpeaking() {
    ttsRef.current?.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
  }

  async function toggleWake() {
    if (wakeRef.current?.active) {
      wakeRef.current.stop();
      wakeRef.current = null;
      setWakeOn(false);
      return;
    }
    try {
      const cfg = await fetch("/api/voice-config").then((r) => r.json());
      if (!cfg.up) { setError("Serviço de voz offline — wake word precisa do apps/voice rodando."); return; }
      const listener = new WakeListener(cfg.wsWakeUrl, {
        onWake: () => {
          stopSpeaking(); // barge-in ao ouvir o gatilho
          if (mode === "standby" && !recording) void toggleMic();
        },
        onEnergy: (rms) => {
          // barge-in por voz: se a Órbita está falando e o usuário fala alto, interrompe
          if (ttsRef.current?.speaking && rms > 0.06) stopSpeaking();
        },
        onError: () => setError("Falha no wake word (serviço de voz)."),
      });
      await listener.start();
      wakeRef.current = listener;
      setWakeOn(true);
    } catch {
      setError("Sem acesso ao microfone para wake word.");
    }
  }

  async function toggleMic() {
    if (recording) { recRef.current?.stop(); return; }
    if (mode !== "standby") return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        setRecording(false);
        setMode("studying");
        const blob = new Blob(chunksRef.current, { type: "audio/webm" });
        const fd = new FormData();
        fd.append("file", blob, "audio.webm");
        try {
          const r = await fetch("/api/stt", { method: "POST", body: fd });
          const d = await r.json();
          setMode("standby");
          if (d.text?.trim()) void sendMessage(d.text.trim());
          else setError("Não entendi o áudio.");
        } catch {
          setMode("standby");
          setError("Falha na transcrição.");
        }
      };
      recRef.current = rec;
      rec.start();
      setRecording(true);
      setMode("listening");
    } catch {
      setError("Sem acesso ao microfone.");
    }
  }

  useEffect(() => {
    fetch("/api/models")
      .then((r) => r.json())
      .then((d) => { setModels(d.models ?? []); setModelKey(d.defaultModel ?? d.models?.[0]?.key ?? ""); })
      .catch(() => setError("Falha ao carregar modelos"));
    loadConvs();
    return () => { wakeRef.current?.stop(); ttsRef.current?.stop(); };
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);

  async function send() {
    const content = input.trim();
    if (!content) return;
    setInput("");
    void sendMessage(content);
  }

  async function sendMessage(content: string) {
    if (!content || mode !== "standby" || !modelKey) return;
    setError(null); setMode("studying");
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "" }]);
    const started = Date.now();
    let spoke = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, modelKey, conversationId: convId.current ?? undefined }),
      });
      const cid = res.headers.get("x-conversation-id");
      if (cid) { convId.current = cid; setActiveId(cid); }
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

      if (voiceOn) { spoke = true; void speak(acc); }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
      setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
    } finally {
      if (!spoke) setMode("standby");
      loadConvs();
    }
  }

  const brl = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <>
    <div className="grid w-full max-w-6xl gap-4 md:grid-cols-[210px_1fr_290px]">
      {/* LEFT RAIL */}
      <aside className="flex flex-col gap-4">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <div className="flex items-center">
            <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Conversas</h3>
            <button onClick={newConversation} className="ml-auto text-xs" style={{ color: "var(--color-gold)" }}>＋ Nova</button>
          </div>
          <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {convs.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>nenhuma ainda</span>}
            {convs.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <button onClick={() => loadConversation(c.id)} className="flex-1 truncate text-left text-xs"
                  style={{ color: activeId === c.id ? "var(--color-gold)" : "var(--color-ink-dim)" }}>{c.title}</button>
                <button onClick={() => deleteConv(c.id)} title="apagar" className="text-xs opacity-40 hover:opacity-100" style={{ color: "#e0705a" }}>×</button>
              </div>
            ))}
          </div>
        </div>

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

        <KnowledgePanel />
        <PrivacyPanel />

        <button onClick={async () => { await signOut(); router.push("/login"); }}
          className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          Sair
        </button>
      </aside>

      {/* CENTER STAGE */}
      <main className="relative flex min-h-[640px] flex-col overflow-hidden rounded-2xl border" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
        <button onClick={() => setFocus(true)} title="modo foco (tela cheia)"
          className="absolute right-3 top-3 z-10 rounded-lg border px-2.5 py-1 text-xs"
          style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
          ⛶ Foco
        </button>
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
          <button onClick={() => setVoiceOn(!voiceOn)} title="voz da Órbita" className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: "var(--color-line)", color: voiceOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {voiceOn ? "🔊" : "🔇"}
          </button>
          <button onClick={toggleWake} title={wakeOn ? "wake word ativo — diga 'Ei Órbita'" : "ativar wake word 'Ei Órbita'"}
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: wakeOn ? "var(--color-gold)" : "var(--color-line)", color: wakeOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {wakeOn ? "👂" : "🕨"}
          </button>
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Fale ou escreva…" className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }} />
          <button onClick={toggleMic} disabled={mode !== "standby" && !recording} title="falar" aria-label="microfone"
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ background: recording ? "#e0705a" : "var(--color-surface)", borderColor: "var(--color-line)" }}>
            {recording ? "⏹" : "🎙️"}
          </button>
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
        <ConnectorsPanel />
        <RoutinesPanel />
      </aside>
    </div>

    {focus && (
      <div className="fixed inset-0 z-50" style={{ background: "#0a0703" }}>
        <div className="absolute inset-0">
          <Orb mode={mode} fill bare />
        </div>

        <div className="pointer-events-none absolute left-0 right-0 top-8 z-10 text-center">
          <div className="text-3xl" style={{ fontFamily: "var(--font-orbitron), sans-serif", fontWeight: 700, letterSpacing: "0.42em", color: "#ffd79a", textShadow: "0 0 24px rgba(255,170,60,0.55)", paddingLeft: "0.42em" }}>
            ÓRBITA
          </div>
          <div className="mt-2 text-[11px]" style={{ letterSpacing: "0.5em", color: "rgba(255,190,120,0.5)", paddingLeft: "0.5em" }}>
            ASSISTENTE · NÚCLEO NEURAL
          </div>
        </div>

        <div className="pointer-events-none absolute bottom-14 left-0 right-0 z-10 flex items-center justify-center gap-3 font-mono text-sm uppercase" style={{ letterSpacing: "0.28em", color: "#ffcf8a", textShadow: "0 0 16px rgba(255,160,50,0.5)" }}>
          <span className="h-2 w-2 rounded-full" style={{ background: "#ffcf8a", boxShadow: "0 0 12px #ffcf8a" }} />
          {STATUS[mode]}
        </div>

        <button onClick={() => setVoiceOn(!voiceOn)} title="voz" className="absolute bottom-6 left-6 z-10 rounded-full border px-3 py-2 text-lg"
          style={{ borderColor: "var(--color-line)", background: "rgba(21,16,10,0.6)", color: voiceOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
          {voiceOn ? "🔊" : "🔇"}
        </button>
        <button onClick={toggleMic} title="falar com a Órbita" className="absolute bottom-6 right-6 z-10 rounded-full border px-4 py-2 text-lg"
          style={{ borderColor: "var(--color-line)", background: recording ? "#e0705a" : "rgba(21,16,10,0.6)" }}>
          {recording ? "⏹" : "🎙️"}
        </button>
        <button onClick={() => setFocus(false)} title="sair do modo foco" className="absolute right-6 top-6 z-10 rounded-lg border px-3 py-1.5 text-sm"
          style={{ borderColor: "var(--color-line)", background: "rgba(21,16,10,0.6)", color: "var(--color-ink-dim)" }}>
          ✕ Sair
        </button>
      </div>
    )}
    </>
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
