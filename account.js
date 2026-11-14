const ncStorage = (() => {
 try { const s=window.localStorage; s.getItem('nc_session'); return s; }
 catch { const memory=new Map(); return {getItem:k=>memory.get(k)??null,setItem:(k,v)=>memory.set(k,String(v)),removeItem:k=>memory.delete(k),clear:()=>memory.clear()}; }
})();
let ncMode='login';
function getAccounts(){let a=JSON.parse(ncStorage.getItem('nc_accounts')||'null');if(!a){const old=JSON.parse(ncStorage.getItem('nc_account')||'null');a=old?[old]:[];ncStorage.setItem('nc_accounts',JSON.stringify(a));}return a;}
function saveAccounts(a){ncStorage.setItem('nc_accounts',JSON.stringify(a));}
function currentAccount(){return getAccounts().find(a=>a.nick===ncStorage.getItem('nc_session'));}
function serverEnabled(){return ncStorage.getItem('nc_server_enabled')!=='false';}
function extendRustexSubscription(account,days){
 const now=Date.now();
 const currentUntil=(window.NCStore&&NCStore.isSubActive(account))?Number((NCStore.subscription(account)||{}).until)||now:now;
 const until=currentUntil+Number(days)*86400000;
 const totalDays=Math.max(0,Math.ceil((until-now)/86400000));
 account.subscription={name:'RustexOrg · '+totalDays+' дней',days:totalDays,until};
 account.lastSubscription={name:'RustexOrg · '+totalDays+' дней',days:totalDays,until,updatedAt:now};
 return totalDays;
}
function buyProduct(name,price,days){
 if(!serverEnabled())return showNC('Сервер временно отключён. Покупки недоступны','error');
 const a=currentAccount(); if(!a){openAccount();return showNC('Сначала войдите в аккаунт');}
 if(a.blocked)return showNC('Аккаунт заблокирован');
 if(name==='HWID-RESET'||name==='HWID Reset')return confirmReset();
 if(['Космический','Тень','Легенда'].includes(name))return cosmeticPurchase(name);
 if((name==='Rustex'||name==='Чит')&&typeof window.productAction==='function')return window.productAction('rustex');
 const opts=[{d:7,p:59},{d:14,p:100},{d:30,p:200},{d:90,p:500},{d:180,p:800}]; const box=document.createElement('div');box.className='purchase-modal';box.innerHTML='<div class="purchase-window"><h3>Выберите срок · '+(name==='Rustex'?'Лаунчер RustEx':escapeHTML(name))+'</h3><p>Деньги будут списаны с баланса сайта.</p><div class="purchase-options">'+opts.map(o=>`<button onclick="finishPurchase('${name}',${o.d},${o.p},this)">${o.d} дней · ${o.p} ₽</button>`).join('')+'</div><button class="purchase-cancel" onclick="closePanel(this.closest(\'.purchase-modal\'),()=>this.closest(\'.purchase-modal\').remove())">Отмена</button></div>';document.body.appendChild(box);openPanel(box);
}
function finishPurchase(name,days,price,btn,promoCode){
 if(!serverEnabled())return showNC('Сервер временно отключён. Покупки недоступны','error');
 const accounts=getAccounts(),a=accounts.find(x=>x.nick===ncStorage.getItem('nc_session'));
 if(!a)return showNC('Сначала войдите в аккаунт','error');
 if(a.blocked)return showNC('Аккаунт заблокирован','error');
 if(promoCode){
   try {
     const pList = JSON.parse(ncStorage.getItem('nc_promos') || '[]');
     const pr = pList.find(x => String(x.code).toUpperCase() === String(promoCode).toUpperCase());
     if(pr && pr.firstOnly && window.NCStore && !NCStore.promo.isFirstPurchase(a.nick)){
       return showNC('Промокод '+pr.code+' действует только на первую покупку','error');
     }
   } catch(e){}
 }
 if(Number(a.balance||0)<Number(price))return showNC('Недостаточно средств на балансе сайта','error');
 a.balance=Number(a.balance||0)-Number(price);
 if(promoCode){
   try {
     const pList = JSON.parse(ncStorage.getItem('nc_promos') || '[]');
     const pr = pList.find(x => x.code.toUpperCase() === String(promoCode).toUpperCase());
     if(pr){
       pr.usedCount = (pr.usedCount || 0) + 1;
       ncStorage.setItem('nc_promos', JSON.stringify(pList));
     }
   } catch(e){}
 }
 const totalDays=extendRustexSubscription(a,days);
 const code='RUSTEX-'+Math.random().toString(36).slice(2,10).toUpperCase();
 const keys=JSON.parse(ncStorage.getItem('nc_keys')||'[]');
 keys.push({code,name:'RustexOrg',days:Number(days),price:Number(price),promo:promoCode||null,used:true,usedBy:a.nick,activatedAt:Date.now(),autoActivated:true,product:'RustexOrg',createdAt:Date.now()});
 saveAccounts(accounts);
 ncStorage.setItem('nc_keys',JSON.stringify(keys));
 const modal=btn&&btn.closest?btn.closest('.purchase-modal'):null;if(modal)closePanel(modal,()=>modal.remove());
 updateProfile();
 if(promoCode){
   showNC('Покупка со скидкой ('+promoCode+'): списано '+price+' ₽, подписка теперь '+totalDays+' дней!','success');
 } else {
   showNC('Покупка успешна: списано '+price+' ₽, подписка теперь '+totalDays+' дней','success');
 }
}
function finishHwidPurchase(price){
 if(!serverEnabled())return showNC('Сервер временно отключён. Сброс HWID недоступен','error');
 const accounts=getAccounts(),a=accounts.find(x=>x.nick===ncStorage.getItem('nc_session'));
 if(!a)return showNC('Сначала войдите в аккаунт','error');
 if(a.blocked)return showNC('Аккаунт заблокирован','error');
 if(Number(a.balance||0)<price)return showNC('Недостаточно средств на балансе сайта','error');
 a.balance=Number(a.balance||0)-price;a.hwid='';saveAccounts(accounts);updateProfile();showNC('Списано '+price+' ₽. HWID сброшен','success');
}
function openAvatarPicker(){const m=document.getElementById('avatar-modal');if(!m)return;m.classList.add('show');m.setAttribute('aria-hidden','false');openPanel(m);const input=document.getElementById('avatar-file');if(input){input.value='';input.onchange=()=>{const f=input.files&&input.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{const p=document.getElementById('avatar-preview');if(p)p.innerHTML='<img src="'+r.result+'" alt="Предпросмотр">';};r.readAsDataURL(f);};}const p=document.getElementById('avatar-preview');const a=currentAccount();if(p)p.innerHTML=a&&a.avatar?'<img src="'+a.avatar+'" alt="Предпросмотр">':'◈';}
function closeAvatarPicker(){const m=document.getElementById('avatar-modal');if(m)closePanel(m,()=>{m.classList.remove('show');m.setAttribute('aria-hidden','true');});}
function saveAvatarFile(){const input=document.getElementById('avatar-file'),file=input&&input.files&&input.files[0];if(!file)return showNC('Сначала выберите изображение');if(file.size>8*1024*1024)return showNC('Файл слишком большой (максимум 8 МБ)','error');const reader=new FileReader();reader.onload=()=>{const img=new Image();img.onload=()=>{const scale=Math.min(1,512/Math.max(img.width,img.height)),canvas=document.createElement('canvas');canvas.width=Math.max(1,Math.round(img.width*scale));canvas.height=Math.max(1,Math.round(img.height*scale));canvas.getContext('2d').drawImage(img,0,0,canvas.width,canvas.height);const data=canvas.toDataURL('image/jpeg',.86),accounts=getAccounts(),a=accounts.find(x=>x.nick===ncStorage.getItem('nc_session'));if(!a)return;a.avatar=data;saveAccounts(accounts);updateProfile();closeAvatarPicker();showNC('Аватарка обновлена','success');};img.src=reader.result;};reader.readAsDataURL(file);}
function sendChat(){const a=currentAccount(),i=document.getElementById('chat-input');if(!a||!i||!i.value.trim())return;if(a.blocked)return showNC('Аккаунт заблокирован','error');const c=JSON.parse(ncStorage.getItem('nc_chat')||'[]');c.push({nick:a.nick,text:i.value.trim().slice(0,1000),time:Date.now()});ncStorage.setItem('nc_chat',JSON.stringify(c));i.value='';renderChat();i.focus();}
let chatRendered='';
function renderChat(){
 const el=document.getElementById('chat-messages');if(!el)return;
 const raw=ncStorage.getItem('nc_chat')||'[]';
 const messages=JSON.parse(raw);
 chatRendered=raw;
 const members=new Map(getAccounts().map(a=>[a.nick,a]));
 el.innerHTML=messages.slice(-50).map(m=>{
  const member=members.get(m.nick);
  const staffRole=m.staff?m.role:(window.staffRoleForNick?staffRoleForNick(m.nick):'');
  const media=!staffRole&&window.chatMediaRole?chatMediaRole(member):'';
  const badge=staffRole&&window.staffChatBadge?staffChatBadge(staffRole):(media&&window.mediaChatBadge?mediaChatBadge(media):roleBadgeHTML(equippedRoleOf(member)));
  const timestamp=Number(m.time);const time=Number.isFinite(timestamp)?new Date(timestamp).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}):'';
  return `<div class="chat-msg"><div class="chat-msg-header"><b>${escapeHTML(m.nick)}</b>${badge}<time>${escapeHTML(time)}</time></div><span class="chat-message-text">${escapeHTML(m.text)}</span></div>`;
 }).join('')||'<p class="chat-empty">Сообщений пока нет. Это локальный демо-чат.</p>';
 el.scrollTop=el.scrollHeight;
}
// Сообщение должно появляться сразу, без перезагрузки: если запись чата
// изменилась в другой вкладке или её изменил сотрудник, подхватываем её сами.
function syncChat(){const raw=ncStorage.getItem('nc_chat')||'[]';if(raw!==chatRendered)renderChat();}
setInterval(syncChat,1500);
function sendSupport(){renderSupport();}
function renderSupport(){renderTickets();}
function renderTickets(){const e=document.getElementById('cabinet-tickets-list');if(e&&window.NCTickets)window.NCTickets.renderPlayer(e);}
function setNCMode(mode){
 ncMode=mode;
 const title=document.getElementById('nc-title');
 const action=document.getElementById('nc-action');
 const switcher=document.getElementById('nc-switcher');
 if(mode==='register'){
  title.textContent='Регистрация'; action.textContent='Зарегистрироваться';
  switcher.innerHTML='Уже есть аккаунт? <button type="button" onclick="setNCMode(\'login\')">Войти</button>';
 }else{
  title.textContent='Вход в аккаунт'; action.textContent='Войти';
  switcher.innerHTML='Нет аккаунта? <button type="button" onclick="setNCMode(\'register\')">Зарегистрироваться</button>';
 }
}
function submitNC(){
 const nickInput=document.querySelector('.nc-window input[autocomplete="username"]');
 const passInput=document.querySelector('.nc-window input[type="password"]');
 const nick=nickInput?nickInput.value.trim():'';
 const pass=passInput?passInput.value:'';
 if(nick.length>24)return showNC('Никнейм — не больше 24 символов','error');
 if(ncMode==='register'&&pass.length<6)return showNC('Пароль — минимум 6 символов','error');
 if(!nick || !pass){showNC('Заполни все поля');return;}
 const accounts=getAccounts(); const saved=accounts.find(a=>a.nick===nick);
 if(ncMode==='register'){
  if(saved){showNC('Этот логин уже зарегистрирован');return;} 
  if(accounts.length>=3){showNC('Можно зарегистрировать максимум 3 аккаунта');return;}
  accounts.push({nick,pass,verified:true,createdAt:new Date().toISOString(),balance:0,subscription:null,hwid:'',blocked:false});
  saveAccounts(accounts);
  ncStorage.setItem('nc_session',nick); closeAccount(()=>resumeCabinetTarget()); updateProfile(); showNC('Демо-аккаунт создан. Добро пожаловать!','success');
  return;
 }else{
  if(!saved){showNC('Сначала зарегистрируй аккаунт');return;}
  if(saved.nick!==nick || saved.pass!==pass){showNC('Неверный ник или пароль');return;}
  if(saved.blocked){showNC('Аккаунт заблокирован','error');return;}
  ncStorage.setItem('nc_session',nick); showNC('Вы вошли как '+nick); closeAccount(()=>resumeCabinetTarget()); updateProfile();
 }
}
function showNC(text,type){
 let n=document.createElement('div');
 const error=/недостат|ошиб|заблок|недейств|сначала|заполн|неверн/i.test(text);
 const success=/покупк|актив|создан|отправлен|сброшен|вошли/i.test(text);
 type=type||(error?'error':success?'success':'info');
 n.className='nc-toast nc-toast-'+type;
 n.innerHTML='<span class="nc-toast-icon">'+(type==='success'?'✓':type==='error'?'!':'i')+'</span><span class="nc-toast-text">'+escapeHTML(text)+'</span><button class="nc-toast-close" aria-label="Закрыть">×</button>';
 n.querySelector('.nc-toast-close').onclick=()=>closePanel(n,()=>n.remove());
 document.body.appendChild(n);
 n.classList.add('show');openPanel(n);
 setTimeout(()=>{if(n.isConnected)closePanel(n,()=>n.remove());},4200);
}
function closeAccount(after){const m=document.getElementById('nc-modal');return closePanel(m,()=>{m.classList.remove('show');m.style.display='none';if(typeof after==='function')after();});}
function logoutNC(){ncStorage.removeItem('nc_session'); updateProfile(); showNC('Вы вышли из аккаунта');}
function updateProfile(){
 const session=ncStorage.getItem('nc_session');
 const label=document.querySelector('.profile b');
 const cabinet=document.getElementById('account');
 const cabinetName=document.getElementById('cabinet-name');
 const cabinetUser=document.getElementById('cabinet-user');
 const cabinetDate=document.getElementById('cabinet-date');
 const cabinetStatus=document.getElementById('cabinet-status');
 if(label) label.textContent=session?session:'Войти в профиль';
 if(cabinet) cabinet.classList.remove('scroll-reveal','is-visible');
 if(cabinetName) cabinetName.textContent=session||'Пользователь';
 if(cabinetUser) cabinetUser.textContent=session||'—';
 const account=getAccounts().find(a=>a.nick===session);
 const avatarHtml=account&&account.avatar?`<img src="${safeAvatar(account.avatar)}" alt="Аватар ${escapeHTML(session||'')}">`:'◈';
 const av=document.getElementById('cabinet-avatar'); if(av) av.innerHTML=avatarHtml;
 const topAv=document.querySelector('.profile .avatar'); if(topAv){topAv.innerHTML=avatarHtml;topAv.classList.toggle('has-image',!!(account&&account.avatar));}
 if(cabinetStatus) cabinetStatus.textContent=account&&account.blocked?'Заблокирован':(account&&window.NCStore&&NCStore.isSubActive(account)?'Активна':'Нет подписки');
 const balance=document.getElementById('cabinet-balance'); if(balance) balance.textContent='₽ '+Number(account&&account.balance||0).toLocaleString('ru-RU');
 const loader=document.getElementById('loader-download'); if(loader){const caption=loader.querySelector('button');if(caption)caption.textContent='Скачать лоадер';loader.setAttribute('aria-label','Скачать лоадер');loader.style.opacity=serverEnabled()?'1':'.45';loader.title=serverEnabled()?'Скачать лоадер':'Сервер отключён';}
 const sub=document.getElementById('cabinet-subscription');
 const hw=document.getElementById('cabinet-hwid'); if(hw) hw.textContent=account&&account.hwid||'Не привязан';

 const days=document.getElementById('cabinet-days'); if(days){const d=(account&&window.NCStore&&NCStore.isSubActive(account))?Math.max(0,Math.ceil((NCStore.subscription(account).until-Date.now())/86400000)):0; days.textContent=d+' дн.'; if(sub) sub.textContent=d>0?'RustEx · '+d+' дней':'Нет подписки';}
 const until=document.getElementById('cabinet-until'); if(until){const subInfo=account&&window.NCStore?NCStore.subscription(account):null;until.textContent=subInfo&&subInfo.until?new Date(subInfo.until).toLocaleDateString('ru-RU'):'—';}
 if(cabinetDate) cabinetDate.textContent=account&&account.createdAt?new Date(account.createdAt).toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}):'—';
 renderChat();
 renderSupport();
 renderUserPurchases();
 if(typeof refreshDashboard==='function')refreshDashboard();
}
window.addEventListener('storage',e=>{if(e.key==='nc_tickets')renderTickets();if(e.key==='nc_chat'||e.key==='nc_accounts'||e.key==='nc_staff_keys')renderChat();});

