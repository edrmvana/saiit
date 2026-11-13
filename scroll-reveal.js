/* ==========================================================================
   NOCTURNE — Плавное каскадное появление блоков при скролле вниз
   Работает на главной странице, в личном кабинете (#account) и в админ-панели.
   ========================================================================== */
(function () {
  'use strict';

  var mqReduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)');
  if (mqReduce && mqReduce.matches) return;

  var MAIN_SELECTORS = [
    'main > .page-heading',
    'main > .hero',
    'main .benefits > div',
    'main .catalog > .section-heading',
    'main .catalog > .catalog-toolbar',
    '#products > .product-card',
    '#empty-products:not([hidden])',
    'main .discover-grid > *',
    'main > .support-strip',
    'main > footer',
    'main > .admin-notice',
    'main > h1',
    'main > .panel'
  ].join(', ');

  var CABINET_SELECTORS = [
    '#account > .cabinet-nav',
    '#account > .cabinet-hero',
    '#account > .cabinet-columns > .card',
    '#account > #cabinet-purchases',
    '#account > .cabinet-chat',
    '#owned-cosmetics .wardrobe > .wardrobe-item'
  ].join(', ');

  var doneTimers = new WeakMap();
  var lastWindowScrollY = 0;
  var lastCabScrollTop = 0;
  var winRaf = 0;
  var cabRaf = 0;
  var cabinetWasOpen = false;

  function clearDoneTimer(el) {
    var t = doneTimers.get(el);
    if (t) {
      clearTimeout(t);
      doneTimers.delete(el);
    }
  }

  function ensureClass(el) {
    if (!el || el.id === 'account') return false;
    if (!el.classList.contains('scroll-reveal')) {
      el.classList.add('scroll-reveal');
    }
    return true;
  }

  function revealImmediate(el) {
    if (!ensureClass(el)) return;
    clearDoneTimer(el);
    el.classList.remove('sr-resetting');
    el.style.removeProperty('--sr-delay');
    el.classList.add('is-visible', 'sr-done');
  }

  function revealAnimated(el, delayMs) {
    if (!ensureClass(el)) return;
    if (el.classList.contains('is-visible')) return;

    clearDoneTimer(el);
    var delay = Math.max(0, Math.round(delayMs || 0));
    if (el.classList.contains('sr-resetting')) {
      el.classList.remove('sr-resetting');
      void el.offsetWidth;
    }
    el.classList.remove('sr-done');
    if (delay > 0) {
      el.style.setProperty('--sr-delay', delay + 'ms');
    } else {
      el.style.removeProperty('--sr-delay');
    }

    el.classList.add('is-visible');

    var timer = setTimeout(function () {
      doneTimers.delete(el);
      if (el.classList.contains('is-visible')) {
        el.classList.add('sr-done');
        el.style.removeProperty('--sr-delay');
      }
    }, delay + 820);
    doneTimers.set(el, timer);
  }

  function resetOffscreen(el) {
    if (!el || el.id === 'account') return;
    if (!el.classList.contains('is-visible') && !el.classList.contains('sr-done')) return;

    clearDoneTimer(el);
    el.classList.add('sr-resetting');
    el.classList.remove('is-visible', 'sr-done');
    el.style.removeProperty('--sr-delay');

    requestAnimationFrame(function () {
      el.classList.remove('sr-resetting');
    });
  }

  function sortVisualOrder(items) {
    return items.sort(function (a, b) {
      var rowA = Math.round(a.top / 24);
      var rowB = Math.round(b.top / 24);
      if (rowA !== rowB) return rowA - rowB;
      return a.left - b.left;
    });
  }

  function evaluateWindowScroll(mode) {
    var vh = window.innerHeight || document.documentElement.clientHeight || 800;
    var docEl = document.scrollingElement || document.documentElement;
    var scrollY = window.scrollY || docEl.scrollTop || 0;
    var maxScroll = Math.max(0, docEl.scrollHeight - vh);
    var canScroll = maxScroll > 28;
    var atBottom = canScroll && scrollY >= maxScroll - 22;
    var scrollingUp = scrollY < lastWindowScrollY - 1;

    var nodes = document.querySelectorAll(MAIN_SELECTORS);
    var toReveal = [];

    var initialCutoff = Math.min(vh * 0.66, vh - Math.min(260, maxScroll * 0.85));
    var triggerLine = vh * 0.88;

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hidden) continue;
      ensureClass(el);

      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      // Элементы, уже полностью прокрученные выше верхнего края экрана
      if (rect.bottom <= -8) {
        revealImmediate(el);
        continue;
      }

      // Если страница целиком помещается в экран без скролла — плавно показываем всё каскадом
      if (!canScroll) {
        if (!el.classList.contains('is-visible')) {
          toReveal.push({ el: el, top: rect.top, left: rect.left });
        }
        continue;
      }

      // Первичная загрузка в самом верху страницы: шапка и hero видны сразу, нижние секции ждут скролла вниз
      if (mode === 'init' && scrollY <= 8) {
        var isHeroTop = el.matches('.page-heading, .hero, .admin-notice, main > h1');
        if (isHeroTop || rect.top <= initialCutoff) {
          toReveal.push({ el: el, top: rect.top, left: rect.left });
        }
        continue;
      }

      // При прокрутке вверх тихо сбрасываем только те блоки, что полностью ушли за нижний край экрана
      if (scrollingUp && rect.top > vh + 16) {
        resetOffscreen(el);
        continue;
      }

      // При прокрутке вниз (или достижении низа страницы) плавно проявляем входящие блоки
      if (!el.classList.contains('is-visible')) {
        if (atBottom || rect.top <= triggerLine) {
          toReveal.push({ el: el, top: rect.top, left: rect.left });
        }
      }
    }

    if (toReveal.length) {
      sortVisualOrder(toReveal);
      for (var j = 0; j < toReveal.length; j++) {
        revealAnimated(toReveal[j].el, Math.min(j * 90, 420));
      }
    }

    lastWindowScrollY = scrollY;
  }

  function evaluateCabinetScroll(mode) {
    var cab = document.getElementById('account');
    if (!cab || !cab.classList.contains('visible')) return;

    var cabRect = cab.getBoundingClientRect();
    var ch = cab.clientHeight || window.innerHeight || 800;
    var scrollTop = cab.scrollTop || 0;
    var maxScroll = Math.max(0, cab.scrollHeight - ch);
    var canScroll = maxScroll > 24;
    var atBottom = canScroll && scrollTop >= maxScroll - 22;
    var scrollingUp = scrollTop < lastCabScrollTop - 1;

    var nodes = cab.querySelectorAll(CABINET_SELECTORS);
    var toReveal = [];
    var initialCutoff = Math.min(ch * 0.68, ch - Math.min(220, maxScroll * 0.8));
    var triggerLine = ch * 0.88;

    for (var i = 0; i < nodes.length; i++) {
      var el = nodes[i];
      if (el.hidden) continue;
      ensureClass(el);

      var rect = el.getBoundingClientRect();
      if (rect.width === 0 && rect.height === 0) continue;

      var relTop = rect.top - cabRect.top;
      var relBottom = rect.bottom - cabRect.top;

      if (relBottom <= -8) {
        revealImmediate(el);
        continue;
      }

      if (!canScroll) {
        if (!el.classList.contains('is-visible')) {
          toReveal.push({ el: el, top: relTop, left: rect.left });
        }
        continue;
      }

      if (mode === 'init' && scrollTop <= 8) {
        var isCabTop = el.matches('.cabinet-nav, .cabinet-hero');
        if (isCabTop || relTop <= initialCutoff) {
          toReveal.push({ el: el, top: relTop, left: rect.left });
        }
        continue;
      }

      if (scrollingUp && relTop > ch + 16) {
        resetOffscreen(el);
        continue;
      }

      if (!el.classList.contains('is-visible')) {
        if (atBottom || relTop <= triggerLine) {
          toReveal.push({ el: el, top: relTop, left: rect.left });
        }
      }
    }

    if (toReveal.length) {
      sortVisualOrder(toReveal);
      for (var j = 0; j < toReveal.length; j++) {
        revealAnimated(toReveal[j].el, Math.min(j * 85, 360));
      }
    }

    lastCabScrollTop = scrollTop;
  }

  function onWindowScroll() {
    if (winRaf) return;
    winRaf = requestAnimationFrame(function () {
      winRaf = 0;
      evaluateWindowScroll('scroll');
    });
  }

  function onCabinetScroll() {
    if (cabRaf) return;
    cabRaf = requestAnimationFrame(function () {
      cabRaf = 0;
      evaluateCabinetScroll('scroll');
    });
  }

  function init() {
    document.documentElement.classList.add('sr-ready');

    // Сначала помечаем все стартовые элементы классом .scroll-reveal
    var initialNodes = document.querySelectorAll(MAIN_SELECTORS);
    for (var i = 0; i < initialNodes.length; i++) {
      ensureClass(initialNodes[i]);
    }

    // Фиксируем стартовый кадр скрытого состояния, чтобы верхние блоки тоже плавно проявились
    void document.documentElement.offsetHeight;

    requestAnimationFrame(function () {
      lastWindowScrollY = window.scrollY || (document.scrollingElement ? document.scrollingElement.scrollTop : 0) || 0;
      evaluateWindowScroll('init');
    });

    window.addEventListener('scroll', onWindowScroll, { passive: true });
    window.addEventListener('resize', function () {
      onWindowScroll();
      onCabinetScroll();
    }, { passive: true });

    // Доступность с клавиатуры: если фокус попадает внутрь ещё скрытого блока — сразу проявляем его
    document.addEventListener('focusin', function (e) {
      var sr = e.target && e.target.closest ? e.target.closest('.scroll-reveal') : null;
      if (sr && !sr.classList.contains('is-visible')) {
        revealAnimated(sr, 0);
      }
    });

    // Наблюдение за динамической сменой карточек каталога (#products)
    var productsEl = document.getElementById('products');
    if (productsEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(function () {
        var cards = productsEl.querySelectorAll('.product-card');
        if (!cards.length) return;

        var vh = window.innerHeight || document.documentElement.clientHeight || 800;
        var pRect = productsEl.getBoundingClientRect();
        var toolbar = document.querySelector('.catalog-toolbar');
        var catalogAlreadyShown = toolbar && toolbar.classList.contains('is-visible');

        for (var k = 0; k < cards.length; k++) {
          ensureClass(cards[k]);
        }

        // Если пользователь переключил фильтр прямо внутри видимого каталога — не перекрываем анимацию таба
        if (catalogAlreadyShown && pRect.top < vh * 0.92 && pRect.bottom > 0) {
          for (var m = 0; m < cards.length; m++) {
            revealImmediate(cards[m]);
          }
        } else {
          onWindowScroll();
        }
      }).observe(productsEl, { childList: true });
    }

    // Наблюдение за открытием/прокруткой личного кабинета (#account) и гардеробом ролей
    var cab = document.getElementById('account');
    if (cab) {
      cab.addEventListener('scroll', onCabinetScroll, { passive: true });

      if (typeof MutationObserver !== 'undefined') {
        new MutationObserver(function () {
          var isOpen = cab.classList.contains('visible');
          if (isOpen && !cabinetWasOpen) {
            cabinetWasOpen = true;
            lastCabScrollTop = cab.scrollTop || 0;
            var cabNodes = cab.querySelectorAll(CABINET_SELECTORS);
            for (var c = 0; c < cabNodes.length; c++) {
              resetOffscreen(cabNodes[c]);
              ensureClass(cabNodes[c]);
            }
            requestAnimationFrame(function () {
              requestAnimationFrame(function () {
                evaluateCabinetScroll('init');
              });
            });
          } else if (!isOpen && cabinetWasOpen) {
            cabinetWasOpen = false;
          }
        }).observe(cab, { attributes: true, attributeFilter: ['class'] });

        var wardrobeWrap = document.getElementById('owned-cosmetics');
        if (wardrobeWrap) {
          new MutationObserver(function () {
            if (!cab.classList.contains('visible')) return;
            var items = wardrobeWrap.querySelectorAll('.wardrobe-item');
            var chatCard = cab.querySelector('.cabinet-chat');
            var alreadyVisible = chatCard && chatCard.classList.contains('is-visible');
            for (var w = 0; w < items.length; w++) {
              if (alreadyVisible) {
                revealImmediate(items[w]);
              } else {
                ensureClass(items[w]);
              }
            }
            if (!alreadyVisible) onCabinetScroll();
          }).observe(wardrobeWrap, { childList: true, subtree: true });
        }
      }
    }

    // Наблюдение за динамически добавляемыми панелями в main (например, в admin.html)
    var mainEl = document.querySelector('main');
    if (mainEl && typeof MutationObserver !== 'undefined') {
      new MutationObserver(function (mutations) {
        var added = false;
        for (var i = 0; i < mutations.length; i++) {
          if (mutations[i].addedNodes && mutations[i].addedNodes.length) {
            added = true;
            break;
          }
        }
        if (added) onWindowScroll();
      }).observe(mainEl, { childList: true });
    }

    // Отключение эффектов при включении пользователем prefers-reduced-motion на лету
    if (mqReduce && mqReduce.addEventListener) {
      mqReduce.addEventListener('change', function (e) {
        if (e.matches) {
          document.documentElement.classList.remove('sr-ready');
          document.querySelectorAll('.scroll-reveal').forEach(function (el) {
            clearDoneTimer(el);
            el.classList.add('is-visible', 'sr-done');
            el.style.removeProperty('--sr-delay');
          });
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
