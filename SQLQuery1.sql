CREATE TABLE robo (
  id INT IDENTITY PRIMARY KEY,
  nome VARCHAR(100) UNIQUE,        -- ex: eco_bot
  ativo BIT DEFAULT 1,
  max_concorrencia INT DEFAULT 1,
  timeout_min INT DEFAULT 60
);

CREATE TABLE agendamento (
  id INT IDENTITY PRIMARY KEY,
  robo_id INT REFERENCES robo(id),
  cron VARCHAR(50),                -- '0 9 * * 1-5'
  parametros NVARCHAR(MAX),        -- JSON
  ativo BIT DEFAULT 1,
  proxima_execucao DATETIME2
);

CREATE TABLE fila_execucao (
  id BIGINT IDENTITY PRIMARY KEY,
  robo_id INT REFERENCES robo(id),
  origem VARCHAR(20),              -- 'MANUAL' | 'AGENDA'
  solicitado_por VARCHAR(100),
  parametros NVARCHAR(MAX),
  status VARCHAR(20) DEFAULT 'PENDENTE', -- PENDENTE/EXECUTANDO/SUCESSO/ERRO/CANCELADO/TIMEOUT
  worker VARCHAR(100),
  pid INT,
  heartbeat DATETIME2,
  inicio DATETIME2, fim DATETIME2,
  exit_code INT,
  criado_em DATETIME2 DEFAULT SYSDATETIME()
);

INSERT INTO robo (nome, ativo, max_concorrencia, timeout_min)
VALUES ('robo_teste', 1, 1, 2);


USE RPA;
SELECT * FROM robo
SELECT * FROM fila_execucao


-- Sucesso
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros) VALUES (1,'MANUAL','marcelo','{"dorme":5}')
--Erro
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":5}' FROM robo WHERE nome = 'robo_teste';

--Cancelar
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":60}' FROM robo WHERE nome = 'robo_teste';
UPDATE fila_execucao SET cancelar_solicitado=1 WHERE id=6

--Timeout
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros) VALUES (1,'MANUAL','marcelo','{"dorme":300}')

--Concorr�ncia
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros) VALUES (1,'MANUAL','marcelo','{"dorme":5}')
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros) VALUES (1,'MANUAL','marcelo','{"dorme":15}')
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros) VALUES (1,'MANUAL','marcelo','{"dorme":50}')

-- agenda
INSERT INTO agendamento (robo_id, cron, parametros, ativo) VALUES (1,'*/2 * * * *','{"dorme":3}',1)
--desativando 
UPDATE agendamento SET ativo = 0 WHERE id = 1;
------ V2 --------------

USE RPA;

-- ============================================================
-- ACIONAMENTO MANUAL (igual a antes)
-- ============================================================

-- Sucesso
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":5}' FROM robo WHERE nome = 'robo_teste';

-- Erro (exit code 3)
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"exit":3}' FROM robo WHERE nome = 'robo_teste';

-- Cancelar: 1) dispara um job longo
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":60}' FROM robo WHERE nome = 'robo_teste';
-- 2) depois que ele estiver EXECUTANDO, cancela o último em andamento
UPDATE fila_execucao SET cancelar_solicitado = 1
WHERE id = (SELECT MAX(id) FROM fila_execucao WHERE status = 'EXECUTANDO');

-- Timeout (robo_teste tem timeout_min = 2)
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', '{"dorme":300}' FROM robo WHERE nome = 'robo_teste';

-- Concorrência (devem rodar um de cada vez)
INSERT INTO fila_execucao (robo_id, origem, solicitado_por, parametros)
SELECT id, 'MANUAL', 'marcelo', p.parametros
FROM robo
CROSS JOIN (VALUES ('{"dorme":5}'), ('{"dorme":15}'), ('{"dorme":50}')) p(parametros)
WHERE nome = 'robo_teste';


-- ============================================================
-- AGENDAMENTO (novo formato: dias / horario / intervalo)
-- ============================================================

-- Teste rápido: todo dia, o dia todo, a cada 2 min (substitui o antigo '*/2 * * * *')
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'TODOS', NULL, '2min', '{"dorme":3}', 1 FROM robo WHERE nome = 'robo_teste';

-- Janela de horário: Seg a Sex, das 08:00 às 18:00, a cada 15 min
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG-SEX', '08:00-18:00', '15min', '{"dorme":3}', 1 FROM robo WHERE nome = 'robo_teste';

-- Uma vez por dia: dias úteis às 09:00
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'UTEIS', '09:00', NULL, '{"dorme":3}', 1 FROM robo WHERE nome = 'robo_teste';

-- Regra inválida (janela sem intervalo): o worker deve desativar e explicar em descricao
INSERT INTO agendamento (robo_id, dias, horario, intervalo, parametros, ativo)
SELECT id, 'SEG-SEX', '08:00-18:00', NULL, '{}', 1 FROM robo WHERE nome = 'robo_teste';

-- Conferir como o worker entendeu cada regra (aguarde ~30s após inserir)
SELECT id, dias, horario, intervalo, descricao, proxima_execucao, ativo
FROM agendamento ORDER BY id DESC;

-- Execuções geradas pela agenda
SELECT id, agendamento_id, status, criado_em, inicio, fim
FROM fila_execucao WHERE origem = 'AGENDA' ORDER BY id DESC;

-- Desativar todos os agendamentos de teste
UPDATE agendamento SET ativo = 0
WHERE robo_id = (SELECT id FROM robo WHERE nome = 'robo_teste');


-- ============================================================
-- MONITORAMENTO
-- ============================================================
SELECT TOP 20 f.id, r.nome, f.origem, f.status, f.inicio, f.fim, f.exit_code, f.mensagem
FROM fila_execucao f JOIN robo r ON r.id = f.robo_id
ORDER BY f.id DESC;