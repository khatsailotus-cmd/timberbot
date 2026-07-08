require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const express = require("express");
const crypto = require("crypto");
const db = require("./db");

let mainWindow = null;
let globalAccessToken = null;
let globalChannelId = null;
let kickPublicKey = null;

const userEventsFile = path.join(__dirname, "user_events.json");
const techEventsFile = path.join(__dirname, "events.json");
const userRewardsFile = path.join(__dirname, "user_rewards.json");
const webhooksFile = path.join(__dirname, "webhooks.json");

function ensureFiles() {
  if (!fs.existsSync(userEventsFile)) fs.writeFileSync(userEventsFile, "[]");
  if (!fs.existsSync(techEventsFile)) fs.writeFileSync(techEventsFile, "[]");
  if (!fs.existsSync(userRewardsFile)) fs.writeFileSync(userRewardsFile, "[]");
  if (!fs.existsSync(webhooksFile)) {
    fs.writeFileSync(webhooksFile, JSON.stringify({ callback: "http://127.0.0.1:3001/hooks" }, null, 2));
  }
}
ensureFiles();

/* ========= LOGS ========= */
function logUserEvent(message) {
  const logs = JSON.parse(fs.readFileSync(userEventsFile));
  logs.push({ timestamp: Date.now(), message });
  fs.writeFileSync(userEventsFile, JSON.stringify(logs, null, 2));

  if (mainWindow) {
    mainWindow.webContents.send("message", {
      type: "event-log-init",
      logs: logs.slice(-10)
    });
  }
}

function logTechEvent(message) {
  const logs = JSON.parse(fs.readFileSync(techEventsFile));
  logs.push({ timestamp: Date.now(), message });
  fs.writeFileSync(techEventsFile, JSON.stringify(logs, null, 2));
}

/* ========= RECOMPENSAS ========= */
let seenEvents = new Set();

function saveUserReward(rewardEvent) {
  const key = `${rewardEvent.reward_id}-${rewardEvent.status}`;
  if (seenEvents.has(key)) {
    return; // ignora duplicado
  }
  seenEvents.add(key);

  const rewards = JSON.parse(fs.readFileSync(userRewardsFile));
  rewards.push({ timestamp: Date.now(), ...rewardEvent });
  fs.writeFileSync(userRewardsFile, JSON.stringify(rewards, null, 2));

  if (rewardEvent.status === "accepted") {
    const logMsg = `🎁 Recompensa aprovada: ${rewardEvent.reward_title} por ${rewardEvent.user}`;
    console.log(logMsg);
    logUserEvent(logMsg);
  } else {
    console.log(`📥 Recompensa ${rewardEvent.status}: ${rewardEvent.reward_title} por ${rewardEvent.user}`);
  }
}

function resetSeenEvents() {
  seenEvents = new Set();
  console.log("♻️ Cache de eventos resetado (início do bot).");
}
resetSeenEvents();

/* ========= POLLING DE REDEMPTIONS ========= */
let pollingInterval = 2000; // 2 segundos
let pollingTimer = null;
let isPolling = false;

