const fs = require('fs');
const path = require('path');
const express = require('express');
const { sql, query, transacao, modo } = require('./db');
const { camposDoRobo, prepararParametros, validarDefinicao, opcoesParaTexto } = require('./parametros');
const agenda = require('./agenda');

// Mesmo fuso do worker (ORQ_FUSO no .env do orquestrador Python)
const FUSO = process.env.ORQ_FUSO || 'America/Sao_Paulo';

const app = express();
app.use(express.json({ limit: '100kb' }));

// Datas saem como texto 'yyyy-mm-dd hh:mi:ss' para não sofrerem conversão de fuso no JSON
const dt = (col) => `CONVERT(varchar(19), ${col}, 120)`;

const wrap = (fn) => (req, res, next) => fn(req, res).catch(next);
const erro = (res, status, mensagem) => res.status(status).json({ erro: mensagem });

// ------------------------------------------------------------------ resumo
app.get('/api/resumo', wrap(async (_req, res) => {
  const [r] = await query(`
    SELECT
      SUM(CASE WHEN status = 'PENDENTE'   THEN 1 ELSE 0 END) AS pendentes,
      SUM(CASE WHEN status = 'EXECUTANDO' THEN 1 ELSE 0 END) AS executando,
      SUM(CASE WHEN status = 'SUCESSO' AND criado_em >= CAST(SYSDATETIME() AS date) THEN 1 ELSE 0 END) AS sucesso_hoje,
      SUM(CASE WHEN status IN ('ERRO','TIMEOUT') AND criado_em >= CAST(SYSDATETIME() AS date) THEN 1 ELSE 0 END) AS erro_hoje,
      (SELECT ${dt('MAX(heartbeat)')} FROM PY_FilaExecucao) AS ultimo_heartbeat
    FROM PY_FilaExecucao`);
  res.json(r);
}));

// ------------------------------------------------------------------ robôs
app.get('/api/robos', wrap(async (_req, res) => {
  res.json(await query(`
    SELECT r.id, r.nome, r.ativo, r.max_concorrencia, r.timeout_min,
           (SELECT COUNT(*) FROM PY_FilaExecucao f WHERE f.robo_id = r.id AND f.status = 'EXECUTANDO') AS executando,
           (SELECT COUNT(*) FROM PY_FilaExecucao f WHERE f.robo_id = r.id AND f.status = 'PENDENTE')   AS pendentes,
           u.status AS ultimo_status, ${dt('u.fim')} AS ultimo_fim
    FROM PY_Robo r
    OUTER APPLY (SELECT TOP 1 status, fim FROM PY_FilaExecucao f
                 WHERE f.robo_id = r.id ORDER BY f.id DESC) u
    ORDER BY r.nome`));
}));

// Cadastro / edição de robô (dados + campos do formulário de parâmetros)
function validarRobo(body) {
  const nome = String(body.nome || '').trim();
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(nome))
    throw new Error('Nome do robô inválido: use letras, números, _ - . (sem espaço). Deve ser o mesmo nome usado pelo bootstrap.');
  const max = parseInt(body.max_concorrencia ?? 1, 10);
  const timeout = parseInt(body.timeout_min ?? 60, 10);
  if (!(max >= 1 && max <= 20)) throw new Error('Execuções simultâneas deve ficar entre 1 e 20');
  if (!(timeout >= 1 && timeout <= 1440)) throw new Error('Timeout deve ficar entre 1 e 1440 minutos');
  const repo = String(body.caminho_repositorio || '').trim();
  if (repo.length > 500) throw new Error('Caminho do repositório muito longo (máx. 500)');
  if (repo && !/^https?:\/\//i.test(repo)) throw new Error('Caminho do repositório deve começar com https://');
  return { nome, max, timeout, repo: repo || null, ativo: body.ativo !== false, campos: validarDefinicao(body.campos) };
}

