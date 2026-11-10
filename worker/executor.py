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

# Chaves do próprio bootstrap: se aparecerem nos parâmetros do formulário, vão para o topo do JSON
CHAVES_BOOTSTRAP = ("ambiente", "executar_bot", "caminho_repositorio")


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

    try:
        params_robo = json.loads(job.parametros or "{}")
    except json.JSONDecodeError as e:
        db.finalizar(job.id, "ERRO", None, f"parametros não é JSON válido: {e}")
        return

    # JSON no formato que o bootstrap espera (o mesmo que o Automation Anywhere envia).
    # O que o usuário preencheu no formulário vai em "parametros" (o bootstrap repassa ao main.py do robô),
    # exceto as chaves do próprio bootstrap: se vierem no formulário, substituem o valor padrão.
    topo = {
        "ambiente": CFG.ambiente,
        "nomebot": job.robo_nome,
        "executar_bot": "True",
        "caminho_repositorio": job.caminho_repositorio or "",
    }
    params_robo = dict(params_robo) if isinstance(params_robo, dict) else {}
    for chave in CHAVES_BOOTSTRAP:
        if chave in params_robo and str(params_robo[chave]).strip() != "":
            valor = params_robo.pop(chave)
            topo[chave] = str(valor) if chave == "executar_bot" else valor
    entrada_bootstrap = json.dumps({**topo, "parametros": params_robo}, ensure_ascii=False)

    env = os.environ.copy()
    env.update({
        "ORQ_EXECUCAO_ID": str(job.id),
        "ORQ_ROBO": job.robo_nome,
        "ORQ_PARAMS": job.parametros or "{}",      # só os parâmetros do robô
        "ORQ_BOOTSTRAP_JSON": entrada_bootstrap,    # JSON completo do bootstrap
        "PYTHONIOENCODING": "utf-8",
        "PYTHONUNBUFFERED": "1",  # log aparece em tempo real no arquivo
    })

    # O JSON também vai como 1º argumento (subprocess cuida das aspas no Windows)
    cmd = [CFG.python_exe, CFG.bootstrap, entrada_bootstrap]
    log.info("Job %s: iniciando %s %s | %s", job.id, CFG.python_exe, CFG.bootstrap, entrada_bootstrap)

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

    retorno = ler_retorno_bootstrap(arq_log)
    resultado = json.dumps(retorno, ensure_ascii=False) if retorno else None

    if status is not None:
        exit_code = None  # processo foi morto pelo worker; o código de saída não significa nada
    else:
        status = "SUCESSO" if exit_code == 0 else "ERRO"
        # O retorno do bootstrap manda: "falha" vira ERRO mesmo se o processo saiu com 0
        if retorno and str(retorno.get("status", "")).lower() == "falha":
            status = "ERRO"
        if status == "ERRO":
            mensagem = (retorno or {}).get("mensagem") or _ultimas_linhas(arq_log)
    db.finalizar(job.id, status, exit_code, mensagem, resultado)
    log.info("Job %s finalizado: %s (exit %s)", job.id, status, exit_code)


def ler_retorno_bootstrap(caminho) -> dict | None:
    """Procura, de baixo para cima, a última linha do log com um JSON que tenha "status"
    (o bootstrap imprime: 'Bootstrap finalizado com status: {...}')."""
    try:
        with open(caminho, "rb") as f:
            f.seek(0, os.SEEK_END)
            f.seek(max(0, f.tell() - 256 * 1024))  # só o final do arquivo
            linhas = f.read().decode("utf-8", errors="replace").splitlines()
    except OSError:
        return None
    for linha in reversed(linhas):
        inicio = linha.find("{")
        if inicio < 0:
            continue
        try:
            dados = json.loads(linha[inicio:])
        except json.JSONDecodeError:
            continue
        if isinstance(dados, dict) and "status" in dados:
            return dados
    return None


def _ultimas_linhas(caminho, n: int = 15) -> str:
    try:
        with open(caminho, encoding="utf-8", errors="replace") as f:
            return "".join(f.readlines()[-n:])
    except OSError:
        return ""
