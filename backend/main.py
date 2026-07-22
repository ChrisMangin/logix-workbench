"""
FastAPI backend — Studio 5000 L5X Editor.

The server keeps ONE open document in memory (the _doc global). All
mutating endpoints operate on the in-memory lxml tree (no XML round-
trips). The client never needs to hold the XML blob; it calls lightweight
summary/listing/detail endpoints for navigation and /api/download when
it wants the file.
"""
import os, sys, io, threading, time, base64, hashlib
from typing import Optional, List

from fastapi import Form, FastAPI, HTTPException, UploadFile, File
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from fastapi.responses import StreamingResponse, Response
from pydantic import BaseModel

import l5x_handler as l5x

app = FastAPI(title="L5X Editor")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ── in-memory document state ──────────────────────────────────────────────────
_lock = threading.Lock()
_doc  = {"root": None, "name": "untitled"}   # root = lxml _Element

# ── parse cache (hash → root) avoids re-parsing the same file twice ──────────
# Keyed by SHA-1 of the raw XML bytes.  Max 6 entries — LRU eviction.
_PARSE_CACHE_MAX = 6
_parse_cache: dict = {}   # sha1_hex -> etree._Element

def _cache_parse(raw: bytes):
    """Parse raw XML bytes, using the cache to skip repeat parses."""
    h = hashlib.sha1(raw).hexdigest()
    if h in _parse_cache:
        return _parse_cache[h], h
    root = l5x.parse_xml(raw).getroot()
    if len(_parse_cache) >= _PARSE_CACHE_MAX:
        del _parse_cache[next(iter(_parse_cache))]
    _parse_cache[h] = root
    return root, h

# ── compare session cache — holds the last compared roots so migrate
#    calls don't need to re-parse or re-upload the same files again ─────────────
_cmp_cache = {"ha": None, "hb": None, "root_a": None, "root_b": None,
              "path_a": None, "path_b": None}   # paths set when opened by path

def _root() -> "etree._Element":
    if _doc["root"] is None:
        raise HTTPException(400, "No project open — create a new project or open an .L5X file first")
    return _doc["root"]

def _set_root(root) -> None:
    with _lock:
        _doc["root"] = root

def _summary():
    return l5x.summarize(_root())

def _err(e: Exception):
    raise HTTPException(400, str(e))

# ── heartbeat / auto-exit ────────────────────────────────────────────────────
# The frontend sends POST /api/heartbeat every 5 s.  A watchdog thread exits
# the process if no heartbeat arrives for 30 s after the first one — so
# closing the last browser tab automatically shuts the server down.
# A tab-count is also maintained so that /api/tab/disconnect can trigger an
# immediate clean exit when the last tab is gone.

_hb_lock         = threading.Lock()
_hb_last         = 0.0   # epoch of last heartbeat; 0 = none received yet
_tab_count       = 0
_exit_timer      = None  # cancellable timer so a browser refresh doesn't kill the server

@app.post("/api/heartbeat")
def api_heartbeat():
    global _hb_last
    with _hb_lock:
        _hb_last = time.time()
    return {"ok": True}

@app.post("/api/tab/connect")
def api_tab_connect():
    global _tab_count, _exit_timer
    with _hb_lock:
        _tab_count += 1
        _hb_last = time.time()
        # Cancel any pending exit — a refresh fires disconnect then connect quickly
        if _exit_timer is not None:
            _exit_timer.cancel()
            _exit_timer = None
    return {"tabs": _tab_count}

@app.post("/api/tab/disconnect")
def api_tab_disconnect():
    global _tab_count, _exit_timer
    with _hb_lock:
        _tab_count = max(0, _tab_count - 1)
        remaining = _tab_count
    if remaining == 0:
        # 5 s grace period so a browser refresh (disconnect → connect) doesn't kill the server
        t = threading.Timer(5.0, lambda: os._exit(0))
        t.daemon = True
        with _hb_lock:
            _exit_timer = t
        t.start()
    return {"tabs": remaining}

