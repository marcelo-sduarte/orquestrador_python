# Orquestrador de Robôs Python

Orquestrador para robôs Python em Windows: **cadastra robôs, executa sob demanda, agenda, enfileira,
acompanha logs ao vivo e guarda o histórico** — tudo a partir de uma interface web e de um banco SQL Server.

- Executar agora, com um formulário de parâmetros próprio de cada robô
- Agendar por dias da semana, horário e intervalo (ex.: Seg a Sex, das 08:00 às 18:00, a cada 15 min)
- Fila com limite de execuções simultâneas por robô, timeout e cancelamento
- Log de cada execução com busca, filtros e o resultado devolvido pelo robô
- Executar novamente com os mesmos parâmetros
- Funciona com vários workers (várias VMs) usando o mesmo banco

---

## Sumário

1. [Como funciona](#1-como-funciona)
2. [Estrutura do repositório](#2-estrutura-do-repositório)
3. [Pré-requisitos](#3-pré-requisitos)
4. [Instalação](#4-instalação)
5. [Primeiro uso](#5-primeiro-uso)
6. [Usando a interface](#6-usando-a-interface)
7. [Agendamentos](#7-agendamentos)
8. [Parâmetros dos robôs](#8-parâmetros-dos-robôs)
9. [Integração com o bootstrap](#9-integração-com-o-bootstrap)
10. [Como o worker funciona](#10-como-o-worker-funciona)
11. [Banco de dados](#11-banco-de-dados)
12. [Configuração](#12-configuração)
13. [Rodando como serviço do Windows](#13-rodando-como-serviço-do-windows)
14. [API](#14-api)
15. [Problemas comuns](#15-problemas-comuns)

---

## 1. Como funciona

```
 Navegador ──▶ front (React) ──▶ API (Node) ──▶ SQL Server ◀── worker (Python) ──▶ bootstrap.py ──▶ robô
                 :5173              :3001        tabelas PY_      lê a fila e         clona/atualiza,
                                                                  os agendamentos     cria venv e roda
                                                                                      bots\<nome>\main.py
```

São três partes independentes que conversam **pelo banco**:

| Parte | Pasta | Papel |
|---|---|---|
| **Worker** | `worker/` | Processo Python que executa os robôs. Transforma agendamentos em execuções, pega execuções da fila, chama o `bootstrap.py`, grava log e resultado. |
| **API** | `api/` | Serviço Node que lê e grava no banco para a interface. Não executa nada. |
| **Front** | `front/` | Interface web (React). |

O worker **não depende** da API: se a API ou o front estiverem fora do ar, os robôs e os agendamentos
continuam rodando — só a tela fica indisponível.

---

## 2. Estrutura do repositório

```
orquestrador/
├── worker/              worker Python
│   ├── worker.py          loop principal
│   ├── agendador.py       agendamentos vencidos → fila
│   ├── regra_agenda.py    interpreta dias / horário / intervalo
│   ├── executor.py        executa um job (bootstrap, log, sinal de vida, timeout, cancelamento)
│   ├── db.py              todas as queries do worker
│   ├── config.py          lê o .env
│   ├── requirements.txt
│   └── .env.example
├── api/                 API Node/Express
│   ├── server.js          rotas
│   ├── db.js              conexão com o SQL Server
│   ├── parametros.js      campos de parâmetro dos robôs
│   ├── agenda.js          cálculo das próximas execuções (mesma regra do regra_agenda.py)
│   └── .env.example
├── front/               interface React/Vite
│   └── src/telas/         Execuções, Fila, Robôs, Agendamentos
└── sql/
    └── criar_banco.sql  cria as tabelas
```

---

## 3. Pré-requisitos

| Item | Observação |
|---|---|
| Windows | Worker e API rodam na mesma máquina (a API lê os arquivos de log do worker) |
| Python 3.12+ | Para o worker. Confira com `py -0p` |
| Node.js 20+ (LTS) | Para a API e o front. Confira com `node -v` |
| SQL Server | Express serve. Acesso com usuário Windows (ou usuário SQL, ver seção 12) |
| ODBC Driver 17 ou 18 for SQL Server | Usado pelo worker e pela API. Confira no PowerShell: `Get-OdbcDriver` |
| Git | Para clonar o repositório |
| `bootstrap.py` | Script que prepara e roda cada robô (ver seção 9) |

---

## 4. Instalação

### 4.1 Clonar
```bat
cd C:\caminho
git clone https://github.com/marcelo-sduarte/orquestrador_python.git orquestrador
cd orquestrador
```

### 4.2 Banco de dados
1. No SSMS, crie (ou escolha) o banco. Ex.: `RPA`.
2. Abra `sql\criar_banco.sql`, troque `USE RPA;` pelo nome do seu banco e execute.
3. O resultado final lista as colunas das 4 tabelas `PY_` criadas.

### 4.3 Worker
```bat
cd C:\caminho\orquestrador
python -m venv env
env\Scripts\pip install -r worker\requirements.txt
copy worker\.env.example worker\.env
```
Edite `worker\.env` — o mínimo:

| Variável | Exemplo |
|---|---|
| `ORQ_CONN_STR` | `DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=RPA;Trusted_Connection=yes;TrustServerCertificate=yes;` |
| `ORQ_PYTHON` | Python que roda o bootstrap. Ex.: `C:\Users\voce\AppData\Local\Programs\Python\Python312\python.exe` |
| `ORQ_BOOTSTRAP` | Caminho do `bootstrap.py` |
| `ORQ_PASTA_LOGS` | Pasta dos logs. Ex.: `C:\orquestrador\logs` |
| `ORQ_AMBIENTE` | `DEV`, `HML` ou `PROD` (enviado ao bootstrap) |

Todas as variáveis estão na seção 12.

Teste no console:
```bat
env\Scripts\python worker\worker.py
```
Deve aparecer `Worker '<nome>' iniciando (max 2 jobs)`. Sem execuções na fila o console fica em
silêncio — é normal. `Ctrl+C` encerra.

> Use o caminho real do Python em `ORQ_PYTHON` (o que aparece em `py -0p`), não o atalho
> `...\WindowsApps\python.exe`, nem o Python do `env` do worker.

### 4.4 API
Em outro terminal:
```bat
cd C:\caminho\orquestrador\api
copy .env.example .env
npm install
npm start
```
Em `api\.env`, deixe `DB_CONN_STR` com a mesma conexão do worker e `ORQ_FUSO` com o mesmo fuso.
Deve aparecer `API do orquestrador em http://localhost:3001 (banco: Windows (ODBC))`.

> A conexão com autenticação Windows usa o pacote nativo `msnodesqlv8`. Se o `npm install` avisar
> *"install scripts blocked"*, rode `npm approve-scripts msnodesqlv8` e `npm rebuild msnodesqlv8`.

### 4.5 Front
Em outro terminal:
```bat
cd C:\caminho\orquestrador\front
npm install
npm run dev
```
Abra **http://localhost:5173**.

No dia a dia ficam três processos: worker, API (`npm start`) e front (`npm run dev`).
Para rodar sem terminais abertos, veja a seção 13.

---

## 5. Primeiro uso

1. **Robôs → + Novo robô**
   - **Nome do robô**: o mesmo nome da pasta do robô para o bootstrap (`bots\<nome>`), sem espaços.
   - **Caminho do repositório**: URL do Azure DevOps do robô (opcional; vazio = usa o que já está na máquina).
   - **Execuções simultâneas** e **Tempo máximo**.
   - **Informações pedidas ao executar**: os campos que o usuário preenche (seção 8).
2. **▶ Executar** no robô, preencha o formulário e **Colocar na fila**.
3. Em **Execuções**, acompanhe o status e clique em **log**.
4. Em **Agendamentos**, crie a rotina do robô (seção 7).

---

## 6. Usando a interface

O topo mostra quantas execuções estão rodando, na fila, e os sucessos/erros do dia.

### Execuções
- Últimas 100 execuções, atualizadas a cada 3 s; filtros por status e robô.
- **log** — abre o detalhe da execução:
  resumo (origem, início/fim, duração, código de saída, máquina), parâmetros enviados,
  **resultado devolvido pelo bootstrap** (✓ Sucesso / ✕ Falha, mensagem e resposta do robô) e o log completo
  com busca, filtro "só avisos e erros", copiar e baixar. Enquanto a execução roda, tudo atualiza sozinho.
- **↻ executar novamente** — coloca o mesmo robô na fila com exatamente os mesmos parâmetros (pede confirmação).
- **cancelar** — `PENDENTE` é cancelado na hora; `EXECUTANDO` é encerrado pelo worker em até ~10 s.

### Fila de Processamento
- **Agora**: o que está executando e o que está aguardando, na ordem em que o worker vai pegar.
- **Próximas execuções agendadas**: uma linha por robô com a próxima execução ("hoje 12:00 (em 19 min)"),
  quantas execuções ele terá no período e as regras de agendamento. Período: Hoje, Hoje e amanhã ou
  Próximos 7 dias. Clicar no robô abre os agendamentos dele.

### Robôs
- Cadastrar/editar robôs, ativar/desativar, ver quantos estão rodando e o último status.
- **▶ Executar** abre o formulário com as informações cadastradas para aquele robô.

### Agendamentos
- Formulário: robô, dias da semana (botões Seg … Dom + atalhos), modo (repetir dentro de um horário,
  uma vez por dia, repetir o dia todo), horários, intervalo e as informações do robô.
- A lista mostra a regra como o worker entendeu e a próxima execução. Dá para ativar/desativar e excluir.
- Filtro por robô.

---

## 7. Agendamentos

Cada agendamento tem três informações:

| Campo | Valores | Vazio significa |
|---|---|---|
| **Dias** | `SEG-SEX`, `SEG,QUA,SEX`, `TODOS`, `UTEIS`, `FDS` (aceita `Segunda`, `seg`, sem acento) | todos os dias |
| **Horário** | `09:00` (um horário) ou `08:00-18:00` (janela). Aceita `8`, `8h`, `8h30`, `8-18`, `8h às 18h` | o dia todo |
| **Intervalo** | `15min`, `30min`, `1h`, `1h30`, `90` (minutos) | uma vez, no horário |

| Dias | Horário | Intervalo | Resultado |
|---|---|---|---|
| `SEG-SEX` | `08:00-18:00` | `15min` | Seg a Sex · das 08:00 às 18:00 · a cada 15 min |
| `UTEIS` | `09:00` | | Seg a Sex · às 09:00 |
| `SEG,QUA,SEX` | `07:00-19:00` | `1h` | Seg, Qua, Sex · das 07:00 às 19:00 · a cada 1h |
| `FDS` | `10:00` | | Fim de semana · às 10:00 |
| `TODOS` | | `2h` | Todos os dias · o dia todo · a cada 2h |

Regras:
- Horário **24h** (`20:00` = 8 da noite). AM/PM não é aceito.
- Na janela, início e fim são **inclusos**: `08:00-18:00` a cada 1h roda às 08:00, 09:00 … 18:00.
- **Janela sem intervalo** ou **horário único com intervalo** é inválido: o agendamento é desativado e o
  motivo aparece na regra (`ERRO: ...`).
- Agendamento novo: na primeira passada (até 30 s) o worker só calcula a próxima execução; não roda na hora.
- Se o worker ficar parado (ex.: fim de semana), ao voltar roda **uma** vez cada agendamento atrasado,
  não uma vez por horário perdido.
- Os horários seguem o fuso `ORQ_FUSO` (padrão `America/Sao_Paulo`).

---

## 8. Parâmetros dos robôs

No cadastro do robô, em **Informações pedidas ao executar**, cada informação tem:

| Campo | Uso |
|---|---|
| Nome exibido | Texto que o usuário vê. Ex.: "Data de referência" |
| Chave | Nome que o robô recebe. Gerada a partir do nome (`data_de_referencia`), pode ser editada |
| Tipo | **Texto**, **Número**, **Data** (calendário), **Sim/Não** ou **Lista de opções** |
| Obrigatório | Não deixa executar sem preencher |
| Valor padrão | Já vem preenchido. Para data, "Data do dia" |
| Opções | Só para lista: `valor=Texto exibido;valor2=Outro texto`. Ex.: `TODOS=Todos;TAESA=Taesa` |
| Dica | Texto de ajuda abaixo do campo |

O que o usuário preenche vira um JSON, validado também na API (obrigatórios, números, datas, opções):
```json
{"data_de_referencia": "2026-11-10", "cliente": "TAESA", "reprocessar": false}
```
- Campos vazios e não obrigatórios não são enviados — o robô usa o padrão dele.
- Em **agendamentos**, uma data com padrão "Data do dia" fica vazia, para o robô usar a data de cada
  execução (e não a data em que o agendamento foi criado).
- Robô sem informações cadastradas executa sem perguntar nada.
- Nunca use parâmetros para senhas: ficam gravados no banco e aparecem no log.

**Chaves do bootstrap:** se o robô tiver informações com chave `ambiente`, `executar_bot`,
`caminho_repositorio` ou `branch`, o valor preenchido vai para o topo do JSON do bootstrap (seção 9),
substituindo o padrão, e não para `parametros`. Ex.: uma lista
"Ambiente" com `DEV=DEV;HML=HML;PROD=PROD` permite escolher o ambiente a cada execução.

---

## 9. Integração com o bootstrap

O worker chama o bootstrap passando um JSON como 1º argumento:

```
<ORQ_PYTHON> <ORQ_BOOTSTRAP> '{"ambiente":"DEV","nomebot":"EcoBot","executar_bot":"True",
                               "caminho_repositorio":"https://dev.azure.com/...","parametros":{...}}'
```

| Chave | Origem |
|---|---|
| `ambiente` | `ORQ_AMBIENTE` do worker (ou a informação `ambiente` do formulário) |
| `nomebot` | Nome do robô cadastrado |
| `executar_bot` | `"True"` (ou a informação `executar_bot` do formulário) |
| `caminho_repositorio` | Caminho do repositório cadastrado no robô |
| `branch` | Só se o robô tiver a informação `branch` no formulário (ex.: `DEV`). Sem ela, o bootstrap usa a branch padrão do repositório |
| `parametros` | As informações preenchidas no formulário |

O mesmo JSON também fica na variável de ambiente `ORQ_BOOTSTRAP_JSON`. Outras variáveis disponíveis para
o bootstrap e o robô: `ORQ_EXECUCAO_ID` (número da execução), `ORQ_ROBO` e `ORQ_PARAMS` (só os parâmetros).

**O que o bootstrap precisa fazer:**
1. Ler o JSON do 1º argumento (`sys.argv[1]`) ou de `ORQ_BOOTSTRAP_JSON`.
2. Imprimir no final uma linha com o JSON de retorno, contendo `status`:
   ```
   Bootstrap finalizado com status: {"status": "sucesso", "mensagem": "...", "resposta": {...}}
   ```
3. Sair com **código 0** em sucesso e **diferente de 0** em falha.

```python
if __name__ == "__main__":
    import sys
    parametro = sys.argv[1] if len(sys.argv) > 1 else os.environ["ORQ_BOOTSTRAP_JSON"]
    resposta = executar(parametro)
    print(f"Bootstrap finalizado com status: {resposta}", flush=True)
    sys.exit(0 if json.loads(resposta).get("status") == "sucesso" else 1)
```

O worker lê esse JSON de retorno e grava em `PY_FilaExecucao.resultado` (é o que aparece em destaque no log).
Se `status` for `"falha"`, a execução fica **ERRO** e a mensagem do bootstrap vai para a coluna Mensagem.
Tudo o que o bootstrap e o robô imprimem vai para o log da execução.

---

## 10. Como o worker funciona

### Ciclo de vida de uma execução
```
PENDENTE ──▶ EXECUTANDO ──┬──▶ SUCESSO     código de saída 0 e retorno sem falha
                          ├──▶ ERRO        código ≠ 0, retorno "falha", falha ao iniciar ou execução órfã
                          ├──▶ CANCELADO   cancelada pela interface
                          └──▶ TIMEOUT     passou do tempo máximo do robô
```

### Loop principal
A cada 5 s (`ORQ_POLL_S`) o worker:
1. A cada 30 s (`ORQ_AGENDA_S`): transforma agendamentos vencidos em execuções `AGENDA` e marca execuções órfãs.
2. Enquanto houver vaga (`ORQ_MAX_JOBS`): pega a execução `PENDENTE` mais antiga cujo robô esteja ativo e
   abaixo do limite de execuções simultâneas, e a executa numa thread.

### Fila segura com vários workers
A execução é "pega" com um único `UPDATE` com bloqueio (`UPDLOCK, READPAST`) e um lock de aplicação
(`sp_getapplock`). Assim a mesma execução nunca roda duas vezes e o limite por robô vale somando todas as VMs.

### Durante a execução
- Saída do processo vai para `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log`.
- A cada 10 s (`ORQ_SINAL_S`) o worker grava o **sinal de vida** (`ultimo_sinal`) e verifica:
  pedido de cancelamento → tempo máximo → desligamento do worker. Em qualquer um deles, encerra o processo
  **e todos os filhos** (bootstrap, Python do robô, chromedriver, navegador...).

### Execuções órfãs
Se uma execução está `EXECUTANDO` mas o `ultimo_sinal` não é atualizado há mais de 120 s (`ORQ_ORFAO_S`),
o worker que a executava caiu (VM desligada, processo morto). Ela é marcada como `ERRO`.
Ao iniciar, o worker também marca como `ERRO` o que tinha ficado `EXECUTANDO` em seu nome.

---

## 11. Banco de dados

Criado por `sql/criar_banco.sql`.

| Tabela | Conteúdo |
|---|---|
| `PY_Robo` | `nome`, `ativo`, `max_concorrencia`, `timeout_min`, `caminho_repositorio` |
| `PY_RoboParametro` | Informações do formulário de cada robô: `chave`, `rotulo`, `tipo`, `obrigatorio`, `padrao`, `opcoes`, `ajuda`, `ordem` |
| `PY_Agendamento` | `robo_id`, `dias`, `horario`, `intervalo`, `parametros`, `ativo`, `proxima_execucao`, `descricao` |
| `PY_FilaExecucao` | Cada execução: `status`, `origem` (MANUAL/AGENDA), `solicitado_por`, `parametros`, `worker`, `pid`, `ultimo_sinal`, `inicio`, `fim`, `exit_code`, `mensagem`, `resultado`, `log_arquivo`, `cancelar_solicitado`, `agendamento_id` |

Consultas úteis:
```sql
-- Últimas execuções
SELECT TOP 50 f.id, r.nome, f.origem, f.status, f.inicio, f.fim, f.mensagem
FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
ORDER BY f.id DESC;

-- Resultado devolvido pelo bootstrap
SELECT id, JSON_VALUE(resultado, '$.status') AS status_bootstrap, JSON_VALUE(resultado, '$.mensagem') AS mensagem
FROM PY_FilaExecucao WHERE resultado IS NOT NULL ORDER BY id DESC;

-- Agendamentos e como o worker os entendeu
SELECT a.id, r.nome, a.descricao, a.proxima_execucao, a.ativo
FROM PY_Agendamento a JOIN PY_Robo r ON r.id = a.robo_id;
```

---

## 12. Configuração

### `worker\.env`

| Variável | Padrão | Descrição |
|---|---|---|
| `ORQ_CONN_STR` | — | String de conexão ODBC do banco |
| `ORQ_WORKER_NOME` | nome da máquina | Identifica o worker nas execuções |
| `ORQ_PYTHON` | — | Python que roda o bootstrap |
| `ORQ_BOOTSTRAP` | — | Caminho do `bootstrap.py` |
| `ORQ_PASTA_LOGS` | — | Pasta dos logs (worker + um arquivo por execução) |
| `ORQ_AMBIENTE` | `DEV` | `ambiente` enviado ao bootstrap |
| `ORQ_MAX_JOBS` | `2` | Execuções simultâneas neste worker |
| `ORQ_POLL_S` | `5` | Intervalo de busca na fila (s) |
| `ORQ_AGENDA_S` | `30` | Intervalo de verificação dos agendamentos (s) |
| `ORQ_SINAL_S` | `10` | Intervalo do sinal de vida e da checagem de cancelamento/timeout (s) |
| `ORQ_ORFAO_S` | `120` | Sem sinal de vida por mais que isso = execução órfã (s) |
| `ORQ_FUSO` | `America/Sao_Paulo` | Fuso dos horários dos agendamentos |

### `api\.env`

| Variável | Descrição |
|---|---|
| `PORT` | Porta da API (padrão `3001`) |
| `ORQ_FUSO` | Mesmo valor do worker |
| `DB_CONN_STR` | Conexão com autenticação Windows (mesma do worker) |
| `DB_SERVER`, `DB_INSTANCE`, `DB_DATABASE`, `DB_USER`, `DB_PASSWORD` | Alternativa com usuário SQL. Se `DB_USER` estiver preenchido, `DB_CONN_STR` é ignorado. Requer TCP/IP habilitado e o serviço SQL Server Browser ligado |

> **Fuso:** os horários dos agendamentos usam `ORQ_FUSO`; início/fim das execuções usam o relógio do
> SQL Server. Mantenha os dois no mesmo fuso.

---

## 13. Rodando como serviço do Windows

Para o worker subir com a máquina e reiniciar sozinho se cair, use o [NSSM](https://nssm.cc):

```bat
nssm install OrquestradorWorker C:\caminho\orquestrador\env\Scripts\python.exe C:\caminho\orquestrador\worker\worker.py
nssm set OrquestradorWorker AppDirectory C:\caminho\orquestrador\worker
nssm set OrquestradorWorker AppStopMethodConsole 60000
nssm set OrquestradorWorker AppExit Default Restart
nssm set OrquestradorWorker ObjectName .\usuario senha
nssm start OrquestradorWorker
```
- `ObjectName`: usuário Windows com acesso ao banco (o padrão `LocalSystem` normalmente não tem).
- Robôs que abrem **navegador visível** ou fazem automação de tela não funcionam como serviço.
  Para esses, rode o worker pelo Agendador de Tarefas com o gatilho "Ao fazer logon".

A API pode ser instalada da mesma forma (`nssm install OrquestradorApi "C:\Program Files\nodejs\node.exe" server.js`
com `AppDirectory` em `api`).

---

## 14. API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/resumo` | Contadores do topo da tela |
| GET | `/api/robos` | Robôs com execuções em andamento e último status |
| GET | `/api/robos/:id` | Robô + informações do formulário |
| POST | `/api/robos` | Cadastra robô: `{ nome, max_concorrencia, timeout_min, ativo, caminho_repositorio, campos }` |
| PUT | `/api/robos/:id` | Atualiza robô e informações |
| PATCH | `/api/robos/:id` | `{ "ativo": true/false }` |
| GET | `/api/robos/:id/parametros` | Informações do formulário |
| POST | `/api/robos/:id/executar` | `{ parametros, solicitado_por }` → `{ id }` |
| GET | `/api/execucoes?status=&robo_id=&limite=` | Lista de execuções |
| GET | `/api/execucoes/:id` | Detalhe (inclui `resultado`) |
| GET | `/api/execucoes/:id/log` | Final do log (até 200 KB) |
| POST | `/api/execucoes/:id/reexecutar` | Nova execução com os mesmos parâmetros |
| POST | `/api/execucoes/:id/cancelar` | Cancela |
| GET | `/api/fila?periodo=hoje\|amanha\|7d&robo_id=` | Execuções em andamento, na fila e próximas agendadas |
| GET | `/api/agendamentos` | Lista |
| POST | `/api/agendamentos` | `{ robo_id, dias, horario, intervalo, parametros }` |
| PATCH | `/api/agendamentos/:id` | `{ "ativo": true/false }` |
| DELETE | `/api/agendamentos/:id` | Exclui |

> A API não tem login. Não a exponha fora da rede interna sem autenticação.

---

## 15. Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| `npm` não é reconhecido | Node.js não instalado. Instale o LTS e abra um terminal novo |
| `Could not read package.json` | `npm` rodado na raiz. Rode dentro de `api\` ou `front\` |
| `Cannot find module ... msnodesqlv8` / `install scripts blocked` | Na pasta `api`: `npm approve-scripts msnodesqlv8` e `npm rebuild msnodesqlv8` |
| `Data source name not found` | Nome do driver ODBC diferente. Veja `Get-OdbcDriver` e ajuste `Driver=` / `DRIVER=` |
| `Invalid object name 'PY_...'` / `Invalid column name` | Banco sem as tabelas. Rode `sql\criar_banco.sql` no banco certo (`USE` no topo) |
| Front mostra "API/banco indisponível" | API parada ou sem conexão com o banco (veja o terminal da API) |
| Página `localhost:5173` não abre | Front não iniciado: `npm run dev` em `front\` |
| Execução fica em `PENDENTE` | Worker parado, robô inativo ou limite de execuções simultâneas atingido |
| Execução vai para `ERRO` com `WinError 2` | `ORQ_PYTHON` ou `ORQ_BOOTSTRAP` com caminho errado |
| Execução marcada como órfã | O worker que a executava parou. Veja `ORQ_PASTA_LOGS\worker.log` |
| Mudança no `.env` não fez efeito | O worker só lê o `.env` ao iniciar: reinicie-o |
| Agendamento não dispara | Desativado, regra inválida (veja a coluna Regra) ou ainda na primeira passada |
| Horários "errados" na tela | `ORQ_FUSO` diferente entre worker/API e o fuso do SQL Server |
| `Login failed` como serviço | Defina o usuário do serviço (`nssm set ... ObjectName`) |

Logs:
- `ORQ_PASTA_LOGS\worker.log` — o que o worker fez (um arquivo por dia, 30 dias).
- `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log` — saída completa de cada execução.
