"use client";

import { useEffect } from "react";
import { brl, dataCurta, iniciais, mesCurto, mesLongo } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { BarraEmpilhada, Ritmo, type Parte } from "./graficos";
import { Barra, Bloco, Carregando, Faixa, Indicador, Link, LinhaLancamento, Pastilha, Vazio } from "./primitivos";
import { plural, tomDaBarra } from "@/lib/financas/apresentacao";
import { tomDoSaldo } from "@/lib/financas/dinheiro";
import type { Painel as TPainel } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/**
 * Painel (PRD §6.1): tudo vem calculado em `GET /api/financas/painel`. Aqui
 * só se escolhe o texto de cada modo e se desenha.
 */
/**
 * As boas-vindas aparecem uma vez por carregamento da página: o painel é
 * remontado a cada troca de aba, e sem isto a folha voltaria a cada visita
 * até o backend registrar que ela foi vista.
 */
let boasVindasPedidas = false;

export function Painel() {
  const f = useFinancas();
  const { dado: p, erro, recarregar } = useVista<TPainel>("painel", { mes: f.ui.mes });
  const querBoasVindas = !!p?.boasVindas;
  const abrir = f.abrir;
  useEffect(() => {
    if (!querBoasVindas || boasVindasPedidas) return;
    // o PRD espera um instante (~0,4 s) para a tela assentar antes da folha
    // subir; a marca fica DENTRO do tempo, senão o efeito duplo do modo
    // estrito cancelaria o primeiro e o segundo acharia que já abriu
    const t = setTimeout(() => {
      boasVindasPedidas = true;
      abrir({ tipo: "boas_vindas" });
    }, 400);
    return () => clearTimeout(t);
  }, [querBoasVindas, abrir]);
  if (!p) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;

  return (
    <div className="fin-pilha">
      <Avisos p={p} />
      <FarolBloco p={p} />
      <UmToque p={p} />
      <div className="fin-indicadores">
        <Indicador rotulo="Tenho na conta" valor={p.indicadores.tenho} tom={p.indicadores.tenho < 0 ? "saida" : null} />
        <Indicador rotulo="A pagar em 30 dias" valor={p.indicadores.aPagar} tom={p.indicadores.aPagar > 0 ? "saida" : null} />
        <Indicador rotulo="Sobra em 30 dias" valor={p.indicadores.sobra} tom={tomDoSaldo(p.indicadores.sobra)} />
        <Indicador rotulo="Já gastei no mês" valor={p.indicadores.gastoMes} tom={p.indicadores.gastoMes > 0 ? "saida" : null} />
      </div>
      <Divisao p={p} />
      <Bloco titulo="Ritmo do mês" direita={<Link onClick={() => f.irPara("historico")}>ver histórico</Link>}>
        <Ritmo mes={p.mes} acumulado={p.ritmo.acumulado} anterior={p.ritmo.anterior} teto={p.ritmo.teto} />
        {p.ritmo.comparacao && (
          <p className="fin-nota">
            No mesmo ponto do mês passado você tinha gasto <b>{brl(p.ritmo.comparacao.antes)}</b>. agora está{" "}
            {p.ritmo.comparacao.diferenca > 0 ? (
              <b className="fin-tom-saida">{brl(p.ritmo.comparacao.diferenca)} acima</b>
            ) : (
              <b className="fin-tom-entrada">{brl(-p.ritmo.comparacao.diferenca)} abaixo</b>
            )}
            .
          </p>
        )}
      </Bloco>
      <div className="fin-grade">
        <ParaOndeFoi p={p} />
        <div className="fin-pilha">
          {p.faturas.length > 0 && (
            <Bloco titulo="Faturas abertas" direita={<Link onClick={() => f.irPara("cartoes")}>ver todas</Link>}>
              {p.faturas.map((c) => (
                <button key={c.cartaoId} type="button" className="fin-linha" onClick={() => f.irPara("cartoes")}>
                  <Pastilha texto={iniciais(c.nome)} cor={c.cor} />
                  <span className="fin-linha-corpo">
                    <strong>{c.nome}</strong>
                    <small>fecha {dataCurta(c.fechamento)} · vence {dataCurta(c.vencimento)}</small>
                  </span>
                  <span className="fin-valor">{brl(c.valor)}</span>
                </button>
              ))}
            </Bloco>
          )}
          {p.dividas.length > 0 && (
            <Bloco titulo="Dívidas" direita={<Link onClick={() => f.irPara("contas", { subContas: "dividas" })}>ver todas</Link>}>
              {p.dividas.map((d) => (
                <button key={d.id} type="button" className="fin-linha" onClick={() => f.irPara("contas", { subContas: "dividas" })}>
                  <Pastilha texto={iniciais(d.nome)} cor="var(--fin-saida)" />
                  <span className="fin-linha-corpo">
                    <strong>{d.nome}</strong>
                    <small>
                      {d.quitacao.tipo === "quitada" ? "quitada" : d.quitacao.tipo === "previsao" ? `quita em ${d.quitacao.meses} ${plural(d.quitacao.meses, "mês", "meses")}` : "sem previsão de quitação"}
                    </small>
                  </span>
                  <span className="fin-valor fin-tom-saida">{brl(d.saldo)}</span>
                </button>
              ))}
            </Bloco>
          )}
          <Bloco titulo="Últimos lançamentos" direita={<Link onClick={() => f.irPara("extrato")}>ver extrato</Link>}>
            {p.ultimos.length === 0 ? (
              <Vazio titulo="Nada lançado ainda." texto="Cada gasto anotado é um gasto que você enxerga." />
            ) : (
              p.ultimos.map((l) => <LinhaLancamento key={l.id} l={l} onClick={() => f.abrirLancamento(l)} />)
            )}
          </Bloco>
        </div>
      </div>
    </div>
  );
}

