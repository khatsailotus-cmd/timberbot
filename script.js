function showTab(tabId) {
  document.querySelectorAll(".tab-content").forEach(div => div.classList.remove("active"));
  document.querySelectorAll(".tabs button").forEach(btn => btn.classList.remove("active"));
  const tab = document.getElementById(tabId);
  if (tab) tab.classList.add("active");
  const btn = document.getElementById("tab-" + tabId);
  if (btn) btn.classList.add("active");
  
  // Carrega dados específicos da aba
  if (tabId === "alavancas") {
    loadRewardsForMapping();
    loadTimberornLevers();
    loadLeverMappings();
  }
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

      case "created-rewards-listed": {
        // Atualiza o seletor de recompensas também
        const rewardSelect = document.getElementById("reward-selector");
        if (rewardSelect && data.rewards && data.rewards.length > 0) {
          rewardSelect.innerHTML = '<option value="">Selecione uma recompensa...</option>';
          data.rewards.forEach(r => {
            const option = document.createElement("option");
            option.value = r.id;
            option.textContent = r.title;
            rewardSelect.appendChild(option);
          });
        }
        break;
      }

      case "timberborn-levers-list": {
        const leverSelect = document.getElementById("lever-selector");
        const connStatusEl = document.getElementById("connection-status");
        
        if (leverSelect && data.levers && data.levers.length > 0) {
          leverSelect.innerHTML = '<option value="">Selecione uma alavanca...</option>';
          data.levers.forEach(lever => {
            const option = document.createElement("option");
            option.value = lever.id;
            option.textContent = lever.name || lever.id;
            leverSelect.appendChild(option);
          });
        }
        
        if (connStatusEl) {
          connStatusEl.textContent = `✅ Timberborn conectado! ${data.levers?.length || 0} alavancas encontradas.`;
          connStatusEl.style.color = "green";
        }
        break;
      }

      case "timberborn-levers-error": {
        const connStatusEl = document.getElementById("connection-status");
        const leverSelect = document.getElementById("lever-selector");
        
        if (connStatusEl) {
          connStatusEl.textContent = `❌ ${data.message}`;
          connStatusEl.style.color = "red";
        }
        
        if (leverSelect) {
          leverSelect.innerHTML = '<option value="">Timberborn offline</option>';
        }
        break;
      }

      case "lever-mapping-saved": {
        const statusEl = document.getElementById("mapping-status");
        statusEl.textContent = "✅ Mapeamento salvo com sucesso!";
        statusEl.style.color = "green";
        loadLeverMappings();
        break;
      }

      case "lever-mapping-deleted": {
        loadLeverMappings();
        break;
      }

      case "lever-mappings-list": {
        const tbody = document.getElementById("mappings-table-body");
        tbody.innerHTML = "";
        
        if (!data.mappings || data.mappings.length === 0) {
          const tr = document.createElement("tr");
          const td = document.createElement("td");
          td.colSpan = 3;
          td.textContent = "Nenhum mapeamento criado ainda.";
          td.style.textAlign = "center";
          td.style.padding = "20px";
          tr.appendChild(td);
          tbody.appendChild(tr);
        } else {
          data.mappings.forEach(mapping => {
            const tr = document.createElement("tr");
            tr.style.borderBottom = "1px solid #ddd";
            
            const tdReward = document.createElement("td");
            tdReward.textContent = mapping.reward_title || mapping.reward_id;
            tdReward.style.border = "1px solid #ddd";
            tdReward.style.padding = "10px";
            
            const tdLever = document.createElement("td");
            tdLever.textContent = mapping.lever_name || mapping.lever_id;
            tdLever.style.border = "1px solid #ddd";
            tdLever.style.padding = "10px";
            
            const tdAction = document.createElement("td");
            tdAction.style.border = "1px solid #ddd";
            tdAction.style.padding = "10px";
            tdAction.style.textAlign = "center";
            
            const deleteBtn = document.createElement("button");
            deleteBtn.textContent = "Deletar";
            deleteBtn.onclick = () => deleteLeverMapping(mapping.reward_id);
            deleteBtn.style.padding = "5px 10px";
            deleteBtn.style.background = "red";
            deleteBtn.style.color = "white";
            deleteBtn.style.border = "none";
            deleteBtn.style.cursor = "pointer";
            
            tdAction.appendChild(deleteBtn);
            tr.appendChild(tdReward);
            tr.appendChild(tdLever);
            tr.appendChild(tdAction);
            tbody.appendChild(tr);
          });
        }
        break;
      }

      case "username-required": {
        const username = prompt("Seu username do Kick:", "");
        if (username && username.trim()) {
          addEventLog(`📝 Username fornecido: ${username}`);
          if (window.electronAPI && window.electronAPI.setUsername) {
            window.electronAPI.setUsername(username.trim());
          }
        } else {
          addEventLog("❌ Username não fornecido");
        }
        break;
      }

      case "channel-discovered":
        if (statusEl) statusEl.innerText = `Status: ${data.message}`;
        addEventLog(data.message);
        break;

      case "channel-error":
        addEventLog(`❌ ${data.message}`);
        if (statusEl) statusEl.innerText = `Status: ${data.message}`;
        break;

      default:
  console.log("Mensagem recebida:", data);

    }
  });
}

// ===== FUNÇÕES DE MAPEAMENTO DE ALAVANCAS =====
function loadRewardsForMapping() {
  if (window.electronAPI && window.electronAPI.listCreatedRewards) {
    window.electronAPI.listCreatedRewards();
  }
}

function loadTimberornLevers() {
  if (window.electronAPI && window.electronAPI.getTimberornLevers) {
    window.electronAPI.getTimberornLevers();
  }
}

function loadLeverMappings() {
  if (window.electronAPI && window.electronAPI.getAllLeverMappings) {
    window.electronAPI.getAllLeverMappings();
  }
}

function saveLeverMapping() {
  const rewardSelect = document.getElementById("reward-selector");
  const leverSelect = document.getElementById("lever-selector");
  const statusEl = document.getElementById("mapping-status");
  
  const selectedRewardOption = rewardSelect.selectedOptions[0];
  const selectedLeverOption = leverSelect.selectedOptions[0];
  
  if (!selectedRewardOption || !selectedLeverOption || !selectedRewardOption.value || !selectedLeverOption.value) {
    statusEl.textContent = "❌ Selecione uma recompensa e uma alavanca";
    statusEl.style.color = "red";
    return;
  }
  
  const rewardId = selectedRewardOption.value;
  const rewardTitle = selectedRewardOption.textContent;
  const leverId = selectedLeverOption.value;
  const leverName = selectedLeverOption.textContent;
  
  if (window.electronAPI && window.electronAPI.saveLeverMapping) {
    window.electronAPI.saveLeverMapping(rewardId, rewardTitle, leverId, leverName);
    statusEl.textContent = "⏳ Salvando mapeamento...";
    statusEl.style.color = "orange";
  }
}

function deleteLeverMapping(rewardId) {
  if (confirm("Deseja deletar este mapeamento?")) {
    if (window.electronAPI && window.electronAPI.deleteLeverMapping) {
      window.electronAPI.deleteLeverMapping(rewardId);
    }
  }
}

function testTimberornConnection() {
  const statusEl = document.getElementById("connection-status");
  statusEl.textContent = "⏳ Testando conexão...";
  
  if (window.electronAPI && window.electronAPI.getTimberornLevers) {
    window.electronAPI.getTimberornLevers();
  }
}