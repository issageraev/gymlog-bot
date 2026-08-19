/* API синхронизации воды: приложение GymLog ↔ общая база с ботом */
import { redisReady, redis, waterKey, goalKey, waterAll, validateInitData } from './_lib.js';

const ORIGIN = 'https://issageraev.github.io';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (!redisReady()) return res.status(503).json({ ok: false, error: 'storage not configured' });

  const auth = req.headers.authorization || '';
  const initData = auth.startsWith('tma ') ? auth.slice(4) : '';
  const user = validateInitData(initData, process.env.TELEGRAM_TOKEN);
  if (!user) return res.status(401).json({ ok: false, error: 'bad initData' });

  try {
    if (req.method === 'GET') {
      const water = await waterAll(user.id);
      const goal = +(await redis('GET', goalKey(user.id))) || null;
      return res.status(200).json({ ok: true, water, goal });
    }
    if (req.method === 'POST') {
      const { date, total, goal } = req.body || {};
      if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
        const v = Math.max(0, Math.min(20000, Math.round(+total || 0)));
        await redis('HSET', waterKey(user.id), date, v);
      }
      if (goal) {
        await redis('SET', goalKey(user.id), Math.max(500, Math.min(6000, Math.round(+goal))));
      }
      return res.status(200).json({ ok: true });
    }
    return res.status(405).json({ ok: false });
  } catch (e) {
    console.error('water api error:', e);
    return res.status(500).json({ ok: false });
  }
}
