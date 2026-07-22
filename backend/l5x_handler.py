"""
l5x_handler.py — Core engine for Studio 5000 .L5X files.

Architecture change: all public functions now operate on an lxml
_Element root (mutating it in-place where needed) rather than round-
tripping through XML strings on every call. The calling layer (main.py)
keeps one parsed document in memory for the lifetime of the session and
only serialises it to a string on /api/download. This makes even 14 MB
files with 4000+ tags feel instant on every interaction.
"""
from __future__ import annotations
import re
import difflib
from lxml import etree
from datetime import datetime
from typing import Optional, List

ATOMIC_TYPES = {"BOOL", "SINT", "INT", "DINT", "LINT", "REAL"}

# ── helpers ──────────────────────────────────────────────────────────────────

def _now() -> str:
    return datetime.now().strftime("%a %b %d %H:%M:%S %Y")

def parse_xml(xml_bytes_or_str) -> etree._ElementTree:
    if isinstance(xml_bytes_or_str, str):
        data = xml_bytes_or_str.encode("utf-8")
    else:
        data = xml_bytes_or_str
    # Strip BOM if present
    if data[:3] == b"\xef\xbb\xbf":
        data = data[3:]
    parser = etree.XMLParser(remove_blank_text=True, resolve_entities=False, recover=True)
    root = etree.fromstring(data, parser)
    return etree.ElementTree(root)

def to_xml_string(root: etree._Element) -> str:
    etree.indent(etree.ElementTree(root), space="  ")
    return etree.tostring(
        root, xml_declaration=True, encoding="UTF-8",
        standalone=True, pretty_print=True,
    ).decode("utf-8")

def _ctrl(root: etree._Element) -> etree._Element:
    c = root.find("Controller")
    if c is None:
        raise ValueError("No <Controller> element found in document")
    return c

def _get_or_make(parent: etree._Element, tag: str) -> etree._Element:
    el = parent.find(tag)
    if el is None:
        el = etree.SubElement(parent, tag)
    return el

def _prog(ctrl: etree._Element, name: str) -> etree._Element:
    p = ctrl.find(f"./Programs/Program[@Name='{name}']")
    if p is None:
        raise ValueError(f"Program '{name}' not found")
    return p

def _tags_el(root: etree._Element, program: Optional[str]) -> etree._Element:
    ctrl = _ctrl(root)
    if program:
        return _get_or_make(_prog(ctrl, program), "Tags")
    return _get_or_make(ctrl, "Tags")

# ── project creation ──────────────────────────────────────────────────────────

def new_project(controller_name: str, processor_type: str = "1756-L83E",
                major_rev: str = "32", minor_rev: str = "11") -> etree._Element:
    now = _now()
    xml_str = f'''<RSLogix5000Content SchemaRevision="1.0" SoftwareRevision="{major_rev}.{minor_rev.zfill(2)}"
  TargetName="{controller_name}" TargetType="Controller" ContainsContext="false"
  ExportDate="{now}" ExportOptions="References NoRawData L5KData DecoratedData Context Dependencies ForceProtectedEncoding AllProjDocTrans">
  <Controller Use="Target" Name="{controller_name}" ProcessorType="{processor_type}"
    MajorRev="{major_rev}" MinorRev="{minor_rev}" TimeSlice="20" ShareUnusedTimeSlice="1"
    ProjectCreationDate="{now}" LastModifiedDate="{now}"
    SFCExecutionControl="CurrentActive" SFCRestartPosition="MostRecent" SFCLastScan="DontScan"
    ProjectSN="16#0000_0000" MatchProjectToController="false" CanUseRPIFromProducer="false"
    InhibitAutomaticFirmwareUpdate="0">
    <RedundancyInfo Enabled="false" KeepTestEditsOnSwitchOver="false" IOMemoryPadPercentage="90" DataTablePadPercentage="50"/>
    <Security Code="0" ChangesToDetect="16#ffff_ffff_ffff_ffff"/>
    <SafetyInfo/>
    <DataTypes/>
    <Modules>
      <Module Name="Local" CatalogNumber="{processor_type}" Vendor="1" ProductType="14"
        ProductCode="0" Major="{major_rev}" Minor="{minor_rev}" ParentModule="Local"
        ParentModPortId="1" Inhibited="false" MajorFault="true">
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
      <Task Name="MainTask" Type="CONTINUOUS" Priority="10" Watchdog="500"
        DisableUpdateOutputs="false" InhibitTask="false">
        <ScheduledPrograms><ScheduledProgram Name="MainProgram"/></ScheduledPrograms>
      </Task>
    </Tasks>
    <CST/>
    <WallClockTime LocalTimeAdjustment="0" TimeZone="0"/>
    <Trends/>
  </Controller>
</RSLogix5000Content>'''
    parser = etree.XMLParser(remove_blank_text=True)
    return etree.fromstring(xml_str.encode(), parser)

# ── summary (lightweight — used for sidebar navigation) ──────────────────────

def summarize(root: etree._Element) -> dict:
    ctrl = _ctrl(root)
    dtypes  = ctrl.findall("./DataTypes/DataType")
    modules = ctrl.findall("./Modules/Module")
    aois    = ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition")
    tags    = ctrl.findall("./Tags/Tag")
    progs   = ctrl.findall("./Programs/Program")
    trends  = ctrl.findall("./Trends/Trend")
    tasks   = ctrl.findall("./Tasks/Task")

    return {
        "controller": {
            "name":          ctrl.get("Name"),
            "processorType": ctrl.get("ProcessorType"),
            "majorRev":      ctrl.get("MajorRev"),
            "minorRev":      ctrl.get("MinorRev"),
            "projectSN":     ctrl.get("ProjectSN"),
            "commPath":      ctrl.get("CommPath", ""),
            "lastModified":  ctrl.get("LastModifiedDate", ""),
        },
        "counts": {
            "tags":      len(tags),
            "dataTypes": len(dtypes),
            "modules":   len(modules),
            "aois":      len(aois),
            "programs":  len(progs),
            "tasks":     len(tasks),
        },
        "dataTypes": [
            {"name": d.get("Name"), "family": d.get("Family", ""), "class": d.get("Class", ""),
             "memberCount": len(d.findall("./Members/Member"))}
            for d in dtypes
        ],
        "modules": [
            {"name": m.get("Name"), "catalogNumber": m.get("CatalogNumber", ""),
             "vendor": m.get("Vendor", ""), "parentModule": m.get("ParentModule", ""),
             "inhibited": m.get("Inhibited", "false")}
            for m in modules
        ],
        "aoiDefinitions": [
            {"name": a.get("Name"), "revision": a.get("Revision", ""),
             "description": (a.findtext("Description") or "").strip(),
             "parameters": [
                 {"name": p.get("Name"), "dataType": p.get("DataType",""), "usage": p.get("Usage","Input")}
                 for p in a.findall("./Parameters/Parameter")
                 if p.get("Visible","true") != "false"
             ]}
            for a in aois
        ],
        "programs": [
            {
                "name":            p.get("Name"),
                "mainRoutineName": p.get("MainRoutineName", ""),
                "disabled":        p.get("Disabled", "false"),
                "tagCount":        len(p.findall("./Tags/Tag")),
                "routines": [
                    {
                        "name":      r.get("Name"),
                        "type":      r.get("Type", "RLL"),
                        "rungCount": len(r.findall("./RLLContent/Rung")),
                    }
                    for r in p.findall("./Routines/Routine")
                ],
            }
            for p in progs
        ],
        "trends": [
            {"name": tr.get("Name"), "samplePeriod": tr.get("SamplePeriod", ""),
             "penCount": len(tr.findall("./Pens/Pen"))}
            for tr in trends
        ],
        "tasks": [
            {
                "name":                 t.get("Name"),
                "type":                 t.get("Type", "CONTINUOUS"),
                "rate":                 t.get("Rate", ""),
                "priority":             t.get("Priority", ""),
                "watchdog":             t.get("Watchdog", ""),
                "disableUpdateOutputs": t.get("DisableUpdateOutputs", "false"),
                "inhibitTask":          t.get("InhibitTask", "false"),
                "scheduledPrograms": [
                    sp.get("Name")
                    for sp in t.findall("./ScheduledPrograms/ScheduledProgram")
                ],
            }
            for t in tasks
        ],
    }

# ── rung comment helper ──────────────────────────────────────────────────────
def _rung_comment(rung_el: etree._Element) -> str:
    """Return the rung comment text.
    Studio 5000 stores comments as:
      <Comment><LocalizedComment Lang="en-US">text</LocalizedComment></Comment>
    Earlier files may use direct CDATA text content of <Comment>.
    """
    cmt = rung_el.find("Comment")
    if cmt is None:
        return ""
    lc = cmt.find("LocalizedComment")
    if lc is not None:
        return (lc.text or "").strip()
    return (cmt.text or "").strip()

# ── tag helpers ───────────────────────────────────────────────────────────────

def _tag_dict(tag_el: etree._Element) -> dict:
    tag_type  = tag_el.get("TagType", "Base")
    alias_for = tag_el.get("AliasFor", "")          # present on Alias tags
    data_type = tag_el.get("DataType") or ""         # "" instead of None/null
    dims_attr = tag_el.get("Dimensions")
    is_array  = dims_attr is not None and dims_attr != "0"
    value, array_values = "", []

    if is_array:
        arr_el = tag_el.find("./Data[@Format='Decorated']/Array")
        if arr_el is not None:
            array_values = [e.get("Value", "") for e in arr_el.findall("Element")]
    else:
        dv = tag_el.find("./Data[@Format='Decorated']/DataValue")
        if dv is not None:
            value = dv.get("Value", "")

    desc_el = tag_el.find("Description")
    # Description can be a child element (CDATA) or an XML attribute — check both
    desc_str = ((desc_el.text or "").strip() if desc_el is not None else "")                or tag_el.get("Description", "")
    return {
        "name":           tag_el.get("Name"),
        "dataType":       data_type,
        "aliasFor":       alias_for,       # non-empty for Alias tags
        "tagType":        tag_type,
        "radix":          tag_el.get("Radix", ""),
        "externalAccess": tag_el.get("ExternalAccess", "Read/Write"),
        "constant":       tag_el.get("Constant", "false"),
        "isArray":        is_array,
        "dimensions":     int(dims_attr) if (is_array and dims_attr and dims_attr.isdigit()) else 0,
        "value":          value,
        "arrayValues":    array_values,
        "description":    desc_str,
    }