function Avisos({ p }: { p: TPainel }) {
  const f = useFinancas();
  const { vencidas, perto } = p.avisos;
  if (!vencidas.n && !perto.n) return null;
  return (
    <div className="fin-pilha curta">
      {vencidas.n > 0 && (
        <Faixa tom="urgente" icone="!" onClick={() => f.irPara("contas", { subContas: "aberto" })}>
          <b>{vencidas.n} {plural(vencidas.n, "conta vencida", "contas vencidas")}</b>, {brl(vencidas.total)} em atraso. Toque para resolver.
        </Faixa>
      )}
      {perto.n > 0 && (
        <Faixa tom="perto" icone="clock" onClick={() => f.irPara("contas", { subContas: "aberto" })}>
          <b>{perto.n} {plural(perto.n, "conta para pagar", "contas para pagar")}</b> nos próximos {p.diasPerto ?? 7} dias, {brl(perto.total)}.
        </Faixa>
      )}
    </div>
  );
}

function FarolBloco({ p }: { p: TPainel }) {
  const f = useFinancas();
  const r = p.farol;
  const configurar = (texto: string) => <Link onClick={() => f.irPara("ajustes", { focoTeto: true })}>{texto}</Link>;

  if (r.modo === "sem_saidas") {
    return (
      <Bloco className="fin-farol">
        <span className="fin-farol-rotulo">Antes de confiar em qualquer número</span>
        <strong className="fin-numero">{brl(r.base)}</strong>
        <p className="fin-farol-sub">é o que entra por mês. O painel ainda não sabe o que sai.</p>
        <Faixa tom="perto" icone="info">
          Sem contas fixas cadastradas e sem gasto lançado, ele dividiria a renda inteira pelos dias que faltam e mostraria um valor que não existe. Cadastre o que sai todo mês primeiro.
        </Faixa>
        <div className="fin-botoes">
          <button type="button" className="button secondary mini" onClick={() => f.abrir({ tipo: "compromisso" })}>+ Conta fixa</button>
          <button type="button" className="button secondary mini" onClick={() => f.abrir({ tipo: "cartao" })}>+ Cartão</button>
          <button type="button" className="button secondary mini" onClick={() => f.abrir({ tipo: "ditado" })}>Lançar por voz</button>
        </div>
      </Bloco>
    );
  }

  if (r.modo === "posso_gastar") {
    const tom = r.valor > 0 ? "entrada" : "saida";
    return (
      <Bloco className="fin-farol">
        <span className="fin-farol-rotulo">{r.fimDoMes ? "Ainda cabe até o fim do mês" : "Posso gastar hoje"}</span>
        <strong className={`fin-numero fin-tom-${tom}`}>{brl(r.valor)}</strong>
        {r.fimDoMes && r.sobra > 0 && (
          <p className="fin-farol-sub">dá {brl(r.porDia)} por dia nos {r.diasRestantes} {plural(r.diasRestantes, "dia", "dias")} que faltam</p>
        )}
        <Barra pct={r.usoPct} tom={tomDaBarra(r.usoPct, 75, 100)} rotulo="Gasto livre sobre o disponível" />
        <p className="fin-nota">
          {r.sobra > 0 ? (
            <>Sobram <b>{brl(r.sobra)}</b> livres para os {r.diasRestantes} {plural(r.diasRestantes, "dia", "dias")} que faltam, depois de tirar contas fixas e parcelas.</>
          ) : (
            <>Você já passou <b>{brl(-r.sobra)}</b> do que sobrava para o mês. Daqui pra frente, todo gasto está saindo do mês que vem.</>
          )}
        </p>
        <p className="fin-rodape">
          Gasto livre até agora: <b>{brl(r.livre)}</b> de {brl(Math.max(0, r.disponivel))}. Total do mês, com fixos e parcelas: <b>{brl(r.gastoTotal)}</b>.
        </p>
      </Bloco>
    );
  }

  if (r.modo === "previsao_30") {
    return (
      <Bloco className="fin-farol">
        <span className="fin-farol-rotulo">Previsão dos próximos 30 dias</span>
        <strong className={`fin-numero fin-tom-${tomDoSaldo(r.sobra)}`}>{brl(r.sobra)}</strong>
        <p className="fin-farol-sub">
          {r.sobra < 0 ? (
            <>É o que <b>falta</b> para fechar o mês com o que você tem e o que está previsto entrar.</>
          ) : (
            "É o que deve sobrar na conta depois de tudo que está previsto entrar e sair."
          )}
        </p>
        <div className="fin-tres">
          <div><span>tenho hoje</span><b>{brl(r.saldo)}</b></div>
          <div><span>entra</span><b className="fin-tom-entrada">+ {brl(r.aReceber)}</b></div>
          <div><span>sai</span><b className="fin-tom-saida">− {brl(r.aPagar)}</b></div>
        </div>
        <p className="fin-rodape">Cadastre sua renda em Ajustes para o painel também dizer quanto você pode gastar por dia. {configurar("Configurar")}</p>
      </Bloco>
    );
  }

  const passou = r.teto !== null && r.gasto > r.teto;
  const pct = r.teto ? (r.gasto / r.teto) * 100 : 0;
  return (
    <Bloco className="fin-farol">
      <span className="fin-farol-rotulo">Gasto em {mesLongo(p.mes)}</span>
      <strong className={`fin-numero ${passou ? "fin-tom-saida" : ""}`}>{brl(r.gasto)}</strong>
      {r.teto ? (
        <>
          <Barra pct={pct} tom={tomDaBarra(pct, 75, 100)} rotulo="Gasto sobre o limite" />
          <p className="fin-nota">
            {passou ? (
              <>Você passou <b>{brl(r.gasto - r.teto)}</b> do limite de {brl(r.teto)}.</>
            ) : (
              <><b>{brl(r.teto - r.gasto)}</b> ainda cabem no limite de {brl(r.teto)}.</>
            )}
          </p>
        </>
      ) : (
        <p className="fin-nota">Sem renda nem teto definidos. {configurar("Configurar agora")}</p>
      )}
      {r.ritmoDia !== null && r.projecao !== null && (
        <p className="fin-rodape">
          Ritmo de <b>{brl(r.ritmoDia)}</b> por dia. Nesse passo, o mês fecha em <b>{brl(r.projecao)}</b>.
        </p>
      )}
    </Bloco>
  );
}