def _heartbeat_watchdog():
    """Exits the process if no heartbeat is received for 30 s (after the first one)."""
    while True:
        time.sleep(10)
        with _hb_lock:
            last = _hb_last
        if last > 0 and (time.time() - last) > 30:
            print("Watchdog: no heartbeat for 30 s — exiting")
            os._exit(0)

threading.Thread(target=_heartbeat_watchdog, daemon=True, name="hb-watchdog").start()


# ── models ────────────────────────────────────────────────────────────────────

class NewProjectReq(BaseModel):
    controllerName: str
    processorType:  str = "1756-L83E"
    majorRev:       str = "32"
    minorRev:       str = "11"

class TagReq(BaseModel):
    name:           str
    dataType:       str
    value:          str  = ""
    description:    str  = ""
    program:        Optional[str] = None
    radix:          str  = "Decimal"
    externalAccess: str  = "Read/Write"
    constant:       bool = False
    dimensions:     int  = 0
    arrayValues:    List[str] = []

class EditTagReq(TagReq):
    oldName: str

class DeleteTagReq(BaseModel):
    name:    str
    program: Optional[str] = None

class ProgramReq(BaseModel):
    name: str

class RoutineReq(BaseModel):
    program: str
    name:    str
    type:    str = "RLL"

class DeleteRoutineReq(BaseModel):
    program: str
    name:    str

class STEditReq(BaseModel):
    program: str
    name:    str
    content: str

class RungAddReq(BaseModel):
    program: str
    routine: str
    text:    str
    comment: str           = ""
    index:   Optional[int] = None

class RungEditReq(BaseModel):
    program: str
    routine: str
    number:  int
    text:    str
    comment: str = ""

class RungMoveReq(BaseModel):
    program: str
    routine: str
    frm:     int = 0
    to:      int = 0

class RungDeleteReq(BaseModel):
    program: str
    routine: str
    number:  int

class DataTypeMemberReq(BaseModel):
    name:        str
    dataType:    str
    dimension:   int = 0
    radix:       str = "Decimal"
    access:      str = "Read/Write"
    description: str = ""

class DataTypeAddReq(BaseModel):
    name:        str
    description: str = ""
    members:     List[DataTypeMemberReq]

class AoiParamReq(BaseModel):
    name:        str
    dataType:    str
    usage:       str = "Input"
    required:    bool = False
    description: str = ""

class AoiAddReq(BaseModel):
    name:        str
    description: str = ""
    parameters:  List[AoiParamReq]

class AoiUpdateReq(BaseModel):
    name:        str
    description: str = ""
    parameters:  List[AoiParamReq]

class AoiDeleteReq(BaseModel):
    name:  str
    force: bool = False

class AoiRungAddReq(BaseModel):
    aoi:     str
    routine: str = "Logic"
    text:    str
    comment: str = ""
    index:   Optional[int] = None

class AoiRungEditReq(BaseModel):
    aoi:     str
    routine: str = "Logic"
    number:  int
    text:    str
    comment: str = ""

class AoiRungDeleteReq(BaseModel):
    aoi:     str
    routine: str = "Logic"
    number:  int

class DataTypeUpdateReq(BaseModel):
    name:        str
    description: str = ""
    members:     List[DataTypeMemberReq]

class TrendMetaReq(BaseModel):
    name:         str
    samplePeriod: str = ""
    captureSize:  str = ""

class TrendPenReq(BaseModel):
    name:    str
    color:   str = ""
    visible: bool = True
    type:    str = "Analog"
    width:   str = "1"
    marker:  str = "0"
    min:     str = ""
    max:     str = ""

class TrendPensReq(BaseModel):
    name: str
    pens: List[TrendPenReq]

class TrendDeleteReq(BaseModel):
    name: str

class TrendDuplicateReq(BaseModel):
    srcName: str
    newName: str

class ModuleReq(BaseModel):
    name: str
    catalogNumber: str = ""
    vendor: str = "1"
    parentModule: str = "Local"
    inhibited: str = "false"

