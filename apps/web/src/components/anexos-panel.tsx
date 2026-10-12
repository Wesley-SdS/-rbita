"use client";

import { useState } from "react";
import { invalidar, useRecurso } from "@/lib/dados/recurso";
import { Button, Card, PanelTitle } from "@/components/ui";

/**
 * Senhas de anexo por remetente (PRD de anexos, C5): a fatura do banco chega
 * em PDF com senha, e a Órbita tenta sozinha as senhas cadastradas para o
 * domínio de quem mandou. Esta tela é o ÚNICO lugar onde a senha entra; ela
 * nunca é pedida nem aceita pelo chat ou pela voz. Toda regra (validação,
 * cifra, a quem vale) mora no servidor.
 */

interface Senha {
  id: string;
  dominio: string;
  rotulo: string | null;
  criadaEm: string;
  usadaEm: string | null;
}

const CHAVE = "/api/anexos/senhas";

const data = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" }) : null);

export function AnexosPanel() {
  const { dado, erro, carregando } = useRecurso<{ senhas: Senha[] }>(CHAVE);
  const [dominio, setDominio] = useState("");
  const [senha, setSenha] = useState("");
  const [rotulo, setRotulo] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [falha, setFalha] = useState<string | null>(null);

  async function pedir(init: RequestInit, url = CHAVE): Promise<boolean> {
    setOcupado(true);
    setFalha(null);
    try {
      const r = await fetch(url, init);
      if (!r.ok) {
        setFalha(((await r.json().catch(() => ({}))) as { error?: string }).error ?? "Não deu certo.");
        return false;
      }
      return true;
    } catch {
      setFalha("Sem conexão com a Órbita. Tente de novo.");
      return false;
    } finally {
      setOcupado(false);
      invalidar(CHAVE);
    }
  }

  async function cadastrar() {
    const ok = await pedir({ method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ dominio, senha, rotulo: rotulo || null }) });
    if (ok) {
      setDominio("");
      setSenha("");
      setRotulo("");
    }
  }

  const senhas = dado?.senhas ?? [];

  return (
    <div className="grid-stack">
      <Card>
        <PanelTitle className="mb-2">Senhas de anexos</PanelTitle>
        <p className="text-[14px]" style={{ color: "var(--color-ink-dim)" }}>
          Fatura e extrato de banco costumam chegar em PDF com senha (os primeiros dígitos do CPF, a data de nascimento). Cadastre aqui a senha
          para o domínio de quem manda, e a Órbita abre sozinha os anexos desse remetente. A senha fica cifrada, nunca aparece de novo, e
          nunca é pedida pelo chat nem pela voz.
        </p>
        <div className="mt-3 flex flex-col gap-2">
          <label className="field">
            Remetente (domínio do e-mail)
            <input name="anexo-dominio" value={dominio} onChange={(e) => setDominio(e.target.value)} placeholder="nubank.com.br" autoComplete="off" />
          </label>
          <label className="field">
            Senha do anexo
            <input name="anexo-senha" type="password" value={senha} onChange={(e) => setSenha(e.target.value)} autoComplete="new-password" />
          </label>
          <label className="field">
            Para lembrar (opcional)
            <input name="anexo-rotulo" value={rotulo} onChange={(e) => setRotulo(e.target.value)} placeholder="fatura do cartão" maxLength={80} />
          </label>
          {falha && <p className="notice">{falha}</p>}
          <Button onClick={cadastrar} disabled={ocupado || dominio.trim().length < 3 || !senha}>
            Cadastrar senha
          </Button>
        </div>
      </Card>

      <Card>
        <PanelTitle className="mb-2">Remetentes com senha</PanelTitle>
        {erro && <p className="notice">Não consegui carregar as senhas: {erro}</p>}
        {carregando && !dado ? (
          <p className="text-[14px]" style={{ color: "var(--color-ink-dim)" }}>Carregando…</p>
        ) : senhas.length === 0 ? (
          <p className="text-[14px]" style={{ color: "var(--color-ink-dim)" }}>Nenhuma senha cadastrada.</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {senhas.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-2">
                <span>
                  <b>{s.dominio}</b>
                  {s.rotulo ? ` (${s.rotulo})` : ""}
                  <span className="text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
                    {" "}
                    cadastrada em {data(s.criadaEm)}
                    {s.usadaEm ? `, usada em ${data(s.usadaEm)}` : ", ainda não usada"}
                  </span>
                </span>
                <Button variant="danger" size="sm" disabled={ocupado} onClick={() => pedir({ method: "DELETE" }, `${CHAVE}?id=${encodeURIComponent(s.id)}`)}>
                  Apagar
                </Button>
              </li>
            ))}
          </ul>
        )}
        <p className="mt-3 text-[13px]" style={{ color: "var(--color-ink-dim)" }}>
          Tetos de tamanho, de ZIP e quanto tempo o texto lido fica guardado estão em Ajustes, no grupo &quot;Anexos e arquivos&quot;.
        </p>
      </Card>
    </div>
  );
}
