"""ÓRBITA, as mãos no Windows (PRD-COMPUTADOR-E-NAVEGADOR, frente A).

Só escuta em 127.0.0.1. Toda requisição precisa do cabeçalho `x-orbita-maos`
com o `MAOS_TOKEN` (inclusive o /health), e qualquer requisição com `Origin`
é recusada: página web nenhuma fala com este serviço, nem com o token roubado
de outro lugar, porque navegador SEMPRE manda `Origin` em pedido de outra
origem (a lição da CVE-2026-25253, PRD §2.5). Não há CORS.

Subir: `servir.py` (é o que a tarefa de logon roda, pelo pythonw). Este módulo
monta o app; os testes montam com peças falsas.
"""

from __future__ import annotations

import hashlib
import logging
import socket
import time
from datetime import datetime, timezone
from typing import Any, Literal

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from maos import VERSAO
from maos.avisos import Avisos
from maos.envelope import Envelope, Espelho
from maos.seguranca import token_confere

log = logging.getLogger("maos")
HOSTS_LOCAIS = {"127.0.0.1", "localhost", "[::1]"}


class Recusada(Exception):
    """A ordem não cabe (envelope, senha, tela mudou). 409 com o motivo, para o modelo repassar."""


# ── corpos ──────────────────────────────────────────────────────────────────
Ocultos = list[str]


class EnvelopeIn(BaseModel):
    sessaoId: str = Field(min_length=1, max_length=80)
    alvo: Literal["computador", "navegador", "ambos"]
    objetivo: str = Field(max_length=400)
    apps: list[str] = Field(default_factory=list, max_length=40)
    sites: list[str] = Field(default_factory=list, max_length=40)
    tetoPassos: int = Field(ge=0, le=10000)
    passosUsados: int = Field(ge=0, le=10000)
    expiraEm: datetime
    maquina: str = Field(max_length=120)


class FimIn(BaseModel):
    sessaoId: str = Field(min_length=1, max_length=80)
    status: Literal["pausada", "encerrada", "parada"]
    motivo: str = Field(default="", max_length=300)


class PararIn(BaseModel):
    origem: str = Field(default="api", max_length=60)


class ConfigIn(BaseModel):
    atalhoParar: str | None = Field(default=None, max_length=40)
    appsOcultos: list[str] | None = Field(default=None, max_length=200)


class ConfirmarIn(BaseModel):
    ids: list[str] = Field(max_length=100)


class AnalisarIn(BaseModel):
    comando: str = Field(min_length=1, max_length=20000)
    shell: Literal["powershell", "pwsh", "gitbash", "wsl", "bash"]
    # com a pasta, os fatos levam o caminho REAL de cada argumento que existe nela (link, 8.3, curinga, fluxo)
    pasta: str | None = Field(default=None, max_length=1000)


class ExecutarIn(BaseModel):
    comando: str = Field(min_length=1, max_length=20000)
    shell: Literal["powershell", "pwsh", "gitbash", "wsl"] = "powershell"
    pasta: str = Field(min_length=1, max_length=1000)
    raizes: list[str] = Field(min_length=1, max_length=50)
    variaveis: list[str] = Field(default_factory=list, max_length=200)
    esperarSeg: float = Field(default=8, ge=0, le=60)
    timeoutSeg: int = Field(default=600, ge=1, le=7200)
    memoriaMb: int = Field(default=2048, ge=32, le=65536)
    saidaMax: int = Field(default=30000, ge=500, le=400000)
    isolado: Literal["docker", "sandbox"] | None = None
    imagem: str = Field(default="alpine:3.20", max_length=200, pattern=r"^[a-z0-9][a-z0-9._/:@-]*$")


class PtyAbrirIn(BaseModel):
    shell: Literal["powershell", "pwsh", "gitbash", "wsl"] = "powershell"
    pasta: str = Field(min_length=1, max_length=1000)
    raizes: list[str] = Field(min_length=1, max_length=50)
    variaveis: list[str] = Field(default_factory=list, max_length=200)
    memoriaMb: int = Field(default=2048, ge=32, le=65536)
    comando: str | None = Field(default=None, max_length=20000)