# ── tag listing (paginated + search) ─────────────────────────────────────────

def list_tags(root: etree._Element, program: Optional[str] = None,
              search: str = "", offset: int = 0, limit: int = 100) -> dict:
    tags_el = _tags_el(root, program)
    all_tags = tags_el.findall("Tag")
    if search:
        s = search.lower()
        all_tags = [t for t in all_tags if s in (t.get("Name") or "").lower()]
    total = len(all_tags)
    page  = all_tags[offset: offset + limit]
    return {"total": total, "offset": offset, "limit": limit, "tags": [_tag_dict(t) for t in page]}

# ── routine detail (rungs paginated) ─────────────────────────────────────────

def _rung_dict(rung_el: etree._Element) -> dict:
    text_el = rung_el.find("Text")
    return {
        "number":  int(rung_el.get("Number", 0)),
        "type":    rung_el.get("Type", "N"),
        "text":    (text_el.text or "").strip() if text_el is not None else "",
        "comment": _rung_comment(rung_el),
    }

def get_routine_detail(root: etree._Element, program: str, name: str,
                       rung_offset: int = 0, rung_limit: int = 200) -> dict:
    ctrl       = _ctrl(root)
    prog_el    = _prog(ctrl, program)
    routine_el = prog_el.find(f"./Routines/Routine[@Name='{name}']")
    if routine_el is None:
        raise ValueError(f"Routine '{name}' not found in program '{program}'")
    r_type = routine_el.get("Type", "RLL")
    result = {"name": name, "type": r_type, "program": program}
    if r_type == "RLL":
        all_rungs = routine_el.findall("./RLLContent/Rung")
        result["totalRungs"] = len(all_rungs)
        result["rungOffset"] = rung_offset
        result["rungLimit"]  = rung_limit
        result["rungs"]      = [_rung_dict(r) for r in all_rungs[rung_offset: rung_offset + rung_limit]]
    elif r_type == "ST":
        lines = routine_el.findall("./STContent/Line")
        result["content"] = "\n".join((l.text or "") for l in lines)
    return result

# ── data type detail ──────────────────────────────────────────────────────────

def get_datatype_detail(root: etree._Element, name: str) -> dict:
    ctrl = _ctrl(root)
    dt   = ctrl.find(f"./DataTypes/DataType[@Name='{name}']")
    if dt is None:
        raise ValueError(f"DataType '{name}' not found")
    desc = (dt.findtext("Description") or "").strip()
    members = []
    for m in dt.findall("./Members/Member"):
        if m.get("Hidden") == "true":
            continue
        m_desc = (m.findtext("Description") or "").strip()
        members.append({
            "name":      m.get("Name") or "",
            "dataType":  m.get("DataType") or "",
            "dimension": m.get("Dimension", "0") or "0",
            "radix":     m.get("Radix", ""),
            "access":    m.get("ExternalAccess", "Read/Write"),
            "description": m_desc,
        })
    return {"name": name, "description": desc, "members": members}

# ── AOI detail ────────────────────────────────────────────────────────────────

def get_aoi_detail(root: etree._Element, name: str) -> dict:
    ctrl = _ctrl(root)
    aoi = None
    for _a in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition"):
        if _a.get("Name") == name:
            aoi = _a
            break
    if aoi is None:
        raise ValueError(f"AOI '{name}' not found")
    params = []
    for p in aoi.findall("./Parameters/Parameter"):
        _pdv = p.find("./DefaultData[@Format='Decorated']/DataValue")
        params.append({
            "name":         p.get("Name") or "",
            "dataType":     p.get("DataType") or "",
            "usage":        p.get("Usage", ""),
            "required":     p.get("Required", "false"),
            "visible":      p.get("Visible", "true"),
            "defaultValue": _pdv.get("Value", "") if _pdv is not None else "",
            "description":  (p.findtext("Description") or "").strip(),
        })
    local_tags = []
    for lt in aoi.findall("./LocalTags/LocalTag"):
        _dv = lt.find("./DefaultData[@Format='Decorated']/DataValue")
        local_tags.append({
            "name":      lt.get("Name") or "",
            "dataType":  lt.get("DataType") or "",
            "dimension": lt.get("Dimension", "0") or "0",
            "value":     _dv.get("Value", "") if _dv is not None else "",
            "description": (lt.findtext("Description") or "").strip(),
        })
    # AOI internal logic - same shape as a routine's rungs, so the frontend
    # can reuse the exact same ladder-diagram renderer (read-only) it uses
    # for normal program routines.
    routines = []
    for rtn in aoi.findall("./Routines/Routine"):
        r_type = rtn.get("Type", "RLL")
        entry  = {"name": rtn.get("Name"), "type": r_type}
        if r_type == "RLL":
            entry["rungs"] = [_rung_dict(r) for r in rtn.findall("./RLLContent/Rung")]
        elif r_type == "ST":
            lines = rtn.findall("./STContent/Line")
            entry["content"] = "\n".join((l.text or "") for l in lines)
        routines.append(entry)
    return {
        "name":        name,
        "revision":    aoi.get("Revision", ""),
        "description": (aoi.findtext("Description") or "").strip(),
        "parameters":  params,
        "localTags":   local_tags,
        "routines":    routines,
    }

# ── create data type / AOI ────────────────────────────────────────────────────

def update_data_type(root: etree._Element, name: str, description: str,
                      members: List[dict]) -> None:
    """Replaces an existing UDT's description and member list wholesale.
    (Renaming/removing members that existing tag instances rely on will
    orphan that stored data - same as Studio 5000, which requires you to
    re-verify the project after a UDT edit.)"""
    ctrl = _ctrl(root)
    dt = ctrl.find(f"./DataTypes/DataType[@Name='{name}']")
    if dt is None:
        raise ValueError(f"Data type '{name}' not found")
    if not members:
        raise ValueError("A data type needs at least one member")
    desc_el = dt.find("Description")
    if desc_el is not None:
        dt.remove(desc_el)
    if description:
        d = etree.Element("Description"); d.text = etree.CDATA(description)
        dt.insert(0, d)
    mem_el = dt.find("Members")
    if mem_el is None:
        mem_el = etree.SubElement(dt, "Members")
    else:
        for m in list(mem_el):
            mem_el.remove(m)
    for m in members:
        me = etree.SubElement(mem_el, "Member")
        me.set("Name", m["name"]); me.set("DataType", m["dataType"])
        dim = int(m.get("dimension") or 0)
        me.set("Dimension", str(dim))
        if m["dataType"] in ATOMIC_TYPES:
            me.set("Radix", m.get("radix") or "Decimal")
        me.set("Hidden", "false")
        me.set("ExternalAccess", m.get("access") or "Read/Write")
        if m.get("description"):
            d = etree.SubElement(me, "Description"); d.text = etree.CDATA(m["description"])

def add_data_type(root: etree._Element, name: str, description: str,
                   members: List[dict]) -> None:
    """members: [{name,dataType,dimension,radix,access,description}, ...]"""
    ctrl = _ctrl(root)
    dtypes = _get_or_make(ctrl, "DataTypes")
    if dtypes.find(f"DataType[@Name='{name}']") is not None:
        raise ValueError(f"Data type '{name}' already exists")
    if not members:
        raise ValueError("A data type needs at least one member")
    dt = etree.SubElement(dtypes, "DataType")
    dt.set("Name", name); dt.set("Family", "NoFamily"); dt.set("Class", "User")
    if description:
        d = etree.SubElement(dt, "Description"); d.text = etree.CDATA(description)
    mem_el = etree.SubElement(dt, "Members")
    for m in members:
        me = etree.SubElement(mem_el, "Member")
        me.set("Name", m["name"])
        me.set("DataType", m["dataType"])
        dim = int(m.get("dimension") or 0)
        me.set("Dimension", str(dim))
        if m["dataType"] in ATOMIC_TYPES:
            me.set("Radix", m.get("radix") or "Decimal")
        me.set("Hidden", "false")
        me.set("ExternalAccess", m.get("access") or "Read/Write")
        if m.get("description"):
            d = etree.SubElement(me, "Description"); d.text = etree.CDATA(m["description"])

def add_aoi(root: etree._Element, name: str, description: str,
            parameters: List[dict]) -> None:
    """parameters: [{name,dataType,usage,required,description}, ...] (user-defined;
    EnableIn/EnableOut are added automatically as Studio 5000 requires)."""
    ctrl = _ctrl(root)
    aois = _get_or_make(ctrl, "AddOnInstructionDefinitions")
    if aois.find(f"AddOnInstructionDefinition[@Name='{name}']") is not None:
        raise ValueError(f"AOI '{name}' already exists")
    aoi = etree.SubElement(aois, "AddOnInstructionDefinition")
    aoi.set("Name", name); aoi.set("Revision", "1.0")
    aoi.set("ExecutePrescan", "false"); aoi.set("ExecutePostscan", "false")
    aoi.set("ExecuteEnableInFalse", "false")
    now = _now()
    aoi.set("CreatedDate", now); aoi.set("EditedDate", now)
    if description:
        d = etree.SubElement(aoi, "Description"); d.text = etree.CDATA(description)
    params_el = etree.SubElement(aoi, "Parameters")

    def _mk_param(pname, dtype, usage, required, visible, desc=""):
        pe = etree.SubElement(params_el, "Parameter")
        pe.set("Name", pname); pe.set("TagType", "Base"); pe.set("DataType", dtype)
        pe.set("Usage", usage); pe.set("Required", "true" if required else "false")
        pe.set("Visible", "true" if visible else "false")
        if dtype in ATOMIC_TYPES:
            pe.set("Radix", "Decimal")
        if desc:
            de = etree.SubElement(pe, "Description"); de.text = etree.CDATA(desc)

    _mk_param("EnableIn", "BOOL", "Input", False, False, "Enable Input - System Defined Parameter")
    _mk_param("EnableOut", "BOOL", "Output", False, False, "Enable Output - System Defined Parameter")
    for p in parameters:
        _mk_param(p["name"], p["dataType"], p.get("usage", "Input"),
                  bool(p.get("required")), True, p.get("description", ""))

    rtns = etree.SubElement(aoi, "Routines")
    rtn  = etree.SubElement(rtns, "Routine"); rtn.set("Name", "Logic"); rtn.set("Type", "RLL")
    rll  = etree.SubElement(rtn, "RLLContent")
    rung = etree.SubElement(rll, "Rung"); rung.set("Number", "0"); rung.set("Type", "N")
    t    = etree.SubElement(rung, "Text"); t.text = etree.CDATA("NOP();")

