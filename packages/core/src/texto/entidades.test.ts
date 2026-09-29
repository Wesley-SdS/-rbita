import { describe, expect, it } from "vitest";
import { decodificarEntidades } from "./entidades";

describe("decodificarEntidades", () => {
  it("o snippet do Gmail volta legível", () => {
    expect(decodificarEntidades("We couldn&#39;t have &amp; &quot;16&quot; &#x2F; &lt;b&gt;")).toBe('We couldn\'t have & "16" / <b>');
  });

  it("&amp;lt; é texto literal, e código inexistente fica como veio", () => {
    expect(decodificarEntidades("&amp;lt; &#99999999;")).toBe("&lt; &#99999999;");
  });
});
