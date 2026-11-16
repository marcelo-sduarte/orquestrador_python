import { createContext, useContext, useEffect, useState } from 'react';
import { ArrowRight, BookOpen, ExternalLink, FileText, Lock, Server, Wrench } from 'lucide-react';
import { api } from '../api.js';
import { Pagina, Status } from '../comum.jsx';

const ABAS = [
  { id: 'orquestrador', nome: 'Orquestrador', icone: BookOpen },
  { id: 'instalacao', nome: 'Instalação', icone: Wrench },
  { id: 'api', nome: 'API', icone: Server },
];

// Link do README e repositório pip vêm do api\.env (ORQ_README_URL / ORQ_PIP_REPO): nada interno no código
const Links = createContext({});

function LinkReadme({ texto = 'README completo' }) {
  const { readme_url: url } = useContext(Links);
  if (!url) return null;
  return (
    <a className="btn btn-claro" href={url} target="_blank" rel="noreferrer">
      <FileText size={15} /> {texto} <ExternalLink size={14} />
    </a>
  );
}

/** Documentação dentro do sistema: como o orquestrador funciona e as rotas da API. */
export default function Sobre() {
  const [aba, setAba] = useState('orquestrador');
  const [links, setLinks] = useState({});
  useEffect(() => { api.sobre().then(setLinks).catch(() => {}); }, []);
  return (
    <Links.Provider value={links}>
    <Pagina trilha="SOBRE" acoes={<LinkReadme />}>
      <div className="abas" role="tablist">
        {ABAS.map(({ id, nome, icone: Icone }) => (
          <button key={id} role="tab" aria-selected={aba === id} className={`aba ${aba === id ? 'ativa' : ''}`}
                  onClick={() => setAba(id)}>
            <Icone size={16} /> {nome}
          </button>
        ))}
      </div>
      {aba === 'orquestrador' && <DocOrquestrador />}
      {aba === 'instalacao' && <DocInstalacao />}
      {aba === 'api' && <DocApi />}
    </Pagina>
    </Links.Provider>
  );
}

// ------------------------------------------------------------------ Orquestrador

