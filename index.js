// =====================================================
// UBMAX SISTEMA COMPLETO - REBECA IA
// Versão Railway - Todas funcionalidades em arquivo único
// =====================================================

const express = require('express');
const cors = require('cors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { Pool } = require('pg');
const http = require('http');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// =====================================================
// CONFIGURAÇÃO DO BANCO DE DADOS
// =====================================================
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false
});

const query = async (text, params) => {
  const client = await pool.connect();
  try {
    return await client.query(text, params);
  } finally {
    client.release();
  }
};

// =====================================================
// MIGRATIONS - TODAS AS 22 TABELAS
// =====================================================
const runMigrations = async () => {
  console.log('🔄 Executando migrations...');
  
  const migrations = `
    -- Empresas (multi-tenant)
    CREATE TABLE IF NOT EXISTS empresas (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      slug VARCHAR(100) UNIQUE NOT NULL,
      telefone_whatsapp VARCHAR(20),
      email VARCHAR(255),
      logo_url TEXT,
      cor_primaria VARCHAR(7) DEFAULT '#6C63FF',
      cor_secundaria VARCHAR(7) DEFAULT '#4CAF50',
      endereco TEXT,
      cidade VARCHAR(100),
      estado VARCHAR(2),
      cep VARCHAR(10),
      cnpj VARCHAR(20),
      plano VARCHAR(50) DEFAULT 'basico',
      ativo BOOLEAN DEFAULT true,
      config_ia JSONB DEFAULT '{}',
      config_whatsapp JSONB DEFAULT '{}',
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Admins das empresas
    CREATE TABLE IF NOT EXISTS admins (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) NOT NULL,
      telefone VARCHAR(20),
      senha_hash VARCHAR(255) NOT NULL,
      avatar_url TEXT,
      permissoes JSONB DEFAULT '["all"]',
      ultimo_acesso TIMESTAMP,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Usuários Master (superadmins)
    CREATE TABLE IF NOT EXISTS usuarios_master (
      id SERIAL PRIMARY KEY,
      nome VARCHAR(255) NOT NULL,
      email VARCHAR(255) UNIQUE NOT NULL,
      senha_hash VARCHAR(255) NOT NULL,
      telefone VARCHAR(20),
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Motoristas
    CREATE TABLE IF NOT EXISTS motoristas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome VARCHAR(255) NOT NULL,
      telefone VARCHAR(20) NOT NULL,
      email VARCHAR(255),
      cpf VARCHAR(14),
      cnh VARCHAR(20),
      cnh_validade DATE,
      senha_hash VARCHAR(255),
      foto_url TEXT,
      veiculo_modelo VARCHAR(100),
      veiculo_placa VARCHAR(10),
      veiculo_cor VARCHAR(50),
      veiculo_ano INTEGER,
      status VARCHAR(20) DEFAULT 'offline',
      latitude DECIMAL(10, 8),
      longitude DECIMAL(11, 8),
      avaliacao_media DECIMAL(3, 2) DEFAULT 5.00,
      total_corridas INTEGER DEFAULT 0,
      total_ganhos DECIMAL(10, 2) DEFAULT 0,
      comissao_percentual DECIMAL(5, 2) DEFAULT 20.00,
      documentos_verificados BOOLEAN DEFAULT false,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Clientes (passageiros)
    CREATE TABLE IF NOT EXISTS clientes (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome VARCHAR(255),
      telefone VARCHAR(20) NOT NULL,
      email VARCHAR(255),
      foto_url TEXT,
      endereco_favorito TEXT,
      latitude_favorita DECIMAL(10, 8),
      longitude_favorita DECIMAL(11, 8),
      total_corridas INTEGER DEFAULT 0,
      avaliacao_media DECIMAL(3, 2) DEFAULT 5.00,
      bloqueado BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Corridas
    CREATE TABLE IF NOT EXISTS corridas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      cliente_id INTEGER REFERENCES clientes(id),
      motorista_id INTEGER REFERENCES motoristas(id),
      origem_endereco TEXT NOT NULL,
      origem_latitude DECIMAL(10, 8),
      origem_longitude DECIMAL(11, 8),
      destino_endereco TEXT NOT NULL,
      destino_latitude DECIMAL(10, 8),
      destino_longitude DECIMAL(11, 8),
      distancia_km DECIMAL(10, 2),
      duracao_estimada INTEGER,
      valor DECIMAL(10, 2),
      valor_motorista DECIMAL(10, 2),
      valor_empresa DECIMAL(10, 2),
      forma_pagamento VARCHAR(50) DEFAULT 'dinheiro',
      status VARCHAR(30) DEFAULT 'pendente',
      codigo_confirmacao VARCHAR(6),
      observacoes TEXT,
      avaliacao_cliente INTEGER,
      avaliacao_motorista INTEGER,
      comentario_cliente TEXT,
      iniciada_em TIMESTAMP,
      finalizada_em TIMESTAMP,
      cancelada_em TIMESTAMP,
      motivo_cancelamento TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Conversas WhatsApp
    CREATE TABLE IF NOT EXISTS conversas (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      cliente_id INTEGER REFERENCES clientes(id),
      telefone VARCHAR(20) NOT NULL,
      nome_contato VARCHAR(255),
      etapa VARCHAR(50) DEFAULT 'inicio',
      contexto JSONB DEFAULT '{}',
      ultima_mensagem TEXT,
      ultima_interacao TIMESTAMP DEFAULT NOW(),
      atendente_humano BOOLEAN DEFAULT false,
      ativa BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Mensagens
    CREATE TABLE IF NOT EXISTS mensagens (
      id SERIAL PRIMARY KEY,
      conversa_id INTEGER REFERENCES conversas(id),
      empresa_id INTEGER REFERENCES empresas(id),
      tipo VARCHAR(20) DEFAULT 'texto',
      direcao VARCHAR(20) DEFAULT 'entrada',
      conteudo TEXT,
      midia_url TEXT,
      midia_tipo VARCHAR(50),
      status_envio VARCHAR(20) DEFAULT 'enviado',
      whatsapp_message_id VARCHAR(255),
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Configurações de preços
    CREATE TABLE IF NOT EXISTS configuracoes_preco (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id) UNIQUE,
      preco_base DECIMAL(10, 2) DEFAULT 5.00,
      preco_km DECIMAL(10, 2) DEFAULT 2.50,
      preco_minuto DECIMAL(10, 2) DEFAULT 0.50,
      preco_minimo DECIMAL(10, 2) DEFAULT 8.00,
      taxa_noturna_percentual DECIMAL(5, 2) DEFAULT 20.00,
      hora_inicio_noturna TIME DEFAULT '22:00',
      hora_fim_noturna TIME DEFAULT '06:00',
      raio_maximo_km DECIMAL(10, 2) DEFAULT 50.00,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Transações financeiras
    CREATE TABLE IF NOT EXISTS transacoes (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      motorista_id INTEGER REFERENCES motoristas(id),
      corrida_id INTEGER REFERENCES corridas(id),
      tipo VARCHAR(50) NOT NULL,
      valor DECIMAL(10, 2) NOT NULL,
      descricao TEXT,
      status VARCHAR(20) DEFAULT 'pendente',
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Avaliações
    CREATE TABLE IF NOT EXISTS avaliacoes (
      id SERIAL PRIMARY KEY,
      corrida_id INTEGER REFERENCES corridas(id),
      avaliador_tipo VARCHAR(20),
      avaliado_tipo VARCHAR(20),
      nota INTEGER CHECK (nota >= 1 AND nota <= 5),
      comentario TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Notificações
    CREATE TABLE IF NOT EXISTS notificacoes (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      usuario_tipo VARCHAR(20),
      usuario_id INTEGER,
      titulo VARCHAR(255),
      mensagem TEXT,
      tipo VARCHAR(50),
      lida BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Logs do sistema
    CREATE TABLE IF NOT EXISTS logs_sistema (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER,
      tipo VARCHAR(50),
      acao VARCHAR(255),
      detalhes JSONB,
      ip VARCHAR(45),
      user_agent TEXT,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- WhatsApp Instâncias (Evolution API)
    CREATE TABLE IF NOT EXISTS whatsapp_instancias (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id) UNIQUE,
      instance_name VARCHAR(100),
      instance_id VARCHAR(255),
      status VARCHAR(50) DEFAULT 'desconectado',
      qrcode TEXT,
      qrcode_expires_at TIMESTAMP,
      numero_conectado VARCHAR(20),
      webhook_url TEXT,
      api_key VARCHAR(255),
      evolution_api_url TEXT,
      criado_em TIMESTAMP DEFAULT NOW(),
      atualizado_em TIMESTAMP DEFAULT NOW()
    );

    -- Prompts da IA
    CREATE TABLE IF NOT EXISTS prompts_ia (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome VARCHAR(100),
      tipo VARCHAR(50),
      prompt TEXT NOT NULL,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Horários de funcionamento
    CREATE TABLE IF NOT EXISTS horarios_funcionamento (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      dia_semana INTEGER,
      hora_abertura TIME,
      hora_fechamento TIME,
      ativo BOOLEAN DEFAULT true
    );

    -- Áreas de atuação
    CREATE TABLE IF NOT EXISTS areas_atuacao (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      nome VARCHAR(100),
      coordenadas JSONB,
      ativo BOOLEAN DEFAULT true
    );

    -- Cupons de desconto
    CREATE TABLE IF NOT EXISTS cupons (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      codigo VARCHAR(50) UNIQUE,
      tipo VARCHAR(20),
      valor DECIMAL(10, 2),
      percentual DECIMAL(5, 2),
      uso_maximo INTEGER,
      uso_atual INTEGER DEFAULT 0,
      validade DATE,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Veículos adicionais
    CREATE TABLE IF NOT EXISTS veiculos (
      id SERIAL PRIMARY KEY,
      motorista_id INTEGER REFERENCES motoristas(id),
      modelo VARCHAR(100),
      marca VARCHAR(100),
      placa VARCHAR(10),
      cor VARCHAR(50),
      ano INTEGER,
      categoria VARCHAR(50),
      principal BOOLEAN DEFAULT false,
      ativo BOOLEAN DEFAULT true,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Chat interno
    CREATE TABLE IF NOT EXISTS chat_suporte (
      id SERIAL PRIMARY KEY,
      empresa_id INTEGER REFERENCES empresas(id),
      usuario_tipo VARCHAR(20),
      usuario_id INTEGER,
      mensagem TEXT,
      anexo_url TEXT,
      lida BOOLEAN DEFAULT false,
      criado_em TIMESTAMP DEFAULT NOW()
    );

    -- Inserir empresa padrão
    INSERT INTO empresas (nome, slug, telefone_whatsapp, email, cidade, estado)
    SELECT 'UBMAX Mobilidade', 'ubmax', '11999999999', 'contato@ubmax.com', 'São Paulo', 'SP'
    WHERE NOT EXISTS (SELECT 1 FROM empresas WHERE slug = 'ubmax');

    -- Inserir usuário master padrão
    INSERT INTO usuarios_master (nome, email, senha_hash)
    SELECT 'Administrador', 'admin@ubmax.com', '21232f297a57a5a743894a0e4a801fc3'
    WHERE NOT EXISTS (SELECT 1 FROM usuarios_master WHERE email = 'admin@ubmax.com');

    -- Inserir admin padrão
    INSERT INTO admins (empresa_id, nome, email, senha_hash)
    SELECT 1, 'Admin UBMAX', 'admin@ubmax.com', '21232f297a57a5a743894a0e4a801fc3'
    WHERE NOT EXISTS (SELECT 1 FROM admins WHERE email = 'admin@ubmax.com');

    -- Inserir configurações de preço padrão
    INSERT INTO configuracoes_preco (empresa_id)
    SELECT 1 WHERE NOT EXISTS (SELECT 1 FROM configuracoes_preco WHERE empresa_id = 1);
  `;

  try {
    await query(migrations);
    console.log('✅ Migrations executadas com sucesso!');
  } catch (error) {
    console.error('❌ Erro nas migrations:', error.message);
  }
};


