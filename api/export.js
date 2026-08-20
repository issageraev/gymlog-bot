/* Экспорт данных GymLog: приложение шлёт свой стейт, бот присылает файл в чат */
import { validateInitData } from './_lib.js';

const ORIGIN = 'https://issageraev.github.io';

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', ORIGIN);
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  res.setHeader('Access-Control-Max-Age', '86400');
}

export default async function handler(req, res) {
  cors(res);
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ ok: false });

  const auth = req.headers.authorization || '';
  const initData = auth.startsWith('tma ') ? auth.slice(4) : '';
  const user = validateInitData(initData, process.env.TELEGRAM_TOKEN);
  if (!user) return res.status(401).json({ ok: false, error: 'bad initData' });

  try {
    const json = JSON.stringify(req.body || {}, null, 2);
    if (json.length > 2_000_000) return res.status(413).json({ ok: false, error: 'too large' });

    const date = new Date().toISOString().slice(0, 10);
    const form = new FormData();
    form.append('chat_id', String(user.id));
    form.append('document', new Blob([json], { type: 'application/json' }), `gymlog-${date}.json`);
    form.append('caption', 'Резервная копия GymLog. Восстановить: приложение → План → Настройки → Импорт.');

    const r = await fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_TOKEN}/sendDocument`, {
      method: 'POST',
      body: form
    });
    const d = await r.json();
    if (!d.ok) throw new Error(d.description || 'sendDocument failed');
    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('export error:', e);
    return res.status(502).json({ ok: false });
  }
}