class PtyEscreverIn(BaseModel):
    texto: str = Field(max_length=20000)
    enter: bool = True


class EncerrarIn(BaseModel):
    pid: int = Field(ge=1)
    nome: str | None = Field(default=None, max_length=260)
    inicio: float | None = None
    forcar: bool = False


class MidiaIn(BaseModel):
    acao: Literal["tocar_pausar", "tocar", "pausar", "proxima", "anterior", "parar", "volume", "aumentar", "diminuir", "mudo", "som", "bloquear"]
    valor: int | None = Field(default=None, ge=0, le=100)


class OcultosIn(BaseModel):
    ocultos: Ocultos = Field(default_factory=list, max_length=200)


class VerIn(OcultosIn):
    janela: int | None = None
    elementosMax: int = Field(default=300, ge=1, le=5000)
    comImagem: bool = False
    resolucao: tuple[int, int] = (1280, 720)
    monitor: int | None = Field(default=None, ge=0, le=16)
    marcas: Literal["grade", "elementos"] | None = None
    formato: Literal["jpeg", "png"] = "jpeg"


class PontoIn(OcultosIn):
    x: float | None = None
    y: float | None = None
    captura: str | None = Field(default=None, max_length=20)
    marca: int | None = Field(default=None, ge=1)


class ElementoIn(OcultosIn):
    leitura: str = Field(max_length=20)
    elemento: int = Field(ge=1)


class AlvoIn(BaseModel):
    leitura: str | None = Field(default=None, max_length=20)
    elemento: int | None = Field(default=None, ge=1)
    x: float | None = None
    y: float | None = None
    captura: str | None = Field(default=None, max_length=20)
    marca: int | None = Field(default=None, ge=1)


class AgirIn(OcultosIn):
    sessaoId: str | None = Field(default=None, max_length=80)
    acao: str = Field(max_length=30)
    alvo: AlvoIn | None = None
    destino: AlvoIn | None = None
    texto: str | None = Field(default=None, max_length=20000)
    tecla: str | None = Field(default=None, max_length=60)
    direcao: Literal["cima", "baixo", "esquerda", "direita", "up", "down", "left", "right"] | None = None
    quantidade: int | None = Field(default=None, ge=1, le=100)
    modificadores: str | None = Field(default=None, max_length=40)
    assinatura: str | None = Field(default=None, max_length=40)


class RegiaoIn(BaseModel):
    """Um trecho de uma captura anterior, em pixels da IMAGEM dela (o zoom do computer use)."""

    captura: str = Field(max_length=20)
    x0: float
    y0: float
    x1: float
    y1: float


class CapturarIn(OcultosIn):
    janela: int | None = None
    monitor: int | None = Field(default=None, ge=0, le=16)
    resolucao: tuple[int, int] = (1280, 720)
    formato: Literal["jpeg", "png"] = "png"
    marcas: Literal["grade"] | None = None
    regiao: RegiaoIn | None = None


class CursorIn(BaseModel):
    captura: str = Field(max_length=20)


class FrenteIn(OcultosIn):
    sessaoId: str | None = Field(default=None, max_length=80)
    janela: int = Field(ge=1)


class AbrirIn(BaseModel):
    tipo: Literal["app", "arquivo", "url"]
    alvo: str = Field(min_length=1, max_length=2000)
    sessaoId: str | None = Field(default=None, max_length=80)
    aprovada: bool = False
    raizes: list[str] = Field(default_factory=list, max_length=50)


class LixeiraIn(BaseModel):
    caminho: str = Field(min_length=1, max_length=2000)
    raizes: list[str] = Field(min_length=1, max_length=50)


