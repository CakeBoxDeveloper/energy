# 🤖 Telegram Energy Balance Bot (Vercel Serverless)

Телеграм-бот, рассчитывающий суточный энергетический баланс:
* 📥 **Приход калорий**: получение данных из дневника питания **FatSecret API**.
* 📤 **Расход калорий**: получение суммарно сожженных калорий из **Google Fit / Health Connect API** (синхронизируется с браслетами/часами Amazfit через приложение Zepp).
* ⚖️ **Баланс**: расчет по формуле `Баланс = Приход - Расход` с явным знаком `+` (профицит) или `-` (дефицит).

Формат ответа бота строго соответствует спецификации:
```text
📊 Энергетический баланс:
📥 Приход: 1850 ккал
📤 Расход: 2200 ккал
⚖️ Итог: -350 ккал
```

---

## 🚀 Быстрый старт и локальный запуск

### 1. Установка зависимостей
```bash
npm install
```

### 2. Запуск тестов
```bash
npm test
```

### 3. Запуск локально (Long Polling)
Скопируйте `.env.example` в `.env`, заполните токен бота и запустите:
```bash
npm start
```

---

## 🔑 Получение API ключей и токенов

### 1. Telegram Bot Token
1. Откройте [@BotFather](https://t.me/BotFather) в Telegram.
2. Создайте бота (`/newbot`) и скопируйте полученный токен в `TELEGRAM_BOT_TOKEN`.

---

### 2. FatSecret API
1. Зарегистрируйтесь на [FatSecret Platform API](https://platform.fatsecret.com/).
2. Создайте новое приложение (App).
3. Получите `Client ID` и `Client Secret` и укажите их в:
   - `FATSECRET_CLIENT_ID`
   - `FATSECRET_CLIENT_SECRET`

---

### 3. Google Fit API (Amazfit / Zepp)

#### Шаг А: Синхронизация Amazfit с Google Fit / Health Connect
1. В приложении **Zepp** (или Zepp Life): зайдите в *Профиль* ➔ *Добавить учетные записи* ➔ подключите **Google Fit** (или Health Connect).

#### Шаг Б: Создание проекта в Google Cloud Console
1. Перейдите в [Google Cloud Console](https://console.cloud.google.com/).
2. Создайте новый проект.
3. В разделе **APIs & Services** ➔ **Library** найдите и включите **Fitness API**.
4. В разделе **OAuth consent screen** выберите *External*, добавьте свой email как тестового пользователя (Test Users).
5. В разделе **Credentials** ➔ **Create Credentials** ➔ **OAuth client ID**:
   - Application type: **Web application**
   - Authorized redirect URIs: `http://localhost:3000/oauth2callback`
6. Скопируйте `Client ID` и `Client Secret` в `.env`.

#### Шаг В: Получение Refresh Token в 1 клик
Запустите интерактивный скрипт:
```bash
npm run get-google-token
```
Перейдите по ссылке в браузере, авторизуйтесь в своем Google-аккаунте и скопируйте сгенерированный `GOOGLE_REFRESH_TOKEN` в `.env`.

---

## ☁️ Развертывание на Vercel

### Вариант 1: Через Vercel CLI
```bash
npm i -g vercel
vercel deploy
```

### Вариант 2: Через GitHub + Vercel Dashboard
1. Загрузите репозиторий на GitHub.
2. Подключите репозиторий в [Vercel Dashboard](https://vercel.com/new).
3. В настройках проекта (**Settings ➔ Environment Variables**) добавьте:
   - `TELEGRAM_BOT_TOKEN`
   - `TELEGRAM_SECRET_TOKEN` (опционально, случайная строка)
   - `FATSECRET_CLIENT_ID`
   - `FATSECRET_CLIENT_SECRET`
   - `GOOGLE_CLIENT_ID`
   - `GOOGLE_CLIENT_SECRET`
   - `GOOGLE_REFRESH_TOKEN`
   - `USER_TIMEZONE` (например `Europe/Moscow`)

### Установка Webhook для Telegram:
После деплоя на Vercel привяжите Webhook командой (в браузере или через curl):
```bash
https://api.telegram.org/bot<YOUR_BOT_TOKEN>/setWebhook?url=https://<YOUR_VERCEL_DOMAIN>/api/webhook&secret_token=<YOUR_SECRET_TOKEN>
```
*(Если `TELEGRAM_SECRET_TOKEN` не используется, параметр `&secret_token=...` можно опустить).*

---

## 📱 Команды бота
- `/balance` (или `/today`) — Получить текущий отчет по балансу калорий за день.
- `/status` — Проверить статус подключения внешних API.
- `/help` — Справка по работе с ботом.
