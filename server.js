'use strict';
// ════════════════════════════════════════════════════════
// server.js — MonoDonaty
// Запуск: node server.js
// Конфіг: скопіюй .env.example → .env і заповни токени
// ════════════════════════════════════════════════════════

// Завантажуємо .env якщо є
try { require('dotenv').config(); } catch(e) {
  // dotenv не встановлено — читаємо .env вручну
  try {
    const fs0 = require('fs'), path0 = require('path');
    const envPath = path0.join(__dirname, '.env');
    if (fs0.existsSync(envPath)) {
      fs0.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const m = line.match(/^\s*([^#\s=]+)\s*=\s*(.*)\s*$/);
        if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
      });
    }
  } catch(e2) {}
}

const http   = require('http');
const fs     = require('fs');
const path   = require('path');
const url    = require('url');
const crypto = require('crypto');
const net    = require('net');
const { exec } = require('child_process');

// ── Конфігурація з .env (або defaults) ──────────────────
let CFG = {
  monoToken:         process.env.MONO_TOKEN         || '',
  accountId:         process.env.MONO_ACCOUNT_ID    || '',
  interval:          parseInt(process.env.MONO_INTERVAL   || '60', 10),
  minAmt:            parseFloat(process.env.MONO_MIN_AMOUNT || '1'),
  channel:           process.env.TWITCH_CHANNEL     || '',
  clientId:          process.env.TWITCH_CLIENT_ID   || '',
  twitchToken:       process.env.TWITCH_TOKEN        || '',
  template:          process.env.TWITCH_TEMPLATE     || 'Donat vid {name}: {amount} {currency}! {comment}',
  templateNoComment: process.env.TWITCH_TEMPLATE_NO_COMMENT || 'Donat vid {name}: {amount} {currency}! Dyakuemo!',
  bgTTS:             true,
  bgTTSVoice:        process.env.TTS_VOICE          || 'uk-UA-OstapNeural',
  bgTTSTemplate:     process.env.TTS_TEMPLATE       || 'Донат від {name}, {amount} {currency}! {comment}',
  bgSound:           true,
  bgSoundFile:       process.env.SOUND_FILE         || 'alert.mp3',
  bgToast:           true,
};

const PORT = 8181;
const MIME = {
  '.html': 'text/html;charset=utf-8',
  '.js':   'application/javascript',
  '.css':  'text/css',
  '.png':  'image/png',
  '.jpg':  'image/jpeg',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.ogg':  'audio/ogg',
};

let wsClients = [];
let browserActiveCount = 0;
let lastDonation = null;
let donationHistory = [];
let pollingEnabled = true;

function wsHandshake(req, socket) {
  const key    = req.headers['sec-websocket-key'];
  const accept = crypto.createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ' + accept + '\r\n\r\n');
}

function wsEncode(data) {
  const msg = Buffer.from(data);
  const len = msg.length;
  let header;
  if (len < 126) header = Buffer.from([0x81, len]);
  else if (len < 65536) header = Buffer.from([0x81, 126, (len >> 8) & 0xff, len & 0xff]);
  else header = Buffer.from([0x81, 127, 0,0,0,0,(len>>24)&0xff,(len>>16)&0xff,(len>>8)&0xff,len&0xff]);
  return Buffer.concat([header, msg]);
}

function wsDecode(buf) {
  if (buf.length < 2) return null;
  const masked = (buf[1] & 0x80) !== 0;
  let len = buf[1] & 0x7f, offset = 2;
  if (len === 126) { len = buf.readUInt16BE(2); offset = 4; }
  else if (len === 127) { offset = 10; }
  if (!masked) return buf.slice(offset, offset + len).toString();
  const mask = buf.slice(offset, offset + 4);
  const data = buf.slice(offset + 4, offset + 4 + len);
  for (let i = 0; i < data.length; i++) data[i] ^= mask[i % 4];
  return data.toString();
}

function wsBroadcast(eventType, data) {
  const payload = JSON.stringify({ event: { type: eventType }, data: data || {} });
  const frame   = wsEncode(payload);
  wsClients = wsClients.filter(s => { try { s.write(frame); return true; } catch(e) { return false; } });
  console.log('[WS] Broadcast:', eventType, '->', wsClients.length, 'clients');
}

const srv = http.createServer((req, res) => {
  const parsed   = url.parse(req.url, true);
  const pathname = parsed.pathname;
  const CORS = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };

  if (pathname === '/api/status') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify({ ok:true, wsClients:wsClients.length, browserActive:browserActiveCount, interval:CFG.interval, channel:CFG.channel, ircReady:ircReady, pollingEnabled:pollingEnabled }));
    return;
  }
  if (pathname === '/api/last-donation') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify(lastDonation || {}));
    return;
  }
  if (pathname === '/api/donations') {
    res.writeHead(200, CORS);
    res.end(JSON.stringify(donationHistory));
    return;
  }
  if (pathname === '/api/config' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const nc = JSON.parse(body);
        Object.assign(CFG, nc);
        console.log('[CFG] Config updated from browser');
        scheduleNextPoll(2);
      } catch(e) {}
      res.writeHead(200, CORS); res.end(JSON.stringify({ ok: true }));
    });
    return;
  }
  if (pathname === '/api/control' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      try {
        const { action } = JSON.parse(body);
        if (action === 'stop') {
          pollingEnabled = false;
          clearTimeout(pollTimer); pollTimer = null;
          console.log('[CTRL] Polling ВИМКНЕНО');
          res.writeHead(200, CORS); res.end(JSON.stringify({ ok: true, polling: false }));
        } else if (action === 'start') {
          pollingEnabled = true;
          scheduleNextPoll(2);
          console.log('[CTRL] Polling УВІМКНЕНО');
          res.writeHead(200, CORS); res.end(JSON.stringify({ ok: true, polling: true }));
        } else {
          res.writeHead(400, CORS); res.end(JSON.stringify({ ok: false, error: 'unknown action' }));
        }
      } catch(e) {
        res.writeHead(500, CORS); res.end(JSON.stringify({ ok: false }));
      }
    });
    return;
  }
  if (pathname === '/api/test-donation' && req.method === 'POST') {
    let body = '';
    req.on('data', d => body += d);
    req.on('end', () => {
      let d = {};
      try { d = JSON.parse(body); } catch(e) {}
      const evt = { id:'test_'+Date.now(), name:d.name||'Тест', amount:d.amount||100, currency:d.currency||'грн', comment:d.comment||'Тестовий донат 🎯', user_name:d.name||'Тест', monoAmount:(d.amount||100)+' '+(d.currency||'грн'), monoComment:d.comment||'Тестовий донат 🎯', ts:Date.now() };
      wsBroadcast('MonobankDonation', evt);
      if (CFG.bgToast) showBgToast(evt.name, evt.amount, evt.currency, evt.comment);
      if (CFG.bgSound && browserActiveCount === 0) playBgSound();
      if (CFG.bgTTS   && browserActiveCount === 0) playBgTTS(evt.name, evt.amount, evt.currency, evt.comment);
      res.writeHead(200, CORS); res.end(JSON.stringify({ ok:true, wsClients:wsClients.length }));
    });
    return;
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, { 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Methods':'GET,POST','Access-Control-Allow-Headers':'Content-Type' });
    res.end(); return;
  }
  let filePath = pathname;
  if (pathname === '/' || pathname === '/index.html') filePath = '/MonoBank-donaty.html';
  const fullPath = path.join(__dirname, filePath.replace(/^\//, ''));
  const ext      = path.extname(fullPath);
  fs.readFile(fullPath, (err, data) => {
    if (err) { res.writeHead(404, {'Content-Type':'text/plain'}); res.end('404: ' + pathname); return; }
    res.writeHead(200, { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Access-Control-Allow-Origin':'*' });
    res.end(data);
  });
});

srv.on('upgrade', (req, socket) => {
  wsHandshake(req, socket);
  wsClients.push(socket);
  socket._isBrowser = false;
  console.log('[WS] Client connected. Total:', wsClients.length);
  let buf = Buffer.alloc(0);
  socket.on('data', chunk => {
    buf = Buffer.concat([buf, chunk]);
    try {
      const msg = wsDecode(buf);
      if (!msg) return;
      buf = Buffer.alloc(0);
      const parsed = JSON.parse(msg);
      if (parsed.type === 'browser_active') {
        socket._isBrowser = true; browserActiveCount++;
        console.log('[WS] Браузер підключено. Активних:', browserActiveCount, '-> server звук ВИМКНЕНО');
      }
      if (parsed.type === 'browser_inactive') {
        if (socket._isBrowser) { socket._isBrowser = false; browserActiveCount = Math.max(0, browserActiveCount-1); }
        console.log('[WS] Браузер відключено. Активних:', browserActiveCount);
      }
    } catch(e) {}
  });
  socket.on('close', () => {
    if (socket._isBrowser) browserActiveCount = Math.max(0, browserActiveCount-1);
    wsClients = wsClients.filter(s => s !== socket);
    console.log('[WS] Відключено. Всього:', wsClients.length, '| Браузерів:', browserActiveCount);
  });
  socket.on('error', () => {
    if (socket._isBrowser) browserActiveCount = Math.max(0, browserActiveCount-1);
    wsClients = wsClients.filter(s => s !== socket);
  });
});

srv.listen(PORT, '127.0.0.1', () => {
  console.log('\n╔══════════════════════════════════════════╗');
  console.log('║  MonoDonaty Server RUNNING               ║');
  console.log('║  http://127.0.0.1:' + PORT + '                   ║');
  console.log('╚══════════════════════════════════════════╝');
  console.log('[*] Mono token:', CFG.monoToken ? CFG.monoToken.slice(0,8)+'...' : 'NOT SET');
  console.log('[*] Account ID:', CFG.accountId || '(autodetect)');
  console.log('[*] Interval:  ', CFG.interval, 'sec');
  console.log('[*] bgToast:', CFG.bgToast, '| bgSound:', CFG.bgSound, '| bgTTS:', CFG.bgTTS);
  console.log('[*] Browser: http://127.0.0.1:' + PORT + '/MonoBank-donaty.html');
  scheduleNextPoll(3);
});

let seenIds   = new Set();
let pollTimer = null;
let accountId = CFG.accountId || '';

function scheduleNextPoll(delaySec) {
  clearTimeout(pollTimer);
  pollTimer = setTimeout(doPoll, (delaySec || CFG.interval) * 1000);
  console.log('[Mono] Next poll in', delaySec || CFG.interval, 'sec');
}

async function doPoll() {
  if (!pollingEnabled) { console.log('[Mono] Polling вимкнено'); return; }
  const token = CFG.monoToken;
  if (!token) { console.log('[Mono] No token, skipping'); scheduleNextPoll(CFG.interval); return; }

  if (!accountId) {
    try {
      console.log('[Mono] Fetching account list...');
      const info = await monoFetch('https://api.monobank.ua/personal/client-info', token);
      const accounts = info.accounts || [];
      const jars     = info.jars     || [];
      // Вибираємо збережений або перший гривневий рахунок
      const acc = accounts.find(a => a.currencyCode === 980) || accounts[0];
      if (acc) { accountId = acc.id; CFG.accountId = acc.id; console.log('[Mono] Account:', acc.maskedPan || acc.id.slice(0,8)); }
      if (jars.length) console.log('[Mono] Jars available:', jars.length, '— set accountId in CFG to use a jar');
    } catch(e) { console.error('[Mono] client-info error:', e.message); scheduleNextPoll(60); return; }
  }

  try {
    const now  = Math.floor(Date.now() / 1000);
    const from = now - (CFG.interval * 2 + 120);
    console.log('[Mono] Polling account:', accountId);
    const txList = await monoFetch('https://api.monobank.ua/personal/statement/' + accountId + '/' + from + '/' + now, token);

    if (!Array.isArray(txList)) { scheduleNextPoll(CFG.interval); return; }

    const newTxs = txList.filter(tx => tx.amount > 0 && !seenIds.has(tx.id) && Math.abs(tx.amount)/100 >= CFG.minAmt).reverse();
    console.log('[Mono] Transactions:', txList.length, '| New donations:', newTxs.length);
    newTxs.forEach(tx => { seenIds.add(tx.id); processDonation(tx); });
    if (seenIds.size > 500) { const arr = Array.from(seenIds); seenIds = new Set(arr.slice(arr.length-300)); }
  } catch(e) {
    if (e.message.includes('429')) { console.warn('[Mono] Rate limit, retry in 65s'); scheduleNextPoll(65); return; }
    console.error('[Mono] Poll error:', e.message);
  }
  scheduleNextPoll(CFG.interval);
}

function processDonation(tx) {
  const amount   = Math.abs(tx.amount) / 100;
  const currency = ({ 980:'грн', 840:'USD', 978:'EUR' })[tx.currencyCode] || 'грн';
  const name     = extractName(tx.description || '');
  const comment  = tx.comment || '';

  console.log('\n💰 DONATION:', name, '-', amount, currency, comment ? '| ' + comment : '');

  const d = { id:tx.id, name, amount, currency, comment, user_name:name,
    monoAmount:amount.toFixed(2)+' '+currency, monoComment:comment, ts:Date.now() };
  lastDonation = d;
  donationHistory.unshift(d);
  if (donationHistory.length > 500) donationHistory = donationHistory.slice(0, 500);

  wsBroadcast('MonobankDonation', d);

  // Чат надсилає ТІЛЬКИ браузер — server.js в чат не пише
  if (CFG.bgToast) showBgToast(name, amount, currency, comment);
  if (CFG.bgSound) { if (browserActiveCount === 0) playBgSound(); }
  if (CFG.bgTTS)   { if (browserActiveCount === 0) playBgTTS(name, amount, currency, comment); }
}

function showBgToast(name, amount, currency, comment) {
  const title = 'Донат ' + amount.toFixed(0) + ' ' + currency + ' від ' + name;
  const body  = comment ? comment.slice(0, 100) : 'Дякуємо за підтримку!';
  const t = title.replace(/'/g,"''").replace(/[\x00-\x1f]/g,'');
  const b = body.replace(/'/g,"''").replace(/[\x00-\x1f]/g,'');
  const ps = "Add-Type -AssemblyName System.Windows.Forms; " +
    "$n = New-Object System.Windows.Forms.NotifyIcon; " +
    "$n.Icon = [System.Drawing.SystemIcons]::Information; " +
    "$n.BalloonTipIcon = 'Info'; " +
    "$n.BalloonTipTitle = '" + t + "'; " +
    "$n.BalloonTipText = '" + b + "'; " +
    "$n.Visible = $true; " +
    "$n.ShowBalloonTip(5000); " +
    "Start-Sleep -Milliseconds 5500; " +
    "$n.Dispose();";
  const encoded = Buffer.from(ps, 'utf16le').toString('base64');
  exec('powershell -NoProfile -WindowStyle Hidden -EncodedCommand ' + encoded,
    err => { if (err) console.error('[Toast] Error:', err.message); else console.log('[Toast] Shown:', title); });
}

function playBgSound() {
  const f = CFG.bgSoundFile || 'alert.mp3';
  const tmpFile = require('os').tmpdir() + '/mono_alert_' + Date.now() + '.mp3';
  const soundPath = path.resolve(__dirname, f);
  if (!fs.existsSync(soundPath)) { console.warn('[Sound] File not found:', soundPath); return; }
  const ps = '$p = New-Object System.Windows.Media.MediaPlayer; ' +
    '$p.Open([System.Uri]\"' + soundPath.replace(/\\/g,'/') + '\"); ' +
    'Start-Sleep -Milliseconds 800; $p.Play(); ' +
    '$dur=0; for($i=0;$i-lt 60;$i++){Start-Sleep -Milliseconds 500; if($p.NaturalDuration.HasTimeSpan){$dur=$p.NaturalDuration.TimeSpan.TotalSeconds;break}}; ' +
    'if($dur -gt 0){Start-Sleep -Seconds ([math]::Ceiling($dur)+1)}else{Start-Sleep -Seconds 8}; ' +
    '$p.Stop(); $p.Close()';
  const cmd = 'powershell -NoProfile -WindowStyle Hidden -Command "Add-Type -AssemblyName presentationCore; & { ' + ps + ' }"';
  exec(cmd, {timeout:30000}, err => { if(err) console.error('[Sound] Error:', err.message); else console.log('[Sound] Played:', f); });
}

function playBgTTS(name, amount, currency, comment) {
  const tpl  = CFG.bgTTSTemplate || '{name}: {amount} {currency}! {comment}';
  const text = tpl.replace('{name}',name).replace('{amount}',amount.toFixed(0)).replace('{currency}',currency).replace('{comment}',comment||'').trim();
  const voice = CFG.bgTTSVoice || 'uk-UA-PolinaNeural';
  const tmp   = require('os').tmpdir() + '/mono_tts_' + Date.now() + '.mp3';
  const cmd1  = 'edge-tts --voice ' + voice + ' --text "' + text.replace(/"/g,"'") + '" --write-media "' + tmp + '"';
  const cmd2  = 'python -m edge_tts --voice ' + voice + ' --text "' + text.replace(/"/g,"'") + '" --write-media "' + tmp + '"';
  exec(cmd1, {timeout:30000}, err1 => {
    if (err1) exec(cmd2, {timeout:30000}, err2 => { if(err2){ console.error('[TTS] Error. Install: pip install edge-tts'); return; } playTmpMp3(tmp); });
    else playTmpMp3(tmp);
  });
}

function playTmpMp3(filePath) {
  const uri = 'file:///' + filePath.replace(/\\/g,'/').replace(/ /g,'%20');
  const ps = 'Add-Type -AssemblyName presentationCore; ' +
    '$mp = New-Object System.Windows.Media.MediaPlayer; ' +
    '$mp.Open([System.Uri]"' + uri + '"); ' +
    'Start-Sleep -Milliseconds 500; $mp.Play(); ' +
    '$dur=0; for($i=0;$i-lt 60;$i++){Start-Sleep -Milliseconds 500;if($mp.NaturalDuration.HasTimeSpan){$dur=$mp.NaturalDuration.TimeSpan.TotalSeconds;break}}; ' +
    'if($dur -gt 0){Start-Sleep -Seconds ([math]::Ceiling($dur)+1)}else{Start-Sleep -Seconds 10}; ' +
    '$mp.Stop(); $mp.Close()';
  exec('powershell -NoProfile -Command "& { ' + ps + ' }"', {timeout:60000},
    err => { if(err) console.error('[TTS] Play error:', err.message); });
  setTimeout(() => { try { fs.unlinkSync(filePath); } catch(e) {} }, 3000);
}

function extractName(desc) {
  if (!desc) return 'Анонім';
  const m = desc.match(/[Вв][іi][дd][:\s]+(.+)/);
  return m ? m[1].trim().slice(0,40) : (desc.slice(0,40) || 'Анонім');
}

function buildChatMsg(d) {
  const tpl = d.comment ? (CFG.template || 'Donat vid {name}: {amount} {currency}! {comment}') : (CFG.templateNoComment || 'Donat vid {name}: {amount} {currency}! Dyakuemo!');
  return tpl.replace('{name}',d.name).replace('{amount}',d.amount.toFixed(2)).replace('{currency}',d.currency).replace('{comment}',d.comment||'');
}

let ircReady  = false;
let ircSocket = null;
let ircQueue  = [];

function connectIRC() {
  if (!CFG.twitchToken || !CFG.channel) return;
  ircSocket = net.createConnection(6667, 'irc.chat.twitch.tv');
  ircSocket.on('connect', () => {
    ircSocket.write('CAP REQ :twitch.tv/tags twitch.tv/commands\r\n');
    ircSocket.write('PASS oauth:' + CFG.twitchToken + '\r\n');
    ircSocket.write('NICK monobot\r\n');
    ircSocket.write('JOIN #' + CFG.channel.toLowerCase() + '\r\n');
  });
  ircSocket.on('data', d => {
    const s = d.toString();
    if (s.includes('PING')) ircSocket.write('PONG :tmi.twitch.tv\r\n');
    if (s.includes('376') || s.includes('JOIN')) {
      ircReady = true;
      console.log('[IRC] Connected to #' + CFG.channel);
      ircQueue.forEach(m => ircSocket.write(m)); ircQueue = [];
    }
  });
  ircSocket.on('error', e => { ircReady = false; console.error('[IRC]', e.message); });
  ircSocket.on('close', () => { ircReady = false; setTimeout(connectIRC, 5000); });
}

function sendTwitchChat(msg) {
  const raw = 'PRIVMSG #' + CFG.channel.toLowerCase() + ' :' + msg.trim() + '\r\n';
  if (ircReady && ircSocket) ircSocket.write(raw);
  else ircQueue.push(raw);
}

if (CFG.twitchToken && CFG.channel) connectIRC();

function monoFetch(apiUrl, token) {
  return new Promise((resolve, reject) => {
    const u = new URL(apiUrl);
    const opts = { hostname:u.hostname, path:u.pathname+u.search, method:'GET', headers:{'X-Token':token} };
    const req = require('https').request(opts, res => {
      let body = '';
      res.on('data', d => body += d);
      res.on('end', () => {
        if (res.statusCode === 429) { reject(new Error('Rate limit (429)')); return; }
        if (res.statusCode !== 200) { reject(new Error('HTTP ' + res.statusCode + ': ' + body.slice(0,100))); return; }
        try { resolve(JSON.parse(body)); } catch(e) { reject(new Error('JSON: ' + e.message)); }
      });
    });
    req.on('error', reject);
    req.end();
  });
}