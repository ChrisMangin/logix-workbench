#![cfg_attr(target_os = "windows", windows_subsystem = "windows")]
//! Logix Workbench — Rust backend.
//! axum HTTP server, auto-exit via heartbeat, duplicate-instance detection.

mod state;
mod l5x;
mod api;

use std::net::TcpListener;
use std::sync::Arc;
use std::time::Duration;
use axum::{Router, routing::{get, post}};
use tower_http::cors::{Any, CorsLayer};
use state::AppState;

const PREFERRED_PORT: u16 = 5000;

fn find_free_port() -> Option<u16> {
    for port in PREFERRED_PORT..6000 {
        if TcpListener::bind(("127.0.0.1", port)).is_ok() { return Some(port); }
    }
    None
}

fn is_port_in_use(port: u16) -> bool {
    TcpListener::bind(("127.0.0.1", port)).is_err()
}

#[tokio::main]
async fn main() {
    // duplicate instance: open browser to existing instance and exit
    if is_port_in_use(PREFERRED_PORT) {
        let _ = open::that(format!("http://127.0.0.1:{PREFERRED_PORT}"));
        return;
    }

    let port = match find_free_port() {
        Some(p) => p,
        None => { eprintln!("No free port"); return; }
    };

    let state = AppState::new();

    // heartbeat watchdog — exits if no heartbeat for 30s after first one
    {
        let s = Arc::clone(&state);
        tokio::spawn(async move {
            loop {
                tokio::time::sleep(Duration::from_secs(10)).await;
                let last = *s.last_heartbeat.lock().unwrap();
                if let Some(t) = last {
                    if t.elapsed() > Duration::from_secs(30) {
                        std::process::exit(0);
                    }
                }
            }
        });
    }

    let cors = CorsLayer::new()
        .allow_origin(Any)
        .allow_methods(Any)
        .allow_headers(Any);

    let app = Router::new()
        // ── heartbeat / tab ──────────────────────────────────────────────
        .route("/api/heartbeat",        post(api::misc::heartbeat))
        .route("/api/tab/connect",      post(api::misc::tab_connect))
        .route("/api/tab/disconnect",   post(api::misc::tab_disconnect))
        .route("/api/ping",             get(api::misc::ping))
        // ── project ──────────────────────────────────────────────────────
        .route("/api/new",              post(api::project::api_new))
        .route("/api/open",             post(api::project::api_open))
        .route("/api/open_path",        post(api::project::api_open_path))
        .route("/api/pick_file",        post(api::project::api_pick_file))
        .route("/api/summary",          get(api::project::api_summary))
        .route("/api/download",         get(api::project::api_download))
        .route("/api/validate",         post(api::project::api_validate))
        .route("/api/search",           get(api::misc::api_search))
        .route("/api/recent",           get(api::misc::api_recent))
        .route("/api/save_recent",      post(api::misc::api_save_recent))
        // ── tags ─────────────────────────────────────────────────────────
        .route("/api/tags",             get(api::tags::list))
        .route("/api/tags/detail",      get(api::tags::detail))
        .route("/api/tags/add",         post(api::tags::add))
        .route("/api/tags/edit",        post(api::tags::edit))
        .route("/api/tags/delete",      post(api::tags::delete))
        // ── programs ─────────────────────────────────────────────────────
        .route("/api/programs/add",     post(api::programs::add))
        .route("/api/programs/delete",  post(api::programs::delete))
        // ── routines ─────────────────────────────────────────────────────
        .route("/api/routines/detail",  get(api::routines::detail))
        .route("/api/routines/add",     post(api::routines::add))
        .route("/api/routines/delete",  post(api::routines::delete))
        .route("/api/routines/edit-st", post(api::routines::edit_st))
        // ── rungs ────────────────────────────────────────────────────────
        .route("/api/rungs/add",        post(api::rungs::add))
        .route("/api/rungs/edit",       post(api::rungs::edit))
        .route("/api/rungs/delete",     post(api::rungs::delete))
        .route("/api/rungs/move",       post(api::rungs::move_rung))
        // ── data types ───────────────────────────────────────────────────
        .route("/api/datatypes/detail", get(api::datatypes::detail))
        .route("/api/datatypes/add",    post(api::datatypes::add))
        .route("/api/datatypes/update", post(api::datatypes::update))
        // ── AOIs ─────────────────────────────────────────────────────────
        .route("/api/aoi/detail",       get(api::aois::detail))
        .route("/api/aoi/add",          post(api::aois::add))
        .route("/api/aoi/update",       post(api::aois::update))
        .route("/api/aoi/delete",       post(api::aois::delete))
        .route("/api/aoi/rungs/add",    post(api::aois::rung_add))
        .route("/api/aoi/rungs/edit",   post(api::aois::rung_edit))
        .route("/api/aoi/rungs/delete", post(api::aois::rung_delete))
        // ── modules ──────────────────────────────────────────────────────
        .route("/api/modules/add",      post(api::modules::add))
        .route("/api/modules/edit",     post(api::modules::edit))
        .route("/api/modules/delete",   post(api::modules::delete))
        // ── tasks ────────────────────────────────────────────────────────
        .route("/api/tasks/add",        post(api::tasks::add))
        .route("/api/tasks/delete",     post(api::tasks::delete))
        // ── trends ───────────────────────────────────────────────────────
        .route("/api/trends/detail",           get(api::trends::detail))
        .route("/api/trends/update-meta",      post(api::trends::update_meta))
        .route("/api/trends/set-pens",         post(api::trends::set_pens))
        .route("/api/trends/delete",           post(api::trends::delete))
        .route("/api/trends/duplicate",        post(api::trends::duplicate))
        // ── compare ──────────────────────────────────────────────────────
        .route("/api/compare",                           post(api::compare::compare_upload))
        .route("/api/compare_paths",                     post(api::compare::compare_paths))
        .route("/api/compare/migrate_and_compare",       post(api::compare::migrate_and_compare))
        .route("/api/compare/migrate_and_compare_cached",post(api::compare::migrate_cached))
        // ── static frontend ──────────────────────────────────────────────
        .fallback(api::static_files::handler)
        .with_state(Arc::clone(&state))
        .layer(cors);

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await.unwrap();
    
    // open browser
    let url = format!("http://{addr}");
    tokio::spawn(async move {
        tokio::time::sleep(Duration::from_millis(200)).await;
        let _ = open::that(&url);
    });

    axum::serve(listener, app).await.unwrap();
}