class ModuleEditReq(BaseModel):
    oldName: str
    name: str
    catalogNumber: str = ""
    vendor: str = "1"
    parentModule: str = "Local"
    inhibited: str = "false"

class ModuleDeleteReq(BaseModel):
    name: str

class TaskReq(BaseModel):
    name: str
    taskType: str = "PERIODIC"
    rate: float = 10.0
    priority: int = 10
    watchdog: float = 500.0

class TaskDeleteReq(BaseModel):
    name: str

# ── project open/new ──────────────────────────────────────────────────────────

@app.post("/api/new")
def api_new(req: NewProjectReq):
    try:
        root = l5x.new_project(req.controllerName, req.processorType, req.majorRev, req.minorRev)
        _set_root(root)
        _doc["name"] = req.controllerName
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/open")
async def api_open(file: UploadFile = File(...)):
    try:
        data = await file.read()
        tree = l5x.parse_xml(data)
        root = tree.getroot()
        _set_root(root)
        _doc["name"] = file.filename.replace(".L5X","").replace(".l5x","")
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/open_path")
def api_open_path(path: str = Form(...)):
    """Open an L5X file directly from the local filesystem path.
    Avoids the HTTP upload overhead for large files on the same machine."""
    try:
        path = path.strip()
        if not os.path.isfile(path):
            raise HTTPException(400, f"File not found: {path}")
        with open(path, "rb") as f:
            raw = f.read()
        root, _ = _cache_parse(raw)
        _set_root(root)
        _doc["name"] = os.path.basename(path).rsplit(".", 1)[0]
        return _summary()
    except HTTPException: raise
    except Exception as e: _err(e)

@app.post("/api/pick_file")
def api_pick_file(title: str = Form("Open L5X File")):
    """Show a native OS file-open dialog and return the chosen path.
    Uses tkinter (stdlib) -- no extra packages required.
    The dialog appears on top of all windows so it is not lost behind the browser."""
    try:
        import tkinter as tk
        from tkinter import filedialog
        root = tk.Tk()
        root.withdraw()                          # hide the empty Tk root window
        root.wm_attributes("-topmost", 1)        # float above browser
        path = filedialog.askopenfilename(
            parent=root,
            title=title,
            filetypes=[("L5X files", "*.l5x *.L5X"), ("All files", "*.*")]
        )
        root.destroy()
        return {"path": path or ""}
    except Exception as e:
        _err(e)

@app.get("/api/summary")
def api_summary():
    try:
        return _summary()
    except Exception as e: _err(e)

@app.get("/api/download")
def api_download():
    try:
        xml_str = l5x.to_xml_string(_root())
        fname   = _doc.get("name", "project") + ".L5X"
        return Response(
            content=xml_str.encode("utf-8"),
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{fname}"'}
        )
    except Exception as e: _err(e)

@app.post("/api/validate")
def api_validate():
    try:
        return l5x.validate(_root())
    except Exception as e: _err(e)

# ── tags (paginated) ──────────────────────────────────────────────────────────

@app.get("/api/tags")
def api_tags_list(program: Optional[str] = None, search: str = "",
                  offset: int = 0, limit: int = 100):
    try:
        return l5x.list_tags(_root(), program, search, offset, limit)
    except Exception as e: _err(e)

@app.post("/api/tags/add")
def api_tags_add(req: TagReq):
    try:
        l5x.add_tag(_root(), req.name, req.dataType, req.value, req.description,
                    req.program, req.radix, req.externalAccess, req.constant,
                    req.dimensions, req.arrayValues)
        return l5x.list_tags(_root(), req.program)
    except Exception as e: _err(e)

@app.post("/api/tags/edit")
def api_tags_edit(req: EditTagReq):
    try:
        l5x.edit_tag(_root(), req.oldName, req.name, req.dataType, req.value,
                     req.description, req.program, req.radix, req.externalAccess,
                     req.constant, req.dimensions, req.arrayValues)
        return l5x.list_tags(_root(), req.program)
    except Exception as e: _err(e)

