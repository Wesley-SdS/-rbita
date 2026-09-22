"use client";

import { memo, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import { useSearchParams } from "next/navigation";
import { Icone } from "./icones";
import { useCasca } from "./contexto";
import { Markdown } from "@/components/markdown";
import type { ModelInfo, Msg, VoiceBridge } from "@/components/console/types";
import type { OrbMode } from "@/components/console/types";
import { useOrbMode } from "@/components/console/use-orb-mode";
import { useConversations } from "@/components/console/use-conversations";
import { useChatStream } from "@/components/console/use-chat-stream";
import { useVoice } from "@/components/console/use-voice";

const ActionsPanel = dynamic(() => import("@/components/actions-panel").then((m) => m.ActionsPanel), { ssr: false });

/**
 * O núcleo antigo tinha 6 estados; o do Presença tem 10. Os seis casam, e os
 * quatro que sobram (executando, concluído, sua decisão, imprevisto) ainda não
 * têm origem no caminho do chat: vão chegar do gate de aprovação e do fim de
 * execução de ferramenta, não de um `setState` solto aqui.
 */
const ROTULO_DO_MODO: Record<OrbMode, string> = {
  standby: "em espera",
  studying: "processando…",
  speaking: "respondendo…",
  searching: "pesquisando…",
  listening: "ouvindo…",
  connecting: "conectando…",
};

const NOMES_DE_FERRAMENTA: Record<string, string> = {
  buscar_conhecimento: "consultando sua memória",
  registrar_gasto: "registrando o gasto",
  contas_a_vencer: "conferindo as contas",
  criar_tarefa: "criando a tarefa",
  listar_tarefas: "lendo suas tarefas",
  lembrar: "guardando na memória",
};

const rotuloDaFerramenta = (nome: string) => NOMES_DE_FERRAMENTA[nome] ?? nome.replace(/_/g, " ");

/**
 * Uma bolha, MEMOIZADA. Durante o streaming só o último objeto de `messages`
 * troca de referência, então apenas a última bolha re-renderiza e as antigas
 * pulam o reparse de markdown.
 */
const Bolha = memo(function Bolha({ m, estado }: { m: Msg; estado: string | null }) {
  const daOrbita = m.role === "assistant";
  return (
    <div className={`message ${daOrbita ? "assistant" : "user"}`}>
      {daOrbita && <span className="mini-orb" />}
      <div className="message-body">
        <div className="message-author">{daOrbita ? "Órbita" : "Você"}</div>
        {m.image && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.image} alt="anexo" className="message-image" />
        )}
        {m.steps?.length ? (
          <div className="message-steps">
            {m.steps.map((s, i) => (
              <span key={i} className={`tag ${s.done ? "green" : ""}`}>
                <Icone nome={s.done ? "check" : "clock"} />
                {rotuloDaFerramenta(s.name)}
              </span>
            ))}
          </div>
        ) : null}
        {daOrbita ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
        {estado && (
          <div className="message-status">
            <span className="typing-dot" />
            <span className="typing-dot" />
            <span className="typing-dot" />
            {estado}
          </div>
        )}
      </div>
    </div>
  );
});

