const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // 🔑 Login
  loginWithKick: () => ipcRenderer.send("login-with-kick"),

  // 🔄 Forçar re-login
  relogin: () => ipcRenderer.send("relogin-with-kick"),

  // 🚪 Logout
  logout: () => ipcRenderer.send("logout"),

  // 📝 Definir Username (fallback)
  setUsername: (username) => ipcRenderer.send("set-username", username),

  // 🎁 Recompensas
  listCreatedRewards: () => ipcRenderer.send("list-created-rewards"),
  createReward: (rewardData) => ipcRenderer.send("create-reward", rewardData),
  updateCreatedReward: (rewardId, rewardData) =>
    ipcRenderer.send("update-created-reward", rewardId, rewardData),
  deleteCreatedReward: (rewardId) =>
    ipcRenderer.send("delete-created-reward", rewardId),

  // 🎮 Timberborn Levers
  saveLeverMapping: (rewardId, rewardTitle, leverId, leverName) =>
    ipcRenderer.send("save-lever-mapping", rewardId, rewardTitle, leverId, leverName),
  getAllLeverMappings: () => ipcRenderer.send("get-all-lever-mappings"),
  deleteLeverMapping: (rewardId) =>
    ipcRenderer.send("delete-lever-mapping", rewardId),
  getTimberornLevers: () => ipcRenderer.send("get-timberborn-levers"),

  // 📩 Mensagens do main process (único canal)
  onMessage: (callback) => ipcRenderer.on("message", callback)
});