"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Icone } from "./icones";
import { useCasca } from "./contexto";
import { BlocoObservado } from "@/lib/use-visible";
import { useRecursos } from "@/lib/dados/recurso";
import { ESTADO_DO_MODO, Nucleo } from "./nucleo";
import { ESTADOS_NUCLEO } from "./estados";
import { useConsoleDeVoz } from "@/components/console/use-console-voz";
import { capturarUmQuadro } from "@/lib/camera/aparelho";

/* "Meus cards": o que o dono fixou para olhar todo dia. É o painel mais ligado
   à ideia de visão geral, então mora aqui e não atrás de uma aba. */
const Widgets = dynamic(() => import("@/components/widgets").then((m) => m.Widgets), {
  ssr: false,
  loading: () => <div className="panel empty-state">Carregando seus cards…</div>,
});

const DIAS = ["Domingo", "Segunda-feira", "Terça-feira", "Quarta-feira", "Quinta-feira", "Sexta-feira", "Sábado"];
const MESES = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];

function saudacaoDaHora(hora: number) {
  if (hora < 6) return "Uma boa hora para descansar";
  if (hora < 12) return "Uma boa hora para criar";
  if (hora < 18) return "Uma boa hora para avançar";
  return "Uma boa hora para respirar";
}

export function VisaoGeral({ nomeUsuario }: { nomeUsuario: string }) {
  const casca = useCasca();

  // A Órbita desta tela OUVE. Antes o núcleo aqui era enfeite (estado fixo em
  // "idle") e o botão de voz só levava para a tela de Conversa: para falar com
  // ela era preciso sair da tela que a mostra. Agora o "Ei Órbita" funciona
  // aqui, e o núcleo reage ao que está acontecendo.
  const assistente = useConsoleDeVoz();
  const estado = ESTADO_DO_MODO[assistente.mode];

  /** Captura UM quadro e repete a pergunta, agora com o que olhar. */
  async function deixarOlhar(pergunta: string) {
    if (await capturarUmQuadro()) assistente.chat.sendMessage(pergunta);
  }

  // O Modo foco abre por cima e tem voz própria; dois reconhecedores no mesmo
  // microfone não ouvem nenhum dos dois.
  useEffect(() => {
    casca.registrarPausaDeVoz(assistente.silenciar);
    return () => casca.registrarPausaDeVoz(null);
  }, [casca, assistente.silenciar]);
  // Os mesmos três recursos que as telas Memória, Rotinas e Casa já pedem:
  // com o cache, entrar em Casa logo depois da Visão geral não busca de novo.
  const { dados } = useRecursos<{
    conhecimento: { memories: number };
    rotinas: { routines: unknown[] };
    comodos: { rooms: unknown[] };
  }>({ conhecimento: "/api/knowledge", rotinas: "/api/routines", comodos: "/api/home/rooms" });
  const contagens = {
    memorias: dados.conhecimento?.memories ?? 0,
    rotinas: dados.rotinas?.routines?.length ?? 0,
    comodos: dados.comodos?.rooms?.length ?? 0,
  };
  // A data só é calculada no cliente: renderizar no servidor daria o dia do
  // fuso do servidor, e a hidratação reclamaria da diferença.
  const [agora, setAgora] = useState<Date | null>(null);

  useEffect(() => {
    setAgora(new Date());
  }, []);

  const fala = ESTADOS_NUCLEO[estado];
  const primeiroNome = nomeUsuario.split(" ")[0] || nomeUsuario;

  return (
    <section className="view" aria-label="Visão geral">
      <div className="page-heading">
        <div>
          <div className="eyebrow">SEU DIA, COM MAIS ESPAÇO.</div>
          <h1>
            Bom ter você aqui, {primeiroNome}
            <span className="mint-period">.</span>
          </h1>
          <p>Um pouco de clareza. Um mundo de possibilidades.</p>
        </div>
        <div className="day-chip">
          <Icone nome="sun" />
          <div>
            <strong>
              {agora ? `${DIAS[agora.getDay()]}, ${agora.getDate()} de ${MESES[agora.getMonth()]}` : " "}
            </strong>
            <span>{agora ? saudacaoDaHora(agora.getHours()) : " "}</span>
          </div>
        </div>
      </div>

      <div className="home-grid">
        <article className="presence-card">
          <div className="presence-top">
            <span className="eyebrow">
              <span className="status-dot" /> UMA PRESENÇA, NÃO SÓ UMA IA
            </span>
            <Link className="icon-button" href="/app/conversa?foco=1" aria-label="Expandir para modo foco" title="Modo foco">
              <Icone nome="expand" />
            </Link>
          </div>

          <div className="orb-stage">
            <div className="orb-cross cross-one">+</div>
            <div className="orb-cross cross-two">+</div>
            <Nucleo estado={estado} intensidade={casca.intensidade} reduzido={casca.reduzido} />
            <div className="orb-tag orb-tag-left">
              <span className="tiny-dot" />
              {/* Em repouso o protótipo troca o nome do estado por uma frase:
                  "Presença" é rótulo de sistema, e ali quem lê é o dono. */}
              <span>{estado === "idle" ? "Tudo no seu ritmo" : fala.label}</span>
            </div>
            <div className="orb-tag orb-tag-right">
              <Icone nome="spark" />
              Contexto conectado
            </div>
            <span className="orb-coordinate coordinate-left">MOVA / CLIQUE</span>
            <span className="orb-coordinate coordinate-right">NEURAL CORE</span>
          </div>

          <div className="presence-copy">
            <div className="state-indicator">
              <span className="status-dot" />
              <span>{fala.status}</span>
            </div>
            <h2>{fala.title}</h2>
            <p>{fala.description}</p>
          </div>

          {/* Falar acontece AQUI; escrever é que muda de tela. */}
          <div className="voice-actions">
            <button
              type="button"
              className={`button ${assistente.voz.wakeOn ? "secondary" : "primary"} voice-button`}
              onClick={() => void assistente.voz.toggleWake()}
            >
              <Icone nome="mic" />
              <span>{assistente.voz.wakeOn ? "Parar de ouvir" : "Ouvir “Ei Órbita”"}</span>
            </button>
            {assistente.voz.realtimeEnabled && (
              <button
                type="button"
                className={`button ${assistente.voz.realtimeOn ? "primary" : "secondary"}`}
                onClick={() => void assistente.voz.toggleRealtime()}
              >
                <Icone nome="wave" />
                {assistente.voz.realtimeOn ? "Encerrar tempo real" : "Tempo real"}
              </button>
            )}
            <Link className="button secondary" href="/app/conversa">
              <Icone nome="keyboard" />
              Prefiro escrever
            </Link>
          </div>

          {/* O rastro da conversa falada: sem isto, quem fala não tem como
              conferir o que a Órbita entendeu sem trocar de tela. */}
          {/* A pergunta de provedor e o pedido de câmera chegam com TEXTO
              VAZIO. Mostrando só `content`, a tela ficava muda e parecia que a
              Órbita não tinha ouvido — era o mesmo buraco do Modo foco. */}
          {assistente.ultima?.escolha ? (
            <div className="escolha-provedor" style={{ marginTop: 12 }}>
              <p className="escolha-motivo">{assistente.ultima.escolha.motivo}</p>
              <div className="escolha-opcoes">
                {assistente.ultima.escolha.opcoes.map((o) => (
                  <button
                    key={o.classe}
                    type="button"
                    className="button secondary compacto"
                    onClick={() => assistente.chat.sendMessage(assistente.ultima!.escolha!.pergunta, undefined, [o.classe])}
                  >
                    Usar {o.rotulo}
                    <small>{o.custo}</small>
                  </button>
                ))}
              </div>
            </div>
          ) : assistente.ultima?.pedidoCamera ? (
            <div className="escolha-provedor" style={{ marginTop: 12 }}>
              <p className="escolha-motivo">{assistente.ultima.pedidoCamera.motivo}</p>
              <div className="escolha-opcoes">
                <button type="button" className="button secondary compacto" onClick={() => void deixarOlhar(assistente.ultima!.pedidoCamera!.pergunta)}>
                  Deixar ela olhar
                  <small>tira uma foto agora e responde</small>
                </button>
              </div>
            </div>
          ) : (assistente.erro || assistente.ultima) ? (
            <p className={`visao-fala ${assistente.erro ? "erro" : ""}`} aria-live="polite">
              {assistente.erro ?? assistente.ultima?.content}
            </p>
          ) : null}

          <div className="presence-foot">
            <span>
              <Icone nome="shield" />
              Você decide o que compartilhar
            </span>
            <Link className="text-button" href="/app/ajustes">
              Ajustar a presença <Icone nome="arrow-right" />
            </Link>
          </div>
        </article>

        <aside className="day-panel">
          <div className="section-heading">
            <h2>Seu dia em órbita</h2>
          </div>

          <article className="briefing-card">
            <div className="briefing-icon">
              <Icone nome="sun" />
            </div>
            <span className="eyebrow">UM RESUMO, SEM PRESSA</span>
            <h3>
              Vamos começar
              <br />
              por onde importa.
            </h3>
            <p>Pergunte pelo seu dia e eu reúno agenda, pendências e o que ficou para retomar.</p>
            <Link className="text-button" href="/app/conversa?pergunta=Como%20est%C3%A1%20meu%20dia%3F">
              Me conte sobre meu dia <Icone nome="arrow-right" />
            </Link>
            <div className="briefing-art" aria-hidden="true">
              <i />
              <i />
              <i />
            </div>
          </article>

          <div className="timeline-header">
            <h3>A seguir</h3>
            <span>Hoje</span>
          </div>

          <Link className="agenda-row" href="/app/reunioes">
            <span className="agenda-time">
              <Icone nome="wave" />
            </span>
            <span className="agenda-line lavender" />
            <span>
              <strong>Reuniões</strong>
              <small>Gravar, transcrever e virar próximos passos</small>
            </span>
            <Icone nome="arrow-up-right" />
          </Link>

          <Link className="agenda-row" href="/app/conexoes">
            <span className="agenda-time">
              <Icone nome="plug" />
            </span>
            <span className="agenda-line mint" />
            <span>
              <strong>Conexões</strong>
              <small>Ligue sua agenda para ver compromissos aqui</small>
            </span>
            <Icone nome="arrow-up-right" />
          </Link>

          <Link className="insight-card" href="/app/memoria">
            <span className="insight-icon">
              <Icone nome="spark" />
            </span>
            <div>
              <span className="eyebrow">O QUE A ÓRBITA GUARDOU</span>
              <p>
                {contagens.memorias > 0
                  ? `${contagens.memorias} ${contagens.memorias === 1 ? "memória guardada" : "memórias guardadas"} sobre você e seus projetos.`
                  : "Nada guardado ainda. O que você conversar pode virar memória."}
              </p>
              <strong>
                Ver memória <Icone nome="arrow-right" />
              </strong>
            </div>
          </Link>
        </aside>
      </div>

      <div className="section-heading quick-heading">
        <div>
          <h2>Seus cards</h2>
          <p>O que você quis ter sempre à mão.</p>
        </div>
      </div>
      {/* Observado: os cards se atualizam sozinhos a cada 2min, e a Visão
          geral é longa. Fora da vista, a atualização pausa. */}
      <BlocoObservado>
        <Widgets />
      </BlocoObservado>

      <div className="section-heading quick-heading">
        <div>
          <h2>Menos esforço. Mais vida.</h2>
          <p>Pequenos caminhos para o que importa.</p>
        </div>
        <Link className="text-button" href="/app/ajustes">
          Personalizar <Icone nome="sliders" />
        </Link>
      </div>

      <div className="quick-grid">
        <Link className="quick-card" href="/app/memoria">
          <span className="quick-icon lavender-bg">
            <Icone nome="network" />
          </span>
          <span className="quick-arrow">
            <Icone nome="arrow-up-right" />
          </span>
          <h3>Sua segunda memória</h3>
          <p>
            Ideias que se conectam.
            <br />
            Nada importante se perde.
          </p>
          <div className="card-foot">
            <span className="tiny-dot purple" />
            <span>
              {contagens.memorias} {contagens.memorias === 1 ? "memória neste universo" : "memórias neste universo"}
            </span>
          </div>
        </Link>

        <Link className="quick-card" href="/app/casa">
          <span className="quick-icon mint-bg">
            <Icone nome="home" />
          </span>
          <span className="quick-arrow">
            <Icone nome="arrow-up-right" />
          </span>
          <h3>Uma casa que acompanha</h3>
          <p>
            O ambiente certo
            <br />
            para o seu momento.
          </p>
          <div className="card-foot">
            <span className="tiny-dot" />
            <span>
              {contagens.comodos > 0
                ? `${contagens.comodos} ${contagens.comodos === 1 ? "ambiente" : "ambientes"} em harmonia`
                : "Nenhum ambiente cadastrado"}
            </span>
          </div>
        </Link>

        <Link className="quick-card" href="/app/rotinas">
          <span className="quick-icon peach-bg">
            <Icone nome="flow" />
          </span>
          <span className="quick-arrow">
            <Icone nome="arrow-up-right" />
          </span>
          <h3>O cotidiano, mais leve</h3>
          <p>
            Pequenas rotinas.
            <br />
            Grandes respiros no dia.
          </p>
          <div className="card-foot">
            <span className="tiny-dot orange" />
            <span>
              {contagens.rotinas > 0
                ? `${contagens.rotinas} ${contagens.rotinas === 1 ? "rotina cuidando" : "rotinas cuidando"} do resto`
                : "Nenhuma rotina ainda"}
            </span>
          </div>
        </Link>
      </div>

      <footer className="page-footer">
        <span>
          <span className="tiny-dot" />
          Feita para estar perto. Projetada para dar espaço.
        </span>
        <span>ÓRBITA / PRESENÇA</span>
      </footer>
    </section>
  );
}
