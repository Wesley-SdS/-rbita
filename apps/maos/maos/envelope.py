"""O ESPELHO do envelope (PRD §5.4 e F2), do lado das mãos.

O core avisa cada mudança de sessão (`PUT /envelope`, `POST /envelope/fim`,
`POST /parar`). Daqui saem as recusas que NÃO dependem do api estar certo:

  - sem envelope ativo, nenhuma ordem de tela (clicar, digitar, abrir);
  - ordem de outra sessão, ou de app fora do envelope, é recusada;
  - depois de `fim` ou de `parar`, tudo daquela sessão é recusado; depois de
    `parar`, até chegar um envelope NOVO;
  - o tempo do envelope é conferido pelo relógio daqui também.

Quem muda o estado chama os ouvintes (borda na tela, ícone, gancho do mouse)
FORA do lock: um ouvinte lento não pode segurar a próxima ordem.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Callable

from .apps import app_no_envelope


@dataclass
class Envelope:
    sessao_id: str
    alvo: str
    objetivo: str
    apps: list[str]
    sites: list[str]
    teto_passos: int
    passos_usados: int
    expira_em: datetime
    maquina: str


@dataclass
class EstadoDoEspelho:
    """`livre`: nunca houve sessão; `ativa`; `fim`: a sessão saiu de ativa; `parado`: o dono mandou parar."""

    status: str = "livre"
    envelope: Envelope | None = None
    motivo: str | None = None
    desde: float = field(default_factory=time.time)


class Espelho:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self._e = EstadoDoEspelho()
        self._ouvintes: list[Callable[[EstadoDoEspelho], None]] = []

    def ouvir(self, fn: Callable[[EstadoDoEspelho], None]) -> None:
        self._ouvintes.append(fn)

    def _avisar(self) -> None:
        estado = self.estado()
        for fn in list(self._ouvintes):
            try:
                fn(estado)
            except Exception:  # noqa: BLE001 - ouvinte com defeito não derruba o espelho
                pass

    def estado(self) -> EstadoDoEspelho:
        with self._lock:
            e = self._e
            return EstadoDoEspelho(status=e.status, envelope=e.envelope, motivo=e.motivo, desde=e.desde)

    def receber(self, env: Envelope) -> None:
        with self._lock:
            self._e = EstadoDoEspelho(status="ativa", envelope=env, motivo=None)
        self._avisar()

    def fim(self, sessao_id: str, status: str, motivo: str) -> bool:
        """Só a sessão espelhada sai de ativa; um `fim` atrasado de outra não apaga a atual."""
        with self._lock:
            e = self._e
            if not e.envelope or e.envelope.sessao_id != sessao_id or e.status != "ativa":
                return False
            self._e = EstadoDoEspelho(status="fim", envelope=e.envelope, motivo=f"{status}: {motivo}")
        self._avisar()
        return True

    def parar(self, origem: str) -> None:
        with self._lock:
            self._e = EstadoDoEspelho(status="parado", envelope=self._e.envelope, motivo=f"parado ({origem})")
        self._avisar()

    def pausar_local(self, motivo: str) -> str | None:
        """O dono mexeu no mouse: a sessão ativa sai de ativa AQUI na hora; o core é avisado depois."""
        with self._lock:
            e = self._e
            if e.status != "ativa" or not e.envelope:
                return None
            sid = e.envelope.sessao_id
            self._e = EstadoDoEspelho(status="fim", envelope=e.envelope, motivo=f"pausada: {motivo}")
        self._avisar()
        return sid

    def ativo(self) -> bool:
        e = self.estado()
        return e.status == "ativa" and e.envelope is not None and e.envelope.expira_em > datetime.now(timezone.utc)

    def conferir(self, sessao_id: str | None, nomes_do_app: list[str] | None) -> str | None:
        """None quando a ordem cabe; senão, o motivo da recusa (em pt-BR, para o modelo repassar)."""
        e = self.estado()
        if e.status == "parado":
            return "A Órbita foi parada. Só volta a agir com uma sessão nova aprovada."
        if e.status != "ativa" or not e.envelope:
            return "Não há sessão de controle ativa nas mãos do Windows."
        env = e.envelope
        if not sessao_id or sessao_id != env.sessao_id:
            return "A ordem é de uma sessão que não é a ativa."
        if env.expira_em <= datetime.now(timezone.utc):
            return "O tempo da sessão acabou."
        if nomes_do_app is not None and not app_no_envelope(nomes_do_app, env.apps):
            return f"O app desta janela não está no envelope aprovado ({', '.join(env.apps) or 'nenhum app'})."
        return None
