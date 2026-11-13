/*
 * NOCTURNE — доступ персонала.
 *
 * Владелец входит по паролю, создаёт одноразовые ключи для сотрудников.
 * Сотрудник вводит ключ в этой же админ-панели и получает только те разделы,
 * которые разрешены его роли.
 *
 * ВАЖНО: это локальное демо. Ключи, сессии и проверка прав выполняются в браузере
 * (localStorage), поэтому ограничения интерфейса можно обойти через консоль, а ключ
 * из браузера владельца не сработает на другом устройстве. Для настоящей защиты
 * нужен backend: общая база, серверная проверка ключа и прав на каждом запросе.
 */
(function () {
  'use strict';

  var OWNER_PASSWORD = 'qwerty123123';
  var SESSION_STORAGE = 'nc_staff_session';
  var KEYS_STORAGE = 'nc_staff_keys';
  var CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

  /* ------------------------------------------------------------------ роли */

  var ROLES = {
    owner: { label: 'Владелец', symbol: '♛', rank: 5, color: '#f2cc84', bg: '#473719', line: '#a07944' },
    senior_admin: { label: 'Старший админ', symbol: '★', rank: 4, color: '#ffb08a', bg: '#46281d', line: '#a05a3c' },
    admin: { label: 'Админ', symbol: '◆', rank: 3, color: '#d3b0ff', bg: '#3a2450', line: '#775397' },
    moderator: { label: 'Модератор', symbol: '●', rank: 2, color: '#8fe9c3', bg: '#1c3b32', line: '#3f8f74' },
    junior_moderator: { label: 'Младший модератор', symbol: '○', rank: 1, color: '#9cc2ff', bg: '#1e2c44', line: '#4a6c9c' }
  };

  var ROLE_ORDER = ['junior_moderator', 'moderator', 'admin', 'senior_admin', 'owner'];

  var PERMISSIONS = [
    { id: 'support.view', label: 'Видеть тикеты поддержки' },
    { id: 'support.reply', label: 'Отвечать на тикеты' },
    { id: 'chat.view', label: 'Видеть чат' },
    { id: 'chat.delete', label: 'Удалять сообщения в чате' },
    { id: 'players.view', label: 'Смотреть список игроков' },
    { id: 'players.edit', label: 'Менять игроков: баланс, пароль, блокировка, подписка' },
    { id: 'keys.view', label: 'Смотреть ключи подписок' },
    { id: 'keys.generate', label: 'Создавать ключи подписок' },
    { id: 'keys.revoke', label: 'Отключать и удалять ключи подписок' },
    { id: 'promos.manage', label: 'Управлять промокодами' },
    { id: 'subs.mass', label: 'Массовые операции с подписками' },
    { id: 'server.manage', label: 'Включать и отключать сервер' },
    { id: 'logs.view', label: 'Смотреть журнал действий' },
    { id: 'logs.clear', label: 'Очищать журнал действий' },
    { id: 'system.backup', label: 'Резервные копии и экспорт' },
    { id: 'staff.view', label: 'Видеть сотрудников и их права' },
    { id: 'staff.issue', label: 'Создавать ключи сотрудников' },
    { id: 'staff.revoke', label: 'Отзывать ключи сотрудников' }
  ];

  var PERMISSION_LABELS = {};
  PERMISSIONS.forEach(function (p) { PERMISSION_LABELS[p.id] = p.label; });

  var ROLE_PERMISSIONS = {
    junior_moderator: ['support.view', 'support.reply'],
    moderator: ['support.view', 'support.reply', 'chat.view', 'chat.delete', 'players.view'],
    admin: [
      'support.view', 'support.reply', 'chat.view', 'chat.delete', 'players.view', 'players.edit',
      'keys.view', 'keys.generate', 'keys.revoke', 'promos.manage', 'logs.view', 'staff.view'
    ],
    senior_admin: [
      'support.view', 'support.reply', 'chat.view', 'chat.delete', 'players.view', 'players.edit',
      'keys.view', 'keys.generate', 'keys.revoke', 'promos.manage', 'logs.view', 'logs.clear',
      'system.backup', 'staff.view', 'staff.issue', 'staff.revoke', 'subs.mass', 'server.manage'
    ],
    owner: PERMISSIONS.map(function (p) { return p.id; })
  };

  // Кому какие роли можно выдавать ключом. Владельца ключом выдать нельзя.
  var ISSUE_LIMITS = {
    owner: ['junior_moderator', 'moderator', 'admin', 'senior_admin'],
    senior_admin: ['junior_moderator', 'moderator'],
    admin: [],
    moderator: [],
    junior_moderator: []
  };

  /* -------------------------------------------------------- локальное хранилище */

  var memoryStore = new Map();

  function storeGet(key) {
    try { return window.localStorage.getItem(key); }
    catch (e) { return memoryStore.has(key) ? memoryStore.get(key) : null; }
  }

  function storeSet(key, value) {
    try { window.localStorage.setItem(key, value); }
    catch (e) { memoryStore.set(key, value); }
  }

  function storeRemove(key) {
    try { window.localStorage.removeItem(key); }
    catch (e) { memoryStore.delete(key); }
  }

  function readKeys() {
    try {
      var list = JSON.parse(storeGet(KEYS_STORAGE) || '[]');
      if (!Array.isArray(list)) return [];
      return list.filter(function (k) { return k && typeof k.code === 'string'; });
    } catch (e) { return []; }
  }

  function writeKeys(list) {
    try { storeSet(KEYS_STORAGE, JSON.stringify(list)); } catch (e) { /* ignore */ }
  }

  function readSession() {
    var raw = storeGet(SESSION_STORAGE);
    if (!raw) return null;
    var session;
    try { session = JSON.parse(raw); } catch (e) { storeRemove(SESSION_STORAGE); return null; }
    if (!session || typeof session !== 'object') { storeRemove(SESSION_STORAGE); return null; }
    if (session.kind === 'owner' || session.role === 'owner') {
      return { kind: 'owner', role: 'owner', name: 'Владелец', loginAt: Number(session.loginAt) || 0 };
    }
    var key = readKeys().filter(function (k) { return k.code === session.keyCode; })[0];
    if (!key || key.revoked) { storeRemove(SESSION_STORAGE); return null; }
    return {
      kind: 'staff',
      role: key.role,
      name: String(key.usedBy || session.name || 'Сотрудник'),
      keyCode: key.code,
      loginAt: Number(session.loginAt) || 0
    };
  }

  function writeSession(session) {
    if (session) storeSet(SESSION_STORAGE, JSON.stringify(session));
    else storeRemove(SESSION_STORAGE);
  }

  /* ------------------------------------------------------------ права ролей */

  function roleLabel(role) {
    return ROLES[role] ? ROLES[role].label : 'Сотрудник';
  }

  function hasPerm(session, perm) {
    if (!session) return false;
    var list = ROLE_PERMISSIONS[session.role] || [];
    return list.indexOf(perm) !== -1;
  }

  function staffCan(perm) {
    var session = readSession();
    if (!session) return false;
    return hasPerm(session, perm);
  }

  function staffCurrentActor() {
    var session = readSession();
    if (!session) return 'Не авторизован';
    return session.name + ' · ' + roleLabel(session.role);
  }

  function issueRoles(role) {
    return (ISSUE_LIMITS[role] || []).slice();
  }

  function canManageKey(key, session) {
    if (!session) return false;
    if (session.role === 'owner') return true;
    if (session.role === 'senior_admin') {
      return key.role === 'junior_moderator' || key.role === 'moderator';
    }
    return false;
  }

  /* --------------------------------------------------------------- утилиты */

  function escHtml(value) {
    if (typeof window.esc === 'function') return window.esc(value);
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function logAction(action, details) {
    try {
      if (typeof window.logAdminAction === 'function') window.logAdminAction(action, details);
    } catch (e) { /* журнал не должен ломать действие */ }
  }

  function toast(text, type, title) {
    try {
      if (typeof window.notify === 'function') window.notify(text, type || 'success', title);
    } catch (e) { /* ignore */ }
  }

  function canon(value) {
    return String(value == null ? '' : value).toUpperCase().replace(/[^A-Z0-9]/g, '');
  }

  function formatDate(ts) {
    if (!ts) return '—';
    try {
      return new Date(ts).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
    } catch (e) { return '—'; }
  }

  function randomBlock() {
    var bytes = new Uint8Array(4);
    if (window.crypto && typeof window.crypto.getRandomValues === 'function') {
      window.crypto.getRandomValues(bytes);
    } else {
      for (var i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
    }
    return Array.prototype.map.call(bytes, function (b) {
      return CODE_ALPHABET[b % CODE_ALPHABET.length];
    }).join('');
  }

  function newKeyCode(existing) {
    var code;
    var tries = 0;
    do {
      code = 'STF-' + randomBlock() + '-' + randomBlock();
      tries++;
    } while (existing.some(function (k) { return k.code === code; }) && tries < 100);
    return code;
  }

  /* ---------------------------------------------------------- экран входа */

  var lockEl = null;

  function buildLock() {
    var lock = document.createElement('div');
    lock.className = 'staff-lock';
    lock.id = 'staff-lock';
    lock.innerHTML = [
      '<div class="staff-lock-box">',
      '  <div class="staff-lock-brand">NOCTURNE <span>· ADMIN</span></div>',
      '  <p class="staff-lock-sub">Вход для владельца и сотрудников</p>',
      '  <div class="staff-tabs" role="tablist">',
      '    <button type="button" class="active" data-staff-tab="staff" role="tab" aria-selected="true">Сотрудник</button>',
      '    <button type="button" data-staff-tab="owner" role="tab" aria-selected="false">Владелец</button>',
      '  </div>',
      '  <form id="staff-form-staff" novalidate>',
      '    <label for="staff-key">Ключ доступа</label>',
      '    <input id="staff-key" name="staff-key" autocomplete="off" spellcheck="false" placeholder="STF-XXXX-XXXX" maxlength="24">',
      '    <label for="staff-name">Имя <span style="color:#7e6b8b">(при первой активации)</span></label>',
      '    <input id="staff-name" name="staff-name" autocomplete="off" placeholder="Как вас зовут" maxlength="24">',
      '    <button type="submit">Войти по ключу</button>',
      '  </form>',
      '  <form id="staff-form-owner" novalidate hidden>',
      '    <label for="staff-pass">Пароль владельца</label>',
      '    <input id="staff-pass" type="password" autocomplete="current-password" placeholder="Пароль">',
      '    <button type="submit">Войти как владелец</button>',
      '  </form>',
      '  <p class="staff-lock-msg" id="staff-lock-msg" role="alert"></p>',
      '  <p class="staff-lock-hint">Ключи создаёт владелец в разделе «Сотрудники и доступы». Ключ действует до отзыва.</p>',
      '  <a class="staff-lock-site" href="index.html">← Вернуться на сайт</a>',
      '</div>'
    ].join('');

    lock.addEventListener('click', function (event) {
      var tab = event.target.closest('[data-staff-tab]');
      if (!tab) return;
      setLockTab(tab.getAttribute('data-staff-tab'));
    });

    lock.querySelector('#staff-form-staff').addEventListener('submit', function (event) {
      event.preventDefault();
      var error = loginStaff(lock.querySelector('#staff-key').value, lock.querySelector('#staff-name').value);
      if (error) { setLockMessage(error); return; }
      finishLogin();
    });

    lock.querySelector('#staff-form-owner').addEventListener('submit', function (event) {
      event.preventDefault();
      var pass = lock.querySelector('#staff-pass').value;
      if (pass !== OWNER_PASSWORD) {
        setLockMessage('Неверный пароль владельца.');
        return;
      }
      writeSession({ kind: 'owner', role: 'owner', name: 'Владелец', loginAt: Date.now() });
      finishLogin();
    });

    return lock;
  }

  function setLockTab(name) {
    if (!lockEl) return;
    lockEl.querySelectorAll('[data-staff-tab]').forEach(function (button) {
      var active = button.getAttribute('data-staff-tab') === name;
      button.classList.toggle('active', active);
      button.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    lockEl.querySelector('#staff-form-staff').hidden = name !== 'staff';
    lockEl.querySelector('#staff-form-owner').hidden = name !== 'owner';
    setLockMessage('');
    var input = lockEl.querySelector(name === 'staff' ? '#staff-key' : '#staff-pass');
    if (input) input.focus();
  }

  function setLockMessage(text) {
    if (!lockEl) return;
    var msg = lockEl.querySelector('#staff-lock-msg');
    if (msg) {
      msg.textContent = text || '';
      msg.classList.remove('ok');
    }
  }

  function showLock(message) {
    if (!lockEl) {
      lockEl = buildLock();
      document.body.appendChild(lockEl);
      var keyInput = lockEl.querySelector('#staff-key');
      if (keyInput) setTimeout(function () { keyInput.focus(); }, 60);
    }
    document.body.classList.add('staff-locked');
    if (message) setLockMessage(message);
  }

  function hideLock() {
    document.body.classList.remove('staff-locked');
    if (!lockEl) return;
    var el = lockEl;
    lockEl = null;
    if (typeof window.closeAdminLock === 'function') {
      try { window.closeAdminLock(el); return; } catch (e) { /* fallback below */ }
    }
    el.remove();
  }

  function loginStaff(rawCode, rawName) {
    var code = canon(rawCode);
    if (!code) return 'Введите ключ доступа.';
    var keys = readKeys();
    var key = keys.filter(function (k) { return canon(k.code) === code; })[0];
    if (!key) return 'Ключ не найден. Проверьте, нет ли опечатки.';
    if (key.revoked) return 'Этот ключ отозван владельцем.';
    var name = String(key.usedBy || '').trim();
    if (!name) {
      name = String(rawName || '').trim().slice(0, 24);
      if (name.length < 2) return 'Ключ ещё не активирован. Введите имя — оно привяжется к ключу.';
      key.usedBy = name;
      key.activatedAt = Date.now();
      writeKeys(keys);
      logAction('Активация ключа сотрудника', name + ' · ' + roleLabel(key.role) + ' · ' + key.code);
      toast('Ключ привязан к имени ' + name + '.', 'success', 'Ключ активирован');
    }
    writeSession({ kind: 'staff', role: key.role, name: name, keyCode: key.code, loginAt: Date.now() });
    return '';
  }

  function finishLogin() {
    var session = readSession();
    if (!session) { showLock('Не удалось открыть сессию. Попробуйте ещё раз.'); return; }
    hideLock();
    renderIdentity();
    applyPermissions();
    try {
      if (typeof window.adminExtras === 'function') window.adminExtras();
    } catch (e) { /* ignore */ }
    applyPermissions();
    logAction('Вход в панель', session.name + ' · ' + roleLabel(session.role));
    toast('Вы вошли как ' + session.name + ' (' + roleLabel(session.role) + ').', 'success', 'Доступ открыт');
  }

  /* ---------------------------------------------------- карточка вошедшего */

  function ensureIdentity() {
    var bar = document.getElementById('staff-identity');
    if (bar) return bar;
    var heading = document.querySelector('main h1');
    if (!heading) return null;
    bar = document.createElement('div');
    bar.id = 'staff-identity';
    bar.innerHTML = [
      '<span class="staff-id-symbol" id="staff-id-symbol" aria-hidden="true">◆</span>',
      '<div class="staff-id-text"><span>Вы вошли как</span><strong id="staff-id-name">—</strong></div>',
      '<span class="staff-id-role" id="staff-id-role">—</span>',
      '<span class="staff-id-key" id="staff-id-key"></span>',
      '<button type="button" id="staff-logout">Сменить пользователя</button>'
    ].join('');
    heading.insertAdjacentElement('afterend', bar);
    bar.querySelector('#staff-logout').addEventListener('click', function () {
      if (window.confirm('Выйти из панели? Ключ или пароль понадобится снова.')) {
        writeSession(null);
        window.location.reload();
      }
    });
    return bar;
  }

  function renderIdentity() {
    var session = readSession();
    var bar = ensureIdentity();
    if (!bar || !session) return;
    var role = ROLES[session.role] || ROLES.junior_moderator;
    bar.style.setProperty('--staff-color', role.color);
    bar.style.setProperty('--staff-bg', role.bg);
    bar.style.setProperty('--staff-line', role.line);
    var symbol = bar.querySelector('#staff-id-symbol');
    var name = bar.querySelector('#staff-id-name');
    var badge = bar.querySelector('#staff-id-role');
    var key = bar.querySelector('#staff-id-key');
    if (symbol) symbol.textContent = role.symbol;
    if (name) name.textContent = session.name;
    if (badge) badge.textContent = role.label;
    if (key) key.textContent = session.kind === 'owner' ? 'по паролю владельца' : session.keyCode;
  }

  /* ------------------------------------------------------------- применение прав */

  function applyPermissions() {
    var session = readSession();

    document.querySelectorAll('[data-staff-perm]').forEach(function (el) {
      var perm = el.getAttribute('data-staff-perm');
      el.hidden = !hasPerm(session, perm);
    });

    document.querySelectorAll('[data-chat-del]').forEach(function (button) {
      button.hidden = !hasPerm(session, 'chat.delete');
    });

    renderStaffPanel();

    if (!session && !lockEl) showLock('');
  }

  /* ------------------------------------------------------- панель сотрудников */

  var lastCreatedCode = '';
  var staffPanelBound = false;

  function ensureStaffPanel() {
    var session = readSession();
    var panel = document.getElementById('staff-panel');
    if (!session) {
      if (panel) panel.remove();
      return null;
    }
    if (!panel) {
      panel = document.createElement('div');
      panel.id = 'staff-panel';
      panel.className = 'panel staff-panel';
      panel.setAttribute('data-staff-perm', 'staff.view');
      var identity = ensureIdentity();
      if (identity && identity.parentNode) identity.insertAdjacentElement('afterend', panel);
      else document.querySelector('main').appendChild(panel);
    }
    if (!staffPanelBound) {
      staffPanelBound = true;
      panel.addEventListener('click', onStaffPanelClick);
      panel.addEventListener('submit', onStaffPanelSubmit);
    }
    return panel;
  }

  function statusOf(key) {
    if (key.revoked) return { label: 'Отозван', cls: 'revoked' };
    if (key.usedBy) return { label: 'Активен', cls: 'active' };
    return { label: 'Не активирован', cls: 'new' };
  }

  function roleOptions(role) {
    return issueRoles(role).map(function (id) {
      return '<option value="' + id + '">' + escHtml(ROLES[id].label) + '</option>';
    }).join('');
  }

  function renderStaffPanel() {
    var panel = ensureStaffPanel();
    if (!panel) return;
    var session = readSession();
    if (!session) return;

    var canIssue = hasPerm(session, 'staff.issue');
    var canRevoke = hasPerm(session, 'staff.revoke');
    var keys = readKeys().slice().sort(function (a, b) { return (b.createdAt || 0) - (a.createdAt || 0); });

    var rows = keys.map(function (key) {
      var role = ROLES[key.role] || ROLES.junior_moderator;
      var status = statusOf(key);
      var visible = canManageKey(key, session);
      var codeHtml = visible
        ? '<span class="staff-code">' + escHtml(key.code) + '</span>'
        : '<span class="staff-code masked">STF-••••-••••</span>';
      var actions = [];
      if (visible) actions.push('<button type="button" data-staff-copy="' + escHtml(key.code) + '">Копировать</button>');
      if (canRevoke && visible && !key.revoked) {
        actions.push('<button type="button" class="danger" data-staff-revoke="' + escHtml(key.code) + '">Отозвать</button>');
      }
      return [
        '<tr>',
        '<td>' + codeHtml + '</td>',
        '<td><span class="staff-id-role" style="--staff-color:' + role.color + ';--staff-bg:' + role.bg + ';--staff-line:' + role.line + '">' + escHtml(role.label) + '</span></td>',
        '<td>' + (key.usedBy ? escHtml(key.usedBy) : '<span class="staff-muted">—</span>') + '</td>',
        '<td>' + escHtml(key.note || '—') + '</td>',
        '<td>' + escHtml(formatDate(key.createdAt)) + '</td>',
        '<td><span class="staff-status ' + status.cls + '">' + status.label + '</span></td>',
        '<td><div class="staff-actions">' + (actions.join('') || '<span class="staff-muted">—</span>') + '</div></td>',
        '</tr>'
      ].join('');
    }).join('');

    var matrixRows = PERMISSIONS.map(function (perm) {
      var cells = ROLE_ORDER.map(function (role) {
        var allowed = (ROLE_PERMISSIONS[role] || []).indexOf(perm.id) !== -1;
        return '<td class="' + (allowed ? 'yes' : 'no') + '">' + (allowed ? '✓' : '—') + '</td>';
      }).join('');
      return '<tr><td>' + escHtml(perm.label) + '</td>' + cells + '</tr>';
    }).join('');

    var matrixHead = ROLE_ORDER.map(function (role) {
      return '<th>' + escHtml(ROLES[role].label) + '</th>';
    }).join('');

    var createForm = canIssue
      ? [
        '<form id="staff-create-form" class="staff-create" autocomplete="off">',
        '  <div class="staff-field"><label for="staff-role">Роль ключа</label><select id="staff-role" name="role">' + roleOptions(session.role) + '</select></div>',
        '  <div class="staff-field"><label for="staff-note">Кому выдаём / заметка</label><input id="staff-note" name="note" maxlength="48" placeholder="Например: Алекс — тикеты"></div>',
        '  <button type="submit">Создать ключ</button>',
        '</form>'
      ].join('')
      : '<p class="staff-muted">Ваша роль может смотреть сотрудников, но не выдавать ключи. Ключи создаёт владелец или старший админ.</p>';

    var reveal = lastCreatedCode
      ? '<div class="staff-newkey" id="staff-newkey"><span>Новый ключ:</span><code>' + escHtml(lastCreatedCode) + '</code>' +
        '<button type="button" data-staff-copy="' + escHtml(lastCreatedCode) + '">Скопировать</button>' +
        '<span class="staff-muted">Передайте его сотруднику. После первого входа ключ привяжется к имени.</span></div>'
      : '';

    panel.innerHTML = [
      '<div class="staff-panel-heading">',
      '  <div><h2>Сотрудники и доступы</h2>',
      '  <p>Ключ выдаёт доступ к панели с правами выбранной роли. Владелец — только вы, по паролю.</p></div>',
      '  <span class="role-count">' + keys.length + ' ключей · ' + (keys.filter(function (k) { return !k.revoked; }).length) + ' активных</span>',
      '</div>',
      '<p class="staff-warning"><b>Демо-режим.</b> Ключи и сессии хранятся в localStorage этого браузера. Ключ, созданный здесь, сработает только в этом браузере; чтобы сотрудник вошёл со своего устройства, позже подключим общий сервер. Ограничения панели не заменяют серверную проверку прав.</p>',
      createForm,
      reveal,
      '<div class="staff-table-wrap"><table class="staff-table">',
      '<thead><tr><th>Ключ</th><th>Роль</th><th>Сотрудник</th><th>Заметка</th><th>Создан</th><th>Статус</th><th>Действия</th></tr></thead>',
      '<tbody>' + (rows || '<tr><td colspan="7" class="staff-muted">Ключей пока нет. Создайте первый ключ для младшего модератора.</td></tr>') + '</tbody>',
      '</table></div>',
      '<h2 style="margin:26px 0 8px;font-size:16px">Матрица прав</h2>',
      '<p class="staff-muted" style="margin:0 0 10px">Что доступно каждой роли в панели.</p>',
      '<div class="staff-matrix-wrap"><table class="staff-matrix">',
      '<thead><tr><th>Возможность</th>' + matrixHead + '</tr></thead>',
      '<tbody>' + matrixRows + '</tbody>',
      '</table></div>'
    ].join('');
  }

  function onStaffPanelSubmit(event) {
    if (!event.target || event.target.id !== 'staff-create-form') return;
    event.preventDefault();
    var roleSelect = event.target.querySelector('#staff-role');
    var noteInput = event.target.querySelector('#staff-note');
    if (!roleSelect) return;
    createStaffKey(roleSelect.value, noteInput ? noteInput.value : '');
  }

  function onStaffPanelClick(event) {
    var copy = event.target.closest('[data-staff-copy]');
    if (copy) {
      var code = copy.getAttribute('data-staff-copy');
      if (typeof window.copyText === 'function') window.copyText(code, 'Ключ скопирован');
      else if (navigator.clipboard) navigator.clipboard.writeText(code).catch(function () {});
      return;
    }
    var revoke = event.target.closest('[data-staff-revoke]');
    if (revoke) askRevokeKey(revoke.getAttribute('data-staff-revoke'));
  }

  function createStaffKey(role, note) {
    var session = readSession();
    if (!session || !hasPerm(session, 'staff.issue')) {
      deny('staff.issue');
      return;
    }
    if (!ROLES[role] || issueRoles(session.role).indexOf(role) === -1) {
      toast('Ваша роль не может выдать такой ключ.', 'error', 'Недостаточно прав');
      return;
    }
    var keys = readKeys();
    var key = {
      code: newKeyCode(keys),
      role: role,
      note: String(note || '').trim().slice(0, 48),
      createdBy: session.name,
      createdByRole: session.role,
      createdAt: Date.now(),
      usedBy: '',
      activatedAt: 0,
      revoked: false
    };
    keys.push(key);
    writeKeys(keys);
    lastCreatedCode = key.code;
    renderStaffPanel();
    logAction('Создание ключа сотрудника', roleLabel(role) + ' · ' + key.code + (key.note ? ' · ' + key.note : ''));
    toast(key.code + '\nРоль: ' + roleLabel(role), 'success', 'Ключ сотрудника создан');
  }

  function askRevokeKey(code) {
    var session = readSession();
    var key = readKeys().filter(function (k) { return k.code === code; })[0];
    if (!session || !key || !canManageKey(key, session)) {
      toast('Этим ключом управляет владелец или старший админ.', 'error', 'Недостаточно прав');
      return;
    }
    var description = roleLabel(key.role) + (key.usedBy ? ' · ' + key.usedBy : ' · ключ ещё не активирован');
    if (typeof window.openAdminAction !== 'function') {
      if (window.confirm('Отозвать ключ ' + code + '? Сотрудник больше не сможет войти.')) revokeKey(code);
      return;
    }
    window.openAdminAction({
      title: 'Отозвать ключ сотрудника',
      description: description,
      symbol: '⛔',
      submitLabel: 'Отозвать ключ',
      html: '<p style="font-size:12px;line-height:1.8;color:#d3bce4;margin:0">Ключ <b>' + escHtml(code) + '</b> перестанет действовать сразу. ' +
        (key.usedBy ? 'Сотрудник <b>' + escHtml(key.usedBy) + '</b> потеряет доступ.' : 'Ключ ещё никто не активировал.') + '</p>',
      onSubmit: function () {
        revokeKey(code);
        return true;
      }
    });
  }

  function revokeKey(code) {
    var session = readSession();
    var keys = readKeys();
    var key = keys.filter(function (k) { return k.code === code; })[0];
    if (!key || !session || !canManageKey(key, session)) return;
    key.revoked = true;
    key.revokedAt = Date.now();
    key.revokedBy = session.name;
    writeKeys(keys);
    renderStaffPanel();
    logAction('Отзыв ключа сотрудника', roleLabel(key.role) + ' · ' + code + (key.usedBy ? ' · ' + key.usedBy : ''));
    toast('Ключ ' + code + ' отозван. Вход по нему закрыт.', 'info', 'Доступ закрыт');
    if (session.kind === 'staff' && session.keyCode === code) {
      writeSession(null);
      window.location.reload();
    }
  }

  /* --------------------------------------------------------------- чат */

  function deleteChatMessage(index) {
    if (!staffCan('chat.delete')) {
      deny('chat.delete');
      return;
    }
    var storage = null;
    try { storage = typeof adminStorage !== 'undefined' ? adminStorage : null; } catch (e) { storage = null; }
    var list;
    try { list = JSON.parse((storage ? storage.getItem('nc_chat') : storeGet('nc_chat')) || '[]'); }
    catch (e) { list = []; }
    if (!Array.isArray(list) || !list[index]) return;
    var removed = list.splice(index, 1)[0];
    try {
      if (storage) storage.setItem('nc_chat', JSON.stringify(list));
      else storeSet('nc_chat', JSON.stringify(list));
    } catch (e) { /* ignore */ }
    if (typeof window.adminExtras === 'function') window.adminExtras();
    applyPermissions();
    logAction('Модерация чата', 'Удалено сообщение ' + removed.nick + ': ' + String(removed.text || '').slice(0, 80));
    toast('Сообщение удалено из чата.', 'info', 'Чат');
  }

  document.addEventListener('click', function (event) {
    var button = event.target.closest('[data-chat-del]');
    if (!button) return;
    deleteChatMessage(Number(button.getAttribute('data-chat-del')));
  });

  /* ------------------------------------------------------- защита действий */

  function deny(perm) {
    var label = PERMISSION_LABELS[perm] || 'это действие';
    toast('Ваша роль не позволяет: ' + label.toLowerCase() + '.', 'error', 'Недостаточно прав');
    return false;
  }

  var GUARDED = {
    generateKey: 'keys.generate',
    disableKey: 'keys.revoke',
    deleteKey: 'keys.revoke',
    clearUsedKeys: 'keys.revoke',
    createPromo: 'promos.manage',
    deletePromo: 'promos.manage',
    togglePromoStatus: 'promos.manage',
    addPromoUses: 'promos.manage',
    clearExpiredPromos: 'promos.manage',
    toggleServer: 'server.manage',
    money: 'players.edit',
    pass: 'players.edit',
    block: 'players.edit',
    hwid: 'players.edit',
    grantSub: 'players.edit',
    removeSub: 'players.edit',
    executeEmergencyReissue: 'subs.mass',
    confirmResetAllSubs: 'subs.mass',
    replySupport: 'support.reply',
    exportBackup: 'system.backup',
    exportPlayersCSV: 'system.backup',
    clearAdminLogs: 'logs.clear'
  };

  function installGuards() {
    Object.keys(GUARDED).forEach(function (name) {
      var original = window[name];
      if (typeof original !== 'function') return;
      window[name] = function () {
        if (!staffCan(GUARDED[name])) return deny(GUARDED[name]);
        return original.apply(this, arguments);
      };
    });
  }

  /* ------------------------------------------------------------ инициализация */

  function refreshSessionUI() {
    var session = readSession();
    if (!session) {
      window.location.reload();
      return;
    }
    renderIdentity();
    applyPermissions();
    try {
      if (typeof window.adminExtras === 'function') window.adminExtras();
    } catch (e) { /* ignore */ }
    applyPermissions();
  }

  function boot() {
    installGuards();
    ensureIdentity();
    var session = readSession();
    if (session) {
      hideLock();
      renderIdentity();
      applyPermissions();
      try {
        if (typeof window.adminExtras === 'function') window.adminExtras();
      } catch (e) { /* ignore */ }
      applyPermissions();
    } else {
      ensureIdentity();
      applyPermissions();
      showLock('');
    }
  }

  // Публичный минимум для основного скрипта панели и inline-обработчиков.
  window.staffCan = staffCan;
  window.staffCurrentActor = staffCurrentActor;
  window.staffDeleteChat = deleteChatMessage;
  window.staffLogout = function () {
    writeSession(null);
    window.location.reload();
  };

  window.addEventListener('storage', function (event) {
    if (event.key !== KEYS_STORAGE && event.key !== SESSION_STORAGE) return;
    var session = readSession();
    if (!session) { window.location.reload(); return; }
    refreshSessionUI();
  });

  boot();
})();
