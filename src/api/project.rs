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

/// The browser sends FormData (multipart), NOT application/x-www-form-urlencoded,
/// so we use Multipart instead of Form<T> here (and everywhere the frontend uses FormData).
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

/// Show a native Windows file-open dialog.
///
/// Root cause of the original "does nothing" bug: axum's Form<T> extractor only handles
/// application/x-www-form-urlencoded; the browser's fetch(FormData) sends multipart/form-data,
/// which axum rejects with 415. The JS got back no `path` field → silent no-op.
///
/// Second bug: rfd::AsyncFileDialog fails on windows_subsystem="windows" processes because
/// there's no Win32 message loop on any thread to dispatch messages to IFileOpenDialog.
///
/// Fix: parse with Multipart, then spawn a hidden PowerShell process that uses
/// System.Windows.Forms.OpenFileDialog — creates its own message loop, always works.
pub async fn api_pick_file(mp: Multipart) -> Response {
    let fields = parse_mp(mp).await;
    let title = fields.get("title")
        .filter(|s| !s.is_empty())
        .map(|s| s.clone())
        .unwrap_or_else(|| "Open L5X File".to_string());

    let path = tokio::task::spawn_blocking(move || pick_file_ps(&title))
        .await
        .unwrap_or_default();
    Json(json!({"path": path})).into_response()
}

/// Drain a multipart body into a String→String map.
/// Used wherever the frontend sends FormData (multipart) but we only need text fields.
pub async fn parse_mp(mut mp: Multipart) -> HashMap<String, String> {
    let mut map = HashMap::new();
    while let Ok(Some(field)) = mp.next_field().await {
        let name = field.name().unwrap_or("").to_string();
        if let Ok(text) = field.text().await {
            map.insert(name, text);
        }
    }
    map
}

/// Spawn a hidden PowerShell process that shows a Windows OpenFileDialog.
/// Returns the selected path, or empty string if cancelled.
fn pick_file_ps(title: &str) -> String {
    // Escape single-quotes for the PowerShell string literal
    let safe_title = title.replace('\'', "''");

    // Use a hidden TopMost form as parent so the dialog appears above the browser window
    let script = format!(
        "Add-Type -AssemblyName System.Windows.Forms; \
         [System.Windows.Forms.Application]::EnableVisualStyles(); \
         $f = New-Object System.Windows.Forms.Form; \
         $f.TopMost = $true; \
         $f.WindowState = [System.Windows.Forms.FormWindowState]::Minimized; \
         $f.Show(); \
         $d = New-Object System.Windows.Forms.OpenFileDialog; \
         $d.Title = '{safe_title}'; \
         $d.Filter = 'L5X Files (*.l5x;*.L5X)|*.l5x;*.L5X|All Files (*.*)|*.*'; \
         $d.Multiselect = $false; \
         $r = $d.ShowDialog($f); \
         $f.Dispose(); \
         if ($r -eq [System.Windows.Forms.DialogResult]::OK) {{ Write-Output $d.FileName }}"
    );

    std::process::Command::new("powershell.exe")
        .args([
            "-NoProfile",
            "-WindowStyle", "Hidden",
            "-Command", &script,
        ])
        .output()
        .ok()
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .unwrap_or_default()
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
