//! Game Key Mapping: lưu trữ JSON riêng (`keymap.json`) và nhận diện game đang chạy.
//!
//! Tách hoàn toàn khỏi Chat Keyboard (`input_text` / `input_key`): module này chỉ làm hai việc —
//!
//! * giữ file cấu hình bền vững: ghi nguyên tử (file tạm → bản sao `.bak` → đổi tên), đọc lại có phục hồi
//!   nếu file chính hỏng. Nội dung JSON do frontend sở hữu (nhiều profile, toạ độ chuẩn hoá 0–1); Rust chỉ
//!   kiểm tra "phong bì" (schema, version, danh sách profile) và giới hạn kích thước để không ghi rác;
//! * đọc gói ứng dụng đang ở foreground (`dumpsys window`) để gắn profile với từng game.
//!
//! Phần thuần (kiểm tra, ghi file, phục hồi, tên file, phân tích dumpsys) có test; các command Tauri bên dưới
//! được test qua mock runtime.

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};

use serde_json::Value;
use tauri::{AppHandle, Emitter, Runtime, State, WebviewWindow};

pub const FILE: &str = "keymap.json";
const BACKUP: &str = "keymap.json.bak";
const TMP: &str = "keymap.json.tmp";
/// Cấu hình thật chỉ vài chục KB; trần 4 MB chặn dữ liệu rác/độc hại.
const MAX_BYTES: usize = 4 * 1024 * 1024;
const MAX_PROFILES: usize = 200;
pub const SCHEMA: &str = "lumir.keymap";

fn lock<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

// ───────────────────────── Kiểm tra ─────────────────────────

fn parse_object(json: &str) -> Result<serde_json::Map<String, Value>, String> {
    if json.len() > MAX_BYTES {
        return Err("Key mapping file is too large".to_string());
    }
    match serde_json::from_str::<Value>(json) {
        Ok(Value::Object(o)) => Ok(o),
        Ok(_) => Err("Key mapping JSON must be an object".to_string()),
        Err(e) => Err(format!("Invalid key mapping JSON: {e}")),
    }
}

/// Kiểm tra phong bì của file cấu hình đầy đủ (frontend chuẩn hoá phần chi tiết).
pub fn validate_store(json: &str) -> Result<(), String> {
    let o = parse_object(json)?;
    if o.get("schema").and_then(Value::as_str) != Some(SCHEMA) {
        return Err("Not a LUMIR key mapping file".to_string());
    }
    if !o.get("version").and_then(Value::as_u64).is_some_and(|v| v >= 1) {
        return Err("Key mapping file has no version".to_string());
    }
    let profiles = o
        .get("profiles")
        .and_then(Value::as_array)
        .ok_or_else(|| "Key mapping file has no profiles".to_string())?;
    if profiles.len() > MAX_PROFILES {
        return Err("Too many profiles".to_string());
    }
    if !profiles.iter().all(|p| p.get("id").and_then(Value::as_str).is_some_and(|s| !s.is_empty())) {
        return Err("A profile has no id".to_string());
    }
    Ok(())
}

// ───────────────────────── File trên đĩa ─────────────────────────

/// Ghi nguyên tử: viết file tạm + fsync, giữ bản trước làm `.bak`, rồi đổi tên đè file chính.
/// Mất điện/crash giữa chừng thì hoặc còn bản cũ, hoặc đã có bản mới — không bao giờ nửa vời.
pub fn write_atomic(dir: &Path, json: &str) -> Result<(), String> {
    fs::create_dir_all(dir).map_err(|e| format!("Cannot create data folder: {e}"))?;
    let (main, bak, tmp) = (dir.join(FILE), dir.join(BACKUP), dir.join(TMP));
    {
        let mut f = fs::File::create(&tmp).map_err(|e| format!("Cannot write key mapping: {e}"))?;
        f.write_all(json.as_bytes()).map_err(|e| format!("Cannot write key mapping: {e}"))?;
        f.sync_all().map_err(|e| format!("Cannot write key mapping: {e}"))?;
    }
    if main.exists() {
        let _ = fs::copy(&main, &bak); // bản sao thất bại thì vẫn lưu tiếp, chỉ mất lưới an toàn
    }
    fs::rename(&tmp, &main).map_err(|e| {
        let _ = fs::remove_file(&tmp);
        format!("Cannot save key mapping: {e}")
    })
}

