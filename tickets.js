/* NOCTURNE — интерфейс тикетов для сайта и админ-панели.
   Данные читает и пишет site-store.js (window.NCStore). */
(function () {
  'use strict';

  if (!window.NCStore) {
    window.NCTickets = {
      renderPlayer: function () {},
      renderAdmin: function () {}
    };
    return;
  }

  var T = window.NCStore.tickets;

  function esc(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (char) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char];
    });
  }

  function two(value) { return value < 10 ? '0' + value : String(value); }

  function timeText(timestamp) {
    var time = Number(timestamp);
    if (!time) return '';
    var date = new Date(time);
    var now = new Date();
    var sameDay = date.toDateString() === now.toDateString();
    if (sameDay) return two(date.getHours()) + ':' + two(date.getMinutes());
    return two(date.getDate()) + '.' + two(date.getMonth() + 1) + '.' + date.getFullYear();
  }

  function toast(text, type) {
    try {
      if (typeof window.showNC === 'function') { window.showNC(text, type || 'success'); return; }
      if (typeof window.notify === 'function') { window.notify(text, type || 'success'); }
    } catch (e) { /* уведомление не должно ломать тикеты */ }
  }

  function log(action, details) {
    try {
      if (typeof window.logAdminAction === 'function') window.logAdminAction(action, details);
    } catch (e) { /* ignore */ }
  }

  function statusClass(status) {
    return status === 'working' ? 'working' : status === 'closed' ? 'closed' : 'open';
  }

  function badge(status) {
    return '<span class="nct-badge nct-badge-' + statusClass(status) + '">' + esc(T.statusLabel(status)) + '</span>';
  }

  function roleLine(role) {
    var label = window.NCStore.roleLabel(role);
    return label ? '<span class="nct-role">' + esc(label) + '</span>' : '';
  }

  function messagesHTML(ticket) {
    var messages = Array.isArray(ticket.messages) ? ticket.messages : [];
    if (!messages.length) return '<p class="nct-empty">Сообщений пока нет.</p>';
    return messages.map(function (message) {
      if (message.from === 'system') {
        return '<div class="nct-system">' + esc(message.text) + '<time>' + esc(timeText(message.time)) + '</time></div>';
      }
      var staff = message.from === 'staff';
      return '<div class="nct-msg ' + (staff ? 'nct-msg-staff' : 'nct-msg-player') + '">' +
        '<div class="nct-msg-head"><b>' + esc(message.name || (staff ? 'Поддержка' : 'Игрок')) + '</b>' +
        (staff ? roleLine(message.role) : '') +
        '<time>' + esc(timeText(message.time)) + '</time></div>' +
        '<p>' + esc(message.text) + '</p>' +
        '</div>';
    }).join('');
  }

  function assigneeHTML(ticket) {
    if (!ticket.assignedTo) return '<span class="nct-assignee nct-muted">Ещё не взят в работу</span>';
    return '<span class="nct-assignee">В работе: <b>' + esc(ticket.assignedTo) + '</b>' +
      (ticket.assignedRole ? ' · ' + esc(window.NCStore.roleLabel(ticket.assignedRole)) : '') + '</span>';
  }

  function messageCountHTML(ticket) {
    var count = Array.isArray(ticket.messages) ? ticket.messages.length : 0;
    return '<span class="nct-msg-count">' + count + ' ' + (count === 1 ? 'сообщение' : count >= 2 && count <= 4 ? 'сообщения' : 'сообщений') + '</span>';
  }

  /* ------------------------------------------------------------------ игрок */

  function playerTicketHTML(ticket) {
    var closed = ticket.status === 'closed';
    return '<details class="nct-ticket" data-nct-id="' + esc(ticket.id) + '">' +
      '<summary class="nct-summary">' +
        '<span class="nct-summary-main"><span class="nct-subject">' + esc(ticket.subject) + '</span>' +
        '<span class="nct-summary-meta">#' + esc(ticket.id) + ' · обновлён ' + esc(timeText(ticket.updatedAt)) + '</span></span>' +
        badge(ticket.status) +
      '</summary>' +
      '<div class="nct-meta-row">' + assigneeHTML(ticket) + messageCountHTML(ticket) + '</div>' +
      '<div class="nct-thread">' + messagesHTML(ticket) + '</div>' +
      (closed ? '<p class="nct-closed-note">Тикет закрыт' + (ticket.closedBy ? ' сотрудником ' + esc(ticket.closedBy) : '') +
        '. Напишите сюда, если проблема вернулась — тикет откроется заново.</p>' : '') +
      '<form class="nct-reply" data-nct-reply="' + esc(ticket.id) + '">' +
        '<textarea name="text" rows="2" maxlength="2000" placeholder="Ваше сообщение…" required></textarea>' +
        '<button type="submit" class="nct-btn">Отправить</button>' +
      '</form>' +
    '</details>';
  }

  function playerToolbarHTML() {
    return '<div class="nct-toolbar">' +
      '<details class="nct-new">' +
        '<summary class="nct-new-toggle">+ Новый тикет</summary>' +
        '<form class="nct-new-form" data-nct-new>' +
          '<label>Тема<input name="subject" maxlength="90" placeholder="Коротко о проблеме" required></label>' +
          '<label>Сообщение<textarea name="text" rows="3" maxlength="2000" placeholder="Опишите ситуацию как можно точнее…" required></textarea></label>' +
          '<button type="submit" class="nct-btn nct-btn-primary">Создать тикет</button>' +
        '</form>' +
      '</details>' +
      '<p class="nct-toolbar-hint">Каждое обращение — отдельный тикет. Здесь видно, кто из персонала взял его в работу.</p>' +
    '</div>';
  }

  function renderPlayer(root, options) {
    if (!root) return;
    var nick = window.NCStore.currentNick();
    var ctx = { mode: 'player', actor: { name: nick, role: '' } };
    root._nctCtx = ctx;
    bind(root);

    if (!nick) {
      root.innerHTML = '<p class="nct-empty">Войдите в аккаунт, чтобы создавать тикеты и переписываться с поддержкой.</p>';
      updateCount(0);
      return;
    }

    var list = T.byNick(nick).slice().sort(function (a, b) {
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });

    root.innerHTML = playerToolbarHTML() +
      '<div class="nct-list">' +
      (list.map(playerTicketHTML).join('') || '<p class="nct-empty">Тикетов пока нет. Создайте первый — ответ придёт сюда.</p>') +
      '</div>';
    updateCount(list.length);
  }

  function updateCount(count) {
    var el = document.getElementById('cabinet-tickets-count');
    if (el) el.textContent = String(count);
  }

  /* ------------------------------------------------------------------ админ */

  function adminTicketHTML(ticket, ctx) {
    var can = ctx.canReply;
    var closed = ticket.status === 'closed';
    var mine = ticket.assignedTo && ctx.actor && ticket.assignedTo === ctx.actor.name;
    var actions = '';

    if (can) {
      if (!closed) {
        actions += '<button type="button" class="nct-btn" data-nct-take="' + esc(ticket.id) + '"' + (mine ? ' disabled' : '') + '>' +
          (mine ? 'Вы взяли тикет' : 'Взять в работу') + '</button>';
        actions += '<button type="button" class="nct-btn nct-btn-danger" data-nct-close="' + esc(ticket.id) + '">Закрыть</button>';
      } else {
        actions += '<button type="button" class="nct-btn" data-nct-reopen="' + esc(ticket.id) + '">Открыть заново</button>';
      }
    }

    return '<details class="nct-ticket nct-admin-ticket" data-nct-id="' + esc(ticket.id) + '">' +
      '<summary class="nct-summary">' +
        '<span class="nct-summary-main"><span class="nct-subject">' + esc(ticket.subject) + '</span>' +
        '<span class="nct-summary-meta"><b class="nct-nick">' + esc(ticket.nick) + '</b> · #' + esc(ticket.id) + ' · ' + esc(timeText(ticket.updatedAt)) + '</span></span>' +
        badge(ticket.status) +
      '</summary>' +
      '<div class="nct-meta-row">' + assigneeHTML(ticket) + messageCountHTML(ticket) + '</div>' +
      '<div class="nct-thread">' + messagesHTML(ticket) + '</div>' +
      (can ? '<div class="nct-actions">' + actions + '</div>' : '<p class="nct-muted nct-readonly">Только чтение</p>') +
      (can ? '<form class="nct-reply" data-nct-reply="' + esc(ticket.id) + '">' +
        '<textarea name="text" rows="2" maxlength="2000" placeholder="Ответ игроку…" required></textarea>' +
        '<button type="submit" class="nct-btn nct-btn-primary">Отправить</button>' +
      '</form>' : '') +
    '</details>';
  }

  function sortForStaff(list) {
    var rank = { working: 0, open: 1, closed: 2 };
    return list.slice().sort(function (a, b) {
      var diff = (rank[statusClass(a.status)] || 0) - (rank[statusClass(b.status)] || 0);
      if (diff) return diff;
      return (Number(b.updatedAt) || 0) - (Number(a.updatedAt) || 0);
    });
  }

  function renderAdmin(root, options) {
    if (!root) return;
    var staff = window.NCStore.currentStaff();
    var ctx = {
      mode: 'staff',
      actor: staff || { name: 'Сотрудник', role: '' },
      canReply: !options || options.canReply !== false
    };
    root._nctCtx = ctx;
    bind(root);

    var all = sortForStaff(T.all());
    var signature = (staff ? staff.name + '/' + staff.role : 'anon') + '|' + ctx.canReply + '|' +
      all.map(function (t) {
        return [t.id, t.status, t.assignedTo || '', t.updatedAt || 0,
          Array.isArray(t.messages) ? t.messages.length : 0].join(':');
      }).join('|');
    if (root.dataset.nctSig === signature) return;
    root.dataset.nctSig = signature;

    var openIds = [];
    root.querySelectorAll('.nct-ticket[open]').forEach(function (node) {
      openIds.push(node.getAttribute('data-nct-id'));
    });

    var open = all.filter(function (t) { return t.status === 'open'; }).length;
    var working = all.filter(function (t) { return t.status === 'working'; }).length;
    var closed = all.filter(function (t) { return t.status === 'closed'; }).length;

    root.innerHTML =
      '<div class="nct-admin-bar">' +
        '<span class="nct-counts"><span class="nct-dot nct-dot-open"></span>Открыто: ' + open +
        ' · <span class="nct-dot nct-dot-working"></span>В работе: ' + working +
        ' · <span class="nct-dot nct-dot-closed"></span>Закрыто: ' + closed + '</span>' +
        '<span class="nct-admin-hint">Младший модератор может отвечать и закрывать тикеты.</span>' +
      '</div>' +
      '<div class="nct-list">' +
      (all.map(function (ticket) { return adminTicketHTML(ticket, ctx); }).join('') ||
        '<p class="nct-empty">Тикетов пока нет. Как только игрок напишет в поддержку, он появится здесь.</p>') +
      '</div>';

    openIds.forEach(function (id) {
      var node = root.querySelector('.nct-ticket[data-nct-id="' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (node) node.open = true;
    });
  }

  /* ------------------------------------------------------------- поведение */

  function rerender(root) {
    var ctx = root._nctCtx || { mode: 'player', actor: { name: window.NCStore.currentNick(), role: '' } };
    var openIds = [];
    root.querySelectorAll('.nct-ticket[open]').forEach(function (node) {
      openIds.push(node.getAttribute('data-nct-id'));
    });

    delete root.dataset.nctSig;
    if (ctx.mode === 'staff') renderAdmin(root, { canReply: ctx.canReply });
    else renderPlayer(root);

    openIds.forEach(function (id) {
      var node = root.querySelector('.nct-ticket[data-nct-id="' + String(id).replace(/[^A-Za-z0-9_-]/g, '') + '"]');
      if (node) node.open = true;
    });
  }

  function bind(root) {
    if (root.dataset.nctBound === '1') return;
    root.dataset.nctBound = '1';

    root.addEventListener('submit', function (event) {
      var form = event.target.closest('form[data-nct-new], form[data-nct-reply]');
      if (!form || !root.contains(form)) return;
      event.preventDefault();

      var ctx = root._nctCtx || {};
      var textArea = form.querySelector('[name="text"]');
      var text = textArea ? textArea.value.trim() : '';
      if (!text) { toast('Напишите сообщение перед отправкой.', 'error'); return; }

      if (form.hasAttribute('data-nct-new')) {
        if (ctx.mode !== 'player') return;
        var nick = window.NCStore.currentNick();
        if (!nick) { toast('Сначала войдите в аккаунт.', 'error'); return; }
        var subjectEl = form.querySelector('[name="subject"]');
        var subject = subjectEl ? subjectEl.value.trim() : '';
        if (!subject) { toast('Укажите тему тикета.', 'error'); return; }
        var ticket = T.create(nick, subject, text);
        toast('Тикет #' + ticket.id + ' создан. Ответ появится здесь.', 'success');
        rerender(root);
        return;
      }

      var id = form.getAttribute('data-nct-reply');
      var isStaff = ctx.mode === 'staff';
      if (isStaff && !ctx.canReply) return;

      T.addMessage(id, {
        from: isStaff ? 'staff' : 'player',
        name: isStaff ? (ctx.actor && ctx.actor.name) || 'Сотрудник' : window.NCStore.currentNick(),
        role: isStaff && ctx.actor ? ctx.actor.role : '',
        text: text
      });

      if (isStaff) {
        log('Ответ в тикете', '#' + id + ' · ' + ((ctx.actor && ctx.actor.name) || 'Сотрудник'));
        toast('Ответ отправлен в тикет #' + id + '.', 'success');
      } else {
        toast('Сообщение отправлено в тикет #' + id + '.', 'success');
      }
      rerender(root);
    });

    root.addEventListener('click', function (event) {
      var ctx = root._nctCtx || {};
      if (ctx.mode !== 'staff') return;

      var take = event.target.closest('[data-nct-take]');
      var close = event.target.closest('[data-nct-close]');
      var reopen = event.target.closest('[data-nct-reopen]');

      if (take) {
        if (!ctx.canReply) return;
        var taken = T.assign(take.getAttribute('data-nct-take'), ctx.actor);
        if (taken) {
          log('Тикет взят в работу', '#' + taken.id + ' · ' + taken.assignedTo);
          toast('Тикет #' + taken.id + ' в работе у ' + taken.assignedTo + '.', 'success');
          rerender(root);
        }
        return;
      }

      if (close) {
        if (!ctx.canReply) return;
        var closed = T.setStatus(close.getAttribute('data-nct-close'), 'closed', ctx.actor);
        if (closed) {
          log('Тикет закрыт', '#' + closed.id + ' · ' + ctx.actor.name);
          toast('Тикет #' + closed.id + ' закрыт.', 'info');
          rerender(root);
        }
        return;
      }

      if (reopen) {
        if (!ctx.canReply) return;
        var reopened = T.setStatus(reopen.getAttribute('data-nct-reopen'), 'open', ctx.actor);
        if (reopened) {
          log('Тикет открыт заново', '#' + reopened.id + ' · ' + ctx.actor.name);
          toast('Тикет #' + reopened.id + ' открыт заново.', 'success');
          rerender(root);
        }
      }
    });
  }

  window.NCTickets = {
    renderPlayer: renderPlayer,
    renderAdmin: renderAdmin,
    refreshPlayer: function () {
      var root = document.getElementById('cabinet-tickets-list');
      if (root) renderPlayer(root);
    }
  };
})();
