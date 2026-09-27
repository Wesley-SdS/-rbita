"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { hojeLocal, mesDe, somarMeses } from "@orbita/core/finance/calendario";
import { useRecurso } from "@/lib/dados/recurso";
import { enviarComando, urlDaVista } from "@/lib/financas/api";
import { gravarSessao, lerSessao } from "@/lib/financas/sessao";
import type { Aba, Cadastros, LinhaDeLancamento, Metas as TMetas } from "@/lib/financas/tipos";
import { Icone } from "@/components/presenca/icones";
import { CtxFinancas, UI_PADRAO, type Acao, type EstadoUi, type Financas, type FolhaAberta } from "./contexto";
import { NavegadorDeMes } from "./primitivos";
import { FolhaDaVez } from "./folhas";
import { Painel } from "./painel";
import { Extrato } from "./extrato";
import { Contas } from "./contas";
import { Cartoes } from "./cartoes";
import { Metas } from "./metas";
import { Previsao } from "./previsao";
import { Historico } from "./historico";
import { Ajustes } from "./ajustes";

const CHAVE_UI = "orbita.financas.ui";
const CHAVE_ROLAGEM = "orbita.financas.rolagem";

/** Quanto tempo a notificação fica (§6.0.7): o dobro quando tem "desfazer", para dar tempo de achar o botão. */
const TOAST_MS = 2600;
const TOAST_COM_ACAO_MS = 5200;

const ABAS: { id: Aba; rotulo: string }[] = [
  { id: "painel", rotulo: "Painel" },
  { id: "extrato", rotulo: "Extrato" },
  { id: "contas", rotulo: "Contas" },
  { id: "cartoes", rotulo: "Cartões" },
  { id: "metas", rotulo: "Metas" },
  { id: "previsao", rotulo: "Previsão" },
  { id: "historico", rotulo: "Histórico" },
  { id: "ajustes", rotulo: "Ajustes" },
];

/**
 * A tela de Finanças inteira (PRD "Freio de Mão", no visual da Órbita).
 *
 * Tudo que é número vem calculado do backend; esta casca guarda só o estado
 * de TELA: aba, mês, filtros, folha aberta e notificação. O estado vai para o
 * `sessionStorage` a cada mudança (§4.6), para um recarregar voltar ao mesmo
 * lugar sem sincronizar nada entre aparelhos.
 */
