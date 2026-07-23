//! All read-only L5X query functions.
use xmltree::Element;
use serde_json::{json, Value};
use super::*;

fn ife<'a>(s: &'a str, d: &'a str) -> &'a str { if s.is_empty() { d } else { s } }


// ─── summary ─────────────────────────────────────────────────────────────────

pub fn summarize(root: &Element) -> Result<Value> {
    let c = ctrl(root)?;

    let dtypes  = children_named(c.get_child("DataTypes").unwrap_or(c), "DataType");
    let modules = children_named(c.get_child("Modules").unwrap_or(c), "Module");
    let aois    = children_named(c.get_child("AddOnInstructionDefinitions").unwrap_or(c), "AddOnInstructionDefinition");
    let tags_el = c.get_child("Tags");
    let progs   = children_named(c.get_child("Programs").unwrap_or(c), "Program");
    let trends  = children_named(c.get_child("Trends").unwrap_or(c), "Trend");
    let tasks   = children_named(c.get_child("Tasks").unwrap_or(c), "Task");

    let tag_count = tags_el.map(|t| children_named(t, "Tag").len()).unwrap_or(0);

    let programs_json: Vec<Value> = progs.iter().map(|p| {
        let routines: Vec<Value> = children_named(
            p.get_child("Routines").unwrap_or(p), "Routine"
        ).iter().map(|r| {
            let rung_count = r.get_child("RLLContent")
                .map(|rll| children_named(rll, "Rung").len())
                .unwrap_or(0);
            json!({
                "name":      attr(r, "Name"),
                "type":      ife(attr(r, "Type"), "RLL"),
                "rungCount": rung_count,
            })
        }).collect();
        let ptag_count = p.get_child("Tags")
            .map(|t| children_named(t, "Tag").len()).unwrap_or(0);
        json!({
            "name":            attr(p, "Name"),
            "mainRoutineName": attr(p, "MainRoutineName"),
            "disabled":        ife(attr(p, "Disabled"), "false"),
            "tagCount":        ptag_count,
            "routines":        routines,
        })
    }).collect();

    let dtypes_json: Vec<Value> = dtypes.iter().map(|d| json!({
        "name":        attr(d, "Name"),
        "family":      attr(d, "Family"),
        "class":       attr(d, "Class"),
        "memberCount": d.get_child("Members")
            .map(|m| children_named(m, "Member").len()).unwrap_or(0),
    })).collect();

    let modules_json: Vec<Value> = modules.iter().map(|m| json!({
        "name":         attr(m, "Name"),
        "catalogNumber":attr(m, "CatalogNumber"),
        "vendor":       attr(m, "Vendor"),
        "parentModule": attr(m, "ParentModule"),
        "inhibited":    ife(attr(m, "Inhibited"), "false"),
    })).collect();

    let aois_json: Vec<Value> = aois.iter().map(|a| {
        let params: Vec<Value> = children_named(
            a.get_child("Parameters").unwrap_or(a), "Parameter"
        ).iter()
            .filter(|p| attr(p, "Visible") != "false")
            .map(|p| json!({
                "name":     attr(p, "Name"),
                "dataType": attr(p, "DataType"),
                "usage":    ife(attr(p, "Usage"), "Input"),
            })).collect();
        json!({
            "name":        attr(a, "Name"),
            "revision":    attr(a, "Revision"),
            "description": child_text(a, "Description"),
            "parameters":  params,
        })
    }).collect();

    let tasks_json: Vec<Value> = tasks.iter().map(|t| {
        let scheduled: Vec<Value> = children_named(
            t.get_child("ScheduledPrograms").unwrap_or(t), "ScheduledProgram"
        ).iter().map(|sp| json!(attr(sp, "Name"))).collect();
        json!({
            "name":                 attr(t, "Name"),
            "type":                 ife(attr(t, "Type"), "CONTINUOUS"),
            "rate":                 attr(t, "Rate"),
            "priority":             attr(t, "Priority"),
            "watchdog":             attr(t, "Watchdog"),
            "disableUpdateOutputs": ife(attr(t, "DisableUpdateOutputs"), "false"),
            "inhibitTask":          ife(attr(t, "InhibitTask"), "false"),
            "scheduledPrograms":    scheduled,
        })
    }).collect();

    let trends_json: Vec<Value> = trends.iter().map(|tr| json!({
        "name":         attr(tr, "Name"),
        "samplePeriod": attr(tr, "SamplePeriod"),
        "penCount":     tr.get_child("Pens")
            .map(|p| children_named(p, "Pen").len()).unwrap_or(0),
    })).collect();

    Ok(json!({
        "controller": {
            "name":          attr(c, "Name"),
            "processorType": attr(c, "ProcessorType"),
            "majorRev":      attr(c, "MajorRev"),
            "minorRev":      attr(c, "MinorRev"),
            "projectSN":     attr(c, "ProjectSN"),
            "commPath":      attr(c, "CommPath"),
            "lastModified":  attr(c, "LastModifiedDate"),
        },
        "counts": {
            "tags":      tag_count,
            "dataTypes": dtypes.len(),
            "modules":   modules.len(),
            "aois":      aois.len(),
            "programs":  progs.len(),
            "tasks":     tasks.len(),
        },
        "dataTypes":      dtypes_json,
        "modules":        modules_json,
        "aoiDefinitions": aois_json,
        "programs":       programs_json,
        "tasks":          tasks_json,
        "trends":         trends_json,
    }))
}