// =====================================================
// REBECA - INTELIGÊNCIA ARTIFICIAL
// =====================================================
const REBECA_PROMPT = `Você é a REBECA, assistente virtual inteligente de uma empresa de transporte/corridas.

PERSONALIDADE:
- Simpática, profissional e eficiente
- Usa emojis moderadamente para ser mais amigável
- Responde de forma clara e objetiva
- Sempre oferece ajuda adicional

CAPACIDADES:
- Solicitar corridas (pedir origem e destino)
- Informar preços estimados
- Verificar status de corridas
- Ajudar com dúvidas gerais
- Encaminhar para atendente humano quando necessário

FLUXO DE CONVERSA:
1. Saudação inicial → Perguntar como pode ajudar
2. Se pedir corrida → Perguntar origem
3. Após origem → Perguntar destino
4. Após destino → Calcular e informar valor, pedir confirmação
5. Após confirmação → Buscar motorista disponível

REGRAS:
- Nunca invente informações sobre preços ou motoristas
- Se não souber algo, encaminhe para atendente
- Mantenha histórico da conversa em mente
- Seja paciente com clientes confusos`;

// Função para chamar OpenAI
async function chamarOpenAI(mensagens, empresaConfig = {}) {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return 'Desculpe, estou com problemas técnicos. Tente novamente em alguns minutos! 🙏';
  }

  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [
          { role: 'system', content: REBECA_PROMPT },
          ...mensagens
        ],
        max_tokens: 500,
        temperature: 0.7
      })
    });

    const data = await response.json();
    if (data.choices && data.choices[0]) {
      return data.choices[0].message.content;
    }
    return 'Desculpe, não consegui processar sua mensagem. Pode repetir? 🙏';
  } catch (error) {
    console.error('Erro OpenAI:', error);
    return 'Ops! Tive um probleminha. Pode repetir sua mensagem? 😊';
  }
}

// Processar mensagem com IA
async function processarMensagemIA(telefone, mensagem, empresaId = 1) {
  try {
    // Buscar ou criar conversa
    let conversa = await query(
      'SELECT * FROM conversas WHERE telefone = $1 AND empresa_id = $2 AND ativa = true',
      [telefone, empresaId]
    );

    if (conversa.rows.length === 0) {
      const novaConversa = await query(
        'INSERT INTO conversas (empresa_id, telefone, etapa) VALUES ($1, $2, $3) RETURNING *',
        [empresaId, telefone, 'inicio']
      );
      conversa = { rows: [novaConversa.rows[0]] };
    }

    const conversaAtual = conversa.rows[0];

    // Salvar mensagem recebida
    await query(
      'INSERT INTO mensagens (conversa_id, empresa_id, direcao, conteudo) VALUES ($1, $2, $3, $4)',
      [conversaAtual.id, empresaId, 'entrada', mensagem]
    );

    // Buscar últimas mensagens para contexto
    const historico = await query(
      'SELECT direcao, conteudo FROM mensagens WHERE conversa_id = $1 ORDER BY criado_em DESC LIMIT 10',
      [conversaAtual.id]
    );

    // Montar mensagens para OpenAI
    const mensagensIA = historico.rows.reverse().map(m => ({
      role: m.direcao === 'entrada' ? 'user' : 'assistant',
      content: m.conteudo
    }));

    // Chamar IA
    const respostaIA = await chamarOpenAI(mensagensIA);

    // Salvar resposta
    await query(
      'INSERT INTO mensagens (conversa_id, empresa_id, direcao, conteudo) VALUES ($1, $2, $3, $4)',
      [conversaAtual.id, empresaId, 'saida', respostaIA]
    );

    // Atualizar conversa
    await query(
      'UPDATE conversas SET ultima_mensagem = $1, ultima_interacao = NOW() WHERE id = $2',
      [mensagem, conversaAtual.id]
    );

    // Detectar intenções e atualizar etapa
    const msgLower = mensagem.toLowerCase();
    let novaEtapa = conversaAtual.etapa;

    if (msgLower.includes('corrida') || msgLower.includes('carro') || msgLower.includes('viagem')) {
      novaEtapa = 'solicitando_origem';
    } else if (conversaAtual.etapa === 'solicitando_origem' && mensagem.length > 5) {
      novaEtapa = 'solicitando_destino';
      await query(
        "UPDATE conversas SET contexto = contexto || $1 WHERE id = $2",
        [JSON.stringify({ origem: mensagem }), conversaAtual.id]
      );
    } else if (conversaAtual.etapa === 'solicitando_destino' && mensagem.length > 5) {
      novaEtapa = 'confirmando_corrida';
      await query(
        "UPDATE conversas SET contexto = contexto || $1 WHERE id = $2",
        [JSON.stringify({ destino: mensagem }), conversaAtual.id]
      );
    }

    if (novaEtapa !== conversaAtual.etapa) {
      await query('UPDATE conversas SET etapa = $1 WHERE id = $2', [novaEtapa, conversaAtual.id]);
    }

    return {
      resposta: respostaIA,
      etapa: novaEtapa,
      conversaId: conversaAtual.id
    };
  } catch (error) {
    console.error('Erro processando mensagem:', error);
    return {
      resposta: 'Desculpe, tive um problema. Pode repetir? 🙏',
      etapa: 'erro'
    };
  }
}

// =====================================================
// CÁLCULO DE PREÇOS
// =====================================================
async function calcularPreco(empresaId, distanciaKm, duracaoMinutos = 0) {
  try {
    const config = await query(
      'SELECT * FROM configuracoes_preco WHERE empresa_id = $1',
      [empresaId]
    );

    const precos = config.rows[0] || {
      preco_base: 5.00,
      preco_km: 2.50,
      preco_minuto: 0.50,
      preco_minimo: 8.00
    };

    let valor = parseFloat(precos.preco_base) +
                (distanciaKm * parseFloat(precos.preco_km)) +
                (duracaoMinutos * parseFloat(precos.preco_minuto));

    // Taxa noturna
    const horaAtual = new Date().getHours();
    if (horaAtual >= 22 || horaAtual < 6) {
      valor *= 1 + (parseFloat(precos.taxa_noturna_percentual) / 100);
    }

    // Valor mínimo
    valor = Math.max(valor, parseFloat(precos.preco_minimo));

    return {
      valor: Math.round(valor * 100) / 100,
      detalhes: {
        base: parseFloat(precos.preco_base),
        distancia: distanciaKm * parseFloat(precos.preco_km),
        tempo: duracaoMinutos * parseFloat(precos.preco_minuto),
        taxaNoturna: horaAtual >= 22 || horaAtual < 6
      }
    };
  } catch (error) {
    console.error('Erro calculando preço:', error);
    return { valor: 15.00, detalhes: {} };
  }
}


// =====================================================
// WHATSAPP - EVOLUTION API
// =====================================================
const EVOLUTION_API_URL = process.env.EVOLUTION_API_URL || 'https://api.evolution.com.br';
const EVOLUTION_API_KEY = process.env.EVOLUTION_API_KEY || '';

// Criar instância WhatsApp
async function criarInstanciaWhatsApp(empresaId, instanceName) {
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        instanceName: instanceName,
        qrcode: true,
        integration: 'WHATSAPP-BAILEYS'
      })
    });
    
    const data = await response.json();
    
    if (data.instance) {
      await query(
        `INSERT INTO whatsapp_instancias (empresa_id, instance_name, instance_id, status) 
         VALUES ($1, $2, $3, 'aguardando_qr')
         ON CONFLICT (empresa_id) 
         DO UPDATE SET instance_name = $2, instance_id = $3, status = 'aguardando_qr', atualizado_em = NOW()`,
        [empresaId, instanceName, data.instance.instanceId || instanceName]
      );
    }
    
    return data;
  } catch (error) {
    console.error('Erro criando instância:', error);
    return { error: error.message };
  }
}

// Buscar QR Code
async function buscarQRCode(instanceName) {
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/qrcode/${instanceName}`, {
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro buscando QR:', error);
    return { error: error.message };
  }
}

// Verificar status da conexão
async function verificarStatusConexao(instanceName) {
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/connectionState/${instanceName}`, {
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro verificando status:', error);
    return { state: 'close' };
  }
}

// Enviar mensagem WhatsApp
async function enviarMensagemWhatsApp(instanceName, telefone, mensagem) {
  try {
    // Formatar telefone (remover caracteres especiais)
    const telFormatado = telefone.replace(/\D/g, '');
    
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendText/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: telFormatado,
        text: mensagem
      })
    });
    
    const data = await response.json();
    return data;
  } catch (error) {
    console.error('Erro enviando mensagem:', error);
    return { error: error.message };
  }
}

// Enviar imagem WhatsApp
async function enviarImagemWhatsApp(instanceName, telefone, imagemUrl, legenda = '') {
  try {
    const telFormatado = telefone.replace(/\D/g, '');
    
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendMedia/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: telFormatado,
        mediatype: 'image',
        media: imagemUrl,
        caption: legenda
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error('Erro enviando imagem:', error);
    return { error: error.message };
  }
}

