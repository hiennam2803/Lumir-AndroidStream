/* LUMIR · Bộ đệm phát (de-jitter) cho video qua Wi-Fi.
 *
 * Vì sao cần: qua Wi-Fi, ADB dồn mọi thứ vào một kết nối TCP nên thỉnh thoảng một khung tới trễ 70–100 ms rồi các khung sau dồn về.
 * Vẽ ngay khi tới thì thấy "giật một nhịp". Bộ đệm này giữ lại khoảng `delay` ms khung rồi phát đều theo nhịp của nguồn:
 * một khung tới trễ không quá `delay` ms được các khung đã đệm sẵn che đi. Đổi lại thêm đúng khoảng `delay` ms độ trễ.
 *
 * Thuật toán (không cần timestamp từ điện thoại):
 *  - I = ước lượng khoảng cách giữa hai khung của nguồn (trung bình trượt, đã kẹp để một lần kẹt/dồn không làm lệch).
 *  - Khung đầu tiên (hoặc sau khi nguồn đứng im lâu): hẹn phát lúc `tới + delay`, các khung sau xếp hàng — đó là lúc "đệm đầy".
 *  - Sau đó phát mỗi I ms một khung. Nhiều khung cùng đến hạn (bị trễ) → chỉ vẽ khung mới nhất.
 *  - Hàng đợi vượt trần (sau khi dồn cục) → bỏ khung cũ nhất để độ trễ không phình ra.
 *  - Hết khung mà khung kế đến trễ → vẽ ngay khi tới (không giữ thêm).
 * Mọi khung đưa vào đều được `paint` hoặc `close` đúng một lần. Thời gian, rAF, vẽ, đóng đều được truyền vào để kiểm thử.
 */
(function (root) {
'use strict';
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

class Playout {
  constructor({ now, raf, caf, paint, close, onDrop }) {
    this.now = now; this.raf = raf; this.caf = caf; this.paint = paint; this.close = close; this.onDrop = onDrop || (() => {});
    this.delay = 0;          /* ms; do bên ngoài đặt */
    this.I = 33;             /* ms, khoảng cách khung ước lượng */
    this.q = [];             /* [{ f, a }] */
    this.next = null;        /* thời điểm hẹn phát khung đầu hàng */
    this.lastArr = null; this.lastPlay = -Infinity; this.h = 0;
  }
  get depth() { return this.q.length; }
  _drop(e) { try { this.close(e.f); } catch (_) {} this.onDrop(); }

  push(f) {
    const a = this.now(), D = this.delay;
    if (this.lastArr != null) {
      const g = a - this.lastArr;
      if (g > 0 && g <= this.I * 4) this.I = clamp(this.I + (clamp(g, this.I * 0.5, this.I * 1.5) - this.I) * 0.08, 4, 100);
    }
    this.lastArr = a;
    if (!this.q.length) {
      if (this.next == null || a - this.lastPlay > Math.max(250, this.I * 8)) this.next = a + D;   /* bắt đầu / nguồn đứng im lâu: dựng đệm (kẹt mạng ngắn hơn thế thì vẽ ngay khi tới, khỏi chờ thêm) */
      else if (a > this.next) this.next = a;                                                        /* khung tới trễ, đệm đã cạn: vẽ ngay */
    }
    this.q.push({ f, a });
    const cap = Math.ceil(D / this.I) + 2;
    while (this.q.length > cap) this._drop(this.q.shift());
    this._kick();
  }

  _kick() { if (!this.h && this.q.length) this.h = this.raf(t => this._tick(t)); }

  _tick(t) {
    this.h = 0;
    const T = Number.isFinite(t) ? t : this.now();   /* mốc rAF và this.now() cùng gốc thời gian (performance.now) */
    let out = null;
    while (this.q.length && this.next != null && T >= this.next) {
      const e = this.q.shift();
      if (out) this._drop(out);                      /* nhiều khung cùng đến hạn: chỉ giữ khung mới nhất */
      out = e; this.next += this.I;
    }
    if (out) { this.paint(out.f); this.lastPlay = T; }
    if (this.next != null && T - this.next > this.I * 2) this.next = T;   /* trễ quá xa (rAF bị chặn…): neo lại, đừng phát dồn */
    this._kick();
  }

  /* Bỏ hết khung đang chờ (đóng bộ giải mã, đổi chế độ…). */
  clear() {
    if (this.h) { try { this.caf(this.h); } catch (_) {} this.h = 0; }
    for (const e of this.q) { try { this.close(e.f); } catch (_) {} }
    this.q.length = 0; this.next = null; this.lastArr = null;
  }
}

const api = { Playout };
if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.LumirPlayout = api;
})(typeof window !== 'undefined' ? window : globalThis);