fn read_valid(path: &Path) -> Option<String> {
    let text = fs::read_to_string(path).ok()?;
    validate_store(&text).ok().map(|_| text)
}

fn unix_secs() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Đọc cấu hình; chưa có file → chuỗi rỗng (frontend tạo mặc định).
/// File chính hỏng → đổi tên thành `keymap.corrupt-<giờ>.json` (không xoá dữ liệu của người dùng) rồi khôi phục từ `.bak`.
pub fn read_with_recovery(dir: &Path) -> Result<String, String> {
    let (main, bak) = (dir.join(FILE), dir.join(BACKUP));
    if main.exists() {
        if let Some(t) = read_valid(&main) {
            return Ok(t);
        }
        let _ = fs::rename(&main, dir.join(format!("keymap.corrupt-{}.json", unix_secs())));
    }
    if let Some(t) = read_valid(&bak) {
        let _ = write_atomic(dir, &t); // dựng lại file chính từ bản sao
        return Ok(t);
    }
    Ok(String::new())
}

// ───────────────────────── Xuất file ─────────────────────────

/// Tên file an toàn trên Windows: bỏ ký tự cấm/điều khiển, không để tên thiết bị (CON, NUL...), tối đa 64 ký tự.
pub fn sanitize_file_name(name: &str) -> String {
    let mut s: String = name
        .chars()
        .map(|c| if c.is_alphanumeric() || matches!(c, '-' | '_' | '.' | ' ' | '(' | ')') { c } else { '_' })
        .collect();
    s = s.trim_matches(|c: char| c == '.' || c == ' ' || c == '_').to_string();
    s = s.chars().take(64).collect::<String>().trim_end_matches(['.', ' ']).to_string();
    let stem = s.split('.').next().unwrap_or("").to_ascii_uppercase();
    let reserved = matches!(stem.as_str(), "CON" | "PRN" | "AUX" | "NUL")
        || ((stem.starts_with("COM") || stem.starts_with("LPT")) && stem.len() == 4 && stem.as_bytes()[3].is_ascii_digit());
    if s.is_empty() {
        "keymap".to_string()
    } else if reserved {
        format!("_{s}")
    } else {
        s
    }
}

/// `<dir>/<stem>.json`, nếu đã có thì `<stem> (2).json`, `(3)`... — không bao giờ ghi đè file cũ.
pub fn unique_json_path(dir: &Path, stem: &str) -> PathBuf {
    let first = dir.join(format!("{stem}.json"));
    if !first.exists() {
        return first;
    }
    (2..10_000)
        .map(|n| dir.join(format!("{stem} ({n}).json")))
        .find(|p| !p.exists())
        .unwrap_or(first)
}

// ───────────────────────── Game đang chạy ─────────────────────────

fn is_package(s: &str) -> bool {
    let mut parts = s.split('.');
    let ok_seg = |p: &str| !p.is_empty() && p.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    let first = parts.next().unwrap_or("");
    first.chars().next().is_some_and(|c| c.is_ascii_alphabetic()) && ok_seg(first) && {
        let rest: Vec<&str> = parts.collect();
        !rest.is_empty() && rest.iter().all(|p| ok_seg(p))
    }
}

/// Lấy gói ứng dụng từ đầu ra `dumpsys window` (dòng `mCurrentFocus` ưu tiên hơn `mFocusedApp`).
/// `Window{1a2b u0 com.game/com.game.Main}` → `com.game`; `Window{.. StatusBar}` hay `null` → bỏ qua.
pub fn parse_foreground(out: &str) -> Option<String> {
    for key in ["mCurrentFocus", "mFocusedApp"] {
        for line in out.lines().filter(|l| l.contains(key)) {
            for tok in line.split(|c: char| c.is_whitespace() || c == '{' || c == '}') {
                if let Some((pkg, _)) = tok.split_once('/') {
                    if is_package(pkg) {
                        return Some(pkg.to_string());
                    }
                }
            }
        }
    }
    None
}

