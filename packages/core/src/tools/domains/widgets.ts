import { z } from "zod";
import { db } from "@orbita/db";
import { widget } from "@orbita/db/widget-schema";
import { registerTools, type ToolDef } from "../registry";

/** Domínio: dashboard (cards pináveis). */

const Input = z.object({
  tipo: z.enum(["cotacao", "clima", "nota", "checklist"]),
  titulo: z.string(),
  par: z.string().optional().describe("par de moeda p/ cotação, ex: USD-BRL, EUR-BRL, BTC-BRL"),
  cidade: z.string().optional().describe("cidade p/ o widget de clima"),
});

export const criar_widget: ToolDef<typeof Input> = {
  name: "criar_widget",
  domain: "dashboard",
  description: "Fixa/pina um CARD no dashboard do usuário para acompanhar algo no dia a dia: cotação de moeda, clima de uma cidade, uma nota ou um checklist. Use quando o usuário disser 'pina', 'fixa', 'cria um card', 'quero acompanhar'.",
  risk: "escrita",
  keywords: ["card", "widget", "pina", "fixa", "acompanhar", "cotação", "dashboard"],
  inputSchema: Input,
  run: async ({ tipo, titulo, par, cidade }, { userId }) => {
    const config =
      tipo === "cotacao" ? { par: (par || "USD-BRL").toUpperCase() } :
      tipo === "clima" ? { cidade: cidade || "São Paulo" } :
      tipo === "nota" ? { text: "" } : { items: [] };
    await db.insert(widget).values({ userId, type: tipo, title: titulo, config });
    return { pinado: true, tipo, titulo };
  },
};

registerTools([criar_widget]);
