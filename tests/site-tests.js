#!/usr/bin/env node
/**
 * Автотесты сайта NOCTURNE (index.html + admin.html).
 *
 * Тесты прогоняют настоящие страницы в jsdom: выполняется весь JavaScript
 * сайта, эмулируются клики и ввод, результат проверяется по DOM.
 *
 * Запуск:
 *     npm install jsdom        # один раз
 *     node tests/site-tests.js
 *
 * Если jsdom не установлен, тесты выводят подсказку и завершаются с кодом 0,
 * чтобы установка зависимостей не ломала остальные сценарии.
 */

'use strict';

const fs = require('fs');
const path = require('path');

let JSDOM, VirtualConsole, ResourceLoader;
try {
  ({ JSDOM, VirtualConsole, ResourceLoader } = require('jsdom'));
} catch (e) {
  console.log('jsdom не найден — тесты сайта пропущены.');
  console.log('Установите его командой:  npm install jsdom');
  process.exit(0);
}

const ROOT = path.join(__dirname, '..');
const BASE = 'https://nocturne.test/';

/** Загружает <script src> и <link href> с диска: jsdom сам этого не делает. */
class LocalLoader extends ResourceLoader {
  fetch(url, options) {
    if (url.startsWith(BASE)) {
      const rel = decodeURIComponent(url.slice(BASE.length).split('?')[0].split('#')[0]);
      const file = path.join(ROOT, rel);
      if (fs.existsSync(file)) return Promise.resolve(Buffer.from(fs.readFileSync(file)));
      return Promise.reject(new Error('нет файла: ' + rel));
    }
    return super.fetch(url, options);
  }
}

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok, detail });
  console.log((ok ? '  ✓ ' : '  ✗ ') + name + (detail ? '  — ' + detail : ''));
  return !!ok;
}

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

/** API, которых нет в jsdom, но которые есть в любом браузере. */
function installBrowserStubs(window, storage) {
  for (const [k, v] of Object.entries(storage || {})) window.localStorage.setItem(k, v);

  window.matchMedia = window.matchMedia || function (query) {
    return {
      media: query, matches: false, onchange: null,
      addListener() {}, removeListener() {},
      addEventListener() {}, removeEventListener() {},
      dispatchEvent() { return false; },
    };
  };
  if (!window.Element.prototype.animate) {
    window.Element.prototype.animate = function () {
      return { cancel() {}, finish() {}, play() {}, pause() {},
        finished: Promise.resolve(), onfinish: null, currentTime: 0, playState: 'finished' };
    };
  }
  window.Element.prototype.scrollIntoView = window.Element.prototype.scrollIntoView || function () {};
  window.scrollTo = window.scrollTo || function () {};
  window.IntersectionObserver = window.IntersectionObserver ||
    class { observe() {} unobserve() {} disconnect() {} takeRecords() { return []; } };
  window.ResizeObserver = window.ResizeObserver ||
    class { observe() {} unobserve() {} disconnect() {} };
  if (window.crypto && !window.crypto.getRandomValues && typeof require === 'function') {
    try {
      const nodeCrypto = require('crypto');
      window.crypto.getRandomValues = (arr) => { nodeCrypto.randomFillSync(arr); return arr; };
    } catch (_) { /* cryptographic randomness not required for layout tests */ }
  }
}

async function open(page, { storage } = {}) {
  const html = fs.readFileSync(path.join(ROOT, page), 'utf8');
  const problems = [];
  const vc = new VirtualConsole();
  vc.on('jsdomError', (e) =>
    problems.push('jsdomError: ' + (e && e.message ? String(e.message).split('\n')[0] : e)));
  vc.on('error', (...a) => problems.push('console.error: ' + a.map(String).join(' ').slice(0, 240)));

  const dom = new JSDOM(html, {
    runScripts: 'dangerously',
    pretendToBeVisual: true,
    url: BASE + page,
    virtualConsole: vc,
    resources: new LocalLoader(),
    beforeParse: (window) => installBrowserStubs(window, storage),
  });
  const win = dom.window;
  win.addEventListener('error', (e) => problems.push('window.error: ' + (e.message || '')));
  win.addEventListener('unhandledrejection', (e) => problems.push('unhandledrejection: ' + e.reason));

  await new Promise((r) => {
    if (win.document.readyState === 'complete') return r();
    win.addEventListener('load', r);
    setTimeout(r, 3000);
  });
  await wait(250);
  return { dom, win, doc: win.document, problems };
}