function UmToque({ p }: { p: TPainel }) {
  const f = useFinancas();
  if (!p.atalhos.length && !p.sugestoes.length) return null;
  return (
    <Bloco titulo="Lançar em um toque" direita={p.atalhos.length ? <Link onClick={() => f.irPara("ajustes")}>editar</Link> : undefined}>
      {p.atalhos.length ? (
        <div className="fin-chips">
          {p.atalhos.map((a) => (
            <button
              key={a.id}
              type="button"
              className="fin-chip"
              style={{ "--cor": a.cor ?? "var(--color-line)" } as React.CSSProperties}
              onClick={() => void f.executar({ tipo: "lancar_atalho", id: a.id })}
            >
              {a.rotulo} <b>{brl(a.valor)}</b>
            </button>
          ))}
        </div>
      ) : (
        <>
          <p className="fin-nota">Estes são os seus gastos mais repetidos. Guarde como atalho e lance com um clique.</p>
          <div className="fin-chips">
            {p.sugestoes.map((s) => (
              <button
                key={s.rotulo}
                type="button"
                className="fin-chip"
                onClick={() =>
                  void f.executar(
                    { tipo: "salvar_atalho", rotulo: s.rotulo, valor: s.valor, categoriaId: s.categoriaId, contaId: s.contaId, cartaoId: s.cartaoId },
                    { mensagem: "Atalho criado." },
                  )
                }
              >
                + {s.rotulo} <b>{brl(s.valor)}</b>
              </button>
            ))}
          </div>
        </>
      )}
    </Bloco>
  );
}

