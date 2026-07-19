"use client";

import { useEffect, useRef, useState } from "react";
import { Orb, type OrbMode } from "@/components/orb";
import { KnowledgePanel } from "@/components/knowledge-panel";
import { PrivacyPanel } from "@/components/privacy-panel";
import { RoutinesPanel } from "@/components/routines-panel";
import { ConnectorsPanel } from "@/components/connectors-panel";
import { MeetingPanel } from "@/components/meeting-panel";
import { FinancePanel } from "@/components/finance-panel";
import { TodoPanel } from "@/components/todo-panel";
import { FolderPanel } from "@/components/folder-panel";
import { ActionsPanel } from "@/components/actions-panel";
import { Markdown } from "@/components/markdown";
import { ExtensionsPanel } from "@/components/extensions-panel";
import { Widgets } from "@/components/widgets";
import { Block, BlocksManager, useHiddenBlocks } from "@/components/block";
import { LocalTTS, WakeListener, recordUntilSilence } from "@/lib/voice/engine";
import { RealtimeSession } from "@/lib/voice/realtime";
import { signOut } from "@/lib/auth-client";
import { useRouter } from "next/navigation";

type Role = "user" | "assistant";
interface ToolStep { name: string; done: boolean }
interface Msg { role: Role; content: string; steps?: ToolStep[] }
interface ModelInfo { key: string; label: string; provider: string; billing: "free" | "subscription" | "paid" | "variable" }

// rótulos amigáveis para a timeline de atividade (o que a Órbita está fazendo).
const TOOL_LABELS: Record<string, string> = {
  hora_atual: "🕐 Consultando a hora",
  salvar_memoria: "💾 Salvando na memória",
  buscar_conhecimento: "📚 Buscando no seu conhecimento",
  registrar_gasto: "💸 Registrando gasto",
  resumo_financeiro: "📊 Resumindo finanças",
  pesquisar_web: "🔍 Pesquisando na web",
  ler_pagina: "🌐 Lendo página",
  ler_emails: "✉️ Lendo e-mails",
  rascunhar_email: "📝 Rascunhando e-mail",
  enviar_email: "📤 Enviando e-mail",
  listar_eventos: "📅 Consultando a agenda",
  criar_evento: "🗓️ Criando evento",
  buscar_notion: "📓 Buscando no Notion",
  ler_pagina_notion: "📓 Lendo página do Notion",
  listar_canais_slack: "💬 Listando canais do Slack",
  enviar_slack: "💬 Enviando no Slack",
  enviar_whatsapp: "📱 Enviando WhatsApp",
};
const toolLabel = (n: string) => TOOL_LABELS[n] ?? `⚙ ${n}`;

// blocos ocultáveis do dashboard (id → rótulo no gerenciador)
const BLOCKS = [
  { id: "widgets", label: "Meus cards" },
  { id: "provedor", label: "Provedor de IA" },
  { id: "persona", label: "Persona" },
  { id: "memoria", label: "Memória & Docs" },
  { id: "reuniao", label: "Reunião" },
  { id: "privacidade", label: "Privacidade (LGPD)" },
  { id: "sessao", label: "Sessão" },
  { id: "custo", label: "Economia vs. nuvem" },
  { id: "financas", label: "Finanças" },
  { id: "tarefas", label: "Tarefas" },
  { id: "arquivos", label: "Arquivos" },
  { id: "extensoes", label: "Extensões" },
  { id: "conectores", label: "Conectores" },
  { id: "proatividade", label: "Proatividade" },
  { id: "push", label: "Notificações push" },
];


const STATUS: Record<OrbMode, string> = {
  standby: 'em espera · diga "Ei Órbita"',
  studying: "processando…",
  speaking: "respondendo…",
  searching: "pesquisando…",
  listening: "ouvindo…",
  connecting: "conectando…",
};

