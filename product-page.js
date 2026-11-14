/* NOCTURNE — страницы и меню оформления заказов
   - Полноразмерное меню (софт RustEx): 2 колонки, выбор срока подписки, характеристики
   - Компактное меню (косметика, сброс HWID, сервисы): меньший размер, единая карточка, предпросмотр, промокоды
*/
(function(){
  if(typeof window.showInfo!=='function')return;

  var PLANS=[
    {d:7,   p:59,  hit:false},
    {d:14,  p:100, hit:true },
    {d:30,  p:200, hit:false},
    {d:90,  p:500, hit:false},
    {d:180, p:800, hit:false}
  ];

  var SPECS=[
    ['Операционная система','Windows 10, Windows 11'],
    ['Разрядность системы','x64 bit'],
    ['Процессор','Intel Core i5 / AMD Ryzen'],
    ['ОЗУ','4 ГБ']
  ];

  var FEATURES=['Андетект','Полный набор функций','Регулярные обновления','Поддержка 24/7'];

  var PAY_METHODS=[
    {id:'balance',label:'Баланс сайта',color:'#a78bfa',svg:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20M6 15h4"/>'},
    {id:'sbp',     label:'СБП',        color:'#3ddc97',svg:'<rect x="6" y="2" width="12" height="20" rx="3"/><path d="M11 18h2"/>'},
    {id:'cis',     label:'Карты СНГ',  color:'#4cc9f0',svg:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>'},
    {id:'rf',      label:'Карты РФ',   color:'#9b7bf0',svg:'<rect x="2" y="5" width="20" height="14" rx="3"/><path d="M2 10h20"/>'},
    {id:'crypto',  label:'Криптовалюта',color:'#f2b705',svg:'<path d="M9 4v16M13 4v16M7 8h7a3 3 0 0 1 0 6H7h8a3 3 0 0 1 0 6H7"/>'},
    {id:'cryptobot',label:'Cryptobot', color:'#2fd0d8',svg:'<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 14h.01M15 14h.01"/>'},
    {id:'funpay',  label:'FunPay',     color:'#f06fa8',svg:'<path d="M3 9h18l-1.5 11H4.5z"/><path d="M8 9V6a4 4 0 0 1 8 0v3"/>'}
  ];

  function payIcon(m){
    return '<span class="np-pay-icon" style="color:'+m.color+'"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">'+m.svg+'</svg></span>';
  }

  function plural(d){
    var n=d%100, n1=d%10;
    if(n>10&&n<20)return 'дней';
    if(n1===1)return 'день';
    if(n1>=2&&n1<=4)return 'дня';
    return 'дней';
  }

  function checkIcon(){
    return '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>';
  }

  function getActivePromos() {
    try {
      var storage = (typeof ncStorage !== 'undefined' ? ncStorage : localStorage);
      var raw = storage.getItem('nc_promos');
      if (!raw) return [];
      var parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch (e) {
      return [];
    }
  }

  function setupPaymentDropdown(root, state){
    var pay=root.querySelector('#np-pay');
    if(!pay)return;
    var trigger=pay.querySelector('#np-pay-trigger');
    var list=pay.querySelector('#np-pay-list');
    var labelEl=pay.querySelector('#np-pay-label');

    var closeList=function(){
      if(!pay.classList.contains('open'))return;
      pay.classList.remove('open');
      pay.classList.add('closing');
      trigger.setAttribute('aria-expanded','false');
      setTimeout(function(){pay.classList.remove('closing');},260);
    };
    var openList=function(){
      pay.classList.remove('closing');
      pay.classList.add('open');
      trigger.setAttribute('aria-expanded','true');
    };

    trigger.addEventListener('click',function(e){
      e.stopPropagation();
      if(pay.classList.contains('open'))closeList();else openList();
    });

    list.querySelectorAll('.np-pay-option').forEach(function(opt){
      opt.addEventListener('click',function(e){
        e.stopPropagation();
        list.querySelectorAll('.np-pay-option').forEach(function(o){o.classList.remove('selected');});
        opt.classList.add('selected');
        state.pay=opt.dataset.pay;
        labelEl.textContent=opt.dataset.label;
        var newIcon=opt.querySelector('.np-pay-icon');
        var oldIcon=trigger.querySelector('.np-pay-icon');
        if(newIcon&&oldIcon)oldIcon.outerHTML=newIcon.outerHTML;
        labelEl.classList.remove('np-pay-label-swap');
        void labelEl.offsetWidth;
        labelEl.classList.add('np-pay-label-swap');
        closeList();
      });
    });

    document.addEventListener('click',function(e){
      if(pay&&!pay.contains(e.target))closeList();
    });
    document.addEventListener('keydown',function(e){
      if(e.key==='Escape')closeList();
    });
  }

  // =========================================================================
  // 1. Полноразмерное меню (Софт RustEx)
  // =========================================================================
  function buildHTML(p){
    var plans=PLANS.map(function(o,i){
      return '<button type="button" class="np-plan'+(i===1?' selected':'')+'" data-days="'+o.d+'" data-price="'+o.p+'">'+
             (o.hit?'<span class="np-plan-hit"><svg viewBox="0 0 24 24" fill="currentColor" width="11" height="11" aria-hidden="true" style="margin-right:3px;display:inline-block;vertical-align:-1px"><path d="M12 2c-.5 3-2.5 5-4 7-1.5 2-2 4-2 6a6 6 0 0 0 12 0c0-3-1.5-5.5-3.5-7.5-1.5-1.5-2-3.5-2.5-5.5z"/></svg>ХИТ</span>':'')+
             '<b>'+o.d+' '+plural(o.d)+'</b><span class="np-plan-price">'+o.p+' ₽</span></button>';
    }).join('');

    var feats=FEATURES.map(function(f){
      return '<li>'+checkIcon()+'<span>'+f+'</span></li>';
    }).join('');

    var specs=SPECS.map(function(s){
      return '<div class="np-spec"><span class="np-spec-name"><i></i>'+s[0]+'</span><span class="np-spec-value">'+s[1]+'</span></div>';
    }).join('');

    return ''+
    '<div class="np-layout">'+
      '<div class="np-col-main">'+
        '<section class="np-card">'+
          '<h4 class="np-kicker">ИНФОРМАЦИЯ О ПРОДУКТЕ</h4>'+
          '<p class="np-desc">Чит для проекта RustEx с полным набором функций. Стабильная работа без вылетов, регулярные обновления под актуальные версии лаунчера и обход систем защиты. Ключ привязывается к аккаунту автоматически сразу после оплаты.</p>'+
          '<ul class="np-features">'+feats+'</ul>'+
          '<div class="np-divider"></div>'+
          '<p class="np-support-label">Поддерживаемые версии:</p>'+
          '<p class="np-support-value">— RustEx</p>'+
        '</section>'+
        '<section class="np-card">'+
          '<h4 class="np-kicker"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/></svg> СИСТЕМНЫЕ ТРЕБОВАНИЯ</h4>'+
          '<div class="np-specs">'+specs+'</div>'+
        '</section>'+
      '</div>'+
      '<aside class="np-col-side">'+
        '<section class="np-card np-order">'+
          '<h4 class="np-kicker">ОФОРМЛЕНИЕ</h4>'+
          '<h3 class="np-title">'+p.name+'</h3>'+
          '<p class="np-from">Цена начинается от 59 ₽.</p>'+
          '<p class="np-field-label">Срок подписки</p>'+
          '<div class="np-plans">'+plans+'</div>'+
          '<p class="np-field-label">Способ оплаты</p>'+
          '<div class="np-pay" id="np-pay">'+
            '<button type="button" class="np-pay-trigger" id="np-pay-trigger" aria-haspopup="listbox" aria-expanded="false">'+
              payIcon(PAY_METHODS[0])+
              '<span class="np-pay-label" id="np-pay-label">'+PAY_METHODS[0].label+'</span>'+
              '<svg class="np-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>'+
            '</button>'+
            '<div class="np-pay-list" id="np-pay-list" role="listbox">'+
              PAY_METHODS.map(function(m,i){
                return '<button type="button" class="np-pay-option'+(i===0?' selected':'')+'" role="option" data-pay="'+m.id+'" data-label="'+m.label+'" style="--np-i:'+i+'">'+
                       payIcon(m)+'<span>'+m.label+'</span>'+
                       '<svg class="np-pay-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>'+
                       '</button>';
              }).join('')+
            '</div>'+
          '</div>'+
          '<div class="np-inputs">'+
            '<label class="np-input-group"><span class="np-field-label">Промокод</span>'+
              '<div class="np-promo-field-wrap">'+
                '<input id="np-promo" type="text" placeholder="Введите промокод…" autocomplete="off" style="text-transform:uppercase">'+
                '<button type="button" id="np-promo-btn" class="np-promo-apply-btn">Применить</button>'+
              '</div>'+
              '<div id="np-promo-feedback" class="np-promo-feedback"></div>'+
              '<div class="np-promo-hint">Первый заказ? Промокод <b>1FIRST</b> даёт −20% на первую покупку.</div>' +
            '</label>'+
          '</div>'+
          '<div class="np-user-balance" id="np-user-balance"></div>'+
          '<div class="np-total"><span>Итого к оплате</span><b id="np-total-value">100 ₽</b></div>'+
          '<button type="button" class="np-submit" id="np-submit">Оформить за <span id="np-submit-value">100 ₽</span> '+
            '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg></button>'+
          '<span class="demo-label">Демо-покупка с локального баланса. Реальные деньги не списываются.</span>'+
        '</section>'+
      '</aside>'+
    '</div>';
  }

  function wire(p){
    var root=document.getElementById('info-body');
    if(!root)return;
    var state={days:14,price:100,discount:0,promoCode:'',pay:'balance'};

    function calculateFinalPrice() {
      if (state.discount > 0) {
        return Math.max(1, Math.round(state.price * (1 - state.discount / 100)));
      }
      return state.price;
    }

    function paint(){
      var finalP = calculateFinalPrice();
      var t = root.querySelector('#np-total-value');
      var s = root.querySelector('#np-submit-value');
      
      if (state.discount > 0) {
        var totalHtml = '<span class="np-old-price">' + state.price + ' ₽</span> ' + finalP + ' ₽ <span class="np-discount-pill">-' + state.discount + '%</span>';
        if (t) t.innerHTML = totalHtml;
        if (s) s.textContent = finalP + ' ₽';
      } else {
        var regularText = state.price + ' ₽';
        if (t) t.textContent = regularText;
        if (s) s.textContent = regularText;
      }

      var balEl = root.querySelector('#np-user-balance');
      if (balEl && typeof currentAccount === 'function') {
        var acc = currentAccount();
        if (acc) {
          var b = Number(acc.balance || 0);
          if (b >= finalP) {
            balEl.innerHTML = '<span class="np-bal-ok">✓ Ваш баланс: <b>' + b + ' ₽</b> (хватает для оплаты)</span>';
          } else {
            var diff = finalP - b;
            balEl.innerHTML = '<span class="np-bal-warn">Ваш баланс: <b>' + b + ' ₽</b> (не хватает ' + diff + ' ₽)</span>';
          }
        } else {
          balEl.innerHTML = '<span class="np-bal-login">Войдите в аккаунт для оплаты с баланса</span>';
        }
      }
    }

    function applyPromoCode(codeStr) {
      var code = (codeStr || '').trim().toUpperCase();
      var feedback = root.querySelector('#np-promo-feedback');
      var promoInput = root.querySelector('#np-promo');
      if (promoInput && codeStr) promoInput.value = code;

      if (!code) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) feedback.innerHTML = '';
        paint();
        return;
      }

      var promos = getActivePromos();
      var found = promos.find(function(item) {
        return item.code.toUpperCase() === code;
      });

      if (!found) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) {
          feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод «' + code + '» не найден</span>';
        }
        paint();
        return;
      }

      if (!found.active) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) {
          feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод временно приостановлен</span>';
        }
        paint();
        return;
      }

      if (found.usesMax > 0 && found.usedCount >= found.usesMax) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) {
          feedback.innerHTML = '<span class="np-promo-msg error">✕ Лимит активаций промокода исчерпан</span>';
        }
        paint();
        return;
      }

      if (found.firstOnly) {
        var buyer = (typeof currentAccount === 'function') ? currentAccount() : null;
        if (buyer && window.NCStore && !window.NCStore.promo.isFirstPurchase(buyer.nick)) {
          state.discount = 0;
          state.promoCode = '';
          if (feedback) {
            feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод «' + found.code + '» действует только на первую покупку</span>';
          }
          paint();
          return;
        }
      }

      state.discount = Number(found.discount) || 0;
      state.promoCode = found.code;
      var discounted = calculateFinalPrice();
      var saved = state.price - discounted;

      if (feedback) {
        feedback.innerHTML = '<span class="np-promo-msg success">✓ Скидка <b>' + found.discount + '%</b> по промокоду <b>' + found.code + '</b> (-' + saved + ' ₽)</span>';
      }
      paint();
    }

    root.querySelectorAll('.np-plan').forEach(function(btn){
      btn.addEventListener('click',function(){
        root.querySelectorAll('.np-plan').forEach(function(b){b.classList.remove('selected');});
        btn.classList.add('selected');
        state.days=Number(btn.dataset.days);
        state.price=Number(btn.dataset.price);
        paint();
      });
    });

    var promoBtn = root.querySelector('#np-promo-btn');
    var promoInp = root.querySelector('#np-promo');
    if (promoBtn && promoInp) {
      promoBtn.addEventListener('click', function(){
        applyPromoCode(promoInp.value);
      });
      promoInp.addEventListener('keydown', function(e){
        if (e.key === 'Enter') {
          e.preventDefault();
          applyPromoCode(promoInp.value);
        }
      });
      promoInp.addEventListener('input', function(){
        if (!promoInp.value.trim() && state.promoCode) {
          applyPromoCode('');
        }
      });
    }

    setupPaymentDropdown(root, state);

    var submit=root.querySelector('#np-submit');
    if(submit){
      submit.addEventListener('click',function(){
        var name=p.purchaseName||p.name;
        var finalP = calculateFinalPrice();
        var appliedPromo = state.promoCode;

        var acc = (typeof currentAccount === 'function') ? currentAccount() : null;
        if (!acc) {
          if (typeof showNC === 'function') showNC('Сначала войдите в аккаунт для покупки', 'error');
          if (typeof openAccount === 'function') openAccount();
          return;
        }

        if (acc.blocked) {
          if (typeof showNC === 'function') showNC('Ваш аккаунт заблокирован', 'error');
          return;
        }

        if (Number(acc.balance || 0) < Number(finalP)) {
          var diff = Number(finalP) - Number(acc.balance || 0);
          if (typeof showNC === 'function') {
            showNC('Недостаточно средств на балансе (не хватает ' + diff + ' ₽). Пополните баланс в личном кабинете.', 'error');
          }
          return;
        }

        if(typeof window.closeInfo==='function')window.closeInfo();
        setTimeout(function(){
          if(typeof window.finishPurchase==='function'){
            window.finishPurchase(name, state.days, finalP, null, appliedPromo);
          }else if(typeof window.buyProduct==='function'){
            window.buyProduct(name, finalP, state.days);
          }
        },160);
      });
    }
    paint();
  }

  // =========================================================================
  // 2. Компактное меню оформления (Косметика, Сервисы, HWID Reset)
  //    Стилизовано под оформление софта, но в компактном формате карточки
  // =========================================================================
  function buildCompactHTML(p){
    var iconHtml = '';
    var badgeText = '✦ ' + (p.type || 'ПРОДУКТ');
    var pills = [];
    var submitActionLabel = 'Оформить за';

    if (p.category === 'cosmetics' || ['Космический', 'Тень', 'Легенда'].includes(p.name)) {
      badgeText = '✦ КОСМЕТИКА · РОЛЬ В ЧАТЕ';
      submitActionLabel = 'Купить роль за';
      var filterStyle = '';
      if (p.id === 'shadow' || p.name === 'Тень') filterStyle = 'style="filter:hue-rotate(245deg) saturate(.35) brightness(.65)"';
      if (p.id === 'legend' || p.name === 'Легенда') filterStyle = 'style="filter:hue-rotate(325deg) saturate(.7)"';
      iconHtml = '<img src="assets/blackhole.webp" alt="' + p.name + '" ' + filterStyle + '>';
      pills = ['Роль в чате', 'Уникальный бейдж', 'Навсегда в коллекции'];
    } else if (p.id === 'reset' || p.name === 'HWID-RESET' || p.name === 'HWID Reset') {
      badgeText = '✦ СЕРВИС · СБРОС ПРИВЯЗКИ';
      submitActionLabel = 'Сбросить HWID за';
      iconHtml = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:26px;height:26px;color:#ba8cf7"><path d="M3 10a9 9 0 1 1 2 8M3 4v6h6"/></svg>';
      pills = ['Сброс привязки устройства', 'В личном кабинете', 'Мгновенно'];
    } else {
      iconHtml = '<span style="font-size:24px;color:#cba6f7">✦</span>';
      pills = Array.isArray(p.features) ? p.features : ['Моментальная выдача', 'Гарантия'];
    }

    var pillsHtml = pills.map(function(item) {
      return '<span class="np-compact-pill">' + checkIcon() + ' ' + item + '</span>';
    }).join('');

    return '' +
    '<div class="np-compact-order">' +
      '<div class="np-compact-preview">' +
        '<div class="np-compact-icon">' + iconHtml + '</div>' +
        '<div class="np-compact-meta">' +
          '<span class="np-compact-badge">' + badgeText + '</span>' +
          '<h3 class="np-compact-title">' + (p.category === 'cosmetics' ? 'Роль «' + p.name + '»' : p.name) + '</h3>' +
          '<p class="np-compact-desc">' + (p.desc || 'Моментальное получение сразу после оплаты.') + '</p>' +
        '</div>' +
      '</div>' +
      '<div class="np-compact-pills">' + pillsHtml + '</div>' +
      '<p class="np-field-label">Способ оплаты</p>' +
      '<div class="np-pay" id="np-pay">' +
        '<button type="button" class="np-pay-trigger" id="np-pay-trigger" aria-haspopup="listbox" aria-expanded="false">' +
          payIcon(PAY_METHODS[0]) +
          '<span class="np-pay-label" id="np-pay-label">' + PAY_METHODS[0].label + '</span>' +
          '<svg class="np-chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>' +
        '</button>' +
        '<div class="np-pay-list" id="np-pay-list" role="listbox">' +
          PAY_METHODS.map(function(m, i) {
            return '<button type="button" class="np-pay-option' + (i === 0 ? ' selected' : '') + '" role="option" data-pay="' + m.id + '" data-label="' + m.label + '" style="--np-i:' + i + '">' +
                   payIcon(m) + '<span>' + m.label + '</span>' +
                   '<svg class="np-pay-check" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m4 12 5 5L20 6"/></svg>' +
                   '</button>';
          }).join('') +
        '</div>' +
      '</div>' +
      '<div class="np-inputs">' +
        '<label class="np-input-group"><span class="np-field-label">Промокод</span>' +
          '<div class="np-promo-field-wrap">' +
            '<input id="np-promo" type="text" placeholder="Введите промокод…" autocomplete="off" style="text-transform:uppercase">' +
            '<button type="button" id="np-promo-btn" class="np-promo-apply-btn">Применить</button>' +
          '</div>' +
          '<div id="np-promo-feedback" class="np-promo-feedback"></div>' +
              '<div class="np-promo-hint">Первый заказ? Промокод <b>1FIRST</b> даёт −20% на первую покупку.</div>' +
        '</label>' +
      '</div>' +
      '<div class="np-user-balance" id="np-user-balance"></div>' +
      '<div class="np-total"><span>Итого к оплате</span><b id="np-total-value">' + p.price + ' ₽</b></div>' +
      '<button type="button" class="np-submit" id="np-submit">' +
        '<span id="np-submit-action">' + submitActionLabel + '</span> <span id="np-submit-value">' + p.price + ' ₽</span> ' +
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 17 17 7M7 7h10v10"/></svg>' +
      '</button>' +
      '<span class="demo-label">Демо-покупка с локального баланса. Реальные деньги не списываются.</span>' +
    '</div>';
  }

  function wireCompact(p){
    var root = document.getElementById('info-body');
    if (!root) return;
    var basePrice = Number(p.price || 0);
    var state = { price: basePrice, discount: 0, promoCode: '', pay: 'balance' };

    function calculateFinalPrice() {
      if (state.discount > 0) {
        return Math.max(1, Math.round(state.price * (1 - state.discount / 100)));
      }
      return state.price;
    }

    function paint() {
      var finalP = calculateFinalPrice();
      var t = root.querySelector('#np-total-value');
      var s = root.querySelector('#np-submit-value');
      var actionLabel = root.querySelector('#np-submit-action');
      var submitBtn = root.querySelector('#np-submit');

      var acc = (typeof currentAccount === 'function') ? currentAccount() : null;
      var alreadyOwned = acc && Array.isArray(acc.cosmetics) && acc.cosmetics.includes(p.name);

      if (state.discount > 0) {
        var totalHtml = '<span class="np-old-price">' + state.price + ' ₽</span> ' + finalP + ' ₽ <span class="np-discount-pill">-' + state.discount + '%</span>';
        if (t) t.innerHTML = totalHtml;
        if (s) s.textContent = finalP + ' ₽';
      } else {
        var regularText = state.price + ' ₽';
        if (t) t.textContent = regularText;
        if (s) s.textContent = regularText;
      }

      var balEl = root.querySelector('#np-user-balance');
      if (balEl) {
        if (alreadyOwned) {
          balEl.innerHTML = '<span class="np-bal-ok">✓ Эта роль уже добавлена в вашу коллекцию</span>';
          if (submitBtn) {
            submitBtn.style.opacity = '0.75';
            if (actionLabel) actionLabel.textContent = 'Уже в коллекции (';
          }
        } else if (acc) {
          var b = Number(acc.balance || 0);
          if (b >= finalP) {
            balEl.innerHTML = '<span class="np-bal-ok">✓ Ваш баланс: <b>' + b + ' ₽</b> (хватает для оплаты)</span>';
          } else {
            var diff = finalP - b;
            balEl.innerHTML = '<span class="np-bal-warn">Ваш баланс: <b>' + b + ' ₽</b> (не хватает ' + diff + ' ₽)</span>';
          }
        } else {
          balEl.innerHTML = '<span class="np-bal-login">Войдите в аккаунт для оплаты с баланса</span>';
        }
      }
    }

    function applyPromoCode(codeStr) {
      var code = (codeStr || '').trim().toUpperCase();
      var feedback = root.querySelector('#np-promo-feedback');
      var promoInput = root.querySelector('#np-promo');
      if (promoInput && codeStr) promoInput.value = code;

      if (!code) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) feedback.innerHTML = '';
        paint();
        return;
      }

      var promos = getActivePromos();
      var found = promos.find(function(item) {
        return item.code.toUpperCase() === code;
      });

      if (!found) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод «' + code + '» не найден</span>';
        paint();
        return;
      }

      if (!found.active) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод временно приостановлен</span>';
        paint();
        return;
      }

      if (found.usesMax > 0 && found.usedCount >= found.usesMax) {
        state.discount = 0;
        state.promoCode = '';
        if (feedback) feedback.innerHTML = '<span class="np-promo-msg error">✕ Лимит активаций промокода исчерпан</span>';
        paint();
        return;
      }

      if (found.firstOnly) {
        var buyer = (typeof currentAccount === 'function') ? currentAccount() : null;
        if (buyer && window.NCStore && !window.NCStore.promo.isFirstPurchase(buyer.nick)) {
          state.discount = 0;
          state.promoCode = '';
          if (feedback) {
            feedback.innerHTML = '<span class="np-promo-msg error">✕ Промокод «' + found.code + '» действует только на первую покупку</span>';
          }
          paint();
          return;
        }
      }

      state.discount = Number(found.discount) || 0;
      state.promoCode = found.code;
      var discounted = calculateFinalPrice();
      var saved = state.price - discounted;

      if (feedback) {
        feedback.innerHTML = '<span class="np-promo-msg success">✓ Скидка <b>' + found.discount + '%</b> по промокоду <b>' + found.code + '</b> (-' + saved + ' ₽)</span>';
      }
      paint();
    }

    var promoBtn = root.querySelector('#np-promo-btn');
    var promoInp = root.querySelector('#np-promo');
    if (promoBtn && promoInp) {
      promoBtn.addEventListener('click', function() { applyPromoCode(promoInp.value); });
      promoInp.addEventListener('keydown', function(e) {
        if (e.key === 'Enter') { e.preventDefault(); applyPromoCode(promoInp.value); }
      });
      promoInp.addEventListener('input', function() {
        if (!promoInp.value.trim() && state.promoCode) applyPromoCode('');
      });
    }

    setupPaymentDropdown(root, state);

    var submit = root.querySelector('#np-submit');
    if (submit) {
      submit.addEventListener('click', function() {
        var finalP = calculateFinalPrice();
        var appliedPromo = state.promoCode;

        if (typeof serverEnabled === 'function' && !serverEnabled()) {
          if (typeof showNC === 'function') showNC('Сервер временно отключён. Покупки недоступны', 'error');
          return;
        }

        var acc = (typeof currentAccount === 'function') ? currentAccount() : null;
        if (!acc) {
          if (typeof showNC === 'function') showNC('Сначала войдите в аккаунт для покупки', 'error');
          if (typeof openAccount === 'function') openAccount();
          return;
        }

        if (acc.blocked) {
          if (typeof showNC === 'function') showNC('Ваш аккаунт заблокирован', 'error');
          return;
        }

        var isCosmetic = p.category === 'cosmetics' || ['Космический', 'Тень', 'Легенда'].includes(p.name);
        if (isCosmetic && Array.isArray(acc.cosmetics) && acc.cosmetics.includes(p.name)) {
          if (typeof showNC === 'function') showNC('Эта роль уже есть в вашей коллекции', 'info');
          return;
        }

        if (Number(acc.balance || 0) < Number(finalP)) {
          var diff = Number(finalP) - Number(acc.balance || 0);
          if (typeof showNC === 'function') {
            showNC('Недостаточно средств на балансе (не хватает ' + diff + ' ₽). Пополните баланс в личном кабинете.', 'error');
          }
          return;
        }

        var storage = (typeof ncStorage !== 'undefined' ? ncStorage : localStorage);
        var accounts = (typeof getAccounts === 'function') ? getAccounts() : JSON.parse(storage.getItem('nc_accounts') || '[]');
        var targetAcc = accounts.find(function(x) { return x.nick === acc.nick; }) || acc;

        // Списание средств
        targetAcc.balance = Number(targetAcc.balance || 0) - Number(finalP);

        // Расход промокода ТОЛЬКО после успешного списания
        if (appliedPromo) {
          try {
            var pList = JSON.parse(storage.getItem('nc_promos') || '[]');
            var pr = pList.find(function(x) { return x.code.toUpperCase() === appliedPromo.toUpperCase(); });
            if (pr) {
              pr.usedCount = (pr.usedCount || 0) + 1;
              storage.setItem('nc_promos', JSON.stringify(pList));
            }
          } catch(e){}
        }

        // Фиксация ключа / покупки в историю заказов
        try {
          var keys = JSON.parse(storage.getItem('nc_keys') || '[]');
          var codePrefix = isCosmetic ? 'ROLE' : 'RESET';
          var code = codePrefix + '-' + Math.random().toString(36).slice(2, 10).toUpperCase();
          var prodTitle = isCosmetic ? 'Роль «' + p.name + '»' : 'Сброс HWID';
          keys.push({
            code: code,
            days: 0,
            price: Number(finalP),
            name: prodTitle,
            promo: appliedPromo || null,
            used: true,
            usedBy: targetAcc.nick,
            activatedAt: Date.now(),
            autoActivated: true,
            product: prodTitle,
            createdAt: Date.now()
          });
          storage.setItem('nc_keys', JSON.stringify(keys));
        } catch(e){}

        if (isCosmetic) {
          targetAcc.cosmetics = Array.isArray(targetAcc.cosmetics) ? targetAcc.cosmetics : [];
          if (!targetAcc.cosmetics.includes(p.name)) targetAcc.cosmetics.push(p.name);
          if (typeof saveAccounts === 'function') saveAccounts(accounts);
          if (typeof window.closeInfo === 'function') window.closeInfo();
          if (typeof updateProfile === 'function') updateProfile();
          if (typeof showNC === 'function') {
            var promoText = appliedPromo ? ' со скидкой (' + appliedPromo + ')' : '';
            showNC('Роль «' + p.name + '» успешно приобретена' + promoText + ' и добавлена в вашу коллекцию!', 'success');
          }
        } else {
          // Сброс HWID
          targetAcc.hwid = '';
          if (typeof saveAccounts === 'function') saveAccounts(accounts);
          if (typeof window.closeInfo === 'function') window.closeInfo();
          if (typeof updateProfile === 'function') updateProfile();
          if (typeof showNC === 'function') {
            var promoText2 = appliedPromo ? ' со скидкой (' + appliedPromo + ')' : '';
            showNC('Списано ' + finalP + ' ₽' + promoText2 + '. HWID успешно сброшен!', 'success');
          }
        }
      });
    }

    paint();
  }

  // =========================================================================
  // Перехват открытия продуктов и покупки
  // =========================================================================
  var originalAction = window.productAction;
  window.productAction = function(id) {
    if (id === 'collection') {
      if (typeof setFilter === 'function') setFilter('cosmetics');
      if (typeof navigateTo === 'function') navigateTo('#shop');
      return;
    }

    if (typeof PRODUCTS === 'undefined') return originalAction ? originalAction.call(this, id) : null;
    var p = PRODUCTS.find(function(x) { return x.id === id; });
    if (!p) return originalAction ? originalAction.call(this, id) : null;

    var modal = document.getElementById('info-modal');
    if (!modal) return;

    if (p.id === 'rustex') {
      window.showInfo(p.name, buildHTML(p));
      modal.classList.add('np-wide');
      modal.classList.remove('np-compact');
      wire(p);
    } else {
      window.showInfo(p.name, buildCompactHTML(p));
      modal.classList.add('np-compact');
      modal.classList.remove('np-wide');
      wireCompact(p);
    }
  };

  window.cosmeticPurchase = function(name) {
    var p = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(function(x) { return x.name === name; }) : null;
    if (!p) {
      p = {
        id: name === 'Космический' ? 'cosmic' : (name === 'Тень' ? 'shadow' : 'legend'),
        name: name,
        category: 'cosmetics',
        type: 'КОСМЕТИКА',
        price: 39,
        desc: (typeof ROLE_CATALOG !== 'undefined' && ROLE_CATALOG[name]) ? ROLE_CATALOG[name].description : 'Роль в чате сайта.'
      };
    }
    var modal = document.getElementById('info-modal');
    if (!modal) return;
    window.showInfo(p.name, buildCompactHTML(p));
    modal.classList.add('np-compact');
    modal.classList.remove('np-wide');
    wireCompact(p);
  };

  window.confirmReset = function() {
    var p = (typeof PRODUCTS !== 'undefined') ? PRODUCTS.find(function(x) { return x.id === 'reset'; }) : null;
    if (!p) {
      p = {
        id: 'reset',
        name: 'HWID Reset',
        category: 'services',
        type: 'СЕРВИС',
        price: 99,
        desc: 'Новый компьютер — привычные возможности. Мгновенная отвязка текущего ПК в личном кабинете.'
      };
    }
    var modal = document.getElementById('info-modal');
    if (!modal) return;
    window.showInfo(p.name, buildCompactHTML(p));
    modal.classList.add('np-compact');
    modal.classList.remove('np-wide');
    wireCompact(p);
  };

  window.buyProduct = function(name, price, days) {
    if (name === 'HWID-RESET' || name === 'HWID Reset') {
      window.confirmReset();
      return;
    }
    if (['Космический', 'Тень', 'Легенда'].includes(name)) {
      window.cosmeticPurchase(name);
      return;
    }
    window.productAction('rustex');
  };

  var originalClose = window.closeInfo;
  if (typeof originalClose === 'function') {
    window.closeInfo = function(after) {
      var r = originalClose.call(this, after);
      setTimeout(function() {
        var m = document.getElementById('info-modal');
        if (m) m.classList.remove('np-wide', 'np-compact');
      }, 320);
      return r;
    };
  }
})();