# ── tag CRUD (operate in-place on root) ───────────────────────────────────────

def _build_tag_el(name: str, data_type: str, value: str = "", description: str = "",
                  radix: str = "Decimal", external_access: str = "Read/Write",
                  constant: bool = False, dimensions: int = 0,
                  array_values: Optional[List[str]] = None) -> etree._Element:
    tag = etree.Element("Tag")
    tag.set("Name", name)
    tag.set("TagType", "Base")
    tag.set("DataType", data_type)
    is_array = dimensions and dimensions > 0
    if is_array:
        tag.set("Dimensions", str(dimensions))
    if data_type in ATOMIC_TYPES and (data_type != "BOOL" or is_array):
        tag.set("Radix", radix or "Decimal")
    tag.set("Constant", "true" if constant else "false")
    tag.set("ExternalAccess", external_access or "Read/Write")

    if is_array and data_type in ATOMIC_TYPES:
        vals = list(array_values or [])
        if len(vals) < dimensions:
            vals += ["0"] * (dimensions - len(vals))
        vals = vals[:dimensions]
        l5k = etree.SubElement(tag, "Data")
        l5k.set("Format", "L5K")
        l5k.text = "[" + ",".join(vals) + "]"
        dec = etree.SubElement(tag, "Data"); dec.set("Format", "Decorated")
        arr = etree.SubElement(dec, "Array")
        arr.set("DataType", data_type); arr.set("Dimensions", str(dimensions))
        arr.set("Radix", radix or "Decimal")
        for i, v in enumerate(vals):
            e = etree.SubElement(arr, "Element"); e.set("Index", f"[{i}]"); e.set("Value", v)
    elif data_type in ATOMIC_TYPES:
        sv = value if value not in (None, "") else "0"
        l5k = etree.SubElement(tag, "Data"); l5k.set("Format", "L5K"); l5k.text = sv
        dec = etree.SubElement(tag, "Data"); dec.set("Format", "Decorated")
        dv  = etree.SubElement(dec, "DataValue"); dv.set("DataType", data_type)
        if data_type != "BOOL":
            dv.set("Radix", radix or "Decimal")
        dv.set("Value", sv)
    else:
        l5k = etree.SubElement(tag, "Data"); l5k.set("Format", "L5K"); l5k.text = value or "0"

    if description:
        desc_el = etree.Element("Description"); desc_el.text = etree.CDATA(description)
        tag.insert(0, desc_el)
    return tag

def add_tag(root: etree._Element, name: str, data_type: str, value: str = "",
            description: str = "", program: Optional[str] = None, radix: str = "Decimal",
            external_access: str = "Read/Write", constant: bool = False,
            dimensions: int = 0, array_values: Optional[List[str]] = None) -> None:
    tags_el = _tags_el(root, program)
    if tags_el.find(f"Tag[@Name='{name}']") is not None:
        raise ValueError(f"Tag '{name}' already exists")
    tags_el.append(_build_tag_el(name, data_type, value, description, radix, external_access,
                                  constant, dimensions, array_values))

def edit_tag(root: etree._Element, old_name: str, name: str, data_type: str, value: str = "",
             description: str = "", program: Optional[str] = None, radix: str = "Decimal",
             external_access: str = "Read/Write", constant: bool = False,
             dimensions: int = 0, array_values: Optional[List[str]] = None) -> None:
    tags_el = _tags_el(root, program)
    old_el  = tags_el.find(f"Tag[@Name='{old_name}']")
    if old_el is None:
        raise ValueError(f"Tag '{old_name}' not found")
    new_el = _build_tag_el(name, data_type, value, description, radix, external_access,
                            constant, dimensions, array_values)
    old_el.addnext(new_el)
    tags_el.remove(old_el)

def delete_tag(root: etree._Element, name: str, program: Optional[str] = None) -> None:
    tags_el = _tags_el(root, program)
    el = tags_el.find(f"Tag[@Name='{name}']")
    if el is None:
        raise ValueError(f"Tag '{name}' not found")
    tags_el.remove(el)

# ── program CRUD ──────────────────────────────────────────────────────────────

def add_program(root: etree._Element, name: str) -> None:
    ctrl  = _ctrl(root)
    progs = _get_or_make(ctrl, "Programs")
    if progs.find(f"Program[@Name='{name}']") is not None:
        raise ValueError(f"Program '{name}' already exists")
    prog = etree.SubElement(progs, "Program")
    for k, v in [("Name", name), ("TestEdits", "false"), ("MainRoutineName", "MainRoutine"),
                  ("Disabled", "false"), ("UseAsFolder", "false")]:
        prog.set(k, v)
    etree.SubElement(prog, "Tags")
    routines = etree.SubElement(prog, "Routines")
    rtn = etree.SubElement(routines, "Routine")
    rtn.set("Name", "MainRoutine"); rtn.set("Type", "RLL")
    rll = etree.SubElement(rtn, "RLLContent")
    rung = etree.SubElement(rll, "Rung"); rung.set("Number", "0"); rung.set("Type", "N")
    t = etree.SubElement(rung, "Text"); t.text = etree.CDATA("NOP();")

def delete_program(root: etree._Element, name: str) -> None:
    ctrl  = _ctrl(root)
    progs = ctrl.find("Programs")
    if progs is None:
        raise ValueError("No programs")
    el = progs.find(f"Program[@Name='{name}']")
    if el is None:
        raise ValueError(f"Program '{name}' not found")
    progs.remove(el)

# ── task CRUD ────────────────────────────────────────────────────────────────

def add_task(root: etree._Element, name: str, task_type: str = "PERIODIC",
             rate: float = 10.0, priority: int = 10, watchdog: float = 500.0) -> None:
    ctrl  = _ctrl(root)
    tasks = _get_or_make(ctrl, "Tasks")
    for t in tasks.findall("Task"):
        if t.get("Name") == name:
            raise ValueError(f"Task '{name}' already exists")
    task = etree.SubElement(tasks, "Task")
    task.set("Name", name)
    task.set("Type", task_type.upper())
    if task_type.upper() == "PERIODIC":
        task.set("Rate", str(rate))
    task.set("Priority", str(int(priority)))
    task.set("Watchdog", str(watchdog))
    task.set("DisableUpdateOutputs", "false")
    task.set("InhibitTask", "false")
    etree.SubElement(task, "ScheduledPrograms")

def delete_task(root: etree._Element, name: str) -> None:
    ctrl  = _ctrl(root)
    tasks = ctrl.find("Tasks")
    if tasks is None:
        raise ValueError("No tasks defined")
    el = tasks.find(f"Task[@Name='{name}']")
    if el is None:
        raise ValueError(f"Task '{name}' not found")
    tasks.remove(el)

# ── module CRUD ──────────────────────────────────────────────────────────────

def add_module(root: etree._Element, name: str, catalog_number: str = "",
               vendor: str = "1", parent_module: str = "Local",
               inhibited: str = "false") -> None:
    ctrl = _ctrl(root)
    mods = _get_or_make(ctrl, "Modules")
    for m in mods.findall("Module"):
        if m.get("Name") == name:
            raise ValueError(f"Module '{name}' already exists")
    mod = etree.SubElement(mods, "Module")
    mod.set("Name", name); mod.set("CatalogNumber", catalog_number)
    mod.set("Vendor", str(vendor)); mod.set("ProductType", "0")
    mod.set("ProductCode", "0"); mod.set("Major", "1"); mod.set("Minor", "1")
    mod.set("ParentModule", parent_module); mod.set("ParentModPortId", "1")
    mod.set("Inhibited", inhibited); mod.set("MajorFault", "false")

def edit_module(root: etree._Element, old_name: str, name: str,
                catalog_number: str, vendor: str = "1",
                parent_module: str = "Local", inhibited: str = "false") -> None:
    ctrl = _ctrl(root)
    mods = ctrl.find("Modules")
    if mods is None:
        raise ValueError("No modules")
    mod = None
    for m in mods.findall("Module"):
        if m.get("Name") == old_name:
            mod = m; break
    if mod is None:
        raise ValueError(f"Module '{old_name}' not found")
    mod.set("Name", name); mod.set("CatalogNumber", catalog_number)
    mod.set("Inhibited", inhibited)

def delete_module(root: etree._Element, name: str) -> None:
    ctrl = _ctrl(root)
    mods = ctrl.find("Modules")
    if mods is None:
        raise ValueError("No modules")
    mod = None
    for m in mods.findall("Module"):
        if m.get("Name") == name:
            mod = m; break
    if mod is None:
        raise ValueError(f"Module '{name}' not found")
    mods.remove(mod)

# ── routine CRUD ──────────────────────────────────────────────────────────────

def add_routine(root: etree._Element, program: str, name: str,
                routine_type: str = "RLL") -> None:
    ctrl  = _ctrl(root)
    prog  = _prog(ctrl, program)
    rtns  = _get_or_make(prog, "Routines")
    if rtns.find(f"Routine[@Name='{name}']") is not None:
        raise ValueError(f"Routine '{name}' already exists")
    rtn = etree.SubElement(rtns, "Routine"); rtn.set("Name", name); rtn.set("Type", routine_type)
    if routine_type == "RLL":
        rll  = etree.SubElement(rtn, "RLLContent")
        rung = etree.SubElement(rll, "Rung"); rung.set("Number", "0"); rung.set("Type", "N")
        t    = etree.SubElement(rung, "Text"); t.text = etree.CDATA("NOP();")
    elif routine_type == "ST":
        st   = etree.SubElement(rtn, "STContent")
        line = etree.SubElement(st, "Line"); line.set("Number", "0"); line.text = etree.CDATA("")

def delete_routine(root: etree._Element, program: str, name: str) -> None:
    ctrl = _ctrl(root)
    prog = _prog(ctrl, program)
    rtns = prog.find("Routines")
    if rtns is None:
        raise ValueError("No routines")
    el = rtns.find(f"Routine[@Name='{name}']")
    if el is None:
        raise ValueError(f"Routine '{name}' not found")
    rtns.remove(el)