// ─── tag helpers ─────────────────────────────────────────────────────────────

fn tag_value(tag_el: &Element) -> (String, Vec<String>, bool) {
    let dims = attr(tag_el, "Dimensions");
    let is_array = !dims.is_empty() && dims != "0";
    if is_array {
        let arr_vals: Vec<String> = tag_el
            .get_child("Data")
            .and_then(|_d| {
                // find Data[@Format='Decorated']
                tag_el.children.iter()
                    .filter_map(|n| n.as_element())
                    .find(|e| e.name == "Data" && attr(e, "Format") == "Decorated")
            })
            .and_then(|d| d.get_child("Array"))
            .map(|arr| children_named(arr, "Element").iter()
                .map(|e| attr(e, "Value").to_string()).collect())
            .unwrap_or_default();
        (String::new(), arr_vals, true)
    } else {
        let val = tag_el.children.iter()
            .filter_map(|n| n.as_element())
            .find(|e| e.name == "Data" && attr(e, "Format") == "Decorated")
            .and_then(|d| d.get_child("DataValue"))
            .map(|dv| attr(dv, "Value").to_string())
            .unwrap_or_else(|| attr(tag_el, "Value").to_string());
        (val, vec![], false)
    }
}

pub fn tag_dict(tag_el: &Element) -> Value {
    let (value, array_values, is_array) = tag_value(tag_el);
    let dims = attr(tag_el, "Dimensions");
    let dim_n: usize = dims.parse().unwrap_or(0);
    let desc = tag_el.get_child("Description")
        .map(|d| get_text(d))
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| attr(tag_el, "Description").to_string());
    json!({
        "name":           attr(tag_el, "Name"),
        "dataType":       attr(tag_el, "DataType"),
        "aliasFor":       attr(tag_el, "AliasFor"),
        "tagType":        ife(attr(tag_el, "TagType"), "Base"),
        "radix":          attr(tag_el, "Radix"),
        "externalAccess": ife(attr(tag_el, "ExternalAccess"), "Read/Write"),
        "constant":       ife(attr(tag_el, "Constant"), "false"),
        "isArray":        is_array,
        "dimensions":     dim_n,
        "value":          value,
        "arrayValues":    array_values,
        "description":    desc,
    })
}

