//! All L5X mutation functions (add / edit / delete).
use xmltree::{Element, XMLNode};
use anyhow::{anyhow, Result};
use super::*;

const ATOMIC: &[&str] = &["BOOL","SINT","INT","DINT","LINT","REAL","LREAL"];

fn now_str() -> String {
    // Simple timestamp — not using chrono to keep deps minimal
    "Mon Jan 01 00:00:00 2025".to_string()
}

// ─── new project ──────────────────────────────────────────────────────────────

pub fn new_project(name: &str, proc_type: &str, major: &str, minor: &str) -> Result<Element> {
    let xml = format!(r#"<?xml version="1.0" encoding="UTF-8"?>
<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="{major}.{minor:0>2}" TargetName="{name}" TargetType="Controller" ContainsContext="false">
  <Controller Use="Target" Name="{name}" ProcessorType="{proc_type}" MajorRev="{major}" MinorRev="{minor}" TimeSlice="20">
    <DataTypes/>
    <Modules>
      <Module Name="Local" CatalogNumber="{proc_type}" Vendor="1" ProductType="14" ProductCode="0" Major="{major}" Minor="{minor}" ParentModule="Local" ParentModPortId="1" Inhibited="false" MajorFault="true">
        <EKey State="ExactMatch"/>
        <Ports><Port Id="1" Address="0" Type="ICP" Upstream="false"/></Ports>
      </Module>
    </Modules>
    <AddOnInstructionDefinitions/>
    <Tags/>
    <Programs>
      <Program Name="MainProgram" TestEdits="false" MainRoutineName="MainRoutine" Disabled="false" UseAsFolder="false">
        <Tags/>
        <Routines>
          <Routine Name="MainRoutine" Type="RLL">
            <RLLContent>
              <Rung Number="0" Type="N">
                <Text><![CDATA[NOP();]]></Text>
              </Rung>
            </RLLContent>
          </Routine>
        </Routines>
      </Program>
    </Programs>
    <Tasks>
      <Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500" DisableUpdateOutputs="false" InhibitTask="false">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
    <Trends/>
  </Controller>
</RSLogix5000Content>"#, name=name, proc_type=proc_type, major=major, minor=minor);
    parse(xml.as_bytes())
}

// ─── tags ─────────────────────────────────────────────────────────────────────

pub fn add_tag(root: &mut Element, name: &str, data_type: &str, value: &str,
               description: &str, program: Option<&str>, radix: &str,
               external_access: &str, constant: bool, dimensions: usize,
               array_values: &[String]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let scope = if let Some(prog_name) = program {
        let progs = get_or_make_child(c, "Programs");
        let p = find_child_mut(progs, "Program", "Name", prog_name)
            .ok_or_else(|| anyhow!("Program '{prog_name}' not found"))?;
        get_or_make_child(p, "Tags")
    } else {
        get_or_make_child(c, "Tags")
    };

    if find_child(scope, "Tag", "Name", name).is_some() {
        return Err(anyhow!("Tag '{name}' already exists"));
    }

    let mut tag = make_el("Tag", &[
        ("Name", name), ("DataType", data_type),
        ("TagType", "Base"), ("Radix", if radix.is_empty() { "Decimal" } else { radix }),
        ("ExternalAccess", if external_access.is_empty() { "Read/Write" } else { external_access }),
        ("Constant", if constant { "true" } else { "false" }),
    ]);
    if dimensions > 0 {
        tag.attributes.insert("Dimensions".into(), dimensions.to_string());
    }
    if !description.is_empty() {
        tag.children.push(XMLNode::Element(make_cdata_el("Description", description)));
    }
    if dimensions > 0 && !array_values.is_empty() {
        let mut data_el = make_el("Data", &[("Format", "Decorated")]);
        let mut arr = make_el("Array", &[("DataType", data_type), ("Dimensions", &dimensions.to_string())]);
        for (i, v) in array_values.iter().enumerate() {
            arr.children.push(XMLNode::Element(make_el("Element", &[("Index", &format!("[{i}]")), ("Value", v)])));
        }
        data_el.children.push(XMLNode::Element(arr));
        tag.children.push(XMLNode::Element(data_el));
    } else if dimensions == 0 && !value.is_empty() {
        let mut data_el = make_el("Data", &[("Format", "Decorated")]);
        data_el.children.push(XMLNode::Element(make_el("DataValue", &[("DataType", data_type), ("Radix", if radix.is_empty() { "Decimal" } else { radix }), ("Value", value)])));
        tag.children.push(XMLNode::Element(data_el));
    }
    scope.children.push(XMLNode::Element(tag));
    Ok(())
}

pub fn edit_tag(root: &mut Element, old_name: &str, name: &str, data_type: &str,
                value: &str, description: &str, program: Option<&str>,
                radix: &str, external_access: &str, constant: bool,
                dimensions: usize, array_values: &[String]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let scope = if let Some(prog_name) = program {
        let progs = get_or_make_child(c, "Programs");
        let p = find_child_mut(progs, "Program", "Name", prog_name)
            .ok_or_else(|| anyhow!("Program '{prog_name}' not found"))?;
        get_or_make_child(p, "Tags")
    } else {
        get_or_make_child(c, "Tags")
    };
    let tag = find_child_mut(scope, "Tag", "Name", old_name)
        .ok_or_else(|| anyhow!("Tag '{old_name}' not found"))?;
    tag.attributes.insert("Name".into(), name.into());
    tag.attributes.insert("DataType".into(), data_type.into());
    if !radix.is_empty() { tag.attributes.insert("Radix".into(), radix.into()); }
    if !external_access.is_empty() { tag.attributes.insert("ExternalAccess".into(), external_access.into()); }
    tag.attributes.insert("Constant".into(), if constant { "true".into() } else { "false".into() });
    // Update description child
    if let Some(pos) = tag.children.iter().position(|n| n.as_element().map(|e| e.name == "Description").unwrap_or(false)) {
        tag.children.remove(pos);
    }
    if !description.is_empty() {
        tag.children.insert(0, XMLNode::Element(make_cdata_el("Description", description)));
    }
    // Update Data/DataValue if value provided
    if let Some(pos) = tag.children.iter().position(|n| n.as_element().map(|e| e.name == "Data").unwrap_or(false)) {
        tag.children.remove(pos);
    }
    if dimensions == 0 && !value.is_empty() {
        let mut data_el = make_el("Data", &[("Format", "Decorated")]);
        data_el.children.push(XMLNode::Element(make_el("DataValue", &[("DataType", data_type), ("Radix", if radix.is_empty() { "Decimal" } else { radix }), ("Value", value)])));
        tag.children.push(XMLNode::Element(data_el));
    }
    Ok(())
}

pub fn delete_tag(root: &mut Element, name: &str, program: Option<&str>) -> Result<()> {
    let c = ctrl_mut(root)?;
    let scope = if let Some(prog_name) = program {
        let progs = get_or_make_child(c, "Programs");
        let p = find_child_mut(progs, "Program", "Name", prog_name)
            .ok_or_else(|| anyhow!("Program '{prog_name}' not found"))?;
        get_or_make_child(p, "Tags")
    } else {
        get_or_make_child(c, "Tags")
    };
    if !remove_child(scope, "Tag", "Name", name) {
        return Err(anyhow!("Tag '{name}' not found"));
    }
    Ok(())
}

// ─── programs ─────────────────────────────────────────────────────────────────

pub fn add_program(root: &mut Element, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let progs = get_or_make_child(c, "Programs");
    if find_child(progs, "Program", "Name", name).is_some() {
        return Err(anyhow!("Program '{name}' already exists"));
    }
    let mut p = make_el("Program", &[("Name", name), ("TestEdits", "false"),
        ("MainRoutineName", "MainRoutine"), ("Disabled", "false"), ("UseAsFolder", "false")]);
    p.children.push(XMLNode::Element(Element::new("Tags")));
    let mut rtns = Element::new("Routines");
    let mut rtn = make_el("Routine", &[("Name", "MainRoutine"), ("Type", "RLL")]);
    let mut rll = Element::new("RLLContent");
    let mut rung = make_el("Rung", &[("Number", "0"), ("Type", "N")]);
    rung.children.push(XMLNode::Element(make_cdata_el("Text", "NOP();")));
    rll.children.push(XMLNode::Element(rung));
    rtn.children.push(XMLNode::Element(rll));
    rtns.children.push(XMLNode::Element(rtn));
    p.children.push(XMLNode::Element(rtns));
    progs.children.push(XMLNode::Element(p));
    Ok(())
}

pub fn delete_program(root: &mut Element, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let progs = get_or_make_child(c, "Programs");
    if !remove_child(progs, "Program", "Name", name) {
        return Err(anyhow!("Program '{name}' not found"));
    }
    Ok(())
}

// ─── routines ─────────────────────────────────────────────────────────────────

pub fn add_routine(root: &mut Element, program: &str, name: &str, rtype: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let p = prog_mut(c, program)?;
    let rtns = get_or_make_child(p, "Routines");
    if find_child(rtns, "Routine", "Name", name).is_some() {
        return Err(anyhow!("Routine '{name}' already exists in '{program}'"));
    }
    let mut rtn = make_el("Routine", &[("Name", name), ("Type", rtype)]);
    if rtype == "RLL" {
        let mut rll = Element::new("RLLContent");
        let mut rung = make_el("Rung", &[("Number", "0"), ("Type", "N")]);
        rung.children.push(XMLNode::Element(make_cdata_el("Text", "NOP();")));
        rll.children.push(XMLNode::Element(rung));
        rtn.children.push(XMLNode::Element(rll));
    } else {
        let mut st = Element::new("STContent");
        let line = make_el("Line", &[("Number", "0")]);
        st.children.push(XMLNode::Element(line));
        rtn.children.push(XMLNode::Element(st));
    }
    rtns.children.push(XMLNode::Element(rtn));
    Ok(())
}

pub fn delete_routine(root: &mut Element, program: &str, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let p = prog_mut(c, program)?;
    let rtns = get_or_make_child(p, "Routines");
    if !remove_child(rtns, "Routine", "Name", name) {
        return Err(anyhow!("Routine '{name}' not found"));
    }
    Ok(())
}

pub fn edit_st_routine(root: &mut Element, program: &str, name: &str, content: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let p = prog_mut(c, program)?;
    let rtns = get_or_make_child(p, "Routines");
    let rtn = find_child_mut(rtns, "Routine", "Name", name)
        .ok_or_else(|| anyhow!("Routine '{name}' not found"))?;
    let st = get_or_make_child(rtn, "STContent");
    st.children.clear();
    for (i, line) in content.lines().enumerate() {
        let mut l = make_el("Line", &[("Number", &i.to_string())]);
        l.children.push(XMLNode::CData(line.to_string()));
        st.children.push(XMLNode::Element(l));
    }
    Ok(())
}

// ─── rungs ────────────────────────────────────────────────────────────────────

fn get_rll_mut<'a>(root: &'a mut Element, program: &str, routine: &str) -> Result<&'a mut Element> {
    let c = ctrl_mut(root)?;
    let p = prog_mut(c, program)?;
    let rtns = get_or_make_child(p, "Routines");
    let rtn = find_child_mut(rtns, "Routine", "Name", routine)
        .ok_or_else(|| anyhow!("Routine '{routine}' not found"))?;
    Ok(get_or_make_child(rtn, "RLLContent"))
}

