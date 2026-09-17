import { describe, it, expect } from "vitest";
import { defaultDomainRisk, domainOf, isKnownDomain, resolveDomainRisk } from "./domain-risk";

describe("defaultDomainRisk", () => {
  it("luz, tomada, mídia e clima executam direto (escrita, sem gate)", () => {
    for (const d of ["light", "switch", "media_player", "climate", "fan"]) {
      expect(defaultDomainRisk(d)).toBe("escrita");
    }
  });
  it("fechadura, alarme, portão e válvula exigem gate (perigoso)", () => {
    for (const d of ["lock", "alarm_control_panel", "cover", "valve"]) {
      expect(defaultDomainRisk(d)).toBe("perigoso");
    }
  });
  it("sensores são só leitura, nunca acionáveis", () => {
    for (const d of ["sensor", "binary_sensor", "camera"]) {
      expect(defaultDomainRisk(d)).toBe("leitura");
    }
  });
  it("domínio desconhecido cai em escrita, nem trava nem libera sem gate", () => {
    expect(defaultDomainRisk("integracao_nova_desconhecida")).toBe("escrita");
    expect(isKnownDomain("integracao_nova_desconhecida")).toBe(false);
  });
});

describe("resolveDomainRisk", () => {
  it("sem override, usa o default", () => {
    expect(resolveDomainRisk("light", new Map())).toBe("escrita");
  });
  it("override do dono vence o default, inclusive subindo o risco de um domínio direto", () => {
    const overrides = new Map([["light", "perigoso" as const]]);
    expect(resolveDomainRisk("light", overrides)).toBe("perigoso");
  });
  it("override não afeta outros domínios", () => {
    const overrides = new Map([["light", "perigoso" as const]]);
    expect(resolveDomainRisk("switch", overrides)).toBe("escrita");
  });
});

describe("domainOf", () => {
  it("extrai o domínio do entity_id do HA", () => {
    expect(domainOf("light.living_room")).toBe("light");
    expect(domainOf("lock.front_door")).toBe("lock");
  });
  it("entity_id sem ponto devolve o próprio valor (dado malformado)", () => {
    expect(domainOf("semponto")).toBe("semponto");
  });
});
