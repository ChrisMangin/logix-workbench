use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

#[derive(Deserialize)]
pub struct NameQuery { pub name: String }

pub async fn detail(State(st): State<Arc<AppState>>, Query(q): Query<NameQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::get_aoi_detail(r, &q.name)) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let params: Vec<serde_json::Value> = body["parameters"].as_array().cloned().unwrap_or_default();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_aoi(root, body["name"].as_str().unwrap_or(""), body["description"].as_str().unwrap_or(""), &params)?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn update(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let params: Vec<serde_json::Value> = body["parameters"].as_array().cloned().unwrap_or_default();
    let name = body["name"].as_str().unwrap_or("").to_string();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::update_aoi(root, &name, body["description"].as_str().unwrap_or(""), &params)?;
        l5x::read::get_aoi_detail(root, &name)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let force = body["force"].as_bool().unwrap_or(false);
    let name  = body["name"].as_str().unwrap_or("").to_string();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        let usages = l5x::write::delete_aoi(root, &name, force)?;
        if !usages.is_empty() {
            return Err(anyhow::anyhow!("AOI '{}' is still used in {} rung(s): {}", name, usages.len(), usages[..8.min(usages.len())].join("; ")));
        }
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn rung_add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let aoi = body["aoi"].as_str().unwrap_or("").to_string();
    let rtn = body["routine"].as_str().unwrap_or("Logic").to_string();
    let idx = body["index"].as_u64().map(|n| n as usize);
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_aoi_rung(root, &aoi, &rtn, body["text"].as_str().unwrap_or("NOP();"), body["comment"].as_str().unwrap_or(""), idx)?;
        l5x::read::get_aoi_detail(root, &aoi)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn rung_edit(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let aoi = body["aoi"].as_str().unwrap_or("").to_string();
    let rtn = body["routine"].as_str().unwrap_or("Logic").to_string();
    let num = body["number"].as_u64().unwrap_or(0) as usize;
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::edit_aoi_rung(root, &aoi, &rtn, num, body["text"].as_str().unwrap_or(""), body["comment"].as_str().unwrap_or(""))?;
        l5x::read::get_aoi_detail(root, &aoi)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn rung_delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let aoi = body["aoi"].as_str().unwrap_or("").to_string();
    let rtn = body["routine"].as_str().unwrap_or("Logic").to_string();
    let num = body["number"].as_u64().unwrap_or(0) as usize;
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_aoi_rung(root, &aoi, &rtn, num)?;
        l5x::read::get_aoi_detail(root, &aoi)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
