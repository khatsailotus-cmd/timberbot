require("dotenv").config();
const express = require("express");
const axios = require("axios");
const crypto = require("crypto");
const fs = require("fs");
const { shell } = require("electron");

let serverInstance = null;

function startAuthServer(PORT = 3000) {
  const app = express();

  const CLIENT_ID = process.env.KICK_CLIENT_ID;
  const CLIENT_SECRET = process.env.KICK_CLIENT_SECRET;
  const REDIRECT_URI = `http://127.0.0.1:${PORT}/callback`;
  const SCOPES = "user:read chat:write channel:rewards:read channel:rewards:write channel:events:read events:subscribe";

  function generatePKCE() {
    const codeVerifier = crypto.randomBytes(64).toString("hex");
    const codeChallenge = crypto.createHash("sha256").update(codeVerifier).digest("base64")
      .replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
    return { codeVerifier, codeChallenge };
  }

  let currentVerifier = null;

  // Decodifica JWT para extrair username
  function decodeJWTFromAuth(token) {
    try {
      console.log("🔐 Tentando decodificar JWT...");
      console.log("   - Token length:", token.length);
      
      const parts = token.split('.');
      console.log("   - Parts count:", parts.length);
      
      if (parts.length !== 3) {
        console.warn("   ❌ Token não é um JWT válido (esperado 3 partes)");
        return null;
      }
      
      const decoded = Buffer.from(parts[1], 'base64').toString('utf-8');
      console.log("   - Decoded payload:", decoded);
      
      const payload = JSON.parse(decoded);
      console.log("   - ✅ Payload parseado:", JSON.stringify(payload, null, 2));
      return payload;
    } catch (err) {
      console.warn("   ❌ Erro ao decodificar:", err.message);
      return null;
    }
  }

  // rota de login
  app.get("/login", (req, res) => {
    const { codeVerifier, codeChallenge } = generatePKCE();
    currentVerifier = codeVerifier;
    const state = crypto.randomBytes(8).toString("hex");

    const authUrl = `https://id.kick.com/oauth/authorize?response_type=code&client_id=${CLIENT_ID}&redirect_uri=${encodeURIComponent(
      REDIRECT_URI
    )}&scope=${encodeURIComponent(SCOPES)}&state=${state}&code_challenge=${codeChallenge}&code_challenge_method=S256`;

    res.redirect(authUrl);
  });

  // callback após login
  app.get("/callback", async (req, res) => {
    const { code } = req.query;
    try {
      const payload = {
        grant_type: "authorization_code",
        code,
        redirect_uri: REDIRECT_URI,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        code_verifier: currentVerifier
      };

      const response = await axios.post("https://id.kick.com/oauth/token",
        new URLSearchParams(payload).toString(),
        { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
      );

      console.log("🔐 Resposta OAuth COMPLETA:", JSON.stringify(response.data, null, 2));

      let username = response.data.user?.username;
      
      // Se username não veio, é necessário pedir pro usuário
      if (!username) {
        console.warn("⚠️ Username não disponível na resposta OAuth");
        console.warn("💡 Será necessário que o usuário digite seu username");
      }

      fs.writeFileSync("token.json", JSON.stringify({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        created_at: Date.now(),
        scope: response.data.scope,
        username: username || "unknown"
      }, null, 2));

      res.send(`
        <html><body>
          <script>
            alert("✅ Login realizado com sucesso! Você pode voltar ao Timberbot.");
            window.close();
          </script>
        </body></html>
      `);

      const tokenData = JSON.parse(fs.readFileSync("token.json"));
      console.log("🔎 Escopos concedidos:", tokenData.scope);
      console.log("👤 Usuário:", tokenData.username);

    } catch (err) {
      console.error("Erro na autenticação:", err.response?.data || err.message);
      res.send("❌ Erro na autenticação. Veja logs.");
    }
  });

  serverInstance = app.listen(PORT, () => {
    console.log(`Auth server rodando em http://127.0.0.1:${PORT}`);
    shell.openExternal(`http://127.0.0.1:${PORT}/login`);
  });
}

function stopAuthServer() {
  if (serverInstance) {
    serverInstance.close(() => {
      console.log("Auth server foi encerrado.");
      serverInstance = null;
    });
  } else {
    console.log("Nenhum servidor está rodando.");
  }
}



module.exports = { startAuthServer, stopAuthServer };