import { describe, expect, it } from "vitest";
import { motivoDoFechamento } from "./gemini-live";

// O Gemini derrubava a sessão e a tela ficava muda (06/10/2026: relógio do
// Windows 3h atrasado, "Token has expired"). O motivo agora vira frase.
describe("por que a sessão de voz caiu", () => {
  it("token vencido aponta para o relógio", () => {
    expect(motivoDoFechamento(1011, "Token has expired")).toContain("relógio deste computador");
  });
  it("configuração recusada diz o que o Gemini disse", () => {
    expect(motivoDoFechamento(1007, 'Invalid value at "setup.tools[0]"')).toBe('O Gemini recusou a configuração da sessão de voz: Invalid value at "setup.tools[0]".');
  });
  it("limite de uso e o resto", () => {
    expect(motivoDoFechamento(1011, "Resource has been exhausted (e.g. check quota).")).toContain("limite de uso");
    expect(motivoDoFechamento(1006, "")).toBe("A sessão de voz caiu (1006).");
  });
});
