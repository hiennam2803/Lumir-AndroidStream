/* LUMIR Performance Monitor.
 * Frontend-only instrumentation: deliberately does not modify stream packets or scheduling.
 * Packet FPS means frame packets received by this WebView, not raw Rust/ADB input FPS.
 * Các chỉ số mở rộng (arrival / RTT / loss / lag / long task / dropped / GPU / fps_1s / fps_5s): xem PERFORMANCE-MONITOR.md.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const TA=window.__TAURI__;
const now=()=>performance.now();
const state={packet:0,decoder:0,render:0,errors:0,bytes:0,decodeDur:[],drawDur:[],pending:[],samples:[],last:now(),open:false,
 latest:{packet:0,decoder:0,render:0,queue:0,decodeMs:null,drawMs:null,memory:null},
 /* mở rộng */
 arriveLast:null,arrive:[],           /* khoảng cách giữa hai packet liên tiếp trong 1 giây vừa qua (ms) */
 recv:0,discarded:0,lostReset:0,dropSec:0,dropTotal:0,   /* packet nhận / bỏ trước giải mã / mất do reset decoder */
 renderTs:[],renderSince:null,        /* mốc thời gian từng lần vẽ, để tính fps_1s / fps_5s trượt */
 lag:[],long:[],rtt:[],gpu:null,
 coalesceSec:0,rust:null,rustAt:0};   /* rust = số liệu K_STATS gần nhất từ Rust */
/* Lưu theo khối 2 phút (mỗi mẫu 1 giây): ghi đủ 4 phút thì xoá 2 phút cũ nhất, rồi ghi tiếp — nên luôn giữ từ 2 đến 4 phút gần nhất. */
const BLOCK=120,CAP=BLOCK*2;
function addBounded(a,v,n=240){a.push(v);if(a.length>n)a.shift()}
function avgTail(a){if(!a.length)return null;return a.reduce((x,y)=>x+y,0)/a.length}
function maxOf(a){if(!a.length)return null;let m=a[0];for(const v of a)if(v>m)m=v;return m}
function fmt(v,d=1){return v==null?'—':v.toFixed(d)}
function ms(v,d=1){return v==null?'—':fmt(v,d)+' ms'}
function set(id,value){const e=$(id);if(e)e.textContent=value}
const clamp=(v,a,b)=>Math.min(b,Math.max(a,v));

/* ── Event loop lag: timer 50 ms; trễ = lần chạy thực tế − lần dự kiến. Bỏ qua khi cửa sổ ẩn (trình duyệt tự giãn timer). ── */
const LAG_STEP=50;let lagExpect=now()+LAG_STEP;
setInterval(()=>{const n=now(),l=Math.max(0,n-lagExpect);lagExpect=n+LAG_STEP;if(!document.hidden&&l<5000)addBounded(state.lag,l,100)},LAG_STEP);

/* ── Long task: PerformanceObserver 'longtask' (tác vụ JS/layout > 50 ms trên main thread). WebView không hỗ trợ → N/A. ── */
let longOk=false;
try{
 if(window.PerformanceObserver&&(PerformanceObserver.supportedEntryTypes||[]).includes('longtask')){
  new PerformanceObserver(list=>{for(const e of list.getEntries())addBounded(state.long,e.duration,200)}).observe({entryTypes:['longtask']});longOk=true;
 }
}catch(_){longOk=false}

/* ── RTT: vòng đi-về Tauri IPC (WebView → Rust → WebView) bằng lệnh `ping`. Không phải RTT tới điện thoại. Thiếu lệnh → N/A. ── */
let rttOff=!(TA&&TA.core&&TA.core.invoke),rttBusy=false;
async function sampleRtt(){
 if(rttOff||rttBusy)return;rttBusy=true;
 try{const t=now();await TA.core.invoke('ping');addBounded(state.rtt,now()-t,5)}
 catch(_){rttOff=true;state.rtt.length=0}
 finally{rttBusy=false}
}
/* ── GPU: WebView không đọc được mức dùng GPU. Chỉ có số thật nếu ai đó gắn window.__lumirGpuUsage() (trả 0..100, hoặc Promise). ── */
async function sampleGpu(){
 try{const f=window.__lumirGpuUsage;if(typeof f!=='function'){state.gpu=null;return}
  const v=await f();state.gpu=Number.isFinite(v)?clamp(v,0,100):null}catch(_){state.gpu=null}
}

/* FPS trung bình trượt: số lần vẽ trong `win` ms gần nhất / độ dài cửa sổ (chưa đủ cửa sổ thì chia theo thời gian đã có). */
function fpsWindow(t,win){
 const a=state.renderTs;if(!a.length||state.renderSince==null)return null;
 let c=0;for(let i=a.length-1;i>=0&&a[i]>=t-win;i--)c++;
 const span=Math.min(win,t-state.renderSince);
 return span>=250?c/(span/1000):null;
}

