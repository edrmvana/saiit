/* NOCTURNE — роли для чата: состав персонала и медиа-роли.
   Каждая роль рисуется градиентом из двух цветов и «переливается». */
(function () {
  'use strict';

  var STAFF = {
    junior_moderator: { label: 'Мл. модератор', symbol: '◇', c1: '#a8dcff', c2: '#6b9bff' },
    moderator: { label: 'Модератор', symbol: '●', c1: '#8fffd9', c2: '#35d6a0' },
    admin: { label: 'Админ', symbol: '◆', c1: '#e3b8ff', c2: '#a86ce6' },
    senior_admin: { label: 'Ст. админ', symbol: '★', c1: '#ffe0a8', c2: '#ffae6b' },
    owner: { label: 'Владелец', symbol: '♛', c1: '#fff0b8', c2: '#ff9de2' }
  };

  var MEDIA = {
    youtube: { label: 'YouTube', symbol: '▶', c1: '#ffb3b3', c2: '#ff4d4d' },
    tiktok: { label: 'TikTok', symbol: '♪', c1: '#7ff7f3', c2: '#ff6b8b' }
  };

  function badge(meta, kind) {
    return '<span class="chat-role-badge chat-role-' + kind + '" style="--cr1:' + meta.c1 + ';--cr2:' + meta.c2 + '" title="Роль: ' + meta.label + '">' +
      '<span class="chat-role-symbol" aria-hidden="true">' + meta.symbol + '</span>' +
      meta.label +
      '</span>';
  }

  window.staffChatBadge = function (role) {
    var meta = STAFF[role];
    return meta ? badge(meta, 'staff') : '';
  };

  window.mediaChatBadge = function (role) {
    var meta = MEDIA[role];
    return meta ? badge(meta, 'media') : '';
  };

  window.chatMediaRole = function (account) {
    return account && MEDIA[account.mediaRole] ? account.mediaRole : '';
  };

  /* Роль сотрудника по нику: ключ staff-доступа или активная сессия панели.
     Нужна, чтобы игрок видел роль модератора/админа в общем чате. */
  window.staffRoleForNick = function (nick) {
    if (!nick) return '';
    try {
      var keys = JSON.parse(window.localStorage.getItem('nc_staff_keys') || '[]');
      if (Array.isArray(keys)) {
        for (var i = 0; i < keys.length; i++) {
          var key = keys[i];
          if (key && key.usedBy === nick && !key.revoked && STAFF[key.role]) return key.role;
        }
      }
      var session = JSON.parse(window.localStorage.getItem('nc_staff_session') || 'null');
      if (session && session.name === nick && STAFF[session.role]) return session.role;
    } catch (e) { /* приватный режим — роли просто не покажем */ }
    return '';
  };

  window.CHAT_STAFF_ROLES = STAFF;
  window.CHAT_MEDIA_ROLES = MEDIA;
})();
