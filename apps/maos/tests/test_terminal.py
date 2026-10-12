"""Terminal avulso (PRD A2): Job Object, ambiente minimo, pasta liberada e a arvore morrendo junto."""

from __future__ import annotations

import os
import subprocess
import sys
import time
from pathlib import Path

import psutil
import pytest

from maos.jobobj import Job
from maos.terminal import Saida, Terminal, ambiente_minimo, detectar_shells, linha_de_comando

SEGREDOS = {"BETTER_AUTH_SECRET": "segredo-do-better-auth-123", "CONNECTORS_ENC_KEY": "chave-dos-conectores-456", "MAOS_TOKEN": "token-das-maos-789"}


def test_ambiente_minimo_nunca_leva_segredo_mesmo_listado():
    origem = {"PATH": "C:\\x", "SystemRoot": "C:\\Windows", "TEMP": "C:\\t", **SEGREDOS, "GITHUB_TOKEN": "ghp_x", "MY_API_KEY": "k"}
    env = ambiente_minimo(["PATH", "TEMP", "BETTER_AUTH_SECRET", "CONNECTORS_ENC_KEY", "GITHUB_TOKEN", "MY_API_KEY", "MAOS_TOKEN"], origem)
    assert env == {"PATH": "C:\\x", "SystemRoot": "C:\\Windows", "TEMP": "C:\\t"}


def test_ambiente_minimo_casa_nome_sem_caixa():
    assert ambiente_minimo(["path"], {"Path": "C:\\y", "SYSTEMROOT": "C:\\W"}) == {"Path": "C:\\y", "SYSTEMROOT": "C:\\W"}


def test_saida_guarda_cabeca_e_cauda():
    s = Saida(200)
    s.acrescentar("a" * 150)
    s.acrescentar("b" * 500)
    t = s.texto()
    assert t.startswith("a" * 100)
    assert t.endswith("b" * 100)
    assert "450 caracteres omitidos" in t


def _shell():
    sh = detectar_shells()
    nome = "pwsh" if "pwsh" in sh else "powershell"
    if nome not in sh:
        pytest.skip("sem PowerShell nesta maquina")
    return nome


@pytest.fixture()
def pasta(tmp_path: Path):
    return tmp_path


def test_filho_nao_herda_os_segredos_do_processo(monkeypatch, pasta):
    for k, v in SEGREDOS.items():
        monkeypatch.setenv(k, v)
    t = Terminal()
    ex = t.executar("Get-ChildItem env: | ForEach-Object { $_.Name + '=' + $_.Value }", _shell(), str(pasta), [str(pasta)], ["PATH", "TEMP", "BETTER_AUTH_SECRET", "CONNECTORS_ENC_KEY"], 60, 512, 30000)
    assert t.esperar(ex, 60)
    r = ex.resumo()
    assert r["status"] == "terminou" and r["codigo"] == 0, r
    for k, v in SEGREDOS.items():
        assert k not in r["saida"], f"{k} chegou ao filho"
        assert v not in r["saida"]
    assert "PATH=" in r["saida"].upper()


def test_pasta_fora_das_raizes_recusada(tmp_path: Path):
    dentro = tmp_path / "liberada"
    dentro.mkdir()
    with pytest.raises(PermissionError):
        Terminal().executar("Get-Date", _shell(), str(tmp_path), [str(dentro)], [], 10, 256, 1000)


def test_dois_pontos_nao_escapam_da_raiz(tmp_path: Path):
    dentro = tmp_path / "liberada"
    dentro.mkdir()
    with pytest.raises(PermissionError):
        Terminal().executar("Get-Date", _shell(), str(dentro / ".."), [str(dentro)], [], 10, 256, 1000)


def test_codigo_de_saida_confiavel(pasta):
    t = Terminal()
    ex = t.executar("Write-Output oi; exit 7", _shell(), str(pasta), [str(pasta)], ["PATH"], 30, 256, 1000)
    t.esperar(ex, 30)
    r = ex.resumo()
    assert r["codigo"] == 7 and "oi" in r["saida"]
    ex2 = t.executar("Get-Item C:\\nao\\existe\\mesmo", _shell(), str(pasta), [str(pasta)], ["PATH"], 30, 256, 2000)
    t.esperar(ex2, 30)
    assert ex2.resumo()["codigo"] != 0


