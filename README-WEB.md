# Orquestrador — Front de teste (React) + API (Node)

Interface simples para operar o orquestrador Python: disparar robôs, acompanhar execuções,
ver logs ao vivo, cancelar e gerenciar agendamentos. **A API só lê/grava no banco `RPA`;
quem executa os robôs continua sendo o `worker.py`.**

```
Navegador (React :5173) ──/api──▶ API Node (:3001) ──▶ SQL Server (RPA) ◀── worker.py
```

## Pré-requisitos
- Node.js 20+ (`node -v`)
- O mesmo driver ODBC usado pelo worker (ODBC Driver 18 ou 17)
- `worker.py` rodando (senão as execuções ficam em `PENDENTE`)

## 1. API
```bash
cd api       # dentro do repositório do orquestrador
cp .env.example .env      # (no cmd: copy .env.example .env)
npm install
npm start
```
Deve aparecer: `API do orquestrador em http://localhost:3001 (banco: Windows (ODBC))`.

Teste rápido no navegador: http://localhost:3001/api/robos

**Conexão:** por padrão usa autenticação Windows pela mesma string ODBC do worker
(`DB_CONN_STR`), via pacote `msnodesqlv8`. Se ele não instalar ou preferir usuário SQL,
preencha `DB_USER`/`DB_PASSWORD` no `.env` (precisa de TCP/IP + SQL Browser habilitados no SQLEXPRESS).

> A API lê o arquivo de log apontado em `fila_execucao.log_arquivo`, então precisa rodar
> na mesma máquina do worker (ou ter acesso à pasta de logs).

## 2. Front
Em outro terminal:
```bash
cd front
npm install
npm run dev
```
Abra http://localhost:5173

## Telas

### Execuções
- Lista as últimas 100 execuções, atualizando a cada 3 s; filtros por status e robô.
- **log** — abre o detalhe da execução:
  - resumo (origem, início/fim, duração, código de saída, máquina/PID) e os parâmetros enviados;
  - **resultado do bootstrap** em destaque (✓ Sucesso / ✕ Falha + mensagem) e a **resposta do robô** formatada
    (coluna `fila_execucao.resultado` — rode `sql/migracoes/05_resultado_execucao.sql`);
  - log com número de linha e cores (erros em vermelho, avisos em amarelo, linha final em verde),
    **busca** com destaque, filtro **só avisos e erros**, **copiar** e **baixar .log**;
  - enquanto a execução roda, tudo atualiza a cada 2 s e acompanha o final.
- **cancelar** — `PENDENTE` é cancelado na hora; `EXECUTANDO` marca `cancelar_solicitado`
  e o worker mata o processo em até ~10 s.

### Fila de Processamento
- **Agora:** o que está em execução (com tempo decorrido) e o que está aguardando na fila, na ordem
  em que o worker vai pegar (1º, 2º...). Dá para cancelar daqui.
- **Próximas execuções agendadas:** uma linha por robô com a próxima execução ("hoje 12:00 (em 19 min)"),
  quantas execuções ele terá no período e o resumo de cada agendamento. Período: **Hoje**, **Hoje e amanhã**
  ou **Próximos 7 dias** (sempre até 23:59 do último dia); filtro por robô.
- Clicar no robô abre a aba **Agendamentos** já filtrada nele.
- As ocorrências são calculadas pela API com a mesma regra do worker (`api/agenda.js` é um porte de
  `regra_agenda.py`), a partir da `proxima_execucao` que o worker gravou. Agendamento com `cron` mostra só a próxima.
- Horários no fuso `ORQ_FUSO` (no `api/.env`, padrão `America/Sao_Paulo`) — use o mesmo valor do worker.
- Ocorrência em vermelho "atrasada" = horário já passou e o worker ainda não enfileirou (worker parado?).

### Robôs
- **+ Novo robô / editar** — cadastra nome (vai como `nomebot` para o bootstrap), caminho do
  repositório Azure DevOps (`caminho_repositorio`; rode `sql/migracoes/04_robo_repositorio.sql`), execuções simultâneas,
  tempo máximo e as **informações pedidas ao executar** (campos do formulário: nome exibido, chave,
  tipo, obrigatório, valor padrão, opções e dica). Não precisa mais de SQL para isso.
- Ativar/desativar robô, ver quantos estão rodando/na fila e o último status.
- **▶ Executar** — abre o formulário com as informações cadastradas e coloca na fila.

## Parâmetros amigáveis (tabela `robo_parametro`)

Em vez de digitar JSON, cada robô tem seus campos cadastrados (pela aba **Robôs**) e o front monta o formulário.
A tabela já vem no `sql/00_criar_tabelas.sql` (banco existente: `sql/migracoes/03_robo_parametro.sql`).

| Coluna | Uso |
|---|---|
| `robo_id` | Robô dono do campo |
| `chave` | Nome da chave no JSON — o que o robô lê em `ORQ_PARAMS` |
| `rotulo` | Texto exibido ao usuário |
| `tipo` | `texto`, `numero`, `data`, `booleano` ou `lista` |
| `obrigatorio` | `1` = não deixa enviar vazio |
| `padrao` | Valor já preenchido. Para `data`, `HOJE` = data do dia |
| `opcoes` | Só para `lista`: `valor=Rótulo;valor2=Rótulo 2` |
| `ajuda` | Dica abaixo do campo |
| `ordem` | Ordem no formulário |

