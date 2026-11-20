//! Điều khiển độ trễ thấp + theo dõi hướng xoay màn hình, mỗi thiết bị một `Link`.
//!
//! * Một phiên `adb shell sh` (stdin là pipe nên không cấp pty) sống suốt thời gian cửa sổ mở: không phải khởi động lại adb cho từng thao tác.
//!   Phím điều hướng và cử chỉ dự phòng (`input tap|swipe`) chạy nền (`&`) qua phiên này.
//! * Chạm/phím thời gian thực ưu tiên số 1: kênh scrcpy-server (ctl.rs), một socket mở sẵn, tiêm bằng InputManager
//!   như `input tap` nhưng mỗi sự kiện chỉ vài ms; hỗ trợ kéo/thả/nhấn giữ đúng nghĩa.
//! * Dự phòng 1: ghi thẳng sự kiện đa điểm (protocol B) vào `/dev/input/eventN` của màn hình cảm ứng
//!   (`printf '\ooo…' >&3`). Mỗi lần chạm/kéo chỉ tốn ~1–3 ms phía máy (so với ~100–300 ms của `input`).
//!   Nếu máy không cho ghi (SELinux/hãng), tự động quay về `input tap|swipe`.
//! * Một tiến trình nhẹ đọc hướng xoay (0–3) để stream đổi kích thước video và để quy đổi toạ độ chạm.
//!
//! Không phụ thuộc Tauri; phần thuần (parse, quy đổi toạ độ, dựng byte) có test.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Write};
use std::process::{Child, ChildStdin};
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU8, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::thread;
use std::time::{Duration, Instant};

use crate::adb::Adb;
use crate::ctl::{Act, Ctl};
use crate::device::AppState;

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

/// Dưới ngưỡng này (và không di chuyển) thì là chạm nhanh; lâu hơn = nhấn giữ. Chỉ dùng ở đường dự phòng.
const TAP_MAX_MS: u128 = 180;
const SWIPE_MAX_MS: u128 = 5000;

// ───────────────────────── Hướng xoay ─────────────────────────

const UNKNOWN: u8 = 255;

/// Lấy hướng hiển thị: `dumpsys input` (mọi đời Android) rồi tới `dumpsys window` nếu không thấy.
/// `sleep 0.5` lỗi trên toolbox cũ → lùi về `sleep 1` để vòng lặp không bao giờ quay trống.
const ORIENT_SCRIPT: &str = "while :; do o=$(dumpsys input 2>/dev/null | grep -m1 -E 'SurfaceOrientation|[Vv]iewport.*orientation'); \
[ -z \"$o\" ] && o=$(dumpsys window displays 2>/dev/null | grep -m1 -E 'mCurrentRotation|mRotation='); \
echo \"$o\"; sleep 0.5 2>/dev/null || sleep 1; done";

/// Đọc hướng xoay từ một dòng của dumpsys. 0 = dọc, 1 = ngang (xoay trái), 2 = dọc ngược, 3 = ngang (xoay phải).
pub fn parse_orientation(line: &str) -> Option<u8> {
    for key in ["SurfaceOrientation", "orientation", "mCurrentRotation", "mRotation"] {
        let Some(p) = line.find(key) else { continue };
        let rest = line[p + key.len()..].trim_start_matches([':', '=', ' ']);
        let named = rest.strip_prefix("ROTATION_").or_else(|| rest.strip_prefix("ORIENTATION_"));
        if let Some(n) = named {
            let digits: String = n.chars().take_while(|c| c.is_ascii_digit()).collect();
            return match digits.as_str() {
                "0" => Some(0),
                "90" => Some(1),
                "180" => Some(2),
                "270" => Some(3),
                _ => None,
            };
        }
        if let Some(n) = rest.chars().next().and_then(|c| c.to_digit(10)) {
            if n < 4 {
                return Some(n as u8);
            }
        }
    }
    None
}

pub struct Orient {
    val: AtomicU8,
    child: Mutex<Option<Child>>,
}