fn make_rung(num: usize, text: &str, comment: &str) -> Element {
    let mut rung = make_el("Rung", &[("Number", &num.to_string()), ("Type", "N")]);
    if !comment.is_empty() {
        let mut cmt = Element::new("Comment");
        let mut lc = make_el("LocalizedComment", &[("Lang", "en-US")]);
        lc.children.push(XMLNode::CData(comment.to_string()));
        cmt.children.push(XMLNode::Element(lc));
        rung.children.push(XMLNode::Element(cmt));
    }
    rung.children.push(XMLNode::Element(make_cdata_el("Text", text)));
    rung
}

pub fn add_rung(root: &mut Element, program: &str, routine: &str,
                text: &str, comment: &str, index: Option<usize>) -> Result<()> {
    let rll = get_rll_mut(root, program, routine)?;
    let count = children_named(rll, "Rung").len();
    let insert_at = index.unwrap_or(count);
    let insert_at = insert_at.min(count);

    // Renumber existing rungs at or after insert_at
    let mut el_indices: Vec<usize> = Vec::new();
    for (i, n) in rll.children.iter().enumerate() {
        if n.as_element().map(|e| e.name == "Rung").unwrap_or(false) {
            el_indices.push(i);
        }
    }
    for (rung_idx, child_idx) in el_indices.iter().enumerate() {
        if rung_idx >= insert_at {
            if let Some(XMLNode::Element(ref mut e)) = rll.children.get_mut(*child_idx) {
                e.attributes.insert("Number".into(), (rung_idx + 1).to_string());
            }
        }
    }

    let new_rung = make_rung(insert_at, text, comment);
    if insert_at < el_indices.len() {
        let child_pos = el_indices[insert_at];
        rll.children.insert(child_pos, XMLNode::Element(new_rung));
    } else {
        rll.children.push(XMLNode::Element(new_rung));
    }
    Ok(())
}