export function Conversa({
  modelosIniciais = [],
  modeloPadrao = "",
  conversasIniciais = [],
}: {
  modelosIniciais?: ModelInfo[];
  modeloPadrao?: string;
  conversasIniciais?: { id: string; title: string }[];
}) {
  const parametros = useSearchParams();
  const casca = useCasca();
  const [modelos] = useState<ModelInfo[]>(modelosIniciais);
  const [chaveModelo, setChaveModelo] = useState(modeloPadrao || modelosIniciais[0]?.key || "");
  const [erro, setErro] = useState<string | null>(null);
  const [modoLocal, setModoLocal] = useState(false);
  const [maisAberto, setMaisAberto] = useState(false);
  const imagemRef = useRef<HTMLInputElement | null>(null);

  // Agrupa uma vez: refiltrar a cada render custava caro durante o streaming.
  const grupos = useMemo(() => {
    const porProvedor = new Map<string, ModelInfo[]>();
    for (const m of modelos) {
      if (m.key === "auto") continue;
      const lista = porProvedor.get(m.provider);
      if (lista) lista.push(m);
      else porProvedor.set(m.provider, [m]);
    }
    return { auto: modelos.filter((m) => m.key === "auto"), porProvedor };
  }, [modelos]);

  const { mode, setMode, modeRef } = useOrbMode();
  const { messages, setMessages, convs, activeId, convId, loadConvs, loadConversation, newConversation, deleteConv } =
    useConversations(conversasIniciais);

  const pontesVoz = useRef<VoiceBridge | null>(null);
  const enviarRef = useRef<((conteudo: string) => void) | null>(null);

  const chat = useChatStream({
    modelKey: chaveModelo,
    privacyMode: modoLocal,
    modeRef,
    setMode,
    setError: setErro,
    setMessages,
    convId,
    setActiveId: () => {},
    loadConvs,
    voiceRef: pontesVoz,
  });
  const voz = useVoice({
    modeRef,
    setMode,
    setError: setErro,
    setMessages,
    input: chat.input,
    setInput: chat.setInput,
    sendMessageRef: enviarRef,
  });

  useEffect(() => {
    enviarRef.current = chat.sendMessage;
  });
  useEffect(() => {
    pontesVoz.current = { handleAssistantResponse: voz.handleAssistantResponse, stopSpeaking: voz.stopSpeaking };
  });

  // O modo foco tem voz própria e abre por cima desta tela. Aqui dizemos à
  // casca como soltar o microfone, senão os dois reconhecedores disputam o
  // mesmo aparelho e nenhum ouve direito.
  useEffect(() => {
    casca.registrarPausaDeVoz(() => {
      voz.stopSpeaking();
      if (voz.wakeOn) void voz.toggleWake();
      if (voz.realtimeOn) void voz.toggleRealtime();
    });
    return () => casca.registrarPausaDeVoz(null);
  });

  useEffect(() => {
    chat.logRef.current?.scrollTo({ top: chat.logRef.current.scrollHeight });
  }, [messages, chat.logRef]);

  // A Visão geral manda para cá com a intenção já escolhida: foco, voz, ou uma
  // pergunta pronta. Roda uma vez, senão reenviaria a pergunta a cada render.
  const intencaoAplicada = useRef(false);
  useEffect(() => {
    if (intencaoAplicada.current) return;
    intencaoAplicada.current = true;
    if (parametros?.get("foco")) casca.abrirFoco();
    const pergunta = parametros?.get("pergunta");
    if (pergunta) chat.sendMessage(pergunta);
    else if (parametros?.get("voz")) void voz.toggleMic();
  }, [parametros, chat, voz, casca]);

  const ocupado = mode !== "standby";

  const composicao = (
    <div className="composer">
      {chat.imageAttach && (
        <div className="attachment-chip">
          <Icone nome="file" />
          imagem anexada
          <button type="button" className="icon-button" onClick={() => chat.setImageAttach(null)} aria-label="Remover anexo">
            <Icone nome="close" />
          </button>
        </div>
      )}
      <div className="composer-inner">
        <div className="composer-mais">
          <button
            type="button"
            className="icon-button"
            onClick={() => setMaisAberto((v) => !v)}
            aria-label="Mais opções"
            aria-expanded={maisAberto}
          >
            <Icone nome="plus" />
          </button>
          {maisAberto && (
            <>
              <div className="composer-fora" onClick={() => setMaisAberto(false)} />
              <div className="composer-menu">
                <button type="button" className={voz.voiceOn ? "ativo" : ""} onClick={() => voz.setVoiceOn(!voz.voiceOn)}>
                  <Icone nome="volume" />
                  {voz.voiceOn ? "Voz da Órbita: ligada" : "Voz da Órbita: desligada"}
                </button>
                <button
                  type="button"
                  className={voz.wakeOn ? "ativo" : ""}
                  onClick={() => {
                    setMaisAberto(false);
                    void voz.toggleWake();
                  }}
                >
                  <Icone nome="mic" />
                  {voz.wakeOn ? "Parar de ouvir" : 'Ouvir "Ei Órbita"'}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMaisAberto(false);
                    imagemRef.current?.click();
                  }}
                >
                  <Icone nome="file" />
                  Anexar imagem
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMaisAberto(false);
                    voz.audioFileRef.current?.click();
                  }}
                >
                  <Icone nome="music" />
                  Enviar áudio para transcrever
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setMaisAberto(false);
                    void voz.seeScreen();
                  }}
                >
                  <Icone nome="expand" />
                  Ver minha tela
                </button>
                {voz.realtimeEnabled && !modoLocal && (
                  <button
                    type="button"
                    className={voz.realtimeOn ? "ativo" : ""}
                    onClick={() => {
                      setMaisAberto(false);
                      void voz.toggleRealtime();
                    }}
                  >
                    <Icone nome="wave" />
                    {voz.realtimeOn ? "Encerrar tempo real" : "Conversa em tempo real"}
                  </button>
                )}
              </div>
            </>
          )}
        </div>

        <textarea
          ref={chat.taRef}
          value={chat.input}
          rows={1}
          maxLength={8000}
          aria-label="Mensagem para a Órbita"
          placeholder="Fale ou escreva…"
          onChange={(e) => {
            chat.setInput(e.target.value);
            chat.autoGrow(e.target);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              chat.send();
            }
          }}
        />

        <button
          type="button"
          className="icon-button"
          onClick={voz.toggleMic}
          disabled={ocupado && !voz.recording}
          aria-label={voz.recording ? "Parar a gravação" : "Falar"}
          title="Microfone"
        >
          <Icone nome={voz.recording ? "stop" : "mic"} />
        </button>

        {/* Gravando: só o botão do microfone controla, para não haver dois
            "parar" na mesma barra. Gerando: parar. Ocioso: enviar. */}
        {voz.recording ? null : ocupado ? (
          <button type="button" className="icon-button send-button" onClick={chat.stopGenerating} aria-label="Parar a resposta">
            <Icone nome="stop" />
          </button>
        ) : (
          <button
            type="button"
            className="icon-button send-button"
            onClick={chat.send}
            disabled={!chat.input.trim() && !chat.imageAttach}
            aria-label="Enviar mensagem"
          >
            <Icone nome="send" />
          </button>
        )}
      </div>
      <div className="composer-hint">
        <span>Enter envia · Shift+Enter quebra linha</span>
        {/* O rodapé dizia 'diga "Ei Órbita"' o tempo todo, inclusive com o wake
            word desligado (que é o padrão): a interface prometia escutar sem
            escutar nada. Agora ele diz o estado real e, quando está desligado,
            é o próprio atalho para ligar, em vez de esconder isso no menu "+". */}
        {mode === "standby" && !voz.wakeOn ? (
          <button type="button" className="dica-wake" onClick={() => void voz.toggleWake()}>
            <Icone nome="mic" />
            <span>ativar “Ei Órbita”</span>
          </button>
        ) : (
          <span>{mode === "standby" ? 'ouvindo · diga "Ei Órbita"' : ROTULO_DO_MODO[mode]}</span>
        )}
      </div>
    </div>
  );

  return (
    <section className="view view-conversa">
      {/* entradas de arquivo, acionadas pelo menu "+" */}
      <input
        ref={voz.audioFileRef}
        type="file"
        accept="audio/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void voz.sendAudioFile(f);
          e.target.value = "";
        }}
      />
      <input
        ref={imagemRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = "";
          if (!f) return;
          if (f.size > 6_000_000) {
            setErro("Imagem muito grande (máx. ~6 MB).");
            return;
          }
          const leitor = new FileReader();
          leitor.onload = () => chat.setImageAttach(String(leitor.result));
          leitor.readAsDataURL(f);
        }}
      />

      <div className="view-heading">
        <div>
          <span className="eyebrow">UM PENSAMENTO PUXA O OUTRO</span>
          <h1>
            Vamos conversar<span className="mint-period">.</span>
          </h1>
          <p>Uma conversa que pode virar memória, plano ou próximo passo.</p>
        </div>
        <button className="button secondary" onClick={casca.abrirFoco}>
          <Icone nome="expand" />
          Modo foco
        </button>
      </div>

      <div className="chat-layout">
        <aside className="panel chat-history">
          <button className="button secondary full-width" onClick={() => { newConversation(); setErro(null); }}>
            <Icone nome="plus" />
            Nova conversa
          </button>

          <div className="panel-label">ESPAÇOS DE CONVERSA</div>
          {convs.length === 0 && <div className="empty-state">Nenhuma conversa ainda.</div>}
          {convs.map((c) => (
            <div key={c.id} className="history-row">
              <button className={`history-item ${activeId === c.id ? "active" : ""}`} onClick={() => loadConversation(c.id)}>
                <Icone nome="chat" />
                <span>{c.title}</span>
              </button>
              <button className="icon-button" onClick={() => deleteConv(c.id)} aria-label={`Apagar ${c.title}`} title="Apagar">
                <Icone nome="close" />
              </button>
            </div>
          ))}

          <div className="panel-label">O CÉREBRO DA RESPOSTA</div>
          <label className="field">
            <select
              aria-label="Modelo de IA"
              title="Qual modelo responde. Os grupos são os provedores configurados."
              value={modoLocal ? (grupos.porProvedor.get("local")?.[0]?.key ?? chaveModelo) : chaveModelo}
              disabled={modoLocal}
              onChange={(e) => setChaveModelo(e.target.value)}
            >
              {!modoLocal && grupos.auto.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
              {[
                { p: "local", label: "Local (grátis)" },
                { p: "claude", label: "Claude (assinatura)" },
                { p: "groq", label: "Groq" },
                { p: "google", label: "Google Gemini" },
                { p: "openai", label: "OpenAI" },
                { p: "cohere", label: "Cohere" },
                { p: "gateway", label: "Gateway (pago)" },
              ].map((g) => {
                const opcoes = grupos.porProvedor.get(g.p) ?? [];
                if (!opcoes.length || (modoLocal && g.p !== "local")) return null;
                return (
                  <optgroup key={g.p} label={g.label}>
                    {opcoes.map((m) => <option key={m.key} value={m.key}>{m.label}</option>)}
                  </optgroup>
                );
              })}
            </select>
          </label>
          <label className="switch-row">
            <input type="checkbox" checked={modoLocal} onChange={(e) => setModoLocal(e.target.checked)} />
            <span>
              <Icone nome="lock" />
              Modo local: nada sai da máquina
            </span>
          </label>

          <ActionsPanel />
        </aside>

        <article className="panel chat-main">
          <div className="chat-top">
            <span className="mini-orb" />
            <div>
              <h2>Uma presença para pensar junto</h2>
              <p>Seu contexto. Seu ritmo. Sua escolha.</p>
            </div>
            {modoLocal && (
              <span className="tag green">
                <Icone nome="shield" />
                LOCAL
              </span>
            )}
          </div>

          <div className="chat-messages" ref={chat.logRef} role="log" aria-live="polite">
            {messages.length === 0 && (
              <div className="empty-state">Converse com a Órbita. Fale pelo microfone ou escreva abaixo.</div>
            )}
            {messages.map((m, i) => (
              <Bolha
                key={i}
                m={m}
                estado={
                  m.role === "assistant" && !m.content && ocupado && i === messages.length - 1
                    ? `${ROTULO_DO_MODO[mode]}${chat.elapsed > 0 ? ` · ${chat.elapsed}s` : ""}`
                    : null
                }
              />
            ))}
          </div>

          {erro && (
            <p role="alert" className="chat-erro">
              {erro}
            </p>
          )}

          {composicao}
        </article>
      </div>

    </section>
  );
}
