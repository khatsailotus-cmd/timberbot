const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // 🔑 Login
  loginWithKick: () => ipcRenderer.send("login-with-kick"),

  // 🔄 Forçar re-login
  relogin: () => ipcRenderer.send("relogin-with-kick"),

  // 🚪 Logout
  logout: () => ipcRenderer.send("logout"),

  // 🎁 Recompensas
  listCreatedRewards: () => ipcRenderer.send("list-created-rewards"),
  createReward: (rewardData) => ipcRenderer.send("create-reward", rewardData),
  updateCreatedReward: (rewardId, rewardData) =>
    ipcRenderer.send("update-created-reward", rewardId, rewardData),
  deleteCreatedReward: (rewardId) =>
    ipcRenderer.send("delete-created-reward", rewardId),

  // 📩 Mensagens do main process (único canal)
  onMessage: (callback) => ipcRenderer.on("message", callback)
});