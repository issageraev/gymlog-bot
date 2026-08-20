/* GymLog Bot — вебхук Telegram + Gemini (Vercel serverless) */
import { redisReady, waterGet, waterIncr, goalGet, fmtMl } from './_lib.js';

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
    `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: SYSTEM }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: {
          temperature: 0.6,
          maxOutputTokens: 2000,
          // минимум размышлений: быстрый ответ важнее для чата
          thinkingConfig: { thinkingLevel: 'low' }
        }
      })
    }
  );
  const data = await r.json();
  const answer = (data?.candidates?.[0]?.content?.parts || [])
    .filter(p => !p.thought && p.text)
    .map(p => p.text).join('') || '';
  if (!answer) throw new Error('empty gemini response: ' + JSON.stringify(data).slice(0, 300));
  return answer.slice(0, 4000);
}

/* Распознавание сообщений о воде.
   Понимает: "+500", "-250", "вода 500", "вода 0,5", "0.5 л", "500 мл", "/water", "вода".
   Голое число без знака/единицы/слова «вода» водой НЕ считается — уходит в Gemini. */
function parseWater(text) {
  const t = text.toLowerCase().replace(',', '.').replace(/[−–—]/g, '-').replace(/^\/water(@\w+)?/, 'вода').trim();
  if (/^вода$/.test(t)) return { show: true };
  const m = t.match(/^(вода\s*)?([+-]?)(\d+(?:\.\d+)?)\s*(л|мл|l|ml)?$/);
  if (!m) return null;
  const [, word, sign, num, unit] = m;
  if (!word && !sign && !unit) return null; // голое число — не вода
  let v = parseFloat(num);
  if (unit === 'л' || unit === 'l' || (!unit && v <= 10)) v *= 1000;
  v = Math.round(v);
  if (!v || v > 5000) return null;
  return { delta: sign === '-' ? -v : v };
}

/* Похоже на рассказ о выпитой воде? Тогда даём Gemini извлечь объём */
function maybeWaterPhrase(text) {
  return /(выпил|выпила|попил|попила|стакан|кружк|бутылк)/i.test(text);
}

async function extractWaterMl(text) {
  try {
    const key = process.env.GEMINI_API_KEY;
    const r = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.6-flash:generateContent?key=${key}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          system_instruction: { parts: [{ text:
`Определи, сообщает ли пользователь, что он ВЫПИЛ воду или напиток (утверждение о факте, не вопрос и не просьба совета).
Если да — оцени суммарный объём в миллилитрах. Ориентиры, если размер не указан: стакан ≈ 300 мл, кружка ≈ 350 мл, чашка ≈ 250 мл, бутылка ≈ 500 мл, литр = 1000 мл. «Два стакана» = 600 мл — складывай всё перечисленное.
Если это вопрос, совет или не про выпитое — верни 0.
Отвечай строго JSON: {"ml": <целое число>}` }] },
          contents: [{ role: 'user', parts: [{ text }] }],
          generationConfig: { temperature: 0, maxOutputTokens: 600, responseMimeType: 'application/json', thinkingConfig: { thinkingLevel: 'low' } }
        })
      }
    );
    const data = await r.json();
    const raw = (data?.candidates?.[0]?.content?.parts || []).filter(p => !p.thought && p.text).map(p => p.text).join('');
    const ml = Math.round(JSON.parse(raw).ml) || 0;
    return ml > 0 && ml <= 5000 ? ml : 0;
  } catch (e) {
    console.error('extractWaterMl:', e);
    return 0;
  }
}

function todayISO() {
  // Дата по Москве; при желании смени смещение под свой часовой пояс
  const d = new Date(Date.now() + 3 * 3600 * 1000);
  return d.toISOString().slice(0, 10);
}

async function handleWater(token, chatId, userId, w) {
  if (!redisReady()) {
    await tg(token, 'sendMessage', { chat_id: chatId, text: 'Хранилище воды ещё не подключено — загляни чуть позже.' });
    return;
  }
  const date = todayISO();
  const total = w.show ? await waterGet(userId, date) : await waterIncr(userId, date, w.delta);
  const goal = await goalGet(userId);
  const pct = Math.round(total / goal * 100);
  const head = w.show ? 'Сегодня' : (w.delta > 0 ? `Записал ${fmtMl(w.delta)}. Сегодня` : `Убрал ${fmtMl(-w.delta)}. Сегодня`);
  const tail = total >= goal ? ' — норма выполнена! 💧' : ` (${pct}% нормы)`;
  await tg(token, 'sendMessage', {
    chat_id: chatId,
    text: `${head}: ${fmtMl(total)} из ${fmtMl(goal)}${tail}\n\nПолная картина — в приложении GymLog (кнопка меню).`
  });
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
    } else if (/^\/?(экспорт|export)$/i.test(text)) {
      await tg(token, 'sendMessage', {
        chat_id: chatId,
        text: 'Резервную копию делает приложение: открой GymLog → План → Настройки → Экспорт. Файл придёт сюда, в этот чат.'
      });
    } else {
      let w = parseWater(text);
      if (!w && maybeWaterPhrase(text) && redisReady()) {
        await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
        const ml = await extractWaterMl(text);
        if (ml > 0) w = { delta: ml };
      }
      if (w) {
        await handleWater(token, chatId, msg.from?.id || chatId, w);
      } else {
        await tg(token, 'sendChatAction', { chat_id: chatId, action: 'typing' });
        const answer = await askGemini(text);
        await tg(token, 'sendMessage', { chat_id: chatId, text: answer });
      }
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
