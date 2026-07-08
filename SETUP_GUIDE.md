# 🎮 Timberbot - Guia de Configuração

## ⚡ Problema Resolvido
O sistema foi convertido para usar **polling (sondagem) automática** em vez de webhooks, portanto:
- ✅ Não precisa de portas abertas
- ✅ Não precisa de IP público
- ✅ Não precisa de software externo (ngrok, Cloudflare, etc)
- ✅ Funciona 100% standalone

## 🚀 Passo a Passo

### 1️⃣ Obter seu CHANNEL_ID
Você precisa descobrir qual é o seu `channel_id` da Kick. Existem 3 formas:

#### **Método A: Decodificar o JWT (RECOMENDADO)**
1. Faça login com Kick no Timberbot
2. Abra o arquivo `token.json`
3. Copie todo o `access_token` (a string longa)
4. Acesse https://jwt.io
5. Cole o token no campo de input
6. Procure pelo campo `"sub"` no payload decodificado
7. Esse valor é seu **CHANNEL_ID**

#### **Método B: Via API Kick**
1. Faça login com Kick no Timberbot
2. Abra o arquivo `token.json`
3. Copie o `access_token`
4. No terminal/PowerShell, rode:
```powershell
$token = "SEU_TOKEN_AQUI"
$headers = @{"Authorization" = "Bearer $token"}
Invoke-RestMethod -Uri "https://api.kick.com/public/v1/channels/rewards" -Headers $headers | ConvertTo-Json
```
5. Procure pelo campo `channel_id` na resposta

#### **Método C: Perguntar para Kick Support**
- Contate support@kick.com com sua conta
- Eles podem fornecer diretamente

### 2️⃣ Configurar o Channel ID
1. Copie `channel.json.example` para `channel.json`
2. Edite o arquivo e substitua `SEU_CHANNEL_ID_AQUI` pelo seu channel_id
3. Salve o arquivo

Exemplo:
```json
{
  "channel_id": "12345"
}
```

### 3️⃣ Preparar Timberborn
1. Instale o mod **"HTTP Server"** no Timberborn
2. Crie alavancas (`HTTP Lever`) no seu mapa
3. Note o ID de cada alavanca
4. Certifique-se que o HTTP Server está rodando em `localhost:8080`

### 4️⃣ Rodar o Timberbot
```bash
npm run start
```

### 5️⃣ Criar Mapeamentos
1. Faça login com Kick
2. Vá para aba **"Recompensas"** e crie algumas
3. Vá para aba **"Alavancas"**
4. Selecione uma recompensa
5. Selecione uma alavanca do Timberborn
6. Clique "Vincular"

## ✅ Testando

### No Timberbot:
- A aba "Início" mostra logs de eventos
- Quando uma redemption chegar, você verá: `🎁 Recompensa resgatada`
- Quando uma alavanca for acionada: `🎮 Lever acionado`

### No Timberborn:
- As alavancas devem mudar de estado quando resgatadas

## ❌ Troubleshooting

### Erro: "Channel ID não disponível"
- Certifique-se que `channel.json` existe e tem o channel_id correto
- Teste decodificando o JWT em jwt.io

### Erro: "Timberborn não está rodando"
- Verifique se Timberborn está rodando com HTTP Server
- Verifique se está em `localhost:8080`
- Acesse http://localhost:8080/api/levers no navegador

### Nenhuma redemption chega
- Verifique se as recompensas foram criadas corretamente
- Verifique se estão "ativadas" no Kick
- Teste fazer uma redemption manualmente

### Lever não aciona
- Verifique se o lever_id está correto
- Teste POST manualmente: `curl -X POST http://localhost:8080/api/levers/LEVER_ID -d '{"state":true}'`

## 📊 Estrutura de Polling

- Verifica a cada **2 segundos** (latência máxima)
- Se rate limited, aguarda exponencialmente (2s → 4s → 8s... até 60s)
- Evita duplicatas com cache interno
- Roda automaticamente ao logar

## 🔧 Arquivos Importantes

- `token.json` - Seu token de autenticação (automático)
- `channel.json` - Seu channel_id (manual, baseado em token.json)
- `timberbot.db` - Banco SQLite com mapeamentos
- `user_events.json` - Log de redemptions
- `events.json` - Log técnico

---

**Pronto! Agora o Timberbot está 100% funcional e standalone.** 🚀
