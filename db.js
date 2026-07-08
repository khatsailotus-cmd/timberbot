const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "timberbot.db");
const db = new sqlite3.Database(dbPath);

// Cria tabela de recompensas se não existir
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS rewards (
      id TEXT PRIMARY KEY,
      title TEXT,
      description TEXT,
      cost INTEGER,
      is_enabled INTEGER,
      is_paused INTEGER,
      background_color TEXT,
      is_user_input_required INTEGER,
      should_redemptions_skip_request_queue INTEGER,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);
});

// CRUD de recompensas
function saveReward(reward) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO rewards 
       (id, title, description, cost, is_enabled, is_paused, background_color, 
        is_user_input_required, should_redemptions_skip_request_queue) 
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        reward.id,
        reward.title,
        reward.description,
        reward.cost,
        reward.is_enabled ? 1 : 0,
        reward.is_paused ? 1 : 0,
        reward.background_color,
        reward.is_user_input_required ? 1 : 0,
        reward.should_redemptions_skip_request_queue ? 1 : 0
      ],
      function (err) {
        if (err) reject(err);
        else resolve(reward);
      }
    );
  });
}

function getAllRewards() {
  return new Promise((resolve, reject) => {
    db.all(`SELECT * FROM rewards ORDER BY created_at DESC`, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

function deleteReward(rewardId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM rewards WHERE id = ?`, [rewardId], function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

module.exports = {
  saveReward,
  getAllRewards,
  deleteReward
};