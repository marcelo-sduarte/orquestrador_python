<p align="center"><img src="front/public/favicon.svg" width="110" alt="PyKronos"></p>

# PyKronos — Orquestrador de Robôs Python

Orquestrador para robôs Python em Windows: **cadastra robôs, executa sob demanda, agenda, enfileira,
acompanha logs ao vivo e guarda o histórico** — tudo a partir de uma interface web e de um banco SQL Server.

- Executar agora, com um formulário de parâmetros próprio de cada robô
- Agendar por dias da semana, horário e intervalo (ex.: Seg a Sex, das 08:00 às 18:00, a cada 15 min)
- Fila com limite de execuções simultâneas por robô, timeout e cancelamento
- Log de cada execução com busca, filtros e o resultado devolvido pelo robô
- Executar novamente com os mesmos parâmetros
- Funciona com vários workers (várias VMs / runners) usando o mesmo banco
- **Tudo em Python**: API em FastAPI, que também serve o front e usa a mesma regra de agenda do worker
- **Robô preso a runner** por tag (ex.: só nos runners com SAP)
- **Log central**: o log de cada execução vai para o banco, e o front mostra o log de qualquer runner
- **Fila sem acúmulo**: um agendamento não enfileira de novo enquanto a execução anterior ainda espera na fila
- **Login com perfis**: *Administrador* (altera tudo) e *Somente visualização* (só consulta)

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
 Navegador ──▶ API FastAPI + front ──▶ SQL Server ◀── worker (Python) ──▶ bootstrap.py ──▶ robô
                     :3001              tabelas PY_      um por runner,       clona/atualiza,
                                                         lê a fila e          cria venv e roda
                                                         os agendamentos      bots\<nome>\main.py
```

São três partes independentes que conversam **pelo banco**:

| Parte | Pasta | Papel |
|---|---|---|
| **Worker** | `worker/` | Processo Python que executa os robôs. Transforma agendamentos em execuções, pega execuções da fila, chama o `bootstrap.py`, grava log e resultado. |
| **API** | `api/` | Serviço Python (FastAPI) que lê e grava no banco para a interface e serve o front compilado. Não executa nada. |
| **Front** | `front/` | Interface web (React). Em produção é compilado (`npm run build`) e servido pela API. |
| **Comum** | `comum/` | Código usado pelo worker e pela API: `regra_agenda.py` (dias / horário / intervalo). |

O worker **não depende** da API: se a API ou o front estiverem fora do ar, os robôs e os agendamentos
continuam rodando — só a tela fica indisponível.

---

## 2. Estrutura do repositório

```
OrquestradorV2/
├── comum/
│   └── regra_agenda.py    interpreta dias / horário / intervalo (worker e API)
├── worker/              worker Python
│   ├── worker.py          loop principal
│   ├── agendador.py       agendamentos vencidos → fila
│   ├── executor.py        executa um job (bootstrap, log, sinal de vida, timeout, cancelamento)
│   ├── processos.py       encerra a árvore de processos dos robôs (inclusive se o worker cair)
│   ├── db.py              todas as queries do worker
│   ├── config.py          lê o .env
│   ├── requirements.txt
│   └── .env.example
├── api/                 API FastAPI
│   ├── main.py            rotas (+ serve front/dist)
│   ├── db.py              conexão com o SQL Server (pyodbc)
│   ├── parametros.py      campos de parâmetro dos robôs
│   ├── auth.py            login, senhas e perfis
│   ├── criar_usuario.py   cria o primeiro administrador (linha de comando)
│   ├── config.py          lê o .env
│   ├── requirements.txt
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
| Windows | Worker em cada runner; API em um servidor (pode ser um dos runners) |
| Python 3.12+ | Para o worker e a API. Confira com `py -0p` |
| Node.js 20+ (LTS) | **Só para compilar o front** (máquina de desenvolvimento). Os runners e o servidor da API não precisam |
| SQL Server 2016+ | Express serve. Acesso com usuário Windows (ou usuário SQL, ver seção 12). O filtro por tag usa `STRING_SPLIT` (nível de compatibilidade 130+) |
| ODBC Driver 17 ou 18 for SQL Server | Usado pelo worker e pela API. Confira no PowerShell: `Get-OdbcDriver` |
| Git | Para clonar o repositório |
| `bootstrap.py` | Script que prepara e roda cada robô (ver seção 9) |