pub fn edit_rung(root: &mut Element, program: &str, routine: &str,
                 number: usize, text: &str, comment: &str) -> Result<()> {
    let rll = get_rll_mut(root, program, routine)?;
    let rung = rll.children.iter_mut()
        .filter_map(|n| n.as_mut_element())
        .find(|e| e.name == "Rung" && attr(e, "Number").parse::<usize>().ok() == Some(number))
        .ok_or_else(|| anyhow!("Rung {number} not found"))?;

    // Remove old Text/Comment children
    rung.children.retain(|n| {
        n.as_element().map(|e| e.name != "Text" && e.name != "Comment").unwrap_or(true)
    });
    if !comment.is_empty() {
        let mut cmt = Element::new("Comment");
        let mut lc = make_el("LocalizedComment", &[("Lang", "en-US")]);
        lc.children.push(XMLNode::CData(comment.to_string()));
        cmt.children.push(XMLNode::Element(lc));
        rung.children.push(XMLNode::Element(cmt));
    }
    rung.children.push(XMLNode::Element(make_cdata_el("Text", text)));
    Ok(())
}

pub fn delete_rung(root: &mut Element, program: &str, routine: &str, number: usize) -> Result<()> {
    let rll = get_rll_mut(root, program, routine)?;
    let pos = rll.children.iter().position(|n| {
        n.as_element().map(|e| e.name == "Rung" && attr(e, "Number").parse::<usize>().ok() == Some(number)).unwrap_or(false)
    }).ok_or_else(|| anyhow!("Rung {number} not found"))?;
    rll.children.remove(pos);
    // Renumber remaining
    let mut n = 0usize;
    for child in rll.children.iter_mut() {
        if let Some(e) = child.as_mut_element() {
            if e.name == "Rung" {
                e.attributes.insert("Number".into(), n.to_string());
                n += 1;
            }
        }
    }
    Ok(())
}

