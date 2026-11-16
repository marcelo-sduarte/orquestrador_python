"""API do Orquestrador (FastAPI).

Mesmas rotas e mesmo JSON da API Node anterior: o front não muda.
Documentação interativa: http://localhost:3001/docs

    python main.py                      (ou)
    python -m uvicorn main:app --host 0.0.0.0 --port 3001
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from fastapi import Body, Depends, FastAPI, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse, PlainTextResponse
from fastapi.security import HTTPBearer
from fastapi.staticfiles import StaticFiles

import auth
import db
from config import CFG  # também coloca ../comum no sys.path
from parametros import (ErroValidacao, campos_do_robo, opcoes_para_texto, preparar_parametros,
                        validar_definicao)
from regra_agenda import Regra, RegraInvalida

# HTTPBearer só para o botão "Authorize" do /docs; quem confere o token é o middleware abaixo
TAGS_DOC = [
    {"name": "Autenticação", "description": "Login e sessão. Todas as rotas /api exigem `Authorization: Bearer <token>`, exceto o login."},
    {"name": "Painel", "description": "Números do topo da tela."},
    {"name": "Execuções", "description": "Histórico, execução manual, reexecução, cancelamento e log."},
    {"name": "Fila", "description": "O que está rodando, aguardando e o que vai rodar pelos agendamentos."},
    {"name": "Robôs", "description": "Cadastro dos robôs e dos campos de parâmetro."},
    {"name": "Agendamentos", "description": "Regras de dias, horário e intervalo de cada robô."},
    {"name": "Usuários", "description": "Somente administrador: cadastro de usuários e perfis."},
]
app = FastAPI(
    title="Orquestrador de Robôs",
    version="2.1",
    description="API do orquestrador: alimenta a interface e lê/grava no SQL Server. Não executa robôs "
                "(quem executa é o worker de cada runner). Perfil **visualizador** só pode usar GET "
                "(e trocar a própria senha); o **administrador** pode tudo.",
    openapi_tags=TAGS_DOC,
    dependencies=[Depends(HTTPBearer(auto_error=False))],
)


# ------------------------------------------------------------------ login obrigatório e perfis
ROTAS_LIVRES = {"/api/login"}                    # sem token
ROTAS_QUALQUER_PERFIL = {("POST", "/api/me/senha")}  # escrita permitida também ao visualizador
_CACHE_USUARIO: dict[int, tuple[float, dict | None]] = {}
_CACHE_S = 60


def _usuario_no_banco(uid: int) -> dict | None:
    """Situação atual do usuário (ativo/perfil), com cache curto: desativar ou trocar o perfil
    vale em até 1 minuto, mesmo para quem já está logado."""
    agora = time.time()
    em_cache = _CACHE_USUARIO.get(uid)
    if em_cache and agora - em_cache[0] < _CACHE_S:
        return em_cache[1]
    u = db.um("SELECT id, login, nome, perfil FROM PY_Usuario WHERE id = ? AND ativo = 1", uid)
    _CACHE_USUARIO[uid] = (agora, u)
    return u


@app.middleware("http")
async def autenticacao(request: Request, call_next):
    caminho = request.url.path
    if not caminho.startswith("/api/") or caminho in ROTAS_LIVRES:
        return await call_next(request)

    cabecalho = request.headers.get("authorization", "")
    token = auth.ler_token(cabecalho[7:]) if cabecalho.lower().startswith("bearer ") else None
    usuario = await run_in_threadpool(_usuario_no_banco, token["id"]) if token else None
    if not usuario:
        return JSONResponse({"erro": "Sessão expirada ou inválida: entre novamente"}, status_code=401)

    if usuario["perfil"] != "admin":
        escrita = request.method not in ("GET", "HEAD", "OPTIONS")
        if caminho.startswith("/api/usuarios") or (escrita and (request.method, caminho) not in ROTAS_QUALQUER_PERFIL):
            return JSONResponse({"erro": "Seu perfil é somente de visualização"}, status_code=403)

    request.state.usuario = usuario
    return await call_next(request)


# ------------------------------------------------------------------ erros no formato do front: {"erro": "..."}
class Erro(Exception):
    def __init__(self, status: int, mensagem: str):
        self.status, self.mensagem = status, mensagem


@app.exception_handler(Erro)
def _erro(_req: Request, e: Erro):
    return JSONResponse({"erro": e.mensagem}, status_code=e.status)


@app.exception_handler(ErroValidacao)
def _erro_validacao(_req: Request, e: ErroValidacao):
    return JSONResponse({"erro": str(e)}, status_code=400)


@app.exception_handler(RequestValidationError)
def _erro_requisicao(_req: Request, e: RequestValidationError):
    return JSONResponse({"erro": f"Requisição inválida: {e.errors()}"}, status_code=400)


@app.exception_handler(Exception)
def _erro_geral(_req: Request, e: Exception):
    return JSONResponse({"erro": str(e)}, status_code=500)


# Datas saem como texto 'yyyy-mm-dd hh:mi:ss' para não sofrerem conversão de fuso no JSON
def dt(col: str) -> str:
    return f"CONVERT(varchar(19), {col}, 120)"


def _int(v: Any, padrao: int | None = None) -> int | None:
    try:
        return int(v)
    except (TypeError, ValueError):
        return padrao


def _usuario(request: Request) -> str:
    """Quem pediu a execução: o usuário logado (não confia no que vem no corpo)."""
    u = getattr(request.state, "usuario", None)
    return (u["nome"] or u["login"])[:100] if u else "front"


# ------------------------------------------------------------------ login e usuários
@app.post("/api/login", tags=["Autenticação"], summary="Entrar: devolve o token (Bearer) e os dados do usuário")
def login(body: dict = Body(default={})):
    usuario = str(body.get("login") or "").strip().lower()
    senha = str(body.get("senha") or "")
    if not usuario or not senha:
        raise Erro(400, "Informe usuário e senha")
    if auth.bloqueado(usuario):
        raise Erro(429, "Muitas tentativas. Aguarde alguns minutos e tente de novo")
    u = db.um("SELECT id, login, nome, perfil, senha_hash, ativo FROM PY_Usuario WHERE login = ?", usuario)
    if not u or not u["ativo"] or not auth.conferir_senha(senha, u["senha_hash"]):
        auth.registrar_falha(usuario)
        raise Erro(401, "Usuário ou senha inválidos")
    auth.limpar_falhas(usuario)
    db.query("UPDATE PY_Usuario SET ultimo_acesso = SYSDATETIME() WHERE id = ?", u["id"])
    dados = {k: u[k] for k in ("id", "login", "nome", "perfil")}
    return {"token": auth.criar_token(dados), "usuario": dados, "expira_em_horas": auth.SESSAO_HORAS}


@app.get("/api/me", tags=["Autenticação"], summary="Dados do usuário logado")
def eu(request: Request):
    return request.state.usuario


@app.post("/api/me/senha", tags=["Autenticação"], summary="Trocar a minha senha (qualquer perfil)")
def trocar_minha_senha(request: Request, body: dict = Body(default={})):
    u = db.um("SELECT id, senha_hash FROM PY_Usuario WHERE id = ?", request.state.usuario["id"])
    if not u or not auth.conferir_senha(str(body.get("senha_atual") or ""), u["senha_hash"]):
        raise Erro(400, "Senha atual incorreta")
    nova = str(body.get("senha_nova") or "")
    if (erro := auth.validar_senha_nova(nova)):
        raise Erro(400, erro)
    db.query("UPDATE PY_Usuario SET senha_hash = ? WHERE id = ?", auth.hash_senha(nova), u["id"])
    return {"ok": True}


_LOGIN = re.compile(r"^[a-z0-9_.@-]{3,100}$")


@app.get("/api/usuarios", tags=["Usuários"], summary="Listar usuários")
def listar_usuarios():
    return db.query(f"""SELECT id, login, nome, perfil, ativo, {dt('criado_em')} AS criado_em,
                               {dt('ultimo_acesso')} AS ultimo_acesso
                        FROM PY_Usuario ORDER BY ativo DESC, nome""")


def _validar_usuario(body: dict, novo: bool) -> dict:
    nome = str(body.get("nome") or "").strip()
    perfil = str(body.get("perfil") or "")
    if not nome:
        raise ErroValidacao("Informe o nome")
    if perfil not in auth.PERFIS:
        raise ErroValidacao("Perfil inválido (admin ou visualizador)")
    senha = str(body.get("senha") or "")
    if novo or senha:
        if (erro := auth.validar_senha_nova(senha)):
            raise ErroValidacao(erro)
    dados = {"nome": nome[:150], "perfil": perfil, "senha": senha or None, "ativo": body.get("ativo") is not False}
    if novo:
        login = str(body.get("login") or "").strip().lower()
        if not _LOGIN.match(login):
            raise ErroValidacao("Login inválido: 3 a 100 caracteres, letras minúsculas, números, . _ - @")
        dados["login"] = login
    return dados


@app.post("/api/usuarios", status_code=201, tags=["Usuários"], summary="Criar usuário")
def criar_usuario(body: dict = Body(default={})):
    d = _validar_usuario(body, novo=True)
    if db.um("SELECT id FROM PY_Usuario WHERE login = ?", d["login"]):
        raise Erro(409, f'Já existe o usuário "{d["login"]}"')
    return db.um("INSERT INTO PY_Usuario (login, nome, perfil, senha_hash, ativo) OUTPUT inserted.id "
                 "VALUES (?, ?, ?, ?, ?)", d["login"], d["nome"], d["perfil"], auth.hash_senha(d["senha"]), d["ativo"])


@app.put("/api/usuarios/{uid}", tags=["Usuários"], summary="Editar usuário (nome, perfil, ativo, nova senha)")
def salvar_usuario(uid: int, request: Request, body: dict = Body(default={})):
    d = _validar_usuario(body, novo=False)
    if uid == request.state.usuario["id"] and (d["perfil"] != "admin" or not d["ativo"]):
        raise Erro(400, "Você não pode tirar o seu próprio perfil de administrador nem se desativar")
    alterado = db.query("UPDATE PY_Usuario SET nome = ?, perfil = ?, ativo = ?, "
                        "senha_hash = ISNULL(?, senha_hash) OUTPUT inserted.id WHERE id = ?",
                        d["nome"], d["perfil"], d["ativo"], auth.hash_senha(d["senha"]) if d["senha"] else None, uid)
    if not alterado:
        raise Erro(404, "Usuário não encontrado")
    _CACHE_USUARIO.pop(uid, None)  # vale na hora
    return {"ok": True}


# ------------------------------------------------------------------ resumo
@app.get("/api/sobre", tags=["Painel"], summary="Links da tela Sobre (README e repositório pip), vindos do .env")
def sobre():
    return {"readme_url": CFG.readme_url or None, "pip_repo": CFG.pip_repo or None, "versao": app.version}


@app.get("/api/resumo", tags=["Painel"], summary="Contadores do topo: executando, na fila, sucesso e erro de hoje")
def resumo():
    return db.um(f"""
        SELECT
          SUM(CASE WHEN status = 'PENDENTE'   THEN 1 ELSE 0 END) AS pendentes,
          SUM(CASE WHEN status = 'EXECUTANDO' THEN 1 ELSE 0 END) AS executando,
          SUM(CASE WHEN status = 'SUCESSO' AND criado_em >= CAST(SYSDATETIME() AS date) THEN 1 ELSE 0 END) AS sucesso_hoje,
          SUM(CASE WHEN status IN ('ERRO','TIMEOUT') AND criado_em >= CAST(SYSDATETIME() AS date) THEN 1 ELSE 0 END) AS erro_hoje,
          (SELECT {dt('MAX(ultimo_sinal)')} FROM PY_FilaExecucao) AS ultimo_sinal
        FROM PY_FilaExecucao""")


# ------------------------------------------------------------------ robôs
@app.get("/api/robos", tags=["Robôs"], summary="Listar robôs com a última execução")
def listar_robos():
    return db.query(f"""
        SELECT r.id, r.nome, r.ativo, r.max_concorrencia, r.timeout_min, r.tag,
               (SELECT COUNT(*) FROM PY_FilaExecucao f WHERE f.robo_id = r.id AND f.status = 'EXECUTANDO') AS executando,
               (SELECT COUNT(*) FROM PY_FilaExecucao f WHERE f.robo_id = r.id AND f.status = 'PENDENTE')   AS pendentes,
               u.status AS ultimo_status, {dt('u.fim')} AS ultimo_fim
        FROM PY_Robo r
        OUTER APPLY (SELECT TOP 1 status, fim FROM PY_FilaExecucao f
                     WHERE f.robo_id = r.id ORDER BY f.id DESC) u
        ORDER BY r.nome""")


_NOME_ROBO = re.compile(r"^[A-Za-z0-9_.-]{1,100}$")
_TAG = re.compile(r"^[a-z0-9_-]{1,50}$")


def validar_robo(body: dict) -> dict:
    nome = str(body.get("nome") or "").strip()
    if not _NOME_ROBO.match(nome):
        raise ErroValidacao("Nome do robô inválido: use letras, números, _ - . (sem espaço). "
                            "Deve ser o mesmo nome usado pelo bootstrap.")
    maximo = _int(body.get("max_concorrencia", 1))
    timeout = _int(body.get("timeout_min", 60))
    if maximo is None or not 1 <= maximo <= 20:
        raise ErroValidacao("Execuções simultâneas deve ficar entre 1 e 20")
    if timeout is None or not 1 <= timeout <= 1440:
        raise ErroValidacao("Timeout deve ficar entre 1 e 1440 minutos")
    repo = str(body.get("caminho_repositorio") or "").strip()
    if len(repo) > 500:
        raise ErroValidacao("Caminho do repositório muito longo (máx. 500)")
    if repo and not re.match(r"^https?://", repo, re.I):
        raise ErroValidacao("Caminho do repositório deve começar com https://")
    tag = str(body.get("tag") or "").strip().lower()
    if tag and not _TAG.match(tag):
        raise ErroValidacao("Runner (tag) inválido: use letras minúsculas, números, _ ou - (ex.: sap)")
    return {"nome": nome, "max": maximo, "timeout": timeout, "repo": repo or None, "tag": tag or None,
            "ativo": body.get("ativo") is not False, "campos": validar_definicao(body.get("campos"))}


def gravar_campos(tx: db.Transacao, robo_id: int, campos: list[dict]) -> None:
    tx.exec("DELETE FROM PY_RoboParametro WHERE robo_id = ?", robo_id)
    for c in campos:
        tx.exec("INSERT INTO PY_RoboParametro (robo_id, chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda, ordem) "
                "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
                robo_id, c["chave"], c["rotulo"], c["tipo"], c["obrigatorio"], c["padrao"], c["opcoes"],
                c["ajuda"], c["ordem"])


@app.get("/api/robos/{robo_id}", tags=["Robôs"], summary="Obter um robô com os campos de parâmetro")
def obter_robo(robo_id: int):
    r = db.um("SELECT id, nome, ativo, max_concorrencia, timeout_min, caminho_repositorio, tag "
              "FROM PY_Robo WHERE id = ?", robo_id)
    if not r:
        raise Erro(404, "Robô não encontrado")
    campos = [{**c, "opcoes": opcoes_para_texto(c["opcoes"]), "padrao": c["padrao"] or ""}
              for c in campos_do_robo(robo_id)]
    return {**r, "campos": campos}


@app.post("/api/robos", status_code=201, tags=["Robôs"], summary="Cadastrar robô")
def criar_robo(body: dict = Body(default={})):
    r = validar_robo(body)
    if db.um("SELECT id FROM PY_Robo WHERE nome = ?", r["nome"]):
        raise Erro(409, f'Já existe um robô chamado "{r["nome"]}"')
    with db.transacao() as tx:
        novo = tx.exec("INSERT INTO PY_Robo (nome, ativo, max_concorrencia, timeout_min, caminho_repositorio, tag) "
                       "OUTPUT inserted.id VALUES (?, ?, ?, ?, ?, ?)",
                       r["nome"], r["ativo"], r["max"], r["timeout"], r["repo"], r["tag"])[0]
        gravar_campos(tx, novo["id"], r["campos"])
    return {"id": novo["id"]}


@app.put("/api/robos/{robo_id}", tags=["Robôs"], summary="Editar robô")
def salvar_robo(robo_id: int, body: dict = Body(default={})):
    r = validar_robo(body)
    if db.um("SELECT id FROM PY_Robo WHERE nome = ? AND id <> ?", r["nome"], robo_id):
        raise Erro(409, f'Já existe um robô chamado "{r["nome"]}"')
    with db.transacao() as tx:
        upd = tx.exec("UPDATE PY_Robo SET nome = ?, ativo = ?, max_concorrencia = ?, timeout_min = ?, "
                      "caminho_repositorio = ?, tag = ? OUTPUT inserted.id WHERE id = ?",
                      r["nome"], r["ativo"], r["max"], r["timeout"], r["repo"], r["tag"], robo_id)
        if not upd:
            raise Erro(404, "Robô não encontrado")
        gravar_campos(tx, robo_id, r["campos"])
    return {"ok": True}


@app.patch("/api/robos/{robo_id}", tags=["Robôs"], summary="Ativar ou desativar robô")
def ativar_robo(robo_id: int, body: dict = Body(default={})):
    ativo = body.get("ativo")
    if not isinstance(ativo, bool):
        raise Erro(400, 'Informe "ativo": true/false')
    db.query("UPDATE PY_Robo SET ativo = ? WHERE id = ?", ativo, robo_id)
    return {"ok": True}


@app.get("/api/robos/{robo_id}/parametros", tags=["Robôs"], summary="Campos de parâmetro do robô (formulário de execução)")
def parametros_robo(robo_id: int):
    return campos_do_robo(robo_id)


@app.post("/api/robos/{robo_id}/executar", status_code=201, tags=["Execuções"], summary="Colocar o robô na fila agora (execução manual)")
def executar_robo(robo_id: int, request: Request, body: dict = Body(default={})):
    robo = db.um("SELECT id, ativo FROM PY_Robo WHERE id = ?", robo_id)
    if not robo:
        raise Erro(404, "Robô não encontrado")
    if not robo["ativo"]:
        raise Erro(409, "Robô está inativo")
    try:
        parametros = preparar_parametros(robo_id, body.get("parametros"))
    except ErroValidacao as e:
        raise Erro(400, f"Parâmetros inválidos: {e}") from e
    return db.um("INSERT INTO PY_FilaExecucao (robo_id, origem, solicitado_por, parametros) "
                 "OUTPUT inserted.id VALUES (?, 'MANUAL', ?, ?)", robo_id, _usuario(request), parametros)


# ------------------------------------------------------------------ execuções
_DURACAO = "CASE WHEN f.inicio IS NULL THEN NULL ELSE DATEDIFF(SECOND, f.inicio, ISNULL(f.fim, SYSDATETIME())) END"


@app.get("/api/execucoes", tags=["Execuções"], summary="Listar execuções (filtros: limite, status, robo_id)")
def listar_execucoes(limite: str | None = None, status: str | None = None, robo_id: str | None = None):
    n = min(_int(limite) or 100, 500)
    filtros, params = [], [n]
    if status:
        filtros.append("f.status = ?")
        params.append(status)
    if robo_id and _int(robo_id) is not None:
        filtros.append("f.robo_id = ?")
        params.append(_int(robo_id))
    where = ("WHERE " + " AND ".join(filtros)) if filtros else ""
    return db.query(f"""
        SELECT TOP (?) f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.parametros,
               f.status, f.worker, f.pid, f.exit_code, f.mensagem, f.agendamento_id,
               f.cancelar_solicitado,
               {dt('f.criado_em')} AS criado_em, {dt('f.inicio')} AS inicio, {dt('f.fim')} AS fim,
               {_DURACAO} AS duracao_s
        FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
        {where}
        ORDER BY f.id DESC""", *params)


@app.get("/api/execucoes/{exec_id}", tags=["Execuções"], summary="Detalhes de uma execução")
def obter_execucao(exec_id: int):
    e = db.um(f"""
        SELECT f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.parametros, f.status, f.worker, f.pid,
               f.exit_code, f.mensagem, f.resultado, f.agendamento_id, f.cancelar_solicitado, f.log_arquivo,
               {dt('f.criado_em')} AS criado_em, {dt('f.inicio')} AS inicio, {dt('f.fim')} AS fim,
               {_DURACAO} AS duracao_s
        FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
        WHERE f.id = ?""", exec_id)
    if not e:
        raise Erro(404, "Execução não encontrada")
    return e


@app.post("/api/execucoes/{exec_id}/reexecutar", status_code=201, tags=["Execuções"], summary="Reexecutar com os mesmos parâmetros")
def reexecutar(exec_id: int, request: Request):
    orig = db.um("SELECT f.id, f.robo_id, f.parametros, r.nome AS robo, r.ativo "
                 "FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id WHERE f.id = ?", exec_id)
    if not orig:
        raise Erro(404, "Execução não encontrada")
    if not orig["ativo"]:
        raise Erro(409, f"O robô {orig['robo']} está inativo — ative-o na aba Robôs para executar")
    novo = db.um("INSERT INTO PY_FilaExecucao (robo_id, origem, solicitado_por, parametros) "
                 "OUTPUT inserted.id VALUES (?, 'MANUAL', ?, ?)",
                 orig["robo_id"], _usuario(request), orig["parametros"] or "{}")
    return {"id": novo["id"], "origem_id": orig["id"]}


@app.post("/api/execucoes/{exec_id}/cancelar", tags=["Execuções"], summary="Cancelar (pendente sai da fila; em execução é encerrada pelo worker)")
def cancelar(exec_id: int):
    # PENDENTE: cancela direto. EXECUTANDO: pede ao worker para matar o processo.
    r = db.um("""
        UPDATE PY_FilaExecucao
        SET status = CASE WHEN status = 'PENDENTE' THEN 'CANCELADO' ELSE status END,
            fim    = CASE WHEN status = 'PENDENTE' THEN SYSDATETIME() ELSE fim END,
            mensagem = CASE WHEN status = 'PENDENTE' THEN 'Cancelado antes de iniciar' ELSE mensagem END,
            cancelar_solicitado = 1
        OUTPUT deleted.status AS status_anterior
        WHERE id = ? AND status IN ('PENDENTE', 'EXECUTANDO')""", exec_id)
    if not r:
        raise Erro(409, "Execução não está pendente nem em execução")
    return {"ok": True, "status_anterior": r["status_anterior"]}


LOG_MAX = 200 * 1024  # devolve só o final de logs grandes


def _final_do_arquivo(caminho: Path) -> str:
    tamanho = caminho.stat().st_size
    with open(caminho, "rb") as f:
        f.seek(max(0, tamanho - LOG_MAX))
        texto = f.read().decode("utf-8", errors="replace")
    return ("... (início do log omitido)\n" + texto) if tamanho > LOG_MAX else texto


@app.get("/api/execucoes/{exec_id}/log", response_class=PlainTextResponse, tags=["Execuções"], summary="Log da execução (arquivo do runner ou cópia gravada no banco)")
def log_execucao(exec_id: int):
    """Log da execução. Com vários runners o arquivo fica no disco de cada um, então:
    1) se a API enxerga o arquivo (mesma máquina ou ORQ_PASTA_LOGS em pasta de rede), lê dele (mais atual);
    2) senão usa a cópia que o worker grava no banco (log_texto: a cada ~30 s e ao terminar).
    O caminho vem SEMPRE do banco (nunca do cliente)."""
    f = db.um("SELECT log_arquivo, log_texto, status, worker FROM PY_FilaExecucao WHERE id = ?", exec_id)
    if not f:
        return "(execução não encontrada)"
    if f["log_arquivo"]:
        arq = Path(f["log_arquivo"])
        try:
            if arq.is_file():
                return _final_do_arquivo(arq)
        except OSError:
            pass
    if f["log_texto"]:
        texto = f["log_texto"]
        return (texto[-LOG_MAX:] if len(texto) > LOG_MAX else texto)
    if f["status"] == "PENDENTE":
        return "(aguardando na fila: ainda não há log)"
    if f["status"] == "EXECUTANDO":
        return (f"(executando no runner {f['worker'] or '?'} — o log aparece aqui em até "
                f"30 segundos)")
    return "(sem log)"


# ------------------------------------------------------------------ fila de processamento
def agora_no_fuso() -> datetime:
    return datetime.now(ZoneInfo(CFG.fuso)).replace(tzinfo=None, microsecond=0)


def _texto(d: datetime | None) -> str | None:
    return d.strftime("%Y-%m-%d %H:%M:%S") if d else None


def _de_texto(s: str) -> datetime:
    return datetime.strptime(s[:19], "%Y-%m-%d %H:%M:%S")


def ocorrencias(regra: Regra, primeira: datetime, ate: datetime, limite: int = 20000) -> list[datetime]:
    """Ocorrências a partir de `primeira` (inclusive) até `ate`, no máximo `limite`."""
    lista: list[datetime] = []
    t: datetime | None = primeira
    while t and t <= ate and len(lista) < limite:
        lista.append(t)
        try:
            t = regra.proxima(t)
        except RegraInvalida:
            t = None
    return lista


_DIAS_PERIODO = {"hoje": 0, "amanha": 1, "7d": 7}


@app.get("/api/fila", tags=["Fila"], summary="Fila de processamento: executando, aguardando e próximas ocorrências dos agendamentos")
def fila(periodo: str = "hoje", robo_id: str | None = None):
    """Tudo que ainda vai rodar: em execução, aguardando na fila e as próximas ocorrências dos agendamentos."""
    periodo = periodo if periodo in _DIAS_PERIODO else "hoje"
    rid = _int(robo_id) if robo_id else None
    filtro, params = ("AND f.robo_id = ?", [rid]) if rid else ("", [])

    em_fila = db.query(f"""
        SELECT f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.status, f.agendamento_id,
               f.cancelar_solicitado, {dt('f.criado_em')} AS criado_em, {dt('f.inicio')} AS inicio,
               CASE WHEN f.inicio IS NULL THEN NULL ELSE DATEDIFF(SECOND, f.inicio, SYSDATETIME()) END AS duracao_s
        FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
        WHERE f.status IN ('EXECUTANDO', 'PENDENTE') {filtro}
        ORDER BY CASE f.status WHEN 'EXECUTANDO' THEN 0 ELSE 1 END, f.criado_em""", *params)

    ags = db.query(f"""
        SELECT a.id, a.robo_id, r.nome AS robo, r.ativo AS robo_ativo, a.dias, a.horario, a.intervalo,
               a.descricao, {dt('a.proxima_execucao')} AS proxima_execucao
        FROM PY_Agendamento a JOIN PY_Robo r ON r.id = a.robo_id
        WHERE a.ativo = 1 {'AND a.robo_id = ?' if rid else ''}""", *params)

    agora = agora_no_fuso()
    ate = datetime.combine(agora.date() + timedelta(days=_DIAS_PERIODO[periodo]), datetime.max.time()).replace(microsecond=0)

    # Agrupa por robô: quantas execuções no período, a próxima e o resumo de cada agendamento
    robos: dict[int, dict] = {}
    for a in ags:
        g = robos.setdefault(a["robo_id"], {"robo_id": a["robo_id"], "robo": a["robo"], "robo_inativo": not a["robo_ativo"],
                                            "total": 0, "proxima": None, "atrasada": False, "agendamentos": []})
        item: dict[str, Any] = {"agendamento_id": a["id"], "descricao": a["descricao"], "total": 0, "proxima": None}
        g["agendamentos"].append(item)
        if not a["proxima_execucao"]:
            item["aviso"] = "aguardando o worker calcular a primeira execução"
            continue
        try:
            lista = ocorrencias(Regra.de_colunas(a["dias"], a["horario"], a["intervalo"]),
                                _de_texto(a["proxima_execucao"]), ate)
        except RegraInvalida as e:
            item["aviso"] = f"regra inválida: {e}"
            continue
        item["total"] = len(lista)
        item["proxima"] = _texto(lista[0]) if lista else None
        if not lista:
            item["proxima_fora"] = a["proxima_execucao"]  # próxima existe, mas fora do período
        g["total"] += len(lista)
        if item["proxima"] and (not g["proxima"] or item["proxima"] < g["proxima"]):
            g["proxima"] = item["proxima"]
        if lista and lista[0] < agora:
            g["atrasada"] = True

    avisos = [{"robo": g["robo"], **it} for g in robos.values() for it in g["agendamentos"] if it.get("aviso")]
    por_robo = sorted(robos.values(), key=lambda g: (g["proxima"] is None, g["proxima"] or "", g["robo"]))

    return {
        "agora": _texto(agora), "fuso": CFG.fuso, "periodo": periodo, "ate": _texto(ate),
        "em_execucao": [f for f in em_fila if f["status"] == "EXECUTANDO"],
        "pendentes": [f for f in em_fila if f["status"] == "PENDENTE"],
        "por_robo": por_robo,
        "avisos": avisos,
    }


# ------------------------------------------------------------------ agendamentos
@app.get("/api/agendamentos", tags=["Agendamentos"], summary="Listar agendamentos")
def listar_agendamentos():
    return db.query(f"""
        SELECT a.id, a.robo_id, r.nome AS robo, a.dias, a.horario, a.intervalo,
               a.parametros, a.ativo, a.descricao, {dt('a.proxima_execucao')} AS proxima_execucao
        FROM PY_Agendamento a JOIN PY_Robo r ON r.id = a.robo_id
        ORDER BY a.ativo DESC, r.nome, a.id""")


def _vazio(v: Any) -> str | None:
    return str(v).strip() if v is not None and str(v).strip() else None


@app.post("/api/agendamentos", status_code=201, tags=["Agendamentos"], summary="Criar agendamento")
def criar_agendamento(body: dict = Body(default={})):
    robo_id = _int(body.get("robo_id"))
    if not robo_id:
        raise Erro(400, "Informe o robô")
    if not body.get("horario") and not body.get("intervalo"):
        raise Erro(400, "Informe o horário ou o intervalo")
    try:
        parametros = preparar_parametros(robo_id, body.get("parametros"), agenda=True)
    except ErroValidacao as e:
        raise Erro(400, f"Parâmetros inválidos: {e}") from e
    return db.um("INSERT INTO PY_Agendamento (robo_id, dias, horario, intervalo, parametros, ativo, descricao) "
                 "OUTPUT inserted.id VALUES (?, ?, ?, ?, ?, 1, N'aguardando o worker validar...')",
                 robo_id, _vazio(body.get("dias")), _vazio(body.get("horario")), _vazio(body.get("intervalo")),
                 parametros)


@app.patch("/api/agendamentos/{ag_id}", tags=["Agendamentos"], summary="Ativar ou desativar agendamento")
def ativar_agendamento(ag_id: int, body: dict = Body(default={})):
    ativo = body.get("ativo")
    if not isinstance(ativo, bool):
        raise Erro(400, 'Informe "ativo": true/false')
    # Ao reativar, zera proxima_execucao: o worker recalcula a partir de agora (sem disparo atrasado)
    db.query("UPDATE PY_Agendamento SET ativo = ?, "
             "proxima_execucao = CASE WHEN ? = 1 THEN NULL ELSE proxima_execucao END WHERE id = ?",
             ativo, ativo, ag_id)
    return {"ok": True}


@app.delete("/api/agendamentos/{ag_id}", tags=["Agendamentos"], summary="Excluir agendamento")
def excluir_agendamento(ag_id: int):
    db.query("DELETE FROM PY_Agendamento WHERE id = ?", ag_id)
    return {"ok": True}


# ------------------------------------------------------------------ front compilado (npm run build)
# Montado por último: as rotas /api/* acima têm prioridade.
if CFG.pasta_front.is_dir():
    app.mount("/", StaticFiles(directory=CFG.pasta_front, html=True), name="front")


if __name__ == "__main__":
    import uvicorn

    print(f"API do orquestrador em http://localhost:{CFG.porta}  (docs: /docs)"
          + (f" · front: {CFG.pasta_front}" if CFG.pasta_front.is_dir() else " · front: use npm run dev"))
    uvicorn.run(app, host=CFG.host, port=CFG.porta)
