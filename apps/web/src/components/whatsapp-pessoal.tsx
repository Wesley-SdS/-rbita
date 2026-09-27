"use client";

import { useEffect, useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

/**
 * WhatsApp PESSOAL pela ponte local (PRD-WHATSAPP W1 e W7): parear o número,
 * ver se continua conectado e escolher, contato a contato, quem a Órbita pode
 * responder sozinha. Toda regra mora no servidor; aqui só há botões.
 */

interface Sessao {
  status: "sem_sessao" | "desconectado" | "pareando" | "conectado" | "banido";
  numero: string | null;
  provedorAtivo: "pessoal" | "cloud" | null;
}

interface Contato {
  id: string;
  jid: string;
  nome: string | null;
  apelido: string | null;
  grupo: boolean;
  modo: "aprovar" | "automatico";
  pausadoAte: string | null;
  ultimaMensagemEm: string | null;
}

interface Contatos {
  contatos: Contato[];
  automaticas: { id: string; chatJid: string; texto: string | null; em: string }[];
}

const ROTULO: Record<Sessao["status"], string> = {
  sem_sessao: "Não pareado",
  desconectado: "Desconectado",
  pareando: "Esperando o celular",
  conectado: "Conectado",
  banido: "Número bloqueado pelo WhatsApp",
};

export function BlocoWhatsappPessoal() {
  const { dado: sessao, erro } = useRecurso<Sessao>("/api/whatsapp/sessao");
  const [pareamento, setPareamento] = useState<{ qr: string | null; codigo: string | null } | null>(null);
  const [telefone, setTelefone] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  // enquanto o QR está na tela, o estado é conferido de novo a cada poucos
  // segundos: é assim que "Conectado" aparece sozinho depois da leitura
  useEffect(() => {
    if (!pareamento) return;
    const t = setInterval(() => invalidar("/api/whatsapp/sessao"), 4000);
    return () => clearInterval(t);
  }, [pareamento]);
  useEffect(() => {
    if (sessao?.status === "conectado") setPareamento(null);
  }, [sessao?.status]);

  async function parear(modo: "qr" | "codigo") {
    setOcupado(true);
    setFalha(null);
    const r = await fetch("/api/whatsapp/parear", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(modo === "codigo" ? { modo, telefone } : { modo }),
    });
    const d = await r.json().catch(() => ({}));
    setOcupado(false);
    if (!r.ok) return setFalha(d.error ?? "Não consegui falar com a ponte do WhatsApp.");
    setPareamento({ qr: d.qr ?? null, codigo: d.codigo ?? null });
    invalidar("/api/whatsapp/sessao");
  }

  async function desconectar() {
    setOcupado(true);
    await fetch("/api/whatsapp/desconectar", { method: "POST" });
    setOcupado(false);
    invalidar("/api/whatsapp/sessao");
  }

  const status = sessao?.status ?? "sem_sessao";
  const conectado = status === "conectado";

  return (
    <article className="panel connector-card">
      <div className="connector-top">
        <span className="connector-logo">W</span>
        <span className={`tag ${conectado ? "green" : erro || status === "banido" ? "orange-tag" : ""}`}>{erro ? "Não consegui verificar" : ROTULO[status]}</span>
      </div>
      <h3>WhatsApp pessoal</h3>
      <p>
        Seu próprio número, por uma ponte que roda nesta casa. A Órbita lê as conversas, ouve os áudios e responde por você, sempre com a sua
        aprovação. Na conversa com você mesmo, ela é a sua assistente.
      </p>

      {conectado ? (
        <>
          <p className="connector-conta">
            <Icone nome="check" />
            Número {sessao?.numero}
          </p>
          <button className="button danger" onClick={desconectar} disabled={ocupado}>
            <Icone nome="close" />
            Desconectar
          </button>
        </>
      ) : (
        <>
          {pareamento?.qr && (
            <div className="whatsapp-qr">
              {/* eslint-disable-next-line @next/next/no-img-element -- data URL gerada na hora, não passa pelo otimizador */}
              <img src={pareamento.qr} alt="QR code para parear o WhatsApp" width={240} height={240} />
              <p>No celular: WhatsApp, Aparelhos conectados, Conectar um aparelho.</p>
            </div>
          )}
          {pareamento?.codigo && (
            <p className="connector-conta">
              Código para digitar no celular: <strong>{pareamento.codigo}</strong>
            </p>
          )}
          <button className="button primary full-width" onClick={() => parear("qr")} disabled={ocupado}>
            <Icone nome="link" />
            {pareamento?.qr ? "Gerar outro QR" : "Parear com QR code"}
          </button>
          <label className="field">
            Ou pelo número (recebe um código)
            <input name="whatsapp-telefone" value={telefone} onChange={(e) => setTelefone(e.target.value)} placeholder="55 11 99999-8888" inputMode="tel" autoComplete="off" />
          </label>
          <button className="button full-width" onClick={() => parear("codigo")} disabled={ocupado || telefone.replace(/\D/g, "").length < 10}>
            Pedir código
          </button>
        </>
      )}
      {falha && <p className="notice">{falha}</p>}
      {conectado && <ContatosDoWhatsapp />}
    </article>
  );
}

