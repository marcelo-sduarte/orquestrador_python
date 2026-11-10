# Orquestrador de Robôs Python

Serviço em Python que **agenda, enfileira e executa** robôs Python a partir de tabelas no SQL Server.
O front (ou qualquer pessoa no SSMS) só grava pedidos no banco; o worker faz o resto.

---

## 1. Visão geral

```
            ┌──────────────┐        ┌───────────────────┐
  Front ───▶│  API / SSMS  │──────▶│  fila_execucao     │◀──────┐
            └──────────────┘ INSERT └───────────────────┘       │
                                         ▲        │ claim       │ INSERT
            ┌──────────────┐             │        ▼             │
            │ agendamento  │──── agendador.py ─── worker.py ────┘
            └──────────────┘   (cron → fila)        │
                                                    │ subprocess
                                                    ▼
                                    python bootstrap.py <robo>
                                                    │
                                    log em arquivo + status no banco
```

**Princípios**
- O front **nunca** executa nada: só insere/atualiza linhas no banco.
- Execução manual e agendada passam pelo **mesmo caminho** (a fila).
- Tudo fica registrado: quem pediu, quando, PID, duração, exit code, log.
- Pode haver vários workers (várias VMs) lendo a mesma fila sem conflito.

---

## 2. Estrutura do projeto

```
orquestrador/
├── worker/   ← worker Python: worker.py, agendador.py, executor.py, regra_agenda.py, db.py,
│               config.py, requirements.txt, .env
├── api/      ← API Node/Express usada pelo front          (ver README-WEB.md)
├── front/    ← front React/Vite                             (ver README-WEB.md)
├── env/      ← venv do worker (não versionado)
└── sql/
    ├── 00_criar_tabelas.sql    ← banco novo: cria todas as tabelas no estado atual
    └── migracoes/              ← banco existente: ALTERs em ordem (01 → 05)
```

Arquivos do worker (pasta `worker/`):

| Arquivo | Responsabilidade |
|---|---|
| `worker.py` | Loop principal. A cada ciclo: processa agenda, recupera órfãos, pega jobs da fila e os executa em threads. |
| `agendador.py` | Lê `agendamento`, transforma horários vencidos em linhas na `fila_execucao` e calcula a próxima execução. |
| `executor.py` | Executa um job: inicia o `bootstrap.py`, grava log, envia heartbeat, trata cancelamento e timeout, mata a árvore de processos. |
| `regra_agenda.py` | Interpreta `dias` / `horario` / `intervalo`, calcula a próxima execução e gera a descrição. |
| `db.py` | Todas as queries SQL. Nenhum outro arquivo fala com o banco diretamente. |
| `config.py` | Lê a configuração do `.env` / variáveis de ambiente. |
| `.env` | Configuração da máquina (string de conexão, caminhos, intervalos). |
| `sql/00_criar_tabelas.sql` | Cria `robo`, `robo_parametro`, `agendamento` e `fila_execucao` completas (banco novo). |
| `sql/migracoes/01..05` | Atualizam um banco criado com versões anteriores (ver `sql/migracoes/LEIA-ME.md`). |
| `api/`, `front/` | Interface web de operação — instruções em `README-WEB.md`. |
| `requirements.txt` | `pyodbc`, `croniter`, `psutil`, `python-dotenv`. |

---

## 3. Tabelas

### `robo` — cadastro dos robôs
| Coluna | Uso |
|---|---|
| `id` | Identificador |
| `nome` | Nome passado ao bootstrap (`python bootstrap.py <nome>`) |
| `ativo` | `0` = robô não executa (nem manual, nem agenda) |
| `max_concorrencia` | Quantas execuções simultâneas deste robô são permitidas (somando todos os workers) |
| `timeout_min` | Tempo máximo de execução; ao passar, o processo é morto (`TIMEOUT`) |

