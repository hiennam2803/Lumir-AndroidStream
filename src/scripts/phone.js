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
 'Always on top':'Luôn nổi trên cùng','Full screen':'Toàn màn hình','Performance':'Hiệu năng','Type with PC keyboard':'Gõ bằng bàn phím máy tính','Keyboard on: typing goes to the phone':'Đã bật bàn phím: chữ gõ sẽ vào ô nhập trên điện thoại','Keyboard off':'Đã tắt bàn phím','Key mapping':'Ánh xạ phím','Key mapping on':'Đã bật ánh xạ phím','Key mapping off':'Đã tắt ánh xạ phím','Edit layout':'Sửa bố cục','Done':'Xong','Clear':'Xoá hết','Click the screen to add a key · drag to move · right-click to delete':'Bấm lên màn hình để thêm phím · kéo để di chuyển · chuột phải để xoá','Press a key to assign…':'Nhấn một phím để gán…','Key mapping on — mapped keys tap the screen':'Ánh xạ phím đang bật — phím đã gán sẽ chạm vào màn hình','Key already used':'Phím này đã được dùng','Too many keys (max 9)':'Quá nhiều phím (tối đa 9)','Key mapping needs the scrcpy control channel, which is still starting. Try again in a moment.':'Kênh điều khiển chưa sẵn sàng, thử lại sau giây lát.','Copied from the phone':'Đã chép từ điện thoại','Nothing copied from the phone':'Không chép được gì từ điện thoại','Copy needs the scrcpy control channel, which is still starting. Try again in a moment.':'Kênh điều khiển chưa sẵn sàng, thử lại sau giây lát.','Typing needs the scrcpy control channel, which is still starting. Try again in a moment.':'Kênh gõ phím chưa sẵn sàng, thử lại sau giây lát.','Exit full screen':'Thoát toàn màn hình','Key mapping (coming soon)':'Ánh xạ phím (sắp có)',
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
/* Popup tự mang bản dịch của mình (popups/quality.js); chú thích kéo/phóng-thu dùng chung ở registry */
Object.assign(VI,Lumir.quality.vi,{'Drag to zoom · Ctrl+wheel · double-click to reset':'Kéo để phóng/thu · Ctrl+cuộn · nhấp đúp để về 100%','Drag to move':'Kéo để di chuyển'});
const Q=Lumir.quality,q=Q.state;   /* q: cài đặt chất lượng (đối tượng sống) */
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
 kbd:'<path d="M10 8h.01"/><path d="M12 12h.01"/><path d="M14 8h.01"/><path d="M16 12h.01"/><path d="M18 8h.01"/><path d="M6 8h.01"/><path d="M7 16h10"/><path d="M8 12h.01"/><rect width="20" height="16" x="2" y="4" rx="2"/>',
 unfull:'<path d="M9 4v5H4M15 4v5h5M9 20v-5H4M15 20v-5h5"/>',
 keys:'<line x1="6" x2="10" y1="11" y2="11"/><line x1="8" x2="8" y1="9" y2="13"/><line x1="15" x2="15.01" y1="12" y2="12"/><line x1="18" x2="18.01" y1="10" y2="10"/><path d="M17.32 5H6.68a4 4 0 0 0-3.978 3.59c-.006.052-.01.101-.017.152C2.604 9.416 2 14.456 2 16a3 3 0 0 0 3 3c1 0 1.5-.5 2-1l1.414-1.414A2 2 0 0 1 9.828 16h4.344a2 2 0 0 1 1.414.586L17 18c.5.5 1 1 2 1a3 3 0 0 0 3-3c0-1.545-.604-6.584-.685-7.258-.007-.05-.011-.1-.017-.151A4 4 0 0 0 17.32 5z"/>',
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
 {t:'kbd',i:'kbd',l:'Chat keyboard'},
 {t:'map',i:'keys',l:'Game Key Mapping'},
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
 Lumir.popups.relabel(T);
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
 window.dispatchEvent(new CustomEvent('lumir:device',{detail:{connected}}));
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
const K_DELTA=0,K_KEY=1,K_ERROR=2,K_RESTART=3,K_ROTATE=4,K_STATS=5;
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
function closeDecoder(){dropPending();if(dec&&dec.state!=='closed')try{dec.close()}catch(_){}dec=null;codec='';if(window.LumirPerf)window.LumirPerf.resetPending()}
function openDecoder(c){
 closeDecoder();
 dec=new VideoDecoder({output:drawFrame,error:e=>{if(window.LumirPerf)window.LumirPerf.decoderError();console.warn('VideoDecoder',e);recover()}});
 dec.configure({codec:c,optimizeForLatency:true});
 window.__lumirDecoderQueue=()=>dec&&dec.state!=='closed'?dec.decodeQueueSize:null;
 if(window.LumirPerf)window.LumirPerf.resetPending();
 codec=c;needKey=true;
}
let winLand=null;   /* cửa sổ đang ở tỉ lệ ngang (true) hay dọc (false); null = chưa biết */
/* Khung dồn cục (sau khi đường truyền nghẽn rồi nhả một loạt): chỉ giữ MỘT khung mới nhất chờ vẽ ở nhịp rAF kế tiếp,
   thay vì vẽ lần lượt hàng chục khung liền (hình chạy bù như tua nhanh). Khung bình thường (cách lần vẽ trước ≥ burstGap()) vẫn vẽ ngay. */
