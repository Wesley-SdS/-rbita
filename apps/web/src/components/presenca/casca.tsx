"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icone } from "./icones";
import { TELAS, telaDoCaminho } from "./navegacao";
import { Busca } from "./busca";
import { Atividade } from "./atividade";
import { ModoFoco } from "./modo-foco";
import { ProvedorCasca } from "./contexto";
import { signOut } from "@/lib/auth-client";

/** Marca: o símbolo é desenhado em CSS (dois anéis e um núcleo), sem imagem. */
function Marca() {
  return (
    <Link className="brand" href="/app" aria-label="Órbita, início">
      <span className="brand-symbol" aria-hidden="true" />
      <span>
        órbita<span className="brand-period">.</span>
      </span>
    </Link>
  );
}

function Tema() {
  const [tema, setTema] = useState<"claro" | "escuro">("claro");

  useEffect(() => {
    setTema(document.documentElement.dataset.theme === "dark" ? "escuro" : "claro");
  }, []);

  function alternar() {
    const proximo = tema === "escuro" ? "claro" : "escuro";
    setTema(proximo);
    // O padrão é o Mineral claro: só o escuro grava atributo e preferência.
    if (proximo === "escuro") document.documentElement.dataset.theme = "dark";
    else delete document.documentElement.dataset.theme;
    try {
      localStorage.setItem("orbita.theme", proximo === "escuro" ? "dark" : "light");
    } catch {
      /* navegação privada */
    }
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

export function Casca({
  nomeUsuario,
  children,
  totalRotinas,
  focoMinutos = 25,
  intensidade = 85,
  reduzido = false,
}: {
  nomeUsuario: string;
  children: React.ReactNode;
  totalRotinas?: number;
  focoMinutos?: number;
  intensidade?: number;
  reduzido?: boolean;
}) {
  const caminho = usePathname() ?? "/app";
  const atual = telaDoCaminho(caminho);
  const [menuAberto, setMenuAberto] = useState(false);
  const [recolhida, setRecolhida] = useState(false);
  const [buscaAberta, setBuscaAberta] = useState(false);
  const [atividadeAberta, setAtividadeAberta] = useState(false);
  const [focoAberto, setFocoAberto] = useState(false);

  // O sistema operacional também pede calma: se a pessoa configurou movimento
  // reduzido no aparelho, isso vale mesmo que a chave do app esteja desligada.
  const [reduzidoNoAparelho, setReduzidoNoAparelho] = useState(false);
  useEffect(() => {
    const consulta = window.matchMedia("(prefers-reduced-motion: reduce)");
    setReduzidoNoAparelho(consulta.matches);
    const aoMudar = (e: MediaQueryListEvent) => setReduzidoNoAparelho(e.matches);
    consulta.addEventListener("change", aoMudar);
    return () => consulta.removeEventListener("change", aoMudar);
  }, []);
  const movimentoReduzido = reduzido || reduzidoNoAparelho;

  // O boot já aplicou o atributo; aqui o React só passa a saber dele. Ler do
  // DOM em vez de do localStorage mantém uma fonte só da verdade.
  useEffect(() => {
    setRecolhida(document.documentElement.dataset.lateral === "recolhida");
  }, []);

  function alternarLateral() {
    const proxima = !recolhida;
    setRecolhida(proxima);
    if (proxima) document.documentElement.dataset.lateral = "recolhida";
    else delete document.documentElement.dataset.lateral;
    try {
      localStorage.setItem("orbita.lateral", proxima ? "recolhida" : "aberta");
    } catch {
      /* navegação privada */
    }
  }

  const fecharMenu = useCallback(() => setMenuAberto(false), []);
  // Navegar no celular tem de fechar a gaveta; sem isso ela cobre a tela nova.
  useEffect(() => fecharMenu(), [caminho, fecharMenu]);

  // ⌘K abre a busca de qualquer tela; Esc fecha o que estiver aberto. O listener
  // fica na janela porque o atalho precisa valer mesmo com o foco num campo.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setAtividadeAberta(false);
        setBuscaAberta((v) => !v);
      } else if (e.key === "Escape") {
        setBuscaAberta(false);
        setAtividadeAberta(false);
        setFocoAberto(false);
        setMenuAberto(false);
      }
    }
    window.addEventListener("keydown", aoTeclar);
    return () => window.removeEventListener("keydown", aoTeclar);
  }, []);

  const grupo = (nome: "espaco" | "conectado") =>
    TELAS.filter((t) => t.grupo === nome).map((t) => (
      <Link
        key={t.slug}
        href={t.href}
        className={`nav-link ${atual.slug === t.slug ? "active" : ""}`}
        aria-current={atual.slug === t.slug ? "page" : undefined}
        title={t.titulo}
      >
        <Icone nome={t.icone} />
        {/* O rótulo vai num span porque com a barra recolhida ele precisa sumir,
            e seletor CSS não alcança nó de texto solto. */}
        <span className="nav-rotulo">{t.titulo}</span>
        {t.slug === "rotinas" && totalRotinas ? <span className="nav-count">{totalRotinas}</span> : null}
        <span className="nav-active-dot" />
      </Link>
    ));

  return (
    <ProvedorCasca
      value={{
        abrirFoco: () => setFocoAberto(true),
        abrirBusca: () => setBuscaAberta(true),
        abrirAtividade: () => setAtividadeAberta(true),
        intensidade,
        reduzido: movimentoReduzido,
      }}
    >
      <a href="#conteudo" className="skip-link">
        Pular para o conteúdo
      </a>
      <div className={`mobile-scrim ${menuAberto ? "open" : ""}`} onClick={fecharMenu} />

      <aside className={`sidebar ${menuAberto ? "open" : ""}`} aria-label="Navegação principal">
        <Marca />
        <div className="workspace">
          <span className="workspace-icon">
            <Icone nome="home" />
          </span>
          <div>
            <strong>Seu universo pessoal</strong>
            <span>Um espaço só seu</span>
          </div>
          <span className="tiny-dot" />
        </div>

        <button className="search-trigger" onClick={() => setBuscaAberta(true)} title="Encontre qualquer coisa (⌘K)">
          <Icone nome="search" />
          <span>Encontre qualquer coisa</span>
          <kbd>⌘ K</kbd>
        </button>

        <p className="nav-caption">SEU ESPAÇO</p>
        <nav className="nav-main">{grupo("espaco")}</nav>

        <p className="nav-caption">CONECTADO A VOCÊ</p>
        <nav className="nav-main">{grupo("conectado")}</nav>

        <div className="sidebar-bottom">
          <button type="button" onClick={() => setFocoAberto(true)} className="focus-teaser" title="Entrar no modo foco">
            <span className="focus-symbol">
              <Icone nome="spark" />
            </span>
            <strong>
              Menos ruído.
              <br />
              Mais presença.
            </strong>
            <span>
              Entre no modo foco <Icone nome="arrow-up-right" />
            </span>
          </button>

          <Link
            href="/app/ajustes"
            className={`nav-link ${atual.slug === "ajustes" ? "active" : ""}`}
            aria-current={atual.slug === "ajustes" ? "page" : undefined}
            title="Preferências"
          >
            <Icone nome="settings" />
            <span className="nav-rotulo">Preferências</span>
          </Link>

          <button className="profile" onClick={() => signOut().then(() => location.assign("/login"))} title="Sair da sua conta">
            <span className="avatar">{nomeUsuario.slice(0, 1).toUpperCase()}</span>
            <span>
              <strong>{nomeUsuario}</strong>
              <small>Sair da sua conta</small>
            </span>
            <Icone nome="chevrons" />
          </button>
        </div>
      </aside>

      <div className="app-shell">
        <header className="topbar">
          <div className="breadcrumb">
            <button
              className="icon-button mobile-menu"
              onClick={() => setMenuAberto((v) => !v)}
              aria-label="Abrir navegação"
              aria-expanded={menuAberto}
            >
              <Icone nome="menu" />
            </button>
            <button
              className="icon-button recolher-lateral"
              onClick={alternarLateral}
              aria-label={recolhida ? "Expandir a navegação" : "Recolher a navegação"}
              aria-pressed={recolhida}
              title={recolhida ? "Expandir a navegação" : "Recolher a navegação"}
            >
              <Icone nome={recolhida ? "arrow-right" : "menu"} />
            </button>
            <span className="breadcrumb-universe">Meu universo</span>
            <span className="slash">/</span>
            <strong>{atual.titulo}</strong>
          </div>
          <div className="topbar-actions">
            <span className="topbar-divider" />
            <Tema />
            <button
              className="icon-button notification-button"
              onClick={() => setAtividadeAberta(true)}
              aria-label="Abrir atividade e aprovações"
              title="Atividade e aprovações"
            >
              <Icone nome="bell" />
            </button>
          </div>
        </header>
        <main id="conteudo" tabIndex={-1}>
          {children}
        </main>
      </div>

      <Busca aberta={buscaAberta} aoFechar={() => setBuscaAberta(false)} />
      <Atividade aberta={atividadeAberta} aoFechar={() => setAtividadeAberta(false)} />
      <ModoFoco
        aberto={focoAberto}
        aoFechar={() => setFocoAberto(false)}
        minutos={focoMinutos}
        intensidade={intensidade}
        reduzido={movimentoReduzido}
      />
    </ProvedorCasca>
  );
}
