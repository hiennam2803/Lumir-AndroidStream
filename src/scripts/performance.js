/* LUMIR Performance Monitor.
 * Frontend-only instrumentation: deliberately does not modify stream packets or scheduling.
 * Packet FPS means frame packets received by this WebView, not raw Rust/ADB input FPS.
 */
(()=>{
'use strict';
const $=id=>document.getElementById(id);
const state={packet:0,decoder:0,render:0,errors:0,bytes:0,decodeDur:[],drawDur:[],pending:[],samples:[],last:performance.now(),open:false,latest:{packet:0,decoder:0,render:0,queue:0,decodeMs:null,drawMs:null,memory:null}};
const MAX=120;
function addBounded(a,v,n=240){a.push(v);if(a.length>n)a.shift()}
function avgTail(a){if(!a.length)return null;return a.reduce((x,y)=>x+y,0)/a.length}
function fmt(v,d=1){return v==null?'—':v.toFixed(d)}
function set(id,value){const e=$(id);if(e)e.textContent=value}
function fpsTick(){
 const now=performance.now(),dt=Math.max(1,now-state.last)/1000;state.last=now;
 const packet=state.packet/dt,decoder=state.decoder/dt,render=state.render/dt;
 state.packet=state.decoder=state.render=0;
 let memory=null;try{if(performance.memory&&Number.isFinite(performance.memory.usedJSHeapSize))memory=performance.memory.usedJSHeapSize/1048576}catch(_){}
 let queue=null;try{queue=window.__lumirDecoderQueue==null?null:window.__lumirDecoderQueue()}catch(_){}
 const decodeMs=avgTail(state.decodeDur),drawMs=avgTail(state.drawDur);
 state.latest={packet,decoder,render,queue,decodeMs,drawMs,memory};
 if(state.open){
  set('perfPacket',fmt(packet,0));set('perfDecoder',fmt(decoder,0));set('perfRender',fmt(render,0));
  set('perfQueue',queue==null?'—':String(queue));set('perfDecodeMs',decodeMs==null?'—':fmt(decodeMs,2)+' ms');
  set('perfDrawMs',drawMs==null?'—':fmt(drawMs,2)+' ms');set('perfMemory',memory==null?'N/A':fmt(memory,0)+' MB');set('perfErrors',String(state.errors));
  set('perfState',document.getElementById('phone')?.classList.contains('live')?'Streaming':'Waiting for stream');
 }
 const sample={time:new Date().toISOString(),packet_fps:packet,decoder_fps:decoder,render_fps:render,decode_queue:queue,decode_to_output_avg_ms:decodeMs,canvas_draw_avg_ms:drawMs,js_heap_mb:memory,decoder_errors:state.errors};
 addBounded(state.samples,sample,MAX);drawChart();
}
function drawChart(){
 const line=$('perfLine');if(!line)return;const a=state.samples.slice(-60);if(!a.length){line.setAttribute('points','');return}
 const max=Math.max(60,...a.map(x=>x.render_fps||0));
 const points=a.map((x,i)=>`${(i/(Math.max(1,a.length-1)))*280},${60-Math.min(60,(x.render_fps||0)/max*54)}`).join(' ');
 line.setAttribute('points',points);
}
function toggle(force){state.open=force==null?!state.open:!!force;$('perfPanel').hidden=!state.open;if(state.open)fpsTick()}
function csv(){
 const cols=['time','packet_fps','decoder_fps','render_fps','decode_queue','decode_to_output_avg_ms','canvas_draw_avg_ms','js_heap_mb','decoder_errors'];
 const esc=v=>{if(v==null)return '';const s=String(v);return /[",\n]/.test(s)?'"'+s.replace(/"/g,'""')+'"':s};
 const body=[cols.join(','),...state.samples.map(r=>cols.map(k=>esc(r[k])).join(','))].join('\r\n');
 const blob=new Blob([body],{type:'text/csv;charset=utf-8'}),url=URL.createObjectURL(blob),a=document.createElement('a');
 a.href=url;a.download=`lumir-performance-${new Date().toISOString().replace(/[:.]/g,'-')}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
}
window.LumirPerf={
 packet(bytes){state.packet++;state.bytes+=bytes||0},
 decodeSubmitted(){addBounded(state.pending,performance.now(),300)},
 decoderOutput(){state.decoder++;const t=state.pending.shift();if(t!=null)addBounded(state.decodeDur,performance.now()-t)},
 renderStart(){return performance.now()},
 renderEnd(start){state.render++;if(Number.isFinite(start))addBounded(state.drawDur,performance.now()-start)},
 decoderError(){state.errors++},
 resetPending(){state.pending.length=0},
 toggle(force){toggle(force)},
};
$('perfExport')?.addEventListener('click',csv);
document.addEventListener('keydown',e=>{if(e.key==='Escape'&&state.open)toggle(false)});
setInterval(fpsTick,1000);
})();
