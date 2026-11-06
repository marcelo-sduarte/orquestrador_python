-- Colunas extras usadas pelo worker (rode uma vez; idempotente)
IF COL_LENGTH('fila_execucao', 'cancelar_solicitado') IS NULL
    ALTER TABLE fila_execucao ADD cancelar_solicitado BIT NOT NULL DEFAULT 0;
IF COL_LENGTH('fila_execucao', 'log_arquivo') IS NULL
    ALTER TABLE fila_execucao ADD log_arquivo NVARCHAR(400) NULL;
IF COL_LENGTH('fila_execucao', 'mensagem') IS NULL
    ALTER TABLE fila_execucao ADD mensagem NVARCHAR(2000) NULL;
IF COL_LENGTH('fila_execucao', 'agendamento_id') IS NULL
    ALTER TABLE fila_execucao ADD agendamento_id INT NULL;
GO

-- Índice para o claim da fila e para a contagem de execuções em andamento
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fila_status_criado')
    CREATE INDEX IX_fila_status_criado ON fila_execucao (status, criado_em) INCLUDE (robo_id);
GO
