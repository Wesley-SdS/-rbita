"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Orb, type OrbMode } from "@/components/orb";
import { Markdown } from "@/components/markdown";
import { Block, BlocksManager, useHiddenBlocks } from "@/components/block";
import { Stat } from "@/components/stat";
import { Card, PanelTitle, Skeleton } from "@/components/ui";
import { IconVolume, IconVolumeOff, IconMic, IconStop, IconChat, IconMenu, IconClose, IconSend } from "@/components/ui/icons";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth-client";
import type { ModelInfo, VoiceBridge } from "@/components/console/types";
import { useOrbMode } from "@/components/console/use-orb-mode";
import { useConversations } from "@/components/console/use-conversations";
import { useChatStream } from "@/components/console/use-chat-stream";
import { useVoice } from "@/components/console/use-voice";

// Painéis pesados / abaixo da dobra: code-split (só baixam o JS quando entram em cena).
// Reduz o bundle inicial do /app e acelera a primeira renderização do chat.
function PanelSkeleton() {
  return <Skeleton />;
}

const KnowledgePanel = dynamic(() => import("@/components/knowledge-panel").then((m) => m.KnowledgePanel), { ssr: false, loading: PanelSkeleton });
const PrivacyPanel = dynamic(() => import("@/components/privacy-panel").then((m) => m.PrivacyPanel), { ssr: false, loading: PanelSkeleton });
const RoutinesPanel = dynamic(() => import("@/components/routines-panel").then((m) => m.RoutinesPanel), { ssr: false, loading: PanelSkeleton });
const ConnectorsPanel = dynamic(() => import("@/components/connectors-panel").then((m) => m.ConnectorsPanel), { ssr: false, loading: PanelSkeleton });
const MeetingPanel = dynamic(() => import("@/components/meeting-panel").then((m) => m.MeetingPanel), { ssr: false, loading: PanelSkeleton });
const FinancePanel = dynamic(() => import("@/components/finance-panel").then((m) => m.FinancePanel), { ssr: false, loading: PanelSkeleton });
const TodoPanel = dynamic(() => import("@/components/todo-panel").then((m) => m.TodoPanel), { ssr: false, loading: PanelSkeleton });
const FolderPanel = dynamic(() => import("@/components/folder-panel").then((m) => m.FolderPanel), { ssr: false, loading: PanelSkeleton });
const ActionsPanel = dynamic(() => import("@/components/actions-panel").then((m) => m.ActionsPanel), { ssr: false, loading: PanelSkeleton });
const ExtensionsPanel = dynamic(() => import("@/components/extensions-panel").then((m) => m.ExtensionsPanel), { ssr: false, loading: PanelSkeleton });
const Widgets = dynamic(() => import("@/components/widgets").then((m) => m.Widgets), { ssr: false, loading: PanelSkeleton });
const PersonaPanel = dynamic(() => import("@/components/side-panels").then((m) => m.PersonaPanel), { ssr: false, loading: PanelSkeleton });
const EconomyPanel = dynamic(() => import("@/components/side-panels").then((m) => m.EconomyPanel), { ssr: false, loading: PanelSkeleton });
const PushToggle = dynamic(() => import("@/components/side-panels").then((m) => m.PushToggle), { ssr: false, loading: PanelSkeleton });

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

/**
 * Botão circular translúcido do modo foco. Vidro fosco + traço fino em vez de
 * caixa com borda e emoji, que dava aparência datada.
 */
function GhostBtn({ children, onClick, label, active, className = "" }: {
  children: ReactNode; onClick: () => void; label: string; active?: boolean; className?: string;
}) {
  return (
    <button onClick={onClick} title={label} aria-label={label}
      className={`flex h-9 w-9 items-center justify-center rounded-full transition-all duration-200 hover:scale-105 ${className}`}
      style={{
        background: active ? "color-mix(in oklab, var(--color-gold) 16%, transparent)" : "rgba(255,255,255,0.05)",
        border: `1px solid ${active ? "color-mix(in oklab, var(--color-gold) 45%, transparent)" : "rgba(255,255,255,0.09)"}`,
        color: active ? "var(--color-gold)" : "rgba(255,236,205,0.62)",
        backdropFilter: "blur(10px)",
      }}>
      {children}
    </button>
  );
}