async function fetchNewRedemptions() {
  if (isPolling || !globalAccessToken || !globalChannelId) return;
  
  isPolling = true;
  try {
    // Busca últimas redemptions do canal usando o channel_id correto
    const response = await axios.get(
      `https://api.kick.com/public/v1/channels/${globalChannelId}/rewards/redemptions`,
      {
        headers: { Authorization: `Bearer ${globalAccessToken}`, Accept: "*/*" },
        params: { limit: 10 } // Últimas 10 redemptions
      }
    );

    const redemptions = response.data?.data || [];
    
    // Processa cada redemption
    for (const redemption of redemptions) {
      const key = `${redemption.id}-${redemption.status}`;
      
      if (!seenEvents.has(key)) {
        seenEvents.add(key);
        
        const rewardEvent = {
          reward_id: redemption.reward.id,
          reward_title: redemption.reward.title,
          user: redemption.redeemer.username,
          status: redemption.status,
          redemption_id: redemption.id
        };
        
        // Salva no arquivo JSON
        saveUserReward(rewardEvent);
        
        // Se foi aceita, aciona o lever
        if (redemption.status === "accepted") {
          await handleAcceptedRedemption(rewardEvent);
        }
        
        // Envia para UI
        if (mainWindow) {
          const uiType = 
            redemption.status === "pending" ? "reward-pending" :
            redemption.status === "accepted" ? "reward-approved" :
            "reward-denied";
          
          mainWindow.webContents.send("message", {
            type: uiType,
            data: rewardEvent
          });
        }
      }
    }

    // Reset backoff se sucesso
    pollingInterval = 2000;
    
  } catch (err) {
    if (err.response?.status === 429) {
      // Rate limited - backoff exponencial
      pollingInterval = Math.min(pollingInterval * 2, 60000); // Max 60s
      console.warn(`⚠️ Rate limited. Próxima verificação em ${pollingInterval}ms`);
    } else if (err.response?.status === 404) {
      console.warn(`⚠️ Endpoint não encontrado. Verifique o channel_id: ${globalChannelId}`);
    } else {
      console.error("❌ Erro ao buscar redemptions:", err.message);
    }
  } finally {
    isPolling = false;
  }
}

async function handleAcceptedRedemption(rewardEvent) {
  try {
    // Busca mapping de recompensa para lever
    const mapping = await db.getLeverMapping(rewardEvent.reward_id);
    
    if (!mapping) {
      logUserEvent(`⚠️ Nenhum lever configurado para: ${rewardEvent.reward_title}`);
      return;
    }
    
    // Aciona o lever
    const result = await triggerTimberborn(mapping.lever_id, true);
    
    if (result.success) {
      const logMsg = `🎮 Lever acionado: ${mapping.lever_name} (${rewardEvent.user})`;
      logUserEvent(logMsg);
      console.log(logMsg);
    } else {
      const logMsg = `❌ Erro ao acionar lever: ${mapping.lever_name}`;
      logUserEvent(logMsg);
      console.error(logMsg, result.error);
    }
  } catch (err) {
    console.error("❌ Erro ao processar redemption aceita:", err.message);
  }
}

function startPolling() {
  if (pollingTimer) return; // Já está rodando
  
  if (!globalChannelId) {
    console.error("❌ Channel ID não disponível. Polling não pode iniciar.");
    logTechEvent("❌ Polling não iniciado: Channel ID ausente");
    return;
  }
  
  console.log("📡 Iniciando polling de redemptions (2s)");
  logTechEvent("📡 Polling iniciado");
  fetchNewRedemptions(); // Primeira execução imediata
  
  // Timer que se ajusta dinamicamente
  const setNextPoll = () => {
    pollingTimer = setTimeout(() => {
      fetchNewRedemptions();
      if (pollingTimer) {
        setNextPoll(); // Agenda próxima verificação
      }
    }, pollingInterval);
  };
  
  setNextPoll();
}

function stopPolling() {
  if (pollingTimer) {
    clearTimeout(pollingTimer);
    pollingTimer = null;
    console.log("⏹️ Polling parado");
  }
}

// Função auxiliar para acionar Timberborn
async function triggerTimberborn(leverId, state = true) {
  try {
    const response = await axios.post(
      `http://localhost:8080/api/levers/${leverId}`,
      { state },
      { timeout: 5000 }
    );
    
    logTechEvent(`Lever acionado: ${leverId} = ${state}`);
    return { success: true, data: response.data };
  } catch (err) {
    // Se erro de conexão, pode ser que o Timberborn não está rodando
    if (err.code === 'ECONNREFUSED') {
      return { success: false, error: "Timberborn não está rodando em localhost:8080" };
    }
    return { success: false, error: err.message };
  }
}

/* ========= CONFIGURAÇÕES ========= */
function setMainWindow(win) { mainWindow = win; }
function setToken(token) { globalAccessToken = token; }

