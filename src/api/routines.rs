use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use serde_json::json;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

#[derive(Deserialize)]
pub struct RoutineQuery { pub program: String, pub name: String, pub rung_offset: Option<usize>, pub rung_limit: Option<usize> }

pub async fn detail(State(st): State<Arc<AppState>>, Query(q): Query<RoutineQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::get_routine_detail(r, &q.program, &q.name, q.rung_offset.unwrap_or(0), q.rung_limit.unwrap_or(200))) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_routine(root, body["program"].as_str().unwrap_or(""), body["name"].as_str().unwrap_or(""), body["type"].as_str().unwrap_or("RLL"))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_routine(root, body["program"].as_str().unwrap_or(""), body["name"].as_str().unwrap_or(""))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn edit_st(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::edit_st_routine(root, body["program"].as_str().unwrap_or(""), body["name"].as_str().unwrap_or(""), body["content"].as_str().unwrap_or(""))?;
        Ok(json!({"ok": true}))
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
