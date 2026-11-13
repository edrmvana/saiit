'use strict';

/*
 * NOCTURNE Mailer
 *
 * Отправка писем без внешних зависимостей: собственный минимальный SMTP-клиент
 * (net/tls), AUTH PLAIN/LOGIN, STARTTLS, multipart/alternative.
 *
 * Настройки берутся из переменных окружения:
 *   SMTP_HOST       адрес SMTP-сервера (например smtp.yandex.ru)
 *   SMTP_PORT       порт (по умолчанию 465 при SMTP_SECURE=1, иначе 587)
 *   SMTP_SECURE     1 — сразу TLS (порт 465), 0 — обычное соединение + STARTTLS
 *   SMTP_STARTTLS   0 — не поднимать TLS (только для локальных тестов)
 *   SMTP_USER       логин ящика
 *   SMTP_PASS       пароль приложения
 *   MAIL_FROM       адрес отправителя (по умолчанию = SMTP_USER)
 *   MAIL_FROM_NAME  имя отправителя (по умолчанию NOCTURNE)
 *   SMTP_TIMEOUT    таймаут операции в мс (по умолчанию 15000)
 *
 * Если SMTP_HOST или MAIL_FROM не заданы, письма не отправляются, а
 * складываются файлами .eml в private/outbox/ — удобно для локальной проверки.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const tls = require('tls');
const crypto = require('crypto');

const OUTBOX_DIR = path.join(__dirname, 'private', 'outbox');

function config() {
  const service = String(process.env.SMTP_SERVICE || '').trim().toLowerCase();
  let secure = process.env.SMTP_SECURE === '1';
  let host = String(process.env.SMTP_HOST || '').trim();
  let port = Number(process.env.SMTP_PORT || 0);
  if (service === 'gmail' || service === 'google') {
    host = host || 'smtp.gmail.com';
    port = port || 465;
    if (process.env.SMTP_SECURE === undefined) secure = true;
  }
  // Пароль приложения Google показывают группами по 4 символа: "abcd efgh ijkl mnop".
  // Пробелы в него не входят — если пользователь скопировал пароль как есть, убираем их.
  const rawPass = String(process.env.SMTP_PASS || '');
  const appPassword = /^([A-Za-z0-9]{4}\s){3}[A-Za-z0-9]{4}$/.test(rawPass.trim())
    ? rawPass.replace(/\s+/g, '')
    : rawPass;
  return {
    host,
    service,
    port: port || (secure ? 465 : 587),
    secure,
    starttls: process.env.SMTP_STARTTLS !== '0',
    debug: process.env.SMTP_DEBUG === '1',
    user: String(process.env.SMTP_USER || ''),
    pass: appPassword,
    from: String(process.env.MAIL_FROM || process.env.SMTP_USER || '').trim(),
    fromName: String(process.env.MAIL_FROM_NAME || 'NOCTURNE'),
    timeout: Number(process.env.SMTP_TIMEOUT || 15000)
  };
}

function configured() {
  const cfg = config();
  return Boolean(cfg.host && cfg.from);
}

function describe() {
  const cfg = config();
  return {
    configured: configured(),
    service: cfg.service,
    host: cfg.host,
    port: cfg.port,
    debug: cfg.debug,
    secure: cfg.secure,
    starttls: cfg.starttls,
    from: cfg.from,
    outbox: OUTBOX_DIR
  };
}

/* ------------------------------------------------------------- транзакция */