// Verifica e renova token se expirado
async function ensureValidToken() {
  if (!globalAccessToken) return false;
  
  try {
    const tokenData = JSON.parse(fs.readFileSync("token.json"));
    const created = tokenData.created_at;
    const expiresIn = tokenData.expires_in * 1000; // converter para ms
    const now = Date.now();
    
    // Se o token está prestes a expirar (menos de 5 minutos), renova
    if ((now - created) > (expiresIn - 300000)) {
      console.log("🔄 Token expirando, renovando...");
      return await refreshAccessToken(tokenData.refresh_token);
    }
    
    return true;
  } catch (err) {
    console.error("❌ Erro ao verificar token:", err.message);
    return false;
  }
}

// Renova o access token usando refresh token
async function refreshAccessToken(refreshToken) {
  try {
    const response = await axios.post(
      "https://id.kick.com/oauth/token",
      new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: process.env.KICK_CLIENT_ID,
        client_secret: process.env.KICK_CLIENT_SECRET
      }).toString(),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    
    const newTokenData = {
      access_token: response.data.access_token,
      refresh_token: response.data.refresh_token,
      expires_in: response.data.expires_in,
      created_at: Date.now(),
      scope: response.data.scope
    };
    
    fs.writeFileSync("token.json", JSON.stringify(newTokenData, null, 2));
    globalAccessToken = newTokenData.access_token;
    console.log("✅ Token renovado com sucesso");
    logTechEvent("✅ Token renovado");
    return true;
  } catch (err) {
    console.error("❌ Erro ao renovar token:", err.message);
    logTechEvent("❌ Erro ao renovar token");
    return false;
  }
}

// Decodifica JWT para extrair informações (sem verificar assinatura, só para ler)
function decodeJWT(token) {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    
    const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
    return JSON.parse(decoded);
  } catch (err) {
    return null;
  }
}

// Descobre channel_id usando username (automático após login)
async function discoverChannelIdByUsername(username) {
  if (!username || username === "unknown") {
    console.error("❌ Username não disponível para discovery");
    logTechEvent("❌ Username não disponível");
    return null;
  }
  
  try {
    console.log(`🔍 Descobrindo channel_id para username: ${username}`);
    
    // Chama endpoint /channels/{username} que sempre funciona
    const response = await axios.get(
      `https://api.kick.com/public/v1/channels/${username}`,
      {
        headers: { Accept: "*/*" }
      }
    );
    
    const channel = response.data?.data;
    if (channel?.id) {
      globalChannelId = channel.id;
      
      // Salva em channel.json para referência futura
      fs.writeFileSync("channel.json", JSON.stringify({
        channel_id: globalChannelId,
        username: username,
        channel_name: channel.name,
        discovered_at: new Date().toISOString()
      }, null, 2));
      
      logTechEvent(`✅ Channel ID descoberto: ${globalChannelId} (${username})`);
      console.log(`✅ Channel ID descoberto: ${globalChannelId}`);
      console.log(`   Canal: ${channel.name}`);
      
      return globalChannelId;
    } else {
      console.error("❌ Channel ID não encontrado na resposta");
      logTechEvent("❌ Channel ID não encontrado na resposta");
      return null;
    }
    
  } catch (err) {
    console.error(`❌ Erro ao descobrir channel_id: ${err.message}`);
    logTechEvent(`❌ Erro ao descobrir channel_id: ${err.message}`);
    return null;
  }
}

