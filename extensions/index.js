const fs = require('node:fs');
const path = require('node:path');

function loadExtensions() {
  const dir = __dirname;
  const files = fs
    .readdirSync(dir)
    .filter((file) => file.endsWith('.js') && file !== 'index.js');

  const map = new Map();

  for (const file of files) {
    const modPath = path.join(dir, file);
    // eslint-disable-next-line global-require, import/no-dynamic-require
    const mod = require(modPath);
    if (!mod || !mod.id || !mod.name || !mod.baseUrl) {
      // Skip invalid extensions but keep going.
      continue;
    }
    map.set(mod.id, mod);
  }

  return {
    list() {
      return Array.from(map.values()).map((ext) => ({
        id: ext.id,
        name: ext.name,
        baseUrl: ext.baseUrl
      }));
    },
    get(id) {
      return map.get(id);
    }
  };
}

module.exports = {
  loadExtensions
};
