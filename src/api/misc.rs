use axum::{extract::{Query, State}, response::IntoResponse, Json};
use serde::Deserialize;
use serde_json::json;
use std::time::Instant;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

pub async fn heartbeat(State(st): State<Arc<AppState>>) -> impl IntoResponse {
    *st.last_heartbeat.lock().unwrap() = Some(Instant::now());
    Json(json!({"ok": true}))
}

pub async fn tab_connect(State(st): State<Arc<AppState>>) -> impl IntoResponse {
    let mut tc = st.tab_count.lock().unwrap();
    *tc += 1;
    *st.last_heartbeat.lock().unwrap() = Some(Instant::now());
    Json(json!({"tabs": *tc}))
}

pub async fn tab_disconnect(State(st): State<Arc<AppState>>) -> impl IntoResponse {
    let tabs = { let mut tc = st.tab_count.lock().unwrap(); *tc = (*tc - 1).max(0); *tc };
    if tabs == 0 {
        tokio::spawn(async { tokio::time::sleep(std::time::Duration::from_secs(5)).await; std::process::exit(0); });
    }
    Json(json!({"tabs": tabs}))
}

pub async fn ping() -> impl IntoResponse { Json(json!({"ok": true})) }

#[derive(Deserialize)]
pub struct SearchQuery { pub q: String, pub limit: Option<usize> }

pub async fn api_search(State(st): State<Arc<AppState>>, Query(q): Query<SearchQuery>) -> impl IntoResponse {
    let doc = st.doc.read().unwrap();
    match doc.require().map(|root| l5x::read::search_xref(root, &q.q, q.limit.unwrap_or(200))) {
        Ok(v) => Json(v).into_response(),
        Err(e) => err400(e),
    }
}

pub async fn api_recent() -> impl IntoResponse {
    let path = recent_path();
    let data = std::fs::read_to_string(&path).unwrap_or_else(|_| "[]".into());
    let v: serde_json::Value = serde_json::from_str(&data).unwrap_or(serde_json::json!([]));
    Json(v)
}

#[derive(serde::Deserialize)]
pub struct RecentBody { pub files: serde_json::Value }

pub async fn api_save_recent(Json(body): Json<RecentBody>) -> impl IntoResponse {
    let path = recent_path();
    let _ = std::fs::write(path, serde_json::to_string_pretty(&body.files).unwrap_or_default());
    Json(json!({"ok": true}))
}

fn recent_path() -> std::path::PathBuf {
    let mut p = std::env::var("APPDATA").map(std::path::PathBuf::from).unwrap_or_else(|_| std::path::PathBuf::from("."));
    p.push("logix-workbench");
    let _ = std::fs::create_dir_all(&p);
    p.push("recent.json");
    p
}
