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

| Arquivo | Responsabilidade |
|---|---|
| `worker.py` | Loop principal. A cada ciclo: processa agenda, recupera órfãos, pega jobs da fila e os executa em threads. |
| `agendador.py` | Lê `agendamento`, transforma horários vencidos (cron) em linhas na `fila_execucao` e calcula a próxima execução. |
| `executor.py` | Executa um job: inicia o `bootstrap.py`, grava log, envia heartbeat, trata cancelamento e timeout, mata a árvore de processos. |
| `db.py` | Todas as queries SQL. Nenhum outro arquivo fala com o banco diretamente. |
| `config.py` | Lê a configuração do `.env` / variáveis de ambiente. |
| `.env` | Configuração da máquina (string de conexão, caminhos, intervalos). |
| `sql/01_ajustes.sql` | Colunas extras e índice usados pelo worker. |
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
| `cron` | Expressão cron de 5 campos (`minuto hora dia mês dia_semana`) |
| `parametros` | JSON enviado ao robô |
| `ativo` | `0` = agendamento pausado |
| `proxima_execucao` | Calculada pelo agendador. `NULL` = agendamento novo |

Exemplos de cron:
| Cron | Significado |
|---|---|
| `0 9 * * 1-5` | Dias úteis às 09:00 |
| `*/15 8-18 * * 1-5` | A cada 15 min, das 8h às 18h, dias úteis |
| `30 6 1 * *` | Dia 1 de cada mês às 06:30 |
| `0 */2 * * *` | A cada 2 horas |

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

## 6. Contrato com o robô

O worker chama:
```
<ORQ_PYTHON> <ORQ_BOOTSTRAP> <robo.nome>
```
E disponibiliza variáveis de ambiente:

| Variável | Conteúdo |
|---|---|
| `ORQ_EXECUCAO_ID` | `fila_execucao.id` — use para correlacionar com os logs do robô |
| `ORQ_ROBO` | Nome do robô |
| `ORQ_PARAMS` | JSON de `parametros` |

No bootstrap/robô:
```python
import json, os
execucao_id = os.getenv("ORQ_EXECUCAO_ID")
params = json.loads(os.getenv("ORQ_PARAMS", "{}"))
```

Regras:
- **Exit code `0` = SUCESSO.** Qualquer outro = ERRO. Use `sys.exit(1)` em falhas de negócio.
- Tudo que o robô imprimir (`print`, `logging` para console) vai para o arquivo de log da execução.
- Parâmetros vão por variável de ambiente (e não pela linha de comando) para evitar problemas de aspas no Windows.

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

## 8. Configuração (`.env`)

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

> **Fuso horário:** `proxima_execucao` segue `ORQ_FUSO`; `criado_em`, `inicio`, `fim` e `heartbeat`
> vêm do relógio do SQL Server. Mantenha os dois no mesmo fuso para não confundir o front
> (ex.: em teste local em Portugal use `ORQ_FUSO=Europe/Lisbon`).

---

## 9. Instalação

```bat
cd C:\caminho\orquestrador
python -m venv env
env\Scripts\pip install -r requirements.txt
copy .env.example .env        &:: editar
```

No SSMS, rode `sql/01_ajustes.sql` **no banco `RPA`** (`USE RPA;` no topo).

### Executar no console (teste)
```bat
env\Scripts\python worker.py
```
Deve aparecer `Worker 'LOCAL' iniciando (max 2 jobs)`. Sem jobs na fila o console fica em silêncio — é normal.
`Ctrl+C` encerra (aguarda os jobs em andamento terminarem).

### Executar como serviço do Windows (NSSM)
```bat
nssm install OrquestradorRobos C:\caminho\orquestrador\env\Scripts\python.exe C:\caminho\orquestrador\worker.py
nssm set OrquestradorRobos AppDirectory C:\caminho\orquestrador
nssm set OrquestradorRobos AppStopMethodConsole 60000
nssm set OrquestradorRobos AppExit Default Restart
nssm set OrquestradorRobos ObjectName .\usuario senha   &:: usuário com acesso ao banco
nssm start OrquestradorRobos
```

> Robôs que abrem **navegador visível** ou fazem automação de tela não funcionam como serviço
> (sessão 0). Para esses, rode o worker pelo Agendador de Tarefas, gatilho "Ao fazer logon".

---

## 10. Testes de validação

Com um `bootstrap_fake.py` (dorme N segundos e sai com o exit code pedido) e o robô `robo_teste`
(`max_concorrencia = 1`, `timeout_min = 2`):

| Teste | `parametros` / ação | Esperado |
|---|---|---|
| Sucesso | `{"dorme":5}` | `SUCESSO`, exit 0 |
| Erro | `{"exit":3}` | `ERRO`, exit 3, fim do log em `mensagem` |
| Cancelamento | `{"dorme":60}` + `cancelar_solicitado = 1` | `CANCELADO` em até ~10 s |
| Timeout | `{"dorme":300}` | `TIMEOUT` após 2 min |
| Concorrência | 3 jobs seguidos | executam um de cada vez |
| Agenda | cron `*/2 * * * *` | `origem = AGENDA` a cada 2 min, sem duplicar |

---

## 11. Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `Invalid column name 'mensagem'` | `01_ajustes.sql` não rodou, ou rodou no `master`. Rode com `USE RPA;`. |
| `Data source name not found` / driver | Driver ODBC diferente. Veja com `Get-OdbcDriver` (PowerShell) e ajuste `DRIVER=`. |
| `Login failed` rodando como serviço | O serviço roda como `LocalSystem`. Defina o usuário em `nssm set ... ObjectName`. |
| Job vai para `ERRO` com `WinError 2` | `ORQ_PYTHON` ou `ORQ_BOOTSTRAP` com caminho errado. Use `py -0p` para achar o Python. Evite o atalho `...\WindowsApps\python.exe`. |
| Job fica em `PENDENTE` | Robô com `ativo = 0`, `max_concorrencia` atingido, ou worker parado. |
| Agendamento não dispara | `ativo = 0`, cron inválido (veja `worker.log`), ou primeira volta (só calcula `proxima_execucao`). |
| Horários "errados" na tela | `ORQ_FUSO` diferente do fuso do SQL Server (ver seção 8). |
| Worker em outra VM não conecta no SQLEXPRESS | Habilitar TCP/IP no SQL Server Configuration Manager, iniciar o SQL Server Browser e liberar o firewall. |

Logs:
- `ORQ_PASTA_LOGS\worker.log` — o que o orquestrador fez (rotação diária, 30 dias).
- `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log` — saída completa de cada execução.