def test_tempo_esgotado_mata(pasta):
    t = Terminal()
    ex = t.executar("Start-Sleep -Seconds 30", _shell(), str(pasta), [str(pasta)], ["PATH"], 2, 256, 1000)
    t.esperar(ex, 20)
    r = ex.resumo()
    assert r["status"] == "tempo_esgotado"
    assert r["duracaoMs"] < 15000


def test_parar_mata_a_arvore_inteira(pasta):
    # o comando abre um NETO (outro python dormindo); parar tem de levar os dois
    t = Terminal()
    script = pasta / "neto.py"
    script.write_text("import time\ntime.sleep(60)\n", encoding="utf-8")
    cmd = f"$p = Start-Process -PassThru -NoNewWindow -FilePath '{sys.executable}' -ArgumentList '{script}'; Write-Output \"NETO=$($p.Id)\"; Start-Sleep -Seconds 60"
    ex = t.executar(cmd, _shell(), str(pasta), [str(pasta)], ["PATH", "TEMP"], 120, 1024, 5000)
    neto = None
    for _ in range(100):
        txt = ex.saida.texto()
        if "NETO=" in txt:
            neto = int(txt.split("NETO=")[1].split()[0])
            break
        time.sleep(0.1)
    assert neto, ex.resumo()
    assert psutil.pid_exists(neto)
    comeco = time.perf_counter()
    t.parar(ex.id)
    t.esperar(ex, 10)
    for _ in range(50):
        if not psutil.pid_exists(neto):
            break
        time.sleep(0.1)
    assert not psutil.pid_exists(neto), "o neto escapou do Job Object"
    assert ex.resumo()["status"] == "parado"
    assert time.perf_counter() - comeco < 5


def test_fechar_o_job_mata_quem_sobrou():
    # KILL_ON_JOB_CLOSE: e o que garante que matar as maos mata os filhos
    j = Job(256)
    p = j.iniciar([sys.executable, "-c", "import time; time.sleep(60)"], cwd=os.getcwd(), env=dict(os.environ), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    assert psutil.pid_exists(p.pid)
    assert j.processos_vivos() == 1
    j.fechar()
    p.wait(10)
    assert not psutil.pid_exists(p.pid) or psutil.Process(p.pid).status() == psutil.STATUS_ZOMBIE


def test_morrer_as_maos_mata_os_filhos(tmp_path: Path):
    # um processo "maos" de mentira cria o job, roda um filho e morre de forma bruta
    sinal = tmp_path / "pid.txt"
    raiz = Path(__file__).resolve().parents[1]
    codigo = (
        "import sys, os, subprocess, time; sys.path.insert(0, r'%s');"
        "from maos.jobobj import Job; j = Job(256);"
        "p = j.iniciar([sys.executable, '-c', 'import time; time.sleep(60)'], cwd=os.getcwd(), env=dict(os.environ), stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL);"
        "open(r'%s', 'w').write(str(p.pid)); time.sleep(60)"
    ) % (raiz, sinal)
    pai = subprocess.Popen([sys.executable, "-c", codigo])
    for _ in range(100):
        if sinal.exists() and sinal.read_text().strip():
            break
        time.sleep(0.1)
    filho = int(sinal.read_text())
    assert psutil.pid_exists(filho)
    pai.kill()  # TerminateProcess: nada de limpeza do lado dele
    pai.wait(10)
    for _ in range(50):
        if not psutil.pid_exists(filho):
            break
        time.sleep(0.1)
    assert not psutil.pid_exists(filho), "o filho sobreviveu as maos"


def test_linha_de_comando_do_powershell_usa_encoded_so_como_transporte():
    args = linha_de_comando("powershell", "powershell.exe", "Write-Output 'a\"b'")
    assert args[:4] == ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive"]
    assert args[4] == "-EncodedCommand"
    assert linha_de_comando("gitbash", "bash.exe", "ls")[-2:] == ["-c", "ls"]
