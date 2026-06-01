const zlib = require('zlib');
const { promisify } = require('util');
const gunzip = promisify(zlib.gunzip);

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

module.exports = { readCache };
