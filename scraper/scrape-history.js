// Scrape History — persistent JSON backup so history survives Railway volume wipes
const fs = require('fs');
const path = require('path');

const HISTORY_PATH = path.join(__dirname, '..', 'data', 'scrape-history.json');

let history = null;

function loadHistory() {
  if (history) return history;
  try {
    if (fs.existsSync(HISTORY_PATH)) {
      history = JSON.parse(fs.readFileSync(HISTORY_PATH, 'utf-8'));
      if (!Array.isArray(history)) history = [];
    } else {
      history = [];
    }
  } catch (err) {
    console.error('[ScrapeHistory] Failed to load history, starting fresh:', err.message);
    history = [];
  }
  return history;
}

function saveHistory(runs) {
  try {
    const dir = path.dirname(HISTORY_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(HISTORY_PATH, JSON.stringify(runs, null, 2));
    history = runs;
  } catch (err) {
    console.error('[ScrapeHistory] Failed to save history:', err.message);
  }
}

function getHistory() {
  return loadHistory();
}

function addRun(runData) {
  loadHistory();
  // Replace existing entry with same started_at, or append
  const idx = history.findIndex(r => r.started_at === runData.started_at);
  if (idx >= 0) {
    history[idx] = runData;
  } else {
    history.push(runData);
  }
  saveHistory(history);
}

module.exports = { loadHistory, saveHistory, getHistory, addRun, HISTORY_PATH };
