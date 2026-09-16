import { describe, it, expect } from "vitest";
import { assertPublicUrl, SsrfError, _internal } from "./ssrf";

const { isPrivateIp } = _internal;

describe("isPrivateIp", () => {
  it("bloqueia loopback, privados, link-local e metadata", () => {
    for (const ip of ["127.0.0.1", "10.1.2.3", "172.16.0.1", "192.168.0.10", "169.254.169.254", "100.64.0.1", "0.0.0.0"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("bloqueia IPv6 interno (loopback/ULA/link-local/mapeado)", () => {
    for (const ip of ["::1", "::", "fc00::1", "fd12::34", "fe80::1", "::ffff:127.0.0.1", "::ffff:10.0.0.1"]) {
      expect(isPrivateIp(ip)).toBe(true);
    }
  });
  it("permite IPs públicos", () => {
    for (const ip of ["8.8.8.8", "1.1.1.1", "93.184.216.34", "2606:4700:4700::1111"]) {
      expect(isPrivateIp(ip)).toBe(false);
    }
  });
});

describe("assertPublicUrl", () => {
  it("rejeita protocolo não-http", async () => {
    await expect(assertPublicUrl("file:///etc/passwd")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("ftp://example.com")).rejects.toBeInstanceOf(SsrfError);
  });
  it("rejeita IP literal interno", async () => {
    await expect(assertPublicUrl("http://169.254.169.254/latest/meta-data/")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("http://127.0.0.1:11434/")).rejects.toBeInstanceOf(SsrfError);
    await expect(assertPublicUrl("http://[::1]/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("rejeita localhost (resolve p/ loopback)", async () => {
    await expect(assertPublicUrl("http://localhost:5432/")).rejects.toBeInstanceOf(SsrfError);
  });
  it("aceita host público", async () => {
    await expect(assertPublicUrl("https://example.com/")).resolves.toBeUndefined();
  });
});
