#!/usr/bin/env node
'use strict';

/*
 * NOCTURNE Licensing Server
 *
 * Мини-сервер лицензий для лоадера:
 *  - проверяет логин/пароль и срок подписки;
 *  - выдаёт одноразовую ссылку на файл только активным подписчикам;
 *  - сам файл лежит в private/ и никогда не отдаётся напрямую.
 *
 * Без зависимостей: node server.js
 *
 * Команды:
 *   node server.js serve
 *   node server.js adduser <логин> <пароль> [ГГГГ-ММ-ДД]
 *   node server.js deluser <логин>
 *   node server.js users
 *   node server.js passwd  <логин> <пароль>
 *   node server.js extend  <логин> <дней>
 *   node server.js ban     <логин> [0|1]
 *   node server.js setbuild <путь к файлу>
 *   node server.js news    <текст>        (заменить новости одной строкой)
 *   node server.js addnews <текст>        (добавить строку новостей)
 *   node server.js setemail <логин> <почта>    (привязать e-mail)
 *   node server.js emailverified <логин> [0|1] (отметить почту подтверждённой)
 *   node server.js emailtest <адрес>           (проверить отправку письма)
 *   node server.js mailstatus                 (показать настройки SMTP)
 *
 * Почта: SMTP_HOST, SMTP_PORT, SMTP_SECURE, SMTP_STARTTLS, SMTP_USER,
 * SMTP_PASS, MAIL_FROM, MAIL_FROM_NAME (см. mailer.js и README).
 */

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const mailer = require('./mailer');

const ROOT = __dirname;
const DB_PATH = path.join(ROOT, 'db.json');
const PRIVATE_DIR = path.join(ROOT, 'private');
const PORT = Number(process.env.PORT || 8090);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_URL = String(process.env.PUBLIC_URL || '').replace(/\/+$/, '');
const SESSION_TTL = 12 * 60 * 60 * 1000; // 12 часов
const TICKET_TTL = 5 * 60 * 1000;        // 5 минут
const MAX_BODY = 16 * 1024;
const CODE_TTL = 10 * 60 * 1000;        // код подтверждения — 10 минут
const CODE_COOLDOWN = 60 * 1000;         // повторная отправка — раз в минуту
const CODE_ATTEMPTS = 5;                 // попыток ввода на один код

const sessions = new Map(); // token -> { nick, expires }
const tickets = new Map();  // ticket -> { file, name, expires }
const attempts = new Map(); // ip -> { count, reset }
const signupHits = new Map(); // ip -> { count, reset } для писем без аккаунта
const emailHits = new Map();  // email -> { count, reset }

function sha256(text) {
  return crypto.createHash('sha256').update(text, 'utf8').digest('hex');
}

function randomHex(bytes) {
  return crypto.randomBytes(bytes).toString('hex');
}

function hashPassword(password, salt) {
  return sha256(salt + ':' + password);
}

function isoDate(date) {
  return new Date(date).toISOString();
}

function addDays(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString();
}

function normalizeDate(value) {
  if (!value) return addDays(30);
  const date = new Date(value.length <= 10 ? value + 'T23:59:59.000Z' : value);
  return isNaN(date.getTime()) ? addDays(30) : date.toISOString();
}

function defaultDb() {
  return {
    version: '1.0.0',
    online: true,
    news: [
      'NOCTURNE: лоадер проверяет подписку автоматически.',
      'Обновления выходят по мере необходимости — просто запустите лоадер снова.'
    ],
    users: [],
    emailCodes: {},
    emailSignups: {},
    build: { name: 'cheat.exe', file: '', sha256: '', size: 0, version: '1.0.0' }
  };
}

