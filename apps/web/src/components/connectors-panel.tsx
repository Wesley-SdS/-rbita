"use client";

import { useEffect, useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

interface Conector {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
}

/**
 * Conexões: o que entra na conversa, e com que limite.
 *
 * Cada conector é um cartão, como no protótipo. O estado "falta configurar no
 * servidor" aparece por escrito em vez de sumir o botão: o dono precisa saber
 * a diferença entre "não quis conectar" e "não dá para conectar ainda".
 */
export function ConnectorsPanel() {
  const { dado, carregando } = useRecurso<{ connectors: Conector[] }>("/api/connectors", { estavel: true });
  const conectores = dado?.connectors ?? [];
  const [recado, setRecado] = useState<string | null>(null);

  useEffect(() => {
    // Volta do OAuth: `?connector=google&status=conectado`. A query sai da URL
    // para um F5 não repetir o recado de algo que já aconteceu.
    const p = new URLSearchParams(window.location.search);
    const conector = p.get("connector");
    const estado = p.get("status");
    if (conector && estado) {
      setRecado(estado === "conectado" ? `${conector} conectado.` : `${conector}: ${estado.replace(/_/g, " ")}`);
      window.history.replaceState({}, "", window.location.pathname);
      setTimeout(() => setRecado(null), 6000);
    }
  }, []);

  async function desconectar(id: string) {
    await fetch(`/api/connectors/${id}`, { method: "DELETE" });
    invalidar("/api/connectors");
  }

  return (
    <>
      {recado && <div className="notice">{recado}</div>}

      {carregando ? (
        <div className="panel empty-state">Carregando suas conexões…</div>
      ) : (
        <div className="three-columns">
          {conectores.map((c) => (
            <article key={c.id} className="panel connector-card">
              <div className="connector-top">
                <span className="connector-logo">{c.icon}</span>
                <span className={`tag ${c.connected ? "green" : ""}`}>{c.connected ? "Conectado" : "Não conectado"}</span>
              </div>
              <h3>{c.label}</h3>
              <p>{c.blurb}</p>
              {c.connected && c.accountLabel && (
                <p className="connector-conta">
                  <Icone nome="check" />
                  {c.accountLabel}
                </p>
              )}
              {!c.configured ? (
                <div className="notice" style={{ margin: "16px 0 0" }}>
                  Faltam as credenciais deste serviço no servidor. Sem elas a Órbita não tem como pedir acesso em seu nome.
                </div>
              ) : c.connected ? (
                <button className="button danger" onClick={() => desconectar(c.id)}>
                  <Icone nome="close" />
                  Desconectar
                </button>
              ) : (
                <a className="button primary" href={`/api/connectors/${c.id}/connect`}>
                  <Icone nome="link" />
                  Conectar
                </a>
              )}
            </article>
          ))}

          <BlocoWhatsapp />
        </div>
      )}

      <div className="notice">
        Você escolhe o que entra na conversa. Cada conexão pede só o acesso de que precisa, e dá para
        desligar a qualquer momento sem perder o que já foi guardado.
      </div>
    </>
  );
}

/**
 * WhatsApp não tem OAuth por usuário sem passar pela revisão de app da Meta
 * (Embedded Signup). O que dá para fazer é tirar o token do `.env` fixo e
 * trazer para a tela (CH.2, zero hardcode): token e ID do número vêm do app da
 * Meta que o dono já configurou.
 */
function BlocoWhatsapp() {
  const { dado: estado } = useRecurso<{ configured: boolean; phoneId: string | null }>("/api/channels/whatsapp", { estavel: true });
  const [numero, setNumero] = useState("");
  const [token, setToken] = useState("");
  const [ocupado, setOcupado] = useState(false);

  async function salvar(e: React.FormEvent) {
    e.preventDefault();
    setOcupado(true);
    await fetch("/api/channels/whatsapp", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ phoneId: numero, token }),
    });
    setOcupado(false);
    setToken("");
    invalidar("/api/channels/whatsapp");
  }

  async function remover() {
    setOcupado(true);
    await fetch("/api/channels/whatsapp", { method: "DELETE" });
    setOcupado(false);
    invalidar("/api/channels/whatsapp");
  }

  return (
    <article className="panel connector-card">
      <div className="connector-top">
        <span className="connector-logo">W</span>
        <span className={`tag ${estado?.configured ? "green" : ""}`}>{estado?.configured ? "Configurado" : "Não configurado"}</span>
      </div>
      <h3>WhatsApp</h3>
      <p>Token e ID do número do seu app da Meta (WhatsApp Business Cloud API).</p>

      {estado?.configured ? (
        <>
          <p className="connector-conta">
            <Icone nome="check" />
            Número {estado.phoneId}
          </p>
          <button className="button danger" onClick={remover} disabled={ocupado}>
            <Icone nome="close" />
            Desconectar
          </button>
        </>
      ) : (
        <form onSubmit={salvar}>
          <label className="field">
            ID do número
            <input value={numero} onChange={(e) => setNumero(e.target.value)} placeholder="phone_id" autoComplete="off" />
          </label>
          <label className="field">
            Token de acesso
            <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="token" autoComplete="off" />
          </label>
          <button type="submit" className="button primary full-width" disabled={ocupado || !numero || !token}>
            <Icone nome="check" />
            Guardar
          </button>
        </form>
      )}
    </article>
  );
}
