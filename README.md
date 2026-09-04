# 🤖 Telegram Energy Balance Bot (Vercel + Redis + 1-Click Auth)

Телеграм-бот с **1-клик авторизацией через браузер** и хранилищем сессий в **Upstash Redis / Vercel KV**:
* 📥 **Приход калорий**: дневник питания **FatSecret API**
* 📤 **Расход калорий**: **Google Fit / Health Connect API** (Amazfit)
* ⚖️ **Баланс**: `Баланс = Приход - Расход` со знаком `+` (профицит) или `-` (дефицит)

---

## ⚡ Как теперь работает авторизация

1. Пользователь запускает бота (`/start` или `/auth`).
2. Бот присылает две кнопки:
   - `[ 🔗 Подключить Google Fit (Amazfit) ]`
   - `[ 🔗 Подключить FatSecret ]`
3. Пользователь кликает по кнопке ➔ открывается официальное окно входа Google / FatSecret ➔ пользователь нажимает «Разрешить».
4. Vercel автоматически сохраняет токен в **Redis** под ID этого пользователя Telegram.
5. Бот готов считать баланс по команде `/balance`!

---

## 🔑 Необходимые настройки

### 1. Бесплатный Redis (Upstash / Vercel KV)
1. В панели [Vercel](https://vercel.com/) в вашем проекте перейдите во вкладку **Storage** ➔ нажмите **Create Database** ➔ выберите **KV** (или создайте бесплатную базу на [upstash.com](https://upstash.com/)).
2. Скопируйте параметры подключения:
   - `UPSTASH_REDIS_REST_URL`
   - `UPSTASH_REDIS_REST_TOKEN`

### 2. Google Cloud Console (OAuth Credentials)
1. В [Google Cloud Console](https://console.cloud.google.com/) в разделе **Credentials** ➔ создайте **OAuth 2.0 Client ID** (тип: Web Application).
2. В поле **Authorized redirect URIs** добавьте:
   - `https://<ВАШ_ДОМЕН_НА_VERCEL>/api/auth/google/callback`
   - `http://localhost:3000/api/auth/google/callback` (для локальных тестов)
3. Скопируйте `GOOGLE_CLIENT_ID` и `GOOGLE_CLIENT_SECRET`.

### 3. FatSecret Platform API
1. В личном кабинете [FatSecret Platform](https://platform.fatsecret.com/) укажите Redirect URI:
   - `https://<ВАШ_ДОМЕН_НА_VERCEL>/api/auth/fatsecret/callback`
2. Скопируйте `FATSECRET_CLIENT_ID` и `FATSECRET_CLIENT_SECRET`.

---

## ☁️ Переменные окружения в Vercel

В **Project Settings ➔ Environment Variables** добавьте:
```env
TELEGRAM_BOT_TOKEN=...
APP_URL=https://<ВАШ_ПРОЕКТ>.vercel.app
UPSTASH_REDIS_REST_URL=https://...
UPSTASH_REDIS_REST_TOKEN=...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
FATSECRET_CLIENT_ID=...
FATSECRET_CLIENT_SECRET=...
USER_TIMEZONE=Europe/Moscow
```

После деплоя привяжите Webhook:
```text
https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://<ВАШ_ПРОЕКТ>.vercel.app/api/webhook
```
