"use client";

import { type Dispatch, type MutableRefObject, type SetStateAction, useEffect, useRef, useState } from "react";
import type { OrbMode } from "@/components/console/types";
import type { Msg, OpcaoDeProvedor, ToolStep, VoiceBridge } from "@/components/console/types";
import { getOwnDeviceId } from "@/lib/device-id";
import { cameraAutorizada, capturarUmQuadro, ehCameraDesteAparelho, garantirCameraDoAparelho } from "@/lib/camera/aparelho";

interface Params {
  modelKey: string;
  privacyMode: boolean;
  modeRef: MutableRefObject<OrbMode>;
  setMode: Dispatch<SetStateAction<OrbMode>>;
  setError: Dispatch<SetStateAction<string | null>>;
  setMessages: Dispatch<SetStateAction<Msg[]>>;
  convId: MutableRefObject<string | null>;
  setActiveId: Dispatch<SetStateAction<string | null>>;
  loadConvs: () => void;
  /** Ponte p/ a voz (falar / parar). Ref atualizada a cada render — sem stale closure. */
  voiceRef: MutableRefObject<VoiceBridge | null>;
}

/**
 * Orquestra o envio de mensagens e o streaming da resposta (NDJSON rich:
 * texto + timeline de ferramentas), o cronômetro ao vivo, as métricas de
 * sessão e o botão parar (AbortController). Não conhece a voz diretamente:
 * fala pela `voiceRef`, o que quebra o ciclo chat↔voz.
 */
