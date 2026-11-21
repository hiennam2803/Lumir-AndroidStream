/* Cửa sổ điện thoại nổi: khung màn hình + thanh điều hướng dọc bên phải.
   - Nút Back/Home/Recents/âm lượng/nguồn gửi phím thật tới điện thoại (adb input keyevent).
   - Chuột trên khung hình = cảm ứng (chạm / nhấn giữ / vuốt / cuộn), gửi qua send_touch.
   - Ngoài Tauri (mở bằng trình duyệt) chạy chế độ demo để xem bố cục. */
(()=>{
'use strict';
const TA=window.__TAURI__,demo=!(TA&&TA.core&&TA.window);
const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
const call=demo?async()=>null:(c,a)=>TA.core.invoke(c,a);
const win=demo?null:TA.window.getCurrentWindow();

const VI={
 'Back':'Quay lại','Home':'Màn hình chính','Recent apps':'Ứng dụng gần đây',
 'Volume up':'Tăng âm lượng','Volume down':'Giảm âm lượng','Power / screen':'Nguồn / màn hình',
 'Always on top':'Luôn nổi trên cùng','Full screen':'Toàn màn hình','Performance':'Hiệu năng','Video quality':'Chất lượng video','Smooth':'Mượt','Balanced':'Cân bằng','Sharp':'Sắc nét','Custom':'Tuỳ chỉnh','Resolution (long side)':'Độ phân giải (cạnh dài)','Bitrate':'Bitrate','Low resolution, fastest response':'Độ phân giải thấp, phản hồi nhanh nhất','Good quality, low latency':'Chất lượng tốt, độ trễ thấp','Full detail, needs a good cable':'Nhiều chi tiết, cần cáp USB tốt','Set resolution and bitrate yourself':'Tự chọn độ phân giải và bitrate','Exit full screen':'Thoát toàn màn hình','Key mapping (coming soon)':'Ánh xạ phím (sắp có)',
 'Main window':'Cửa sổ chính','Minimize':'Thu nhỏ','Close':'Đóng',
 'Waiting for video stream':'Đang chờ luồng video','Retry':'Thử lại',
 'Video decoding is not supported on this system.':'Hệ thống này không hỗ trợ giải mã video.',
 'Video stream stopped':'Luồng video đã dừng','Unknown phone window':'Không xác định được cửa sổ điện thoại',
 'Device disconnected':'Thiết bị đã ngắt kết nối',
 'Plug the cable back in and connect from the main window.':'Cắm lại cáp rồi kết nối từ cửa sổ chính.',
 'Open main window':'Mở cửa sổ chính',
 'Unknown screen size':'Không xác định được kích thước màn hình','Unknown touch phase':'Thao tác chạm không hợp lệ','adb shell session lost':'Phiên adb shell đã mất','Device is not connected.':'Thiết bị chưa được kết nối.',
 'ADB timed out':'ADB không phản hồi','ADB not found':'Không tìm thấy ADB'
};
let lang='en',theme='dark',pinned=true,serial='',dev=null,connected=false,ar=9/20,live=false;
const T=k=>lang==='vi'&&VI[k]||k;
const mq=matchMedia('(prefers-color-scheme: dark)');

/* ── Icon (viewBox 24, nét 1.8 — cùng phong cách cửa sổ chính) ── */
const P={
 back:'<path d="M15.5 5.5v13L7 12z"/>',
 home:'<circle cx="12" cy="12" r="6"/>',
 recents:'<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
 volup:'<path d="M4 10v4h3l4 3V7l-4 3z"/><path d="M15 9.5a3.5 3.5 0 010 5"/><path d="M17.8 7a7 7 0 010 10"/>',
 voldn:'<path d="M4 10v4h3l4 3V7l-4 3z"/><path d="M15 9.5a3.5 3.5 0 010 5"/>',
 power:'<path d="M12 3.5v8"/><path d="M7.4 6.6a7 7 0 109.2 0"/>',
 pin:'<path d="M9 4h6l-1 6 3 3H7l3-3z"/><path d="M12 13v7"/>',
 full:'<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
 gauge:'<path d="M4.5 17a8 8 0 1115 0"/><path d="M12 17l3.5-5"/>',
 perf:'<path d="M3.5 13h4l2.5-6 4 11 2.5-5h4"/>',
 unfull:'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
 keys:'<rect x="3" y="6" width="18" height="12" rx="2.5"/><path d="M7 10h.01M11 10h.01M15 10h.01M7 14h10"/>',
 main:'<rect x="3.5" y="5" width="17" height="14" rx="2.5"/><path d="M3.5 9.5h17"/>',
 min:'<path d="M6 12h12"/>',
 x:'<path d="M6.5 6.5l11 11M17.5 6.5l-11 11"/>'
};
const svg=n=>`<svg viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

/* Thứ tự thanh dọc: điều hướng → phần cứng → công cụ → (đệm) → về cửa sổ chính */
const RAIL=[
 {t:'key',k:'back',i:'back',l:'Back'},
 {t:'key',k:'home',i:'home',l:'Home'},
 {t:'key',k:'recents',i:'recents',l:'Recent apps'},
 {t:'sep'},
 {t:'key',k:'volume_up',i:'volup',l:'Volume up'},
 {t:'key',k:'volume_down',i:'voldn',l:'Volume down'},
 {t:'key',k:'power',i:'power',l:'Power / screen'},
 {t:'sep'},
 {t:'pin',i:'pin',l:'Always on top'},
 {t:'full',i:'full',l:'Full screen'},
 {t:'qual',i:'gauge',l:'Video quality'},
 {t:'perf',i:'perf',l:'Performance'},
 {t:'map',i:'keys',l:'Key mapping (coming soon)'},
 {t:'sp'},
 {t:'main',i:'main',l:'Main window'}
];

function buildRail(){
 $('#rail').innerHTML=RAIL.map(r=>{
  if(r.t==='sep')return'<div class="rsep"></div>';
  if(r.t==='sp')return'<div class="rsp"></div>';
  return`<button class="rb" data-t="${r.t}" ${r.k?`data-k="${r.k}"`:''} data-l="${r.l}" aria-label="${r.l}" title="${r.l}">${svg(r.i)}</button>`;
 }).join('');
 $('#bMin').innerHTML=svg('min');$('#bClose').innerHTML=svg('x');
}

/* ── Ngôn ngữ / giao diện: dùng chung cài đặt với cửa sổ chính ── */
function loadPrefs(){try{const v=JSON.parse(localStorage.getItem('lumir')||'{}');theme=v.theme||'dark';lang=v.lang||'en'}catch(_){}
 try{pinned=localStorage.getItem('lumir-pin')!=='0'}catch(_){}}
function applyTheme(){document.documentElement.dataset.theme=(theme==='light'||(theme==='system'&&!mq.matches))?'light':'dark'}
function applyLang(){
 document.documentElement.lang=lang;
 $$('[data-t]:not(.rb)').forEach(e=>{if(e.dataset.o===undefined)e.dataset.o=e.textContent;e.textContent=T(e.dataset.o)});
 $$('[data-l]').forEach(e=>{const s=T(e.dataset.l);e.setAttribute('aria-label',s);e.dataset.tip=s;if(e.classList.contains('ib'))e.title=s});
}

/* ── Trạng thái thiết bị ── */
function parseRes(r){const m=/(\d+)\s*[×x]\s*(\d+)/.exec(r||'');return m&&+m[1]>0&&+m[2]>0?+m[1]/+m[2]:null}
function setDevice(d){
 if(d)dev={...(dev||{}),...d};
 const was=connected;
 connected=!!d&&d.status==='connected';
 const name=(dev&&dev.name)||'—';
 $('#phNm').textContent=name;
 $('#phRes').textContent=(dev&&dev.resolution)||'—';
 $('#ttl').textContent='LUMIR · '+name;
 document.title='LUMIR — '+name;
 $('#top').classList.toggle('off',!connected);
 $('#ovl').hidden=connected;
 $$('.rb[data-t=key]').forEach(b=>b.disabled=!connected);
 const a=parseRes(dev&&dev.resolution);if(a&&!live)ar=a;
 if(a&&winLand===null)winLand=a>1;
 fit();
 if(connected&&!was)startStream();
 else if(!connected&&was)stopStream(true,true);
}
/* Khung điện thoại vừa khít vùng stage, giữ đúng tỉ lệ màn hình */
function fit(){
 const st=$('#stage'),r=st.getBoundingClientRect(),cs=getComputedStyle(st);
 const aw=r.width-parseFloat(cs.paddingLeft)-parseFloat(cs.paddingRight),ah=r.height-parseFloat(cs.paddingTop)-parseFloat(cs.paddingBottom);
 let w=ah*ar,h=ah;if(w>aw){w=aw;h=aw/ar}
 w=Math.max(0,Math.floor(w));h=Math.max(0,Math.floor(h));
 const p=$('#phone');p.style.width=w+'px';p.style.height=h+'px';p.style.borderRadius='0';
}


/* ── Video: Rust gửi gói nhị phân [loại][dữ liệu H.264 Annex-B]; ở đây giải mã bằng WebCodecs rồi vẽ lên canvas ──
   loại: 0 = khung P · 1 = khung IDR (có SPS/PPS) · 2 = lỗi (văn bản) · 3 = đang nối lại (screenrecord tự dừng sau 180 giây) · 4 = máy vừa xoay (luồng mới khác kích thước) */
const K_DELTA=0,K_KEY=1,K_ERROR=2,K_RESTART=3,K_ROTATE=4;
let ch=null,dec=null,codec='',needKey=true,ts=0,vctx=null,retryAt=0,retries=0;

function setLive(on){live=on;$('#phone').classList.toggle('live',on)}
function setStatus(msg,err){
 $('#phStT').textContent=T(msg);$('#phSt').classList.toggle('err',!!err);$('#bRetry').hidden=!err;
}
function streamError(msg){
 stopStream(true,false);
 setStatus(String(msg||'Video stream stopped').slice(0,160),true);
}

/* Mã codec 'avc1.PPCCLL' lấy từ SPS (NAL loại 7) nằm ở đầu khung IDR */
function spsCodec(u8){
 const n=Math.min(u8.length-6,64);
 for(let i=0;i<n;i++){
  if(u8[i]||u8[i+1])continue;
  const j=u8[i+2]===1?i+3:(u8[i+2]===0&&u8[i+3]===1?i+4:-1);
  if(j>0&&(u8[j]&31)===7){const h=v=>v.toString(16).padStart(2,'0');return'avc1.'+h(u8[j+1])+h(u8[j+2])+h(u8[j+3])}
 }
 return null;
}
function closeDecoder(){if(dec&&dec.state!=='closed')try{dec.close()}catch(_){}dec=null;codec=''}
function openDecoder(c){
 closeDecoder();
 dec=new VideoDecoder({output:drawFrame,error:e=>{if(window.LumirPerf)window.LumirPerf.decoderError();console.warn('VideoDecoder',e);recover()}});
 dec.configure({codec:c,optimizeForLatency:true});
 window.__lumirDecoderQueue=()=>dec&&dec.state!=='closed'?dec.decodeQueueSize:null;
 if(window.LumirPerf)window.LumirPerf.resetPending();
 codec=c;needKey=true;
}
let winLand=null;   /* cửa sổ đang ở tỉ lệ ngang (true) hay dọc (false); null = chưa biết */
function drawFrame(f){
 const perfDrawStart=window.LumirPerf?window.LumirPerf.renderStart():0;
 if(window.LumirPerf)window.LumirPerf.decoderOutput();
 if(cv.width!==f.displayWidth||cv.height!==f.displayHeight){
  cv.width=f.displayWidth;cv.height=f.displayHeight;ar=cv.width/cv.height;fit();
  const land=cv.width>cv.height;                      /* máy xoay ngang/dọc → cửa sổ xoay theo */
  if(winLand!==null&&land!==winLand){winLand=land;call('fit_phone_window',{landscape:land}).catch(()=>{})}
 }
 vctx.drawImage(f,0,0);f.close();
 if(window.LumirPerf)window.LumirPerf.renderEnd(perfDrawStart);
 retries=0;
 if(!live)setLive(true);
}
function onPacket(m){
 const u=m instanceof ArrayBuffer?new Uint8Array(m):ArrayBuffer.isView(m)?new Uint8Array(m.buffer,m.byteOffset,m.byteLength):Uint8Array.from(m);
 if(u.length<1)return;
 const k=u[0],p=u.subarray(1);
 if((k===K_KEY||k===K_DELTA)&&window.LumirPerf)window.LumirPerf.packet(u.length);
 if(k===K_ERROR){streamError(new TextDecoder().decode(p));return}
 if(k===K_ROTATE){closeDecoder();needKey=true;return}   /* kích thước đổi: mở lại bộ giải mã ở IDR kế tiếp */
 if(k===K_RESTART){needKey=true;return}            /* giữ nguyên hình cũ, chờ IDR của lượt mới */
 if(k===K_KEY){const c=spsCodec(p);if(c&&c!==codec)openDecoder(c)}
 if(!dec||dec.state==='closed'||(needKey&&k!==K_KEY))return;
 needKey=false;
 try{dec.decode(new EncodedVideoChunk({type:k===K_KEY?'key':'delta',timestamp:ts,data:p}));if(window.LumirPerf)window.LumirPerf.decodeSubmitted();ts+=16667}
 catch(e){console.warn('decode',e);recover()}
}
/* Giải mã lỗi (khung hỏng): khởi động lại luồng để có IDR mới, tối đa 4 lần liên tiếp */
function recover(){
 if(!connected)return;
 const now=Date.now();
 if(retries>=4||now-retryAt<1000){streamError('Video stream stopped');return}
 retryAt=now;retries++;startStream();
}
async function startStream(keep){
 if(!connected)return;
 if(demo){demoFrame();return}
 if(typeof VideoDecoder==='undefined'){setStatus('Video decoding is not supported on this system.',true);return}
 stopStream(false,!!keep);   /* keep: đổi chất lượng thì giữ khung hình cũ, không nháy màn hình chờ */
 vctx=vctx||$('#vid').getContext('2d',{alpha:false,desynchronized:true});
 const c=new TA.core.Channel();ch=c;c.onmessage=m=>{if(ch===c)onPacket(m)};
 setStatus('Waiting for video stream',false);
 try{await call('start_stream',{serial,onFrame:c,maxSide:q.side,bitRateMbps:q.mbps})}catch(e){if(ch===c)streamError(T(String(e)))}
}
/* remote: báo Rust dừng adb · keep: giữ khung hình cuối (khi mất kết nối, lớp phủ đã che) */
function stopStream(remote,keep){
 ch=null;closeDecoder();
 if(!keep)setLive(false);
 if(remote&&!demo)call('stop_stream').catch(()=>{});
}
/* Chế độ demo (mở bằng trình duyệt): vẽ hình mẫu để xem bố cục */
function demoFrame(){
 const cv=$('#vid');cv.width=540;cv.height=1200;ar=.45;
 const g=cv.getContext('2d'),gr=g.createLinearGradient(0,0,540,1200);
 gr.addColorStop(0,'#1d4e89');gr.addColorStop(1,'#35d6c2');g.fillStyle=gr;g.fillRect(0,0,540,1200);
 g.fillStyle='rgba(255,255,255,.9)';g.font='600 44px Inter,sans-serif';g.textAlign='center';g.fillText('LUMIR demo',270,600);
 setLive(true);fit();
}

/* ── Hành động ── */
let tt;function toast(m){const t=$('#toast');t.textContent=m;t.classList.add('show');clearTimeout(tt);tt=setTimeout(()=>t.classList.remove('show'),2200)}
const busy=new Set();
async function press(btn){
 const k=btn.dataset.k;if(!connected||busy.has(k))return;
 busy.add(k);btn.classList.add('flash');setTimeout(()=>btn.classList.remove('flash'),160);
 try{await call('send_key',{serial,key:k})}catch(e){toast(T(String(e)))}finally{busy.delete(k)}
}
function setPin(on,persist){
 pinned=on;const b=$('.rb[data-t=pin]');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
 call('set_always_on_top',{on}).catch(()=>{});
 if(persist)try{localStorage.setItem('lumir-pin',on?'1':'0')}catch(_){}
}
/* Toàn màn hình: nút trên thanh, phím F11 để bật/tắt, Esc để thoát. Thoát xong thì chỉnh lại tỉ lệ cửa sổ theo hướng máy hiện tại */
let full=false;
function setRailHidden(hidden){document.body.classList.toggle('rail-hidden',!!hidden);requestAnimationFrame(fit)}
async function setFull(on){
 if(on===full)return;
 try{if(!demo)await call('set_fullscreen',{on})}catch(e){toast(T(String(e)));return}
 full=on;
 document.documentElement.classList.toggle('is-fullscreen',on);
 const b=$('.rb[data-t=full]'),l=on?'Exit full screen':'Full screen';
 b.innerHTML=svg(on?'unfull':'full');b.classList.toggle('on',on);b.setAttribute('aria-pressed',on);
 b.dataset.l=l;b.dataset.tip=T(l);b.setAttribute('aria-label',T(l));
 if(!on&&!demo)call('fit_phone_window',{landscape:landscape()}).catch(()=>{});
 setTimeout(fit,60);
}
const toMain=()=>call('focus_main_window').catch(e=>toast(T(String(e))));

/* ── Chất lượng video ──
   screenrecord không có tuỳ chọn FPS (xuất khung mỗi khi màn hình đổi), nên "mượt / FPS cao" = độ phân giải và bitrate
   thấp để encoder + cáp USB theo kịp; "sắc nét" = ngược lại. Đổi chế độ thì mở lại luồng video (~0,5 giây),
   kênh điều khiển cảm ứng không bị ảnh hưởng. FPS hiển thị là số khung THỰC SỰ nhận được mỗi giây
   (màn hình tĩnh thì encoder không gửi khung nên 0 fps là bình thường). */
const PRESETS={
 smooth:{side:720,mbps:4,d:'Low resolution, fastest response'},
 balanced:{side:1280,mbps:8,d:'Good quality, low latency'},
 sharp:{side:1920,mbps:16,d:'Full detail, needs a good cable'},
 custom:{d:'Set resolution and bitrate yourself'}
};
let q={mode:'balanced',side:1280,mbps:8};
function loadQ(){
 try{const v=JSON.parse(localStorage.getItem('lumir-q')||'{}');
  if(PRESETS[v.mode])q.mode=v.mode;
  if(v.side>=320&&v.side<=2560)q.side=v.side|0;
  if(v.mbps>=1&&v.mbps<=32)q.mbps=v.mbps|0;}catch(_){}
 const p=PRESETS[q.mode];if(p.side){q.side=p.side;q.mbps=p.mbps}
}
function saveQ(){try{localStorage.setItem('lumir-q',JSON.stringify(q))}catch(_){}}
function renderQ(){
 $$('#qpSeg button').forEach(b=>b.classList.toggle('on',b.dataset.m===q.mode));
 const d=$('#qpD');d.textContent=T(PRESETS[q.mode].d);
 $('#qpC').hidden=q.mode!=='custom';
 $('#qpRes').value=q.side;$('#qpBr').value=q.mbps;
 $('#qpResV').textContent=q.side+' px';$('#qpBrV').textContent=q.mbps+' Mbps';
}
function applyQ(){saveQ();renderQ();if(connected&&!demo)startStream(true)}
function setQP(on){
 $('#qp').hidden=!on;
 const b=$('.rb[data-t=qual]');if(b){b.classList.toggle('on',on);b.setAttribute('aria-pressed',on)}
}
$('#qpSeg').addEventListener('click',e=>{
 const b=e.target.closest('button');if(!b||b.dataset.m===q.mode)return;
 q.mode=b.dataset.m;const p=PRESETS[q.mode];if(p.side){q.side=p.side;q.mbps=p.mbps}
 applyQ();
});
$('#qpRes').addEventListener('input',e=>{q.side=+e.target.value;$('#qpResV').textContent=q.side+' px'});
$('#qpBr').addEventListener('input',e=>{q.mbps=+e.target.value;$('#qpBrV').textContent=q.mbps+' Mbps'});
$('#qpRes').addEventListener('change',applyQ);
$('#qpBr').addEventListener('change',applyQ);
/* ── Chuột → cảm ứng thời gian thực ──
   Nhấn = ngón tay chạm xuống, kéo = ngón tay di chuyển, nhả = nhấc lên (Rust ghi thẳng vào màn hình cảm ứng nên
   kéo mượt, nhấn giữ và fling đúng như tay thật). Cuộn chuột = vuốt cuộn · chuột phải = Back · chuột giữa = Home.
   Toạ độ gửi đi đã chuẩn hoá 0..1. Lệnh gửi TUẦN TỰ (đợi lệnh trước xong) để giữ thứ tự down → move → up;
   nhiều move liên tiếp chưa kịp gửi thì chỉ giữ cái mới nhất, nên độ trễ không bị dồn lại. */
let ptr=null,wheelBusy=false,marker=null;
const tq=[];let tbusy=false;
const cv=$('#vid');
const norm=e=>{const r=cv.getBoundingClientRect();return[Math.min(1,Math.max(0,(e.clientX-r.left)/r.width)),Math.min(1,Math.max(0,(e.clientY-r.top)/r.height))]};
const landscape=()=>cv.width>cv.height;
function tpush(p,pt){
 if(!connected||!live)return;
 const it={p,x:pt[0],y:pt[1]},last=tq[tq.length-1];
 if(p==='move'&&last&&last.p==='move')tq[tq.length-1]=it;else tq.push(it);
 if(!tbusy)tpump();
}
async function tpump(){
 tbusy=true;
 while(tq.length){
  const it=tq.shift();
  try{await call('touch_event',{serial,phase:it.p,x:it.x,y:it.y,landscape:landscape()})}
  catch(err){toast(T(String(err)));tq.length=0;ptr=null;showMarker(null,false)}
 }
 tbusy=false;
}
function showMarker(e,on){
 const ph=$('#phone');
 if(!marker){marker=document.createElement('i');marker.className='tp';ph.appendChild(marker)}
 if(!on||!e){marker.classList.remove('on');return}
 const r=ph.getBoundingClientRect();
 marker.style.left=(e.clientX-r.left)+'px';marker.style.top=(e.clientY-r.top)+'px';marker.classList.add('on');
}
function release(e){
 if(!ptr||(e&&e.pointerId!==ptr.id))return;
 const pt=e?norm(e):ptr.last;
 ptr=null;showMarker(null,false);tpush('up',pt);
}
cv.addEventListener('pointerdown',e=>{
 if(!connected||!live)return;
 if(e.button===2){press($('.rb[data-k=back]'));return}
 if(e.button===1){e.preventDefault();press($('.rb[data-k=home]'));return}
 if(e.button!==0||ptr)return;
 e.preventDefault();cv.setPointerCapture(e.pointerId);
 const pt=norm(e);ptr={id:e.pointerId,last:pt};
 showMarker(e,true);tpush('down',pt);
});
cv.addEventListener('pointermove',e=>{
 if(!ptr||e.pointerId!==ptr.id)return;
 ptr.last=norm(e);showMarker(e,true);tpush('move',ptr.last);
});
cv.addEventListener('pointerup',release);
cv.addEventListener('pointercancel',release);
cv.addEventListener('lostpointercapture',release);
/* Cuộn chuột: vuốt ngược chiều cuộn; mỗi lần chỉ một lệnh để không dồn ứ */
cv.addEventListener('wheel',e=>{
 e.preventDefault();
 if(!connected||!live||wheelBusy||!e.deltaY||ptr)return;
 const a=norm(e),len=Math.min(.5,Math.max(.12,Math.abs(e.deltaY)/500));
 wheelBusy=true;
 call('touch_scroll',{serial,x:a[0],y:a[1],dy:e.deltaY>0?-len:len,landscape:landscape()})
  .catch(err=>toast(T(String(err)))).finally(()=>{wheelBusy=false});
},{passive:false});

document.addEventListener('click',e=>{
 if(!e.target.closest('#qp')&&!e.target.closest('.rb[data-t=qual]'))setQP(false);   /* bấm ra ngoài thì đóng bảng */
 const b=e.target.closest('.rb');
 if(b){
  const t=b.dataset.t;
  if(t==='key')press(b);
  else if(t==='pin')setPin(!pinned,true);
  else if(t==='full')setFull(!full);
  else if(t==='qual')setQP($('#qp').hidden);
  else if(t==='perf'){if(window.LumirPerf)window.LumirPerf.toggle()}
  else if(t==='main')toMain();
  else if(t==='map')toast(T('Key mapping (coming soon)'));
  return}
 if(e.target.closest('#bRetry')){retries=0;startStream()}
 else if(e.target.closest('#bOvlMain'))toMain();
 else if(e.target.closest('#bMin')&&win)win.minimize();
 else if(e.target.closest('#bClose')){win?win.close():window.close()}
});
$('#top').addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('button')||!win)return;win.startDragging().catch(()=>{})});
document.addEventListener('contextmenu',e=>e.preventDefault());
document.addEventListener('keydown',e=>{
 if(e.key==='F11'){e.preventDefault();setFull(!full)}
 else if(e.key==='F3'){e.preventDefault();setRailHidden(!document.body.classList.contains('rail-hidden'))}   /* ẩn/hiện thanh công cụ */
 else if(e.key==='Escape'&&!$('#qp').hidden){e.preventDefault();setQP(false)}
 else if(e.key==='Escape'&&full){e.preventDefault();setFull(false)}
});
if(win&&win.onResized)win.onResized(()=>requestAnimationFrame(fit)).catch(()=>{});
new ResizeObserver(fit).observe($('#stage'));
mq.addEventListener('change',applyTheme);
/* Đổi ngôn ngữ / giao diện ở cửa sổ chính → cập nhật ngay ở đây */
window.addEventListener('storage',e=>{if(e.key==='lumir'){loadPrefs();applyTheme();applyLang();renderQ()}});

async function init(){
 loadPrefs();loadQ();applyTheme();buildRail();applyLang();renderQ();
 if(demo){serial='DEMO';setDevice({name:'Demo phone',resolution:'1080×2400',status:'connected'});setPin(pinned,false);return}
 try{const c=await call('phone_context');serial=c.serial;setDevice(c.device||{status:'disconnected'})}
 catch(e){setDevice({status:'disconnected'})}
 await TA.event.listen('devices-changed',ev=>{const d=ev.payload.find(x=>x.serial===serial);setDevice(d||{status:'disconnected'})});
 setPin(pinned,false);
}
init();
})();