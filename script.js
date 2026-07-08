function showTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(div => div.classList.remove("active"));
  document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add("active");
  const btn = document.getElementById("tab-" + tabId);
  if (btn) btn.classList.add("active");
}

function addEventLog(message) {
  const log = document.getElementById("event-log");
  if (log.children.length === 1 && log.children[0].textContent.trim() === "Nenhum evento ainda...") {
    log.innerHTML = "";
  }
  const entry = document.createElement("p");
  entry.textContent = `[${new Date().toLocaleTimeString()}] ${message}`;
  if (message.includes("✅ Recompensa do BOT resgatada")) {
    entry.classList.add("bot-reward");
  }
  log.appendChild(entry);
  while (log.children.length > 10) {
    log.removeChild(log.firstChild);
  }
  log.scrollTop = log.scrollHeight;
}

document.addEventListener("DOMContentLoaded", () => {
  const form = document.getElementById("reward-form");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const rewardData = {
      title: document.getElementById("title").value.trim(),
      description: document.getElementById("description").value.trim(),
      cost: parseInt(document.getElementById("cost").value, 10),
      background_color: document.getElementById("background_color").value.trim(),
      is_enabled: document.getElementById("is_enabled").value === "true",
      is_user_input_required: false,
      should_redemptions_skip_request_queue: false
    };
    if (window.electronAPI && window.electronAPI.createReward) {
      window.electronAPI.createReward(rewardData);
      document.getElementById("create-status").innerText = "⏳ Enviando recompensa...";
    } else {
      document.getElementById("create-status").innerText = "❌ API não disponível (preload).";
    }
  });
});

// Listener único para todas as mensagens
if (window.electronAPI && window.electronAPI.onMessage) {
  window.electronAPI.onMessage((_event, data) => {
    const loginBtn = document.getElementById("login-btn");
    const logoutBtn = document.getElementById("logout-btn");
    const indicator = document.getElementById("indicator");
    const statusEl = document.getElementById("status");

    switch (data.type) {
      case "event-log-init": {
        const logBox = document.getElementById("event-log");
        logBox.innerHTML = "";
        if (!data.logs || data.logs.length === 0) {
          const p = document.createElement("p");
          p.textContent = "Nenhum evento ainda...";
          logBox.appendChild(p);
        } else {
          data.logs.forEach(entry => {
            const p = document.createElement("p");
            p.textContent = `[${new Date(entry.timestamp).toLocaleTimeString()}] ${entry.message}`;
            if (entry.message.includes("✅ Recompensa do BOT resgatada")) {
              p.classList.add("bot-reward");
            }
            logBox.appendChild(p);
          });
        }
        break;
      }

      case "token-status":
        if (data.message && data.message.includes("Token carregado")) {
          if (loginBtn) loginBtn.style.display = "none";
          if (logoutBtn) logoutBtn.style.display = "inline-block";
          if (indicator) indicator.style.background = "green";
        } else {
          if (loginBtn) loginBtn.style.display = "inline-block";
          if (logoutBtn) logoutBtn.style.display = "none";
          if (indicator) indicator.style.background = "red";
        }
        if (statusEl) statusEl.innerText = `Status: ${data.message}`;
        break;

      case "login-disabled":
        if (data.disabled) {
          if (loginBtn) loginBtn.style.display = "none";
          if (logoutBtn) logoutBtn.style.display = "inline-block";
          if (indicator) indicator.style.background = "green";
          if (statusEl) statusEl.innerText = "Status: ✅ Login ativo";
        } else {
          if (loginBtn) loginBtn.style.display = "inline-block";
          if (logoutBtn) logoutBtn.style.display = "none";
          if (indicator) indicator.style.background = "red";
          if (statusEl) statusEl.innerText = "Status: ❌ Não logado";
        }
        break;

      case "reward-created":
        if (document.getElementById("create-status")) {
          document.getElementById("create-status").innerText =
            `✅ Recompensa criada:\n${JSON.stringify(data.reward, null, 2)}`;
        }
        break;

      case "reward-error":
        if (document.getElementById("create-status")) {
          document.getElementById("create-status").innerText = `❌ Erro: ${data.message}`;
        }
        break;

      case "created-rewards-listed": {
        const list = document.getElementById("created-rewards-list");
        list.innerHTML = "";
        if (!data.rewards || data.rewards.length === 0) {
          const li = document.createElement("li");
          li.textContent = "Nenhuma recompensa criada ainda.";
          list.appendChild(li);
        } else {
          data.rewards.forEach(r => {
            const li = document.createElement("li");
            const textSpan = document.createElement("span");
            textSpan.textContent = `${r.title} (ID: ${r.id})`;
            const actionsDiv = document.createElement("div");
            actionsDiv.classList.add("reward-actions");

            const editBtn = document.createElement("button");
            editBtn.textContent = "Editar";
            editBtn.type = "button";
            editBtn.onclick = () => {
              const newTitle = prompt("Novo título:", r.title);
              if (newTitle) {
                const updatedData = { ...r, title: newTitle };
                if (window.electronAPI && window.electronAPI.updateCreatedReward) {
                  window.electronAPI.updateCreatedReward(r.id, updatedData);
                }
              }
            };

            const delBtn = document.createElement("button");
            delBtn.textContent = "Deletar";
            delBtn.type = "button";
            delBtn.onclick = () => {
              if (confirm(`Deseja deletar a recompensa "${r.title}"?`)) {
                if (window.electronAPI && window.electronAPI.deleteCreatedReward) {
                  window.electronAPI.deleteCreatedReward(r.id);
                }
              }
            };

            actionsDiv.appendChild(editBtn);
            actionsDiv.appendChild(delBtn);
            li.appendChild(textSpan);
            li.appendChild(actionsDiv);
            list.appendChild(li);
          });
        }
        break;
      }

      case "kick-event":
        if (data.data.event === "channel.reward.redemption.updated") {
          const rewardId = data.data.data.reward_id;
          const userName = data.data.data.user_name;
          addEventLog(`🎁 Recompensa resgatada: ${rewardId} por ${userName}`);
        } else if (data.data.event === "chat.message.sent") {
          addEventLog(`💬 Mensagem: ${data.data.data.content} (${data.data.data.sender})`);
        }
        break;

        case "reward-pending":
        addEventLog(`⏳ Recompensa pendente: ${data.data.reward_title} por ${data.data.user}`);
        break;

        case "reward-approved":
        addEventLog(`🎉 Recompensa aprovada: ${data.data.reward_title} por ${data.data.user}`);
        break;

        case "reward-denied":
        addEventLog(`❌ Recompensa rejeitada: ${data.data.reward_title} por ${data.data.user}`);
        break;

      default:
  console.log("Mensagem recebida:", data);

    }
  });
}