import { settings } from "../settings";
import type { Limiares } from "./tipos";

/**
 * Os limiares do painel lidos da config a cada pedido (o store de settings
 * tem cache curto): mudar "perto de vencer" de 7 para 3 dias vale na próxima
 * tela aberta, sem reiniciar nada (CLAUDE.md §5.6).
 */
export async function limiaresDaConfig(): Promise<Limiares> {
  const [diasPerto, diasJanela, diasFimDoMes, mesesMedia, mesesSemeados, mesesPrevisao, repeticoesAtalho] = await Promise.all([
    settings.get("finance.diasPerto"),
    settings.get("finance.diasJanela"),
    settings.get("finance.diasFimDoMes"),
    settings.get("finance.mesesMedia"),
    settings.get("finance.mesesSemeados"),
    settings.get("finance.mesesPrevisao"),
    settings.get("finance.repeticoesAtalho"),
  ]);
  return { diasPerto, diasJanela, diasFimDoMes, mesesMedia, mesesSemeados, mesesPrevisao, repeticoesAtalho };
}
