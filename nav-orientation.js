/* NOCTURNE — ориентация на странице.
   Липкая шапка с «хлебными крошками», полоса прогресса прокрутки и мягкая
   подсветка текущего раздела в меню. Всё деликатно: без скачков и без лишних
   перерисовок. */

(function () {
  var topbar = document.querySelector('.topbar');
  var progress = document.getElementById('nc-progress-bar');
  var nav = document.querySelector('.sidebar nav');
  var lastHash = '';
  var lastStuck = null;
  var ticking = false;

  // Разделы, за которыми следим. Список короткий намеренно: на странице
  // всего три зоны (главная, каталог, личный кабинет), остальные пункты меню
  // открывают диалоги, а не прокрутку.
  var WATCHED = [
    ['.hero', '#home'],
    ['.benefits', '#home'],
    ['#shop', '#shop'],
    ['.account-card', '#account']
  ];

  var sections = [];

  function collect() {
    sections = [];
    for (var i = 0; i < WATCHED.length; i++) {
      var element = document.querySelector(WATCHED[i][0]);
      if (!element) continue;
      // Один и тот же блок мог попасть в список дважды.
      var seen = false;
      for (var j = 0; j < sections.length; j++) {
        if (sections[j].element === element) seen = true;
      }
      if (!seen) sections.push({ element: element, hash: WATCHED[i][1] });
    }
  }

  function activeSection() {
    var line = window.scrollY + window.innerHeight * 0.3;
    var best = null;
    for (var i = 0; i < sections.length; i++) {
      var rect = sections[i].element.getBoundingClientRect();
      // Скрытый блок (например, закрытый личный кабинет) не участвует в выборе:
      // у него нулевая высота и сверху он был бы «лучшим» всегда.
      if (rect.height <= 0 && rect.width <= 0) continue;
      if (rect.top + window.scrollY <= line) best = sections[i];
    }
    if (best) return best;
    // У самого низа страницы активным остаётся последний видимый раздел.
    if (window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 4) {
      for (var k = sections.length - 1; k >= 0; k--) {
        var last = sections[k].element.getBoundingClientRect();
        if (last.height > 0 || last.width > 0) return sections[k];
      }
    }
    return null;
  }

  function apply() {
    ticking = false;

    var stuck = window.scrollY > 4;
    if (topbar && stuck !== lastStuck) {
      topbar.classList.toggle('is-stuck', stuck);
      lastStuck = stuck;
    }

    if (progress) {
      var height = document.documentElement.scrollHeight - window.innerHeight;
      var ratio = height > 0 ? Math.min(1, Math.max(0, window.scrollY / height)) : 0;
      var bar = progress.querySelector('i');
      if (bar) bar.style.width = (ratio * 100).toFixed(2) + '%';
      progress.setAttribute('aria-hidden', 'true');
    }

    var current = activeSection();
    if (!current || current.hash === lastHash) return;
    lastHash = current.hash;

    if (nav) {
      var links = nav.querySelectorAll('a[href^="#"]');
      for (var i = 0; i < links.length; i++) {
        links[i].classList.toggle('spy-active', links[i].getAttribute('href') === current.hash);
      }
    }
    // markNav из app.js обновляет «хлебные крошки» и класс .active.
    if (typeof window.markNav === 'function') {
      var known = ['#home', '#shop', '#cosmetics', '#news', '#community', '#support'];
      if (known.indexOf(current.hash) !== -1) window.markNav(current.hash);
    }
  }

  function onScroll() {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(apply);
  }

  function start() {
    collect();
    apply();
  }

  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', function () {
    collect();
    onScroll();
  });
  window.addEventListener('load', start);
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    start();
    // Каталог и дополнительные блоки появляются после отрисовки.
    setTimeout(start, 400);
  }
})();