function loadDb() {
  try {
    const db = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (!db || !Array.isArray(db.users)) throw new Error('bad db');
    if (!db.build) db.build = { name: 'cheat.exe', file: '', sha256: '', size: 0, version: '1.0.0' };
    if (!Array.isArray(db.news)) db.news = [];
    if (!db.emailCodes || typeof db.emailCodes !== 'object') db.emailCodes = {};
    if (!db.emailSignups || typeof db.emailSignups !== 'object') db.emailSignups = {};
    return db;
  } catch (error) {
    const db = defaultDb();
    const salt = randomHex(16);
    db.users.push({
      nick: 'demo',
      salt,
      hash: hashPassword('demo', salt),
      until: addDays(30),
      banned: false,
      createdAt: new Date().toISOString()
    });
    saveDb(db);
    console.log('[db] Создана новая база. Тестовый аккаунт: demo / demo (удалите его перед публикацией).');
    return db;
  }
}

function saveDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// Перечитываем базу на каждом запросе: команды CLI применяются без перезапуска сервера.
function currentDb(fallback) {
  try {
    const data = JSON.parse(fs.readFileSync(DB_PATH, 'utf8'));
    if (data && Array.isArray(data.users)) {
      if (!data.build) data.build = { name: 'cheat.exe', file: '', sha256: '', size: 0, version: '1.0.0' };
      if (!Array.isArray(data.news)) data.news = [];
      if (!data.emailCodes || typeof data.emailCodes !== 'object') data.emailCodes = {};
      if (!data.emailSignups || typeof data.emailSignups !== 'object') data.emailSignups = {};
      return data;
    }
  } catch (error) { /* оставляем последнюю известную базу */ }
  return fallback;
}

function findUser(db, nick) {
  const needle = String(nick || '').toLowerCase();
  return db.users.find(user => String(user.nick).toLowerCase() === needle);
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return crypto.timingSafeEqual(left, right);
}


/* --------------------------------------------------------------- e-mail */

function normEmail(value) {
  return String(value || '').trim().toLowerCase();
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(value || '').trim());
}

function escapeHtmlServer(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
}

function emailLetter(nick, code, purpose) {
  const safeNick = escapeHtmlServer(nick);
  const reset = purpose === 'reset';
  const title = reset ? 'Сброс пароля NOCTURNE' : 'Код подтверждения NOCTURNE';
  const action = reset ? 'сброса пароля' : 'подтверждения почты';
  const text = [
    'NOCTURNE',
    '',
    'Здравствуйте, ' + nick + '!',
    '',
    'Код ' + action + ': ' + code,
    '',
    'Код действует 10 минут и подходит только для одной попытки подтверждения.',
    'Если вы не запрашивали код, просто проигнорируйте письмо — аккаунт останется как есть.',
    '',
    'Сотрудники NOCTURNE никогда не спрашивают код. Никому его не сообщайте.',
    '',
    '— NOCTURNE'
  ].join('\n');
  const html = [
    '<div style="background:#0b0713;padding:32px 16px;font-family:Segoe UI,Arial,sans-serif">',
    '<div style="max-width:520px;margin:0 auto;background:#140d1f;border:1px solid #3a2450;border-radius:16px;padding:28px;color:#e9e2f5">',
    '<div style="letter-spacing:6px;font-size:12px;color:#9a7bd4;margin-bottom:18px">NOCTURNE</div>',
    '<h2 style="margin:0 0 12px;font-size:20px;color:#fff">' + title + '</h2>',
    '<p style="margin:0 0 18px;color:#b9a9d0">Здравствуйте, ' + safeNick + '! Ваш код ' + action + ':</p>',
    '<div style="font-size:32px;letter-spacing:10px;font-weight:700;color:#fff;background:#1d1230;border-radius:12px;padding:16px;text-align:center">' + code + '</div>',
    '<p style="margin:18px 0 0;color:#8d7aa8;font-size:13px">Код действует 10 минут. Если вы не запрашивали его — просто проигнорируйте письмо.</p>',
    '<p style="margin:10px 0 0;color:#8d7aa8;font-size:13px">Сотрудники NOCTURNE никогда не спрашивают код.</p>',
    '</div></div>'
  ].join('');
  return { subject: title, text, html };
}

function signupAllowed() {
  return process.env.MAIL_ALLOW_SIGNUP !== '0';
}