export function FinancasApp() {
  const [ui, setUi] = useState<EstadoUi>(() => lerSessao(CHAVE_UI, UI_PADRAO));
  const [hoje, setHoje] = useState(() => hojeLocal());
  const [folha, setFolha] = useState<{ n: number; f: FolhaAberta } | null>(null);
  const [toast, setToast] = useState<{ n: number; texto: string; acao?: Acao } | null>(null);
  const [focoTeto, setFocoTeto] = useState(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const raiz = useRef<HTMLDivElement>(null);

  const mesAtual = mesDe(hoje);
  const mes = ui.mes ?? mesAtual;
  const { dado: cad } = useRecurso<Cadastros>(urlDaVista("cadastros"));

  useEffect(() => gravarSessao(CHAVE_UI, ui), [ui]);

  // posição da rolagem, também lembrada por sessão (§4.6)
  useEffect(() => {
    const { y } = lerSessao(CHAVE_ROLAGEM, { y: 0 });
    // espera a primeira leitura desenhar: rolar antes disso não tem para onde ir
    const t = y > 0 ? setTimeout(() => window.scrollTo({ top: y }), 400) : null;
    const guardar = () => gravarSessao(CHAVE_ROLAGEM, { y: window.scrollY });
    window.addEventListener("pagehide", guardar);
    return () => {
      if (t) clearTimeout(t);
      guardar();
      window.removeEventListener("pagehide", guardar);
    };
  }, []);

  const mudarUi = useCallback((patch: Partial<EstadoUi>) => setUi((u) => ({ ...u, ...patch })), []);
  const aprenderHoje = useCallback((h: string) => setHoje((antes) => (antes === h ? antes : h)), []);

  const avisar = useCallback((texto: string, acao?: Acao) => {
    if (timer.current) clearTimeout(timer.current);
    if (!texto) return setToast(null);
    setToast((t) => ({ n: (t?.n ?? 0) + 1, texto, acao }));
    timer.current = setTimeout(() => setToast(null), acao ? TOAST_COM_ACAO_MS : TOAST_MS);
  }, []);

  const fechar = useCallback(() => setFolha(null), []);
  const abrir = useCallback((f: FolhaAberta) => setFolha((antes) => ({ n: (antes?.n ?? 0) + 1, f })), []);

  const rolarParaTopo = useCallback(() => {
    const el = raiz.current;
    if (el && el.getBoundingClientRect().top < 0) el.scrollIntoView({ block: "start" });
  }, []);

  const irPara: Financas["irPara"] = useCallback(
    (aba, extra = {}) => {
      setUi((u) => ({
        ...u,
        aba,
        ...(extra.subContas ? { subContas: extra.subContas } : {}),
        ...(extra.mes !== undefined ? { mes: extra.mes } : {}),
        // tocar em Metas estando em Metas volta para a lista (§6.0.5)
        ...(aba === "metas" ? { metaAberta: extra.metaId ?? (u.aba === "metas" ? null : u.metaAberta) } : {}),
      }));
      if (extra.focoTeto) setFocoTeto((n) => n + 1);
      else rolarParaTopo();
    },
    [rolarParaTopo],
  );

  const definirMes = useCallback((m: string | null) => setUi((u) => ({ ...u, mes: m && m !== mesDe(hoje) ? m : null })), [hoje]);

  const executar: Financas["executar"] = useCallback(
    async (cmd, opts = {}) => {
      const r = await enviarComando(cmd);
      if (!r.ok) {
        avisar(r.erro);
        return null;
      }
      const d = r.dado;
      // a tela vai para o mês do que acabou de ser criado ou editado (§6.0.4)
      if (d.mes) definirMes(d.mes);
      if (!opts.manterAberta) setFolha(null);
      if (!opts.silencioso) {
        const texto = opts.mensagem ?? [d.mensagem, d.aviso].filter(Boolean).join(" ");
        const id = d.desfazerId;
        avisar(
          texto,
          id
            ? {
                rotulo: "desfazer",
                fazer: () => {
                  void enviarComando({ tipo: "desfazer", id }).then((x) => avisar(x.ok ? x.dado.mensagem : x.erro));
                },
              }
            : undefined,
        );
      }
      return d;
    },
    [avisar, definirMes],
  );

  const abrirLancamento = useCallback(
    async (l: LinhaDeLancamento) => {
      if (l.metaId) {
        // ponto de atenção 3: o lançamento de meta seria recriado ao salvar o
        // item, então a edição é pelo item. Abre a meta direto.
        const metas = await fetch(urlDaVista("metas")).then((r) => (r.ok ? (r.json() as Promise<TMetas>) : null)).catch(() => null);
        const nome = metas?.itens.find((m) => m.id === l.metaId)?.nome;
        avisar(nome ? `Este lançamento vem da meta ${nome}. Edite pelo item.` : "Este lançamento vem de uma meta. Edite pelo item.");
        irPara("metas", { metaId: l.metaId });
        return;
      }
      if (l.transferencia && l.grupoTransferencia) return abrir({ tipo: "transferencia", perna: l });
      abrir({ tipo: "lancamento", lanc: l });
    },
    [abrir, avisar, irPara],
  );

  const valor: Financas = useMemo(
    () => ({
      hoje, mesAtual, mes, definirMes, ui, mudarUi, irPara, focoTeto, abrir, fechar, avisar, executar,
      cad: cad ?? null, abrirLancamento: (l) => void abrirLancamento(l), aprenderHoje,
    }),
    [hoje, mesAtual, mes, definirMes, ui, mudarUi, irPara, focoTeto, abrir, fechar, avisar, executar, cad, abrirLancamento, aprenderHoje],
  );

  const tela = (() => {
    switch (ui.aba) {
      case "painel": return <Painel />;
      case "extrato": return <Extrato />;
      case "contas": return <Contas />;
      case "cartoes": return <Cartoes />;
      case "metas": return <Metas />;
      case "previsao": return <Previsao />;
      case "historico": return <Historico />;
      case "ajustes": return <Ajustes />;
    }
  })();

  return (
    <CtxFinancas.Provider value={valor}>
      <div className="fin" ref={raiz}>
        <div className="fin-topo">
          <nav className="fin-nav" aria-label="Seções das finanças">
            {ABAS.map((a) => (
              <button
                key={a.id}
                type="button"
                className={`filter-chip ${ui.aba === a.id ? "active" : ""}`}
                aria-current={ui.aba === a.id ? "page" : undefined}
                onClick={() => irPara(a.id)}
              >
                {a.rotulo}
              </button>
            ))}
          </nav>
          <div className="fin-barra-topo">
            <NavegadorDeMes mes={mes} atual={mesAtual} aoMudar={(d) => definirMes(d === 0 ? null : somarMeses(mes, d))} />
            <div className="fin-acoes-desk">
              <button type="button" className="button primary compacto" onClick={() => abrir({ tipo: "lancamento" })}>
                <Icone nome="plus" /> Novo lançamento
              </button>
              <button type="button" className="button secondary compacto" onClick={() => abrir({ tipo: "ditado" })}>
                <Icone nome="mic" /> Ditar por voz
              </button>
            </div>
          </div>
        </div>

        <div className="fin-conteudo">{tela}</div>

        <div className="fin-fabs">
          <button type="button" className="fin-fab mic" aria-label="Ditar lançamento" onClick={() => abrir({ tipo: "ditado" })}>
            <Icone nome="mic" />
          </button>
          <button type="button" className="fin-fab mais" aria-label="Novo lançamento" onClick={() => abrir({ tipo: "lancamento" })}>
            <Icone nome="plus" />
          </button>
        </div>

        {folha && <FolhaDaVez key={folha.n} folha={folha.f} />}

        <div className="fin-toast-area" role="status" aria-live="polite">
          {toast && (
            <div key={toast.n} className="fin-toast">
              <span>{toast.texto}</span>
              {toast.acao && (
                <button
                  type="button"
                  onClick={() => {
                    const a = toast.acao!;
                    setToast(null);
                    a.fazer();
                  }}
                >
                  {toast.acao.rotulo}
                </button>
              )}
            </div>
          )}
        </div>
      </div>
    </CtxFinancas.Provider>
  );
}
