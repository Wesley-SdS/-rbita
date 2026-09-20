import { redirect } from "next/navigation";

/**
 * Os insights viraram a aba "Ver conexões" dentro de Memória: o grafo é o que
 * o protótipo chama de mapa das memórias, e ali ele fica ao lado do acervo em
 * vez de numa página solta.
 *
 * A rota continua existindo só para não quebrar link antigo, atalho salvo ou
 * aba que alguém deixou aberta.
 */
export default function PaginaInsights() {
  redirect("/app/memoria");
}
