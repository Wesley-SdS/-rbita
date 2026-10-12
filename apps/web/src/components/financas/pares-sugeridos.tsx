"use client";

import { brl, dataCurta } from "@orbita/core/finance/formato";
import type { ParSugerido } from "@orbita/core/finance/transferencias";
import { useRecurso, invalidar } from "@/lib/dados/recurso";
import { enviarComando, invalidarFinancas, urlDaVista } from "@/lib/financas/api";
import type { ContaCarteira } from "@/lib/financas/tipos";
import { useFinancas } from "./contexto";
import { Bloco, Link, Pastilha } from "./primitivos";

/**
 * Saída numa conta e entrada de mesmo valor em outra que, muito provavelmente,
 * são a mesma transferência lançada como gasto e renda. Só sugere: sem o
 * documento do outro lado, a Órbita não sabe se foi para você mesmo ou para um
 * amigo que devolveu o valor, então quem confirma é você (um a um ou todos).
 */
export function ParesSugeridos({ contas }: { contas: ContaCarteira[] }) {
  const f = useFinancas();
  const url = urlDaVista("pares");
  const { dado, recarregar } = useRecurso<{ pares: ParSugerido[] }>(url);
  if (!dado?.pares.length) return null;
  const nome = (id: string) => contas.find((c) => c.id === id)?.nome ?? "conta apagada";

  async function marcar(pares: ParSugerido[]) {
    const r = await enviarComando({ tipo: "juntar_transferencia", pares: pares.map((p) => ({ saidaId: p.saida.id, entradaId: p.entrada.id })) });
    if (!r.ok) return f.avisar(r.erro);
    const grupos = r.dado.grupos ?? [];
    invalidar(url);
    invalidarFinancas();
    recarregar();
    // o "desfazer" padrão apagaria lançamentos; aqui ele só desliga a marca
    f.avisar(r.dado.mensagem, grupos.length
      ? {
          rotulo: "desfazer",
          fazer: () => {
            void enviarComando({ tipo: "desjuntar_transferencia", grupos }).then((x) => {
              invalidar(url);
              invalidarFinancas();
              recarregar();
              f.avisar(x.ok ? x.dado.mensagem : x.erro);
            });
          },
        }
      : undefined);
  }

  return (
    <Bloco
      titulo="Possíveis transferências entre suas contas"
      direita={dado.pares.length > 1 ? <Link onClick={() => void marcar(dado.pares)}>marcar todas ({dado.pares.length})</Link> : undefined}
    >
      <p className="fin-nota">
        Estes pares saíram de uma conta e entraram em outra com o mesmo valor. Se foram dinheiro seu mudando de lugar, marque: deixam de contar como gasto e como renda e só movem o saldo.
      </p>
      {dado.pares.map((p) => (
        <div key={`${p.saida.id}:${p.entrada.id}`} className="fin-linha estatica">
          <Pastilha texto="⇄" />
          <span className="fin-linha-corpo">
            <strong>{brl(p.saida.valor)}</strong>
            <small>
              saiu de {nome(p.saida.contaId)} em {dataCurta(p.saida.data)} e entrou em {nome(p.entrada.contaId)} em {dataCurta(p.entrada.data)}
            </small>
          </span>
          <Link onClick={() => void marcar([p])}>é transferência</Link>
        </div>
      ))}
    </Bloco>
  );
}
