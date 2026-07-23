use axum::{
    body::Body,
    http::{Request, StatusCode, header},
    response::{IntoResponse, Response},
};
use rust_embed::RustEmbed;

#[derive(RustEmbed)]
#[folder = "frontend/"]
struct Frontend;

pub async fn handler(req: Request<Body>) -> Response {
    let path = req.uri().path().trim_start_matches('/');
    let path = if path.is_empty() { "index.html" } else { path };

    // Try exact match first
    if let Some(content) = Frontend::get(path) {
        let mime = mime_for(path);
        return (
            [(header::CONTENT_TYPE, mime)],
            content.data.as_ref().to_vec()
        ).into_response();
    }

    // SPA fallback → index.html
    if let Some(index) = Frontend::get("index.html") {
        return (
            [(header::CONTENT_TYPE, "text/html; charset=utf-8")],
            index.data.as_ref().to_vec()
        ).into_response();
    }

    StatusCode::NOT_FOUND.into_response()
}

fn mime_for(path: &str) -> &'static str {
    if      path.ends_with(".html") { "text/html; charset=utf-8" }
    else if path.ends_with(".js")   { "application/javascript; charset=utf-8" }
    else if path.ends_with(".css")  { "text/css; charset=utf-8" }
    else if path.ends_with(".png")  { "image/png" }
    else if path.ends_with(".ico")  { "image/x-icon" }
    else if path.ends_with(".svg")  { "image/svg+xml" }
    else if path.ends_with(".json") { "application/json" }
    else                            { "application/octet-stream" }
}