function DocOrquestrador() {
  return (
    <div className="doc">
      <section>
        <h2>O que é</h2>
        <p>
          O orquestrador executa robôs Python de forma agendada ou sob demanda, distribuindo as execuções entre
          os runners (VMs). Ele guarda o histórico, o log e o resultado de cada execução e mostra tudo nesta interface.
        </p>
      </section>

      <section>
        <h2>Como as partes conversam</h2>
        <div className="doc-fluxo">
          <Caixa titulo="Navegador" texto="Esta interface" />
          <ArrowRight className="doc-seta" aria-hidden="true" />
          <Caixa titulo="API (FastAPI)" texto="Servidor central · porta 3001 · entrega o front" />
          <ArrowRight className="doc-seta" aria-hidden="true" />
          <Caixa titulo="SQL Server" texto="Tabelas PY_ · fila, agenda, histórico" destaque />
          <ArrowRight className="doc-seta doc-seta-volta" aria-hidden="true" />
          <Caixa titulo="Worker (runner)" texto="Um por VM · lê a fila e os agendamentos" />
          <ArrowRight className="doc-seta" aria-hidden="true" />
          <Caixa titulo="bootstrap.py → robô" texto="Atualiza o Git, cria o env e roda o main.py" />
        </div>
        <p className="dica">
          API e worker não falam entre si: os dois só falam com o banco. Se a API cair, os robôs e os agendamentos
          continuam rodando; só a tela fica indisponível.
        </p>
      </section>

      <section>
        <h2>Telas</h2>
        <table className="doc-tabela">
          <tbody>
            <tr><th>Execuções</th><td>Histórico com status, quem pediu, duração, mensagem e log. Permite reexecutar e cancelar.</td></tr>
            <tr><th>Fila de Processamento</th><td>O que está rodando, o que aguarda vaga e as próximas ocorrências dos agendamentos.</td></tr>
            <tr><th>Robôs</th><td>Cadastro do robô (repositório, runner/tag, concorrência, timeout e campos de parâmetro) e o botão de executar agora.</td></tr>
            <tr><th>Agendamentos</th><td>Dias da semana, horário ou janela de horário e intervalo de repetição, com branch, ambiente e executar_bot.</td></tr>
            <tr><th>Usuários</th><td>Somente administrador: criar usuários, definir o perfil, ativar ou desativar e redefinir a senha.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Perfis</h2>
        <table className="doc-tabela">
          <tbody>
            <tr><th>Administrador</th><td>Faz tudo: executa, cadastra e edita robôs e agendamentos, cancela execuções e gerencia usuários.</td></tr>
            <tr><th>Somente visualização</th><td>Consulta execuções (com log), fila, robôs e agendamentos. A API recusa qualquer alteração vinda deste perfil.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2>Ciclo de uma execução</h2>
        <div className="doc-status">
          <Status valor="PENDENTE" /><ArrowRight size={16} aria-hidden="true" />
          <Status valor="EXECUTANDO" /><ArrowRight size={16} aria-hidden="true" />
          <span className="doc-status-fim">
            <Status valor="SUCESSO" /> <Status valor="ERRO" /> <Status valor="CANCELADO" /> <Status valor="TIMEOUT" />
          </span>
        </div>
        <ul>
          <li><b>SUCESSO</b>: o bootstrap terminou com código 0 e o robô não retornou <code>"status": "falha"</code>.</li>
          <li><b>ERRO</b>: código diferente de 0, retorno <code>falha</code>, erro ao iniciar ou o runner parou de dar sinal de vida (execução órfã).</li>
          <li><b>CANCELADO</b>: alguém cancelou pela tela. <b>TIMEOUT</b>: passou do tempo máximo do robô.</li>
          <li>No cancelamento, timeout ou queda do worker, o robô e todos os processos filhos (Chrome, chromedriver…) são encerrados.</li>
        </ul>
      </section>

      <section>
        <h2>Agendamentos</h2>
        <p>
          A cada 30 segundos os workers transformam os agendamentos vencidos em execuções na fila. Um mesmo agendamento
          nunca gera duas execuções pendentes ao mesmo tempo, mesmo com vários runners ligados.
        </p>
        <ul>
          <li><b>Repetir dentro de um horário</b>: ex. das 08:00 às 18:00, a cada 30 minutos.</li>
          <li><b>Uma vez por dia</b>: ex. às 07:00.</li>
          <li><b>Repetir o dia todo</b>: a cada N minutos, 24 horas.</li>
        </ul>
      </section>

      <section>
        <h2>Runners e tags</h2>
        <p>
          Cada robô pode ter uma <b>tag</b> (ex.: <code>sap</code>) e cada runner declara as suas em <code>ORQ_TAGS</code>.
          Robô sem tag roda em qualquer runner; robô com tag só roda em runner que tenha a mesma tag. Se nenhum runner
          ligado tiver a tag, a execução fica <b>PENDENTE</b>.
        </p>
      </section>

      <section>
        <h2>Contrato com o bootstrap e o robô</h2>
        <p>O worker chama o <code>bootstrap.py</code> passando um JSON:</p>
        <pre>{`{"ambiente": "DEV", "nomebot": "MeuRobo", "executar_bot": "True",
 "caminho_repositorio": "https://seu-git/.../meu_robo", "branch": "DEV",
 "parametros": { ... campos do formulário ... }}`}</pre>
        <ul>
          <li><code>ambiente</code> aceita só <b>DEV</b>, <b>QAS</b> ou <b>PRD</b>. <code>executar_bot = False</code> só atualiza o código e as dependências.</li>
          <li>O robô imprime na última linha um JSON com <code>status</code> (<code>sucesso</code> ou <code>falha</code>) e <code>message</code>.</li>
          <li>O bootstrap devolve <code>{"status", "mensagem", "resposta"}</code>; a mensagem aparece na coluna Mensagem e o JSON no log.</li>
        </ul>
      </section>

      <section>
        <h2>Onde cada parte roda</h2>
        <table className="doc-tabela">
          <tbody>
            <tr><th>Runners (VMs)</th><td>Só <code>worker\</code> + <code>comum\</code>, o bootstrap e os robôs. Configuração em <code>worker\.env</code>.</td></tr>
            <tr><th>Servidor central</th><td><code>api\</code> + <code>comum\</code> + <code>front\dist</code>. Configuração em <code>api\.env</code>. Não precisa de Node.</td></tr>
            <tr><th>SQL Server</th><td>Banco único criado por <code>sql\criar_banco.sql</code>.</td></tr>
            <tr><th>Bibliotecas Python</th><td>Instaladas com <code>pip</code>; se houver repositório interno (<code>ORQ_PIP_REPO</code>), só dele (ver README).</td></tr>
          </tbody>
        </table>
        <p className="dica">Detalhes de instalação, variáveis de ambiente e problemas comuns estão no README do repositório.</p>
      </section>
    </div>
  );
}

