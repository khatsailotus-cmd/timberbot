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

      fs.writeFileSync("token.json", JSON.stringify({
        access_token: response.data.access_token,
        refresh_token: response.data.refresh_token,
        expires_in: response.data.expires_in,
        created_at: Date.now(),
        scope: response.data.scope,
        username: response.data.user?.username
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