pub fn move_rung(root: &mut Element, program: &str, routine: &str, from: usize, to: usize) -> Result<()> {
    if from == to { return Ok(()); }
    let rll = get_rll_mut(root, program, routine)?;
    let rung_indices: Vec<usize> = rll.children.iter().enumerate()
        .filter_map(|(i, n)| if n.as_element().map(|e| e.name == "Rung").unwrap_or(false) { Some(i) } else { None })
        .collect();
    let max_n = rung_indices.len();
    if from >= max_n || to >= max_n { return Err(anyhow!("Rung index out of range")); }
    let from_child = rung_indices[from];
    let node = rll.children.remove(from_child);
    let to_child = if to > from {
        rung_indices[to] - 1
    } else {
        rung_indices[to]
    };
    rll.children.insert(to_child, node);
    // Renumber all rungs
    let mut n = 0usize;
    for child in rll.children.iter_mut() {
        if let Some(e) = child.as_mut_element() {
            if e.name == "Rung" {
                e.attributes.insert("Number".into(), n.to_string());
                n += 1;
            }
        }
    }
    Ok(())
}

// ─── data types ───────────────────────────────────────────────────────────────

fn build_dtype_members(dt: &mut Element, description: &str, members: &[serde_json::Value]) -> Result<()> {
    // Remove old Description + Members
    dt.children.retain(|n| n.as_element().map(|e| e.name != "Description" && e.name != "Members").unwrap_or(true));
    if !description.is_empty() {
        dt.children.insert(0, XMLNode::Element(make_cdata_el("Description", description)));
    }
    let mut mem_el = Element::new("Members");
    for m in members {
        let m_name = m["name"].as_str().unwrap_or("");
        let m_dt   = m["dataType"].as_str().unwrap_or("");
        let m_dim  = m["dimension"].as_str().unwrap_or("0");
        let m_rad  = m["radix"].as_str().unwrap_or("Decimal");
        let m_acc  = m["access"].as_str().unwrap_or("Read/Write");
        let m_desc = m["description"].as_str().unwrap_or("");
        let mut me = make_el("Member", &[("Name", m_name), ("DataType", m_dt),
            ("Dimension", m_dim), ("Hidden", "false"), ("ExternalAccess", m_acc)]);
        if ATOMIC.contains(&m_dt) { me.attributes.insert("Radix".into(), m_rad.into()); }
        if !m_desc.is_empty() { me.children.push(XMLNode::Element(make_cdata_el("Description", m_desc))); }
        mem_el.children.push(XMLNode::Element(me));
    }
    dt.children.push(XMLNode::Element(mem_el));
    Ok(())
}