impl Orient {
    fn spawn(adb: &Adb, serial: &str) -> Arc<Orient> {
        let o = Arc::new(Orient { val: AtomicU8::new(UNKNOWN), child: Mutex::new(None) });
        if let Ok(mut c) = adb.spawn_session(&["-s", serial, "exec-out", ORIENT_SCRIPT], true) {
            if let Some(out) = c.stdout.take() {
                let o2 = o.clone();
                let _ = thread::Builder::new().name("lumir-orient".into()).spawn(move || {
                    for line in BufReader::new(out).lines().map_while(|l| l.ok()) {
                        if let Some(r) = parse_orientation(&line) {
                            o2.val.store(r, Ordering::SeqCst);
                        }
                    }
                });
            }
            *lock(&o.child) = Some(c);
        }
        o
    }

    /// Hướng hiện tại, `None` nếu chưa đọc được.
    pub fn get(&self) -> Option<u8> {
        match self.val.load(Ordering::SeqCst) {
            UNKNOWN => None,
            v => Some(v),
        }
    }

    fn stop(&self) {
        if let Some(mut c) = lock(&self.child).take() {
            let _ = c.kill();
            let _ = c.wait();
        }
    }
}

/// Toạ độ (a, b) trên khung hình đang hiển thị (0..1) → toạ độ theo hướng TỰ NHIÊN của máy (u ngang, v dọc).
/// Cảm ứng báo toạ độ thô theo hướng tự nhiên; Android mới là bên xoay chúng theo màn hình.
pub fn to_natural(rot: u8, a: f64, b: f64) -> (f64, f64) {
    match rot % 4 {
        1 => (1.0 - b, a),
        2 => (1.0 - a, 1.0 - b),
        3 => (b, 1.0 - a),
        _ => (a, b),
    }
}

// ───────────────────────── Màn hình cảm ứng (evdev) ─────────────────────────

#[derive(Debug, Clone, PartialEq)]
pub struct PadInfo {
    pub dev: String,
    pub max_x: i32,
    pub max_y: i32,
    pub btn_touch: bool,
    pub pressure: Option<i32>,
    pub major: Option<i32>,
    /// `input_event` 24 byte (userspace 64-bit) hay 16 byte (32-bit).
    pub wide: bool,
}

fn abs_max(block: &str, name: &str) -> Option<i32> {
    let line = block.lines().find(|l| l.contains(name))?;
    let rest = line[line.find("max")? + 3..].trim_start();
    let digits: String = rest.chars().take_while(|c| c.is_ascii_digit() || *c == '-').collect();
    digits.parse().ok()
}

/// Chọn thiết bị cảm ứng đa điểm trong đầu ra `getevent -pl`; phần sau dấu `@@abi` là `ro.product.cpu.abi`.
pub fn parse_getevent(out: &str) -> Option<PadInfo> {
    let (events, abi) = out.split_once("@@abi").unwrap_or((out, ""));
    let wide = abi.contains("64");
    let mut best: Option<(bool, PadInfo)> = None;
    for block in events.split("add device").skip(1) {
        let dev = block
            .lines()
            .next()?
            .split_once(':')
            .map(|(_, p)| p.trim().to_string())
            .unwrap_or_default();
        let ok_path = dev.strip_prefix("/dev/input/event").is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()));
        if !ok_path || !block.contains("ABS_MT_SLOT") {
            continue; // không phải đa điểm protocol B
        }
        let (Some(max_x), Some(max_y)) = (abs_max(block, "ABS_MT_POSITION_X"), abs_max(block, "ABS_MT_POSITION_Y")) else {
            continue;
        };
        if max_x <= 0 || max_y <= 0 {
            continue;
        }
        let info = PadInfo {
            dev,
            max_x,
            max_y,
            btn_touch: block.contains("BTN_TOUCH"),
            pressure: abs_max(block, "ABS_MT_PRESSURE").filter(|m| *m > 0),
            major: abs_max(block, "ABS_MT_TOUCH_MAJOR").filter(|m| *m > 0),
            wide,
        };
        let direct = block.contains("INPUT_PROP_DIRECT");
        if best.as_ref().map_or(true, |(d, _)| direct && !*d) {
            best = Some((direct, info));
        }
    }
    best.map(|(_, i)| i)
}

