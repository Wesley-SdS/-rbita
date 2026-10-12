"""As ações que as mãos aceitam são as que o core manda (G6 da auditoria de 11/10/2026).

"mover", "botao_descer" e "botao_subir" existiam aqui sem o core nunca mandá-las
(o toolset do Claude as desliga por não terem alvo único para o risco). Ação
que ninguém manda é só porta aberta: foram removidas, e este teste trava a
lista nas duas pontas.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from maos import acoes, entrada
from maos.envelope import Espelho

RISCO_DO_CORE = Path(__file__).resolve().parents[3] / "packages" / "core" / "src" / "computador" / "risco.ts"


def test_mesma_lista_do_core():
    fonte = RISCO_DO_CORE.read_text(encoding="utf-8")
    m = re.search(r"ACOES_DO_COMPUTADOR = \[([^\]]*)\]", fonte)
    assert m, "ACOES_DO_COMPUTADOR sumiu do core: atualize este teste"
    do_core = set(re.findall(r'"([a-z_]+)"', m.group(1)))
    assert acoes.ACOES == do_core


@pytest.mark.parametrize("acao", ["mover", "botao_descer", "botao_subir", "apagar_tudo", None])
def test_acao_que_o_core_nao_manda_e_recusada_antes_de_tudo(acao):
    # nem o espelho do envelope chega a ser consultado: a recusa vem antes de olhar a tela
    with pytest.raises(acoes.Recusa, match="Ação desconhecida"):
        acoes.agir({"acao": acao, "alvo": {"x": 10, "y": 10}}, Espelho(), [])


def test_entrada_sem_mover_nem_segurar_botao():
    assert not hasattr(entrada, "mover")
    assert not hasattr(entrada, "botao")