---

## 4. Instalação

### 4.1 Copiar o projeto
Copie (ou clone) a pasta `OrquestradorV2` inteira para a máquina — `comum\`, `worker\` e `api\` precisam
ficar lado a lado:
```bat
cd C:\caminho\OrquestradorV2
```

### 4.2 Banco de dados
1. No SSMS, crie (ou escolha) o banco. Ex.: `RPA`.
2. Abra `sql\criar_banco.sql`, troque `USE RPA;` pelo nome do seu banco e execute.
3. O resultado final lista as colunas das 4 tabelas `PY_` criadas.

> Já tem o banco da versão 1? Rode o mesmo script: ele só acrescenta o que falta
> (`PY_Robo.tag`, `PY_FilaExecucao.log_texto` e dois índices) e não mexe nos dados.

### 4.3 Worker
```bat
cd C:\caminho\OrquestradorV2
python -m venv env
env\Scripts\pip install -r worker\requirements.txt
copy worker\.env.example worker\.env
```

> **Repositório pip interno (sem internet).** Se a empresa tiver uma pasta ou servidor com os pacotes,
> instale só dele (`--no-index` = não vai à internet):
> ```bat
> env\Scripts\pip install --no-index --find-links "<pasta_ou_url_do_repositorio>" -r worker\requirements.txt
> ```
> Se o pip avisar `Location ... is ignored`, a máquina não enxerga a pasta (rede/VPN) ou o pip não aceitou
> o caminho de rede: mapeie uma unidade com `net use R: "<pasta>"` e use `--find-links R:\`.
> Para conferir se o repositório tem tudo sem instalar nada, acrescente `--dry-run --ignore-installed`.
> Pacotes com parte compilada (`pyodbc`, `psutil`, `pydantic-core`) precisam do `.whl` da mesma
> versão do Python do `env` (ex.: `cp312` para Python 3.12).
> Coloque o mesmo caminho em `ORQ_PIP_REPO` no `api\.env` para a tela **Sobre** mostrar o comando certo.

Edite `worker\.env` — o mínimo:

| Variável | Exemplo |
|---|---|
| `ORQ_CONN_STR` | `DRIVER={ODBC Driver 18 for SQL Server};SERVER=localhost\SQLEXPRESS;DATABASE=RPA;Trusted_Connection=yes;TrustServerCertificate=yes;` |
| `ORQ_PYTHON` | Python que roda o bootstrap. Ex.: `C:\Users\voce\AppData\Local\Programs\Python\Python312\python.exe` |
| `ORQ_BOOTSTRAP` | Caminho do `bootstrap.py` |
| `ORQ_PASTA_LOGS` | Pasta dos logs. Ex.: `C:\orquestrador\logs` |
| `ORQ_AMBIENTE` | `DEV`, `QAS` ou `PRD` (enviado ao bootstrap) |
| `ORQ_TAGS` | Tags deste runner, ex.: `sap,chrome`. Vazio = só executa robôs sem tag (seção 10) |

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
Em outro terminal (pode usar o mesmo `env` do worker):
```bat
cd C:\caminho\OrquestradorV2
env\Scripts\pip install -r api\requirements.txt
copy api\.env.example api\.env
env\Scripts\python api\main.py
```
Em `api\.env`, deixe `ORQ_CONN_STR` com a mesma conexão do worker e `ORQ_FUSO` com o mesmo fuso.
Deve aparecer `API do orquestrador em http://localhost:3001  (docs: /docs)`.
Em **http://localhost:3001/docs** fica a documentação interativa de todas as rotas.

### 4.5 Primeiro administrador
O front exige login. Crie o primeiro administrador pelo terminal (a senha é pedida e não aparece na tela,
mínimo 8 caracteres):
```bat
cd C:\caminho\OrquestradorV2
env\Scripts\python api\criar_usuario.py admin "Administrador"
```
Os demais usuários são criados pela tela **Usuários** (só para administradores). O mesmo comando também
redefine a senha de quem esqueceu: rode-o de novo com o mesmo login.

