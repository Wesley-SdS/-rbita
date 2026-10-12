"""Modo ISOLADO (PRD A10): Docker sem rede e só leitura, Windows Sandbox por `.wsb`.

Nada aqui chama o Docker nem o Windows Sandbox de verdade: o Sandbox não está
instalado nesta máquina e o `docker info` chega a levar minutos com o Docker
Desktop lento. O que se prova é o que as mãos MANDAM rodar (os argumentos do
`docker run`, o `.wsb`), o que fazem com a resposta (saída e código por
arquivo) e o que fecham no fim: só a Área Restrita que elas abriram (G5).
"""

from __future__ import annotations

import subprocess
import time
import xml.etree.ElementTree as ET
from pathlib import Path

import pytest

from maos import isolado


def test_args_docker_sem_rede_so_leitura_sem_capacidades():
    a = isolado.args_docker("docker.exe", "orbita-x", r"C:\proj", r"C:\saida", "python:3.12-slim", "python x.py", 512)
    assert a[:2] == ["docker.exe", "run"]
    juntos = " ".join(a)
    for trava in ("--network none", "--read-only", "--cap-drop ALL", "--security-opt no-new-privileges", "--pids-limit 256", "--memory 512m", "--rm"):
        assert trava in juntos, trava
    # a pasta do comando entra SÓ para leitura; só /saida é gravável
    assert r"type=bind,source=C:\proj,target=/trabalho,readonly" in a
    assert r"type=bind,source=C:\saida,target=/saida" in a
    # o comando vai como UM argumento do sh -c (não é remontado em texto de shell do Windows)
    assert a[-3:] == ["sh", "-c", "python x.py"]
    assert a[a.index("--name") + 1] == "orbita-x"


def test_config_wsb_rede_desligada_e_pasta_so_leitura():
    xml = isolado.config_wsb(r"C:\proj", r"C:\saida\abc", 'echo "oi" & del x > y < z')
    raiz = ET.fromstring(xml)  # XML válido mesmo com & < > " no comando
    assert raiz.findtext("Networking") == "Disable"
    assert raiz.findtext("ClipboardRedirection") == "Disable"
    pastas = {m.findtext("SandboxFolder"): (m.findtext("HostFolder"), m.findtext("ReadOnly")) for m in raiz.iter("MappedFolder")}
    assert pastas == {r"C:\trabalho": (r"C:\proj", "true"), r"C:\saida": (r"C:\saida\abc", "false")}
    cmd = raiz.findtext("LogonCommand/Command")
    # o comando chega inteiro ao cmd do Sandbox, e a saída e o código voltam por arquivo
    assert 'echo "oi" & del x > y < z' in cmd
    assert r"> C:\saida\saida.txt 2>&1" in cmd and r"C:\saida\codigo.txt" in cmd


def test_escolher_nunca_troca_em_silencio(monkeypatch):
    monkeypatch.setattr(isolado, "motores", lambda: {"sandbox": False, "docker": True})
    assert isolado.escolher("auto") == "docker"
    assert isolado.escolher("docker") == "docker"
    with pytest.raises(RuntimeError, match="Windows Sandbox não está instalado"):
        isolado.escolher("sandbox")
    monkeypatch.setattr(isolado, "motores", lambda: {"sandbox": True, "docker": True})
    assert isolado.escolher("auto") == "sandbox"
    monkeypatch.setattr(isolado, "motores", lambda: {"sandbox": False, "docker": False})
    with pytest.raises(RuntimeError, match="Não há como isolar"):
        isolado.escolher("auto")


def test_docker_disponivel_so_com_conteiner_linux(monkeypatch):
    monkeypatch.setattr(isolado.shutil, "which", lambda n: r"C:\docker\docker.exe" if n.startswith("docker") else None)
    respostas = {"saida": b"linux\n", "codigo": 0}
    chamados: list[list[str]] = []

    def run(args, **kw):
        chamados.append(args)
        return subprocess.CompletedProcess(args, respostas["codigo"], respostas["saida"], b"")

    monkeypatch.setattr(isolado.subprocess, "run", run)
    assert isolado.docker_disponivel() == r"C:\docker\docker.exe"
    assert chamados[0][1:] == ["info", "--format", "{{.OSType}}"]
    respostas["saida"] = b"windows\n"
    assert isolado.docker_disponivel() is None
    respostas.update(saida=b"", codigo=1)
    assert isolado.docker_disponivel() is None
    monkeypatch.setattr(isolado.shutil, "which", lambda n: None)
    assert isolado.docker_disponivel() is None