function renderUserPurchases(){
  const session = ncStorage.getItem('nc_session');
  const listEl = document.getElementById('cabinet-purchases-list');
  const countEl = document.getElementById('cabinet-purchases-count');
  if(!listEl) return;
  if(!session){
    listEl.innerHTML = '<p class="muted" style="margin:0;font-size:12px;color:#8f7e9f">Войдите в аккаунт для просмотра истории</p>';
    if(countEl) countEl.textContent = '0';
    return;
  }
  let keys = [];
  try {
    keys = JSON.parse(ncStorage.getItem('nc_keys') || '[]');
  } catch(e){}
  const myKeys = keys.filter(k => k.usedBy === session);
  if(countEl) countEl.textContent = myKeys.length + (myKeys.length === 1 ? ' заказ' : (myKeys.length < 5 ? ' заказа' : ' заказов'));

  if(!myKeys.length){
    listEl.innerHTML = '<p class="muted" style="margin:0;font-size:12px;color:#8f7e9f">У вас пока нет оформленных заказов</p>';
    return;
  }

  listEl.innerHTML = myKeys.slice().reverse().map(k => {
    const dateStr = k.createdAt ? new Date(k.createdAt).toLocaleDateString('ru-RU') : '—';
    const promoHtml = k.promo ? `<span style="background:#3d2459;color:#e1b8ff;padding:2px 7px;border-radius:4px;font-size:10px;font-weight:600;margin-left:4px">скидка по промокоду ${escapeHTML(k.promo)}</span>` : '';
    const tariff = k.trial ? 'Пробная · 1 день' : k.days ? `${k.days} дней` : 'Сброс HWID';
    return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;background:#181323;border:1px solid #362947;border-radius:8px;font-size:12px;flex-wrap:wrap;gap:8px">
      <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
        <code style="background:#251c33;padding:3px 8px;border-radius:5px;color:#e8ddf5;font-weight:600;letter-spacing:.5px">${escapeHTML(k.code)}</code>
        <span style="color:#ba9cd9">Тариф: <b>${escapeHTML(tariff)}</b></span>
        ${promoHtml}
      </div>
      <div style="display:flex;align-items:center;gap:12px">
        <b style="color:#7ee6bb">${k.price ? k.price + ' ₽' : '0 ₽'}</b>
        <span style="color:#8a799c;font-size:11px">${dateStr}</span>
        <button type="button" style="background:#2b1d3d;color:#cba6f7;border:1px solid #583c74;padding:4px 9px;border-radius:6px;font-size:10px;cursor:pointer" onclick="navigator.clipboard&&navigator.clipboard.writeText('${escapeHTML(k.code)}').then(()=>showNC('Ключ скопирован в буфер: ${escapeHTML(k.code)}','success'))">Копировать</button>
      </div>
    </div>`;
  }).join('');
}
function goToCabinet(target){
 const session=ncStorage.getItem('nc_session');
 if(!session){pendingCabinetTarget=target||'#cabinet-overview';openAccount();showNC('Сначала войди или зарегистрируй аккаунт');return;}
 updateProfile();
 openCabinet(target);
}
function openCabinet(target){
 updateProfile();
 const c=document.getElementById('account');
 if(!c)return;
 // Выносим кабинет из main, чтобы fixed-оверлей гарантированно перекрывал ВЕСЬ viewport.
 if(c.parentElement!==document.body)document.body.appendChild(c);
 c.classList.remove('scroll-reveal','is-visible');
 document.body.classList.add('cabinet-open');
 c.classList.add('visible');
 c.scrollTo({top:0,behavior:'instant'});
 openPanel(c).then(()=>{if(target&&c.classList.contains('visible')&&!panelStates.get(c)?.closing)navigateToParameter(target);});
}
function closeCabinet(){
 const c=document.getElementById('account');
 if(c)closePanel(c,()=>{c.classList.remove('visible');document.body.classList.remove('cabinet-open');});
}
function subActive(acc){
 if(window.NCStore&&typeof NCStore.isSubActive==='function')return !!NCStore.isSubActive(acc);
 const sub=(window.NCStore&&typeof NCStore.subscription==='function'?NCStore.subscription(acc):null)||{};
 return !!(sub&&Number(sub.until)>Date.now());
}
// Пробную активируют один раз на аккаунт: проверяем отметку и историю ключей.
function trialAlreadyUsed(acc,keys){
 if(!acc)return true;
 if(Number(acc.trialUsedAt)>0)return true;
 return (Array.isArray(keys)?keys:[]).some(k=>k&&k.trial&&k.usedBy===acc.nick);
}
function redeemKey(){
 if(!serverEnabled())return showNC('Сервер временно отключён. Активация ключей недоступна','error');
 const input=document.getElementById('cabinet-key'); const code=(input&&input.value||'').trim().toUpperCase(); if(!code)return showNC('Введите ключ');
 const keys=JSON.parse(ncStorage.getItem('nc_keys')||'[]'); const item=keys.find(k=>k.code===code&&!k.used); if(!item)return showNC('Ключ недействителен или уже использован');
 const session=ncStorage.getItem('nc_session'); const accounts=getAccounts(); const acc=accounts.find(a=>a.nick===session); if(!acc)return;
 if(item.trial){
  if(trialAlreadyUsed(acc,keys))return showNC('Пробная подписка уже выдавалась этому аккаунту — второй раз нельзя','error');
  if(subActive(acc))return showNC('У аккаунта уже есть активная подписка — пробная выдаётся только без подписки','info');
  const totalDays=extendRustexSubscription(acc,1);
  const until=Number((acc.subscription||{}).until)||Date.now();
  const name='Пробная · 1 день';
  acc.subscription={name:name,days:1,trial:true,until:until};
  acc.lastSubscription={name:name,days:1,until:until,updatedAt:Date.now(),trial:true};
  acc.trialUsedAt=Date.now();
  acc.trialKey=item.code;
  item.used=true;item.usedBy=acc.nick;item.activatedAt=Date.now();item.trialActivated=true;
  saveAccounts(accounts);
  ncStorage.setItem('nc_keys',JSON.stringify(keys));
  if(input)input.value='';
  updateProfile();
  showNC('Пробная подписка активирована: 1 день. Продлить можно обычным ключом или покупкой','success');
  return;
 }
 if(item.days===0){acc.hwid='';showNC('HWID сброшен');} else {const totalDays=extendRustexSubscription(acc,item.days);showNC('Ключ активирован. Подписка теперь '+totalDays+' дней');} saveAccounts(accounts); item.used=true; item.usedBy=acc.nick; item.activatedAt=Date.now(); ncStorage.setItem('nc_keys',JSON.stringify(keys)); input.value=''; updateProfile();
}
function openAccount(){
 const m=document.getElementById('nc-modal'); const session=ncStorage.getItem('nc_session');
 m.style.display='flex';
 document.querySelectorAll('.nc-window input,#nc-action,#nc-switcher').forEach(e=>e.style.display=session?'none':'');
 document.getElementById('nc-session').style.display=session?'block':'none';
 document.getElementById('nc-session-name').textContent=session||'';
 if(!session)setNCMode('login');
 m.classList.add('show');
 openPanel(m);
}
