USE RPA;
GO
/* Cadastro dos parâmetros de cada robô.
   O front usa esta tabela para montar um formulário (em vez do usuário digitar JSON).

   tipo:
     texto     -> caixa de texto
     numero    -> campo numérico
     data      -> calendário (formato gravado: AAAA-MM-DD). padrao = 'HOJE' preenche a data do dia
     booleano  -> Sim/Não (gravado como true/false)
     lista     -> caixa de seleção. opcoes = 'valor=Rótulo;valor2=Rótulo 2'
                  (valores numéricos são gravados como número no JSON)
*/
IF OBJECT_ID('dbo.robo_parametro') IS NULL
CREATE TABLE dbo.robo_parametro (
    id          INT IDENTITY PRIMARY KEY,
    robo_id     INT           NOT NULL REFERENCES dbo.robo(id) ON DELETE CASCADE,
    chave       VARCHAR(50)   NOT NULL,           -- nome da chave no JSON (o que o robô lê)
    rotulo      NVARCHAR(100) NOT NULL,           -- texto exibido ao usuário
    tipo        VARCHAR(20)   NOT NULL
                CONSTRAINT CK_robo_parametro_tipo CHECK (tipo IN ('texto','numero','data','booleano','lista')),
    obrigatorio BIT           NOT NULL DEFAULT 0,
    padrao      NVARCHAR(200) NULL,               -- valor já preenchido no formulário
    opcoes      NVARCHAR(MAX) NULL,               -- só para tipo 'lista'
    ajuda       NVARCHAR(300) NULL,               -- dica exibida abaixo do campo
    ordem       INT           NOT NULL DEFAULT 0,
    CONSTRAINT UQ_robo_parametro UNIQUE (robo_id, chave)
);
GO

-- Os campos de cada robô agora são cadastrados pela tela (aba Robôs > Novo robô / editar).
-- Para remover os campos de teste antigos (dorme/exit) do robo_teste:
DELETE p FROM dbo.robo_parametro p JOIN dbo.robo r ON r.id = p.robo_id
WHERE r.nome = 'robo_teste' AND p.chave IN ('dorme', 'exit');
GO

/* Exemplo para um robô real:

DECLARE @eco INT = (SELECT id FROM dbo.robo WHERE nome = 'eco_bot');
INSERT INTO dbo.robo_parametro (robo_id, chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda, ordem) VALUES
 (@eco, 'data',        N'Data de referência', 'data',     0, 'HOJE', NULL,
        N'Dia a processar. Em agendamentos, deixe vazio para usar a data do dia', 1),
 (@eco, 'cliente',     N'Cliente',            'lista',    1, 'TODOS', N'TODOS=Todos;TAESA=Taesa;BRASILIENSE=Brasiliense',
        NULL, 2),
 (@eco, 'reprocessar', N'Reprocessar já processados', 'booleano', 0, 'false', NULL,
        N'Marque para processar novamente itens que já foram concluídos', 3);
*/

-- Conferir
SELECT r.nome, p.ordem, p.chave, p.rotulo, p.tipo, p.obrigatorio, p.padrao, p.opcoes
FROM dbo.robo_parametro p JOIN dbo.robo r ON r.id = p.robo_id
ORDER BY r.nome, p.ordem;