class SalvarIn(BaseModel):
    pasta: str = Field(min_length=1, max_length=1000)
    nome: str = Field(min_length=1, max_length=260)
    base64: str = Field(min_length=1, max_length=120_000_000)


# ── o app ───────────────────────────────────────────────────────────────────
class Maos:
    """As peças vivas do processo. Os testes trocam o que precisarem."""

    def __init__(self, token: str, api_url: str, gui: Any = None) -> None:
        from maos.pty_sessoes import Sessoes
        from maos.terminal import Terminal

        self.token = token
        self.espelho = Espelho()
        self.terminal = Terminal()
        self.pty = Sessoes()
        self.avisos = Avisos(api_url, token)
        self.gui = gui
        self.ocultos_config: list[str] = []
        self.atalho = "Ctrl+Alt+Esc"
        self.analisador_ps = None
        self.ultimo_parar: dict | None = None
        self._isolamento: tuple[float, dict] | None = None
        self.maquina = socket.gethostname()[:120]

    def ocultos(self, pedidos: list[str] | None) -> list[str]:
        """O que o pedido manda MAIS o que a config empurrou: a lista só cresce aqui."""
        return list(dict.fromkeys([*(pedidos or []), *self.ocultos_config]))

    def parar_local(self, origem: str, avisar_api: bool) -> dict:
        """Para tudo DESTE lado, já: digitação, terminal, sessões de terminal, borda."""
        from maos.entrada import INTERRUPTOR

        comeco = time.perf_counter()
        recebido_em = time.time()
        INTERRUPTOR.cortar()
        sid = self.espelho.estado().envelope.sessao_id if self.espelho.estado().envelope else None
        self.espelho.parar(origem)
        n = self.terminal.parar_todos(f"parado ({origem})")
        p = self.pty.fechar_todas(f"parado ({origem})")
        ms = round((time.perf_counter() - comeco) * 1000, 1)
        self.ultimo_parar = {"origem": origem, "ms": ms, "terminais": n, "sessoes_pty": p, "em": time.time(), "recebido_em": recebido_em}
        log.info("maos.parado origem=%s ms=%s terminais=%s pty=%s", origem, ms, n, p)
        if avisar_api:
            self.avisos.emitir("parar", origem, "o dono mandou parar", sid)
        return self.ultimo_parar

    def pausar_local(self, motivo: str) -> None:
        from maos.entrada import INTERRUPTOR

        sid = self.espelho.pausar_local(motivo)
        if sid:
            INTERRUPTOR.cortar()
            log.info("maos.pausado motivo=%s", motivo)
            self.avisos.emitir("pausar", "mouse", motivo, sid)

    def isolamento(self, esperar: bool = False) -> dict:
        """Docker e Sandbox detectados em segundo plano: `docker info` com o Docker Desktop
        lento leva dezenas de segundos, e o /health não pode esperar por isso."""
        import threading

        from maos.isolado import motores

        agora = time.time()
        if not self._isolamento or agora - self._isolamento[0] > 120:
            if getattr(self, "_detectando", None) is None or not self._detectando.is_alive():
                def detectar():
                    self._isolamento = (time.time(), motores())

                self._detectando = threading.Thread(target=detectar, daemon=True)
                self._detectando.start()
            if esperar:
                self._detectando.join(60)
        return self._isolamento[1] if self._isolamento else {"sandbox": None, "docker": None, "verificando": True}