function ContatosDoWhatsapp() {
  const { dado } = useRecurso<Contatos>("/api/whatsapp/contatos");
  const [aberto, setAberto] = useState(false);
  const [filtro, setFiltro] = useState("");

  async function mudar(id: string, patch: { modo?: Contato["modo"]; apelido?: string | null; retomar?: boolean }) {
    const r = await fetch(`/api/whatsapp/contatos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
    if (!r.ok) {
      const d = await r.json().catch(() => ({}));
      alert(d.error ?? "Não consegui salvar.");
    }
    invalidar("/api/whatsapp/contatos");
  }

  const f = filtro.trim().toLowerCase();
  const pessoas = (dado?.contatos ?? []).filter((c) => !c.grupo && (!f || `${c.apelido ?? ""} ${c.nome ?? ""} ${c.jid}`.toLowerCase().includes(f)));
  const automaticos = pessoas.filter((c) => c.modo === "automatico").length;

  return (
    <div className="whatsapp-contatos">
      <button className="button compacto" onClick={() => setAberto(!aberto)}>
        {aberto ? "Fechar" : `Quem a Órbita responde sozinha (${automaticos})`}
      </button>
      {aberto && (
        <>
          <p className="notice">
            Marcado, a Órbita responde aquele contato sem pedir sua aprovação. Nesse modo ela não enxerga nada seu (agenda, finanças, e-mail,
            casa), só aquela conversa. Grupo nunca é respondido sozinho. Se você escrever à mão na conversa, ela para por um tempo.
          </p>
          <label className="field">
            Procurar
            <input value={filtro} onChange={(e) => setFiltro(e.target.value)} placeholder="nome ou número" autoComplete="off" />
          </label>
          <ul className="whatsapp-lista">
            {pessoas.slice(0, 100).map((c) => {
              const pausado = c.pausadoAte && new Date(c.pausadoAte).getTime() > Date.now();
              return (
                <li key={c.id}>
                  <span>
                    <strong>{c.apelido ?? c.nome ?? c.jid.split("@")[0]}</strong>
                    {c.apelido && c.nome ? ` (${c.nome})` : ""}
                    {pausado ? " · pausado" : ""}
                  </span>
                  <span className="whatsapp-acoes">
                    <button
                      className="button compacto"
                      onClick={() => {
                        const novo = prompt("Como você chama esta pessoa? (ex.: mãe)", c.apelido ?? "");
                        if (novo !== null) void mudar(c.id, { apelido: novo.trim() || null });
                      }}
                    >
                      <Icone nome="edit" />
                    </button>
                    {pausado && (
                      <button className="button compacto" onClick={() => mudar(c.id, { retomar: true })}>
                        Retomar
                      </button>
                    )}
                    <label className="whatsapp-toggle">
                      <input type="checkbox" checked={c.modo === "automatico"} onChange={(e) => mudar(c.id, { modo: e.target.checked ? "automatico" : "aprovar" })} />
                      Sozinha
                    </label>
                  </span>
                </li>
              );
            })}
          </ul>
          {dado?.automaticas.length ? (
            <>
              <h4>O que ela mandou sozinha</h4>
              <ul className="whatsapp-lista">
                {dado.automaticas.map((m) => (
                  <li key={m.id}>
                    <span>
                      {new Date(m.em).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" })} · para{" "}
                      {dado.contatos.find((c) => c.jid === m.chatJid)?.apelido ?? dado.contatos.find((c) => c.jid === m.chatJid)?.nome ?? m.chatJid.split("@")[0]}: {m.texto}
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </>
      )}
    </div>
  );
}
