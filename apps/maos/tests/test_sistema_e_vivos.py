"""Sistema, midia, atalho de parar, terminal vivo e a leitura da tela (sem injetar entrada nenhuma)."""

from __future__ import annotations

import os
import time
from pathlib import Path

import pytest

from maos.gui import interpretar_atalho
from maos.sistema import motivo_para_nao_encerrar, procurar_processos, resumo_do_sistema
from maos.win32 import MOD_ALT, MOD_CONTROL


def test_atalho_de_parar():
    assert interpretar_atalho("Ctrl+Alt+Esc") == (MOD_CONTROL | MOD_ALT, 0x1B)
    assert interpretar_atalho("ctrl+alt+F12")[1] == 0x7B
    for ruim in ("Esc", "Ctrl+", "Hiper+Esc", "Ctrl+Alt+NaoExiste"):
        with pytest.raises(ValueError):
            interpretar_atalho(ruim)


def test_resumo_do_sistema():
    r = resumo_do_sistema(top=3)
    assert 0 <= r["cpu_pct"] <= 100
    assert r["memoria"]["total_gb"] > 0
    assert r["discos"] and all("livre_gb" in d for d in r["discos"])
    assert len(r["processos_cpu"]) <= 3


def test_nao_encerra_a_si_mesmo_nem_processo_do_windows():
    assert "própria Órbita" in motivo_para_nao_encerrar(os.getpid(), None, None, set())
    csrss = [p for p in procurar_processos("csrss")]
    if csrss:
        m = motivo_para_nao_encerrar(csrss[0]["pid"], "csrss", None, set())
        assert m is not None


def test_pid_reaproveitado_e_recusado():
    import subprocess
    import sys

    p = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(20)"])
    try:
        assert "reaproveitado" in motivo_para_nao_encerrar(p.pid, "notepad", None, set())
        assert "reiniciou" in motivo_para_nao_encerrar(p.pid, None, 1.0, set())
        assert motivo_para_nao_encerrar(p.pid, "python", None, set()) is None
    finally:
        p.kill()


def test_rota_encerrar_recusa_processo_do_windows(cliente, cab):
    lista = procurar_processos("csrss")
    if not lista:
        pytest.skip("csrss nao visivel")
    r = cliente.post("/processos/encerrar", json={"pid": lista[0]["pid"], "nome": "csrss"}, headers=cab)
    assert r.status_code == 409


def test_midia_acao_desconhecida_422(cliente, cab):
    assert cliente.post("/midia", json={"acao": "explodir"}, headers=cab).status_code == 422


def test_volume_so_leitura():
    from maos.midia import estado_do_volume

    try:
        e = estado_do_volume()
    except Exception as ex:  # noqa: BLE001 - maquina sem saida de audio
        pytest.skip(f"sem dispositivo de audio: {ex}")
    assert 0 <= e["volume"] <= 100 and isinstance(e["mudo"], bool)


def test_midia_nao_depende_do_interruptor(monkeypatch):
    # depois de um "parar", a midia (sem sessao) continua funcionando
    from maos import entrada, midia

    enviados = []
    monkeypatch.setattr(entrada, "_enviar", lambda ev: enviados.append(len(ev)))
    entrada.INTERRUPTOR.cortar()
    try:
        midia.executar("pausar")
        assert enviados
        with pytest.raises(entrada.Interrompido):
            entrada.digitar("x")
    finally:
        entrada.INTERRUPTOR.rearmar()


def test_terminal_vivo(tmp_path: Path):
    from maos.pty_sessoes import Sessoes
    from maos.terminal import detectar_shells

    sh = "pwsh" if "pwsh" in detectar_shells() else "powershell"
    s = Sessoes()
    sess = s.abrir(sh, str(tmp_path), [str(tmp_path)], ["PATH", "TEMP"], 512)
    try:
        # espera o prompt em vez de um tempo fixo: com a máquina carregada (a suíte inteira),
        # o PowerShell passava de 1,5 s para subir e o comando se perdia
        for _ in range(150):
            if "PS " in sess.ler(None, 20000)["texto"]:
                break
            time.sleep(0.2)
        s.escrever(sess.id, "Write-Output ('orbita' + '-viva')", True)
        texto = ""
        for _ in range(150):
            texto = sess.ler(None, 20000)["texto"]
            if "orbita-viva" in texto:
                break
            time.sleep(0.2)
        assert "orbita-viva" in texto
        assert sess.job.processos_vivos() >= 1
    finally:
        assert s.fechar_todas("fim") == 1
    time.sleep(0.5)
    assert not sess.proc.isalive()