export function Console({ userName, userEmail }: { userName: string; userEmail: string }) {
  const router = useRouter();
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [modelKey, setModelKey] = useState("");
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<OrbMode>("standby");
  const modeRef = useRef<OrbMode>("standby"); // espelho p/ callbacks (evita stale closure do wake)
  const [error, setError] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const logRef = useRef<HTMLDivElement>(null);

  // métricas de sessão (reais / estimadas)
  const [stats, setStats] = useState({ requests: 0, tokens: 0, lastMs: 0 });
  const [voiceOn, setVoiceOn] = useState(true);
  const [recording, setRecording] = useState(false);
  const [wakeOn, setWakeOn] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const ttsRef = useRef<LocalTTS | null>(null);
  const wakeRef = useRef<WakeListener | null>(null);
  const audioFileRef = useRef<HTMLInputElement | null>(null);
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const [imageAttach, setImageAttach] = useState<string | null>(null); // data URL da imagem anexada
  const ttsLocalOkRef = useRef<boolean>(true); // cai p/ navegador se o TTS local falhar
  const { hidden, toggle } = useHiddenBlocks(); // blocos que o usuário ocultou
  const [privacyMode, setPrivacyMode] = useState(false); // força tudo local (nada vai p/ nuvem)
  const [realtimeEnabled, setRealtimeEnabled] = useState(false); // S2S premium disponível?
  const [realtimeOn, setRealtimeOn] = useState(false);
  const rtRef = useRef<RealtimeSession | null>(null);
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

  /** Para a fala imediatamente (barge-in) e libera o estado (evita travar em "speaking"). */
  function stopSpeaking() {
    ttsRef.current?.stop();
    if (typeof window !== "undefined" && "speechSynthesis" in window) speechSynthesis.cancel();
    if (modeRef.current === "speaking") { modeRef.current = "standby"; setMode("standby"); }
  }

  /** "Ver a tela": captura um frame da tela compartilhada e pede análise à Órbita. */
  async function seeScreen() {
    if (mode !== "standby") return;
    let stream: MediaStream | null = null;
    try {
      stream = await (navigator.mediaDevices as MediaDevices & { getDisplayMedia: (c: unknown) => Promise<MediaStream> }).getDisplayMedia({ video: true });
      const video = document.createElement("video");
      video.srcObject = stream;
      await video.play();
      await new Promise((r) => setTimeout(r, 400)); // deixa o primeiro frame chegar
      const canvas = document.createElement("canvas");
      canvas.width = video.videoWidth || 1280;
      canvas.height = video.videoHeight || 720;
      canvas.getContext("2d")?.drawImage(video, 0, 0, canvas.width, canvas.height);
      const image = canvas.toDataURL("image/jpeg", 0.6);
      stream.getTracks().forEach((t) => t.stop());

      const question = input.trim() || "O que você vê na minha tela? Me ajude com o que estou fazendo.";
      setInput("");
      setMessages((m) => [...m, { role: "user", content: "🖥️ " + question }, { role: "assistant", content: "" }]);
      setMode("studying");
      const r = await fetch("/api/vision", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ image, question }) });
      const d = await r.json();
      setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: d.answer ?? ("⚠ " + (d.error ?? "falha")) }; return c; });
      setMode("standby");
      if (d.answer && voiceOn) void speak(d.answer);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      setMode("standby");
      if (!(e instanceof Error && e.name === "NotAllowedError")) setError("Não foi possível capturar a tela.");
    }
  }

  /** Transcreve um arquivo de áudio enviado e coloca o texto no composer. */
  async function sendAudioFile(file: File) {
    setMode("studying");
    try {
      const fd = new FormData();
      fd.append("file", file, file.name || "audio.webm");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      setMode("standby");
      if (d.text?.trim()) setInput((prev) => (prev ? prev + " " : "") + d.text.trim());
      else setError("Não consegui transcrever o áudio.");
    } catch {
      setMode("standby");
      setError("Falha ao transcrever o áudio.");
    }
  }

  /** Fluxo mãos-livres: grava o comando até o silêncio, transcreve e envia. */
  async function voiceCommand() {
    if (modeRef.current !== "standby") return;
    setMode("listening");
    try {
      const blob = await recordUntilSilence({ onSpeech: () => setMode("listening") });
      if (!blob) { setMode("standby"); return; }
      setMode("studying");
      const fd = new FormData();
      fd.append("file", blob, "audio.webm");
      const r = await fetch("/api/stt", { method: "POST", body: fd });
      const d = await r.json();
      if (d.text?.trim()) { setMode("standby"); void sendMessage(d.text.trim()); }
      else { setMode("standby"); }
    } catch {
      setMode("standby");
      setError("Falha ao capturar o comando de voz.");
    }
  }

  /** Modo tempo real (S2S premium via OpenAI Realtime). */
  async function toggleRealtime() {
    if (rtRef.current?.active) {
      rtRef.current.stop();
      rtRef.current = null;
      setRealtimeOn(false);
      setMode("standby");
      return;
    }
    // não mistura com o wake word local
    if (wakeRef.current?.active) { wakeRef.current.stop(); wakeRef.current = null; setWakeOn(false); }
    stopSpeaking();
    const rt = new RealtimeSession({
      onState: (s) => setMode(s === "speaking" ? "speaking" : s === "connecting" ? "connecting" : s === "listening" ? "listening" : "standby"),
      onError: () => { setError("Falha no modo tempo real."); rt.stop(); rtRef.current = null; setRealtimeOn(false); },
      onTranscript: (role, text) => setMessages((m) => [...m, { role, content: text }]),
    });
    try {
      setRealtimeOn(true);
      await rt.start();
      rtRef.current = rt;
    } catch (e) {
      setRealtimeOn(false);
      setError(e instanceof Error ? e.message : "Não foi possível iniciar o tempo real.");
    }
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
          stopSpeaking(); // barge-in ao ouvir "Ei Órbita" (libera o estado)
          if (modeRef.current === "standby") void voiceCommand();
        },
        // marca que estamos em modo voz (para a conversa continuar sem repetir o gatilho)
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
    fetch("/api/realtime/config").then((r) => r.json()).then((d) => setRealtimeEnabled(!!d.enabled)).catch(() => {});
    return () => { wakeRef.current?.stop(); ttsRef.current?.stop(); rtRef.current?.stop(); };
  }, []);

  useEffect(() => { logRef.current?.scrollTo({ top: logRef.current.scrollHeight }); }, [messages]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  async function send() {
    const content = input.trim();
    if (!content && !imageAttach) return;
    setInput("");
    void sendMessage(content || "O que há nesta imagem?");
  }

  async function sendMessage(content: string) {
    if (!content || mode !== "standby" || !modelKey) return;
    // modo privacidade: força modelo local, nada é enviado para nuvem
    const effectiveModelKey = privacyMode && !modelKey.startsWith("local/") ? "local/qwen2.5:7b" : modelKey;
    const imgToSend = imageAttach; // imagem anexada (uma vez); limpa o anexo
    if (imgToSend) setImageAttach(null);
    setError(null); setMode("studying");
    setMessages((m) => [...m, { role: "user", content }, { role: "assistant", content: "" }]);
    const started = Date.now();
    let spoke = false;

    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, modelKey: effectiveModelKey, conversationId: convId.current ?? undefined, rich: true, image: imgToSend ?? undefined }),
      });
      const cid = res.headers.get("x-conversation-id");
      if (cid) { convId.current = cid; setActiveId(cid); }
      const usedModel = res.headers.get("x-model") ?? modelKey;

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erro no servidor" }));
        throw new Error(err.error ?? "Erro no servidor");
      }

      // stream NDJSON: {t:'text'|'tool'|'tool-done'}. Reconstrói texto + timeline.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let buf = "";
      const steps: ToolStep[] = [];
      const flush = () =>
        setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc, steps: [...steps] }; return c; });
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { t: string; v?: string; name?: string };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "text") { acc += ev.v ?? ""; if (acc) setMode("speaking"); }
          else if (ev.t === "tool" && ev.name) { setMode("searching"); steps.push({ name: ev.name, done: false }); }
          else if (ev.t === "tool-done" && ev.name) { const s = steps.find((x) => x.name === ev.name && !x.done); if (s) s.done = true; }
          flush();
        }
      }

      // métricas da sessão (tokens estimados por chars quando não há usage do provedor).
      // A economia acumulada/persistida vem do EconomyPanel (/api/usage) — refetch via requests.
      const outTokens = Math.max(1, Math.ceil(acc.length / 4));
      setStats((s) => ({
        requests: s.requests + 1,
        tokens: s.tokens + outTokens,
        lastMs: Date.now() - started,
      }));

      if (voiceOn) {
        spoke = true;
        void speak(acc).then(() => {
          // conversa contínua mãos-livres: enquanto o wake está ativo, re-arma a
          // escuta por um follow-up (sem precisar repetir "Ei Órbita" a cada turno).
          if (wakeRef.current?.active && modeRef.current === "standby") void voiceCommand();
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro inesperado");
      setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
    } finally {
      if (!spoke) setMode("standby");
      loadConvs();
    }
  }

  return (
    <>
    <div className="grid w-full flex-1 gap-3 md:min-h-0 md:grid-cols-[220px_1fr_300px] xl:grid-cols-[260px_1fr_340px]">
      {/* LEFT RAIL */}
      <aside className="flex flex-col gap-3 md:min-h-0 md:overflow-y-auto md:pr-1">
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

        <Block id="provedor" hidden={hidden} toggle={toggle}>
        <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Provedor de IA</h3>
          <select value={privacyMode ? "local/qwen2.5:7b" : modelKey} disabled={privacyMode} onChange={(e) => setModelKey(e.target.value)}
            className="w-full rounded-lg border px-2 py-2 text-xs disabled:opacity-60"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }}>
            {/* Auto primeiro, depois cada provedor em seu grupo separado */}
            {!privacyMode && models.filter((m) => m.key === "auto").map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            {[
              { p: "local", label: "⚡ Local (grátis)" },
              { p: "claude", label: "🟠 Claude Max (assinatura)" },
              { p: "gateway", label: "☁ Gateway (pago)" },
            ].map((g) => {
              const opts = models.filter((m) => m.key !== "auto" && m.provider === g.p);
              if (!opts.length || (privacyMode && g.p !== "local")) return null;
              return (
                <optgroup key={g.p} label={g.label}>
                  {opts.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                </optgroup>
              );
            })}
          </select>
          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[11px]" style={{ color: privacyMode ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            <input type="checkbox" checked={privacyMode} onChange={(e) => setPrivacyMode(e.target.checked)} />
            🔒 Modo privacidade (força tudo local — nada sai da máquina)
          </label>
        </div>
        </Block>

        <Block id="memoria" hidden={hidden} toggle={toggle}><KnowledgePanel /></Block>
        <Block id="reuniao" hidden={hidden} toggle={toggle}><MeetingPanel /></Block>
        <Block id="privacidade" hidden={hidden} toggle={toggle}><PrivacyPanel email={userEmail} /></Block>

        <button onClick={async () => { await signOut(); router.push("/login"); }}
          className="rounded-lg border px-4 py-2 text-sm" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
          Sair
        </button>
      </aside>

      {/* CENTER STAGE */}
      <main className="relative flex h-[82vh] flex-col overflow-hidden rounded-2xl border md:h-full md:min-h-0" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
        <div className="absolute right-3 top-3 z-10 flex gap-2">
          <BlocksManager blocks={BLOCKS} hidden={hidden} toggle={toggle} />
          <a href="/insights" title="insights e grafo de conhecimento"
            className="rounded-lg border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
            📊 Insights
          </a>
          <button onClick={() => setFocus(true)} title="modo foco (tela cheia)"
            className="rounded-lg border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
            ⛶ Foco
          </button>
        </div>
        <div className="relative shrink-0">
          <Orb mode={mode} height={210} />
          <div className="absolute bottom-1 left-1/2 -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: "var(--color-ink-dim)" }}>
            {STATUS[mode]}
          </div>
        </div>

        <div ref={logRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="mt-6 text-center text-sm" style={{ color: "var(--color-ink-dim)" }}>
              Converse com a Órbita — rodando no seu Qwen 2.5 local.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "flex justify-end" : "flex flex-col items-start"}>
              {/* timeline de atividade: o que a Órbita está fazendo (passos com ⟳ → ✓) */}
              {m.role === "assistant" && m.steps && m.steps.length > 0 && (
                <div className="mb-1 flex flex-col gap-0.5">
                  {m.steps.map((s, k) => (
                    <div key={k} className="flex items-center gap-1.5 font-mono text-[10px]" style={{ color: s.done ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
                      <span>{s.done ? "✓" : "⟳"}</span>
                      <span>{toolLabel(s.name)}</span>
                    </div>
                  ))}
                </div>
              )}
              <div className="max-w-[85%] rounded-xl px-3 py-2 text-sm"
                style={{ background: m.role === "user" ? "color-mix(in oklab, var(--color-gold) 16%, var(--color-surface))" : "var(--color-ground)", border: "1px solid var(--color-line)", color: "var(--color-ink)" }}>
                {m.role === "assistant" && m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content || (mode !== "standby" && i === messages.length - 1 ? "…" : "")}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <p className="px-4 pb-1 text-xs" style={{ color: "#e0705a" }}>{error}</p>}

        <div className="flex shrink-0 flex-wrap items-center gap-2 border-t p-3" style={{ borderColor: "var(--color-line)" }}>
          <button onClick={() => setVoiceOn(!voiceOn)} title="voz da Órbita" className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: "var(--color-line)", color: voiceOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {voiceOn ? "🔊" : "🔇"}
          </button>
          <button onClick={toggleWake} title={wakeOn ? "wake word ativo — diga 'Ei Órbita'" : "ativar wake word 'Ei Órbita'"}
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: wakeOn ? "var(--color-gold)" : "var(--color-line)", color: wakeOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {wakeOn ? "👂" : "🕨"}
          </button>
          {realtimeEnabled && !privacyMode && (
            <button onClick={toggleRealtime} title={realtimeOn ? "encerrar conversa em tempo real" : "conversa por voz em tempo real (premium)"}
              className="rounded-lg border px-2.5 py-2 text-sm"
              style={{ borderColor: realtimeOn ? "var(--color-gold)" : "var(--color-line)", color: realtimeOn ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
              {realtimeOn ? "🔴" : "⚡"}
            </button>
          )}
          <input ref={audioFileRef} type="file" accept="audio/*" className="hidden"
            onChange={(e) => { const f = e.target.files?.[0]; if (f) void sendAudioFile(f); e.target.value = ""; }} />
          <button onClick={() => audioFileRef.current?.click()} title="enviar áudio para transcrever" className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
            🎵
          </button>
          <button onClick={seeScreen} title="deixar a Órbita ver sua tela" className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
            🖥️
          </button>
          <input ref={imageFileRef} type="file" accept="image/*" className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              if (f.size > 6_000_000) { setError("Imagem muito grande (máx. ~6 MB)."); return; }
              const r = new FileReader();
              r.onload = () => setImageAttach(String(r.result));
              r.readAsDataURL(f);
            }} />
          <button onClick={() => imageFileRef.current?.click()} title="anexar imagem (a Órbita responde sobre ela com o modelo de visão)"
            className="rounded-lg border px-2.5 py-2 text-sm"
            style={{ borderColor: imageAttach ? "var(--color-gold)" : "var(--color-line)", color: imageAttach ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            🖼️
          </button>
          {imageAttach && (
            <span className="relative inline-block shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={imageAttach} alt="anexo" className="h-9 w-9 rounded-lg border object-cover" style={{ borderColor: "var(--color-gold)" }} />
              <button onClick={() => setImageAttach(null)} title="remover imagem" aria-label="remover imagem"
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
                style={{ background: "#e0705a", color: "#fff" }}>×</button>
            </span>
          )}
          <input value={input} onChange={(e) => setInput(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder="Fale ou escreva…" className="flex-1 rounded-lg border px-3 py-2 text-sm outline-none"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }} />
          <button onClick={toggleMic} disabled={mode !== "standby" && !recording} title="falar" aria-label="microfone"
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ background: recording ? "#e0705a" : "var(--color-surface)", borderColor: "var(--color-line)" }}>
            {recording ? "⏹" : "🎙️"}
          </button>
          <button onClick={send} disabled={mode !== "standby" || (!input.trim() && !imageAttach)}
            className="rounded-lg px-4 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
            {mode !== "standby" ? "…" : "Enviar"}
          </button>
        </div>
      </main>

      {/* RIGHT RAIL */}
      <aside className="flex flex-col gap-3 md:min-h-0 md:overflow-y-auto md:pl-1">
        <Block id="widgets" hidden={hidden} toggle={toggle}><Widgets /></Block>
        <Block id="persona" hidden={hidden} toggle={toggle}><PersonaPanel /></Block>
        <Block id="sessao" hidden={hidden} toggle={toggle}>
          <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
            <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Sessão</h3>
            <Stat label="Requisições" value={String(stats.requests)} />
            <Stat label="Tokens (~saída)" value={stats.tokens.toLocaleString("pt-BR")} />
            <Stat label="Latência (última)" value={stats.lastMs ? stats.lastMs + "ms" : "—"} accent />
          </div>
        </Block>
        <Block id="custo" hidden={hidden} toggle={toggle}><EconomyPanel refreshKey={stats.requests} /></Block>
        <Block id="financas" hidden={hidden} toggle={toggle}><FinancePanel /></Block>
        <Block id="tarefas" hidden={hidden} toggle={toggle}><TodoPanel /></Block>
        <Block id="arquivos" hidden={hidden} toggle={toggle}><FolderPanel /></Block>
        <Block id="extensoes" hidden={hidden} toggle={toggle}><ExtensionsPanel /></Block>
        <ActionsPanel />
        <Block id="conectores" hidden={hidden} toggle={toggle}><ConnectorsPanel /></Block>
        <Block id="proatividade" hidden={hidden} toggle={toggle}><RoutinesPanel /></Block>
        <Block id="push" hidden={hidden} toggle={toggle}><PushToggle /></Block>
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

/** Liga/desliga notificações push do navegador (proatividade). */
function PushToggle() {
  const [status, setStatus] = useState<"unsupported" | "denied" | "off" | "on" | "loading">("loading");
  const [busy, setBusy] = useState(false);
  useEffect(() => { import("@/lib/push/client").then((m) => m.pushStatus()).then(setStatus).catch(() => setStatus("unsupported")); }, []);
  async function toggle() {
    setBusy(true);
    try {
      const m = await import("@/lib/push/client");
      if (status === "on") { await m.disablePush(); setStatus("off"); }
      else { const r = await m.enablePush(); setStatus(r.ok ? "on" : "off"); }
    } finally { setBusy(false); }
  }
  async function test() { await fetch("/api/push/test", { method: "POST" }); }
  if (status === "unsupported") return null;
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-2 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Notificações push</h3>
      {status === "denied" ? (
        <p className="text-[12px]" style={{ color: "var(--color-ink-dim)" }}>Permissão bloqueada no navegador. Libere nas configurações do site para receber avisos.</p>
      ) : (
        <div className="flex items-center gap-2">
          <button onClick={toggle} disabled={busy || status === "loading"}
            className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ borderColor: status === "on" ? "var(--color-gold)" : "var(--color-line)", color: status === "on" ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {busy ? "…" : status === "on" ? "🔔 Ativas" : "🔕 Ativar"}
          </button>
          {status === "on" && (
            <button onClick={test} className="rounded-lg border px-3 py-2 text-sm" style={{ borderColor: "var(--color-line)", color: "var(--color-ink-dim)" }}>
              Testar
            </button>
          )}
        </div>
      )}
    </div>
  );
}

type ProfileT = { assistantName: string; userName: string | null; persona: string | null };

/** Persona configurável: nome da assistente, como te chamar e tom/estilo. */
function PersonaPanel() {
  const [p, setP] = useState<ProfileT | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    fetch("/api/profile").then((r) => (r.ok ? r.json() : null)).then((d) => {
      if (d?.profile) setP({ assistantName: d.profile.assistantName ?? "Órbita", userName: d.profile.userName ?? "", persona: d.profile.persona ?? "" });
    }).catch(() => {});
  }, []);
  async function save() {
    if (!p) return;
    setSaving(true); setSaved(false);
    try {
      const r = await fetch("/api/profile", {
        method: "PUT", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ assistantName: p.assistantName || "Órbita", userName: p.userName || null, persona: p.persona || null }),
      });
      if (r.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); }
    } finally { setSaving(false); }
  }
  const field = { borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" };
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Persona</h3>
      {!p ? (
        <div className="py-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>—</div>
      ) : (
        <div className="flex flex-col gap-2">
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Nome da assistente</label>
          <input value={p.assistantName} onChange={(e) => setP({ ...p, assistantName: e.target.value })} maxLength={40}
            className="rounded-lg border px-3 py-2 text-sm outline-none" style={field} placeholder="Órbita" />
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Como te chamar</label>
          <input value={p.userName ?? ""} onChange={(e) => setP({ ...p, userName: e.target.value })} maxLength={40}
            className="rounded-lg border px-3 py-2 text-sm outline-none" style={field} placeholder="opcional" />
          <label className="text-[11px]" style={{ color: "var(--color-ink-dim)" }}>Tom & preferências</label>
          <textarea value={p.persona ?? ""} onChange={(e) => setP({ ...p, persona: e.target.value })} maxLength={2000} rows={3}
            className="resize-y rounded-lg border px-3 py-2 text-sm outline-none" style={field}
            placeholder="Ex.: seja direto e objetivo; me trate por você; evite jargão." />
          <button onClick={save} disabled={saving}
            className="mt-1 rounded-lg px-3 py-2 text-sm font-semibold disabled:opacity-50"
            style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
            {saving ? "Salvando…" : saved ? "Salvo ✓" : "Salvar persona"}
          </button>
        </div>
      )}
    </div>
  );
}

