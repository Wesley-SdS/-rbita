"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Icone } from "@/components/presenca/icones";

/**
 * Telegram, o canal da PRÓPRIA Órbita (PRD-TELEGRAM): um bot oficial onde ela
 * fala como ela mesma, com você e com as pessoas da casa. Aqui só há botões;
 * toda regra (quem pode falar, o que a família pode pedir, aprovação) mora no
 * servidor.
 */

interface Estado {
  conectado: boolean;
  bot: { username: string; ultimoContatoEm: string | null; ultimoErro: string | null } | null;
  contatos: { id: string; nome: string | null; username: string | null; papel: "dono" | "pessoa" | "desconhecido" | "bloqueado"; pessoa: string | null }[];
  pessoas: { id: string; nome: string }[];
}

const PAPEL: Record<Estado["contatos"][number]["papel"], string> = {
  dono: "Você",
  pessoa: "Pessoa da casa",
  desconhecido: "Sem convite",
  bloqueado: "Bloqueado",
};

async function pedir(url: string, init?: RequestInit): Promise<{ ok: boolean; dado: Record<string, unknown> }> {
  try {
    const r = await fetch(url, init);
    return { ok: r.ok, dado: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  } catch {
    return { ok: false, dado: { error: "Sem conexão com a Órbita. Tente de novo." } };
  }
}

export function BlocoTelegram() {
  const { dado: estado, erro } = useRecurso<Estado>("/api/telegram");
  const [token, setToken] = useState("");
  const [pessoa, setPessoa] = useState("");
  const [convite, setConvite] = useState<{ link: string; para: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function agir(url: string, corpo?: unknown, metodo = "POST") {
    setOcupado(true);
    setFalha(null);
    const r = await pedir(url, { method: metodo, headers: { "Content-Type": "application/json" }, body: corpo === undefined ? undefined : JSON.stringify(corpo) });
    setOcupado(false);
    if (!r.ok) setFalha(String(r.dado.error ?? "Não deu certo."));
    invalidar("/api/telegram");
    return r;
  }

  async function conectar() {
    const r = await agir("/api/telegram/conectar", { token });
    if (r.ok) setToken("");
  }

  async function convidar(papel: "dono" | "pessoa") {
    const r = await agir("/api/telegram/convite", papel === "dono" ? { papel } : { papel, personId: pessoa });
    if (r.ok) setConvite({ link: String(r.dado.link), para: papel === "dono" ? "você" : estado?.pessoas.find((p) => p.id === pessoa)?.nome ?? "a pessoa" });
  }

  const conectado = Boolean(estado?.conectado);
  const donoVinculado = estado?.contatos.some((c) => c.papel === "dono");
  const parado = estado?.bot?.ultimoErro || (estado?.bot?.ultimoContatoEm && Date.now() - Date.parse(estado.bot.ultimoContatoEm) > 120_000);

  return (
    <article className="panel connector-card">
      <div className="connector-top">
        <span className="connector-logo">T</span>
        <span className={`tag ${conectado && !parado ? "green" : erro || parado ? "orange-tag" : ""}`}>
          {erro ? "Não consegui verificar" : !conectado ? "Não conectado" : parado ? "Sem resposta do Telegram" : "Conectado"}
        </span>
      </div>
      <h3>Telegram da Órbita</h3>
      <p>
        O canal da própria Órbita: um bot seu, oficial, onde ela fala como ela mesma. Você conversa com ela, recebe avisos e o briefing, e aprova
        pedidos com um botão. As pessoas da casa também podem falar com ela por aqui, só com o que você liberar.
      </p>

      {!conectado ? (
        <>
          <ol className="lista-passos">
            <li>No Telegram, abra o @BotFather e mande /newbot.</li>
            <li>Escolha o nome (ex.: Órbita) e um usuário terminado em bot (ex.: orbita_da_casa_bot).</li>
            <li>Copie o token que ele mostrar e cole abaixo.</li>
          </ol>
          <label className="field">
            Token do bot
            <input name="telegram-token" type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="123456789:AA..." autoComplete="off" />
          </label>
          <button className="button primary full-width" onClick={conectar} disabled={ocupado || token.trim().length < 20}>
            <Icone nome="link" />
            Conectar o bot
          </button>
        </>
      ) : (
        <>
          <p className="connector-conta">
            <Icone nome="check" />
            <a href={`https://t.me/${estado?.bot?.username}`} target="_blank" rel="noreferrer">
              @{estado?.bot?.username}
            </a>
          </p>
          {estado?.bot?.ultimoErro && <p className="notice">Último erro: {estado.bot.ultimoErro}</p>}

          {!donoVinculado && (
            <button className="button primary full-width" onClick={() => convidar("dono")} disabled={ocupado}>
              <Icone nome="plus" />
              Vincular o meu Telegram
            </button>
          )}

          <label className="field">
            Convidar uma pessoa da casa
            <select value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
              <option value="">Escolha a pessoa</option>
              {estado?.pessoas.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.nome}
                </option>
              ))}
            </select>
          </label>
          <button className="button full-width" onClick={() => convidar("pessoa")} disabled={ocupado || !pessoa}>
            Gerar convite
          </button>
          {!estado?.pessoas.length && <p className="notice">Cadastre a pessoa primeiro em Casa, Pessoas.</p>}

          {convite && (
            <div className="notice">
              <p>
                Convite para {convite.para} (vale uma vez, por pouco tempo). {convite.para === "você" ? "Abra no seu celular:" : "Mande este link para ela:"}
              </p>
              <p>
                <a href={convite.link} target="_blank" rel="noreferrer">
                  {convite.link}
                </a>
              </p>
              <button className="button compacto" onClick={() => void navigator.clipboard?.writeText(convite.link)}>
                Copiar link
              </button>
            </div>
          )}

          {estado?.contatos.length ? (
            <ul className="whatsapp-lista">
              {estado.contatos.map((c) => (
                <li key={c.id}>
                  <span>
                    <strong>{c.pessoa ?? c.nome ?? c.username ?? "Sem nome"}</strong>
                    {` · ${PAPEL[c.papel]}`}
                  </span>
                  <span className="whatsapp-acoes">
                    {c.papel !== "bloqueado" && c.papel !== "dono" && (
                      <button className="button compacto" onClick={() => agir(`/api/telegram/contatos/${c.id}`, { papel: "bloqueado" }, "PATCH")} disabled={ocupado}>
                        Bloquear
                      </button>
                    )}
                    {(c.papel === "pessoa" || c.papel === "bloqueado") && (
                      <button className="button compacto" onClick={() => agir(`/api/telegram/contatos/${c.id}`, { papel: "desconhecido" }, "PATCH")} disabled={ocupado}>
                        {c.papel === "bloqueado" ? "Desbloquear" : "Desvincular"}
                      </button>
                    )}
                    <button className="button compacto" aria-label={`Apagar ${c.nome ?? "contato"} e a conversa`} onClick={() => agir(`/api/telegram/contatos/${c.id}`, undefined, "DELETE")} disabled={ocupado}>
                      <Icone nome="trash" />
                    </button>
                  </span>
                </li>
              ))}
            </ul>
          ) : null}

          <button className="button danger" onClick={() => agir("/api/telegram/desconectar")} disabled={ocupado}>
            <Icone nome="close" />
            Desconectar o bot
          </button>
        </>
      )}
      {falha && <p className="notice">{falha}</p>}
    </article>
  );
}
