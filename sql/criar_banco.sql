/* ============================================================================
   Orquestrador de Robôs — criação do banco

   Cria as 4 tabelas do orquestrador (prefixo PY_):
     PY_Robo           robôs cadastrados
     PY_RoboParametro  informações pedidas no formulário de cada robô
     PY_Agendamento    quando cada robô roda
     PY_FilaExecucao   cada execução (fila, andamento e histórico)

   Pode ser rodado mais de uma vez: só cria o que ainda não existe.
   ============================================================================ */

-- Troque pelo nome do seu banco
USE RPA;
GO

/* ----------------------------------------------------------------------------
   PY_Robo — cadastro dos robôs
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.PY_Robo') IS NULL
CREATE TABLE dbo.PY_Robo (
    id                  INT IDENTITY PRIMARY KEY,
    nome                VARCHAR(100)  UNIQUE,          -- "nomebot" do bootstrap: pasta bots\<nome>
    ativo               BIT           DEFAULT 1,       -- 0 = não executa (nem manual, nem agenda)
    max_concorrencia    INT           DEFAULT 1,       -- execuções simultâneas permitidas (todas as VMs)
    timeout_min         INT           DEFAULT 60,      -- passou disso o processo é morto (TIMEOUT)
    caminho_repositorio NVARCHAR(500) NULL             -- URL Azure DevOps; o bootstrap clona/atualiza
);
GO

/* ----------------------------------------------------------------------------
   PY_RoboParametro — informações pedidas no formulário ao executar/agendar
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.PY_RoboParametro') IS NULL
CREATE TABLE dbo.PY_RoboParametro (
    id          INT IDENTITY PRIMARY KEY,
    robo_id     INT           NOT NULL REFERENCES dbo.PY_Robo(id) ON DELETE CASCADE,
    chave       VARCHAR(50)   NOT NULL,                -- nome da chave no JSON (o que o robô lê)
    rotulo      NVARCHAR(100) NOT NULL,                -- texto exibido ao usuário
    tipo        VARCHAR(20)   NOT NULL
                CONSTRAINT CK_PY_RoboParametro_tipo CHECK (tipo IN ('texto','numero','data','booleano','lista')),
    obrigatorio BIT           NOT NULL DEFAULT 0,
    padrao      NVARCHAR(200) NULL,                    -- valor inicial; para data, 'HOJE'
    opcoes      NVARCHAR(MAX) NULL,                    -- tipo lista: 'valor=Rótulo;valor2=Rótulo 2'
    ajuda       NVARCHAR(300) NULL,                    -- dica exibida abaixo do campo
    ordem       INT           NOT NULL DEFAULT 0,
    CONSTRAINT UQ_PY_RoboParametro UNIQUE (robo_id, chave)
);
GO

/* ----------------------------------------------------------------------------
   PY_Agendamento — quando cada robô roda (dias + horário + intervalo)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.PY_Agendamento') IS NULL
CREATE TABLE dbo.PY_Agendamento (
    id               INT IDENTITY PRIMARY KEY,
    robo_id          INT           REFERENCES dbo.PY_Robo(id),
    dias             VARCHAR(50)   NULL,               -- 'SEG-SEX', 'SEG,QUA,SEX', 'TODOS', 'FDS'
    horario          VARCHAR(20)   NULL,               -- '09:00' ou '08:00-18:00'
    intervalo        VARCHAR(10)   NULL,               -- '15min', '1h', '1h30'
    parametros       NVARCHAR(MAX) NULL,               -- JSON copiado para cada execução
    ativo            BIT           DEFAULT 1,
    proxima_execucao DATETIME2     NULL,               -- calculada pelo worker (fuso ORQ_FUSO)
    descricao        NVARCHAR(200) NULL                -- como o worker entendeu a regra (ou 'ERRO: ...')
);
GO

/* ----------------------------------------------------------------------------
   PY_FilaExecucao — cada execução (pedida, rodando ou finalizada)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.PY_FilaExecucao') IS NULL
CREATE TABLE dbo.PY_FilaExecucao (
    id                  BIGINT IDENTITY PRIMARY KEY,
    robo_id             INT            REFERENCES dbo.PY_Robo(id),
    origem              VARCHAR(20),                   -- 'MANUAL' | 'AGENDA'
    solicitado_por      VARCHAR(100),
    parametros          NVARCHAR(MAX),                 -- JSON do formulário
    status              VARCHAR(20)    DEFAULT 'PENDENTE', -- PENDENTE/EXECUTANDO/SUCESSO/ERRO/CANCELADO/TIMEOUT
    worker              VARCHAR(100),                  -- máquina que executou
    pid                 INT,
    ultimo_sinal        DATETIME2,                     -- sinal de vida: o worker atualiza a cada ~10 s enquanto roda
    inicio              DATETIME2,
    fim                 DATETIME2,
    exit_code           INT,
    criado_em           DATETIME2      DEFAULT SYSDATETIME(),
    cancelar_solicitado BIT            NOT NULL DEFAULT 0,
    log_arquivo         NVARCHAR(400)  NULL,           -- caminho do log completo da execução
    mensagem            NVARCHAR(2000) NULL,           -- motivo de erro/cancelamento/timeout
    agendamento_id      INT            NULL,           -- agendamento que gerou (origem AGENDA)
    resultado           NVARCHAR(MAX)  NULL            -- JSON de retorno do bootstrap
);
GO

-- Índice usado pelo claim da fila e pela contagem de execuções em andamento
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_PY_FilaExecucao_status_criado' AND object_id = OBJECT_ID('dbo.PY_FilaExecucao'))
    CREATE INDEX IX_PY_FilaExecucao_status_criado ON dbo.PY_FilaExecucao (status, criado_em) INCLUDE (robo_id);
GO

/* ----------------------------------------------------------------------------
   Opcional (recomendado): impedir JSON inválido gravado direto no banco
   ----------------------------------------------------------------------------
ALTER TABLE dbo.PY_FilaExecucao ADD CONSTRAINT CK_PY_FilaExecucao_parametros_json
    CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
ALTER TABLE dbo.PY_Agendamento ADD CONSTRAINT CK_PY_Agendamento_parametros_json
    CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
*/

-- Conferência: lista as tabelas e colunas criadas
SELECT t.name AS tabela, c.column_id, c.name AS coluna, TYPE_NAME(c.user_type_id) AS tipo, c.max_length, c.is_nullable
FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
WHERE t.name IN ('PY_Robo', 'PY_RoboParametro', 'PY_Agendamento', 'PY_FilaExecucao')
ORDER BY t.name, c.column_id;