const EV_SYN: u16 = 0;
const EV_KEY: u16 = 1;
const EV_ABS: u16 = 3;
const BTN_TOUCH: u16 = 330;
const ABS_MT_SLOT: u16 = 47;
const ABS_MT_TOUCH_MAJOR: u16 = 48;
const ABS_MT_POSITION_X: u16 = 53;
const ABS_MT_POSITION_Y: u16 = 54;
const ABS_MT_TRACKING_ID: u16 = 57;
const ABS_MT_PRESSURE: u16 = 58;

fn ev(buf: &mut Vec<u8>, wide: bool, ty: u16, code: u16, val: i32) {
    buf.extend(std::iter::repeat(0u8).take(if wide { 16 } else { 8 })); // dấu thời gian: kernel tự gán
    buf.extend_from_slice(&ty.to_le_bytes());
    buf.extend_from_slice(&code.to_le_bytes());
    buf.extend_from_slice(&val.to_le_bytes());
}

/// Byte → `\ooo` (printf nào cũng hiểu, không cần `\x`).
fn esc(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("\\{b:03o}")).collect()
}

/// Một lần `printf` PHẢI nhỏ hơn bộ đệm 512 byte của mksh (nếu không bị cắt giữa chừng một sự kiện):
/// tối đa 8 sự kiện × 24 byte = 192 byte.
fn write_cmd(bytes: &[u8]) -> String {
    debug_assert!(bytes.len() <= 400);
    format!("printf '{}' >&3", esc(bytes))
}

fn raw(p: &PadInfo, u: f64, v: f64) -> (i32, i32) {
    let c = |t: f64, max: i32| (t.clamp(0.0, 1.0) * f64::from(max)).round() as i32;
    (c(u, p.max_x), c(v, p.max_y))
}

fn down_bytes(p: &PadInfo, u: f64, v: f64, id: i32) -> Vec<u8> {
    let (x, y) = raw(p, u, v);
    let mut b = Vec::with_capacity(192);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_SLOT, 0);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_TRACKING_ID, id);
    if p.btn_touch {
        ev(&mut b, p.wide, EV_KEY, BTN_TOUCH, 1);
    }
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_X, x);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_Y, y);
    if let Some(m) = p.pressure {
        ev(&mut b, p.wide, EV_ABS, ABS_MT_PRESSURE, (m / 4).max(1));
    }
    if let Some(m) = p.major {
        ev(&mut b, p.wide, EV_ABS, ABS_MT_TOUCH_MAJOR, (m / 16).max(1));
    }
    ev(&mut b, p.wide, EV_SYN, 0, 0);
    b
}

fn move_bytes(p: &PadInfo, u: f64, v: f64) -> Vec<u8> {
    let (x, y) = raw(p, u, v);
    let mut b = Vec::with_capacity(72);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_X, x);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_Y, y);
    ev(&mut b, p.wide, EV_SYN, 0, 0);
    b
}

fn up_bytes(p: &PadInfo, u: f64, v: f64) -> Vec<u8> {
    let (x, y) = raw(p, u, v);
    let mut b = Vec::with_capacity(144);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_X, x);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_POSITION_Y, y);
    ev(&mut b, p.wide, EV_SYN, 0, 0);
    ev(&mut b, p.wide, EV_ABS, ABS_MT_TRACKING_ID, -1);
    if p.btn_touch {
        ev(&mut b, p.wide, EV_KEY, BTN_TOUCH, 0);
    }
    ev(&mut b, p.wide, EV_SYN, 0, 0);
    b
}

// ───────────────────────── Link ─────────────────────────