// Enviar localização
async function enviarLocalizacaoWhatsApp(instanceName, telefone, latitude, longitude, nome = '', endereco = '') {
  try {
    const telFormatado = telefone.replace(/\D/g, '');
    
    const response = await fetch(`${EVOLUTION_API_URL}/message/sendLocation/${instanceName}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': EVOLUTION_API_KEY
      },
      body: JSON.stringify({
        number: telFormatado,
        latitude: latitude,
        longitude: longitude,
        name: nome,
        address: endereco
      })
    });
    
    return await response.json();
  } catch (error) {
    console.error('Erro enviando localização:', error);
    return { error: error.message };
  }
}

// Desconectar instância
async function desconectarWhatsApp(instanceName) {
  try {
    const response = await fetch(`${EVOLUTION_API_URL}/instance/logout/${instanceName}`, {
      method: 'DELETE',
      headers: { 'apikey': EVOLUTION_API_KEY }
    });
    
    return await response.json();
  } catch (error) {
    console.error('Erro desconectando:', error);
    return { error: error.message };
  }
}


// =====================================================
// SISTEMA DE CORRIDAS E ATRIBUIÇÃO AUTOMÁTICA
// =====================================================

// Criar nova corrida
async function criarCorrida(dados) {
  const {
    empresaId, clienteId, origem, destino,
    origemLat, origemLng, destinoLat, destinoLng,
    distanciaKm, valor, formaPagamento, observacoes
  } = dados;

  try {
    // Gerar código de confirmação
    const codigo = Math.random().toString(36).substring(2, 8).toUpperCase();
    
    // Calcular valores
    const valorMotorista = valor * 0.80; // 80% para motorista
    const valorEmpresa = valor * 0.20;   // 20% para empresa

    const result = await query(
      `INSERT INTO corridas (
        empresa_id, cliente_id, origem_endereco, destino_endereco,
        origem_latitude, origem_longitude, destino_latitude, destino_longitude,
        distancia_km, valor, valor_motorista, valor_empresa,
        forma_pagamento, codigo_confirmacao, observacoes, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, 'pendente')
      RETURNING *`,
      [
        empresaId, clienteId, origem, destino,
        origemLat, origemLng, destinoLat, destinoLng,
        distanciaKm, valor, valorMotorista, valorEmpresa,
        formaPagamento || 'dinheiro', codigo, observacoes
      ]
    );

    const corrida = result.rows[0];

    // Emitir evento via Socket.IO
    io.to(`empresa_${empresaId}`).emit('nova_corrida', corrida);

    // Iniciar busca por motorista
    buscarMotoristaDisponivel(corrida);

    return corrida;
  } catch (error) {
    console.error('Erro criando corrida:', error);
    throw error;
  }
}

// Buscar motorista disponível mais próximo
async function buscarMotoristaDisponivel(corrida) {
  try {
    const motoristas = await query(
      `SELECT *, 
        (6371 * acos(cos(radians($1)) * cos(radians(latitude)) * 
        cos(radians(longitude) - radians($2)) + 
        sin(radians($1)) * sin(radians(latitude)))) AS distancia
      FROM motoristas 
      WHERE empresa_id = $3 
        AND status = 'online' 
        AND ativo = true
        AND latitude IS NOT NULL
      ORDER BY distancia ASC
      LIMIT 5`,
      [corrida.origem_latitude || -23.55, corrida.origem_longitude || -46.63, corrida.empresa_id]
    );

    if (motoristas.rows.length === 0) {
      // Nenhum motorista disponível
      await query(
        "UPDATE corridas SET status = 'sem_motorista' WHERE id = $1",
        [corrida.id]
      );
      io.to(`empresa_${corrida.empresa_id}`).emit('corrida_sem_motorista', { corridaId: corrida.id });
      return null;
    }

    // Notificar motoristas próximos
    for (const motorista of motoristas.rows) {
      io.to(`motorista_${motorista.id}`).emit('nova_corrida_disponivel', {
        corrida,
        distancia: motorista.distancia
      });
    }

    return motoristas.rows;
  } catch (error) {
    console.error('Erro buscando motorista:', error);
    return null;
  }
}

// Motorista aceita corrida
async function aceitarCorrida(corridaId, motoristaId) {
  try {
    // Verificar se corrida ainda está disponível
    const corrida = await query(
      'SELECT * FROM corridas WHERE id = $1 AND status = $2',
      [corridaId, 'pendente']
    );

    if (corrida.rows.length === 0) {
      return { success: false, error: 'Corrida não disponível' };
    }

    // Atribuir motorista
    await query(
      "UPDATE corridas SET motorista_id = $1, status = 'aceita' WHERE id = $2",
      [motoristaId, corridaId]
    );

    // Atualizar status do motorista
    await query(
      "UPDATE motoristas SET status = 'em_corrida' WHERE id = $1",
      [motoristaId]
    );

    // Buscar dados atualizados
    const corridaAtualizada = await query(
      `SELECT c.*, m.nome as motorista_nome, m.telefone as motorista_telefone,
        m.veiculo_modelo, m.veiculo_placa, m.veiculo_cor, m.foto_url as motorista_foto
      FROM corridas c
      LEFT JOIN motoristas m ON c.motorista_id = m.id
      WHERE c.id = $1`,
      [corridaId]
    );

    const dadosCorrida = corridaAtualizada.rows[0];

    // Emitir eventos
    io.to(`empresa_${dadosCorrida.empresa_id}`).emit('corrida_aceita', dadosCorrida);
    io.to(`cliente_${dadosCorrida.cliente_id}`).emit('motorista_a_caminho', dadosCorrida);

    return { success: true, corrida: dadosCorrida };
  } catch (error) {
    console.error('Erro aceitando corrida:', error);
    return { success: false, error: error.message };
  }
}

// Iniciar corrida
async function iniciarCorrida(corridaId, motoristaId) {
  try {
    await query(
      "UPDATE corridas SET status = 'em_andamento', iniciada_em = NOW() WHERE id = $1 AND motorista_id = $2",
      [corridaId, motoristaId]
    );

    const corrida = await query('SELECT * FROM corridas WHERE id = $1', [corridaId]);
    
    io.to(`empresa_${corrida.rows[0].empresa_id}`).emit('corrida_iniciada', corrida.rows[0]);
    io.to(`cliente_${corrida.rows[0].cliente_id}`).emit('corrida_iniciada', corrida.rows[0]);

    return { success: true, corrida: corrida.rows[0] };
  } catch (error) {
    console.error('Erro iniciando corrida:', error);
    return { success: false, error: error.message };
  }
}

// Finalizar corrida
async function finalizarCorrida(corridaId, motoristaId) {
  try {
    await query(
      "UPDATE corridas SET status = 'finalizada', finalizada_em = NOW() WHERE id = $1 AND motorista_id = $2",
      [corridaId, motoristaId]
    );

    // Atualizar status do motorista
    await query(
      "UPDATE motoristas SET status = 'online', total_corridas = total_corridas + 1 WHERE id = $1",
      [motoristaId]
    );

    const corrida = await query('SELECT * FROM corridas WHERE id = $1', [corridaId]);
    const dadosCorrida = corrida.rows[0];

    // Registrar transação
    await query(
      "INSERT INTO transacoes (empresa_id, motorista_id, corrida_id, tipo, valor, status) VALUES ($1, $2, $3, 'corrida', $4, 'concluida')",
      [dadosCorrida.empresa_id, motoristaId, corridaId, dadosCorrida.valor_motorista]
    );

    // Atualizar ganhos do motorista
    await query(
      'UPDATE motoristas SET total_ganhos = total_ganhos + $1 WHERE id = $2',
      [dadosCorrida.valor_motorista, motoristaId]
    );

    io.to(`empresa_${dadosCorrida.empresa_id}`).emit('corrida_finalizada', dadosCorrida);
    io.to(`cliente_${dadosCorrida.cliente_id}`).emit('corrida_finalizada', dadosCorrida);

    return { success: true, corrida: dadosCorrida };
  } catch (error) {
    console.error('Erro finalizando corrida:', error);
    return { success: false, error: error.message };
  }
}

// Cancelar corrida
async function cancelarCorrida(corridaId, motivo, canceladoPor) {
  try {
    const corrida = await query('SELECT * FROM corridas WHERE id = $1', [corridaId]);
    
    if (corrida.rows.length === 0) {
      return { success: false, error: 'Corrida não encontrada' };
    }

    await query(
      "UPDATE corridas SET status = 'cancelada', cancelada_em = NOW(), motivo_cancelamento = $1 WHERE id = $2",
      [motivo, corridaId]
    );

    const dadosCorrida = corrida.rows[0];

    // Se tinha motorista, liberar
    if (dadosCorrida.motorista_id) {
      await query(
        "UPDATE motoristas SET status = 'online' WHERE id = $1",
        [dadosCorrida.motorista_id]
      );
    }

    io.to(`empresa_${dadosCorrida.empresa_id}`).emit('corrida_cancelada', { corridaId, motivo, canceladoPor });

    return { success: true };
  } catch (error) {
    console.error('Erro cancelando corrida:', error);
    return { success: false, error: error.message };
  }
}


// =====================================================
// MIDDLEWARES
// =====================================================
const verificarToken = (req, res, next) => {
  const token = req.headers.authorization?.replace('Bearer ', '');
  if (!token) {
    return res.status(401).json({ success: false, error: 'Token não fornecido' });
  }
  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'segredo');
    req.usuario = decoded;
    next();
  } catch (error) {
    return res.status(401).json({ success: false, error: 'Token inválido' });
  }
};

// =====================================================
// ROTAS DE AUTENTICAÇÃO
// =====================================================

// Login Master
app.post('/api/auth/master/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const senhaHash = crypto.createHash('md5').update(senha || '').digest('hex');
    
    const result = await query(
      'SELECT * FROM usuarios_master WHERE email = $1 AND senha_hash = $2 AND ativo = true',
      [email, senhaHash]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }
    
    const user = result.rows[0];
    const token = jwt.sign(
      { id: user.id, tipo: 'master' },
      process.env.JWT_SECRET || 'segredo',
      { expiresIn: '24h' }
    );
    
    res.json({ success: true, token, user: { id: user.id, nome: user.nome, email: user.email } });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Login Admin
app.post('/api/auth/admin/login', async (req, res) => {
  try {
    const { email, senha } = req.body;
    const senhaHash = crypto.createHash('md5').update(senha || '').digest('hex');
    
    const result = await query(
      `SELECT a.*, e.nome as empresa_nome, e.slug as empresa_slug 
       FROM admins a
       LEFT JOIN empresas e ON a.empresa_id = e.id
       WHERE a.email = $1 AND a.senha_hash = $2 AND a.ativo = true`,
      [email, senhaHash]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }
    
    const admin = result.rows[0];
    const token = jwt.sign(
      { id: admin.id, empresa_id: admin.empresa_id, tipo: 'admin' },
      process.env.JWT_SECRET || 'segredo',
      { expiresIn: '24h' }
    );
    
    // Atualizar último acesso
    await query('UPDATE admins SET ultimo_acesso = NOW() WHERE id = $1', [admin.id]);
    
    res.json({ 
      success: true, 
      token, 
      admin: { 
        id: admin.id, 
        nome: admin.nome, 
        email: admin.email,
        empresa_id: admin.empresa_id,
        empresa_nome: admin.empresa_nome
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Login Motorista
app.post('/api/auth/motorista/login', async (req, res) => {
  try {
    const { telefone, senha } = req.body;
    const senhaHash = crypto.createHash('md5').update(senha || '').digest('hex');
    
    const result = await query(
      `SELECT m.*, e.nome as empresa_nome 
       FROM motoristas m
       LEFT JOIN empresas e ON m.empresa_id = e.id
       WHERE m.telefone = $1 AND m.senha_hash = $2 AND m.ativo = true`,
      [telefone, senhaHash]
    );
    
    if (result.rows.length === 0) {
      return res.status(401).json({ success: false, error: 'Credenciais inválidas' });
    }
    
    const motorista = result.rows[0];
    const token = jwt.sign(
      { id: motorista.id, empresa_id: motorista.empresa_id, tipo: 'motorista' },
      process.env.JWT_SECRET || 'segredo',
      { expiresIn: '24h' }
    );
    
    res.json({ 
      success: true, 
      token, 
      motorista: { 
        id: motorista.id, 
        nome: motorista.nome, 
        telefone: motorista.telefone,
        empresa_id: motorista.empresa_id,
        foto_url: motorista.foto_url
      } 
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// ROTAS DO PAINEL ADMIN
// =====================================================

// Dashboard Admin
app.get('/api/admin/dashboard', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    
    const [motoristas, corridas, corridasHoje, corridasAndamento, faturamento] = await Promise.all([
      query('SELECT COUNT(*) as total FROM motoristas WHERE empresa_id = $1 AND ativo = true', [empresaId]),
      query('SELECT COUNT(*) as total FROM corridas WHERE empresa_id = $1', [empresaId]),
      query("SELECT COUNT(*) as total FROM corridas WHERE empresa_id = $1 AND DATE(criado_em) = CURRENT_DATE", [empresaId]),
      query("SELECT COUNT(*) as total FROM corridas WHERE empresa_id = $1 AND status IN ('aceita', 'em_andamento')", [empresaId]),
      query("SELECT COALESCE(SUM(valor_empresa), 0) as total FROM corridas WHERE empresa_id = $1 AND status = 'finalizada' AND DATE(criado_em) = CURRENT_DATE", [empresaId])
    ]);

    // Motoristas online
    const motoristasOnline = await query(
      "SELECT COUNT(*) as total FROM motoristas WHERE empresa_id = $1 AND status = 'online'",
      [empresaId]
    );

    res.json({
      success: true,
      data: {
        motoristas: parseInt(motoristas.rows[0]?.total || 0),
        motoristas_online: parseInt(motoristasOnline.rows[0]?.total || 0),
        corridas_total: parseInt(corridas.rows[0]?.total || 0),
        corridas_hoje: parseInt(corridasHoje.rows[0]?.total || 0),
        corridas_andamento: parseInt(corridasAndamento.rows[0]?.total || 0),
        faturamento_hoje: parseFloat(faturamento.rows[0]?.total || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar motoristas
app.get('/api/admin/motoristas', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const result = await query(
      `SELECT id, nome, telefone, email, veiculo_modelo, veiculo_placa, veiculo_cor,
        status, avaliacao_media, total_corridas, total_ganhos, foto_url, ativo, criado_em
       FROM motoristas 
       WHERE empresa_id = $1 
       ORDER BY nome`,
      [empresaId]
    );
    res.json({ success: true, motoristas: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cadastrar motorista
app.post('/api/admin/motoristas', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const { nome, telefone, email, cpf, cnh, veiculoModelo, veiculoPlaca, veiculoCor, senha } = req.body;
    
    const senhaHash = crypto.createHash('md5').update(senha || '123456').digest('hex');
    
    const result = await query(
      `INSERT INTO motoristas (empresa_id, nome, telefone, email, cpf, cnh, veiculo_modelo, veiculo_placa, veiculo_cor, senha_hash)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
      [empresaId, nome, telefone, email, cpf, cnh, veiculoModelo, veiculoPlaca, veiculoCor, senhaHash]
    );
    
    res.json({ success: true, motorista: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar motorista
app.put('/api/admin/motoristas/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone, email, veiculoModelo, veiculoPlaca, veiculoCor, ativo } = req.body;
    
    const result = await query(
      `UPDATE motoristas SET nome = COALESCE($1, nome), telefone = COALESCE($2, telefone),
       email = COALESCE($3, email), veiculo_modelo = COALESCE($4, veiculo_modelo),
       veiculo_placa = COALESCE($5, veiculo_placa), veiculo_cor = COALESCE($6, veiculo_cor),
       ativo = COALESCE($7, ativo), atualizado_em = NOW()
       WHERE id = $8 RETURNING *`,
      [nome, telefone, email, veiculoModelo, veiculoPlaca, veiculoCor, ativo, id]
    );
    
    res.json({ success: true, motorista: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Deletar motorista (desativar)
app.delete('/api/admin/motoristas/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    await query('UPDATE motoristas SET ativo = false WHERE id = $1', [id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar corridas
app.get('/api/admin/corridas', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const { status, data, limite = 50 } = req.query;
    
    let sql = `
      SELECT c.*, 
        cl.nome as cliente_nome, cl.telefone as cliente_telefone,
        m.nome as motorista_nome, m.telefone as motorista_telefone
      FROM corridas c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      LEFT JOIN motoristas m ON c.motorista_id = m.id
      WHERE c.empresa_id = $1
    `;
    const params = [empresaId];
    
    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }
    
    if (data) {
      params.push(data);
      sql += ` AND DATE(c.criado_em) = $${params.length}`;
    }
    
    sql += ` ORDER BY c.criado_em DESC LIMIT ${parseInt(limite)}`;
    
    const result = await query(sql, params);
    res.json({ success: true, corridas: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar corrida manual
app.post('/api/admin/corridas', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const { clienteTelefone, clienteNome, origem, destino, valor, formaPagamento, observacoes } = req.body;
    
    // Buscar ou criar cliente
    let cliente = await query(
      'SELECT * FROM clientes WHERE telefone = $1 AND empresa_id = $2',
      [clienteTelefone, empresaId]
    );
    
    if (cliente.rows.length === 0) {
      cliente = await query(
        'INSERT INTO clientes (empresa_id, nome, telefone) VALUES ($1, $2, $3) RETURNING *',
        [empresaId, clienteNome || 'Cliente', clienteTelefone]
      );
    }
    
    const corrida = await criarCorrida({
      empresaId,
      clienteId: cliente.rows[0].id,
      origem,
      destino,
      distanciaKm: 5, // Padrão se não informado
      valor: valor || 15.00,
      formaPagamento,
      observacoes
    });
    
    res.json({ success: true, corrida });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =====================================================
// ROTAS WHATSAPP - ADMIN
// =====================================================

// Status da conexão
app.get('/api/admin/whatsapp/status-conexao', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    
    const instancia = await query(
      'SELECT * FROM whatsapp_instancias WHERE empresa_id = $1',
      [empresaId]
    );
    
    if (instancia.rows.length === 0) {
      return res.json({ 
        conectado: false, 
        status: 'nao_configurado',
        mensagem: 'WhatsApp não configurado' 
      });
    }
    
    const dados = instancia.rows[0];
    
    // Verificar status real na Evolution API
    if (dados.instance_name && EVOLUTION_API_KEY) {
      const statusReal = await verificarStatusConexao(dados.instance_name);
      return res.json({
        conectado: statusReal.state === 'open',
        status: statusReal.state,
        numero: dados.numero_conectado,
        instance_name: dados.instance_name
      });
    }
    
    res.json({
      conectado: dados.status === 'conectado',
      status: dados.status,
      numero: dados.numero_conectado
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Gerar QR Code
app.post('/api/admin/whatsapp/gerar-qrcode', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const { instanceName } = req.body;
    
    const nome = instanceName || `ubmax_${empresaId}_${Date.now()}`;
    
    // Criar instância
    const resultado = await criarInstanciaWhatsApp(empresaId, nome);
    
    if (resultado.error) {
      return res.status(400).json({ success: false, error: resultado.error });
    }
    
    // Buscar QR Code
    await new Promise(resolve => setTimeout(resolve, 2000)); // Aguardar criação
    const qrcode = await buscarQRCode(nome);
    
    res.json({
      success: true,
      qrcode: qrcode.base64 || qrcode.qrcode,
      instanceName: nome,
      mensagem: 'Escaneie o QR Code com seu WhatsApp'
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Desconectar WhatsApp
app.post('/api/admin/whatsapp/desconectar', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    
    const instancia = await query(
      'SELECT * FROM whatsapp_instancias WHERE empresa_id = $1',
      [empresaId]
    );
    
    if (instancia.rows.length > 0 && instancia.rows[0].instance_name) {
      await desconectarWhatsApp(instancia.rows[0].instance_name);
    }
    
    await query(
      "UPDATE whatsapp_instancias SET status = 'desconectado', numero_conectado = NULL WHERE empresa_id = $1",
      [empresaId]
    );
    
    res.json({ success: true, mensagem: 'WhatsApp desconectado' });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Enviar mensagem teste
app.post('/api/admin/whatsapp/enviar-mensagem', verificarToken, async (req, res) => {
  try {
    const empresaId = req.usuario.empresa_id || 1;
    const { telefone, mensagem } = req.body;
    
    const instancia = await query(
      'SELECT * FROM whatsapp_instancias WHERE empresa_id = $1',
      [empresaId]
    );
    
    if (instancia.rows.length === 0) {
      return res.status(400).json({ success: false, error: 'WhatsApp não configurado' });
    }
    
    const resultado = await enviarMensagemWhatsApp(instancia.rows[0].instance_name, telefone, mensagem);
    res.json({ success: true, resultado });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// ROTAS DO PAINEL MASTER
// =====================================================

// Dashboard Master
app.get('/api/master/dashboard', verificarToken, async (req, res) => {
  try {
    const [empresas, motoristas, corridas, faturamento] = await Promise.all([
      query('SELECT COUNT(*) as total FROM empresas WHERE ativo = true'),
      query('SELECT COUNT(*) as total FROM motoristas WHERE ativo = true'),
      query('SELECT COUNT(*) as total FROM corridas'),
      query("SELECT COALESCE(SUM(valor), 0) as total FROM corridas WHERE status = 'finalizada'")
    ]);

    res.json({
      success: true,
      data: {
        empresas: parseInt(empresas.rows[0]?.total || 0),
        motoristas: parseInt(motoristas.rows[0]?.total || 0),
        corridas: parseInt(corridas.rows[0]?.total || 0),
        faturamento_total: parseFloat(faturamento.rows[0]?.total || 0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Listar empresas
app.get('/api/master/empresas', verificarToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT e.*, 
        (SELECT COUNT(*) FROM motoristas WHERE empresa_id = e.id) as total_motoristas,
        (SELECT COUNT(*) FROM corridas WHERE empresa_id = e.id) as total_corridas
       FROM empresas e ORDER BY e.nome`
    );
    res.json({ success: true, empresas: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar empresa
app.post('/api/master/empresas', verificarToken, async (req, res) => {
  try {
    const { nome, slug, telefone, email, cidade, estado, cnpj, plano } = req.body;
    
    const result = await query(
      `INSERT INTO empresas (nome, slug, telefone_whatsapp, email, cidade, estado, cnpj, plano)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [nome, slug, telefone, email, cidade, estado, cnpj, plano || 'basico']
    );
    
    // Criar configurações de preço padrão
    await query(
      'INSERT INTO configuracoes_preco (empresa_id) VALUES ($1)',
      [result.rows[0].id]
    );
    
    res.json({ success: true, empresa: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar empresa
app.put('/api/master/empresas/:id', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, telefone, email, cidade, estado, plano, ativo } = req.body;
    
    const result = await query(
      `UPDATE empresas SET nome = COALESCE($1, nome), telefone_whatsapp = COALESCE($2, telefone_whatsapp),
       email = COALESCE($3, email), cidade = COALESCE($4, cidade), estado = COALESCE($5, estado),
       plano = COALESCE($6, plano), ativo = COALESCE($7, ativo), atualizado_em = NOW()
       WHERE id = $8 RETURNING *`,
      [nome, telefone, email, cidade, estado, plano, ativo, id]
    );
    
    res.json({ success: true, empresa: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Criar admin para empresa
app.post('/api/master/empresas/:id/admin', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { nome, email, senha } = req.body;
    
    const senhaHash = crypto.createHash('md5').update(senha || '123456').digest('hex');
    
    const result = await query(
      'INSERT INTO admins (empresa_id, nome, email, senha_hash) VALUES ($1, $2, $3, $4) RETURNING *',
      [id, nome, email, senhaHash]
    );
    
    res.json({ success: true, admin: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});


// =====================================================
// ROTAS DO PAINEL MOTORISTA
// =====================================================

// Perfil do motorista
app.get('/api/motorista/perfil', verificarToken, async (req, res) => {
  try {
    const result = await query(
      `SELECT m.*, e.nome as empresa_nome 
       FROM motoristas m
       LEFT JOIN empresas e ON m.empresa_id = e.id
       WHERE m.id = $1`,
      [req.usuario.id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, error: 'Motorista não encontrado' });
    }
    
    res.json({ success: true, motorista: result.rows[0] });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar status
app.post('/api/motorista/status', verificarToken, async (req, res) => {
  try {
    const { status, latitude, longitude } = req.body;
    
    await query(
      `UPDATE motoristas SET status = $1, latitude = COALESCE($2, latitude), 
       longitude = COALESCE($3, longitude), atualizado_em = NOW() WHERE id = $4`,
      [status, latitude, longitude, req.usuario.id]
    );
    
    // Emitir evento
    io.to(`empresa_${req.usuario.empresa_id}`).emit('motorista_status_alterado', {
      motoristaId: req.usuario.id,
      status,
      latitude,
      longitude
    });
    
    res.json({ success: true, status });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Atualizar localização
app.post('/api/motorista/localizacao', verificarToken, async (req, res) => {
  try {
    const { latitude, longitude } = req.body;
    
    await query(
      'UPDATE motoristas SET latitude = $1, longitude = $2, atualizado_em = NOW() WHERE id = $3',
      [latitude, longitude, req.usuario.id]
    );
    
    // Emitir para empresa acompanhar
    io.to(`empresa_${req.usuario.empresa_id}`).emit('motorista_localizacao', {
      motoristaId: req.usuario.id,
      latitude,
      longitude
    });
    
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Corridas do motorista
app.get('/api/motorista/corridas', verificarToken, async (req, res) => {
  try {
    const { status } = req.query;
    
    let sql = `
      SELECT c.*, cl.nome as cliente_nome, cl.telefone as cliente_telefone
      FROM corridas c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      WHERE c.motorista_id = $1
    `;
    const params = [req.usuario.id];
    
    if (status) {
      params.push(status);
      sql += ` AND c.status = $${params.length}`;
    }
    
    sql += ' ORDER BY c.criado_em DESC LIMIT 50';
    
    const result = await query(sql, params);
    res.json({ success: true, corridas: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Corridas disponíveis
app.get('/api/motorista/corridas-disponiveis', verificarToken, async (req, res) => {
  try {
    const motorista = await query('SELECT latitude, longitude FROM motoristas WHERE id = $1', [req.usuario.id]);
    const lat = motorista.rows[0]?.latitude || -23.55;
    const lng = motorista.rows[0]?.longitude || -46.63;
    
    const result = await query(
      `SELECT c.*, cl.nome as cliente_nome,
        (6371 * acos(cos(radians($1)) * cos(radians(c.origem_latitude)) * 
        cos(radians(c.origem_longitude) - radians($2)) + 
        sin(radians($1)) * sin(radians(c.origem_latitude)))) AS distancia
      FROM corridas c
      LEFT JOIN clientes cl ON c.cliente_id = cl.id
      WHERE c.empresa_id = $3 AND c.status = 'pendente'
      ORDER BY distancia ASC
      LIMIT 10`,
      [lat, lng, req.usuario.empresa_id]
    );
    
    res.json({ success: true, corridas: result.rows });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Aceitar corrida
app.post('/api/motorista/corridas/:id/aceitar', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await aceitarCorrida(id, req.usuario.id);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Iniciar corrida
app.post('/api/motorista/corridas/:id/iniciar', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await iniciarCorrida(id, req.usuario.id);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Finalizar corrida
app.post('/api/motorista/corridas/:id/finalizar', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const resultado = await finalizarCorrida(id, req.usuario.id);
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Cancelar corrida
app.post('/api/motorista/corridas/:id/cancelar', verificarToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { motivo } = req.body;
    const resultado = await cancelarCorrida(id, motivo, 'motorista');
    res.json(resultado);
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Estatísticas do motorista
app.get('/api/motorista/estatisticas', verificarToken, async (req, res) => {
  try {
    const [total, hoje, ganhos, avaliacao] = await Promise.all([
      query("SELECT COUNT(*) as total FROM corridas WHERE motorista_id = $1 AND status = 'finalizada'", [req.usuario.id]),
      query("SELECT COUNT(*) as total FROM corridas WHERE motorista_id = $1 AND status = 'finalizada' AND DATE(finalizada_em) = CURRENT_DATE", [req.usuario.id]),
      query("SELECT COALESCE(SUM(valor_motorista), 0) as total FROM corridas WHERE motorista_id = $1 AND status = 'finalizada' AND DATE(finalizada_em) = CURRENT_DATE", [req.usuario.id]),
      query('SELECT avaliacao_media FROM motoristas WHERE id = $1', [req.usuario.id])
    ]);
    
    res.json({
      success: true,
      data: {
        total_corridas: parseInt(total.rows[0]?.total || 0),
        corridas_hoje: parseInt(hoje.rows[0]?.total || 0),
        ganhos_hoje: parseFloat(ganhos.rows[0]?.total || 0),
        avaliacao: parseFloat(avaliacao.rows[0]?.avaliacao_media || 5.0)
      }
    });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// =====================================================
// WEBHOOKS WHATSAPP
// =====================================================

// Webhook Meta (WhatsApp Business API)
app.get('/webhook', (req, res) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];
  
  if (mode === 'subscribe' && token === process.env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
    console.log('✅ Webhook verificado!');
    return res.status(200).send(challenge);
  }
  res.sendStatus(403);
});

app.post('/webhook', async (req, res) => {
  try {
    console.log('📩 Webhook recebido:', JSON.stringify(req.body, null, 2));
    
    const body = req.body;
    
    if (body.object === 'whatsapp_business_account') {
      for (const entry of body.entry || []) {
        for (const change of entry.changes || []) {
          if (change.value.messages) {
            for (const message of change.value.messages) {
              const telefone = message.from;
              const texto = message.text?.body || '';
              
              // Processar com IA
              const resposta = await processarMensagemIA(telefone, texto, 1);
              
              console.log(`💬 ${telefone}: ${texto}`);
              console.log(`🤖 REBECA: ${resposta.resposta}`);
              
              // Aqui enviaria a resposta via API (necessita configuração)
            }
          }
        }
      }
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Erro no webhook:', error);
    res.sendStatus(500);
  }
});

// Webhook Evolution API
app.post('/webhook/evolution', async (req, res) => {
  try {
    console.log('📩 Webhook Evolution:', JSON.stringify(req.body, null, 2));
    
    const { event, data, instance } = req.body;
    
    if (event === 'messages.upsert') {
      const message = data;
      if (message.key.fromMe) return res.sendStatus(200); // Ignorar mensagens enviadas
      
      const telefone = message.key.remoteJid.replace('@s.whatsapp.net', '');
      const texto = message.message?.conversation || 
                    message.message?.extendedTextMessage?.text || '';
      
      if (!texto) return res.sendStatus(200);
      
      // Buscar empresa pela instância
      const instancia = await query(
        'SELECT empresa_id FROM whatsapp_instancias WHERE instance_name = $1',
        [instance]
      );
      
      const empresaId = instancia.rows[0]?.empresa_id || 1;
      
      // Processar com IA
      const resposta = await processarMensagemIA(telefone, texto, empresaId);
      
      // Enviar resposta
      if (resposta.resposta) {
        await enviarMensagemWhatsApp(instance, telefone, resposta.resposta);
      }
    }
    
    if (event === 'connection.update') {
      const { state } = data;
      await query(
        "UPDATE whatsapp_instancias SET status = $1, atualizado_em = NOW() WHERE instance_name = $2",
        [state === 'open' ? 'conectado' : 'desconectado', instance]
      );
    }
    
    res.sendStatus(200);
  } catch (error) {
    console.error('Erro webhook Evolution:', error);
    res.sendStatus(500);
  }
});


// =====================================================
// ROTAS PÚBLICAS E API DE TESTE
// =====================================================

// Calcular preço
app.post('/api/calcular-preco', async (req, res) => {
  try {
    const { empresaId = 1, distanciaKm, duracaoMinutos } = req.body;
    const preco = await calcularPreco(empresaId, distanciaKm, duracaoMinutos);
    res.json({ success: true, ...preco });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Testar IA
app.post('/api/testar-ia', async (req, res) => {
  try {
    const { telefone = 'teste', mensagem } = req.body;
    const resposta = await processarMensagemIA(telefone, mensagem, 1);
    res.json({ success: true, ...resposta });
  } catch (error) {
    res.status(500).json({ success: false, error: error.message });
  }
});

// Health check
app.get('/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));
app.get('/api/status', (req, res) => res.json({ status: 'online', versao: '2.0.0', nome: 'UBMAX REBECA' }));

// =====================================================
// PÁGINAS HTML COMPLETAS
// =====================================================

// CSS Global
const CSS_GLOBAL = `
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: 'Segoe UI', Tahoma, sans-serif; background: #0f0f23; color: #fff; min-height: 100vh; }
  .container { max-width: 1400px; margin: 0 auto; padding: 20px; }
  .header { background: linear-gradient(135deg, #6C63FF, #4CAF50); padding: 20px; border-radius: 15px; margin-bottom: 20px; display: flex; justify-content: space-between; align-items: center; }
  .header h1 { font-size: 24px; }
  .header .user-info { display: flex; align-items: center; gap: 15px; }
  .btn { padding: 10px 20px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: all 0.3s; }
  .btn-primary { background: #6C63FF; color: white; }
  .btn-success { background: #4CAF50; color: white; }
  .btn-danger { background: #f44336; color: white; }
  .btn-secondary { background: #333; color: white; }
  .btn:hover { transform: translateY(-2px); box-shadow: 0 5px 15px rgba(0,0,0,0.3); }
  .card { background: #1a1a2e; border-radius: 15px; padding: 20px; margin-bottom: 20px; }
  .card-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 15px; padding-bottom: 15px; border-bottom: 1px solid #333; }
  .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 20px; margin-bottom: 20px; }
  .stat-card { background: linear-gradient(135deg, #1a1a2e, #16213e); border-radius: 15px; padding: 25px; text-align: center; border: 1px solid #333; }
  .stat-card h3 { font-size: 36px; color: #6C63FF; margin-bottom: 10px; }
  .stat-card p { color: #888; font-size: 14px; }
  .stat-card.success h3 { color: #4CAF50; }
  .stat-card.warning h3 { color: #ff9800; }
  .stat-card.danger h3 { color: #f44336; }
  .table { width: 100%; border-collapse: collapse; }
  .table th, .table td { padding: 15px; text-align: left; border-bottom: 1px solid #333; }
  .table th { color: #888; font-weight: 600; }
  .table tr:hover { background: rgba(108, 99, 255, 0.1); }
  .badge { padding: 5px 12px; border-radius: 20px; font-size: 12px; font-weight: 600; }
  .badge-success { background: rgba(76, 175, 80, 0.2); color: #4CAF50; }
  .badge-warning { background: rgba(255, 152, 0, 0.2); color: #ff9800; }
  .badge-danger { background: rgba(244, 67, 54, 0.2); color: #f44336; }
  .badge-info { background: rgba(33, 150, 243, 0.2); color: #2196F3; }
  .form-group { margin-bottom: 15px; }
  .form-group label { display: block; margin-bottom: 5px; color: #888; }
  .form-group input, .form-group select, .form-group textarea { width: 100%; padding: 12px; border: 1px solid #333; border-radius: 8px; background: #0f0f23; color: white; font-size: 14px; }
  .form-group input:focus { border-color: #6C63FF; outline: none; }
  .modal { display: none; position: fixed; top: 0; left: 0; width: 100%; height: 100%; background: rgba(0,0,0,0.8); z-index: 1000; justify-content: center; align-items: center; }
  .modal.active { display: flex; }
  .modal-content { background: #1a1a2e; border-radius: 15px; padding: 30px; width: 90%; max-width: 500px; max-height: 90vh; overflow-y: auto; }
  .modal-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 20px; }
  .modal-close { background: none; border: none; color: #888; font-size: 24px; cursor: pointer; }
  .tabs { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
  .tab { padding: 10px 20px; background: #1a1a2e; border: 1px solid #333; border-radius: 8px; cursor: pointer; transition: all 0.3s; }
  .tab.active { background: #6C63FF; border-color: #6C63FF; }
  .whatsapp-status { display: flex; align-items: center; gap: 10px; padding: 15px; background: #1a1a2e; border-radius: 10px; }
  .whatsapp-status .dot { width: 12px; height: 12px; border-radius: 50%; }
  .whatsapp-status .dot.online { background: #4CAF50; }
  .whatsapp-status .dot.offline { background: #f44336; }
  .qrcode-container { text-align: center; padding: 20px; }
  .qrcode-container img { max-width: 250px; border-radius: 10px; }
  .login-container { min-height: 100vh; display: flex; justify-content: center; align-items: center; background: linear-gradient(135deg, #0f0f23, #1a1a2e); }
  .login-box { background: #1a1a2e; padding: 40px; border-radius: 20px; width: 100%; max-width: 400px; box-shadow: 0 10px 40px rgba(0,0,0,0.3); }
  .login-box h1 { text-align: center; margin-bottom: 30px; color: #6C63FF; }
  .login-box .logo { font-size: 48px; text-align: center; margin-bottom: 20px; }
  @media (max-width: 768px) { .stats-grid { grid-template-columns: 1fr 1fr; } .header { flex-direction: column; gap: 15px; } }
`;

// Página Admin
const ADMIN_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UBMAX - Painel Admin</title>
  <style>${CSS_GLOBAL}</style>
</head>
<body>
  <div id="login-page" class="login-container">
    <div class="login-box">
      <div class="logo">🚗</div>
      <h1>UBMAX Admin</h1>
      <form id="login-form">
        <div class="form-group">
          <label>Email</label>
          <input type="email" id="email" placeholder="seu@email.com" required>
        </div>
        <div class="form-group">
          <label>Senha</label>
          <input type="password" id="senha" placeholder="••••••••" required>
        </div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Entrar</button>
        <p id="login-error" style="color: #f44336; text-align: center; margin-top: 15px; display: none;"></p>
      </form>
    </div>
  </div>
  
  <div id="dashboard-page" style="display: none;">
    <div class="container">
      <div class="header">
        <h1>🚗 UBMAX - Painel Admin</h1>
        <div class="user-info">
          <span id="admin-nome">Admin</span>
          <button class="btn btn-secondary" onclick="logout()">Sair</button>
        </div>
      </div>
      
      <div class="tabs">
        <div class="tab active" onclick="showTab('dashboard')">📊 Dashboard</div>
        <div class="tab" onclick="showTab('motoristas')">👥 Motoristas</div>
        <div class="tab" onclick="showTab('corridas')">🚕 Corridas</div>
        <div class="tab" onclick="showTab('whatsapp')">💬 WhatsApp</div>
      </div>
      
      <!-- Dashboard -->
      <div id="tab-dashboard">
        <div class="stats-grid">
          <div class="stat-card"><h3 id="stat-motoristas">0</h3><p>Motoristas</p></div>
          <div class="stat-card success"><h3 id="stat-online">0</h3><p>Online Agora</p></div>
          <div class="stat-card warning"><h3 id="stat-corridas-hoje">0</h3><p>Corridas Hoje</p></div>
          <div class="stat-card"><h3 id="stat-andamento">0</h3><p>Em Andamento</p></div>
          <div class="stat-card success"><h3 id="stat-faturamento">R$ 0</h3><p>Faturamento Hoje</p></div>
        </div>
        <div class="card">
          <div class="card-header"><h2>Últimas Corridas</h2></div>
          <table class="table">
            <thead><tr><th>ID</th><th>Cliente</th><th>Origem</th><th>Destino</th><th>Valor</th><th>Status</th></tr></thead>
            <tbody id="ultimas-corridas"></tbody>
          </table>
        </div>
      </div>
      
      <!-- Motoristas -->
      <div id="tab-motoristas" style="display: none;">
        <div class="card">
          <div class="card-header">
            <h2>👥 Motoristas</h2>
            <button class="btn btn-primary" onclick="abrirModalMotorista()">+ Novo Motorista</button>
          </div>
          <table class="table">
            <thead><tr><th>Nome</th><th>Telefone</th><th>Veículo</th><th>Status</th><th>Corridas</th><th>Ações</th></tr></thead>
            <tbody id="lista-motoristas"></tbody>
          </table>
        </div>
      </div>
      
      <!-- Corridas -->
      <div id="tab-corridas" style="display: none;">
        <div class="card">
          <div class="card-header">
            <h2>🚕 Corridas</h2>
            <button class="btn btn-primary" onclick="abrirModalCorrida()">+ Nova Corrida</button>
          </div>
          <table class="table">
            <thead><tr><th>ID</th><th>Cliente</th><th>Motorista</th><th>Origem</th><th>Destino</th><th>Valor</th><th>Status</th><th>Data</th></tr></thead>
            <tbody id="lista-corridas"></tbody>
          </table>
        </div>
      </div>
      
      <!-- WhatsApp -->
      <div id="tab-whatsapp" style="display: none;">
        <div class="card">
          <div class="card-header"><h2>💬 WhatsApp</h2></div>
          <div class="whatsapp-status">
            <div class="dot" id="whatsapp-dot"></div>
            <span id="whatsapp-status-text">Verificando...</span>
          </div>
          <div id="whatsapp-actions" style="margin-top: 20px;">
            <button class="btn btn-success" id="btn-conectar" onclick="conectarWhatsApp()">Conectar WhatsApp</button>
            <button class="btn btn-danger" id="btn-desconectar" style="display:none;" onclick="desconectarWhatsApp()">Desconectar</button>
          </div>
          <div id="qrcode-area" class="qrcode-container" style="display: none;">
            <h3>Escaneie o QR Code</h3>
            <img id="qrcode-img" src="" alt="QR Code">
            <p style="color: #888; margin-top: 10px;">Abra o WhatsApp > Dispositivos conectados > Conectar dispositivo</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  
  <!-- Modal Motorista -->
  <div class="modal" id="modal-motorista">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Cadastrar Motorista</h2>
        <button class="modal-close" onclick="fecharModal('modal-motorista')">&times;</button>
      </div>
      <form id="form-motorista">
        <div class="form-group"><label>Nome</label><input type="text" name="nome" required></div>
        <div class="form-group"><label>Telefone</label><input type="text" name="telefone" required></div>
        <div class="form-group"><label>Email</label><input type="email" name="email"></div>
        <div class="form-group"><label>CPF</label><input type="text" name="cpf"></div>
        <div class="form-group"><label>CNH</label><input type="text" name="cnh"></div>
        <div class="form-group"><label>Modelo do Veículo</label><input type="text" name="veiculoModelo"></div>
        <div class="form-group"><label>Placa</label><input type="text" name="veiculoPlaca"></div>
        <div class="form-group"><label>Cor</label><input type="text" name="veiculoCor"></div>
        <div class="form-group"><label>Senha</label><input type="password" name="senha" value="123456"></div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Salvar</button>
      </form>
    </div>
  </div>
  
  <!-- Modal Corrida -->
  <div class="modal" id="modal-corrida">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Nova Corrida</h2>
        <button class="modal-close" onclick="fecharModal('modal-corrida')">&times;</button>
      </div>
      <form id="form-corrida">
        <div class="form-group"><label>Telefone Cliente</label><input type="text" name="clienteTelefone" required></div>
        <div class="form-group"><label>Nome Cliente</label><input type="text" name="clienteNome"></div>
        <div class="form-group"><label>Origem</label><input type="text" name="origem" required></div>
        <div class="form-group"><label>Destino</label><input type="text" name="destino" required></div>
        <div class="form-group"><label>Valor (R$)</label><input type="number" name="valor" step="0.01" value="15.00"></div>
        <div class="form-group"><label>Pagamento</label><select name="formaPagamento"><option value="dinheiro">Dinheiro</option><option value="pix">PIX</option><option value="cartao">Cartão</option></select></div>
        <div class="form-group"><label>Observações</label><textarea name="observacoes"></textarea></div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Criar Corrida</button>
      </form>
    </div>
  </div>
  
  <script>
    let token = localStorage.getItem('admin_token');
    
    // Verificar login
    if (token) { verificarToken(); }
    
    async function verificarToken() {
      try {
        const res = await fetch('/api/admin/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) { mostrarDashboard(); } else { localStorage.removeItem('admin_token'); }
      } catch (e) { localStorage.removeItem('admin_token'); }
    }
    
    // Login
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('email').value;
      const senha = document.getElementById('senha').value;
      
      try {
        const res = await fetch('/api/auth/admin/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, senha })
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          localStorage.setItem('admin_token', token);
          document.getElementById('admin-nome').textContent = data.admin.nome;
          mostrarDashboard();
        } else {
          document.getElementById('login-error').textContent = data.error;
          document.getElementById('login-error').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('login-error').textContent = 'Erro ao conectar';
        document.getElementById('login-error').style.display = 'block';
      }
    });
    
    function mostrarDashboard() {
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('dashboard-page').style.display = 'block';
      carregarDashboard();
      carregarMotoristas();
      carregarCorridas();
      verificarWhatsApp();
    }
    
    function logout() {
      localStorage.removeItem('admin_token');
      location.reload();
    }
    
    function showTab(tab) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      document.getElementById('tab-' + tab).style.display = 'block';
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
    }
    
    async function carregarDashboard() {
      try {
        const res = await fetch('/api/admin/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          document.getElementById('stat-motoristas').textContent = data.data.motoristas;
          document.getElementById('stat-online').textContent = data.data.motoristas_online;
          document.getElementById('stat-corridas-hoje').textContent = data.data.corridas_hoje;
          document.getElementById('stat-andamento').textContent = data.data.corridas_andamento;
          document.getElementById('stat-faturamento').textContent = 'R$ ' + data.data.faturamento_hoje.toFixed(2);
        }
      } catch (e) { console.error(e); }
    }
    
    async function carregarMotoristas() {
      try {
        const res = await fetch('/api/admin/motoristas', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          const tbody = document.getElementById('lista-motoristas');
          tbody.innerHTML = data.motoristas.map(m => \`
            <tr>
              <td>\${m.nome}</td>
              <td>\${m.telefone}</td>
              <td>\${m.veiculo_modelo || '-'} \${m.veiculo_placa || ''}</td>
              <td><span class="badge badge-\${m.status === 'online' ? 'success' : 'danger'}">\${m.status}</span></td>
              <td>\${m.total_corridas}</td>
              <td><button class="btn btn-secondary" onclick="editarMotorista(\${m.id})">✏️</button></td>
            </tr>
          \`).join('');
        }
      } catch (e) { console.error(e); }
    }
    
    async function carregarCorridas() {
      try {
        const res = await fetch('/api/admin/corridas', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          const tbody = document.getElementById('lista-corridas');
          const ultimas = document.getElementById('ultimas-corridas');
          const html = data.corridas.slice(0, 10).map(c => \`
            <tr>
              <td>#\${c.id}</td>
              <td>\${c.cliente_nome || c.cliente_telefone || '-'}</td>
              <td>\${c.motorista_nome || '-'}</td>
              <td>\${c.origem_endereco?.substring(0, 20) || '-'}...</td>
              <td>\${c.destino_endereco?.substring(0, 20) || '-'}...</td>
              <td>R$ \${parseFloat(c.valor || 0).toFixed(2)}</td>
              <td><span class="badge badge-\${c.status === 'finalizada' ? 'success' : c.status === 'cancelada' ? 'danger' : 'warning'}">\${c.status}</span></td>
              <td>\${new Date(c.criado_em).toLocaleString('pt-BR')}</td>
            </tr>
          \`).join('');
          tbody.innerHTML = html;
          ultimas.innerHTML = html;
        }
      } catch (e) { console.error(e); }
    }
    
    async function verificarWhatsApp() {
      try {
        const res = await fetch('/api/admin/whatsapp/status-conexao', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const dot = document.getElementById('whatsapp-dot');
        const text = document.getElementById('whatsapp-status-text');
        const btnConectar = document.getElementById('btn-conectar');
        const btnDesconectar = document.getElementById('btn-desconectar');
        
        if (data.conectado) {
          dot.classList.add('online');
          dot.classList.remove('offline');
          text.textContent = 'Conectado: ' + (data.numero || 'WhatsApp');
          btnConectar.style.display = 'none';
          btnDesconectar.style.display = 'inline-block';
        } else {
          dot.classList.add('offline');
          dot.classList.remove('online');
          text.textContent = data.mensagem || 'Desconectado';
          btnConectar.style.display = 'inline-block';
          btnDesconectar.style.display = 'none';
        }
      } catch (e) { console.error(e); }
    }
    
    async function conectarWhatsApp() {
      try {
        document.getElementById('qrcode-area').style.display = 'block';
        document.getElementById('qrcode-img').src = '';
        
        const res = await fetch('/api/admin/whatsapp/gerar-qrcode', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({})
        });
        const data = await res.json();
        
        if (data.qrcode) {
          document.getElementById('qrcode-img').src = data.qrcode.startsWith('data:') ? data.qrcode : 'data:image/png;base64,' + data.qrcode;
        } else {
          alert('Erro ao gerar QR Code: ' + (data.error || 'Tente novamente'));
        }
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    async function desconectarWhatsApp() {
      if (!confirm('Deseja desconectar o WhatsApp?')) return;
      try {
        await fetch('/api/admin/whatsapp/desconectar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        verificarWhatsApp();
        document.getElementById('qrcode-area').style.display = 'none';
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    function abrirModalMotorista() { document.getElementById('modal-motorista').classList.add('active'); }
    function abrirModalCorrida() { document.getElementById('modal-corrida').classList.add('active'); }
    function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
    
    document.getElementById('form-motorista').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const dados = Object.fromEntries(formData);
      
      try {
        const res = await fetch('/api/admin/motoristas', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
        const data = await res.json();
        if (data.success) {
          fecharModal('modal-motorista');
          carregarMotoristas();
          e.target.reset();
          alert('Motorista cadastrado!');
        } else { alert(data.error); }
      } catch (e) { alert('Erro: ' + e.message); }
    });
    
    document.getElementById('form-corrida').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      const dados = Object.fromEntries(formData);
      
      try {
        const res = await fetch('/api/admin/corridas', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(dados)
        });
        const data = await res.json();
        if (data.success) {
          fecharModal('modal-corrida');
          carregarCorridas();
          carregarDashboard();
          e.target.reset();
          alert('Corrida criada!');
        } else { alert(data.error); }
      } catch (e) { alert('Erro: ' + e.message); }
    });
    
    // Atualizar a cada 30 segundos
    setInterval(() => { carregarDashboard(); carregarCorridas(); }, 30000);
  </script>
</body>
</html>`;

app.get('/admin', (req, res) => res.send(ADMIN_HTML));


// Página Master
const MASTER_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UBMAX - Painel Master</title>
  <style>${CSS_GLOBAL}</style>
</head>
<body>
  <div id="login-page" class="login-container">
    <div class="login-box">
      <div class="logo">👑</div>
      <h1>UBMAX Master</h1>
      <form id="login-form">
        <div class="form-group"><label>Email</label><input type="email" id="email" placeholder="admin@ubmax.com" required></div>
        <div class="form-group"><label>Senha</label><input type="password" id="senha" placeholder="••••••••" required></div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Entrar</button>
        <p id="login-error" style="color: #f44336; text-align: center; margin-top: 15px; display: none;"></p>
      </form>
    </div>
  </div>
  
  <div id="dashboard-page" style="display: none;">
    <div class="container">
      <div class="header">
        <h1>👑 UBMAX - Painel Master</h1>
        <button class="btn btn-secondary" onclick="logout()">Sair</button>
      </div>
      
      <div class="tabs">
        <div class="tab active" onclick="showTab('dashboard')">📊 Dashboard</div>
        <div class="tab" onclick="showTab('empresas')">🏢 Empresas</div>
      </div>
      
      <div id="tab-dashboard">
        <div class="stats-grid">
          <div class="stat-card"><h3 id="stat-empresas">0</h3><p>Empresas</p></div>
          <div class="stat-card success"><h3 id="stat-motoristas">0</h3><p>Motoristas</p></div>
          <div class="stat-card warning"><h3 id="stat-corridas">0</h3><p>Total Corridas</p></div>
          <div class="stat-card"><h3 id="stat-faturamento">R$ 0</h3><p>Faturamento Total</p></div>
        </div>
      </div>
      
      <div id="tab-empresas" style="display: none;">
        <div class="card">
          <div class="card-header">
            <h2>🏢 Empresas</h2>
            <button class="btn btn-primary" onclick="abrirModalEmpresa()">+ Nova Empresa</button>
          </div>
          <table class="table">
            <thead><tr><th>Nome</th><th>Cidade</th><th>Plano</th><th>Motoristas</th><th>Corridas</th><th>Status</th></tr></thead>
            <tbody id="lista-empresas"></tbody>
          </table>
        </div>
      </div>
    </div>
  </div>
  
  <div class="modal" id="modal-empresa">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Nova Empresa</h2>
        <button class="modal-close" onclick="fecharModal('modal-empresa')">&times;</button>
      </div>
      <form id="form-empresa">
        <div class="form-group"><label>Nome</label><input type="text" name="nome" required></div>
        <div class="form-group"><label>Slug (URL)</label><input type="text" name="slug" required></div>
        <div class="form-group"><label>Telefone</label><input type="text" name="telefone"></div>
        <div class="form-group"><label>Email</label><input type="email" name="email"></div>
        <div class="form-group"><label>Cidade</label><input type="text" name="cidade"></div>
        <div class="form-group"><label>Estado</label><input type="text" name="estado" maxlength="2"></div>
        <div class="form-group"><label>CNPJ</label><input type="text" name="cnpj"></div>
        <div class="form-group"><label>Plano</label><select name="plano"><option value="basico">Básico</option><option value="profissional">Profissional</option><option value="enterprise">Enterprise</option></select></div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Salvar</button>
      </form>
    </div>
  </div>
  
  <script>
    let token = localStorage.getItem('master_token');
    if (token) verificarToken();
    
    async function verificarToken() {
      try {
        const res = await fetch('/api/master/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) mostrarDashboard();
        else localStorage.removeItem('master_token');
      } catch (e) { localStorage.removeItem('master_token'); }
    }
    
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/auth/master/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: document.getElementById('email').value, senha: document.getElementById('senha').value })
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          localStorage.setItem('master_token', token);
          mostrarDashboard();
        } else {
          document.getElementById('login-error').textContent = data.error;
          document.getElementById('login-error').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('login-error').textContent = 'Erro ao conectar';
        document.getElementById('login-error').style.display = 'block';
      }
    });
    
    function mostrarDashboard() {
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('dashboard-page').style.display = 'block';
      carregarDashboard();
      carregarEmpresas();
    }
    
    function logout() { localStorage.removeItem('master_token'); location.reload(); }
    
    function showTab(tab) {
      document.querySelectorAll('[id^="tab-"]').forEach(el => el.style.display = 'none');
      document.getElementById('tab-' + tab).style.display = 'block';
      document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
      event.target.classList.add('active');
    }
    
    async function carregarDashboard() {
      try {
        const res = await fetch('/api/master/dashboard', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          document.getElementById('stat-empresas').textContent = data.data.empresas;
          document.getElementById('stat-motoristas').textContent = data.data.motoristas;
          document.getElementById('stat-corridas').textContent = data.data.corridas;
          document.getElementById('stat-faturamento').textContent = 'R$ ' + data.data.faturamento_total.toFixed(2);
        }
      } catch (e) { console.error(e); }
    }
    
    async function carregarEmpresas() {
      try {
        const res = await fetch('/api/master/empresas', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          document.getElementById('lista-empresas').innerHTML = data.empresas.map(e => \`
            <tr>
              <td>\${e.nome}</td>
              <td>\${e.cidade || '-'} / \${e.estado || '-'}</td>
              <td><span class="badge badge-info">\${e.plano}</span></td>
              <td>\${e.total_motoristas}</td>
              <td>\${e.total_corridas}</td>
              <td><span class="badge badge-\${e.ativo ? 'success' : 'danger'}">\${e.ativo ? 'Ativo' : 'Inativo'}</span></td>
            </tr>
          \`).join('');
        }
      } catch (e) { console.error(e); }
    }
    
    function abrirModalEmpresa() { document.getElementById('modal-empresa').classList.add('active'); }
    function fecharModal(id) { document.getElementById(id).classList.remove('active'); }
    
    document.getElementById('form-empresa').addEventListener('submit', async (e) => {
      e.preventDefault();
      const formData = new FormData(e.target);
      try {
        const res = await fetch('/api/master/empresas', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify(Object.fromEntries(formData))
        });
        const data = await res.json();
        if (data.success) { fecharModal('modal-empresa'); carregarEmpresas(); carregarDashboard(); e.target.reset(); alert('Empresa criada!'); }
        else alert(data.error);
      } catch (e) { alert('Erro: ' + e.message); }
    });
  </script>
</body>
</html>`;

app.get('/master', (req, res) => res.send(MASTER_HTML));

// Página Motorista
const MOTORISTA_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UBMAX - Painel Motorista</title>
  <style>${CSS_GLOBAL}
    .status-toggle { display: flex; gap: 10px; margin-bottom: 20px; }
    .status-btn { flex: 1; padding: 15px; border: 2px solid #333; border-radius: 10px; background: transparent; color: #888; cursor: pointer; transition: all 0.3s; }
    .status-btn.active { border-color: #4CAF50; color: #4CAF50; background: rgba(76, 175, 80, 0.1); }
    .status-btn.offline.active { border-color: #f44336; color: #f44336; background: rgba(244, 67, 54, 0.1); }
    .corrida-card { background: #1a1a2e; border-radius: 15px; padding: 20px; margin-bottom: 15px; border: 1px solid #333; }
    .corrida-card h3 { margin-bottom: 10px; }
    .corrida-card p { color: #888; margin: 5px 0; }
    .corrida-card .valor { font-size: 24px; color: #4CAF50; font-weight: bold; }
    .corrida-actions { display: flex; gap: 10px; margin-top: 15px; }
  </style>
</head>
<body>
  <div id="login-page" class="login-container">
    <div class="login-box">
      <div class="logo">🚗</div>
      <h1>Motorista UBMAX</h1>
      <form id="login-form">
        <div class="form-group"><label>Telefone</label><input type="text" id="telefone" placeholder="11999999999" required></div>
        <div class="form-group"><label>Senha</label><input type="password" id="senha" placeholder="••••••••" required></div>
        <button type="submit" class="btn btn-primary" style="width: 100%">Entrar</button>
        <p id="login-error" style="color: #f44336; text-align: center; margin-top: 15px; display: none;"></p>
      </form>
    </div>
  </div>
  
  <div id="dashboard-page" style="display: none;">
    <div class="container">
      <div class="header">
        <h1>🚗 Motorista</h1>
        <button class="btn btn-secondary" onclick="logout()">Sair</button>
      </div>
      
      <div class="card">
        <h3>Seu Status</h3>
        <div class="status-toggle">
          <button class="status-btn" id="btn-online" onclick="alterarStatus('online')">🟢 Online</button>
          <button class="status-btn offline" id="btn-offline" onclick="alterarStatus('offline')">🔴 Offline</button>
        </div>
      </div>
      
      <div class="stats-grid">
        <div class="stat-card"><h3 id="stat-corridas">0</h3><p>Corridas Hoje</p></div>
        <div class="stat-card success"><h3 id="stat-ganhos">R$ 0</h3><p>Ganhos Hoje</p></div>
        <div class="stat-card"><h3 id="stat-avaliacao">5.0</h3><p>Avaliação</p></div>
      </div>
      
      <div class="card">
        <h3>Corridas Disponíveis</h3>
        <div id="corridas-disponiveis"></div>
      </div>
      
      <div class="card">
        <h3>Corrida Atual</h3>
        <div id="corrida-atual">
          <p style="color: #888; text-align: center;">Nenhuma corrida em andamento</p>
        </div>
      </div>
    </div>
  </div>
  
  <script>
    let token = localStorage.getItem('motorista_token');
    let statusAtual = 'offline';
    
    if (token) verificarToken();
    
    async function verificarToken() {
      try {
        const res = await fetch('/api/motorista/perfil', { headers: { 'Authorization': 'Bearer ' + token } });
        if (res.ok) { const data = await res.json(); statusAtual = data.motorista.status; mostrarDashboard(); }
        else localStorage.removeItem('motorista_token');
      } catch (e) { localStorage.removeItem('motorista_token'); }
    }
    
    document.getElementById('login-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        const res = await fetch('/api/auth/motorista/login', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ telefone: document.getElementById('telefone').value, senha: document.getElementById('senha').value })
        });
        const data = await res.json();
        if (data.success) {
          token = data.token;
          localStorage.setItem('motorista_token', token);
          mostrarDashboard();
        } else {
          document.getElementById('login-error').textContent = data.error;
          document.getElementById('login-error').style.display = 'block';
        }
      } catch (e) {
        document.getElementById('login-error').textContent = 'Erro ao conectar';
        document.getElementById('login-error').style.display = 'block';
      }
    });
    
    function mostrarDashboard() {
      document.getElementById('login-page').style.display = 'none';
      document.getElementById('dashboard-page').style.display = 'block';
      atualizarStatusUI();
      carregarEstatisticas();
      carregarCorridasDisponiveis();
      iniciarLocalizacao();
    }
    
    function logout() { localStorage.removeItem('motorista_token'); location.reload(); }
    
    function atualizarStatusUI() {
      document.getElementById('btn-online').classList.toggle('active', statusAtual === 'online');
      document.getElementById('btn-offline').classList.toggle('active', statusAtual === 'offline');
    }
    
    async function alterarStatus(novoStatus) {
      try {
        const res = await fetch('/api/motorista/status', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ status: novoStatus })
        });
        const data = await res.json();
        if (data.success) { statusAtual = novoStatus; atualizarStatusUI(); }
      } catch (e) { console.error(e); }
    }
    
    async function carregarEstatisticas() {
      try {
        const res = await fetch('/api/motorista/estatisticas', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) {
          document.getElementById('stat-corridas').textContent = data.data.corridas_hoje;
          document.getElementById('stat-ganhos').textContent = 'R$ ' + data.data.ganhos_hoje.toFixed(2);
          document.getElementById('stat-avaliacao').textContent = data.data.avaliacao.toFixed(1);
        }
      } catch (e) { console.error(e); }
    }
    
    async function carregarCorridasDisponiveis() {
      try {
        const res = await fetch('/api/motorista/corridas-disponiveis', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const container = document.getElementById('corridas-disponiveis');
        if (data.success && data.corridas.length > 0) {
          container.innerHTML = data.corridas.map(c => \`
            <div class="corrida-card">
              <div class="valor">R$ \${parseFloat(c.valor || 0).toFixed(2)}</div>
              <p>📍 <strong>Origem:</strong> \${c.origem_endereco}</p>
              <p>🎯 <strong>Destino:</strong> \${c.destino_endereco}</p>
              <p>📏 <strong>Distância:</strong> \${c.distancia ? c.distancia.toFixed(1) + ' km' : '-'}</p>
              <div class="corrida-actions">
                <button class="btn btn-success" onclick="aceitarCorrida(\${c.id})">✅ Aceitar</button>
              </div>
            </div>
          \`).join('');
        } else {
          container.innerHTML = '<p style="color: #888; text-align: center;">Nenhuma corrida disponível</p>';
        }
      } catch (e) { console.error(e); }
    }
    
    async function aceitarCorrida(id) {
      try {
        const res = await fetch('/api/motorista/corridas/' + id + '/aceitar', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token }
        });
        const data = await res.json();
        if (data.success) {
          alert('Corrida aceita! Vá até o passageiro.');
          carregarCorridasDisponiveis();
          carregarCorridaAtual();
        } else { alert(data.error); }
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    async function carregarCorridaAtual() {
      try {
        const res = await fetch('/api/motorista/corridas?status=aceita', { headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        const container = document.getElementById('corrida-atual');
        
        if (data.success && data.corridas.length > 0) {
          const c = data.corridas[0];
          container.innerHTML = \`
            <div class="corrida-card" style="border-color: #4CAF50;">
              <div class="valor">R$ \${parseFloat(c.valor || 0).toFixed(2)}</div>
              <p>👤 <strong>Cliente:</strong> \${c.cliente_nome || c.cliente_telefone}</p>
              <p>📍 <strong>Origem:</strong> \${c.origem_endereco}</p>
              <p>🎯 <strong>Destino:</strong> \${c.destino_endereco}</p>
              <p>🔑 <strong>Código:</strong> \${c.codigo_confirmacao}</p>
              <div class="corrida-actions">
                <button class="btn btn-primary" onclick="iniciarCorrida(\${c.id})">▶️ Iniciar</button>
                <button class="btn btn-danger" onclick="cancelarCorrida(\${c.id})">❌ Cancelar</button>
              </div>
            </div>
          \`;
        } else {
          // Verificar se há corrida em andamento
          const resAndamento = await fetch('/api/motorista/corridas?status=em_andamento', { headers: { 'Authorization': 'Bearer ' + token } });
          const dataAndamento = await resAndamento.json();
          
          if (dataAndamento.success && dataAndamento.corridas.length > 0) {
            const c = dataAndamento.corridas[0];
            container.innerHTML = \`
              <div class="corrida-card" style="border-color: #ff9800;">
                <div class="valor">R$ \${parseFloat(c.valor || 0).toFixed(2)}</div>
                <p>🚗 <strong>EM ANDAMENTO</strong></p>
                <p>🎯 <strong>Destino:</strong> \${c.destino_endereco}</p>
                <div class="corrida-actions">
                  <button class="btn btn-success" onclick="finalizarCorrida(\${c.id})">✅ Finalizar</button>
                </div>
              </div>
            \`;
          } else {
            container.innerHTML = '<p style="color: #888; text-align: center;">Nenhuma corrida em andamento</p>';
          }
        }
      } catch (e) { console.error(e); }
    }
    
    async function iniciarCorrida(id) {
      try {
        const res = await fetch('/api/motorista/corridas/' + id + '/iniciar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) { alert('Corrida iniciada!'); carregarCorridaAtual(); }
        else alert(data.error);
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    async function finalizarCorrida(id) {
      try {
        const res = await fetch('/api/motorista/corridas/' + id + '/finalizar', { method: 'POST', headers: { 'Authorization': 'Bearer ' + token } });
        const data = await res.json();
        if (data.success) { alert('Corrida finalizada! Obrigado!'); carregarCorridaAtual(); carregarEstatisticas(); carregarCorridasDisponiveis(); }
        else alert(data.error);
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    async function cancelarCorrida(id) {
      const motivo = prompt('Motivo do cancelamento:');
      if (!motivo) return;
      try {
        const res = await fetch('/api/motorista/corridas/' + id + '/cancelar', {
          method: 'POST',
          headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
          body: JSON.stringify({ motivo })
        });
        const data = await res.json();
        if (data.success) { alert('Corrida cancelada'); carregarCorridaAtual(); carregarCorridasDisponiveis(); }
        else alert(data.error);
      } catch (e) { alert('Erro: ' + e.message); }
    }
    
    function iniciarLocalizacao() {
      if (navigator.geolocation) {
        navigator.geolocation.watchPosition(async (pos) => {
          try {
            await fetch('/api/motorista/localizacao', {
              method: 'POST',
              headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
              body: JSON.stringify({ latitude: pos.coords.latitude, longitude: pos.coords.longitude })
            });
          } catch (e) {}
        }, () => {}, { enableHighAccuracy: true });
      }
    }
    
    setInterval(() => { carregarCorridasDisponiveis(); carregarCorridaAtual(); }, 15000);
  </script>
</body>
</html>`;

app.get('/motorista', (req, res) => res.send(MOTORISTA_HTML));


// Página Inicial
const HOME_HTML = `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>UBMAX - Sistema de Transporte Inteligente</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body { font-family: 'Segoe UI', Tahoma, sans-serif; background: linear-gradient(135deg, #0f0f23 0%, #1a1a2e 50%, #16213e 100%); color: #fff; min-height: 100vh; }
    .hero { min-height: 100vh; display: flex; flex-direction: column; justify-content: center; align-items: center; text-align: center; padding: 20px; }
    .logo { font-size: 80px; margin-bottom: 20px; animation: bounce 2s infinite; }
    @keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }
    h1 { font-size: 48px; margin-bottom: 10px; background: linear-gradient(135deg, #6C63FF, #4CAF50); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
    .subtitle { font-size: 20px; color: #888; margin-bottom: 40px; }
    .features { display: grid; grid-template-columns: repeat(auto-fit, minmax(250px, 1fr)); gap: 20px; max-width: 1000px; margin-bottom: 40px; }
    .feature { background: rgba(255,255,255,0.05); padding: 30px; border-radius: 15px; border: 1px solid rgba(255,255,255,0.1); }
    .feature h3 { color: #6C63FF; margin-bottom: 10px; }
    .feature p { color: #888; font-size: 14px; }
    .buttons { display: flex; gap: 15px; flex-wrap: wrap; justify-content: center; }
    .btn { padding: 15px 30px; border-radius: 10px; text-decoration: none; font-weight: 600; transition: all 0.3s; display: inline-block; }
    .btn-primary { background: linear-gradient(135deg, #6C63FF, #5a52e0); color: white; }
    .btn-success { background: linear-gradient(135deg, #4CAF50, #45a049); color: white; }
    .btn-warning { background: linear-gradient(135deg, #ff9800, #f57c00); color: white; }
    .btn:hover { transform: translateY(-3px); box-shadow: 0 10px 30px rgba(0,0,0,0.3); }
    .footer { padding: 20px; text-align: center; color: #666; font-size: 14px; }
    .status-badge { background: rgba(76, 175, 80, 0.2); color: #4CAF50; padding: 5px 15px; border-radius: 20px; font-size: 12px; margin-bottom: 20px; display: inline-block; }
    .tech-stack { display: flex; gap: 15px; justify-content: center; flex-wrap: wrap; margin-top: 30px; }
    .tech { background: rgba(255,255,255,0.05); padding: 10px 20px; border-radius: 20px; font-size: 12px; color: #888; }
  </style>
</head>
<body>
  <div class="hero">
    <div class="logo">🚗</div>
    <span class="status-badge">✅ Sistema Online</span>
    <h1>UBMAX</h1>
    <p class="subtitle">Sistema de Transporte Inteligente com IA</p>
    
    <div class="features">
      <div class="feature">
        <h3>🤖 REBECA IA</h3>
        <p>Atendimento automatizado via WhatsApp com inteligência artificial GPT-4</p>
      </div>
      <div class="feature">
        <h3>💬 WhatsApp</h3>
        <p>Integração completa com Evolution API e WhatsApp Business</p>
      </div>
      <div class="feature">
        <h3>📊 Dashboard</h3>
        <p>Painel completo para gerenciar motoristas, corridas e faturamento</p>
      </div>
      <div class="feature">
        <h3>🏢 Multi-Empresa</h3>
        <p>Sistema white-label para múltiplas empresas de transporte</p>
      </div>
    </div>
    
    <div class="buttons">
      <a href="/admin" class="btn btn-primary">🔐 Painel Admin</a>
      <a href="/master" class="btn btn-warning">👑 Painel Master</a>
      <a href="/motorista" class="btn btn-success">🚗 Painel Motorista</a>
    </div>
    
    <div class="tech-stack">
      <span class="tech">Node.js</span>
      <span class="tech">PostgreSQL</span>
      <span class="tech">Socket.IO</span>
      <span class="tech">OpenAI GPT-4</span>
      <span class="tech">Evolution API</span>
      <span class="tech">Railway</span>
    </div>
  </div>
  
  <div class="footer">
    <p>UBMAX v2.0 - Sistema de Transporte Inteligente</p>
    <p style="margin-top: 5px;">Desenvolvido com ❤️ para revolucionar o transporte</p>
  </div>
</body>
</html>`;

app.get('/', (req, res) => res.send(HOME_HTML));

// =====================================================
// SOCKET.IO - TEMPO REAL
// =====================================================
io.on('connection', (socket) => {
  console.log('📱 Nova conexão Socket.IO:', socket.id);
  
  // Entrar em sala da empresa
  socket.on('join_empresa', (empresaId) => {
    socket.join(\`empresa_\${empresaId}\`);
    console.log(\`Socket \${socket.id} entrou na empresa \${empresaId}\`);
  });
  
  // Entrar em sala do motorista
  socket.on('join_motorista', (motoristaId) => {
    socket.join(\`motorista_\${motoristaId}\`);
    console.log(\`Socket \${socket.id} entrou como motorista \${motoristaId}\`);
  });
  
  // Entrar em sala do cliente
  socket.on('join_cliente', (clienteId) => {
    socket.join(\`cliente_\${clienteId}\`);
    console.log(\`Socket \${socket.id} entrou como cliente \${clienteId}\`);
  });
  
  // Atualização de localização do motorista
  socket.on('motorista_localizacao', async (data) => {
    const { motoristaId, latitude, longitude, empresaId } = data;
    io.to(\`empresa_\${empresaId}\`).emit('motorista_localizacao', { motoristaId, latitude, longitude });
  });
  
  socket.on('disconnect', () => {
    console.log('📱 Conexão encerrada:', socket.id);
  });
});

// =====================================================
// INICIALIZAÇÃO DO SERVIDOR
// =====================================================
const PORT = process.env.PORT || 3000;

async function iniciar() {
  try {
    // Testar conexão com banco
    await pool.query('SELECT NOW()');
    console.log('✅ Conectado ao PostgreSQL');
    
    // Executar migrations
    await runMigrations();
    
    // Iniciar servidor
    server.listen(PORT, '0.0.0.0', () => {
      console.log('');
      console.log('🚀 ═══════════════════════════════════════════');
      console.log('   UBMAX SISTEMA COMPLETO - REBECA IA');
      console.log('🚀 ═══════════════════════════════════════════');
      console.log('');
      console.log(\`   🌐 Servidor: http://localhost:\${PORT}\`);
      console.log(\`   📊 Admin:    http://localhost:\${PORT}/admin\`);
      console.log(\`   👑 Master:   http://localhost:\${PORT}/master\`);
      console.log(\`   🚗 Motorista: http://localhost:\${PORT}/motorista\`);
      console.log('');
      console.log('   📱 WhatsApp: Evolution API integrado');
      console.log('   🤖 IA: OpenAI GPT-4o-mini ativado');
      console.log('   ⚡ Socket.IO: Tempo real ativo');
      console.log('');
      console.log('🚀 ═══════════════════════════════════════════');
      console.log('');
    });
  } catch (error) {
    console.error('❌ Erro ao iniciar:', error.message);
    process.exit(1);
  }
}

iniciar();

