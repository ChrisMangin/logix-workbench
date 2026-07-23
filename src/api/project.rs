use axum::{
    extract::{Multipart, Form, State},
    response::{IntoResponse, Response},
    Json,
};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
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

#[derive(Deserialize)]
pub struct PathForm { pub path: String }

pub async fn api_open_path(State(st): State<Arc<AppState>>, Form(f): Form<PathForm>) -> Response {
    let path = f.path.trim().to_string();
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

#[derive(Deserialize)]
pub struct TitleForm { pub title: Option<String> }

pub async fn api_pick_file(Form(f): Form<TitleForm>) -> Response {
    let title = f.title.as_deref().unwrap_or("Open L5X File");
    let path = rfd::AsyncFileDialog::new()
        .add_filter("L5X Files", &["l5x", "L5X"])
        .set_title(title)
        .pick_file()
        .await
        .map(|h| h.path().to_string_lossy().to_string())
        .unwrap_or_default();
    Json(json!({"path": path})).into_response()
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