const burstGap=()=>Math.max(2,Math.min(8,500/(q.fps||60)));   /* ms: nửa khoảng cách giữa hai khung (60 fps → 8, 120 fps → ~4) */
let pendFrame=null,pendRaf=0,lastDraw=0;
function dropPending(){
 if(playout)playout.clear();
 if(pendFrame){try{pendFrame.close()}catch(_){}pendFrame=null}
 if(pendRaf){cancelAnimationFrame(pendRaf);pendRaf=0}
}
function flushPending(){pendRaf=0;const f=pendFrame;pendFrame=null;if(f)paintFrame(f)}
/* Bộ đệm mạng (playout.js): tuỳ chọn cho Wi-Fi. Bật (q.buf > 0) thì khung đi qua bộ đệm và được phát đều nhịp thay vì vẽ ngay. */
const playout=window.LumirPlayout?new window.LumirPlayout.Playout({
 now:()=>performance.now(),raf:cb=>requestAnimationFrame(cb),caf:h=>cancelAnimationFrame(h),
 paint:f=>paintFrame(f),close:f=>f.close(),onDrop:()=>{if(window.LumirPerf)window.LumirPerf.coalesced()}
}):null;
function drawFrame(f){
 if(window.LumirPerf)window.LumirPerf.decoderOutput();
 if(playout&&q.buf>0){playout.delay=q.buf;playout.push(f);return}
 if(pendFrame){try{pendFrame.close()}catch(_){}pendFrame=f;if(window.LumirPerf)window.LumirPerf.coalesced();return}   /* đã có khung chờ: khung mới hơn thay thế */
 if(performance.now()-lastDraw>=burstGap()){paintFrame(f);return}
 pendFrame=f;pendRaf=requestAnimationFrame(flushPending);
}
function paintFrame(f){
 const perfDrawStart=window.LumirPerf?window.LumirPerf.renderStart():0;
 lastDraw=performance.now();
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
 if(k===K_STATS){if(window.LumirPerf&&p.length>=24)window.LumirPerf.rustStats(p);return}   /* số liệu chẩn đoán từ Rust, không phải khung hình */
 if(k===K_ERROR){streamError(new TextDecoder().decode(p));return}
 if(k===K_ROTATE){closeDecoder();needKey=true;return}   /* kích thước đổi: mở lại bộ giải mã ở IDR kế tiếp */
 if(k===K_RESTART){needKey=true;return}            /* giữ nguyên hình cũ, chờ IDR của lượt mới */
 if(k===K_KEY){const c=spsCodec(p);if(c&&c!==codec)openDecoder(c)}
 if(!dec||dec.state==='closed'||(needKey&&k!==K_KEY)){if(window.LumirPerf)window.LumirPerf.packetDropped();return}
 needKey=false;
 try{dec.decode(new EncodedVideoChunk({type:k===K_KEY?'key':'delta',timestamp:ts,data:p}));if(window.LumirPerf)window.LumirPerf.decodeSubmitted();ts+=16667}
 catch(e){if(window.LumirPerf)window.LumirPerf.packetDropped();console.warn('decode',e);recover()}
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
 try{await call('start_stream',{serial,onFrame:c,maxSide:q.side,bitRateMbps:q.mbps,fps:q.fps})}catch(e){if(ch===c)streamError(T(String(e)))}
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

/* ── Chất lượng video: giao diện + cài đặt nằm ở popups/quality.js; ở đây chỉ nối vào luồng ── */
Q.bind({T,restart:()=>{if(connected&&!demo)startStream(true)},bufferChanged:()=>{if(playout)playout.clear()}});
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
 const b=e.target.closest('.rb');
 if(b){
  const t=b.dataset.t;
  if(t==='key')press(b);
  else if(t==='pin')setPin(!pinned,true);
  else if(t==='full')setFull(!full);
  else if(t==='main')toMain();
  else if(t==='kbd')setKbd(!kbd);
  else if(t==='map'){const k=KMAP();if(k)k.toggle()}
  return}
 if(e.target.closest('#bRetry')){retries=0;startStream()}
 else if(e.target.closest('#bOvlMain'))toMain();
 else if(e.target.closest('#bMin')&&win)win.minimize();
 else if(e.target.closest('#bClose')){win?win.close():window.close()}
});
$('#top').addEventListener('mousedown',e=>{if(e.button!==0||e.target.closest('button')||!win)return;win.startDragging().catch(()=>{})});
document.addEventListener('contextmenu',e=>e.preventDefault());