fn tags_scope<'a>(root: &'a Element, program: Option<&str>) -> Option<&'a Element> {
    let c = root.get_child("Controller")?;
    if let Some(prog_name) = program {
        let progs = c.get_child("Programs")?;
        let p = find_child(progs, "Program", "Name", prog_name)?;
        p.get_child("Tags")
    } else {
        c.get_child("Tags")
    }
}

pub fn list_tags(root: &Element, program: Option<&str>, search: &str, offset: usize, limit: usize) -> Value {
    let scope = tags_scope(root, program);
    let all: Vec<&Element> = scope
        .map(|s| children_named(s, "Tag")
            .into_iter()
            .filter(|t| {
                if search.is_empty() { return true; }
                let n = attr(t, "Name").to_lowercase();
                n.contains(&search.to_lowercase())
            })
            .collect())
        .unwrap_or_default();
    let total = all.len();
    let page: Vec<Value> = all.iter().skip(offset).take(limit).map(|t| tag_dict(t)).collect();
    json!({ "total": total, "offset": offset, "limit": limit, "tags": page })
}

pub fn get_tag_detail(root: &Element, program: Option<&str>, name: &str) -> Result<Value> {
    let scope = tags_scope(root, program)
        .ok_or_else(|| anyhow!("Tags scope not found"))?;
    let tag = find_child(scope, "Tag", "Name", name)
        .ok_or_else(|| anyhow!("Tag '{name}' not found"))?;
    Ok(tag_dict(tag))
}

// ─── routine detail ───────────────────────────────────────────────────────────

pub fn get_routine_detail(root: &Element, program: &str, name: &str, rung_offset: usize, rung_limit: usize) -> Result<Value> {
    let c = ctrl(root)?;
    let p = prog(c, program)?;
    let rtns = p.get_child("Routines").ok_or_else(|| anyhow!("No routines in program '{program}'"))?;
    let rtn = find_child(rtns, "Routine", "Name", name)
        .ok_or_else(|| anyhow!("Routine '{name}' not found in '{program}'"))?;
    let r_type = ife(attr(rtn, "Type"), "RLL");
    let mut result = json!({ "name": name, "type": r_type, "program": program });
    if r_type == "RLL" {
        let all_rungs = rtn.get_child("RLLContent")
            .map(|rll| children_named(rll, "Rung"))
            .unwrap_or_default();
        let total = all_rungs.len();
        let page: Vec<Value> = all_rungs.iter().skip(rung_offset).take(rung_limit)
            .map(|r| rung_dict(r)).collect();
        result["totalRungs"] = json!(total);
        result["rungOffset"]  = json!(rung_offset);
        result["rungLimit"]   = json!(rung_limit);
        result["rungs"]       = json!(page);
    } else if r_type == "ST" {
        let lines = rtn.get_child("STContent")
            .map(|s| children_named(s, "Line")
                .iter().map(|l| get_text(l)).collect::<Vec<_>>().join("\n"))
            .unwrap_or_default();
        result["content"] = json!(lines);
    }
    Ok(result)
}

// ─── data type detail ─────────────────────────────────────────────────────────

pub fn get_datatype_detail(root: &Element, name: &str) -> Result<Value> {
    let c = ctrl(root)?;
    let dts = c.get_child("DataTypes").ok_or_else(|| anyhow!("No DataTypes"))?;
    let dt = find_child(dts, "DataType", "Name", name)
        .ok_or_else(|| anyhow!("DataType '{name}' not found"))?;
    let desc = child_text(dt, "Description");
    let members: Vec<Value> = dt.get_child("Members")
        .map(|m| children_named(m, "Member")
            .iter()
            .filter(|m| attr(m, "Hidden") != "true")
            .map(|m| json!({
                "name":      attr(m, "Name"),
                "dataType":  attr(m, "DataType"),
                "dimension": ife(attr(m, "Dimension"), "0"),
                "radix":     attr(m, "Radix"),
                "access":    ife(attr(m, "ExternalAccess"), "Read/Write"),
                "description": child_text(m, "Description"),
            })).collect())
        .unwrap_or_default();
    Ok(json!({ "name": name, "description": desc, "members": members }))
}