export function useChatStream(p: Params) {
  const [input, setInput] = useState("");
  const [stats, setStats] = useState({ requests: 0, tokens: 0, lastMs: 0 });
  const [elapsed, setElapsed] = useState(0); // segundos desde o envio (feedback ao vivo)
  const [imageAttach, setImageAttach] = useState<string | null>(null); // data URL da imagem anexada
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const abortRef = useRef<AbortController | null>(null); // aborta o stream do chat (botão parar)
  const taRef = useRef<HTMLTextAreaElement>(null); // textarea (auto-grow)
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => () => { if (timerRef.current) clearInterval(timerRef.current); }, []); // limpa o cronômetro no unmount

  // auto-cresce o textarea conforme o conteúdo (até um teto), sem barra de rolagem.
  // O teto tem de ser o MESMO do `max-height` da folha: com 160 aqui e 110 lá,
  // o JS esticava além do que o CSS permitia e sobrava barra de rolagem.
  const autoGrow = (el: HTMLTextAreaElement) => { el.style.height = "auto"; el.style.height = Math.min(el.scrollHeight, 132) + "px"; };

  function send() {
    const content = input.trim();
    if (!content && !imageAttach) return;
    setInput("");
    if (taRef.current) taRef.current.style.height = "auto"; // volta o textarea a 1 linha
    void sendMessage(content || "O que há nesta imagem?");
  }

  /**
   * `liberar` é a resposta do dono à pergunta "o provedor que você escolheu
   * falhou, uso outro?". Vale só para ESTE envio: autorizar uma vez não muda
   * a configuração da casa.
   */
  async function sendMessage(content: string, voiceClip?: string, liberar?: ("assinatura" | "local" | "paga")[]) {
    if (!content || p.modeRef.current !== "standby" || !p.modelKey) return;
    // modo privacidade: quem troca para um modelo local é o SERVIDOR (só ele
    // sabe o que está instalado). Aqui só vai o pedido.
    const effectiveModelKey = p.modelKey;
    const imgToSend = imageAttach; // imagem anexada (uma vez); limpa o anexo
    if (imgToSend) setImageAttach(null);
    p.setError(null); p.setMode("studying");

    p.setMessages((m) => [...m, { role: "user", content, image: imgToSend ?? undefined }, { role: "assistant", content: "" }]);
    const started = Date.now();
    let spoke = false;
    // cronômetro ao vivo: mostra os segundos correndo enquanto a Órbita processa
    setElapsed(0);
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    const stopTimer = () => { if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; } };

    const ac = new AbortController();
    abortRef.current = ac;
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // voiceClip: trecho de voz do ditado (Onda 9, "quem pediu"); mensagens digitadas nunca o têm.
        // deviceId: aparelho registrado em Casa → Aparelhos (Onda 12), diz "daqui" é onde.
        body: JSON.stringify({ content, modelKey: effectiveModelKey, conversationId: p.convId.current ?? undefined, rich: true, image: imgToSend ?? undefined, voiceClip, deviceId: getOwnDeviceId() ?? undefined, privacidade: p.privacyMode || undefined, liberar }),
        signal: ac.signal,
      });
      const cid = res.headers.get("x-conversation-id");
      if (cid) { p.convId.current = cid; p.setActiveId(cid); }

      if (!res.ok || !res.body) {
        const err = await res.json().catch(() => ({ error: "Erro no servidor" }));
        throw new Error(err.error ?? "Erro no servidor");
      }

      // stream NDJSON: {t:'text'|'tool'|'tool-done'}. Reconstrói texto + timeline.
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let acc = "";
      let buf = "";
      let speakingSet = false; // evita um setState de modo por token
      // quando a Órbita pergunta qual provedor usar, não vem texto nenhum: o
      // pintor não pode sobrescrever a pergunta com uma bolha vazia
      let perguntou = false;
      let pedidoDeCamera: { motivo: string; pergunta: string; cameraId: string | null } | null = null;
      const steps: ToolStep[] = [];
      // O stream entrega muitos pedaços por segundo. Re-renderizar o React a
      // cada pedaço engasgava a animação do Orb (medido: 47fps parado contra
      // 27fps respondendo). Agrupamos as atualizações em ~60ms: o texto segue
      // aparecendo fluido para o olho, com uma fração das renderizações.
      const FLUSH_MS = 60;
      let lastFlush = 0;
      const paint = () => {
        if (perguntou) return;
        p.setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: acc, steps: [...steps] }; return c; });
      };
      const flush = (force = false) => {
        const now = Date.now();
        if (force || now - lastFlush >= FLUSH_MS) { lastFlush = now; paint(); }
      };
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          let ev: { t: string; v?: string; name?: string; msg?: string; motivo?: string; opcoes?: OpcaoDeProvedor[]; tipo?: string; camera?: string | null; cameraId?: string | null };
          try { ev = JSON.parse(line); } catch { continue; }
          if (ev.t === "text") {
            acc += ev.v ?? "";
            // troca o estado UMA vez por resposta, não a cada token
            if (acc && !speakingSet) { speakingSet = true; p.setMode("speaking"); }
            flush();
          } else if (ev.t === "tool" && ev.name) {
            p.setMode("searching"); steps.push({ name: ev.name, done: false }); flush(true);
          } else if (ev.t === "tool-done" && ev.name) {
            const s = steps.find((x) => x.name === ev.name && !x.done); if (s) s.done = true; flush(true);
          } else if (ev.t === "pedido" && ev.tipo === "camera") {
            // a Órbita precisa ver e não tem imagem recente: guarda o pedido
            // para a tela oferecer o botão quando a resposta terminar
            pedidoDeCamera = { motivo: ev.motivo ?? "Preciso de uma imagem para responder.", pergunta: content, cameraId: ev.cameraId ?? null };
          } else if (ev.t === "escolha" && ev.opcoes?.length) {
            // A Órbita não trocou de provedor sozinha: ela pergunta. A pergunta
            // vira parte da mensagem para continuar ali depois de rolar a tela.
            perguntou = true;
            const pergunta = { motivo: ev.motivo ?? "O provedor escolhido não pôde atender.", opcoes: ev.opcoes, pergunta: content };
            p.setMessages((m) => { const c = [...m]; c[c.length - 1] = { role: "assistant", content: "", escolha: pergunta }; return c; });
          } else if (ev.t === "error") {
            p.setError(ev.msg ?? "Falha ao gerar a resposta."); flush(true);
          }
        }
      }
      flush(true); // garante que o texto final apareça inteiro
      // o pedido de imagem entra NA MENSAGEM, junto da resposta: assim ele
      // sobrevive ao rolar da conversa, como a pergunta de provedor
      // A Órbita precisou ver. Quem pediu "o que estou segurando" já autorizou
      // a câmera no próprio pedido — perguntar de novo seria burocracia. Então
      // a captura acontece agora e a pergunta é refeita, já com o que olhar.
      //
      // O botão continua existindo, mas só quando a captura NÃO deu certo
      // (permissão negada, câmera ocupada): aí a pessoa precisa saber o porquê.
      if (pedidoDeCamera) {
        const pedido = pedidoDeCamera;
        // `cameraId: null` = a casa não tem câmera nenhuma e este aparelho
        // pode ser a primeira. Com id, só captura se for a DESTE aparelho.
        const daqui = pedido.cameraId === null ? await garantirCameraDoAparelho() : ehCameraDesteAparelho(pedido.cameraId) ? pedido.cameraId : null;
        if (daqui && cameraAutorizada() && (await capturarUmQuadro(daqui))) {
          stopTimer();
          p.setMode("standby");
          void sendMessage(pedido.pergunta);
          return;
        }
        p.setMessages((m) => { const c = [...m]; const ult = c[c.length - 1]; if (ult) c[c.length - 1] = { ...ult, pedidoCamera: pedido }; return c; });
      }

      // métricas da sessão (tokens estimados por chars quando não há usage do provedor).
      // A economia acumulada/persistida vem do EconomyPanel (/api/usage) — refetch via requests.
      const outTokens = Math.max(1, Math.ceil(acc.length / 4));
      setStats((s) => ({
        requests: s.requests + 1,
        tokens: s.tokens + outTokens,
        lastMs: Date.now() - started,
      }));

      // pós-resposta: a voz (se ligada) fala e re-arma a escuta. Chamado pela ponte
      // (ref) para não acoplar o chat à voz nem sofrer stale-closure.
      // Sem TEXTO não há o que falar. Quando o turno termina numa pergunta
      // (qual provedor usar, posso olhar pela câmera), `acc` fica vazio, e
      // mandar isso para a voz deixava o núcleo preso em "processando" para
      // sempre: o TTS não tinha o que dizer e nunca devolvia o estado.
      spoke = acc.trim() ? (p.voiceRef.current?.handleAssistantResponse(acc) ?? false) : false;
    } catch (e) {
      // parada intencional (botão parar): mantém o texto parcial, sem erro.
      if (e instanceof DOMException && e.name === "AbortError") {
        p.setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
      } else {
        p.setError(e instanceof Error ? e.message : "Erro inesperado");
        p.setMessages((m) => { const c = [...m]; if (c[c.length - 1]?.role === "assistant" && !c[c.length - 1]?.content) c.pop(); return c; });
      }
    } finally {
      abortRef.current = null;
      stopTimer();
      if (!spoke) p.setMode("standby");
      p.loadConvs();
    }
  }

  /** Para a geração em andamento (aborta o stream do chat e a fala). */
  function stopGenerating() {
    abortRef.current?.abort();
    p.voiceRef.current?.stopSpeaking();
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    p.setMode("standby");
  }

  return {
    input, setInput, stats, elapsed, imageAttach, setImageAttach,
    taRef, logRef, autoGrow, send, sendMessage, stopGenerating,
  };
}
