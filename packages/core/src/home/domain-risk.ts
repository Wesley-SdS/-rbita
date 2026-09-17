import type { ToolRisk } from "../tools/registry";

/**
 * Risco por DOMÍNIO do Home Assistant (B3.8). Isto é o DEFAULT — o dono
 * sobrescreve por domínio na tela (tabela `ha_domain_risk`, packages/db); o
 * default aqui é só o que o app usa até ele mexer, nunca a fonte de verdade.
 *
 * Decisão do dono (17/09): luz, tomada, mídia e clima executam direto;
 * fechadura, alarme, portão e garagem passam pelo gate humano (§5.1).
 * Doença não classificada explicitamente cai em "escrita" (executa, mas não é
 * leitura) — nunca em "perigoso" por omissão, para não travar o app à toa,
 * mas também nunca em "leitura", porque acionar não é ler.
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
  script: "escrita",
  input_boolean: "escrita",
  input_number: "escrita",
  input_select: "escrita",
  scene: "escrita",

  // gate (decisão do dono)
  lock: "perigoso",
  alarm_control_panel: "perigoso",
  cover: "perigoso", // portões e garagens do HA são "cover"
  valve: "perigoso", // registro de água/gás

  // leitura pura (sensores nunca são acionados)
  sensor: "leitura",
  binary_sensor: "leitura",
  person: "leitura",
  device_tracker: "leitura",
  weather: "leitura",
  camera: "leitura",
};

/** Domínio desconhecido (integração nova, nunca visto): nem trava, nem libera sem gate. */
const FALLBACK_RISK: ToolRisk = "escrita";

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
