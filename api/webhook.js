/* GymLog Bot — вебхук Telegram + Gemini (Vercel serverless) */

const APP_URL = 'https://issageraev.github.io/gymlog/';

const SYSTEM = `Ты — тренер-ассистент в телеграм-боте GymLog (дневник тренировок).
Твоя единственная тема: силовые тренировки, фитнес, техника упражнений, программы,
питание и добавки для тренирующихся, восстановление, сон, вода, здоровье в контексте спорта.

Правила:
- Отвечай по-русски, кратко и по делу: до 120 слов, простыми словами. Списки — с дефисами.
- Не используй markdown-разметку (звёздочки, решётки) — только обычный текст.
- Если вопрос не про тренировки/здоровье — вежливо откажись одним предложением и напомни, что ты помогаешь только с тренировками.
- Ты не врач: не ставь диагнозы и не назначай лечение. При боли, травме или тревожных симптомах советуй обратиться к врачу.
- Где уместно, напоминай, что вести дневник можно в приложении GymLog (кнопка меню слева от поля ввода).`;

async function tg(token, method, payload) {
  const r = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return r.json();
}

async function askGemini(text) {
  const key = process.env.GEMINI_API_KEY;
  const r = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 800,
          thinkingConfig: { thinkingBudget: 0 }
        }
      })
    }
  );
  const data = await r.json();
  const answer = data?.candidates?.[0]?.content?.parts?.map(p => p.text).join('') || '';
  if (!answer) throw new Error('empty gemini response: ' + JSON.stringify(data).slice(0, 300));
  return answer.slice(0, 4000);
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(200).send('GymLog bot is running');

  const secret = process.env.WEBHOOK_SECRET;
  if (secret && req.headers['x-telegram-bot-api-secret-token'] !== secret) {
    return res.status(401).json({ ok: false });
  }

  const token = process.env.TELEGRAM_TOKEN;
  const msg = req.body?.message;
  const chatId = msg?.chat?.id;
  const text = (msg?.text || '').trim();

  if (!chatId || !text) return res.status(200).json({ ok: true });

  try {
    if (text.startsWith('/start')) {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Привет! Я ассистент GymLog 🏋️\n\nВеди дневник тренировок в приложении — кнопка «GymLog» слева от поля ввода или кнопка ниже.\n\nА мне можешь задать любой вопрос о тренировках, технике, питании и восстановлении.',
        reply_markup: {
          inline_keyboard: [[{ text: '🏋️ Открыть GymLog', web_app: { url: APP_URL } }]]
        }
      });
    } else {
      await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
      const answer = await askGemini(text);
      await tg(token, 'sendMessage', { chat_id: chatId, text: answer });
    }
  } catch (e) {
    console.error('bot error:', e);
    try {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Не получилось ответить — попробуй ещё раз через минуту.'
      });
    } catch (_) {}
  }

  return res.status(200).json({ ok: true });
}
