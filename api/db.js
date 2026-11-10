// Conexão com o SQL Server.
// Sem DB_USER -> autenticação Windows via ODBC (msnodesqlv8), mesma string do worker Python.
// Com DB_USER -> usuário/senha SQL via tedious (driver padrão do mssql).
require('dotenv').config();

const usarWindows = !process.env.DB_USER;
const sql = usarWindows ? require('mssql/msnodesqlv8') : require('mssql');

const config = usarWindows
  ? { connectionString: process.env.DB_CONN_STR, pool: { max: 10 } }
  : {
      server: process.env.DB_SERVER || 'localhost',
      database: process.env.DB_DATABASE || 'RPA',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      options: {
        instanceName: process.env.DB_INSTANCE || undefined,
        trustServerCertificate: true,
        encrypt: false,
      },
      pool: { max: 10 },
    };

let poolPromise;
function pool() {
  if (!poolPromise) {
    poolPromise = new sql.ConnectionPool(config).connect().catch((err) => {
      poolPromise = undefined; // permite tentar de novo na próxima requisição
      throw err;
    });
  }
  return poolPromise;
}

/** Executa uma query parametrizada: query('SELECT ... WHERE id = @id', { id: [sql.Int, 5] }) */
async function query(texto, params = {}) {
  const req = (await pool()).request();
  for (const [nome, [tipo, valor]] of Object.entries(params)) req.input(nome, tipo, valor);
  const r = await req.query(texto);
  return r.recordset ?? [];
}

/**
 * Executa várias queries numa transação. fn recebe exec(texto, params) com a mesma assinatura de query().
 * Se fn lançar erro, tudo é desfeito.
 */
async function transacao(fn) {
  const tx = new sql.Transaction(await pool());
  await tx.begin();
  const exec = async (texto, params = {}) => {
    const req = new sql.Request(tx);
    for (const [nome, [tipo, valor]] of Object.entries(params)) req.input(nome, tipo, valor);
    return (await req.query(texto)).recordset ?? [];
  };
  try {
    const r = await fn(exec);
    await tx.commit();
    return r;
  } catch (e) {
    await tx.rollback().catch(() => {});
    throw e;
  }
}

module.exports = { sql, query, transacao, modo: usarWindows ? 'Windows (ODBC)' : 'SQL user' };
