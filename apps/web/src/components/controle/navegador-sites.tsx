"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, ErrorRetry, Input, Select } from "@/components/ui";

/**
 * Bloco "sites" da tela Controle do PC (frente B): o que a Órbita pode fazer
 * em cada site (bloqueado, só ler, ler e agir na sessão) e os roteiros que ela
 * aprendeu. As categorias bloqueadas (bancos, senhas, webmail, contas, o
 * navegador e a própria Órbita) vencem qualquer linha daqui e se ajustam em
 * "Categorias de site bloqueadas", logo abaixo. Nada disto tem tool: muda só
 * por esta tela (PRD §2.3).
 */

interface Sites {
  padrao: string;
  categorias: string[];
  modos: string[];
  sites: { id: string; dominio: string; modo: string }[];
}
interface Roteiros {
  roteiros: { id: string; dominio: string; intencao: string; passos: number; usos: number; falhas: number; tokensAprendizado: number; usadoEm: string | null }[];
}

const SITES = "/api/navegador/sites";
const ROTEIROS = "/api/navegador/roteiros";
const dim = { color: "var(--color-ink-dim)" } as const;
const MODO: Record<string, string> = { bloqueado: "Nada (nem ler)", leitura: "Só ler", escrita: "Ler e agir na sessão" };

export function NavegadorSites() {
  const sites = useRecurso<Sites>(SITES);
  const roteiros = useRecurso<Roteiros>(ROTEIROS);
  const [dominio, setDominio] = useState("");
  const [modo, setModo] = useState("leitura");
  const [aviso, setAviso] = useState<string | null>(null);

  async function chamar(url: string, init: RequestInit, chave: string) {
    setAviso(null);
    try {
      const r = await fetch(url, { ...init, headers: { "content-type": "application/json" } });
      const d = (await r.json().catch(() => ({}))) as { error?: string };
      if (!r.ok) setAviso(d.error ?? "Não deu certo.");
      return r.ok;
    } catch {
      setAviso("Sem conexão com a Órbita.");
      return false;
    } finally {
      invalidar(chave);
    }
  }

  if (sites.erro && !sites.dado) return <ErrorRetry message={sites.erro} onRetry={sites.recarregar} />;
  const d = sites.dado;

  return (
    <div className="flex flex-col gap-3 text-[15px]">
      <p className="text-[14px]" style={dim}>
        Site que não está na lista: <b>{d ? (MODO[d.padrao] ?? d.padrao) : "…"}</b>. Categorias sempre bloqueadas agora: {d?.categorias.join(", ") || "nenhuma"}. Mesmo
        num site &quot;ler e agir&quot;, enviar, pagar, publicar e excluir continuam pedindo a sua aprovação.
      </p>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await chamar(SITES, { method: "POST", body: JSON.stringify({ dominio, modo }) }, SITES)) setDominio("");
        }}
      >
        <Input value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="jira.atlassian.net" aria-label="Domínio" maxLength={253} />
        <Select value={modo} onChange={(e) => setModo(e.target.value)} aria-label="O que a Órbita pode fazer">
          {(d?.modos ?? ["bloqueado", "leitura", "escrita"]).map((m) => (
            <option key={m} value={m}>
              {MODO[m] ?? m}
            </option>
          ))}
        </Select>
        <Button size="sm" type="submit" disabled={!dominio.trim()}>
          Salvar
        </Button>
      </form>
      {d?.sites.length ? (
        <ul className="flex flex-col gap-1">
          {d.sites.map((s) => (
            <li key={s.id} className="flex items-baseline justify-between gap-2">
              <span>
                <b>{s.dominio}</b> <span style={dim}>· {MODO[s.modo] ?? s.modo}</span>
              </span>
              <Button variant="subtle" size="sm" onClick={() => void chamar(`${SITES}/${s.id}`, { method: "DELETE" }, SITES)}>
                Tirar
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[14px]" style={dim}>Nenhum site classificado ainda.</p>
      )}

      <div className="border-t pt-3" style={{ borderColor: "var(--color-line)" }}>
        <p className="mb-2 font-semibold">Roteiros aprendidos</p>
        <p className="mb-2 text-[14px]" style={dim}>
          Tarefa que deu certo no Chrome vira roteiro: a próxima igual roda sem chamar o modelo. Passo com efeito continua pedindo aprovação.
        </p>
        {roteiros.dado?.roteiros.length ? (
          <ul className="flex flex-col gap-1">
            {roteiros.dado.roteiros.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-2">
                <span>
                  <b>{r.intencao}</b>
                  <span className="block text-[13px]" style={dim}>
                    {r.dominio} · {r.passos} passos · usado {r.usos}x{r.falhas ? ` · falhou ${r.falhas}x` : ""} · aprendido com {r.tokensAprendizado.toLocaleString("pt-BR")} tokens
                  </span>
                </span>
                <Button variant="subtle" size="sm" onClick={() => void chamar(`${ROTEIROS}/${r.id}`, { method: "DELETE" }, ROTEIROS)}>
                  Esquecer
                </Button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[14px]" style={dim}>Nenhum roteiro ainda.</p>
        )}
      </div>
      {aviso ? <p className="notice">{aviso}</p> : null}
    </div>
  );
}
