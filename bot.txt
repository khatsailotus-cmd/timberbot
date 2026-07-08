require("dotenv").config();
const fs = require("fs");
const path = require("path");
const axios = require("axios");
const express = require("express");
const crypto = require("crypto");
const db = require("./db");

let mainWindow = null;
let globalAccessToken = null;
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

/* ========= CONFIGURAÇÕES ========= */
function setMainWindow(win) { mainWindow = win; }
function setToken(token) { globalAccessToken = token; }

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
  listCreatedRewards,
  listBotRewards,
  createReward,
  loadUserEvents,
  subscribeToEvents,
  approveReward,
  rejectReward,
  fetchRemoteEvents
};