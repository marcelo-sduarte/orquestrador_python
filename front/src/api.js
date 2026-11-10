async function chamar(metodo, url, corpo) {
  const r = await fetch(url, {
    method: metodo,
    headers: corpo ? { 'Content-Type': 'application/json' } : undefined,
    body: corpo ? JSON.stringify(corpo) : undefined,
  });
  const tipo = r.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await r.json() : await r.text();
  if (!r.ok) throw new Error(dados?.erro || dados || `HTTP ${r.status}`);
  return dados;
}

export const api = {
  resumo: () => chamar('GET', '/api/resumo'),
  robos: () => chamar('GET', '/api/robos'),
  obterRobo: (id) => chamar('GET', `/api/robos/${id}`),
  criarRobo: (dados) => chamar('POST', '/api/robos', dados),
  salvarRobo: (id, dados) => chamar('PUT', `/api/robos/${id}`, dados),
  camposRobo: (id) => chamar('GET', `/api/robos/${id}/parametros`),
  ativarRobo: (id, ativo) => chamar('PATCH', `/api/robos/${id}`, { ativo }),
  executar: (id, parametros, solicitado_por) =>
    chamar('POST', `/api/robos/${id}/executar`, { parametros, solicitado_por }),

  execucoes: (filtros = {}) => {
    const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    return chamar('GET', `/api/execucoes${q ? '?' + q : ''}`);
  },
  cancelar: (id) => chamar('POST', `/api/execucoes/${id}/cancelar`),
  execucao: (id) => chamar('GET', `/api/execucoes/${id}`),
  log: (id) => chamar('GET', `/api/execucoes/${id}/log`),

  fila: (periodo, robo_id) => {
    const q = new URLSearchParams({ periodo, ...(robo_id ? { robo_id } : {}) }).toString();
    return chamar('GET', `/api/fila?${q}`);
  },

  agendamentos: () => chamar('GET', '/api/agendamentos'),
  criarAgendamento: (dados) => chamar('POST', '/api/agendamentos', dados),
  ativarAgendamento: (id, ativo) => chamar('PATCH', `/api/agendamentos/${id}`, { ativo }),
  excluirAgendamento: (id) => chamar('DELETE', `/api/agendamentos/${id}`),
};