function signupRateLimited(ip) {
  const now = Date.now();
  const state = signupHits.get(ip);
  if (!state || now > state.reset) {
    signupHits.set(ip, { count: 1, reset: now + 60 * 60 * 1000 });
    return false;
  }
  state.count += 1;
  return state.count > 5;
}

function emailRateLimited(email) {
  const now = Date.now();
  const state = emailHits.get(email);
  if (!state || now > state.reset) {
    emailHits.set(email, { count: 1, reset: now + 60 * 60 * 1000 });
    return false;
  }
  state.count += 1;
  return state.count > 5;
}

function applyCors(res) {
  res.setHeader('Access-Control-Allow-Origin', String(process.env.MAIL_ALLOWED_ORIGIN || '*'));
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Vary', 'Origin');
}

function readParams(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const type = String(req.headers['content-type'] || '');
      let params;
      if (/application\/json/i.test(type)) {
        try {
          params = JSON.parse(body || '{}');
        } catch (error) {
          return reject(new Error('bad json'));
        }
      } else {
        params = {};
        for (const [key, value] of new URLSearchParams(body)) params[key] = value;
      }
      resolve({
        login: String(params.login || params.nick || '').trim(),
        password: String(params.password || ''),
        newPassword: String(params.newPassword || params.password2 || ''),
        email: String(params.email || '').trim(),
        code: String(params.code || '').trim(),
        purpose: String(params.purpose || 'verify').trim()
      });
    });
    req.on('error', reject);
  });
}

/* ------------------------------------------------------------------ CLI */

