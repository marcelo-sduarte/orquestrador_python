// Sessão (token de login) guardada no navegador. Ao receber 401, o App volta para a tela de login.
const CHAVE = 'orq_sessao';

export function obterSessao() {
  try { return JSON.parse(localStorage.getItem(CHAVE)) || null; } catch { return null; }
}
export function salvarSessao(s) { localStorage.setItem(CHAVE, JSON.stringify(s)); }
export function encerrarSessao() { localStorage.removeItem(CHAVE); }

async function chamar(metodo, url, corpo, { semSessao = false } = {}) {
  const headers = {};
  if (corpo) headers['Content-Type'] = 'application/json';
  const sessao = obterSessao();
  if (sessao?.token && !semSessao) headers.Authorization = `Bearer ${sessao.token}`;

  const r = await fetch(url, { method: metodo, headers, body: corpo ? JSON.stringify(corpo) : undefined });
  const tipo = r.headers.get('content-type') || '';
  const dados = tipo.includes('json') ? await r.json() : await r.text();
  if (r.status === 401 && !semSessao) {
    encerrarSessao();
    window.dispatchEvent(new Event('orq-sessao-expirada'));
  }
  if (!r.ok) throw new Error(dados?.erro || dados || `HTTP ${r.status}`);
  return dados;
}

export const api = {
  login: (login, senha) => chamar('POST', '/api/login', { login, senha }, { semSessao: true }),
  trocarSenha: (senha_atual, senha_nova) => chamar('POST', '/api/me/senha', { senha_atual, senha_nova }),

  usuarios: () => chamar('GET', '/api/usuarios'),
  criarUsuario: (dados) => chamar('POST', '/api/usuarios', dados),
  salvarUsuario: (id, dados) => chamar('PUT', `/api/usuarios/${id}`, dados),

  resumo: () => chamar('GET', '/api/resumo'),
  sobre: () => chamar('GET', '/api/sobre'),
  robos: () => chamar('GET', '/api/robos'),
  obterRobo: (id) => chamar('GET', `/api/robos/${id}`),
  criarRobo: (dados) => chamar('POST', '/api/robos', dados),
  salvarRobo: (id, dados) => chamar('PUT', `/api/robos/${id}`, dados),
  camposRobo: (id) => chamar('GET', `/api/robos/${id}/parametros`),
  ativarRobo: (id, ativo) => chamar('PATCH', `/api/robos/${id}`, { ativo }),
  executar: (id, parametros) => chamar('POST', `/api/robos/${id}/executar`, { parametros }),

  execucoes: (filtros = {}) => {
    const q = new URLSearchParams(Object.entries(filtros).filter(([, v]) => v)).toString();
    return chamar('GET', `/api/execucoes${q ? '?' + q : ''}`);
  },
  reexecutar: (id) => chamar('POST', `/api/execucoes/${id}/reexecutar`),
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
