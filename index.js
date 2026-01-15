// ========================================
// REBECA - SISTEMA DE CORRIDAS
// Versão simplificada - tudo em um arquivo
// ========================================

require('dotenv').config();
const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// Middlewares
app.use(cors());
app.use(express.json());

// Database
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const query = async (text, params) => {
  try {
    return await pool.query(text, params);
  } catch (e) {
    console.error('DB Error:', e.message);
    return { rows: [] };
  }
};

// ========================================
// MIGRATIONS (criar tabelas)
// ========================================
const runMigrations = async () => {
  const sql = `
    CREATE TABLE IF NOT EXISTS empresas (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(100) NOT NULL,
      telefone VARCHAR(20),
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS motoristas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER,
      nome VARCHAR(100) NOT NULL,
      telefone VARCHAR(20),
      senha_hash VARCHAR(64),
      status VARCHAR(20) DEFAULT 'offline',
      ativo BOOLEAN DEFAULT TRUE,
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS corridas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER,
      cliente_telefone VARCHAR(20),
      motorista_id INTEGER,
      origem TEXT,
      destino TEXT,
      status VARCHAR(30) DEFAULT 'aguardando',
      valor DECIMAL(10,2),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    CREATE TABLE IF NOT EXISTS usuarios_master (
      id SERIAL PRIMARY KEY,
      email VARCHAR(100) UNIQUE,
      senha_hash VARCHAR(64),
      nome VARCHAR(100),
      criado_em TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    
    INSERT INTO empresas (id, nome) VALUES (1, 'Empresa Padrão') ON CONFLICT (id) DO NOTHING;
    INSERT INTO usuarios_master (email, senha_hash, nome) VALUES ('admin@ubmax.com', '240be518fabd2724ddb6f04eeb9d5b5a', 'Admin') ON CONFLICT (email) DO NOTHING;
  `;
  
  try {
    await pool.query(sql);
    console.log('✅ Banco de dados configurado!');
  } catch (e) {
    console.log('⚠️ Migrations:', e.message);
  }
};

// ========================================
// ROTAS API
// ========================================

// Health check
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

app.get('/api/status', (req, res) => {
  res.json({ status: 'online', sistema: 'REBECA', versao: '2.1.0' });
});

// Login Master
app.post('/api/auth/master/login', async (req, res) => {
  const { email, senha } = req.body;
  const hash = crypto.createHash('md5').update(senha || '').digest('hex');
  
  const result = await query('SELECT * FROM usuarios_master WHERE email = $1 AND senha_hash = $2', [email, hash]);
  
  if (result.rows.length === 0) {
    return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
  }
  
  const user = result.rows[0];
  const token = jwt.sign({ id: user.id, tipo: 'master' }, process.env.JWT_SECRET || 'segredo', { expiresIn: '24h' });
  
  res.json({ success: true, token, user: { id: user.id, nome: user.nome } });
});

// Dashboard Master
app.get('/api/master/dashboard', async (req, res) => {
  const empresas = await query('SELECT COUNT(*) as total FROM empresas');
  const motoristas = await query('SELECT COUNT(*) as total FROM motoristas');
  const corridas = await query('SELECT COUNT(*) as total FROM corridas');
  
  res.json({
    success: true,
    data: {
      empresas: parseInt(empresas.rows[0]?.total || 0),
      motoristas: parseInt(motoristas.rows[0]?.total || 0),
      corridas: parseInt(corridas.rows[0]?.total || 0)
    }
  });
});

// Dashboard Admin
app.get('/api/admin/dashboard', async (req, res) => {
  const motoristas = await query('SELECT COUNT(*) as total FROM motoristas WHERE ativo = true');
  const corridas = await query('SELECT COUNT(*) as total FROM corridas');
  const hoje = await query("SELECT COUNT(*) as total FROM corridas WHERE DATE(criado_em) = CURRENT_DATE");
  
  res.json({
    success: true,
    data: {
      motoristas: parseInt(motoristas.rows[0]?.total || 0),
      corridas_total: parseInt(corridas.rows[0]?.total || 0),
      corridas_hoje: parseInt(hoje.rows[0]?.total || 0)
    }
  });
});

// Status WhatsApp
app.get('/api/admin/whatsapp/status-conexao', (req, res) => {
  res.json({ conectado: false, status: 'Configure o WhatsApp' });
});

// Webhook
app.get('/webhook', (req, res) => {
  const challenge = req.query['hub.challenge'];
  if (challenge) return res.send(challenge);
  res.sendStatus(200);
});

app.post('/webhook', (req, res) => {
  console.log('Webhook:', JSON.stringify(req.body));
  res.sendStatus(200);
});

// ========================================
// PÁGINAS HTML
// ========================================

const pageStyle = `
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #0f172a; color: white; min-height: 100vh; }
    .container { max-width: 1200px; margin: 0 auto; padding: 20px; }
    .header { display: flex; justify-content: space-between; align-items: center; padding: 20px 0; border-bottom: 1px solid #334155; margin-bottom: 30px; }
    .logo { font-size: 24px; font-weight: bold; }
    .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 30px; }
    .card { background: #1e293b; border-radius: 16px; padding: 24px; text-align: center; }
    .card h3 { color: #94a3b8; font-size: 12px; margin-bottom: 8px; }
    .card .value { font-size: 32px; font-weight: bold; }
    .btn { background: #3b82f6; color: white; border: none; padding: 12px 24px; border-radius: 8px; cursor: pointer; }
    .success { background: #1e293b; border-radius: 16px; padding: 40px; text-align: center; }
    .success h2 { color: #22c55e; margin-bottom: 16px; }
  </style>
`;

