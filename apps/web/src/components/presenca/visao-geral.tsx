"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { Icone } from "./icones";
import { useCasca } from "./contexto";
import { Nucleo } from "./nucleo";
import { ESTADOS_NUCLEO, type EstadoNucleo } from "./estados";

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
  const [estado] = useState<EstadoNucleo>("idle");
  const [contagens, setContagens] = useState({ memorias: 0, rotinas: 0, comodos: 0 });
  // A data só é calculada no cliente: renderizar no servidor daria o dia do
  // fuso do servidor, e a hidratação reclamaria da diferença.
  const [agora, setAgora] = useState<Date | null>(null);

  useEffect(() => {
    setAgora(new Date());
    // Números reais, não os do roteiro do protótipo. Cada um falha em silêncio:
    // a tela inicial não pode quebrar porque um painel está fora do ar.
    void Promise.allSettled([
      fetch("/api/knowledge").then((r) => r.json()),
      fetch("/api/routines").then((r) => r.json()),
      fetch("/api/home/rooms").then((r) => r.json()),
    ]).then(([conhecimento, rotinas, comodos]) => {
      setContagens({
        memorias: conhecimento.status === "fulfilled" ? Number(conhecimento.value?.memories ?? 0) : 0,
        rotinas: rotinas.status === "fulfilled" ? (rotinas.value?.routines ?? []).length : 0,
        comodos: comodos.status === "fulfilled" ? (comodos.value?.rooms ?? []).length : 0,
      });
    });
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

          <div className="voice-actions">
            <Link className="button primary voice-button" href="/app/conversa?voz=1">
              <Icone nome="mic" />
              <span>Conversar com a Órbita</span>
            </Link>
            <Link className="button secondary" href="/app/conversa">
              <Icone nome="keyboard" />
              Prefiro escrever
            </Link>
          </div>

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
      <Widgets />

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
