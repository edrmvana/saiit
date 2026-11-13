/* NOCTURNE · коды подтверждения почты
 * Два режима работы:
 *  1) Серверный — если задан window.NC_MAIL_ENDPOINT (например http://127.0.0.1:8090),
 *     код генерирует и отправляет сервер лицензий (launcher/server, SMTP).
 *  2) Демо — без сервера: код создаётся в браузере, письмо ложится в локальный
 *     «ящик» (nc_mail_outbox), его можно открыть и посмотреть.
 */
(function () {
  'use strict';

  const TTL_MS = 10 * 60 * 1000;
  const COOLDOWN_MS = 60 * 1000;
  const MAX_ATTEMPTS = 5;
  const CODES_KEY = 'nc_mail_codes';
  const OUTBOX_KEY = 'nc_mail_outbox';

  let state = null;
  let timer = null;

  /* ------------------------------------------------------------ утилиты */

  function storage() {
    return window.ncStorage || window.localStorage;
  }

  function readJSON(key, fallback) {
    try {
      const raw = storage().getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (error) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    try {
      storage().setItem(key, JSON.stringify(value));
    } catch (error) { /* переполнение localStorage — молча пропускаем */ }
  }

  function endpoint() {
    return String(window.NC_MAIL_ENDPOINT || '').replace(/\/+$/, '');
  }

  function isEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[a-zA-Z]{2,}$/.test(String(value || '').trim());
  }

  function normalizeEmail(value) {
    return String(value || '').trim().toLowerCase();
  }

  function randomCode() {
    let number;
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      number = window.crypto.getRandomValues(new Uint32Array(1))[0] % 1000000;
    } else {
      number = Math.floor(Math.random() * 1000000);
    }
    return String(number).padStart(6, '0');
  }

  function toast(text, type) {
    if (typeof window.showNC === 'function') window.showNC(text, type);
  }

  function parseReply(text) {
    const lines = String(text || '').split(/\r?\n/);
    const head = String(lines.shift() || '').trim();
    const data = {};
    for (const line of lines) {
      const index = line.indexOf('=');
      if (index > 0) data[line.slice(0, index)] = line.slice(index + 1);
    }
    return { ok: head === 'OK', error: head === 'OK' ? '' : (data.message || 'Ошибка отправки кода'), data };
  }

  async function post(pathname, body) {
    const base = endpoint();
    if (!base) throw new Error('Сервер почты не настроен');
    const response = await fetch(base + pathname, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseReply(await response.text());
  }

  /* ------------------------------------------------- отправка и проверка */

  function letterSubject(purpose) {
    return purpose === 'reset' ? 'Сброс пароля NOCTURNE' : 'Код подтверждения NOCTURNE';
  }

  function pushLetter(letter) {
    const letters = readJSON(OUTBOX_KEY, []);
    letters.unshift(letter);
    writeJSON(OUTBOX_KEY, letters.slice(0, 40));
  }

  async function send({ nick, email, purpose }) {
    const key = String(nick || '').toLowerCase();
    const mail = normalizeEmail(email);
    const kind = purpose === 'reset' ? 'reset' : 'verify';
    const now = Date.now();
    const stored = readJSON(CODES_KEY, {})[key];

    if (stored && now - Number(stored.sentAt || 0) < COOLDOWN_MS) {
      const retry = Math.ceil((COOLDOWN_MS - (now - Number(stored.sentAt || 0))) / 1000);
      return { ok: false, retry, error: 'Код уже отправлен. Повторите через ' + retry + ' с.' };
    }

    if (endpoint()) {
      try {
        // Подтверждение почты при регистрации не требует аккаунта на сервере:
        // сервер отправляет код на адрес и не заводит там пользователя.
        const payload = kind === 'reset'
          ? { login: nick, email: mail, purpose: kind }
          : { email: mail, purpose: 'register' };
        const reply = await post('/api/email/code', payload);
        if (!reply.ok) return { ok: false, retry: Number(reply.data.retry || 0), error: reply.error };
        const expiresAt = Date.parse(reply.data.expires) || now + TTL_MS;
        const record = {
          nick,
          email: reply.data.email || mail,
          purpose: kind,
          sentAt: now,
          expiresAt,
          attempts: 0,
          delivery: reply.data.delivery || 'smtp',
          signup: reply.data.signup === '1'
        };
        const all = readJSON(CODES_KEY, {});
        all[key] = record;
        writeJSON(CODES_KEY, all);
        return { ok: true, server: true, delivery: record.delivery, email: record.email, expiresAt };
      } catch (error) {
        /* сервер недоступен — уходим в демо-режим, чтобы форма не «умирала» */
      }
    }

    const code = randomCode();
    const expiresAt = now + TTL_MS;
    const record = { nick, email: mail, purpose: kind, code, sentAt: now, expiresAt, attempts: 0, delivery: 'demo' };
    const all = readJSON(CODES_KEY, {});
    all[key] = record;
    writeJSON(CODES_KEY, all);
    pushLetter({
      id: 'L-' + now + '-' + Math.floor(Math.random() * 1000),
      to: mail,
      nick,
      subject: letterSubject(kind),
      purpose: kind,
      code,
      time: now,
      delivery: 'demo'
    });
    return { ok: true, demo: true, delivery: 'demo', email: mail, expiresAt, code };
  }

  async function verify({ nick, code, purpose, newPassword }) {
    const key = String(nick || '').toLowerCase();
    const all = readJSON(CODES_KEY, {});
    const record = all[key];
    const kind = purpose === 'reset' ? 'reset' : 'verify';

    if (endpoint() && record && record.delivery !== 'demo') {
      try {
        const reply = await post('/api/email/verify', record.signup
          ? { email: record.email, code }
          : { login: nick, code, purpose: kind, newPassword: newPassword || '' });
        if (!reply.ok) return { ok: false, error: reply.error, left: Number(reply.data.left || 0) };
        delete all[key];
        writeJSON(CODES_KEY, all);
        return {
          ok: true,
          server: true,
          email: reply.data.email,
          purpose: reply.data.purpose,
          passwordChanged: reply.data.passwordChanged === '1'
        };
      } catch (error) {
        return { ok: false, error: 'Сервер почты недоступен: ' + (error.message || error) };
      }
    }

    if (!record) return { ok: false, error: 'Код не запрашивался или уже использован.' };
    if (record.purpose !== kind) return { ok: false, error: 'Код запрашивался для другого действия.' };
    if (Date.now() > Number(record.expiresAt || 0)) {
      delete all[key];
      writeJSON(CODES_KEY, all);
      return { ok: false, error: 'Код истёк. Запросите новый.' };
    }
    if (Number(record.attempts || 0) >= MAX_ATTEMPTS) {
      return { ok: false, error: 'Слишком много неверных попыток. Запросите новый код.' };
    }
    if (kind === 'reset' && String(newPassword || '').length < 6) {
      return { ok: false, error: 'Новый пароль — минимум 6 символов.' };
    }
    if (String(code) !== String(record.code)) {
      record.attempts = Number(record.attempts || 0) + 1;
      all[key] = record;
      writeJSON(CODES_KEY, all);
      const left = Math.max(0, MAX_ATTEMPTS - record.attempts);
      return { ok: false, error: 'Неверный код. Осталось попыток: ' + left + '.', left };
    }
    delete all[key];
    writeJSON(CODES_KEY, all);
    return { ok: true, demo: true, email: record.email, purpose: record.purpose, passwordChanged: kind === 'reset' };
  }

  /* --------------------------------------------------------------- модал */

  const DIGITS = 6;

  function ensureModal() {
    if (document.getElementById('nc-mail-modal')) return;

    const shell = document.createElement('div');
    shell.id = 'nc-mail-modal';
    shell.className = 'nc-mail-modal';
    shell.innerHTML = [
      '<div class="nc-mail-window" role="dialog" aria-modal="true" aria-labelledby="nc-mail-title">',
      '<button class="nc-mail-x" type="button" data-mail-close aria-label="Закрыть">×</button>',
      '<div class="nc-mail-symbol">✉</div>',
      '<h3 id="nc-mail-title">Подтверждение почты</h3>',
      '<p class="nc-mail-hint" id="nc-mail-hint">Отправим 6-значный код на вашу почту.</p>',
      '<div id="nc-mail-step-address" class="nc-mail-step">',
      '<input id="nc-mail-address" type="email" placeholder="you@example.com" autocomplete="email" aria-label="Электронная почта">',
      '<button id="nc-mail-send" type="button" class="nc-mail-primary">Отправить код</button>',
      '</div>',
      '<div id="nc-mail-step-code" class="nc-mail-step" hidden>',
      '<p class="nc-mail-sent">Код отправлен на <b id="nc-mail-target"></b></p>',
      '<p class="nc-mail-demo" id="nc-mail-demo-note" hidden>Демо-режим: письмо не уходит в интернет — код показан в окне «Письмо».</p>',
      '<div class="nc-mail-digits" id="nc-mail-digits">',
      Array.from({ length: DIGITS }).map((item, index) =>
        '<input inputmode="numeric" maxlength="1" autocomplete="one-time-code" aria-label="Цифра ' + (index + 1) + '">'
      ).join(''),
      '</div>',
      '<div class="nc-mail-timer" id="nc-mail-timer"></div>',
      '<div id="nc-mail-password-wrap" hidden>',
      '<input id="nc-mail-password" type="password" placeholder="Новый пароль" autocomplete="new-password" aria-label="Новый пароль">',
      '</div>',
      '<button id="nc-mail-submit" type="button" class="nc-mail-primary">Подтвердить</button>',
      '<div class="nc-mail-links">',
      '<button id="nc-mail-resend" type="button" class="nc-mail-link" disabled>Отправить снова</button>',
      '<button id="nc-mail-inbox-open" type="button" class="nc-mail-link">Открыть письмо (демо)</button>',
      '<button id="nc-mail-change" type="button" class="nc-mail-link">Изменить почту</button>',
      '</div>',
      '</div>',
      '<div class="nc-mail-error" id="nc-mail-error" role="status"></div>',
      '</div>'
    ].join('');
    document.body.appendChild(shell);

    const inbox = document.createElement('div');
    inbox.id = 'nc-mail-inbox';
    inbox.className = 'nc-mail-inbox';
    inbox.hidden = true;
    inbox.innerHTML = '<div class="nc-mail-inbox-window" role="dialog" aria-modal="true" aria-labelledby="nc-mail-inbox-title">' +
      '<button class="nc-mail-x" type="button" data-inbox-close aria-label="Закрыть">×</button>' +
      '<h3 id="nc-mail-inbox-title">Почта (демо)</h3>' +
      '<p class="nc-mail-hint">Письма этого браузера. Настоящая отправка включается на сервере лицензий.</p>' +
      '<div class="nc-mail-inbox-list" id="nc-mail-inbox-list"></div>' +
      '</div>';
    document.body.appendChild(inbox);

    shell.addEventListener('click', event => {
      if (event.target === shell) closeModal();
    });
    document.addEventListener('keydown', event => {
      if (event.key !== 'Escape') return;
      const inbox = document.getElementById('nc-mail-inbox');
      if (inbox && !inbox.hidden) return closeInbox();
      const modal = document.getElementById('nc-mail-modal');
      if (modal && !modal.hidden) closeModal();
    });
    inbox.addEventListener('click', event => {
      if (event.target === inbox) closeInbox();
    });
    shell.querySelector('[data-mail-close]').onclick = closeModal;
    inbox.querySelector('[data-inbox-close]').onclick = closeInbox;

    shell.querySelector('#nc-mail-send').onclick = () => sendFromForm();
    shell.querySelector('#nc-mail-submit').onclick = () => submitCode();
    shell.querySelector('#nc-mail-resend').onclick = () => resend();
    shell.querySelector('#nc-mail-inbox-open').onclick = () => openInbox();
    shell.querySelector('#nc-mail-change').onclick = () => showAddressStep(true);

    shell.querySelector('#nc-mail-address').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); sendFromForm(); }
    });
    shell.querySelector('#nc-mail-password').addEventListener('keydown', event => {
      if (event.key === 'Enter') { event.preventDefault(); submitCode(); }
    });

    const digits = Array.from(shell.querySelectorAll('#nc-mail-digits input'));
    digits.forEach((input, index) => {
      input.addEventListener('input', () => {
        const clean = input.value.replace(/\D/g, '').slice(-1);
        input.value = clean;
        if (clean && index < digits.length - 1) digits[index + 1].focus();
        if (digits.every(item => item.value)) submitCode();
      });
      input.addEventListener('keydown', event => {
        if (event.key === 'Backspace' && !input.value && index > 0) digits[index - 1].focus();
        if (event.key === 'ArrowLeft' && index > 0) digits[index - 1].focus();
        if (event.key === 'ArrowRight' && index < digits.length - 1) digits[index + 1].focus();
        if (event.key === 'Enter') { event.preventDefault(); submitCode(); }
      });
      input.addEventListener('paste', event => {
        const text = String((event.clipboardData || window.clipboardData || {}).getData('text') || '').replace(/\D/g, '').slice(0, DIGITS);
        if (!text) return;
        event.preventDefault();
        text.split('').forEach((char, position) => {
          if (digits[position]) digits[position].value = char;
        });
        digits[Math.min(text.length, DIGITS - 1)].focus();
        if (text.length === DIGITS) submitCode();
      });
    });
  }

  function elements() {
    const modal = document.getElementById('nc-mail-modal');
    return {
      modal,
      title: modal.querySelector('#nc-mail-title'),
      hint: modal.querySelector('#nc-mail-hint'),
      addressStep: modal.querySelector('#nc-mail-step-address'),
      codeStep: modal.querySelector('#nc-mail-step-code'),
      address: modal.querySelector('#nc-mail-address'),
      target: modal.querySelector('#nc-mail-target'),
      digits: Array.from(modal.querySelectorAll('#nc-mail-digits input')),
      passwordWrap: modal.querySelector('#nc-mail-password-wrap'),
      demoNote: modal.querySelector('#nc-mail-demo-note'),
      password: modal.querySelector('#nc-mail-password'),
      error: modal.querySelector('#nc-mail-error'),
      timer: modal.querySelector('#nc-mail-timer'),
      resend: modal.querySelector('#nc-mail-resend'),
      inbox: modal.querySelector('#nc-mail-inbox-open')
    };
  }

  function showError(text) {
    const ui = elements();
    ui.error.textContent = text || '';
    ui.error.classList.toggle('show', Boolean(text));
    if (text) {
      ui.modal.querySelector('.nc-mail-window').classList.remove('shake');
      void ui.modal.offsetWidth;
      ui.modal.querySelector('.nc-mail-window').classList.add('shake');
    }
  }

  function showAddressStep(keepEmail) {
    const ui = elements();
    ui.addressStep.hidden = false;
    ui.codeStep.hidden = true;
    ui.address.readOnly = false;
    if (!keepEmail && state && state.email) ui.address.value = state.email;
    showError('');
    setTimeout(() => ui.address.focus(), 60);
  }

  function startTimer() {
    stopTimer();
    const ui = elements();
    const tick = () => {
      if (!state) return;
      const now = Date.now();
      const leftCode = Math.max(0, Number(state.expiresAt || 0) - now);
      const leftResend = Math.max(0, Number(state.cooldownUntil || 0) - now);
      const minutes = Math.floor(leftCode / 60000);
      const seconds = Math.floor((leftCode % 60000) / 1000);
      ui.timer.textContent = leftCode > 0
        ? 'Код действует ' + minutes + ':' + String(seconds).padStart(2, '0')
        : 'Срок кода истёк — запросите новый';
      ui.timer.classList.toggle('expired', leftCode <= 0);
      ui.resend.disabled = leftResend > 0;
      ui.resend.textContent = leftResend > 0
        ? 'Отправить снова через ' + Math.ceil(leftResend / 1000) + ' с'
        : 'Отправить снова';
    };
    tick();
    timer = setInterval(tick, 1000);
  }

  function stopTimer() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  function showCodeStep(result) {
    const ui = elements();
    ui.addressStep.hidden = true;
    ui.codeStep.hidden = false;
    ui.target.textContent = result.email;
    ui.passwordWrap.hidden = state.purpose !== 'reset';
    state.expiresAt = result.expiresAt;
    state.cooldownUntil = Date.now() + COOLDOWN_MS;
    ui.digits.forEach(input => { input.value = ''; });
    startTimer();
    setTimeout(() => ui.digits[0].focus(), 80);
    ui.demoNote.hidden = !result.demo;
    if (result.demo) {
      ui.inbox.hidden = false;
      setTimeout(() => openInbox(result.code), 350);
    } else {
      ui.inbox.hidden = true;
    }
  }

  async function sendFromForm() {
    if (!state) return;
    const ui = elements();
    const email = normalizeEmail(ui.address.value);
    if (!isEmail(email)) return showError('Введите корректный e-mail');
    ui.modal.querySelector('#nc-mail-send').disabled = true;
    showError('');
    try {
      const result = await send({ nick: state.nick, email, purpose: state.purpose });
      if (!result.ok) {
        showAddressStep(true);
        return showError(result.error);
      }
      state.email = result.email || email;
      showCodeStep(result);
      toast(result.demo ? 'Письмо с кодом в демо-ящике' : 'Код отправлен на ' + state.email, 'success');
    } finally {
      ui.modal.querySelector('#nc-mail-send').disabled = false;
    }
  }

  async function resend() {
    if (!state) return;
    const ui = elements();
    if (Date.now() < Number(state.cooldownUntil || 0)) return;
    ui.resend.disabled = true;
    const result = await send({ nick: state.nick, email: state.email, purpose: state.purpose });
    if (!result.ok) {
      if (result.retry) {
        state.cooldownUntil = Date.now() + result.retry * 1000;
        startTimer();
      }
      return showError(result.error);
    }
    state.email = result.email || state.email;
    state.expiresAt = result.expiresAt;
    state.cooldownUntil = Date.now() + COOLDOWN_MS;
    ui.digits.forEach(input => { input.value = ''; });
    startTimer();
    showError('');
    toast(result.demo ? 'Новый код — в демо-письме' : 'Новый код отправлен', 'success');
    if (result.demo) openInbox(result.code);
    setTimeout(() => ui.digits[0].focus(), 60);
  }

  async function submitCode() {
    if (!state) return;
    const ui = elements();
    const code = ui.digits.map(input => input.value).join('');
    if (code.length !== DIGITS) return showError('Введите 6 цифр из письма');
    const newPassword = state.purpose === 'reset' ? ui.password.value : '';
    if (state.purpose === 'reset' && newPassword.length < 6) return showError('Новый пароль — минимум 6 символов');
    const submit = ui.modal.querySelector('#nc-mail-submit');
    submit.disabled = true;
    showError('');
    try {
      const result = await verify({ nick: state.nick, code, purpose: state.purpose, newPassword });
      if (!result.ok) {
        showError(result.error);
        if (result.left === 0) {
          ui.digits.forEach(input => { input.value = ''; });
        }
        return;
      }
      const callback = state.onVerified;
      const payload = {
        nick: state.nick,
        email: result.email || state.email,
        purpose: state.purpose,
        passwordChanged: Boolean(result.passwordChanged),
        newPassword: newPassword
      };
      closeModal();
      if (typeof callback === 'function') callback(payload);
    } finally {
      submit.disabled = false;
    }
  }

  function start(options) {
    ensureModal();
    const ui = elements();
    state = {
      nick: options.nick,
      email: normalizeEmail(options.email || ''),
      purpose: options.purpose === 'reset' ? 'reset' : 'verify',
      onVerified: options.onVerified,
      expiresAt: 0,
      cooldownUntil: 0
    };
    ui.title.textContent = state.purpose === 'reset' ? 'Сброс пароля' : 'Подтверждение почты';
    ui.hint.textContent = state.purpose === 'reset'
      ? 'Отправим код на привязанную почту, затем зададите новый пароль.'
      : 'Отправим 6-значный код на вашу почту — он действует 10 минут.';
    ui.address.value = state.email;
    ui.password.value = '';
    ui.error.textContent = '';
    ui.error.classList.remove('show');
    ui.modal.hidden = false;
    ui.modal.classList.add('show');
    document.body.classList.add('nc-mail-lock');

    if (state.email && isEmail(state.email)) {
      ui.addressStep.hidden = true;
      ui.codeStep.hidden = true;
      sendFromForm();
    } else {
      showAddressStep(false);
    }
  }

  function closeModal() {
    const modal = document.getElementById('nc-mail-modal');
    if (!modal) return;
    stopTimer();
    modal.classList.remove('show');
    modal.hidden = true;
    document.body.classList.remove('nc-mail-lock');
    const callback = state && state.onCancel;
    state = null;
    if (typeof callback === 'function') callback();
  }

  /* --------------------------------------------------------- демо-письма */

  function openInbox(focusCode) {
    const box = document.getElementById('nc-mail-inbox');
    if (!box) return;
    const list = box.querySelector('#nc-mail-inbox-list');
    const letters = readJSON(OUTBOX_KEY, []);
    if (!letters.length) {
      list.innerHTML = '<p class="nc-mail-empty">Писем пока нет. Отправьте код — письмо появится здесь.</p>';
    } else {
      list.innerHTML = letters.map(letter => {
        const time = new Date(Number(letter.time || 0));
        const stamp = isNaN(time.getTime()) ? '' : time.toLocaleString('ru-RU', {
          day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });
        const highlight = focusCode && letter.code === focusCode;
        return '<article class="nc-mail-letter' + (highlight ? ' fresh' : '') + '" data-code="' + letter.code + '">' +
          '<header><b>' + escape(letter.subject || 'Письмо') + '</b><time>' + escape(stamp) + '</time></header>' +
          '<div class="nc-mail-letter-to">Кому: ' + escape(letter.to) + (letter.nick ? ' · ' + escape(letter.nick) : '') + '</div>' +
          '<p>Здравствуйте! Код: <b class="nc-mail-code">' + escape(letter.code) + '</b><br>' +
          '<span>Действует 10 минут. Сотрудники NOCTURNE код не спрашивают.</span></p>' +
          '<button type="button" class="nc-mail-link" data-use-code="' + letter.code + '">Подставить код</button>' +
          '</article>';
      }).join('');
    }
    box.hidden = false;
    box.classList.add('show');
    list.querySelectorAll('[data-use-code]').forEach(button => {
      button.onclick = () => {
        const code = button.getAttribute('data-use-code');
        const digits = elements().digits;
        code.split('').forEach((char, index) => { if (digits[index]) digits[index].value = char; });
        closeInbox();
        showError('');
        digits[Math.min(code.length, DIGITS - 1)].focus();
      };
    });
  }

  function closeInbox() {
    const box = document.getElementById('nc-mail-inbox');
    if (!box) return;
    box.classList.remove('show');
    box.hidden = true;
  }

  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, char => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[char]));
  }

  function peekCode(nick) {
    const record = readJSON(CODES_KEY, {})[String(nick || '').toLowerCase()];
    return record && record.code ? record.code : '';
  }

  window.NCMail = {
    TTL_MS,
    COOLDOWN_MS,
    MAX_ATTEMPTS,
    isEmail,
    normalizeEmail,
    endpoint,
    send,
    verify,
    start,
    close: closeModal,
    openInbox,
    closeInbox,
    peekCode
  };
})();
