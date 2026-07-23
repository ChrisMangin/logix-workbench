use axum::{extract::State, response::{IntoResponse, Response}, Json};
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_task(root, body["name"].as_str().unwrap_or(""), body["taskType"].as_str().unwrap_or("PERIODIC"),
            body["rate"].as_f64().unwrap_or(10.0), body["priority"].as_i64().unwrap_or(10) as i32,
            body["watchdog"].as_f64().unwrap_or(500.0))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_task(root, body["name"].as_str().unwrap_or(""))?;
        l5x::read::summarize(root)
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