// Página Admin
app.get('/admin', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>REBECA - Admin</title>${pageStyle}</head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo" style="color: #3b82f6;">🚗 REBECA - Admin</div>
          <div style="color: #22c55e;">● Online</div>
        </div>
        <div class="cards">
          <div class="card"><h3>MOTORISTAS</h3><div class="value" style="color: #3b82f6;" id="m">0</div></div>
          <div class="card"><h3>CORRIDAS HOJE</h3><div class="value" style="color: #22c55e;" id="h">0</div></div>
          <div class="card"><h3>TOTAL</h3><div class="value" style="color: #8b5cf6;" id="t">0</div></div>
        </div>
        <div class="success">
          <h2>✅ Sistema Online!</h2>
          <p style="color: #94a3b8;">REBECA está pronta para atender.</p>
        </div>
      </div>
      <script>
        fetch('/api/admin/dashboard').then(r=>r.json()).then(d=>{
          if(d.success){
            document.getElementById('m').textContent=d.data.motoristas;
            document.getElementById('h').textContent=d.data.corridas_hoje;
            document.getElementById('t').textContent=d.data.corridas_total;
          }
        });
      </script>
    </body></html>
  `);
});

// Página Master
app.get('/master', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>REBECA - Master</title>${pageStyle}</head>
    <body>
      <div class="container">
        <div class="header">
          <div class="logo" style="color: #8b5cf6;">👑 REBECA - Master</div>
        </div>
        <div class="cards">
          <div class="card"><h3>EMPRESAS</h3><div class="value" style="color: #8b5cf6;" id="e">0</div></div>
          <div class="card"><h3>MOTORISTAS</h3><div class="value" style="color: #3b82f6;" id="m">0</div></div>
          <div class="card"><h3>CORRIDAS</h3><div class="value" style="color: #22c55e;" id="c">0</div></div>
        </div>
        <div class="success">
          <h2>👑 Painel Master</h2>
          <p style="color: #94a3b8;">Gerencie todas as empresas.</p>
          <p style="color: #64748b; margin-top: 16px; font-size: 14px;">Login: admin@ubmax.com | Senha: admin123</p>
        </div>
      </div>
      <script>
        fetch('/api/master/dashboard').then(r=>r.json()).then(d=>{
          if(d.success){
            document.getElementById('e').textContent=d.data.empresas;
            document.getElementById('m').textContent=d.data.motoristas;
            document.getElementById('c').textContent=d.data.corridas;
          }
        });
      </script>
    </body></html>
  `);
});

// Página Motorista
app.get('/motorista', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>REBECA - Motorista</title>${pageStyle}</head>
    <body>
      <div class="container" style="max-width: 500px; text-align: center; padding-top: 50px;">
        <div style="font-size: 64px; margin-bottom: 20px;">🚗</div>
        <h1 style="color: #22c55e; margin-bottom: 30px;">REBECA - Motorista</h1>
        <div class="success">
          <h2>Bem-vindo!</h2>
          <p style="color: #94a3b8; margin-bottom: 20px;">App do motorista.</p>
          <button class="btn" style="background: #22c55e;">FICAR ONLINE</button>
        </div>
      </div>
    </body></html>
  `);
});

// Página Inicial
app.get('/', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html><head><title>REBECA</title>${pageStyle}</head>
    <body>
      <div class="container" style="text-align: center; padding-top: 50px;">
        <div style="font-size: 80px; margin-bottom: 20px;">🚗</div>
        <h1 style="color: #3b82f6; margin-bottom: 10px;">REBECA</h1>
        <p style="color: #94a3b8; margin-bottom: 40px;">Sistema de Corridas via WhatsApp</p>
        <div class="cards" style="max-width: 600px; margin: 0 auto;">
          <a href="/admin" class="card" style="text-decoration: none; color: white;">
            <div style="font-size: 32px; margin-bottom: 10px;">📊</div>
            <h3>ADMIN</h3>
          </a>
          <a href="/master" class="card" style="text-decoration: none; color: white;">
            <div style="font-size: 32px; margin-bottom: 10px;">👑</div>
            <h3>MASTER</h3>
          </a>
          <a href="/motorista" class="card" style="text-decoration: none; color: white;">
            <div style="font-size: 32px; margin-bottom: 10px;">🚗</div>
            <h3>MOTORISTA</h3>
          </a>
        </div>
      </div>
    </body></html>
  `);
});

// ========================================
// INICIAR SERVIDOR
// ========================================
const PORT = process.env.PORT || 3000;

server.listen(PORT, '0.0.0.0', async () => {
  console.log('');
  console.log('========================================');
  console.log('   🚗 REBECA - Sistema de Corridas');
  console.log('========================================');
  console.log('   ✅ Servidor rodando na porta ' + PORT);
  console.log('   📱 /admin - Painel Admin');
  console.log('   👑 /master - Painel Master');
  console.log('   🚗 /motorista - App Motorista');
  console.log('========================================');
  
  await runMigrations();
});

module.exports = app;
