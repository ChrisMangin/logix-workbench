use axum::{extract::{State, Multipart}, response::{IntoResponse, Response}, Json};
use base64::Engine;
use serde_json::json;
use std::sync::Arc;
use super::err400;
use crate::{state::AppState, l5x};
use crate::api::project::parse_mp;

// ─── compare two uploaded files ──────────────────────────────────────────────

pub async fn compare_upload(State(st): State<Arc<AppState>>, mut mp: Multipart) -> Response {
    let mut bytes_a: Option<Vec<u8>> = None;
    let mut bytes_b: Option<Vec<u8>> = None;
    let mut inc_cmt = false;
    let mut inc_vals = false;
    while let Ok(Some(field)) = mp.next_field().await {
        match field.name().unwrap_or("") {
            "fileA"            => { bytes_a = field.bytes().await.ok().map(|b| b.to_vec()); }
            "fileB"            => { bytes_b = field.bytes().await.ok().map(|b| b.to_vec()); }
            "include_comments" => { let v = field.text().await.unwrap_or_default(); inc_cmt  = v.to_lowercase() == "true"; }
            "include_values"   => { let v = field.text().await.unwrap_or_default(); inc_vals = v.to_lowercase() == "true"; }
            _ => {}
        }
    }
    let (ba, bb) = match (bytes_a, bytes_b) { (Some(a), Some(b)) => (a, b), _ => return err400(anyhow::anyhow!("fileA and fileB required")) };
    let result = l5x::diff::compare_l5x(&ba, &bb, inc_cmt, inc_vals);
    { let mut cmp = st.cmp.lock().unwrap(); cmp.set_paths(ba, bb, None, None); }
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

// ─── compare by filesystem path ──────────────────────────────────────────────
// Frontend sends FormData (multipart) — must use Multipart extractor, not Form<T>.

pub async fn compare_paths(State(st): State<Arc<AppState>>, mp: Multipart) -> Response {
    let fields = parse_mp(mp).await;
    let pa = fields.get("pathA").map(|s| s.trim().to_string()).unwrap_or_default();
    let pb = fields.get("pathB").map(|s| s.trim().to_string()).unwrap_or_default();
    let inc_cmt  = fields.get("include_comments").map(|s| s.to_lowercase() == "true").unwrap_or(false);
    let inc_vals = fields.get("include_values").map(|s| s.to_lowercase() == "true").unwrap_or(false);

    if pa.is_empty() || pb.is_empty() { return err400(anyhow::anyhow!("pathA and pathB required")); }
    if !std::path::Path::new(&pa).is_file() { return err400(anyhow::anyhow!("File not found: {pa}")); }
    if !std::path::Path::new(&pb).is_file() { return err400(anyhow::anyhow!("File not found: {pb}")); }

    let ba = match std::fs::read(&pa) { Ok(b) => b, Err(e) => return err400(anyhow::anyhow!("{e}")) };
    let bb = match std::fs::read(&pb) { Ok(b) => b, Err(e) => return err400(anyhow::anyhow!("{e}")) };
    let result = l5x::diff::compare_l5x(&ba, &bb, inc_cmt, inc_vals);
    { let mut cmp = st.cmp.lock().unwrap(); cmp.set_paths(ba, bb, Some(pa), Some(pb)); }
    match result { Ok(v) => Json(v).into_response(), Err(e) => err400(e) }
}

// ─── migrate + compare (file upload) ─────────────────────────────────────────

pub async fn migrate_and_compare(State(st): State<Arc<AppState>>, mut mp: Multipart) -> Response {
    let mut bytes_a: Option<Vec<u8>> = None;
    let mut bytes_b: Option<Vec<u8>> = None;
    let mut direction = String::new(); let mut change_type = String::new();
    let mut name = String::new(); let mut program = String::new();
    let mut inc_cmt = false; let mut inc_vals = false;
    while let Ok(Some(field)) = mp.next_field().await {
        match field.name().unwrap_or("") {
            "fileA"            => { bytes_a    = field.bytes().await.ok().map(|b| b.to_vec()); }
            "fileB"            => { bytes_b    = field.bytes().await.ok().map(|b| b.to_vec()); }
            "direction"        => { direction   = field.text().await.unwrap_or_default(); }
            "change_type"      => { change_type = field.text().await.unwrap_or_default(); }
            "name"             => { name        = field.text().await.unwrap_or_default(); }
            "program"          => { program     = field.text().await.unwrap_or_default(); }
            "include_comments" => { let v = field.text().await.unwrap_or_default(); inc_cmt  = v.to_lowercase() == "true"; }
            "include_values"   => { let v = field.text().await.unwrap_or_default(); inc_vals = v.to_lowercase() == "true"; }
            _ => {}
        }
    }
    let (ba, bb) = match (bytes_a, bytes_b) { (Some(a), Some(b)) => (a, b), _ => return err400(anyhow::anyhow!("fileA and fileB required")) };
    do_migrate(ba, bb, &direction, &change_type, &name, &program, inc_cmt, inc_vals, None, None, Arc::clone(&st)).await
}

// ─── migrate + compare (cached paths) ────────────────────────────────────────
// Frontend sends FormData (multipart) — must use Multipart extractor, not Form<T>.

pub async fn migrate_cached(State(st): State<Arc<AppState>>, mp: Multipart) -> Response {
    let fields = parse_mp(mp).await;
    let direction   = fields.get("direction").cloned().unwrap_or_default();
    let change_type = fields.get("change_type").cloned().unwrap_or_default();
    let name        = fields.get("name").cloned().unwrap_or_default();
    let program     = fields.get("program").cloned().unwrap_or_default();
    let inc_cmt     = fields.get("include_comments").map(|s| s.to_lowercase() == "true").unwrap_or(false);
    let inc_vals    = fields.get("include_values").map(|s| s.to_lowercase() == "true").unwrap_or(false);

    let (ba, bb, path_a, path_b) = {
        let cmp = st.cmp.lock().unwrap();
        match (&cmp.bytes_a, &cmp.bytes_b) {
            (Some(a), Some(b)) => (a.clone(), b.clone(), cmp.path_a.clone(), cmp.path_b.clone()),
            _ => return err400(anyhow::anyhow!("No cached comparison — run a path-based compare first")),
        }
    };
    do_migrate(ba, bb, &direction, &change_type, &name, &program, inc_cmt, inc_vals, path_a, path_b, Arc::clone(&st)).await
}

async fn do_migrate(ba: Vec<u8>, bb: Vec<u8>, direction: &str, change_type: &str, name: &str, program: &str,
                    inc_cmt: bool, inc_vals: bool, path_a: Option<String>, path_b: Option<String>,
                    st: Arc<AppState>) -> Response {
    let prog = if program.is_empty() { None } else { Some(program) };
    let direction   = direction.to_string();
    let change_type = change_type.to_string();
    let name        = name.to_string();
    let result: anyhow::Result<Response> = (|| {
        let mut root_a = l5x::parse(&ba)?;
        let mut root_b = l5x::parse(&bb)?;
        let (modified_bytes, modified_side, comparison) = if direction == "AtoB" {
            l5x::diff::migrate_change(&root_a.clone(), &mut root_b, &change_type, &name, prog)?;
            let mb = l5x::to_xml_string(&root_b).into_bytes();
            let cmp = l5x::diff::compare_l5x(&ba, &mb, inc_cmt, inc_vals)?;
            (mb, "B", cmp)
        } else {
            l5x::diff::migrate_change(&root_b.clone(), &mut root_a, &change_type, &name, prog)?;
            let mb = l5x::to_xml_string(&root_a).into_bytes();
            let cmp = l5x::diff::compare_l5x(&mb, &bb, inc_cmt, inc_vals)?;
            (mb, "A", cmp)
        };
        if modified_side == "B" { if let Some(ref p) = path_b { let _ = std::fs::write(p, &modified_bytes); } }
        else                    { if let Some(ref p) = path_a { let _ = std::fs::write(p, &modified_bytes); } }
        {
            let mut cmp_cache = st.cmp.lock().unwrap();
            if modified_side == "B" { cmp_cache.bytes_b = Some(modified_bytes.clone()); }
            else                    { cmp_cache.bytes_a = Some(modified_bytes.clone()); }
        }
        let encoded = base64::engine::general_purpose::STANDARD.encode(&modified_bytes);
        Ok(Json(json!({"modified_bytes":encoded,"modified_side":modified_side,"comparison":comparison})).into_response())
    })();
    match result { Ok(r) => r, Err(e) => err400(e) }
}
