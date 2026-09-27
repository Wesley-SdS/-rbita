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
  const [pareamento, setPareamento] = useState<{ qr: string | null; codigo: string | null; expiraEm: number } | null>(null);
  const [telefone, setTelefone] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  // enquanto o QR está na tela, o estado é conferido de novo a cada poucos
  // segundos: é assim que "Conectado" aparece sozinho depois da leitura
  // (com margem além da validade do QR; vencido, o dono gera outro)
  useEffect(() => {
    if (!pareamento) return;
    const t = setInterval(() => {
      if (Date.now() > pareamento.expiraEm + 30_000) return clearInterval(t);
      invalidar("/api/whatsapp/sessao");
    }, 4000);
    return () => clearInterval(t);
  }, [pareamento]);
  useEffect(() => {
    if (sessao?.status === "conectado") setPareamento(null);
  }, [sessao?.status]);

  async function parear(modo: "qr" | "codigo") {
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch("/api/whatsapp/parear", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(modo === "codigo" ? { modo, telefone } : { modo }),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) return setFalha(d.error ?? "Não consegui falar com a ponte do WhatsApp.");
      setPareamento({ qr: d.qr ?? null, codigo: d.codigo ?? null, expiraEm: Date.parse(d.expiraEm) || Date.now() + 60_000 });
      invalidar("/api/whatsapp/sessao");
    } catch {
      setFalha("Sem conexão com a Órbita. Tente de novo.");
    } finally {
      setOcupado(false);
    }
  }

  async function desconectar() {
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch("/api/whatsapp/desconectar", { method: "POST" });
      // falhou em desligar na ponte: o número CONTINUA conectado, e a tela diz isso
      if (!r.ok) setFalha(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não consegui desconectar. O número continua conectado.");
      invalidar("/api/whatsapp/sessao");
    } catch {
      setFalha("Sem conexão com a Órbita. O número continua conectado.");
    } finally {
      setOcupado(false);
    }
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
  const [editando, setEditando] = useState<{ id: string; apelido: string } | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  async function mudar(id: string, patch: { modo?: Contato["modo"]; apelido?: string | null; retomar?: boolean }) {
    setErro(null);
    try {
      const r = await fetch(`/api/whatsapp/contatos/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      if (!r.ok) setErro(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não consegui salvar.");
    } catch {
      setErro("Sem conexão com a Órbita.");
    }
    invalidar("/api/whatsapp/contatos");
  }

  const nomePorJid = new Map((dado?.contatos ?? []).map((c) => [c.jid, c.apelido ?? c.nome ?? c.jid.split("@")[0]]));

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
          {erro && <p className="notice">{erro}</p>}
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
                    {editando?.id === c.id ? (
                      <form
                        className="whatsapp-acoes"
                        onSubmit={(e) => {
                          e.preventDefault();
                          void mudar(c.id, { apelido: editando.apelido.trim() || null });
                          setEditando(null);
                        }}
                      >
                        <input
                          aria-label={`Como você chama ${c.nome ?? "este contato"}`}
                          value={editando.apelido}
                          onChange={(e) => setEditando({ id: c.id, apelido: e.target.value })}
                          placeholder="ex.: mãe"
                          maxLength={80}
                          autoFocus
                        />
                        <button type="submit" className="button compacto" aria-label="Salvar apelido">
                          <Icone nome="check" />
                        </button>
                      </form>
                    ) : (
                      <button className="button compacto" aria-label={`Editar apelido de ${c.apelido ?? c.nome ?? "contato"}`} onClick={() => setEditando({ id: c.id, apelido: c.apelido ?? "" })}>
                        <Icone nome="edit" />
                      </button>
                    )}
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
                      {nomePorJid.get(m.chatJid) ?? m.chatJid.split("@")[0]}: {m.texto}
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
