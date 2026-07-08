const { app, BrowserWindow, ipcMain, Menu, shell } = require("electron");
const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const bot = require("./bot");
const { startAuthServer, stopAuthServer } = require("./auth");


let globalAccessToken = null;
let webhookStarted = false;
let authServerStarted = false; // controla se o servidor já foi iniciado
let mainWindow = null;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  Menu.setApplicationMenu(null);
  
  // atalhos de reload
  mainWindow.webContents.on("before-input-event", (event, input) => {
    if (input.key === "F5" && input.type === "keyDown") {
      mainWindow.reload();
      event.preventDefault();
    }
    if ((input.key === "r" || input.key === "R") && input.control && input.type === "keyDown") {
      mainWindow.reload();
      event.preventDefault();
    }
  });

  mainWindow.loadFile("index.html");

  // Inicia polling de redemptions quando janela carregar
  mainWindow.webContents.on("did-finish-load", () => {
    loadToken(mainWindow);
    watchTokenFile(mainWindow);

    const logs = bot.loadUserEvents();
    const last10 = logs.slice(-10);
    mainWindow.webContents.send("message", { type: "event-log-init", logs: last10 });
  });

  bot.setMainWindow(mainWindow);
}

function loadToken(win) {
  try {
    const tokenData = JSON.parse(fs.readFileSync("token.json"));
    globalAccessToken = tokenData.access_token;

    bot.setToken(globalAccessToken);

    win.webContents.send("message", { type: "token-status", message: "✅ Token carregado" });
    win.webContents.send("message", { type: "login-disabled", disabled: true });

    // Busca informações do canal e inicia polling
    bot.fetchChannelInfo().then(() => {
      if (!webhookStarted) {
        bot.startPolling();
        webhookStarted = true;
      }
    }).catch(err => {
      console.error("❌ Erro ao carregar channel info:", err);
      
      // Se username é "unknown", pede pro usuário informar
      if (tokenData.username === "unknown") {
        console.log("📝 Aguardando username do usuário...");
        win.webContents.send("message", { 
          type: "username-required", 
          message: "Digite seu username do Kick para continuar" 
        });
      } else {
        win.webContents.send("message", { type: "token-status", message: "⚠️ Erro ao carregar canal" });
      }
    });
  } catch {
    win.webContents.send("message", { type: "token-status", message: "❌ Nenhum token salvo" });
    win.webContents.send("message", { type: "login-disabled", disabled: false });
  }
}

function watchTokenFile(win) {
  const tokenPath = path.join(__dirname, "token.json");
  fs.watchFile(tokenPath, { interval: 1000 }, () => {
    loadToken(win);
  });
}

/* 🔑 LOGIN */
ipcMain.on("login-with-kick", () => {
  if (!authServerStarted) {
    startAuthServer(3000);
    authServerStarted = true;
  } else {
    stopAuthServer();
    startAuthServer(3000);
    authServerStarted = true;
  }
});

/* LISTAR RECOMPENSAS */
ipcMain.on("list-created-rewards", async (event) => {
  try {
    const rewards = await bot.listBotRewards();
    event.sender.send("message", { type: "created-rewards-listed", rewards });
  } catch (err) {
    event.sender.send("message", { type: "reward-error", message: err.message });
  }
});

/* CRIAR RECOMPENSA */
ipcMain.on("create-reward", async (event, rewardData) => {
  try {
    const reward = await bot.createReward(rewardData);
    event.sender.send("message", { type: "reward-created", reward });

    const rewards = await bot.listBotRewards();
    event.sender.send("message", { type: "created-rewards-listed", rewards });
  } catch (err) {
    event.sender.send("message", { type: "reward-error", message: err.message });
  }
});

