// Cosmetic roles are presentation only; they never grant administrator permissions.
const ROLE_CATALOG={
 'Космический':{key:'cosmic',symbol:'✦',description:'Твоя орбита — твои правила.'},
 'Тень':{key:'shadow',symbol:'◈',description:'Тёмный стиль, узнаваемый характер.'},
 'Легенда':{key:'legend',symbol:'♛',description:'Оставь свой след в сообществе.'}
};
function equippedRoleOf(account){const name=account?.equippedRole;return Object.prototype.hasOwnProperty.call(ROLE_CATALOG,name)&&Array.isArray(account?.cosmetics)&&account.cosmetics.includes(name)?name:null;}
function roleBadgeHTML(name){if(!Object.prototype.hasOwnProperty.call(ROLE_CATALOG,name))return '';const role=ROLE_CATALOG[name];return `<span class="role-badge role-${role.key}" aria-label="Роль: ${name}"><span class="role-symbol" aria-hidden="true">${role.symbol}</span>${name}</span>`;}