// Busca informações do canal do usuário (para obter channel_id)
async function fetchChannelInfo() {
  // Primeiro verifica se token é válido
  const tokenValid = await ensureValidToken();
  if (!tokenValid) {
    console.error("❌ Token inválido ou expirado");
    logTechEvent("❌ Token inválido - faça login novamente");
    return null;
  }
  
  if (!globalAccessToken) return null;
  
  try {
    console.log("🔍 Buscando informações do canal...");
    
    // Estratégia 1: PREFERIDA - Usar discovery automática via username
    try {
      const tokenData = JSON.parse(fs.readFileSync("token.json"));
      if (tokenData.username && tokenData.username !== "unknown") {
        console.log(`📝 Descobrindo via username: ${tokenData.username}`);
        const channelId = await discoverChannelIdByUsername(tokenData.username);
        if (channelId) {
          return { channel_id: channelId };
        }
      }
    } catch (err) {
      console.warn("⚠️ Erro ao tentar discovery:", err.message);
    }
    
    // Estratégia 2: Tentar decodificar JWT se discovery falhar
    try {
      const payload = decodeJWT(globalAccessToken);
      if (payload?.sub) {
        globalChannelId = payload.sub;
        logTechEvent(`Channel ID extraído do token JWT: ${globalChannelId}`);
        console.log(`✅ Channel ID obtido do token: ${globalChannelId}`);
        return { channel_id: globalChannelId };
      }
    } catch (err1) {
      console.warn("⚠️ Não foi possível extrair do JWT");
    }
    
    // Estratégia 3: Tentar ler do arquivo de configuração (se existe)
    try {
      if (fs.existsSync("channel.json")) {
        const channelConfig = JSON.parse(fs.readFileSync("channel.json"));
        if (channelConfig.channel_id) {
          globalChannelId = channelConfig.channel_id;
          logTechEvent(`Channel ID lido do arquivo: ${globalChannelId}`);
          console.log(`✅ Channel ID carregado do config: ${globalChannelId}`);
          return { channel_id: globalChannelId };
        }
      }
    } catch (err2) {
      console.warn("⚠️ Não foi possível ler channel.json");
    }
    
    console.warn("⚠️ Channel ID não encontrado");
    console.warn("📝 Faça login novamente ou crie 'channel.json'");
    logTechEvent("⚠️ Channel ID não encontrado. Faça login novamente.");
    return null;
    
  } catch (err) {
    console.error("❌ Erro ao buscar channel info:", err.message);
    logTechEvent(`Erro ao buscar channel: ${err.message}`);
    return null;
  }
}

let createdRewardsCache = [];

async function refreshCreatedRewards() {
  if (!globalAccessToken) return;
  try {
    const rewards = await listCreatedRewards();
    createdRewardsCache = rewards.map(r => r.id);
    logTechEvent("Cache de recompensas atualizado.");
  } catch (err) {
    logTechEvent(`Erro ao atualizar cache de recompensas: ${err.message}`);
  }
}

/* ========= VALIDAÇÃO DE ASSINATURA ========= */
async function loadKickPublicKey(retries = 3, delay = 1000) {
  if (kickPublicKey) return kickPublicKey;

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await axios.get("https://api.kick.com/public/v1/public-key", {
        headers: { Accept: "*/*" }
      });

      // A resposta correta vem em resp.data.data.public_key
      const pubKey = resp.data?.data?.public_key;
      if (pubKey) {
        kickPublicKey = pubKey;
        console.log("🔑 Chave pública carregada da Kick.");
        return kickPublicKey;
      } else {
        console.warn(`⚠️ Resposta inválida ao buscar chave pública (tentativa ${attempt}):`, resp.data);
      }
    } catch (err) {
      console.warn(`⚠️ Erro ao buscar chave pública (tentativa ${attempt}):`, err.message);
    }

    if (attempt < retries) {
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }

  console.error("❌ Não foi possível carregar a chave pública da Kick após várias tentativas.");
  return null;
}

function verifySignature(headers, rawBody) {
  if (!kickPublicKey) {
    console.warn("⚠️ Chave pública não carregada, não é possível verificar assinatura.");
    return false;
  }

  const messageId = headers["kick-event-message-id"];
  const timestamp = headers["kick-event-message-timestamp"];
  const signatureHeader = headers["kick-event-signature"];

  if (!messageId || !timestamp || !signatureHeader) {
    console.warn("⚠️ Cabeçalhos de assinatura ausentes:", headers);
    return false;
  }

  const signatureString = `${messageId}.${timestamp}.${rawBody}`;
  const verifier = crypto.createVerify("RSA-SHA256");
  verifier.update(signatureString);
  verifier.end();

  try {
    return verifier.verify(kickPublicKey, signatureHeader, "base64");
  } catch (err) {
    console.error("❌ Erro ao verificar assinatura:", err.message);
    return false;
  }
}

