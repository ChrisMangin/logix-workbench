//! Compare two L5X files and produce a structured diff.
//! Uses roxmltree (zero-copy, fast) for the read-only compare pass.
//! Uses `similar` (Myers LCS, no autojunk) for rung sequence diff.

use roxmltree::Document;
use serde_json::{json, Value};
use similar::{Algorithm, capture_diff_slices, DiffOp};
use anyhow::{anyhow, Result};
use std::collections::{HashMap, HashSet};

// ─── parse helpers ────────────────────────────────────────────────────────────

fn strip_bom(bytes: &[u8]) -> &[u8] {
    if bytes.starts_with(b"\xef\xbb\xbf") { &bytes[3..] } else { bytes }
}

fn parse_str(bytes: &[u8]) -> Result<String> {
    let stripped = strip_bom(bytes);
    std::str::from_utf8(stripped).map(|s| s.to_string()).map_err(|e| anyhow!("{e}"))
}

fn rx_attr<'a>(node: &roxmltree::Node<'a, '_>, name: &str) -> &'a str {
    node.attribute(name).unwrap_or("")
}

fn rung_comment_rx(rung: &roxmltree::Node) -> String {
    for c in rung.children() {
        if !c.is_element() || c.tag_name().name() != "Comment" { continue; }
        for lc in c.children() {
            if lc.is_element() && lc.tag_name().name() == "LocalizedComment" {
                return lc.text().unwrap_or("").trim().to_string();
            }
        }
        return c.text().unwrap_or("").trim().to_string();
    }
    String::new()
}

fn rung_text_rx(rung: &roxmltree::Node) -> String {
    for c in rung.children() {
        if c.is_element() && c.tag_name().name() == "Text" {
            return c.text().unwrap_or("").trim().to_string();
        }
    }
    String::new()
}

// ─── rung data ────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct RungData { text: String, comment: String }

fn get_rungs(doc: &Document, prog: &str, rtn: &str) -> Vec<RungData> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let progs = match ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "Programs") { Some(p) => p, None => return vec![] };
    let prog_el = match progs.children().find(|c| c.is_element() && c.tag_name().name() == "Program" && rx_attr(c, "Name") == prog) { Some(p) => p, None => return vec![] };
    let rtns = match prog_el.children().find(|c| c.is_element() && c.tag_name().name() == "Routines") { Some(r) => r, None => return vec![] };
    let rtn_el = match rtns.children().find(|c| c.is_element() && c.tag_name().name() == "Routine" && rx_attr(c, "Name") == rtn) { Some(r) => r, None => return vec![] };
    let rll = match rtn_el.children().find(|c| c.is_element() && c.tag_name().name() == "RLLContent") { Some(r) => r, None => return vec![] };
    rll.children().filter(|c| c.is_element() && c.tag_name().name() == "Rung")
        .map(|rung| RungData { text: rung_text_rx(&rung), comment: rung_comment_rx(&rung) })
        .collect()
}

fn get_tags(doc: &Document, prog: Option<&str>) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let scope = if let Some(pname) = prog {
        let progs = ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "Programs");
        let p = progs.and_then(|ps| ps.children().find(|c| c.is_element() && c.tag_name().name() == "Program" && rx_attr(c, "Name") == pname));
        p.and_then(|p| p.children().find(|c| c.is_element() && c.tag_name().name() == "Tags"))
    } else {
        ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "Tags")
    };
    let mut map = HashMap::new();
    if let Some(tags_el) = scope {
        for t in tags_el.children().filter(|c| c.is_element() && c.tag_name().name() == "Tag") {
            let name = rx_attr(&t, "Name").to_string();
            let dt   = rx_attr(&t, "DataType").to_string();
            let val = t.descendants().find(|d| d.is_element() && d.tag_name().name() == "DataValue")
                .map(|dv| rx_attr(&dv, "Value").to_string()).unwrap_or_default();
            let desc = t.children().find(|c| c.is_element() && c.tag_name().name() == "Description")
                .and_then(|d| d.text()).unwrap_or("").trim().to_string();
            map.insert(name.clone(), json!({
                "name": name, "dataType": dt, "value": val, "desc": desc,
                "tagType": rx_attr(&t, "TagType"),
                "radix": rx_attr(&t, "Radix"),
                "externalAccess": rx_attr(&t, "ExternalAccess"),
            }));
        }
    }
    map
}

