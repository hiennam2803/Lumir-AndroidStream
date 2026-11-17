const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const I={home:'<path d="M3 11l9-8 9 8M5 10v10h5v-6h4v6h5V10"/>',back:'<path d="M15 5l-7 7 7 7"/>',rec:'<rect x="5" y="5" width="14" height="14" rx="3"/>',mouse:'<path d="M5 3l14 7-6 2-2 6z"/>',kb:'<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',map:'<path d="M6 12h4m-2-2v4M15 11h.01M18 13h.01"/><rect x="2" y="6" width="20" height="12" rx="6"/>',off:'<path d="M12 3v9M6.4 6.4a8 8 0 1 0 11.2 0"/>',re:'<path d="M21 12a9 9 0 1 1-3-6.7L21 8M21 3v5h-5"/>',phone:'<path d="M22 17v3a2 2 0 0 1-2 2A18 18 0 0 1 2 4a2 2 0 0 1 2-2h3l2 5-2.5 1.5a11 11 0 0 0 6 6L16 14l5 2z"/>',msg:'<path d="M21 12a8 8 0 0 1-12 7l-5 1 1-4.5A8 8 0 1 1 21 12z"/>',cam:'<path d="M4 8h3l2-3h6l2 3h3v11H4z"/><circle cx="12" cy="13" r="3.5"/>',globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',music:'<path d="M9 18V5l11-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="17" cy="16" r="3"/>',mail:'<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>',img:'<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="1.5"/><path d="M21 15l-5-5L5 21"/>',pin:'<path d="M12 21s7-6 7-11a7 7 0 0 0-14 0c0 5 7 11 7 11z"/><circle cx="12" cy="10" r="2.5"/>',cal:'<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',set:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M5 19l2-2M17 7l2-2"/>'};
const svg=n=>`<svg viewBox="0 0 24 24">${I[n]}</svg>`;
$('#apps').innerHTML=[['cal','Lịch','#e5584f'],['cam','Camera','#5b6472'],['img','Ảnh','#4f8cf0'],['globe','Web','#2fa98f'],['music','Nhạc','#d4577f'],['mail','Mail','#4a7bd0'],['pin','Bản đồ','#3da56a'],['set','Cài đặt','#7b6fcf']].map(a=>`<div class="ap"><div class="ic" style="background:${a[2]}">${svg(a[0])}</div>${a[1]}</div>`).join('');
$('#dock').innerHTML=[['phone','#3da56a'],['msg','#4f8cf0'],['globe','#2fa98f'],['cam','#5b6472']].map(a=>`<div class="ic" style="background:${a[1]}">${svg(a[0])}</div>`).join('');
/* ---- state: một nguồn sự thật duy nhất ---- */
const M={
 smooth:{n:'Smoothness',d:'Ưu tiên FPS cao, độ trễ thấp',fps:120,lat:18,br:12.6,c:'H.264',t:33.4,r:'720x1560'},
 bal:{n:'Balanced',d:'Cân bằng hình ảnh và độ mượt',fps:60,lat:32,br:18.4,c:'H.264',t:34.2,r:'1080x2340'},
 qual:{n:'Image Quality',d:'Ưu tiên độ nét, bitrate cao',fps:30,lat:46,br:38.2,c:'H.265',t:36.8,r:'1440x3120'},
 custom:{n:'Custom',d:'Tự cấu hình độ phân giải, FPS, bitrate, codec',fps:90,lat:28,br:24,c:'H.265',t:35.1,r:'1080x2340'}};
const S={mode:'bal',o:'p',view:'n',conn:'USB',st:'on',ov:true,tog:{}};
const CS={on:['Đã kết nối','ok'],ing:['Đang kết nối…','wn'],off:['Đã ngắt','er'],fail:['Kết nối thất bại','er']};
const cur=()=>M[S.mode];
let anim=0,tm,endArm,jit;
const fmt=(v,id)=>id==='#mBr'?v.toFixed(1):Math.round(v);
function num(id,v){const e=$(id),a=parseFloat(e.textContent)||v,t=performance.now(),k=++anim;
 (function f(n){if(k!==anim)return;const p=Math.min(1,(n-t)/350);e.textContent=fmt(a+(v-a)*p,id);p<1?requestAnimationFrame(f):anim=0})(t)}
function toast(t){const e=$('#toast');e.textContent=t;e.classList.add('show');clearTimeout(tm);tm=setTimeout(()=>e.classList.remove('show'),1800)}
/* ---- render ---- */
function render(){
 const m=cur(),on=S.st==='on',[w,h]=m.r.split('x').map(Number),res=S.o==='p'?`${w} × ${h}`:`${h} × ${w}`;
 const w$=$('#win');w$.className=`st-${S.st} v-${S.view} ${S.o==='l'?'land':''} ${S.ov?'':'hide-ov'}`;
 $('#phone').classList.toggle('land',S.o==='l');
 $('#bFloat').classList.toggle('on',S.view==='fl');$('#bFull').classList.toggle('on',S.view==='full');$('#bOv').classList.toggle('on',S.ov);
 $$('#qs .q').forEach(b=>b.classList.toggle('on',b.dataset.m===S.mode));
 $$('#rot button[data-o]').forEach(b=>b.classList.toggle('on',b.dataset.o===S.o&&b.dataset.o!=='r'));
 $$('#seg button').forEach(b=>b.classList.toggle('on',b.dataset.c===S.conn));
 $('#qd').textContent=m.d;$('#cu').classList.toggle('show',S.mode==='custom');
 $('#cR').value=m.r;$('#cF').value=m.fps;$('#cB').value=m.br;$('#cC').value=m.c;$('#oF').textContent=m.fps;$('#oB').textContent=m.br+' Mbps';
 const dis=!on;$$('.cb[data-n],#qs .q,#rot button,#cu select,#cu input').forEach(b=>b.disabled=dis);
 $$('#seg button').forEach(b=>b.disabled=S.st==='ing');
 const cs=$('#cs');cs.textContent=CS[S.st][0];cs.className='cs '+CS[S.st][1];
 $('#mSt').textContent='MÔ PHỎNG · '+(on?'ONLINE':S.st==='ing'?'CONNECTING':'OFFLINE');$('#metrics').className=S.st==='ing'?'st-ing':on?'':'st-off';
 $('#sC').textContent=S.conn;$('#sE').textContent=on?'Engine Ready':'Engine Idle';
 const warn=m.t>=36;$('#kT').innerHTML=on?`<span class="${warn?'wn':''}">${m.t.toFixed(1)} °C · ${warn?'Ấm':'Bình thường'}</span>`:'–';
 $('#kC').textContent=on?m.c:'–';
 $('#kA').innerHTML=on?'<span class="ok">Device (mô phỏng)</span>':S.st==='ing'?'<span class="wn">Unauthorized…</span>':'<span class="er">Offline</span>';
 $('#offT').innerHTML={ing:`Đang kết nối qua ${S.conn}…`,off:'Mất tín hiệu<br>Nhấn “Kết nối lại” để tiếp tục',fail:`Không thể kết nối qua ${S.conn}<br>Nhấn “Thử lại”`,on:''}[S.st];
 $('#live').textContent=`LIVE · ${res} · ${m.fps}fps`;
 const b=$('#bEnd'),lbl={on:'Ngắt kết nối',ing:'Đang kết nối…',off:'Kết nối lại',fail:'Thử lại'}[S.st];
 b.className='cb end'+(S.st==='off'||S.st==='fail'?' re':'')+(endArm?' cf':'');b.disabled=S.st==='ing';
 b.querySelector('span').textContent=endArm?'Nhấn lại để xác nhận':lbl;b.querySelector('svg').innerHTML=on?I.off:I.re;
 if(on){num('#mFps',m.fps);num('#mLat',m.lat);num('#mBr',m.br)}else{anim++;['#mFps','#mLat','#mBr'].forEach(i=>$(i).textContent='–')}
 $('#mRes').textContent=on?res:'–';
 fit();
}
function fit(){const st=$('#stage'),ph=$('#phone'),L=S.o==='l',b=9,ratio=L?19.5/9:9/19.5;
 let sh=Math.min(st.clientHeight-60-2*b,(st.clientWidth-60-2*b)/ratio);if(S.view==='fl')sh=L?150:360;
 const sw=sh*ratio;ph.style.width=sw+2*b+'px';ph.style.height=sh+2*b+'px';ph.style.setProperty('--r',(L?22:34)+'px')}
new ResizeObserver(fit).observe($('#stage'));
/* ---- kết nối ---- */
function connect(){S.st='ing';render();clearTimeout(connect.t);
 connect.t=setTimeout(()=>{S.st=(S.conn==='LAN'&&Math.random()<.25)?'fail':'on';render();toast(S.st==='on'?'Đã kết nối qua '+S.conn+' (mô phỏng)':'Kết nối LAN thất bại')},1000)}
function drop(){clearTimeout(connect.t);S.st='off';endArm=0;S.view='n';render();toast('Đã ngắt kết nối mô phỏng')}
$('#bar').innerHTML=[['home','Trang chủ Android','Home'],['back','Quay lại','Back'],['rec','Đa nhiệm','Recents'],['|'],['mouse','Điều khiển chuột','Chuột',1],['kb','Bàn phím','Bàn phím',1],['map','Key Mapping','Key Mapping',2]].map(b=>b[0]==='|'?'<span class="vs"></span>':`<button class="cb" data-tip="${b[1]}" data-n="${b[2]}" data-t="${b[3]||0}">${svg(b[0])}</button>`).join('')+`<button class="cb end" id="bEnd">${svg('off')}<span></span></button>`;
$$('.cb[data-n]').forEach(b=>b.onclick=()=>{const t=b.dataset.t;
 if(t==='2'){$('#km').classList.add('show')}
 else if(t==='1'){b.classList.toggle('on');toast(b.dataset.n+(b.classList.contains('on')?' · bật':' · tắt')+' (mô phỏng)')}
 else toast('Gửi lệnh '+b.dataset.n+' (mô phỏng)')});
$('#kmX').onclick=()=>$('#km').classList.remove('show');
$('#bEnd').onclick=()=>{
 if(S.st==='on'){if(endArm){clearTimeout(endArm);drop()}else{endArm=setTimeout(()=>{endArm=0;render()},3000);render()}}
 else connect()};
$$('#seg button').forEach(b=>b.onclick=()=>{if(b.dataset.c===S.conn&&S.st==='on')return;S.conn=b.dataset.c;connect()});
/* ---- điều khiển ---- */
$('#qs').innerHTML=Object.entries(M).map(([k,m])=>`<button class="q" data-m="${k}">${m.n}</button>`).join('');
$$('#qs .q').forEach(b=>b.onclick=()=>{S.mode=b.dataset.m;render();toast('Chế độ: '+cur().n)});
$$('#rot button').forEach(b=>b.onclick=()=>{const o=b.dataset.o;S.o=o==='r'?(S.o==='p'?'l':'p'):o;render();toast('Hướng: '+(S.o==='p'?'Dọc':'Ngang'))});
function cust(){const c=M.custom;c.r=$('#cR').value;c.fps=+$('#cF').value;c.br=+$('#cB').value;c.c=$('#cC').value;
 const px=c.r.split('x').reduce((a,b)=>a*b)/2.5e6;c.lat=Math.round(12+c.br*.4+px*6+(c.c==='H.265'?4:0));c.t=+(31+c.fps/30+c.br/12+px).toFixed(1);render()}
['#cR','#cF','#cB','#cC'].forEach(i=>$(i).oninput=cust);
/* chế độ hiển thị loại trừ lẫn nhau: n | fl | full */
const setView=v=>{if(S.st!=='on'&&v!=='n')return toast('Cần kết nối thiết bị trước');S.view=S.view===v?'n':v;render();toast({n:'Preview chuẩn',fl:'Cửa sổ nổi',full:'Toàn màn hình · Esc để thoát'}[S.view])};
$('#bFloat').onclick=()=>setView('fl');$('#bFull').onclick=()=>setView('full');
$('#bOv').onclick=()=>{S.ov=!S.ov;render()};
addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#km').classList.contains('show'))$('#km').classList.remove('show');else if(S.view!=='n'){S.view='n';render()}}});
$$('[data-act]').forEach(b=>b.onclick=()=>toast(b.dataset.act));
/* ---- đồng hồ thật + jitter có quản lý vòng đời ---- */
function tick(){const d=new Date(),t=d.toLocaleTimeString('vi-VN',{hour:'2-digit',minute:'2-digit',hour12:false});$('#pClock').textContent=t;$('#sbT').textContent=t;$('#pDate').textContent=d.toLocaleDateString('vi-VN',{weekday:'long',day:'numeric',month:'long'})}
function startSim(){stopSim();jit=setInterval(()=>{if(S.st!=='on'||anim)return;const m=cur();
 $('#mFps').textContent=m.fps-(Math.random()<.3?1:0);$('#mLat').textContent=m.lat+Math.round(Math.random()*4-2);$('#mBr').textContent=(m.br+Math.random()*1.2-.6).toFixed(1)},1600)}
function stopSim(){clearInterval(jit)}
document.addEventListener('visibilitychange',()=>document.hidden?stopSim():startSim());
setInterval(tick,15000);tick();startSim();
/* scale: không nhỏ hơn 0.6 để chữ còn đọc được */
function scale(){const pad=window.__TAURI__?0:8,k=Math.max(.6,Math.min(1,(innerWidth-pad)/1024,(innerHeight-pad)/720));$('#win').style.transform=`scale(${k})`}
addEventListener('resize',scale);scale();render();
