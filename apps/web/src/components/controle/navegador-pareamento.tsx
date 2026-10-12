"use client";

import { useEffect, useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, ErrorRetry } from "@/components/ui";

/**
 * Bloco "pareamento" da tela Controle do PC (frente B): o código de 6 dígitos
 * que o dono digita no popup da extensão, as extensões pareadas com o botão
 * de revogar, a ponte de native messaging (instalada, ativa, instalar e
 * remover pelo MESMO instalador do README) e o perfil dedicado (abrir com
 * janela para fazer login nos sites que as rotinas usam, e apagar os logins
 * dele). Toda regra está no servidor (`/api/navegador/*`, com OwnerGuard);
 * aqui só se mostra e se chama a rota.
 */

interface Extensao {
  id: string;
  nome: string;
  versao: string | null;
  criadaEm: string;
  vistaEm: string | null;
  revogadaEm: string | null;
}
interface Estado {
  extensaoId: string;
  conectada: boolean;
  codigo: { expiraEm: string } | null;
  extensoes: Extensao[];
}

interface EstadoDaPonte {
  instalada: boolean;
  segredo: boolean;
  manifesto: boolean;
  ativa: boolean;
}

const CHAVE = "/api/navegador/extensoes";
const CHAVE_DA_PONTE = "/api/navegador/ponte";
const dim = { color: "var(--color-ink-dim)" } as const;
const hora = (iso: string) => new Date(iso).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });

