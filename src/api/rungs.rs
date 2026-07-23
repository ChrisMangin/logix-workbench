use axum::{extract::State, response::{IntoResponse, Response}, Json};
use serde_json::json;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().unwrap_or("").to_string();
    let rtn  = body["routine"].as_str().unwrap_or("").to_string();
    let idx  = body["index"].as_u64().map(|n| n as usize);
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_rung(root, &prog, &rtn, body["text"].as_str().unwrap_or("NOP();"), body["comment"].as_str().unwrap_or(""), idx)?;
        l5x::read::get_routine_detail(root, &prog, &rtn, 0, 200)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn edit(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().unwrap_or("").to_string();
    let rtn  = body["routine"].as_str().unwrap_or("").to_string();
    let num  = body["number"].as_u64().unwrap_or(0) as usize;
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::edit_rung(root, &prog, &rtn, num, body["text"].as_str().unwrap_or(""), body["comment"].as_str().unwrap_or(""))?;
        l5x::read::get_routine_detail(root, &prog, &rtn, 0, 200)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().unwrap_or("").to_string();
    let rtn  = body["routine"].as_str().unwrap_or("").to_string();
    let num  = body["number"].as_u64().unwrap_or(0) as usize;
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_rung(root, &prog, &rtn, num)?;
        l5x::read::get_routine_detail(root, &prog, &rtn, 0, 200)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn move_rung(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().unwrap_or("").to_string();
    let rtn  = body["routine"].as_str().unwrap_or("").to_string();
    let from = body["frm"].as_u64().unwrap_or(0) as usize;
    let to   = body["to"].as_u64().unwrap_or(0) as usize;
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::move_rung(root, &prog, &rtn, from, to)?;
        Ok(json!({"ok":true}))
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
