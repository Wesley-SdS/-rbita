"use client";

import { useEffect, useState } from "react";
import { Icone } from "@/components/presenca/icones";

interface Aviso {
  id: string;
  title: string;
  content: string;
  read: boolean;
}
interface Rotina {
  id: string;
  title: string;
  intervalMinutes: number;
  prompt?: string;
}

const CADENCIAS = [
  { minutos: 60, rotulo: "A cada hora" },
  { minutos: 360, rotulo: "A cada 6 horas" },
  { minutos: 720, rotulo: "Duas vezes por dia" },
  { minutos: 1440, rotulo: "Todos os dias" },
  { minutos: 10080, rotulo: "Toda semana" },
];

function cadencia(minutos: number) {
  return CADENCIAS.find((c) => c.minutos === minutos)?.rotulo ?? `A cada ${minutos} min`;
}

/* Um ícone por rotina, escolhido pelo intervalo: o de hora em hora é o mais
   frequente e ganha a faísca, o diário ganha o sol, o semanal a lua. É só
   linguagem visual, o comportamento não muda. */
function iconeDa(minutos: number) {
  if (minutos <= 60) return { nome: "spark", fundo: "mint-bg" };
  if (minutos >= 10080) return { nome: "moon", fundo: "lavender-bg" };
  return { nome: "sun", fundo: "peach-bg" };
}

/**
 * Rotinas: pequenos rituais que a Órbita cuida sozinha.
 *
 * Quem executa é o processo persistente (`apps/api`), não esta tela: o
 * agendador que vivia aqui morreu na Onda 1, e por isso as rotinas continuam
 * rodando com o navegador fechado.
 */
