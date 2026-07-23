use axum::{extract::State, response::{IntoResponse, Response}, Json};
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_module(root, body["name"].as_str().unwrap_or(""), body["catalogNumber"].as_str().unwrap_or(""),
            body["vendor"].as_str().unwrap_or("1"), body["parentModule"].as_str().unwrap_or("Local"),
            body["inhibited"].as_str().unwrap_or("false"))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn edit(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::edit_module(root, body["oldName"].as_str().unwrap_or(""), body["name"].as_str().unwrap_or(""),
            body["catalogNumber"].as_str().unwrap_or(""), body["vendor"].as_str().unwrap_or("1"),
            body["parentModule"].as_str().unwrap_or("Local"), body["inhibited"].as_str().unwrap_or("false"))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_module(root, body["name"].as_str().unwrap_or(""))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
