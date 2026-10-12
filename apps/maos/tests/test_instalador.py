"""O instalador da tarefa "Orbita Maos" (G7 e G8 da auditoria de 11/10/2026).

Nada aqui registra, troca ou sobe a tarefa instalada do dono: o script roda só
em modo `-Seco`, que monta os objetos do Agendador (os `New-ScheduledTask*` não
gravam nada) e sai. O resto é o parser oficial do PowerShell lendo o arquivo.
"""

from __future__ import annotations

import subprocess
from pathlib import Path

import pytest

from maos.gui import MOD_ALT, MOD_CONTROL, MOD_SHIFT, interpretar_atalho
from maos.terminal import detectar_shells

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "instalar.ps1"


@pytest.fixture(scope="module")
def powershell() -> str:
    sh = detectar_shells()
    exe = sh.get("powershell") or sh.get("pwsh")
    if not exe:
        pytest.skip("sem PowerShell")
    return exe


def _rodar(exe: str, *args: str) -> subprocess.CompletedProcess:
    # a saída sai na página de código do console: o teste só compara trechos sem acento
    return subprocess.run(
        [exe, "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", str(SCRIPT), *args],
        capture_output=True, timeout=180, creationflags=0x08000000,
    )


def test_o_script_e_powershell_valido(powershell):
    r = subprocess.run(
        [powershell, "-NoProfile", "-NonInteractive", "-Command",
         f"$t=$null;$e=$null;[void][System.Management.Automation.Language.Parser]::ParseFile('{SCRIPT}',[ref]$t,[ref]$e);$e.Count"],
        capture_output=True, timeout=120, creationflags=0x08000000,
    )
    assert r.stdout.decode().strip() == "0", r.stderr.decode(errors="replace")


def test_seco_mostra_prioridade_normal_e_nao_muda_nada(powershell):
    def prioridade_instalada() -> str:
        q = subprocess.run([powershell, "-NoProfile", "-NonInteractive", "-Command", "(Get-ScheduledTask -TaskName 'Orbita Maos' -ErrorAction SilentlyContinue).Settings.Priority"], capture_output=True, timeout=120, creationflags=0x08000000)
        return q.stdout.decode().strip()

    antes = prioridade_instalada()
    r = _rodar(powershell, "-Seco")
    saida = r.stdout.decode("utf-8", errors="replace")
    assert r.returncode == 0, r.stderr.decode(errors="replace")
    assert "nada foi alterado" in saida
    assert "prioridade: 4" in saida
    assert ": Limited; prioridade" in saida
    assert "espera do /health depois de subir: 180 s" in saida
    assert "Ctrl+Alt+F12" in saida  # o aviso do atalho
    # a tarefa que já está instalada (se houver) não foi tocada pelo modo seco
    assert prioridade_instalada() == antes


def test_seco_respeita_a_espera_pedida(powershell):
    saida = _rodar(powershell, "-Seco", "-EsperarSeg", "300").stdout.decode("utf-8", errors="replace")
    assert "espera do /health depois de subir: 300 s" in saida


def test_remover_seco_nao_remove(powershell):
    r = _rodar(powershell, "-Remover", "-Seco")
    assert r.returncode == 0
    assert "nada foi alterado" in r.stdout.decode("utf-8", errors="replace")


def test_o_script_espera_o_tempo_pedido_e_registra_com_a_prioridade():
    fonte = SCRIPT.read_text(encoding="utf-8-sig")
    assert "$PrioridadeDaTarefa = 4" in fonte
    assert "-Priority $PrioridadeDaTarefa" in fonte
    assert "[int]$EsperarSeg = 180" in fonte
    # o laço de espera é pelo relógio e avisa o andamento, em vez de 60 voltas fixas
    assert "if ($passou -ge $EsperarSeg) { break }" in fonte
    assert "ainda subindo" in fonte


@pytest.mark.parametrize(
    ("atalho", "esperado"),
    [("Ctrl+Alt+Esc", (MOD_CONTROL | MOD_ALT, 0x1B)), ("Ctrl+Alt+F12", (MOD_CONTROL | MOD_ALT, 0x7B)), ("Ctrl+Shift+F12", (MOD_CONTROL | MOD_SHIFT, 0x7B))],
)
def test_as_alternativas_documentadas_do_atalho_sao_aceitas(atalho, esperado):
    assert interpretar_atalho(atalho) == esperado