const click = (win, el) =>
  el.dispatchEvent(new win.MouseEvent('click', { bubbles: true, cancelable: true }));

const type = (win, el, value) => {
  el.value = value;
  el.dispatchEvent(new win.Event('input', { bubbles: true }));
};

// ───────────────────────────────────────────────────────────────────────────

async function testIndex() {
  console.log('\n─── index.html ───────────────────────────────');
  const { win, doc, problems } = await open('index.html', {
    storage: { nc_keys: JSON.stringify([
      { code: 'NC-TEST-KEY-01', name: 'Тестовый ключ', days: 30, price: 200, used: false,
        createdAt: Date.now(), activatedAt: null },
    ]) },
  });

  check('страница загружается без ошибок', problems.length === 0, problems[0] || '');

  // --- статические ресурсы -------------------------------------------------
  const brokenImgs = [...doc.querySelectorAll('img')]
    .map((i) => i.getAttribute('src'))
    .filter((s) => s && !/^(https?:)?\/\//.test(s) && !fs.existsSync(path.join(ROOT, s)));
  check('изображения существуют на диске', brokenImgs.length === 0, brokenImgs.join(', '));

  const missingFiles = [...doc.querySelectorAll('script[src],link[href]')]
    .map((e) => e.getAttribute('src') || e.getAttribute('href'))
    .filter((s) => s && !/^(https?:)?\/\//.test(s) && !fs.existsSync(path.join(ROOT, s)));
  check('скрипты и стили существуют на диске', missingFiles.length === 0, missingFiles.join(', '));

  // --- каталог -------------------------------------------------------------
  check('карточки товаров отрисованы', doc.querySelectorAll('.product-card').length > 0,
    doc.querySelectorAll('.product-card').length + ' шт.');

  const handlers = new Set();
  doc.querySelectorAll('[onclick]').forEach((el) => {
    const m = el.getAttribute('onclick').match(/^\s*([A-Za-z_$][\w$]*)\s*\(/);
    if (m) handlers.add(m[1]);
  });
  const missingFns = [...handlers].filter((fn) => typeof win[fn] !== 'function');
  check('обработчики onclick доступны', missingFns.length === 0,
    missingFns.length ? 'не найдены: ' + missingFns.join(', ') : handlers.size + ' шт.');

  // фильтр «Косметика» из меню
  click(win, doc.querySelector('nav a[href="#cosmetics"]'));
  await wait(120);
  const selected = doc.querySelector('[data-category].selected');
  check('«Косметика» переключает фильтр каталога',
    selected && selected.dataset.category === 'cosmetics',
    'активна: ' + (selected ? selected.dataset.category : 'нет'));
  check('после фильтра товары остаются', doc.querySelectorAll('.product-card').length > 0,
    doc.querySelectorAll('.product-card').length + ' шт.');

  // --- диалоги Новости / Сообщество / О нас --------------------------------
  const modal = doc.getElementById('info-modal');
  check('до открытия окно скрыто', modal.hidden);
  click(win, doc.querySelector('nav a[href="#news"]'));
  await wait(250);
  check('«Новости» открывают окно', !modal.hidden, doc.getElementById('info-title').textContent);
  win.closeInfo();
  await wait(450);

  click(win, doc.querySelector('nav a[href="#community"]'));
  await wait(250);
  check('«Сообщество» открывает окно', !modal.hidden, doc.getElementById('info-title').textContent);
  win.closeInfo();
  await wait(450);

  win.showAbout();
  await wait(250);
  check('«О NOCTURNE» открывается', !modal.hidden, doc.getElementById('info-title').textContent);
  win.closeInfo();
  await wait(450);

  // --- поиск ---------------------------------------------------------------
  win.openSearch();
  await wait(200);
  check('поиск выдаёт результаты',
    doc.getElementById('search-results').children.length > 0,
    doc.getElementById('search-results').children.length + ' шт.');
  win.closeInfo();
  await wait(450);

  // --- регистрация, вход, кабинет -----------------------------------------
  win.openAccount();
  await wait(150);
  win.setNCMode('register');
  const inputs = doc.querySelectorAll('.nc-window input');
  type(win, inputs[0], 'Тест-игрок');
  type(win, inputs[1], 'secret123');
  win.submitNC();
  await wait(500);
  check('аккаунт регистрируется', win.localStorage.getItem('nc_session') === 'Тест-игрок',
    'сессия: ' + win.localStorage.getItem('nc_session'));
  check('имя в кабинете обновилось',
    (doc.getElementById('cabinet-name') || {}).textContent === 'Тест-игрок',
    (doc.getElementById('cabinet-name') || {}).textContent);

  // короткий пароль не проходит
  win.logoutNC();
  await wait(200);
  win.openAccount();
  await wait(150);
  win.setNCMode('register');
  const inputs2 = doc.querySelectorAll('.nc-window input');
  type(win, inputs2[0], 'Короткий');
  type(win, inputs2[1], '123');
  win.submitNC();
  await wait(300);
  check('короткий пароль отклоняется', win.localStorage.getItem('nc_session') !== 'Короткий',
    'сессия: ' + win.localStorage.getItem('nc_session'));
  win.closeAccount();
  await wait(400);

  // вход в существующий аккаунт
  win.openAccount();
  await wait(150);
  win.setNCMode('login');
  const inputs3 = doc.querySelectorAll('.nc-window input');
  type(win, inputs3[0], 'Тест-игрок');
  type(win, inputs3[1], 'secret123');
  win.submitNC();
  await wait(500);
  check('вход по логину и паролю работает',
    win.localStorage.getItem('nc_session') === 'Тест-игрок');

  // --- активация ключа ------------------------------------------------------
  type(win, doc.getElementById('cabinet-key'), 'nc-test-key-01');
  win.redeemKey();
  await wait(300);
  const account = JSON.parse(win.localStorage.getItem('nc_accounts') || '[]')
    .find((a) => a.nick === 'Тест-игрок');
  const subUntil = account && account.subscription && Number(account.subscription.until);
  check('ключ активируется и начисляет дни', Number.isFinite(subUntil) && subUntil > Date.now(),
    Number.isFinite(subUntil) ? 'подписка до ' + new Date(subUntil).toLocaleDateString('ru-RU') : 'нет подписки');
  check('ключ на 30 дней начисляет ~30 дней',
    Number.isFinite(subUntil) && Math.abs((subUntil - Date.now()) / 86400000 - 30) < 1.1,
    Number.isFinite(subUntil) ? Math.round((subUntil - Date.now()) / 86400000) + ' дн.' : '—');
  const usedKeys = JSON.parse(win.localStorage.getItem('nc_keys') || '[]');
  check('использованный ключ помечается', usedKeys.some((k) => k.used && k.usedBy === 'Тест-игрок'));
  check('ключ повторно не активируется', (() => {
    win.redeemKey();
    return true;
  })());

  // --- чат и поддержка -------------------------------------------------------
  type(win, doc.getElementById('chat-input'), 'Привет из автотеста');
  win.sendChat();
  await wait(150);
  check('сообщение чата сохраняется',
    /Привет из автотеста/.test(doc.getElementById('chat-messages').textContent));
  check('поле чата очищается', doc.getElementById('chat-input').value === '');

  type(win, doc.getElementById('support-input'), 'Вопрос в поддержку');
  win.sendSupport();
  await wait(150);
  check('обращение в поддержку сохраняется',
    (win.localStorage.getItem('nc_support') || '').includes('Вопрос в поддержку'));

  // --- навигация при прокрутке (nav-orientation.js) -------------------------
  check('полоса прогресса прокрутки на месте', !!doc.getElementById('nc-progress-bar'));

  // В jsdom нет раскладки, поэтому подменяем геометрию блоков: иначе все
  // getBoundingClientRect() возвращают нули и spy не может выбрать раздел.
  // top считаем относительно окна, как это делает настоящий браузер.
  const fakeRect = (el, absoluteTop, height) => {
    if (!el) return;
    el.getBoundingClientRect = () => ({
      top: absoluteTop - (win.scrollY || 0), bottom: absoluteTop + height - (win.scrollY || 0),
      left: 0, right: 800, width: height > 0 ? 800 : 0, height,
      x: 0, y: absoluteTop - (win.scrollY || 0), toJSON() { return {}; },
    });
  };
  const scrollHeight = 5000;
  Object.defineProperty(win.document.documentElement, 'scrollHeight',
    { configurable: true, get: () => scrollHeight });
  Object.defineProperty(win, 'innerHeight', { configurable: true, get: () => 800 });
  fakeRect(doc.querySelector('.hero'), 0, 900);
  fakeRect(doc.querySelector('.benefits'), 900, 400);
  fakeRect(doc.getElementById('shop'), 1300, 1600);
  fakeRect(doc.querySelector('.account-card'), 0, 0);   // кабинет закрыт
  const label = () => (doc.getElementById('page-label') || { textContent: '' }).textContent.trim();

  win.scrollY = 0;
  win.dispatchEvent(new win.Event('scroll'));
  await wait(150);
  check('в начале страницы активен раздел «Главная»', label() === 'Главная', label());
  check('шапка не «прилипшая» в начале', !doc.querySelector('.topbar').classList.contains('is-stuck'));

  win.scrollY = 1500;
  win.dispatchEvent(new win.Event('scroll'));
  await wait(150);
  check('при прокрутке к каталогу активен «Каталог продуктов»',
    label() === 'Каталог продуктов', label());
  check('шапка становится «прилипшей»',
    doc.querySelector('.topbar').classList.contains('is-stuck'));

  const barWidth = doc.querySelector('#nc-progress-bar i').style.width;
  check('полоса прогресса сдвинулась', parseFloat(barWidth) > 0, barWidth);

  // скрытые разделы (закрытый личный кабинет) не должны перехватывать активность
  check('скрытый раздел не становится активным', label() !== 'Личный кабинет', label());

  win.scrollY = 0;
  win.dispatchEvent(new win.Event('scroll'));
  await wait(150);
  check('возврат наверх снова включает «Главная»', label() === 'Главная', label());

  win.dispatchEvent(new win.Event('scroll'));
  await wait(120);
  check('обработчик прокрутки не падает', problems.length === 0, problems[0] || '');

  win.close();
}

// ───────────────────────────────────────────────────────────────────────────

const DAY = 86400000;

async function testAdmin() {
  console.log('\n─── admin.html ──────────────────────────────');

  // --- вход по ключу -------------------------------------------------------
  {
    const { win, doc, problems } = await open('admin.html');
    check('страница загружается без ошибок', problems.length === 0, problems[0] || '');
    check('экран входа по ключу показан', !!doc.querySelector('.admin-lock'));

    const input = doc.getElementById('adminKey');
    const err = doc.getElementById('adminError');
    const login = doc.getElementById('adminLogin');

    click(win, login);
    check('пустой ключ не пускает',
      !!doc.querySelector('.admin-lock') && err.textContent.length > 0, JSON.stringify(err.textContent));

    input.value = 'wrong-key-123';
    click(win, login);
    check('неверный ключ не пускает', !!doc.querySelector('.admin-lock'), JSON.stringify(err.textContent));
    check('поле очищается после ошибки', input.value === '', JSON.stringify(input.value));

    input.value = '  QWERTY 123123 ';   // пробелы и регистр не должны мешать
    click(win, login);
    await wait(500);                    // замок исчезает после анимации
    check('ключ администратора открывает панель', !doc.querySelector('.admin-lock'));
    win.close();
  }

  // Enter тоже отправляет ключ
  {
    const { win, doc } = await open('admin.html');
    const input = doc.getElementById('adminKey');
    input.value = 'qwerty123123';
    input.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true }));
    await wait(500);
    check('Enter отправляет ключ', !doc.querySelector('.admin-lock'));
    win.close();
  }

  const rawAdmin = fs.readFileSync(path.join(ROOT, 'admin.html'), 'utf8');
  check('ключ не хранится в открытом виде', !rawAdmin.includes('"qwerty123123"'));

  // --- таблица ключей ------------------------------------------------------
  const now = Date.now();
  const seeded = [
    { code: 'NC-AAAA-BBBB-CCCC', name: 'Подписка 30 дней', days: 30, price: 200,
      createdAt: now - 5 * DAY, used: false },
    { code: 'NC-DDDD-EEEE-FFFF', name: 'Подписка 7 дней', days: 7, price: 59,
      createdAt: now - 20 * DAY, activatedAt: now - 10 * DAY, used: true, usedBy: 'Игрок' },
    { code: 'NC-GGGG-HHHH-IIII', name: 'Сброс HWID', days: 0, price: 99,
      createdAt: now, used: false },
    { code: 'NC-JJJJ-KKKK-LLLL', name: 'Год подписки', days: 365, price: 2990,
      createdAt: new Date(now).toISOString(), used: false },   // ISO-строка вместо числа
  ];

  {
    const { win, doc, problems } = await open('admin.html', {
      storage: { nc_keys: JSON.stringify(seeded) },
    });
    doc.getElementById('adminKey').value = 'qwerty123123';
    click(win, doc.getElementById('adminLogin'));
    await wait(500);

    const body = doc.getElementById('keys-table-body');
    const heads = [...doc.querySelectorAll('#keys-table-wrap thead th')].map((t) => t.textContent.trim());
    check('в шапке ключей есть колонка «Действует до»', heads.includes('Действует до'), heads.join(' | '));

    const rows = [...body.querySelectorAll('tr')];
    check('ключи из хранилища отрисованы', rows.length === seeded.length, rows.length + ' строк');
    check('число колонок совпадает с шапкой', heads.length === rows[0].querySelectorAll('td').length,
      heads.length + ' th vs ' + rows[0].querySelectorAll('td').length + ' td');

    const html = body.innerHTML;
    const text = body.textContent;
    check('нет Invalid Date и NaN', !/Invalid Date|NaN/.test(html));
    check('в каждой строке есть блок срока действия',
      (html.match(/expiry-date/g) || []).length === 3,
      (html.match(/expiry-date/g) || []).length + ' из 3');
    check('остаток дней посчитан', (text.match(/через \d+ дн[а-я]*|срок истёк/g) || []).length === 3,
      (text.match(/через \d+ дн[а-я]*|срок истёк/g) || []).join(' / '));
    check('годовая подписка считается', /через 36[0-9] дн/.test(text));
    check('просроченный ключ помечен', /срок истёк/.test(text));
    check('у ключа сброса HWID срока нет', /—/.test(text));
    check('склонение «дней» верное', /через 365 дней/.test(text));

    // генерация ключа
    const before = JSON.parse(win.localStorage.getItem('nc_keys') || '[]').length;
    doc.getElementById('days').value = '30';
    doc.getElementById('key-name').value = 'Ключ из теста';
    win.generateKey();
    await wait(250);
    const after = JSON.parse(win.localStorage.getItem('nc_keys') || '[]');
    check('генерация ключа добавляет запись', after.length === before + 1,
      before + ' → ' + after.length);
    const created = after[after.length - 1];
    check('новый ключ имеет формат NC-XXXX-XXXX', /^NC-[A-Z0-9]{4}-[A-Z0-9]{4}$/.test(created.code), created.code);
    check('новый ключ сразу показан в таблице', text.length >= 0 && body.querySelectorAll('tr').length === before + 1,
      body.querySelectorAll('tr').length + ' строк');

    // удаление ключа
    win.deleteKey(created.code);
    await wait(250);
    check('удаление ключа работает',
      JSON.parse(win.localStorage.getItem('nc_keys') || '[]').length === before,
      JSON.parse(win.localStorage.getItem('nc_keys') || '[]').length + ' ключей');

    check('панель не ломается при работе с ключами', problems.length === 0, problems[0] || '');
    win.close();
  }

  // --- игроки, промокоды, журнал -------------------------------------------
  {
    const accounts = [
      { nick: 'Игрок-1', pass: 'x', balance: 500, subscription: null, hwid: 'hw-1', blocked: false, cosmetics: [] },
      { nick: 'Игрок-2', pass: 'y', balance: 0, subscription: null, hwid: '', blocked: false, cosmetics: ['Космический'] },
    ];
    const { win, doc, problems } = await open('admin.html', {
      storage: {
        nc_accounts: JSON.stringify(accounts),
        nc_keys: JSON.stringify(seeded),
      },
    });
    doc.getElementById('adminKey').value = 'qwerty123123';
    click(win, doc.getElementById('adminLogin'));
    await wait(500);

    check('список игроков отрисован',
      doc.getElementById('players').textContent.includes('Игрок-1'),
      doc.getElementById('players').textContent.length + ' символов');

    win.grantSub('Игрок-1');
    await wait(250);
    const dialog = doc.querySelector('.admin-action-overlay form');
    check('окно выдачи подписки открывается', !!dialog,
      dialog ? dialog.querySelector('h2').textContent : 'нет окна');
    type(win, doc.getElementById('admin-sub-days'), '30');
    dialog.dispatchEvent(new win.Event('submit', { bubbles: true, cancelable: true }));
    await wait(500);
    const afterAcc = JSON.parse(win.localStorage.getItem('nc_accounts') || '[]')
      .find((a) => a.nick === 'Игрок-1');
    const until = afterAcc && afterAcc.subscription && Number(afterAcc.subscription.until);
    check('выдача подписки игроку работает', Number.isFinite(until) && until > Date.now(),
      until ? 'подписка до ' + new Date(until).toLocaleDateString('ru-RU') : 'подписки нет');
    check('подписка выдана примерно на 30 дней',
      Number.isFinite(until) && Math.abs((until - Date.now()) / 86400000 - 30) < 1.1,
      Number.isFinite(until) ? Math.round((until - Date.now()) / 86400000) + ' дн.' : '—');

    doc.getElementById('promo-code-input').value = 'TESTPROMO';
    win.createPromo();
    await wait(250);
    const promos = JSON.parse(win.localStorage.getItem('nc_promos') || '[]');
    check('промокод создаётся', promos.some((p) => p.code === 'TESTPROMO'),
      promos.map((p) => p.code).join(', ') || 'нет промокодов');
    check('промокод показан в таблице',
      doc.getElementById('promo-table-body').textContent.includes('TESTPROMO'));

    win.logAdminAction('Автотест', 'Проверка журнала');
    await wait(250);
    check('журнал операций заполняется',
      (doc.getElementById('audit-log-body') || { textContent: '' }).textContent.includes('Автотест'));

    check('панель не ломается при работе с игроками', problems.length === 0, problems[0] || '');
    win.close();
  }
}

// ───────────────────────────────────────────────────────────────────────────

(async () => {
  console.log('Автотесты сайта NOCTURNE');
  await testIndex();
  await testAdmin();

  const failed = results.filter((r) => !r.ok);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' проверок пройдено');
  if (failed.length) {
    console.log('ПРОВАЛЕНО:');
    failed.forEach((f) => console.log('  - ' + f.name + (f.detail ? ' — ' + f.detail : '')));
  }
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error('Тесты упали с исключением:', e);
  process.exit(1);
});