function createChannel(socket, timeout) {
  let buffer = '';
  let lines = [];
  const waiters = [];
  let failure = null;
  let current = socket;

  function fail(error) {
    failure = failure || error;
    while (waiters.length) waiters.shift().reject(failure);
  }

  function pump() {
    while (waiters.length) {
      const reply = takeReply();
      if (!reply) return;
      waiters.shift().resolve(reply);
    }
  }

  function takeReply() {
    if (!lines.length) return null;
    const first = lines[0];
    if (!/^\d{3}/.test(first)) {
      lines = lines.slice(1);
      return { code: 0, text: first };
    }
    const code = Number(first.slice(0, 3));
    const group = [];
    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      group.push(line);
      if (line.length < 4 || line[3] !== '-') {
        lines = lines.slice(index + 1);
        return {
          code,
          text: group.map(line => line.slice(4)).join('\n'),
          raw: group.join('\n')
        };
      }
    }
    return null;
  }

  const debug = config().debug;

  function debugLog(direction, text) {
    if (!debug) return;
    const safe = /^AUTH\b/i.test(text) || /^[A-Za-z0-9+/=]{8,}$/.test(text)
      ? text.replace(/\S{12,}$/, '<скрыто>')
      : text;
    console.log('[smtp] ' + direction + ' ' + safe);
  }

  function onData(chunk) {
    buffer += chunk.toString('utf8');
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + 1);
      if (line.endsWith('\r')) line = line.slice(0, -1);
      debugLog('<<', line);
      lines.push(line);
    }
    pump();
  }

  function attach(sock) {
    if (current && current !== sock) {
      current.removeListener('data', onData);
      current.removeListener('error', fail);
      current.removeListener('close', onClose);
    }
    current = sock;
    sock.on('data', onData);
    sock.on('error', fail);
    sock.on('close', onClose);
  }

  function onClose() {
    fail(new Error('SMTP-сервер закрыл соединение'));
  }

  attach(socket);

  function read() {
    if (failure) return Promise.reject(failure);
    const reply = takeReply();
    if (reply) return Promise.resolve(reply);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiters.push(waiter);
      const timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('SMTP: истекло время ожидания ответа'));
      }, timeout);
      timer.unref && timer.unref();
      const originalResolve = waiter.resolve;
      waiter.resolve = value => { clearTimeout(timer); originalResolve(value); };
    });
  }

  function write(line) {
    if (failure) throw failure;
    debugLog('>>', line);
    current.write(line + '\r\n');
  }

  async function reply(line) {
    if (line) write(line);
    return read();
  }

  async function expect(line, codes) {
    const result = await reply(line);
    const allowed = Array.isArray(codes) ? codes : [codes];
    if (!allowed.includes(result.code)) {
      throw new Error('SMTP: неожиданный ответ ' + result.code + ' на "' + (line || '').split(' ')[0] + '": ' + result.text);
    }
    return result;
  }

  return { attach, read, write, reply, expect, fail: () => failure, close: () => current.destroy() };
}

function upgrade(socket, cfg) {
  return new Promise((resolve, reject) => {
    const secureSocket = tls.connect({
      socket,
      servername: net.isIP(cfg.host) ? undefined : cfg.host,
      rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED === '1' ? false : true
    }, () => resolve(secureSocket));
    secureSocket.once('error', reject);
    secureSocket.setTimeout(cfg.timeout, () => reject(new Error('TLS: таймаут')));
  });
}

function connect(cfg) {
  return new Promise((resolve, reject) => {
    const socket = cfg.secure
      ? tls.connect({
        host: cfg.host,
        port: cfg.port,
        servername: net.isIP(cfg.host) ? undefined : cfg.host,
        rejectUnauthorized: process.env.SMTP_ALLOW_SELF_SIGNED === '1' ? false : true
      })
      : net.connect({ host: cfg.host, port: cfg.port });
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error('SMTP: не удалось подключиться к ' + cfg.host + ':' + cfg.port));
    }, cfg.timeout);
    socket.setTimeout(cfg.timeout);
    socket.once('error', error => {
      clearTimeout(timer);
      reject(error);
    });
    socket.once(cfg.secure ? 'secureConnect' : 'connect', () => {
      clearTimeout(timer);
      resolve(socket);
    });
  });
}

function encodeHeader(value) {
  const text = String(value || '').replace(/[\r\n]+/g, ' ').trim();
  if (!/[^\x20-\x7E]/.test(text)) return text;
  return '=?UTF-8?B?' + Buffer.from(text, 'utf8').toString('base64') + '?=';
}

function cleanAddress(value) {
  const text = String(value || '').trim();
  if (!/^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/.test(text)) {
    throw new Error('Некорректный адрес получателя');
  }
  return text;
}

