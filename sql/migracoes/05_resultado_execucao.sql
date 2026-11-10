USE RPA;
GO
-- JSON de retorno do bootstrap (status / mensagem / resposta do robô), gravado pelo worker ao final
IF COL_LENGTH('dbo.fila_execucao', 'resultado') IS NULL
    ALTER TABLE dbo.fila_execucao ADD resultado NVARCHAR(MAX) NULL;
GO

-- Consultar
SELECT TOP 20 id, status, JSON_VALUE(resultado, '$.status') AS status_bootstrap,
       JSON_VALUE(resultado, '$.mensagem') AS mensagem_bootstrap, resultado
FROM dbo.fila_execucao ORDER BY id DESC;
