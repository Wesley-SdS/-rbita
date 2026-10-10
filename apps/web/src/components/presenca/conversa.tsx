"use client";

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Icone } from "./icones";
import { PropostaCard } from "@/components/presenca/proposta-card";
import { FontesPilha } from "@/components/presenca/fontes-pilha";
import { CartaoAtalho, PainelDeCartoes } from "@/components/presenca/painel-de-cartoes";
import { Tema } from "./tema";
import { useRecurso } from "@/lib/dados/recurso";
import { SeletorDeModelo } from "./seletor-modelo";
import { capturarUmQuadro } from "@/lib/camera/aparelho";
import { useCasca } from "./contexto";
import { Markdown } from "@/components/markdown";
import type { ModelInfo, Msg, VoiceBridge } from "@/components/console/types";
import type { OrbMode } from "@/components/console/types";
import { useOrbMode } from "@/components/console/use-orb-mode";
import { useConversations } from "@/components/console/use-conversations";
import { useChatStream } from "@/components/console/use-chat-stream";
import { useVoice } from "@/components/console/use-voice";


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
  resumo_financeiro: "olhando suas finanças",
  lancar_por_frase: "lançando",
  transferir_dinheiro: "registrando a transferência",
  usar_atalho: "lançando o atalho",
  desfazer_lancamento: "desfazendo",
  adicionar_conta: "cadastrando a conta",
  pagar_conta: "registrando o pagamento",
  pagar_fatura: "pagando a fatura",
  registrar_divida: "anotando a dívida",
  pagar_divida: "registrando o pagamento da dívida",
  criar_meta: "criando a meta",
  salvar_item_meta: "atualizando a meta",
  definir_renda: "guardando a renda",
  cadastrar_cartao: "cadastrando o cartão",
  cadastrar_carteira: "cadastrando a conta",
  noticias_dos_meus_temas: "lendo as notícias dos seus temas",
  seguir_tema_de_noticias: "passando a acompanhar o tema",
  deixar_de_seguir_tema: "parando de acompanhar o tema",
  buscar_noticias_agora: "buscando notícias",
  criar_tarefa: "criando a tarefa",
  listar_tarefas: "lendo suas tarefas",
  lembrar: "guardando na memória",
};

/**
 * No pé do histórico, só o LEMBRETE das aprovações: a fila inteira, com o texto
 * de cada proposta, espremia a coluna e empurrava as conversas para fora da
 * tela (09/10/2026). Ler e decidir é na gaveta do sino, que tem espaço.
 */
function LembreteDeAprovacoes({ aoAbrir }: { aoAbrir: () => void }) {
  const { dado } = useRecurso<{ actions: unknown[] }>("/api/actions");
  const n = dado?.actions?.length ?? 0;
  if (!n) return null;
  return (
    <button type="button" className="chat-history-aprovacoes" onClick={aoAbrir}>
      <span className="chat-history-aprovacoes-n">{n}</span>
      <span>
        <strong>{n === 1 ? "1 ação esperando você" : `${n} ações esperando você`}</strong>
        <small>Ver e aprovar</small>
      </span>
      <Icone nome="arrow-right" />
    </button>
  );
}

const rotuloDaFerramenta = (nome: string) => NOMES_DE_FERRAMENTA[nome] ?? nome.replace(/_/g, " ");

/**
 * Uma bolha, MEMOIZADA. Durante o streaming só o último objeto de `messages`
 * troca de referência, então apenas a última bolha re-renderiza e as antigas
 * pulam o reparse de markdown.
 */
