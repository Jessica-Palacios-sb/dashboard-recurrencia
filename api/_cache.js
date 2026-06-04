const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);
const gzip = promisify(zlib.gzip);

async function readCache(redis, key) {
  const raw = await redis.get(key);
  if (!raw) return null;
  const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
  if (str.startsWith('gz:')) {
    const buf = Buffer.from(str.slice(3), 'base64');
    const decompressed = await gunzip(buf);
    return JSON.parse(decompressed.toString());
  }
  return typeof raw === 'string' ? JSON.parse(raw) : raw;
}

// Comprime con gzip antes de guardar — mismo formato que scripts/sync-redis.js.
// Necesario para payloads grandes (recurrencia ~10MB) que superan el límite de 10MB de Upstash sin comprimir.
async function writeCache(redis, key, data, ttl) {
  const compressed = await gzip(JSON.stringify(data));
  const value = 'gz:' + compressed.toString('base64');
  await redis.set(key, value, { ex: ttl });
}

module.exports = { readCache, writeCache };
