/* Общие помощники: Redis (Upstash REST) и проверка Telegram initData */
import crypto from 'node:crypto';

const RURL = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
const RTOK = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;

export function redisReady() { return !!(RURL && RTOK); }

export async function redis(...cmd) {
  const r = await fetch(RURL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${RTOK}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(cmd)
  });
  const d = await r.json();
  if (d.error) throw new Error('redis: ' + d.error);
  return d.result;
}

/* Вода за день: абсолютная запись и атомарное приращение */
export const waterKey = uid => `water:${uid}`;
export const goalKey = uid => `goal:${uid}`;

export async function waterGet(uid, date) {
  const v = await redis('HGET', waterKey(uid), date);
  return +v || 0;
}
export async function waterIncr(uid, date, delta) {
  let v = await redis('HINCRBY', waterKey(uid), date, Math.round(delta));
  if (v < 0) { v = 0; await redis('HSET', waterKey(uid), date, 0); }
  return +v;
}
export async function waterAll(uid) {
  const arr = (await redis('HGETALL', waterKey(uid))) || [];
  const out = {};
  for (let i = 0; i < arr.length; i += 2) out[arr[i]] = +arr[i + 1] || 0;
  return out;
}
export async function goalGet(uid) {
  return +(await redis('GET', goalKey(uid))) || 2000;
}

/* Проверка подписи Telegram Mini App initData */
export function validateInitData(initData, botToken) {
  try {
    const p = new URLSearchParams(initData);
    const hash = p.get('hash');
    if (!hash) return null;
    p.delete('hash');
    const dataCheck = [...p.entries()].map(([k, v]) => `${k}=${v}`).sort().join('\n');
    const secret = crypto.createHmac('sha256', 'WebAppData').update(botToken).digest();
    const calc = crypto.createHmac('sha256', secret).update(dataCheck).digest('hex');
    if (calc !== hash) return null;
    if (Date.now() / 1000 - (+p.get('auth_date') || 0) > 86400) return null;
    const user = JSON.parse(p.get('user') || 'null');
    return user && user.id ? user : null;
  } catch (e) { return null; }
}

export function fmtMl(ml) {
  return ml >= 1000
    ? (ml / 1000).toFixed(ml % 1000 ? 2 : 0).replace(/\.?0+$/, '').replace('.', ',') + ' л'
    : ml + ' мл';
}
