'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
function createJournal(directory) {
  const filename = record => {
    if (!/^WHE-[A-Za-z0-9-]+$/.test(record?.id || '')) throw new Error('Invalid webhook journal ID');
    return path.join(directory, record.id + '.json');
  };
  return {
    async put(record) {
      const target = filename(record);
      await fs.mkdir(directory, { recursive: true, mode: 0o700 });
      const temp = target + '.' + crypto.randomBytes(8).toString('hex') + '.tmp';
      const handle = await fs.open(temp, 'wx', 0o600);
      try { await handle.writeFile(JSON.stringify(record)); await handle.sync(); }
      finally { await handle.close(); }
      await fs.rename(temp, target);
    },
    async remove(record) {
      try { await fs.unlink(filename(record)); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    },
    async list() {
      let names;
      try { names = await fs.readdir(directory); }
      catch (error) { if (error.code === 'ENOENT') return []; throw error; }
      const records = [];
      for (const name of names.sort()) {
        if (!/^WHE-[A-Za-z0-9-]+\.json$/.test(name)) continue;
        try {
          const record = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8'));
          if (path.basename(filename(record)) !== name) throw new Error('Mismatched journal ID');
          records.push(record);
        } catch (error) {
          if (error.code !== 'ENOENT') console.warn('[webhook-journal-read]', name, error.code || 'INVALID_RECORD');
        }
      }
      return records;
    }
  };
}
module.exports = { createJournal };