### 4.6 Front

**Uso normal (sem Node no servidor):** compile o front uma vez numa máquina com Node e copie a pasta
`front\dist` para o servidor da API. A API serve o front na mesma porta:
```bat
cd C:\caminho\OrquestradorV2\front
npm install
npm run build
```
Reinicie a API e abra **http://localhost:3001**.

**Desenvolvendo o front:** `npm run dev` em `front\` e abra **http://localhost:5173**
(o Vite redireciona `/api` para a API na porta 3001).

No dia a dia ficam dois processos: worker (em cada runner) e API.

### 4.7 Iniciar e parar tudo de uma vez
Na pasta `OrquestradorV2`, dê dois cliques em **`iniciar.bat`** (ou rode no terminal). Ele abre a API e o
worker, cada um numa janela própria, e abre o navegador em http://localhost:3001.
Se o front ainda não foi compilado, ele compila antes (precisa do Node).

| Comando | O que faz |
|---|---|
| `iniciar.bat` | API + worker |
| `iniciar.bat build` | Recompila o front (`npm run build`) e inicia |
| `iniciar.bat dev` | API + worker + front em modo desenvolvimento (http://localhost:5173) |
| `parar.bat` | Fecha as janelas abertas pelo `iniciar.bat` (robôs em execução são encerrados junto) |

Para rodar sem terminais abertos e subir com a máquina, veja a seção 13.

---

## 5. Primeiro uso

0. Abra http://localhost:3001 e entre com o administrador criado no passo 4.5.
1. **Robôs → + Adicionar**
   - **Nome do robô**: o mesmo nome da pasta do robô para o bootstrap (`bots\<nome>`), sem espaços.
   - **Runner (tag)**: deixe vazio para rodar em qualquer runner, ou informe a tag (ex.: `sap`) para rodar
     só nos workers com essa tag em `ORQ_TAGS`.
   - **Caminho do repositório**: URL do repositório Git do robô (opcional; vazio = usa o que já está na máquina).
   - **Execuções simultâneas** e **Tempo máximo**.
   - **Informações pedidas ao executar**: os campos que o usuário preenche (seção 8).
2. **▶ Executar** no robô, preencha o formulário e **Colocar na fila**.
3. Em **Execuções**, acompanhe o status e clique em **log**.
4. Em **Agendamentos**, crie a rotina do robô (seção 7).

---

## 6. Usando a interface

O menu lateral leva às telas (o botão ☰ recolhe o menu). No topo de cada tela ficam quatro cartões:
execuções rodando, na fila, sucessos e erros do dia. No canto superior direito, o menu do usuário tem
**Alterar senha** e **Sair**.

### Perfis
| Perfil | Pode |
|---|---|
| **Administrador** | Tudo: cadastrar/editar/executar robôs, agendamentos, cancelar e reexecutar, gerenciar usuários |
| **Somente visualização** | Consultar execuções (com log), fila, robôs e agendamentos; trocar a própria senha. Os botões de ação não aparecem e a API recusa qualquer alteração |

A sessão dura 12 horas (`API_SESSAO_HORAS`). Usuário desativado ou com perfil alterado perde o acesso
antigo em até 1 minuto. Após 5 senhas erradas em 5 minutos, o login fica bloqueado por alguns minutos.

### Usuários (administrador)
Lista com login, nome, perfil, último acesso e o interruptor de ativo. **+ Adicionar** cria o usuário;
o lápis edita nome, perfil, ativo e permite definir uma nova senha. Você não pode se desativar nem tirar
o seu próprio perfil de administrador.

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
- Cadastrar/editar robôs, ativar/desativar, ver quantos estão rodando, o último status e o runner (tag).
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
- **Sem acúmulo na fila:** se a execução anterior do agendamento ainda está `PENDENTE` (esperando vaga),
  o horário seguinte não cria outra — o `worker.log` mostra
  `execução anterior ainda na fila — não enfileirado de novo`. Execução manual não tem essa trava.
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
| Opções | Só para lista: `valor=Texto exibido;valor2=Outro texto`. Ex.: `TODOS=Todos;CLIENTE_A=Cliente A` |
| Dica | Texto de ajuda abaixo do campo |

O que o usuário preenche vira um JSON, validado também na API (obrigatórios, números, datas, opções):
```json
{"data_de_referencia": "2026-11-10", "cliente": "CLIENTE_A", "reprocessar": false}
```
- Campos vazios e não obrigatórios não são enviados — o robô usa o padrão dele.
- Em **agendamentos**, uma data com padrão "Data do dia" fica vazia, para o robô usar a data de cada
  execução (e não a data em que o agendamento foi criado).
- Robô sem informações cadastradas executa sem perguntar nada.
- Nunca use parâmetros para senhas: ficam gravados no banco e aparecem no log.

**Chaves do bootstrap:** se o robô tiver informações com chave `ambiente`, `executar_bot`,
`caminho_repositorio` ou `branch`, o valor preenchido vai para o topo do JSON do bootstrap (seção 9),
substituindo o padrão, e não para `parametros`. Ex.: uma lista
"Ambiente" com `DEV=DEV;QAS=QAS;PRD=PRD` permite escolher o ambiente a cada execução.

---

## 9. Integração com o bootstrap

O worker chama o bootstrap passando um JSON como 1º argumento:

```
<ORQ_PYTHON> <ORQ_BOOTSTRAP> '{"ambiente":"DEV","nomebot":"MeuRobo","executar_bot":"True",
                               "caminho_repositorio":"https://seu-git/.../meu_robo","parametros":{...}}'
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
2. Enquanto houver vaga (`ORQ_MAX_JOBS`): pega a execução `PENDENTE` mais antiga cujo robô esteja ativo,
   abaixo do limite de execuções simultâneas e **que este runner possa executar** (tag), e a executa numa thread.