/* ========= SERVIDOR WEBHOOK ========= */
function startWebhookServer(PORT = 3001) {
  const app = express();

  app.use(express.json({
    verify: (req, res, buf) => {
      req.rawBody = buf.toString();
    }
  }));

  app.post("/hooks", async (req, res) => {
  await loadKickPublicKey();

  if (!kickPublicKey || !verifySignature(req.headers, req.rawBody)) {
    console.warn("⚠️ Assinatura inválida.");
    return res.sendStatus(401);
  }

  const eventType = req.headers["kick-event-type"];
  const payload = req.body;

  console.log("✅ Evento validado:", eventType);
  logTechEvent(`Evento recebido: ${eventType}`);

  if (eventType === "channel.reward.redemption.updated") {
  const { reward, redeemer, status } = payload;
  if (reward && redeemer) {
    const rewardEvent = {
      reward_id: reward.id,
      reward_title: reward.title,
      user: redeemer.username,
      status: status
    };
    saveUserReward(rewardEvent);
    if (mainWindow) {
      if (status === "pending") {
        mainWindow.webContents.send("message", {
          type: "reward-pending",
          data: rewardEvent
        });
      } else if (status === "accepted") {
        mainWindow.webContents.send("message", {
          type: "reward-approved", // mapeamos "accepted" para "approved"
          data: rewardEvent
        });
      } else if (status === "rejected") {
        mainWindow.webContents.send("message", {
          type: "reward-denied",
          data: rewardEvent
        });
      }
    }
  }
}
 else if (eventType === "chat.message.sent") {
    const { content, sender } = payload;
    logUserEvent(`💬 Mensagem: ${content} (${sender})`);
    console.log("📥 Evento de chat recebido:", payload);
    if (mainWindow) {
      mainWindow.webContents.send("message", { type: "kick-event", data: payload });
    }
  } else if (
    eventType === "channel.reward.created" ||
    eventType === "channel.reward.updated" ||
    eventType === "channel.reward.deleted"
  ) {
    refreshCreatedRewards();
  }

  res.sendStatus(200);
});

  app.listen(PORT, async () => {
    console.log(`Webhook server rodando em http://127.0.0.1:${PORT}/hooks`);
    refreshCreatedRewards();
  });
}

/* ========= FUNÇÕES DE RECOMPENSAS ========= */
async function listCreatedRewards() {
  if (!globalAccessToken) throw new Error("Token não definido");
  const response = await axios.get("https://api.kick.com/public/v1/channels/rewards", {
    headers: { Authorization: `Bearer ${globalAccessToken}`, Accept: "*/*" }
  });
  return response.data.data;
}

async function listBotRewards() {
  if (!globalAccessToken) throw new Error("Token não definido");
  const allRewards = await listCreatedRewards();
  const botRewards = await db.getAllRewards();
  const botRewardIds = botRewards.map(r => r.id);
  return allRewards.filter(r => botRewardIds.includes(r.id));
}

async function createReward(rewardData) {
  if (!globalAccessToken) throw new Error("Token não definido");
  const response = await axios.post(
    "https://api.kick.com/public/v1/channels/rewards",
    rewardData,
    { headers: { Authorization: `Bearer ${globalAccessToken}`, "Content-Type": "application/json", Accept: "*/*" } }
  );
  const reward = response.data.data;
  logUserEvent(`🎁 Recompensa criada: ${reward.title}`);
  await db.saveReward(reward);
  refreshCreatedRewards();
  return reward;
}

function loadUserEvents() {
  const logs = JSON.parse(fs.readFileSync(userEventsFile));
  if (mainWindow) {
    mainWindow.webContents.send("message", {
      type: "event-log-init",
      logs: logs.slice(-10)
    });
  }
  return logs;
}