### `agendamento` — quando cada robô roda
| Coluna | Uso |
|---|---|
| `robo_id` | Robô a executar |
| `dias` | Dias da semana: `SEG-SEX`, `SEG,QUA,SEX`, `TODOS`, `UTEIS`, `FDS`. Vazio = todos |
| `horario` | `09:00` (uma vez) ou janela `08:00-18:00`. Vazio = dia todo |
| `intervalo` | `15min`, `30min`, `1h`, `1h30`, `90` (minutos). Vazio = uma vez no horário |
| `cron` | *Opcional/avançado.* Se preenchido, tem prioridade sobre as três colunas acima |
| `parametros` | JSON enviado ao robô |
| `ativo` | `0` = agendamento pausado |
| `descricao` | Preenchida pelo worker: como ele entendeu a regra (ou `ERRO: ...`) |
| `proxima_execucao` | Calculada pelo agendador. `NULL` = agendamento novo |

#### Como preencher

| dias | horario | intervalo | Resultado (`descricao`) |
|---|---|---|---|
| `SEG-SEX` | `08:00-18:00` | `15min` | Seg a Sex · das 08:00 às 18:00 · a cada 15 min |
| `UTEIS` | `09:00` | | Seg a Sex · às 09:00 |
| `SEG,QUA,SEX` | `07:00-19:00` | `1h` | Seg, Qua, Sex · das 07:00 às 19:00 · a cada 1h |
| `SAB-DOM` | `10:00` | | Fim de semana · às 10:00 |
| `SEX-SEG` | `08:30-12:00` | `30min` | Sex a Seg · das 08:30 às 12:00 · a cada 30 min |
| `TODOS` | | `2h` | Todos os dias · o dia todo · a cada 2h |

Regras:
- **Horário único sem intervalo** → roda uma vez por dia.
- **Janela + intervalo** → roda a cada X minutos; início e fim **inclusos** (`08:00-18:00` a cada 1h roda às 08:00 … 18:00).
- **Sem horário + intervalo** → o dia todo, a partir de 00:00.
- Janela sem intervalo, ou horário único com intervalo → **inválido**: o agendamento é desativado e o motivo aparece em `descricao`.
- Formatos aceitos: dias `SEG`/`Segunda`/`seg` (sem diferença de acento ou maiúsculas); horas `8`, `8h`, `08:00`, `8h30`; janelas `8-18` ou `8h às 18h`.

```sql
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG-SEX', '08:00-18:00', '15min', '{}', 1 FROM robo WHERE nome = 'eco_bot';

SELECT id, dias, horario, intervalo, descricao, proxima_execucao, ativo FROM agendamento;
```

#### Cron (avançado)
Para regras que as colunas acima não cobrem (ex.: dia 1 de cada mês), preencha `cron` e deixe as outras vazias:

| Cron | Significado |
|---|---|
| `30 6 1 * *` | Dia 1 de cada mês às 06:30 |
| `0 9 1-7 * 1` | Primeira segunda-feira do mês às 09:00 |

### `fila_execucao` — cada execução (pedida, rodando ou finalizada)
| Coluna | Uso |
|---|---|
| `robo_id`, `parametros` | O que executar |
| `origem` | `MANUAL` ou `AGENDA` |
| `solicitado_por` | Usuário do front ou `agendador` |
| `agendamento_id` | Agendamento que gerou a execução (se `AGENDA`) |
| `status` | Ver ciclo de vida abaixo |
| `worker`, `pid` | Máquina e processo que está executando |
| `heartbeat` | Atualizado a cada ~10 s enquanto roda |
| `inicio`, `fim`, `exit_code` | Resultado |
| `cancelar_solicitado` | `1` = pedir ao worker que mate o processo |
| `mensagem` | Motivo do erro/cancelamento/timeout (últimas linhas do log em caso de erro) |
| `log_arquivo` | Caminho do log completo da execução |
| `criado_em` | Momento do pedido (ordem da fila) |

---

## 4. Ciclo de vida de uma execução