class _Lancado:
    def __init__(self, pid: int):
        self.pid = pid


@pytest.fixture()
def sandbox_falso(tmp_path: Path, monkeypatch):
    """Um Windows Sandbox de mentira: `lancar` lê o .wsb e escreve a saída como o LogonCommand escreveria."""
    monkeypatch.setattr(isolado, "PASTA_SAIDA", tmp_path / "isolado")
    estado = {"vivos": set(), "mortos": [], "lancados": [], "responder": True, "saida": "ola do sandbox\n", "codigo": "0 \n", "lancar_pid": 4242, "nascem": {4243}}

    def lancar(args):
        estado["lancados"].append(args)
        cfg = Path(args[1])
        raiz = ET.fromstring(cfg.read_text(encoding="utf-8"))
        host_saida = next(m.findtext("HostFolder") for m in raiz.iter("MappedFolder") if m.findtext("SandboxFolder") == r"C:\saida")
        if estado["responder"]:
            (Path(host_saida) / "saida.txt").write_text(estado["saida"], encoding="utf-8")
            (Path(host_saida) / "codigo.txt").write_text(estado["codigo"], encoding="utf-8")
        estado["vivos"] |= {estado["lancar_pid"], *estado["nascem"]}
        return _Lancado(estado["lancar_pid"])

    def rodar(pasta="C:\\proj", comando="python x.py", timeout=5):
        return isolado.rodar_no_sandbox(
            pasta, comando, timeout,
            exe=r"C:\Windows\System32\WindowsSandbox.exe",
            lancar=lancar,
            listar=lambda: set(estado["vivos"]),
            arvore_de=lambda pid: {pid},
            matar=lambda pids: (estado["mortos"].append(set(pids)), estado["vivos"].difference_update(pids)),
            dormir=lambda s: time.sleep(0.01),
        )

    estado["rodar"] = rodar
    return estado


def test_sandbox_devolve_saida_e_codigo_por_arquivo_e_apaga_o_wsb(sandbox_falso):
    r = sandbox_falso["rodar"]()
    assert r["motor"] == "sandbox" and r["terminou"] is True and r["codigo"] == 0
    assert r["saida"] == "ola do sandbox\n"
    exe, cfg = sandbox_falso["lancados"][0]
    assert exe.endswith("WindowsSandbox.exe") and cfg.endswith(".wsb")
    assert not Path(cfg).exists(), "o .wsb (que tem o comando) não fica para trás"


def test_sandbox_fecha_so_a_instancia_que_abriu(sandbox_falso):
    sandbox_falso["rodar"]()
    # o lançado e o que nasceu depois dele (o servidor da sessão); nunca por nome de imagem
    assert sandbox_falso["mortos"] == [{4242, 4243}]


def test_area_restrita_do_dono_aberta_antes_recusa_e_nao_mata_nada(sandbox_falso):
    sandbox_falso["vivos"] = {777}  # a Área Restrita que o dono abriu à mão
    with pytest.raises(RuntimeError, match="Já existe uma Área Restrita"):
        sandbox_falso["rodar"]()
    assert sandbox_falso["mortos"] == []
    assert sandbox_falso["lancados"] == []
    assert sandbox_falso["vivos"] == {777}


def test_sandbox_que_nao_responde_estoura_o_prazo_e_mesmo_assim_fecha(sandbox_falso):
    sandbox_falso["responder"] = False
    comeco = time.time()
    r = sandbox_falso["rodar"](timeout=1)
    assert time.time() - comeco < 5
    assert r["terminou"] is False and r["codigo"] is None and r["saida"] == ""
    assert sandbox_falso["mortos"] == [{4242, 4243}]


def test_sem_sandbox_instalado_diz_o_que_falta(monkeypatch):
    monkeypatch.setattr(isolado, "sandbox_disponivel", lambda: None)
    with pytest.raises(RuntimeError, match="não está instalado"):
        isolado.rodar_no_sandbox(r"C:\proj", "x", 5)


