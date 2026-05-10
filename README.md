# 🟡 MonoDonaty

Сповіщення про донати з **Monobank** у **Twitch-чат** та **OBS Browser Source**.

Коли хтось переказує гроші на твій рахунок або банку — бот автоматично пише в чат, показує алерт в OBS, відтворює звук і TTS.

---

## ✨ Що вміє

- 💰 Відслідковує нові транзакції через Monobank API (polling)
- 💬 Надсилає донат-повідомлення в Twitch-чат (IRC)
- 🖥️ OBS Browser Source — анімований алерт поверх стріму
- 🔊 Звуковий сигнал + TTS (Text-to-Speech через edge-tts)
- 🔔 Windows-сповіщення (toast)
- ⚙️ Веб-інтерфейс налаштувань — не потрібно редагувати код
- 🫙 Підтримка рахунків і Monobank-банок

---

## 📋 Вимоги

- **Node.js** ≥ 18 → [nodejs.org](https://nodejs.org)
- **Windows** (звук і TTS через PowerShell)
- **Python + edge-tts** (опціонально, тільки для TTS):
  ```
  pip install edge-tts
  ```

---

## 🚀 Встановлення

### 1. Клонуй репозиторій

```bash
git clone https://github.com/YOUR_USERNAME/MonoDonaty.git
cd MonoDonaty
```

### 2. Встанови залежності

```bash
npm install
```

### 3. Створи `.env` файл

```bash
copy .env.example .env   # Windows
cp .env.example .env     # Mac/Linux
```

Відкрий `.env` у будь-якому текстовому редакторі і заповни свої дані.

---

## 🔑 Де взяти токени

### Monobank Token
1. Відкрий [api.monobank.ua](https://api.monobank.ua)
2. Авторизуйся через додаток Monobank
3. Скопіюй **Токен** — встав у `MONO_TOKEN`

### Twitch Client ID
1. Відкрий [dev.twitch.tv/console](https://dev.twitch.tv/console)
2. Натисни **Register Your Application**
3. Назва: будь-яка (напр. `MonoDonaty`)
4. OAuth Redirect URL: `http://localhost:8181/twitch-callback`
5. Category: **Chat Bot**
6. Скопіюй **Client ID** → встав у `TWITCH_CLIENT_ID`

### Twitch OAuth Token (для IRC)
1. Відкрий [twitchapps.com/tmi](https://twitchapps.com/tmi/)
2. Натисни **Connect** і авторизуйся
3. Скопіюй токен (без `oauth:`) → встав у `TWITCH_TOKEN`

---

## ▶️ Запуск

```bash
npm start
```

Або подвійний клік на `start.bat`.

Відкриється сервер на `http://127.0.0.1:8181`

### OBS Browser Source

Додай в OBS: **Browser Source** → URL: `http://127.0.0.1:8181`  
Розмір: 1920×1080 (або по розміру сцени).

---

## ⚙️ Конфігурація через веб-інтерфейс

Відкрий `http://127.0.0.1:8181` у браузері — там є повний інтерфейс налаштувань.  
Можна налаштувати всі параметри без редагування файлів.

---

## 📁 Структура файлів

```
MonoDonaty/
├── server.js          # Node.js сервер
├── index.html         # Веб-інтерфейс (OBS + налаштування)
├── .env               # Твої токени (НЕ комітити!)
├── .env.example       # Приклад конфігурації
├── .gitignore
├── package.json
├── start.bat          # Запуск на Windows
├── start_hidden.vbs   # Прихований запуск (без cmd-вікна)
└── alert.mp3          # Звук сповіщення (додай свій)
```

---

## ❓ Часті питання

**Чому моно API повертає 429?**  
Ліміт Monobank — не частіше 1 запиту за 60 секунд. Встанови `MONO_INTERVAL=60` або більше.

**TTS не працює**  
Встанови edge-tts: `pip install edge-tts`

**Бот не пише в чат**  
Перевір `TWITCH_TOKEN` і `TWITCH_CHANNEL`. Токен повинен бути без префіксу `oauth:`.

---

## 📄 Ліцензія

MIT — дивись [LICENSE](LICENSE)
