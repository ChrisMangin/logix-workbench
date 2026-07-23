use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

#[derive(Deserialize)]
pub struct NameQuery { pub name: String }

pub async fn detail(State(st): State<Arc<AppState>>, Query(q): Query<NameQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::get_trend_detail(r, &q.name)) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn update_meta(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let name = body["name"].as_str().unwrap_or("").to_string();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::update_trend_meta(root, &name, body["samplePeriod"].as_str().unwrap_or(""), body["captureSize"].as_str().unwrap_or(""))?;
        l5x::read::get_trend_detail(root, &name)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn set_pens(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let name = body["name"].as_str().unwrap_or("").to_string();
    let pens: Vec<serde_json::Value> = body["pens"].as_array().cloned().unwrap_or_default();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::set_trend_pens(root, &name, &pens)?;
        l5x::read::get_trend_detail(root, &name)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_trend(root, body["name"].as_str().unwrap_or(""))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn duplicate(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::duplicate_trend(root, body["srcName"].as_str().unwrap_or(""), body["newName"].as_str().unwrap_or(""))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
