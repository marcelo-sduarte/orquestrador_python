"""Controle dos processos dos robôs no Windows.

Problema: no Windows, quando um processo morre os filhos dele NÃO morrem junto.
Se o worker cair de forma abrupta (Gerenciador de Tarefas, falta de memória,
travamento, reinício do serviço), o bootstrap, o robô, o Chrome e o chromedriver
continuariam rodando sem supervisão.

Duas proteções:
  1. ativar_encerramento_junto_com_worker(): coloca o próprio worker num Job Object
     do Windows com KILL_ON_JOB_CLOSE. Todo processo que o worker iniciar (e os
     filhos deles) entra no mesmo Job. Quando o worker morre, de qualquer jeito,
     o Windows fecha o Job e mata todos.
  2. encerrar_processos_restantes(): na inicialização, mata a árvore dos robôs que
     o banco ainda registra como EXECUTANDO neste worker (caso a proteção 1 não
     esteja disponível ou um processo tenha escapado do Job).
"""
from __future__ import annotations

import logging
import os

import psutil

log = logging.getLogger("processos")

_job_handle = None   # mantido aberto enquanto o worker viver (fechar = matar os robôs)


def matar_arvore(pid: int) -> None:
    """Mata o processo e todos os filhos (bootstrap -> python do venv -> chromedriver...)."""
    try:
        pai = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    try:
        filhos = pai.children(recursive=True)
    except psutil.NoSuchProcess:
        filhos = []
    for p in [*filhos, pai]:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs([*filhos, pai], timeout=10)


def ativar_encerramento_junto_com_worker() -> bool:
    """Proteção 1 (só Windows). Devolve True se o Job Object foi ativado."""
    global _job_handle
    if os.name != "nt":
        return False
    try:
        import ctypes
        from ctypes import wintypes

        class IO_COUNTERS(ctypes.Structure):
            _fields_ = [(n, ctypes.c_ulonglong) for n in (
                "ReadOperationCount", "WriteOperationCount", "OtherOperationCount",
                "ReadTransferCount", "WriteTransferCount", "OtherTransferCount")]

        class JOBOBJECT_BASIC_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [("PerProcessUserTimeLimit", ctypes.c_int64),
                        ("PerJobUserTimeLimit", ctypes.c_int64),
                        ("LimitFlags", wintypes.DWORD),
                        ("MinimumWorkingSetSize", ctypes.c_size_t),
                        ("MaximumWorkingSetSize", ctypes.c_size_t),
                        ("ActiveProcessLimit", wintypes.DWORD),
                        ("Affinity", ctypes.c_size_t),
                        ("PriorityClass", wintypes.DWORD),
                        ("SchedulingClass", wintypes.DWORD)]

        class JOBOBJECT_EXTENDED_LIMIT_INFORMATION(ctypes.Structure):
            _fields_ = [("BasicLimitInformation", JOBOBJECT_BASIC_LIMIT_INFORMATION),
                        ("IoInfo", IO_COUNTERS),
                        ("ProcessMemoryLimit", ctypes.c_size_t),
                        ("JobMemoryLimit", ctypes.c_size_t),
                        ("PeakProcessMemoryUsed", ctypes.c_size_t),
                        ("PeakJobMemoryUsed", ctypes.c_size_t)]

        JobObjectExtendedLimitInformation = 9
        JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE = 0x2000

        k32 = ctypes.WinDLL("kernel32", use_last_error=True)
        k32.CreateJobObjectW.restype = wintypes.HANDLE
        k32.CreateJobObjectW.argtypes = [wintypes.LPVOID, wintypes.LPCWSTR]
        k32.SetInformationJobObject.restype = wintypes.BOOL
        k32.SetInformationJobObject.argtypes = [wintypes.HANDLE, ctypes.c_int, wintypes.LPVOID, wintypes.DWORD]
        k32.AssignProcessToJobObject.restype = wintypes.BOOL
        k32.AssignProcessToJobObject.argtypes = [wintypes.HANDLE, wintypes.HANDLE]
        k32.GetCurrentProcess.restype = wintypes.HANDLE

        job = k32.CreateJobObjectW(None, None)
        if not job:
            raise ctypes.WinError(ctypes.get_last_error())

        info = JOBOBJECT_EXTENDED_LIMIT_INFORMATION()
        info.BasicLimitInformation.LimitFlags = JOB_OBJECT_LIMIT_KILL_ON_JOB_CLOSE
        if not k32.SetInformationJobObject(job, JobObjectExtendedLimitInformation,
                                           ctypes.byref(info), ctypes.sizeof(info)):
            raise ctypes.WinError(ctypes.get_last_error())

        # O próprio worker entra no Job: todo processo iniciado depois herda o Job automaticamente,
        # sem janela entre o Popen e a associação.
        if not k32.AssignProcessToJobObject(job, k32.GetCurrentProcess()):
            raise ctypes.WinError(ctypes.get_last_error())

        _job_handle = job
        return True
    except Exception as e:
        log.warning("Job Object não ativado (%s): se o worker cair, os robôs podem continuar rodando. "
                    "A limpeza na próxima inicialização continua ativa.", e)
        return False


def encerrar_processos_restantes(execucoes, bootstrap: str) -> int:
    """Proteção 2. execucoes = [(id, pid), ...] que estavam EXECUTANDO neste worker.
    Só mata o pid se ele ainda for um processo do bootstrap (o Windows reaproveita números de pid)."""
    alvo = os.path.normcase(os.path.abspath(bootstrap))
    mortos = 0
    for job_id, pid in execucoes:
        if not pid:
            continue
        try:
            p = psutil.Process(int(pid))
            cmd = " ".join(p.cmdline())
        except (psutil.NoSuchProcess, psutil.AccessDenied, ValueError):
            continue
        if alvo not in os.path.normcase(cmd) and os.path.basename(alvo) not in os.path.normcase(cmd):
            log.info("Job %s: pid %s agora é outro processo (%s), ignorado", job_id, pid, p.name())
            continue
        log.warning("Job %s: processo %s ainda estava rodando após a queda do worker — encerrando", job_id, pid)
        matar_arvore(int(pid))
        mortos += 1
    return mortos