def criar_app(maos: Maos) -> FastAPI:
    app = FastAPI(title="ÓRBITA Mãos", docs_url=None, redoc_url=None, openapi_url=None)
    app.state.maos = maos

    @app.middleware("http")
    async def so_de_casa(request: Request, call_next):
        # 1. página web: o navegador SEMPRE manda Origin em pedido de outra origem. Nenhuma origem vale aqui.
        if request.headers.get("origin") is not None:
            return JSONResponse({"detail": "origem não permitida"}, status_code=403)
        # 2. DNS rebinding: um domínio que resolve para 127.0.0.1 chega com outro Host
        host = (request.headers.get("host") or "").rsplit(":", 1)[0].lower()
        if host not in HOSTS_LOCAIS:
            return JSONResponse({"detail": "host não permitido"}, status_code=403)
        # 3. o token, em tempo constante, em TODA rota
        if not token_confere(request.headers.get("x-orbita-maos"), maos.token):
            return JSONResponse({"detail": "não autorizado"}, status_code=401)
        return await call_next(request)

    @app.exception_handler(Recusada)
    async def _recusa(_r, e: Recusada):
        return JSONResponse({"detail": str(e), "recusada": True}, status_code=409)

    def recusar_em(fn, *a, **kw):
        """Recusa de domínio (envelope, senha, caminho) vira 409 com o motivo; o resto, 500."""
        from maos.acoes import Recusa
        from maos.entrada import Interrompido

        try:
            return fn(*a, **kw)
        except (Recusa, PermissionError, Interrompido) as e:
            raise Recusada(str(e)) from e
        except (LookupError, FileNotFoundError) as e:
            raise HTTPException(404, str(e)) from e
        except TimeoutError as e:
            # a UIA de um app grande (Electron) com a máquina carregada passa do prazo: dizer isso,
            # e não um 500 sem motivo que o modelo não sabe repassar
            raise HTTPException(504, "A leitura da tela passou do prazo (app grande ou PC sobrecarregado). Tente uma janela menor, ou a captura.") from e
        except ValueError as e:
            raise HTTPException(422, str(e)) from e

    # ── saúde e espelho ────────────────────────────────────────────────────
    @app.get("/health")
    def health() -> dict:
        from maos.dpi import dpi_por_monitor_ligado, monitores
        from maos.seguranca import integridade_do_processo, processo_elevado
        from maos.sistema import sessao_do_windows
        from maos.entrada import INTERRUPTOR
        from maos.terminal import detectar_shells

        e = maos.espelho.estado()
        gui = maos.gui
        cfg_hash = hashlib.sha1(f"{maos.atalho}|{'|'.join(maos.ocultos_config)}".encode()).hexdigest()[:12]
        return {
            "status": "ok",
            "versao": VERSAO,
            "maquina": maos.maquina,
            "sessao_windows": sessao_do_windows(),
            "integridade": integridade_do_processo(),
            "elevado": processo_elevado(),
            "dpi": {"por_monitor_v2": dpi_por_monitor_ligado()},
            "monitores": [m.para_dict() for m in monitores()],
            "shells": detectar_shells(),
            "isolamento": maos.isolamento(),
            "espelho": {"status": e.status, "sessaoId": e.envelope.sessao_id if e.envelope else None, "motivo": e.motivo},
            "atalho": {"texto": getattr(gui, "atalho_texto", maos.atalho), "registrado": bool(getattr(gui, "atalho_ok", False)), "erro": getattr(gui, "atalho_erro", None)},
            "bandeja": {"erro": getattr(gui, "erro", None) if gui else "sem interface gráfica neste processo"},
            "avisos": maos.avisos.pendentes(),
            "terminal": {"rodando": maos.terminal.rodando(), "sessoes": len([s for s in maos.pty.listar() if s["viva"]])},
            "ultimo_parar": maos.ultimo_parar,
            "ultima_injecao": INTERRUPTOR.ultima_injecao,
            "config_hash": cfg_hash,
        }

    @app.put("/envelope")
    def envelope(b: EnvelopeIn) -> dict:
        from maos.entrada import INTERRUPTOR

        if b.maquina and b.maquina.lower() != maos.maquina.lower():
            raise Recusada(f"Este envelope é para a máquina {b.maquina}, e esta é {maos.maquina}.")
        exp = b.expiraEm if b.expiraEm.tzinfo else b.expiraEm.replace(tzinfo=timezone.utc)
        maos.espelho.receber(Envelope(b.sessaoId, b.alvo, b.objetivo, b.apps, b.sites, b.tetoPassos, b.passosUsados, exp, b.maquina))
        INTERRUPTOR.rearmar()
        return {"ok": True, "status": "ativa"}

    @app.post("/envelope/fim")
    def fim(b: FimIn) -> dict:
        from maos.entrada import INTERRUPTOR

        mudou = maos.espelho.fim(b.sessaoId, b.status, b.motivo)
        if mudou:
            INTERRUPTOR.cortar()
        return {"ok": True, "mudou": mudou}

    @app.post("/parar")
    def parar(b: PararIn) -> dict:
        # quem chama é o core: não avisa o api de volta (ele já sabe, e um aviso aqui viraria laço)
        return {"ok": True, **maos.parar_local(b.origem, avisar_api=False)}

    @app.put("/config")
    def config(b: ConfigIn) -> dict:
        if b.appsOcultos is not None:
            maos.ocultos_config = [o for o in b.appsOcultos if o.strip()][:200]
        if b.atalhoParar:
            maos.atalho = b.atalhoParar
            if maos.gui:
                maos.gui.trocar_atalho(b.atalhoParar)
        return {"ok": True}

    @app.post("/avisos/confirmar")
    def confirmar(b: ConfirmarIn) -> dict:
        return {"ok": True, "confirmados": maos.avisos.confirmar(b.ids)}

    # ── terminal ───────────────────────────────────────────────────────────
    @app.post("/terminal/analisar")
    def analisar(b: AnalisarIn) -> dict:
        from maos.analisar import AnalisadorPowerShell, analisar_bash, caminhos_reais
        from maos.terminal import detectar_shells

        def com_reais(fatos: dict) -> dict:
            if b.pasta and fatos.get("parse_ok"):
                fatos["caminhos_reais"] = caminhos_reais(fatos, b.pasta)
            return fatos

        if b.shell in ("gitbash", "wsl", "bash"):
            return com_reais({**analisar_bash(b.comando), "shell": "bash"})
        shells = detectar_shells()
        exe = shells.get("pwsh") or shells.get("powershell")
        if not exe:
            return {"shell": "powershell", "parse_ok": False, "erros": ["nenhum PowerShell nesta máquina para analisar"], "comandos": [], "redirecionamentos": [], "substituicoes": [], "metodos": [], "tipos": [], "operadores": [], "atribuicoes": 0, "instrucoes": 0}
        if maos.analisador_ps is None:
            maos.analisador_ps = AnalisadorPowerShell(exe)
        comeco = time.perf_counter()
        fatos = com_reais(maos.analisador_ps.analisar(b.comando))
        return {**fatos, "ms": round((time.perf_counter() - comeco) * 1000, 1)}

    @app.post("/terminal/executar")
    def executar(b: ExecutarIn) -> dict:
        def rodar():
            if b.isolado == "sandbox":
                from maos.isolado import rodar_no_sandbox
                from maos.terminal import dentro_de
                from pathlib import Path

                if not dentro_de(Path(b.pasta).expanduser(), b.raizes):
                    raise PermissionError("A pasta está fora das pastas liberadas para o terminal.")
                return {"id": None, "terminou": True, **rodar_no_sandbox(str(Path(b.pasta).expanduser().resolve()), b.comando, b.timeoutSeg)}
            if b.isolado == "docker":
                ex = maos.terminal.executar_isolado(b.comando, b.pasta, b.raizes, b.variaveis, b.timeoutSeg, b.memoriaMb, b.saidaMax, b.imagem)
            else:
                ex = maos.terminal.executar(b.comando, b.shell, b.pasta, b.raizes, b.variaveis, b.timeoutSeg, b.memoriaMb, b.saidaMax)
            maos.terminal.esperar(ex, b.esperarSeg)
            return ex.resumo()

        try:
            return recusar_em(rodar)
        except RuntimeError as e:
            raise HTTPException(503, str(e)) from e

    @app.get("/terminal/{eid}")
    def saida(eid: str) -> dict:
        ex = maos.terminal.obter(eid)
        if not ex:
            raise HTTPException(404, "Esse comando não existe mais (as mãos reiniciaram, ou ele é muito antigo).")
        return ex.resumo()

    @app.post("/terminal/{eid}/parar")
    def parar_comando(eid: str) -> dict:
        ex = maos.terminal.parar(eid)
        if not ex:
            raise HTTPException(404, "Esse comando não existe mais.")
        maos.terminal.esperar(ex, 3)
        return ex.resumo()

    # ── sessão de terminal (A9) ────────────────────────────────────────────
    @app.get("/pty")
    def pty_listar() -> dict:
        return {"sessoes": maos.pty.listar()}

    @app.post("/pty/abrir")
    def pty_abrir(b: PtyAbrirIn) -> dict:
        def rodar():
            s = maos.pty.abrir(b.shell, b.pasta, b.raizes, b.variaveis, b.memoriaMb)
            if b.comando:
                time.sleep(0.4)
                maos.pty.escrever(s.id, b.comando, True)
            return s.resumo()

        try:
            return recusar_em(rodar)
        except RuntimeError as e:
            raise HTTPException(503, str(e)) from e

    @app.post("/pty/{sid}/escrever")
    def pty_escrever(sid: str, b: PtyEscreverIn) -> dict:
        return recusar_em(maos.pty.escrever, sid, b.texto, b.enter)

    @app.get("/pty/{sid}")
    def pty_ler(sid: str, desde: int | None = None, maximo: int = 30000) -> dict:
        s = maos.pty.obter(sid)
        if not s:
            raise HTTPException(404, "Essa sessão de terminal não existe.")
        return s.ler(desde, max(500, min(maximo, 400000)))

    @app.post("/pty/{sid}/fechar")
    def pty_fechar(sid: str) -> dict:
        if not maos.pty.fechar(sid, "fechada pela Órbita"):
            raise HTTPException(404, "Essa sessão de terminal não existe.")
        return {"ok": True}

    # ── sistema e mídia ────────────────────────────────────────────────────
    @app.get("/sistema")
    def sistema() -> dict:
        from maos.sistema import resumo_do_sistema

        return resumo_do_sistema()

    @app.get("/processos")
    def processos(nome: str) -> dict:
        from maos.sistema import procurar_processos

        return {"processos": procurar_processos(nome[:120])}

    @app.get("/processos/{pid}")
    def processo(pid: int) -> dict:
        import psutil

        from maos.sistema import descrever_processo

        try:
            return descrever_processo(pid)
        except psutil.NoSuchProcess as e:
            raise HTTPException(404, "Esse processo não existe mais.") from e
        except psutil.Error as e:
            raise HTTPException(409, f"Não consegui ler esse processo ({e}).") from e

    @app.get("/apps/nomes")
    def nomes_do_app(nome: str) -> dict:
        """Os nomes pelos quais um app casa com o envelope ("Bloco de Notas" -> notepad e apelidos):
        a tabela de apelidos é fato sobre o Windows e mora só aqui."""
        from maos.apps import nomes_com_apelidos

        return {"nomes": sorted(nomes_com_apelidos([nome[:120]]))}

    @app.post("/processos/encerrar")
    def encerrar(b: EncerrarIn) -> dict:
        from maos.sistema import encerrar as fechar
        from maos.sistema import motivo_para_nao_encerrar

        motivo = motivo_para_nao_encerrar(b.pid, b.nome, b.inicio, set())
        if motivo:
            raise Recusada(motivo)
        return fechar(b.pid, b.forcar)

    @app.post("/midia")
    def midia(b: MidiaIn) -> dict:
        from maos.midia import executar as executar_midia

        return recusar_em(executar_midia, b.acao, b.valor)

    # ── ver e agir ─────────────────────────────────────────────────────────
    @app.post("/computador/janelas")
    def janelas(b: OcultosIn) -> dict:
        from maos.uia import listar_janelas

        return {"janelas": listar_janelas(maos.ocultos(b.ocultos))}

    @app.post("/computador/ver")
    def ver(b: VerIn) -> dict:
        from maos.captura import CAPTURADOR
        from maos.uia import ler_janela

        def rodar():
            ocultos = maos.ocultos(b.ocultos)
            hwnd = b.janela
            if hwnd is None:
                from maos.win32 import user32

                hwnd = int(user32.GetForegroundWindow() or 0)
            out = ler_janela(hwnd, b.elementosMax, ocultos)
            if b.comImagem:
                out["imagem"] = CAPTURADOR.capturar(ocultos, tuple(b.resolucao), b.monitor, hwnd, b.formato, b.marcas, out["elementos"] if b.marcas == "elementos" else None)
            return out

        return recusar_em(rodar)

    @app.post("/computador/capturar")
    def capturar(b: CapturarIn) -> dict:
        from maos.captura import CAPTURADOR

        def rodar():
            ret = None
            if b.regiao:
                r = b.regiao
                l, t = CAPTURADOR.para_fisico(r.captura, min(r.x0, r.x1), min(r.y0, r.y1))
                rr, bb = CAPTURADOR.para_fisico(r.captura, max(r.x0, r.x1), max(r.y0, r.y1))
                if rr - l < 8 or bb - t < 8:
                    raise ValueError("O trecho do zoom é pequeno demais.")
                ret = (l, t, rr, bb)
            return CAPTURADOR.capturar(maos.ocultos(b.ocultos), tuple(b.resolucao), b.monitor, None if ret else b.janela, b.formato, b.marcas, None, ret)

        return recusar_em(rodar)

    @app.post("/computador/cursor")
    def cursor(b: CursorIn) -> dict:
        """Onde está o cursor, no espaço da imagem de uma captura (o `cursor_position` do computer use)."""
        from maos.captura import CAPTURADOR
        from maos.entrada import posicao_do_cursor

        def rodar():
            px, py = posicao_do_cursor()
            x, y = CAPTURADOR.para_imagem(b.captura, px, py)
            cap = CAPTURADOR.captura(b.captura)
            dentro = bool(cap and 0 <= x < cap.largura and 0 <= y < cap.altura)
            return {"x": x, "y": y, "captura": b.captura, "dentro_da_imagem": dentro}

        return recusar_em(rodar)

    @app.post("/computador/no-ponto")
    def no_ponto(b: PontoIn) -> dict:
        from maos.captura import CAPTURADOR
        from maos.uia import descrever_no_ponto

        def rodar():
            if b.captura and b.marca is not None:
                x, y = CAPTURADOR.marca(b.captura, b.marca)
            elif b.x is None or b.y is None:
                raise ValueError("Diga o ponto (x, y) ou a marca da captura.")
            else:
                x, y = CAPTURADOR.para_fisico(b.captura, b.x, b.y) if b.captura else (int(b.x), int(b.y))
            return {**descrever_no_ponto(x, y, maos.ocultos(b.ocultos)), "ponto": [x, y]}

        return recusar_em(rodar)

    @app.post("/computador/focado")
    def focado(b: OcultosIn) -> dict:
        from maos.uia import elemento_focado, publico

        def rodar():
            d = elemento_focado(maos.ocultos(b.ocultos))
            if not d:
                raise LookupError("Nenhum elemento tem o foco agora.")
            return publico(d)

        return recusar_em(rodar)

    @app.post("/computador/elemento")
    def elemento(b: ElementoIn) -> dict:
        from maos.uia import centro, descrever_no_ponto, do_cache

        def rodar():
            c = do_cache(b.leitura, b.elemento)
            if not c:
                raise LookupError("Essa leitura da tela expirou ou o elemento não existe nela: veja a janela de novo.")
            x, y = centro(c["rect"])
            agora = descrever_no_ponto(x, y, maos.ocultos(b.ocultos))
            from maos.uia import PAPEIS

            # o que foi LIDO (papel, nome, assinatura) é o que vai para o crítico e para a proposta
            return {**agora, "papel": PAPEIS.get(c["tipo"], "outro"), "nome": c["nome"], "assinatura": c["assinatura"], "senha": c["senha"] or agora["senha"], "ponto": [x, y]}

        return recusar_em(rodar)

    @app.post("/computador/agir")
    def agir(b: AgirIn) -> dict:
        from maos.acoes import agir as executar_acao

        ordem = b.model_dump()
        ordem["alvo"] = b.alvo.model_dump() if b.alvo else None
        ordem["destino"] = b.destino.model_dump() if b.destino else None
        return recusar_em(executar_acao, ordem, maos.espelho, maos.ocultos(b.ocultos))

    @app.post("/computador/janela/frente")
    def janela_frente(b: FrenteIn) -> dict:
        """Traz para a frente uma janela do envelope. Sem isto, janela aberta ATRÁS da que o dono
        usa nunca recebia ação: o alvo é descrito pelo ponto, e o ponto caía na janela de cima."""
        from maos.acoes import Recusa, _trazer_para_frente
        from maos.uia import info_da_janela
        from maos.win32 import user32

        def rodar():
            if not user32.IsWindow(b.janela):
                raise LookupError("Essa janela não existe mais: veja as janelas de novo.")
            info = info_da_janela(b.janela, maos.ocultos(b.ocultos))
            if info["oculta"]:
                raise Recusa("Esta janela é de um app oculto pela configuração: a Órbita não age nela.")
            if info["elevada"]:
                raise Recusa("Esta janela roda como administrador: a Órbita nunca age em janela elevada.")
            motivo = maos.espelho.conferir(b.sessaoId, info["nomes"])
            if motivo:
                raise Recusa(motivo)
            _trazer_para_frente(b.janela)
            return {"ok": True, "janela": b.janela, "app": info["app"], "em_foco": int(user32.GetForegroundWindow() or 0) == b.janela}

        return recusar_em(rodar)

    @app.post("/computador/abrir")
    def abrir(b: AbrirIn) -> dict:
        from maos import arquivos as arq
        from maos.apps import APELIDOS, normalizar_app

        def rodar():
            if not b.aprovada:
                # sem a aprovação do dono, abrir só vale dentro da sessão e (para app) dentro do envelope
                nomes = None
                if b.tipo == "app":
                    n = normalizar_app(b.alvo)
                    nomes = [n, *next((v for k, v in APELIDOS.items() if n == k or n in v), ())]
                    nomes += [k for k, v in APELIDOS.items() if n in v]
                motivo = maos.espelho.conferir(b.sessaoId, nomes)
                if motivo:
                    raise PermissionError(motivo)
            if b.tipo == "app":
                return arq.abrir_app(b.alvo)
            if b.tipo == "url":
                return arq.abrir_url(b.alvo)
            return arq.abrir_arquivo(b.alvo, b.raizes)

        return recusar_em(rodar)

    # ── arquivos ───────────────────────────────────────────────────────────
    @app.post("/arquivos/lixeira")
    def lixeira(b: LixeiraIn) -> dict:
        from maos.arquivos import para_lixeira

        return recusar_em(para_lixeira, b.caminho, b.raizes)

    @app.post("/arquivos/salvar")
    def salvar(b: SalvarIn) -> dict:
        import base64 as b64

        from maos.arquivos import salvar as gravar

        try:
            dados = b64.b64decode(b.base64, validate=True)
        except ValueError as e:
            raise HTTPException(422, "conteúdo em base64 inválido") from e
        return recusar_em(gravar, b.pasta, b.nome, dados)

    @app.get("/isolamento")
    def isolamento() -> dict:
        return maos.isolamento()

    return app


__all__ = ["criar_app", "Maos", "Recusada"]
