"use client";

import type { FolhaAberta } from "../contexto";
import { FolhaLancamento } from "./lancamento";
import { FolhaParcelas } from "./parcelas";
import { FolhaTransferencia } from "./transferencia";
import { FolhaAtalho } from "./atalho";
import { FolhaCompromisso } from "./compromisso";
import { FolhaQuitar } from "./quitar";
import { FolhaFatura } from "./fatura";
import { FolhaDivida } from "./divida";
import { FolhaPagarDivida } from "./pagar-divida";
import { FolhaMeta } from "./meta";
import { FolhaItem } from "./item";
import { FolhaCategoria } from "./categoria";
import { FolhaConta } from "./conta";
import { FolhaCartao } from "./cartao";
import { FolhaRegra } from "./regra";
import { FolhaDitado } from "./ditado";
import { FolhaBoleto } from "./boleto";
import { FolhaImportar } from "./importar";
import { FolhaRestaurar } from "./restaurar";
import { FolhaBoasVindas } from "./boas-vindas";

/** Só uma folha por vez (PRD §6.0.6): quem abre outra troca esta. */
export function FolhaDaVez({ folha }: { folha: FolhaAberta }) {
  switch (folha.tipo) {
    case "lancamento": return <FolhaLancamento lanc={folha.lanc} cartaoId={folha.cartaoId} />;
    case "parcelas": return <FolhaParcelas lanc={folha.lanc} />;
    case "transferencia": return <FolhaTransferencia perna={folha.perna} />;
    case "atalho": return <FolhaAtalho atalho={folha.atalho} />;
    case "compromisso": return <FolhaCompromisso conta={folha.conta} preenchido={folha.preenchido} />;
    case "quitar": return <FolhaQuitar conta={folha.conta} />;
    case "fatura": return <FolhaFatura cartao={folha.cartao} />;
    case "divida": return <FolhaDivida divida={folha.divida} />;
    case "pagar_divida": return <FolhaPagarDivida divida={folha.divida} />;
    case "meta": return <FolhaMeta meta={folha.meta} quantas={folha.quantas} />;
    case "item": return <FolhaItem meta={folha.meta} item={folha.item} />;
    case "categoria": return <FolhaCategoria categoria={folha.categoria} />;
    case "conta": return <FolhaConta conta={folha.conta} />;
    case "cartao": return <FolhaCartao cartao={folha.cartao} />;
    case "regra": return <FolhaRegra regra={folha.regra} />;
    case "ditado": return <FolhaDitado />;
    case "boleto": return <FolhaBoleto />;
    case "importar": return <FolhaImportar />;
    case "restaurar": return <FolhaRestaurar />;
    case "boas_vindas": return <FolhaBoasVindas />;
  }
}