/// (x, y) chuẩn hoá trên khung hình hiển thị → điểm ảnh theo hướng hiển thị hiện tại + kích thước màn hình đó.
/// `res` là độ phân giải tự nhiên (wm size); máy đang nằm ngang thì đảo W×H.
pub fn display_px(res: Option<(u32, u32)>, rot: u8, x: f64, y: f64) -> Option<(i32, i32, u16, u16)> {
    let (mut w, mut h) = res?;
    if (rot % 2 == 1) != (w > h) {
        std::mem::swap(&mut w, &mut h);
    }
    let (cw, ch) = (u16::try_from(w).ok()?, u16::try_from(h).ok()?);
    let px = |t: f64, max: u32| (t.clamp(0.0, 1.0) * f64::from(max.saturating_sub(1))).round() as i32;
    Some((px(x, w), px(y, h), cw, ch))
}

#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum Phase {
    Down,
    Move,
    Up,
}

impl Phase {
    pub fn parse(s: &str) -> Option<Phase> {
        match s {
            "down" => Some(Phase::Down),
            "move" => Some(Phase::Move),
            "up" => Some(Phase::Up),
            _ => None,
        }
    }
}

enum PadState {
    Probing,
    Ready(PadInfo),
    Unsupported,
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Mode {
    Ctl,
    Evdev,
    Input,
}

struct Gesture {
    mode: Mode,
    start: (f64, f64),
    t0: Instant,
}

struct Sh {
    child: Child,
    stdin: ChildStdin,
}

pub struct Link {
    serial: String,
    orient: Arc<Orient>,
    sh: Mutex<Option<Sh>>,
    pad: Mutex<PadState>,
    ctl: Mutex<Option<Arc<Ctl>>>,
    gesture: Mutex<Option<Gesture>>,
    tid: AtomicU32,
    closed: AtomicBool,
    born: Instant,
    ctl_failed: AtomicBool,
}

impl Link {
    fn new(adb: &Adb, serial: &str) -> Arc<Link> {
        Arc::new(Link {
            serial: serial.to_string(),
            orient: Orient::spawn(adb, serial),
            sh: Mutex::new(None),
            pad: Mutex::new(PadState::Probing),
            ctl: Mutex::new(None),
            gesture: Mutex::new(None),
            tid: AtomicU32::new(1),
            closed: AtomicBool::new(false),
            born: Instant::now(),
            ctl_failed: AtomicBool::new(false),
        })
    }

    /// Còn dùng được không? (đang khởi động, hoặc kênh scrcpy còn sống). Đổi chất lượng video gọi lại `start_stream`
    /// nên không được dựng lại kênh điều khiển mỗi lần; chỉ dựng lại khi nó đã chết hoặc thất bại.
    fn usable(&self) -> bool {
        if self.closed.load(Ordering::SeqCst) {
            return false;
        }
        match &*lock(&self.ctl) {
            Some(c) => c.is_alive(),
            None => !self.ctl_failed.load(Ordering::SeqCst) && self.born.elapsed() < Duration::from_secs(20),
        }
    }

    pub fn orient(&self) -> Arc<Orient> {
        self.orient.clone()
    }