function cli(args) {
  const db = loadDb();
  const command = args[0] || 'serve';

  if (command === 'serve') return serve(db);

  if (command === 'adduser') {
    const nick = String(args[1] || '').trim();
    const password = String(args[2] || '');
    if (!nick || !password) {
      console.log('Использование: node server.js adduser <логин> <пароль> [ГГГГ-ММ-ДД]');
      return;
    }
    if (findUser(db, nick)) {
      console.log('Такой пользователь уже есть. Смените пароль командой passwd.');
      return;
    }
    const salt = randomHex(16);
    db.users.push({
      nick,
      salt,
      hash: hashPassword(password, salt),
      until: normalizeDate(args[3]),
      banned: false,
      createdAt: new Date().toISOString()
    });
    saveDb(db);
    console.log(`Пользователь ${nick} создан. Подписка до ${isoDate(db.users[db.users.length - 1].until)}.`);
    return;
  }

  if (command === 'deluser') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    db.users = db.users.filter(item => item !== user);
    saveDb(db);
    console.log(`Пользователь ${user.nick} удалён.`);
    return;
  }

  if (command === 'users') {
    if (!db.users.length) return console.log('Пользователей нет.');
    for (const user of db.users) {
      console.log(`${user.nick}\t${isoDate(user.until)}\t${user.banned ? 'заблокирован' : 'активен'}`);
    }
    return;
  }

  if (command === 'passwd') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    user.salt = randomHex(16);
    user.hash = hashPassword(String(args[2] || ''), user.salt);
    saveDb(db);
    console.log('Пароль обновлён.');
    return;
  }

  if (command === 'extend') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    const days = Number(args[2] || 30);
    const base = new Date(user.until).getTime();
    const from = Math.max(Date.now(), isNaN(base) ? 0 : base);
    user.until = new Date(from + days * 24 * 60 * 60 * 1000).toISOString();
    saveDb(db);
    console.log(`Подписка ${user.nick} продлена до ${user.until}.`);
    return;
  }

  if (command === 'ban') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    user.banned = String(args[2] || '1') !== '0';
    saveDb(db);
    console.log(`Пользователь ${user.nick}: ${user.banned ? 'заблокирован' : 'разблокирован'}.`);
    return;
  }

  if (command === 'setemail') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    const email = normEmail(args[2]);
    if (!validEmail(email)) return console.log('Некорректный e-mail.');
    user.email = email;
    user.emailVerified = false;
    saveDb(db);
    console.log(`Почта ${user.nick}: ${email} (не подтверждена). Подтвердить: node server.js emailverified ${user.nick} 1`);
    return;
  }

  if (command === 'emailverified') {
    const user = findUser(db, args[1]);
    if (!user) return console.log('Пользователь не найден.');
    user.emailVerified = String(args[2] || '1') !== '0';
    saveDb(db);
    console.log(`Почта ${user.nick}: ${user.emailVerified ? 'подтверждена' : 'не подтверждена'}.`);
    return;
  }

  if (command === 'mailstatus') {
    const info = mailer.describe();
    console.log(info.configured ? 'SMTP настроен.' : 'SMTP НЕ настроен: письма складываются в ' + info.outbox);
    console.log('  host:     ' + (info.host || '—'));
    console.log('  port:     ' + info.port);
    console.log('  secure:   ' + (info.secure ? 'да (TLS сразу)' : 'нет (STARTTLS)'));
    console.log('  starttls: ' + (info.starttls ? 'да' : 'нет'));
    console.log('  from:     ' + (info.from || '—'));
    console.log('  debug:    ' + (info.debug ? 'включён (SMTP_DEBUG=1)' : 'выключен'));
    console.log('  письма без аккаунта: ' + (signupAllowed() ? 'разрешены (MAIL_ALLOW_SIGNUP=0 отключает)' : 'отключены'));
    return;
  }

  if (command === 'emailtest') {
    const to = normEmail(args[1]);
    if (!validEmail(to)) return console.log('Использование: node server.js emailtest <адрес>');
    mailer.deliver({
      to,
      subject: 'NOCTURNE: проверка почты',
      text: 'Это тестовое письмо от сервера NOCTURNE. Если вы его видите, отправка настроена верно.',
      html: '<div style="background:#0b0713;color:#e9e2f5;font-family:Segoe UI,Arial,sans-serif;padding:24px;border-radius:12px">Это тестовое письмо от сервера NOCTURNE. Отправка настроена верно.</div>'
    }).then(result => {
      console.log(result.delivery === 'smtp' ? 'Письмо отправлено через SMTP на ' + to : 'SMTP не настроен, письмо сохранено в ' + result.file);
    }).catch(error => {
      console.log('Не удалось отправить письмо: ' + error.message);
    });
    return;
  }

  if (command === 'setbuild') {
    const source = args[1];
    if (!source || !fs.existsSync(source)) {
      console.log('Файл не найден. Использование: node server.js setbuild <путь к файлу>');
      return;
    }
    fs.mkdirSync(PRIVATE_DIR, { recursive: true });
    const name = path.basename(source);
    const destination = path.join(PRIVATE_DIR, name);
    if (path.resolve(source) !== path.resolve(destination)) fs.copyFileSync(source, destination);
    const data = fs.readFileSync(destination);
    db.build = {
      name,
      file: path.relative(ROOT, destination).replace(/\\/g, '/'),
      sha256: crypto.createHash('sha256').update(data).digest('hex'),
      size: data.length,
      version: args[2] || db.version || '1.0.0'
    };
    saveDb(db);
    console.log(`Сборка обновлена: ${name}, ${data.length} байт, sha256 ${db.build.sha256}.`);
    return;
  }

  if (command === 'news' || command === 'addnews') {
    const text = args.slice(1).join(' ').trim();
    if (!text) return console.log('Введите текст новости.');
    if (command === 'news') db.news = [text];
    else db.news.push(text);
    saveDb(db);
    console.log('Новости обновлены.');
    return;
  }

  console.log('Неизвестная команда. Доступно: serve, adduser, deluser, users, passwd, extend, ban, setbuild, news, addnews, setemail, emailverified, emailtest, mailstatus.');
}

/* --------------------------------------------------------------- HTTP */