fn ctrl_props(doc: &Document) -> Vec<(String, String)> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    vec![
        ("Name".into(),          rx_attr(&ctrl, "Name").into()),
        ("ProcessorType".into(), rx_attr(&ctrl, "ProcessorType").into()),
        ("MajorRev".into(),      rx_attr(&ctrl, "MajorRev").into()),
        ("MinorRev".into(),      rx_attr(&ctrl, "MinorRev").into()),
    ]
}

fn get_programs(doc: &Document) -> HashMap<String, HashMap<String, (usize, String)>> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let mut progs: HashMap<String, HashMap<String, (usize, String)>> = HashMap::new();
    if let Some(ps) = ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "Programs") {
        for p in ps.children().filter(|c| c.is_element() && c.tag_name().name() == "Program") {
            let pname = rx_attr(&p, "Name").to_string();
            let mut rtns: HashMap<String, (usize, String)> = HashMap::new();
            if let Some(rs) = p.children().find(|c| c.is_element() && c.tag_name().name() == "Routines") {
                for r in rs.children().filter(|c| c.is_element() && c.tag_name().name() == "Routine") {
                    let rname = rx_attr(&r, "Name").to_string();
                    let rtype = rx_attr(&r, "Type").to_string();
                    let rungs = r.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Rung").count();
                    rtns.insert(rname, (rungs, rtype));
                }
            }
            progs.insert(pname, rtns);
        }
    }
    progs
}

fn get_tag_count(doc: &Document, prog: &str) -> usize {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    ctrl.descendants()
        .find(|d| d.is_element() && d.tag_name().name() == "Program" && rx_attr(d, "Name") == prog)
        .and_then(|p| p.children().find(|c| c.is_element() && c.tag_name().name() == "Tags"))
        .map(|t| t.children().filter(|c| c.is_element() && c.tag_name().name() == "Tag").count())
        .unwrap_or(0)
}

fn prog_routines_summary(doc: &Document, pname: &str) -> Vec<Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let p = match ctrl.descendants().find(|d| d.is_element() && d.tag_name().name() == "Program" && rx_attr(d, "Name") == pname) { Some(p) => p, None => return vec![] };
    let rs = match p.children().find(|c| c.is_element() && c.tag_name().name() == "Routines") { Some(r) => r, None => return vec![] };
    rs.children().filter(|c| c.is_element() && c.tag_name().name() == "Routine").map(|r| {
        let rtype = rx_attr(&r, "Type").to_string();
        let rungs: Vec<Value> = r.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Rung")
            .enumerate().map(|(j, rg)| json!({"num":j,"text":rung_text_rx(&rg),"comment":rung_comment_rx(&rg)})).collect();
        json!({"name":rx_attr(&r,"Name"),"type":rtype,"rungs":rungs.len(),"rungs_data":rungs})
    }).collect()
}

fn get_modules(doc: &Document) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let mut seen: HashSet<u32> = HashSet::new();
    let mut mods: HashMap<String, Value> = HashMap::new();
    for c in ctrl.children().filter(|c| c.is_element()) {
        let tag = c.tag_name().name();
        if tag == "Modules" || tag == "EthernetNetwork" {
            for m in c.children().filter(|m| m.is_element() && m.tag_name().name() == "Module") {
                if !seen.insert(m.id().get()) { continue; }
                let name = rx_attr(&m, "Name").to_string();
                mods.insert(name.clone(), json!({"name":name,"catalog":rx_attr(&m,"CatalogNumber"),"slot":rx_attr(&m,"Slot")}));
            }
        }
    }
    mods
}