// ───────────────────────── Trạng thái + command Tauri ─────────────────────────

pub struct KeymapStore {
    dir: PathBuf,
    export_dir: PathBuf,
    guard: Mutex<()>, // một lần ghi/đọc tại một thời điểm (nhiều cửa sổ điện thoại dùng chung một file)
}

impl KeymapStore {
    pub fn new(dir: PathBuf, export_dir: PathBuf) -> Self {
        KeymapStore { dir, export_dir, guard: Mutex::new(()) }
    }
}

type Store<'a> = State<'a, Arc<KeymapStore>>;

async fn blocking<T, F>(f: F) -> Result<T, String>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, String> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(f).await.map_err(|e| e.to_string())?
}

/// Đọc `keymap.json` (rỗng nếu chưa có). Có phục hồi từ `.bak` khi file chính hỏng.
#[tauri::command]
pub async fn keymap_load(store: Store<'_>) -> Result<String, String> {
    let s = store.inner().clone();
    blocking(move || {
        let _g = lock(&s.guard);
        read_with_recovery(&s.dir)
    })
    .await
}

/// Ghi `keymap.json`. Phát event `keymap-changed` (kèm nhãn cửa sổ đã ghi) để cửa sổ điện thoại khác nạp lại.
#[tauri::command]
pub async fn keymap_save<R: Runtime>(app: AppHandle<R>, window: WebviewWindow<R>, store: Store<'_>, json: String) -> Result<(), String> {
    let s = store.inner().clone();
    blocking(move || {
        validate_store(&json)?;
        let _g = lock(&s.guard);
        write_atomic(&s.dir, &json)
    })
    .await?;
    let _ = app.emit("keymap-changed", window.label().to_string());
    Ok(())
}

