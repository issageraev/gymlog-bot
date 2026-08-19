# GymLog Bot

Серверная часть бота [@gym_aes_bot](https://t.me/gym_aes_bot): принимает вебхук Telegram на Vercel
и отвечает через Google Gemini (бесплатный тариф) — только на темы тренировок и здоровья.

Мини-приложение: https://issageraev.github.io/gymlog/ (репозиторий `gymlog`).

## Переменные окружения (Vercel → Settings → Environment Variables)

| Имя | Что это |
|---|---|
| `TELEGRAM_TOKEN` | токен бота из @BotFather |
| `GEMINI_API_KEY` | ключ из https://aistudio.google.com/apikey |
| `WEBHOOK_SECRET` | случайная строка; та же передаётся в `setWebhook` как `secret_token` |

## Привязка вебхука

```bash
curl "https://api.telegram.org/bot$TELEGRAM_TOKEN/setWebhook" \
  -d url="https://<project>.vercel.app/api/webhook" \
  -d secret_token="$WEBHOOK_SECRET"
```
