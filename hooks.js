// server.js
const express = require("express");
const fs = require("fs");
const app = express();
const token = "7MHldKTCZ1pc0SiBz5qZzqhYpqIUp94z";
const file = `events_${token}.json`;

app.use(express.json());

app.post("/hooks", (req, res) => {
  let events = [];
  if (fs.existsSync(file)) {
    events = JSON.parse(fs.readFileSync(file));
  }
  events.push({ timestamp: Date.now(), event: req.body });
  fs.writeFileSync(file, JSON.stringify(events, null, 2));
  res.send("Evento recebido");
});

app.get(`/events_${token}.json`, (req, res) => {
  if (!fs.existsSync(file)) return res.json([]);
  res.sendFile(file, { root: __dirname });
});

app.listen(3000, () => console.log("Webhook server rodando na porta 3000"));