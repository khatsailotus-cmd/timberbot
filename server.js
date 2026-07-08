const express = require("express");
const fs = require("fs");
const path = require("path");

const app = express();
const token = "7MHldKTCZ1pc0SiBz5qZzqhYpqIUp94z";
const file = path.join(__dirname, `events_${token}.json`);

app.use(express.json());

// inicializa arquivo se não existir
if (!fs.existsSync(file)) {
  fs.writeFileSync(file, "[]");
}

// endpoint para receber webhooks da Kick
app.post("/hooks", (req, res) => {
  let events = [];
  if (fs.existsSync(file)) {
    events = JSON.parse(fs.readFileSync(file));
  }
  events.push({ timestamp: Date.now(), event: req.body });
  fs.writeFileSync(file, JSON.stringify(events, null, 2));
  res.send("Evento recebido");
});

// endpoint para consultar eventos
app.get(`/events_${token}.json`, (req, res) => {
  if (!fs.existsSync(file)) return res.json([]);
  res.sendFile(file);
});

// porta definida pelo Render
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Servidor rodando na porta ${PORT}`));