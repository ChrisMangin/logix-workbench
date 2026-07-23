pub mod misc;
pub mod project;
pub mod tags;
pub mod programs;
pub mod routines;
pub mod rungs;
pub mod datatypes;
pub mod aois;
pub mod modules;
pub mod tasks;
pub mod trends;
pub mod compare;
pub mod static_files;

use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use std::sync::Arc;
use crate::state::AppState;

/// Convenience re-export so handlers can write `Cx` instead of the full type.
pub type Cx = axum::extract::State<Arc<AppState>>;

/// Convert anyhow::Error to 400 JSON response.
pub fn err400(e: anyhow::Error) -> Response {
    (StatusCode::BAD_REQUEST, Json(json!({"detail": e.to_string()}))).into_response()
}
