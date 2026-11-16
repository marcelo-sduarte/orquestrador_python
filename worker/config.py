"""Configuração do orquestrador via variáveis de ambiente (ou arquivo .env)."""
from __future__ import annotations

import os
import socket
import sys
from dataclasses import dataclass, field
from pathlib import Path

try:
    from dotenv import load_dotenv

    load_dotenv(Path(__file__).with_name(".env"))
except ImportError:  # python-dotenv é opcional
    pass


# Código compartilhado com a API (regra_agenda.py) fica em ../comum
PASTA_COMUM = Path(__file__).resolve().parent.parent / "comum"
if str(PASTA_COMUM) not in sys.path:
    sys.path.insert(0, str(PASTA_COMUM))


def _int(nome: str, padrao: int) -> int:
    return int(os.getenv(nome, padrao))


@dataclass(frozen=True)
class Config:
    conn_str: str = os.getenv(
        "ORQ_CONN_STR",
        "DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost;DATABASE=Orquestrador;"
        "Trusted_Connection=yes;TrustServerCertificate=yes;",
    )
    worker_nome: str = os.getenv("ORQ_WORKER_NOME", socket.gethostname())

    # Como o robô é executado: python + bootstrap + nome do robô
    python_exe: str = os.getenv("ORQ_PYTHON", r"C:\Python315\python.exe")
    bootstrap: str = os.getenv("ORQ_BOOTSTRAP", r"C:\robos\bootstrap.py")
    pasta_logs: Path = Path(os.getenv("ORQ_PASTA_LOGS", r"C:\robos\logs"))

    # Tags deste runner (ex.: "sap,chrome"). Robô com tag só roda em worker que tenha a tag;
    # robô sem tag roda em qualquer worker. Vazio = este worker só pega robôs sem tag.
    tags: str = ",".join(t.strip().lower() for t in os.getenv("ORQ_TAGS", "").split(",") if t.strip())

    # A cada quantos segundos o final do log da execução em andamento é copiado para o banco
    # (assim o front mostra o log de qualquer runner, sem acessar o disco dele)
    log_parcial_s: int = _int("ORQ_LOG_PARCIAL_S", 30)

    max_jobs_simultaneos: int = _int("ORQ_MAX_JOBS", 2)    # limite total deste worker
    intervalo_poll_s: int = _int("ORQ_POLL_S", 5)          # busca de novos jobs
    intervalo_agenda_s: int = _int("ORQ_AGENDA_S", 30)     # verificação dos agendamentos
    intervalo_sinal_s: int = _int("ORQ_SINAL_S", 10)       # sinal de vida (ultimo_sinal) e checagem de cancelamento
    orfao_apos_s: int = _int("ORQ_ORFAO_S", 120)           # sem sinal de vida há mais que isso -> job órfão

    fuso: str = os.getenv("ORQ_FUSO", "America/Sao_Paulo")  # horários dos agendamentos

    # Ambiente enviado ao bootstrap ("ambiente" no JSON): DEV, QAS ou PRD — o da máquina onde o worker roda
    ambiente: str = os.getenv("ORQ_AMBIENTE", "DEV").strip().upper()


CFG = Config()
