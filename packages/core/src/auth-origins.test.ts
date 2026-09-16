import { describe, expect, it } from "vitest";
import { trustedOrigins } from "./auth-origins";

/** Monta um Request com os headers que a Vercel/Next entregam. */
function req(headers: Record<string, string>): Request {
  return new Request("https://x/api/auth/sign-in", { headers });
}

describe("trustedOrigins", () => {
  it("confia no domínio de produção da Vercel (same-origin)", () => {
    // reproduz o erro real: Origin = domínio de produção, sem VERCEL_* no runtime
    const list = trustedOrigins(
      req({ host: "rbita-web.vercel.app", "x-forwarded-proto": "https", origin: "https://rbita-web.vercel.app" }),
    );
    expect(list).toContain("https://rbita-web.vercel.app");
  });

  it("confia em qualquer alias de deploy da Vercel via Host", () => {
    const list = trustedOrigins(
      req({ host: "rbita-git-main-wesleysds-projects.vercel.app", "x-forwarded-proto": "https" }),
    );
    expect(list).toContain("https://rbita-git-main-wesleysds-projects.vercel.app");
  });

  it("NÃO confia numa origem de CSRF (Origin ≠ Host)", () => {
    // ataque: a requisição chega no nosso host, mas o Origin é de outro site
    const list = trustedOrigins(
      req({ host: "rbita-web.vercel.app", "x-forwarded-proto": "https", origin: "https://evil.example.com" }),
    );
    expect(list).toContain("https://rbita-web.vercel.app"); // o host legítimo entra
    expect(list).not.toContain("https://evil.example.com"); // o atacante, não
  });

  it("mantém localhost e host de LAN em http (mobile)", () => {
    const list = trustedOrigins(req({ host: "192.168.15.10:3000", origin: "http://192.168.15.10:3000" }));
    expect(list).toContain("http://192.168.15.10:3000");
    expect(list).toContain("http://localhost:3000");
  });

  it("sem request, ainda retorna os defaults locais", () => {
    const list = trustedOrigins();
    expect(list).toContain("http://localhost:3000");
  });
});
