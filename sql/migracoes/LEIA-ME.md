# Migrações

Para um banco **que já existe** (criado com versões anteriores do orquestrador), rode em ordem.
Todos são idempotentes: rodar de novo não causa erro nem duplica nada.

| Script | O que faz |
|---|---|
| `01_ajustes.sql` | `fila_execucao`: `cancelar_solicitado`, `log_arquivo`, `mensagem`, `agendamento_id` + índice da fila |
| `02_agenda_amigavel.sql` | `agendamento`: `dias`, `horario`, `intervalo`, `descricao`; `cron` passa a aceitar NULL |
| `03_robo_parametro.sql` | Cria `robo_parametro` (campos do formulário de cada robô) |
| `04_robo_repositorio.sql` | `robo.caminho_repositorio` (URL do Azure DevOps enviada ao bootstrap) |
| `05_resultado_execucao.sql` | `fila_execucao.resultado` (JSON de retorno do bootstrap) |

Para um banco **novo**, use só `../00_criar_tabelas.sql` (já contém tudo isso).