// ─── AOI detail ───────────────────────────────────────────────────────────────

pub fn get_aoi_detail(root: &Element, name: &str) -> Result<Value> {
    let c = ctrl(root)?;
    let aois = c.get_child("AddOnInstructionDefinitions")
        .ok_or_else(|| anyhow!("No AOIs"))?;
    let aoi = find_child(aois, "AddOnInstructionDefinition", "Name", name)
        .ok_or_else(|| anyhow!("AOI '{name}' not found"))?;

    let params: Vec<Value> = aoi.get_child("Parameters")
        .map(|ps| children_named(ps, "Parameter").iter().map(|p| {
            let dv = p.get_child("DefaultData")
                .and_then(|dd| dd.get_child("DataValue"))
                .map(|dv| attr(dv, "Value").to_string())
                .unwrap_or_default();
            json!({
                "name":         attr(p, "Name"),
                "dataType":     attr(p, "DataType"),
                "usage":        attr(p, "Usage"),
                "required":     ife(attr(p, "Required"), "false"),
                "visible":      ife(attr(p, "Visible"), "true"),
                "defaultValue": dv,
                "description":  child_text(p, "Description"),
            })
        }).collect()).unwrap_or_default();

    let local_tags: Vec<Value> = aoi.get_child("LocalTags")
        .map(|lt| children_named(lt, "LocalTag").iter().map(|t| {
            let dv = t.get_child("DefaultData")
                .and_then(|dd| dd.get_child("DataValue"))
                .map(|dv| attr(dv, "Value").to_string())
                .unwrap_or_default();
            json!({
                "name":      attr(t, "Name"),
                "dataType":  attr(t, "DataType"),
                "dimension": ife(attr(t, "Dimension"), "0"),
                "value":     dv,
                "description": child_text(t, "Description"),
            })
        }).collect()).unwrap_or_default();

    let routines: Vec<Value> = aoi.get_child("Routines")
        .map(|rs| children_named(rs, "Routine").iter().map(|r| {
            let r_type = ife(attr(r, "Type"), "RLL");
            let mut entry = json!({ "name": attr(r, "Name"), "type": r_type });
            if r_type == "RLL" {
                let rungs: Vec<Value> = r.get_child("RLLContent")
                    .map(|rll| children_named(rll, "Rung").iter().map(|rg| rung_dict(rg)).collect())
                    .unwrap_or_default();
                entry["rungs"] = json!(rungs);
            } else if r_type == "ST" {
                let lines = r.get_child("STContent")
                    .map(|s| children_named(s, "Line")
                        .iter().map(|l| get_text(l)).collect::<Vec<_>>().join("\n"))
                    .unwrap_or_default();
                entry["content"] = json!(lines);
            }
            entry
        }).collect()).unwrap_or_default();

    Ok(json!({
        "name":        name,
        "revision":    attr(aoi, "Revision"),
        "description": child_text(aoi, "Description"),
        "parameters":  params,
        "localTags":   local_tags,
        "routines":    routines,
    }))
}

// ─── trend detail ─────────────────────────────────────────────────────────────

