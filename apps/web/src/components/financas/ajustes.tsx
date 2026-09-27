"use client";

import { useEffect, useRef, useState } from "react";
import { brl, iniciais, mesCurto } from "@orbita/core/finance/formato";
import { useFinancas, useVista } from "./contexto";
import { Bloco, CampoDinheiro, Carregando, Faixa, Link, Pastilha, Vazio } from "./primitivos";
import { DocumentosDaFila } from "./documentos-fila";
import { plural } from "@/lib/financas/apresentacao";
import type { Cadastros, Categoria } from "@/lib/financas/tipos";
import { ErrorRetry } from "@/components/ui";

/** Acima disso as fotos das metas pesam no celular (PRD §6.8, "~3,5 MB"). */
const FOTOS_PESADAS_BYTES = 3.5 * 1024 * 1024;

/** Ajustes (PRD §6.8), sem o bloco de Aparência: o tema é o do app. */
export function Ajustes() {
  const f = useFinancas();
  const { dado: c, erro, recarregar } = useVista<Cadastros>("cadastros", { mes: f.ui.mes });
  if (!c) return erro ? <ErrorRetry message={erro} onRetry={recarregar} /> : <Carregando />;
  return (
    <div className="fin-pilha">
      <RendaETeto c={c} />
      <Bloco titulo="Atalhos de um toque" direita={<Link onClick={() => f.abrir({ tipo: "atalho" })}>+ novo</Link>}>
        {c.atalhos.length === 0 ? (
          <Vazio titulo="Nenhum atalho ainda." texto="Um atalho lança o gasto com um clique, sem abrir formulário. Bom para almoço, transporte, café." />
        ) : (
          c.atalhos.map((a) => (
            <button key={a.id} type="button" className="fin-linha" onClick={() => f.abrir({ tipo: "atalho", atalho: a })}>
              <Pastilha texto={iniciais(a.rotulo)} cor={a.categoria?.cor} />
              <span className="fin-linha-corpo">
                <strong>{a.rotulo}</strong>
                <small>{a.categoria?.nome ?? "Sem categoria"}</small>
              </span>
              <span className="fin-valor">{brl(a.valor)}</span>
            </button>
          ))
        )}
      </Bloco>
      <Bloco titulo="Regras de categorização" direita={<Link onClick={() => f.abrir({ tipo: "regra" })}>+ nova</Link>}>
        {c.regras.length === 0 ? (
          <Vazio titulo="Nenhuma regra ainda." texto="Elas são criadas sozinhas quando você importa um extrato e escolhe a categoria de cada linha." />
        ) : (
          c.regras.map((r) => (
            <div key={r.id} className="fin-linha estatica">
              <Pastilha texto="→" cor={r.categoria?.cor} />
              <span className="fin-linha-corpo">
                <strong>contém &quot;{r.contem}&quot;</strong>
                <small>vira {r.categoria?.nome ?? "categoria apagada"}</small>
              </span>
              <Link onClick={() => f.abrir({ tipo: "regra", regra: r })}>editar</Link>
            </div>
          ))
        )}
      </Bloco>
      <Bloco titulo="Categorias e orçamentos" direita={<Link onClick={() => f.abrir({ tipo: "categoria" })}>+ nova</Link>}>
        <ListaCategorias titulo="Saídas" cats={c.categorias.filter((x) => x.natureza === "despesa")} mes={f.mes} />
        <ListaCategorias titulo="Entradas" cats={c.categorias.filter((x) => x.natureza === "receita")} mes={f.mes} />
      </Bloco>
      <Bloco titulo="Contas e carteiras" direita={<Link onClick={() => f.abrir({ tipo: "conta" })}>+ nova</Link>}>
        {c.contas.map((x) => (
          <button key={x.id} type="button" className="fin-linha" onClick={() => f.abrir({ tipo: "conta", conta: x })}>
            <Pastilha texto={iniciais(x.nome)} cor={x.cor} />
            <span className="fin-linha-corpo">
              <strong>{x.nome}</strong>
              <small>saldo inicial {brl(x.saldoInicial)}</small>
            </span>
            <span className={`fin-valor ${x.saldo < 0 ? "fin-tom-saida" : ""}`}>{brl(x.saldo)}</span>
          </button>
        ))}
      </Bloco>
      <Bloco titulo="Cartões" direita={<Link onClick={() => f.abrir({ tipo: "cartao" })}>+ novo</Link>}>
        {c.cartoes.length === 0 ? (
          <Vazio titulo="Nenhum cartão." texto="Cadastre para acompanhar faturas, limite e compras parceladas." />
        ) : (
          c.cartoes.map((x) => (
            <div key={x.id} className="fin-linha estatica">
              <Pastilha texto={iniciais(x.nome)} cor={x.cor} />
              <span className="fin-linha-corpo">
                <strong>{x.nome}</strong>
                <small>fecha dia {x.fechamento} · vence dia {x.vencimento} · limite {brl(x.limite)}</small>
              </span>
              <Link onClick={() => f.abrir({ tipo: "cartao", cartao: x })}>editar</Link>
            </div>
          ))
        )}
      </Bloco>
      <SeusDados c={c} />
    </div>
  );
}

