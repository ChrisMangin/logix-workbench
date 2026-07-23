use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

#[derive(Deserialize)]
pub struct NameQuery { pub name: String }

pub async fn detail(State(st): State<Arc<AppState>>, Query(q): Query<NameQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::get_datatype_detail(r, &q.name)) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let members: Vec<serde_json::Value> = body["members"].as_array().cloned().unwrap_or_default();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_data_type(root, body["name"].as_str().unwrap_or(""), body["description"].as_str().unwrap_or(""), &members)?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn update(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let members: Vec<serde_json::Value> = body["members"].as_array().cloned().unwrap_or_default();
    let name = body["name"].as_str().unwrap_or("").to_string();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::update_data_type(root, &name, body["description"].as_str().unwrap_or(""), &members)?;
        l5x::read::get_datatype_detail(root, &name)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
