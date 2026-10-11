'use strict';
const fs = require('node:fs');
const path = require('node:path');

function writableDirectory(candidate, fsImpl) {
  fsImpl.mkdirSync(candidate, { recursive: true, mode: 0o700 });
  fsImpl.accessSync(candidate, fsImpl.constants.W_OK);
  return candidate;
}

function resolveWritableDirectory({ configured, fallback, label, fsImpl = fs, logger = console.warn }) {
  const requested = String(configured || '').trim();
  if (requested) {
    const candidate = path.resolve(requested);
    try { return { path: writableDirectory(candidate, fsImpl), fallback: false }; }
    catch (error) { logger(`[runtime-storage] ${label} khong ghi duoc; dung thu muc HOME.`, error.code || 'NOT_WRITABLE'); }
  }
  const target = path.resolve(fallback);
  return { path: writableDirectory(target, fsImpl), fallback: Boolean(requested) };
}

function resolveWritableFile({ configured, fallback, label, fsImpl = fs, logger = console.warn }) {
  const requested = String(configured || '').trim();
  if (requested) {
    const candidate = path.resolve(requested);
    try {
      writableDirectory(path.dirname(candidate), fsImpl);
      return { path: candidate, fallback: false };
    } catch (error) { logger(`[runtime-storage] ${label} khong ghi duoc; dung file HOME.`, error.code || 'NOT_WRITABLE'); }
  }
  const target = path.resolve(fallback);
  writableDirectory(path.dirname(target), fsImpl);
  return { path: target, fallback: Boolean(requested) };
}

module.exports = { resolveWritableDirectory, resolveWritableFile };