### Runners e tags
Cada robô pode ter uma **tag** (aba Robôs → Runner). Cada worker declara as suas em `ORQ_TAGS`.

| Robô | Worker com `ORQ_TAGS=sap,chrome` | Worker com `ORQ_TAGS=` (vazio) |
|---|---|---|
| sem tag | executa | executa |
| tag `sap` | executa | não executa |
| tag `excel` | não executa | não executa |

Use para robôs que só funcionam onde há SAP GUI, certificado, perfil do Chrome etc.
Se nenhum worker tiver a tag do robô, a execução fica `PENDENTE` até um worker com a tag subir.

### Fila segura com vários workers
A execução é "pega" com um único `UPDATE` com bloqueio (`UPDLOCK, READPAST`) e um lock de aplicação
(`sp_getapplock`). Assim a mesma execução nunca roda duas vezes e o limite por robô vale somando todas as VMs.

### Durante a execução
- Saída do processo vai para `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log`, no disco do runner.
- **Log central:** a cada 30 s (`ORQ_LOG_PARCIAL_S`) o final do log (até 256 KB) é copiado para
  `PY_FilaExecucao.log_texto`; ao terminar, até 1 MB. A API lê o arquivo se o enxergar
  (mesma máquina ou `ORQ_PASTA_LOGS` numa pasta de rede); senão mostra a cópia do banco.
  Assim o botão **log** funciona para execuções de qualquer runner.
- A cada 10 s (`ORQ_SINAL_S`) o worker grava o **sinal de vida** (`ultimo_sinal`) e verifica:
  pedido de cancelamento → tempo máximo → desligamento do worker. Em qualquer um deles, encerra o processo
  **e todos os filhos** (bootstrap, Python do robô, chromedriver, navegador...).

- A supervisão não para por falha de banco: se gravar o pid, o sinal de vida ou o resultado falhar,
  o worker tenta de novo no ciclo seguinte. Qualquer erro inesperado na supervisão encerra o robô antes
  de propagar — nunca sobra processo de robô sem dono.

### Execuções órfãs
Se uma execução está `EXECUTANDO` mas o `ultimo_sinal` não é atualizado há mais de 120 s (`ORQ_ORFAO_S`),
o worker que a executava caiu (VM desligada, processo morto). Ela é marcada como `ERRO`.
Se o worker na verdade estava vivo (ex.: banco fora do ar por mais que `ORQ_ORFAO_S`), ao voltar a falar
com o banco ele vê que a execução foi marcada como órfã e **encerra o robô**, porque a vaga já foi
liberada e outra execução do mesmo robô pode ter começado.