def edit_st_routine(root: etree._Element, program: str, name: str, content: str) -> None:
    ctrl  = _ctrl(root)
    prog  = _prog(ctrl, program)
    rtn   = prog.find(f"./Routines/Routine[@Name='{name}']")
    if rtn is None:
        raise ValueError(f"Routine '{name}' not found")
    st = _get_or_make(rtn, "STContent")
    for child in list(st):
        st.remove(child)
    for i, line_text in enumerate(content.split("\n")):
        line = etree.SubElement(st, "Line"); line.set("Number", str(i))
        line.text = etree.CDATA(line_text)

# ── rung CRUD ─────────────────────────────────────────────────────────────────

def _rll_el(root: etree._Element, program: str, routine: str) -> etree._Element:
    ctrl = _ctrl(root); prog = _prog(ctrl, program)
    rtn  = prog.find(f"./Routines/Routine[@Name='{routine}']")
    if rtn is None:
        raise ValueError(f"Routine '{routine}' not found")
    if rtn.get("Type") != "RLL":
        raise ValueError(f"Routine '{routine}' is not RLL type")
    return _get_or_make(rtn, "RLLContent")

def _aoi_el(root: etree._Element, name: str) -> etree._Element:
    ctrl = _ctrl(root)
    aoi = ctrl.find(f"./AddOnInstructionDefinitions/AddOnInstructionDefinition[@Name='{name}']")
    if aoi is None:
        raise ValueError(f"AOI '{name}' not found")
    return aoi

def _aoi_rll_el(root: etree._Element, aoi_name: str, routine: str) -> etree._Element:
    aoi = _aoi_el(root, aoi_name)
    rtn = aoi.find(f"./Routines/Routine[@Name='{routine}']")
    if rtn is None:
        raise ValueError(f"Routine '{routine}' not found in AOI '{aoi_name}'")
    if rtn.get("Type") != "RLL":
        raise ValueError(f"Routine '{routine}' is not RLL type")
    return _get_or_make(rtn, "RLLContent")

def _renumber(rll: etree._Element) -> None:
    for i, r in enumerate(rll.findall("Rung")):
        r.set("Number", str(i))

def _add_rung_to(rll: etree._Element, text: str, comment: str = "",
                  index: Optional[int] = None) -> None:
    rung  = etree.Element("Rung"); rung.set("Type", "N")
    if comment:
        c = etree.SubElement(rung, "Comment"); c.text = etree.CDATA(comment)
    t = etree.SubElement(rung, "Text"); t.text = etree.CDATA(text)
    rungs = rll.findall("Rung")
    if index is None or index >= len(rungs):
        rll.append(rung)
    else:
        rungs[index].addprevious(rung)
    _renumber(rll)

def _edit_rung_in(rll: etree._Element, number: int, text: str, comment: str = "") -> None:
    rung = rll.find(f"Rung[@Number='{number}']")
    if rung is None:
        raise ValueError(f"Rung {number} not found")
    for tag in ("Comment", "Text"):
        old = rung.find(tag)
        if old is not None:
            rung.remove(old)
    if comment:
        c = etree.Element("Comment"); c.text = etree.CDATA(comment); rung.append(c)
    t = etree.Element("Text"); t.text = etree.CDATA(text); rung.append(t)

def _delete_rung_from(rll: etree._Element, number: int) -> None:
    rung = rll.find(f"Rung[@Number='{number}']")
    if rung is None:
        raise ValueError(f"Rung {number} not found")
    rll.remove(rung)
    _renumber(rll)

def add_rung(root: etree._Element, program: str, routine: str, text: str,
             comment: str = "", index: Optional[int] = None) -> None:
    _add_rung_to(_rll_el(root, program, routine), text, comment, index)

def edit_rung(root: etree._Element, program: str, routine: str, number: int,
              text: str, comment: str = "") -> None:
    _edit_rung_in(_rll_el(root, program, routine), number, text, comment)

def delete_rung(root: etree._Element, program: str, routine: str, number: int) -> None:
    _delete_rung_from(_rll_el(root, program, routine), number)

def add_aoi_rung(root: etree._Element, aoi_name: str, routine: str, text: str,
                  comment: str = "", index: Optional[int] = None) -> None:
    _add_rung_to(_aoi_rll_el(root, aoi_name, routine), text, comment, index)

def edit_aoi_rung(root: etree._Element, aoi_name: str, routine: str, number: int,
                   text: str, comment: str = "") -> None:
    _edit_rung_in(_aoi_rll_el(root, aoi_name, routine), number, text, comment)

def delete_aoi_rung(root: etree._Element, aoi_name: str, routine: str, number: int) -> None:
    _delete_rung_from(_aoi_rll_el(root, aoi_name, routine), number)

def update_aoi(root: etree._Element, name: str, description: str, parameters: List[dict]) -> None:
    """Replaces the description and user-visible parameters of an existing
    AOI (EnableIn/EnableOut system params are preserved automatically).
    Local tags and internal logic routines are left untouched."""
    aoi = _aoi_el(root, name)
    desc_el = aoi.find("Description")
    if desc_el is not None:
        aoi.remove(desc_el)
    if description:
        d = etree.Element("Description"); d.text = etree.CDATA(description)
        aoi.insert(0, d)
    params_el = aoi.find("Parameters")
    if params_el is None:
        params_el = etree.SubElement(aoi, "Parameters")
    # keep the two system params, drop everything else, rebuild from `parameters`
    system = [p for p in params_el.findall("Parameter") if p.get("Name") in ("EnableIn", "EnableOut")]
    for p in list(params_el):
        params_el.remove(p)
    for p in system:
        params_el.append(p)
    for p in parameters:
        pe = etree.SubElement(params_el, "Parameter")
        pe.set("Name", p["name"]); pe.set("TagType", "Base"); pe.set("DataType", p["dataType"])
        pe.set("Usage", p.get("usage", "Input")); pe.set("Required", "true" if p.get("required") else "false")
        pe.set("Visible", "true")
        if p["dataType"] in ATOMIC_TYPES:
            pe.set("Radix", "Decimal")
        if p.get("description"):
            de = etree.SubElement(pe, "Description"); de.text = etree.CDATA(p["description"])

def delete_aoi(root: etree._Element, name: str, force: bool = False) -> List[str]:
    """Deletes an AOI definition. Returns a list of "Program.Routine Rung N"
    locations still calling it - if any are found and force=False, the AOI
    is NOT deleted (mirrors Studio 5000 refusing to delete an in-use AOI)."""
    ctrl = _ctrl(root)
    aoi  = _aoi_el(root, name)
    usages = []
    pattern = re.compile(r"\b" + re.escape(name) + r"\s*\(")
    for prog in ctrl.findall("./Programs/Program"):
        for rtn in prog.findall("./Routines/Routine[@Type='RLL']"):
            for rung in rtn.findall("./RLLContent/Rung"):
                txt = rung.findtext("Text") or ""
                if pattern.search(txt):
                    usages.append(f"{prog.get('Name')}.{rtn.get('Name')} Rung {rung.get('Number')}")
    if usages and not force:
        return usages
    aois_el = ctrl.find("AddOnInstructionDefinitions")
    aois_el.remove(aoi)
    return []

# ── validation ────────────────────────────────────────────────────────────────

def _parse_rung_struct(text):
    """Python mirror of the frontend's parseRungTextToSteps() grammar - used
    only to catch genuinely malformed/garbled rung text (unbalanced
    brackets, stray characters, unterminated instruction calls, etc.).
    Returns True if the text is structurally well-formed AB instruction
    syntax, False otherwise. Deliberately does NOT check instruction
    mnemonics against a whitelist (Studio 5000 has hundreds of valid ones -
    that would just create false positives)."""
    if text is None:
        return True
    s = text.strip()
    s = re.sub(r";\s*$", "", s)
    if s == "":
        return True
    n = len(s)
    pos = [0]

    def skip_ws():
        while pos[0] < n and s[pos[0]].isspace():
            pos[0] += 1

    def parse_instr():
        m = re.match(r"[A-Za-z_][A-Za-z0-9_]*\(", s[pos[0]:])
        if not m:
            return False
        j = pos[0] + m.end()
        close = s.find(")", j)
        if close == -1:
            return False
        pos[0] = close + 1
        return True

    def parse_branch():
        pos[0] += 1  # consume '['
        while True:
            skip_ws()
            if not parse_seq():
                return False
            skip_ws()
            if pos[0] < n and s[pos[0]] == ",":
                pos[0] += 1
                continue
            if pos[0] < n and s[pos[0]] == "]":
                pos[0] += 1
                return True
            return False

    def parse_seq():
        any_elem = True
        while True:
            skip_ws()
            if pos[0] >= n or s[pos[0]] in ",]":
                break
            if s[pos[0]] == "[":
                if not parse_branch():
                    return False
            else:
                if not parse_instr():
                    return False
        return any_elem

    ok = parse_seq()
    skip_ws()
    return ok and pos[0] == n

