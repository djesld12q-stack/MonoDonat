'use strict';
// ════════════════════════════════════════════════════════
// watcher.js — MonoDonaty Watcher
// Живе завжди у фоні (порт 8182).
// • Якщо всі браузери закрили сайт → зупиняє server.js
// • Якщо браузер знову відкрив сайт → запускає server.js
// Запускається разом з server.js через start_hidden.vbs
// ════════════════════════════════════════════════════════

const http    = require('http');
const { exec, spawn } = require('child_process');
const path    = require('path');
const fs      = require('fs');

const WATCHER_PORT  = 8182;          // порт watcher'а
const MAIN_PORT     = 8181;          // порт server.js
const POLL_INTERVAL = 3000;          // перевіряти кожні 3с
const GRACE_MS      = 8000;          // чекати 8с після закриття браузера перед зупинкою

const DIR = path.dirname(process.argv[1] || __dirname);

let serverProcess   = null;
let serverRunning   = false;
let browserWasActive = false;
let graceTimer      = null;

// ── Запуск server.js ──────────────────────────────────────
function startServer() {
  if (serverRunning) return;
  console.log('[Watcher] Запускаємо server.js...');

  const serverPath = path.join(DIR, 'server.js');
  if (!fs.existsSync(serverPath)) {
    console.error('[Watcher] server.js не знайдено:', serverPath);
    return;
  }

  serverProcess = spawn('node', [serverPath], {
    cwd:      DIR,
    detached: false,
    stdio:    'inherit',
  });

  serverProcess.on('spawn', () => {
    serverRunning = true;
    console.log('[Watcher] server.js запущено (PID', serverProcess.pid + ')');
  });

  serverProcess.on('exit', (code) => {
    serverRunning = false;
    serverProcess = null;
    console.log('[Watcher] server.js зупинено (код', code + ')');
  });

  serverProcess.on('error', (e) => {
    serverRunning = false;
    serverProcess = null;
    console.error('[Watcher] Помилка запуску server.js:', e.message);
  });
}

// ── Зупинка server.js ─────────────────────────────────────
function stopServer() {
  if (!serverRunning || !serverProcess) return;
  console.log('[Watcher] Зупиняємо server.js...');
  try {
    serverProcess.kill('SIGTERM');
  } catch(e) {
    // якщо SIGTERM не спрацював — taskkill (Windows)
    exec('taskkill /PID ' + serverProcess.pid + ' /F /T', () => {});
  }
}

// ── Перевірка чи є браузери на server.js ─────────────────
function checkBrowsers() {
  if (!serverRunning) return;

  const req = http.request({
    hostname: '127.0.0.1',
    port:     MAIN_PORT,
    path:     '/api/status',
    method:   'GET',
    timeout:  2000,
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      try {
        const status = JSON.parse(body);
        const hasBrowser = (status.browserActive > 0) || (status.wsClients > 0);

        if (hasBrowser) {
          // Браузер є — скасовуємо таймер зупинки
          browserWasActive = true;
          clearTimeout(graceTimer);
          graceTimer = null;
        } else if (browserWasActive && !graceTimer) {
          // Браузер щойно закрився — запускаємо grace period
          console.log('[Watcher] Браузер закрито, чекаємо', GRACE_MS / 1000 + 'с...');
          graceTimer = setTimeout(() => {
            graceTimer = null;
            browserWasActive = false;
            console.log('[Watcher] Браузер так і не повернувся — зупиняємо server.js');
            stopServer();
          }, GRACE_MS);
        }
      } catch(e) {}
    });
  });

  req.on('error', () => {
    // server.js не відповідає — вважаємо що впав
    if (serverRunning) {
      serverRunning = false;
      serverProcess = null;
      console.warn('[Watcher] server.js не відповідає');
    }
  });

  req.on('timeout', () => req.destroy());
  req.end();
}

setInterval(checkBrowsers, POLL_INTERVAL);

// ── HTTP сервер watcher'а ─────────────────────────────────
// Браузер відкриває http://127.0.0.1:8182 → watcher піднімає server.js
// і одразу редіректить на основний сайт
const watcherSrv = http.createServer((req, res) => {
  const CORS = { 'Access-Control-Allow-Origin': '*' };

  // Статус watcher'а
  if (req.url === '/status') {
    res.writeHead(200, { ...CORS, 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ watcher: true, serverRunning }));
    return;
  }

  // Будь-який GET → запускаємо server якщо треба + редірект
  if (!serverRunning) {
    console.log('[Watcher] Браузер відкрив сайт — запускаємо server.js');
    startServer();
    // Даємо серверу 2с на старт перед редіректом
    setTimeout(() => {
      res.writeHead(302, { ...CORS, 'Location': 'http://127.0.0.1:8181/' });
      res.end();
    }, 2000);
  } else {
    res.writeHead(302, { ...CORS, 'Location': 'http://127.0.0.1:8181/' });
    res.end();
  }
});

watcherSrv.listen(WATCHER_PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  MonoDonaty Watcher RUNNING              ║');
  console.log('║  http://127.0.0.1:' + WATCHER_PORT + '                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('[Watcher] Запускаємо server.js одразу...');
  startServer();
});

watcherSrv.on('error', (e) => {
  console.error('[Watcher] Не вдалось запустити на порті', WATCHER_PORT + ':', e.message);
});

// ── Graceful shutdown watcher'а ───────────────────────────
process.on('SIGINT',  () => { stopServer(); process.exit(0); });
process.on('SIGTERM', () => { stopServer(); process.exit(0); });