def test_parar_local_fecha_terminal_vivo_e_comando(maos, tmp_path: Path):
    from maos.terminal import detectar_shells

    sh = "pwsh" if "pwsh" in detectar_shells() else "powershell"
    ex = maos.terminal.executar("Start-Sleep -Seconds 30", sh, str(tmp_path), [str(tmp_path)], ["PATH"], 60, 256, 1000)
    maos.pty.abrir(sh, str(tmp_path), [str(tmp_path)], ["PATH"], 256)
    r = maos.parar_local("teste", avisar_api=False)
    assert r["terminais"] == 1 and r["sessoes_pty"] == 1
    assert r["ms"] < 300, r
    maos.terminal.esperar(ex, 5)
    assert ex.resumo()["status"] == "parado"


def test_janelas_e_ponto_pela_uia(cliente, cab):
    from maos.dpi import monitores

    r = cliente.post("/computador/janelas", json={}, headers=cab)
    assert r.status_code == 200
    for j in r.json()["janelas"]:
        assert {"janela", "titulo", "app", "pid", "foco", "monitor", "elevada", "oculta"} <= set(j)
    m = next(x for x in monitores() if x.primario)
    p = cliente.post("/computador/no-ponto", json={"x": m.x + m.largura // 2, "y": m.y + m.altura // 2}, headers=cab)
    assert p.status_code == 200
    assert "papel" in p.json() and "assinatura" in p.json()


def test_uia_no_processo_novo():
    """Como o serviço instalado: processo novo, e o comtypes importado PELA thread da UIA.
    Antes, o pedido de MTA numa thread que o import já tinha feito STA quebrava o pool."""
    import subprocess
    import sys

    codigo = (
        "import sys; assert 'comtypes' not in sys.modules\n"
        "from maos.uia import na_thread_da_uia, _uia\n"
        "print(na_thread_da_uia(lambda: _uia() is not None))\n"
        "print(na_thread_da_uia(lambda: 2))\n"
    )
    r = subprocess.run([sys.executable, "-c", codigo], cwd=Path(__file__).resolve().parents[1], capture_output=True, text=True, timeout=120)
    assert r.returncode == 0, r.stderr[-2000:]
    assert r.stdout.split() == ["True", "2"]


def test_leitura_que_passa_do_prazo_vira_504_com_motivo(cliente, cab, monkeypatch):
    import maos.uia as uia

    def demora(*_a, **_k):
        raise TimeoutError()

    monkeypatch.setattr(uia, "ler_janela", demora)
    r = cliente.post("/computador/ver", json={"janela": 1}, headers=cab)
    assert r.status_code == 504
    assert "prazo" in r.json()["detail"]


def test_trazer_janela_para_frente_so_dentro_do_envelope(cliente, cab):
    """Sem injetar nada: janela que não existe é 404, e sem sessão espelhada a ordem é recusada."""
    from maos.win32 import user32

    assert cliente.post("/computador/janela/frente", json={"janela": 0x7FFFFFF0, "sessaoId": "s1"}, headers=cab).status_code == 404
    shell = int(user32.GetShellWindow() or 0)
    r = cliente.post("/computador/janela/frente", json={"janela": shell, "sessaoId": "s1"}, headers=cab)
    assert r.status_code == 409 and r.json()["recusada"] is True


def test_digitar_espera_o_eco_de_cada_caractere(monkeypatch):
    """Sem injetar nada: o envio é trocado por uma lista, e o eco é o app "mostrando" o texto."""
    from maos import entrada

    enviados: list[int] = []
    perguntas: list[int] = []
    monkeypatch.setattr(entrada, "_enviar", lambda ev: enviados.append(len(ev)))

    def eco():
        perguntas.append(len(enviados))
        return len(enviados)

    entrada.INTERRUPTOR.rearmar()
    entrada.digitar("aã\n", eco=eco)
    assert enviados == [2, 2, 2]
    # antes de cada caractere e depois dele, até o app mostrar: nunca manda o próximo antes do eco
    assert perguntas == [0, 1, 1, 2, 2, 3]

    # app que não mostra nada: espera o prazo e segue (quem confere o resultado é o agir)
    enviados.clear()
    comeco = time.perf_counter()
    entrada.digitar("ab", eco=lambda: 0, espera_eco=0.05)
    assert len(enviados) == 2 and time.perf_counter() - comeco >= 0.09