fn get_tasks(doc: &Document) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    ctrl.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Task")
        .map(|t| { let n = rx_attr(&t,"Name").to_string();
            (n.clone(), json!({"name":n,"type":rx_attr(&t,"Type"),"rate":rx_attr(&t,"Rate"),"priority":rx_attr(&t,"Priority"),"watchdog":rx_attr(&t,"Watchdog")}))
        }).collect()
}

fn get_trends(doc: &Document) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    ctrl.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Trend")
        .map(|t| { let n = rx_attr(&t,"Name").to_string(); let pens = t.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Pen").count();
            (n.clone(), json!({"name":n,"pens":pens}))
        }).collect()
}

fn get_dtypes(doc: &Document) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let mut map: HashMap<String, Value> = HashMap::new();
    if let Some(dts) = ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "DataTypes") {
        for dt in dts.children().filter(|c| c.is_element() && c.tag_name().name() == "DataType") {
            let name = rx_attr(&dt, "Name").to_string();
            let members: Vec<Value> = dt.descendants()
                .filter(|d| d.is_element() && d.tag_name().name() == "Member" && rx_attr(d, "Hidden") != "true")
                .map(|m| json!({"name":rx_attr(&m,"Name"),"type":rx_attr(&m,"DataType"),"dim":rx_attr(&m,"Dimension")})).collect();
            let desc = dt.children().find(|c| c.is_element() && c.tag_name().name() == "Description").and_then(|d| d.text()).unwrap_or("").to_string();
            map.insert(name.clone(), json!({"name":name,"members":members,"desc":desc}));
        }
    }
    map
}

fn get_aois(doc: &Document) -> HashMap<String, Value> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let mut map: HashMap<String, Value> = HashMap::new();
    if let Some(aois) = ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "AddOnInstructionDefinitions") {
        for aoi in aois.children().filter(|c| c.is_element() && c.tag_name().name() == "AddOnInstructionDefinition") {
            let name = rx_attr(&aoi, "Name").to_string();
            let rev  = rx_attr(&aoi, "Revision").to_string();
            let params: Vec<Value> = aoi.descendants().filter(|d| d.is_element() && d.tag_name().name() == "Parameter")
                .map(|p| json!({"name":rx_attr(&p,"Name"),"dt":rx_attr(&p,"DataType"),"usage":rx_attr(&p,"Usage")})).collect();
            let local_tags: Vec<Value> = aoi.descendants().filter(|d| d.is_element() && d.tag_name().name() == "LocalTag")
                .map(|lt| json!({"name":rx_attr(&lt,"Name"),"dt":rx_attr(&lt,"DataType")})).collect();
            map.insert(name.clone(), json!({"name":name,"revision":rev,"params":params,"localTags":local_tags}));
        }
    }
    map
}

fn get_aoi_routines(doc: &Document, aoi_name: &str) -> HashMap<String, Vec<RungData>> {
    let root = doc.root_element();
    let ctrl = root.first_element_child().unwrap_or(root);
    let mut map: HashMap<String, Vec<RungData>> = HashMap::new();
    if let Some(aois) = ctrl.children().find(|c| c.is_element() && c.tag_name().name() == "AddOnInstructionDefinitions") {
        if let Some(aoi) = aois.children().find(|c| c.is_element() && c.tag_name().name() == "AddOnInstructionDefinition" && rx_attr(c, "Name") == aoi_name) {
            if let Some(rtns) = aoi.children().find(|c| c.is_element() && c.tag_name().name() == "Routines") {
                for r in rtns.children().filter(|c| c.is_element() && c.tag_name().name() == "Routine") {
                    let rname = rx_attr(&r, "Name").to_string();
                    if let Some(rll) = r.children().find(|c| c.is_element() && c.tag_name().name() == "RLLContent") {
                        let rungs: Vec<RungData> = rll.children().filter(|c| c.is_element() && c.tag_name().name() == "Rung")
                            .map(|rg| RungData { text: rung_text_rx(&rg), comment: rung_comment_rx(&rg) }).collect();
                        map.insert(rname, rungs);
                    }
                }
            }
        }
    }
    map
}

// ─── diff helpers ─────────────────────────────────────────────────────────────

