"use client";

import Link from "next/link";
import { useRecurso } from "@/lib/dados/recurso";
import { Icone } from "./icones";

interface Evento {
  id: string;
  titulo: string;
  inicio: string;
  fim: string;
  diaInteiro: boolean;
  local?: string;
  pessoas: string[];
  abrir?: string;
  entrar?: string;
  provedor: "google" | "microsoft";
  contas: string[];
}
interface Agenda {
  eventos: Evento[];
  falhas: string[];
  conectadas: number;
}

const CHAVE = "/api/agenda";

const dia = (d: Date) => d.toLocaleDateString("sv-SE"); // AAAA-MM-DD no fuso do navegador
const hora = (iso: string) => new Date(iso).toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
const diaDoEvento = (e: Evento) => (e.diaInteiro ? e.inicio.slice(0, 10) : dia(new Date(e.inicio)));

function rotuloDoDia(d: string): string {
  const hoje = new Date();
  const amanha = new Date(hoje.getTime() + 86_400_000);
  if (d === dia(hoje)) return "Hoje";
  if (d === dia(amanha)) return "Amanhã";
  return new Date(`${d}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "long", day: "2-digit", month: "2-digit" });
}

/** "Com Lucas e Maria", "Com Lucas e mais 3". */
function comQuem(p: string[]): string {
  if (!p.length) return "";
  if (p.length <= 2) return `Com ${p.join(" e ")}`;
  return `Com ${p[0]} e mais ${p.length - 1}`;
}

/** Agora entre início e fim: a reunião que está acontecendo ganha destaque. */
const acontecendo = (e: Evento, agora = Date.now()) => !e.diaInteiro && Date.parse(e.inicio) <= agora && agora < Date.parse(e.fim);

function Linha({ e, mostrarConta }: { e: Evento; mostrarConta: boolean }) {
  const detalhes = [comQuem(e.pessoas), e.local && !e.local.startsWith("http") ? e.local : ""].filter(Boolean).join(" · ");
  return (
    <div className={`agenda-evento ${acontecendo(e) ? "agora" : ""}`}>
      <span className="agenda-time">{e.diaInteiro ? "Dia todo" : hora(e.inicio)}</span>
      <span className={`agenda-line ${e.pessoas.length || e.entrar ? "lavender" : "mint"}`} />
      <span className="agenda-evento-texto">
        {e.abrir ? (
          <a href={e.abrir} target="_blank" rel="noopener noreferrer">
            <strong>{e.titulo}</strong>
          </a>
        ) : (
          <strong>{e.titulo}</strong>
        )}
        {detalhes && <small>{detalhes}</small>}
        {mostrarConta && (
          <span className="agenda-contas">
            {e.contas.map((c) => (
              <span key={c} className="proposta-conta" title={c}>
                {c}
              </span>
            ))}
          </span>
        )}
      </span>
      {e.entrar && (
        <a className="button primary compacto agenda-entrar" href={e.entrar} target="_blank" rel="noopener noreferrer">
          <Icone nome="play" />
          Entrar
        </a>
      )}
    </div>
  );
}

/**
 * A agenda de verdade, de todas as contas conectadas.
 *
 * `hoje`: o bloco "A seguir" da Visão geral. Mostra o que falta de hoje; com o
 * dia livre, o próximo compromisso (dizer "nada hoje" e esconder a reunião de
 * amanhã cedo seria inútil). `proximas`: a lista de Reuniões, por dia.
 * A etiqueta da conta só aparece com mais de uma agenda: com uma só é ruído.
 */
export function AgendaProxima({ modo, limite = 4 }: { modo: "hoje" | "proximas"; limite?: number }) {
  const { dado, carregando, erro } = useRecurso<Agenda>(CHAVE);
  const eventos = dado?.eventos ?? [];
  const mostrarConta = new Set(eventos.flatMap((e) => e.contas)).size > 1;

  if (carregando && !dado) return <div className="empty-state agenda-vazia">Lendo sua agenda…</div>;
  if (erro && !dado) return <div className="empty-state agenda-vazia">Não consegui ler a agenda agora.</div>;
  if (dado && dado.conectadas === 0) {
    return (
      <Link className="agenda-row" href="/app/conexoes">
        <span className="agenda-time">
          <Icone nome="plug" />
        </span>
        <span className="agenda-line mint" />
        <span>
          <strong>Conecte sua agenda</strong>
          <small>Google ou Outlook, e seus compromissos aparecem aqui</small>
        </span>
        <Icone nome="arrow-up-right" />
      </Link>
    );
  }

  const falhou = dado?.falhas.length ? <p className="agenda-aviso">Faltou a agenda de {dado.falhas.join(", ")} (reconecte em Conexões).</p> : null;

  if (modo === "hoje") {
    const hoje = dia(new Date());
    const deHoje = eventos.filter((e) => diaDoEvento(e) === hoje);
    const mostrar = (deHoje.length ? deHoje : eventos.slice(0, 1)).slice(0, limite);
    return (
      <>
        {!deHoje.length && <p className="agenda-aviso">Nada mais hoje.{mostrar.length ? ` O próximo é ${rotuloDoDia(diaDoEvento(mostrar[0])).toLowerCase()}:` : ""}</p>}
        {mostrar.map((e) => (
          <Linha key={e.id} e={e} mostrarConta={mostrarConta} />
        ))}
        {deHoje.length > limite && (
          <Link className="text-button" href="/app/reunioes">
            Mais {deHoje.length - limite} hoje <Icone nome="arrow-right" />
          </Link>
        )}
        {falhou}
      </>
    );
  }

  // em Reuniões, só reunião: bloco de rotina ("Água", "Academia") é agenda, e
  // continua na Visão geral. O mesmo critério do aviso "Reunião em breve".
  const reunioes = eventos.filter((e) => !e.diaInteiro && (e.pessoas.length > 0 || !!e.entrar));
  if (!reunioes.length) return <div className="empty-state agenda-vazia">Nenhuma reunião com outras pessoas nos próximos dias.{falhou}</div>;
  const porDia = new Map<string, Evento[]>();
  for (const e of reunioes.slice(0, limite)) porDia.set(diaDoEvento(e), [...(porDia.get(diaDoEvento(e)) ?? []), e]);
  return (
    <div className="agenda-dias">
      {[...porDia].map(([d, lista]) => (
        <section key={d}>
          <h4 className="agenda-dia">{rotuloDoDia(d)}</h4>
          {lista.map((e) => (
            <Linha key={e.id} e={e} mostrarConta={mostrarConta} />
          ))}
        </section>
      ))}
      {falhou}
    </div>
  );
}
