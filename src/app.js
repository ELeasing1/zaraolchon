(function(){
var D=document,W=window,R=D.documentElement;
function $(s,r){return(r||D).querySelector(s)}
function $$(s,r){return[].slice.call((r||D).querySelectorAll(s))}
var yr=$('#yr');if(yr)yr.textContent=new Date().getFullYear();

/* шапка, нижняя панель, появление блоков */
var hdr=$('#hdr'),bar=$('#bar'),rv=$$('.rv'),done=0;
function reveal(){
  if(done)return;
  var h=W.innerHeight,left=0;
  rv.forEach(function(e){
    if(e.classList.contains('in'))return;
    if(e.getBoundingClientRect().top<h*.93)e.classList.add('in');else left++;
  });
  if(!left)done=1;
}
function revealAll(){rv.forEach(function(e){e.classList.add('in')});done=1}
function onScroll(){
  var y=W.pageYOffset,h=W.innerHeight;
  hdr.classList.toggle('stuck',y>30);
  bar.classList.toggle('show',y>h*.55&&y+h<R.scrollHeight-140);
  reveal();
}
W.addEventListener('scroll',onScroll,{passive:true});
W.addEventListener('resize',onScroll,{passive:true});
W.addEventListener('load',onScroll);
onScroll();
/* предохранители: во фрейме событие scroll может не приходить */
setTimeout(function(){if(!done)revealAll()},W.self!==W.top?2500:9000);

/* мобильное меню */
var burger=$('#burger'),mnav=$('#mnav');
function menu(o){mnav.classList.toggle('open',o);burger.classList.toggle('on',o);burger.setAttribute('aria-expanded',o)}
burger.addEventListener('click',function(){menu(!mnav.classList.contains('open'))});
$$('a',mnav).forEach(function(a){a.addEventListener('click',function(){menu(false)})});

/* лайтбокс */
var figs=$$('.fig--z'),lb=$('#lb'),lbImg=$('#lbImg'),lbC=$('#lbC'),idx=0;
function openLb(i){
  idx=(i+figs.length)%figs.length;
  var im=$('img',figs[idx]);
  lbImg.src=im.currentSrc||im.src;lbImg.alt=im.alt;lbImg.hidden=false;
  lbC.textContent=(idx+1)+' / '+figs.length+(im.alt?' · '+im.alt:'');
  if(lb.hidden){lb.hidden=false;void lb.offsetWidth;lb.classList.add('open');R.style.overflow='hidden';$('#lbX').focus()}
}
function closeLb(){
  lb.classList.remove('open');R.style.overflow='';
  figs[idx].focus({preventScroll:true});
  setTimeout(function(){lb.hidden=lbImg.hidden=true;lbImg.removeAttribute('src')},300);
}
figs.forEach(function(f,i){
  f.tabIndex=0;f.setAttribute('role','button');
  f.addEventListener('click',function(){openLb(i)});
  f.addEventListener('keydown',function(e){if(e.key=='Enter'||e.key==' '){e.preventDefault();openLb(i)}});
});
$('#lbX').addEventListener('click',closeLb);
$('#lbP').addEventListener('click',function(){openLb(idx-1)});
$('#lbN').addEventListener('click',function(){openLb(idx+1)});
lb.addEventListener('click',function(e){if(e.target==lb||e.target==lbImg)closeLb()});
D.addEventListener('keydown',function(e){
  if(e.key=='Escape'){if(!lb.hidden)closeLb();else menu(false)}
  else if(!lb.hidden&&e.key=='ArrowLeft')openLb(idx-1);
  else if(!lb.hidden&&e.key=='ArrowRight')openLb(idx+1);
});
var x0=null;
lb.addEventListener('touchstart',function(e){x0=e.touches[0].clientX},{passive:true});
lb.addEventListener('touchend',function(e){
  if(x0===null)return;
  var dx=e.changedTouches[0].clientX-x0;
  if(Math.abs(dx)>50)openLb(idx+(dx<0?1:-1));
  x0=null;
},{passive:true});

/* подсказка «листайте вбок» гаснет после первого свайпа */
$$('.swipe').forEach(function(h){
  var g=h.previousElementSibling;
  g.addEventListener('scroll',function(){if(g.scrollLeft>12)h.style.opacity=0},{passive:true});
});
})();