const Bolha = memo(function Bolha({
  m,
  indice,
  estado,
  cartaoAberto,
  aoAbrirCartao,
  aoEscolherProvedor,
  aoDeixarOlhar,
  aoDecidirProposta,
}: {
  m: Msg;
  indice: number;
  estado: string | null;
  /** o cartão DESTA mensagem que está no painel lateral, se algum */
  cartaoAberto: string | null;
  aoAbrirCartao: (indice: number, id: string) => void;
  aoEscolherProvedor?: (classe: "assinatura" | "local" | "paga", pergunta: string) => void;
  aoDeixarOlhar?: (pergunta: string) => void;
  aoDecidirProposta?: (id: string, estado: "confirmada" | "descartada", resultado?: string) => void;
}) {
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
        {m.olhou && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={m.olhou} alt="o que a Órbita viu pela câmera" className="message-image olhada" />
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
        {m.escolha ? (
          /* A Órbita não trocou de provedor sozinha: ela conta o que houve e
             deixa a decisão com o dono. Cada opção diz o que custa ANTES de
             ser clicada — oferecer "nuvem paga" sem dizer que cobra seria
             repetir o gasto silencioso, só que com mais passos. */
          <div className="escolha-provedor">
            <p className="escolha-motivo">{m.escolha.motivo}</p>
            <p className="escolha-pergunta">Quer que eu use outro caminho para responder?</p>
            <div className="escolha-opcoes">
              {m.escolha.opcoes.map((o) => (
                <button key={o.classe} type="button" className="button secondary compacto" onClick={() => aoEscolherProvedor?.(o.classe, m.escolha!.pergunta)}>
                  Usar {o.rotulo}
                  <small>{o.custo}</small>
                </button>
              ))}
            </div>
          </div>
        ) : daOrbita ? <Markdown>{m.content}</Markdown> : <p>{m.content}</p>}
        {m.pedidoCamera && (
          /* A Órbita precisa ver e não tem imagem recente. Ela PEDE: a câmera
             acende por um instante, com o aval de quem está na frente dela. */
          <div className="escolha-provedor" style={{ marginTop: 10 }}>
            <p className="escolha-motivo">{m.pedidoCamera.motivo}</p>
            <p className="escolha-pergunta">Posso dar uma olhada pela câmera deste aparelho?</p>
            <div className="escolha-opcoes">
              <button type="button" className="button secondary compacto" onClick={() => aoDeixarOlhar?.(m.pedidoCamera!.pergunta)}>
                Deixar ela olhar
                <small>tira uma foto agora e responde</small>
              </button>
            </div>
          </div>
        )}
        {m.proposta && (
          /* A proposta espera VOCÊ. Fica aqui, na conversa, porque decidir
             sobre o e-mail é parte da conversa sobre o e-mail. */
          <div style={{ marginTop: 10 }}>
            <PropostaCard proposta={m.proposta} aoDecidir={aoDecidirProposta ?? (() => {})} />
          </div>
        )}
        {m.cartoes?.length ? (
          /* o que ela consultou (e-mails, agenda, chamados): na mensagem fica só o
             atalho; o cartão abre no painel ao lado, com espaço (pedido do dono,
             09/10/2026: dentro da bolha as abas e a lista ficavam espremidas) */
          <div className="mensagem-cartoes">
            {m.cartoes.map((c) => (
              <CartaoAtalho key={c.id} cartao={c} aberto={cartaoAberto === c.id} aoAbrir={() => aoAbrirCartao(indice, c.id)} />
            ))}
          </div>
        ) : null}
        {m.fontes?.length && !m.cartoes?.some((c) => c.tipo === "noticias") ? (
          /* de onde veio o que ela contou: a pilha abre em leque no mouse */
          <div className="mensagem-fontes">
            <FontesPilha fontes={m.fontes} para="cima" />
          </div>
        ) : null}
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
  // o painel lateral: qual mensagem e qual cartão dela
  const [painel, setPainel] = useState<{ msg: number; id: string } | null>(null);
  const abrirCartao = useCallback((msg: number, id: string) => setPainel({ msg, id }), []);
  const fecharPainel = useCallback(() => setPainel(null), []);
  // a resposta cujo painel o dono fechou não reabre sozinha
  const fechadoPara = useRef<number | null>(null);
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

  // As conversas anteriores: abertas ou recolhidas, lembrado neste navegador
  // (conveniência de quem olha, não dado: sem localStorage, abre aberto).
  const [historicoAberto, setHistoricoAberto] = useState(true);
  useEffect(() => {
    try {
      if (localStorage.getItem("orbita.conversa.historico") === "recolhido") setHistoricoAberto(false);
    } catch {
      /* navegação privada ou armazenamento bloqueado: fica aberto */
    }
  }, []);
  const mudarHistorico = useCallback((aberto: boolean) => {
    setHistoricoAberto(aberto);
    try {
      localStorage.setItem("orbita.conversa.historico", aberto ? "aberto" : "recolhido");
    } catch {
      /* idem */
    }
  }, []);
  const [buscaConversa, setBuscaConversa] = useState("");
  const conversasFiltradas = useMemo(() => {
    const q = buscaConversa.trim().toLowerCase();
    return q ? convs.filter((c) => c.title.toLowerCase().includes(q)) : convs;
  }, [convs, buscaConversa]);
  const tituloDaConversa = convs.find((c) => c.id === activeId)?.title ?? "Nova conversa";

  // os cartões da mensagem que está no painel (sumiu a mensagem, some o painel)
  const cartoesDoPainel = painel ? messages[painel.msg]?.cartoes ?? null : null;
  // trocar de conversa fecha o painel: o índice da mensagem é de OUTRA conversa
  useEffect(() => {
    setPainel(null);
    fechadoPara.current = null;
  }, [activeId]);
  // a resposta que está CHEGANDO e traz cartões abre o primeiro no painel, como
  // o artefato no Adalink; só enquanto ela responde (abrir uma conversa antiga
  // não abre nada sozinho) e nunca a resposta cujo painel o dono fechou
  const ultima = messages.length - 1;
  const primeiroDaUltima = messages[ultima]?.role === "assistant" ? messages[ultima]?.cartoes?.[0]?.id ?? null : null;
  const respondendo = mode !== "standby";
  useEffect(() => {
    if (!respondendo || !primeiroDaUltima || fechadoPara.current === ultima) return;
    setPainel((atual) => (atual?.msg === ultima ? atual : { msg: ultima, id: primeiroDaUltima }));
  }, [respondendo, primeiroDaUltima, ultima]);

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
    pontesVoz.current = {
      handleAssistantResponse: voz.handleAssistantResponse,
      iniciarFalaEmFluxo: voz.iniciarFalaEmFluxo,
      stopSpeaking: voz.stopSpeaking,
    };
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

  /** Captura UM quadro e repete a pergunta, agora com o que ver. */
  /**
   * O desfecho da proposta volta PARA A MENSAGEM.
   *
   * Guardar num estado solto perderia o desfecho ao rolar a conversa ou ao
   * chegar a resposta seguinte, e o cartão voltaria a pedir confirmação de algo
   * que já foi enviado. Na mensagem, ele fica onde aconteceu.
   */
  function decidirProposta(id: string, estado: "confirmada" | "descartada", resultado?: string) {
    setMessages((m) =>
      m.map((msg) => (msg.proposta?.id === id ? { ...msg, proposta: { ...msg.proposta, estado, resultado } } : msg)),
    );
  }

  async function deixarOlhar(pergunta: string) {
    const ok = await capturarUmQuadro();
    if (!ok) {
      setErro("Não consegui usar a câmera deste aparelho. Ligue ela em Casa → Câmeras.");
      return;
    }
    chat.sendMessage(pergunta);
  }

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

        {/*
          LER EM VOZ ALTA, à mão e à vista.
          O interruptor existia só dentro do menu "+", e o dono não o achou:
          "deveria ter um botão para eu marcar se eu quero que tenha a voz lendo
          a resposta ou não". É uma escolha de momento, não de configuração,
          porque muda de uma pergunta para a outra (de madrugada, ao lado de
          alguém, numa resposta longa que se lê mais rápido do que se ouve).
          Escolha de momento mora ao lado do campo, não em três cliques.
        */}
        <button
          type="button"
          className={`icon-button${voz.voiceOn ? " ativo" : ""}`}
          onClick={() => voz.setVoiceOn(!voz.voiceOn)}
          aria-pressed={voz.voiceOn}
          aria-label={voz.voiceOn ? "Parar de ler as respostas em voz alta" : "Ler as respostas em voz alta"}
          title={voz.voiceOn ? "Lendo em voz alta (clique para só texto)" : "Só texto (clique para ler em voz alta)"}
        >
          <Icone nome={voz.voiceOn ? "volume" : "mute"} />
        </button>

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
          <span>
            {mode === "standby"
              ? voz.ultimoOuvido
                ? `ouvi: “${voz.ultimoOuvido.slice(0, 40)}”`
                : 'ouvindo · diga "Ei Órbita"'
              : ROTULO_DO_MODO[mode]}
          </span>
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

      <div className={`chat-layout${cartoesDoPainel ? " com-painel" : ""}${historicoAberto ? "" : " sem-historico"}`}>
        {historicoAberto && (
          <aside className="chat-history" aria-label="Conversas anteriores">
            <div className="chat-history-topo">
              <button className="button secondary" onClick={() => { newConversation(); setErro(null); }}>
                <Icone nome="plus" />
                Nova conversa
              </button>
              <button type="button" className="icon-button" onClick={() => mudarHistorico(false)} aria-label="Recolher as conversas anteriores" title="Recolher">
                <Icone nome="sidebar" />
              </button>
            </div>
            <label className="chat-history-busca">
              <Icone nome="search" />
              <input type="search" value={buscaConversa} onChange={(e) => setBuscaConversa(e.target.value)} placeholder="Buscar conversa" aria-label="Buscar conversa" />
            </label>
            <div className="chat-history-lista">
              {convs.length === 0 && <div className="empty-state">Nenhuma conversa ainda.</div>}
              {conversasFiltradas.map((c) => (
                <div key={c.id} className="history-row">
                  <button className={`history-item ${activeId === c.id ? "active" : ""}`} onClick={() => loadConversation(c.id)}>
                    <span>{c.title}</span>
                  </button>
                  <button className="icon-button" onClick={() => deleteConv(c.id)} aria-label={`Apagar ${c.title}`} title="Apagar">
                    <Icone nome="close" />
                  </button>
                </div>
              ))}
            </div>
            <LembreteDeAprovacoes aoAbrir={casca.abrirAtividade} />
          </aside>
        )}

        <article className="chat-main">
          {/* o cabeçalho fino faz o papel da barra do topo e do bloco "Vamos
              conversar" (redesenho de 09/10/2026: a conversa ganha a altura) */}
          <header className="chat-top">
            {!historicoAberto && (
              <button type="button" className="icon-button" onClick={() => mudarHistorico(true)} aria-label="Mostrar as conversas anteriores" title="Conversas anteriores">
                <Icone nome="sidebar" />
              </button>
            )}
            <div className="chat-titulo">
              <strong>{tituloDaConversa}</strong>
              <span>{messages.length ? `${messages.length} ${messages.length === 1 ? "mensagem" : "mensagens"}` : "Fale pelo microfone ou escreva abaixo"}</span>
            </div>
            <span className="chat-top-espaco" />
            {/* Com o gateway ligado a descoberta traz centenas de modelos: um
                <select> nativo com tudo dentro travava a tela. Ver
                components/presenca/seletor-modelo.tsx. */}
            <div className="chat-top-modelo">
              <SeletorDeModelo
                modelos={modoLocal ? modelos.filter((m) => m.provider === "local") : modelos}
                valor={modoLocal ? (grupos.porProvedor.get("local")?.[0]?.key ?? chaveModelo) : chaveModelo}
                aoEscolher={setChaveModelo}
                desabilitado={modoLocal}
              />
            </div>
            <label className="chat-top-local" title="Modo local: nada sai da máquina">
              <input type="checkbox" checked={modoLocal} onChange={(e) => setModoLocal(e.target.checked)} />
              <Icone nome="lock" />
              <span>Modo local</span>
            </label>
            {!historicoAberto && (
              <button type="button" className="button secondary compacto" onClick={() => { newConversation(); setErro(null); }}>
                <Icone nome="plus" />
                Nova conversa
              </button>
            )}
            <button type="button" className="icon-button" onClick={casca.abrirFoco} aria-label="Modo foco" title="Modo foco">
              <Icone nome="expand" />
            </button>
            <span className="chat-top-divisor" />
            <Tema />
            <button type="button" className="icon-button" onClick={casca.abrirAtividade} aria-label="Abrir atividade e aprovações" title="Atividade e aprovações">
              <Icone nome="bell" />
            </button>
            <button type="button" className="icon-button" onClick={casca.alternarLateral} aria-label={casca.lateralRecolhida ? "Expandir o menu" : "Recolher o menu"} title={casca.lateralRecolhida ? "Expandir o menu" : "Recolher o menu"}>
              <Icone nome="menu" />
            </button>
          </header>

          <div className="chat-messages" ref={chat.logRef} role="log" aria-live="polite">
            <div className="chat-coluna">
            {messages.length === 0 && (
              <div className="empty-state">Converse com a Órbita. Fale pelo microfone ou escreva abaixo.</div>
            )}
            {messages.map((m, i) => (
              <Bolha
                key={i}
                m={m}
                indice={i}
                cartaoAberto={painel?.msg === i ? painel.id : null}
                aoAbrirCartao={abrirCartao}
                estado={
                  m.role === "assistant" && !m.content && ocupado && i === messages.length - 1
                    ? `${ROTULO_DO_MODO[mode]}${chat.elapsed > 0 ? ` · ${chat.elapsed}s` : ""}`
                    : null
                }
                aoEscolherProvedor={(classe, pergunta) => chat.sendMessage(pergunta, undefined, [classe])}
                aoDeixarOlhar={(pergunta) => void deixarOlhar(pergunta)}
                aoDecidirProposta={decidirProposta}
              />
            ))}
            </div>
          </div>

          {erro && (
            <p role="alert" className="chat-erro">
              {erro}
            </p>
          )}

          {composicao}
        </article>

        {cartoesDoPainel && painel ? (
          <PainelDeCartoes
            cartoes={cartoesDoPainel}
            ativo={painel.id}
            aoEscolher={(id) => setPainel({ msg: painel.msg, id })}
            aoFechar={() => {
              fechadoPara.current = painel.msg;
              fecharPainel();
            }}
          />
        ) : null}
      </div>

    </section>
  );
}
