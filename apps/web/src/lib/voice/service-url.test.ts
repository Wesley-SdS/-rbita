import { afterEach, describe, expect, it, vi } from "vitest";
import { voiceServiceUrl } from "./service-url";

afterEach(() => {
  vi.unstubAllEnvs();
});

const call = (value: string) => {
  vi.stubEnv("VOICE_URL", value);
  return voiceServiceUrl();
};

describe("voiceServiceUrl", () => {
  it("aceita uma URL limpa e remove a barra final", () => {
    expect(call("https://rbita.onrender.com")).toBe("https://rbita.onrender.com");
    expect(call("https://rbita.onrender.com/")).toBe("https://rbita.onrender.com");
  });

  it("corta espaços/quebras em volta", () => {
    expect(call("  https://rbita.onrender.com \n")).toBe("https://rbita.onrender.com");
  });

  it("rejeita o valor malformado real (rótulo colado no valor) → null", () => {
    // exatamente o que quebrou em produção
    const ruim = "VOICE_URL           = https://rbita.onrender.com\nVOICE_PUBLIC_WS_URL = wss://rbita.onrender.com";
    expect(call(ruim)).toBeNull();
  });

  it("mantém só protocolo+host (descarta caminho colado)", () => {
    expect(call("https://rbita.onrender.com/stt")).toBe("https://rbita.onrender.com");
  });
});