/* ========= SUBSCRIÇÃO DE EVENTOS ========= */
function getWebhookUrl() {
  try {
    const data = JSON.parse(fs.readFileSync(webhooksFile));
    return data.callback || "http://127.0.0.1:3001/hooks";
  } catch {
    return "http://127.0.0.1:3001/hooks";
  }
}

async function subscribeToEvents() {
  if (!globalAccessToken) {
    console.error("❌ Token não definido, não é possível subscrever eventos.");
    return;
  }

  const callbackUrl = getWebhookUrl();

  try {
    const response = await axios.post(
      "https://api.kick.com/public/v1/events/subscriptions",
      {
        events: [
          { name: "chat.message.sent", version: 1 },
          { name: "channel.reward.redemption.updated", version: 1 },
          { name: "channel.reward.created", version: 1 },
          { name: "channel.reward.updated", version: 1 },
          { name: "channel.reward.deleted", version: 1 }
        ],
        method: "webhook",
        callback: callbackUrl
      },
      {
        headers: {
          Authorization: `Bearer ${globalAccessToken}`,
          "Content-Type": "application/json",
          Accept: "*/*"
        }
      }
    );

    console.log("📡 Subscrição de eventos realizada:", response.data);
    logTechEvent("Eventos subscritos com sucesso.");
  } catch (err) {
    console.error("❌ Erro ao subscrever eventos:", err.response?.data || err.message);
    logTechEvent("Erro ao subscrever eventos.");
  }
}

async function updateRewardStatus(redemptionId, newStatus) {
  if (!globalAccessToken) throw new Error("Token não definido");

  try {
    const response = await axios.patch(
      `https://api.kick.com/public/v1/channels/rewards/redemptions/${redemptionId}`,
      { status: newStatus },
      {
        headers: {
          Authorization: `Bearer ${globalAccessToken}`,
          "Content-Type": "application/json",
          Accept: "*/*"
        }
      }
    );

    const updated = response.data.data;
    console.log(`✅ Recompensa ${newStatus}: ${updated.reward.title} por ${updated.redeemer.username}`);

    // envia para interface
    if (mainWindow) {
      mainWindow.webContents.send("message", {
        type: newStatus === "accepted" ? "reward-approved" : "reward-denied",
        data: {
          reward_id: updated.reward.id,
          reward_title: updated.reward.title,
          user: updated.redeemer.username,
          status: newStatus
        }
      });
    }

    return updated;
  } catch (err) {
    console.error(`❌ Erro ao atualizar recompensa:`, err.response?.data || err.message);
    throw err;
  }
}

async function approveReward(redemptionId) {
  return updateRewardStatus(redemptionId, "accepted");
}

async function rejectReward(redemptionId) {
  return updateRewardStatus(redemptionId, "rejected");
}

async function fetchRemoteEvents() {
  try {
    const resp = await axios.get("https://timberbot.onrender.com/events_7MHldKTCZ1pc0SiBz5qZzqhYpqIUp94z.json");
    let events = resp.data;

    if (!Array.isArray(events)) {
      console.warn("Resposta não é array, ajustando:", events);
      events = [];
    }

    events.forEach(ev => {
      const fullEvent = ev.event;
      if (mainWindow) {
        mainWindow.webContents.send("message", {
          type: "reward-event",
          data: fullEvent
        });
      }
    });
  } catch (err) {
    console.error("❌ Erro ao buscar eventos remotos:", err.message);
  }
}

/* ========= EXPORT ========= */
module.exports = {
  startWebhookServer,
  setMainWindow,
  setToken,
  ensureValidToken,
  refreshAccessToken,
  discoverChannelIdByUsername,
  fetchChannelInfo,
  listCreatedRewards,
  listBotRewards,
  createReward,
  loadUserEvents,
  subscribeToEvents,
  approveReward,
  rejectReward,
  fetchRemoteEvents,
  startPolling,
  stopPolling,
  triggerTimberborn,
  handleAcceptedRedemption
};