```
PENDENTE ──claim──▶ EXECUTANDO ──┬──▶ SUCESSO     (exit code 0)
                                 ├──▶ ERRO        (exit code ≠ 0, falha ao iniciar, órfão)
                                 ├──▶ CANCELADO   (cancelar_solicitado = 1)
                                 └──▶ TIMEOUT     (passou de robo.timeout_min)
```

---

## 5. Como funciona, passo a passo

### 5.1 Loop do worker (`worker.py`)
A cada `ORQ_POLL_S` segundos (padrão 5):
1. **A cada `ORQ_AGENDA_S` (30 s):** roda o agendador e procura jobs órfãos.
2. **Enquanto houver vaga** (`ORQ_MAX_JOBS`), pega o próximo job `PENDENTE` e o entrega a uma thread.

Ao iniciar, o worker marca como `ERRO – Interrompido` qualquer job que estava `EXECUTANDO`
com o nome dele (ele foi desligado no meio da execução).

### 5.2 Agendamento (`agendador.py`)
- Seleciona agendamentos ativos com `proxima_execucao <= agora`, com lock (`UPDLOCK, READPAST`)
  para dois workers não gerarem a mesma execução.
- Se `proxima_execucao` é `NULL` (agendamento novo): **só calcula** a próxima, não executa na hora.
- Se venceu: insere **uma** linha na fila e calcula a próxima a partir de agora.
  Se o worker ficou parado (ex.: fim de semana), roda **uma vez** ao voltar, não uma por horário perdido.
- Cron inválido: o agendamento é desativado e o erro vai para o `worker.log`.

### 5.3 Pegar job da fila (claim — `db.py`)
- `sp_getapplock` serializa o claim entre workers (dura milissegundos).
- `UPDATE TOP(1) ... WITH (UPDLOCK, READPAST)` pega o `PENDENTE` mais antigo **cujo robô está ativo e
  ainda não atingiu `max_concorrencia`** e já o marca como `EXECUTANDO` na mesma instrução.
- Resultado: o mesmo job nunca é executado duas vezes, e o limite por robô vale para todas as VMs.

### 5.4 Execução (`executor.py`)
1. Valida que `parametros` é JSON.
2. Inicia `ORQ_PYTHON ORQ_BOOTSTRAP <nome_do_robo>` com stdout/stderr redirecionados para
   `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log`.
3. Grava `pid` e `log_arquivo` no banco.
4. A cada `ORQ_HEARTBEAT_S` (10 s): atualiza `heartbeat` e verifica
   cancelamento → timeout → desligamento do worker. Qualquer um deles **mata a árvore de processos**
   (bootstrap, Python do venv, chromedriver, navegador...).
5. Ao terminar, grava `status`, `exit_code`, `fim` e `mensagem`.

### 5.5 Proteção contra órfãos
Se um job está `EXECUTANDO` e o `heartbeat` não é atualizado há mais de `ORQ_ORFAO_S` (120 s),
o worker que o executava morreu (VM caiu, processo morto). Qualquer worker ativo o marca como `ERRO`.

---

## 6. Contrato com o robô e parâmetros

### 6.1 Como o robô é chamado
```
<ORQ_PYTHON> <ORQ_BOOTSTRAP> <robo.nome>
```
Variáveis de ambiente disponíveis para o bootstrap **e para o robô** (processos filhos herdam):

| Variável | Conteúdo |
|---|---|
| `ORQ_EXECUCAO_ID` | `fila_execucao.id` — use para correlacionar com os logs do robô |
| `ORQ_ROBO` | Nome do robô |
| `ORQ_PARAMS` | JSON de `parametros` |

> Se o `bootstrap.py` chamar o robô com `subprocess(..., env=...)`, monte o `env` a partir de
> `os.environ.copy()`; caso contrário o robô perde as variáveis `ORQ_*`.

Exit code: **`0` = SUCESSO**, qualquer outro = ERRO (use `sys.exit(1)` em falhas de negócio).
Tudo que o robô imprimir vai para o log da execução.