type Usage = {
  requests: number; tokensTotal: number; localRequests: number; cloudRequests: number;
  economiaBRL: number; cloudSpentBRL: number; energyWhEstimate: number; energyCostBRL: number; liquidoBRL: number;
  assumptions: { LOCAL_WATTS: number; KWH_PRICE_BRL: number };
};

/** Economia acumulada vs. nuvem — dados reais persistidos (/api/usage). */
function EconomyPanel({ refreshKey }: { refreshKey: number }) {
  const [u, setU] = useState<Usage | null>(null);
  useEffect(() => {
    let alive = true;
    fetch("/api/usage").then((r) => (r.ok ? r.json() : null)).then((d) => { if (alive && d) setU(d); }).catch(() => {});
    return () => { alive = false; };
  }, [refreshKey]);
  const money = (n: number) => "R$" + n.toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  const pctLocal = u && u.requests ? Math.round((u.localRequests / u.requests) * 100) : 0;
  return (
    <div className="rounded-2xl border p-4" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
      <h3 className="mb-3 font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Economia vs. nuvem</h3>
      {!u ? (
        <div className="py-2 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>—</div>
      ) : (
        <>
          <Stat label="Respostas locais" value={`${u.localRequests}/${u.requests} (${pctLocal}%)`} />
          <Stat label="Tokens (~saída)" value={u.tokensTotal.toLocaleString("pt-BR")} />
          <Stat label="Energia local (est.)" value={`${u.energyWhEstimate.toLocaleString("pt-BR", { maximumFractionDigits: 2 })} Wh`} />
          <Stat label="Custo da energia (est.)" value={money(u.energyCostBRL)} />
          {u.cloudSpentBRL > 0 && <Stat label="Gasto em nuvem paga" value={money(u.cloudSpentBRL)} accent />}
          <div className="mt-3 rounded-xl border p-3" style={{ borderColor: "color-mix(in oklab, var(--color-gold) 30%, transparent)", background: "color-mix(in oklab, var(--color-gold) 12%, transparent)" }}>
            <div className="font-mono text-[10px] uppercase" style={{ color: "var(--color-gold)" }}>você economizou</div>
            <div className="mt-1 text-xl font-bold">{money(u.economiaBRL)} <span className="text-xs" style={{ color: "var(--color-ink-dim)" }}>vs. pagar por uso</span></div>
            <div className="mt-1 text-[11px]" style={{ color: "var(--color-ink-dim)" }}>líquido de energia: <b>{money(u.liquidoBRL)}</b></div>
          </div>
          <p className="mt-2 text-[10px] leading-snug" style={{ color: "var(--color-ink-dim)" }}>
            Estimativa: energia a {u.assumptions.LOCAL_WATTS}W · {money(u.assumptions.KWH_PRICE_BRL)}/kWh (sem GPU dedicada, valor configurável). Economia = preço de referência da nuvem para respostas locais/Max.
          </p>
        </>
      )}
    </div>
  );
}