function RendaETeto({ c }: { c: Cadastros }) {
  const f = useFinancas();
  const [renda, setRenda] = useState(c.renda);
  const [teto, setTeto] = useState(c.teto);
  useEffect(() => setRenda(c.renda), [c.renda]);
  useEffect(() => setTeto(c.teto), [c.teto]);
  const tetoRef = useRef<HTMLInputElement>(null);
  const bloco = useRef<HTMLDivElement>(null);

  // "Configurar" no painel traz até aqui e põe o cursor no teto (§6.1.2)
  useEffect(() => {
    if (!f.focoTeto) return;
    bloco.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    tetoRef.current?.focus({ preventScroll: true });
  }, [f.focoTeto]);

  return (
    <Bloco titulo="Quanto entra e quanto pode sair">
      <div ref={bloco}>
        <p className="fin-nota">Com a renda preenchida, o painel calcula sozinho quanto sobra por dia depois das contas fixas e das parcelas.</p>
        <div className="fin-campo-acao">
          <CampoDinheiro rotulo="Renda do mês" valor={renda} aoMudar={setRenda} />
          <button type="button" className="button primary compacto" onClick={() => void f.executar({ tipo: "definir_renda", valor: renda })}>Salvar</button>
        </div>
        <div className="fin-campo-acao">
          <CampoDinheiro rotulo="Teto de gastos (se preferir um limite fixo)" valor={teto} aoMudar={setTeto} entrada={tetoRef} />
          <button type="button" className="button secondary compacto" onClick={() => void f.executar({ tipo: "definir_teto", valor: teto })}>Salvar</button>
        </div>
      </div>
    </Bloco>
  );
}

function ListaCategorias({ titulo, cats, mes }: { titulo: string; cats: Categoria[]; mes: string }) {
  const f = useFinancas();
  return (
    <div className="fin-secao">
      <span className="fin-rotulo">{titulo}</span>
      {cats.map((x) => (
        <div key={x.id} className="fin-linha estatica">
          <Pastilha texto={x.iniciais} cor={x.cor} />
          <span className="fin-linha-corpo">
            <strong>{x.nome}</strong>
            <small>
              {x.orcamento > 0 ? `orçamento ${brl(x.orcamento)}` : "sem orçamento"} · {mesCurto(mes)}: {brl(x.noMes)}
            </small>
          </span>
          <Link onClick={() => f.abrir({ tipo: "categoria", categoria: x })}>editar</Link>
        </div>
      ))}
    </div>
  );
}

function SeusDados({ c }: { c: Cadastros }) {
  const f = useFinancas();
  const t = c.totais;
  const kb = Math.round(t.bytesDasFotos / 1024);

  async function apagarTudo() {
    if (!window.confirm("Apagar TODOS os lançamentos, contas e cartões? Isso não tem volta.")) return;
    if (!window.confirm("Tem certeza mesmo? Faça um backup antes se quiser guardar.")) return;
    const r = await f.executar({ tipo: "apagar_tudo" });
    if (r) f.irPara("painel", { mes: null });
  }

  return (
    <Bloco titulo="Seus dados">
      <p className="fin-nota">
        {t.lancamentos} {plural(t.lancamentos, "lançamento", "lançamentos")}, {t.contas} {plural(t.contas, "conta", "contas")}, {t.metas}{" "}
        {plural(t.metas, "meta", "metas")}. Tudo fica salvo na sua conta: entre com a mesma conta no celular e no computador.
        {t.bytesDasFotos > 0 ? ` As fotos das metas ocupam cerca de ${kb} KB.` : ""}
      </p>
      {t.bytesDasFotos > FOTOS_PESADAS_BYTES && (
        <Faixa tom="perto" icone="info">As fotos estão pesadas. Se a tela começar a demorar, remova algumas das metas antigas.</Faixa>
      )}
      <div className="fin-botoes">
        <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "transferencia" })}>Transferência entre contas</button>
        <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "importar" })}>Importar extrato do banco</button>
        <a className="button secondary compacto" href="/api/financas/exportar?formato=csv" download="lancamentos.csv" onClick={() => f.avisar("Arquivo salvo.")}>
          Baixar CSV
        </a>
        <a className="button secondary compacto" href="/api/financas/exportar?formato=backup" download="backup-financas.json" onClick={() => f.avisar("Arquivo salvo.")}>
          Backup (JSON)
        </a>
        <button type="button" className="button secondary compacto" onClick={() => f.abrir({ tipo: "restaurar" })}>Restaurar backup</button>
      </div>
      <DocumentosDaFila />
      <button type="button" className="button full-width fin-apagar" onClick={() => void apagarTudo()}>Apagar tudo</button>
    </Bloco>
  );
}