Exemplo:
```sql
DECLARE @eco INT = (SELECT id FROM robo WHERE nome = 'eco_bot');
INSERT INTO robo_parametro (robo_id, chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda, ordem) VALUES
 (@eco, 'data',        N'Data de referência', 'data',     0, 'HOJE',  NULL, N'Dia a processar', 1),
 (@eco, 'cliente',     N'Cliente',            'lista',    1, 'TODOS', N'TODOS=Todos;TAESA=Taesa', NULL, 2),
 (@eco, 'reprocessar', N'Reprocessar',        'booleano', 0, 'false', NULL, NULL, 3);
```
Resultado no JSON enviado: `{"data":"2026-11-10","cliente":"TAESA","reprocessar":false}`.

Regras:
- Valores são convertidos para o tipo certo (`numero` → número, `booleano` → true/false, opção numérica de `lista` → número).
- Campos vazios e não obrigatórios **não vão** no JSON — o robô usa o padrão dele.
- A API valida de novo no servidor (obrigatórios, números, datas `AAAA-MM-DD`, opções válidas).
- **Agendamentos:** data com padrão `HOJE` fica vazia (e não é obrigatória), para o robô calcular a data em cada execução — senão todas as execuções usariam a data do dia em que o agendamento foi criado.
- Robô sem campos cadastrados: executa com `{}`.
- **Modo avançado (JSON)**: link no formulário para editar o JSON diretamente; chaves fora do cadastro são mantidas.
- Nas listas de execuções e agendamentos os parâmetros aparecem resumidos (`cliente: TAESA · reprocessar: sim`).

### Agendamentos
- Formulário guiado: dias da semana marcados um a um (Seg … Dom, com atalhos Seg a Sex / Todos / Fim de semana), modo
  (janela + intervalo, uma vez por dia, ou o dia todo), horários com seletor de hora.
- Mostra exatamente o que vai gravar em `dias` / `horario` / `intervalo` e uma prévia.
- Na lista, a coluna **Regra** mostra a `descricao` gravada pelo worker — é a interpretação oficial.
  Regras inválidas aparecem em vermelho com `ERRO: ...` e o agendamento é desativado.
- Reativar um agendamento recalcula a próxima execução a partir de agora (não dispara atrasado).

## Endpoints da API

| Método | Rota | Descrição |
|---|---|---|
| GET | `/api/resumo` | Contadores (executando, fila, sucesso/erro hoje) |
| GET | `/api/robos` | Robôs com execuções em andamento e último status |
| PATCH | `/api/robos/:id` | `{ "ativo": true/false }` |
| GET | `/api/robos/:id` | Robô + campos (tela de edição) |
| POST | `/api/robos` | Cadastra robô: `{ nome, max_concorrencia, timeout_min, ativo, campos: [...] }` |
| PUT | `/api/robos/:id` | Atualiza robô e substitui os campos |
| GET | `/api/robos/:id/parametros` | Campos cadastrados em `robo_parametro` |
| POST | `/api/robos/:id/executar` | `{ "parametros": "{...}", "solicitado_por": "nome" }` → `{ id }` |
| GET | `/api/execucoes?status=&robo_id=&limite=` | Lista de execuções |
| GET | `/api/execucoes/:id` | Detalhe da execução (inclui `resultado` do bootstrap) |
| POST | `/api/execucoes/:id/cancelar` | Cancela pendente / solicita cancelamento |
| GET | `/api/execucoes/:id/log` | Final do log (até 200 KB), texto |
| GET | `/api/fila?periodo=hoje\|amanha\|7d&robo_id=` | Em execução, pendentes e próximas execuções agrupadas por robô |
| GET | `/api/agendamentos` | Lista |
| POST | `/api/agendamentos` | `{ robo_id, dias, horario, intervalo, parametros }` |
| PATCH | `/api/agendamentos/:id` | `{ "ativo": true/false }` |
| DELETE | `/api/agendamentos/:id` | Exclui |

## Observações
- Front de **teste**: não tem login. Não exponha a API fora da sua máquina/rede interna sem autenticação.
- Datas são devolvidas como texto `yyyy-mm-dd hh:mi:ss` exatamente como estão no banco (sem conversão de fuso).
- Todas as queries são parametrizadas; o caminho do log vem sempre do banco, nunca do navegador.

## Problemas comuns
| Sintoma | Solução |
|---|---|
| `Cannot find module 'msnodesqlv8'` | `npm install msnodesqlv8` na pasta `api`; se falhar, use a opção de usuário SQL no `.env` |
| `Data source name not found` | Driver ODBC diferente: ajuste `Driver={ODBC Driver 17 for SQL Server}` |
| Front mostra "API/banco indisponível" | API não está rodando na porta 3001 ou não conecta no banco (veja o terminal da API) |
| Execução fica em `PENDENTE` | `worker.py` parado ou robô inativo |
| Log "(arquivo não encontrado)" | API rodando em outra máquina que não enxerga a pasta de logs do worker |