pub fn add_data_type(root: &mut Element, name: &str, description: &str, members: &[serde_json::Value]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let dts = get_or_make_child(c, "DataTypes");
    if find_child(dts, "DataType", "Name", name).is_some() {
        return Err(anyhow!("DataType '{name}' already exists"));
    }
    if members.is_empty() { return Err(anyhow!("A data type needs at least one member")); }
    let mut dt = make_el("DataType", &[("Name", name), ("Family", "NoFamily"), ("Class", "User")]);
    build_dtype_members(&mut dt, description, members)?;
    dts.children.push(XMLNode::Element(dt));
    Ok(())
}

pub fn update_data_type(root: &mut Element, name: &str, description: &str, members: &[serde_json::Value]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let dts = get_or_make_child(c, "DataTypes");
    let dt = find_child_mut(dts, "DataType", "Name", name)
        .ok_or_else(|| anyhow!("DataType '{name}' not found"))?;
    if members.is_empty() { return Err(anyhow!("A data type needs at least one member")); }
    build_dtype_members(dt, description, members)
}

// ─── AOIs ─────────────────────────────────────────────────────────────────────

pub fn add_aoi(root: &mut Element, name: &str, description: &str, params: &[serde_json::Value]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let aois = get_or_make_child(c, "AddOnInstructionDefinitions");
    if find_child(aois, "AddOnInstructionDefinition", "Name", name).is_some() {
        return Err(anyhow!("AOI '{name}' already exists"));
    }
    let mut aoi = make_el("AddOnInstructionDefinition", &[("Name", name), ("Revision", "1.0"),
        ("Vendor", ""), ("ExecutionControl", "Immediate"), ("ExecutionPeriod", "1"), ("ExecutionCount", "1")]);
    if !description.is_empty() { aoi.children.push(XMLNode::Element(make_cdata_el("Description", description))); }
    let mut ps = Element::new("Parameters");
    for p in params {
        let p_name = p["name"].as_str().unwrap_or("");
        let p_dt   = p["dataType"].as_str().unwrap_or("BOOL");
        let p_use  = p["usage"].as_str().unwrap_or("Input");
        let p_req  = if p["required"].as_bool().unwrap_or(false) { "true" } else { "false" };
        let p_desc = p["description"].as_str().unwrap_or("");
        let mut param = make_el("Parameter", &[("Name", p_name), ("TagType", "Base"),
            ("DataType", p_dt), ("Usage", p_use), ("Required", p_req), ("Visible", "true")]);
        if !p_desc.is_empty() { param.children.push(XMLNode::Element(make_cdata_el("Description", p_desc))); }
        ps.children.push(XMLNode::Element(param));
    }
    aoi.children.push(XMLNode::Element(ps));
    aoi.children.push(XMLNode::Element(Element::new("LocalTags")));
    let mut rtns = Element::new("Routines");
    let mut logic_rtn = make_el("Routine", &[("Name", "Logic"), ("Type", "RLL")]);
    let mut rll = Element::new("RLLContent");
    let mut rung = make_el("Rung", &[("Number", "0"), ("Type", "N")]);
    rung.children.push(XMLNode::Element(make_cdata_el("Text", "NOP();")));
    rll.children.push(XMLNode::Element(rung));
    logic_rtn.children.push(XMLNode::Element(rll));
    rtns.children.push(XMLNode::Element(logic_rtn));
    aoi.children.push(XMLNode::Element(rtns));
    aois.children.push(XMLNode::Element(aoi));
    Ok(())
}

