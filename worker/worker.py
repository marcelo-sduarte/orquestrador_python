"""Worker do orquestrador: agenda + fila + execução. Rode como serviço do Windows (NSSM).

    python worker.py
"""
from __future__ import annotations

import logging
import signal
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from logging.handlers import TimedRotatingFileHandler

import agendador
import db
import executor
from config import CFG


def configurar_log() -> None:
    CFG.pasta_logs.mkdir(parents=True, exist_ok=True)
    fmt = logging.Formatter("%(asctime)s %(levelname)-7s [%(name)s] %(message)s")
    arq = TimedRotatingFileHandler(CFG.pasta_logs / "worker.log", when="midnight",
                                   backupCount=30, encoding="utf-8")
    arq.setFormatter(fmt)
    tela = logging.StreamHandler()
    tela.setFormatter(fmt)
    logging.basicConfig(level=logging.INFO, handlers=[arq, tela])


log = logging.getLogger("worker")


def main() -> None:
    configurar_log()
    parar = threading.Event()
    signal.signal(signal.SIGINT, lambda *_: parar.set())
    signal.signal(signal.SIGTERM, lambda *_: parar.set())
    if hasattr(signal, "SIGBREAK"):  # Windows: NSSM envia Ctrl+Break ao parar o serviço
        signal.signal(signal.SIGBREAK, lambda *_: parar.set())

    log.info("Worker '%s' iniciando (max %s jobs)", CFG.worker_nome, CFG.max_jobs_simultaneos)
    n = db.marcar_jobs_do_worker_como_interrompidos()
    if n:
        log.warning("%s job(s) deste worker ficaram órfãos no último desligamento", n)

    pool = ThreadPoolExecutor(max_workers=CFG.max_jobs_simultaneos, thread_name_prefix="job")
    rodando: set = set()
    ultima_agenda = 0.0

    def _job_terminou(fut):
        rodando.discard(fut)
        if fut.exception():
            log.error("Erro inesperado no job", exc_info=fut.exception())

    while not parar.is_set():
        try:
            if time.monotonic() - ultima_agenda >= CFG.intervalo_agenda_s:
                ultima_agenda = time.monotonic()
                agendador.processar_agenda()
                if (n := db.recuperar_orfaos()):
                    log.warning("%s job(s) órfão(s) marcados como ERRO", n)

            # Pega jobs enquanto houver vaga neste worker
            while len(rodando) < CFG.max_jobs_simultaneos and not parar.is_set():
                job = db.pegar_proximo_job()
                if job is None:
                    break
                fut = pool.submit(executor.executar, job, parar)
                rodando.add(fut)
                fut.add_done_callback(_job_terminou)
        except Exception:
            log.exception("Falha no ciclo principal (banco indisponível?) — tentando de novo")

        parar.wait(CFG.intervalo_poll_s)

    log.info("Encerrando: aguardando %s job(s) finalizarem", len(rodando))
    pool.shutdown(wait=True)
    log.info("Worker encerrado")


if __name__ == "__main__":
    main()