function sendText(res, status, text) {
  res.writeHead(status, {
    'Content-Type': 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(text);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > MAX_BODY) {
        reject(new Error('too large'));
        req.destroy();
      }
    });
    req.on('end', () => {
      const params = new URLSearchParams(body);
      resolve({ login: params.get('login') || '', password: params.get('password') || '' });
    });
    req.on('error', reject);
  });
}

function rateLimited(ip) {
  const now = Date.now();
  const state = attempts.get(ip);
  if (!state || now > state.reset) {
    attempts.set(ip, { count: 1, reset: now + 60 * 1000 });
    return false;
  }
  state.count++;
  return state.count > 8;
}

function bearerToken(req) {
  const header = String(req.headers.authorization || '');
  const match = /^Bearer\s+([a-f0-9]{32,128})$/i.exec(header);
  return match ? match[1] : '';
}

function sessionFor(req) {
  const token = bearerToken(req);
  if (!token) return null;
  const session = sessions.get(token);
  if (!session) return null;
  if (session.expires < Date.now()) {
    sessions.delete(token);
    return null;
  }
  return session;
}

async function handleSignupCode(db, params, ip, res) {
  if (!signupAllowed()) return sendText(res, 200, 'ERR\nmessage=Подтверждение почты без аккаунта отключено на сервере.');
  const email = normEmail(params.email);
  if (!validEmail(email)) return sendText(res, 200, 'ERR\nmessage=Введите корректный e-mail.');
  const key = 'email:' + email;
  const previous = db.emailSignups[key];
  if (previous && Date.now() - Number(previous.sentAt || 0) < CODE_COOLDOWN) {
    const retry = Math.max(1, Math.ceil((CODE_COOLDOWN - (Date.now() - Number(previous.sentAt || 0))) / 1000));
    return sendText(res, 200, ['ERR', 'retry=' + retry, 'message=Код уже отправлен. Повторите через ' + retry + ' с.'].join('\n'));
  }
  if (signupRateLimited(ip) || emailRateLimited(email)) {
    return sendText(res, 200, 'ERR\nmessage=Слишком много писем на этот адрес. Попробуйте через час.');
  }
  const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
  const salt = randomHex(8);
  const expiresAt = Date.now() + CODE_TTL;
  db.emailSignups[key] = {
    email,
    salt,
    hash: sha256(salt + ':' + code),
    sentAt: Date.now(),
    expiresAt,
    attempts: 0
  };
  saveDb(db);
  const letter = emailLetter(email.split('@')[0], code, 'verify');
  try {
    const result = await mailer.deliver({ to: email, ...letter });
    if (result.delivery !== 'smtp') console.log('[mail] код для ' + email + ': ' + code + ' (SMTP не настроен, письмо в ' + result.file + ')');
    return sendText(res, 200, [
      'OK',
      'signup=1',
      'delivery=' + result.delivery,
      'email=' + email,
      'expires=' + isoDate(expiresAt),
      'ttl=' + Math.round(CODE_TTL / 1000),
      'cooldown=' + Math.round(CODE_COOLDOWN / 1000)
    ].join('\n'));
  } catch (error) {
    delete db.emailSignups[key];
    saveDb(db);
    return sendText(res, 200, 'ERR\nmessage=Не удалось отправить письмо: ' + String(error.message || error).replace(/[\r\n]+/g, ' '));
  }
}

async function handleSignupVerify(db, params, res) {
  const email = normEmail(params.email);
  const key = 'email:' + email;
  const record = db.emailSignups[key];
  if (!record) return sendText(res, 200, 'ERR\nmessage=Код не запрашивался или уже использован.');
  if (Date.now() > Number(record.expiresAt || 0)) {
    delete db.emailSignups[key];
    saveDb(db);
    return sendText(res, 200, 'ERR\nmessage=Код истёк. Запросите новый.');
  }
  if (Number(record.attempts || 0) >= CODE_ATTEMPTS) {
    return sendText(res, 200, 'ERR\nmessage=Слишком много неверных попыток. Запросите новый код.');
  }
  if (!safeEqual(sha256(record.salt + ':' + params.code), record.hash)) {
    record.attempts = Number(record.attempts || 0) + 1;
    saveDb(db);
    const left = Math.max(0, CODE_ATTEMPTS - record.attempts);
    return sendText(res, 200, ['ERR', 'code=wrong', 'left=' + left, 'message=Неверный код. Осталось попыток: ' + left + '.'].join('\n'));
  }
  delete db.emailSignups[key];
  saveDb(db);
  return sendText(res, 200, ['OK', 'verified=1', 'signup=1', 'email=' + record.email, 'passwordChanged=0'].join('\n'));
}

