import { Conteudo } from "./conteudo";

/**
 * O mapa não é adiantado pelo servidor como as outras telas.
 *
 * Ele depende do filtro escolhido (a chave do cache muda com os tipos), então
 * semear o padrão pagaria por uma busca que o primeiro clique jogaria fora.
 */
export default function PaginaConhecimento() {
  return <Conteudo />;
}
