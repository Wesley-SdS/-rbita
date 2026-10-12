"""Configuração do processo: token, porta e endereço do apps/api.

O token NÃO tem padrão: sem `MAOS_TOKEN`, o serviço recusa subir (PRD §5.2,
ao contrário do `PERCEPTION_TOKEN`, que é opcional). Ele vem do ambiente ou,
quando a tarefa de logon sobe o `pythonw` sem o ambiente do terminal, do
`.env` da RAIZ do repositório, que é o mesmo arquivo que o apps/api lê.

Do `.env` só se lê o que este processo precisa (token, porta, URL do api):
o resto (segredos da Órbita) nunca entra no `os.environ` daqui, e por isso
não tem como vazar para um comando filho.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[3]
ENV_DA_RAIZ = RAIZ / ".env"
CHAVES_LIDAS = ("MAOS_TOKEN", "MAOS_PORTA", "ORBITA_API_URL")


def ler_env(caminho: Path = ENV_DA_RAIZ) -> dict[str, str]:
    """Só as chaves de `CHAVES_LIDAS`, do jeito que o dotenv do api lê."""
    out: dict[str, str] = {}
    try:
        texto = caminho.read_text(encoding="utf-8-sig")
    except OSError:
        return out
    for linha in texto.splitlines():
        linha = linha.strip()
        if not linha or linha.startswith("#") or "=" not in linha:
            continue
        chave, valor = linha.split("=", 1)
        chave = chave.strip().removeprefix("export ").strip()
        if chave not in CHAVES_LIDAS:
            continue
        valor = valor.strip()
        if len(valor) >= 2 and valor[0] == valor[-1] and valor[0] in "\"'":
            valor = valor[1:-1]
        out[chave] = valor
    return out


@dataclass(frozen=True)
class Config:
    token: str
    porta: int
    api_url: str


def carregar(env: dict[str, str] | None = None, arquivo: dict[str, str] | None = None) -> Config:
    """Ambiente vence o arquivo. Token vazio é o mesmo que ausente."""
    env = dict(os.environ) if env is None else env
    arquivo = ler_env() if arquivo is None else arquivo
    pegar = lambda k, d="": (env.get(k) or arquivo.get(k) or d).strip()  # noqa: E731
    token = pegar("MAOS_TOKEN")
    porta = int(pegar("MAOS_PORTA", "8003") or "8003")
    api = pegar("ORBITA_API_URL", "http://127.0.0.1:3010").rstrip("/")
    return Config(token=token, porta=porta, api_url=api)