function servesStatic() {
  return false;
}

function serve(initialDb) {
  fs.mkdirSync(PRIVATE_DIR, { recursive: true });

  const server = http.createServer((req, res) => {
    const db = currentDb(initialDb);
    const url = new URL(req.url, 'http://localhost');
    const ip = req.socket.remoteAddress || 'unknown';

    if (req.method === 'GET' && url.pathname === '/api/status') {
      const lines = ['OK', 'version=' + db.version, 'online=' + (db.online ? 'true' : 'false')];
      for (const item of db.news.slice(0, 6)) lines.push('news=' + String(item).replace(/[\r\n]+/g, ' '));
      return sendText(res, 200, lines.join('\n'));
    }

    if (req.method === 'POST' && url.pathname === '/api/login') {
      if (rateLimited(ip)) return sendText(res, 429, 'ERR\nmessage=Слишком много попыток. Подождите минуту.');
      parseBody(req).then(({ login, password }) => {
        const user = findUser(db, login);
        const expected = user ? hashPassword(password, user.salt) : sha256('invalid:' + randomHex(8));
        const valid = user && safeEqual(expected, user.hash);
        if (!valid) return sendText(res, 200, 'ERR\nmessage=Неверный логин или пароль.');
        if (user.banned) return sendText(res, 200, 'ERR\nmessage=Аккаунт заблокирован.');
        if (!db.online) return sendText(res, 200, 'ERR\nmessage=Сервер временно отключён на техработы.');

        const token = randomHex(32);
        sessions.set(token, { nick: user.nick, expires: Date.now() + SESSION_TTL });
        return sendText(res, 200, [
          'OK',
          'token=' + token,
          'nick=' + user.nick,
          'until=' + isoDate(user.until)
        ].join('\n'));
      }).catch(() => sendText(res, 400, 'ERR\nmessage=Некорректный запрос.'));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/ticket') {
      const session = sessionFor(req);
      if (!session) return sendText(res, 200, 'ERR\nmessage=Сессия истекла. Войдите заново.');
      const user = findUser(db, session.nick);
      if (!user) return sendText(res, 200, 'ERR\nmessage=Аккаунт не найден.');
      if (user.banned) return sendText(res, 200, 'ERR\nmessage=Аккаунт заблокирован.');
      if (!db.online) return sendText(res, 200, 'ERR\nmessage=Сервер временно отключён на техработы.');
      if (!(new Date(user.until).getTime() > Date.now())) {
        return sendText(res, 200, 'ERR\nmessage=Подписка истекла. Продлите её на сайте.');
      }
      if (!db.build || !db.build.file) return sendText(res, 200, 'ERR\nmessage=Сборка ещё не загружена на сервер.');
      const buildPath = path.join(ROOT, db.build.file);
      if (!fs.existsSync(buildPath)) return sendText(res, 200, 'ERR\nmessage=Файл сборки не найден на сервере.');
      if (!db.build.sha256) return sendText(res, 200, 'ERR\nmessage=У сборки нет контрольной суммы. Запустите setbuild.');

      const ticket = randomHex(24);
      tickets.set(ticket, { file: buildPath, name: db.build.name, expires: Date.now() + TICKET_TTL });
      const base = PUBLIC_URL || ('http://' + (req.headers.host || '127.0.0.1:' + PORT));
      return sendText(res, 200, [
        'OK',
        'url=' + base + '/download/' + ticket,
        'sha256=' + db.build.sha256,
        'name=' + db.build.name,
        'version=' + (db.build.version || db.version)
      ].join('\n'));
    }

    if (req.method === 'GET' && url.pathname.startsWith('/download/')) {
      const ticket = url.pathname.slice('/download/'.length);
      const entry = tickets.get(ticket);
      if (!entry) return sendText(res, 404, 'Ссылка недействительна или уже использована.');
      tickets.delete(ticket);
      if (entry.expires < Date.now()) return sendText(res, 404, 'Ссылка истекла.');
      if (!fs.existsSync(entry.file)) return sendText(res, 404, 'Файл не найден.');

      const stat = fs.statSync(entry.file);
      res.writeHead(200, {
        'Content-Type': 'application/octet-stream',
        'Content-Length': stat.size,
        'Content-Disposition': 'attachment; filename="' + String(entry.name).replace(/["\r\n]/g, '') + '"',
        'Cache-Control': 'no-store'
      });
      const stream = fs.createReadStream(entry.file);
      stream.on('error', () => res.destroy());
      stream.pipe(res);
      return;
    }

    if (url.pathname.startsWith('/api/email/')) {
      applyCors(res);
      if (req.method === 'OPTIONS') {
        res.writeHead(204);
        return res.end();
      }
    }

    if (req.method === 'POST' && url.pathname === '/api/email/code') {
      if (rateLimited(ip)) return sendText(res, 429, 'ERR\nmessage=Слишком много попыток. Подождите минуту.');
      readParams(req).then(async params => {
        if (!params.login) {
          return handleSignupCode(db, params, ip, res).catch(() => sendText(res, 400, 'ERR\nmessage=Некорректный запрос.'));
        }
        const user = findUser(db, params.login);
        if (!user) return sendText(res, 200, 'ERR\nmessage=Аккаунт не найден.');
        if (user.banned) return sendText(res, 200, 'ERR\nmessage=Аккаунт заблокирован.');
        const email = normEmail(params.email || user.email);
        if (!validEmail(email)) return sendText(res, 200, 'ERR\nmessage=Введите корректный e-mail.');
        const purpose = params.purpose === 'reset' ? 'reset' : 'verify';
        if (purpose === 'reset' && user.email && normEmail(user.email) !== email) {
          return sendText(res, 200, 'ERR\\nmessage=Почта не совпадает с привязанной к аккаунту.');
        }
        const key = String(user.nick).toLowerCase();
        const previous = db.emailCodes[key];
        if (previous && Date.now() - Number(previous.sentAt || 0) < CODE_COOLDOWN) {
          const retry = Math.max(1, Math.ceil((CODE_COOLDOWN - (Date.now() - Number(previous.sentAt || 0))) / 1000));
          return sendText(res, 200, ['ERR', 'retry=' + retry, 'message=Код уже отправлен. Повторите через ' + retry + ' с.'].join('\n'));
        }
        const code = String(crypto.randomInt(0, 1000000)).padStart(6, '0');
        const salt = randomHex(8);
        const expiresAt = Date.now() + CODE_TTL;
        db.emailCodes[key] = {
          nick: user.nick,
          email,
          purpose,
          salt,
          hash: sha256(salt + ':' + code),
          sentAt: Date.now(),
          expiresAt,
          attempts: 0,
          sends: previous ? Number(previous.sends || 1) + 1 : 1
        };
        saveDb(db);
        const letter = emailLetter(user.nick, code, purpose);
        try {
          const result = await mailer.deliver({ to: email, ...letter });
          if (result.delivery !== 'smtp') console.log('[mail] код для ' + user.nick + ': ' + code + ' (SMTP не настроен, письмо в ' + result.file + ')');
          return sendText(res, 200, [
            'OK',
            'delivery=' + result.delivery,
            'email=' + email,
            'expires=' + isoDate(expiresAt),
            'ttl=' + Math.round(CODE_TTL / 1000),
            'cooldown=' + Math.round(CODE_COOLDOWN / 1000)
          ].join('\n'));
        } catch (error) {
          delete db.emailCodes[key];
          saveDb(db);
          return sendText(res, 200, 'ERR\nmessage=Не удалось отправить письмо: ' + String(error.message || error).replace(/[\r\n]+/g, ' '));
        }
      }).catch(() => sendText(res, 400, 'ERR\nmessage=Некорректный запрос.'));
      return;
    }

    if (req.method === 'POST' && url.pathname === '/api/email/verify') {
      readParams(req).then(params => {
        if (!params.login) {
          return handleSignupVerify(db, params, res).catch(() => sendText(res, 400, 'ERR\nmessage=Некорректный запрос.'));
        }
        const user = findUser(db, params.login);
        if (!user) return sendText(res, 200, 'ERR\nmessage=Аккаунт не найден.');
        const key = String(user.nick).toLowerCase();
        const record = db.emailCodes[key];
        if (!record) return sendText(res, 200, 'ERR\nmessage=Код не запрашивался или уже использован.');
        if (Date.now() > Number(record.expiresAt || 0)) {
          delete db.emailCodes[key];
          saveDb(db);
          return sendText(res, 200, 'ERR\nmessage=Код истёк. Запросите новый.');
        }
        if (Number(record.attempts || 0) >= CODE_ATTEMPTS) {
          return sendText(res, 200, 'ERR\nmessage=Слишком много неверных попыток. Запросите новый код.');
        }
        if (record.purpose === 'reset' && params.newPassword.length < 6) {
          return sendText(res, 200, 'ERR\nmessage=Новый пароль — минимум 6 символов.');
        }
        const expected = sha256(record.salt + ':' + params.code);
        if (!safeEqual(expected, record.hash)) {
          record.attempts = Number(record.attempts || 0) + 1;
          saveDb(db);
          const left = Math.max(0, CODE_ATTEMPTS - record.attempts);
          return sendText(res, 200, ['ERR', 'code=wrong', 'left=' + left, 'message=Неверный код. Осталось попыток: ' + left + '.'].join('\n'));
        }
        user.email = record.email;
        user.emailVerified = true;
        user.emailVerifiedAt = new Date().toISOString();
        const passwordChanged = record.purpose === 'reset';
        if (passwordChanged) {
          user.salt = randomHex(16);
          user.hash = hashPassword(params.newPassword, user.salt);
        }
        delete db.emailCodes[key];
        saveDb(db);
        return sendText(res, 200, [
          'OK',
          'verified=1',
          'email=' + record.email,
          'purpose=' + record.purpose,
          'passwordChanged=' + (passwordChanged ? '1' : '0')
        ].join('\n'));
      }).catch(() => sendText(res, 400, 'ERR\nmessage=Некорректный запрос.'));
      return;
    }

    if (servesStatic()) return;
    sendText(res, 404, 'Not found');
  });

  setInterval(() => {
    const now = Date.now();
    for (const [token, session] of sessions) if (session.expires < now) sessions.delete(token);
    for (const [ticket, entry] of tickets) if (entry.expires < now) tickets.delete(ticket);
    for (const [ip, state] of attempts) if (state.reset < now) attempts.delete(ip);
  }, 60 * 1000).unref();

  server.listen(PORT, HOST, () => {
    console.log('NOCTURNE licensing server');
    console.log('  API:     http://' + (HOST === '0.0.0.0' ? '127.0.0.1' : HOST) + ':' + PORT);
    console.log('  Сборка:  ' + (initialDb.build && initialDb.build.file ? initialDb.build.file + ' (' + initialDb.build.size + ' байт)' : 'не загружена'));
    console.log('  Аккаунты: ' + initialDb.users.length);
    console.log('  Публичный адрес: ' + (PUBLIC_URL || 'определяется по Host запроса'));
    console.log('  Почта:   ' + (mailer.configured() ? 'SMTP ' + mailer.config().host : 'SMTP не настроен (письма в private/outbox)'));
    console.log('\nОстановить: Ctrl+C');
  });
}

cli(process.argv.slice(2));
