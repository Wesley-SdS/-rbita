/**
 * Os DOMÍNIOS SENSÍVEIS do controle do PC (PRD-COMPUTADOR-E-NAVEGADOR F1).
 *
 * Toda tool registrada num destes domínios é tratada como sensível pelo
 * próprio registro, pelo NOME DO DOMÍNIO, sem a tool precisar declarar nada:
 * uma tool nova de terminal que esquecesse uma flag continuaria sensível. O
 * `requires.dono` existe para OUTRO domínio optar pelo mesmo tratamento.
 *
 * Sensível quer dizer, ao mesmo tempo:
 *   - só aparece quando `controle.ativo` está ligado e o canal está em
 *     `controle.canais`;
 *   - nunca aparece em turno de pessoa da casa, nem em regra disparada por
 *     texto de terceiro (`soLeitura`); a resposta automática do WhatsApp não
 *     tem tool nenhuma (`whatsapp/automatico.ts`);
 *   - cada chamada passa pela guarda (`controle/guarda.ts`): trilha, sessão,
 *     crítico e a checagem de quem pede.
 *
 * Puro: o registro (que é puro) importa daqui.
 */
export const DOMINIOS_SENSIVEIS = ["controle", "terminal", "arquivos", "computador", "navegador"] as const;
export type DominioSensivel = (typeof DOMINIOS_SENSIVEIS)[number];

export function ehDominioSensivel(domain: string): domain is DominioSensivel {
  return (DOMINIOS_SENSIVEIS as readonly string[]).includes(domain);
}

/** A tool é sensível pelo domínio ou porque pediu (`requires.dono`). */
export function ehToolSensivel(def: { domain: string; requires?: { dono?: boolean } }): boolean {
  return ehDominioSensivel(def.domain) || def.requires?.dono === true;
}

/**
 * Onde a ação acontece, para a sessão de controle: só computador e navegador
 * AGEM numa tela e precisam de envelope. Terminal e arquivos têm gate próprio
 * (classificador de comando, pastas liberadas) e não dependem de sessão.
 */
export type TipoDeAlvo = "computador" | "navegador";
export function tipoDeAlvoDoDominio(domain: string): TipoDeAlvo | null {
  return domain === "computador" || domain === "navegador" ? domain : null;
}

export interface CondicaoDoTurno {
  /** `controle.ativo` */
  ativo: boolean;
  /** `controle.canais` */
  canais: readonly string[];
  canal: string;
  /** regra disparada por evento de terceiro: só leitura e nada sensível */
  soLeitura?: boolean;
  /** turno de alguém que não é o dono (Telegram da família, voz reconhecida de outra pessoa) */
  pessoaDaCasa?: boolean;
}

/** As tools sensíveis entram neste turno? Falha fechada: qualquer dúvida é não. Puro. */
export function sensiveisLiberados(c: CondicaoDoTurno): boolean {
  if (!c.ativo) return false;
  if (c.soLeitura || c.pessoaDaCasa) return false;
  return c.canais.map((x) => x.trim().toLowerCase()).includes(c.canal.toLowerCase());
}