async function gravarCampos(exec, roboId, campos) {
  await exec('DELETE FROM PY_RoboParametro WHERE robo_id = @robo', { robo: [sql.Int, roboId] });
  for (const c of campos) {
    await exec(`INSERT INTO PY_RoboParametro (robo_id, chave, rotulo, tipo, obrigatorio, padrao, opcoes, ajuda, ordem)
                VALUES (@robo, @chave, @rotulo, @tipo, @obrig, @padrao, @opcoes, @ajuda, @ordem)`, {
      robo: [sql.Int, roboId], chave: [sql.VarChar(50), c.chave], rotulo: [sql.NVarChar(100), c.rotulo],
      tipo: [sql.VarChar(20), c.tipo], obrig: [sql.Bit, c.obrigatorio], padrao: [sql.NVarChar(200), c.padrao],
      opcoes: [sql.NVarChar(sql.MAX), c.opcoes], ajuda: [sql.NVarChar(300), c.ajuda], ordem: [sql.Int, c.ordem],
    });
  }
}

// Dados completos para a tela de edição
app.get('/api/robos/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  const [r] = await query('SELECT id, nome, ativo, max_concorrencia, timeout_min, caminho_repositorio FROM PY_Robo WHERE id = @id', { id: [sql.Int, id] });
  if (!r) return erro(res, 404, 'Robô não encontrado');
  const campos = (await camposDoRobo(id)).map((c) => ({ ...c, opcoes: opcoesParaTexto(c.opcoes), padrao: c.padrao ?? '' }));
  res.json({ ...r, campos });
}));

app.post('/api/robos', wrap(async (req, res) => {
  let r;
  try { r = validarRobo(req.body); } catch (e) { return erro(res, 400, e.message); }
  const [existe] = await query('SELECT id FROM PY_Robo WHERE nome = @nome', { nome: [sql.VarChar(100), r.nome] });
  if (existe) return erro(res, 409, `Já existe um robô chamado "${r.nome}"`);
  const id = await transacao(async (exec) => {
    const [novo] = await exec(`INSERT INTO PY_Robo (nome, ativo, max_concorrencia, timeout_min, caminho_repositorio)
                               OUTPUT inserted.id VALUES (@nome, @ativo, @max, @timeout, @repo)`, {
      nome: [sql.VarChar(100), r.nome], ativo: [sql.Bit, r.ativo], max: [sql.Int, r.max], timeout: [sql.Int, r.timeout],
      repo: [sql.NVarChar(500), r.repo],
    });
    await gravarCampos(exec, novo.id, r.campos);
    return novo.id;
  });
  res.status(201).json({ id });
}));

app.put('/api/robos/:id', wrap(async (req, res) => {
  const id = +req.params.id;
  let r;
  try { r = validarRobo(req.body); } catch (e) { return erro(res, 400, e.message); }
  const [outro] = await query('SELECT id FROM PY_Robo WHERE nome = @nome AND id <> @id',
    { nome: [sql.VarChar(100), r.nome], id: [sql.Int, id] });
  if (outro) return erro(res, 409, `Já existe um robô chamado "${r.nome}"`);
  const ok = await transacao(async (exec) => {
    const [upd] = await exec(`UPDATE PY_Robo SET nome = @nome, ativo = @ativo, max_concorrencia = @max, timeout_min = @timeout,
                                caminho_repositorio = @repo
                              OUTPUT inserted.id WHERE id = @id`, {
      id: [sql.Int, id], nome: [sql.VarChar(100), r.nome], ativo: [sql.Bit, r.ativo],
      max: [sql.Int, r.max], timeout: [sql.Int, r.timeout], repo: [sql.NVarChar(500), r.repo],
    });
    if (!upd) return false;
    await gravarCampos(exec, id, r.campos);
    return true;
  });
  if (!ok) return erro(res, 404, 'Robô não encontrado');
  res.json({ ok: true });
}));

app.patch('/api/robos/:id', wrap(async (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== 'boolean') return erro(res, 400, 'Informe "ativo": true/false');
  await query('UPDATE PY_Robo SET ativo = @ativo WHERE id = @id',
    { id: [sql.Int, +req.params.id], ativo: [sql.Bit, ativo] });
  res.json({ ok: true });
}));

// Campos de parâmetro do robô (para o front montar o formulário)
app.get('/api/robos/:id/parametros', wrap(async (req, res) => {
  res.json(await camposDoRobo(+req.params.id));
}));

