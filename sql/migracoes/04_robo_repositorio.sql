USE RPA;
GO
-- Caminho do repositório (Azure DevOps) de cada robô: enviado ao bootstrap como "caminho_repositorio".
-- Vazio = o bootstrap não clona/atualiza, só usa o que já está em C:\RPA\repo\bots\<nome>.
IF COL_LENGTH('dbo.robo', 'caminho_repositorio') IS NULL
    ALTER TABLE dbo.robo ADD caminho_repositorio NVARCHAR(500) NULL;
GO

/* Exemplo:
UPDATE robo SET caminho_repositorio =
  'https://dev.azure.com/hypera/Repositorio_Automacoes_Python/_git/Repositorio_Automacoes_Python/automacoes/eco_bot'
WHERE nome = 'EcoBot';
*/
SELECT id, nome, caminho_repositorio FROM dbo.robo;