def search_xref(root: etree._Element, query: str, limit: int = 200) -> dict:
    """Studio 5000-style Find / Cross-Reference: given a search term (usually
    a tag name or instruction mnemonic), returns:
      - definitions: everywhere the exact name is *defined* (a tag, UDT,
        AOI, routine, or program with that name)
      - usages: every rung (in a program routine OR an AOI's internal
        logic) whose text contains the term as a whole word
    """
    q = query.strip()
    if not q:
        return {"query": query, "definitions": [], "usages": []}
    ctrl = _ctrl(root)
    q_lower = q.lower()
    pattern = re.compile(re.escape(q), re.IGNORECASE)

    definitions = []
    for t in ctrl.findall("./Tags/Tag"):
        if q_lower in t.get("Name", "").lower():
            definitions.append({"kind": "Controller Tag", "location": t.get("Name"), "dataType": t.get("DataType")})
    for dt in ctrl.findall("./DataTypes/DataType"):
        if q_lower in dt.get("Name", "").lower():
            definitions.append({"kind": "Data Type", "location": dt.get("Name")})
    for a in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition"):
        if q_lower in a.get("Name", "").lower():
            definitions.append({"kind": "Add-On Instruction", "location": a.get("Name")})
    for prog in ctrl.findall("./Programs/Program"):
        pname = prog.get("Name")
        if q_lower in pname.lower():
            definitions.append({"kind": "Program", "location": pname})
        for t in prog.findall("./Tags/Tag"):
            if q_lower in t.get("Name", "").lower():
                definitions.append({"kind": "Program Tag", "location": f"{pname}.{t.get('Name')}", "dataType": t.get("DataType")})
        for rtn in prog.findall("./Routines/Routine"):
            if q_lower in rtn.get("Name", "").lower():
                definitions.append({"kind": "Routine", "location": f"{pname}.{rtn.get('Name')}"})

    usages = []
    for prog in ctrl.findall("./Programs/Program"):
        pname = prog.get("Name")
        for rtn in prog.findall("./Routines/Routine[@Type='RLL']"):
            rname = rtn.get("Name")
            for rung in rtn.findall("./RLLContent/Rung"):
                txt = rung.findtext("Text") or ""
                cmt = _rung_comment(rung)
                if pattern.search(txt) or pattern.search(cmt):
                    usages.append({
                        "scope": f"{pname}.{rname}", "program": pname, "routine": rname,
                        "rung": int(rung.get("Number")), "text": txt, "comment": cmt,
                        "isAoi": False,
                    })
                    if len(usages) >= limit:
                        break
            if len(usages) >= limit:
                break
        if len(usages) >= limit:
            break

    if len(usages) < limit:
        for aoi in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition"):
            aname = aoi.get("Name")
            for rtn in aoi.findall("./Routines/Routine[@Type='RLL']"):
                rname = rtn.get("Name")
                for rung in rtn.findall("./RLLContent/Rung"):
                    txt = rung.findtext("Text") or ""
                    cmt = _rung_comment(rung)
                    if pattern.search(txt) or pattern.search(cmt):
                        usages.append({
                            "scope": f"AOI:{aname}.{rname}", "program": aname, "routine": rname,
                            "rung": int(rung.get("Number")), "text": txt, "comment": cmt,
                            "isAoi": True,
                        })
                        if len(usages) >= limit:
                            break
                if len(usages) >= limit:
                    break
            if len(usages) >= limit:
                break

    return {"query": query, "definitions": definitions, "usages": usages, "truncated": len(usages) >= limit}