pub fn update_aoi(root: &mut Element, name: &str, description: &str, params: &[serde_json::Value]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let aois = get_or_make_child(c, "AddOnInstructionDefinitions");
    let aoi = find_child_mut(aois, "AddOnInstructionDefinition", "Name", name)
        .ok_or_else(|| anyhow!("AOI '{name}' not found"))?;
    // Update description
    aoi.children.retain(|n| n.as_element().map(|e| e.name != "Description" && e.name != "Parameters").unwrap_or(true));
    if !description.is_empty() { aoi.children.insert(0, XMLNode::Element(make_cdata_el("Description", description))); }
    let mut ps = Element::new("Parameters");
    for p in params {
        let p_name = p["name"].as_str().unwrap_or("");
        let p_dt   = p["dataType"].as_str().unwrap_or("BOOL");
        let p_use  = p["usage"].as_str().unwrap_or("Input");
        let p_req  = if p["required"].as_bool().unwrap_or(false) { "true" } else { "false" };
        let p_desc = p["description"].as_str().unwrap_or("");
        let mut param = make_el("Parameter", &[("Name", p_name), ("TagType", "Base"),
            ("DataType", p_dt), ("Usage", p_use), ("Required", p_req), ("Visible", "true")]);
        if !p_desc.is_empty() { param.children.push(XMLNode::Element(make_cdata_el("Description", p_desc))); }
        ps.children.push(XMLNode::Element(param));
    }
    aoi.children.insert(if description.is_empty() { 0 } else { 1 }, XMLNode::Element(ps));
    Ok(())
}

pub fn delete_aoi(root: &mut Element, name: &str, force: bool) -> Result<Vec<String>> {
    // Find usages in rung text
    let c_ref = ctrl(root)?;
    let mut usages: Vec<String> = Vec::new();
    for p in children_named(c_ref.get_child("Programs").unwrap_or(c_ref), "Program") {
        let pn = attr(p, "Name");
        if let Some(rtns) = p.get_child("Routines") {
            for r in children_named(rtns, "Routine") {
                let rn = attr(r, "Name");
                if let Some(rll) = r.get_child("RLLContent") {
                    for rung in children_named(rll, "Rung") {
                        if rung_text(rung).contains(name) {
                            usages.push(format!("{pn}/{rn} rung {}", attr(rung, "Number")));
                        }
                    }
                }
            }
        }
    }
    if !usages.is_empty() && !force { return Ok(usages); }
    let c = ctrl_mut(root)?;
    let aois = get_or_make_child(c, "AddOnInstructionDefinitions");
    remove_child(aois, "AddOnInstructionDefinition", "Name", name);
    Ok(vec![])
}

// AOI rung helpers
fn get_aoi_rll_mut<'a>(root: &'a mut Element, aoi_name: &str, routine: &str) -> Result<&'a mut Element> {
    let c = ctrl_mut(root)?;
    let aois = get_or_make_child(c, "AddOnInstructionDefinitions");
    let aoi = find_child_mut(aois, "AddOnInstructionDefinition", "Name", aoi_name)
        .ok_or_else(|| anyhow!("AOI '{aoi_name}' not found"))?;
    let rtns = get_or_make_child(aoi, "Routines");
    let rtn = find_child_mut(rtns, "Routine", "Name", routine)
        .ok_or_else(|| anyhow!("Routine '{routine}' not found in AOI"))?;
    Ok(get_or_make_child(rtn, "RLLContent"))
}