@app.post("/api/tags/delete")
def api_tags_delete(req: DeleteTagReq):
    try:
        l5x.delete_tag(_root(), req.name, req.program)
        return l5x.list_tags(_root(), req.program)
    except Exception as e: _err(e)

# ── programs ──────────────────────────────────────────────────────────────────

@app.post("/api/programs/add")
def api_programs_add(req: ProgramReq):
    try:
        l5x.add_program(_root(), req.name)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/programs/delete")
def api_programs_delete(req: ProgramReq):
    try:
        l5x.delete_program(_root(), req.name)
        return _summary()
    except Exception as e: _err(e)

# ── routines ──────────────────────────────────────────────────────────────────

@app.post("/api/routines/add")
def api_routines_add(req: RoutineReq):
    try:
        l5x.add_routine(_root(), req.program, req.name, req.type)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/routines/delete")
def api_routines_delete(req: DeleteRoutineReq):
    try:
        l5x.delete_routine(_root(), req.program, req.name)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/routines/edit-st")
def api_routines_edit_st(req: STEditReq):
    try:
        l5x.edit_st_routine(_root(), req.program, req.name, req.content)
        return {"ok": True}
    except Exception as e: _err(e)

@app.get("/api/routines/detail")
def api_routine_detail(program: str, name: str,
                       rung_offset: int = 0, rung_limit: int = 200):
    try:
        return l5x.get_routine_detail(_root(), program, name, rung_offset, rung_limit)
    except Exception as e: _err(e)

# ── rungs ─────────────────────────────────────────────────────────────────────

@app.post("/api/rungs/add")
def api_rungs_add(req: RungAddReq):
    try:
        l5x.add_rung(_root(), req.program, req.routine, req.text, req.comment, req.index)
        return l5x.get_routine_detail(_root(), req.program, req.routine)
    except Exception as e: _err(e)

@app.post("/api/rungs/edit")
def api_rungs_edit(req: RungEditReq):
    try:
        l5x.edit_rung(_root(), req.program, req.routine, req.number, req.text, req.comment)
        return l5x.get_routine_detail(_root(), req.program, req.routine)
    except Exception as e: _err(e)


@app.post("/api/rungs/move")
def api_rung_move(req: RungMoveReq):
    # pydantic uses 'from' as alias since it's a reserved word
    from_num = req.frm
    try:
        l5x.move_rung(_root(), req.program, req.routine, from_num, req.to)
        return {"ok": True}
    except Exception as e: _err(e)

@app.post("/api/rungs/delete")
def api_rungs_delete(req: RungDeleteReq):
    try:
        l5x.delete_rung(_root(), req.program, req.routine, req.number)
        return l5x.get_routine_detail(_root(), req.program, req.routine)
    except Exception as e: _err(e)

# ── data types / AOI detail ───────────────────────────────────────────────────

@app.get("/api/datatypes/detail")
def api_dt_detail(name: str):
    try:
        return l5x.get_datatype_detail(_root(), name)
    except Exception as e: _err(e)

@app.get("/api/aoi/detail")
def api_aoi_detail(name: str):
    try:
        return l5x.get_aoi_detail(_root(), name)
    except Exception as e: _err(e)

@app.post("/api/datatypes/add")
def api_dt_add(req: DataTypeAddReq):
    try:
        l5x.add_data_type(_root(), req.name, req.description, [m.dict() for m in req.members])
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/aoi/add")
def api_aoi_add(req: AoiAddReq):
    try:
        l5x.add_aoi(_root(), req.name, req.description, [p.dict() for p in req.parameters])
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/aoi/update")
def api_aoi_update(req: AoiUpdateReq):
    try:
        l5x.update_aoi(_root(), req.name, req.description, [p.dict() for p in req.parameters])
        return l5x.get_aoi_detail(_root(), req.name)
    except Exception as e: _err(e)

