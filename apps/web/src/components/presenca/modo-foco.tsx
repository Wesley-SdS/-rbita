"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Icone } from "./icones";
import { ESTADO_DO_MODO, Nucleo } from "./nucleo";
import { ESTADOS_NUCLEO } from "./estados";
import { useConsoleDeVoz } from "@/components/console/use-console-voz";
import { capturarUmQuadro } from "@/lib/camera/aparelho";

const formatar = (segundos: number) =>
  `${String(Math.floor(segundos / 60)).padStart(2, "0")}:${String(segundos % 60).padStart(2, "0")}`;

/**
 * Modo foco: a tela limpa em que se conversa com a Órbita por VOZ.
 *
 * Nasceu no protótipo como um bloco de tempo tipo pomodoro, e foi portado
 * assim. Só que a intenção do dono sempre foi outra: a área de menor ruído é
 * onde se FALA com ela, sem painel, sem menu, sem histórico. O tempo continua
 * existindo, porque marcar um bloco é útil, mas virou um canto discreto em vez
 * de ser o assunto da tela.
 *
 * A voz aqui é PRÓPRIA, não emprestada da tela de Conversa: o foco abre por
 * cima de qualquer rota (é montado na casca), e depender de outra tela estar
 * montada era exatamente o motivo de o "Ei Órbita" não funcionar aqui. Para os
 * dois não disputarem o microfone, quem abre o foco pede à tela de trás que
 * solte a voz dela (`pausarVozDaTela`).
 *
 * A contagem é feita por PRAZO (`Date.now()` de destino) e não decrementando um
 * contador: o navegador estrangula `setInterval` em aba oculta, e um contador
 * decrescente atrasaria minutos enquanto a pessoa está justamente fora da aba,
 * que é o que o modo foco quer que aconteça.
 */