pub fn get_trend_detail(root: &Element, name: &str) -> Result<Value> {
    let c = ctrl(root)?;
    let trends = c.get_child("Trends").ok_or_else(|| anyhow!("No Trends"))?;
    let tr = find_child(trends, "Trend", "Name", name)
        .ok_or_else(|| anyhow!("Trend '{name}' not found"))?;
    let pens: Vec<Value> = tr.get_child("Pens")
        .map(|ps| children_named(ps, "Pen").iter().map(|p| json!({
            "name":    attr(p, "Name"),
            "color":   attr(p, "Color"),
            "visible": ife(attr(p, "Visible"), "true"),
            "type":    ife(attr(p, "Type"), "Analog"),
            "width":   ife(attr(p, "Width"), "1"),
            "marker":  ife(attr(p, "Marker"), "0"),
            "min":     attr(p, "Min"),
            "max":     attr(p, "Max"),
        })).collect()).unwrap_or_default();
    Ok(json!({
        "name":         name,
        "samplePeriod": attr(tr, "SamplePeriod"),
        "captureSize":  attr(tr, "CaptureSize"),
        "pens":         pens,
    }))
}

// ─── cross-reference search ───────────────────────────────────────────────────

pub fn search_xref(root: &Element, q: &str, limit: usize) -> Value {
    let q_lo = q.to_lowercase();
    let mut hits: Vec<Value> = Vec::new();
    let c = match ctrl(root) { Ok(c) => c, Err(_) => return json!([]) };

    // Tags
    if let Some(tags_el) = c.get_child("Tags") {
        for t in children_named(tags_el, "Tag") {
            if hits.len() >= limit { break; }
            if attr(t, "Name").to_lowercase().contains(&q_lo) {
                hits.push(json!({"kind":"tag","scope":"controller","name":attr(t,"Name"),"dataType":attr(t,"DataType")}));
            }
        }
    }

    // Program tags + rung text
    for p in children_named(c.get_child("Programs").unwrap_or(c), "Program") {
        let prog_name = attr(p, "Name");
        if let Some(ptags) = p.get_child("Tags") {
            for t in children_named(ptags, "Tag") {
                if hits.len() >= limit { break; }
                if attr(t, "Name").to_lowercase().contains(&q_lo) {
                    hits.push(json!({"kind":"tag","scope":prog_name,"name":attr(t,"Name"),"dataType":attr(t,"DataType")}));
                }
            }
        }
        if let Some(rtns) = p.get_child("Routines") {
            for r in children_named(rtns, "Routine") {
                let rtn_name = attr(r, "Name");
                if let Some(rll) = r.get_child("RLLContent") {
                    for rung in children_named(rll, "Rung") {
                        if hits.len() >= limit { break; }
                        let text = rung_text(rung);
                        let cmt  = rung_comment(rung);
                        if text.to_lowercase().contains(&q_lo) || cmt.to_lowercase().contains(&q_lo) {
                            let num = attr(rung, "Number").parse::<usize>().unwrap_or(0);
                            hits.push(json!({"kind":"rung","program":prog_name,"routine":rtn_name,"rung":num,"text":text,"comment":cmt}));
                        }
                    }
                }
            }
        }
    }

    json!({ "query": q, "hits": hits, "total": hits.len() })
}

// ─── validate ─────────────────────────────────────────────────────────────────

pub fn validate(root: &Element) -> Value {
    let c = match ctrl(root) { Ok(c) => c, Err(e) => return json!({"ok":false,"errors":[e.to_string()]}) };
    let mut errors: Vec<String> = Vec::new();
    // Check all rungs for unterminated semicolons
    for p in children_named(c.get_child("Programs").unwrap_or(c), "Program") {
        let pn = attr(p, "Name");
        if let Some(rtns) = p.get_child("Routines") {
            for r in children_named(rtns, "Routine") {
                if attr(r, "Type") != "RLL" { continue; }
                let rn = attr(r, "Name");
                if let Some(rll) = r.get_child("RLLContent") {
                    for rung in children_named(rll, "Rung") {
                        let text = rung_text(rung);
                        let num  = attr(rung, "Number");
                        if !text.is_empty() && !text.trim_end().ends_with(';') {
                            errors.push(format!("{pn}/{rn} rung {num}: missing semicolon"));
                        }
                    }
                }
            }
        }
    }
    json!({ "ok": errors.is_empty(), "errors": errors })
}
