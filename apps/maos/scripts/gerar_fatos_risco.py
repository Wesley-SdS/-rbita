"""Gera os FATOS reais dos casos de risco para o teste do core.

O classificador (`packages/core/src/terminal/risco.ts`) é testado com os
fatos que o parser DE VERDADE produz, não com fatos escritos à mão: assim o
teste prova o par inteiro (AST do PowerShell ou tree-sitter do bash + regra).
O `tests/test_analisar.py` reprova se este arquivo ficar velho.

    .venv/Scripts/python.exe scripts/gerar_fatos_risco.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

RAIZ = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(RAIZ))

from maos.analisar import AnalisadorPowerShell, analisar_bash  # noqa: E402
from maos.terminal import detectar_shells  # noqa: E402

CASOS = RAIZ / "tests" / "casos_risco.json"
SAIDA = RAIZ.parents[1] / "packages" / "core" / "src" / "terminal" / "__fixtures__" / "fatos-risco.json"


def juntar_reais(fatos: dict, caso: dict) -> None:
    """O caminho REAL depende do disco de quem roda: o caso que precisa dele (link,
    junção, relativo que cai no .env) traz os `reais` escritos no próprio caso, e
    eles entram nos fatos como as mãos os mandariam. Quem resolve de verdade é
    `maos.analisar.caminhos_reais`, testado no disco em `tests/test_analisar.py`."""
    if "reais" in caso:
        fatos["caminhos_reais"] = caso["reais"]


def fatos_de_todos() -> list[dict]:
    casos = json.loads(CASOS.read_text(encoding="utf-8"))
    sh = detectar_shells()
    # prazo folgado: com a máquina ocupada, a subida do PowerShell passava dos 8 s e os primeiros casos
    # saíam como "parse falho" na fixture (gerar não tem pressa; o prazo curto é do serviço)
    ps = AnalisadorPowerShell(sh.get("pwsh") or sh["powershell"], prazo_seg=90)
    out = []
    try:
        for c in casos:
            f = ps.analisar(c["comando"]) if c["shell"] == "powershell" else analisar_bash(c["comando"])
            f.pop("ms", None)
            # mensagens de erro do parser vêm no idioma do Windows: o teste só precisa saber que houve erro
            f["erros"] = ["erro de sintaxe"] if f.get("erros") else []
            juntar_reais(f, c)
            out.append({**c, "fatos": f})
    finally:
        ps.fechar()
    return out


def main() -> int:
    dados = fatos_de_todos()
    SAIDA.parent.mkdir(parents=True, exist_ok=True)
    SAIDA.write_bytes((json.dumps(dados, ensure_ascii=False, indent=1, sort_keys=True) + "\n").encode("utf-8"))
    print(f"{len(dados)} casos -> {SAIDA}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
