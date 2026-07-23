use std::sync::{Arc, Mutex, RwLock};
use std::time::Instant;
use xmltree::Element;

// ─── document state ──────────────────────────────────────────────────────────

#[derive(Default)]
pub struct DocState {
    pub root: Option<Element>,
    pub name: String,
}

impl DocState {
    pub fn set(&mut self, root: Element, name: &str) {
        self.root = Some(root);
        self.name = name.to_string();
    }
    pub fn clear(&mut self) {
        self.root = None;
        self.name = String::new();
    }
    pub fn get(&self) -> Option<&Element> {
        self.root.as_ref()
    }
    pub fn get_mut(&mut self) -> Option<&mut Element> {
        self.root.as_mut()
    }
    pub fn require(&self) -> anyhow::Result<&Element> {
        self.root.as_ref().ok_or_else(|| anyhow::anyhow!("No project open — open an .L5X file first"))
    }
    pub fn require_mut(&mut self) -> anyhow::Result<&mut Element> {
        self.root.as_mut().ok_or_else(|| anyhow::anyhow!("No project open — open an .L5X file first"))
    }
}

// ─── compare cache ───────────────────────────────────────────────────────────

#[derive(Default)]
pub struct CmpState {
    pub bytes_a: Option<Vec<u8>>,
    pub bytes_b: Option<Vec<u8>>,
    pub path_a:  Option<String>,
    pub path_b:  Option<String>,
}

impl CmpState {
    pub fn set_paths(&mut self, ba: Vec<u8>, bb: Vec<u8>, pa: Option<String>, pb: Option<String>) {
        self.bytes_a = Some(ba);
        self.bytes_b = Some(bb);
        self.path_a  = pa;
        self.path_b  = pb;
    }
}

// ─── global app state ────────────────────────────────────────────────────────

pub struct AppState {
    pub doc:            RwLock<DocState>,
    pub cmp:            Mutex<CmpState>,
    pub last_heartbeat: Mutex<Option<Instant>>,
    pub tab_count:      Mutex<i32>,
}

impl AppState {
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            doc:            RwLock::new(DocState::default()),
            cmp:            Mutex::new(CmpState::default()),
            last_heartbeat: Mutex::new(None),
            tab_count:      Mutex::new(0),
        })
    }
}