function Divisao({ p }: { p: TPainel }) {
  const f = useFinancas();
  const d = p.divisao;
  if (!d) return null;
  const partes: Parte[] = [
    { nome: "Contas fixas", valor: d.contasFixas, classe: "fixas" },
    { nome: "Parcelas", valor: d.parcelas, classe: "parcelas" },
    { nome: "Metas", valor: d.metas, classe: "metas" },
    { nome: "Gasto livre", valor: d.livre, classe: "livre" },
    ...(d.base !== null && d.sobra !== null ? [{ nome: "Sobra", valor: d.sobra, classe: "sobra" }] : []),
  ];
  const escala = Math.max(d.total, d.base ?? 0);
  const sobre = d.base ?? d.total;
  const proximos = d.proximos.filter((m) => m.valor > 0);
  return (
    <Bloco titulo={`Como ${mesLongo(p.mes)} se divide`} direita={<span className="fin-valor">{brl(d.total)}</span>}>
      <BarraEmpilhada partes={partes} escala={escala} />
      <ul className="fin-legenda">
        {partes.filter((x) => x.valor > 0).map((x) => (
          <li key={x.nome}>
            <i className={x.classe} />
            <span>{x.nome}</span>
            <b>{brl(x.valor)}</b>
            <small>{sobre > 0 ? Math.round((x.valor / sobre) * 100) : 0}%</small>
          </li>
        ))}
      </ul>
      <p className="fin-nota">
        {d.base !== null ? (
          <>
            De <b>{brl(d.base)}</b> que entram, <b>{brl(d.comprometido)}</b> saem sozinhos antes de você decidir qualquer coisa. Isso é{" "}
            <b>{d.base > 0 ? Math.round((d.comprometido / d.base) * 100) : 0}%</b> do mês.
          </>
        ) : (
          <><b>{brl(d.comprometido)}</b> já estão comprometidos neste mês. Cadastre sua renda em Ajustes para ver quanto isso representa do que entra.</>
        )}
      </p>
      {proximos.length > 0 && (
        <div className="fin-proximos">
          <span className="fin-rotulo">Já comprometido nos próximos meses</span>
          <button type="button" className="fin-faixa-meses" onClick={() => f.irPara("previsao")} aria-label="Abrir a previsão dos 12 meses à frente">
            {d.proximos.map((m) => (
              <span key={m.mes} className="fin-mes-card">
                <small>{mesCurto(m.mes)}</small>
                <b>{brl(m.valor)}</b>
              </span>
            ))}
          </button>
          <small className="fin-dica">Toque para ver os 12 meses à frente.</small>
        </div>
      )}
    </Bloco>
  );
}

function ParaOndeFoi({ p }: { p: TPainel }) {
  const { total, categorias } = p.paraOndeFoi;
  return (
    <Bloco titulo="Para onde foi" direita={<span className="fin-valor">{brl(total)}</span>}>
      {categorias.length === 0 ? (
        <Vazio titulo="Nenhum gasto lançado neste mês." texto="Toque no + para registrar o primeiro." />
      ) : (
        <ul className="fin-categorias">
          {categorias.map((c) => {
            const comOrc = c.orcamento > 0;
            const pctOrc = comOrc ? (c.total / c.orcamento) * 100 : 0;
            const passou = comOrc && c.total > c.orcamento;
            return (
              <li key={c.categoriaId ?? "sem"}>
                <div className="fin-categoria-topo">
                  <span>{c.nome}</span>
                  <b>{brl(c.total)}</b>
                  <small>{Math.round(c.pct)}%</small>
                </div>
                {comOrc ? (
                  <>
                    <Barra pct={pctOrc} tom={tomDaBarra(pctOrc, 80, 100.0001)} cor={pctOrc < 80 ? c.cor : undefined} rotulo={`${c.nome} sobre o orçamento`} />
                    <small className={passou ? "fin-tom-saida" : "fin-dica"}>
                      {passou ? `passou ${brl(c.total - c.orcamento)} do orçamento de ${brl(c.orcamento)}` : `restam ${brl(c.orcamento - c.total)} de ${brl(c.orcamento)}`}
                    </small>
                  </>
                ) : (
                  <Barra pct={c.pct} cor={c.cor} rotulo={c.nome} />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </Bloco>
  );
}
