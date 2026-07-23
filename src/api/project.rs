use axum::{
    extract::{Multipart, State},
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;
use std::collections::HashMap;
use super::err400;
use crate::{state::AppState, l5x};

pub async fn api_new(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let name      = body["controllerName"].as_str().unwrap_or("Controller");
    let proc_type = body["processorType"].as_str().unwrap_or("1756-L83E");
    let major     = body["majorRev"].as_str().unwrap_or("32");
    let minor     = body["minorRev"].as_str().unwrap_or("11");
    let result = (|| -> anyhow::Result<_> {
        let root = l5x::write::new_project(name, proc_type, major, minor)?;
        let summary = l5x::read::summarize(&root)?;
        st.doc.write().unwrap().set(root, name);
        Ok(summary)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn api_open(State(st): State<Arc<AppState>>, mut mp: Multipart) -> Response {
    while let Ok(Some(field)) = mp.next_field().await {
        if field.name().unwrap_or("") == "file" || field.file_name().is_some() {
            let fname = field.file_name().unwrap_or("project").to_string();
            let data = match field.bytes().await { Ok(b) => b, Err(e) => return err400(anyhow::anyhow!("{e}")) };
            let base = std::path::Path::new(&fname).file_stem().and_then(|s| s.to_str()).unwrap_or("project").to_string();
            return load_bytes(State(st), &data, &base).await;
        }
    }
    err400(anyhow::anyhow!("No file field"))
}

/// Frontend sends FormData (multipart) — use Multipart extractor, not Form<T>.
pub async fn api_open_path(State(st): State<Arc<AppState>>, mp: Multipart) -> Response {
    let fields = parse_mp(mp).await;
    let path = fields.get("path").map(|s| s.trim().to_string()).unwrap_or_default();
    if path.is_empty() { return err400(anyhow::anyhow!("path required")); }
    if !std::path::Path::new(&path).is_file() { return err400(anyhow::anyhow!("File not found: {path}")); }
    let data = match std::fs::read(&path) { Ok(d) => d, Err(e) => return err400(anyhow::anyhow!("{e}")) };
    let base = std::path::Path::new(&path).file_stem().and_then(|s| s.to_str()).unwrap_or("project").to_string();
    load_bytes(State(st), &data, &base).await
}

async fn load_bytes(State(st): State<Arc<AppState>>, data: &[u8], name: &str) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let root = l5x::parse(data)?;
        let summary = l5x::read::summarize(&root)?;
        st.doc.write().unwrap().set(root, name);
        Ok(summary)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

/// Show a native Windows file-open dialog using IFileOpenDialog (COM).
///
/// Previous approach (PowerShell subprocess) caused visible console window flashes even with
/// -WindowStyle Hidden, because Windows briefly shows the process before applying the style.
///
/// This implementation calls IFileOpenDialog directly via the `windows` crate:
///   - No subprocess spawned → no window flash
///   - COM initialized as STA on the spawn_blocking thread
///   - Show() internally runs its own message loop, so no pump setup needed
///   - Appears in front via FOS_FORCEFILESYSTEM | IFileDialog::SetOptions
pub async fn api_pick_file(mp: Multipart) -> Response {
    let fields = parse_mp(mp).await;
    let title = fields.get("title")
        .filter(|s| !s.is_empty())
        .cloned()
        .unwrap_or_else(|| "Open L5X File".to_string());

    let path = tokio::task::spawn_blocking(move || pick_file_native(&title))
        .await
        .unwrap_or_default();
    Json(json!({"path": path})).into_response()
}

/// Drain a multipart body into a name→value map (text fields only).
pub async fn parse_mp(mut mp: Multipart) -> HashMap<String, String> {
    let mut map = HashMap::new();
    while let Ok(Some(field)) = mp.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if let Ok(text) = field.text().await { map.insert(name, text); }
    }
    map
}

/// Show a native IFileOpenDialog via Windows COM.
/// Runs on a dedicated blocking thread; no subprocess, no window flash.
fn pick_file_native(title: &str) -> String {
    #[cfg(target_os = "windows")]
    {
        use windows::{
            Win32::{
                System::Com::{
                    CoCreateInstance, CoInitializeEx, CoUninitialize, CoTaskMemFree,
                    CLSCTX_INPROC_SERVER, COINIT_APARTMENTTHREADED, COINIT_DISABLE_OLE1DDE,
                },
                UI::Shell::{
                    Common::COMDLG_FILTERSPEC,
                    FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH,
                },
            },
            core::PCWSTR,
        };

        unsafe {
            // Initialize COM as STA on this thread (required for IFileOpenDialog)
            let hr = CoInitializeEx(None, COINIT_APARTMENTTHREADED | COINIT_DISABLE_OLE1DDE);
            // S_OK (0) = we initialized; S_FALSE (1) = already initialized; both are success
            let we_initialized = hr.0 == 0;

            let result = pick_file_com(title);

            if we_initialized { CoUninitialize(); }

            result
        }
    }

    #[cfg(not(target_os = "windows"))]
    { String::new() }
}

#[cfg(target_os = "windows")]
unsafe fn pick_file_com(title: &str) -> String {
    use windows::{
        Win32::{
            System::Com::{CoCreateInstance, CoTaskMemFree, CLSCTX_INPROC_SERVER},
            UI::Shell::{
                Common::COMDLG_FILTERSPEC,
                FileOpenDialog, IFileOpenDialog, SIGDN_FILESYSPATH,
            },
        },
        core::PCWSTR,
    };

    // Create the file open dialog COM object
    let dialog: IFileOpenDialog = match CoCreateInstance(&FileOpenDialog, None, CLSCTX_INPROC_SERVER) {
        Ok(d) => d,
        Err(_) => return String::new(),
    };

    // Set dialog title
    let title_w: Vec<u16> = title.encode_utf16().chain(std::iter::once(0)).collect();
    let _ = dialog.SetTitle(PCWSTR::from_raw(title_w.as_ptr()));

    // Set file type filter — keep wide strings alive until after SetFileTypes returns
    let name_w: Vec<u16> = "L5X Files (*.l5x)\0".encode_utf16().collect();
    let spec_w: Vec<u16> = "*.l5x;*.L5X\0".encode_utf16().collect();
    let filters = [COMDLG_FILTERSPEC {
        pszName: PCWSTR::from_raw(name_w.as_ptr()),
        pszSpec: PCWSTR::from_raw(spec_w.as_ptr()),
    }];
    let _ = dialog.SetFileTypes(&filters);
    let _ = dialog.SetFileTypeIndex(1);

    // Show the dialog — blocks until the user picks a file or cancels.
    // IFileOpenDialog::Show() runs its own Win32 message loop internally, so no pump needed.
    // Returns Err if the user cancelled (HRESULT ERROR_CANCELLED).
    if dialog.Show(None).is_err() {
        return String::new();
    }

    // Retrieve selected item
    let item = match dialog.GetResult() {
        Ok(i) => i,
        Err(_) => return String::new(),
    };

    // Get filesystem path from the selected item
    let pwstr = match item.GetDisplayName(SIGDN_FILESYSPATH) {
        Ok(p) => p,
        Err(_) => return String::new(),
    };

    // Convert PWSTR (null-terminated UTF-16) to Rust String, then free COM-allocated memory
    let ptr = pwstr.0;
    let len = (0..).take_while(|&i| *ptr.add(i) != 0).count();
    let path = String::from_utf16_lossy(std::slice::from_raw_parts(ptr, len));
    CoTaskMemFree(Some(ptr as *const _));

    path.to_string()
}

pub async fn api_summary(State(st): State<Arc<AppState>>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::summarize(r)) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn api_download(State(st): State<Arc<AppState>>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require() {
        Ok(root) => {
            let xml  = l5x::to_xml_string(root);
            let name = format!("{}.L5X", doc.name);
            (axum::http::StatusCode::OK,
             [(axum::http::header::CONTENT_TYPE, "application/xml".to_string()),
              (axum::http::header::CONTENT_DISPOSITION, format!("attachment; filename=\"{name}\""))],
             xml.into_bytes()).into_response()
        }
        Err(e) => err400(e),
    }
}

pub async fn api_validate(State(st): State<Arc<AppState>>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require() {
        Ok(root) => Json(l5x::read::validate(root)).into_response(),
        Err(e) => err400(e),
    }
}