fn rung_diff_calc(ra: &[RungData], rb: &[RungData], inc_cmt: bool) -> Vec<Value> {
    let ka: Vec<String> = ra.iter().map(|r| if inc_cmt { format!("{}\x00{}", r.text, r.comment) } else { r.text.clone() }).collect();
    let kb: Vec<String> = rb.iter().map(|r| if inc_cmt { format!("{}\x00{}", r.text, r.comment) } else { r.text.clone() }).collect();
    if ka == kb { return vec![]; }
    let ops = capture_diff_slices(Algorithm::Myers, &ka, &kb);
    let mut result = Vec::new();
    for op in ops {
        match op {
            DiffOp::Equal { .. } => {}
            DiffOp::Insert { new_index, new_len, .. } => {
                for j in new_index..new_index+new_len {
                    result.push(json!({"op":"added","numB":j,"textB":rb[j].text,"comB":rb[j].comment}));
                }
            }
            DiffOp::Delete { old_index, old_len, .. } => {
                for i in old_index..old_index+old_len {
                    result.push(json!({"op":"removed","numA":i,"textA":ra[i].text,"comA":ra[i].comment}));
                }
            }
            DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let k_max = old_len.max(new_len);
                for k in 0..k_max {
                    let ia = old_index+k; let jb = new_index+k;
                    let ha = ia < old_index+old_len; let hb = jb < new_index+new_len;
                    if ha && hb { result.push(json!({"op":"changed","numA":ia,"numB":jb,"textA":ra[ia].text,"comA":ra[ia].comment,"textB":rb[jb].text,"comB":rb[jb].comment})); }
                    else if ha { result.push(json!({"op":"removed","numA":ia,"textA":ra[ia].text,"comA":ra[ia].comment})); }
                    else        { result.push(json!({"op":"added","numB":jb,"textB":rb[jb].text,"comB":rb[jb].comment})); }
                }
            }
        }
    }
    result
}