pub fn add_aoi_rung(root: &mut Element, aoi: &str, routine: &str, text: &str, comment: &str, index: Option<usize>) -> Result<()> {
    let rll = get_aoi_rll_mut(root, aoi, routine)?;
    let count = children_named(rll, "Rung").len();
    let pos = index.unwrap_or(count).min(count);
    let new_rung = make_rung(pos, text, comment);
    // Renumber after pos
    for child in rll.children.iter_mut() {
        if let Some(e) = child.as_mut_element() {
            if e.name == "Rung" {
                if let Ok(n) = attr(e, "Number").parse::<usize>() {
                    if n >= pos { e.attributes.insert("Number".into(), (n+1).to_string()); }
                }
            }
        }
    }
    let rung_positions: Vec<usize> = rll.children.iter().enumerate()
        .filter_map(|(i, n)| if n.as_element().map(|e| e.name == "Rung").unwrap_or(false) { Some(i) } else { None })
        .collect();
    if pos < rung_positions.len() {
        rll.children.insert(rung_positions[pos], XMLNode::Element(new_rung));
    } else {
        rll.children.push(XMLNode::Element(new_rung));
    }
    Ok(())
}

pub fn edit_aoi_rung(root: &mut Element, aoi: &str, routine: &str, number: usize, text: &str, comment: &str) -> Result<()> {
    let rll = get_aoi_rll_mut(root, aoi, routine)?;
    let rung = rll.children.iter_mut()
        .filter_map(|n| n.as_mut_element())
        .find(|e| e.name == "Rung" && attr(e, "Number").parse::<usize>().ok() == Some(number))
        .ok_or_else(|| anyhow!("AOI rung {number} not found"))?;
    rung.children.retain(|n| n.as_element().map(|e| e.name != "Text" && e.name != "Comment").unwrap_or(true));
    if !comment.is_empty() {
        let mut cmt = Element::new("Comment");
        let mut lc = make_el("LocalizedComment", &[("Lang", "en-US")]);
        lc.children.push(XMLNode::CData(comment.to_string()));
        cmt.children.push(XMLNode::Element(lc));
        rung.children.push(XMLNode::Element(cmt));
    }
    rung.children.push(XMLNode::Element(make_cdata_el("Text", text)));
    Ok(())
}

pub fn delete_aoi_rung(root: &mut Element, aoi: &str, routine: &str, number: usize) -> Result<()> {
    let rll = get_aoi_rll_mut(root, aoi, routine)?;
    let pos = rll.children.iter().position(|n| {
        n.as_element().map(|e| e.name == "Rung" && attr(e, "Number").parse::<usize>().ok() == Some(number)).unwrap_or(false)
    }).ok_or_else(|| anyhow!("AOI rung {number} not found"))?;
    rll.children.remove(pos);
    let mut n = 0usize;
    for child in rll.children.iter_mut() {
        if let Some(e) = child.as_mut_element() {
            if e.name == "Rung" { e.attributes.insert("Number".into(), n.to_string()); n += 1; }
        }
    }
    Ok(())
}

// ─── modules ──────────────────────────────────────────────────────────────────

pub fn add_module(root: &mut Element, name: &str, catalog: &str, vendor: &str, parent: &str, inhibited: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let mods = get_or_make_child(c, "Modules");
    if find_child(mods, "Module", "Name", name).is_some() {
        return Err(anyhow!("Module '{name}' already exists"));
    }
    let m = make_el("Module", &[("Name", name), ("CatalogNumber", catalog),
        ("Vendor", vendor), ("ProductType", "0"), ("ProductCode", "0"),
        ("Major", "1"), ("Minor", "1"), ("ParentModule", parent),
        ("ParentModPortId", "1"), ("Inhibited", inhibited), ("MajorFault", "false")]);
    mods.children.push(XMLNode::Element(m));
    Ok(())
}

pub fn edit_module(root: &mut Element, old_name: &str, name: &str, catalog: &str, vendor: &str, parent: &str, inhibited: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let mods = get_or_make_child(c, "Modules");
    let m = find_child_mut(mods, "Module", "Name", old_name)
        .ok_or_else(|| anyhow!("Module '{old_name}' not found"))?;
    m.attributes.insert("Name".into(), name.into());
    m.attributes.insert("CatalogNumber".into(), catalog.into());
    m.attributes.insert("Vendor".into(), vendor.into());
    m.attributes.insert("ParentModule".into(), parent.into());
    m.attributes.insert("Inhibited".into(), inhibited.into());
    Ok(())
}

