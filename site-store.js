/* NOCTURNE — общее локальное хранилище: тикеты игроков и промокод 1FIRST.
   Подключается и на сайте, и в админ-панели. Данные живут в localStorage. */
(function () {
  'use strict';

  var TICKETS_KEY = 'nc_tickets';
  var SUPPORT_KEY = 'nc_support';
  var MIGRATION_FLAG = 'nc_tickets_migrated_v1';
  var FIRST_PROMO_FLAG = 'nc_promo_1first_seeded';

  var ROLE_LABELS = {
    junior_moderator: 'Младший модератор',
    moderator: 'Модератор',
    admin: 'Админ',
    senior_admin: 'Старший админ',
    owner: 'Владелец'
  };

  var STATUS_LABELS = { open: 'Открыт', working: 'В работе', closed: 'Закрыт' };

  function store() {
    try { return window.localStorage; } catch (e) { return null; }
  }

  function readJSON(key, fallback) {
    var s = store();
    if (!s) return fallback;
    try {
      var raw = s.getItem(key);
      if (!raw) return fallback;
      var value = JSON.parse(raw);
      return value == null ? fallback : value;
    } catch (e) {
      return fallback;
    }
  }

  function writeJSON(key, value) {
    var s = store();
    if (!s) return;
    try { s.setItem(key, JSON.stringify(value)); } catch (e) { /* переполнение — молча */ }
  }

  function roleLabel(role) { return ROLE_LABELS[role] || role || ''; }
  function statusLabel(status) { return STATUS_LABELS[status] || 'Открыт'; }

  /* ------------------------------------------------------------------ тикеты */

  function ticketList() {
    var value = readJSON(TICKETS_KEY, []);
    return Array.isArray(value) ? value : [];
  }

  function saveTickets(list) { writeJSON(TICKETS_KEY, list); }

  function findTicket(list, id) {
    for (var i = 0; i < list.length; i++) {
      if (String(list[i].id) === String(id)) return list[i];
    }
    return null;
  }

  function nextId(list) {
    var max = 1000;
    list.forEach(function (ticket) {
      var number = parseInt(String(ticket && ticket.id || '').replace(/\D+/g, ''), 10);
      if (!isNaN(number) && number > max) max = number;
    });
    return 'T-' + (max + 1);
  }

  function systemEvent(ticket, text) {
    ticket.messages.push({ from: 'system', name: '', role: '', text: String(text), time: Date.now() });
  }

  function migrateSupport() {
    var s = store();
    if (!s) return;
    try {
      if (s.getItem(MIGRATION_FLAG) === '1') return;
    } catch (e) { return; }

    var legacy = readJSON(SUPPORT_KEY, []);
    var list = ticketList();
    if (Array.isArray(legacy) && legacy.length && !list.length) {
      legacy.forEach(function (entry) {
        if (!entry || !entry.text) return;
        var time = Number(entry.time) || Date.now();
        var nick = String(entry.nick || 'Игрок').slice(0, 40);
        var ticket = {
          id: nextId(list),
          nick: nick,
          subject: 'Обращение из поддержки',
          status: 'open',
          assignedTo: '',
          assignedRole: '',
          createdAt: time,
          updatedAt: time,
          closedAt: 0,
          closedBy: '',
          messages: [{
            from: 'player', name: nick, role: '',
            text: String(entry.text).slice(0, 2000), time: time
          }]
        };
        if (entry.reply) {
          ticket.messages.push({
            from: 'staff', name: 'Поддержка', role: '',
            text: String(entry.reply).slice(0, 2000), time: time
          });
        }
        list.push(ticket);
      });
      saveTickets(list);
    }
    try { s.setItem(MIGRATION_FLAG, '1'); } catch (e) { /* ignore */ }
  }

  function createTicket(nick, subject, text) {
    var list = ticketList();
    var time = Date.now();
    var ticket = {
      id: nextId(list),
      nick: String(nick || 'Игрок').slice(0, 40),
      subject: String(subject || 'Без темы').trim().slice(0, 90) || 'Без темы',
      status: 'open',
      assignedTo: '',
      assignedRole: '',
      createdAt: time,
      updatedAt: time,
      closedAt: 0,
      closedBy: '',
      messages: [{
        from: 'player',
        name: String(nick || 'Игрок'),
        role: '',
        text: String(text || '').trim().slice(0, 2000),
        time: time
      }]
    };
    list.push(ticket);
    saveTickets(list);
    return ticket;
  }

  function addMessage(id, message) {
    var list = ticketList();
    var ticket = findTicket(list, id);
    if (!ticket) return null;
    if (!Array.isArray(ticket.messages)) ticket.messages = [];

    var time = Date.now();
    ticket.messages.push({
      from: message.from === 'staff' ? 'staff' : 'player',
      name: String(message.name || '').slice(0, 40),
      role: message.role || '',
      text: String(message.text || '').trim().slice(0, 2000),
      time: time
    });

    if (message.from === 'staff') {
      if (!ticket.assignedTo) {
        ticket.assignedTo = String(message.name || '').slice(0, 40);
        ticket.assignedRole = message.role || '';
        systemEvent(ticket, 'Исполнитель: ' + ticket.assignedTo + (message.role ? ' (' + roleLabel(message.role) + ')' : ''));
      }
      if (ticket.status === 'closed') {
        systemEvent(ticket, 'Тикет открыт заново ответом сотрудника: ' + String(message.name || ''));
        ticket.closedAt = 0;
        ticket.closedBy = '';
      }
      ticket.status = 'working';
    } else if (ticket.status === 'closed') {
      systemEvent(ticket, 'Игрок вернул тикет: ' + String(message.name || ''));
      ticket.status = 'open';
      ticket.closedAt = 0;
      ticket.closedBy = '';
    }

    ticket.updatedAt = time;
    saveTickets(list);
    return ticket;
  }

  function assignTicket(id, actor) {
    var list = ticketList();
    var ticket = findTicket(list, id);
    if (!ticket || !actor || !actor.name) return null;
    var changed = ticket.assignedTo !== actor.name;
    ticket.assignedTo = String(actor.name).slice(0, 40);
    ticket.assignedRole = actor.role || '';
    ticket.status = 'working';
    ticket.closedAt = 0;
    ticket.closedBy = '';
    ticket.updatedAt = Date.now();
    if (changed) {
      systemEvent(ticket, 'Взял в работу: ' + ticket.assignedTo + (actor.role ? ' (' + roleLabel(actor.role) + ')' : ''));
    }
    saveTickets(list);
    return ticket;
  }

  function setTicketStatus(id, status, actor) {
    var list = ticketList();
    var ticket = findTicket(list, id);
    if (!ticket) return null;
    var name = actor && actor.name ? String(actor.name).slice(0, 40) : 'Сотрудник';
    ticket.updatedAt = Date.now();

    if (status === 'closed') {
      ticket.status = 'closed';
      ticket.closedAt = ticket.updatedAt;
      ticket.closedBy = name;
      systemEvent(ticket, 'Тикет закрыт: ' + name);
    } else {
      ticket.status = status === 'working' ? 'working' : 'open';
      ticket.closedAt = 0;
      ticket.closedBy = '';
      systemEvent(ticket, 'Тикет открыт заново: ' + name);
    }

    saveTickets(list);
    return ticket;
  }

  function ticketsByNick(nick) {
    return ticketList().filter(function (ticket) { return ticket.nick === nick; });
  }

  function currentNick() {
    var s = store();
    if (!s) return '';
    try { return s.getItem('nc_session') || ''; } catch (e) { return ''; }
  }

  function currentStaff() {
    var session = readJSON('nc_staff_session', null);
    if (!session || !session.name) return null;
    return { name: String(session.name), role: session.role || '' };
  }

  /* ------------------------------------------------------------------ промо */

  function ensureFirstPromo() {
    var s = store();
    if (!s) return;
    try {
      if (s.getItem(FIRST_PROMO_FLAG) === '1') return;
    } catch (e) { return; }

    var list = readJSON('nc_promos', []);
    if (!Array.isArray(list)) list = [];
    var existing = null;
    list.forEach(function (promo) {
      if (String(promo && promo.code || '').toUpperCase() === '1FIRST') existing = promo;
    });
    if (existing) {
      if (!existing.firstOnly) {
        existing.firstOnly = true;
        writeJSON('nc_promos', list);
      }
    } else {
      list.unshift({
        code: '1FIRST',
        discount: 20,
        usesMax: 0,
        usedCount: 0,
        active: true,
        firstOnly: true,
        createdAt: Date.now()
      });
      writeJSON('nc_promos', list);
    }
    try { s.setItem(FIRST_PROMO_FLAG, '1'); } catch (e) { /* ignore */ }
  }

  function hasPurchased(nick) {
    if (!nick) return false;
    var keys = readJSON('nc_keys', []);
    if (!Array.isArray(keys)) return false;
    return keys.some(function (key) {
      return key && key.usedBy === nick && key.autoActivated === true;
    });
  }

  function isFirstPurchase(nick) { return !hasPurchased(nick); }

  window.NCStore = {
    roleLabel: roleLabel,
    statusLabel: statusLabel,
    currentNick: currentNick,
    currentStaff: currentStaff,
    tickets: {
      all: ticketList,
      save: saveTickets,
      find: function (id) { return findTicket(ticketList(), id); },
      byNick: ticketsByNick,
      create: createTicket,
      addMessage: addMessage,
      assign: assignTicket,
      setStatus: setTicketStatus,
      migrateSupport: migrateSupport,
      statusLabel: statusLabel,
      roleLabel: roleLabel
    },
    promo: {
      ensureFirstPromo: ensureFirstPromo,
      hasPurchased: hasPurchased,
      isFirstPurchase: isFirstPurchase
    }
  };

  migrateSupport();
  ensureFirstPromo();
})();