/// Xuất một cấu hình (JSON bất kỳ do frontend dựng) ra thư mục Tải xuống; trả đường dẫn file đã ghi.
#[tauri::command]
pub async fn keymap_export(store: Store<'_>, name: String, json: String) -> Result<String, String> {
    let s = store.inner().clone();
    blocking(move || {
        parse_object(&json)?;
        let _g = lock(&s.guard);
        fs::create_dir_all(&s.export_dir).map_err(|e| format!("Cannot create export folder: {e}"))?;
        let path = unique_json_path(&s.export_dir, &sanitize_file_name(&name));
        fs::write(&path, json.as_bytes()).map_err(|e| format!("Cannot export key mapping: {e}"))?;
        Ok(path.to_string_lossy().into_owned())
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    fn tmp(tag: &str) -> PathBuf {
        let d = std::env::temp_dir().join(format!("lumir-keymap-{tag}-{}-{}", std::process::id(), unix_secs()));
        let _ = fs::remove_dir_all(&d);
        fs::create_dir_all(&d).unwrap();
        d
    }

    const OK: &str = r#"{"schema":"lumir.keymap","version":1,"activeProfileId":"p1","profiles":[{"id":"p1","name":"A","controls":[]}]}"#;

    #[test]
    fn validates_envelope() {
        assert!(validate_store(OK).is_ok());
        assert!(validate_store("not json").unwrap_err().starts_with("Invalid key mapping JSON"));
        assert!(validate_store("[]").is_err());
        assert!(validate_store(r#"{"schema":"other","version":1,"profiles":[]}"#).is_err());
        assert!(validate_store(r#"{"schema":"lumir.keymap","profiles":[]}"#).is_err()); // thiếu version
        assert!(validate_store(r#"{"schema":"lumir.keymap","version":1}"#).is_err()); // thiếu profiles
        assert!(validate_store(r#"{"schema":"lumir.keymap","version":1,"profiles":[{"name":"x"}]}"#).is_err()); // thiếu id
        assert!(validate_store(&format!("{{\"schema\":\"lumir.keymap\",\"version\":1,\"profiles\":[],\"x\":\"{}\"}}", "a".repeat(MAX_BYTES))).is_err());
    }

    #[test]
    fn write_then_read_roundtrip_and_backup() {
        let d = tmp("rw");
        assert_eq!(read_with_recovery(&d).unwrap(), ""); // chưa có file
        write_atomic(&d, OK).unwrap();
        assert_eq!(read_with_recovery(&d).unwrap(), OK);
        assert!(!d.join(TMP).exists(), "file tạm phải được dọn");
        assert!(!d.join(BACKUP).exists(), "lần ghi đầu chưa có bản trước để sao");
        let v2 = OK.replace("\"A\"", "\"B\"");
        write_atomic(&d, &v2).unwrap();
        assert_eq!(read_with_recovery(&d).unwrap(), v2);
        assert_eq!(fs::read_to_string(d.join(BACKUP)).unwrap(), OK, ".bak giữ bản trước");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn corrupt_main_is_quarantined_and_restored_from_backup() {
        let d = tmp("corrupt");
        write_atomic(&d, OK).unwrap();
        write_atomic(&d, &OK.replace("\"A\"", "\"B\"")).unwrap(); // .bak = OK
        fs::write(d.join(FILE), "{ cắt ngang giữa chừng").unwrap();
        assert_eq!(read_with_recovery(&d).unwrap(), OK);
        assert_eq!(fs::read_to_string(d.join(FILE)).unwrap(), OK, "file chính được dựng lại");
        let corrupt: Vec<_> = fs::read_dir(&d)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| e.file_name().to_string_lossy().starts_with("keymap.corrupt-"))
            .collect();
        assert_eq!(corrupt.len(), 1, "file hỏng được giữ lại, không bị xoá");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn corrupt_without_backup_starts_fresh() {
        let d = tmp("nobak");
        fs::write(d.join(FILE), "garbage").unwrap();
        assert_eq!(read_with_recovery(&d).unwrap(), "");
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn file_names_are_safe() {
        assert_eq!(sanitize_file_name("PUBG Mobile"), "PUBG Mobile");
        assert_eq!(sanitize_file_name("a/b\\c:d*e?f\"g<h>i|j"), "a_b_c_d_e_f_g_h_i_j");
        assert_eq!(sanitize_file_name("Liên Quân"), "Liên Quân");
        assert_eq!(sanitize_file_name("  ..  "), "keymap");
        assert_eq!(sanitize_file_name(""), "keymap");
        assert_eq!(sanitize_file_name("CON"), "_CON");
        assert_eq!(sanitize_file_name("com1.json"), "_com1.json");
        assert_eq!(sanitize_file_name(&"x".repeat(200)).chars().count(), 64);
        assert!(!sanitize_file_name("../../etc/passwd").contains('/'));
    }

    #[test]
    fn export_never_overwrites() {
        let d = tmp("exp");
        let a = unique_json_path(&d, "p");
        assert_eq!(a, d.join("p.json"));
        fs::write(&a, "1").unwrap();
        let b = unique_json_path(&d, "p");
        assert_eq!(b, d.join("p (2).json"));
        fs::write(&b, "2").unwrap();
        assert_eq!(unique_json_path(&d, "p"), d.join("p (3).json"));
        let _ = fs::remove_dir_all(&d);
    }

    #[test]
    fn foreground_package_formats() {
        // Android 9–13: mCurrentFocus / mFocusedApp
        assert_eq!(
            parse_foreground("  mCurrentFocus=Window{4f2a1b u0 com.tencent.ig/com.epicgames.ue4.SplashActivity}\n  mFocusedApp=ActivityRecord{1 u0 com.x.y/.A t5}").as_deref(),
            Some("com.tencent.ig")
        );
        assert_eq!(
            parse_foreground("mCurrentFocus=Window{9f c0 u0 com.android.launcher3/com.android.launcher3.Launcher}").as_deref(),
            Some("com.android.launcher3")
        );
        // mCurrentFocus rỗng → dùng mFocusedApp
        assert_eq!(
            parse_foreground("  mCurrentFocus=null\n  mFocusedApp=ActivityRecord{1a2b u0 com.garena.game.kgvn/com.garena.game.kgvn.Main t77}").as_deref(),
            Some("com.garena.game.kgvn")
        );
        // cửa sổ hệ thống không có gói
        assert_eq!(parse_foreground("mCurrentFocus=Window{1234 u0 StatusBar}"), None);
        assert_eq!(parse_foreground("mCurrentFocus=null"), None);
        assert_eq!(parse_foreground(""), None);
        // đường dẫn trông giống nhưng không phải gói
        assert_eq!(parse_foreground("mCurrentFocus=Window{1 u0 /data/x/y}"), None);
    }

    #[test]
    fn package_names() {
        assert!(is_package("com.tencent.ig"));
        assert!(is_package("a.b"));
        assert!(!is_package("singleword"));
        assert!(!is_package("1com.x"));
        assert!(!is_package("com..x"));
        assert!(!is_package("com.x-y"));
    }

    // ── Command Tauri qua mock runtime: kiểm cả đường IPC + tuần tự hoá, không chỉ hàm thuần ──
    use tauri::test::{mock_builder, mock_context, noop_assets};
    use tauri::webview::InvokeRequest;
    use tauri::{ipc::InvokeBody, WebviewWindowBuilder};

    fn app(dir: &Path, exp: &Path) -> tauri::App<tauri::test::MockRuntime> {
        mock_builder()
            .manage(Arc::new(KeymapStore::new(dir.to_path_buf(), exp.to_path_buf())))
            .invoke_handler(tauri::generate_handler![keymap_load, keymap_save, keymap_export])
            .build(mock_context(noop_assets()))
            .expect("mock app")
    }

    fn invoke(w: &tauri::WebviewWindow<tauri::test::MockRuntime>, cmd: &str, body: Value) -> Result<Value, Value> {
        let req = InvokeRequest {
            cmd: cmd.into(),
            callback: tauri::ipc::CallbackFn(0),
            error: tauri::ipc::CallbackFn(1),
            url: if cfg!(any(windows, target_os = "android")) { "http://tauri.localhost" } else { "tauri://localhost" }.parse().unwrap(),
            body: InvokeBody::Json(body),
            headers: Default::default(),
            invoke_key: tauri::test::INVOKE_KEY.to_string(),
        };
        tauri::test::get_ipc_response(w, req).map(|b| b.deserialize::<Value>().unwrap())
    }

    #[test]
    fn commands_roundtrip_through_ipc() {
        let (dir, exp) = (tmp("ipc"), tmp("ipc-exp"));
        let app = app(&dir, &exp);
        let w = WebviewWindowBuilder::new(&app, "phone-test", Default::default()).build().unwrap();

        // chưa có file → rỗng
        assert_eq!(invoke(&w, "keymap_load", serde_json::json!({})).unwrap(), Value::String(String::new()));
        // JSON hỏng bị từ chối, file không bị tạo
        let err = invoke(&w, "keymap_save", serde_json::json!({ "json": "oops" })).unwrap_err();
        assert!(err.as_str().unwrap().starts_with("Invalid key mapping JSON"));
        assert!(!dir.join(FILE).exists());
        // lưu → nạp lại đúng từng byte (kể cả Unicode)
        let doc = OK.replace("\"A\"", "\"Liên Quân ⚔\"");
        invoke(&w, "keymap_save", serde_json::json!({ "json": doc })).unwrap();
        assert_eq!(invoke(&w, "keymap_load", serde_json::json!({})).unwrap(), Value::String(doc.clone()));
        assert_eq!(fs::read_to_string(dir.join(FILE)).unwrap(), doc);
        // xuất file: tên được làm sạch, không ghi đè
        let p1 = invoke(&w, "keymap_export", serde_json::json!({ "name": "a/b", "json": "{\"x\":1}" })).unwrap();
        let p2 = invoke(&w, "keymap_export", serde_json::json!({ "name": "a/b", "json": "{\"x\":2}" })).unwrap();
        assert_ne!(p1, p2);
        assert!(p1.as_str().unwrap().ends_with("a_b.json"));
        assert_eq!(fs::read_to_string(p1.as_str().unwrap()).unwrap(), "{\"x\":1}");
        assert!(invoke(&w, "keymap_export", serde_json::json!({ "name": "x", "json": "nope" })).is_err());
        let _ = fs::remove_dir_all(&dir);
        let _ = fs::remove_dir_all(&exp);
    }
}
