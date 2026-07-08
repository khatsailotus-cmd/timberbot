function loginWithKick() { window.electronAPI.loginWithKick(); }
function createReward() { window.electronAPI.createReward(); }
function listRewards() { window.electronAPI.listRewards(); }
function logout() { window.electronAPI.logout(); }

window.addEventListener("message", (event) => {
  const status = document.getElementById("status");
  if (event.data.type === "token-status") {
    status.innerText = event.data.message;
    status.style.color = event.data.message.includes("✅") ? "green" : "orange";
  }
  if (event.data.type === "login-disabled") {
    const btn = document.getElementById("login-btn");
    if (btn) {
      btn.disabled = event.data.disabled;
      btn.innerText = event.data.disabled ? "Já logado" : "Login com Kick";
    }
  }
  
});