@app.post("/api/aoi/delete")
def api_aoi_delete(req: AoiDeleteReq):
    try:
        usages = l5x.delete_aoi(_root(), req.name, req.force)
        if usages:
            raise HTTPException(409, f"AOI '{req.name}' is still used in {len(usages)} rung(s): " + "; ".join(usages[:8]) + (" ..." if len(usages) > 8 else ""))
        return _summary()
    except HTTPException: raise
    except Exception as e: _err(e)

@app.post("/api/aoi/rungs/add")
def api_aoi_rungs_add(req: AoiRungAddReq):
    try:
        l5x.add_aoi_rung(_root(), req.aoi, req.routine, req.text, req.comment, req.index)
        return l5x.get_aoi_detail(_root(), req.aoi)
    except Exception as e: _err(e)

@app.post("/api/aoi/rungs/edit")
def api_aoi_rungs_edit(req: AoiRungEditReq):
    try:
        l5x.edit_aoi_rung(_root(), req.aoi, req.routine, req.number, req.text, req.comment)
        return l5x.get_aoi_detail(_root(), req.aoi)
    except Exception as e: _err(e)

@app.post("/api/aoi/rungs/delete")
def api_aoi_rungs_delete(req: AoiRungDeleteReq):
    try:
        l5x.delete_aoi_rung(_root(), req.aoi, req.routine, req.number)
        return l5x.get_aoi_detail(_root(), req.aoi)
    except Exception as e: _err(e)

@app.get("/api/search")
def api_search(q: str, limit: int = 200):
    try:
        return l5x.search_xref(_root(), q, limit)
    except Exception as e: _err(e)

@app.post("/api/datatypes/update")
def api_dt_update(req: DataTypeUpdateReq):
    try:
        l5x.update_data_type(_root(), req.name, req.description, [m.dict() for m in req.members])
        return l5x.get_datatype_detail(_root(), req.name)
    except Exception as e: _err(e)

@app.get("/api/tags/detail")
def api_tag_detail(name: str, program: Optional[str] = None):
    try:
        return l5x.get_tag_detail(_root(), program, name)
    except Exception as e: _err(e)

# ── trends ────────────────────────────────────────────────────────────────────

@app.get("/api/trends/detail")
def api_trend_detail(name: str):
    try:
        return l5x.get_trend_detail(_root(), name)
    except Exception as e: _err(e)

@app.post("/api/trends/update-meta")
def api_trend_update_meta(req: TrendMetaReq):
    try:
        l5x.update_trend_meta(_root(), req.name, req.samplePeriod, req.captureSize)
        return l5x.get_trend_detail(_root(), req.name)
    except Exception as e: _err(e)

@app.post("/api/trends/set-pens")
def api_trend_set_pens(req: TrendPensReq):
    try:
        l5x.set_trend_pens(_root(), req.name, [p.dict() for p in req.pens])
        return l5x.get_trend_detail(_root(), req.name)
    except Exception as e: _err(e)

@app.post("/api/trends/delete")
def api_trend_delete(req: TrendDeleteReq):
    try:
        l5x.delete_trend(_root(), req.name)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/trends/duplicate")
def api_trend_duplicate(req: TrendDuplicateReq):
    try:
        l5x.duplicate_trend(_root(), req.srcName, req.newName)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/tasks/add")
def api_task_add(req: TaskReq):
    try:
        l5x.add_task(_root(), req.name, req.taskType, req.rate, req.priority, req.watchdog)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/tasks/delete")
def api_task_delete(req: TaskDeleteReq):
    try:
        l5x.delete_task(_root(), req.name)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/modules/add")
def api_module_add(req: ModuleReq):
    try:
        l5x.add_module(_root(), req.name, req.catalogNumber, req.vendor, req.parentModule, req.inhibited)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/modules/edit")
def api_module_edit(req: ModuleEditReq):
    try:
        l5x.edit_module(_root(), req.oldName, req.name, req.catalogNumber, req.vendor, req.parentModule, req.inhibited)
        return _summary()
    except Exception as e: _err(e)

@app.post("/api/modules/delete")
def api_module_delete(req: ModuleDeleteReq):
    try:
        l5x.delete_module(_root(), req.name)
        return _summary()
    except Exception as e: _err(e)