/** Item do menu "+" do compositor. */
function MenuItem({ icon, label, onClick, active }: { icon: string; label: string; onClick: () => void; active?: boolean }) {
  return (
    <button onClick={onClick}
      className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] hover:opacity-90"
      style={{ color: active ? "var(--color-gold)" : "var(--color-ink)", background: active ? "color-mix(in oklab, var(--color-gold) 12%, transparent)" : "transparent" }}>
      <span className="w-5 text-center">{icon}</span>
      <span>{label}</span>
    </button>
  );
}

export function Console({
  userName,
  userEmail,
  initialModels = [],
  initialDefaultModel = "",
  initialConvs = [],
}: {
  userName: string;
  userEmail: string;
  initialModels?: ModelInfo[];
  initialDefaultModel?: string;
  initialConvs?: { id: string; title: string }[];
}) {
  const router = useRouter();
  const [models] = useState<ModelInfo[]>(initialModels);
  const [modelKey, setModelKey] = useState(initialDefaultModel || initialModels[0]?.key || "");
  const [error, setError] = useState<string | null>(null);
  const [privacyMode, setPrivacyMode] = useState(false); // força tudo local (nada vai p/ nuvem)
  const [focus, setFocus] = useState(false);
  const [focusChat, setFocusChat] = useState(false); // painel de conversa lateral (modo foco)
  const focusLogRef = useRef<HTMLDivElement>(null);
  const [plusOpen, setPlusOpen] = useState(false); // menu "+" do compositor
  const imageFileRef = useRef<HTMLInputElement | null>(null);
  const { hidden, toggle } = useHiddenBlocks(); // blocos que o usuário ocultou

  const { mode, setMode, modeRef } = useOrbMode();
  const { messages, setMessages, convs, activeId, setActiveId, convId, loadConvs, loadConversation, newConversation, deleteConv } =
    useConversations(initialConvs);

  // Pontes chat↔voz por ref (evitam o ciclo de dependência e o stale-closure do
  // callback do wake word). São reatribuídas a cada render — sempre a closure atual.
  const voiceRef = useRef<VoiceBridge | null>(null);
  const sendMessageRef = useRef<((content: string) => void) | null>(null);

  const chat = useChatStream({
    modelKey, privacyMode, modeRef, setMode, setError,
    setMessages, convId, setActiveId, loadConvs, voiceRef,
  });
  const voice = useVoice({
    modeRef, setMode, setError, setMessages,
    input: chat.input, setInput: chat.setInput, sendMessageRef,
  });

  useEffect(() => { sendMessageRef.current = chat.sendMessage; });
  useEffect(() => { voiceRef.current = { handleAssistantResponse: voice.handleAssistantResponse, stopSpeaking: voice.stopSpeaking }; });

  useEffect(() => { chat.logRef.current?.scrollTo({ top: chat.logRef.current.scrollHeight }); }, [messages, chat.logRef]);

  // No celular abre direto no MODO FOCO (limpo, voz-primeiro); no desktop começa no dashboard.
  useEffect(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) setFocus(true);
  }, []);

  // última resposta da Órbita (mostrada no centro quando o painel está fechado)
  const lastReply = [...messages].reverse().find((m) => m.role === "assistant" && m.content)?.content ?? "";

  // rola o painel lateral para a mensagem mais recente
  useEffect(() => {
    if (focusChat) focusLogRef.current?.scrollTo({ top: focusLogRef.current.scrollHeight });
  }, [messages, focusChat]);

  return (
    <>
    <div className="grid w-full flex-1 gap-3 md:min-h-0 md:grid-cols-[220px_1fr_300px] xl:grid-cols-[260px_1fr_340px]">
      {/* LEFT RAIL */}
      <aside className="flex flex-col gap-3 md:min-h-0 md:overflow-y-auto md:pr-1">
        <div className="rounded-2xl border p-3" style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
          <div className="flex items-center">
            <h3 className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Conversas</h3>
            <button onClick={() => { newConversation(); setError(null); }} className="ml-auto text-xs" style={{ color: "var(--color-gold)" }}>＋ Nova</button>
          </div>
          <div className="mt-2 flex max-h-40 flex-col gap-1 overflow-y-auto">
            {convs.length === 0 && <span className="text-[10px]" style={{ color: "var(--color-ink-dim)" }}>nenhuma ainda</span>}
            {convs.map((c) => (
              <div key={c.id} className="group flex items-center gap-1">
                <button onClick={() => loadConversation(c.id)} className="flex-1 truncate text-left text-xs"
                  style={{ color: activeId === c.id ? "var(--color-gold)" : "var(--color-ink-dim)" }}>{c.title}</button>
                <button onClick={() => deleteConv(c.id)} title="apagar" className="text-xs opacity-40 hover:opacity-100" style={{ color: "var(--color-danger)" }}>×</button>
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
        <Card>
          <PanelTitle className="mb-2">Provedor de IA</PanelTitle>
          <select value={privacyMode ? "local/qwen2.5:7b" : modelKey} disabled={privacyMode} onChange={(e) => setModelKey(e.target.value)}
            className="w-full rounded-lg border px-2 py-2 text-xs disabled:opacity-60"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }}>
            {/* Auto primeiro, depois cada provedor em seu grupo separado */}
            {!privacyMode && models.filter((m) => m.key === "auto").map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
            {[
              { p: "local", label: "⚡ Local (grátis)" },
              { p: "claude", label: "🟠 Claude Max (assinatura)" },
              { p: "groq", label: "🚀 Groq (rápido, barato)" },
              { p: "google", label: "🔵 Google Gemini" },
              { p: "openai", label: "🟢 OpenAI" },
              { p: "cohere", label: "🟣 Cohere" },
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
        </Card>
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
          <ThemeToggle />
          <Link href="/insights" prefetch title="insights e grafo de conhecimento"
            className="rounded-lg border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
            📊 Insights
          </Link>
          <button onClick={() => setFocus(true)} title="modo foco (tela cheia)"
            className="rounded-lg border px-2.5 py-1 text-xs"
            style={{ borderColor: "var(--color-line)", background: "var(--color-surface)", color: "var(--color-ink-dim)" }}>
            ⛶ Foco
          </button>
        </div>
        <div className="relative shrink-0 h-[42vh] min-h-[300px]"
          style={{ background: "radial-gradient(circle at 50% 48%, #1a1206 0%, #0d0904 55%, transparent 100%)" }}>
          <Orb mode={mode} fill bare />
          <div className="absolute bottom-2 left-1/2 -translate-x-1/2 font-mono text-[11px] uppercase tracking-[0.16em]" style={{ color: mode !== "standby" ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
            {STATUS[mode]}{mode !== "standby" && chat.elapsed > 0 ? ` · ${chat.elapsed}s` : ""}
          </div>
        </div>

        <div ref={chat.logRef} aria-live="polite" aria-atomic="false" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          {messages.length === 0 && (
            <p className="mt-6 text-center text-sm" style={{ color: "var(--color-ink-dim)" }}>
              Converse com a Órbita. Fale pelo microfone ou escreva abaixo.
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
                {m.image && (
                  // miniatura do anexo enviado na própria bolha
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={m.image} alt="anexo" className="mb-2 max-h-48 rounded-lg border object-contain" style={{ borderColor: "var(--color-line)" }} />
                )}
                {m.role === "assistant" && m.content ? (
                  <Markdown>{m.content}</Markdown>
                ) : mode !== "standby" && i === messages.length - 1 ? (
                  <span className="flex items-center gap-2" style={{ color: "var(--color-ink-dim)" }}>
                    <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-gold)" }} />
                    <span>{STATUS[mode]}</span>
                    {chat.elapsed > 0 && <span className="font-mono text-xs" style={{ color: "var(--color-ink-dim)" }}>{chat.elapsed}s</span>}
                  </span>
                ) : (
                  <span className="whitespace-pre-wrap">{m.content}</span>
                )}
              </div>
            </div>
          ))}
        </div>

        {error && <p role="alert" className="px-4 pb-1 text-xs" style={{ color: "var(--color-danger)" }}>{error}</p>}

        {/* inputs de arquivo ocultos (acionados pelo menu "+") */}
        <input ref={voice.audioFileRef} type="file" accept="audio/*" className="hidden"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) void voice.sendAudioFile(f); e.target.value = ""; }} />
        <input ref={imageFileRef} type="file" accept="image/*" className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0]; e.target.value = "";
            if (!f) return;
            if (f.size > 6_000_000) { setError("Imagem muito grande (máx. ~6 MB)."); return; }
            const r = new FileReader();
            r.onload = () => chat.setImageAttach(String(r.result));
            r.readAsDataURL(f);
          }} />

        <div className="flex shrink-0 items-end gap-2 border-t p-3" style={{ borderColor: "var(--color-line)" }}>
          {/* menu "+" — consolida voz, ouvir, áudio, ver tela, imagem, tempo real */}
          <div className="relative shrink-0">
            <button onClick={() => setPlusOpen((v) => !v)} title="mais opções" aria-label="mais opções" aria-expanded={plusOpen}
              className="rounded-lg border px-3 py-2 text-lg leading-none"
              style={{ borderColor: plusOpen ? "var(--color-gold)" : "var(--color-line)", color: plusOpen ? "var(--color-gold)" : "var(--color-ink-dim)" }}>
              ＋
            </button>
            {plusOpen && (
              <>
                {/* clique fora fecha */}
                <div className="fixed inset-0 z-10" onClick={() => setPlusOpen(false)} />
                <div className="absolute bottom-12 left-0 z-20 w-56 rounded-xl border p-1 shadow-lg"
                  style={{ borderColor: "var(--color-line)", background: "var(--color-surface)" }}>
                  <MenuItem icon={voice.voiceOn ? "🔊" : "🔇"} label={voice.voiceOn ? "Voz da Órbita: ligada" : "Voz da Órbita: desligada"} active={voice.voiceOn}
                    onClick={() => voice.setVoiceOn(!voice.voiceOn)} />
                  <MenuItem icon={voice.wakeOn ? "👂" : "🕨"} label={voice.wakeOn ? "Parar de ouvir" : 'Ouvir "Ei Órbita"'} active={voice.wakeOn}
                    onClick={() => { setPlusOpen(false); void voice.toggleWake(); }} />
                  <MenuItem icon="🖼️" label="Anexar imagem" active={!!chat.imageAttach}
                    onClick={() => { setPlusOpen(false); imageFileRef.current?.click(); }} />
                  <MenuItem icon="🎵" label="Enviar áudio p/ transcrever"
                    onClick={() => { setPlusOpen(false); voice.audioFileRef.current?.click(); }} />
                  <MenuItem icon="🖥️" label="Ver minha tela"
                    onClick={() => { setPlusOpen(false); void voice.seeScreen(); }} />
                  {voice.realtimeEnabled && !privacyMode && (
                    <MenuItem icon={voice.realtimeOn ? "🔴" : "⚡"} label={voice.realtimeOn ? "Encerrar tempo real" : "Conversa em tempo real"} active={voice.realtimeOn}
                      onClick={() => { setPlusOpen(false); void voice.toggleRealtime(); }} />
                  )}
                </div>
              </>
            )}
          </div>

          {chat.imageAttach && (
            <span className="relative mb-0.5 inline-block shrink-0">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={chat.imageAttach} alt="anexo" className="h-9 w-9 rounded-lg border object-cover" style={{ borderColor: "var(--color-gold)" }} />
              <button onClick={() => chat.setImageAttach(null)} title="remover imagem" aria-label="remover imagem"
                className="absolute -right-1 -top-1 flex h-4 w-4 items-center justify-center rounded-full text-[10px] leading-none"
                style={{ background: "var(--color-danger)", color: "#fff" }}>×</button>
            </span>
          )}

          <textarea
            ref={chat.taRef}
            value={chat.input}
            rows={1}
            onChange={(e) => { chat.setInput(e.target.value); chat.autoGrow(e.target); }}
            onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); chat.send(); } }}
            placeholder="Fale ou escreva…  (Enter envia · Shift+Enter quebra linha)"
            className="max-h-40 min-h-[42px] flex-1 resize-none rounded-lg border px-3 py-2.5 text-sm outline-none"
            style={{ borderColor: "var(--color-line)", background: "var(--color-ground)", color: "var(--color-ink)" }}
          />

          <button onClick={voice.toggleMic} disabled={mode !== "standby" && !voice.recording} title="falar" aria-label="microfone"
            className="shrink-0 rounded-lg border px-3 py-2 text-sm disabled:opacity-50"
            style={{ background: voice.recording ? "var(--color-danger)" : "var(--color-surface)", borderColor: "var(--color-line)" }}>
            {voice.recording ? "⏹" : "🎙️"}
          </button>
          {mode !== "standby" ? (
            <button onClick={chat.stopGenerating} title="parar a resposta" aria-label="parar"
              className="shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold"
              style={{ background: "var(--color-danger)", color: "#fff" }}>
              ⏹ Parar
            </button>
          ) : (
            <button onClick={chat.send} disabled={!chat.input.trim() && !chat.imageAttach}
              className="shrink-0 rounded-lg px-4 py-2.5 text-sm font-semibold disabled:opacity-50"
              style={{ background: "linear-gradient(120deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
              Enviar
            </button>
          )}
        </div>
      </main>

      {/* RIGHT RAIL */}
      <aside className="flex flex-col gap-3 md:min-h-0 md:overflow-y-auto md:pl-1">
        <Block id="widgets" hidden={hidden} toggle={toggle}><Widgets /></Block>
        <Block id="persona" hidden={hidden} toggle={toggle}><PersonaPanel /></Block>
        <Block id="sessao" hidden={hidden} toggle={toggle}>
          <Card>
            <PanelTitle className="mb-3">Sessão</PanelTitle>
            <Stat label="Requisições" value={String(chat.stats.requests)} />
            <Stat label="Tokens (~saída)" value={chat.stats.tokens.toLocaleString("pt-BR")} />
            <Stat label="Latência (última)" value={chat.stats.lastMs ? chat.stats.lastMs + "ms" : "—"} accent />
          </Card>
        </Block>
        <Block id="custo" hidden={hidden} toggle={toggle}><EconomyPanel refreshKey={chat.stats.requests} /></Block>
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
      <div className="fixed inset-0 z-50 flex" style={{ background: "#0a0703" }}>
        {/* palco do Orb — encolhe quando o painel de conversa abre */}
        <div className="relative min-w-0 flex-1">
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

          <GhostBtn className="absolute left-5 top-6 z-20" onClick={() => setFocus(false)} label="abrir painéis"><IconMenu /></GhostBtn>
          <GhostBtn className="absolute right-5 top-6 z-20" onClick={() => setFocus(false)} label="sair do modo foco"><IconClose /></GhostBtn>

          {/* resposta mais recente ao centro — só quando o painel está recolhido */}
          {lastReply && !focusChat && (
            <div className="absolute left-6 right-6 top-1/2 z-10 max-h-[26vh] -translate-y-1/2 overflow-y-auto rounded-2xl px-5 py-4 text-center text-[15px] leading-relaxed"
              style={{ color: "var(--color-ink)", background: "rgba(8,5,2,0.5)", backdropFilter: "blur(6px)" }}>
              {lastReply}
            </div>
          )}

          <div className="pointer-events-none absolute bottom-28 left-0 right-0 z-10 flex items-center justify-center gap-3 font-mono text-xs uppercase" style={{ letterSpacing: "0.28em", color: "#ffcf8a", textShadow: "0 0 16px rgba(255,160,50,0.5)" }}>
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: "#ffcf8a", boxShadow: "0 0 10px #ffcf8a" }} />
            {STATUS[mode]}{mode !== "standby" && chat.elapsed > 0 ? ` · ${chat.elapsed}s` : ""}
          </div>

          {/* controles: voz · microfone (ou parar) · conversa */}
          <div className="absolute bottom-8 left-0 right-0 z-20 flex items-center justify-center gap-7">
            <GhostBtn onClick={() => voice.setVoiceOn(!voice.voiceOn)} active={voice.voiceOn}
              label={voice.voiceOn ? "desligar a voz" : "ligar a voz"}>
              {voice.voiceOn ? <IconVolume /> : <IconVolumeOff />}
            </GhostBtn>
            <button onClick={mode !== "standby" ? chat.stopGenerating : voice.toggleMic}
              title={mode !== "standby" ? "parar" : "falar com a Órbita"} aria-label={mode !== "standby" ? "parar" : "microfone"}
              className="flex h-[54px] w-[54px] items-center justify-center rounded-full transition-transform duration-200 hover:scale-105"
              style={{
                background: voice.recording || mode !== "standby" ? "var(--color-danger)" : "linear-gradient(135deg, var(--color-amber), var(--color-gold))",
                color: voice.recording || mode !== "standby" ? "#fff" : "#241403",
                boxShadow: voice.recording || mode !== "standby" ? "0 0 26px rgba(224,112,90,0.45)" : "0 0 26px rgba(245,181,68,0.4)",
              }}>
              {voice.recording || mode !== "standby" ? <IconStop size={17} /> : <IconMic size={21} />}
            </button>
            <GhostBtn onClick={() => setFocusChat((v) => !v)} active={focusChat} label="conversa"><IconChat /></GhostBtn>
          </div>
        </div>

        {/* painel de conversa: transcrições + digitação, recolhível */}
        {focusChat && (
          <aside className="flex w-full max-w-[380px] shrink-0 flex-col border-l"
            style={{ borderColor: "rgba(255,255,255,0.07)", background: "rgba(8,5,2,0.92)", backdropFilter: "blur(14px)" }}>
            <header className="flex shrink-0 items-center border-b px-4 py-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <span className="font-mono text-[10px] uppercase tracking-widest" style={{ color: "var(--color-ink-dim)" }}>Conversa</span>
              <button onClick={() => setFocusChat(false)} aria-label="recolher conversa" title="recolher"
                className="ml-auto rounded-full p-1.5" style={{ color: "var(--color-ink-dim)" }}>
                <IconClose size={16} />
              </button>
            </header>

            <div ref={focusLogRef} aria-live="polite" className="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
              {messages.length === 0 && (
                <p className="mt-8 text-center text-sm" style={{ color: "var(--color-ink-dim)" }}>Fale ou escreva para começar.</p>
              )}
              {messages.map((m, i) => (
                <div key={i} className={m.role === "user" ? "flex justify-end" : "flex justify-start"}>
                  <div className="max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed"
                    style={{
                      background: m.role === "user" ? "color-mix(in oklab, var(--color-gold) 15%, transparent)" : "rgba(255,255,255,0.05)",
                      color: "var(--color-ink)",
                    }}>
                    {m.image && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={m.image} alt="anexo" className="mb-2 max-h-40 rounded-lg object-contain" />
                    )}
                    {m.role === "assistant" && m.content ? (
                      <Markdown>{m.content}</Markdown>
                    ) : m.content ? (
                      <span className="whitespace-pre-wrap">{m.content}</span>
                    ) : (
                      <span className="inline-block h-2 w-2 animate-pulse rounded-full" style={{ background: "var(--color-gold)" }} />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="flex shrink-0 items-end gap-2 border-t p-3" style={{ borderColor: "rgba(255,255,255,0.07)" }}>
              <textarea value={chat.input} rows={1} autoFocus placeholder="Escreva para a Órbita…"
                onChange={(e) => { chat.setInput(e.target.value); chat.autoGrow(e.target); }}
                onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) { e.preventDefault(); chat.send(); } }}
                className="max-h-32 min-h-[42px] flex-1 resize-none rounded-xl px-3.5 py-2.5 text-sm outline-none"
                style={{ background: "rgba(255,255,255,0.05)", border: "1px solid rgba(255,255,255,0.09)", color: "var(--color-ink)" }} />
              <button onClick={() => chat.send()} disabled={!chat.input.trim()} aria-label="enviar" title="enviar"
                className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-xl transition-transform hover:scale-105 disabled:opacity-40 disabled:hover:scale-100"
                style={{ background: "linear-gradient(135deg, var(--color-amber), var(--color-gold))", color: "#241403" }}>
                <IconSend />
              </button>
            </div>
          </aside>
        )}
      </div>
    )}
    </>
  );
}
