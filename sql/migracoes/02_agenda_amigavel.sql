USE RPA;
GO
-- Agendamento "amigável": dias / horario / intervalo (cron vira opcional)
IF COL_LENGTH('dbo.agendamento', 'dias') IS NULL
    ALTER TABLE dbo.agendamento ADD dias VARCHAR(50) NULL;        -- 'SEG-SEX', 'SEG,QUA,SEX', 'TODOS'
IF COL_LENGTH('dbo.agendamento', 'horario') IS NULL
    ALTER TABLE dbo.agendamento ADD horario VARCHAR(20) NULL;     -- '09:00' ou '08:00-18:00'
IF COL_LENGTH('dbo.agendamento', 'intervalo') IS NULL
    ALTER TABLE dbo.agendamento ADD intervalo VARCHAR(10) NULL;   -- '15min', '30min', '1h', '1h30'
IF COL_LENGTH('dbo.agendamento', 'descricao') IS NULL
    ALTER TABLE dbo.agendamento ADD descricao NVARCHAR(200) NULL; -- preenchida pelo worker
GO
ALTER TABLE dbo.agendamento ALTER COLUMN cron VARCHAR(50) NULL;
GO

/* Exemplos

-- Seg a Sex, das 08:00 às 18:00, a cada 15 min
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG-SEX', '08:00-18:00', '15min', '{}', 1 FROM robo WHERE nome = 'eco_bot';

-- Todo dia útil às 09:00 (uma vez)
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'UTEIS', '09:00', NULL, '{}', 1 FROM robo WHERE nome = 'eco_bot';

-- Seg, Qua e Sex, das 07:00 às 19:00, a cada 1h
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG,QUA,SEX', '07:00-19:00', '1h', '{}', 1 FROM robo WHERE nome = 'eco_bot';

-- Conferir: a coluna descricao mostra como o worker entendeu a regra
SELECT id, dias, horario, intervalo, cron, descricao, proxima_execucao, ativo FROM agendamento;
*/