    /// Nền: mở phiên shell, dò màn hình cảm ứng, thử ghi một sự kiện SYN vô hại để biết có được phép không.
    fn start(self: &Arc<Self>, st: Arc<AppState>) {
        // Kênh điều khiển scrcpy-server (mất ~1–2 giây để lên; trong lúc đó dùng đường dự phòng).
        let (me, st2) = (self.clone(), st.clone());
        let _ = thread::Builder::new().name("lumir-ctl-start".into()).spawn(move || {
            match Ctl::start(&st2.adb, &me.serial) {
                Ok(c) => {
                    *lock(&me.ctl) = Some(c);
                    if me.closed.load(Ordering::SeqCst) {
                        if let Some(c) = lock(&me.ctl).take() {
                            c.shutdown(); // cửa sổ đã đóng trong lúc đang khởi động
                        }
                    }
                }
                Err(e) => {
                    me.ctl_failed.store(true, Ordering::SeqCst);
                    eprintln!("[lumir] scrcpy control unavailable, falling back: {e}");
                }
            }
        });

        let me = self.clone();
        let _ = thread::Builder::new().name("lumir-input-probe".into()).spawn(move || {
            let _ = me.exec(&st.adb, ":"); // mở sẵn shell
            let info = st
                .adb
                .shell(&me.serial, "getevent -pl 2>/dev/null; echo @@abi; getprop ro.product.cpu.abi")
                .ok()
                .and_then(|o| parse_getevent(&o));
            let usable = info.filter(|p| {
                let mut b = Vec::new();
                ev(&mut b, p.wide, EV_SYN, 0, 0);
                let cmd = format!("printf '{}' > {} && echo LUMIR_OK", esc(&b), p.dev);
                st.adb.shell(&me.serial, &cmd).is_ok_and(|o| o.contains("LUMIR_OK"))
            });
            if me.closed.load(Ordering::SeqCst) {
                return;
            }
            match usable {
                Some(p) => {
                    // Mở sẵn fd 3 trong phiên shell; `spawn_sh` cũng lặp lại dòng này nếu phiên bị dựng lại.
                    let _ = me.exec(&st.adb, &format!("exec 3>{}", p.dev));
                    *lock(&me.pad) = PadState::Ready(p);
                }
                None => {
                    eprintln!("[lumir] evdev touch not usable on this device (using input fallback)");
                    *lock(&me.pad) = PadState::Unsupported;
                }
            }
        });
    }

    /// Lưu ý: PHẢI là `shell`, không phải `exec-out` — `exec-out` không chuyển tiếp stdin nên `sh` đọc thấy EOF và thoát ngay.
    fn spawn_sh(&self, adb: &Adb) -> Result<Sh, String> {
        let mut child = adb
            .spawn_session(&["-s", &self.serial, "shell", "sh"], false)
            .map_err(|e| e.to_string())?;
        let mut stdin = child.stdin.take().ok_or_else(|| "adb shell: no stdin".to_string())?;
        if let PadState::Ready(p) = &*lock(&self.pad) {
            let _ = writeln!(stdin, "exec 3>{}", p.dev);
        }
        Ok(Sh { child, stdin })
    }

    /// Ghi một dòng lệnh vào phiên shell; phiên chết thì dựng lại một lần rồi thử lại.
    fn exec(&self, adb: &Adb, line: &str) -> Result<(), String> {
        let mut g = lock(&self.sh);
        for attempt in 0..2 {
            if g.is_none() {
                *g = Some(self.spawn_sh(adb)?);
            }
            let sh = g.as_mut().expect("vừa dựng");
            if writeln!(sh.stdin, "{line}").and_then(|_| sh.stdin.flush()).is_ok() {
                return Ok(());
            }
            if let Some(mut dead) = g.take() {
                let _ = dead.child.kill();
                let _ = dead.child.wait();
            }
            if attempt == 1 {
                break;
            }
        }
        Err("adb shell session lost".to_string())
    }

    /// Chạy một lệnh shell ở nền (không chặn phiên): phím điều hướng, `input tap|swipe` dự phòng.
    pub fn exec_bg(&self, adb: &Adb, cmd: &str) -> Result<(), String> {
        self.exec(adb, &format!("{cmd} &"))
    }

    fn pad_ready(&self) -> Option<PadInfo> {
        match &*lock(&self.pad) {
            PadState::Ready(p) => Some(p.clone()),
            _ => None,
        }
    }

    fn ctl_ready(&self) -> Option<Arc<Ctl>> {
        lock(&self.ctl).as_ref().filter(|c| c.is_alive()).cloned()
    }

    /// Có đường thời gian thực (kênh scrcpy hoặc evdev) không?
    fn realtime(&self) -> bool {
        self.ctl_ready().is_some() || self.pad_ready().is_some()
    }

    /// Phím điều hướng: kênh scrcpy nếu có, không thì `input keyevent` qua phiên shell.
    pub fn key(&self, adb: &Adb, code: u32) -> Result<(), String> {
        if let Some(c) = self.ctl_ready() {
            if c.key(code as i32) {
                return Ok(());
            }
        }
        self.exec_bg(adb, &format!("input keyevent {code}"))
    }

