"""O caminho REAL dos argumentos (G1 da auditoria de 11/10/2026), no disco de verdade.

O core compara os argumentos do comando com `arquivos.negados` pelo texto; aqui
se prova que as mãos devolvem o arquivo que vai ser lido DE FATO: o `.env` por
trás de uma junção, de um link, do nome curto 8.3, de um curinga e de um fluxo
do NTFS. Tudo numa pasta temporária: nada fora dela é tocado.
"""

from __future__ import annotations

import ctypes
import os
import time
from pathlib import Path

import _winapi
import pytest

from maos.analisar import analisar_bash, caminhos_reais


def _fatos(*args: str, entrada: str | None = None) -> dict:
    return {
        "comandos": [{"nome": "Get-Content", "args": list(args)}],
        "redirecionamentos": [{"tipo": "entrada", "alvo": entrada}] if entrada else [],
    }


@pytest.fixture()
def disco(tmp_path: Path):
    raiz = tmp_path / "projeto"
    fora = tmp_path / "fora"
    (raiz / "docs").mkdir(parents=True)
    fora.mkdir()
    (raiz / ".env").write_text("SEGREDO=nao-pode-sair\n", encoding="utf-8")
    (raiz / "README.md").write_text("oi\n", encoding="utf-8")
    (fora / "segredos.txt").write_text("fora\n", encoding="utf-8")
    # junção não precisa de administrador (link simbólico de arquivo precisa, ou do modo de desenvolvedor)
    _winapi.CreateJunction(str(fora), str(raiz / "atalho"))
    return raiz, fora


def _reais(fatos: dict, pasta: Path) -> dict[str, str]:
    return {r["arg"]: os.path.normcase(r["real"]) for r in caminhos_reais(fatos, str(pasta))}


def test_relativo_e_dotdot_viram_o_env(disco):
    raiz, _ = disco
    env = os.path.normcase(str(raiz / ".env"))
    r = _reais(_fatos(".env", "docs\\..\\.env", ".\\docs\\..\\.env"), raiz)
    assert r == {".env": env, "docs\\..\\.env": env, ".\\docs\\..\\.env": env}


def test_juncao_aponta_para_fora(disco):
    raiz, fora = disco
    r = _reais(_fatos("atalho\\segredos.txt"), raiz)
    assert r["atalho\\segredos.txt"] == os.path.normcase(str(fora / "segredos.txt"))


def test_link_simbolico_de_nome_inocente(disco):
    raiz, _ = disco
    try:
        os.symlink(raiz / ".env", raiz / "notas")
    except OSError:
        pytest.skip("criar link simbólico de arquivo pede administrador ou o modo de desenvolvedor nesta máquina")
    assert _reais(_fatos("notas"), raiz)["notas"] == os.path.normcase(str(raiz / ".env"))


def test_curinga_expande_e_acha_o_env_escondido(disco):
    raiz, _ = disco
    env = os.path.normcase(str(raiz / ".env"))
    for curinga in (".en*", "*env", ".en?", "[.]env"):
        reais = [os.path.normcase(x["real"]) for x in caminhos_reais(_fatos(curinga), str(raiz))]
        assert env in reais, curinga


def test_fluxo_do_ntfs_e_o_proprio_arquivo(disco):
    raiz, _ = disco
    env = os.path.normcase(str(raiz / ".env"))
    r = _reais(_fatos(".env::$DATA", ".env:oculto", "-Path:.env"), raiz)
    assert r == {".env::$DATA": env, ".env:oculto": env, "-Path:.env": env}


def test_nome_curto_8_3(disco):
    raiz, _ = disco
    longo = str(raiz / ".env")
    buf = ctypes.create_unicode_buffer(600)
    n = ctypes.windll.kernel32.GetShortPathNameW(longo, buf, 600)
    curto = buf.value if n else ""
    if not curto or os.path.basename(curto).lower() == ".env":
        pytest.skip("este volume não gera nome curto 8.3 (fsutil 8dot3name): o caso fica coberto pelo texto no core")
    nome_curto = os.path.basename(curto)
    assert _reais(_fatos(nome_curto), raiz)[nome_curto] == os.path.normcase(longo)


def test_redirecionamento_de_entrada_tambem(disco):
    raiz, _ = disco
    fatos = analisar_bash("cat < .env")
    assert _reais(fatos, raiz) == {".env": os.path.normcase(str(raiz / ".env"))}


def test_o_que_nao_existe_rede_e_opcao_ficam_de_fora(disco):
    raiz, _ = disco
    comeco = time.perf_counter()
    r = _reais(_fatos("nao-existe.txt", "\\\\servidor-que-nao-existe\\c$\\x", "\\\\?\\C:\\x", "-Raw", "HEAD~1"), raiz)
    # caminho de rede não é resolvido (poderia travar esperando o servidor): o core já o sobe para perigoso
    assert r == {}
    assert time.perf_counter() - comeco < 2


def test_til_e_variavel_da_pasta_do_usuario(tmp_path: Path):
    casa = tmp_path / "casa"
    casa.mkdir()
    (casa / ".env").write_text("x=1\n", encoding="utf-8")
    env = os.path.normcase(str(casa / ".env"))
    fatos = _fatos("~/.env", "$env:USERPROFILE\\.env", "%USERPROFILE%\\.env")
    reais = {r["arg"]: os.path.normcase(r["real"]) for r in caminhos_reais(fatos, str(tmp_path), home=str(casa))}
    assert reais == {"~/.env": env, "$env:USERPROFILE\\.env": env, "%USERPROFILE%\\.env": env}


def test_rota_analisar_devolve_os_reais_com_a_pasta(cliente, cab, disco):
    raiz, fora = disco
    r = cliente.post("/terminal/analisar", headers=cab, json={"comando": "cat atalho/segredos.txt", "shell": "gitbash", "pasta": str(raiz)})
    assert r.status_code == 200
    reais = r.json()["caminhos_reais"]
    assert [os.path.normcase(x["real"]) for x in reais] == [os.path.normcase(str(fora / "segredos.txt"))]
    # sem a pasta, os fatos são só do parser (é assim que a fixture do core é gerada)
    sem = cliente.post("/terminal/analisar", headers=cab, json={"comando": "cat atalho/segredos.txt", "shell": "gitbash"})
    assert "caminhos_reais" not in sem.json()