// ------------------------------------------------------------------ Instalação

function DocInstalacao() {
  const { pip_repo: repo } = useContext(Links);
  // Com repositório interno configurado: instala só dele (--no-index); senão, pip padrão
  const pip = (req) => (repo
    ? `env\\Scripts\\pip install --no-index -r ${req} ^\n  --find-links "${repo}"`
    : `env\\Scripts\\pip install -r ${req}`);
  return (
    <div className="doc">
      <section>
        <h2>Visão geral</h2>
        <p>
          Três lugares: o <b>banco</b> (uma vez), o <b>servidor central</b> com a API e o front, e cada <b>runner</b> (VM)
          com o worker. Todos precisam de Python 3.12+ e do ODBC Driver 17 ou 18 for SQL Server. O Node só é usado na
          máquina de desenvolvimento, para compilar o front.
        </p>
        <p className="dica">Os comandos abaixo são para o Prompt de Comando (CMD), na pasta do projeto. Use os caminhos reais da máquina.</p>
      </section>

      <section>
        <h2><span className="passo">1</span> Banco de dados (uma vez)</h2>
        <ol>
          <li>No SSMS, abra <code>sql\criar_banco.sql</code>, ajuste o <code>USE RPA;</code> para o banco certo e execute.</li>
          <li>O script é seguro para rodar de novo: só cria o que falta e não mexe nos dados.</li>
          <li>O banco precisa de nível de compatibilidade 130 ou maior (filtro de tags).</li>
        </ol>
      </section>

      <section>
        <h2><span className="passo">2</span> Servidor central: API + front</h2>
        <p>Copie as pastas <code>api\</code>, <code>comum\</code> e <code>front\dist</code> (o front já compilado).</p>
        <pre>{`python -m venv env
${pip(String.raw`api\requirements.txt`)}
copy api\\.env.example api\\.env
env\\Scripts\\python api\\main.py`}</pre>
        <ul>
          <li>No <code>api\.env</code>: <code>ORQ_CONN_STR</code> (conexão com o SQL Server), <code>ORQ_FUSO</code> e um <code>API_SEGREDO</code> fixo.</li>
          <li>Deve aparecer <code>API do orquestrador em http://localhost:3001</code>. Libere a porta 3001 no firewall para os usuários.</li>
        </ul>
      </section>

      <section>
        <h2><span className="passo">3</span> Primeiro administrador</h2>
        <pre>{`env\\Scripts\\python api\\criar_usuario.py admin "Administrador"`}</pre>
        <p className="dica">A senha é pedida no terminal (mínimo 8 caracteres). Os demais usuários são criados na tela Usuários.</p>
      </section>

      <section>
        <h2><span className="passo">4</span> Cada runner (VM)</h2>
        <p>Copie só <code>worker\</code> e <code>comum\</code>. O bootstrap e os robôs também ficam na VM.</p>
        <pre>{`python -m venv env
${pip(String.raw`worker\requirements.txt`)}
copy worker\\.env.example worker\\.env
env\\Scripts\\python worker\\worker.py`}</pre>
        <table className="doc-tabela">
          <tbody>
            <tr><th>ORQ_CONN_STR</th><td>A mesma conexão da API, apontando para o servidor SQL central.</td></tr>
            <tr><th>ORQ_PYTHON</th><td>Python que roda o bootstrap (o caminho real, visto com <code>py -0p</code>).</td></tr>
            <tr><th>ORQ_BOOTSTRAP</th><td>Caminho do <code>bootstrap.py</code> nesta VM.</td></tr>
            <tr><th>ORQ_AMBIENTE</th><td>DEV, QAS ou PRD.</td></tr>
            <tr><th>ORQ_TAGS</th><td>Tags deste runner (ex.: <code>sap,chrome</code>). Vazio = só robôs sem tag.</td></tr>
            <tr><th>ORQ_PASTA_LOGS</th><td>Pasta dos logs. Numa pasta de rede, a tela mostra o log completo de qualquer runner.</td></tr>
          </tbody>
        </table>
      </section>

      <section>
        <h2><span className="passo">5</span> Front (máquina de desenvolvimento)</h2>
        <pre>{`cd front
npm install
npm run build`}</pre>
        <p className="dica">Gera <code>front\dist</code>; copie essa pasta para o servidor central e recarregue a página com Ctrl+F5. Repita sempre que uma tela mudar.</p>
      </section>

      <section>
        <h2><span className="passo">6</span> Deixar rodando</h2>
        <ul>
          <li><b>API</b>: como serviço do Windows (NSSM), com reinício automático.</li>
          <li><b>Worker</b>: como serviço; se o robô abre navegador visível ou automatiza a tela, use o Agendador de Tarefas com o gatilho "Ao fazer logon".</li>
          <li>A conta que roda cada serviço precisa de acesso ao banco, ao bootstrap e às pastas dos robôs.</li>
          <li>Em teste na mesma máquina, o <code>iniciar.bat</code> sobe API e worker juntos (<code>iniciar.bat build</code> recompila o front antes).</li>
        </ul>
      </section>

      <section>
        <h2>Problemas comuns</h2>
        <table className="doc-tabela">
          <tbody>
            <tr><th>pip: Location ... is ignored</th><td>A máquina não enxerga a pasta do repositório interno (rede/VPN). Mapeie uma unidade com <code>net use</code>.</td></tr>
            <tr><th>No matching distribution</th><td>O pacote ou a versão para o seu Python não está no repositório interno.</td></tr>
            <tr><th>Data source name not found</th><td>Driver ODBC com outro nome. Confira com <code>Get-OdbcDriver</code> no PowerShell.</td></tr>
            <tr><th>Execução sempre PENDENTE</th><td>Worker parado, robô inativo, limite de concorrência ou nenhum runner com a tag do robô.</td></tr>
            <tr><th>Tela não mudou</th><td>O front não foi recompilado: <code>npm run build</code> e Ctrl+F5.</td></tr>
          </tbody>
        </table>
        <p className="dica">Serviços, variáveis completas e mais problemas: veja o README.</p>
        <LinkReadme texto="Abrir o README" />
      </section>
    </div>
  );
}