app.post('/api/robos/:id/executar', wrap(async (req, res) => {
  const [robo] = await query('SELECT id, ativo FROM PY_Robo WHERE id = @id', { id: [sql.Int, +req.params.id] });
  if (!robo) return erro(res, 404, 'Robô não encontrado');
  if (!robo.ativo) return erro(res, 409, 'Robô está inativo');

  let parametros;
  try { parametros = await prepararParametros(robo.id, req.body.parametros); }
  catch (e) { return erro(res, 400, `Parâmetros inválidos: ${e.message}`); }

  const [novo] = await query(`
    INSERT INTO PY_FilaExecucao (robo_id, origem, solicitado_por, parametros)
    OUTPUT inserted.id
    VALUES (@robo, 'MANUAL', @usuario, @parametros)`, {
    robo: [sql.Int, robo.id],
    usuario: [sql.VarChar(100), (req.body.solicitado_por || 'front').slice(0, 100)],
    parametros: [sql.NVarChar(sql.MAX), parametros],
  });
  res.status(201).json(novo);
}));

// ------------------------------------------------------------------ execuções
app.get('/api/execucoes', wrap(async (req, res) => {
  const limite = Math.min(+req.query.limite || 100, 500);
  const filtros = [];
  const params = { limite: [sql.Int, limite] };
  if (req.query.status) { filtros.push('f.status = @status'); params.status = [sql.VarChar(20), req.query.status]; }
  if (req.query.robo_id) { filtros.push('f.robo_id = @robo'); params.robo = [sql.Int, +req.query.robo_id]; }

  res.json(await query(`
    SELECT TOP (@limite) f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.parametros,
           f.status, f.worker, f.pid, f.exit_code, f.mensagem, f.agendamento_id,
           f.cancelar_solicitado,
           ${dt('f.criado_em')} AS criado_em, ${dt('f.inicio')} AS inicio, ${dt('f.fim')} AS fim,
           CASE WHEN f.inicio IS NULL THEN NULL
                ELSE DATEDIFF(SECOND, f.inicio, ISNULL(f.fim, SYSDATETIME())) END AS duracao_s
    FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
    ${filtros.length ? 'WHERE ' + filtros.join(' AND ') : ''}
    ORDER BY f.id DESC`, params));
}));

// Detalhe de uma execução (tela de log)
app.get('/api/execucoes/:id', wrap(async (req, res) => {
  const [e] = await query(`
    SELECT f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.parametros, f.status, f.worker, f.pid,
           f.exit_code, f.mensagem, f.resultado, f.agendamento_id, f.cancelar_solicitado, f.log_arquivo,
           ${dt('f.criado_em')} AS criado_em, ${dt('f.inicio')} AS inicio, ${dt('f.fim')} AS fim,
           CASE WHEN f.inicio IS NULL THEN NULL
                ELSE DATEDIFF(SECOND, f.inicio, ISNULL(f.fim, SYSDATETIME())) END AS duracao_s
    FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
    WHERE f.id = @id`, { id: [sql.BigInt, +req.params.id] });
  if (!e) return erro(res, 404, 'Execução não encontrada');
  res.json(e);
}));

app.post('/api/execucoes/:id/cancelar', wrap(async (req, res) => {
  const id = [sql.BigInt, +req.params.id];
  // PENDENTE: cancela direto. EXECUTANDO: pede ao worker para matar o processo.
  const [r] = await query(`
    UPDATE PY_FilaExecucao
    SET status = CASE WHEN status = 'PENDENTE' THEN 'CANCELADO' ELSE status END,
        fim    = CASE WHEN status = 'PENDENTE' THEN SYSDATETIME() ELSE fim END,
        mensagem = CASE WHEN status = 'PENDENTE' THEN 'Cancelado antes de iniciar' ELSE mensagem END,
        cancelar_solicitado = 1
    OUTPUT deleted.status AS status_anterior
    WHERE id = @id AND status IN ('PENDENTE', 'EXECUTANDO')`, { id });
  if (!r) return erro(res, 409, 'Execução não está pendente nem em execução');
  res.json({ ok: true, status_anterior: r.status_anterior });
}));