    fn rotation(&self, hint_landscape: bool) -> u8 {
        self.orient.get().unwrap_or(if hint_landscape { 1 } else { 0 })
    }

    /// Chạm / kéo / nhả. (x, y) chuẩn hoá 0..1 trên khung hình đang hiển thị.
    /// `res` = độ phân giải tự nhiên (wm size) cho đường dự phòng; `hint_landscape` dùng khi chưa biết hướng xoay.
    pub fn touch(
        &self,
        adb: &Adb,
        phase: Phase,
        x: f64,
        y: f64,
        res: Option<(u32, u32)>,
        hint_landscape: bool,
    ) -> Result<(), String> {
        let (x, y) = (if x.is_finite() { x.clamp(0.0, 1.0) } else { 0.0 }, if y.is_finite() { y.clamp(0.0, 1.0) } else { 0.0 });
        let rot = self.rotation(hint_landscape);
        let (u, v) = to_natural(rot, x, y);
        let point = |x: f64, y: f64| display_px(res, rot, x, y);
        match phase {
            Phase::Down => {
                let (ctl, pad) = (self.ctl_ready(), self.pad_ready());
                let mode = if ctl.is_some() {
                    Mode::Ctl
                } else if pad.is_some() {
                    Mode::Evdev
                } else {
                    Mode::Input
                };
                *lock(&self.gesture) = Some(Gesture { mode, start: (x, y), t0: Instant::now() });
                match (mode, ctl, pad) {
                    (Mode::Ctl, Some(c), _) => {
                        if let Some((px, py, w, h)) = point(x, y) {
                            c.touch(Act::Down, px, py, w, h);
                        }
                        Ok(())
                    }
                    (Mode::Evdev, _, Some(p)) => {
                        let id = (self.tid.fetch_add(1, Ordering::SeqCst) % 60000) as i32 + 1;
                        self.exec(adb, &write_cmd(&down_bytes(&p, u, v, id)))
                    }
                    _ => Ok(()),
                }
            }
            Phase::Move => {
                let Some(mode) = lock(&self.gesture).as_ref().map(|g| g.mode) else { return Ok(()) };
                match mode {
                    Mode::Ctl => {
                        if let (Some(c), Some((px, py, w, h))) = (self.ctl_ready(), point(x, y)) {
                            c.touch(Act::Move, px, py, w, h);
                        }
                        Ok(())
                    }
                    Mode::Evdev => match self.pad_ready() {
                        Some(p) => self.exec(adb, &write_cmd(&move_bytes(&p, u, v))),
                        None => Ok(()),
                    },
                    Mode::Input => Ok(()), // đường dự phòng chỉ cần điểm đầu và điểm cuối
                }
            }
            Phase::Up => {
                let Some(g) = lock(&self.gesture).take() else { return Ok(()) };
                match g.mode {
                    Mode::Ctl => {
                        if let (Some(c), Some((px, py, w, h))) = (self.ctl_ready(), point(x, y)) {
                            c.touch(Act::Up, px, py, w, h);
                        }
                        Ok(())
                    }
                    Mode::Evdev if self.pad_ready().is_some() => {
                        let p = self.pad_ready().expect("vừa kiểm tra");
                        self.exec(adb, &write_cmd(&up_bytes(&p, u, v)))
                    }
                    _ => {
                        let ms = g.t0.elapsed().as_millis().clamp(1, SWIPE_MAX_MS);
                        self.input_gesture(adb, g.start, (x, y), ms, res, rot)
                    }
                }
            }
        }
    }

