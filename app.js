const ICONS = {"home": "<path d=\"m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-7H9v7H4a1 1 0 0 1-1-1z\"/>", "grid": "<rect x=\"3\" y=\"3\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"14\" y=\"3\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"3\" y=\"14\" width=\"7\" height=\"7\" rx=\"2\"/><rect x=\"14\" y=\"14\" width=\"7\" height=\"7\" rx=\"2\"/>", "spark": "<path d=\"m12 3 2.7 6.3L21 12l-6.3 2.7L12 21l-2.7-6.3L3 12l6.3-2.7z\"/>", "user": "<circle cx=\"12\" cy=\"8\" r=\"4\"/><path d=\"M4 21v-2a8 8 0 0 1 16 0v2\"/>", "chat": "<path d=\"M21 11.5a8.5 8.5 0 0 1-8.5 8.5H3l2-5A8.5 8.5 0 1 1 21 11.5Z\"/><path d=\"M8 11h.01M12 11h.01M16 11h.01\"/>", "headphones": "<path d=\"M3 14v-3a9 9 0 0 1 18 0v3M21 17v2a3 3 0 0 1-3 3h-3\"/><rect x=\"3\" y=\"11\" width=\"4\" height=\"8\" rx=\"2\"/><rect x=\"17\" y=\"11\" width=\"4\" height=\"8\" rx=\"2\"/>", "arrow": "<path d=\"M4 12h16m-6-6 6 6-6 6\"/>", "external": "<path d=\"M7 17 17 7M7 7h10v10\"/>", "chevron": "<path d=\"m9 5 7 7-7 7\"/>", "search": "<circle cx=\"10.5\" cy=\"10.5\" r=\"6.5\"/><path d=\"m16 16 4.5 4.5\"/>", "bell": "<path d=\"M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4\"/>", "check": "<path d=\"m5 12 4 4L19 6\"/>", "shield": "<path d=\"m12 3 8 3v6c0 5-8 9-8 9s-8-4-8-9V6z\"/><path d=\"m8 12 3 3 5-6\"/>", "bolt": "<path d=\"m13 2-9 12h7l-1 8 10-13h-8z\"/>", "cart": "<path d=\"M3 3h2l3 13h11l2-9H6M9 21h.01M18 21h.01\"/>", "reset": "<path d=\"M3 10a9 9 0 1 1 2 8M3 4v6h6\"/>", "discord": "<path d=\"M7 5 4 6S1 12 2 17l5 2 1-2m8 0 1 2 5-2c1-5-2-11-2-11l-3-1-1 2H8z\"/><circle cx=\"8\" cy=\"12\" r=\"1\"/><circle cx=\"16\" cy=\"12\" r=\"1\"/><path d=\"M7 16q5 3 10 0\"/>", "menu": "<path d=\"M4 6h16M4 12h16M4 18h16\"/>", "book": "<path d=\"M4 3h13l3 3v15H4zM8 9h8M8 13h8M8 17h5\"/>"};
function icon(n){return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[n]||ICONS.spark}</svg>`;}
function escapeHTML(value){return String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function safeAvatar(value){return /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(value||'')?value:'';}

// Panel motion uses cancellable animations, so repeated clicks cannot hide a reopened window.
const panelStates=new WeakMap();
let panelOrder=12000;
let pendingCabinetTarget=null;
const reducedMotion=()=>window.matchMedia('(prefers-reduced-motion: reduce)').matches;
function panelParts(el){const card=el.querySelector('.nc-window,.avatar-window,.purchase-window,.info-window');return card?[el,card]:[el];}
function resetPanelMotion(el){const old=panelStates.get(el);if(old){old.cancelled=true;old.animations.forEach(a=>a.cancel());}const state={animations:[],cancelled:false,closing:false};panelStates.set(el,state);return state;}
function openPanel(el,contentOnly=false){
 if(!el)return Promise.resolve();
 const state=resetPanelMotion(el);el.style.zIndex=el.classList.contains('nc-toast')?'200000':String(++panelOrder);
 if(reducedMotion()||!el.animate)return Promise.resolve();
 if(contentOnly){const content=el.querySelector('#info-body')||el;state.animations.push(content.animate([{opacity:.35,transform:'translateY(7px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,easing:'cubic-bezier(.22,1,.36,1)'}));}
 else{const parts=panelParts(el);state.animations.push(el.animate([{opacity:0},{opacity:1}],{duration:300,easing:'ease-out'}));const card=parts[1]||el;state.animations.push(card.animate([{transform:'translateY(18px) scale(.98)'},{transform:'translateY(0) scale(1)'}],{duration:420,easing:'cubic-bezier(.22,1,.36,1)'}));}
 return Promise.all(state.animations.map(a=>a.finished.catch(()=>{})));
}
function closePanel(el,done){
 if(!el){done?.();return Promise.resolve();}
 if(panelStates.get(el)?.closing)return panelStates.get(el).promise;
 const state=resetPanelMotion(el);state.closing=true;
 const finish=()=>{if(state.cancelled)return;done?.();state.animations.forEach(a=>a.cancel());panelStates.delete(el);};
 if(reducedMotion()||!el.animate||el.hidden||getComputedStyle(el).display==='none'){finish();return Promise.resolve();}
 state.animations.push(el.animate([{opacity:1},{opacity:0}],{duration:240,easing:'ease-in',fill:'forwards'}));
 const card=panelParts(el)[1]||el;state.animations.push(card.animate([{transform:'translateY(0) scale(1)'},{transform:'translateY(10px) scale(.987)'}],{duration:240,easing:'ease-in',fill:'forwards'}));
 state.promise=Promise.all(state.animations.map(a=>a.finished.catch(()=>{}))).then(finish);return state.promise;
}
function navigateTo(target){const el=typeof target==='string'?document.querySelector(target):target;if(!el)return;el.scrollIntoView({behavior:reducedMotion()?'instant':'smooth',block:'start'});}
function navigateToParameter(target){
 const el=document.querySelector(target);if(!el)return;
 document.querySelectorAll('[data-cabinet-target]').forEach(b=>{const selected=b.dataset.cabinetTarget===target;b.classList.toggle('selected',selected);b.setAttribute('aria-pressed',selected);});
 const anchor=el.matches('input')?(el.closest('.cabinet-key-row')||el.closest('.chat-send')||el):el;
 if(el.matches('input,button'))el.focus({preventScroll:true});
 anchor.scrollIntoView({behavior:reducedMotion()?'instant':'smooth',block:el.matches('input')?'center':'start'});
 if(!reducedMotion()&&anchor.animate)anchor.animate([{outline:'2px solid transparent',outlineOffset:'6px'},{outline:'2px solid #ad80ed99',outlineOffset:'6px'},{outline:'2px solid transparent',outlineOffset:'6px'}],{duration:1300,easing:'ease-in-out'});
}
function resumeCabinetTarget(){if(!pendingCabinetTarget)return;const target=pendingCabinetTarget;pendingCabinetTarget=null;openCabinet(target);}

const PRODUCTS=[
 {id:'rustex',name:'Чит',purchaseName:'Rustex',category:'software',type:'СОФТ',price:59,period:' / 7 дней',desc:'Больше возможностей для твоей игры.',features:['Лаунчер','RustEx'],tag:'ПОПУЛЯРНОЕ',art:'software'},
 {id:'cosmic',name:'Космический',category:'cosmetics',type:'КОСМЕТИКА',price:39,period:' / навсегда',desc:'Твой собственный след среди звёзд.',features:['Роль в чате','Можно снять'],tag:'НОВИНКА',art:'cosmetic'},
 {id:'shadow',name:'Тень',category:'cosmetics',type:'КОСМЕТИКА',price:39,period:' / навсегда',desc:'Тёмная эстетика. Яркая индивидуальность.',features:['Роль в чате','Можно снять'],tag:'КОЛЛЕКЦИЯ',art:'cosmetic'},
 {id:'legend',name:'Легенда',category:'cosmetics',type:'КОСМЕТИКА',price:39,period:' / навсегда',desc:'Для тех, кто оставляет свой след.',features:['Роль в чате','Можно снять'],tag:'КОЛЛЕКЦИЯ',art:'cosmetic'},
 {id:'reset',name:'HWID Reset',category:'services',type:'СЕРВИС',price:99,period:' / сброс',desc:'Новый компьютер — привычные возможности.',features:['Сброс привязки','В личном кабинете'],tag:'СЕРВИС',art:'service'}
];
let activeCategory='all';
function renderProducts(category='all'){
 const products=category==='all'?[PRODUCTS[0],{...PRODUCTS[1],id:'collection',name:'Косметика',desc:'Выделяйся. Создавай свой уникальный стиль.',features:['3 уникальные роли','Навсегда']},PRODUCTS[4]]:PRODUCTS.filter(p=>p.category===category);
 document.getElementById('products').innerHTML=products.map((p,i)=>`<article class="product-card" data-product-id="${p.id}" style="animation-delay:${i*55}ms"><div class="product-art ${p.art}"><div class="product-tags"><span class="tag ${p.id==='rustex'?'green':''}"><i class="tag-dot"></i>${p.tag}</span><span class="tag-id">NC / 0${PRODUCTS.findIndex(x=>x.id===p.id)+1||2}</span></div>${p.art==='software'?'<img src="assets/nc_logo.webp" alt="Логотип NOCTURNE">':p.art==='cosmetic'?`<img src="assets/blackhole.webp" alt="Космическая коллекция" style="${p.id==='shadow'?'filter:hue-rotate(245deg) saturate(.35) brightness(.65)':p.id==='legend'?'filter:hue-rotate(325deg) saturate(.7)':''}">`:`<span class="reset-symbol">${icon('reset')}</span>`}</div><div class="product-body"><div class="product-title"><h3>${p.name}</h3><span class="type">${p.type}</span></div><p>${p.desc}</p><div class="product-features">${p.features.map(f=>`<span>${icon('check')}${f}</span>`).join('')}</div><div class="product-bottom"><span class="price">${p.id==='rustex'||p.id==='collection'?'<small>от </small>':''}${p.price} <small>₽</small><small class="per">${p.period}</small></span><button class="product-buy" onclick="productAction('${p.id}')" aria-label="${p.id==='collection'?'Выбрать косметику':'Купить '+p.name}">${p.id==='collection'?'Выбрать':'Подробнее'} ${icon('arrow')}</button></div></div></article>`).join('');
}
function setFilter(category){
 activeCategory=category;renderProducts(category);
 if(!reducedMotion()){document.querySelectorAll('.product-card').forEach((card,i)=>{if(card.animate)card.animate([{opacity:0,transform:'translateY(6px)'},{opacity:1,transform:'translateY(0)'}],{duration:280,delay:i*25,easing:'cubic-bezier(.22,1,.36,1)',fill:'backwards'});});}
 document.querySelectorAll('[data-category]').forEach(b=>{b.classList.toggle('selected',b.dataset.category===category);b.setAttribute('aria-pressed',b.dataset.category===category);});
}
function productAction(id){
 if(id==='collection'){setFilter('cosmetics');navigateTo('#shop');return;}
 const p=PRODUCTS.find(x=>x.id===id);if(!p)return;
 showInfo(p.name,`<p>${p.desc}</p><ul>${p.features.map(f=>`<li>${f}</li>`).join('')}</ul>${p.id==='rustex'?'<h3>Выберите свой срок</h3><p>7 дней — 59 ₽ · 14 дней — 100 ₽<br>30 дней — 200 ₽ · 90 дней — 500 ₽<br>180 дней — 800 ₽</p>':`<h3>${p.price} ₽ <span class="muted">${p.period}</span></h3>`}<button class="button primary" onclick="closeInfo();buyProduct('${p.id==='reset'?'HWID-RESET':(p.purchaseName||p.name)}',${p.price},${p.id==='rustex'?'undefined':'0'})">${icon('cart')} ${p.id==='rustex'?'Выбрать подписку':'Перейти к покупке'}</button><span class="demo-label">Демо-покупка с локального баланса. Реальные деньги не списываются.</span>`);
}
function toggleMenu(force){const open=force??!document.querySelector('.sidebar').classList.contains('open');document.querySelector('.sidebar').classList.toggle('open',open);document.querySelector('.nav-scrim').classList.toggle('open',open);document.querySelector('.mobile-toggle').setAttribute('aria-expanded',open);}
function markNav(hash){document.querySelectorAll('nav a').forEach(a=>{const active=a.getAttribute('href')===hash;a.classList.toggle('active',active);if(active)a.setAttribute('aria-current','page');else a.removeAttribute('aria-current');});const labels={'#home':'Главная','#shop':'Каталог продуктов','#cosmetics':'Косметика','#news':'Новости','#community':'Сообщество','#support':'Поддержка','#account':'Личный кабинет'};document.getElementById('page-label').textContent=labels[hash]||'Главная';}
document.querySelectorAll('a[href^="#"]').forEach(a=>a.addEventListener('click',e=>{e.preventDefault();const hash=a.getAttribute('href');toggleMenu(false);if(hash==='#account'){goToCabinet();return;}const sectionDialogs={'#news':showNews,'#community':showCommunity,'#support':showHelp};if(sectionDialogs[hash]){sectionDialogs[hash]();return;}if(a.dataset.filter)setFilter(a.dataset.filter);const target=document.querySelector(hash==='#cosmetics'?'#shop':hash);if(target){markNav(hash);navigateTo(target);try{history.replaceState(null,'',hash);}catch{}}}));
document.querySelectorAll('[data-category]').forEach(b=>b.addEventListener('click',()=>setFilter(b.dataset.category)));
function showInfo(title,html){const m=document.getElementById('info-modal');const wasOpen=!m.hidden&&!panelStates.get(m)?.closing;document.getElementById('info-title').textContent=title;document.getElementById('info-body').innerHTML=html;m.hidden=false;openPanel(m,wasOpen);}
function closeInfo(after){const m=document.getElementById('info-modal');return closePanel(m,()=>{m.hidden=true;if(typeof after==='function')after();});}
function showNews(){showInfo('Новая эра. Cosmic Update.',`<span class="section-kicker">12 АПРЕЛЯ 2025 · ОБНОВЛЕНИЕ ПЛАТФОРМЫ</span><p style="margin-top:17px">NOCTURNE — пространство для твоей игры. В новой версии космический стиль стал частью каждого экрана.</p><h3>Что изменилось в интерфейсе</h3><ul><li>Новый каталог с категориями и поиском.</li><li>Удобный личный кабинет: подписка, ключи и косметика.</li><li>Адаптивный интерфейс для телефона и компьютера.</li><li>Понятные цены и подтверждение перед покупкой.</li></ul><button class="button primary" onclick="closeInfo();navigateTo('#shop')">Посмотреть продукты ${icon('arrow')}</button>`);}
function showAbout(){showInfo('За пределами привычного.',`<p>NOCTURNE — твоя игровая вселенная. Софты, косметика, личный кабинет и сообщество в одном пространстве.</p><h3>Cosmic Edition / v12.0</h3><p>Мы сохранили космический характер проекта и сделали интерфейс проще: меньше визуального шума, больше внимания к тому, что важно тебе.</p><span class="demo-label">Это локальная демо-версия. Аккаунты, баланс, чат и покупки хранятся в браузере. Сервер и платёжная система не подключены.</span>`);}
function showPrivacy(){showInfo('Твои данные',`<p>Демо-версия хранит никнейм, пароль, аватар, подписки и сообщения в localStorage этого браузера. Email при регистрации не нужен. Данные не отправляются на сервер.</p><h3>Важно знать</h3><p>Не используй настоящий пароль или личные данные. Локальное хранилище не защищает данные от других пользователей этого компьютера или изменений через инструменты разработчика.</p><p>Чтобы удалить данные, очисти данные сайта в настройках браузера. Это удалит и демо-покупки.</p>`);}
function showCommunity(){showInfo('Свои люди. Твоя орбита.',`<p>Общайся с сообществом NOCTURNE, делись идеями и следи за обновлениями.</p><h3>Discord · скоро на связи</h3><p>Приглашение на сервер ещё не настроено владельцем сайта. Пока можно попробовать локальный чат в личном кабинете.</p><button class="button primary" onclick="closeInfo(()=>goToCabinet('#chat-input'))">${icon('chat')} Открыть демо-чат</button><span class="demo-label">Сообщения видны только в этом браузере. Общий онлайн-чат ещё не подключён.</span>`);}
function showHelp(){showInfo('Центр поддержки',`<p>Разберёмся вместе. Самое важное — ниже.</p><details open><summary>Как начать пользоваться?</summary><p>Создай демо-аккаунт, открой каталог и выбери продукт. Данные сохранятся в этом браузере.</p></details><details><summary>Как купить подписку?</summary><p>Выбери «Лаунчер RustEx» и нужный срок. Демо-покупка списывает средства с локального баланса. Пополнение и реальные платежи не подключены.</p></details><details><summary>Где активировать ключ?</summary><p>В личном кабинете, в блоке «Информация об аккаунте». Демо-ключ можно создать в локальной админ-панели.</p></details><details><summary>Как работает лоадер?</summary><p>Скачайте его в личном кабинете. Вход в лоадер — по аккаунту и активной подписке; файл чита сервер отдаёт по одноразовой ссылке.</p></details><details><summary>Где задать вопрос?</summary><p>В личном кабинете, раздел «Тикеты». Каждое обращение — отдельный тикет: видно статус, ответы и имя сотрудника, который взял его в работу.</p></details><button class="button primary" onclick="closeInfo(()=>goToCabinet('#cabinet-tickets'))">${icon('headphones')} Открыть тикеты</button>`);}
function openSearch(){showInfo('Найди своё',`<label for="product-search" class="muted">Поиск по каталогу</label><input id="product-search" class="search-input" type="search" placeholder="RustEx, лаунчер, косметика…" autocomplete="off"><div id="search-results" class="search-results" aria-live="polite"></div>`);const input=document.querySelector('#product-search');input.addEventListener('input',()=>renderSearch(input.value));renderSearch('');setTimeout(()=>input.focus(),30);}
function renderSearch(query){const q=query.trim().toLocaleLowerCase('ru');const results=PRODUCTS.filter(p=>(p.name+' '+(p.purchaseName||'')+' '+p.features.join(' ')+' '+p.desc+' '+p.type).toLocaleLowerCase('ru').includes(q));document.getElementById('search-results').innerHTML=results.map(p=>`<button class="search-result" onclick="productAction('${p.id}')"><span>${p.name}</span><small>${p.id==='rustex'?'от ':''}${p.price} ₽ →</small></button>`).join('')||'<p class="chat-empty">Ничего не найдено. Попробуй «RustEx» или «косметика».</p>';}
function confirmReset(){
  if(typeof window.productAction==='function')return window.productAction('reset');
  showInfo('Сбросить HWID?',`<p>Текущая привязка к компьютеру будет удалена. С локального баланса спишется <b>99 ₽</b>.</p><button class="confirm-button" onclick="finishHwidPurchase(99);closeInfo()">Подтвердить · 99 ₽</button><button class="purchase-cancel" onclick="closeInfo()">Отмена</button>`);
}
function cosmeticPurchase(name){
  const idMap={'Космический':'cosmic','Тень':'shadow','Легенда':'legend'};
  const id=idMap[name];
  if(id&&typeof window.productAction==='function')return window.productAction(id);
  const a=currentAccount();if(a?.cosmetics?.includes(name))return showNC('Эта роль уже есть в твоей коллекции','info');
  showInfo('Роль «'+name+'»',`<p>Добавить роль в твою коллекцию навсегда?<br>С локального баланса спишется <b>39 ₽</b>.</p><button class="confirm-button" onclick="finishCosmetic('${name}')">Подтвердить · 39 ₽</button><button class="purchase-cancel" onclick="closeInfo()">Отмена</button>`);
}
function finishCosmetic(name){if(!['Космический','Тень','Легенда'].includes(name))return;if(!serverEnabled())return showNC('Покупки временно недоступны','error');const accounts=getAccounts(),a=accounts.find(x=>x.nick===ncStorage.getItem('nc_session'));if(!a||a.blocked)return showNC('Войдите в доступный аккаунт','error');if(a.cosmetics?.includes(name))return showNC('Эта роль уже куплена','info');if(Number(a.balance||0)<39)return showNC('Недостаточно средств на локальном балансе','error');a.balance=Number(a.balance)-39;a.cosmetics=[...(a.cosmetics||[]),name];saveAccounts(accounts);closeInfo();updateProfile();showNC('Роль «'+name+'» добавлена в коллекцию','success');}
function renderWardrobe(){
 const account=currentAccount(),owned=document.getElementById('owned-cosmetics');
 const roles=[...new Set(account?.cosmetics||[])].filter(n=>Object.prototype.hasOwnProperty.call(ROLE_CATALOG,n));
 const active=equippedRoleOf(account);
 if(owned)owned.innerHTML='<div class="role-section-heading"><div><h2>Моя косметика</h2><p>Надень роль — она появится рядом с ником в чате. Активна только одна роль.</p></div><span class="role-count">'+roles.length+' / 3</span></div>'+(roles.length?'<div class="wardrobe">'+roles.map(name=>{const r=ROLE_CATALOG[name],on=active===name;return `<article class="wardrobe-item role-${r.key}${on?' equipped':''}"><span class="wardrobe-status">${on?'● Надета':'В коллекции'}</span><div class="wardrobe-icon" aria-hidden="true">${r.symbol}</div>${roleBadgeHTML(name)}<p class="wardrobe-description">${r.description}</p><button class="wardrobe-toggle" data-role="${r.key}" aria-pressed="${on}" aria-label="${on?'Снять':'Надеть'} роль ${name}" onclick="toggleEquippedRole('${name}')">${on?'Снять роль':'Надеть роль'}</button></article>`;}).join('')+'</div>':'<div class="role-empty">Твоя коллекция пока пуста. Приобретённые роли появятся здесь.<button onclick="browseCosmetics()">Выбрать косметику →</button></div>');
 const identity=document.getElementById('chat-identity');
 if(identity){const staffRole=window.staffRoleForNick?staffRoleForNick(account?.nick):'';const media=window.chatMediaRole?chatMediaRole(account):'';const badge=staffRole&&window.staffChatBadge?staffChatBadge(staffRole):(media&&window.mediaChatBadge?mediaChatBadge(media):(active?roleBadgeHTML(active):'<span class="role-none">Без роли</span>'));identity.innerHTML='<span>В чате:</span><strong>'+escapeHTML(account?.nick||'Гость')+'</strong>'+badge+'<button class="role-manage" onclick="openWardrobe()">Сменить роль →</button>';}
}
function toggleEquippedRole(name){
 if(!Object.prototype.hasOwnProperty.call(ROLE_CATALOG,name))return;
 const list=getAccounts(),account=list.find(a=>a.nick===ncStorage.getItem('nc_session'));
 if(!account)return showNC('Сначала войдите в аккаунт','error');
 if(account.blocked)return showNC('Аккаунт заблокирован','error');
 if(!Array.isArray(account.cosmetics)||!account.cosmetics.includes(name))return showNC('Этой роли ещё нет в твоей коллекции','error');
 const takingOff=equippedRoleOf(account)===name;
 account.equippedRole=takingOff?null:name;saveAccounts(list);updateProfile();
 document.querySelector('[data-role="'+ROLE_CATALOG[name].key+'"]').focus({preventScroll:true});
 showNC(takingOff?'Роль снята. В чате отображается только ник.':'Роль «'+name+'» надета и видна в чате.','success');
}
function refreshDashboard(){renderWardrobe();const label=document.getElementById('server-label');if(label){label.textContent=serverEnabled()?'Все системы работают':'Технические работы';label.parentElement.previousElementSibling.style.background=serverEnabled()?'var(--green)':'#eaaa6e';}}
// All overlays support Escape, backdrop close, focus trapping and focus return.
function currentOverlay(){return [...document.querySelectorAll('.nc-modal,.avatar-modal,.purchase-modal,.info-modal,.account-card')].filter(el=>!el.hidden&&getComputedStyle(el).display!=='none'&&(el.classList.contains('visible')||el.classList.contains('show')||el.classList.contains('purchase-modal')||el.classList.contains('info-modal'))).sort((a,b)=>Number(getComputedStyle(a).zIndex)-Number(getComputedStyle(b).zIndex)).pop();}
let lastOverlay=null,restoreFocus=null;
const overlayObserver=new MutationObserver(()=>{const overlay=currentOverlay();if(overlay===lastOverlay)return;if(overlay){if(!lastOverlay)restoreFocus=document.activeElement;const dialog=overlay.querySelector('.nc-window,.avatar-window,.purchase-window,.info-window')||overlay;dialog.setAttribute('role','dialog');dialog.setAttribute('aria-modal','true');dialog.setAttribute('aria-label',dialog.querySelector('h2,h3')?.textContent||'Личный кабинет');dialog.setAttribute('tabindex','-1');const focus=dialog.querySelector('input:not([type="file"]),button');(focus&&getComputedStyle(focus).display!=='none'?focus:dialog).focus({preventScroll:true});document.body.style.overflow='hidden';}else{document.body.style.overflow='';if(restoreFocus?.isConnected)restoreFocus.focus({preventScroll:true});}document.querySelector('.workspace').inert=!!overlay;document.querySelector('.sidebar').inert=!!overlay;lastOverlay=overlay;});
overlayObserver.observe(document.body,{subtree:true,attributes:true,attributeFilter:['class','style','hidden'],childList:true});
function closeTopOverlay(){const m=currentOverlay();if(!m)return;if(m.id==='info-modal')closeInfo();else if(m.id==='nc-modal')closeAccount();else if(m.id==='avatar-modal')closeAvatarPicker();else if(m.id==='account')closeCabinet();else closePanel(m,()=>m.remove());}
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(currentOverlay())closeTopOverlay();else toggleMenu(false);}if(e.key==='/'&&!['INPUT','TEXTAREA'].includes(document.activeElement.tagName)&&!currentOverlay()){e.preventDefault();openSearch();}if(e.key==='Tab'){const m=currentOverlay();if(!m)return;const focusable=[...m.querySelectorAll('button,a[href],input,summary,[tabindex="0"]')].filter(el=>!el.disabled&&el.getClientRects().length);if(!focusable.length)return;const first=focusable[0],last=focusable[focusable.length-1];if(e.shiftKey&&(document.activeElement===first||!focusable.includes(document.activeElement))){last.focus();e.preventDefault();}else if(!e.shiftKey&&(document.activeElement===last||!focusable.includes(document.activeElement))){first.focus();e.preventDefault();}}});
document.addEventListener('click',e=>{if(e.target===currentOverlay()&&!e.target.classList.contains('account-card'))closeTopOverlay();});
document.querySelectorAll('.nc-window input').forEach(i=>{i.setAttribute('aria-label',i.placeholder);i.addEventListener('keydown',e=>{if(e.key==='Enter')submitNC();});});
document.querySelectorAll('.cabinet-close,.avatar-close').forEach(b=>b.setAttribute('aria-label','Закрыть'));
['chat','support'].forEach(kind=>{const input=document.getElementById(kind+'-input');if(!input)return;input.maxLength=1000;input.setAttribute('aria-label',kind==='chat'?'Сообщение в локальный чат':'Локальное обращение');input.addEventListener('keydown',e=>{if(e.key==='Enter')(kind==='chat'?sendChat:sendSupport)();});});
document.querySelector('#cabinet-key').setAttribute('aria-label','Ключ подписки');
document.querySelector('#loader-download').addEventListener('click',e=>{if(!serverEnabled()){e.preventDefault();showNC('Скачивание временно недоступно','error');}});
window.addEventListener('storage',()=>{updateProfile();});
document.getElementById('products').addEventListener('click',e=>{if(e.target.closest('button,a,input'))return;const card=e.target.closest('[data-product-id]');if(card)productAction(card.dataset.productId);});
renderProducts();updateProfile();markNav('#home');
if(location.hash==='#cosmetics'){setFilter('cosmetics');navigateTo('#shop');markNav('#cosmetics');}

function openWardrobe(){navigateToParameter('#owned-cosmetics');}
function browseCosmetics(){const c=document.getElementById('account');closePanel(c,()=>{c.classList.remove('visible');document.body.classList.remove('cabinet-open');setFilter('cosmetics');navigateTo('#shop');});}

// =============================================================================
// NOCTURNE Live Clock — отображение времени на сайте
// =============================================================================
function updateNcTopClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  
  const el = document.getElementById('nc-clock-digits');
  if (el) el.textContent = `${h}:${m}:${s}`;

  const tip = document.getElementById('nc-clock-tooltip');
  if (tip) {
    const days = ['Воскресенье','Понедельник','Вторник','Среда','Четверг','Пятница','Суббота'];
    const months = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    tip.textContent = `✦ ${days[now.getDay()]}, ${now.getDate()} ${months[now.getMonth()]} · Время сервера`;
  }
}
setInterval(updateNcTopClock, 250);
updateNcTopClock();