### 6.2 Fluxo dos parâmetros
```
agendamento.parametros ──(copiado a cada execução)──┐
front / SSMS ─────────────────INSERT────────────────┴─▶ fila_execucao.parametros
        ──▶ worker valida JSON ──▶ ORQ_PARAMS ──▶ bootstrap ──▶ robô
```
- `parametros` precisa ser **JSON válido**; se não for, o job vai para `ERRO` sem iniciar o robô.
- Vai por variável de ambiente (não linha de comando) para evitar problemas de aspas no Windows.
- O JSON do agendamento é **fixo**: valores que mudam a cada execução (ex.: "data de hoje")
  devem ser calculados pelo robô quando o parâmetro não vier.

### 6.3 Leitura no robô (com valores padrão)
```python
import json, os, sys
from datetime import date

def carregar_parametros() -> dict:
    bruto = os.getenv("ORQ_PARAMS", "{}")
    try:
        p = json.loads(bruto)
    except json.JSONDecodeError:
        print(f"ORQ_PARAMS inválido: {bruto!r}")
        sys.exit(2)
    return {
        "data": date.fromisoformat(p["data"]) if p.get("data") else date.today(),
        "cliente": p.get("cliente", "TODOS"),
        "reprocessar": bool(p.get("reprocessar", False)),
    }

execucao_id = os.getenv("ORQ_EXECUCAO_ID", "local")
params = carregar_parametros()
print(f"execucao={execucao_id} params={params}")
```
Teste fora do orquestrador (Git Bash): `ORQ_PARAMS='{"data":"2026-11-01"}' python robo.py`

### 6.4 Exemplos
```sql
-- Padrões do robô (data = hoje)
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{}' FROM robo WHERE nome = 'eco_bot';

-- Reprocessar um dia
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"data":"2026-11-03","reprocessar":true}' FROM robo WHERE nome = 'eco_bot';

-- Mesmo robô, dois clientes na agenda
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'UTEIS', '08:00', NULL, '{"cliente":"TAESA"}', 1 FROM robo WHERE nome = 'eco_bot';

-- Consultar por parâmetro
SELECT id, status, JSON_VALUE(parametros, '$.cliente') AS cliente FROM fila_execucao;

-- (Recomendado) bloquear JSON inválido no banco
ALTER TABLE fila_execucao ADD CONSTRAINT CK_fila_parametros_json CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
ALTER TABLE agendamento  ADD CONSTRAINT CK_agenda_parametros_json CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
```

### 6.5 Boas práticas
- **Nunca senhas** em `parametros`: ficam em texto no banco e no log. Use `.env`/cofre do robô.
- **Parâmetros pequenos**: passe ids e caminhos, não dados (limite de ~32 mil caracteres no Windows).
- Caminhos no JSON: `"C:/pasta/arquivo.pdf"` (barra normal) ou `"C:\\pasta\\arquivo.pdf"`.
- **Valor padrão para tudo**: o robô não deve quebrar por falta de uma chave.
- **Logue os parâmetros** no início da execução.

---

## 7. Operação pelo banco (o que o front faz)

```sql
-- Executar agora
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"data":"2026-11-06"}' FROM robo WHERE nome = 'eco_bot';

-- Cancelar uma execução em andamento
UPDATE fila_execucao SET cancelar_solicitado = 1 WHERE id = 123 AND status = 'EXECUTANDO';

-- Cancelar antes de começar
UPDATE fila_execucao SET status = 'CANCELADO', fim = SYSDATETIME() WHERE id = 123 AND status = 'PENDENTE';

-- Criar agendamento
INSERT INTO agendamento (robo_id, cron, parametros, ativo)
SELECT id, '0 9 * * 1-5', '{}', 1 FROM robo WHERE nome = 'eco_bot';

-- Pausar agendamento / robô
UPDATE agendamento SET ativo = 0 WHERE id = 1;
UPDATE robo SET ativo = 0 WHERE nome = 'eco_bot';

-- Monitorar
SELECT TOP 50 f.id, r.nome, f.origem, f.status, f.inicio, f.fim, f.exit_code, f.mensagem
FROM fila_execucao f JOIN robo r ON r.id = f.robo_id
ORDER BY f.id DESC;
```

