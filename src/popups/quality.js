/* LUMIR · popups/quality.js — popup "Chất lượng video": giao diện, cài đặt (lưu localStorage 'lumir-q') và bản dịch của riêng nó.
 *
 * Phần còn lại của app chỉ cần:
 *   Lumir.quality.state          — { mode, side, mbps, fps, buf } (đối tượng sống, đọc trực tiếp khi mở luồng / giải mã)
 *   Lumir.quality.bind({ T, restart, bufferChanged })  — nối dịch + 2 sự kiện: cần mở lại luồng / đổi cách phát ở JS
 *   Lumir.quality.load() / .render()  — nạp cài đặt đã lưu / vẽ lại (ví dụ sau khi đổi ngôn ngữ)
 *   Lumir.quality.vi             — các chuỗi dịch tiếng Việt của popup, để từ điển cửa sổ gộp vào
 *
 * screenrecord không có tuỳ chọn FPS (xuất khung mỗi khi màn hình đổi), nên "mượt / FPS cao" = độ phân giải và bitrate
 * thấp để encoder + cáp USB theo kịp; "sắc nét" = ngược lại. Đổi chế độ / FPS thì mở lại luồng video (~0,5 giây), kênh
 * điều khiển cảm ứng không bị ảnh hưởng. Độ đệm mạng chỉ đổi cách phát ở JS nên không cần mở lại luồng.
 */
