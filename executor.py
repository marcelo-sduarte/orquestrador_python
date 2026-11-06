"""Executa um job: chama o bootstrap.py, acompanha heartbeat, cancelamento e timeout."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import time
from datetime import datetime

import psutil

import db
from config import CFG

log = logging.getLogger("executor")


def _matar_arvore(pid: int) -> None:
    """Mata o processo e todos os filhos (bootstrap -> python do venv -> chromedriver...)."""
    try:
        pai = psutil.Process(pid)
    except psutil.NoSuchProcess:
        return
    filhos = pai.children(recursive=True)
    for p in [*filhos, pai]:
        try:
            p.kill()
        except psutil.NoSuchProcess:
            pass
    psutil.wait_procs([*filhos, pai], timeout=10)


def executar(job: db.Job, parar) -> None:
    CFG.pasta_logs.mkdir(parents=True, exist_ok=True)
    arq_log = CFG.pasta_logs / f"{datetime.now():%Y%m%d}_{job.robo_nome}_{job.id}.log"

    # Parâmetros vão por variável de ambiente: evita problema de aspas do JSON na linha de comando
    env = os.environ.copy()
    env.update({
        "ORQ_EXECUCAO_ID": str(job.id),
        "ORQ_ROBO": job.robo_nome,
        "ORQ_PARAMS": job.parametros or "{}",
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",  # log aparece em tempo real no arquivo
    })
    try:
        json.loads(env["ORQ_PARAMS"])
    except json.JSONDecodeError as e:
        db.finalizar(job.id, "ERRO", None, f"parametros não é JSON válido: {e}")
        return

    cmd = [CFG.python_exe, CFG.bootstrap, job.robo_nome]
    log.info("Job %s: iniciando %s", job.id, cmd)

    with open(arq_log, "w", encoding="utf-8", errors="replace") as saida:
        try:
            proc = subprocess.Popen(
                cmd, stdout=saida, stderr=subprocess.STDOUT, env=env,
                cwd=os.path.dirname(CFG.bootstrap) or None,
                creationflags=getattr(subprocess, "CREATE_NEW_PROCESS_GROUP", 0),
            )
        except OSError as e:
            db.finalizar(job.id, "ERRO", None, f"Falha ao iniciar processo: {e}")
            return

        db.registrar_inicio(job.id, proc.pid, str(arq_log))
        limite = time.monotonic() + job.timeout_min * 60
        status, mensagem = None, None

        while proc.poll() is None:
            try:
                cancelar = db.heartbeat_e_cancelamento(job.id)
            except Exception:  # banco fora do ar não derruba o robô; tenta de novo no próximo ciclo
                log.exception("Job %s: falha no heartbeat", job.id)
                cancelar = False

            if cancelar:
                status, mensagem = "CANCELADO", "Cancelado pelo usuário"
            elif time.monotonic() > limite:
                status, mensagem = "TIMEOUT", f"Excedeu {job.timeout_min} min"
            elif parar.is_set():
                status, mensagem = "ERRO", "Worker encerrado durante a execução"

            if status:
                log.warning("Job %s: %s — matando processo %s", job.id, mensagem, proc.pid)
                _matar_arvore(proc.pid)
                break

            try:
                proc.wait(timeout=CFG.intervalo_heartbeat_s)
            except subprocess.TimeoutExpired:
                pass

        exit_code = proc.wait()

    if status is not None:
        exit_code = None  # processo foi morto pelo worker; o código de saída não significa nada
    else:
        status = "SUCESSO" if exit_code == 0 else "ERRO"
        if exit_code != 0:
            mensagem = _ultimas_linhas(arq_log)
    db.finalizar(job.id, status, exit_code, mensagem)
    log.info("Job %s finalizado: %s (exit %s)", job.id, status, exit_code)


def _ultimas_linhas(caminho, n: int = 15) -> str:
    try:
        with open(caminho, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except OSError:
        return ""