// Lê o log da execução. O caminho vem SEMPRE do banco (nunca do cliente).
app.get('/api/execucoes/:id/log', wrap(async (req, res) => {
  const [f] = await query('SELECT log_arquivo FROM PY_FilaExecucao WHERE id = @id',
    { id: [sql.BigInt, +req.params.id] });
  if (!f || !f.log_arquivo) return res.type('text/plain').send('(sem log ainda)');

  const arq = path.resolve(f.log_arquivo);
  if (!fs.existsSync(arq)) return res.type('text/plain').send(`(arquivo não encontrado: ${arq})`);

  const MAX = 200 * 1024; // devolve só o final de logs grandes
  const { size } = fs.statSync(arq);
  const fd = fs.openSync(arq, 'r');
  const buf = Buffer.alloc(Math.min(size, MAX));
  fs.readSync(fd, buf, 0, buf.length, Math.max(0, size - MAX));
  fs.closeSync(fd);
  res.type('text/plain; charset=utf-8')
     .send((size > MAX ? '... (início do log omitido)\n' : '') + buf.toString('utf8'));
}));

// ------------------------------------------------------------------ fila de processamento
// Tudo que ainda vai rodar: em execução, aguardando na fila e as próximas ocorrências dos agendamentos.
app.get('/api/fila', wrap(async (req, res) => {
  // periodo: hoje (até 23:59 de hoje) | amanha (até 23:59 de amanhã) | 7d (até 23:59 do 7º dia)
  const DIAS_PERIODO = { hoje: 0, amanha: 1, '7d': 7 };
  const periodo = req.query.periodo in DIAS_PERIODO ? req.query.periodo : 'hoje';
  const roboId = req.query.robo_id ? +req.query.robo_id : null;
  const filtroRobo = roboId ? 'AND f.robo_id = @robo' : '';
  const params = roboId ? { robo: [sql.Int, roboId] } : {};

  const fila = await query(`
    SELECT f.id, f.robo_id, r.nome AS robo, f.origem, f.solicitado_por, f.status, f.agendamento_id,
           f.cancelar_solicitado, ${dt('f.criado_em')} AS criado_em, ${dt('f.inicio')} AS inicio,
           CASE WHEN f.inicio IS NULL THEN NULL ELSE DATEDIFF(SECOND, f.inicio, SYSDATETIME()) END AS duracao_s
    FROM PY_FilaExecucao f JOIN PY_Robo r ON r.id = f.robo_id
    WHERE f.status IN ('EXECUTANDO', 'PENDENTE') ${filtroRobo}
    ORDER BY CASE f.status WHEN 'EXECUTANDO' THEN 0 ELSE 1 END, f.criado_em`, params);

  const ags = await query(`
    SELECT a.id, a.robo_id, r.nome AS robo, r.ativo AS robo_ativo, a.dias, a.horario, a.intervalo, a.cron,
           a.descricao, ${dt('a.proxima_execucao')} AS proxima_execucao
    FROM PY_Agendamento a JOIN PY_Robo r ON r.id = a.robo_id
    WHERE a.ativo = 1 ${roboId ? 'AND a.robo_id = @robo' : ''}`, params);

  const agora = agenda.agoraNoFuso(FUSO);
  const hoje0 = Date.UTC(agora.getUTCFullYear(), agora.getUTCMonth(), agora.getUTCDate());
  const ate = new Date(hoje0 + (DIAS_PERIODO[periodo] + 1) * 86400000 - 1000); // 23:59:59 do último dia

  // Agrupa por robô: quantas execuções no período, a próxima e o resumo de cada agendamento
  const robos = new Map();
  const avisos = [];
  for (const a of ags) {
    if (!robos.has(a.robo_id)) {
      robos.set(a.robo_id, { robo_id: a.robo_id, robo: a.robo, robo_inativo: !a.robo_ativo,
                             total: 0, proxima: null, atrasada: false, agendamentos: [] });
    }
    const g = robos.get(a.robo_id);
    const item = { agendamento_id: a.id, descricao: a.descricao, total: 0, proxima: null };
    g.agendamentos.push(item);

    if (!a.proxima_execucao) { item.aviso = 'aguardando o worker calcular a primeira execução'; continue; }
    const primeira = agenda.deTexto(a.proxima_execucao);
    let lista;
    if (a.cron) lista = primeira <= ate ? [primeira] : [];
    else {
      try { lista = agenda.ocorrencias(agenda.criarRegra(a.dias, a.horario, a.intervalo), primeira, ate, 20000); }
      catch (e) { item.aviso = `regra inválida: ${e.message}`; continue; }
    }
    item.total = lista.length;
    item.proxima = lista.length ? agenda.paraTexto(lista[0]) : null;
    if (!lista.length) item.proxima_fora = a.proxima_execucao; // próxima existe, mas fora do período
    g.total += lista.length;
    if (item.proxima && (!g.proxima || item.proxima < g.proxima)) g.proxima = item.proxima;
    if (lista.length && lista[0] < agora) g.atrasada = true;
  }
  for (const g of robos.values()) for (const it of g.agendamentos) if (it.aviso) avisos.push({ robo: g.robo, ...it });

  const porRobo = [...robos.values()].sort((x, y) =>
    (x.proxima ? 0 : 1) - (y.proxima ? 0 : 1) || (x.proxima || '').localeCompare(y.proxima || '') || x.robo.localeCompare(y.robo));

  res.json({
    agora: agenda.paraTexto(agora), fuso: FUSO, periodo, ate: agenda.paraTexto(ate),
    em_execucao: fila.filter((f) => f.status === 'EXECUTANDO'),
    pendentes: fila.filter((f) => f.status === 'PENDENTE'),
    por_robo: porRobo,
    avisos,
  });
}));

