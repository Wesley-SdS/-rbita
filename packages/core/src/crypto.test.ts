import { describe, it, expect, beforeAll } from "vitest";
import { encryptSecret, decryptSecret } from "./crypto";

beforeAll(() => {
  process.env.CONNECTORS_ENC_KEY = "chave-de-teste-suficientemente-longa-123456";
});

describe("crypto (tokens em repouso)", () => {
  it("faz round-trip de um segredo", () => {
    const secret = "ya29.a0AfB_byC-token-oauth-exemplo";
    const enc = encryptSecret(secret);
    expect(enc).not.toContain(secret); // nunca em texto puro
    expect(enc.startsWith("v1:")).toBe(true);
    expect(decryptSecret(enc)).toBe(secret);
  });

  it("gera cifras diferentes para o mesmo texto (IV aleatório)", () => {
    const a = encryptSecret("mesmo-texto");
    const b = encryptSecret("mesmo-texto");
    expect(a).not.toBe(b);
    expect(decryptSecret(a)).toBe("mesmo-texto");
    expect(decryptSecret(b)).toBe("mesmo-texto");
  });

  it("detecta adulteração (auth tag do GCM)", () => {
    const enc = encryptSecret("integridade");
    const [fmt, iv, tag, ct] = enc.split(":");
    // troca 1 caractere do ciphertext → decrypt deve lançar
    const flipped = ct[0] === "A" ? "B" + ct.slice(1) : "A" + ct.slice(1);
    const tampered = [fmt, iv, tag, flipped].join(":");
    expect(() => decryptSecret(tampered)).toThrow();
  });

  it("preserva unicode (pt-BR)", () => {
    const secret = "reunião às 15h — não esquecer açaí 🥤";
    expect(decryptSecret(encryptSecret(secret))).toBe(secret);
  });
});