export function RoutinesPanel() {
  const [avisos, setAvisos] = useState<Aviso[]>([]);
  const [rotinas, setRotinas] = useState<Rotina[]>([]);
  const [criando, setCriando] = useState(false);
  const [titulo, setTitulo] = useState("");
  const [instrucao, setInstrucao] = useState("");
  const [intervalo, setIntervalo] = useState(1440);
  const [ocupado, setOcupado] = useState(false);

  function carregarAvisos() {
    fetch("/api/notifications")
      .then((r) => r.json())
      .then((d) => setAvisos(d.notifications ?? []))
      .catch(() => {});
  }
  function carregarRotinas() {
    fetch("/api/routines")
      .then((r) => r.json())
      .then((d) => setRotinas(d.routines ?? []))
      .catch(() => {});
  }

  useEffect(() => {
    carregarAvisos();
    carregarRotinas();
    const poll = setInterval(carregarAvisos, 30000);
    return () => clearInterval(poll);
  }, []);

  async function criar(e: React.FormEvent) {
    e.preventDefault();
    if (!titulo.trim() || !instrucao.trim() || ocupado) return;
    setOcupado(true);
    try {
      await fetch("/api/routines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: titulo, prompt: instrucao, intervalMinutes: intervalo }),
      });
      setTitulo("");
      setInstrucao("");
      setCriando(false);
      carregarRotinas();
    } finally {
      setOcupado(false);
    }
  }

  async function rodarAgora() {
    setOcupado(true);
    try {
      await fetch("/api/routines/run", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ force: true }),
      });
      carregarAvisos();
    } finally {
      setOcupado(false);
    }
  }

  async function apagar(id: string) {
    await fetch(`/api/routines?id=${id}`, { method: "DELETE" });
    carregarRotinas();
  }

  async function marcarLida(id: string) {
    await fetch("/api/notifications", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id }),
    });
    carregarAvisos();
  }

  const naoLidos = avisos.filter((a) => !a.read);

  return (
    <>
      {naoLidos.length > 0 && (
        <div className="memory-banner">
          <Icone nome="spark" />
          <div>
            <h3>
              {naoLidos.length === 1 ? "Uma rotina trouxe algo" : `${naoLidos.length} rotinas trouxeram algo`}
            </h3>
            <p>Enquanto você estava em outra coisa, a Órbita reuniu isto para você.</p>
          </div>
        </div>
      )}

      {avisos.length > 0 && (
        <div className="panel" style={{ marginBottom: 22 }}>
          <div className="panel-label">O QUE CHEGOU ENQUANTO ISSO</div>
          {avisos.slice(0, 6).map((a) => (
            <button key={a.id} className={`aviso-rotina ${a.read ? "lido" : ""}`} onClick={() => marcarLida(a.id)}>
              <span className="tiny-dot" />
              <span>
                <strong>{a.title}</strong>
                <small>{a.content}</small>
              </span>
            </button>
          ))}
        </div>
      )}

      <div className="section-heading" style={{ marginBottom: 18 }}>
        <div>
          <h2>Seus rituais</h2>
          <p className="descricao-secao">
            {rotinas.length === 0
              ? "Nenhum ainda. Uma rotina é um pedido que se repete sozinho."
              : `${rotinas.length} ${rotinas.length === 1 ? "rotina cuidando" : "rotinas cuidando"} do resto.`}
          </p>
        </div>
        <div className="acoes-secao">
          {rotinas.length > 0 && (
            <button className="button secondary compacto" onClick={rodarAgora} disabled={ocupado}>
              <Icone nome="play" />
              {ocupado ? "Rodando…" : "Rodar agora"}
            </button>
          )}
          <button className="button primary compacto" onClick={() => setCriando((v) => !v)}>
            <Icone nome={criando ? "close" : "plus"} />
            {criando ? "Cancelar" : "Criar rotina"}
          </button>
        </div>
      </div>

      {criando && (
        <form className="panel" onSubmit={criar} style={{ marginBottom: 20 }}>
          <span className="eyebrow">UM RITUAL QUE COMBINA COM VOCÊ</span>
          <label className="field">
            Nome da rotina
            <input value={titulo} onChange={(e) => setTitulo(e.target.value)} required maxLength={80} placeholder="Ex.: Meu começo de dia" />
          </label>
          <label className="field">
            Qual é a intenção?
            <textarea
              value={instrucao}
              onChange={(e) => setInstrucao(e.target.value)}
              required
              maxLength={2000}
              placeholder="O que a Órbita deve fazer? Ex.: reunir minha agenda e o que ficou de ontem."
            />
          </label>
          <label className="field">
            Com que frequência?
            <select value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))}>
              {CADENCIAS.map((c) => (
                <option key={c.minutos} value={c.minutos}>
                  {c.rotulo}
                </option>
              ))}
            </select>
          </label>
          <div className="form-actions">
            <button type="button" className="button secondary" onClick={() => setCriando(false)}>
              Agora não
            </button>
            <button type="submit" className="button primary" disabled={ocupado}>
              <Icone nome="check" />
              Criar rotina
            </button>
          </div>
        </form>
      )}

      {rotinas.length === 0 ? (
        <div className="panel empty-state">
          Nada por aqui ainda. Crie um ritual e a Órbita cuida da sequência, mesmo com o navegador fechado.
        </div>
      ) : (
        <div className="three-columns">
          {rotinas.map((r) => {
            const ico = iconeDa(r.intervalMinutes);
            return (
              <article key={r.id} className="panel routine-card">
                <div className="routine-top">
                  <span className={`quick-icon ${ico.fundo}`}>
                    <Icone nome={ico.nome} />
                  </span>
                  <button className="icon-button" onClick={() => apagar(r.id)} aria-label={`Apagar ${r.title}`} title="Apagar rotina">
                    <Icone nome="trash" />
                  </button>
                </div>
                <h3>{r.title}</h3>
                <p>{r.prompt || "Sem descrição."}</p>
                <div className="routine-flow">
                  <div className="flow-step">
                    <span>
                      <Icone nome="clock" />
                    </span>
                    {cadencia(r.intervalMinutes)}
                  </div>
                  <div className="flow-connector" />
                  <div className="flow-step">
                    <span>
                      <Icone nome="network" />
                    </span>
                    Considerar seu contexto
                  </div>
                  <div className="flow-connector" />
                  <div className="flow-step">
                    <span>
                      <Icone nome="check" />
                    </span>
                    Avisar você aqui
                  </div>
                </div>
                <div className="routine-bottom">
                  <span>Roda no servidor, sem você abrir nada</span>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </>
  );
}