# ── file comparison ────────────────────────────────────────────────────────────

@app.post("/api/compare")
async def api_compare(fileA: UploadFile = File(...), fileB: UploadFile = File(...),
                      include_comments: str = Form("false"),
                      include_values: str = Form("false")):
    """Compare two L5X files without loading either into the main doc slot."""
    try:
        raw_a = await fileA.read()
        raw_b = await fileB.read()
        root_a, ha = _cache_parse(raw_a)
        root_b, hb = _cache_parse(raw_b)
        # Cache roots for subsequent migrate calls (avoids re-parse)
        _cmp_cache.update(ha=ha, hb=hb, root_a=root_a, root_b=root_b)
        return l5x.compare_l5x(
            root_a, root_b,
            include_comments=(include_comments.lower()=="true"),
            include_values=(include_values.lower()=="true"),
        )
    except Exception as e: _err(e)

@app.post("/api/compare/migrate")
async def api_compare_migrate(
    fileA: UploadFile = File(...),
    fileB: UploadFile = File(...),
    direction: str = Form(...),
    change_type: str = Form(...),
    name: str = Form(...),
    program: str = Form(""),
):
    """Copy one element between two files. direction='AtoB' copies A->B, 'BtoA' copies B->A.
    Returns the modified file as an attachment download."""
    try:
        raw_a = await fileA.read()
        raw_b = await fileB.read()
        root_a = l5x.parse_xml(raw_a).getroot()
        root_b = l5x.parse_xml(raw_b).getroot()
        prog = program or None
        if direction == "AtoB":
            modified = l5x.migrate_change(root_a, root_b, change_type, name, prog)
            out_name = fileB.filename or "modified_B.l5x"
        else:
            modified = l5x.migrate_change(root_b, root_a, change_type, name, prog)
            out_name = fileA.filename or "modified_A.l5x"
        xml_bytes = l5x.to_xml_string(modified).encode("utf-8")
        return StreamingResponse(
            io.BytesIO(xml_bytes),
            media_type="application/xml",
            headers={"Content-Disposition": f'attachment; filename="{out_name}"'}
        )
    except Exception as e: _err(e)

@app.post("/api/compare/migrate_and_compare")
async def api_compare_migrate_and_compare(
    fileA: UploadFile = File(...),
    fileB: UploadFile = File(...),
    direction: str = Form(...),
    change_type: str = Form(...),
    name: str = Form(...),
    program: str = Form(""),
):
    """Migrate one element then re-compare in a single round trip.
    Returns JSON: {modified_bytes: base64, modified_side: 'A'|'B', comparison: {...}}"""
    try:
        raw_a = await fileA.read()
        raw_b = await fileB.read()
        # Re-use cached parse if available (avoids re-parsing 100+ MB files)
        ha = hashlib.sha1(raw_a).hexdigest()
        hb = hashlib.sha1(raw_b).hexdigest()
        root_a = _cmp_cache["root_a"] if ha == _cmp_cache["ha"] else _cache_parse(raw_a)[0]
        root_b = _cmp_cache["root_b"] if hb == _cmp_cache["hb"] else _cache_parse(raw_b)[0]
        prog = program or None
        if direction == "AtoB":
            modified = l5x.migrate_change(root_a, root_b, change_type, name, prog)
            modified_bytes = l5x.to_xml_string(modified).encode("utf-8")
            new_root_b, nhb = _cache_parse(modified_bytes)
            _cmp_cache.update(ha=ha, hb=nhb, root_a=root_a, root_b=new_root_b)
            comparison = l5x.compare_l5x(root_a, new_root_b)
            modified_side = "B"
        else:
            modified = l5x.migrate_change(root_b, root_a, change_type, name, prog)
            modified_bytes = l5x.to_xml_string(modified).encode("utf-8")
            new_root_a, nha = _cache_parse(modified_bytes)
            _cmp_cache.update(ha=nha, hb=hb, root_a=new_root_a, root_b=root_b)
            comparison = l5x.compare_l5x(new_root_a, root_b)
            modified_side = "A"
        return {
            "modified_bytes": base64.b64encode(modified_bytes).decode("ascii"),
            "modified_side": modified_side,
            "comparison": comparison,
        }
    except Exception as e: _err(e)


