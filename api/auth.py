"""Login, senhas e tokens da API.

Perfis:
    admin         vê e altera tudo (robôs, agendamentos, execuções, usuários)
    visualizador  só consulta (qualquer método diferente de GET é recusado)

Senha: PBKDF2-SHA256 com sal (biblioteca padrão do Python, sem dependências).
Token: JSON assinado com HMAC-SHA256 usando o segredo da API (API_SEGREDO no .env ou api/.segredo,
gerado no primeiro uso). Vale API_SESSAO_HORAS horas (padrão 12).
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
import os
import secrets
import time
from pathlib import Path
from threading import Lock

PERFIS = ("admin", "visualizador")
_ITERACOES = 200_000


# ------------------------------------------------------------------ senhas
def hash_senha(senha: str) -> str:
    sal = secrets.token_hex(16)
    h = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal.encode(), _ITERACOES).hex()
    return f"pbkdf2_sha256${_ITERACOES}${sal}${h}"


def conferir_senha(senha: str, guardada: str | None) -> bool:
    try:
        algoritmo, iteracoes, sal, h = (guardada or "").split("$")
        if algoritmo != "pbkdf2_sha256":
            return False
        calc = hashlib.pbkdf2_hmac("sha256", senha.encode(), sal.encode(), int(iteracoes)).hex()
        return hmac.compare_digest(calc, h)
    except ValueError:
        return False


def validar_senha_nova(senha: str) -> str | None:
    """Mensagem de erro, ou None se a senha serve."""
    if len(senha or "") < 8:
        return "A senha deve ter pelo menos 8 caracteres"
    return None


# ------------------------------------------------------------------ segredo dos tokens
def _carregar_segredo() -> bytes:
    if os.getenv("API_SEGREDO"):
        return os.environ["API_SEGREDO"].encode()
    arq = Path(__file__).with_name(".segredo")
    if not arq.exists():
        arq.write_text(secrets.token_urlsafe(48), encoding="utf-8")
    return arq.read_text(encoding="utf-8").strip().encode()


_SEGREDO = _carregar_segredo()
SESSAO_HORAS = float(os.getenv("API_SESSAO_HORAS", "12"))


def _b64(dados: bytes) -> str:
    return base64.urlsafe_b64encode(dados).rstrip(b"=").decode()


def _de_b64(txt: str) -> bytes:
    return base64.urlsafe_b64decode(txt + "=" * (-len(txt) % 4))


def criar_token(usuario: dict) -> str:
    carga = {"id": usuario["id"], "login": usuario["login"], "nome": usuario["nome"],
             "perfil": usuario["perfil"], "exp": int(time.time() + SESSAO_HORAS * 3600)}
    corpo = _b64(json.dumps(carga, separators=(",", ":")).encode())
    assinatura = _b64(hmac.new(_SEGREDO, corpo.encode(), hashlib.sha256).digest())
    return f"{corpo}.{assinatura}"


def ler_token(token: str) -> dict | None:
    """Dados do usuário se o token for válido e não tiver vencido; senão None."""
    try:
        corpo, assinatura = token.split(".", 1)
        esperado = _b64(hmac.new(_SEGREDO, corpo.encode(), hashlib.sha256).digest())
        if not hmac.compare_digest(esperado, assinatura):
            return None
        carga = json.loads(_de_b64(corpo))
        return carga if carga.get("exp", 0) > time.time() else None
    except (ValueError, json.JSONDecodeError):
        return None


# ------------------------------------------------------------------ proteção contra tentativa e erro
_TENTATIVAS: dict[str, list[float]] = {}
_TRAVA = Lock()
MAX_TENTATIVAS, JANELA_S = 5, 300


def bloqueado(login: str) -> bool:
    agora = time.time()
    with _TRAVA:
        recentes = [t for t in _TENTATIVAS.get(login.lower(), []) if agora - t < JANELA_S]
        _TENTATIVAS[login.lower()] = recentes
        return len(recentes) >= MAX_TENTATIVAS


def registrar_falha(login: str) -> None:
    with _TRAVA:
        _TENTATIVAS.setdefault(login.lower(), []).append(time.time())


def limpar_falhas(login: str) -> None:
    with _TRAVA:
        _TENTATIVAS.pop(login.lower(), None)