    /// Đường dự phòng: `input tap` / `input swipe` (nhấn giữ = vuốt tại chỗ).
    fn input_gesture(
        &self,
        adb: &Adb,
        from: (f64, f64),
        to: (f64, f64),
        ms: u128,
        res: Option<(u32, u32)>,
        rot: u8,
    ) -> Result<(), String> {
        let (mut w, mut h) = res.ok_or_else(|| "Unknown screen size".to_string())?;
        if (rot % 2 == 1) != (w > h) {
            std::mem::swap(&mut w, &mut h);
        }
        let px = |t: f64, max: u32| (t.clamp(0.0, 1.0) * f64::from(max.saturating_sub(1))).round() as u32;
        let (x1, y1, x2, y2) = (px(from.0, w), px(from.1, h), px(to.0, w), px(to.1, h));
        let cmd = if (x1, y1) == (x2, y2) && ms < TAP_MAX_MS {
            format!("input tap {x1} {y1}")
        } else {
            format!("input swipe {x1} {y1} {x2} {y2} {}", ms.max(1))
        };
        self.exec_bg(adb, &cmd)
    }

    /// Cuộn chuột: vuốt từ (x, y) một đoạn `dy` (chuẩn hoá, âm = ngón tay đi lên). Thời gian thực khi có evdev.
    pub fn scroll(
        &self,
        adb: &Adb,
        x: f64,
        y: f64,
        dy: f64,
        res: Option<(u32, u32)>,
        hint_landscape: bool,
    ) -> Result<(), String> {
        let y2 = (y + dy).clamp(0.03, 0.97);
        if self.realtime() {
            const STEPS: u32 = 10;
            self.touch(adb, Phase::Down, x, y, res, hint_landscape)?;
            for i in 1..=STEPS {
                let t = f64::from(i) / f64::from(STEPS);
                let eased = 1.0 - (1.0 - t) * (1.0 - t); // nhanh lúc đầu, chậm dần như ngón tay thật
                thread::sleep(Duration::from_millis(9));
                self.touch(adb, Phase::Move, x, y + (y2 - y) * eased, res, hint_landscape)?;
            }
            self.touch(adb, Phase::Up, x, y2, res, hint_landscape)
        } else {
            let rot = self.rotation(hint_landscape);
            self.input_gesture(adb, (x, y), (x, y2), 220, res, rot)
        }
    }

    fn shutdown(&self) {
        self.closed.store(true, Ordering::SeqCst);
        self.orient.stop();
        if let Some(c) = lock(&self.ctl).take() {
            c.shutdown();
        }
        if let Some(mut s) = lock(&self.sh).take() {
            drop(s.stdin);
            let _ = s.child.kill();
            let _ = s.child.wait();
        }
    }
}

// ───────────────────────── Registry ─────────────────────────

#[derive(Default)]
pub struct Inputs {
    map: Mutex<HashMap<String, Arc<Link>>>,
}

impl Inputs {
    /// Lấy `Link` đang dùng được của thiết bị, không thì tạo mới (thay cái cũ: adb có thể đã bị rút/cắm lại).
    pub fn start(&self, st: &Arc<AppState>, serial: &str) -> Arc<Link> {
        if let Some(l) = self.get(serial).filter(|l| l.usable()) {
            return l;
        }
        let link = Link::new(&st.adb, serial);
        let old = lock(&self.map).insert(serial.to_string(), link.clone());
        if let Some(o) = old {
            o.shutdown();
        }
        link.start(st.clone());
        link
    }

    pub fn get(&self, serial: &str) -> Option<Arc<Link>> {
        lock(&self.map).get(serial).cloned()
    }