---

## 8. Configuração (`worker/.env`)

| Variável | Padrão | Descrição |
|---|---|---|
| `ORQ_CONN_STR` | — | String ODBC. Local: `DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=RPA;Trusted_Connection=yes;TrustServerCertificate=yes;` |
| `ORQ_WORKER_NOME` | hostname | Nome gravado em `fila_execucao.worker` |
| `ORQ_PYTHON` | — | Python **base** que roda o bootstrap (não o venv do orquestrador) |
| `ORQ_BOOTSTRAP` | — | Caminho do `bootstrap.py` |
| `ORQ_PASTA_LOGS` | — | Pasta dos logs (worker + um arquivo por execução) |
| `ORQ_MAX_JOBS` | `2` | Jobs simultâneos neste worker |
| `ORQ_POLL_S` | `5` | Intervalo de busca na fila (s) |
| `ORQ_AGENDA_S` | `30` | Intervalo de verificação da agenda (s) |
| `ORQ_HEARTBEAT_S` | `10` | Intervalo de heartbeat/cancelamento (s) |
| `ORQ_ORFAO_S` | `120` | Heartbeat parado por mais que isso = órfão (s) |
| `ORQ_FUSO` | `America/Sao_Paulo` | Fuso em que o cron é interpretado |
| `ORQ_AMBIENTE` | `DEV` | `ambiente` enviado ao bootstrap (DEV, HML ou PROD) |

> **Fuso horário:** `proxima_execucao` segue `ORQ_FUSO`; `criado_em`, `inicio`, `fim` e `heartbeat`
> vêm do relógio do SQL Server. Mantenha os dois no mesmo fuso para não confundir o front
> (ex.: em teste local em Portugal use `ORQ_FUSO=Europe/Lisbon`).

---

## 9. Instalação

```bat
cd C:\caminho\orquestrador
python -m venv env
env\Scripts\pip install -r worker\requirements.txt
copy worker\.env.example worker\.env        &:: editar
```

No SSMS, **banco novo**: rode `sql/00_criar_tabelas.sql` (troque `USE RPA;` pelo nome do seu banco).
**Banco já existente**: rode `sql/migracoes/01` a `05`, em ordem — todos podem ser rodados mais de uma vez.

### Executar no console (teste)
```bat
cd C:\caminho\orquestrador
env\Scripts\python worker\worker.py
```
Deve aparecer `Worker 'LOCAL' iniciando (max 2 jobs)`. Sem jobs na fila o console fica em silêncio — é normal.
`Ctrl+C` encerra (aguarda os jobs em andamento terminarem).

### Executar como serviço do Windows (NSSM)
```bat
nssm install OrquestradorRobos C:\caminho\orquestrador\env\Scripts\python.exe C:\caminho\orquestrador\worker\worker.py
nssm set OrquestradorRobos AppDirectory C:\caminho\orquestrador\worker
nssm set OrquestradorRobos AppStopMethodConsole 60000
nssm set OrquestradorRobos AppExit Default Restart
nssm set OrquestradorRobos ObjectName .\usuario senha   &:: usuário com acesso ao banco
nssm start OrquestradorRobos
```

> Robôs que abrem **navegador visível** ou fazem automação de tela não funcionam como serviço
> (sessão 0). Para esses, rode o worker pelo Agendador de Tarefas, gatilho "Ao fazer logon".

---

## 10. Testes de validação

Os testes usam um **bootstrap falso** no lugar do real, para validar o orquestrador sem depender
de nenhum robô. Ele entende só dois parâmetros, criados para teste:

| Parâmetro | Efeito no `bootstrap_fake.py` |
|---|---|
| `dorme` | Quantos segundos o "robô" fica trabalhando (padrão 5) |
| `exit` | Código de saída ao terminar (padrão 0 = sucesso) |

