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
    // Studio 5000 layout, learned the hard way from real L5X work:
    // the stock xmltree emitter re-indents everything, drops the BOM,
    // writes LF line endings, and loses CDATA, and Studio 5000 then
    // truncates multi-line comments on import. So this writes the file
    // the way Studio 5000 itself does:
    //   - UTF-8 BOM, then the XML declaration, then CRLF throughout
    //   - no indentation (every element starts at column 0)
    //   - Text / Comment / Data / DefaultData / Description content is
    //     written back as CDATA on its own lines, exactly as Studio does:
    //       <Comment>\r\n<![CDATA[...]]>\r\n</Comment>
    //     xmltree's parser turns CDATA into plain Text nodes on read
    //     (xmltree 0.10 lib.rs, CData -> Text), so the writer has to
    //     put CDATA back for those element names, and for any node that
    //     is still a CData node (new rungs/tags created by write.rs).
    //   - attributes stay in insertion order (xmltree "attribute-order"
    //     feature, IndexMap instead of HashMap), so a save does not
    //     shuffle them.
    //   - short single-text children (e.g. <ConfigID>100</ConfigID>)
    //     stay inline, and an element whose children are all such
    //     short-text elements (e.g. <public>) stays on one line, as in
    //     the original export.
    // Line endings inside CDATA are normalised to CRLF: XML parsers
    // normalise \r\n to \n on read, so the parsed text has LF only.
    let mut out = String::new();
    out.push('\u{FEFF}');
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\r\n");
    write_element(&mut out, root);
    out
}

/// Element names whose text content Studio 5000 stores as CDATA.
const CDATA_ELEMENTS: [&str; 5] = ["Text", "Comment", "Data", "DefaultData", "Description"];

fn escape_text(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;")
}

fn escape_attr(s: &str) -> String {
    escape_text(s).replace('"', "&quot;")
}

fn to_crlf(s: &str) -> String {
    s.replace("\r\n", "\n").replace('\n', "\r\n")
}

/// Children that carry content: element nodes, CData, non-whitespace text,
/// comments and processing instructions. Whitespace-only text between
/// elements is layout from the source file, not content, and is dropped
/// (the writer lays the file out itself).
fn significant_children(el: &Element) -> Vec<&XMLNode> {
    el.children
        .iter()
        .filter(|n| match n {
            XMLNode::Text(t) => !t.trim().is_empty(),
            _ => true,
        })
        .collect()
}

fn open_tag(el: &Element) -> String {
    let mut s = String::from("<");
    s.push_str(&el.name);
    for (k, v) in &el.attributes {
        s.push(' ');
        s.push_str(k);
        s.push_str("=\"");
        s.push_str(&escape_attr(v));
        s.push('"');
    }
    s
}

/// True when the element can be written on one line: a single short text
/// child with no line breaks, e.g. <ConfigID>100</ConfigID>.
fn inline_text(el: &Element) -> Option<String> {
    // CDATA elements are never inline text: their content is written
    // back as a CDATA block, even when it is a single line. Without
    // this, a Rung (whose children are Comment and Text) would match
    // the all-inline-children rule below and be written on one line.
    if CDATA_ELEMENTS.contains(&el.name.as_str()) {
        return None;
    }
    let kids = significant_children(el);
    if kids.len() == 1 {
        if let XMLNode::Text(t) = kids[0] {
            if !t.contains('\n') && !t.contains('\r') {
                return Some(escape_text(t));
            }
        }
    }
    None
}

fn write_element(out: &mut String, el: &Element) {
    let kids = significant_children(el);
    let open = open_tag(el);
    if kids.is_empty() {
        out.push_str(&open);
        out.push_str("/>\r\n");
        return;
    }
    // One text / CDATA child: CDATA block for the Studio CDATA elements,
    // inline text otherwise.
    if kids.len() == 1 {
        if let XMLNode::CData(c) | XMLNode::Text(c) = kids[0] {
            let is_cdata_node = matches!(kids[0], XMLNode::CData(_));
            if CDATA_ELEMENTS.contains(&el.name.as_str()) || is_cdata_node {
                if !c.contains("]]>") {
                    out.push_str(&open);
                    out.push_str(">\r\n<![CDATA[");
                    out.push_str(&to_crlf(c));
                    out.push_str("]]>\r\n</");
                    out.push_str(&el.name);
                    out.push_str(">\r\n");
                    return;
                }
                // Content holds "]]>" so CDATA is impossible; fall
                // through to escaped inline text below.
            }
            if let Some(t) = inline_text(el) {
                out.push_str(&open);
                out.push('>');
                out.push_str(&t);
                out.push_str("</");
                out.push_str(&el.name);
                out.push_str(">\r\n");
                return;
            }
            // Multi-line plain text: keep it, CRLF-normalised.
            out.push_str(&open);
            out.push('>');
            out.push_str(&to_crlf(c));
            out.push_str("</");
            out.push_str(&el.name);
            out.push_str(">\r\n");
            return;
        }
    }
    // All children are short inline-text elements: one line, as Studio
    // writes <public><ConfigID>100</ConfigID><CatNum>...</CatNum></public>.
    if !kids.is_empty()
        && kids
            .iter()
            .all(|n| n.as_element().map(|e| inline_text(e).is_some()).unwrap_or(false))
    {
        out.push_str(&open);
        out.push('>');
        for n in &kids {
            let e = n.as_element().unwrap();
            out.push_str(&open_tag(e));
            out.push('>');
            out.push_str(&inline_text(e).unwrap());
            out.push_str("</");
            out.push_str(&e.name);
            out.push('>');
        }
        out.push_str("</");
        out.push_str(&el.name);
        out.push_str(">\r\n");
        return;
    }
    out.push_str(&open);
    out.push_str(">\r\n");
    for n in &kids {
        match n {
            XMLNode::Element(e) => write_element(out, e),
            XMLNode::Text(t) => {
                out.push_str(&escape_text(t));
                out.push_str("\r\n");
            }
            XMLNode::CData(c) => {
                out.push_str("<![CDATA[");
                out.push_str(&to_crlf(c));
                out.push_str("]]>\r\n");
            }
            XMLNode::Comment(c) => {
                out.push_str("<!--");
                out.push_str(c);
                out.push_str("-->\r\n");
            }
            XMLNode::ProcessingInstruction(target, data) => {
                out.push_str("<?");
                out.push_str(target);
                if let Some(d) = data {
                    out.push(' ');
                    out.push_str(d);
                }
                out.push_str("?>\r\n");
            }
        }
    }
    out.push_str("</");
    out.push_str(&el.name);
    out.push_str(">\r\n");
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