def test_nao_ha_mais_taskkill_por_nome(sandbox_falso, monkeypatch):
    # a versão anterior rodava `taskkill /IM <nome> /F` para cada processo do Sandbox, na máquina inteira
    rodados: list = []
    monkeypatch.setattr(isolado.subprocess, "run", lambda *a, **k: rodados.append(a))
    sandbox_falso["rodar"]()
    assert rodados == []


def test_executar_isolado_docker_monta_os_argumentos_e_recusa_fora_das_raizes(maos, tmp_path: Path, monkeypatch):
    from maos import terminal

    proj = tmp_path / "proj"
    proj.mkdir()
    monkeypatch.setattr(isolado, "PASTA_SAIDA", tmp_path / "saidas")
    monkeypatch.setattr(terminal.shutil, "which", lambda n: r"C:\docker\docker.exe" if n.startswith("docker") else None)
    capturado: dict = {}
    monkeypatch.setattr(maos.terminal, "_iniciar", lambda ex, args, env, timeout: capturado.update(ex=ex, args=args, env=env, timeout=timeout) or ex)
    ex = maos.terminal.executar_isolado("python x.py", str(proj), [str(tmp_path)], ["PATH", "BETTER_AUTH_SECRET"], 60, 256, 1000, "python:3.12-slim")
    assert ex.isolado == "docker"
    args = capturado["args"]
    assert args[0] == r"C:\docker\docker.exe" and "--network" in args and args[args.index("--network") + 1] == "none"
    assert any(a.startswith(f"type=bind,source={proj.resolve()},target=/trabalho,readonly") for a in args)
    assert "BETTER_AUTH_SECRET" not in capturado["env"]
    with pytest.raises(PermissionError):
        maos.terminal.executar_isolado("x", str(proj), [str(tmp_path / "outra")], [], 60, 256, 1000, "img")
    monkeypatch.setattr(terminal.shutil, "which", lambda n: None)
    with pytest.raises(RuntimeError, match="Docker não está instalado"):
        maos.terminal.executar_isolado("x", str(proj), [str(tmp_path)], [], 60, 256, 1000, "img")


def test_rota_sandbox_confere_a_pasta_antes_de_abrir(cliente, cab, tmp_path: Path, monkeypatch):
    proj = tmp_path / "proj"
    proj.mkdir()
    chamado: list = []
    monkeypatch.setattr(isolado, "rodar_no_sandbox", lambda pasta, comando, timeout: chamado.append((pasta, comando, timeout)) or {"motor": "sandbox", "terminou": True, "codigo": 0, "saida": "ok", "duracaoMs": 5})
    corpo = {"comando": "python x.py", "shell": "powershell", "pasta": str(proj), "raizes": [str(tmp_path / "outra")], "variaveis": [], "esperarSeg": 1, "timeoutSeg": 30, "memoriaMb": 256, "saidaMax": 1000, "isolado": "sandbox"}
    fora = cliente.post("/terminal/executar", headers=cab, json=corpo)
    assert fora.status_code >= 400 and chamado == []
    dentro = cliente.post("/terminal/executar", headers=cab, json={**corpo, "raizes": [str(tmp_path)]})
    assert dentro.status_code == 200, dentro.text
    assert dentro.json()["saida"] == "ok" and dentro.json()["terminou"] is True
    assert chamado == [(str(proj.resolve()), "python x.py", 30)]


def test_arvore_e_matar_de_verdade_so_o_pid_dado():
    """As peças reais do fechamento (psutil), num processo nosso qualquer: mata pelo PID, não pelo nome."""
    import sys

    alvo = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], creationflags=0x08000000)
    vizinho = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"], creationflags=0x08000000)
    try:
        assert alvo.pid in isolado.arvore_do_processo(alvo.pid)
        isolado.matar_pids({alvo.pid})
        assert alvo.wait(10) is not None
        # o outro processo com o MESMO nome de imagem continua vivo
        assert vizinho.poll() is None
        assert isinstance(isolado.processos_do_sandbox(), set)
    finally:
        for p in (alvo, vizinho):
            if p.poll() is None:
                p.kill()
