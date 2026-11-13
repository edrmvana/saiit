/* NOCTURNE — плавный переход между «Вход» и «Регистрация» */
(function(){
  if(typeof window.setNCMode!=='function')return;

  var original=window.setNCMode;
  var busy=false;

  function windowEl(){return document.querySelector('.nc-window');}

  window.setNCMode=function(mode){
    var win=windowEl();

    // без анимации: первый вызов, скрытое окно или reduced-motion
    var reduced=window.matchMedia&&window.matchMedia('(prefers-reduced-motion:reduce)').matches;
    var modal=document.getElementById('nc-modal');
    var hidden=!modal||modal.hidden||getComputedStyle(modal).display==='none';
    if(!win||reduced||hidden||busy){return original.call(this,mode);}

    busy=true;

    // 1. запоминаем текущую высоту окна (FLIP)
    var startHeight=win.getBoundingClientRect().height;

    // направление сдвига: в регистрацию — влево, назад ко входу — вправо
    var toRegister=mode==='register';
    win.classList.remove('nc-swap-in-left','nc-swap-in-right');
    win.classList.add('nc-swap-out',toRegister?'nc-swap-dir-left':'nc-swap-dir-right');

    window.setTimeout(function(){
      // 2. меняем содержимое, пока оно скрыто
      original.call(window,mode);

      win.classList.remove('nc-swap-out','nc-swap-dir-left','nc-swap-dir-right');

      // 3. анимируем высоту от старой к новой
      var endHeight=win.getBoundingClientRect().height;
      if(Math.abs(endHeight-startHeight)>1){
        win.style.height=startHeight+'px';
        win.getBoundingClientRect(); // reflow
        win.style.transition='height .38s cubic-bezier(.22,.8,.3,1)';
        win.style.height=endHeight+'px';
        window.setTimeout(function(){
          win.style.transition='';
          win.style.height='';
        },400);
      }

      // 4. новое содержимое въезжает с противоположной стороны
      win.classList.add(toRegister?'nc-swap-in-left':'nc-swap-in-right');
      window.setTimeout(function(){
        win.classList.remove('nc-swap-in-left','nc-swap-in-right');
        busy=false;
      },380);
    },170);
  };
})();