> `dorme` e `exit` **não existem nos robôs reais** — cada robô define os próprios parâmetros (ver seção 6).

`bootstrap_fake.py`:
```python
import os, sys, time, json
p = json.loads(os.environ.get("ORQ_PARAMS", "{}"))
print(f"robo={sys.argv[1]} execucao={os.environ.get('ORQ_EXECUCAO_ID')} params={p}", flush=True)
for i in range(p.get("dorme", 5)):
    print(f"trabalhando... {i+1}", flush=True)
    time.sleep(1)
sys.exit(p.get("exit", 0))
```

No `.env`, aponte `ORQ_BOOTSTRAP` para ele e cadastre o robô de teste:
```sql
INSERT INTO robo (nome, ativo, max_concorrencia, timeout_min) VALUES ('robo_teste', 1, 1, 2);
```

| Teste | `parametros` / ação | Esperado |
|---|---|---|
| Sucesso | `{"dorme":5}` | `SUCESSO`, exit 0 |
| Erro | `{"exit":3}` | `ERRO`, exit 3, fim do log em `mensagem` |
| Cancelamento | `{"dorme":60}` + `cancelar_solicitado = 1` | `CANCELADO` em até ~10 s |
| Timeout | `{"dorme":300}` | `TIMEOUT` após 2 min (`timeout_min = 2`) |
| Concorrência | 3 jobs seguidos | executam um de cada vez (`max_concorrencia = 1`) |
| JSON inválido | `parametros = 'abc'` | `ERRO`: "parametros não é JSON válido", robô nem inicia |
| Agenda | `dias='TODOS'`, `horario=NULL`, `intervalo='2min'` | `origem = AGENDA` a cada 2 min, sem duplicar |
| Agenda inválida | `horario='08:00-18:00'`, `intervalo=NULL` | `ativo = 0` e `descricao = 'ERRO: com janela de horário, informe o intervalo...'` |

Script dos testes:
```sql
USE RPA;

-- Sucesso
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":5}' FROM robo WHERE nome = 'robo_teste';

-- Erro
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"exit":3}' FROM robo WHERE nome = 'robo_teste';

-- Cancelamento: dispara e, com o job EXECUTANDO, cancela o último em andamento
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":60}' FROM robo WHERE nome = 'robo_teste';
UPDATE fila_execucao SET cancelar_solicitado = 1
WHERE id = (SELECT MAX(id) FROM fila_execucao WHERE status = 'EXECUTANDO');

-- Timeout
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":300}' FROM robo WHERE nome = 'robo_teste';

-- Concorrência
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT r.id, 'MANUAL', 'marcelo', p.parametros
FROM robo r CROSS JOIN (VALUES ('{"dorme":5}'), ('{"dorme":15}'), ('{"dorme":50}')) p(parametros)
WHERE r.nome = 'robo_teste';

-- JSON inválido (só funciona se a constraint ISJSON não estiver criada)
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', 'abc' FROM robo WHERE nome = 'robo_teste';

-- Agenda (a cada 2 min) e agenda inválida
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'TODOS', NULL, '2min', '{"dorme":3}', 1 FROM robo WHERE nome = 'robo_teste';
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG-SEX', '08:00-18:00', NULL, '{}', 1 FROM robo WHERE nome = 'robo_teste';

-- Conferir
SELECT id, dias, horario, intervalo, descricao, proxima_execucao, ativo FROM agendamento ORDER BY id DESC;
SELECT TOP 20 id, origem, status, exit_code, mensagem, inicio, fim FROM fila_execucao ORDER BY id DESC;

-- Desligar a agenda de teste
UPDATE agendamento SET ativo = 0 WHERE robo_id = (SELECT id FROM robo WHERE nome = 'robo_teste');
```

---