fn diff_tags(ta: &HashMap<String, Value>, tb: &HashMap<String, Value>, inc_vals: bool) -> Value {
    let fields = ["dataType","desc","tagType","radix","externalAccess","value"];
    let mut added: Vec<Value> = tb.iter().filter(|(k,_)| !ta.contains_key(*k)).map(|(_,v)| v.clone()).collect();
    let mut removed: Vec<Value> = ta.iter().filter(|(k,_)| !tb.contains_key(*k)).map(|(_,v)| v.clone()).collect();
    let mut changed: Vec<Value> = Vec::new();
    for (k, va) in ta.iter() {
        if let Some(vb) = tb.get(k) {
            let mut diffs: HashMap<String, Value> = HashMap::new();
            for f in &fields {
                let fa = va.get(*f).and_then(|v| v.as_str()).unwrap_or("");
                let fb = vb.get(*f).and_then(|v| v.as_str()).unwrap_or("");
                if fa != fb { diffs.insert(f.to_string(), json!({"from":fa,"to":fb})); }
            }
            if diffs.is_empty() { continue; }
            if !inc_vals && diffs.len() == 1 && diffs.contains_key("value") { continue; }
            changed.push(json!({"name":k,"dataType":va["dataType"].as_str().unwrap_or(""),"tagType":va["tagType"].as_str().unwrap_or("Base"),"changes":diffs}));
        }
    }
    added.sort_by(|a,b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    removed.sort_by(|a,b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    changed.sort_by(|a,b| a["name"].as_str().unwrap_or("").cmp(b["name"].as_str().unwrap_or("")));
    json!({"added":added,"removed":removed,"changed":changed})
}

fn diff_named(a: &HashMap<String, Value>, b: &HashMap<String, Value>) -> Value {
    let mut added: Vec<Value> = b.iter().filter(|(k,_)| !a.contains_key(*k)).map(|(_,v)| v.clone()).collect();
    let mut removed: Vec<Value> = a.iter().filter(|(k,_)| !b.contains_key(*k)).map(|(_,v)| v.clone()).collect();
    let mut changed: Vec<Value> = a.iter().filter(|(k,va)| b.get(*k).map(|vb| **va != *vb).unwrap_or(false)).map(|(k,_)| json!({"name":k})).collect();
    added.sort_by(|x,y| x["name"].as_str().unwrap_or("").cmp(y["name"].as_str().unwrap_or("")));
    removed.sort_by(|x,y| x["name"].as_str().unwrap_or("").cmp(y["name"].as_str().unwrap_or("")));
    changed.sort_by(|x,y| x["name"].as_str().unwrap_or("").cmp(y["name"].as_str().unwrap_or("")));
    json!({"added":added,"removed":removed,"changed":changed})
}

fn total(d: &Value) -> usize {
    let a = d["added"].as_array().map(|v| v.len()).unwrap_or(0);
    let r = d["removed"].as_array().map(|v| v.len()).unwrap_or(0);
    let c = d["changed"].as_array().map(|v| v.len()).unwrap_or(0);
    a + r + c
}

// ─── main compare ─────────────────────────────────────────────────────────────

pub fn compare_l5x(bytes_a: &[u8], bytes_b: &[u8], inc_cmt: bool, inc_vals: bool) -> Result<Value> {
    let text_a = parse_str(bytes_a)?;
    let text_b = parse_str(bytes_b)?;
    let doc_a = Document::parse(&text_a).map_err(|e| anyhow!("Parse A: {e}"))?;
    let doc_b = Document::parse(&text_b).map_err(|e| anyhow!("Parse B: {e}"))?;

    // controller props
    let props_a = ctrl_props(&doc_a);
    let props_b = ctrl_props(&doc_b);
    let ctrl_changes: Vec<Value> = props_a.iter().zip(props_b.iter())
        .filter_map(|((na, va), (_, vb))| if va != vb { Some(json!({"prop":na,"from":va,"to":vb})) } else { None })
        .collect();

    // tags
    let ta = get_tags(&doc_a, None); let tb = get_tags(&doc_b, None);
    let ctrl_tags_diff = diff_tags(&ta, &tb, inc_vals);

    // data types
    let dts_a = get_dtypes(&doc_a); let dts_b = get_dtypes(&doc_b);
    let na_dt: HashSet<String> = dts_a.keys().cloned().collect();
    let nb_dt: HashSet<String> = dts_b.keys().cloned().collect();
    let mut dt_added: Vec<Value>   = nb_dt.difference(&na_dt).map(|k| json!({"name":k})).collect();
    let mut dt_removed: Vec<Value> = na_dt.difference(&nb_dt).map(|k| json!({"name":k})).collect();
    dt_added.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
    dt_removed.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
    let mut dt_changed: Vec<Value> = Vec::new();
    let mut dt_common: Vec<String> = na_dt.intersection(&nb_dt).cloned().collect(); dt_common.sort();
    for k in &dt_common {
        let va = &dts_a[k]; let vb = &dts_b[k];
        if va != vb {
            let ma = va["members"].as_array().cloned().unwrap_or_default();
            let mb = vb["members"].as_array().cloned().unwrap_or_default();
            let ma_names: HashSet<String> = ma.iter().filter_map(|m| m["name"].as_str().map(|s| s.to_string())).collect();
            let mb_names: HashSet<String> = mb.iter().filter_map(|m| m["name"].as_str().map(|s| s.to_string())).collect();
            let mem_added:   Vec<&Value> = mb.iter().filter(|m| !ma_names.contains(m["name"].as_str().unwrap_or(""))).collect();
            let mem_removed: Vec<&Value> = ma.iter().filter(|m| !mb_names.contains(m["name"].as_str().unwrap_or(""))).collect();
            dt_changed.push(json!({"name":k,"membersA":ma,"membersB":mb,"memberDiff":{"added":mem_added,"removed":mem_removed,"changed":[]}}));
        }
    }
    let dtype_diff = json!({"added":dt_added,"removed":dt_removed,"changed":dt_changed});

    // AOIs
    let aois_a = get_aois(&doc_a); let aois_b = get_aois(&doc_b);
    let na_aoi: HashSet<String> = aois_a.keys().cloned().collect();
    let nb_aoi: HashSet<String> = aois_b.keys().cloned().collect();
    let mut aoi_added: Vec<Value>   = nb_aoi.difference(&na_aoi).map(|k| aois_b[k].clone()).collect();
    let mut aoi_removed: Vec<Value> = na_aoi.difference(&nb_aoi).map(|k| aois_a[k].clone()).collect();
    aoi_added.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
    aoi_removed.sort_by(|a,b| a["name"].as_str().cmp(&b["name"].as_str()));
    let mut aoi_changed: Vec<Value> = Vec::new();
    let mut aoi_common: Vec<String> = na_aoi.intersection(&nb_aoi).cloned().collect(); aoi_common.sort();
    for k in &aoi_common {
        let va = &aois_a[k]; let vb = &aois_b[k];
        if va != vb {
            let rtns_a = get_aoi_routines(&doc_a, k);
            let rtns_b = get_aoi_routines(&doc_b, k);
            let all_rtn_names: HashSet<String> = rtns_a.keys().chain(rtns_b.keys()).cloned().collect();
            let mut rtn_diffs: HashMap<String, Value> = HashMap::new();
            for rname in &all_rtn_names {
                let ra = rtns_a.get(rname.as_str()).map(Vec::as_slice).unwrap_or(&[]);
                let rb = rtns_b.get(rname.as_str()).map(Vec::as_slice).unwrap_or(&[]);
                let diff = rung_diff_calc(ra, rb, inc_cmt);
                if !diff.is_empty() {
                    let ra_j: Vec<Value> = ra.iter().enumerate().map(|(i,r)| json!({"num":i,"text":r.text,"comment":r.comment})).collect();
                    let rb_j: Vec<Value> = rb.iter().enumerate().map(|(i,r)| json!({"num":i,"text":r.text,"comment":r.comment})).collect();
                    rtn_diffs.insert(rname.clone(), json!({"rungsA":ra_j,"rungsB":rb_j,"rungDiff":diff}));
                }
            }
            aoi_changed.push(json!({"name":k,"revisionA":va["revision"],"revisionB":vb["revision"],"routineDiffs":rtn_diffs}));
        }
    }
    let aoi_diff = json!({"added":aoi_added,"removed":aoi_removed,"changed":aoi_changed});

    // programs
    let progs_a = get_programs(&doc_a); let progs_b = get_programs(&doc_b);
    let na_p: HashSet<String> = progs_a.keys().cloned().collect();
    let nb_p: HashSet<String> = progs_b.keys().cloned().collect();
    let mut prog_added_names: Vec<String> = nb_p.difference(&na_p).cloned().collect(); prog_added_names.sort();
    let mut prog_removed_names: Vec<String> = na_p.difference(&nb_p).cloned().collect(); prog_removed_names.sort();
    let prog_added: Vec<Value>   = prog_added_names.iter().map(|k| { let r = prog_routines_summary(&doc_b, k); json!({"name":k,"routineCount":r.len(),"routines":r}) }).collect();
    let prog_removed: Vec<Value> = prog_removed_names.iter().map(|k| { let r = prog_routines_summary(&doc_a, k); json!({"name":k,"routineCount":r.len(),"routines":r}) }).collect();
    let mut prog_changed: Vec<Value> = Vec::new();
    let mut common_progs: Vec<String> = na_p.intersection(&nb_p).cloned().collect(); common_progs.sort();
    for pname in &common_progs {
        let ra = &progs_a[pname]; let rb = &progs_b[pname];
        let rna: HashSet<String> = ra.keys().cloned().collect();
        let rnb: HashSet<String> = rb.keys().cloned().collect();
        let mut rtns_added_names: Vec<String> = rnb.difference(&rna).cloned().collect(); rtns_added_names.sort();
        let mut rtns_removed_names: Vec<String> = rna.difference(&rnb).cloned().collect(); rtns_removed_names.sort();
        let rtns_added: Vec<Value> = rtns_added_names.iter().map(|rn| {
            let rungs = get_rungs(&doc_b, pname, rn);
            let rd: Vec<Value> = rungs.iter().enumerate().map(|(i,r)| json!({"num":i,"text":r.text,"comment":r.comment})).collect();
            json!({"name":rn,"type":rb[rn].1,"rungs":rb[rn].0,"rungs_data":rd})
        }).collect();
        let rtns_removed: Vec<Value> = rtns_removed_names.iter().map(|rn| {
            let rungs = get_rungs(&doc_a, pname, rn);
            let rd: Vec<Value> = rungs.iter().enumerate().map(|(i,r)| json!({"num":i,"text":r.text,"comment":r.comment})).collect();
            json!({"name":rn,"type":ra[rn].1,"rungs":ra[rn].0,"rungs_data":rd})
        }).collect();
        let mut rtns_changed: Vec<Value> = Vec::new();
        let mut common_rtns: Vec<String> = rna.intersection(&rnb).cloned().collect(); common_rtns.sort();
        for rname in &common_rtns {
            let rl_a = get_rungs(&doc_a, pname, rname);
            let rl_b = get_rungs(&doc_b, pname, rname);
            let meta_ch = ra[rname] != rb[rname];
            let content_ch = rl_a.len() != rl_b.len() || rl_a.iter().zip(rl_b.iter()).any(|(a,b)| a.text != b.text || (inc_cmt && a.comment != b.comment));
            if meta_ch || content_ch {
                let diff = rung_diff_calc(&rl_a, &rl_b, inc_cmt);
                let ra_j: Vec<Value> = rl_a.iter().enumerate().map(|(j,r)| json!({"num":j,"text":r.text,"comment":r.comment})).collect();
                let rb_j: Vec<Value> = rl_b.iter().enumerate().map(|(j,r)| json!({"num":j,"text":r.text,"comment":r.comment})).collect();
                rtns_changed.push(json!({"name":rname,"from":{"type":ra[rname].1,"rungs":ra[rname].0},"to":{"type":rb[rname].1,"rungs":rb[rname].0},"rungDiff":diff,"rungsA":ra_j,"rungsB":rb_j}));
            }
        }
        let has_rtn_ch = !rtns_added.is_empty() || !rtns_removed.is_empty() || !rtns_changed.is_empty();
        let tc_a = get_tag_count(&doc_a, pname); let tc_b = get_tag_count(&doc_b, pname);
        if has_rtn_ch || tc_a != tc_b {
            let pta = get_tags(&doc_a, Some(pname)); let ptb = get_tags(&doc_b, Some(pname));
            let tag_d = diff_tags(&pta, &ptb, inc_vals);
            prog_changed.push(json!({"name":pname,"routines":{"added":rtns_added,"removed":rtns_removed,"changed":rtns_changed},"tagCountA":tc_a,"tagCountB":tc_b,"tagDiff":tag_d}));
        }
    }
    let prog_diff = json!({"added":prog_added,"removed":prog_removed,"changed":prog_changed});

    let module_diff = diff_named(&get_modules(&doc_a), &get_modules(&doc_b));
    let task_diff   = diff_named(&get_tasks(&doc_a),   &get_tasks(&doc_b));
    let trend_diff  = diff_named(&get_trends(&doc_a),  &get_trends(&doc_b));

    let sum_total = ctrl_changes.len() + total(&ctrl_tags_diff) + total(&dtype_diff) +
                    total(&aoi_diff) + total(&prog_diff) + total(&module_diff) +
                    total(&task_diff) + total(&trend_diff);
    let summary = json!({
        "controller": ctrl_changes.len(), "tags": total(&ctrl_tags_diff),
        "dataTypes": total(&dtype_diff), "aois": total(&aoi_diff),
        "programs": total(&prog_diff), "modules": total(&module_diff),
        "tasks": total(&task_diff), "trends": total(&trend_diff), "total": sum_total,
    });

    Ok(json!({
        "summary":    summary,
        "controller": ctrl_changes,
        "tags":       ctrl_tags_diff,
        "dataTypes":  dtype_diff,
        "aois":       aoi_diff,
        "programs":   prog_diff,
        "modules":    module_diff,
        "tasks":      task_diff,
        "trends":     trend_diff,
    }))
}

// ─── migrate ──────────────────────────────────────────────────────────────────

pub fn migrate_change(src: &xmltree::Element, dst: &mut xmltree::Element, change_type: &str, name: &str, program: Option<&str>) -> Result<()> {
    use xmltree::XMLNode;
    use super::{ctrl, ctrl_mut, find_child, find_child_mut, get_or_make_child, remove_child};

    match change_type {
        "tag" => {
            let src_c = ctrl(src)?;
            let src_scope = if let Some(pname) = program {
                find_child(src_c.get_child("Programs").unwrap_or(src_c), "Program", "Name", pname)
                    .ok_or_else(|| anyhow!("Program not found in source"))?.get_child("Tags")
                    .ok_or_else(|| anyhow!("No Tags in source program"))?
            } else {
                src_c.get_child("Tags").ok_or_else(|| anyhow!("No controller Tags in source"))?
            };
            let tag = find_child(src_scope, "Tag", "Name", name)
                .ok_or_else(|| anyhow!("Tag '{name}' not found"))?.clone();
            let dst_c = ctrl_mut(dst)?;
            let dst_scope = if let Some(pname) = program {
                let progs = get_or_make_child(dst_c, "Programs");
                let p = find_child_mut(progs, "Program", "Name", pname).ok_or_else(|| anyhow!("Program not found in dest"))?;
                get_or_make_child(p, "Tags")
            } else { get_or_make_child(dst_c, "Tags") };
            remove_child(dst_scope, "Tag", "Name", name);
            dst_scope.children.push(XMLNode::Element(tag));
        }
        "routine" => {
            let pname = program.ok_or_else(|| anyhow!("Program required"))?;
            let src_c = ctrl(src)?;
            let src_prog = find_child(src_c.get_child("Programs").unwrap_or(src_c), "Program", "Name", pname).ok_or_else(|| anyhow!("Program not found"))?;
            let rtn = find_child(src_prog.get_child("Routines").unwrap_or(src_prog), "Routine", "Name", name).ok_or_else(|| anyhow!("Routine not found"))?.clone();
            let dst_c = ctrl_mut(dst)?;
            let dst_progs = get_or_make_child(dst_c, "Programs");
            let dst_prog = find_child_mut(dst_progs, "Program", "Name", pname).ok_or_else(|| anyhow!("Program not found in dest"))?;
            let dst_rtns = get_or_make_child(dst_prog, "Routines");
            remove_child(dst_rtns, "Routine", "Name", name);
            dst_rtns.children.push(XMLNode::Element(rtn));
        }
        "aoi" => {
            let src_c = ctrl(src)?;
            let aoi = find_child(src_c.get_child("AddOnInstructionDefinitions").unwrap_or(src_c), "AddOnInstructionDefinition", "Name", name).ok_or_else(|| anyhow!("AOI not found"))?.clone();
            let dst_c = ctrl_mut(dst)?;
            let dst_aois = get_or_make_child(dst_c, "AddOnInstructionDefinitions");
            remove_child(dst_aois, "AddOnInstructionDefinition", "Name", name);
            dst_aois.children.push(XMLNode::Element(aoi));
        }
        "datatype" | "dtype" => {
            let src_c = ctrl(src)?;
            let dt = find_child(src_c.get_child("DataTypes").unwrap_or(src_c), "DataType", "Name", name).ok_or_else(|| anyhow!("DataType not found"))?.clone();
            let dst_c = ctrl_mut(dst)?;
            let dst_dts = get_or_make_child(dst_c, "DataTypes");
            remove_child(dst_dts, "DataType", "Name", name);
            dst_dts.children.push(XMLNode::Element(dt));
        }
        _ => return Err(anyhow!("Unknown change_type '{change_type}'")),
    }
    Ok(())
}
