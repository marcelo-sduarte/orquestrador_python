/* ============================================================================
   Orquestrador de Robôs — criação do banco (estado atual completo)

   Use este script para um banco NOVO. Para um banco que já existe e foi criado
   com versões anteriores, rode os scripts de sql/migracoes/ em ordem (01 → 05).

   Pode ser rodado mais de uma vez: só cria o que ainda não existe.
   ============================================================================ */

-- Troque pelo nome do seu banco
USE RPA;
GO

/* ----------------------------------------------------------------------------
   robo — cadastro dos robôs
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.robo') IS NULL
CREATE TABLE dbo.robo (
    id                  INT IDENTITY PRIMARY KEY,
    nome                VARCHAR(100)  UNIQUE,          -- "nomebot" do bootstrap: pasta bots\<nome>
    ativo               BIT           DEFAULT 1,       -- 0 = não executa (nem manual, nem agenda)
    max_concorrencia    INT           DEFAULT 1,       -- execuções simultâneas permitidas (todas as VMs)
    timeout_min         INT           DEFAULT 60,      -- passou disso o processo é morto (TIMEOUT)
    caminho_repositorio NVARCHAR(500) NULL             -- URL Azure DevOps; o bootstrap clona/atualiza
);
GO

/* ----------------------------------------------------------------------------
   robo_parametro — informações pedidas no formulário ao executar/agendar
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.robo_parametro') IS NULL
CREATE TABLE dbo.robo_parametro (
    id          INT IDENTITY PRIMARY KEY,
    robo_id     INT           NOT NULL REFERENCES dbo.robo(id) ON DELETE CASCADE,
    chave       VARCHAR(50)   NOT NULL,                -- nome da chave no JSON (o que o robô lê)
    rotulo      NVARCHAR(100) NOT NULL,                -- texto exibido ao usuário
    tipo        VARCHAR(20)   NOT NULL
                CONSTRAINT CK_robo_parametro_tipo CHECK (tipo IN ('texto','numero','data','booleano','lista')),
    obrigatorio BIT           NOT NULL DEFAULT 0,
    padrao      NVARCHAR(200) NULL,                    -- valor inicial; para data, 'HOJE'
    opcoes      NVARCHAR(MAX) NULL,                    -- tipo lista: 'valor=Rótulo;valor2=Rótulo 2'
    ajuda       NVARCHAR(300) NULL,                    -- dica exibida abaixo do campo
    ordem       INT           NOT NULL DEFAULT 0,
    CONSTRAINT UQ_robo_parametro UNIQUE (robo_id, chave)
);
GO

/* ----------------------------------------------------------------------------
   agendamento — quando cada robô roda
   Forma amigável (dias / horario / intervalo) ou cron (tem prioridade se preenchido)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.agendamento') IS NULL
CREATE TABLE dbo.agendamento (
    id               INT IDENTITY PRIMARY KEY,
    robo_id          INT           REFERENCES dbo.robo(id),
    cron             VARCHAR(50)   NULL,               -- opcional/avançado: '30 6 1 * *'
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
   fila_execucao — cada execução (pedida, rodando ou finalizada)
   ---------------------------------------------------------------------------- */
IF OBJECT_ID('dbo.fila_execucao') IS NULL
CREATE TABLE dbo.fila_execucao (
    id                  BIGINT IDENTITY PRIMARY KEY,
    robo_id             INT            REFERENCES dbo.robo(id),
    origem              VARCHAR(20),                   -- 'MANUAL' | 'AGENDA'
    solicitado_por      VARCHAR(100),
    parametros          NVARCHAR(MAX),                 -- JSON do formulário
    status              VARCHAR(20)    DEFAULT 'PENDENTE', -- PENDENTE/EXECUTANDO/SUCESSO/ERRO/CANCELADO/TIMEOUT
    worker              VARCHAR(100),                  -- máquina que executou
    pid                 INT,
    heartbeat           DATETIME2,                     -- atualizado a cada ~10 s enquanto roda
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
IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'IX_fila_status_criado' AND object_id = OBJECT_ID('dbo.fila_execucao'))
    CREATE INDEX IX_fila_status_criado ON dbo.fila_execucao (status, criado_em) INCLUDE (robo_id);
GO

/* ----------------------------------------------------------------------------
   Opcional (recomendado): impedir JSON inválido gravado direto no banco
   ----------------------------------------------------------------------------
ALTER TABLE dbo.fila_execucao ADD CONSTRAINT CK_fila_parametros_json
    CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
ALTER TABLE dbo.agendamento ADD CONSTRAINT CK_agenda_parametros_json
    CHECK (parametros IS NULL OR ISJSON(parametros) = 1);
*/

-- Conferência: lista as tabelas e colunas criadas
SELECT t.name AS tabela, c.column_id, c.name AS coluna, TYPE_NAME(c.user_type_id) AS tipo, c.max_length, c.is_nullable
FROM sys.tables t JOIN sys.columns c ON c.object_id = t.object_id
WHERE t.name IN ('robo', 'robo_parametro', 'agendamento', 'fila_execucao')
ORDER BY t.name, c.column_id;