function fpsTick(){
 const t=now(),dt=Math.max(1,t-state.last)/1000;state.last=t;
 const packet=state.packet/dt,decoder=state.decoder/dt,render=state.render/dt;
 state.packet=state.decoder=state.render=0;
 let memory=null;try{if(performance.memory&&Number.isFinite(performance.memory.usedJSHeapSize))memory=performance.memory.usedJSHeapSize/1048576}catch(_){}
 let queue=null;try{queue=window.__lumirDecoderQueue==null?null:window.__lumirDecoderQueue()}catch(_){}
 const decodeMs=avgTail(state.decodeDur),drawMs=avgTail(state.drawDur);

 /* mở rộng — tính trên 1 giây vừa qua rồi xoá bộ đệm giây */
 const arriveAvg=avgTail(state.arrive),arriveMax=maxOf(state.arrive);
 const lossPct=state.recv?state.discarded/state.recv*100:null;
 const dropped1s=state.dropSec;
 const lagAvg=avgTail(state.lag),lagMax=maxOf(state.lag);
 const longMax=longOk?(maxOf(state.long)||0):null,longCnt=longOk?state.long.length:null;
 const rtt=avgTail(state.rtt);
 const renderLoad=drawMs==null?null:clamp(drawMs*render/10,0,100);   /* ms vẽ mỗi khung × số khung/giây ÷ 1000 ms */
 state.renderTs=state.renderTs.filter(x=>x>=t-5000);if(!state.renderTs.length)state.renderSince=null;
 const fps1=fpsWindow(t,1000),fps5=fpsWindow(t,5000);
 const coalesced1s=state.coalesceSec;state.coalesceSec=0;
 const rs=state.rust&&now()-state.rustAt<3000?state.rust:null;state.rust=null;   /* quá 3 giây không có gói mới → coi như không có */
 state.arrive.length=0;state.recv=0;state.discarded=0;state.dropSec=0;state.lag.length=0;state.long.length=0;
 sampleRtt();sampleGpu();

 state.latest={packet,decoder,render,queue,decodeMs,drawMs,memory,arriveAvg,arriveMax,lossPct,dropped1s,lagAvg,lagMax,longMax,longCnt,rtt,renderLoad,fps1,fps5,coalesced1s,rs};
 if(state.open){
  set('perfPacket',fmt(packet,0));set('perfDecoder',fmt(decoder,0));set('perfRender',fmt(render,0));
  set('perfQueue',queue==null?'—':String(queue));set('perfDecodeMs',decodeMs==null?'—':fmt(decodeMs,2)+' ms');
  set('perfDrawMs',drawMs==null?'—':fmt(drawMs,2)+' ms');set('perfMemory',memory==null?'N/A':fmt(memory,0)+' MB');set('perfErrors',String(state.errors));
  set('perfState',document.getElementById('phone')?.classList.contains('live')?'Streaming':'Waiting for stream');
  set('perfFps1',fps1==null?'—':fmt(fps1,1));set('perfFps5',fps5==null?'—':fmt(fps5,1));
  set('perfArrive',arriveAvg==null?'—':fmt(arriveAvg,1)+' / '+fmt(arriveMax,0)+' ms');
  set('perfRtt',rttOff?'N/A':ms(rtt,1));
  set('perfLoss',lossPct==null?'—':fmt(lossPct,1)+' %');
  set('perfDropped',state.dropTotal+(dropped1s?' (+'+dropped1s+')':''));
  set('perfLag',lagAvg==null?'—':fmt(lagAvg,1)+' / '+fmt(lagMax,0)+' ms');
  set('perfLong',longOk?(longCnt?fmt(longMax,0)+' ms ×'+longCnt:'0'):'N/A');
  set('perfGpu',state.gpu==null?'N/A':fmt(state.gpu,0)+' %');
  set('perfLoad',renderLoad==null?'—':fmt(renderLoad,0)+' %');
  set('perfCoalesce',String(coalesced1s));
  set('perfPts',rs?rs.ptsGap+' ms':'N/A');set('perfRead',rs?rs.readGap+' ms':'N/A');
  set('perfSend',rs?rs.sendMax+' ms':'N/A');set('perfTransit',rs&&rs.transit!=null?rs.transit+' ms':'N/A');
 }
 const sample={time:new Date().toISOString(),packet_fps:packet,decoder_fps:decoder,render_fps:render,decode_queue:queue,decode_to_output_avg_ms:decodeMs,canvas_draw_avg_ms:drawMs,js_heap_mb:memory,decoder_errors:state.errors,
  fps_1s:fps1,fps_5s:fps5,frame_arrival_interval_avg_ms:arriveAvg,frame_arrival_interval_max_ms:arriveMax,network_rtt_ms:rtt,packet_loss_pct:lossPct,
  dropped_frames:state.dropTotal,dropped_frames_1s:dropped1s,event_loop_lag_avg_ms:lagAvg,event_loop_lag_max_ms:lagMax,
  long_task_duration_max_ms:longMax,long_task_count:longCnt,gpu_usage_pct:state.gpu,render_load_pct:renderLoad,
  coalesced_frames_1s:coalesced1s,device_pts_gap_max_ms:rs?rs.ptsGap:null,rust_read_gap_max_ms:rs?rs.readGap:null,rust_send_max_ms:rs?rs.sendMax:null,rust_to_js_transit_ms:rs?rs.transit:null};
 state.samples.push(sample);if(state.samples.length>=CAP)state.samples.splice(0,BLOCK);drawChart();
}
function drawChart(){
 const line=$('perfLine');if(!line)return;const a=state.samples.slice(-60);if(!a.length){line.setAttribute('points','');return}
 const max=Math.max(60,...a.map(x=>x.render_fps||0));
 const points=a.map((x,i)=>`${(i/(Math.max(1,a.length-1)))*280},${60-Math.min(60,(x.render_fps||0)/max*54)}`).join(' ');
 line.setAttribute('points',points);
}
function toggle(force){state.open=force==null?!state.open:!!force;$('perfPanel').hidden=!state.open;
 const b=document.querySelector('.rb[data-t=perf]');if(b){b.classList.toggle('on',state.open);b.setAttribute('aria-pressed',String(state.open))}
 if(state.open)fpsTick()}
