"use client";

import { useEffect, useRef, useState } from "react";
import { useOrbMode } from "./use-orb-mode";
import { useChatStream } from "./use-chat-stream";
import { useVoice } from "./use-voice";
import type { Msg, VoiceBridge } from "./types";

/**
 * Uma Órbita que ouve, pensa e fala, pronta para qualquer tela.
 *
 * Existe porque a mesma fiação passou a ser pedida em três lugares (a
 * Conversa, o Modo foco e a Visão geral), e ela tem um detalhe que não
 * perdoa: o chat e a voz não podem se conhecer diretamente, senão viram um
 * ciclo. A ligação é feita por DUAS refs atualizadas a cada render — o chat
 * fala pela `voiceRef`, a voz envia pela `sendMessageRef` — e é justamente o
 * tipo de coisa que, copiada três vezes, diverge na primeira mudança.
 *
 * A tela de Conversa NÃO usa este atalho: lá a mesma máquina precisa da lista
 * de conversas, da troca de modelo e do modo privado, então ela monta as peças
 * à mão. Aqui é o caso simples: uma conversa solta, modelo automático.
 */
export function useConsoleDeVoz(opcoes: { modelKey?: string } = {}) {
  const { mode, setMode, modeRef } = useOrbMode();
  const [mensagens, setMensagens] = useState<Msg[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const convId = useRef<string | null>(null);
  const pontesVoz = useRef<VoiceBridge | null>(null);
  const enviarRef = useRef<((conteudo: string, voiceClip?: string) => void) | null>(null);

  const chat = useChatStream({
    modelKey: opcoes.modelKey ?? "auto",
    privacyMode: false,
    modeRef,
    setMode,
    setError: setErro,
    setMessages: setMensagens,
    convId,
    setActiveId: () => {},
    loadConvs: () => {},
    voiceRef: pontesVoz,
  });

  const voz = useVoice({
    modeRef,
    setMode,
    setError: setErro,
    setMessages: setMensagens,
    input: chat.input,
    setInput: chat.setInput,
    sendMessageRef: enviarRef,
  });

  // Sem array de dependências: as duas pontes têm de apontar para o fechamento
  // DESTE render, senão a voz envia com um `sendMessage` velho.
  useEffect(() => {
    enviarRef.current = chat.sendMessage;
  });
  useEffect(() => {
    pontesVoz.current = { handleAssistantResponse: voz.handleAssistantResponse, stopSpeaking: voz.stopSpeaking };
  });

  /** Solta o microfone e cala a boca. Usado quando outra superfície assume a voz. */
  const vozRef = useRef(voz);
  vozRef.current = voz;
  const silenciar = useRef(() => {
    const v = vozRef.current;
    v.stopSpeaking();
    if (v.wakeOn) void v.toggleWake();
    if (v.realtimeOn) void v.toggleRealtime();
  }).current;

  /** A última fala com conteúdo, para a tela mostrar o rastro da conversa. */
  const ultima = [...mensagens].reverse().find((m) => m.content.trim()) ?? null;

  return { mode, mensagens, ultima, erro, chat, voz, silenciar };
}