/* ── Bàn phím máy tính → điện thoại ──
   Bật bằng nút bàn phím trên thanh dọc. Ký tự thường đi qua ô nhập ẩn (tạo bằng JS, không có trong HTML) nên bộ gõ tiếng Việt/IME hoạt động;
   phím đặc biệt (Enter, Backspace, mũi tên, Ctrl+A/C/X/Z...) gửi thành mã phím Android. F11/F3/Esc vẫn là phím của cửa sổ.
   Mọi lệnh xếp hàng tuần tự để chữ và Backspace (bộ gõ như Unikey gửi Backspace + chữ mới) giữ đúng thứ tự. */
let kbd=false,kbQ=Promise.resolve(),kbErrAt=0,kbLast='',kbLastAt=0;
let kbIn=null;   /* ô nhập ẩn: tạo bằng JS khi bật bàn phím, xoá khi tắt — không có trong HTML */
const KB_KEYS={Enter:66,Backspace:67,Delete:112,Tab:61,ArrowUp:19,ArrowDown:20,ArrowLeft:21,ArrowRight:22,Home:122,End:123,PageUp:92,PageDown:93};
const KB_CTRL={a:29,z:54};   /* Ctrl+C / Ctrl+X xử lý riêng: chép nội dung về clipboard máy tính */
function kbSend(cmd,args){
 if(demo)return;
 kbQ=kbQ.then(()=>call(cmd,{serial,...args})).catch(kbErr);
}
function kbErr(e){const n=Date.now();if(n-kbErrAt>2000){kbErrAt=n;toast(T(String(e)))}}
/* Đặt chữ vào clipboard máy tính (cần thao tác phím vừa rồi còn hiệu lực; không được thì dùng cách dự phòng). */
async function pcCopy(text){
 try{await navigator.clipboard.writeText(text);return}catch(_){}
 const ta=document.createElement('textarea');ta.value=text;ta.style.cssText='position:fixed;left:-9999px;top:0;opacity:0';
 document.body.appendChild(ta);ta.select();try{document.execCommand('copy')}catch(_){}ta.remove();
 if(kbIn)kbIn.focus();
}
/* Ctrl+C / Ctrl+X: điện thoại chép (cắt) đoạn đang chọn rồi gửi nội dung về, đặt vào clipboard máy tính. Cùng hàng đợi với chữ đang gõ để đúng thứ tự. */
function kbCopy(cut){
 if(demo)return;
 kbQ=kbQ.then(()=>call('input_copy',{serial,cut})).then(async s=>{
  if(!s){toast(T('Nothing copied from the phone'));return}
  await pcCopy(s);toast(T('Copied from the phone'))
 }).catch(kbErr);
}
const kbText=s=>{if(s)kbSend('input_text',{text:s})};
const kbCode=(code,e)=>kbSend('input_key',{code,ctrl:!!(e.ctrlKey||e.metaKey),shift:!!e.shiftKey,alt:!!e.altKey});
function kbKey(e){
 if(e.isComposing||e.key==='Process'||e.keyCode===229)return false;   /* bộ gõ đang soạn: để ô nhập xử lý */
 if(Lumir.popups.owns(e.target))return false;  /* đang thao tác trong một popup (ví dụ kéo thanh trượt chất lượng) */
 const c=KB_KEYS[e.key];
 if(c){e.preventDefault();kbCode(c,e);return true}
 if((e.ctrlKey||e.metaKey)&&!e.altKey){
  const key=(e.key||'').toLowerCase();
  if(key==='c'||key==='x'){e.preventDefault();kbCopy(key==='x');return true}
  const k=KB_CTRL[key];
  if(k){e.preventDefault();kbCode(k,e);return true}
 }
 return false;   /* ký tự thường, Ctrl+V (sự kiện paste), phím F... → xử lý ở nơi khác */
}
function kbMake(){
 const el=document.createElement('textarea');
 el.setAttribute('aria-hidden','true');el.tabIndex=-1;el.autocomplete='off';el.spellcheck=false;
 el.setAttribute('autocapitalize','off');el.setAttribute('autocorrect','off');
 el.style.cssText='position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;border:0;padding:0;resize:none;pointer-events:none';
 el.addEventListener('input',e=>{
  if(e.isComposing)return;
  const v=el.value;el.value='';
  if(v){kbLast=v;kbLastAt=performance.now();kbText(v)}
 });
 el.addEventListener('compositionend',e=>{
  const v=e.data||el.value;el.value='';
  if(v&&!(v===kbLast&&performance.now()-kbLastAt<60))kbText(v);   /* tránh gửi hai lần nếu trình duyệt đã gửi qua sự kiện input */
 });
 el.addEventListener('paste',e=>{e.preventDefault();kbText((e.clipboardData&&e.clipboardData.getData('text'))||'')});
 document.body.appendChild(el);
 return el;
}
function setKbd(on){
 if(on===kbd)return;
 if(on&&KMAP()&&KMAP().editing){toast(T('Finish editing the key mapping first'));return}
 if(on&&kmActive())KMAP().set(false);   /* gõ chữ và ánh xạ phím không dùng cùng lúc */
 kbd=on;
 const b=$('.rb[data-t=kbd]');if(b){b.classList.toggle('on',on);b.setAttribute('aria-pressed',String(on))}
 if(on){kbIn=kbMake();kbIn.focus();toast(T('Keyboard on: typing goes to the phone'))}
 else{if(kbIn){kbIn.remove();kbIn=null}toast(T('Keyboard off'))}
}
document.addEventListener('mouseup',e=>{if(kbd&&!Lumir.popups.owns(e.target))setTimeout(()=>{if(kbIn)kbIn.focus()},0)});
window.addEventListener('focus',()=>{if(kbd&&kbIn)kbIn.focus()});

