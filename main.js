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
  setInterval(bot.fetchRemoteEvents, 5000); // a cada 5 segundos


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

    if (!webhookStarted) {
      bot.startWebhookServer(3001);
      webhookStarted = true;
    }

    bot.subscribeToEvents();
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
  stopAuthServer(3000);
  authServerStarted = false;
  console.log("🚪 Logout realizado. Token removido.");
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