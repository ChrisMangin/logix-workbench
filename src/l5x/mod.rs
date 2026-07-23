//! L5X XML engine — parse, read, write, diff.
pub mod read;
pub mod write;
pub mod diff;

use xmltree::{Element, XMLNode};
use std::io::Cursor;
use anyhow::{anyhow, Result};

// ─── parse ────────────────────────────────────────────────────────────────────

pub fn parse(bytes: &[u8]) -> Result<Element> {
    let data = if bytes.starts_with(b"\xef\xbb\xbf") { &bytes[3..] } else { bytes };
    Element::parse(Cursor::new(data)).map_err(|e| anyhow!("XML parse error: {e}"))
}

pub fn to_xml_string(root: &Element) -> String {
    let mut out: Vec<u8> = Vec::new();
    // Add XML declaration manually
    out.extend_from_slice(b"<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\n");
    let cfg = xmltree::EmitterConfig::new()
        .perform_indent(true)
        .indent_string("  ")
        .write_document_declaration(false); // we already wrote it above
    let _ = root.write_with_config(&mut out, cfg);
    String::from_utf8(out).unwrap_or_default()
}

// ─── navigation helpers ───────────────────────────────────────────────────────

pub fn ctrl(root: &Element) -> Result<&Element> {
    root.get_child("Controller").ok_or_else(|| anyhow!("No <Controller> element"))
}

pub fn ctrl_mut(root: &mut Element) -> Result<&mut Element> {
    root.get_mut_child("Controller").ok_or_else(|| anyhow!("No <Controller> element"))
}

pub fn attr<'a>(el: &'a Element, name: &str) -> &'a str {
    el.attributes.get(name).map(|s| s.as_str()).unwrap_or("")
}

pub fn get_text(el: &Element) -> String {
    el.get_text().map(|s| s.trim().to_string()).unwrap_or_default()
}

pub fn child_text(el: &Element, tag: &str) -> String {
    el.get_child(tag).map(|c| get_text(c)).unwrap_or_default()
}

pub fn children_named<'a>(el: &'a Element, tag: &str) -> Vec<&'a Element> {
    el.children.iter().filter_map(|n| n.as_element()).filter(|e| e.name == tag).collect()
}

pub fn all_children(el: &Element) -> impl Iterator<Item = &Element> {
    el.children.iter().filter_map(|n| n.as_element())
}

/// Find first child element matching tag + attribute value.
pub fn find_child<'a>(el: &'a Element, tag: &str, attr_name: &str, val: &str) -> Option<&'a Element> {
    el.children.iter().filter_map(|n| n.as_element())
        .find(|e| e.name == tag && attr(e, attr_name) == val)
}

/// Mutable version — finds by position first (immutable), then returns mutable ref.
pub fn find_child_mut<'a>(el: &'a mut Element, tag: &str, attr_name: &str, val: &str) -> Option<&'a mut Element> {
    let idx = el.children.iter()
        .position(|n| n.as_element()
            .map(|e| e.name == tag && attr(e, attr_name) == val)
            .unwrap_or(false))?;
    el.children[idx].as_mut_element()
}

/// Ensure child with given tag exists; create it if not.
pub fn get_or_make_child<'a>(el: &'a mut Element, tag: &str) -> &'a mut Element {
    if el.get_child(tag).is_none() {
        el.children.push(XMLNode::Element(Element::new(tag)));
    }
    el.get_mut_child(tag).unwrap()
}

pub fn make_el(name: &str, attrs: &[(&str, &str)]) -> Element {
    let mut e = Element::new(name);
    for (k, v) in attrs { e.attributes.insert(k.to_string(), v.to_string()); }
    e
}

pub fn make_cdata_el(name: &str, text: &str) -> Element {
    let mut e = Element::new(name);
    e.children.push(XMLNode::CData(text.to_string()));
    e
}

pub fn make_text_el(name: &str, text: &str) -> Element {
    let mut e = Element::new(name);
    e.children.push(XMLNode::Text(text.to_string()));
    e
}

pub fn set_cdata(el: &mut Element, text: &str) {
    el.children.clear();
    el.children.push(XMLNode::CData(text.to_string()));
}

pub fn remove_child(el: &mut Element, tag: &str, attr_name: &str, val: &str) -> bool {
    if let Some(pos) = el.children.iter().position(|n| {
        n.as_element().map(|e| e.name == tag && attr(e, attr_name) == val).unwrap_or(false)
    }) {
        el.children.remove(pos);
        true
    } else { false }
}

pub fn prog<'a>(ctrl_el: &'a Element, name: &str) -> Result<&'a Element> {
    let progs = ctrl_el.get_child("Programs").unwrap_or(ctrl_el);
    find_child(progs, "Program", "Name", name).ok_or_else(|| anyhow!("Program '{name}' not found"))
}

pub fn prog_mut<'a>(ctrl_el: &'a mut Element, name: &str) -> Result<&'a mut Element> {
    // need to split borrow
    let has = ctrl_el.get_child("Programs")
        .and_then(|ps| find_child(ps, "Program", "Name", name))
        .is_some();
    if !has { return Err(anyhow!("Program '{name}' not found")); }
    let progs = get_or_make_child(ctrl_el, "Programs");
    find_child_mut(progs, "Program", "Name", name).ok_or_else(|| anyhow!("Program '{name}' not found"))
}

pub fn rung_comment(rung_el: &Element) -> String {
    let cmt = match rung_el.get_child("Comment") { Some(c) => c, None => return String::new() };
    if let Some(lc) = cmt.get_child("LocalizedComment") { return get_text(lc); }
    get_text(cmt)
}

pub fn rung_text(rung_el: &Element) -> String {
    rung_el.get_child("Text").map(|t| get_text(t)).unwrap_or_default()
}

pub fn rung_dict(rung_el: &Element) -> serde_json::Value {
    serde_json::json!({
        "number":  attr(rung_el, "Number").parse::<usize>().unwrap_or(0),
        "type":    if attr(rung_el, "Type").is_empty() { "N" } else { attr(rung_el, "Type") },
        "text":    rung_text(rung_el),
        "comment": rung_comment(rung_el),
    })
}
