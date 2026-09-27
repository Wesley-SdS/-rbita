"use client";

import { useEffect, useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";
import { BlocoWhatsappPessoal } from "@/components/whatsapp-pessoal";

interface Conta {
  id: string;
  label: string | null;
  principal: boolean;
  expiraEm: string | null;
  falhasDeRenovacao: number;
}

interface Conector {
  id: string;
  label: string;
  icon: string;
  blurb: string;
  configured: boolean;
  connected: boolean;
  accountLabel: string | null;
  /** Uma linha por CONTA: o Google deixou de ser "conectado ou não". */
  contas: Conta[];
}

/**
 * Conexões: o que entra na conversa, e com que limite.
 *
 * Cada conector é um cartão, como no protótipo. O estado "falta configurar no
 * servidor" aparece por escrito em vez de sumir o botão: o dono precisa saber
 * a diferença entre "não quis conectar" e "não dá para conectar ainda".
 *
 * E falha de carregamento é DITA, não engolida. Este painel já mostrou a grade
 * com o cartão do WhatsApp sozinho, sem nenhum aviso, quando a leitura de
 * `/api/connectors` falhou: o dono viu "não tenho conector nenhum" e a
 * verdade era que a lista não tinha chegado (a rota respondia 200 com cinco
 * conectores e o Google conectado, conferido no mesmo minuto). Lista vazia e
 * lista que não carregou são coisas diferentes, e a tela tem de distinguir as
 * duas. É o mesmo princípio do `contexto-seguro.ts`: falha silenciosa vira
 * falha que se explica.
 */
export function ConnectorsPanel() {
  const { dado, carregando, erro, recarregar } = useRecurso<{ connectors: Conector[] }>("/api/connectors", { estavel: true });
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

  /** Desconecta TODAS as contas do provedor. */
  async function desconectarTudo(id: string) {
    await fetch(`/api/connectors/${id}`, { method: "DELETE" });
    invalidar("/api/connectors");
  }

  /** Desconecta UMA conta, sem levar as outras junto. */
  async function desconectarConta(contaId: string) {
    await fetch(`/api/connectors/contas?id=${contaId}`, { method: "DELETE" });
    invalidar("/api/connectors");
  }

  /** Troca qual conta responde quando o pedido não diz qual. */
  async function tornarPrincipal(contaId: string) {
    await fetch("/api/connectors/contas", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: contaId }),
    });
    invalidar("/api/connectors");
  }

  return (
    <>
      {recado && <div className="notice">{recado}</div>}

      {erro && (
        <div className="notice" style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Icone nome="info" />
          <span style={{ flex: 1, minWidth: 200 }}>
            Não consegui carregar suas conexões ({erro}) Os conectores abaixo podem estar faltando por isso, não por
            estarem desligados.
          </span>
          <button className="button secondary compacto" onClick={recarregar}>
            <Icone nome="refresh" />
            Tentar de novo
          </button>
        </div>
      )}

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
              {c.contas.length > 0 && (
                <ul className="conta-lista">
                  {c.contas.map((conta, i) => (
                    <li key={conta.id} className={`conta-item ${conta.principal ? "principal" : ""}`}>
                      <Icone nome={conta.falhasDeRenovacao > 0 ? "clock" : "check"} />
                      <span className="conta-nome">{conta.label ?? (i === 0 ? "Conta conectada" : `Conta ${i + 1}`)}</span>
                      {/* "principal" só aparece quando há mais de uma: com uma conta só, a palavra não significa nada */}
                      {conta.principal && c.contas.length > 1 && <span className="tag green">principal</span>}
                      {conta.falhasDeRenovacao > 0 && <span className="tag orange-tag">reconecte</span>}
                      {!conta.principal && (
                        <button className="conta-acao" onClick={() => tornarPrincipal(conta.id)} title="Usar esta conta para enviar e criar">
                          tornar principal
                        </button>
                      )}
                      <button className="icon-button" onClick={() => desconectarConta(conta.id)} aria-label={`Desconectar ${conta.label ?? "conta"}`} title="Desconectar esta conta">
                        <Icone nome="close" />
                      </button>
                    </li>
                  ))}
                </ul>
              )}

              {!c.configured ? (
                <div className="notice" style={{ margin: "16px 0 0" }}>
                  Faltam as credenciais deste serviço no servidor. Sem elas a Órbita não tem como pedir acesso em seu nome.
                </div>
              ) : (
                <div className="conta-botoes">
                  <a className={`button ${c.connected ? "secondary" : "primary"} compacto`} href={`/api/connectors/${c.id}/connect`}>
                    <Icone nome={c.connected ? "plus" : "link"} />
                    {c.connected ? "Conectar outra conta" : "Conectar"}
                  </a>
                  {c.contas.length > 1 && (
                    <button className="button danger compacto" onClick={() => desconectarTudo(c.id)}>
                      Desconectar todas
                    </button>
                  )}
                </div>
              )}
            </article>
          ))}

          <BlocoWhatsappPessoal />
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
  const { dado: estado, erro } = useRecurso<{ configured: boolean; phoneId: string | null }>("/api/channels/whatsapp", { estavel: true });
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
        {/* sem estado lido, "Não configurado" seria uma AFIRMAÇÃO que a tela não
            pode fazer: ela não sabe, e dizer que não sabe é o certo */}
        <span className={`tag ${estado?.configured ? "green" : erro ? "orange-tag" : ""}`}>
          {erro ? "Não consegui verificar" : estado?.configured ? "Configurado" : "Não configurado"}
        </span>
      </div>
      <h3>WhatsApp Business (Cloud API)</h3>
      <p>Token e ID do número do seu app da Meta. Só envia texto; para ler conversas, use o WhatsApp pessoal.</p>

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
          {/*
            AUTOCOMPLETE: o Chrome ignora `autocomplete="off"` num par
            texto + senha, porque presume um formulário de login. O resultado
            foi ele preencher o ID do número com o e-mail da conta
            (`wesley@orbita.local`) e o token com a senha guardada: um clique em
            "Guardar" e a Órbita ficaria com credencial de WhatsApp inventada.
            `new-password` é o que de fato desfaz essa presunção, e os `name`
            próprios tiram o campo do palpite de "usuário" e "senha".
          */}
          <label className="field">
            ID do número
            <input
              name="whatsapp-phone-id"
              value={numero}
              onChange={(e) => setNumero(e.target.value)}
              placeholder="phone_id"
              inputMode="numeric"
              autoComplete="off"
              data-lpignore="true"
            />
          </label>
          <label className="field">
            Token de acesso
            <input
              name="whatsapp-token"
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder="token"
              autoComplete="new-password"
              data-lpignore="true"
            />
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
