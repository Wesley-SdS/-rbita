import type { ToolRisk } from "../tools/registry";

/**
 * Risco por DOMÍNIO do Home Assistant (B3.8). Isto é o DEFAULT — o dono
 * sobrescreve por domínio na tela (tabela `ha_domain_risk`, packages/db); o
 * default aqui é só o que o app usa até ele mexer, nunca a fonte de verdade.
 *
 * Decisão do dono (17/09): luz, tomada, mídia e clima executam direto;
 * fechadura, alarme, portão e garagem passam pelo gate humano (§5.1).
 *
 * `scene`, `script`, `automation` e `homeassistant` são domínios de
 * DESPACHO: os serviços deles agem sobre OUTRAS entidades (`scene.apply`
 * aceita um mapa arbitrário de entidade→estado; `homeassistant.turn_on`
 * aceita qualquer `entity_id` de qualquer domínio). Classificar isso pelo
 * domínio da entidade "alvo" não protege nada — por isso ficam em
 * "perigoso" aqui E são recusados por `casa_acionar`/`casa_acionar_com_aprovacao`
 * mesmo que o dono rebaixe o risco na tela (defesa em profundidade, achado
 * de auditoria pós-Onda 6). Ativar uma cena continua possível pela tool
 * dedicada `casa_ativar_cena`, que não aceita `dados` livre.
 */
const DEFAULT_DOMAIN_RISK: Record<string, ToolRisk> = {
  // direto (decisão do dono)
  light: "escrita",
  switch: "escrita",
  media_player: "escrita",
  climate: "escrita",
  fan: "escrita",
  humidifier: "escrita",
  vacuum: "escrita",
  input_boolean: "escrita",
  input_number: "escrita",
  input_select: "escrita",

  // gate (decisão do dono)
  lock: "perigoso",
  alarm_control_panel: "perigoso",
  cover: "perigoso", // portões e garagens do HA são "cover"
  valve: "perigoso", // registro de água/gás

  // domínios de despacho: sempre perigoso, nunca rebaixável (ver comentário acima)
  scene: "perigoso",
  script: "perigoso",
  automation: "perigoso",
  homeassistant: "perigoso",

  // leitura pura (sensores nunca são acionados)
  sensor: "leitura",
  binary_sensor: "leitura",
  person: "leitura",
  device_tracker: "leitura",
  weather: "leitura",
  camera: "leitura",
};

/** Domínios de despacho (ver comentário de `DEFAULT_DOMAIN_RISK`): nunca acionáveis por `casa_acionar`/`_com_aprovacao`, mesmo com override do dono. */
export const DISPATCH_DOMAINS: ReadonlySet<string> = new Set(["scene", "script", "automation", "homeassistant"]);

/**
 * Domínio desconhecido (integração nova, nunca vista): "perigoso" por
 * padrão. Um domínio que a Órbita não reconhece pode ser exatamente um
 * domínio de despacho novo que o HA adicionou — liberar por omissão seria
 * repetir o erro que a auditoria pegou em `scene`/`script`/`homeassistant`.
 * O dono libera explicitamente pela tela quando souber que é seguro.
 */
const FALLBACK_RISK: ToolRisk = "perigoso";

export function defaultDomainRisk(domain: string): ToolRisk {
  return DEFAULT_DOMAIN_RISK[domain] ?? FALLBACK_RISK;
}

export function isKnownDomain(domain: string): boolean {
  return domain in DEFAULT_DOMAIN_RISK;
}

/** Domínio → risco, aplicando overrides do banco por cima do default. */
export function resolveDomainRisk(domain: string, overrides: ReadonlyMap<string, ToolRisk>): ToolRisk {
  return overrides.get(domain) ?? defaultDomainRisk(domain);
}

/** `entity_id` do HA é sempre "dominio.objeto"; extrai o domínio. */
export function domainOf(entityId: string): string {
  const i = entityId.indexOf(".");
  return i > 0 ? entityId.slice(0, i) : entityId;
}