/* ATUALIZAR RECOMPENSA */
ipcMain.on("update-created-reward", async (event, rewardId, rewardData) => {
  try {
    const reward = await bot.updateCreatedReward(rewardId, rewardData);
    event.sender.send("message", { type: "reward-updated", reward });

    const rewards = await bot.listBotRewards();
    event.sender.send("message", { type: "created-rewards-listed", rewards });
  } catch (err) {
    event.sender.send("message", { type: "reward-error", message: err.message });
  }
});

/* DELETAR RECOMPENSA */
ipcMain.on("delete-created-reward", async (event, rewardId) => {
  try {
    const result = await bot.deleteCreatedReward(rewardId);
    event.sender.send("message", { type: "reward-deleted", rewardId, result });

    const rewards = await bot.listBotRewards();
    event.sender.send("message", { type: "created-rewards-listed", rewards });
  } catch (err) {
    event.sender.send("message", { type: "reward-error", message: err.message });
  }
});

/* 🚪 LOGOUT */
ipcMain.on("logout", () => {
  globalAccessToken = null;
  try {
    fs.unlinkSync("token.json");
  } catch {}
  bot.stopPolling();
  webhookStarted = false;
  console.log("🚪 Logout realizado. Token removido.");
});

/* 🔑 DEFINIR USERNAME (fallback se Kick API não retornar) */
ipcMain.on("set-username", async (event, username) => {
  try {
    console.log(`📝 Username fornecido: ${username}`);
    
    // Descobre channel ID usando o username
    const channelId = await bot.discoverChannelIdByUsername(username);
    if (channelId) {
      event.sender.send("message", { 
        type: "channel-discovered", 
        channelId, 
        message: `✅ Canal descoberto: ${channelId}` 
      });
      
      // Inicia polling
      if (!webhookStarted) {
        bot.startPolling();
        webhookStarted = true;
      }
    } else {
      event.sender.send("message", { 
        type: "channel-error", 
        message: "❌ Não foi possível descobrir o channel ID" 
      });
    }
  } catch (err) {
    console.error("❌ Erro ao definir username:", err);
    event.sender.send("message", { 
      type: "channel-error", 
      message: `Erro: ${err.message}` 
    });
  }
});

/* 🎮 TIMBERBORN LEVERS */
ipcMain.on("save-lever-mapping", async (event, rewardId, rewardTitle, leverId, leverName) => {
  try {
    const db = require("./db");
    await db.saveLeverMapping(rewardId, rewardTitle, leverId, leverName);
    event.sender.send("message", { type: "lever-mapping-saved", rewardId, leverId });
    console.log(`✅ Mapping salvo: ${rewardTitle} → ${leverName}`);
  } catch (err) {
    event.sender.send("message", { type: "lever-mapping-error", message: err.message });
  }
});

ipcMain.on("get-all-lever-mappings", async (event) => {
  try {
    const db = require("./db");
    const mappings = await db.getAllLeverMappings();
    event.sender.send("message", { type: "lever-mappings-list", mappings });
  } catch (err) {
    event.sender.send("message", { type: "lever-mapping-error", message: err.message });
  }
});

ipcMain.on("delete-lever-mapping", async (event, rewardId) => {
  try {
    const db = require("./db");
    await db.deleteLeverMapping(rewardId);
    event.sender.send("message", { type: "lever-mapping-deleted", rewardId });
    console.log(`✅ Mapping deletado: ${rewardId}`);
  } catch (err) {
    event.sender.send("message", { type: "lever-mapping-error", message: err.message });
  }
});

ipcMain.on("get-timberborn-levers", async (event) => {
  try {
    const axios = require("axios");
    const response = await axios.get("http://localhost:8080/api/levers", { timeout: 5000 });
    const levers = response.data?.data || [];
    event.sender.send("message", { type: "timberborn-levers-list", levers });
  } catch (err) {
    event.sender.send("message", { 
      type: "timberborn-levers-error", 
      message: "Timberborn não está rodando em localhost:8080" 
    });
  }
});

app.whenReady().then(() => {
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") {
    app.quit();
  }
});