## 11. Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `Invalid column name 'mensagem'` | `01_ajustes.sql` não rodou, ou rodou no `master`. Rode com `USE RPA;`. |
| `Data source name not found` / driver | Driver ODBC diferente. Veja com `Get-OdbcDriver` (PowerShell) e ajuste `DRIVER=`. |
| `Login failed` rodando como serviço | O serviço roda como `LocalSystem`. Defina o usuário em `nssm set ... ObjectName`. |
| Job vai para `ERRO` com `WinError 2` | `ORQ_PYTHON` ou `ORQ_BOOTSTRAP` com caminho errado. Use `py -0p` para achar o Python. Evite o atalho `...\WindowsApps\python.exe`. |
| Job fica em `PENDENTE` | Robô com `ativo = 0`, `max_concorrencia` atingido, ou worker parado. |
| Agendamento não dispara | `ativo = 0`, regra inválida (veja `descricao` e `worker.log`), ou primeira volta (só calcula `proxima_execucao`). |
| Horários "errados" na tela | `ORQ_FUSO` diferente do fuso do SQL Server (ver seção 8). |
| Worker em outra VM não conecta no SQLEXPRESS | Habilitar TCP/IP no SQL Server Configuration Manager, iniciar o SQL Server Browser e liberar o firewall. |

Logs:
- `ORQ_PASTA_LOGS\worker.log` — o que o orquestrador fez (rotação diária, 30 dias).
- `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log` — saída completa de cada execução.

---

## 12. Integração com o bootstrap (`bootstrap_template/bootstrap.py`)

O worker chama o bootstrap com o **mesmo JSON que o Automation Anywhere envia**, como 1º argumento:

```
<ORQ_PYTHON> <ORQ_BOOTSTRAP> '{"ambiente": "DEV", "nomebot": "EcoBot", "executar_bot": "True",
                               "caminho_repositorio": "https://dev.azure.com/...", "parametros": {...}}'
```

| Chave | De onde vem |
|---|---|
| `ambiente` | `ORQ_AMBIENTE` no `.env` do worker (DEV, HML ou PROD — o da máquina) |
| `nomebot` | Nome do robô cadastrado (tabela `robo.nome`) → pasta `C:\RPA\repo\bots\<nome>` |
| `executar_bot` | Sempre `"True"` |
| `caminho_repositorio` | `robo.caminho_repositorio` (cadastro do robô no front). Vazio = não clona/atualiza |
| `parametros` | O que o usuário preencheu no formulário — o bootstrap repassa ao `main.py` do robô |

O mesmo JSON também fica na variável de ambiente `ORQ_BOOTSTRAP_JSON`; `ORQ_PARAMS` continua com só os parâmetros do robô.

**No bootstrap**, só o bloco `if __name__ == "__main__":` foi alterado (o AA chama a função `executar`, que não mudou):
- lê o JSON do 1º argumento (ou de `ORQ_BOOTSTRAP_JSON`); sem nada, usa o `parametro` de teste local;
- termina com `sys.exit(0)` se `status == "sucesso"` e `sys.exit(1)` se `"falha"` — é isso que faz o
  orquestrador marcar `SUCESSO`/`ERRO`. A última linha do log mostra o payload de retorno.

**Chaves do bootstrap no formulário:** se o robô tiver campos com chave `ambiente`, `executar_bot`
ou `caminho_repositorio`, o valor preenchido substitui o padrão no topo do JSON (e não vai em `parametros`).
Ex.: um campo "Ambiente" (lista DEV/HML/PROD) permite escolher o ambiente a cada execução.

**Retorno do bootstrap:** ao final, o worker lê a última linha do log que contém um JSON com `"status"`
(`Bootstrap finalizado com status: {...}`) e grava em `fila_execucao.resultado`
(rode `sql/migracoes/05_resultado_execucao.sql`). Se `status = "falha"`, a execução fica `ERRO`
e a coluna `mensagem` recebe a `mensagem` do bootstrap (mais legível que o fim do log).

O log de cada execução (`ORQ_PASTA_LOGS`) traz a saída completa do bootstrap; o bootstrap continua
gravando também o próprio log em `C:\RPA\repo\logs`.
