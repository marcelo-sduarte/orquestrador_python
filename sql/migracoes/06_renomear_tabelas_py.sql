/* ============================================================================
   06 — Renomeia as tabelas para o padrão PY_ + PascalCase
        robo            -> PY_Robo
        robo_parametro  -> PY_RoboParametro
        agendamento     -> PY_Agendamento
        fila_execucao   -> PY_FilaExecucao

   Os dados, chaves estrangeiras e IDENTITY são mantidos (sp_rename só troca o nome).

   ANTES DE RODAR: pare o worker e a API. Depois de rodar, suba os dois com o
   código novo (que já usa os nomes PY_). Código antigo + tabela nova = erro
   "Invalid object name 'robo'".

   Pode ser rodado mais de uma vez: só renomeia o que ainda tem o nome antigo.
   ============================================================================ */
USE RPA;
GO

SET XACT_ABORT ON;
BEGIN TRANSACTION;

-- Tabelas
IF OBJECT_ID('dbo.robo') IS NOT NULL AND OBJECT_ID('dbo.PY_Robo') IS NULL
    EXEC sp_rename 'dbo.robo', 'PY_Robo';
IF OBJECT_ID('dbo.robo_parametro') IS NOT NULL AND OBJECT_ID('dbo.PY_RoboParametro') IS NULL
    EXEC sp_rename 'dbo.robo_parametro', 'PY_RoboParametro';
IF OBJECT_ID('dbo.agendamento') IS NOT NULL AND OBJECT_ID('dbo.PY_Agendamento') IS NULL
    EXEC sp_rename 'dbo.agendamento', 'PY_Agendamento';
IF OBJECT_ID('dbo.fila_execucao') IS NOT NULL AND OBJECT_ID('dbo.PY_FilaExecucao') IS NULL
    EXEC sp_rename 'dbo.fila_execucao', 'PY_FilaExecucao';

-- Constraints e índice com nome próprio (os automáticos, tipo PK__robo__..., ficam como estão)
IF OBJECT_ID('dbo.CK_robo_parametro_tipo') IS NOT NULL
    EXEC sp_rename 'dbo.CK_robo_parametro_tipo', 'CK_PY_RoboParametro_tipo', 'OBJECT';
IF OBJECT_ID('dbo.UQ_robo_parametro') IS NOT NULL
    EXEC sp_rename 'dbo.UQ_robo_parametro', 'UQ_PY_RoboParametro', 'OBJECT';
IF EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fila_status_criado' AND object_id = OBJECT_ID('dbo.PY_FilaExecucao'))
    EXEC sp_rename 'dbo.PY_FilaExecucao.IX_fila_status_criado', 'IX_PY_FilaExecucao_status_criado', 'INDEX';
-- Constraints opcionais de JSON, se tiverem sido criadas
IF OBJECT_ID('dbo.CK_fila_parametros_json') IS NOT NULL
    EXEC sp_rename 'dbo.CK_fila_parametros_json', 'CK_PY_FilaExecucao_parametros_json', 'OBJECT';
IF OBJECT_ID('dbo.CK_agenda_parametros_json') IS NOT NULL
    EXEC sp_rename 'dbo.CK_agenda_parametros_json', 'CK_PY_Agendamento_parametros_json', 'OBJECT';

COMMIT;
GO

-- Conferência: devem aparecer as 4 tabelas PY_ e nenhuma com o nome antigo
SELECT name AS tabela, create_date, modify_date
FROM sys.tables
WHERE name IN ('PY_Robo', 'PY_RoboParametro', 'PY_Agendamento', 'PY_FilaExecucao',
               'robo', 'robo_parametro', 'agendamento', 'fila_execucao')
ORDER BY name;

SELECT (SELECT COUNT(*) FROM dbo.PY_Robo)          AS robos,
       (SELECT COUNT(*) FROM dbo.PY_Agendamento)   AS agendamentos,
       (SELECT COUNT(*) FROM dbo.PY_FilaExecucao)  AS execucoes,
       (SELECT COUNT(*) FROM dbo.PY_RoboParametro) AS parametros;