    pub fn stop(&self, serial: &str) {
        if let Some(l) = lock(&self.map).remove(serial) {
            l.shutdown();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const GETEVENT: &str = r#"add device 1: /dev/input/event5
  name:     "gpio-keys"
  events:
    KEY (0001): KEY_VOLUMEUP
add device 2: /dev/input/event3
  name:     "fts_ts"
  events:
    KEY (0001): BTN_TOUCH
    ABS (0003): ABS_MT_SLOT           : value 0, min 0, max 9, fuzz 0, flat 0, resolution 0
                ABS_MT_TOUCH_MAJOR    : value 0, min 0, max 255, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_X     : value 0, min 0, max 1079, fuzz 0, flat 0, resolution 0
                ABS_MT_POSITION_Y     : value 0, min 0, max 2399, fuzz 0, flat 0, resolution 0
                ABS_MT_TRACKING_ID    : value 0, min 0, max 65535, fuzz 0, flat 0, resolution 0
                ABS_MT_PRESSURE       : value 0, min 0, max 63, fuzz 0, flat 0, resolution 0
  input props:
    INPUT_PROP_DIRECT
@@abi
arm64-v8a
"#;

    #[test]
    fn orientation_formats() {
        assert_eq!(parse_orientation("  SurfaceOrientation: 1"), Some(1));
        assert_eq!(parse_orientation("Viewport INTERNAL: displayId=0, port=129, orientation=3, logicalFrame=[0]"), Some(3));
        assert_eq!(parse_orientation("      mCurrentRotation=ROTATION_90"), Some(1));
        assert_eq!(parse_orientation("mCurrentRotation=ROTATION_270 mFoo=1"), Some(3));
        assert_eq!(parse_orientation("mRotation=2"), Some(2));
        assert_eq!(parse_orientation("orientation=ORIENTATION_180"), Some(2));
        assert_eq!(parse_orientation(""), None);
        assert_eq!(parse_orientation("SurfaceOrientation: 9"), None);
    }

    #[test]
    fn natural_mapping() {
        assert_eq!(to_natural(0, 0.2, 0.7), (0.2, 0.7));
        // Xoay trái: góc trên-trái của khung ngang = góc trên-phải của máy ở hướng tự nhiên.
        assert_eq!(to_natural(1, 0.0, 0.0), (1.0, 0.0));
        assert_eq!(to_natural(2, 0.0, 0.0), (1.0, 1.0));
        assert_eq!(to_natural(3, 0.0, 0.0), (0.0, 1.0));
        // Quay đủ 4 lần thì về đúng chỗ cũ.
        for r in 0..4 {
            let (u, v) = to_natural(r, 0.3, 0.6);
            assert!((0.0..=1.0).contains(&u) && (0.0..=1.0).contains(&v));
        }
    }

    #[test]
    fn display_pixels() {
        assert_eq!(display_px(Some((1080, 2400)), 0, 0.0, 1.0), Some((0, 2399, 1080, 2400)));
        // Máy nằm ngang: màn hình là 2400×1080.
        assert_eq!(display_px(Some((1080, 2400)), 1, 1.0, 0.5), Some((2399, 540, 2400, 1080)));
        assert_eq!(display_px(None, 0, 0.5, 0.5), None);
    }

    #[test]
    fn picks_touchscreen() {
        let p = parse_getevent(GETEVENT).expect("có màn hình cảm ứng");
        assert_eq!(p.dev, "/dev/input/event3");
        assert_eq!((p.max_x, p.max_y), (1079, 2399));
        assert!(p.btn_touch && p.wide);
        assert_eq!((p.pressure, p.major), (Some(63), Some(255)));
        assert!(parse_getevent("add device 1: /dev/input/event5\n  KEY (0001): KEY_BACK\n").is_none());
        assert!(!parse_getevent(&GETEVENT.replace("arm64-v8a", "armeabi-v7a")).unwrap().wide);
    }

    #[test]
    fn event_bytes_layout() {
        let p = parse_getevent(GETEVENT).unwrap();
        let d = down_bytes(&p, 0.5, 0.5, 7);
        assert_eq!(d.len() % 24, 0);
        assert!(d.len() <= 400, "một printf phải nhỏ hơn bộ đệm 512 byte của mksh");
        assert!(up_bytes(&p, 0.5, 0.5).len() <= 400);
        // Sự kiện đầu: ABS_MT_SLOT = 0 (type 3, code 47).
        assert_eq!(&d[16..20], &[3, 0, 47, 0]);
        let narrow = PadInfo { wide: false, ..p };
        assert_eq!(move_bytes(&narrow, 0.0, 0.0).len(), 3 * 16);
        assert_eq!(esc(&[0, 255, 8]), "\\000\\377\\010");
    }
}