pub fn delete_module(root: &mut Element, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let mods = get_or_make_child(c, "Modules");
    remove_child(mods, "Module", "Name", name);
    Ok(())
}

// ─── tasks ────────────────────────────────────────────────────────────────────

pub fn add_task(root: &mut Element, name: &str, task_type: &str, rate: f64, priority: i32, watchdog: f64) -> Result<()> {
    let c = ctrl_mut(root)?;
    let tasks = get_or_make_child(c, "Tasks");
    if find_child(tasks, "Task", "Name", name).is_some() {
        return Err(anyhow!("Task '{name}' already exists"));
    }
    let t = make_el("Task", &[("Name", name), ("Type", task_type),
        ("Rate", &rate.to_string()), ("Priority", &priority.to_string()),
        ("Watchdog", &watchdog.to_string()), ("DisableUpdateOutputs", "false"), ("InhibitTask", "false")]);
    tasks.children.push(XMLNode::Element(t));
    Ok(())
}

pub fn delete_task(root: &mut Element, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let tasks = get_or_make_child(c, "Tasks");
    remove_child(tasks, "Task", "Name", name);
    Ok(())
}

// ─── trends ───────────────────────────────────────────────────────────────────

pub fn get_trend_detail_w(root: &Element, name: &str) -> Result<serde_json::Value> {
    super::read::get_trend_detail(root, name)
}

pub fn update_trend_meta(root: &mut Element, name: &str, sample_period: &str, capture_size: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let trends = get_or_make_child(c, "Trends");
    let tr = find_child_mut(trends, "Trend", "Name", name)
        .ok_or_else(|| anyhow!("Trend '{name}' not found"))?;
    if !sample_period.is_empty() { tr.attributes.insert("SamplePeriod".into(), sample_period.into()); }
    if !capture_size.is_empty()  { tr.attributes.insert("CaptureSize".into(), capture_size.into()); }
    Ok(())
}

pub fn set_trend_pens(root: &mut Element, name: &str, pens: &[serde_json::Value]) -> Result<()> {
    let c = ctrl_mut(root)?;
    let trends = get_or_make_child(c, "Trends");
    let tr = find_child_mut(trends, "Trend", "Name", name)
        .ok_or_else(|| anyhow!("Trend '{name}' not found"))?;
    tr.children.retain(|n| n.as_element().map(|e| e.name != "Pens").unwrap_or(true));
    let mut ps = Element::new("Pens");
    for p in pens {
        let pen = make_el("Pen", &[
            ("Name",    p["name"].as_str().unwrap_or("")),
            ("Color",   p["color"].as_str().unwrap_or("")),
            ("Visible", if p["visible"].as_bool().unwrap_or(true) { "true" } else { "false" }),
            ("Type",    p["type"].as_str().unwrap_or("Analog")),
            ("Width",   p["width"].as_str().unwrap_or("1")),
            ("Marker",  p["marker"].as_str().unwrap_or("0")),
            ("Min",     p["min"].as_str().unwrap_or("")),
            ("Max",     p["max"].as_str().unwrap_or("")),
        ]);
        ps.children.push(XMLNode::Element(pen));
    }
    tr.children.push(XMLNode::Element(ps));
    Ok(())
}

pub fn delete_trend(root: &mut Element, name: &str) -> Result<()> {
    let c = ctrl_mut(root)?;
    let trends = get_or_make_child(c, "Trends");
    remove_child(trends, "Trend", "Name", name);
    Ok(())
}

pub fn duplicate_trend(root: &mut Element, src_name: &str, new_name: &str) -> Result<()> {
    let c_ref = ctrl(root)?;
    let trends_ref = c_ref.get_child("Trends").ok_or_else(|| anyhow!("No Trends"))?;
    let src = find_child(trends_ref, "Trend", "Name", src_name)
        .ok_or_else(|| anyhow!("Trend '{src_name}' not found"))?;
    let mut dup = src.clone();
    dup.attributes.insert("Name".into(), new_name.into());
    let c = ctrl_mut(root)?;
    let trends = get_or_make_child(c, "Trends");
    trends.children.push(XMLNode::Element(dup));
    Ok(())
}