### Robôs não sobrevivem à queda do worker
No Windows, quando um processo morre os filhos dele continuam rodando. Para o robô não ficar rodando
sem supervisão (e não rodar em duplicidade com a próxima execução), há duas proteções:

1. **Job Object** — ao iniciar, o worker entra num *Job Object* do Windows com `KILL_ON_JOB_CLOSE`.
   Todo processo que ele inicia (bootstrap, robô, Chrome, chromedriver...) fica no mesmo Job.
   Se o worker cair de qualquer forma (travamento, falta de memória, "Finalizar tarefa", reinício
   do serviço), o Windows encerra todos. No `worker.log` aparece
   `Job Object ativo: se o worker cair, o Windows encerra os robôs junto`.
2. **Limpeza ao reiniciar** — ao subir, o worker procura as execuções que ficaram `EXECUTANDO` em seu nome,
   encerra a árvore de cada `pid` que ainda for um processo do bootstrap e **só então** marca as
   execuções como `ERRO` (liberando a vaga do robô).

Processos abertos fora da árvore do robô (ex.: Excel iniciado via COM/DCOM) não são filhos do worker e
não são cobertos por essas proteções.

**Como validar:** com um robô rodando, finalize o `python.exe` do worker pelo Gerenciador de Tarefas.
O bootstrap, o Python do robô e o navegador devem sumir na hora.

---

## 11. Banco de dados

Criado por `sql/criar_banco.sql`.

| Tabela | Conteúdo |
|---|---|
| `PY_Robo` | `nome`, `ativo`, `max_concorrencia`, `timeout_min`, `caminho_repositorio`, `tag` |
| `PY_RoboParametro` | Informações do formulário de cada robô: `chave`, `rotulo`, `tipo`, `obrigatorio`, `padrao`, `opcoes`, `ajuda`, `ordem` |
| `PY_Agendamento` | `robo_id`, `dias`, `horario`, `intervalo`, `parametros`, `ativo`, `proxima_execucao`, `descricao` |
| `PY_FilaExecucao` | Cada execução: `status`, `origem` (MANUAL/AGENDA), `solicitado_por`, `parametros`, `worker`, `pid`, `ultimo_sinal`, `inicio`, `fim`, `exit_code`, `mensagem`, `resultado`, `log_arquivo`, `log_texto`, `cancelar_solicitado`, `agendamento_id` |

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
| `ORQ_AMBIENTE` | `DEV` | `ambiente` enviado ao bootstrap: `DEV`, `QAS` ou `PRD` |
| `ORQ_TAGS` | vazio | Tags deste runner, separadas por vírgula (ex.: `sap,chrome`) |
| `ORQ_LOG_PARCIAL_S` | `30` | A cada quantos segundos o log em andamento é copiado para o banco |
| `ORQ_MAX_JOBS` | `2` | Execuções simultâneas neste worker |
| `ORQ_POLL_S` | `5` | Intervalo de busca na fila (s) |
| `ORQ_AGENDA_S` | `30` | Intervalo de verificação dos agendamentos (s) |
| `ORQ_SINAL_S` | `10` | Intervalo do sinal de vida e da checagem de cancelamento/timeout (s) |
| `ORQ_ORFAO_S` | `120` | Sem sinal de vida por mais que isso = execução órfã (s) |
| `ORQ_FUSO` | `America/Sao_Paulo` | Fuso dos horários dos agendamentos |

### `api\.env`

| Variável | Padrão | Descrição |
|---|---|---|
| `ORQ_CONN_STR` | — | Mesma conexão do worker. Para usuário SQL, troque `Trusted_Connection=yes` por `UID=...;PWD=...;` |
| `ORQ_FUSO` | `America/Sao_Paulo` | Mesmo valor do worker |
| `API_HOST` | `0.0.0.0` | Interface onde a API escuta (`127.0.0.1` = só a própria máquina) |
| `API_PORTA` | `3001` | Porta da API e do front |
| `API_PASTA_FRONT` | `..\front\dist` | Front compilado servido pela API |
| `API_SESSAO_HORAS` | `12` | Duração do login |
| `API_SEGREDO` | gerado | Chave que assina os logins. Se vazio, é criada em `api\.segredo` no primeiro uso. Com mais de um servidor de API, use o mesmo valor em todos |
| `ORQ_README_URL` | vazio | Link do README completo mostrado na tela Sobre (vazio = sem botão) |
| `ORQ_PIP_REPO` | vazio | Pasta/URL do repositório pip interno, usada nos comandos da tela Sobre |