/* Ánh xạ phím nằm ở scripts/keymap.js (nạp sau file này) và nối qua window.LumirKeymap; thiếu file đó thì mọi thứ khác vẫn chạy. */
const KMAP=()=>window.LumirKeymap||null;
const kmActive=()=>{const k=KMAP();return !!(k&&k.on)};
document.addEventListener('keydown',e=>{
 if(kmActive()&&KMAP().key(e))return;
 if(kbd&&kbKey(e))return;
 if(e.key==='F11'){e.preventDefault();setFull(!full)}
 else if(e.key==='F3'){e.preventDefault();setRailHidden(!document.body.classList.contains('rail-hidden'))}   /* ẩn/hiện thanh công cụ */
 else if(e.key==='Escape'&&Lumir.popups.closeTop()){e.preventDefault()}   /* Esc đóng popup mở sau cùng */
 else if(e.key==='Escape'&&full){e.preventDefault();setFull(false)}
});
if(win&&win.onResized)win.onResized(()=>requestAnimationFrame(fit)).catch(()=>{});
new ResizeObserver(fit).observe($('#stage'));
mq.addEventListener('change',applyTheme);
/* Đổi ngôn ngữ / giao diện ở cửa sổ chính → cập nhật ngay ở đây */
window.addEventListener('storage',e=>{if(e.key==='lumir'){loadPrefs();applyTheme();applyLang();Q.render()}});

async function init(){
 loadPrefs();Q.load();applyTheme();buildRail();applyLang();Q.render();
 if(demo){serial='DEMO';setDevice({name:'Demo phone',resolution:'1080×2400',status:'connected'});setPin(pinned,false);return}
 try{const c=await call('phone_context');serial=c.serial;setDevice(c.device||{status:'disconnected'})}
 catch(e){setDevice({status:'disconnected'})}
 await TA.event.listen('devices-changed',ev=>{const d=ev.payload.find(x=>x.serial===serial);setDevice(d||{status:'disconnected'})});
 setPin(pinned,false);
}
/* API cho scripts/keymap.js (file này nằm trong IIFE nên các biến của nó không tự lộ ra ngoài) */
window.LumirPhone={call,toast,T,VI,$,cv,demo,landscape,kbErr,setKbd,get serial(){return serial},get kbd(){return kbd},get connected(){return connected},get device(){return dev}};
init();
})();