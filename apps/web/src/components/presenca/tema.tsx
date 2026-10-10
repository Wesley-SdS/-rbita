"use client";

import { useEffect, useState } from "react";
import { COOKIE_TEMA, gravarPreferencia, migrarDoLocalStorage } from "@/lib/preferencias-visuais";
import { Icone } from "./icones";

/** O botão de tema claro e escuro: na barra do topo e no cabeçalho da Conversa. */
export function Tema() {
  const [tema, setTema] = useState<"claro" | "escuro">("claro");

  useEffect(() => {
    // quem já usava a Órbita tem a escolha no localStorage e nenhum cookie: sem
    // esta migração o tema escuro "sumiria" na primeira carga depois da
    // mudança, e a pessoa acharia que a preferência foi esquecida
    migrarDoLocalStorage();
    setTema(document.documentElement.dataset.theme === "dark" ? "escuro" : "claro");
  }, []);

  function alternar() {
    const proximo = tema === "escuro" ? "claro" : "escuro";
    setTema(proximo);
    // O padrão é o Mineral claro: só o escuro grava atributo e preferência.
    if (proximo === "escuro") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    // cookie e não localStorage: é o servidor que precisa ler isto para
    // mandar o HTML já com o tema certo (ver `lib/preferencias-visuais.ts`)
    gravarPreferencia(COOKIE_TEMA, proximo);
  }

  return (
    <button
      className="icon-button"
      onClick={alternar}
      aria-label={tema === "escuro" ? "Usar o tema claro" : "Usar o tema escuro"}
      title="Alternar tema"
    >
      <Icone nome={tema === "escuro" ? "sun" : "moon"} />
    </button>
  );
}