function csv(){
 const cols=['time','packet_fps','decoder_fps','render_fps','fps_1s','fps_5s','decode_queue','decode_to_output_avg_ms','canvas_draw_avg_ms','frame_arrival_interval_avg_ms','frame_arrival_interval_max_ms','network_rtt_ms','packet_loss_pct','dropped_frames','dropped_frames_1s','event_loop_lag_avg_ms','event_loop_lag_max_ms','long_task_duration_max_ms','long_task_count','gpu_usage_pct','render_load_pct','coalesced_frames_1s','device_pts_gap_max_ms','rust_read_gap_max_ms','rust_send_max_ms','rust_to_js_transit_ms','js_heap_mb','decoder_errors'];
 const esc=v=>{if(v==null)return '';const s=typeof v==='number'?String(Math.round(v*1000)/1000):String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
 const body=[cols.join(','),...state.samples.map(r=>cols.map(k=>esc(r[k])).join(','))].join('\r\n');
 const blob=new Blob([body],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`lumir-performance-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
/* Gói K_STATS (24 byte big-endian): pts_gap_ms · read_gap_ms · send_ms · số gói · epoch_ms. */
function parseRust(p){
 const v=new DataView(p.buffer,p.byteOffset,p.byteLength);
 const sentAt=Number(v.getBigUint64(16,false));
 return{ptsGap:v.getUint32(0,false),readGap:v.getUint32(4,false),sendMax:v.getUint32(8,false),packets:v.getUint32(12,false),
  transit:sentAt>0?Math.max(0,Date.now()-sentAt):null};   /* cùng máy, cùng đồng hồ: thời gian gói đi từ Rust tới WebView (xếp sau các khung nên gồm cả hàng đợi) */
}
window.LumirPerf={
 /* Rust → JS: số liệu chẩn đoán 1 giây/lần (chỉ có khi video đi qua scrcpy-server) */
 rustStats(p){try{state.rust=parseRust(p);state.rustAt=now()}catch(_){state.rust=null}},
 /* khung dồn cục: một khung đang chờ bị thay bằng khung mới hơn, không vẽ (không tính là mất khung) */
 coalesced(){state.coalesceSec++},
 packet(bytes){const t=now();state.packet++;state.recv++;state.bytes+=bytes||0;if(state.arriveLast!=null)addBounded(state.arrive,t-state.arriveLast,600);state.arriveLast=t},
 /* packet đã nhận nhưng không được đưa vào decoder (chưa có decoder / đang chờ IDR) */
 packetDropped(){state.discarded++;state.dropSec++;state.dropTotal++},
 decodeSubmitted(){addBounded(state.pending,now(),300)},
 decoderOutput(){state.decoder++;const t=state.pending.shift();if(t!=null)addBounded(state.decodeDur,now()-t)},
 renderStart(){return now()},
 renderEnd(start){const t=now();state.render++;if(!state.renderTs.length)state.renderSince=t;state.renderTs.push(t);if(Number.isFinite(start))addBounded(state.drawDur,t-start)},
 decoderError(){state.errors++},
 /* decoder bị đóng/mở lại: các khung đã nộp mà chưa có output coi như mất */
 resetPending(){const n=state.pending.length;if(n){state.dropSec+=n;state.dropTotal+=n}state.pending.length=0;state.arriveLast=null},
 toggle(force){toggle(force)},
};
$('perfExport')?.addEventListener('click',csv);
$('perfClose')?.addEventListener('click',()=>toggle(false));
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.open)toggle(false)});
setInterval(fpsTick,1000);
})();