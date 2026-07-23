use axum::{extract::{Query, State}, response::{IntoResponse, Response}, Json};
use serde::Deserialize;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};

#[derive(Deserialize)]
pub struct TagsQuery { pub program: Option<String>, pub search: Option<String>, pub offset: Option<usize>, pub limit: Option<usize> }

pub async fn list(State(st): State<Arc<AppState>>, Query(q): Query<TagsQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require() {
        Ok(root) => Json(l5x::read::list_tags(root, q.program.as_deref(), q.search.as_deref().unwrap_or(""), q.offset.unwrap_or(0), q.limit.unwrap_or(100))).into_response(),
        Err(e) => err400(e),
    }
}

#[derive(Deserialize)]
pub struct TagDetailQuery { pub name: String, pub program: Option<String> }

pub async fn detail(State(st): State<Arc<AppState>>, Query(q): Query<TagDetailQuery>) -> Response {
    let doc = st.doc.read().unwrap();
    match doc.require().and_then(|r| l5x::read::get_tag_detail(r, q.program.as_deref(), &q.name)) {
        Ok(v) => Json(v).into_response(), Err(e) => err400(e),
    }
}

pub async fn add(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
    let arr: Vec<String> = body["arrayValues"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::add_tag(root, body["name"].as_str().unwrap_or(""), body["dataType"].as_str().unwrap_or(""),
            body["value"].as_str().unwrap_or(""), body["description"].as_str().unwrap_or(""),
            prog.as_deref(), body["radix"].as_str().unwrap_or(""), body["externalAccess"].as_str().unwrap_or(""),
            body["constant"].as_bool().unwrap_or(false), body["dimensions"].as_u64().unwrap_or(0) as usize, &arr)?;
        Ok(l5x::read::list_tags(root, prog.as_deref(), "", 0, 100))
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn edit(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
    let arr: Vec<String> = body["arrayValues"].as_array().map(|a| a.iter().filter_map(|v| v.as_str().map(|s| s.to_string())).collect()).unwrap_or_default();
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::edit_tag(root, body["oldName"].as_str().unwrap_or(""), body["name"].as_str().unwrap_or(""),
            body["dataType"].as_str().unwrap_or(""), body["value"].as_str().unwrap_or(""),
            body["description"].as_str().unwrap_or(""), prog.as_deref(), body["radix"].as_str().unwrap_or(""),
            body["externalAccess"].as_str().unwrap_or(""), body["constant"].as_bool().unwrap_or(false),
            body["dimensions"].as_u64().unwrap_or(0) as usize, &arr)?;
        Ok(l5x::read::list_tags(root, prog.as_deref(), "", 0, 100))
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

pub async fn delete(State(st): State<Arc<AppState>>, Json(body): Json<serde_json::Value>) -> Response {
    let prog = body["program"].as_str().filter(|s| !s.is_empty()).map(|s| s.to_string());
    let result = (|| -> anyhow::Result<_> {
        let mut doc = st.doc.write().unwrap();
        let root = doc.require_mut()?;
        l5x::write::delete_tag(root, body["name"].as_str().unwrap_or(""), prog.as_deref())?;
        Ok(l5x::read::list_tags(root, prog.as_deref(), "", 0, 100))
    })();
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}