// ------------------------------------------------------------------ agendamentos
app.get('/api/agendamentos', wrap(async (_req, res) => {
  res.json(await query(`
    SELECT a.id, a.robo_id, r.nome AS robo, a.dias, a.horario, a.intervalo, a.cron,
           a.parametros, a.ativo, a.descricao, ${dt('a.proxima_execucao')} AS proxima_execucao
    FROM PY_Agendamento a JOIN PY_Robo r ON r.id = a.robo_id
    ORDER BY a.ativo DESC, r.nome, a.id`));
}));

app.post('/api/agendamentos', wrap(async (req, res) => {
  const { robo_id, dias, horario, intervalo } = req.body;
  if (!robo_id) return erro(res, 400, 'Informe o robô');
  if (!horario && !intervalo) return erro(res, 400, 'Informe o horário ou o intervalo');
  let parametros;
  try { parametros = await prepararParametros(+robo_id, req.body.parametros, { agenda: true }); }
  catch (e) { return erro(res, 400, `Parâmetros inválidos: ${e.message}`); }

  const vazio = (v) => (v && String(v).trim()) || null;
  const [novo] = await query(`
    INSERT INTO PY_Agendamento (robo_id, dias, horario, intervalo, parametros, ativo, descricao)
    OUTPUT inserted.id
    VALUES (@robo, @dias, @horario, @intervalo, @parametros, 1, N'aguardando o worker validar...')`, {
    robo: [sql.Int, +robo_id],
    dias: [sql.VarChar(50), vazio(dias)],
    horario: [sql.VarChar(20), vazio(horario)],
    intervalo: [sql.VarChar(10), vazio(intervalo)],
    parametros: [sql.NVarChar(sql.MAX), parametros],
  });
  res.status(201).json(novo);
}));

app.patch('/api/agendamentos/:id', wrap(async (req, res) => {
  const { ativo } = req.body;
  if (typeof ativo !== 'boolean') return erro(res, 400, 'Informe "ativo": true/false');
  // Ao reativar, zera proxima_execucao: o worker recalcula a partir de agora (sem disparo atrasado)
  await query(`UPDATE PY_Agendamento SET ativo = @ativo,
                 proxima_execucao = CASE WHEN @ativo = 1 THEN NULL ELSE proxima_execucao END
               WHERE id = @id`, { id: [sql.Int, +req.params.id], ativo: [sql.Bit, ativo] });
  res.json({ ok: true });
}));

app.delete('/api/agendamentos/:id', wrap(async (req, res) => {
  await query('DELETE FROM PY_Agendamento WHERE id = @id', { id: [sql.Int, +req.params.id] });
  res.json({ ok: true });
}));

// ------------------------------------------------------------------ erros
app.use((err, _req, res, _next) => {
  console.error(err);
  res.status(500).json({ erro: err.message });
});

const PORT = +process.env.PORT || 3001;
app.listen(PORT, () => console.log(`API do orquestrador em http://localhost:${PORT} (banco: ${modo})`));