(() => {
'use strict';
const L = (window.Lumir = window.Lumir || {});
const $ = s => document.querySelector(s), $$ = s => [...document.querySelectorAll(s)];

const PRESETS = {
  smooth: { side: 720, mbps: 4, d: 'Low resolution, fastest response' },
  balanced: { side: 1280, mbps: 8, d: 'Good quality, low latency' },
  sharp: { side: 1920, mbps: 16, d: 'Full detail, needs a good cable' },
  custom: { d: 'Set resolution and bitrate yourself' },
};
const FPS_OPTS = [30, 60, 90, 120], BUF_OPTS = [0, 35, 70];
const state = { mode: 'balanced', side: 1280, mbps: 8, fps: 60, buf: 0 };
const hooks = { T: k => k, restart() {}, bufferChanged() {} };
const T = (...a) => hooks.T(...a);

const VI = {
  "Video quality": "Chất lượng video",
  "Smooth": "Mượt",
  "Balanced": "Cân bằng",
  "Sharp": "Sắc nét",
  "Custom": "Tuỳ chỉnh",
  "Resolution (long side)": "Độ phân giải (cạnh dài)",
  "Bitrate": "Bitrate",
  "Low resolution, fastest response": "Độ phân giải thấp, phản hồi nhanh nhất",
  "Good quality, low latency": "Chất lượng tốt, độ trễ thấp",
  "Full detail, needs a good cable": "Nhiều chi tiết, cần cáp USB tốt",
  "Set resolution and bitrate yourself": "Tự chọn độ phân giải và bitrate",
  "Frame rate": "Tốc độ khung hình",
  "High frame rates need a capable phone and may run warm.": "Tốc độ cao cần điện thoại đủ mạnh và có thể làm máy nóng.",
  "Network buffer": "Độ đệm mạng",
  "Off": "Tắt",
  "Low": "Thấp",
  "Medium": "Vừa",
  "Smooths Wi-Fi hiccups but adds delay. Keep Off for USB or fast games.": "Làm mượt cú giật do Wi-Fi nhưng thêm độ trễ. Nên để Tắt khi dùng USB hoặc chơi game cần phản hồi nhanh.",
};

const HTML = `
<div class="qp" id="qp" role="dialog" aria-label="Video quality" hidden>
  <div class="qp-h" data-t="Video quality">Video quality</div>
  <div class="qp-seg" id="qpSeg">
    <button data-m="smooth" data-t="Smooth">Smooth</button>
    <button data-m="balanced" data-t="Balanced">Balanced</button>
    <button data-m="sharp" data-t="Sharp">Sharp</button>
    <button data-m="custom" data-t="Custom">Custom</button>
  </div>
  <div class="qp-d" id="qpD"></div>
  <div class="qp-c" id="qpC" hidden>
    <label><span class="qp-l"><span data-t="Resolution (long side)">Resolution (long side)</span><b id="qpResV"></b></span>
      <input type="range" id="qpRes" min="320" max="2560" step="80"></label>
    <label><span class="qp-l"><span data-t="Bitrate">Bitrate</span><b id="qpBrV"></b></span>
      <input type="range" id="qpBr" min="1" max="32" step="1"></label>
  </div>
  <div class="qp-f">
    <span class="qp-l"><span data-t="Frame rate">Frame rate</span><b id="qpFpsV"></b></span>
    <div class="qp-seg f4" id="qpFps" role="group" aria-label="Frame rate">
      <button data-f="30">30</button><button data-f="60">60</button><button data-f="90">90</button><button data-f="120">120</button>
    </div>
    <div class="qp-d" id="qpFpsN"></div>
  </div>
  <div class="qp-f">
    <span class="qp-l"><span data-t="Network buffer">Network buffer</span><b id="qpBufV"></b></span>
    <div class="qp-seg f3" id="qpBuf" role="group" aria-label="Network buffer">
      <button data-b="0" data-t="Off">Off</button><button data-b="35" data-t="Low">Low</button><button data-b="70" data-t="Medium">Medium</button>
    </div>
    <div class="qp-d" id="qpBufN"></div>
  </div>
</div>`;
if (!document.getElementById('qp')) document.body.insertAdjacentHTML('beforeend', HTML);

function load() {
  try {
    const v = JSON.parse(localStorage.getItem('lumir-q') || '{}');
    if (PRESETS[v.mode]) state.mode = v.mode;
    if (v.side >= 320 && v.side <= 2560) state.side = v.side | 0;
    if (v.mbps >= 1 && v.mbps <= 32) state.mbps = v.mbps | 0;
    if (FPS_OPTS.includes(v.fps)) state.fps = v.fps;
    if (BUF_OPTS.includes(v.buf)) state.buf = v.buf;
  } catch (_) {}
  const p = PRESETS[state.mode]; if (p.side) { state.side = p.side; state.mbps = p.mbps; }
}
function save() { try { localStorage.setItem('lumir-q', JSON.stringify(state)); } catch (_) {} }

function render() {
  const q = state;
  $$('#qpSeg button').forEach(b => b.classList.toggle('on', b.dataset.m === q.mode));
  $('#qpD').textContent = T(PRESETS[q.mode].d);
  $('#qpC').hidden = q.mode !== 'custom';
  $('#qpRes').value = q.side; $('#qpBr').value = q.mbps;
  $('#qpResV').textContent = q.side + ' px'; $('#qpBrV').textContent = q.mbps + ' Mbps';
  $$('#qpFps button').forEach(b => b.classList.toggle('on', +b.dataset.f === q.fps));
  $('#qpFpsV').textContent = q.fps + ' fps';
  $('#qpFpsN').textContent = q.fps > 60 ? T('High frame rates need a capable phone and may run warm.') : '';
  $$('#qpBuf button').forEach(b => b.classList.toggle('on', +b.dataset.b === q.buf));
  $('#qpBufV').textContent = q.buf ? '+' + q.buf + ' ms' : T('Off');
  $('#qpBufN').textContent = q.buf ? T('Smooths Wi-Fi hiccups but adds delay. Keep Off for USB or fast games.') : '';
}
/* Đổi cài đặt cần mở lại luồng: lưu → vẽ lại → báo cho cửa sổ. */
function apply() { save(); render(); hooks.restart(); }

$('#qpSeg').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || b.dataset.m === state.mode) return;
  state.mode = b.dataset.m; const p = PRESETS[state.mode]; if (p.side) { state.side = p.side; state.mbps = p.mbps; }
  apply();
});
$('#qpRes').addEventListener('input', e => { state.side = +e.target.value; $('#qpResV').textContent = state.side + ' px'; });
$('#qpBr').addEventListener('input', e => { state.mbps = +e.target.value; $('#qpBrV').textContent = state.mbps + ' Mbps'; });
$('#qpRes').addEventListener('change', apply);
$('#qpBr').addEventListener('change', apply);
$('#qpFps').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || +b.dataset.f === state.fps) return;
  state.fps = +b.dataset.f; apply();
});
$('#qpBuf').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b || +b.dataset.b === state.buf) return;
  state.buf = +b.dataset.b; hooks.bufferChanged(); save(); render();   /* không cần mở lại luồng */
});

L.popups.register({ id: 'quality', el: '#qp', button: 'qual', handle: '.qp-h', persist: 'qp', outside: true });
L.quality = { state, vi: VI, load, render, bind(h) { Object.assign(hooks, h); } };
})();