function buildMessage({ to, subject, text, html, from, fromName }) {
  const cfg = config();
  const sender = from || cfg.from;
  const senderName = fromName || cfg.fromName;
  const boundary = 'nc-' + crypto.randomBytes(12).toString('hex');
  const domain = (String(sender).split('@')[1] || 'nocturne.local').replace(/[^\w.-]/g, '');
  const lines = [
    'From: ' + encodeHeader(senderName) + ' <' + sender + '>',
    'To: <' + to + '>',
    'Subject: ' + encodeHeader(subject),
    'Date: ' + new Date().toUTCString(),
    'Message-ID: <' + crypto.randomBytes(10).toString('hex') + '@' + domain + '>',
    'MIME-Version: 1.0',
    'X-Mailer: NOCTURNE Mailer'
  ];

  const plain = String(text || '').replace(/\r?\n/g, '\r\n');
  if (html) {
    lines.push('Content-Type: multipart/alternative; boundary="' + boundary + '"');
    lines.push('');
    lines.push('--' + boundary);
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(plain);
    lines.push('');
    lines.push('--' + boundary);
    lines.push('Content-Type: text/html; charset=utf-8');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(String(html).replace(/\r?\n/g, '\r\n'));
    lines.push('');
    lines.push('--' + boundary + '--');
  } else {
    lines.push('Content-Type: text/plain; charset=utf-8');
    lines.push('Content-Transfer-Encoding: 8bit');
    lines.push('');
    lines.push(plain);
  }
  return lines.join('\r\n');
}

function dotStuff(message) {
  return message
    .split('\r\n')
    .map(line => (line.startsWith('.') ? '.' + line : line))
    .join('\r\n');
}

async function sendMail({ to, subject, text, html, from, fromName }) {
  const cfg = config();
  if (!configured()) throw new Error('SMTP не настроен');
  const recipient = cleanAddress(to);

  let socket = await connect(cfg);
  const channel = createChannel(socket, cfg.timeout);

  try {
    await channel.expect(null, 220);
    let ehlo = await channel.expect('EHLO ' + (process.env.SMTP_HELO || 'nocturne.local'), 250);

    if (!cfg.secure && cfg.starttls) {
      if (!/STARTTLS/i.test(ehlo.text)) throw new Error('SMTP: сервер не поддерживает STARTTLS');
      await channel.expect('STARTTLS', 220);
      socket = await upgrade(socket, cfg);
      channel.attach(socket);
      ehlo = await channel.expect('EHLO ' + (process.env.SMTP_HELO || 'nocturne.local'), 250);
    }

    if (cfg.user) {
      if (/AUTH[^\n]*PLAIN/i.test(ehlo.text)) {
        const token = Buffer.from('\0' + cfg.user + '\0' + cfg.pass, 'utf8').toString('base64');
        await channel.expect('AUTH PLAIN ' + token, 235);
      } else if (/AUTH/i.test(ehlo.text)) {
        await channel.expect('AUTH LOGIN', 334);
        await channel.expect(Buffer.from(cfg.user, 'utf8').toString('base64'), 334);
        await channel.expect(Buffer.from(cfg.pass, 'utf8').toString('base64'), 235);
      } else {
        throw new Error('SMTP: сервер не поддерживает AUTH');
      }
    }

    const message = buildMessage({
      to: recipient,
      subject,
      text,
      html,
      from,
      fromName
    });

    await channel.expect('MAIL FROM:<' + cfg.from + '>', 250);
    await channel.expect('RCPT TO:<' + recipient + '>', [250, 251]);
    await channel.expect('DATA', 354);
    channel.write(dotStuff(message) + '\r\n.');
    await channel.expect(null, 250);
    try {
      await channel.expect('QUIT', 221);
    } catch (error) { /* письмо уже принято — QUIT не критичен */ }
    return { delivery: 'smtp', message };
  } finally {
    channel.close();
  }
}

async function deliver({ to, subject, text, html, from, fromName }) {
  const recipient = cleanAddress(to);
  if (configured()) {
    await sendMail({ to: recipient, subject, text, html, from, fromName });
    return { delivery: 'smtp' };
  }
  fs.mkdirSync(OUTBOX_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const safe = recipient.replace(/[^a-z0-9@._-]/gi, '_');
  const file = path.join(OUTBOX_DIR, stamp + '-' + safe + '.eml');
  const message = buildMessage({ to: recipient, subject, text, html, from, fromName });
  fs.writeFileSync(file, message, 'utf8');
  console.log('[mail] SMTP не настроен — письмо сохранено в ' + file);
  return { delivery: 'outbox', file };
}

module.exports = { config, configured, describe, deliver, sendMail, buildMessage, cleanAddress, OUTBOX_DIR };