export function ModoFoco({
  aberto,
  aoFechar,
  minutos,
  intensidade,
  reduzido,
  pausarVozDaTela,
}: {
  aberto: boolean;
  aoFechar: () => void;
  minutos: number;
  intensidade: number;
  reduzido: boolean;
  pausarVozDaTela?: () => void;
}) {
  const total = minutos * 60;
  const [restante, setRestante] = useState(total);
  const [rodando, setRodando] = useState(false);
  const [tempoVisivel, setTempoVisivel] = useState(false);
  const prazo = useRef(0);

  // ── voz própria ───────────────────────────────────────────────────────────
  const { mode, ultima, erro, voz, chat, silenciar } = useConsoleDeVoz();

  /** Captura UM quadro e repete a pergunta, agora com o que olhar. */
  async function deixarOlhar(pergunta: string) {
    if (await capturarUmQuadro()) chat.sendMessage(pergunta);
  }

  // Abrir o foco tira a voz da tela de trás; fechar devolve o silêncio aqui.
  // Sem isto, dois reconhecedores disputariam o mesmo microfone e nenhum dos
  // dois ouviria direito.
  useEffect(() => {
    if (aberto) pausarVozDaTela?.();
    else silenciar();
  }, [aberto, pausarVozDaTela, silenciar]);

  // Trocar a duração nas Preferências precisa valer no próximo bloco, mas não
  // pode encurtar um foco que já está correndo.
  useEffect(() => {
    if (!rodando) setRestante(total);
  }, [total, rodando]);

  useEffect(() => {
    if (!rodando) return;
    const id = setInterval(() => {
      const falta = Math.max(0, Math.ceil((prazo.current - Date.now()) / 1000));
      setRestante(falta);
      if (falta === 0) setRodando(false);
    }, 250);
    return () => clearInterval(id);
  }, [rodando]);

  // Sem isto a página de trás rola junto e a tela ganha duas barras de rolagem.
  useEffect(() => {
    if (!aberto) return;
    const antes = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = antes;
    };
  }, [aberto]);

  const alternar = useCallback(() => {
    setRodando((estava) => {
      if (estava) return false;
      prazo.current = Date.now() + (restante || total) * 1000;
      if (!restante) setRestante(total);
      return true;
    });
  }, [restante, total]);

  if (!aberto) return null;

  const terminou = restante === 0;
  const ocupada = mode !== "standby";
  // A voz manda no núcleo; o tempo só aparece nele quando não há conversa.
  const estadoNucleo = ocupada ? ESTADO_DO_MODO[mode] : rodando ? "thinking" : terminou ? "success" : "idle";

  return (
    <div className="focus-overlay" role="dialog" aria-modal="true" aria-label="Modo foco">
      <header>
        <span className="brand">
          <span className="brand-symbol" aria-hidden="true" />
          <span>
            órbita<span className="brand-period">.</span>
          </span>
        </span>
        <span className="focus-eyebrow">SÓ VOCÊ. UMA COISA DE CADA VEZ.</span>
        <button className="icon-button" onClick={aoFechar} aria-label="Sair do modo foco">
          <Icone nome="close" />
        </button>
      </header>

      <div id="focus-stage-slot">
        <div className="orb-stage">
          <Nucleo estado={estadoNucleo} intensidade={intensidade} reduzido={reduzido} />
        </div>
      </div>

      <div className="focus-copy">
        <span className="eyebrow">{ESTADOS_NUCLEO[estadoNucleo].status.toUpperCase()}</span>
        <h2>{terminou && !ocupada ? "Que bom. Você esteve presente." : "Fale comigo."}</h2>

        {/* A conversa por voz precisa deixar rastro: sem isto, quem fala não
            tem como conferir o que a Órbita entendeu. Só a última troca, para
            a tela continuar sendo a de menor ruído. */}
        <div className="foco-dialogo" aria-live="polite">
          {erro ? (
            <p className="foco-erro">{erro}</p>
          ) : ultima?.escolha ? (
            /* A Órbita não trocou de provedor sozinha. Sem isto aqui, o turno
               terminava numa pergunta que a tela não mostrava, e o núcleo
               ficava girando em "processando" sem explicação nenhuma. */
            <div className="escolha-provedor">
              <p className="escolha-motivo">{ultima.escolha.motivo}</p>
              <div className="escolha-opcoes">
                {ultima.escolha.opcoes.map((o) => (
                  <button
                    key={o.classe}
                    type="button"
                    className="button secondary compacto"
                    onClick={() => chat.sendMessage(ultima.escolha!.pergunta, undefined, [o.classe])}
                  >
                    Usar {o.rotulo}
                    <small>{o.custo}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : ultima?.pedidoCamera ? (
            <div className="escolha-provedor">
              <p className="escolha-motivo">{ultima.pedidoCamera.motivo}</p>
              <div className="escolha-opcoes">
                <button type="button" className="button secondary compacto" onClick={() => void deixarOlhar(ultima.pedidoCamera!.pergunta)}>
                  Deixar ela olhar
                  <small>tira uma foto agora e responde</small>
                </button>
              </div>
            </div>
          ) : ultima ? (
            <p className={ultima.role === "user" ? "foco-fala-sua" : "foco-fala-dela"}>{ultima.content}</p>
          ) : voz.wakeOn && voz.ultimoOuvido ? (
            /* O que ela ENTENDEU, enquanto espera o chamado. Sem isto, um wake
               que não dispara é invisível: não há erro nem log, e a única
               informação disponível é "não funcionou". */
            <p className="foco-ouvido">ouvi: “{voz.ultimoOuvido}”</p>
          ) : (
            <p className="foco-dica">Diga “Ei Órbita” e peça o que precisar, ou abra uma conversa contínua.</p>
          )}
        </div>

        <div className="focus-buttons">
          <button className={`button ${voz.wakeOn ? "secondary" : "primary"}`} onClick={() => void voz.toggleWake()}>
            <Icone nome="mic" />
            {voz.wakeOn ? "Parar de ouvir" : "Ouvir “Ei Órbita”"}
          </button>
          {voz.realtimeEnabled && (
            <button className={`button ${voz.realtimeOn ? "primary" : "secondary"}`} onClick={() => void voz.toggleRealtime()}>
              <Icone nome="wave" />
              {voz.realtimeOn ? "Encerrar tempo real" : "Conversa em tempo real"}
            </button>
          )}
        </div>
      </div>

      {/* O tempo: um canto, não o assunto. */}
      <div className="foco-tempo">
        {tempoVisivel ? (
          <div className="foco-tempo-painel">
            <p className="foco-relogio" aria-live="polite">
              {formatar(restante)}
            </p>
            <div className="foco-tempo-acoes">
              <button className="button secondary compacto" onClick={alternar}>
                <Icone nome={rodando ? "pause" : "play"} />
                {rodando ? "Pausar" : terminou ? "Mais um" : restante === total ? "Começar" : "Retomar"}
              </button>
              <button
                className="text-button"
                onClick={() => {
                  setRodando(false);
                  setRestante(total);
                }}
              >
                Recomeçar
              </button>
              <button className="icon-button" onClick={() => setTempoVisivel(false)} aria-label="Esconder o tempo">
                <Icone nome="close" />
              </button>
            </div>
          </div>
        ) : (
          <button className="foco-tempo-botao" onClick={() => setTempoVisivel(true)}>
            <Icone nome="clock" />
            {rodando ? formatar(restante) : "Marcar um tempo"}
          </button>
        )}
      </div>

      <footer>Sem notificações. Sem pressa. No seu ritmo.</footer>
    </div>
  );
}