> **Fuso:** os horários dos agendamentos usam `ORQ_FUSO`; início/fim das execuções usam o relógio do
> SQL Server. Mantenha os dois no mesmo fuso.

---

## 13. Rodando como serviço do Windows

Para o worker subir com a máquina e reiniciar sozinho se cair, use o [NSSM](https://nssm.cc):

```bat
nssm install OrquestradorWorker C:\caminho\OrquestradorV2\env\Scripts\python.exe C:\caminho\OrquestradorV2\worker\worker.py
nssm set OrquestradorWorker AppDirectory C:\caminho\OrquestradorV2\worker
nssm set OrquestradorWorker AppStopMethodConsole 60000
nssm set OrquestradorWorker AppExit Default Restart
nssm set OrquestradorWorker ObjectName .\usuario senha
nssm start OrquestradorWorker
```
- `ObjectName`: usuário Windows com acesso ao banco (o padrão `LocalSystem` normalmente não tem).
- Robôs que abrem **navegador visível** ou fazem automação de tela não funcionam como serviço.
  Para esses, rode o worker pelo Agendador de Tarefas com o gatilho "Ao fazer logon".

A API é instalada da mesma forma, no servidor da API:
```bat
nssm install OrquestradorApi C:\caminho\OrquestradorV2\env\Scripts\python.exe C:\caminho\OrquestradorV2\api\main.py
nssm set OrquestradorApi AppDirectory C:\caminho\OrquestradorV2\api
nssm set OrquestradorApi AppExit Default Restart
nssm set OrquestradorApi ObjectName .\usuario senha
nssm start OrquestradorApi
```

---

## 14. API

Todas as rotas, menos `/api/login`, exigem o cabeçalho `Authorization: Bearer <token>`.
Com perfil *visualizador*, só `GET` é aceito (e `/api/usuarios` é recusado).

| Método | Rota | Descrição |
|---|---|---|
| POST | `/api/login` | `{ login, senha }` → `{ token, usuario }` |
| GET | `/api/me` | Usuário logado |
| POST | `/api/me/senha` | `{ senha_atual, senha_nova }` (qualquer perfil) |
| GET | `/api/usuarios` | Lista de usuários (admin) |
| POST | `/api/usuarios` | `{ login, nome, perfil, senha }` (admin) |
| PUT | `/api/usuarios/:id` | `{ nome, perfil, ativo, senha? }` (admin) |
| GET | `/api/resumo` | Contadores do topo da tela |
| GET | `/api/robos` | Robôs com execuções em andamento e último status |
| GET | `/api/robos/:id` | Robô + informações do formulário |
| POST | `/api/robos` | Cadastra robô: `{ nome, max_concorrencia, timeout_min, ativo, caminho_repositorio, tag, campos }` |
| PUT | `/api/robos/:id` | Atualiza robô e informações |
| PATCH | `/api/robos/:id` | `{ "ativo": true/false }` |
| GET | `/api/robos/:id/parametros` | Informações do formulário |
| POST | `/api/robos/:id/executar` | `{ parametros, solicitado_por }` → `{ id }` |
| GET | `/api/execucoes?status=&robo_id=&limite=` | Lista de execuções |
| GET | `/api/execucoes/:id` | Detalhe (inclui `resultado`) |
| GET | `/api/execucoes/:id/log` | Final do log (até 200 KB): do arquivo, se a API o enxergar, ou da cópia no banco |
| POST | `/api/execucoes/:id/reexecutar` | Nova execução com os mesmos parâmetros |
| POST | `/api/execucoes/:id/cancelar` | Cancela |
| GET | `/api/fila?periodo=hoje\|amanha\|7d&robo_id=` | Execuções em andamento, na fila e próximas agendadas |
| GET | `/api/agendamentos` | Lista |
| POST | `/api/agendamentos` | `{ robo_id, dias, horario, intervalo, parametros }` |
| PATCH | `/api/agendamentos/:id` | `{ "ativo": true/false }` |
| DELETE | `/api/agendamentos/:id` | Exclui |

A documentação interativa (Swagger) fica em `/docs`: faça `POST /api/login`, copie o `token` e cole em
**Authorize** para testar as demais rotas.

> O login protege o front e a API, mas a conexão é HTTP. Fora da rede interna, publique atrás de HTTPS.

---

## 15. Problemas comuns

| Sintoma | Causa / solução |
|---|---|
| Front pede login e ninguém tem usuário | Crie o administrador: `env\Scripts\python api\criar_usuario.py <login> "<nome>"` |
| `Invalid object name 'PY_Usuario'` | Rode o `sql\criar_banco.sql` de novo (ele só acrescenta o que falta) |
| Volta para o login sozinho | Sessão venceu (12 h), usuário desativado ou o `api\.segredo` mudou |
| `npm` não é reconhecido | Node.js não instalado (só é preciso para compilar o front). Instale o LTS e abra um terminal novo |
| `http://localhost:3001` mostra `{"detail":"Not Found"}` | Front não compilado: `npm run build` em `front\` e reinicie a API |
| `ModuleNotFoundError: regra_agenda` | A pasta `comum\` não foi copiada junto com `worker\` / `api\` |
| `ZoneInfoNotFoundError` | Falta o pacote `tzdata`: rode de novo o `pip install --no-index --find-links ...` da seção 4.3 |
| pip: `Location '...' is ignored` | Máquina não enxerga o compartilhamento (rede/VPN) ou o pip não aceitou o caminho UNC: mapeie uma unidade com `net use` (seção 4.3) |
| pip: `No matching distribution found for X` | O pacote X (ou a versão para o seu Python) não está no repositório interno: peça para incluir o `.whl` |
| `'STRING_SPLIT' is not a recognized built-in function` | Banco com nível de compatibilidade abaixo de 130: `ALTER DATABASE RPA SET COMPATIBILITY_LEVEL = 130` |
| Robô com tag fica sempre `PENDENTE` | Nenhum worker ligado tem essa tag em `ORQ_TAGS` |
| `Data source name not found` | Nome do driver ODBC diferente. Veja `Get-OdbcDriver` e ajuste `Driver=` / `DRIVER=` |
| `Invalid object name 'PY_...'` / `Invalid column name` | Banco sem as tabelas. Rode `sql\criar_banco.sql` no banco certo (`USE` no topo) |
| Front mostra "API/banco indisponível" | API parada ou sem conexão com o banco (veja o terminal da API) |
| Página `localhost:5173` não abre | Front não iniciado: `npm run dev` em `front\` |
| Execução fica em `PENDENTE` | Worker parado, robô inativo, limite de execuções simultâneas atingido ou nenhum worker com a tag do robô |
| Execução vai para `ERRO` com `WinError 2` | `ORQ_PYTHON` ou `ORQ_BOOTSTRAP` com caminho errado |
| Execução marcada como órfã | O worker que a executava parou. Veja `ORQ_PASTA_LOGS\worker.log` |
| `Job Object não ativado` no `worker.log` | O Windows recusou o Job Object (versão antiga ou política). A limpeza ao reiniciar continua ativa, mas se o worker cair o robô roda até o worker voltar |
| Mudança no `.env` não fez efeito | O worker só lê o `.env` ao iniciar: reinicie-o |
| Agendamento não dispara | Desativado, regra inválida (veja a coluna Regra) ou ainda na primeira passada |
| Horários "errados" na tela | `ORQ_FUSO` diferente entre worker/API e o fuso do SQL Server |
| `Login failed` como serviço | Defina o usuário do serviço (`nssm set ... ObjectName`) |

Logs:
- `ORQ_PASTA_LOGS\worker.log` — o que o worker fez (um arquivo por dia, 30 dias).
- `ORQ_PASTA_LOGS\AAAAMMDD_<robo>_<id>.log` — saída completa de cada execução.