export function NavegadorPareamento() {
  const { dado, erro, recarregar } = useRecurso<Estado>(CHAVE);
  const ponte = useRecurso<EstadoDaPonte>(CHAVE_DA_PONTE);
  const [codigo, setCodigo] = useState<{ codigo: string; expiraEm: string } | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [agora, setAgora] = useState(() => Date.now());

  // o relógio do código: some quando vence, e a lista se atualiza para mostrar a extensão que acabou de parear
  useEffect(() => {
    if (!codigo) return;
    const t = setInterval(() => {
      setAgora(Date.now());
      invalidar(CHAVE);
    }, 3000);
    return () => clearInterval(t);
  }, [codigo]);
  const restante = codigo ? Math.max(0, Math.round((new Date(codigo.expiraEm).getTime() - agora) / 1000)) : 0;
  useEffect(() => {
    if (codigo && restante === 0) setCodigo(null);
  }, [codigo, restante]);

  async function chamar(url: string, init: RequestInit, ok: (d: Record<string, unknown>) => void) {
    setAviso(null);
    try {
      const r = await fetch(url, { ...init, headers: { "content-type": "application/json", ...(init.headers ?? {}) } });
      const d = (await r.json().catch(() => ({}))) as Record<string, unknown>;
      if (!r.ok) setAviso(typeof d.error === "string" ? d.error : "Não deu certo. Tente de novo.");
      else ok(d);
    } catch {
      setAviso("Sem conexão com a Órbita.");
    } finally {
      invalidar(CHAVE);
      invalidar(CHAVE_DA_PONTE);
    }
  }

  if (erro && !dado) return <ErrorRetry message={erro} onRetry={recarregar} />;

  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <p className="text-[14px]" style={dim}>
        Instale a extensão (apps/extensao-chrome, &quot;Carregar sem compactação&quot; em chrome://extensions), gere um código aqui e digite no
        popup dela. O código vale 5 minutos e uma vez só. {dado?.conectada ? "Uma extensão está conectada agora." : "Nenhuma extensão conectada agora."}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <Button size="sm" onClick={() => void chamar("/api/navegador/parear", { method: "POST" }, (d) => setCodigo({ codigo: String(d.codigo), expiraEm: String(d.expiraEm) }))}>
          Parear extensão
        </Button>
        {codigo ? (
          <span>
            Código: <b className="tracking-[0.25em] text-[20px]">{codigo.codigo}</b> <span style={dim}>(vale mais {Math.floor(restante / 60)}:{String(restante % 60).padStart(2, "0")})</span>
          </span>
        ) : null}
      </div>
      {dado?.extensaoId ? (
        <p className="text-[13px]" style={dim}>
          Só a extensão de ID <code>{dado.extensaoId}</code> conecta.
        </p>
      ) : null}
      {dado?.extensoes.length ? (
        <ul className="flex flex-col gap-2">
          {dado.extensoes.map((e) => (
            <li key={e.id} className="flex items-baseline justify-between gap-2 rounded-lg border px-3 py-2" style={{ borderColor: "var(--color-line)" }}>
              <span>
                <b>{e.nome}</b>
                {e.versao ? <span style={dim}> {e.versao}</span> : null}
                <span className="block text-[13px]" style={dim}>
                  pareada em {hora(e.criadaEm)}
                  {e.vistaEm ? ` · vista em ${hora(e.vistaEm)}` : ""}
                  {e.revogadaEm ? ` · revogada em ${hora(e.revogadaEm)}` : ""}
                </span>
              </span>
              {!e.revogadaEm ? (
                <Button variant="danger" size="sm" onClick={() => void chamar(`/api/navegador/extensoes/${e.id}`, { method: "DELETE" }, () => setAviso("Revogada. A extensão foi desconectada."))}>
                  Revogar
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="text-[14px]" style={dim}>
          Ponte de native messaging (opcional): o Chrome só a inicia para a extensão da Órbita, e ela prova quem é com um segredo guardado num arquivo
          que só a sua conta do Windows lê.{" "}
          {ponte.erro && !ponte.dado
            ? "Não consegui ler o estado da ponte."
            : ponte.dado
              ? ponte.dado.instalada
                ? `Instalada${ponte.dado.segredo ? "" : ", mas sem o segredo (instale de novo)"}${ponte.dado.ativa ? ", e a extensão está falando por ela agora." : ", sem a extensão falando por ela agora."}`
                : "Não instalada: a extensão fala pelo WebSocket."
              : "…"}
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void chamar(CHAVE_DA_PONTE, { method: "POST", body: JSON.stringify({ acao: "instalar" }) }, () => setAviso("Ponte instalada. Recarregue a extensão em chrome://extensions para ela usar a ponte."))}>
            {ponte.dado?.instalada ? "Instalar de novo" : "Instalar a ponte"}
          </Button>
          {ponte.dado?.instalada ? (
            <Button variant="subtle" size="sm" onClick={() => void chamar(CHAVE_DA_PONTE, { method: "POST", body: JSON.stringify({ acao: "remover" }) }, () => setAviso("Ponte removida: a extensão volta para o WebSocket."))}>
              Remover a ponte
            </Button>
          ) : null}
        </div>
      </div>
      <div className="flex flex-col gap-2 border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="text-[14px]" style={dim}>
          Perfil dedicado: um Chrome à parte, sem os seus logins, onde as rotinas leem sites sozinhas (ligue em &quot;Perfil dedicado para rotinas&quot;). Abra com janela uma vez e faça login só nos sites que a Órbita pode usar sem você olhando.
        </p>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => void chamar("/api/navegador/dedicado", { method: "POST", body: JSON.stringify({ acao: "abrir_login" }) }, (d) => setAviso(String(d.mensagem ?? "Aberto.")))}>
            Abrir o perfil dedicado para login
          </Button>
          <Button variant="subtle" size="sm" onClick={() => void chamar("/api/navegador/dedicado", { method: "POST", body: JSON.stringify({ acao: "fechar" }) }, () => setAviso("Perfil dedicado fechado."))}>
            Fechar
          </Button>
          <Button
            variant="danger"
            size="sm"
            onClick={() => {
              if (!window.confirm("Apagar o perfil dedicado? Os logins e cookies que você fez nele somem, e as rotinas precisam de um login novo.")) return;
              void chamar("/api/navegador/dedicado", { method: "POST", body: JSON.stringify({ acao: "apagar" }) }, (d) => setAviso(String(d.mensagem ?? "Perfil dedicado apagado.")));
            }}
          >
            Apagar logins e cookies
          </Button>
        </div>
      </div>
      {aviso ? <p className="notice">{aviso}</p> : null}
    </div>
  );
}