@app.post("/api/compare_paths")
def api_compare_paths(pathA: str = Form(...), pathB: str = Form(...),
                      include_comments: str = Form("false"),
                      include_values: str = Form("false")):
    """Compare two L5X files by local filesystem path — no upload needed."""
    try:
        for p in (pathA, pathB):
            if not os.path.isfile(p.strip()):
                raise HTTPException(400, f"File not found: {p}")
        with open(pathA.strip(), "rb") as f: raw_a = f.read()
        with open(pathB.strip(), "rb") as f: raw_b = f.read()
        root_a, ha = _cache_parse(raw_a)
        root_b, hb = _cache_parse(raw_b)
        _cmp_cache.update(ha=ha, hb=hb, root_a=root_a, root_b=root_b,
                          path_a=pathA.strip(), path_b=pathB.strip())
        return l5x.compare_l5x(
            root_a, root_b,
            include_comments=(include_comments.lower()=="true"),
            include_values=(include_values.lower()=="true"),
        )
    except HTTPException: raise
    except Exception as e: _err(e)

@app.post("/api/compare/migrate_and_compare_cached")
def api_compare_migrate_cached(direction: str = Form(...),
                               change_type: str = Form(...),
                               name: str = Form(...),
                               program: str = Form(""),
                               include_comments: str = Form("false"),
                               include_values: str = Form("false")):
    """Migrate + re-compare using the server-side cached roots — no file upload needed."""
    try:
        root_a = _cmp_cache.get("root_a")
        root_b = _cmp_cache.get("root_b")
        if root_a is None or root_b is None:
            raise HTTPException(400, "No cached comparison — run a path-based compare first")
        prog = program or None
        if direction == "AtoB":
            modified = l5x.migrate_change(root_a, root_b, change_type, name, prog)
            modified_bytes = l5x.to_xml_string(modified).encode("utf-8")
            new_root_b, nhb = _cache_parse(modified_bytes)
            _cmp_cache.update(hb=nhb, root_b=new_root_b)
            # Write back to disk if we have a path
            path_b = _cmp_cache.get("path_b")
            if path_b:
                with open(path_b, "wb") as f: f.write(modified_bytes)
            comparison = l5x.compare_l5x(root_a, new_root_b,
                include_comments=(include_comments.lower()=="true"),
                include_values=(include_values.lower()=="true"))
            return {"comparison": comparison, "modified_side": "B",
                    "modified_bytes": base64.b64encode(modified_bytes).decode("ascii")}
        else:
            modified = l5x.migrate_change(root_b, root_a, change_type, name, prog)
            modified_bytes = l5x.to_xml_string(modified).encode("utf-8")
            new_root_a, nha = _cache_parse(modified_bytes)
            _cmp_cache.update(ha=nha, root_a=new_root_a)
            path_a = _cmp_cache.get("path_a")
            if path_a:
                with open(path_a, "wb") as f: f.write(modified_bytes)
            comparison = l5x.compare_l5x(new_root_a, root_b,
                include_comments=(include_comments.lower()=="true"),
                include_values=(include_values.lower()=="true"))
            return {"comparison": comparison, "modified_side": "A",
                    "modified_bytes": base64.b64encode(modified_bytes).decode("ascii")}
    except HTTPException: raise
    except Exception as e: _err(e)

# ── serve frontend ────────────────────────────────────────────────────────────

def _frontend_dir():
    if getattr(sys, "frozen", False) and hasattr(sys, "_MEIPASS"):
        d = os.path.join(sys._MEIPASS, "frontend")
        if os.path.isdir(d):
            return d
    return os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "frontend")

_fd = _frontend_dir()
if os.path.isdir(_fd):
    app.mount("/", StaticFiles(directory=_fd, html=True), name="static")