def validate(root: etree._Element) -> dict:
    errors = []
    warnings = []
    if root.tag != "RSLogix5000Content":
        errors.append("Root element must be <RSLogix5000Content>")
    ctrl = root.find("Controller")
    if ctrl is None:
        errors.append("Missing <Controller> element")
        return {"valid": False, "errors": errors, "warnings": warnings}

    if not ctrl.get("Name"):
        errors.append("Controller missing Name attribute")
    if not ctrl.get("ProcessorType"):
        errors.append("Controller missing ProcessorType attribute")

    # ── duplicate tag names within a scope ──────────────────────────────
    def check_dupes(tags_el, scope_label):
        seen = {}
        for t in (tags_el.findall("Tag") if tags_el is not None else []):
            nm = t.get("Name")
            seen[nm] = seen.get(nm, 0) + 1
        for nm, cnt in seen.items():
            if cnt > 1:
                errors.append(f"Duplicate tag '{nm}' defined {cnt}x in {scope_label}")

    check_dupes(ctrl.find("Tags"), "controller tags")

    known_types = set(ATOMIC_TYPES)
    known_types |= {d.get("Name") for d in ctrl.findall("./DataTypes/DataType")}
    known_types |= {a.get("Name") for a in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition")}
    known_types |= {"TIMER", "COUNTER", "CONTROL", "STRING", "ALARM_ANALOG", "ALARM_DIGITAL", "MESSAGE", "PID"}

    def check_tag_types(tags_el, scope_label):
        for t in (tags_el.findall("Tag") if tags_el is not None else []):
            dt = t.get("DataType", "")
            base = dt.split(":")[0] if ":" in dt else dt
            if base and base not in known_types:
                warnings.append(f"Tag '{t.get('Name')}' in {scope_label} references unknown data type '{dt}'")

    check_tag_types(ctrl.find("Tags"), "controller tags")

    routine_names_by_program = {}
    for prog in ctrl.findall("./Programs/Program"):
        pname = prog.get("Name")
        check_dupes(prog.find("Tags"), f"program '{pname}'")
        check_tag_types(prog.find("Tags"), f"program '{pname}'")
        rnames = {r.get("Name") for r in prog.findall("./Routines/Routine")}
        routine_names_by_program[pname] = rnames
        if prog.get("MainRoutineName") and prog.get("MainRoutineName") not in rnames:
            errors.append(f"Program '{pname}': MainRoutineName '{prog.get('MainRoutineName')}' does not exist")

    # ── rung-level checks ────────────────────────────────────────────────
    OUTPUT_INSTRS = {
        "OTE","OTL","OTU","TON","TOF","RTO","CTU","CTD","RES",
        "ADD","SUB","MUL","DIV","MOD","MOV","MVM","CPT","CLR",
        "JSR","RET","JMP","LBL","END","NOP","MSG","COP","OSR","OSF",
        "EQU","NEQ","LES","LEQ","GRT","GEQ","CMP","LIM","MEQ",
        "AND","OR","XOR","NOT","BAND","BOR","BXOR","BTD",
        "FLL","FAL","FSC","DDT","SQI","SQL","SQO","MOD",
        "SCL","SCP","AFI","TOT","RTOR","ATON","ACOS","ASIN","SQRT",
        "MAS","MAH","MAM","MAJ","MAG","MCD","MCP","MCT","MDF",
    }
    CONDITION_ONLY = {"XIC","XIO","ONS"}
    # All instructions we recognize; anything else gets a warning
    ALL_KNOWN_INSTRS = OUTPUT_INSTRS | CONDITION_ONLY
    # Expected operand counts for common fixed-arity instructions (None = variable/skip)
    OPERAND_COUNT = {
        "XIC":1,"XIO":1,"ONS":1,
        "OTE":1,"OTL":1,"OTU":1,
        "TON":3,"TOF":3,"RTO":3,
        "CTU":3,"CTD":3,"RES":1,
        "ADD":3,"SUB":3,"MUL":3,"DIV":3,"MOD":3,
        "MOV":2,"CLR":1,"CPT":2,"MVM":3,
        "EQU":2,"NEQ":2,"LES":2,"LEQ":2,"GRT":2,"GEQ":2,
        "CMP":2,"LIM":3,"MEQ":3,
        "NOP":0,"END":0,"AFI":0,
        "OSR":1,"OSF":1,
    }
    ctrl_tags = ctrl.find("Tags")
    # Collect AOI names so we don't warn on them as unknown instructions
    aoi_names = {a.get("Name") for a in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition")}

    def get_tag_type_v(tag_name, prog_tags_v):
        for scope in (prog_tags_v, ctrl_tags):
            if scope is None:
                continue
            el = scope.find(f"Tag[@Name='{tag_name}']")
            if el is not None:
                return el.get("DataType", "")
        return ""

    def check_rung_instrs(txt, loc, rnames, lbl_names, prog_tags_v):
        """Apply rung-level instruction checks. Called for both program and AOI rungs."""
        if not txt or txt in (";", "NOP();"):
            warnings.append(f"{loc}: empty/NOP rung")
            return
        if not _parse_rung_struct(txt):
            errors.append(f"{loc}: malformed instruction text (unbalanced brackets/parentheses)")
            return
        instrs = re.findall(r'\b([A-Z][A-Z0-9_]*)(?=\s*\()', txt)
        if instrs:
            if all(i in CONDITION_ONLY for i in instrs):
                errors.append(f"{loc}: rung has only condition instructions \u2014 no output instruction (Studio 5000 will reject on download)")
            last = instrs[-1]
            if last not in OUTPUT_INSTRS:
                warnings.append(f"{loc}: last instruction '{last}' \u2014 expected an output instruction")
            # Unknown instruction check (not in known set and not an AOI)
            for instr in instrs:
                if instr not in ALL_KNOWN_INSTRS and instr not in aoi_names:
                    warnings.append(f"{loc}: unrecognized instruction '{instr}' \u2014 may cause download error")
            # Operand count check for fixed-arity instructions
            for m in re.finditer(r'\b([A-Z][A-Z0-9_]*)\(([^)]*)\)', txt):
                code = m.group(1)
                expected = OPERAND_COUNT.get(code)
                if expected is None:
                    continue
                raw_args = m.group(2).strip()
                if expected == 0:
                    if raw_args:
                        errors.append(f"{loc}: {code}() takes no operands but got '{raw_args}'")
                else:
                    args = [a.strip() for a in raw_args.split(',')]
                    # Empty operand check
                    for i, arg in enumerate(args):
                        if not arg:
                            errors.append(f"{loc}: {code}() operand {i+1} is empty \u2014 fill in all arguments")
                    # Count check
                    if len(args) != expected:
                        errors.append(f"{loc}: {code}() expects {expected} operand(s), got {len(args)}")
        for m2 in re.finditer(r'\bJSR\(\s*([A-Za-z_][A-Za-z0-9_]*)', txt):
            t = m2.group(1)
            if rnames is not None and t not in rnames:
                errors.append(f"{loc}: JSR('{t}') \u2014 routine not found")
        for m2 in re.finditer(r'\bJMP\(\s*([A-Za-z_][A-Za-z0-9_]*)', txt):
            t = m2.group(1)
            if lbl_names is not None and t not in lbl_names:
                warnings.append(f"{loc}: JMP('{t}') \u2014 label not found in routine")
        for m2 in re.finditer(r'\b(TON|TOF|RTO)\(\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)', txt):
            instr_name, tag = m2.group(1), m2.group(2).split("[")[0].split(".")[0]
            dt = get_tag_type_v(tag, prog_tags_v)
            if dt and dt != "TIMER":
                warnings.append(f"{loc}: {instr_name}({tag}) \u2014 tag type '{dt}', expected TIMER")
        for m2 in re.finditer(r'\b(CTU|CTD)\(\s*([A-Za-z_][A-Za-z0-9_.\[\]]*)', txt):
            instr_name, tag = m2.group(1), m2.group(2).split("[")[0].split(".")[0]
            dt = get_tag_type_v(tag, prog_tags_v)
            if dt and dt != "COUNTER":
                warnings.append(f"{loc}: {instr_name}({tag}) \u2014 tag type '{dt}', expected COUNTER")

    for prog in ctrl.findall("./Programs/Program"):
        pname = prog.get("Name")
        prog_tags_v = prog.find("Tags")
        rnames = routine_names_by_program.get(pname, set())
        # Collect LBL labels across all rungs first
        lbl_names = set()
        for rtn2 in prog.findall("./Routines/Routine[@Type='RLL']"):
            for rung2 in rtn2.findall("./RLLContent/Rung"):
                for m2 in re.finditer(r'\bLBL\(\s*([A-Za-z_][A-Za-z0-9_]*)', rung2.findtext("Text") or ""):
                    lbl_names.add(m2.group(1))
        for rtn in prog.findall("./Routines/Routine"):
            rname = rtn.get("Name")
            if rtn.get("Type") != "RLL":
                continue
            for rung in rtn.findall("./RLLContent/Rung"):
                num = rung.get("Number")
                txt = (rung.findtext("Text") or "").strip()
                loc = f"{pname}.{rname} Rung {num}"
                check_rung_instrs(txt, loc, rnames, lbl_names, prog_tags_v)

    # ── AOI routine rung checks ────────────────────────────────────────────
    for aoi in ctrl.findall("./AddOnInstructionDefinitions/AddOnInstructionDefinition"):
        aname = aoi.get("Name")
        aoi_tags_v = aoi.find("LocalTags")
        for rtn in aoi.findall("./Routines/Routine"):
            rname = rtn.get("Name")
            if rtn.get("Type") != "RLL":
                continue
            lbl_names = set()
            for rung2 in rtn.findall("./RLLContent/Rung"):
                for m2 in re.finditer(r'\bLBL\(\s*([A-Za-z_][A-Za-z0-9_]*)', rung2.findtext("Text") or ""):
                    lbl_names.add(m2.group(1))
            for rung in rtn.findall("./RLLContent/Rung"):
                num = rung.get("Number")
                txt = (rung.findtext("Text") or "").strip()
                loc = f"AOI:{aname}.{rname} Rung {num}"
                check_rung_instrs(txt, loc, None, lbl_names, aoi_tags_v)

    valid = len(errors) == 0
    return {"valid": valid, "errors": errors, "warnings": warnings}

# ── tag value/comment breakdown (bit/UDT-member expansion in the UI) ─────────

def _parse_decorated_value(el: etree._Element):
    """Recursively turns a <DataValue>/<Array>/<Structure> element (the
    'Decorated' representation of a tag's stored value) into a plain nested
    dict/scalar tree: {} for Structure (keyed by member name), {} for Array
    (keyed by string index), or a plain string for a scalar DataValue."""
    if el is None:
        return None
    tag = el.tag
    if tag == "DataValue":
        return el.get("Value")
    if tag == "Array":
        result = {}
        for e in el.findall("Element"):
            idx = e.get("Index", "").strip("[]")
            sub = e.find("Structure")
            result[idx] = _parse_decorated_value(sub) if sub is not None else e.get("Value")
        return result
    if tag == "Structure":
        result = {}
        for child in el:
            if child.tag == "DataValueMember":
                result[child.get("Name")] = child.get("Value")
            elif child.tag == "StructureMember":
                result[child.get("Name")] = _parse_decorated_value(child.find("Structure") or child)
            elif child.tag == "ArrayMember":
                arr = {}
                for e in child.findall("Element"):
                    idx = e.get("Index", "").strip("[]")
                    sub = e.find("Structure")
                    arr[idx] = _parse_decorated_value(sub) if sub is not None else e.get("Value")
                result[child.get("Name")] = arr
        return result
    return None

def get_tag_detail(root: etree._Element, program: Optional[str], name: str) -> dict:
    tags_el = _tags_el(root, program)
    tag = tags_el.find(f"Tag[@Name='{name}']")
    if tag is None:
        raise ValueError(f"Tag '{name}' not found")
    decorated = tag.find("Data[@Format='Decorated']")
    value_tree = None
    if decorated is not None and len(decorated):
        value_tree = _parse_decorated_value(decorated[0])
    comments = {}
    for c in tag.findall("./Comments/Comment"):
        comments[c.get("Operand", "")] = (c.text or "").strip()
    return {"name": name, "value": value_tree, "comments": comments}

# ── Trends (view/edit pen lists + metadata; the binary <Template> chart-
#    layout blob is left completely untouched so the project stays openable
#    in Studio 5000 - only the plain-XML <Pens> and Trend attributes below
#    it are touched) ───────────────────────────────────────────────────────

def get_trend_detail(root: etree._Element, name: str) -> dict:
    ctrl = _ctrl(root)
    tr = ctrl.find(f"./Trends/Trend[@Name='{name}']")
    if tr is None:
        raise ValueError(f"Trend '{name}' not found")
    pens = []
    for p in tr.findall("./Pens/Pen"):
        pens.append({
            "name": p.get("Name"), "color": p.get("Color", ""), "visible": p.get("Visible", "true"),
            "type": p.get("Type", "Analog"), "width": p.get("Width", "1"), "marker": p.get("Marker", "0"),
            "min": p.get("Min", ""), "max": p.get("Max", ""),
        })
    return {
        "name": name, "samplePeriod": tr.get("SamplePeriod", ""),
        "numberOfCaptures": tr.get("NumberOfCaptures", ""), "captureSizeType": tr.get("CaptureSizeType", ""),
        "captureSize": tr.get("CaptureSize", ""), "startTriggerType": tr.get("StartTriggerType", ""),
        "stopTriggerType": tr.get("StopTriggerType", ""), "hasTemplate": tr.find("Template") is not None,
        "pens": pens,
    }

def update_trend_meta(root: etree._Element, name: str, sample_period: str, capture_size: str) -> None:
    ctrl = _ctrl(root)
    tr = ctrl.find(f"./Trends/Trend[@Name='{name}']")
    if tr is None:
        raise ValueError(f"Trend '{name}' not found")
    if sample_period: tr.set("SamplePeriod", str(sample_period))
    if capture_size:  tr.set("CaptureSize", str(capture_size))

def set_trend_pens(root: etree._Element, name: str, pens: List[dict]) -> None:
    """Replaces the whole <Pens> list for a trend (used for add/edit/delete -
    the frontend always sends the full desired pen list back)."""
    ctrl = _ctrl(root)
    tr = ctrl.find(f"./Trends/Trend[@Name='{name}']")
    if tr is None:
        raise ValueError(f"Trend '{name}' not found")
    pens_el = tr.find("Pens")
    if pens_el is None:
        pens_el = etree.SubElement(tr, "Pens")
    else:
        for p in list(pens_el):
            pens_el.remove(p)
    for p in pens:
        pe = etree.SubElement(pens_el, "Pen")
        pe.set("Name", p["name"]); pe.set("Color", p.get("color") or "16#0000_ff00")
        pe.set("Visible", "true" if p.get("visible", True) else "false")
        pe.set("Style", "0"); pe.set("Type", p.get("type") or "Analog")
        pe.set("Width", str(p.get("width") or "1")); pe.set("Marker", str(p.get("marker") or "0"))
        if p.get("min") not in (None, ""): pe.set("Min", str(p["min"]))
        if p.get("max") not in (None, ""): pe.set("Max", str(p["max"]))

def delete_trend(root: etree._Element, name: str) -> None:
    ctrl = _ctrl(root)
    trends_el = ctrl.find("Trends")
    tr = ctrl.find(f"./Trends/Trend[@Name='{name}']")
    if tr is None:
        raise ValueError(f"Trend '{name}' not found")
    trends_el.remove(tr)

def duplicate_trend(root: etree._Element, src_name: str, new_name: str) -> None:
    """Creates a new trend by deep-copying an existing one (including its
    opaque binary <Template> chart layout) and renaming it - this is the
    only safe way to author a *new* trend here, since the <Template> format
    is an undocumented RSLogix5000 binary blob we can't synthesize from
    scratch without risking a file Studio 5000 can't open."""
    ctrl = _ctrl(root)
    trends_el = _get_or_make(ctrl, "Trends")
    src = trends_el.find(f"Trend[@Name='{src_name}']")
    if src is None:
        raise ValueError(f"Trend '{src_name}' not found")
    if trends_el.find(f"Trend[@Name='{new_name}']") is not None:
        raise ValueError(f"Trend '{new_name}' already exists")
    import copy
    clone = copy.deepcopy(src)
    clone.set("Name", new_name)
    trends_el.append(clone)


# ── file comparison ───────────────────────────────────────────────────────────

def compare_l5x(root_a: etree._Element, root_b: etree._Element,
                include_comments: bool = False, include_values: bool = False) -> dict:
    """Compare two parsed L5X trees and return a structured diff."""

    def ctrl_of(root):
        return root.find("Controller")

    # ── controller properties ─────────────────────────────────────────────
    ctrl_props = ["Name","ProcessorType","MajorRev","MinorRev","TimeSlice","Use","SafetyInfo"]
    ctrl_a = ctrl_of(root_a)
    ctrl_b = ctrl_of(root_b)
    ctrl_changes = []
    for p in ctrl_props:
        va = ctrl_a.get(p,"") if ctrl_a is not None else ""
        vb = ctrl_b.get(p,"") if ctrl_b is not None else ""
        if va != vb:
            ctrl_changes.append({"prop": p, "from": va, "to": vb})

    # ── helper: get tag dict for a scope ─────────────────────────────────
    def get_tags(root, program=None):
        if program:
            prog = root.find(f"./Controller/Programs/Program[@Name='{program}']")
            scope = prog.find("Tags") if prog is not None else None
        else:
            ctrl = root.find("Controller")
            scope = ctrl.find("Tags") if ctrl is not None else None
        if scope is None:
            return {}
        def _tag_value(t):
            """Extract value from <Data Format="Decorated"> child — same as _tag_dict."""
            dims = t.get("Dimensions")
            if dims and dims != "0":
                arr = t.find("./Data[@Format='Decorated']/Array")
                if arr is not None:
                    return ",".join(e.get("Value","") for e in arr.findall("Element")[:8])
            dv = t.find("./Data[@Format='Decorated']/DataValue")
            if dv is not None:
                return dv.get("Value","")
            return t.get("Value","")  # fallback for older L5X
        return {
            t.get("Name",""):
            {"dataType": t.get("DataType",""), "value": _tag_value(t),
             "desc": t.findtext("Description","") or t.get("Description",""),
             "tagType": t.get("TagType","Base"),
             "radix": t.get("Radix",""),
             "externalAccess": t.get("ExternalAccess","Read/Write")}
            for t in scope.findall("Tag")
        }

    def diff_tags(ta, tb):
        added   = [{"name": k, **v} for k, v in tb.items() if k not in ta]
        removed = [{"name": k, **v} for k, v in ta.items() if k not in tb]
        changed = []
        # Always compare all fields including value so bit-expand works.
        # If include_values is False we only suppress tags whose SOLE change is value.
        compare_fields = ["dataType", "desc", "tagType", "radix", "externalAccess", "value"]
        for k in ta:
            if k in tb:
                va, vb = ta[k], tb[k]
                diffs = {}
                for field in compare_fields:
                    if va.get(field,"") != vb.get(field,""):
                        diffs[field] = {"from": va.get(field,""), "to": vb.get(field,"")}
                if diffs:
                    # Skip value-only changes when the checkbox is unchecked
                    if not include_values and set(diffs.keys()) == {"value"}:
                        continue
                    changed.append({"name": k, "dataType": va.get("dataType",""),
                                    "tagType": va.get("tagType","Base"), "changes": diffs})
        return {"added": added, "removed": removed, "changed": changed}

    ctrl_tags_diff = diff_tags(get_tags(root_a), get_tags(root_b))

    # ── data types ────────────────────────────────────────────────────────
    def get_dtypes(root):
        dts = {}
        for dt in root.findall("./Controller/DataTypes/DataType"):
            name = dt.get("Name","")
            members = [
                {"name": m.get("Name",""), "type": m.get("DataType",""), "dim": m.get("Dimension","0")}
                for m in dt.findall("./Members/Member") if m.get("Hidden","false").lower() != "true"
            ]
            dts[name] = {"members": members, "desc": dt.findtext("Description","")}
        return dts

    def diff_simple(da, db):
        na, nb = set(da), set(db)
        added   = [{"name": k} for k in sorted(nb - na)]
        removed = [{"name": k} for k in sorted(na - nb)]
        changed = [{"name": k} for k in sorted(na & nb) if da[k] != db[k]]
        return {"added": added, "removed": removed, "changed": changed}

    raw_dts_a = get_dtypes(root_a)
    raw_dts_b = get_dtypes(root_b)
    na_dt, nb_dt = set(raw_dts_a), set(raw_dts_b)
    dt_added   = [{"name": k} for k in sorted(nb_dt - na_dt)]
    dt_removed = [{"name": k} for k in sorted(na_dt - nb_dt)]
    dt_changed = []
    for k in sorted(na_dt & nb_dt):
        da, db = raw_dts_a[k], raw_dts_b[k]
        if da != db:
            ma = {m["name"]: m for m in da.get("members",[])}
            mb = {m["name"]: m for m in db.get("members",[])}
            mem_added   = [mb[n] for n in mb if n not in ma]
            mem_removed = [ma[n] for n in ma if n not in mb]
            mem_changed = [{"name":n,"from":ma[n],"to":mb[n]}
                          for n in ma if n in mb and ma[n]!=mb[n]]
            dt_changed.append({"name": k,
                                "membersA": da.get("members",[]),
                                "membersB": db.get("members",[]),
                                "memberDiff":{"added":mem_added,"removed":mem_removed,"changed":mem_changed}})
    dtype_diff = {"added": dt_added, "removed": dt_removed, "changed": dt_changed}

    # ── AOIs ──────────────────────────────────────────────────────────────
    def get_aois(root):
        aois = {}
        for a in root.findall("./Controller/AddOnInstructionDefinitions/AddOnInstructionDefinition"):
            name = a.get("Name","")
            params = [
                {"name": p.get("Name",""), "type": p.get("DataType",""), "usage": p.get("Usage","")}
                for p in a.findall("./Parameters/Parameter")
                if p.get("Name","") not in ("EnableIn","EnableOut")
            ]
            local_tags = []
            for _lt in a.findall("./LocalTags/LocalTag"):
                _dv = _lt.find("./DefaultData[@Format='Decorated']/DataValue")
                local_tags.append({
                    "name": _lt.get("Name",""),
                    "dataType": _lt.get("DataType",""),
                    "value": _dv.get("Value","") if _dv is not None else "",
                    "desc": _lt.findtext("Description",""),
                })
            rev = a.get("Revision","")
            # Collect routine rung texts for logic comparison
            routines = {}
            for rtn in a.findall("./Routines/Routine"):
                rname = rtn.get("Name","")
                rungs = [(rg.findtext("Text","").strip(), _rung_comment(rg))
                         for rg in rtn.findall("./RLLContent/Rung")]
                routines[rname] = rungs
            aois[name] = {"params": params, "localTags": local_tags, "revision": rev,
                          "desc": a.findtext("Description",""), "routines": routines}
        return aois

    raw_aois_a = get_aois(root_a)
    raw_aois_b = get_aois(root_b)
    na_aoi, nb_aoi = set(raw_aois_a), set(raw_aois_b)
    def _aoi_full(d):
        """Serialize a full AOI snapshot with params, localTags, and routines."""
        return {
            "params": d.get("params", []),
            "localTags": d.get("localTags", []),
            "routines": {
                rname: [{"num": j, "text": t, "comment": c} for j, (t, c) in enumerate(rungs)]
                for rname, rungs in d.get("routines", {}).items()
            },
        }

    aoi_added   = [{"name": k, **_aoi_full(raw_aois_b[k])} for k in sorted(nb_aoi - na_aoi)]
    aoi_removed = [{"name": k, **_aoi_full(raw_aois_a[k])} for k in sorted(na_aoi - nb_aoi)]
    aoi_changed = []
    for k in sorted(na_aoi & nb_aoi):
        aa, ab = raw_aois_a[k], raw_aois_b[k]
        if aa != ab:
            # Diff params
            pa_names = {p["name"]: p for p in aa.get("params",[])}
            pb_names = {p["name"]: p for p in ab.get("params",[])}
            param_added   = [pb_names[n] for n in pb_names if n not in pa_names]
            param_removed = [pa_names[n] for n in pa_names if n not in pb_names]
            param_changed = [{"name":n,"from":pa_names[n],"to":pb_names[n]}
                             for n in pa_names if n in pb_names and pa_names[n]!=pb_names[n]]
            # Compare logic routines
            rtn_diffs = {}
            all_rtn_names = set(list(aa.get("routines",{}).keys()) + list(ab.get("routines",{}).keys()))
            for rname in sorted(all_rtn_names):
                ra_rungs = aa.get("routines",{}).get(rname,[])
                rb_rungs = ab.get("routines",{}).get(rname,[])
                if ra_rungs == rb_rungs:
                    continue  # identical routine — skip
                diff = rung_diff_calc(ra_rungs, rb_rungs)
                rtn_diffs[rname] = {
                    "rungsA": [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(ra_rungs)],
                    "rungsB": [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(rb_rungs)],
                    "rungDiff": diff
                }
            # Diff local tags
            la_map = {t["name"]: t for t in aa.get("localTags",[])}
            lb_map = {t["name"]: t for t in ab.get("localTags",[])}
            ltag_added   = [lb_map[n] for n in lb_map if n not in la_map]
            ltag_removed = [la_map[n] for n in la_map if n not in lb_map]
            ltag_changed = [{"name":n,"changes":{"dataType":{"from":la_map[n].get("dataType",""),"to":lb_map[n].get("dataType","")}}}
                            for n in la_map if n in lb_map and la_map[n]!=lb_map[n]]
            aoi_changed.append({"name": k,
                                 "revisionA": aa.get("revision",""), "revisionB": ab.get("revision",""),
                                 "paramsA": aa.get("params",[]),
                                 "paramsB": ab.get("params",[]),
                                 "paramDiff": {"added":param_added,"removed":param_removed,"changed":param_changed},
                                 "localTagsA": aa.get("localTags",[]),
                                 "localTagsB": ab.get("localTags",[]),
                                 "localTagDiff": {"added":ltag_added,"removed":ltag_removed,"changed":ltag_changed},
                                 "routineDiffs": rtn_diffs})
    aoi_diff = {"added": aoi_added, "removed": aoi_removed, "changed": aoi_changed}

    # ── programs + routines ───────────────────────────────────────────────
    def build_rung_cache(root):
        """Pre-compute {pname: {rname: [(text,comment),...]}} for the whole file."""
        cache = {}
        for p in root.findall("./Controller/Programs/Program"):
            pname = p.get("Name","")
            cache[pname] = {}
            for r in p.findall("./Routines/Routine"):
                rname = r.get("Name","")
                cache[pname][rname] = [
                    ((rg.findtext("Text") or "").strip(), _rung_comment(rg))
                    for rg in r.findall("./RLLContent/Rung")
                ]
        return cache

    rung_cache_a = build_rung_cache(root_a)
    rung_cache_b = build_rung_cache(root_b)

    def get_rung_texts(which, pname, rname):
        cache = rung_cache_a if which == "a" else rung_cache_b
        return cache.get(pname, {}).get(rname, [])

    def rung_diff_calc(rungs_a, rungs_b):
        """Compute rung-level diff between two lists of (text,comment) tuples."""
        if include_comments:
            keys_a = [f"{r[0]}\x00{r[1]}" for r in rungs_a]
            keys_b = [f"{r[0]}\x00{r[1]}" for r in rungs_b]
        else:
            keys_a = [r[0] for r in rungs_a]
            keys_b = [r[0] for r in rungs_b]
        if keys_a == keys_b:
            return []  # Quick bail — identical content
        sm = difflib.SequenceMatcher(None, keys_a, keys_b, autojunk=True)
        result = []
        for op, i1, i2, j1, j2 in sm.get_opcodes():
            if op == "equal":
                continue
            elif op == "insert":
                for j in range(j1, j2):
                    result.append({"op":"added","numB":j,"textB":rungs_b[j][0],"comB":rungs_b[j][1]})
            elif op == "delete":
                for i in range(i1, i2):
                    result.append({"op":"removed","numA":i,"textA":rungs_a[i][0],"comA":rungs_a[i][1]})
            elif op == "replace":
                for k in range(max(i2-i1, j2-j1)):
                    ia = i1+k; jb = j1+k
                    if ia < i2 and jb < j2:
                        result.append({"op":"changed","numA":ia,"numB":jb,
                                        "textA":rungs_a[ia][0],"comA":rungs_a[ia][1],
                                        "textB":rungs_b[jb][0],"comB":rungs_b[jb][1]})
                    elif ia < i2:
                        result.append({"op":"removed","numA":ia,"textA":rungs_a[ia][0],"comA":rungs_a[ia][1]})
                    else:
                        result.append({"op":"added","numB":jb,"textB":rungs_b[jb][0],"comB":rungs_b[jb][1]})
        return result

    def get_programs(root):
        progs = {}
        for p in root.findall("./Controller/Programs/Program"):
            pname = p.get("Name","")
            routines = {}
            for r in p.findall("./Routines/Routine"):
                rname = r.get("Name","")
                rtype = r.get("Type","RLL")
                rll = r.find("RLLContent")
                rungs = len(rll.findall("Rung")) if rll is not None else 0
                routines[rname] = {"type": rtype, "rungs": rungs}
            # Direct count — avoids building a full tag dict just for the count
            tag_count = len(p.findall("./Tags/Tag"))
            progs[pname] = {"routines": routines, "tagCount": tag_count}
        return progs

    progs_a = get_programs(root_a)
    progs_b = get_programs(root_b)
    na, nb = set(progs_a), set(progs_b)
    def _prog_summary(root, pname, progs_dict):
        """Return {name, routineCount, routines: [{name, type, rungs}]} for an added/removed program."""
        rtns = []
        for rname, rinfo in sorted(progs_dict[pname]["routines"].items()):
            rd = [{"num":j,"text":t,"comment":c}
                  for j,(t,c) in enumerate(get_rung_texts(
                      "b" if root is root_b else "a", pname, rname))]
            rtns.append({"name": rname, "type": rinfo.get("type","RLL"),
                         "rungs": rinfo.get("rungs",0), "rungs_data": rd})
        return {"name": pname, "routineCount": len(rtns), "routines": rtns}
    prog_added   = [_prog_summary(root_b, k, progs_b) for k in sorted(nb - na)]
    prog_removed = [_prog_summary(root_a, k, progs_a) for k in sorted(na - nb)]
    prog_changed = []
    for pname in sorted(na & nb):
        pa, pb = progs_a[pname], progs_b[pname]
        ra, rb = pa["routines"], pb["routines"]
        rna, rnb = set(ra), set(rb)
        rtns_added   = []
        for k in sorted(rnb - rna):
            rd = [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(get_rung_texts("b",pname,k))]
            rtns_added.append({"name": k, **rb[k], "rungs_data": rd})
        rtns_removed = []
        for k in sorted(rna - rnb):
            rd = [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(get_rung_texts("a",pname,k))]
            rtns_removed.append({"name": k, **ra[k], "rungs_data": rd})
        rtns_changed = []
        for rname in sorted(rna & rnb):
            rl_a = get_rung_texts("a", pname, rname)
            rl_b = get_rung_texts("b", pname, rname)
            if ra[rname] != rb[rname] or rl_a != rl_b:
                rung_diffs = rung_diff_calc(rl_a, rl_b)
                rtns_changed.append({"name": rname, "from": ra[rname], "to": rb[rname],
                                     "rungDiff": rung_diffs,
                                     "rungsA": [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(rl_a)],
                                     "rungsB": [{"num":j,"text":t,"comment":c} for j,(t,c) in enumerate(rl_b)]})
        has_rtn_changes = bool(rtns_added or rtns_removed or rtns_changed)
        tag_count_changed = pa["tagCount"] != pb["tagCount"]
        if has_rtn_changes or tag_count_changed:
            # Only diff tags when the program actually changed (avoids N^2 tag lookups)
            prog_tags_a = get_tags(root_a, pname)
            prog_tags_b = get_tags(root_b, pname)
            tag_d = diff_tags(prog_tags_a, prog_tags_b)
            prog_changed.append({
                "name": pname,
                "routines": {"added": rtns_added, "removed": rtns_removed, "changed": rtns_changed},
                "tagCountA": pa["tagCount"], "tagCountB": pb["tagCount"],
                "tagDiff": tag_d
            })
    prog_diff = {"added": prog_added, "removed": prog_removed, "changed": prog_changed}

    # ── modules (I/O) ─────────────────────────────────────────────────────
    def get_modules(root):
        mods = {}
        for m in (root.findall("./Controller/EthernetNetwork/Module")
                  + root.findall("./Controller/Modules/Module")):
            name = m.get("Name","")
            mods[name] = {"catalog": m.get("CatalogNumber",""), "slot": m.get("Slot","")}
        return mods

    module_diff = diff_simple(get_modules(root_a), get_modules(root_b))

    # ── tasks ─────────────────────────────────────────────────────────────
    def get_tasks(root):
        tasks = {}
        for t in root.findall("./Controller/Tasks/Task"):
            name = t.get("Name","")
            tasks[name] = {
                "type": t.get("Type",""), "rate": t.get("Rate",""),
                "priority": t.get("Priority",""), "watchdog": t.get("Watchdog","")
            }
        return tasks

    task_diff = diff_simple(get_tasks(root_a), get_tasks(root_b))

    # ── trends ────────────────────────────────────────────────────────────
    def get_trends(root):
        trends = {}
        for t in root.findall("./Controller/Trends/Trend"):
            name = t.get("Name","")
            trends[name] = {"pens": len(t.findall("./Pens/Pen"))}
        return trends

    trend_diff = diff_simple(get_trends(root_a), get_trends(root_b))

    # ── summary ───────────────────────────────────────────────────────────
    def _total(d):
        return len(d.get("added",[])) + len(d.get("removed",[])) + len(d.get("changed",[]))

    summary = {
        "controller": len(ctrl_changes),
        "tags": _total(ctrl_tags_diff),
        "dataTypes": _total(dtype_diff),
        "aois": _total(aoi_diff),
        "programs": _total(prog_diff),
        "modules": _total(module_diff),
        "tasks": _total(task_diff),
        "trends": _total(trend_diff),
    }
    summary["total"] = sum(summary.values())

    return {
        "summary": summary,
        "controller": ctrl_changes,
        "tags": ctrl_tags_diff,
        "dataTypes": dtype_diff,
        "aois": aoi_diff,
        "programs": prog_diff,
        "modules": module_diff,
        "tasks": task_diff,
        "trends": trend_diff,
    }


def migrate_change(root_src, root_dst, change_type: str, name: str, program: str | None = None):
    """Copy an element from root_src into root_dst (in place). Returns root_dst."""
    from copy import deepcopy

    if change_type == "tag":
        if program:
            sp = root_src.find(f"./Controller/Programs/Program[@Name='{program}']")
            dp = root_dst.find(f"./Controller/Programs/Program[@Name='{program}']")
            src_scope = sp.find("Tags") if sp is not None else None
            dst_scope = dp.find("Tags") if dp is not None else None
            if dst_scope is None and dp is not None:
                dst_scope = etree.SubElement(dp, "Tags")
        else:
            src_scope = root_src.find("./Controller/Tags")
            dst_scope = root_dst.find("./Controller/Tags")
            if dst_scope is None:
                ctrl = root_dst.find("Controller")
                dst_scope = etree.SubElement(ctrl, "Tags")
        if src_scope is None: raise ValueError(f"Tag scope not found in source for '{name}'")
        el = src_scope.find(f"Tag[@Name='{name}']")
        if el is None: raise ValueError(f"Tag '{name}' not found in source")
        if dst_scope is not None:
            old = dst_scope.find(f"Tag[@Name='{name}']")
            if old is not None: dst_scope.remove(old)
            dst_scope.append(deepcopy(el))

    elif change_type == "datatype":
        src_dts = root_src.find("./Controller/DataTypes")
        dst_dts = root_dst.find("./Controller/DataTypes")
        if src_dts is None: raise ValueError("DataTypes not in source")
        el = src_dts.find(f"DataType[@Name='{name}']")
        if el is None: raise ValueError(f"DataType '{name}' not in source")
        if dst_dts is None:
            ctrl = root_dst.find("Controller")
            dst_dts = etree.SubElement(ctrl, "DataTypes")
        old = dst_dts.find(f"DataType[@Name='{name}']")
        if old is not None: dst_dts.remove(old)
        dst_dts.append(deepcopy(el))

    elif change_type == "aoi":
        src_a = root_src.find("./Controller/AddOnInstructionDefinitions")
        dst_a = root_dst.find("./Controller/AddOnInstructionDefinitions")
        if src_a is None: raise ValueError("AOI defs not in source")
        el = src_a.find(f"AddOnInstructionDefinition[@Name='{name}']")
        if el is None: raise ValueError(f"AOI '{name}' not in source")
        if dst_a is None:
            ctrl = root_dst.find("Controller")
            dst_a = etree.SubElement(ctrl, "AddOnInstructionDefinitions")
        old = dst_a.find(f"AddOnInstructionDefinition[@Name='{name}']")
        if old is not None: dst_a.remove(old)
        dst_a.append(deepcopy(el))

    elif change_type == "routine":
        if not program: raise ValueError("program required for routine migration")
        sp = root_src.find(f"./Controller/Programs/Program[@Name='{program}']")
        dp = root_dst.find(f"./Controller/Programs/Program[@Name='{program}']")
        if sp is None: raise ValueError(f"Program '{program}' not in source")
        if dp is None: raise ValueError(f"Program '{program}' not in destination — migrate the program first")
        src_r = sp.find("Routines")
        el = src_r.find(f"Routine[@Name='{name}']") if src_r is not None else None
        if el is None: raise ValueError(f"Routine '{name}' not in source program '{program}'")
        dst_r = dp.find("Routines")
        if dst_r is None: dst_r = etree.SubElement(dp, "Routines")
        old = dst_r.find(f"Routine[@Name='{name}']")
        if old is not None: dst_r.remove(old)
        dst_r.append(deepcopy(el))

    else:
        raise ValueError(f"Unknown change_type '{change_type}'")

    return root_dst
