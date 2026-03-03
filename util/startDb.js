const db = require('./profile-db');
const {
  normalizeAiSettings,
  normalizeTerminalSettings,
  normalizeUpdateSettings,
  normalizeUiTheme
} = require('./profile-defaults');

module.exports = function () {
  if (!db.has('name')) db.set('name', 'Default');
  if (!db.has('type')) db.set('type', 'local');
  if (!db.has('config')) db.set('config', {});
  if (!db.has('write')) db.set('write', true);
  if (!db.has('hosts')) db.set('hosts', []);
  if (!db.has('tags')) db.set('tags', []);
  if (!db.has('knownHosts')) db.set('knownHosts', []);
  if (!db.has('snippets')) db.set('snippets', []);

  db.set('ai', normalizeAiSettings(db.get('ai')));
  db.set('terminalSettings', normalizeTerminalSettings(db.get('terminalSettings')));
  db.set('updateSettings', normalizeUpdateSettings(db.get('updateSettings')));
  db.set('uiTheme', normalizeUiTheme(db.get('uiTheme')));

  return db;
}

