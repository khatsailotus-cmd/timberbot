const sqlite3 = require("sqlite3").verbose();
const path = require("path");

const dbPath = path.join(__dirname, "timberbot.db");
const db = new sqlite3.Database(dbPath);

// Cria tabelas se não existirem
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

  db.run(`
    CREATE TABLE IF NOT EXISTS lever_mappings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      reward_id TEXT UNIQUE NOT NULL,
      reward_title TEXT,
      lever_id TEXT NOT NULL,
      lever_name TEXT,
      enabled INTEGER DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS polling_state (
      key TEXT PRIMARY KEY,
      last_redemption_id TEXT,
      last_check TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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

// ===== LEVER MAPPINGS =====
function saveLeverMapping(rewardId, rewardTitle, leverId, leverName) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO lever_mappings (reward_id, reward_title, lever_id, lever_name, enabled) 
       VALUES (?, ?, ?, ?, 1)`,
      [rewardId, rewardTitle, leverId, leverName],
      function (err) {
        if (err) reject(err);
        else resolve({ reward_id: rewardId, lever_id: leverId });
      }
    );
  });
}

function getLeverMapping(rewardId) {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT * FROM lever_mappings WHERE reward_id = ? AND enabled = 1`,
      [rewardId],
      (err, row) => {
        if (err) reject(err);
        else resolve(row);
      }
    );
  });
}

function getAllLeverMappings() {
  return new Promise((resolve, reject) => {
    db.all(
      `SELECT * FROM lever_mappings WHERE enabled = 1 ORDER BY created_at DESC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      }
    );
  });
}

function deleteLeverMapping(rewardId) {
  return new Promise((resolve, reject) => {
    db.run(`DELETE FROM lever_mappings WHERE reward_id = ?`, [rewardId], function (err) {
      if (err) reject(err);
      else resolve(this.changes);
    });
  });
}

// ===== POLLING STATE =====
function getPollingState() {
  return new Promise((resolve, reject) => {
    db.get(
      `SELECT last_redemption_id FROM polling_state WHERE key = 'default'`,
      (err, row) => {
        if (err) reject(err);
        else resolve(row?.last_redemption_id || null);
      }
    );
  });
}

function updatePollingState(lastRedemptionId) {
  return new Promise((resolve, reject) => {
    db.run(
      `INSERT OR REPLACE INTO polling_state (key, last_redemption_id, last_check) 
       VALUES ('default', ?, CURRENT_TIMESTAMP)`,
      [lastRedemptionId],
      (err) => {
        if (err) reject(err);
        else resolve();
      }
    );
  });
}

module.exports = {
  saveReward,
  getAllRewards,
  deleteReward,
  saveLeverMapping,
  getLeverMapping,
  getAllLeverMappings,
  deleteLeverMapping,
  getPollingState,
  updatePollingState
};