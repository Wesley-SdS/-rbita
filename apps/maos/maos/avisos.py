"""Avisos das mãos para o api: "o dono apertou o atalho", "o dono mexeu no mouse".

O parar e a pausa JÁ ACONTECERAM do lado de cá quando isto roda: o aviso é
para o core parar as sessões no banco, cancelar as propostas da fila e emitir
o evento (`POST /api/maos/aviso`, com o mesmo token). Se o api estiver fora
(reiniciando pelo `tsx watch`), o aviso fica na fila e sai pelo `/health`,
que o laço `maos` do api lê a cada volta e confirma (`POST /avisos/confirmar`).
Nenhum aviso se perde, e nenhum é repetido depois de confirmado.
"""

from __future__ import annotations

import json
import logging
import threading
import time
import urllib.request
import uuid

log = logging.getLogger("maos.avisos")
# sem proxy: o api é desta máquina, e um proxy do sistema não pode ver o token
_SEM_PROXY = urllib.request.build_opener(urllib.request.ProxyHandler({}))


class Avisos:
    def __init__(self, api_url: str, token: str) -> None:
        self.api_url = api_url.rstrip("/")
        self.token = token
        self._lock = threading.Lock()
        self._pendentes: list[dict] = []

    def emitir(self, tipo: str, origem: str, motivo: str = "", sessao_id: str | None = None) -> dict:
        aviso = {"id": uuid.uuid4().hex, "tipo": tipo, "origem": origem, "motivo": motivo, "sessaoId": sessao_id, "em": time.time()}
        with self._lock:
            self._pendentes.append(aviso)
            self._pendentes = self._pendentes[-50:]
        threading.Thread(target=self._enviar, args=(aviso,), daemon=True).start()
        return aviso

    def _enviar(self, aviso: dict) -> None:
        corpo = json.dumps(aviso).encode("utf-8")
        req = urllib.request.Request(self.api_url + "/api/maos/aviso", data=corpo, method="POST", headers={"content-type": "application/json", "x-orbita-maos": self.token})
        try:
            with _SEM_PROXY.open(req, timeout=5) as r:
                if 200 <= r.status < 300:
                    self.confirmar([aviso["id"]])
        except Exception as e:  # noqa: BLE001 - api fora: fica pendente para o laço buscar
            log.warning("avisos.envio_falhou tipo=%s erro=%s", aviso["tipo"], e)

    def pendentes(self) -> list[dict]:
        with self._lock:
            return list(self._pendentes)

    def confirmar(self, ids: list[str]) -> int:
        with self._lock:
            antes = len(self._pendentes)
            self._pendentes = [a for a in self._pendentes if a["id"] not in set(ids)]
            return antes - len(self._pendentes)