function Caixa({ titulo, texto, destaque = false }) {
  return (
    <div className={`doc-caixa ${destaque ? 'destaque' : ''}`}>
      <b>{titulo}</b>
      <span>{texto}</span>
    </div>
  );
}

// ------------------------------------------------------------------ API (lida do /openapi.json)

const METODOS = ['get', 'post', 'put', 'patch', 'delete'];
const LIVRES = new Set(['POST /api/login']);
const QUALQUER_PERFIL = new Set(['POST /api/me/senha']);

function quemPode(metodo, caminho) {
  const chave = `${metodo} ${caminho}`;
  if (LIVRES.has(chave)) return 'Sem login';
  if (caminho.startsWith('/api/usuarios')) return 'Administrador';
  if (metodo === 'GET' || QUALQUER_PERFIL.has(chave)) return 'Todos';
  return 'Administrador';
}

function DocApi() {
  const [spec, setSpec] = useState(null);
  const [erro, setErro] = useState('');

  useEffect(() => {
    fetch('/openapi.json')
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then(setSpec)
      .catch((e) => setErro(e.message));
  }, []);

  if (erro) return <div className="faixa-erro">Não foi possível ler a documentação da API ({erro}).</div>;
  if (!spec) return <div className="dica">carregando…</div>;

  // Agrupa as rotas pela tag, na ordem em que a API declara as tags
  const grupos = new Map((spec.tags || []).map((t) => [t.name, { ...t, rotas: [] }]));
  Object.entries(spec.paths || {}).forEach(([caminho, ops]) => {
    METODOS.filter((m) => ops[m]).forEach((m) => {
      const op = ops[m];
      const tag = op.tags?.[0] || 'Outras';
      if (!grupos.has(tag)) grupos.set(tag, { name: tag, rotas: [] });
      grupos.get(tag).rotas.push({ metodo: m.toUpperCase(), caminho, resumo: op.summary || '' });
    });
  });

  return (
    <div className="doc">
      <section>
        <div className="doc-api-topo">
          <div>
            <h2>{spec.info?.title} <span className="badge">versão {spec.info?.version}</span></h2>
            {spec.info?.description && <p>{spec.info.description.replace(/\*\*/g, '')}</p>}
          </div>
          <a className="btn" href="/docs" target="_blank" rel="noreferrer">
            Documentação interativa <ExternalLink size={15} />
          </a>
        </div>
      </section>

      <section>
        <h2><Lock size={17} aria-hidden="true" /> Como autenticar</h2>
        <ol>
          <li><code>POST /api/login</code> com <code>{'{"login": "...", "senha": "..."}'}</code> devolve um <code>token</code> válido por 12 horas.</li>
          <li>Envie o token em todas as outras chamadas no cabeçalho <code>Authorization: Bearer &lt;token&gt;</code>.</li>
          <li>Sem token ou com token vencido a API responde <b>401</b>; perfil sem permissão recebe <b>403</b>. Erros vêm como <code>{'{"erro": "mensagem"}'}</code>.</li>
        </ol>
        <pre>{`curl -X POST http://<servidor>:3001/api/login -H "Content-Type: application/json" -d "{\\"login\\":\\"admin\\",\\"senha\\":\\"...\\"}"
curl http://<servidor>:3001/api/execucoes?limite=20 -H "Authorization: Bearer <token>"`}</pre>
      </section>

      {[...grupos.values()].filter((g) => g.rotas.length).map((g) => (
        <section key={g.name}>
          <h2>{g.name}</h2>
          {g.description && <p className="dica">{g.description.replace(/`/g, '')}</p>}
          <div className="tabela-rolagem">
            <table className="doc-rotas">
              <colgroup><col style={{ width: 90 }} /><col style={{ width: 330 }} /><col /><col style={{ width: 130 }} /></colgroup>
              <thead><tr><th>Método</th><th>Rota</th><th>O que faz</th><th>Quem pode</th></tr></thead>
              <tbody>
                {g.rotas.map((r) => (
                  <tr key={`${r.metodo} ${r.caminho}`}>
                    <td><span className={`metodo metodo-${r.metodo.toLowerCase()}`}>{r.metodo}</span></td>
                    <td><code>{r.caminho}</code></td>
                    <td className="quebra">{r.resumo}</td>
                    <td>{quemPode(r.metodo, r.caminho)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ))}
    </div>
  );
}
