/* ── L5X Editor — Studio 5000–style UI ─────────────────────────────────── *
 * No XML is held in the browser. All state lives server-side.
 * Every click hits a lightweight REST endpoint.
 * ──────────────────────────────────────────────────────────────────────── */
"use strict";

const API = "";
let _summary  = null;
let _active   = null;
let _modified = false;
let _customInstructionsReady = Promise.resolve();

const qs  = s => document.querySelector(s);
const mk  = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };
const mkB = (label, cls, cb) => { const b = mk("button", cls); b.textContent = label; b.onclick = cb; return b; };

let _toastTimer;
function toast(msg, type = "ok") {
  const t = qs("#toast");
  t.textContent = msg; t.className = "show " + type;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => t.className = "", 2800);
}

async function api(method, path, body) {
  const opts = { method };
  if (body) { opts.headers = {"Content-Type":"application/json"}; opts.body = JSON.stringify(body); }
  const r = await fetch(API + path, opts);
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.detail || r.statusText);
  return d;
}
const GET  = path         => api("GET",  path);
const POST = (path, body) => api("POST", path, body);

function setModified(val) {
  _modified = val;
  qs("#modifiedFlag").classList.toggle("hidden", !val);
  // Keep the active tab's .modified flag in sync so the X-button close also prompts
  const _curTab = typeof _edGetActive === "function" ? _edGetActive() : null;
  if (_curTab && _curTab.id === _edActiveId) _curTab.modified = val;
}

async function refresh(newSummary) {
  _summary = newSummary || await GET("/api/summary");
  setModified(true);
  const n = _summary.controller.name;
  qs("#docName").textContent = n + ".L5X";
  qs("#statusText").textContent = `${n}  •  ${_summary.counts.programs} programs  •  ${_summary.counts.tasks||0} tasks  •  ${_summary.counts.tags} ctrl tags  •  ${_summary.counts.dataTypes} UDTs  •  ${_summary.counts.modules} modules`;
  qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = false;
  _customInstructionsReady = loadCustomInstructions();
  _tbRender();
  renderTree();
  if (_active) renderContent(_active);
}

async function loadSummary(s) {
  _summary = s;
  setModified(false);
  // Update current editor tab (create one if none — e.g. new project from welcome screen)
  const edTab = _edEnsureTab();
  if (edTab) {
    edTab.summary = s; edTab.modified = false;
    edTab.label = (s.controller?.name||"Editor") + ".L5X";
  }
  const n = s.controller.name;
  qs("#docName").textContent = n + ".L5X";
  qs("#statusText").textContent = `${n}  •  ${s.counts.programs} programs  •  ${s.counts.tasks||0} tasks  •  ${s.counts.tags} ctrl tags  •  ${s.counts.dataTypes} UDTs  •  ${s.counts.modules} modules`;
  qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = false;
  const welcome = qs("#welcome"); if (welcome) welcome.remove();
  _setOrganizerVisible(true);
  renderTree();
  _active = {kind:"controller"}; renderContent(_active);
  _customInstructionsReady = loadCustomInstructions();
  _tbRender();
}

/** Fetches every AOI definition's parameters (usually a handful to a few
 * dozen) once per document load, so the visual rung builder can offer the
 * project's own Add-On Instructions alongside the built-in catalog. */
function loadCustomInstructions() {
  // Build custom instructions directly from summary data (parameters are now included).
  // No extra API calls needed — this runs instantly at file open time.
  if (!_summary || !_summary.aoiDefinitions.length) { setCustomInstructions([]); return Promise.resolve(); }
  const custom = _summary.aoiDefinitions.map(a => ({
    category: "Custom (AOI)",
    code: a.name,
    label: a.name,
    kind: "output",
    symbol: "block",
    operands: ["[Tag]", ...(a.parameters || []).map(p => p.name)],
  }));
  setCustomInstructions(custom);
  return Promise.resolve();
}

/* ── tree ───────────────────────────────────────────────────────────────── */
const _exp = new Set();

/* ── Organizer visibility ────────────────────────────────────────────────── */
function _setOrganizerVisible(visible) {
  const org = qs("#organizer"), rz = qs("#resizer");
  if (org) org.classList.toggle("hidden", !visible);
  if (rz)  rz.classList.toggle("hidden",  !visible);
}

/* ── Editor Tabs ─────────────────────────────────────────────────────────── */
let _edTabs = [];
let _edActiveId = null;
function _edGetActive() { return _edTabs.find(t=>t.id===_edActiveId)||_edTabs[0]||null; }
/** Ensure at least one editor tab exists and we're in editor mode. Returns the active tab. */
function _edEnsureTab() {
  if (_edTabs.length === 0) {
    const id = "ed_" + Date.now();
    _edTabs.push({id, label:"Editor", file:null, summary:null, active:null, exp:new Set(), modified:false});
    _edActiveId = id;
  }
  if (_cmpActiveTabId !== "editor") {
    const overlay = qs("#cmpOverlay");
    if (overlay) overlay.classList.add("hidden");
    _cmpActiveTabId = "editor";
  }
  return _edGetActive();
}
function _edSaveCurrent() {
  const t=_edGetActive(); if(!t) return;
  t.summary=_summary; t.active=_active?{..._active}:null;
  t.exp=new Set(_exp); t.modified=_modified;
}

function renderTree() {
  if (!_summary) return;
  const c = qs("#orgTree");
  const sv = qs("#treeSearch").value.trim().toLowerCase();
  c.innerHTML = "";
  const ctrl = mk("div","treeCtrlBar"); c.appendChild(ctrl);
  const colBtn = mkB("- Collapse All","treeCtrlBtn", () => { _exp.clear(); renderTree(); });
  const expBtn = mkB("+ Expand All","treeCtrlBtn", () => {
    const s2 = _summary; if (!s2) return;
    ["aois","trends","tasks",...(s2.tasks||[]).map(t=>"task_"+t.name),
     ...(s2.programs||[]).map(p=>"prog_"+p.name),
     ...(s2.tasks||[]).flatMap(t=>(t.scheduledPrograms||[]).map(pn=>"tkprog_"+t.name+"_"+pn))]
    .forEach(id=>_exp.add(id));
    renderTree();
  });
  colBtn.title = "Collapse all organizer nodes";
  expBtn.title = "Expand all organizer nodes";
  ctrl.appendChild(colBtn); ctrl.appendChild(expBtn);
  c.appendChild(buildTree(sv));
}

function row(indent, icon, label, meta, active, onClick, onAdd) {
  const r = mk("div", "treeRow" + (active ? " active" : ""));
  r.style.paddingLeft = (8 + indent * 14) + "px";
  r.appendChild(mk("span","treeToggle",""));
  r.appendChild(mk("span","treeIcon",icon));
  r.appendChild(mk("span","rowLabel",label));
  r.appendChild(mk("span","rowMeta", meta != null ? String(meta) : ""));
  if (onAdd) {
    const ab = mk("button","treeAddBtn","+"); ab.title="Add";
    ab.onclick = e => { e.stopPropagation(); onAdd(); }; r.appendChild(ab);
  }
  if (onClick) r.onclick = onClick;
  return r;
}

function folder(indent, icon, id, label, meta, onHead, onAdd) {
  const wrap = mk("div","treeNode");
  const open = _exp.has(id);
  const r = mk("div","treeRow");
  r.style.paddingLeft = (8 + indent * 14) + "px";
  r.appendChild(mk("span","treeToggle", open ? "▾" : "▸"));
  r.appendChild(mk("span","treeIcon",icon));
  r.appendChild(mk("span","rowLabel",label));
  r.appendChild(mk("span","rowMeta",meta != null ? String(meta) : ""));
  if (onAdd) {
    const ab = mk("button","treeAddBtn","+"); ab.title="Add";
    ab.onclick = e => { e.stopPropagation(); onAdd(); }; r.appendChild(ab);
  }
  r.onclick = () => { _exp.has(id) ? _exp.delete(id) : _exp.add(id); if (onHead) onHead(); else renderTree(); };
  wrap.appendChild(r);
  if (open) { const ch = mk("div","treeChildren"); wrap.appendChild(ch); wrap._ch = ch; }
  return wrap;
}

function isActive(kind, params) {
  if (!_active || _active.kind !== kind) return false;
  return Object.entries(params||{}).every(([k,v]) => _active[k] === v);
}

function buildTree(sv) {
  const s = _summary; const root = mk("div");

  root.appendChild(row(0,"🎛",s.controller.name,s.controller.processorType,
    isActive("controller"),
    ()=>{ _active={kind:"controller"}; renderTree(); renderContent(_active); }));

  root.appendChild(row(1,"🏷","Controller Tags",s.counts.tags,
    isActive("tags",{program:null}),
    ()=>{ _active={kind:"tags",program:null}; renderTree(); renderContent(_active); },
    ()=>openTagDialog(null)));

  /* Data Types — single click shows list in content pane (no dropdown) */
  root.appendChild(row(1,"📐","Data Types",s.counts.dataTypes,
    isActive("datatypes"),
    ()=>{ _active={kind:"datatypes"}; renderTree(); renderContent(_active); },
    ()=>openNewDataTypeDialog()));

  /* AOIs */
  const aoiF = folder(1,"⚙️","aois","Add-On Instructions",s.counts.aois,
    ()=>{ _active={kind:"aois"}; renderTree(); renderContent(_active); });
  if (_exp.has("aois") && aoiF._ch) {
    (sv ? s.aoiDefinitions.filter(a=>a.name.toLowerCase().includes(sv)) : s.aoiDefinitions).forEach(a=>{
      aoiF._ch.appendChild(row(2,"⚙️",a.name,"v"+a.revision,isActive("aoi",{name:a.name}),
        ()=>{ _active={kind:"aoi",name:a.name}; renderTree(); renderContent(_active); }));
    });
  }
  root.appendChild(aoiF);

  /* Modules — single click shows list in content pane (no dropdown) */
  root.appendChild(row(1,"🔌","I/O Configuration",s.counts.modules,
    isActive("modules"),
    ()=>{ _active={kind:"modules"}; renderTree(); renderContent(_active); },
    ()=>openNewModuleDialog()));

  /* Trends */
  const trF = folder(1,"📈","trends","Trends",(s.trends||[]).length,
    ()=>{ _active={kind:"trends"}; renderTree(); renderContent(_active); });
  if (_exp.has("trends") && trF._ch) {
    (sv ? (s.trends||[]).filter(t=>t.name.toLowerCase().includes(sv)) : (s.trends||[])).forEach(t=>{
      trF._ch.appendChild(row(2,"📈",t.name,t.penCount+" pens",isActive("trend",{name:t.name}),
        ()=>{ _active={kind:"trend",name:t.name}; renderTree(); renderContent(_active); }));
    });
  }
  root.appendChild(trF);

  /* Tasks */
  const tkF = folder(1,"⏱","tasks","Tasks",(s.tasks||[]).length,
    ()=>{ _active={kind:"tasks"}; renderTree(); renderContent(_active); },
    ()=>openNewTaskDialog());
  if (_exp.has("tasks") && tkF._ch) {
    (sv ? (s.tasks||[]).filter(t=>t.name.toLowerCase().includes(sv)) : (s.tasks||[])).forEach(t=>{
      const typeLabel = t.type==="PERIODIC"?"⏱":t.type==="EVENT"?"⚡":"🔄";
      const tId = "task_"+t.name;
      const tF = folder(2,typeLabel,tId,t.name,t.type.toLowerCase(),
        ()=>{ _active={kind:"task",name:t.name}; renderTree(); renderContent(_active); });
      tkF._ch.appendChild(tF);
      if (_exp.has(tId) && tF._ch) {
        (t.scheduledPrograms||[]).forEach(pname=>{
          const pp = s.programs.find(x=>x.name===pname);
          const pId = "tkprog_"+t.name+"_"+pname;
          const pF = folder(3,"📦",pId,pname,(pp?.routines?.length||0)+" rtns",
            ()=>{ _active={kind:"program",program:pname}; renderTree(); renderContent(_active); });
          tF._ch.appendChild(pF);
          if (_exp.has(pId) && pF._ch) {
            pF._ch.appendChild(row(4,"🏷","Tags",pp?.tagCount||0,isActive("tags",{program:pname}),
              ()=>{ _active={kind:"tags",program:pname}; renderTree(); renderContent(_active); },
              ()=>openTagDialog(pname)));
            const rId2="tkrtns_"+t.name+"_"+pname;
            const rF2=folder(4,"🧩",rId2,"Routines",pp?.routines?.length||0,
              ()=>{ _active={kind:"routines",program:pname}; renderTree(); renderContent(_active); },
              ()=>openNewRoutinePrompt(pname));
            pF._ch.appendChild(rF2);
            if (_exp.has(rId2) && rF2._ch) {
              (pp?.routines||[]).forEach(r=>{
                rF2._ch.appendChild(row(5,r.type==="RLL"?"🪜":"📝",r.name,
                  r.type==="RLL"?`[${r.rungCount}]`:"ST",
                  isActive("routine",{program:pname,name:r.name}),
                  ()=>{ _active={kind:"routine",program:pname,name:r.name,rungOffset:0}; renderTree(); renderContent(_active); }));
              });
            }
          }
        });
      }
    });
  }
  root.appendChild(tkF);

  return root;
}

/* ── content router ─────────────────────────────────────────────────────── */
// Context menu: right-click any row to copy name or value
function _addRowContextMenu(row, getName, getValue) {
  row.addEventListener("contextmenu", e => {
    e.preventDefault();
    const old = document.getElementById("rowCtxMenu"); if (old) old.remove();
    const menu = document.createElement("div");
    menu.id = "rowCtxMenu"; menu.className = "ctxMenu";
    menu.style.cssText = "position:fixed;left:"+e.clientX+"px;top:"+e.clientY+"px;z-index:99999;";
    function addItem(lbl, cb) {
      const it = document.createElement("div"); it.className = "ctxItem";
      it.textContent = lbl;
      it.onclick = () => { menu.remove(); cb(); };
      menu.appendChild(it);
    }
    const name = getName();
    const val  = getValue ? getValue() : null;
    if (name) addItem("Copy name: "+name, ()=>navigator.clipboard.writeText(name).then(()=>toast("Copied: "+name)));
    if (val != null && val !== "") addItem("Copy value: "+val, ()=>navigator.clipboard.writeText(String(val)).then(()=>toast("Copied: "+val)));
    if (!menu.children.length) return;
    document.body.appendChild(menu);
    setTimeout(()=>document.addEventListener("click", ()=>menu.remove(), {once:true}), 0);
  });
}

function renderContent(a) {
  const c = qs("#content"); c.innerHTML = "";
  if      (a.kind==="controller") showController(c);
  else if (a.kind==="tags")       showTags(c, a.program, a._search||"", a._offset||0);
  else if (a.kind==="datatypes")  showDatatypeList(c);
  else if (a.kind==="datatype")   showDatatypeDetail(c, a.name);
  else if (a.kind==="aois")       showAoiList(c);
  else if (a.kind==="aoi")        showAoiDetail(c, a.name);
  else if (a.kind==="modules")    showModuleList(c);
  else if (a.kind==="module")     showModuleDetail(c, a.name);
  else if (a.kind==="trends")     showTrendList(c);
  else if (a.kind==="trend")      showTrendDetail(c, a.name);
  else if (a.kind==="tasks")      showTaskList(c);
  else if (a.kind==="task")       showTaskDetail(c, a.name);
  else if (a.kind==="programs")   showProgramList(c);
  else if (a.kind==="program")    showProgramDetail(c, a.program);
  else if (a.kind==="routines")   showRoutineList(c, a.program);
  else if (a.kind==="routine")    showRoutine(c, a.program, a.name, a.rungOffset||0);
  else if (a.kind==="compare")    showComparePanel(c);
}

function panel() { const p = mk("div","panel"); qs("#content").appendChild(p); return p; }
function panelHead(title, ...btns) {
  const h = mk("div","panelHead"); h.innerHTML=`<h2>${title}</h2><span class="spacer"></span>`;
  btns.forEach(b=>h.appendChild(b)); return h;
}

/* ── controller info ────────────────────────────────────────────────────── */
function showController(c) {
  const s=_summary, p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("🎛 "+s.controller.name));
  const b=mk("div","panelBody"); p.appendChild(b);
  const g=mk("div","propGrid"); b.appendChild(g);
  [["Processor Type",s.controller.processorType],["Firmware",`${s.controller.majorRev}.${s.controller.minorRev}`],
   ["Project SN",s.controller.projectSN||"-"],["Comm Path",s.controller.commPath||"-"],
   ["Last Modified",s.controller.lastModified||"-"],["Controller Tags",s.counts.tags],
   ["Data Types",s.counts.dataTypes],["AOI Definitions",s.counts.aois],
   ["I/O Modules",s.counts.modules],["Programs",s.counts.programs]].forEach(([k,v])=>{
    g.appendChild(mk("div","pk",k)); g.appendChild(mk("div","pv",String(v||"-")));
  });
}

/* ── tags ────────────────────────────────────────────────────────────────── */
const TAG_PAGE=100;
/* Studio 5000 lets you expand a DINT tag to see its 32 individual bits,
 * walk into a UDT tag's members (which may themselves be UDTs or
 * integers-with-bits), or step through the elements of an array - all
 * recursively, with the actual stored value and per-operand comment (or
 * else the UDT member's own description) shown alongside each row. */
const BIT_WIDTH = {SINT:8, INT:16, DINT:32, LINT:64};
function _memberExpandable(dataType, dimension) {
  if (dimension && Number(dimension) > 0) return true; // can always drill into array elements
  if (BIT_WIDTH[dataType]) return true;
  if ((_summary?.dataTypes || []).some(d => d.name === dataType)) return true;
  // AOI-typed tags (instances of Add-On Instructions) are also expandable
  if ((_summary?.aoiDefinitions || []).some(a => a.name === dataType)) return true;
  return false;
}
function _pathKeys(path) { return path.map(p => p.key); }
function _operandStr(path) { return path.map(p => p.isIndex ? `[${p.key}]` : `.${p.key}`).join(""); }
function _lookupValue(tree, keys) {
  let cur = tree;
  for (const k of keys) { if (cur == null || typeof cur !== "object") return undefined; cur = cur[k]; }
  return cur;
}
async function _fetchTagCtx(program, name) {
  try { const d = await GET(`/api/tags/detail?name=${enc(name)}&program=${enc(program||"")}`); return {value: d.value, comments: d.comments || {}}; }
  catch (e) { return {value: null, comments: {}}; }
}
function _removeChildRows(row) {
  (row._childRows || []).forEach(ch => { _removeChildRows(ch); ch.remove(); });
  row._childRows = [];
}
function _fmtVal(v) {
  if (v == null || typeof v === "object") return "";
  return String(v);
}
/** Appends breakdown rows for one level (array indices, bits, or UDT
 * members) right after `afterRow`, recursively wiring further expand
 * buttons. `ctx` ({value,comments}) is the ONE tag-detail fetch done at
 * the top level - reused unchanged all the way down. `path` is the list
 * of {key,isIndex} steps taken from the root tag to get here. */
function _insertBreakdownRows(afterRow, label, dataType, dimension, depth, ctx, path) {
  const dim = Number(dimension || 0);
  if (dim > 0) {
    let cursor = afterRow; const rows = [];
    for (let i = 0; i < dim; i++) {
      const nm = `${label}[${i}]`;
      const childPath = [...path, {key: String(i), isIndex: true}];
      const val = _lookupValue(ctx.value, _pathKeys(childPath));
      const expandable = _memberExpandable(dataType, 0);
      const tr = mk("tr", "breakdownRow");
      tr.innerHTML = `<td style="padding-left:${16+depth*16}px">${expandable?'<button type="button" class="expArrow">▶</button>':'<span class="expArrowSpacer"></span>'}<span class="bdName">${nm}</span></td><td></td><td class="type">${dataType}</td><td class="val">${_fmtVal(val)}</td><td class="desc"></td><td></td>`;
      cursor.after(tr); cursor = tr; rows.push(tr);
      _addRowContextMenu(tr,
        () => nm,
        () => { try { return _lookupValue(ctx.value, _pathKeys(childPath)); } catch(e2) { return null; } });
      if (expandable) {
        const btn = tr.querySelector(".expArrow");
        btn.onclick = () => _toggleBreakdown(tr, nm, dataType, 0, depth+1, ctx, childPath, btn);
      }
    }
    afterRow._childRows = rows;
    return;
  }
  if (BIT_WIDTH[dataType]) {
    const raw = Number(_lookupValue(ctx.value, _pathKeys(path)) || 0);
    let cursor = afterRow; const rows = [];
    for (let i = 0; i < BIT_WIDTH[dataType]; i++) {
      const nm = `${label}.${i}`;
      const bitVal = (raw >> i) & 1;
      const tr = mk("tr", "breakdownRow");
      tr.innerHTML = `<td style="padding-left:${16+depth*16}px"><span class="expArrowSpacer"></span><span class="bdName">${nm}</span></td><td></td><td class="type">BOOL</td><td class="val">${bitVal}</td><td class="desc"></td><td></td>`;
      cursor.after(tr); cursor = tr; rows.push(tr);
    }
    afterRow._childRows = rows;
    return;
  }
  // UDT or AOI-typed tag — fetch the member list from the right endpoint
  const isAoiType = (_summary?.aoiDefinitions || []).some(a => a.name === dataType);
  const membersFetch = isAoiType
    ? GET(`/api/aoi/detail?name=${enc(dataType)}`).then(d =>
        d.parameters.filter(p => p.visible !== "false").map(p => ({
          name: p.name, dataType: p.dataType, dimension: "0", description: p.description,
        })))
    : GET(`/api/datatypes/detail?name=${enc(dataType)}`).then(d => d.members);
  membersFetch.then(members => {
    let cursor = afterRow; const rows = [];
    members.forEach(m => {
      const childPath = [...path, {key: m.name, isIndex: false}];
      const mdim = Number(m.dimension || 0);
      const val = mdim > 0 ? undefined : _lookupValue(ctx.value, _pathKeys(childPath));
      const operand = _operandStr(childPath);
      const desc = ctx.comments[operand] || m.description || "";
      const nm = `${label}.${m.name}`;
      const ty = mdim > 0 ? `${m.dataType}[${mdim}]` : m.dataType;
      const expandable = _memberExpandable(m.dataType, mdim);
      const tr = mk("tr", "breakdownRow");
      tr.innerHTML = `<td style="padding-left:${16+depth*16}px">${expandable?'<button type="button" class="expArrow">▶</button>':'<span class="expArrowSpacer"></span>'}<span class="bdName">${nm}</span></td><td></td><td class="type">${ty}</td><td class="val">${_fmtVal(val)}</td><td class="desc"></td><td></td>`;
      tr.querySelector(".desc").textContent = desc;
      cursor.after(tr); cursor = tr; rows.push(tr);
      if (expandable) {
        const btn = tr.querySelector(".expArrow");
        btn.onclick = () => _toggleBreakdown(tr, nm, m.dataType, mdim, depth+1, ctx, childPath, btn);
      }
    });
    afterRow._childRows = rows;
  }).catch(() => {});
}
function _toggleBreakdown(row, label, dataType, dimension, depth, ctx, path, btn) {
  if (row._childRows && row._childRows.length) {
    _removeChildRows(row);
    btn.textContent = "▶";
  } else {
    btn.textContent = "▼";
    _insertBreakdownRows(row, label, dataType, dimension, depth, ctx, path);
  }
}
/** Top-level tag row expand: fetches the tag's actual stored value tree +
 * per-operand comments ONCE, then reuses that same ctx for every nested
 * expand underneath it. */
function _toggleTopBreakdown(row, tg, program, btn) {
  if (row._childRows && row._childRows.length) {
    _removeChildRows(row);
    btn.textContent = "▶";
    return;
  }
  btn.textContent = "▼";
  btn.disabled = true;
  _fetchTagCtx(program, tg.name).then(ctx => {
    btn.disabled = false;
    const isAoiType = (_summary?.aoiDefinitions||[]).some(a=>a.name===tg.dataType);
    if (!tg.isArray && !isAoiType && !(_summary?.dataTypes||[]).some(d=>d.name===tg.dataType) && ctx.value == null) {
      ctx = {value: tg.value, comments: {}};
    }
    _insertBreakdownRows(row, tg.name, tg.dataType, tg.isArray ? tg.dimensions : 0, 1, ctx, []);
  });
}

function showTags(c, prog, search, offset) {
  c.innerHTML = "";
  const p=mk("div","panel"); c.appendChild(p);
  const title = prog ? "🏷 Tags — "+prog : "🏷 Controller Tags";
  p.appendChild(panelHead(title, mkB("+ New Tag","primary sm",()=>openTagDialog(prog))));
  const b=mk("div","panelBody"); p.appendChild(b);
  const fb=mk("div","filterBar"); b.appendChild(fb);
  const si=mk("input"); si.placeholder="Filter by name…"; si.value=search;
  si.oninput=debounce(()=>{ _active._search=si.value; _active._offset=0; showTags(c,prog,si.value,0); },300);
  fb.appendChild(si);
  const ldr=mk("p","empty","Loading…"); b.appendChild(ldr);
  GET(`/api/tags?`+new URLSearchParams({program:prog||"",search,offset,limit:TAG_PAGE}))
    .then(d=>{
      ldr.remove();
      if (!d.tags.length){ b.appendChild(mk("p","empty","No tags.")); return; }
      const sortCol=_active._sortCol||"name", sortDir=_active._sortDir!=null?_active._sortDir:1;
      const tags=[...d.tags].sort((a,b)=>{
        const k={name:"name","Tag Type":"tagType","Data Type":"dataType",value:"value",description:"description"}[sortCol]||"name";
        const av=String(a[k]||"").toLowerCase(),bv=String(b[k]||"").toLowerCase();
        return av<bv?-sortDir:av>bv?sortDir:0;
      });
      const t=mk("table","dataTable"); b.appendChild(t);
      function sortTh(lbl,col){const a=col===sortCol?(sortDir>0?"▴":"▾"):"";return `<th class="sortable" data-col="${col}">${lbl}<span class="sortArrow">${a}</span></th>`;}
      t.innerHTML=`<tr>${sortTh("Name","name")}${sortTh("Tag Type","tagType")}${sortTh("Data Type","Data Type")}${sortTh("Value","value")}${sortTh("Description","description")}<th></th></tr>`;
      t.querySelectorAll("th.sortable").forEach(th=>th.onclick=()=>{
        const col=th.dataset.col,dir=(col===sortCol)?-sortDir:1;
        _active._sortCol=col;_active._sortDir=dir;showTags(c,prog,search,offset);
      });
      tags.forEach(tg=>{
        const tr=mk("tr"); t.appendChild(tr);
        const isAlias = tg.tagType === "Alias";
        // Display alias types as "→ target" instead of an empty/null type cell
        const ty = isAlias && tg.aliasFor
          ? `<span class="aliasType" title="Alias for: ${tg.aliasFor}">→ ${tg.aliasFor}</span>`
          : (tg.isArray ? `${tg.dataType}[${tg.dimensions}]` : (tg.dataType || ""));
        const va=tg.isArray?`[${(tg.arrayValues||[]).slice(0,4).join(",")}${tg.dimensions>4?",…":""}]`:tg.value;
        // Alias tags are not expandable (they point to I/O module data)
        const expandable = !isAlias && _memberExpandable(tg.dataType, tg.isArray?tg.dimensions:0);
        const nameCell = expandable ? `<button type="button" class="expArrow">▶</button><span class="bdName">${tg.name}</span>` : tg.name;
        const tagTypeBadge = tg.tagType==="Alias" ? '<span class="tagTypeBadge tagTypeBadgeAlias">Alias</span>'
          : tg.tagType==="ProducedTag" ? '<span class="tagTypeBadge tagTypeBadgeProd">Produced</span>'
          : tg.tagType==="ConsumedTag" ? '<span class="tagTypeBadge tagTypeBadgeCons">Consumed</span>'
          : '<span class="tagTypeBadge tagTypeBadgeBase">Base</span>';
        const radixNote = (tg.radix && tg.radix !== "Decimal" && tg.radix !== "Float") ? `<span class="tagRadix" title="Radix">${tg.radix}</span>` : "";
        const accessNote = tg.externalAccess === "Read Only" ? '<span class="tagAccess tagAccessRO" title="Read Only">RO</span>'
          : tg.externalAccess === "None" ? '<span class="tagAccess tagAccessNone" title="No External Access">—</span>' : "";
        tr.innerHTML=`<td>${nameCell}${accessNote}</td><td class="type">${tagTypeBadge}</td><td class="type">${ty}${radixNote}</td><td class="val">${va}</td><td class="desc">${tg.description||""}</td>`;
        const td=mk("td","acts"); tr.appendChild(td);
        if (!isAlias) td.append(mkB("Edit","sm",()=>openTagDialog(prog,tg)));
        td.append(mkB("Delete","sm danger",()=>deleteTag(prog,tg.name)));
        if (expandable) {
          const btn = tr.querySelector(".expArrow");
          btn.onclick = () => _toggleTopBreakdown(tr, tg, prog, btn);
        }
      });
      if (d.total>TAG_PAGE) {
        const pg=mk("div","pagination"); b.appendChild(pg);
        pg.appendChild(mk("span","",`${offset+1}–${Math.min(offset+TAG_PAGE,d.total)} of ${d.total}`));
        if (offset>0) pg.appendChild(mkB("◀ Prev","",()=>{ _active._offset=offset-TAG_PAGE; showTags(c,prog,search,offset-TAG_PAGE); }));
        if (offset+TAG_PAGE<d.total) pg.appendChild(mkB("Next ▶","",()=>{ _active._offset=offset+TAG_PAGE; showTags(c,prog,search,offset+TAG_PAGE); }));
      }
    }).catch(e=>{ ldr.textContent="Error: "+e.message; });
}

/* ── data types ─────────────────────────────────────────────────────────── */
function showDatatypeList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("📐 Data Types (User-Defined)", mkB("+ New Data Type","primary sm",openNewDataTypeDialog)));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!_summary.dataTypes.length){ b.appendChild(mk("p","empty","None.")); return; }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Class</th><th>Members</th></tr>`;
  _summary.dataTypes.forEach(d=>{
    const tr=mk("tr"); t.appendChild(tr);
    tr.innerHTML=`<td>${d.name}</td><td class="type">${d.class||"-"}</td><td>${d.memberCount}</td>`;
    tr.onclick=()=>{ _active={kind:"datatype",name:d.name}; renderTree(); renderContent(_active); };
    tr.style.cursor="pointer";
  });
}

function showDatatypeDetail(c, name) {
  const p=mk("div","panel"); c.appendChild(p);
  const b=mk("div","panelBody"); p.appendChild(b);
  const ldr=mk("p","empty","Loading…"); b.appendChild(ldr);
  GET(`/api/datatypes/detail?name=${enc(name)}`).then(d=>{
    ldr.remove();

    /* inline save — reads directly from the table DOM */
    async function saveDtEdits() {
      const desc = descI.value.trim();
      const members = Array.from(tbl.querySelectorAll("tr.dtEditRow")).map(tr => {
        const ins = tr.querySelectorAll("input,select");
        return { name: ins[0].value.trim(), dataType: ins[1].value,
                 dimension: parseInt(ins[2].value)||0,
                 access: ins[3].value, description: ins[4].value.trim() };
      }).filter(m => m.name);
      if (!members.length) { toast("At least one member required","err"); return; }
      try {
        await POST("/api/datatypes/update",{name,description:desc,members});
        toast("Data type saved"); setModified(true);
        _active={kind:"datatype",name}; renderContent(_active);
      } catch(e){ toast(e.message,"err"); }
    }

    p.insertBefore(panelHead("📋 "+name, mkB("Save Changes","sm primary",saveDtEdits)), b);

    /* description field — inline editable */
    const descI=mk("input","inlineDesc"); descI.value=d.description||"";
    descI.placeholder="Description…"; b.appendChild(descI);

    /* member table — each row is directly editable */
    const tbl=mk("table","dataTable editableTable"); tbl.style.marginTop="8px"; b.appendChild(tbl);
    tbl.innerHTML=`<tr><th>Member</th><th>Data Type</th><th>Dim</th><th>Access</th><th>Description</th><th></th></tr>`;

    function addMemberRow(vals={}) {
      const tr=mk("tr","dtEditRow"); tbl.appendChild(tr);
      const allTypes=[...new Set([...SCALAR_TYPES,
        ...(_summary?.dataTypes||[]).map(dd=>dd.name),
        ...(_summary?.aoiDefinitions||[]).map(a=>a.name)])];
      const nameI=mk("input"); nameI.value=vals.name||""; nameI.style.width="120px";
      const typeSel=mk("select");
      const allTypesRow=[...allTypes];
      // If the existing type isn't in the list (e.g., LREAL, USINT, or unknown UDT), add it first
      if (vals.dataType && !allTypesRow.includes(vals.dataType)) allTypesRow.unshift(vals.dataType);
      allTypesRow.forEach(t=>{const o=mk("option");o.value=t;o.textContent=t;typeSel.appendChild(o);});
      if (vals.dataType) typeSel.value=vals.dataType;
      const dimI=mk("input"); dimI.type="number"; dimI.min="0"; dimI.value=vals.dimension||0; dimI.style.width="55px";
      const accSel=mk("select"); ["Read/Write","Read Only","None"].forEach(a=>{const o=mk("option");o.value=a;o.textContent=a;accSel.appendChild(o);});
      if (vals.access) accSel.value=vals.access;
      const descEl=mk("input"); descEl.value=vals.description||""; descEl.placeholder="Description";
      const delB=mkB("✕","icon danger",()=>tr.remove());
      [nameI,typeSel,dimI,accSel,descEl,delB].forEach(el=>{const td=mk("td");td.appendChild(el);tr.appendChild(td);});
    }

    d.members.forEach(m=>addMemberRow(m));
    const addRowBtn=mkB("+ Add Member","sm",()=>addMemberRow());
    addRowBtn.style.marginTop="8px"; b.appendChild(addRowBtn);

  }).catch(e=>{ ldr.textContent="Error: "+e.message; });
}

/* ── AOIs ────────────────────────────────────────────────────────────────── */
function showAoiList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("⚙️ Add-On Instructions", mkB("+ New AOI","primary sm",openNewAoiDialog)));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!_summary.aoiDefinitions.length){ b.appendChild(mk("p","empty","None.")); return; }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Revision</th><th>Description</th></tr>`;
  _summary.aoiDefinitions.forEach(a=>{
    const tr=mk("tr"); t.appendChild(tr);
    tr.innerHTML=`<td>${a.name}</td><td class="type">${a.revision||"-"}</td><td class="desc">${a.description||""}</td>`;
    tr.onclick=()=>{ _active={kind:"aoi",name:a.name}; renderTree(); renderContent(_active); };
    tr.style.cursor="pointer";
  });
}

/** Shows an AOI definition: its parameters (with real names/descriptions -
 * these are what the "P1/P2/P3" placeholders on rung blocks resolve to
 * once loaded), its local (private) tags, and — new — its actual internal
 * ladder logic, rendered read-only with the same diagram used everywhere
 * else, so users can see exactly what an AOI does instead of treating it
 * as a black box. */
function showAoiDetail(c, name) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("⚙️ "+name, mkB("Delete AOI","sm danger",()=>deleteAoi(name))));
  const b=mk("div","panelBody"); p.appendChild(b);
  const ldr=mk("p","empty","Loading…"); b.appendChild(ldr);
  Promise.all([GET(`/api/aoi/detail?name=${enc(name)}`), _customInstructionsReady]).then(([a])=>{
    ldr.remove();
    if (a.description){ const dd=mk("p","desc",a.description); dd.style.marginBottom="12px"; b.appendChild(dd); }

    const tabs=mk("div","modeTabs"); b.appendChild(tabs);
    const panes={};
    const paneBox=mk("div"); b.appendChild(paneBox);
    function mkTab(key,label,active){
      const btn=mkB(label,active?"primary":"",()=>{
        tabs.querySelectorAll("button").forEach(x=>x.className="");
        btn.className="primary";
        Object.entries(panes).forEach(([k,el])=>el.style.display = k===key ? "" : "none");
        _active.aoiTab = key;
      });
      tabs.appendChild(btn);
      return btn;
    }

    const paramsPane=mk("div"); paneBox.appendChild(paramsPane); panes.params=paramsPane;
    const visibleParams = a.parameters.filter(pp=>pp.visible!=="false");
    paramsPane.appendChild(mkB("Edit Parameters","sm primary",()=>openEditAoiParamsDialog(name,a.description,visibleParams)));
    const t=mk("table","dataTable"); t.style.marginTop="8px"; paramsPane.appendChild(t);
    t.innerHTML=`<tr><th>Parameter</th><th>Data Type</th><th>Usage</th><th>Required</th><th>Default</th><th>Description</th></tr>`;
    visibleParams.forEach(pp=>{
      const tr=mk("tr"); t.appendChild(tr);
      const expandable = _memberExpandable(pp.dataType, 0);
      const nameCell = expandable
        ? `<button type="button" class="expArrow">▶</button><span class="bdName">${pp.name}</span>`
        : pp.name;
      tr.innerHTML=`<td>${nameCell}</td><td class="type">${pp.dataType}</td><td>${pp.usage}</td><td>${pp.required}</td><td class="val">${pp.defaultValue||""}</td><td class="desc">${pp.description||""}</td>`;
      if (expandable) {
        const btn = tr.querySelector(".expArrow");
        btn.onclick = () => _toggleBreakdown(tr, pp.name, pp.dataType, 0, 1, {value:null,comments:{}}, [], btn);
      }
    });

    const localPane=mk("div"); localPane.style.display="none"; paneBox.appendChild(localPane); panes.local=localPane;
    if (!a.localTags.length){ localPane.appendChild(mk("p","empty","No local tags.")); }
    else {
      const lt=mk("table","dataTable"); localPane.appendChild(lt);
      lt.innerHTML=`<tr><th>Name</th><th>Data Type</th><th>Dim</th><th>Value</th><th>Description</th><th></th></tr>`;
      a.localTags.forEach(m=>{
        const tr=mk("tr"); lt.appendChild(tr);
        const dim = Number(m.dimension||0);
        const expandable = _memberExpandable(m.dataType, dim);
        const ty = dim > 0 ? `${m.dataType}[${dim}]` : m.dataType;
        const nameCell = expandable
          ? `<button type="button" class="expArrow">▶</button><span class="bdName">${m.name}</span>`
          : m.name;
        tr.innerHTML=`<td>${nameCell}</td><td class="type">${ty}</td><td class="type">${dim>0?dim:""}</td><td class="val">${m.value||""}</td><td class="desc">${m.description||""}</td><td></td>`;
        if (expandable) {
          const btn = tr.querySelector(".expArrow");
          btn.onclick = () => _toggleBreakdown(tr, m.name, m.dataType, dim, 1, {value:null,comments:{}}, [], btn);
        }
      });
    }

    const logicPane=mk("div"); logicPane.style.display="none"; paneBox.appendChild(logicPane); panes.logic=logicPane;
    if (!a.routines.length){ logicPane.appendChild(mk("p","empty","No internal logic.")); }
    const aoiTagNames = [...(a.parameters||[]).map(pp=>pp.name), ...(a.localTags||[]).map(m=>m.name)];
    a.routines.forEach(r=>{
      logicPane.appendChild(mk("h3","",r.name+(r.type==="ST"?" (Structured Text)":"")));
      if (r.type==="RLL") {
        _renderAoiRungList(logicPane, name, r.name, r.rungs, aoiTagNames);
      } else {
        const ta=mk("pre","stEditor"); ta.textContent=r.content||""; logicPane.appendChild(ta);
      }
    });

    mkTab("params","Parameters",true);
    mkTab("local",`Local Tags (${a.localTags.length})`,false);
    mkTab("logic",`Logic (${a.routines.length} routine${a.routines.length===1?"":"s"})`,false);
    // Restore previously active tab (e.g. Logic tab after Raw Text toggle)
    const _savedTab = _active.aoiTab || "params";
    if (_savedTab !== "params") {
      const _tabBtns = [...tabs.querySelectorAll("button")];
      const _tabKeys = ["params","local","logic"];
      const _idx = _tabKeys.indexOf(_savedTab);
      if (_idx > 0 && _tabBtns[_idx]) _tabBtns[_idx].click();
    }
  }).catch(e=>{ ldr.remove(); b.appendChild(mk("p","empty","Error: "+e.message)); });
}

/** Rung card for AOI internal logic — aligned with buildRungCard so all
 * features (rung selection, keyboard Delete) work identically. */
function buildAoiRungCard(rung, aoiName, routineName, tagNames, mode) {
  const card=mk("div","rungCard");
  card._rungNum = rung.number;
  card._selectSelf = () => _selectRung(card);

  /* Click anywhere on the card body selects it — use capture so it fires
   * even when insertDots or elements call e.stopPropagation(). */
  card.addEventListener("click", (e) => {
    if (e.target.closest(".rungCardHead")) return; // header buttons are not selection targets
    if (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
    _selectRung(card);
  }, true);  // capture=true: fires before child stopPropagation
  card.addEventListener("focusin", ()=>_selectRung(card));

  /* Compact header: [0000] | comment input | Delete */
  const hd=mk("div","rungCardHead"); card.appendChild(hd);
  hd.appendChild(mk("span","rungNumBadge",String(rung.number).padStart(4,"0")));
  const ci=mk("input","rungCommentInline"); ci.placeholder="Comment…"; ci.value=rung.comment||"";
  ci.title="Ctrl+Enter to quick-save this rung";
  hd.appendChild(ci);
  const acts=mk("div","rungHeadActs");

  const bd=mk("div","rungCardBody"); card.appendChild(bd);
  let aoiRungMode = mode;
  let builder=createRungBuilder(bd, rung.text, ()=>tagNames||[], {mode:aoiRungMode, hideTabs:true});
  /* Expose builder+ci on card for keyboard Ctrl+Enter quick-save */
  card._builder = builder;
  card._ci = ci;

  const modeBtn=mkB(builder.getMode&&builder.getMode()==="raw"?"↩ Visual":"✏ Raw","sm rungModeBtn",()=>{
    const newMode = (builder.getMode ? builder.getMode() : aoiRungMode)==="raw" ? "visual" : "raw";
    aoiRungMode = newMode;
    if (builder.setMode) { builder.setMode(newMode); }
    else { const prev=builder.getText(); bd.innerHTML=""; builder=createRungBuilder(bd,prev,()=>tagNames||[],{mode:newMode,hideTabs:true}); card._builder=builder; }
    modeBtn.textContent=newMode==="raw"?"↩ Visual":"✏ Raw";
  });
  acts.append(modeBtn);

  /* Ctrl+Enter quick-saves just this rung */
  ci.addEventListener("keydown", async e=>{
    if (!e.ctrlKey||e.key!=="Enter") return;
    try {
      await POST("/api/aoi/rungs/edit",{aoi:aoiName,routine:routineName,number:rung.number,text:builder.getText(),comment:ci.value});
      toast("Rung "+rung.number+" saved"); setModified(true);
    } catch(ex){ toast(ex.message,"err"); }
  });
  acts.append(mkB("✕","sm danger",async()=>{
    if (!confirm(`Delete rung ${rung.number}?`)) return;
    try { await POST("/api/aoi/rungs/delete",{aoi:aoiName,routine:routineName,number:rung.number}); toast("Rung deleted"); setModified(true); _active={kind:"aoi",name:aoiName}; renderContent(_active); }
    catch(e){ toast(e.message,"err"); }
  }));
  hd.appendChild(acts);

  return card;
}

/** Renders the rung list for one AOI routine — mirrors _renderRungList so AOI
 * logic gets the same control bar (Visual/Raw toggle), rung
 * selection, and keyboard Delete as program routines. */
function _renderAoiRungList(container, aoiName, routineName, rungs, tagNames) {
  /* Control bar: Visual/Raw mode toggle */
  const ctrlBar=mk("div","rungCtrlBar"); container.appendChild(ctrlBar);
  ctrlBar.appendChild(buildBuilderModeToggle(
    ()=>_active.builderMode||"visual",
    (m)=>{
      _active.builderMode=m;
      ctrlBar.querySelectorAll(".routineModeToggle button").forEach((btn,i)=>{
        btn.className=(i===0&&m==="visual")||(i===1&&m==="raw")?"primary":"";
      });
      if (list) list.querySelectorAll(".rungCard").forEach(card=>{
        if (!card._builder) return;
        const curMode = card._builder.getMode ? card._builder.getMode() : null;
        if (curMode === m) return;  // already in target mode
        card._builder.setMode(m);
        // Sync the per-rung mode button text
        const btn = card.querySelector(".rungModeBtn");
        if (btn) btn.textContent = m === "raw" ? "\u21A9 Visual" : "\u270F Raw";
      });
    },
  ));
  const addB=mkB("+ Add Rung","primary sm",()=>addAoiRung(aoiName,routineName)); ctrlBar.appendChild(addB);

  let list;

  // Language Element Toolbar (same as main routines — universal editing)
  container.appendChild(buildElemToolbar(null, null, {aoiName, routineName}));

  list=mk("div","rungList"); container.appendChild(list);
  const mode=_active.builderMode||"visual";
  rungs.forEach(rung=>list.appendChild(buildAoiRungCard(rung,aoiName,routineName,tagNames,mode)));

  // Navigate to highlighted rung when coming from search/validation
  if (_active.highlightRung !== undefined) {
    const target = Number(_active.highlightRung);
    delete _active.highlightRung;
    for (const card of list.querySelectorAll(".rungCard")) {
      if (Number(card._rungNum) === target) {
        _selectRung(card);
        setTimeout(()=>card.scrollIntoView({behavior:"smooth",block:"center"}), 80);
        break;
      }
    }
  }

  /* Keyboard shortcuts: Ctrl+C/V copy-paste, Delete removes instruction then rung */
  function _onKeyDel(e) {
    const tgt=document.activeElement;
    if (tgt&&(tgt.tagName==="INPUT"||tgt.tagName==="TEXTAREA"||tgt.tagName==="SELECT")) return;
    // Ctrl+C: copy selected instruction
    if ((e.ctrlKey||e.metaKey) && e.key==="c") {
      if (window._selElem && window._selElem._delCtx) {
        const meta = window._selElem._delCtx._dragMeta;
        if (meta) {
          window._ldClipboard = JSON.parse(JSON.stringify(meta.arr[meta.idx]));
          const el = meta.arr[meta.idx];
          toast("Copied " + (el.kind==="branch" ? "branch" : el.code));
          e.preventDefault();
        }
      }
      return;
    }
    // Ctrl+V: paste copied element at insert cursor, or append to selected rung
    if ((e.ctrlKey||e.metaKey) && e.key==="v") {
      if (window._ldClipboard) {
        const el = JSON.parse(JSON.stringify(window._ldClipboard));
        if (window._ldInsertPos) {
          const {arr, idx, onChange} = window._ldInsertPos;
          arr.splice(idx, 0, el); _clearInsertPos(); onChange();
          toast("Pasted " + (el.kind==="branch" ? "branch" : el.code));
          e.preventDefault();
        } else if (_selRungCard && _selRungCard._builder) {
          if (_selRungCard._builder.addElement(el)) {
            toast("Pasted " + (el.kind==="branch" ? "branch" : el.code));
          } else { toast("Switch to Visual mode to paste","err"); }
          e.preventDefault();
        }
      }
      return;
    }
    if (e.key!=="Delete") return;
    // Delete instruction first — never accidentally deletes rung while instruction selected
    if (window._selElem && window._selElem._delCtx && list && list.contains(window._selElem)) {
      e.preventDefault();
      window._selElem._delCtx.onDelete();
      window._selElem=null;
      return;
    }
    if (!_selRungCard||!list.contains(_selRungCard)) return;
    e.preventDefault();
    const num=_selRungCard._rungNum;
    if (!confirm(`Delete rung ${num}?`)) return;
    POST("/api/aoi/rungs/delete",{aoi:aoiName,routine:routineName,number:num})
      .then(()=>{ toast("Rung deleted"); setModified(true); _active={kind:"aoi",name:aoiName}; renderContent(_active); })
      .catch(e=>toast(e.message,"err"));
  }
  document.addEventListener("keydown", _onKeyDel);
  const obs=new MutationObserver(()=>{ if(!document.body.contains(list)){ document.removeEventListener("keydown",_onKeyDel); obs.disconnect(); }});
  obs.observe(document.body,{childList:true,subtree:true});
}
async function addAoiRung(aoiName, routineName) {
  try { await POST("/api/aoi/rungs/add",{aoi:aoiName,routine:routineName,text:"NOP();",comment:""}); toast("Rung added"); setModified(true); _active={kind:"aoi",name:aoiName}; renderContent(_active); }
  catch(e){ toast(e.message,"err"); }
}
async function deleteAoi(name, force) {
  if (!confirm(`Delete AOI "${name}"? This cannot be undone.`)) return;
  try {
    const s=await POST("/api/aoi/delete",{name,force:!!force});
    await refresh(s); toast("AOI deleted"); _active={kind:"aois"}; renderContent(_active);
  } catch(e) {
    if (/still used in/.test(e.message) && confirm(e.message+"\n\nDelete anyway? (the rungs calling it will be left referencing a non-existent instruction — you'll need to fix them up.)")) {
      return deleteAoi(name, true);
    }
    toast(e.message,"err");
  }
}
function openEditAoiParamsDialog(name, description, currentParams) {
  _rowDialog({
    title: "Edit "+name+" Parameters", rowsLabel: "Parameters", addLabel: "+ Add Parameter", okLabel: "Save",
    types: SCALAR_TYPES, usage: true, initialName: name, initialDesc: description, initialRows: currentParams, lockName: true,
    onSave: async (_n, desc, parameters) => {
      await POST("/api/aoi/update", {name, description: desc, parameters});
      toast("AOI updated"); setModified(true);
      _active={kind:"aoi",name}; renderContent(_active);
    },
  });
}

/* ── Modules ─────────────────────────────────────────────────────────────── */
function _moduleDialog(title, initial, onSave) {
  const dlg = document.createElement("dialog"); dlg.className = "formDialog";
  dlg.innerHTML = `<h3>${title}</h3>
    <label>Name<input id="mdN" value="${initial.name||""}"></label>
    <label>Catalog Number<input id="mdC" value="${initial.catalogNumber||""}"></label>
    <label>Vendor ID<input id="mdV" type="number" value="${initial.vendor||1}"></label>
    <label>Parent Module<input id="mdP" value="${initial.parentModule||"Local"}"></label>
    <label><input type="checkbox" id="mdI" style="width:auto;margin-right:6px"${initial.inhibited==="true"?" checked":""}> Inhibited</label>
    <div class="dlgBtns"><button id="mdX">Cancel</button><button id="mdOK" class="primary">${initial.name?"Save":"Add"}</button></div>`;
  document.body.appendChild(dlg);
  dlg.querySelector("#mdX").onclick = ()=>{ dlg.close(); dlg.remove(); };
  dlg.querySelector("#mdOK").onclick = () => {
    const n=dlg.querySelector("#mdN").value.trim();
    if (!n){ toast("Name required","err"); return; }
    onSave({
      name: n,
      catalogNumber: dlg.querySelector("#mdC").value.trim(),
      vendor: dlg.querySelector("#mdV").value,
      parentModule: dlg.querySelector("#mdP").value.trim()||"Local",
      inhibited: dlg.querySelector("#mdI").checked?"true":"false",
    }); dlg.close(); dlg.remove();
  };
  dlg.showModal();
}
function openNewModuleDialog() {
  _moduleDialog("Add Module", {}, d => {
    POST("/api/modules/add",d).then(s=>{refresh(s);toast("Module added");_active={kind:"module",name:d.name};renderContent(_active);}).catch(e=>toast(e.message,"err"));
  });
}
function openEditModuleDialog(m) {
  if (!m){ toast("Module not found","err"); return; }
  _moduleDialog("Edit Module", m, d => {
    POST("/api/modules/edit",{...d, oldName:m.name}).then(s=>{refresh(s);toast("Module saved");_active={kind:"module",name:d.name};renderContent(_active);}).catch(e=>toast(e.message,"err"));
  });
}

function showModuleList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("🔌 I/O Configuration", mkB("+ Add Module","primary sm",()=>openNewModuleDialog())));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!_summary.modules.length){ b.appendChild(mk("p","empty","None.")); return; }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Catalog Number</th><th>Parent</th><th>Inhibited</th></tr>`;
  _summary.modules.forEach(m=>{
    const tr=mk("tr"); t.appendChild(tr);
    tr.innerHTML=`<td>${m.name}</td><td class="type">${m.catalogNumber}</td><td>${m.parentModule||"-"}</td><td>${m.inhibited}</td>`;
    tr.onclick=()=>{ _active={kind:"module",name:m.name}; renderTree(); renderContent(_active); };
    tr.style.cursor="pointer";
  });
}

function showModuleDetail(c, name) {
  const m=_summary.modules.find(x=>x.name===name);
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("🔌 Module: "+name,
    mkB("Edit","sm",()=>openEditModuleDialog(m)),
    mkB("Delete","sm danger",()=>{
      if(!confirm("Delete module "+name+"?")) return;
      POST("/api/modules/delete",{name}).then(s=>{refresh(s);toast("Module deleted");_active={kind:"modules"};renderContent(_active);}).catch(e=>toast(e.message,"err"));
    })));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!m){ b.appendChild(mk("p","empty","Not found.")); return; }
  const g=mk("div","propGrid"); b.appendChild(g);
  [["Name",m.name],["Catalog",m.catalogNumber],["Vendor",m.vendor],["Parent",m.parentModule||"-"],["Inhibited",m.inhibited]]
    .forEach(([k,v])=>{ g.appendChild(mk("div","pk",k)); g.appendChild(mk("div","pv",v||"-")); });
}

/* ── Trends ──────────────────────────────────────────────────────────────── *
 * Studio 5000 stores each trend's chart layout (colors, axes, zoom, etc.)
 * as an opaque, undocumented binary blob (<Template>) alongside a plain,
 * editable <Pens> list (which tags are logged, their color/min/max). We
 * only ever touch the <Pens> list and a few plain attributes - the binary
 * blob is left completely alone so the project stays openable in Studio.
 * Because of that, a genuinely brand-new trend can only be created by
 * duplicating an existing one (which clones its Template) and editing the
 * copy's pens - there's no safe way to synthesize a Template from scratch. */
function showTrendList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("📈 Trends"));
  const b=mk("div","panelBody"); p.appendChild(b);
  const trends = _summary.trends || [];
  if (!trends.length) {
    b.appendChild(mk("p","empty","No trends in this project. (A new trend's chart layout is an undocumented Studio 5000 binary format we can't safely synthesize from scratch - if you add one in Studio 5000 and reopen the file here, you'll be able to view/duplicate/edit its pens.)"));
    return;
  }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Sample Period (ms)</th><th>Pens</th><th></th></tr>`;
  trends.forEach(tr=>{
    const row=mk("tr"); t.appendChild(row);
    row.innerHTML=`<td>${tr.name}</td><td class="type">${tr.samplePeriod}</td><td>${tr.penCount}</td>`;
    row.onclick=()=>{ _active={kind:"trend",name:tr.name}; renderTree(); renderContent(_active); };
    row.style.cursor="pointer";
  });
}

function showTrendDetail(c, name) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("📈 "+name,
    mkB("Duplicate as New Trend…","sm",()=>openDuplicateTrendDialog(name)),
    mkB("Delete Trend","sm danger",()=>deleteTrend(name))));
  const b=mk("div","panelBody"); p.appendChild(b);
  const ldr=mk("p","empty","Loading…"); b.appendChild(ldr);
  GET(`/api/trends/detail?name=${enc(name)}`).then(t=>{
    ldr.remove();
    const g=mk("div","propGrid"); b.appendChild(g);
    const spI=mk("input"); spI.value=t.samplePeriod; spI.style.width="80px";
    const csI=mk("input"); csI.value=t.captureSize; csI.style.width="80px";
    [["Sample Period (ms)",spI],["Capture Size (samples)",csI],
     ["Start Trigger",t.startTriggerType],["Stop Trigger",t.stopTriggerType],
     ["Chart layout",t.hasTemplate?"present (not editable here)":"none"]]
      .forEach(([k,v])=>{ g.appendChild(mk("div","pk",k)); const pv=mk("div","pv"); if (v instanceof HTMLElement) pv.appendChild(v); else pv.textContent=v||"-"; g.appendChild(pv); });
    const saveMetaB=mkB("Save Settings","sm primary",async()=>{
      await POST("/api/trends/update-meta",{name,samplePeriod:spI.value.trim(),captureSize:csI.value.trim()});
      toast("Trend settings saved"); setModified(true);
    }); saveMetaB.style.margin="8px 0 16px"; b.appendChild(saveMetaB);

    b.appendChild(mk("div","dlgRowsHead",`Pens (${t.pens.length})`));
    b.appendChild(mkB("+ Add Pen","sm primary",()=>openPenDialog(name,t.pens,null)));
    const pt=mk("table","dataTable"); pt.style.marginTop="8px"; b.appendChild(pt);
    pt.innerHTML=`<tr><th>Tag</th><th>Color</th><th>Type</th><th>Min</th><th>Max</th><th>Visible</th><th></th></tr>`;
    t.pens.forEach(pen=>{
      const row=mk("tr"); pt.appendChild(row);
      const swatch = `<span class="penSwatch" style="background:${_penColorCss(pen.color)}"></span>`;
      row.innerHTML=`<td>${pen.name}</td><td>${swatch}${pen.color}</td><td class="type">${pen.type}</td><td>${pen.min}</td><td>${pen.max}</td><td>${pen.visible}</td>`;
      const td=mk("td","acts"); row.appendChild(td);
      td.append(
        mkB("Edit","sm",()=>openPenDialog(name,t.pens,pen)),
        mkB("Delete","sm danger",async()=>{
          if (!confirm(`Remove pen "${pen.name}"?`)) return;
          const newPens = t.pens.filter(x=>x!==pen);
          await POST("/api/trends/set-pens",{name,pens:newPens});
          toast("Pen removed"); setModified(true); _active={kind:"trend",name}; renderContent(_active);
        }));
    });
  }).catch(e=>{ ldr.textContent="Error: "+e.message; });
}
function _penColorCss(c) {
  // AB stores colors as "16#00bb_ggrr" (note: BGR order, not RGB)
  const m = /16#0*([0-9a-fA-F_]+)/.exec(c||"");
  if (!m) return "#888";
  const hex = m[1].replace(/_/g,"").padStart(6,"0").slice(-6);
  const b=hex.slice(0,2), g=hex.slice(2,4), r=hex.slice(4,6);
  return `#${r}${g}${b}`;
}
function openPenDialog(trendName, allPens, existing) {
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h3>${existing?"Edit":"Add"} Pen</h3>
    <label>Tag Name<input id="pnName" value="${existing?existing.name:""}"></label>
    <label>Color (hex, e.g. #ff0000)<input id="pnColor" type="color" value="${_penColorCss(existing?.color)}"></label>
    <label>Type<select id="pnType"><option>Analog</option><option>Digital</option></select></label>
    <label>Min<input id="pnMin" value="${existing?existing.min:"0"}"></label>
    <label>Max<input id="pnMax" value="${existing?existing.max:"100"}"></label>
    <label><input type="checkbox" id="pnVis" style="width:auto;margin-right:6px"${!existing||existing.visible!=="false"?" checked":""}> Visible</label>
    <div class="dlgBtns"><button id="pnX">Cancel</button><button id="pnOK" class="primary">${existing?"Save":"Add"}</button></div>`;
  document.body.appendChild(dlg);
  if (existing) dlg.querySelector("#pnType").value = existing.type;
  dlg.showModal();
  dlg.querySelector("#pnX").onclick=()=>{ dlg.close(); dlg.remove(); };
  dlg.querySelector("#pnOK").onclick=async()=>{
    const name=dlg.querySelector("#pnName").value.trim();
    if (!name){ toast("Tag name required","err"); return; }
    const hex=dlg.querySelector("#pnColor").value.replace("#","");
    const r=hex.slice(0,2), g=hex.slice(2,4), b=hex.slice(4,6);
    const color = `16#00${b}${g}${r}`;
    const pen = {
      name, color, type: dlg.querySelector("#pnType").value,
      min: dlg.querySelector("#pnMin").value.trim(), max: dlg.querySelector("#pnMax").value.trim(),
      visible: dlg.querySelector("#pnVis").checked,
    };
    const newPens = existing ? allPens.map(p=>p===existing?pen:p) : [...allPens, pen];
    try {
      await POST("/api/trends/set-pens",{name:trendName,pens:newPens});
      toast(existing?"Pen saved":"Pen added"); setModified(true);
      dlg.close(); dlg.remove();
      _active={kind:"trend",name:trendName}; renderContent(_active);
    } catch(e){ toast(e.message,"err"); }
  };
}
/* ── Tasks ───────────────────────────────────────────────────────────────── */
function openNewTaskDialog() {
  const dlg = document.createElement("dialog");
  dlg.className = "formDialog";
  dlg.innerHTML = `<h3>New Task</h3>
    <label>Name<input id="tkN" placeholder="MainTask"></label>
    <label>Type<select id="tkT">
      <option value="CONTINUOUS">CONTINUOUS</option>
      <option value="PERIODIC" selected>PERIODIC</option>
      <option value="EVENT">EVENT</option>
    </select></label>
    <label id="tkRL">Rate (ms)<input id="tkR" type="number" min="0.1" step="0.1" value="10"></label>
    <label>Priority<input id="tkP" type="number" min="1" max="15" value="10"></label>
    <label>Watchdog (ms)<input id="tkW" type="number" min="1" value="500"></label>
    <div class="dlgBtns"><button id="tkX">Cancel</button><button id="tkOK" class="primary">Create</button></div>`;
  document.body.appendChild(dlg);
  const tSel=dlg.querySelector("#tkT"), rateRow=dlg.querySelector("#tkRL");
  tSel.onchange=()=>{ rateRow.style.display = tSel.value==="PERIODIC" ? "" : "none"; };
  dlg.querySelector("#tkX").onclick=()=>{ dlg.close(); dlg.remove(); };
  dlg.querySelector("#tkOK").onclick=async()=>{
    const name=dlg.querySelector("#tkN").value.trim();
    if (!name){ toast("Name required","err"); return; }
    const taskType=tSel.value;
    const rate=parseFloat(dlg.querySelector("#tkR").value)||10;
    const priority=parseInt(dlg.querySelector("#tkP").value)||10;
    const watchdog=parseFloat(dlg.querySelector("#tkW").value)||500;
    try {
      const s=await POST("/api/tasks/add",{name,taskType,rate,priority,watchdog});
      refresh(s); toast("Task created"); dlg.close(); dlg.remove();
      _active={kind:"task",name}; renderTree(); renderContent(_active);
    } catch(e){ toast(e.message,"err"); }
  };
  dlg.showModal();
}

function showTaskList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("⏱ Tasks", mkB("+ New Task","primary sm",()=>openNewTaskDialog())));
  const b=mk("div","panelBody"); p.appendChild(b);
  const tasks = _summary.tasks || [];
  if (!tasks.length){ b.appendChild(mk("p","empty","No tasks defined.")); return; }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Type</th><th>Rate (ms)</th><th>Priority</th><th>Watchdog (ms)</th><th>Programs</th></tr>`;
  tasks.forEach(tk=>{
    const tr=mk("tr"); t.appendChild(tr);
    const typeCls = tk.type==="PERIODIC"?"badge periodic":tk.type==="EVENT"?"badge event":"badge continuous";
    const typeBadge=`<span class="${typeCls}">${tk.type}</span>`;
    tr.innerHTML=`<td><b>${tk.name}</b></td><td>${typeBadge}</td><td class="type">${tk.type==="PERIODIC"?tk.rate:"-"}</td><td class="type">${tk.priority}</td><td class="type">${tk.watchdog}</td><td class="desc">${(tk.scheduledPrograms||[]).join(", ")}</td>`;
    tr.onclick=()=>{ _active={kind:"task",name:tk.name}; renderTree(); renderContent(_active); };
    tr.style.cursor="pointer";
  });
}

function showTaskDetail(c, name) {
  const tk=(_summary.tasks||[]).find(x=>x.name===name);
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("⏱ Task: "+name, mkB("Delete Task","sm danger",()=>{
    if (!confirm("Delete task "+name+"?")) return;
    POST("/api/tasks/delete",{name}).then(s=>{ refresh(s); toast("Task deleted"); _active={kind:"tasks"}; renderContent(_active); }).catch(e=>toast(e.message,"err"));
  })));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!tk){ b.appendChild(mk("p","empty","Not found.")); return; }
  const typeCls = tk.type==="PERIODIC"?"badge periodic":tk.type==="EVENT"?"badge event":"badge continuous";
  const badge=document.createElement("span"); badge.className=typeCls; badge.textContent=tk.type;
  b.appendChild(badge); b.appendChild(document.createElement("br")); b.style.paddingTop="8px";
  const g=mk("div","propGrid"); b.appendChild(g);
  const props=[["Name",tk.name],["Type",tk.type],["Priority",tk.priority],["Watchdog (ms)",tk.watchdog]];
  if (tk.type==="PERIODIC") props.push(["Rate (ms)",tk.rate]);
  if (tk.inhibitTask==="true") props.push(["Status","Inhibited"]);
  props.forEach(([k,v])=>{ g.appendChild(mk("div","pk",k)); g.appendChild(mk("div","pv",String(v||"-"))); });
  b.appendChild(mk("h3","","Scheduled Programs"));
  if (!tk.scheduledPrograms.length){ b.appendChild(mk("p","empty","None scheduled.")); return; }
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Program</th><th>Main Routine</th><th>Tag Count</th><th>Routines</th></tr>`;
  (tk.scheduledPrograms||[]).forEach(pname=>{
    const pp=(_summary.programs||[]).find(x=>x.name===pname);
    const tr=mk("tr"); t.appendChild(tr);
    tr.innerHTML=`<td><a class="treeLink">${pname}</a></td><td class="type">${pp?.mainRoutineName||"-"}</td><td>${pp?.tagCount??"-"}</td><td>${pp?.routines?.length??"-"}</td>`;
    tr.style.cursor="pointer";
    tr.onclick=()=>{ _active={kind:"program",program:pname}; _exp.add("programs"); _exp.add("prog_"+pname); renderTree(); renderContent(_active); };
  });
}

function openDuplicateTrendDialog(srcName) {
  const n = prompt("New trend name:", srcName+"_Copy");
  if (!n) return;
  POST("/api/trends/duplicate",{srcName,newName:n}).then(s=>{
    refresh(s); toast("Trend duplicated"); _active={kind:"trend",name:n}; renderContent(_active);
  }).catch(e=>toast(e.message,"err"));
}
async function deleteTrend(name) {
  if (!confirm(`Delete trend "${name}"?`)) return;
  try { const s=await POST("/api/trends/delete",{name}); await refresh(s); _active={kind:"trends"}; renderContent(_active); toast("Trend deleted"); }
  catch(e){ toast(e.message,"err"); }
}

/* ── Programs ────────────────────────────────────────────────────────────── */
function showProgramList(c) {
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("📁 Programs", mkB("+ New Program","primary sm",openNewProgramPrompt)));
  const b=mk("div","panelBody"); p.appendChild(b);
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Main Routine</th><th>Tags</th><th>Routines</th><th></th></tr>`;
  _summary.programs.forEach(pp=>{
    const tr=mk("tr"); t.appendChild(tr);
    tr.innerHTML=`<td>${pp.name}</td><td class="type">${pp.mainRoutineName}</td><td>${pp.tagCount}</td><td>${pp.routines.length}</td>`;
    const td=mk("td","acts"); tr.appendChild(td);
    td.appendChild(mkB("Delete","sm danger",()=>deleteProgram(pp.name)));
  });
}

function showProgramDetail(c, program) {
  const pp=_summary.programs.find(x=>x.name===program);
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("📦 "+program, mkB("Delete Program","danger sm",()=>deleteProgram(program))));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (!pp){ b.appendChild(mk("p","empty","Not found.")); return; }
  const g=mk("div","propGrid"); b.appendChild(g);
  [["Name",pp.name],["Main Routine",pp.mainRoutineName],["Disabled",pp.disabled],["Tag Count",pp.tagCount],["Routine Count",pp.routines.length]]
    .forEach(([k,v])=>{ g.appendChild(mk("div","pk",k)); g.appendChild(mk("div","pv",String(v))); });
}

function showRoutineList(c, program) {
  const pp=_summary.programs.find(x=>x.name===program);
  const p=mk("div","panel"); c.appendChild(p);
  p.appendChild(panelHead("🧩 Routines — "+program, mkB("+ New Routine","primary sm",()=>openNewRoutinePrompt(program))));
  const b=mk("div","panelBody"); p.appendChild(b);
  const t=mk("table","dataTable"); b.appendChild(t);
  t.innerHTML=`<tr><th>Name</th><th>Type</th><th>Rungs</th><th></th></tr>`;
  (pp?.routines||[]).forEach(r=>{
    const tr=mk("tr"); t.appendChild(tr);
    const badge=r.type==="RLL"?`<span class="badge rll">RLL</span>`:`<span class="badge st">ST</span>`;
    tr.innerHTML=`<td>${r.name}</td><td>${badge}</td><td>${r.type==="RLL"?r.rungCount:"–"}</td>`;
    const td=mk("td","acts"); tr.appendChild(td);
    td.append(
      mkB("Open","sm",()=>{ _active={kind:"routine",program,name:r.name,rungOffset:0}; _exp.add("prog_"+program); _exp.add("rtns_"+program); renderTree(); renderContent(_active); }),
      mkB("Delete","sm danger",()=>deleteRoutine(program,r.name)));
  });
}

/* ── Routine ─────────────────────────────────────────────────────────────── */
const RUNG_PAGE=50;
/* Cache the last-fetched routine so that toggling Visual ↔ Raw is instant
 * with no server round-trip.  Invalidated whenever any rung is mutated. */
let _routineCache = null;
function _invalidateRoutineCache() { _routineCache = null; }
let _selRungCard = null;

/* Shared render helper — builds the routine panel body from already-loaded data. */
function _renderRoutineBody(p, r, tagNames, program, name, rungOffset) {
  const badge=r.type==="RLL"?`<span class="badge rll">RLL</span>`:`<span class="badge st">ST</span>`;
  const addB = r.type==="RLL" ? mkB("+ Add Rung","primary sm",()=>addRung(program,name)) : null;
  const h=mk("div","panelHead"); p.appendChild(h);
  h.innerHTML=`<h2>${r.type==="RLL"?"🚪":"📝"} ${r.name}</h2>${badge}<span class="spacer"></span>`;
  if (addB) h.appendChild(addB);
  h.appendChild(mkB("Delete Routine","sm danger",()=>deleteRoutine(program,name)));
  const b=mk("div","panelBody"); p.appendChild(b);
  if (r.type==="RLL") {
    _renderRungList(b, r, tagNames, program, name, rungOffset);
  } else if (r.type==="ST") {
    const stWrap=mk("div","stEditorWrap"); b.appendChild(stWrap);
    const stEd=mkSyntaxEditor(stWrap, r.content||"", "st", null);
    const sv=mkB("Save","primary",async()=>{
      await POST("/api/routines/edit-st",{program,name,content:stEd.getValue()});
      toast("Routine saved"); setModified(true);
    }); sv.style.marginTop="8px"; b.appendChild(sv);
  } else {
    b.appendChild(mk("p","empty","Routine type '"+r.type+"' is read-only in this tool."));
  }
}

/** Language Element Toolbar — Studio 5000-style quick-insert strip.
 *  Click an instruction button to append it to the selected rung (visual mode)
 *  or create a new rung if nothing is selected. */
function buildElemToolbar(program, routine, aoiCtx) {
  const bar = mk("div","elemToolbar");
  // Full instruction set based on Rockwell 1756-RM003 reference manual
  const groups = [
    {label:"Bit",       codes:["XIC","XIO","OTE","OTL","OTU","ONS","OSR","OSF"]},
    {label:"Timer/Ctr", codes:["TON","TOF","RTO","CTU","CTD","RES"]},
    {label:"Compare",   codes:["EQU","NEQ","GRT","GEQ","LES","LEQ","LIM","MEQ","CMP"]},
    {label:"Math",      codes:["ADD","SUB","MUL","DIV","MOD","SQR","ABS","NEG","CPT"]},
    {label:"Move/Logic",codes:["MOV","MVM","CLR","AND","OR","XOR","NOT"]},
    {label:"File",      codes:["COP","CPS","FLL","BTD","BSL","BSR","SWP"]},
    {label:"String",    codes:["MID","FIND","CONCAT","UPPER","LOWER","STOD","DTOS"]},
    {label:"Ctrl",      codes:["JSR","RET","JMP","LBL","NOP","TND","MCR","AFI","UID","UIE"]},
    {label:"System",    codes:["GSV","SSV","MSG","IOT","IIN","EVENT"]},
    {label:"Seq",       codes:["SQI","SQO","SQL"]},
  ];
  groups.forEach(g=>{
    const grp=mk("span","tbGrp");
    grp.appendChild(mk("span","tbGrpLabel",g.label+":"));
    g.codes.forEach(code=>{
      const btn=mkB(code,"tbInstr",async()=>{
        const instr=instructionByCode(code);
        const el={kind:"instr",code,args:instr?instr.operands.map(()=>""):[]};

        // Priority 1: Insert at the selected wire position (click-to-select workflow)
        if (window._ldInsertPos) {
          const {arr,idx,onChange} = window._ldInsertPos;
          arr.splice(idx,0,el);
          _clearInsertPos();
          onChange();
          return;
        }

        // Priority 2: Append to the selected rung visual builder
        if (_selRungCard && _selRungCard._builder && _selRungCard._builder.addElement(el)) {
          return;
        }

        // Priority 3: No rung selected — create a new rung containing just this instruction
        try {
          const args = instr ? instr.operands.map(()=>"").join(",") : "";
          const txt = code+"("+args+")"+";";
          if (aoiCtx) {
            await POST("/api/aoi/rungs/add",{aoi:aoiCtx.aoiName,routine:aoiCtx.routineName,text:txt,comment:""});
            toast("Added "+code+" rung"); setModified(true); _active={kind:"aoi",name:aoiCtx.aoiName}; renderContent(_active);
          } else {
            await POST("/api/rungs/add",{program,routine,text:txt,comment:""});
            toast("Added "+code+" rung"); setModified(true); _invalidateRoutineCache();
            showRoutine(qs("#content"),program,routine,_active.rungOffset||0);
          }
        } catch(e){toast(e.message,"err");}
      });
      // Secondary: drag from toolbar onto the rung wire
      btn.draggable = true;
      btn.ondragstart = (e) => {
        _dragBegin({ kind:"new-instr", code });
        e.dataTransfer.effectAllowed = "copy";
        e.dataTransfer.setData("text/plain", code);
        btn.classList.add("tbDragging");
      };
      btn.ondragend = () => { _dragEnd(); btn.classList.remove("tbDragging"); };
      grp.appendChild(btn);
    });
    bar.appendChild(grp);
  });
  // Structural elements
  const structGrp=mk("span","tbGrp tbStructure");
  structGrp.appendChild(mk("span","tbGrpLabel","Add:"));
  const rungBtn = mkB("+ Rung","tbInstr tbSpecial",async()=>{
    try {
      if (aoiCtx) {
        const idx = _selRungCard ? _selRungCard._rungNum + 1 : null;
        await POST("/api/aoi/rungs/add",{aoi:aoiCtx.aoiName,routine:aoiCtx.routineName,text:"NOP();",comment:"",index:idx});
        toast("Rung added"); setModified(true); _active={kind:"aoi",name:aoiCtx.aoiName}; renderContent(_active);
      } else {
        const idx = _selRungCard ? _selRungCard._rungNum + 1 : null;
        await POST("/api/rungs/add",{program,routine,text:"NOP();",comment:"",index:idx});
        toast("Rung added"); setModified(true); _invalidateRoutineCache();
        showRoutine(qs("#content"),program,routine,_active.rungOffset||0);
      }
    } catch(e){toast(e.message,"err");}
  });
  rungBtn.draggable=true;
  rungBtn.ondragstart=(e)=>{_dragBegin({kind:"new-rung",program,routine,aoiCtx});e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("text/plain","rung");};
  rungBtn.ondragend=()=>_dragEnd();
  structGrp.appendChild(rungBtn);
  const branchBtn = mkB("⊕ Branch","tbInstr tbSpecial",()=>{
    if (_selRungCard&&_selRungCard._builder) {
      if (window._ldInsertPos) {
        const {arr,idx,onChange} = window._ldInsertPos;
        arr.splice(idx, 0, {kind:"branch",legs:[[],[]]});
        _clearInsertPos(); onChange();
      } else { _selRungCard._builder.addElement({kind:"branch",legs:[[],[]]}); }
    } else { toast("Select a rung first","err"); }
  });
  branchBtn.draggable=true;
  branchBtn.ondragstart=(e)=>{_dragBegin({kind:"new-branch"});e.dataTransfer.effectAllowed="copy";e.dataTransfer.setData("text/plain","branch");};
  branchBtn.ondragend=()=>_dragEnd();
  structGrp.appendChild(branchBtn);
  bar.appendChild(structGrp);

  // Hint label — shows when a wire position is selected (click-to-insert mode)
  const insertHint = mk("span","tbInsertHint","");
  bar._updateInsertHint = () => {
    if (window._ldInsertPos) {
      insertHint.textContent = "▼ Pos " + window._ldInsertPos.idx + " selected — click instruction to insert";
      insertHint.classList.add("active");
    } else {
      insertHint.textContent = "";
      insertHint.classList.remove("active");
    }
  };
  bar.appendChild(insertHint);
  // Wire up the callback: _clearInsertPos() and insertDot.onclick both fire window._onInsertPosChange
  window._onInsertPosChange = () => bar._updateInsertHint && bar._updateInsertHint();

  return bar;
}

/* Builds/re-builds just the rung list — called on first render AND on every
 * Visual/Raw toggle so mode switching is instant (no fetch, no loading flash). */
function _renderRungList(b, r, tagNames, program, name, rungOffset) {
  b.innerHTML = "";
  _selRungCard = null;
  if (!r.rungs.length && r.totalRungs===0){ b.appendChild(mk("p","empty","No rungs.")); return; }

  // Control bar: Visual/Raw toggle
  const ctrlBar=mk("div","rungCtrlBar"); b.appendChild(ctrlBar);
  ctrlBar.appendChild(buildBuilderModeToggle(
    ()=>_active.builderMode||"visual",
    (m)=>{
      _active.builderMode=m;
      // Sync global toggle button styling
      ctrlBar.querySelectorAll(".routineModeToggle button").forEach((btn,i)=>{
        btn.className=(i===0&&m==="visual")||(i===1&&m==="raw")?"primary":"";
      });
      // Switch each rung card in-place without a full page re-render
      if (list) list.querySelectorAll(".rungCard").forEach(card=>{
        if (!card._builder) return;
        const curMode = card._builder.getMode ? card._builder.getMode() : null;
        if (curMode === m) return;  // already in target mode
        card._builder.setMode(m);
        // Sync the per-rung mode button text
        const btn = card.querySelector(".rungModeBtn");
        if (btn) btn.textContent = m === "raw" ? "\u21A9 Visual" : "\u270F Raw";
      });
    },
  ));
  let list;

  if (r.totalRungs>RUNG_PAGE) {
    const pg=pager(rungOffset,r.totalRungs,RUNG_PAGE,n=>{
      _active.rungOffset=n; _invalidateRoutineCache(); showRoutine(qs("#content"),program,name,n);
    }); b.appendChild(pg);
  }
  // Language Element Toolbar (Studio 5000-style quick-insert strip)
  b.appendChild(buildElemToolbar(program, name));

  list=mk("div","rungList"); b.appendChild(list);
  r.rungs.forEach(rung=>{
    const card=buildRungCard(rung,program,name,tagNames,_active.builderMode||"visual");
    // Rung drag-and-drop: only the badge is a drag handle (not the whole card)
    // This prevents rung reorder drag from conflicting with instruction drag
    const _badge = card.querySelector(".rungNumBadge");
    if (_badge) {
      _badge.draggable = true;
      _badge.title = "Drag to reorder rung";
      _badge.style.cursor = "grab";
      _badge.ondragstart = (e) => {
        e.stopPropagation();
        _dragBegin({ kind:"rung", num: rung.number });
        e.dataTransfer.effectAllowed = "move";
        e.dataTransfer.setData("text/plain", String(rung.number));
        card.classList.add("dragging");
      };
      _badge.ondragend = () => { card.classList.remove("dragging"); _dragEnd(); };
    }
    card.ondragover = (e) => {
      const d = window._ldDrag;
      if (!d) return;
      if (d.kind === "rung") {
        if (d.num === rung.number) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "move";
        card.classList.add("rungDragOver");
      } else if (d.kind === "new-rung") {
        e.preventDefault(); e.dataTransfer.dropEffect = "copy";
        card.classList.add("rungDragOver");
      } else {
        // Instruction drag: accept so cursor shows copy (wire child already handled it if over wire)
        e.preventDefault(); e.dataTransfer.dropEffect = "copy";
      }
    };
    card.ondragleave = (e) => { if (!card.contains(e.relatedTarget)) card.classList.remove("rungDragOver"); };
    card.ondrop = async (e) => {
      card.classList.remove("rungDragOver");
      const d = window._ldDrag;
      if (!d) return; // already handled by wire/insertDot child (which stopPropagated)
      e.preventDefault();
      if (d.kind === "new-rung") {
        // +Rung dragged and dropped on a card: insert a new rung after this one
        try {
          await POST("/api/rungs/add",{program,routine:name,text:"NOP();",comment:"",index:rung.number+1});
          toast("Rung added"); setModified(true); _invalidateRoutineCache();
          showRoutine(qs("#content"),program,name,_active.rungOffset||0);
        } catch(ex){toast(ex.message||"Add failed","err");}
        _dragEnd(); return;
      }
      if (d.kind !== "rung") {
        // Instruction dropped on card area outside the wire — insert at end of rung
        if (card._builder && card._builder.addElement) {
          const instr = d.kind === "new-instr" ? instructionByCode(d.code) : null;
          let el;
          if (d.kind === "new-instr") {
            el = {kind:"instr",code:d.code,args:instr?instr.operands.map(()=>""):[]};
          } else if (d.kind === "move-instr") {
            el = d.arr[d.idx];
            d.arr.splice(d.idx, 1);
          }
          if (el) card._builder.addElement(el);
        }
        _dragEnd(); return;
      }
      if (d.kind !== "rung" || d.num === rung.number) return;
      try {
        await POST("/api/rungs/move",{program,routine:name,frm:d.num,to:rung.number});
        setModified(true); _invalidateRoutineCache();
        showRoutine(qs("#content"),program,name,_active.rungOffset||0);
      } catch(ex){ toast(ex.message||"Move failed","err"); }
      _dragEnd();
    };
    list.appendChild(card);
  });
  // Navigate to a specific rung when returning from a Find result click
  if (_active.highlightRung !== undefined) {
    const target = Number(_active.highlightRung);
    delete _active.highlightRung;
    const cards = list.querySelectorAll(".rungCard");
    for (const card of cards) {
      if (Number(card._rungNum) === target) {
        _selectRung(card);
        // Scroll after paint so the element is in view
        requestAnimationFrame(()=>requestAnimationFrame(()=>
          card.scrollIntoView({behavior:"smooth",block:"center"})));
        break;
      }
    }
  }
  if (r.totalRungs>RUNG_PAGE) {
    const pg2=pager(rungOffset,r.totalRungs,RUNG_PAGE,n=>{
      _active.rungOffset=n; _invalidateRoutineCache(); showRoutine(qs("#content"),program,name,n);
    }); b.appendChild(pg2);
  }

  // Keyboard shortcuts on selected rung (skips when focus is in any input)
  function _onKeyDel(e) {
    const tgt=document.activeElement;
    if (tgt&&(tgt.tagName==="INPUT"||tgt.tagName==="TEXTAREA"||tgt.tagName==="SELECT")) return;
    // Ctrl+C: copy selected instruction/branch
    if ((e.ctrlKey||e.metaKey) && e.key==="c") {
      if (window._selElem && window._selElem._delCtx) {
        const meta = window._selElem._delCtx._dragMeta;
        if (meta) {
          window._ldClipboard = JSON.parse(JSON.stringify(meta.arr[meta.idx]));
          const el = meta.arr[meta.idx];
          toast("Copied " + (el.kind==="branch" ? "branch" : el.code));
          e.preventDefault();
        }
      }
      return;
    }
    // Ctrl+V: paste at insert cursor if set, else append to selected rung
    if ((e.ctrlKey||e.metaKey) && e.key==="v") {
      if (window._ldClipboard) {
        const el = JSON.parse(JSON.stringify(window._ldClipboard));
        if (window._ldInsertPos) {
          const {arr, idx, onChange} = window._ldInsertPos;
          arr.splice(idx, 0, el); _clearInsertPos(); onChange();
          toast("Pasted " + (el.kind==="branch" ? "branch" : el.code));
          e.preventDefault();
        } else if (_selRungCard && _selRungCard._builder) {
          if (_selRungCard._builder.addElement(el)) {
            toast("Pasted " + (el.kind==="branch" ? "branch" : el.code));
          } else { toast("Switch to Visual mode to paste","err"); }
          e.preventDefault();
        }
      }
      return;
    }
    // Delete key: instruction first (never accidentally deletes rung when instruction selected)
    if (e.key==="Delete" && window._selElem && window._selElem._delCtx) {
      e.preventDefault();
      window._selElem._delCtx.onDelete();
      window._selElem=null;
      return;
    }
    // Delete selected rung (only fires when NO instruction is selected)
    if (e.key==="Delete" && _selRungCard) {
      e.preventDefault();
      deleteRung(program, name, _selRungCard._rungNum);
      return;
    }
  }
  document.addEventListener("keydown", _onKeyDel);
  const obs=new MutationObserver(()=>{ if(!document.body.contains(b)){ document.removeEventListener("keydown",_onKeyDel); obs.disconnect(); }});
  obs.observe(document.body,{childList:true,subtree:true});
}

function showRoutine(c, program, name, rungOffset) {
  c.innerHTML = "";
  const p=mk("div","panel"); c.appendChild(p);
  // Mode-switch shortcut: reuse cached data if available (no fetch)
  const cached = _routineCache &&
    _routineCache.program === program &&
    _routineCache.name    === name    &&
    _routineCache.rungOffset === rungOffset;
  if (cached) {
    _renderRoutineBody(p, _routineCache.r, _routineCache.tagNames, program, name, rungOffset);
    return;
  }
  const ldr=mk("p","empty","Loading routine…"); p.appendChild(ldr);
  Promise.all([
    GET(`/api/routines/detail?program=${enc(program)}&name=${enc(name)}&rung_offset=${rungOffset}&rung_limit=${RUNG_PAGE}`),
    fetchTagNamesFor(program),
    _customInstructionsReady,
  ]).then(([r, tagNames])=>{
      _routineCache = {program, name, rungOffset, r, tagNames};
      ldr.remove();
      _renderRoutineBody(p, r, tagNames, program, name, rungOffset);
    }).catch(e=>{ ldr.textContent="Error: "+e.message; });
}

function pager(offset, total, pageSize, go) {
  const pg=mk("div","pagination");
  pg.appendChild(mk("span","",`${offset+1}–${Math.min(offset+pageSize,total)} of ${total}`));
  if (offset>0) pg.appendChild(mkB("◀ Prev","",()=>go(offset-pageSize)));
  if (offset+pageSize<total) pg.appendChild(mkB("Next ▶","",()=>go(offset+pageSize)));
  return pg;
}

function buildRungCard(rung, program, routine, tagNames, mode) {
  const card=mk("div","rungCard");
  card._rungNum = rung.number;
  card._selectSelf = () => _selectRung(card);

  /* Capture-phase click: fires before insertDot/element stopPropagation,
   * so clicking anywhere on the rung wire selects this rung card. */
  card.addEventListener("click", (e) => {
    if (e.target.closest(".rungCardHead")) return;
    if (e.target.tagName==="INPUT"||e.target.tagName==="TEXTAREA"||e.target.tagName==="SELECT") return;
    _selectRung(card);
  }, true);  // capture=true
  card.addEventListener("focusin", ()=>_selectRung(card));

  const hd=mk("div","rungCardHead"); card.appendChild(hd);
  hd.appendChild(mk("span","rungNumBadge",String(rung.number).padStart(4,"0")));
  const ci=mk("input","rungCommentInline"); ci.placeholder="Comment…"; ci.value=rung.comment||"";
  ci.title="Ctrl+Enter to quick-save this rung";
  hd.appendChild(ci);

  const bd=mk("div","rungCardBody"); card.appendChild(bd);
  let rungMode = mode;
  let builder = createRungBuilder(bd, rung.text, ()=>tagNames||[], {mode:rungMode, hideTabs:true});
  card._builder = builder;
  card._ci = ci;

  const acts=mk("div","rungHeadActs");
  const modeBtn = mkB(builder.getMode&&builder.getMode()==="raw"?"↩ Visual":"✏ Raw","sm rungModeBtn",()=>{
    const newMode = (builder.getMode ? builder.getMode() : rungMode)==="raw" ? "visual" : "raw";
    rungMode = newMode;
    if (builder.setMode) { builder.setMode(newMode); }
    else { const prev = builder.getText(); bd.innerHTML = ""; builder = createRungBuilder(bd, prev, ()=>tagNames||[], {mode:newMode, hideTabs:true}); card._builder = builder; }
    modeBtn.textContent = newMode==="raw" ? "↩ Visual" : "✏ Raw";
  });
  acts.append(modeBtn, mkB("✕","sm danger",()=>deleteRung(program,routine,rung.number)));
  hd.appendChild(acts);

  ci.addEventListener("keydown", async e=>{
    if (!e.ctrlKey||e.key!=="Enter") return;
    try {
      await POST("/api/rungs/edit",{program,routine,number:rung.number,text:builder.getText(),comment:ci.value});
      toast("Rung "+rung.number+" saved"); setModified(true); _invalidateRoutineCache();
    } catch(ex){ toast(ex.message,"err"); }
  });
  return card;
}

function _selectRung(card) {
  if (_selRungCard===card) return;
  _clearInsertPos();  // switching rungs clears any wire cursor
  if (_selRungCard) { _selRungCard.classList.remove("selected"); }
  const siblings = card.parentElement?.querySelectorAll(".rungCard");
  if (siblings) siblings.forEach(c=>c.classList.toggle("dimmed", c!==card));
  _selRungCard = card;
  card.classList.add("selected");
  card.classList.remove("dimmed");
}
/** One Visual/Raw toggle shared by every rung in the routine, instead of
 * each rung having its own tab pair — condenses the whole routine into a
 * single continuous ladder (or a single continuous raw-text listing). */
function buildBuilderModeToggle(getMode, setMode) {
  const box=mk("div","modeTabs routineModeToggle");
  const vb=mk("button"); vb.textContent="Visual Builder"; vb.className=getMode()==="visual"?"primary":""; vb.onclick=()=>setMode("visual");
  const rb=mk("button"); rb.textContent="Raw Text"; rb.className=getMode()==="raw"?"primary":""; rb.onclick=()=>setMode("raw");
  box.append(vb, rb);
  return box;
}

/** Grabs a reasonably-sized pool of tag names (controller + program scope)
 * for the operand autocomplete dropdown in the rung builder. Capped so it
 * stays fast even on documents with thousands of tags. */
async function fetchTagNamesFor(program) {
  try {
    const [ctrl, prog] = await Promise.all([
      GET(`/api/tags?limit=500`),
      program ? GET(`/api/tags?program=${enc(program)}&limit=500`) : Promise.resolve({tags:[]}),
    ]);
    const names = new Set();
    ctrl.tags.forEach(t=>names.add(t.name));
    prog.tags.forEach(t=>names.add(t.name));
    return [...names];
  } catch (e) { return []; }
}

/* ── actions ─────────────────────────────────────────────────────────────── */
async function deleteTag(program, name) {
  if (!confirm(`Delete tag "${name}"?`)) return;
  try { await POST("/api/tags/delete",{name,program}); toast("Tag deleted"); setModified(true); renderContent(_active); }
  catch(e){ toast(e.message,"err"); }
}
async function deleteProgram(name) {
  if (!confirm(`Delete program "${name}" and all its contents?`)) return;
  try { const s=await POST("/api/programs/delete",{name}); await refresh(s); _active={kind:"programs"}; renderContent(_active); toast("Deleted"); }
  catch(e){ toast(e.message,"err"); }
}
async function deleteRoutine(program, name) {
  if (!confirm(`Delete routine "${name}"?`)) return;
  try { const s=await POST("/api/routines/delete",{program,name}); await refresh(s); _active={kind:"routines",program}; renderContent(_active); toast("Deleted"); }
  catch(e){ toast(e.message,"err"); }
}
async function addRung(program, routine) {
  try { await POST("/api/rungs/add",{program,routine,text:"NOP();",comment:""}); toast("Rung added"); setModified(true); _invalidateRoutineCache(); renderContent(_active); }
  catch(e){ toast(e.message,"err"); }
}
async function deleteRung(program, routine, number) {
  if (!confirm(`Delete rung ${number}?`)) return;
  try { await POST("/api/rungs/delete",{program,routine,number}); toast("Rung deleted"); setModified(true); _invalidateRoutineCache(); renderContent(_active); }
  catch(e){ toast(e.message,"err"); }
}

/* ── prompts ─────────────────────────────────────────────────────────────── */
function openNewProgramPrompt() {
  const n=prompt("New program name:","Program1"); if (!n) return;
  POST("/api/programs/add",{name:n}).then(s=>{refresh(s);toast("Program created");}).catch(e=>toast(e.message,"err"));
}
function openNewRoutinePrompt(program) {
  const n=prompt("Routine name:","Routine1"); if (!n) return;
  const type=confirm("Click OK for Ladder (RLL), Cancel for ST") ? "RLL" : "ST";
  POST("/api/routines/add",{program,name:n,type}).then(s=>{
    refresh(s); toast("Routine created");
    _active={kind:"routine",program,name:n,rungOffset:0}; renderContent(_active);
  }).catch(e=>toast(e.message,"err"));
}

/* ── data type / AOI creation dialogs ───────────────────────────────────── */
function _rowDialog(opts) {
  /* Generic "name/description + dynamic rows" dialog builder shared by New
   * Data Type, New AOI, and Edit AOI Parameters (pre-filled via
   * initialName/initialDesc/initialRows, with lockName to disable renaming
   * an existing AOI from this dialog). */
  const dlg=document.createElement("dialog"); dlg.className="rowDialog";
  const rowsBox=mk("div","dlgRows");
  const rows=[];
  function addRow(vals) {
    const row=mk("div","dlgRow");
    const nameI=mk("input"); nameI.placeholder="Name"; nameI.value=vals?.name||"";
    const typeSel=mk("select"); [...new Set((opts.types||SCALAR_TYPES).concat((_summary?.dataTypes||[]).map(d=>d.name)).concat((_summary?.aoiDefinitions||[]).map(a=>a.name)))].forEach(t=>{
      const o=document.createElement("option"); o.textContent=t; typeSel.appendChild(o);
    });
    if (vals?.dataType) typeSel.value=vals.dataType;
    row.append(nameI, typeSel);
    let usageSel=null;
    if (opts.usage) {
      usageSel=mk("select");
      ["Input","Output","InOut"].forEach(u=>{ const o=document.createElement("option"); o.textContent=u; usageSel.appendChild(o); });
      if (vals?.usage) usageSel.value=vals.usage;
      row.appendChild(usageSel);
    }
    let dimI=null;
    if (opts.dimensions) {
      dimI=mk("input"); dimI.type="number"; dimI.min="0"; dimI.placeholder="Dim (0=scalar)";
      dimI.value=vals?.dimension||0; dimI.title="Array dimension (0 = not an array)";
      row.appendChild(dimI);
    }
    const rm=mkB("✕","icon",()=>{ rowsBox.removeChild(row); rows.splice(rows.indexOf(entry),1); });
    row.appendChild(rm);
    const entry={row,nameI,typeSel,usageSel,dimI,description:vals?.description||""};
    rows.push(entry);
    rowsBox.appendChild(row);
  }
  dlg.innerHTML=`<h3>${opts.title}</h3>
    <label>Name<input id="rdName" value="${opts.initialName||""}"${opts.lockName?" disabled":""}></label>
    <label>Description<input id="rdDesc" value="${opts.initialDesc||""}"></label>
    <div class="dlgRowsHead">${opts.rowsLabel}</div>`;
  dlg.appendChild(rowsBox);
  const addBtn=mkB(opts.addLabel,"sm",()=>addRow());
  dlg.appendChild(addBtn);
  const btnRow=mk("div","dlgBtns");
  const cancelB=mkB("Cancel","",()=>{ dlg.close(); dlg.remove(); });
  const okB=mkB(opts.okLabel,"primary",async()=>{
    const name=(opts.lockName?opts.initialName:dlg.querySelector("#rdName").value.trim());
    const description=dlg.querySelector("#rdDesc").value.trim();
    if (!name){ toast("Name required","err"); return; }
    const items=rows.map(r=>({
      name:r.nameI.value.trim(), dataType:r.typeSel.value,
      usage:r.usageSel?r.usageSel.value:undefined, required:false, description:r.description||"",
      dimension:r.dimI?(parseInt(r.dimI.value)||0):0,
    })).filter(r=>r.name);
    if (!items.length){ toast(opts.rowsLabel+" required","err"); return; }
    try { await opts.onSave(name, description, items); dlg.close(); dlg.remove(); }
    catch(e){ toast(e.message,"err"); }
  });
  btnRow.append(cancelB, okB);
  dlg.appendChild(btnRow);
  document.body.appendChild(dlg);
  if (opts.initialRows && opts.initialRows.length) opts.initialRows.forEach(r=>addRow(r));
  else { addRow(); addRow(); }
  dlg.showModal();
}

function openNewDataTypeDialog() {
  _rowDialog({
    title: "New Data Type", rowsLabel: "Members", addLabel: "+ Add Member", okLabel: "Create",
    types: SCALAR_TYPES, dimensions: true,
    onSave: async (name, description, members) => {
      const s = await POST("/api/datatypes/add", {name, description, members});
      await refresh(s); toast("Data type created");
      _active={kind:"datatype",name}; renderContent(_active);
    },
  });
}

function openNewAoiDialog() {
  _rowDialog({
    title: "New Add-On Instruction", rowsLabel: "Parameters", addLabel: "+ Add Parameter", okLabel: "Create",
    types: SCALAR_TYPES, usage: true,
    onSave: async (name, description, parameters) => {
      const s = await POST("/api/aoi/add", {name, description, parameters});
      await refresh(s); toast("AOI created");
      _active={kind:"aoi",name}; renderContent(_active);
    },
  });
}

/* ── tag dialog ──────────────────────────────────────────────────────────── */
const ARRAY_TYPES=["BOOL","SINT","INT","DINT","LINT","REAL"];
const PREDEFINED_TYPES=["TIMER","COUNTER","CONTROL","STRING","MESSAGE","PID","ALARM_ANALOG","ALARM_DIGITAL"];
const SCALAR_TYPES=["BOOL","SINT","INT","DINT","LINT","USINT","UINT","UDINT","ULINT","REAL","LREAL"].concat(PREDEFINED_TYPES);
/** Full list of every data type this project actually knows about: atomics,
 * Studio 5000's predefined structures, every user-defined type (UDT), and
 * every Add-On Instruction (an AOI call needs a tag of its own type) -
 * so the "New/Edit Tag" data type dropdown isn't missing anything. */
function allKnownDataTypes() {
  const udts = (_summary?.dataTypes || []).map(d => d.name);
  const aois = (_summary?.aoiDefinitions || []).map(a => a.name);
  return [...new Set([...SCALAR_TYPES, ...udts, ...aois])];
}
function openTagDialog(program, existing) {
  const isEdit=!!existing, isArr=isEdit&&existing.isArray;
  const dlg=document.createElement("dialog");
  dlg.innerHTML=`<h3>${isEdit?"Edit":"New"} Tag</h3>
    <label>Name<input id="tgN" value="${isEdit?existing.name:""}"></label>
    <label>Data Type<select id="tgT"></select></label>
    <label><input type="checkbox" id="tgArr" style="width:auto;margin-right:6px"${isArr?" checked":""}> Array</label>
    <label id="tgDL" class="${isArr?"":"hidden"}">Array Length<input id="tgDim" type="number" min="1" value="${isEdit&&isArr?existing.dimensions:1}"></label>
    <label id="tgVL" class="${isArr?"hidden":""}">Initial Value<input id="tgVal" value="${isEdit&&!isArr?existing.value:"0"}"></label>
    <div id="tgAB" class="${isArr?"":"hidden"}"><label>Values (comma-separated)<textarea id="tgAV" rows="3">${isEdit&&isArr?(existing.arrayValues||[]).join(","):""}</textarea></label></div>
    <label>Description<input id="tgDesc" value="${isEdit?existing.description||"":""}"></label>
    <label><input type="checkbox" id="tgConst" style="width:auto;margin-right:6px"${isEdit&&existing.constant==="true"?" checked":""}> Constant</label>
    <div class="dlgBtns"><button id="tgX">Cancel</button><button id="tgOK" class="primary">${isEdit?"Save":"Create"}</button></div>`;
  document.body.appendChild(dlg);
  const tSel=dlg.querySelector("#tgT"), arrC=dlg.querySelector("#tgArr");
  function refT(){ const al=arrC.checked?ARRAY_TYPES:allKnownDataTypes(); tSel.innerHTML=al.map(t=>`<option${isEdit&&t===existing.dataType?" selected":""}>${t}</option>`).join(""); if(isEdit&&al.includes(existing.dataType)) tSel.value=existing.dataType; }
  function refV(){ ["#tgDL","#tgAB"].forEach(s=>dlg.querySelector(s).classList.toggle("hidden",!arrC.checked)); dlg.querySelector("#tgVL").classList.toggle("hidden",arrC.checked); }
  arrC.onchange=()=>{ refT(); refV(); }; refT(); refV(); dlg.showModal();
  dlg.querySelector("#tgX").onclick=()=>{ dlg.close(); dlg.remove(); };
  dlg.querySelector("#tgOK").onclick=async()=>{
    const name=dlg.querySelector("#tgN").value.trim(), dataType=tSel.value;
    const description=dlg.querySelector("#tgDesc").value.trim(), constant=dlg.querySelector("#tgConst").checked;
    if (!name){ toast("Name required","err"); return; }
    const ia=arrC.checked;
    let pl={name,dataType,description,program:program||null,constant};
    if (ia){ pl.dimensions=parseInt(dlg.querySelector("#tgDim").value)||1; pl.arrayValues=dlg.querySelector("#tgAV").value.split(",").map(s=>s.trim()).filter(Boolean); pl.value=""; }
    else { pl.value=dlg.querySelector("#tgVal").value.trim(); pl.dimensions=0; pl.arrayValues=[]; }
    try {
      if (isEdit) { pl.oldName=existing.name; await POST("/api/tags/edit",pl); } else { await POST("/api/tags/add",pl); }
      toast(isEdit?"Tag saved":"Tag created"); setModified(true); dlg.close(); dlg.remove();
      _active={kind:"tags",program}; renderContent(_active);
    } catch(e){ toast(e.message,"err"); }
  };
}

/* ── toolbar ─────────────────────────────────────────────────────────────── */
try {
  qs("#btnNew").onclick = () => {
    if (_cmpActiveTabId !== "editor") { _tbNew(); return; }  // In compare mode: new comparison tab
    qs("#dlgNew").showModal();
  };
  if (qs("#wBtnNew")) qs("#wBtnNew").onclick = () => qs("#dlgNew").showModal();
  if (qs("#btnCompare")) qs("#btnCompare").onclick = showCompare;
  qs("#npCancel").onclick = () => qs("#dlgNew").close();
  qs("#npCreate").onclick = async () => {
    const n=qs("#npName").value.trim()||"MyController";
    try {
      const s=await POST("/api/new",{controllerName:n,processorType:qs("#npProcessor").value,majorRev:qs("#npMajor").value,minorRev:qs("#npMinor").value});
      qs("#dlgNew").close(); await loadSummary(s); toast("Project created");
    } catch(e){ toast(e.message,"err"); }
  };
} catch(err) { console.error("Toolbar wiring error:", err); }

async function openFile(file) {
  if (!file) return;
  const edTab = _edEnsureTab();  // create tab if none; switch to editor mode
  startProgress("Opening " + file.name);
  const fd=new FormData(); fd.append("file",file);
  try {
    const r=await fetch(API+"/api/open",{method:"POST",body:fd});
    const d=await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.detail||r.statusText);
    // Store file object in current editor tab for re-open on tab switch
    if (edTab) { edTab.file=file; edTab.label=file.name; }
    await loadSummary(d); toast("Opened "+file.name);
  } catch(e){ toast(e.message,"err"); }
  finally { endProgress(); }
}

/** Call the server-side OS file picker. Returns the chosen path or "" if cancelled. */
async function pickFile(title) {
  if (!title) title = "Open L5X File";
  try {
    const fd = new FormData(); fd.append("title", title);
    const r = await fetch(API+"/api/pick_file",{method:"POST",body:fd});
    const d = await r.json().catch(()=>({}));
    return d.path || "";
  } catch(e) { toast(e.message||"File picker error","err"); return ""; }
}

async function openByPath(path) {
  if (!path) return;
  const edTab = _edEnsureTab();
  const fname = path.split(/[\\/]/).pop();
  startProgress("Opening " + fname);
  try {
    const fd = new FormData(); fd.append("path", path);
    const r = await fetch(API+"/api/open_path",{method:"POST",body:fd});
    const d = await r.json().catch(()=>({}));
    if (!r.ok) throw new Error(d.detail||r.statusText);
    if (edTab) { edTab.path=path; edTab.label=fname; }
    _saveRecentFile(fname, "editor", {a: path});
    await loadSummary(d); toast("Opened " + fname);
  } catch(e){ toast(e.message,"err"); }
  finally { endProgress(); }
}

async function _showOpenPathDlg() {
  const path = await pickFile("Open L5X File");
  if (path) openByPath(path);
}
// Wire the Open label: native OS picker for editor, browser file-dialog for compare (.cmpjson)
const _openLabelInterceptor = qs("#openLabel");
if (_openLabelInterceptor) {
  _openLabelInterceptor.addEventListener("click", async e => {
    if (_cmpActiveTabId !== "editor") return; // compare mode: let label click pass through to fileInput
    e.preventDefault();
    const path = await pickFile("Open L5X File");
    if (path) openByPath(path);
  }, true); // capture phase so we beat the label's default activation
}
try {
  qs("#fileInput").onchange = e => {
    const f = e.target.files[0]; e.target.value = "";
    if (!f) return;
    if (qs("#fileInput")._cmpMode) {
      const tab = _cmpTabs.find(t=>t.id===_cmpActiveTabId);
      if (!tab) { toast("Open a comparison tab first","err"); return; }
      const body = qs("#cmpOverlay .cmpBody");
      if (body) _cmpLoadSaved(f, tab, body); else toast("No comparison panel open","err");
    } else {
      openFile(f);
    }
  };
  if (qs("#fileInput2")) qs("#fileInput2").onchange = e=>{ openFile(e.target.files[0]); e.target.value=""; };
} catch(err) { console.error("File input wiring error:", err); }

qs("#btnSave").onclick = async () => {
  // In compare mode: save the comparison JSON instead of the L5X
  if (_cmpActiveTabId !== "editor") {
    const tab = _cmpTabs.find(t=>t.id===_cmpActiveTabId);
    if (tab) _cmpSave(tab); else toast("No comparison to save","err");
    return;
  }
  // Editor mode: download L5X
  startProgress("Saving");
  try {
    const r=await fetch(API+"/api/download"); if (!r.ok) throw new Error("Download failed");
    const blob=await r.blob(), a=document.createElement("a");
    a.href=URL.createObjectURL(blob); a.download=(_summary?.controller?.name||"project")+".L5X";
    a.click(); URL.revokeObjectURL(a.href);
    setModified(false);
    const edTab=_edGetActive(); if(edTab) edTab.modified=false;
    toast("Saved");
  } catch(e){ toast(e.message,"err"); }
  finally { endProgress(); }
};
/** Parses a validation message — returns a location object or null. */
function _parseValLocation(msg) {
  let m;
  // AOI rung: "AOI:AoiName.Routine Rung N: ..."
  m = msg.match(/^AOI:([\w]+)\.([\w]+)\s+Rung\s+(\d+)/i);
  if (m) return {kind:"aoirung", aoi:m[1], routine:m[2], rung:parseInt(m[3],10)};
  // Program rung: "ProgramName.RoutineName Rung N: ..."
  m = msg.match(/^([\w]+)\.([\w]+)\s+Rung\s+(\d+)/i);
  if (m) return {kind:"rung",program:m[1],routine:m[2],rung:parseInt(m[3],10)};
  // Program tag scope: "... in program 'ProgName'"
  m = msg.match(/in program '([\w]+)'/i);
  if (m) return {kind:"progtags",program:m[1]};
  // Controller tags: "... in controller tags"
  if (/in controller tags/i.test(msg)) return {kind:"ctrltags"};
  // Program-level: "Program 'Name': ..."
  m = msg.match(/^Program '([\w]+)':/i);
  if (m) return {kind:"program",program:m[1]};
  return null;
}
function _navigateToValItem(msg) {
  const loc = _parseValLocation(msg);
  if (!loc) { toast("No navigable location in this message","err"); return; }
  const tagM = msg.match(/[Tt]ag '([^']+)'/);
  const tagFilter = tagM ? tagM[1] : "";
  if (loc.kind === "aoirung") {
    _active = {kind:"aoi", name:loc.aoi, aoiTab:"logic", highlightRung:loc.rung};
    _exp.add("aois");
  } else if (loc.kind === "rung") {
    const rungPage = Math.floor(loc.rung / RUNG_PAGE) * RUNG_PAGE;
    _active = {kind:"routine",program:loc.program,name:loc.routine,rungOffset:rungPage,highlightRung:loc.rung};
    _exp.add("prog_"+loc.program); _exp.add("rtns_"+loc.program);
  } else if (loc.kind === "progtags") {
    _active = {kind:"tags",program:loc.program,_search:tagFilter};
    if (loc.program) { _exp.add("prog_"+loc.program); _exp.add("tags_"+loc.program); }
  } else if (loc.kind === "ctrltags") {
    _active = {kind:"tags",_search:tagFilter};
  } else if (loc.kind === "program") {
    _active = {kind:"routines",program:loc.program};
    if (loc.program) _exp.add("prog_"+loc.program);
  }
  renderTree(); renderContent(_active);
}
function showValidationLog(r) {
  let panel = document.getElementById("valFooter");
  if (!panel) {
    panel = document.createElement("div"); panel.id = "valFooter";
    const root = document.getElementById("root");
    const statusBar = document.getElementById("statusBar");
    root.insertBefore(panel, statusBar);
  }
  panel.innerHTML = "";
  const errList = r.errors || [], warnList = r.warnings || [];
  const hdr = mk("div","valHdr");
  const summary = r.valid ? "\u2705 Validation passed" :
    "\u274C " + [errList.length&&`${errList.length} error${errList.length>1?"s":""}`,
      warnList.length&&`${warnList.length} warning${warnList.length>1?"s":""}`].filter(Boolean).join(", ");
  hdr.appendChild(mk("span","valTitle",summary));
  hdr.appendChild(mkB("\xd7","valClose",()=>panel.classList.add("hidden")));
  panel.appendChild(hdr);
  const list = mk("div","valList"); panel.appendChild(list);
  if (!errList.length && !warnList.length) list.appendChild(mk("div","valItem valOk","No issues found."));
  function _makeValItem(cls, icon, msg) {
    const d = mk("div","valItem "+cls); d.textContent = icon + "  " + msg;
    const loc = _parseValLocation(msg);
    d.style.cursor = "pointer";
    d.title = loc ? "Click to navigate" : "No navigable location";
    d.onclick = () => _navigateToValItem(msg);
    return d;
  }
  errList.forEach(msg  => list.appendChild(_makeValItem("valErr",  "\u274c", msg)));
  warnList.forEach(msg => list.appendChild(_makeValItem("valWarn", "\u26a0\ufe0f", msg)));
  panel.classList.remove("hidden");
}
qs("#btnValidate").onclick = async () => {
  startProgress("Validating");
  try {
    const r=await POST("/api/validate");
    showValidationLog(r);
  } catch(e){ toast(e.message,"err"); }
  finally { endProgress(); }
};
qs("#treeSearch").oninput = debounce(()=>renderTree(), 200);

/* ── Process lifecycle ────────────────────────────────────────────────────────
 * Register this tab with the backend and send a heartbeat every 5 s.
 * When the tab is closed (beforeunload), the backend decrements its tab count
 * and exits automatically when the last tab is gone. */
(function() {
  // Register tab on load
  fetch(API + "/api/tab/connect", {method:"POST"}).catch(()=>{});
  // Periodic heartbeat (keeps watchdog alive for multi-tab scenarios)
  setInterval(() => fetch(API + "/api/heartbeat", {method:"POST"}).catch(()=>{}), 5000);
  // On tab close: decrement count; sendBeacon is reliable even during unload
  // On tab close: prompt if unsaved changes, then disconnect
  window.addEventListener("beforeunload", (e) => {
    // Check for any unsaved state across editor tabs and compare sessions
    const hasEdChanges = _modified || _edTabs.some(t => t.modified);
    const hasCmpData   = _cmpTabs.some(t => t.data);
    if (hasEdChanges || hasCmpData) {
      e.preventDefault();
      e.returnValue = hasEdChanges
        ? "You have unsaved changes. Refreshing will lose them."
        : "You have an open comparison session. Refreshing will close it.";
      return e.returnValue;
    }
    navigator.sendBeacon(API + "/api/tab/disconnect");
  });
})();


/* ── Find / Cross-Reference ─────────────────────────────────────────────── */
function runFind() {
  const q = qs("#findInput").value.trim();
  if (!q) return;
  // In compare mode: redirect to compare tree search
  if (_cmpActiveTabId !== "editor") {
    const tab = _cmpTabs.find(t=>t.id===_cmpActiveTabId);
    if (tab && tab.data) { _cmpShowFindDialog(tab, q); }
    else { toast("Run a comparison first","err"); }
    return;
  }
  if (!_summary) { toast("Open a project first","err"); return; }
  GET(`/api/search?q=${enc(q)}&limit=300`).then(showFindResults).catch(e=>toast(e.message,"err"));
}
function showFindResults(r) {
  const old=document.querySelector("dialog.findDialog"); if (old) old.remove();
  const dlg=document.createElement("dialog"); dlg.className="findDialog";
  dlg.innerHTML=`<h3>Find: "${r.query}"</h3>`;
  const body=mk("div","findBody"); dlg.appendChild(body);

  if (r.definitions.length) {
    body.appendChild(mk("div","dlgRowsHead",`Defined as (${r.definitions.length})`));
    const dt=mk("table","dataTable"); body.appendChild(dt);
    dt.innerHTML=`<tr><th>Kind</th><th>Location</th></tr>`;
    r.definitions.forEach(d=>{
      const tr=mk("tr"); dt.appendChild(tr);
      tr.innerHTML=`<td class="type">${d.kind}</td><td>${d.location}${d.dataType?` <span class="desc">(${d.dataType})</span>`:""}</td>`;
    });
  } else {
    body.appendChild(mk("p","empty","Not defined as a tag/type/AOI/routine/program name."));
  }

  body.appendChild(mk("div","dlgRowsHead",`Used in ${r.usages.length} rung${r.usages.length===1?"":"s"}${r.truncated?" (truncated)":""}`));
  if (!r.usages.length) body.appendChild(mk("p","empty","No rung usages found."));
  r.usages.forEach(u=>{
    const row=mk("div","findHit");
    row.innerHTML=`<div class="findHitHead">${u.isAoi?"⚙️ AOI ":"📦 "}<b>${u.scope}</b> — Rung ${u.rung}${u.comment?` <span class="desc">// ${u.comment}</span>`:""}</div><pre class="findHitText"></pre>`;
    row.querySelector(".findHitText").textContent = u.text.trim();
    row.onclick = () => {
      dlg.close(); dlg.remove();
      if (u.isAoi) {
        _active={kind:"aoi",name:u.program,aoiTab:"logic",highlightRung:u.rung};
      } else {
        const rungPage = Math.floor(u.rung / RUNG_PAGE) * RUNG_PAGE;
        _active={kind:"routine",program:u.program,name:u.routine,rungOffset:rungPage,highlightRung:u.rung};
        _exp.add("prog_"+u.program); _exp.add("rtns_"+u.program);
      }
      renderTree(); renderContent(_active);
    };
    body.appendChild(row);
  });

  const btnRow=mk("div","dlgBtns");
  btnRow.appendChild(mkB("Close","",()=>{ dlg.close(); dlg.remove(); }));
  dlg.appendChild(btnRow);
  document.body.appendChild(dlg);
  dlg.showModal();
}
qs("#btnFind").onclick = runFind;
qs("#findInput").onkeydown = e => { if (e.key==="Enter") runFind(); };

/* ── resizer ─────────────────────────────────────────────────────────────── */
(function(){
  const rz=qs("#resizer"), org=qs("#organizer"); let drag=false,sx,sw;
  rz.onmousedown=e=>{ drag=true; sx=e.clientX; sw=org.offsetWidth; };
  document.onmousemove=e=>{ if (!drag) return; org.style.width=Math.max(180,Math.min(600,sw+e.clientX-sx))+"px"; };
  document.onmouseup=()=>{ drag=false; };
})();

/* ── utils ───────────────────────────────────────────────────────────────── */
function enc(s){ return encodeURIComponent(s); }
function debounce(fn,ms){ let t; return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms);}; }

/* ── progress bar ─────────────────────────────────────────────────────────── */
let _progTimer = null;
let _progVal   = 0;

function startProgress(msg) {
  const bar  = qs("#progressBar");
  const fill = qs("#progressFill");
  clearInterval(_progTimer);
  _progVal = 0;
  fill.style.transition = "none";
  fill.style.width = "0%";
  bar.classList.add("active");
  // Quick jump to 25%, then slow crawl toward 85%
  requestAnimationFrame(() => {
    fill.style.transition = "width .35s cubic-bezier(.4,0,.2,1)";
    fill.style.width = "25%";
  });
  _progVal = 25;
  _progTimer = setInterval(() => {
    _progVal = Math.min(85, _progVal + (85 - _progVal) * 0.06 + 0.4);
    fill.style.width = _progVal + "%";
  }, 250);
  if (msg) qs("#statusText").textContent = msg + "…";
}

function endProgress() {
  clearInterval(_progTimer);
  _progTimer = null;
  const fill = qs("#progressFill");
  const bar  = qs("#progressBar");
  fill.style.transition = "width .15s ease";
  fill.style.width = "100%";
  setTimeout(() => {
    bar.classList.remove("active");
    setTimeout(() => {
      fill.style.transition = "none";
      fill.style.width = "0%";
    }, 200);
  }, 300);
}

/* ── close file ───────────────────────────────────────────────────────────── */
/* ── Recent files (localStorage) ─────────────────────────────────────── */
function _saveRecentFile(name, type, paths) {
  // paths: undefined for editor, {a,b} for compare
  try {
    const list = JSON.parse(localStorage.getItem("lwRecent")||"[]");
    const filtered = list.filter(r=>!(r.name===name && r.type===type));
    filtered.unshift({name, type, ts: Date.now(), paths: paths||null});
    localStorage.setItem("lwRecent", JSON.stringify(filtered.slice(0,12)));
  } catch(e) {}
}
function _getRecentFiles() {
  try { return JSON.parse(localStorage.getItem("lwRecent")||"[]"); } catch(e) { return []; }
}
function _relTime(ts) {
  const d = Date.now()-ts, m=60000, h=3600000, day=86400000;
  if (d<m)   return "just now";
  if (d<h)   return Math.floor(d/m)+"m ago";
  if (d<day) return Math.floor(d/h)+"h ago";
  return Math.floor(d/day)+"d ago";
}

function _renderWelcome(container) {
  container.innerHTML = "";
  const w = mk("div","welcomeScreen"); w.id = "welcome"; container.appendChild(w);

  // Hero
  const hero = mk("div","welcomeHero"); w.appendChild(hero);
  hero.innerHTML = `
    <div class="welcomeLogoMark">⚙</div>
    <h1 class="welcomeTitle">Logix Workbench</h1>
    <p class="welcomeTagline">Studio 5000-style editor &amp; comparison tool for Allen-Bradley .L5X files</p>
    <p class="welcomeHint">Click <kbd>+&thinsp;Editor</kbd> or <kbd>+&thinsp;Compare</kbd> in the tab bar to get started.</p>`;

  // Guide button
  const guideBtn = mk("button","welcomeGuideBtn","📖 User Guide"); guideBtn.onclick = showUserGuide;
  hero.appendChild(guideBtn);

  // Feature cards
  const grid = mk("div","welcomeCards"); w.appendChild(grid);
  [
    {icon:"🗂", title:"Editor",         desc:"Open and edit .L5X files. Navigate programs, routines, tags, data types, AOIs, I/O, and trends from the Controller Organizer."},
    {icon:"⇄", title:"Compare",        desc:"Diff two .L5X revisions side-by-side. See every change — tags, logic, AOIs, data types. Migrate individual items between files."},
    {icon:"🪜", title:"Ladder Logic",  desc:"Visual rung diagram with click-to-edit. Switch between visual and raw text modes. AOI instructions expand with full parameter names."},
    {icon:"📐", title:"Data Types",    desc:"Create and edit User-Defined Types. Add, reorder, and type members inline. All changes sync to the live Controller Organizer."},
  ].forEach(f => {
    const card = mk("div","welcomeFeatureCard"); grid.appendChild(card);
    card.innerHTML = `<div class="wfIcon">${f.icon}</div><strong>${f.title}</strong><p>${f.desc}</p>`;
  });

  // Recent files
  const recent = _getRecentFiles();
  if (recent.length) {
    const sec = mk("div","welcomeRecentSec"); w.appendChild(sec);
    const recHdr = mk("div","welcomeRecentHdr"); sec.appendChild(recHdr);
    recHdr.appendChild(mk("h3","welcomeRecentTitle","Recent Files"));
    const recFilter = mk("input","welcomeRecentFilter");
    recFilter.type="search"; recFilter.placeholder="Filter..."; recFilter.autocomplete="off";
    recHdr.appendChild(recFilter);
    const list = mk("div","welcomeRecentList"); sec.appendChild(list);
    recFilter.oninput = () => {
      const q = recFilter.value.trim().toLowerCase();
      list.querySelectorAll(".welcomeRecentRow").forEach(r => {
        r.style.display = (!q || r.dataset.filter?.includes(q)) ? "" : "none";
      });
    };
    recent.forEach(item => {
      const row = mk("div","welcomeRecentRow"); list.appendChild(row);
      row.dataset.filter = ((item.name||"")+" "+(item.paths?.a||"")+" "+(item.paths?.b||"")).toLowerCase();
      row.innerHTML = `<span class="wrIcon">${item.type==="compare"?"⇄":"🗂"}</span><span class="wrName">${item.name}</span><span class="wrDate">${_relTime(item.ts)}</span>`;
      const paths = item.paths;
      if (paths) {
        row.classList.add("clickable");
        row.title = item.type==="compare"
          ? `Open: ${paths.a||""} ⇄ ${paths.b||""}`
          : `Open: ${paths.a||""}`;
        row.onclick = () => {
          if (item.type==="compare" && paths.a && paths.b) {
            const tab = _tbNew();  // opens a compare tab
            if (tab) { tab.pathA = paths.a; tab.pathB = paths.b; }
            // show panel and auto-run
            setTimeout(async () => {
              const overlay = qs("#cmpOverlay");
              if (overlay) { overlay.innerHTML=""; _cmpShowPanel(overlay, tab); }
              // pre-fill and trigger compare
              const pa = paths.a, pb = paths.b;
              startProgress("Comparing files…");
              try {
                const fd = new FormData();
                fd.append("pathA",pa); fd.append("pathB",pb);
                fd.append("include_comments","false"); fd.append("include_values","false");
                const r = await fetch(API+"/api/compare_paths",{method:"POST",body:fd});
                const d = await r.json().catch(()=>({}));
                if (!r.ok) throw new Error(d.detail||r.statusText);
                tab.data=d; tab.label=item.name; _tbRender();
                const body = qs("#cmpOverlay .cmpBody");
                if (body) { body.innerHTML=""; _renderCmpSplit(body,tab); }
                _updateToolbarForMode();
              } catch(e){ toast(e.message,"err"); }
              finally { endProgress(); }
            }, 50);
          } else if (item.type==="editor" && paths.a) {
            openByPath(paths.a);
          }
        };
      }
    });
  }
}

/* ── User Guide modal ────────────────────────────────────────────────────── */
function showUserGuide() {
  // Opens in a separate browser tab - user can keep it open while working
  window.open("/guide.html", "_blank", "noopener");
}

// Wire ? key + global keyboard shortcuts
document.addEventListener("keydown", e => {
  const tag = document.activeElement?.tagName;
  const inInput = ["INPUT","TEXTAREA","SELECT"].includes(tag);
  const ctrl = e.ctrlKey || e.metaKey;

  // ? opens the guide (not in input fields)
  if (e.key==="?" && !ctrl && !e.altKey && !inInput) { showUserGuide(); return; }

  // Esc: close any open overlay dialogs
  if (e.key==="Escape") {
    const sc = document.getElementById("dlgShortcuts");
    if (sc) { sc.remove(); e.preventDefault(); return; }
    const findDlg = document.querySelector("dialog.findDialog");
    if (findDlg && findDlg.open) { findDlg.close(); findDlg.remove(); e.preventDefault(); return; }
  }

  if (!ctrl) return;

  // Ctrl+S: Save
  if (e.key==="s" || e.key==="S") {
    e.preventDefault();
    qs("#btnSave").click();
    return;
  }

  // Ctrl+O: Open
  if ((e.key==="o" || e.key==="O") && !inInput) {
    e.preventDefault();
    if (_cmpActiveTabId === "editor") { _showOpenPathDlg(); }
    return;
  }

  // Ctrl+N: New (editor) or new compare tab
  if ((e.key==="n" || e.key==="N") && !inInput && !e.shiftKey) {
    e.preventDefault();
    qs("#btnNew").click();
    return;
  }

  // Ctrl+W: Close current tab
  if ((e.key==="w" || e.key==="W") && !inInput) {
    e.preventDefault();
    qs("#btnClose").click();
    return;
  }

  // Ctrl+F: Focus find box
  if (e.key==="f" || e.key==="F") {
    e.preventDefault();
    const fi = qs("#findInput"); if (fi) { fi.focus(); fi.select(); }
    return;
  }

  // Ctrl+Tab / Ctrl+Shift+Tab: cycle tabs
  if (e.key==="Tab") {
    e.preventDefault();
    const allTabs = [..._edTabs.map(t=>({kind:"ed",id:t.id})),
                      ..._cmpTabs.map(t=>({kind:"cmp",id:t.id}))];
    if (!allTabs.length) return;
    const curId = _cmpActiveTabId !== "editor" ? _cmpActiveTabId : _edActiveId;
    const ci = allTabs.findIndex(t=>t.id===curId);
    const ni = e.shiftKey
      ? (ci <= 0 ? allTabs.length-1 : ci-1)
      : (ci >= allTabs.length-1 ? 0 : ci+1);
    const next = allTabs[ni];
    if (next.kind==="ed") _edSwitchTab(next.id);
    else _tbSwitch(next.id);
    return;
  }

  // Ctrl+Z: Undo  Ctrl+Y: Redo  (notify if no in-progress edit)
  if ((e.key==="z" || e.key==="Z") && !inInput) {
    toast("Undo: edit within a rung to use Ctrl+Z","err");
    return;
  }

  // Ctrl+/ : keyboard shortcut cheatsheet toggle
  if (e.key==="/") {
    e.preventDefault();
    _showShortcutCheatsheet();
    return;
  }

  // Ctrl+G : jump to rung number
  if ((e.key==="g" || e.key==="G") && !inInput) {
    e.preventDefault();
    _jumpToRung();
    return;
  }
});

function _showShortcutCheatsheet() {
  const old = document.getElementById("dlgShortcuts");
  if (old) { old.remove(); return; }
  const modal = document.createElement("div");
  modal.id = "dlgShortcuts";
  modal.style.cssText = "position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;z-index:9999;";
  const box = document.createElement("div"); box.className = "shortcutBox";
  box.innerHTML = '<div class="shortcutHdr"><span>Keyboard Shortcuts</span>'
    + '<button class="ugClose" onclick="document.getElementById(\'dlgShortcuts\').remove()">\u2715</button></div>'
    + '<div class="shortcutGrid">'
    + '<div class="scSection">File &amp; Editing</div>'
    + '<div class="scRow"><kbd>Ctrl+S</kbd><span>Save file</span></div>'
    + '<div class="scRow"><kbd>Ctrl+O</kbd><span>Open file</span></div>'
    + '<div class="scRow"><kbd>Ctrl+N</kbd><span>New file</span></div>'
    + '<div class="scRow"><kbd>Ctrl+W</kbd><span>Close current tab</span></div>'
    + '<div class="scSection">Navigation</div>'
    + '<div class="scRow"><kbd>Ctrl+F</kbd><span>Focus search / find box</span></div>'
    + '<div class="scRow"><kbd>Ctrl+Tab</kbd><span>Next tab</span></div>'
    + '<div class="scRow"><kbd>Ctrl+Shift+Tab</kbd><span>Previous tab</span></div>'
    + '<div class="scRow"><kbd>Ctrl+G</kbd><span>Jump to rung number</span></div>'
    + '<div class="scSection">Misc</div>'
    + '<div class="scRow"><kbd>?</kbd><span>Open User Guide (new tab)</span></div>'
    + '<div class="scRow"><kbd>Ctrl+/</kbd><span>This cheatsheet (toggle)</span></div>'
    + '<div class="scRow"><kbd>Esc</kbd><span>Close open dialogs</span></div>'
    + '</div>';
  modal.appendChild(box);
  document.body.appendChild(modal);
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
}

function _jumpToRung() {
  const cards = [...document.querySelectorAll(".rungCard")];
  if (!cards.length) { toast("No rungs visible","err"); return; }
  const nums = cards.map(c => parseInt(c.querySelector(".rungNumBadge")?.textContent||"-1",10)+1);
  const maxN = Math.max(...nums);
  const inp = prompt("Jump to rung (1 to " + maxN + "):");
  if (!inp) return;
  const target = parseInt(inp,10) - 1;
  for (const card of cards) {
    const badge = card.querySelector(".rungNumBadge");
    if (badge && parseInt(badge.textContent,10) === target) {
      card.scrollIntoView({block:"center",behavior:"smooth"});
      card.classList.add("cmpFindHighlight");
      setTimeout(()=>card.classList.remove("cmpFindHighlight"),2000);
      return;
    }
  }
  toast("Rung "+inp+" not found","err");
}

function closeFile() {
  const t = _edGetActive();
  if ((t?.modified || _modified) && !confirm("You have unsaved changes. Close anyway?")) return;
  if (t) {
    // Remove the tab entirely (no "New File" ghost tab left behind)
    t.modified = false; setModified(false);
    _edCloseTab(t.id);
  } else {
    _summary = null; _active = null;
    _exp.clear(); setModified(false);
    qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = true;
    qs("#docName").textContent = ""; qs("#statusText").textContent = "Ready";
    const vf = qs("#valFooter"); if (vf) vf.classList.add("hidden");
    _setOrganizerVisible(false); qs("#orgTree").innerHTML = "";
    _renderWelcome(qs("#content")); _tbRender(); _updateToolbarForMode();
  }
}

qs("#btnClose").onclick = () => {
  if (_cmpActiveTabId !== "editor") {
    _tbClose(_cmpActiveTabId);
  } else {
    closeFile();
  }
};

/* ── Toolbar context-aware mode ─────────────────────────────────────────── */
function _updateToolbarForMode() {
  const isCompare = _cmpActiveTabId !== "editor";
  const saveBtnEl = qs("#btnSave");
  const fileInputEl = qs("#fileInput");
  const newBtnEl = qs("#btnNew");
  const openLabelEl = qs("#openLabel");
  const noContext = _edTabs.length === 0 && _cmpTabs.length === 0;

  if (isCompare) {
    if (fileInputEl) { fileInputEl.accept = ".cmpjson,.json"; fileInputEl._cmpMode = true; }
    const tab = _cmpTabs.find(t=>t.id===_cmpActiveTabId);
    saveBtnEl.disabled = !(tab && tab.data);
    if (newBtnEl) newBtnEl.disabled = true;
  } else {
    if (fileInputEl) { fileInputEl.accept = ".l5x,.xml"; fileInputEl._cmpMode = false; }
    saveBtnEl.disabled = !_summary;
    // Disable New when on the pure home screen — use +Editor tab to create a file
    if (newBtnEl) newBtnEl.disabled = noContext;
  }
  // Disable Open on pure home screen (no editor or compare tabs open)
  if (openLabelEl) openLabelEl.classList.toggle("tbDisabled", noContext);
}

/* ── Tab / Screen System ─────────────────────────────────────────────────── */
/* _tbRender is declared with `function` so it hoists — loadSummary can call
   it safely even though it's defined later in the file.                     */

let _cmpTabs = [];           // [{id, label, fileA, fileB, data, viewMode}]
let _cmpActiveTabId = "editor";

function _tbRender() {
  const bar = qs("#tabBar");
  if (!bar) return;
  bar.innerHTML = "";

  // Editor tabs (one per open file)
  _edTabs.forEach(t => {
    const isActive = _cmpActiveTabId === "editor" && _edActiveId === t.id;
    const tab = mk("div","wbTab"+(isActive?" active":""));
    tab.appendChild(mk("span","wbTabIcon","🗂"));
    const lbl = t.summary ? (t.summary.controller?.name||"Editor")+".L5X" : (t.label||"Editor");
    tab.appendChild(mk("span","wbTabLabel", lbl + (t.modified?" *":"")));
    const x = mk("span","wbTabClose","×"); x.title="Close";
    x.onclick = e => { e.stopPropagation(); _edCloseTab(t.id); };
    tab.appendChild(x);
    tab.onclick = () => _edSwitchTab(t.id);
    bar.appendChild(tab);
  });

  // New editor tab button
  const ne = mk("button","wbTabNew","+ Editor");
  ne.title = "Open a new file in a second editor tab";
  ne.onclick = _edNewTab;
  bar.appendChild(ne);

  // Separator
  const sep = mk("span","wbTabSep","|"); bar.appendChild(sep);

  // Compare tabs
  _cmpTabs.forEach(t => {
    const tab = mk("div","wbTab"+(_cmpActiveTabId===t.id?" active":""));
    tab.appendChild(mk("span","wbTabIcon","⇄"));
    tab.appendChild(mk("span","wbTabLabel", t.label));
    const x = mk("span","wbTabClose","×"); x.title="Close";
    x.onclick = e => { e.stopPropagation(); _tbClose(t.id); };
    tab.appendChild(x);
    tab.onclick = () => _tbSwitch(t.id);
    bar.appendChild(tab);
  });

  const nb = mk("button","wbTabNew","+ Compare");
  nb.title = "Compare two .L5X files side-by-side";
  nb.onclick = _tbNew;
  bar.appendChild(nb);
}

function _tbSwitch(id) {
  _cmpActiveTabId = id;
  const overlay = qs("#cmpOverlay");
  if (id === "editor") {
    if (overlay) overlay.classList.add("hidden");
    // Restore editor content for the current editor tab
    const edTab = _edGetActive();
    if (edTab) {
      _summary = edTab.summary || _summary;
      _active  = edTab.active  || _active  || {kind:"controller"};
      _exp.clear(); (edTab.exp || new Set()).forEach(v => _exp.add(v));
      setModified(edTab.modified || false);
      if (_summary) {
        qs("#docName").textContent = edTab.label || "";
        const s = _summary;
        qs("#statusText").textContent = s.controller
          ? (s.controller.name + "  •  " + s.counts.programs + " programs  •  " + (s.counts.tasks||0) + " tasks  •  " + s.counts.tags + " ctrl tags")
          : "Ready";
        qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = false;
        const welcome = qs("#welcome"); if (welcome) welcome.remove();
        _setOrganizerVisible(true);
        renderTree(); renderContent(_active);
      }
    }
  } else {
    if (overlay) {
      overlay.classList.remove("hidden");
      overlay.innerHTML = "";
      const tab = _cmpTabs.find(t => t.id === id);
      if (tab) _cmpShowPanel(overlay, tab);
    }
  }
  _tbRender();
  _updateToolbarForMode();
}

function _tbNew() {
  const id = "cmp_" + Date.now();
  _cmpTabs.push({id, label:"New Comparison", fileA:null, fileB:null, data:null, viewMode:"visual"});
  _tbSwitch(id);
}

/* ── Editor tab management ──────────────────────────────────────────────── */
function _edNewTab() {
  // Save current state before creating new tab
  _edSaveCurrent();
  const id = "ed_" + Date.now();
  _edTabs.push({id, label:"New File", file:null, summary:null, active:null, exp:new Set(), modified:false});
  _edSwitchTab(id);
}

async function _edSwitchTab(id) {
  // Already on this tab in editor mode — no-op
  if (id === _edActiveId && _cmpActiveTabId === "editor") return;

  // If currently in compare mode, return to editor first
  if (_cmpActiveTabId !== "editor") {
    const overlay = qs("#cmpOverlay");
    if (overlay) overlay.classList.add("hidden");
    _cmpActiveTabId = "editor";
  }

  // Warn if current tab has unsaved changes
  const cur = _edGetActive();
  if (cur && cur.modified) {
    if (!confirm(`Switch tabs? Unsaved changes to "${cur.label||"Editor"}" will be lost.`)) return;
    cur.modified = false; setModified(false);
  }
  _edSaveCurrent();

  const t = _edTabs.find(tab=>tab.id===id);
  if (!t) return;

  if (t.file || t.path) {
    startProgress("Loading " + t.label);
    try {
      let d;
      if (t.file) {
        const fd = new FormData(); fd.append("file", t.file);
        const r = await fetch(API+"/api/open",{method:"POST",body:fd});
        d = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(d.detail||r.statusText);
      } else {
        // Re-open by server path (native file picker path)
        const fd = new FormData(); fd.append("path", t.path);
        const r = await fetch(API+"/api/open_path",{method:"POST",body:fd});
        d = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(d.detail||r.statusText);
      }
      endProgress();
      t.summary = d; t.label = (d.controller?.name||t.label)+".L5X"; t.modified = false;
      _saveRecentFile(t.label, "editor", t.path ? {a:t.path} : null);
      _edActiveId = id;
      _summary = d;
      _active = t.active || {kind:"controller"};
      _exp.clear(); (t.exp||new Set()).forEach(v=>_exp.add(v));
      setModified(false);
      qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = false;
      qs("#docName").textContent = t.label;
      qs("#statusText").textContent = `${d.controller.name}  •  ${d.counts.programs} programs  •  ${d.counts.tasks||0} tasks  •  ${d.counts.tags} ctrl tags`;
      const welcome = qs("#welcome"); if (welcome) welcome.remove();
      _setOrganizerVisible(true);
      renderTree(); renderContent(_active);
    } catch(e) { endProgress(); toast(e.message,"err"); return; }
  } else if (t.summary) {
    // Tab has cached summary - restore without re-fetching
    _edActiveId = id;
    _summary = t.summary; _active = t.active || {kind:"controller"};
    _exp.clear(); (t.exp||new Set()).forEach(v=>_exp.add(v));
    setModified(t.modified||false);
    qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = false;
    qs("#docName").textContent = t.label||"Editor";
    const s = t.summary;
    qs("#statusText").textContent = s.controller
      ? (s.controller.name + "  •  " + s.counts.programs + " programs  •  " + (s.counts.tasks||0) + " tasks  •  " + s.counts.tags + " ctrl tags")
      : "Ready";
    const welcome = qs("#welcome"); if (welcome) welcome.remove();
    _setOrganizerVisible(true);
    renderTree(); renderContent(_active);
  } else {
    // Empty editor tab
    _edActiveId = id;
    _summary = null; _active = null;
    _exp.clear(); setModified(false);
    qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = true;
    qs("#docName").textContent = "";
    qs("#statusText").textContent = "Ready";
    _setOrganizerVisible(true);
    qs("#orgTree").innerHTML = "";
    const content = qs("#content");
    content.innerHTML = "";
    const hint = mk("div","editorEmptyHint");
    hint.innerHTML = "<p>Use <strong>Open</strong> in the toolbar to load an .L5X file, or <strong>New</strong> to create a project.</p>";
    content.appendChild(hint);
  }  _tbRender();
  _updateToolbarForMode();
}

function _edCloseTab(id) {
  const t = _edTabs.find(tab=>tab.id===id);
  if (t && t.modified) {
    if (!confirm(`Close "${t.label||"Editor"}"? Unsaved changes will be lost.`)) return;
  }
  _edTabs = _edTabs.filter(tab=>tab.id!==id);
  if (_edTabs.length === 0) {
    // No more editor tabs — go back to welcome screen
    _edActiveId = null;
    _summary = null; _active = null;
    _exp.clear(); setModified(false);
    qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = true;
    qs("#docName").textContent = "";
    qs("#statusText").textContent = "Ready";
    const vf = qs("#valFooter"); if (vf) vf.classList.add("hidden");
    _setOrganizerVisible(false);
    qs("#orgTree").innerHTML = "";
    _renderWelcome(qs("#content"));
    _tbRender();
    _updateToolbarForMode();
    return;
  }
  if (_edActiveId === id) {
    _edSwitchTab(_edTabs[0].id);
  } else {
    _tbRender();
  }
}

function _tbClose(id) {
  const tab = _cmpTabs.find(t => t.id === id);
  if (tab && tab.data && !confirm("Close this comparison? Any unsaved migrated changes will be lost.")) return;
  _cmpTabs = _cmpTabs.filter(t => t.id !== id);
  if (_cmpActiveTabId === id) _tbSwitch("editor");
  else _tbRender();
}

function showCompare() { _tbNew(); }

// Init tab bar once DOM is ready — hide organizer until a file is loaded
document.addEventListener("DOMContentLoaded", () => {
  _tbRender();
  _setOrganizerVisible(false);
  // Render welcome screen initially (HTML shell just has a comment placeholder)
  _renderWelcome(qs("#content"));
  // Logo click → home screen
  const logoEl = qs(".logo");
  if (logoEl) { logoEl.onclick = goHome; logoEl.style.cursor = "pointer"; logoEl.title = "Home"; }
});

/* ── Compare Panel (per-tab) ─────────────────────────────────────────────── */
function _cmpShowPanel(container, tab) {
  container.innerHTML = "";
  const wrap = mk("div","cmpWrap"); container.appendChild(wrap);

  /* top bar */
  const bar = mk("div","cmpTopBar"); wrap.appendChild(bar);

  // ── Browse buttons — native OS file picker for each side ─────────────────────
  const pathRow = mk("div","cmpPathRow"); bar.appendChild(pathRow);
  // runBtn is hoisted as var so _mkPickSlot can reference it before pathRow.appendChild
  var runBtn;
  function _mkPickSlot(which) {
    const isA = which === "A";
    const ps = mk("div","cmpPickSlot"); ps.classList.add(isA?"cmpPickSlotA":"cmpPickSlotB");
    if (isA ? tab.pathA : tab.pathB) ps.classList.add("ready");
    const btn = mk("div","cmpPickBtn");
    const ico = mk("div","cmpPickIcon "+(isA?"cmpIconA":"cmpIconB"), which);
    const meta = mk("div","cmpPickMeta");
    const lbl = mk("div","cmpPickLbl", isA ? "File A — baseline" : "File B — revised");
    const name = mk("div","cmpPickName");
    const stored = isA ? tab.pathA : tab.pathB;
    name.textContent = stored ? stored.split(/[\\/]/).pop() : "Click to browse…";
    meta.appendChild(lbl); meta.appendChild(name);
    btn.appendChild(ico); btn.appendChild(meta);
    ps.appendChild(btn);
    ps.title = isA ? "Click to select File A" : "Click to select File B";
    ps.onclick = async () => {
      const path = await pickFile(isA ? "Select File A — baseline" : "Select File B — revised");
      if (!path) return;
      if (isA) tab.pathA = path; else tab.pathB = path;
      name.textContent = path.split(/[\\/]/).pop();
      ps.classList.add("ready");
      if (runBtn) runBtn.disabled = !(tab.pathA && tab.pathB);
    };
    return ps;
  }
  pathRow.appendChild(_mkPickSlot("A"));
  pathRow.appendChild(mk("div","cmpTopArrow","⇄"));
  pathRow.appendChild(_mkPickSlot("B"));
  runBtn = mkB("Compare ⇄","primary cmpRunBtn", runComparison);
  runBtn.disabled = !(tab.pathA && tab.pathB);
  pathRow.appendChild(runBtn);

  // Options row
  const optRow = mk("div","cmpOptRow"); bar.appendChild(optRow);
  optRow.appendChild(mk("span","cmpOptLabel","Options:"));
  function mkOpt(field, label) {
    const ow = mk("label","cmpOptItem");
    const cb = mk("input"); cb.type="checkbox"; cb.checked=!!tab[field];
    cb.onchange = () => { tab[field]=cb.checked; };
    ow.appendChild(cb); ow.appendChild(document.createTextNode(" "+label));
    return ow;
  }
  optRow.appendChild(mkOpt("includeComments","Comments"));
  optRow.appendChild(mkOpt("includeValues","Tag Values"));


  // View mode toggle
  const viewGroup = mk("div","cmpViewToggle"); bar.appendChild(viewGroup);
  ["visual","raw"].forEach(mode => {
    const b = mkB(mode==="visual"?"Visual":"Raw Text","cmpViewBtn"+(tab.viewMode===mode?" active":""),
      () => {
        tab.viewMode=mode;
        viewGroup.querySelectorAll(".cmpViewBtn").forEach(x=>x.classList.remove("active"));
        b.classList.add("active");
        if (tab.data) {
          // Fast path: only re-render rung card bodies — no layout rebuild
          const cards = wrap.querySelectorAll(".cmpRoRung");
          if (cards.length) {
            cards.forEach(card => {
              const bd = card.querySelector(".rungCardBody");
              if (!bd) return;
              bd.innerHTML = "";
              createRungBuilder(bd, card.dataset.rungText||"", ()=>[], {mode, hideTabs:true});
            });
          } else {
            _reRenderBody();
          }
        }
      });
    viewGroup.appendChild(b);
  });

  // Save/Open are handled by the toolbar — no duplicate buttons here

  const body = mk("div","cmpBody"); wrap.appendChild(body);
  function _reRenderBody() { body.innerHTML=""; if(tab.data) _renderCmpSplit(body,tab); else _cmpShowHint(body); }

  if (tab.data) _renderCmpSplit(body, tab);
  else          _cmpShowHint(body);

  async function runComparison() {
    const pa = (tab.pathA||"").trim(), pb = (tab.pathB||"").trim();
    if (!pa || !pb) { toast("Enter both file paths above","err"); return; }
    startProgress("Comparing files…");
    runBtn.disabled = true;
    try {
      const fd = new FormData();
      fd.append("pathA", pa); fd.append("pathB", pb);
      fd.append("include_comments", tab.includeComments ? "true" : "false");
      fd.append("include_values",   tab.includeValues   ? "true" : "false");
      const r = await fetch(API+"/api/compare_paths",{method:"POST",body:fd});
      const d = await r.json().catch(()=>({}));
      if (!r.ok) throw new Error(d.detail||r.statusText);
      tab.data = d;
      tab.pathA = pa; tab.pathB = pb;
      tab.label = pa.split(/[\\/]/).pop().replace(/\.l5x$/i,"") + " ⇄ " + pb.split(/[\\/]/).pop().replace(/\.l5x$/i,"");
      _tbRender();
      _saveRecentFile(tab.label, "compare", {a:pa, b:pb});
      body.innerHTML = "";
      _renderCmpSplit(body, tab);
      _updateToolbarForMode();
    } catch(e) { toast(e.message,"err"); }
    finally { endProgress(); runBtn.disabled = false; }
  }
}

function _cmpShowHint(container) {
  const h = mk("div","cmpHint"); container.appendChild(h);
  h.innerHTML = `<div class="cmpHintIcon">\u21c4</div>
    <p>Choose two .L5X files above and click <strong>Compare \u21c4</strong>.</p>
    <p class="cmpHintSub">Changes appear side-by-side. Use the diff tree to navigate both files at once.</p>`;
}

/* ── Split layout ────────────────────────────────────────────────────────── */
function _cmpExportDiff(tab) {
  const data = tab.data;
  if (!data) { toast("No comparison data to export","err"); return; }
  const s = data.summary||{};
  const nameA = tab.pathA ? tab.pathA.split(/[\\/]/).pop() : "File A";
  const nameB = tab.pathB ? tab.pathB.split(/[\\/]/).pop() : "File B";
  const lines = [
    "=== Diff: "+nameA+" vs "+nameB+" ===",
    "Total changes: "+s.total, ""
  ];
  const tags=data.tags||{}, dts=data.dataTypes||{}, aois=data.aois||{}, progs=data.programs||{};
  if ((tags.added||[]).length)   lines.push("Tags added:   "+(tags.added.map(t=>t.name).join(", ")));
  if ((tags.removed||[]).length) lines.push("Tags removed: "+(tags.removed.map(t=>t.name).join(", ")));
  if ((tags.changed||[]).length) lines.push("Tags changed: "+(tags.changed.map(t=>t.name).join(", ")));
  if ((dts.added||[]).length)    lines.push("Data types added:   "+(dts.added.map(d=>d.name).join(", ")));
  if ((dts.removed||[]).length)  lines.push("Data types removed: "+(dts.removed.map(d=>d.name).join(", ")));
  if ((dts.changed||[]).length)  lines.push("Data types changed: "+(dts.changed.map(d=>d.name).join(", ")));
  if ((aois.added||[]).length)   lines.push("AOIs added:   "+(aois.added.map(a=>a.name).join(", ")));
  if ((aois.removed||[]).length) lines.push("AOIs removed: "+(aois.removed.map(a=>a.name).join(", ")));
  if ((aois.changed||[]).length) lines.push("AOIs changed: "+(aois.changed.map(a=>a.name).join(", ")));
  if ((progs.added||[]).length)   lines.push("Programs added:   "+(progs.added.map(p=>p.name).join(", ")));
  if ((progs.removed||[]).length) lines.push("Programs removed: "+(progs.removed.map(p=>p.name).join(", ")));
  (progs.changed||[]).forEach(p => {
    const rtns = p.routines||{};
    const adds  = (rtns.added||[]).map(r=>r.name);
    const rems  = (rtns.removed||[]).map(r=>r.name);
    const chgs  = (rtns.changed||[]).map(r => r.name+":"+(r.rungDiff||[]).length+"R");
    lines.push("Program "+p.name+": "+(adds.length?"added=["+adds.join(",")+"] ":"")+(rems.length?"removed=["+rems.join(",")+"] ":"")+(chgs.length?"changed=["+chgs.join(",")+"]":"").trim());
  });
  navigator.clipboard.writeText(lines.join("\n"))
    .then(()=>toast("Diff summary copied","ok"))
    .catch(()=>toast("Clipboard unavailable","err"));
}

function _renderCmpSplit(container, tab) {
  container.innerHTML = "";
  const data = tab.data;
  const s = data.summary||{};

  if (!s.total) {
    const h = mk("div","cmpHint"); container.appendChild(h);
    h.innerHTML = `<div class="cmpHintIcon">\u2713</div><p style="font-size:16px">Files are identical.</p>`;
    return;
  }

  const layout = mk("div","cmpLayout"); container.appendChild(layout);

  /* diff tree (left) */
  const treePane = mk("div","cmpTreePane"); layout.appendChild(treePane);
  const th = mk("div","cmpTreeHeader"); treePane.appendChild(th);
  th.innerHTML = `Changes <span class="cmpTreeBadge">${s.total}</span>`;
  const _expBtn = mkB("📋 Copy Diff", "cmpExportBtn", () => _cmpExportDiff(tab));
  _expBtn.title = "Copy diff summary to clipboard";
  th.appendChild(_expBtn);
  // Search box — filters tree items by name
  const treeSearch = mk("input","cmpTreeSearch"); treePane.appendChild(treeSearch);
  treeSearch.type="text"; treeSearch.placeholder="Filter changes…"; treeSearch.spellcheck=false;
  const treeScroll = mk("div","cmpTreeScroll"); treePane.appendChild(treeScroll);

  /* resizer between tree and right panes */
  const rz = mk("div","cmpResizer"); layout.appendChild(rz);
  let _rzDragging = false;
  rz.addEventListener("mousedown", e => {
    _rzDragging = true; e.preventDefault();
    rz.classList.add("dragging");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  });
  const onRzMove = e => {
    if (!_rzDragging) return;
    const rect = layout.getBoundingClientRect();
    const w = Math.max(140, Math.min(480, e.clientX - rect.left));
    layout.style.gridTemplateColumns = w + "px 6px 1fr 1fr";
  };
  const onRzUp = () => {
    if (!_rzDragging) return;
    _rzDragging = false; rz.classList.remove("dragging");
    document.body.style.cursor = ""; document.body.style.userSelect = "";
  };
  document.addEventListener("mousemove", onRzMove);
  document.addEventListener("mouseup", onRzUp);
  // Clean up listeners if the layout is removed from DOM
  const rzObs = new MutationObserver(() => {
    if (!document.contains(layout)) {
      document.removeEventListener("mousemove", onRzMove);
      document.removeEventListener("mouseup", onRzUp);
      rzObs.disconnect();
    }
  });
  rzObs.observe(document.body, {childList:true, subtree:true});

  /* right: two panes */
  const rightGrid = mk("div","cmpRightGrid"); layout.appendChild(rightGrid);

  const paneAWrap = mk("div","cmpSidePane cmpSidePaneA"); rightGrid.appendChild(paneAWrap);
  const paneAHdr  = mk("div","cmpSidePaneHdr"); paneAWrap.appendChild(paneAHdr);
  paneAHdr.innerHTML = `<span class="cmpFilePill cmpFilePillA">A</span><span class="cmpFileName">${tab.pathA ? tab.pathA.split(/[\\/]/).pop() : tab.fileA?.name||"File A"}</span>`;
  const paneA = mk("div","cmpSidePaneBody"); paneAWrap.appendChild(paneA);

  const paneBWrap = mk("div","cmpSidePane cmpSidePaneB"); rightGrid.appendChild(paneBWrap);
  const paneBHdr  = mk("div","cmpSidePaneHdr"); paneBWrap.appendChild(paneBHdr);
  paneBHdr.innerHTML = `<span class="cmpFilePill cmpFilePillB">B</span><span class="cmpFileName">${tab.pathB ? tab.pathB.split(/[\\/]/).pop() : tab.fileB?.name||"File B"}</span>`;
  const paneB = mk("div","cmpSidePaneBody"); paneBWrap.appendChild(paneB);

  paneA.innerHTML = `<p class="cmpPaneHint">\u2190 Select a change from the tree.</p>`;
  paneB.innerHTML = `<p class="cmpPaneHint">\u2190 Select a change from the tree.</p>`;

  treeSearch.oninput = () => {
    const q = treeSearch.value.trim().toLowerCase();
    if (q) {
      // Expand all folders so all leaf rows are in DOM, then filter
      const allFolderIds = ["ctrl","aois","progs","modules","tasks"];
      (data.programs?.changed||[]).forEach(p => allFolderIds.push("prog_"+p.name));
      allFolderIds.forEach(id => cmpExp.add(id));
      const saved = treeScroll.scrollTop;
      treeScroll.innerHTML = ""; buildAll(); treeScroll.scrollTop = saved;
      // Hide leaf rows that don't match
      treeScroll.querySelectorAll(".cmpDiffRow").forEach(el => {
        el.style.display = el.textContent.toLowerCase().includes(q) ? "" : "none";
      });
      // Show/hide folder headers based on whether they have visible children
      treeScroll.querySelectorAll(".treeNode").forEach(node => {
        const children = node.querySelector(".treeChildren");
        if (!children) return;
        const anyVisible = Array.from(children.querySelectorAll(".cmpDiffRow,.treeRow"))
          .some(r => r.style.display !== "none");
        const hdr = node.querySelector(":scope > .treeRow");
        if (hdr) hdr.style.display = anyVisible ? "" : "none";
        node.style.display = anyVisible ? "" : "none";
      });
    } else {
      // Restore normal tree with preserved expand state
      const saved = treeScroll.scrollTop;
      treeScroll.innerHTML = ""; buildAll(); treeScroll.scrollTop = saved;
    }
  };

  _buildCmpDiffTree(treeScroll, data, tab, item => {
    paneA.innerHTML = ""; paneB.innerHTML = "";
    _renderCmpItem(paneA, paneB, item, tab);
  });

  requestAnimationFrame(() => {
    const first = treeScroll.querySelector(".cmpTreeItem");
    if (first) first.click();
  });
}

/* ── Diff tree (organizer-style) ─────────────────────────────────────────── */
function _buildCmpDiffTree(container, data, tab, onSelect) {
  let activeEl = null;
  const cmpExp = new Set(); // local expand state for this tree

  function sel(el, item) {
    if (activeEl) activeEl.classList.remove("active");
    activeEl = el; el.classList.add("active");
    onSelect(item);
  }

  function cmpRow(indent, status, icon, label, meta, item, migrateInfo) {
    const r = mk("div","treeRow cmpDiffRow");
    r.style.paddingLeft = (8 + indent*14) + "px";
    r.appendChild(mk("span","treeToggle",""));
    r.appendChild(mk("span","treeIcon", icon));
    const labelEl = mk("span","rowLabel",label); r.appendChild(labelEl);
    if (meta) r.appendChild(mk("span","rowMeta",meta));
    // status pill
    const pill = mk("span","cmpTreePill cmpTreePill-"+status,
      status==="added"?"+":status==="removed"?"\u2212":"~");
    r.appendChild(pill);
    // migrate buttons (only if files available)
    if (migrateInfo && (tab.fileA && tab.fileB || tab.pathA && tab.pathB)) {
      const mWrap = mk("span","cmpMigrateBtns");
      if (status !== "added") { // can apply A→B (A's version exists)
        const ab = mk("button","cmpMigrateBtn cmpMigrateAB","\u2192B");
        ab.title = "Copy this item from A into B"; 
        ab.onclick = e => { e.stopPropagation(); _cmpMigrate(tab,"AtoB",migrateInfo,container,data,onSelect); };
        mWrap.appendChild(ab);
      }
      if (status !== "removed") { // can apply B→A (B's version exists)
        const ba = mk("button","cmpMigrateBtn cmpMigrateBA","\u2190A");
        ba.title = "Copy this item from B into A";
        ba.onclick = e => { e.stopPropagation(); _cmpMigrate(tab,"BtoA",migrateInfo,container,data,onSelect); };
        mWrap.appendChild(ba);
      }
      r.appendChild(mWrap);
    }
    if (item) r.onclick = () => sel(r, item);
    return r;
  }

  function cmpFolder(indent, status, icon, id, label, count, buildFn) {
    const wrap = mk("div","treeNode");
    const open = cmpExp.has(id);
    const r = mk("div","treeRow");
    r.style.paddingLeft = (8 + indent*14) + "px";
    r.appendChild(mk("span","treeToggle", open?"\u25be":"\u25b8"));
    r.appendChild(mk("span","treeIcon", icon));
    r.appendChild(mk("span","rowLabel", label));
    r.appendChild(mk("span","rowMeta", String(count)));
    if (status) {
      const p = mk("span","cmpTreePill cmpTreePill-"+status,
        status==="added"?"+":status==="removed"?"\u2212":"~");
      r.appendChild(p);
    }
    r.onclick = () => {
      cmpExp.has(id) ? cmpExp.delete(id) : cmpExp.add(id);
      // re-render tree
      const s = container.scrollTop;
      container.innerHTML = "";
      buildAll();
      container.scrollTop = s;
    };
    wrap.appendChild(r);
    if (open) {
      const ch = mk("div","treeChildren"); wrap.appendChild(ch);
      buildFn(ch);
    }
    return wrap;
  }

  function buildAll() {
    // Controller
    const ctrl = data.controller||[];
    if (ctrl.length) {
      const f = cmpFolder(0,"changed","🎛","ctrl","Controller Properties",ctrl.length, ch => {
        ctrl.forEach(c => ch.appendChild(cmpRow(1,"changed","⚙️",c.prop,
          `${c.from||"\u2014"}\u2192${c.to||"\u2014"}`,{type:"ctrl-prop",data:c},null)));
      });
      container.appendChild(f);
      if (!cmpExp.has("ctrl")) cmpExp.add("ctrl"); // open by default
    }

    // Tags — single row, click shows all tag changes in pane
    const tags = data.tags||{added:[],removed:[],changed:[]};
    const tagN = tags.added.length+tags.removed.length+tags.changed.length;
    if (tagN) {
      container.appendChild(cmpRow(0,"changed","🏷","Controller Tags",String(tagN)+" change"+(tagN>1?"s":""),
        {type:"all-tags"},null));
    }

    // Data Types — single row, click shows all dtype changes in pane
    const dts = data.dataTypes||{added:[],removed:[],changed:[]};
    const dtN = dts.added.length+dts.removed.length+dts.changed.length;
    if (dtN) {
      container.appendChild(cmpRow(0,"changed","📐","Data Types",String(dtN)+" change"+(dtN>1?"s":""),
        {type:"all-dtypes"},null));
    }

    // AOIs
    const aois = data.aois||{added:[],removed:[],changed:[]};
    const aoiN = aois.added.length+aois.removed.length+aois.changed.length;
    if (aoiN) {
      container.appendChild(cmpFolder(0,null,"⚙️","aois","Add-On Instructions",aoiN, ch => {
        aois.added.forEach(t => ch.appendChild(cmpRow(1,"added","⚙️",t.name,"",
          {type:"aoi",status:"added",data:t},{type:"aoi",name:t.name})));
        aois.removed.forEach(t => ch.appendChild(cmpRow(1,"removed","⚙️",t.name,"",
          {type:"aoi",status:"removed",data:t},{type:"aoi",name:t.name})));
        aois.changed.forEach(t => { const rev=t.revisionA!==t.revisionB?`v${t.revisionA}\u2192${t.revisionB}`:"";
          ch.appendChild(cmpRow(1,"changed","⚙️",t.name,rev,
            {type:"aoi",status:"changed",data:t},{type:"aoi",name:t.name}));
        });
      }));
    }

    // Programs
    const progs = data.programs||{added:[],removed:[],changed:[]};
    const progN = progs.added.length+progs.removed.length+progs.changed.length;
    if (progN) {
      container.appendChild(cmpFolder(0,null,"📦","progs","Programs",progN, ch => {
        progs.added.forEach(p => ch.appendChild(cmpRow(1,"added","📦",p.name,"",
          {type:"program",status:"added",data:p},null)));
        progs.removed.forEach(p => ch.appendChild(cmpRow(1,"removed","📦",p.name,"",
          {type:"program",status:"removed",data:p},null)));
        progs.changed.forEach(p => {
          const rtns = p.routines||{added:[],removed:[],changed:[]};
          const total = rtns.added.length+rtns.removed.length+rtns.changed.length;
          const pKey = "prog_"+p.name;
          const pFold = cmpFolder(1,"changed","📦",pKey,p.name,total+" rtn diff", ch2 => {
            rtns.added.forEach(r => ch2.appendChild(cmpRow(2,"added","📄",r.name,`${r.rungs} rungs`,
              {type:"routine",status:"added",program:p.name,data:r},
              {type:"routine",name:r.name,program:p.name})));
            rtns.removed.forEach(r => ch2.appendChild(cmpRow(2,"removed","📄",r.name,`was ${r.rungs} rungs`,
              {type:"routine",status:"removed",program:p.name,data:r},
              {type:"routine",name:r.name,program:p.name})));
            rtns.changed.forEach(r => { const rc=(r.rungDiff||[]).length;
              ch2.appendChild(cmpRow(2,"changed","📄",r.name,rc?`${rc} rung diff`:"logic",
                {type:"routine",status:"changed",program:p.name,data:r},
                {type:"routine",name:r.name,program:p.name}));
            });
            const td = p.tagDiff;
            if (td) { const tc=(td.added||[]).length+(td.removed||[]).length+(td.changed||[]).length;
              if (tc) ch2.appendChild(cmpRow(2,"changed","🏷","Tags",`${tc} change${tc>1?"s":""}`,
                {type:"prog-tags",program:p.name,data:td},null));
            }
          });
          ch.appendChild(pFold);
        });
      }));
    }

    // Modules — single row, click shows all module changes in pane
    const mods = data.modules||{added:[],removed:[],changed:[]};
    const modN = mods.added.length+mods.removed.length+mods.changed.length;
    if (modN) {
      container.appendChild(cmpRow(0,"changed","🔌","I/O Configuration",String(modN)+" change"+(modN>1?"s":""),
        {type:"all-modules"},null));
    }

    // Tasks — single row, click shows all task changes in pane
    const tasks = data.tasks||{added:[],removed:[],changed:[]};
    const taskN = tasks.added.length+tasks.removed.length+tasks.changed.length;
    if (taskN) {
      container.appendChild(cmpRow(0,"changed","⏱","Tasks",String(taskN)+" change"+(taskN>1?"s":""),
        {type:"all-tasks"},null));
    }

    // Trends — single row, click shows all trend changes in pane
    const trends = data.trends||{added:[],removed:[],changed:[]};
    const trendN = (trends.added||[]).length+(trends.removed||[]).length+(trends.changed||[]).length;
    if (trendN) {
      container.appendChild(cmpRow(0,"changed","📈","Trends",String(trendN)+" change"+(trendN>1?"s":""),
        {type:"all-trends"},null));
    }
  }

  buildAll();
}

/* ── Item content renderers ─────────────────────────────────────────────── */
/** Compare-mode Find dialog: searches names AND rung text - works like editor cross-ref. */
function _cmpShowFindDialog(tab, q) {
  const data = tab.data || {};
  const qLo = q.toLowerCase();
  const hits = [];

  // 1. Structural name matches (tags, dtypes, AOIs, programs, routines)
  const tags = data.tags || {};
  [...(tags.added||[]),...(tags.removed||[]),...(tags.changed||[])].forEach(t => {
    if ((t.name||"").toLowerCase().includes(qLo)) {
      const st = tags.added?.find(x=>x.name===t.name)?"added":tags.removed?.find(x=>x.name===t.name)?"removed":"changed";
      hits.push({label:"🏷 Tag: "+t.name, status:st, item:{type:"all-tags"}, highlight:t.name});
    }
  });

  const dts = data.dataTypes || {};
  [...(dts.added||[]),...(dts.removed||[]),...(dts.changed||[])].forEach(d => {
    if ((d.name||"").toLowerCase().includes(qLo))
      hits.push({label:"📐 Data Type: "+d.name, status:"changed", item:{type:"all-dtypes"}, highlight:d.name});
  });

  const aois = data.aois || {};
  [...(aois.added||[]),...(aois.removed||[]),...(aois.changed||[])].forEach(a => {
    const st = aois.added?.find(x=>x.name===a.name)?"added":aois.removed?.find(x=>x.name===a.name)?"removed":"changed";
    if ((a.name||"").toLowerCase().includes(qLo))
      hits.push({label:"⚙️ AOI: "+a.name, status:st, item:{type:"aoi",status:st,data:a}});
  });

  const progs = data.programs || {};
  [...(progs.added||[]),...(progs.removed||[]),...(progs.changed||[])].forEach(p => {
    const st = progs.added?.find(x=>x.name===p.name)?"added":progs.removed?.find(x=>x.name===p.name)?"removed":"changed";
    if ((p.name||"").toLowerCase().includes(qLo))
      hits.push({label:"📦 Program: "+p.name, status:st, item:{type:"program",status:st,data:p}});
    if (st==="changed") {
      const rtns = p.routines||{};
      [...(rtns.added||[]),...(rtns.removed||[]),...(rtns.changed||[])].forEach(r => {
        const rst = rtns.added?.find(x=>x.name===r.name)?"added":rtns.removed?.find(x=>x.name===r.name)?"removed":"changed";
        if ((r.name||"").toLowerCase().includes(qLo))
          hits.push({label:"📄 Routine: "+p.name+" / "+r.name, status:rst,
            item:{type:"routine",status:rst,program:p.name,data:r}});
      });
    }
  });

  // 2. Rung text/comment search - searches actual ladder content in the diff
  const rungHits = [];
  [...(progs.changed||[])].forEach(p => {
    const rtns = p.routines||{};
    [...(rtns.changed||[])].forEach(r => {
      const seen = new Set();
      (r.rungDiff||[]).forEach(rd => {
        if ((rd.text||"").toLowerCase().includes(qLo) || (rd.comment||"").toLowerCase().includes(qLo)) {
          const key = p.name+"."+r.name+"."+rd.num;
          if (!seen.has(key)) { seen.add(key);
            rungHits.push({
              label: "🧱 "+p.name+" / "+r.name+" · Rung "+(rd.num+1)+(rd.comment?"  // "+rd.comment.slice(0,50):""),
              sub:   (rd.text||"").slice(0,90),
              status: rd.status==="added"?"added":rd.status==="removed"?"removed":"changed",
              item:  {type:"routine", status:"changed", program:p.name, data:r},
              rung:  rd.num,
            });
          }
        }
      });
      [...(r.rungsA||[]).map(rg=>Object.assign({},rg,{_side:"A"})),
       ...(r.rungsB||[]).map(rg=>Object.assign({},rg,{_side:"B"}))].forEach(rg => {
        if ((rg.text||"").toLowerCase().includes(qLo) || (rg.comment||"").toLowerCase().includes(qLo)) {
          const key = p.name+"."+r.name+"."+rg.num+rg._side;
          if (!seen.has(key)) { seen.add(key);
            rungHits.push({
              label: "🧱 "+p.name+" / "+r.name+" · Rung "+(rg.num+1)+" (file "+rg._side+")"+(rg.comment?"  // "+rg.comment.slice(0,50):""),
              sub:   (rg.text||"").slice(0,90),
              status: "changed",
              item:  {type:"routine", status:"changed", program:p.name, data:r},
              rung:  rg.num,
              _side: rg._side,
            });
          }
        }
      });
    });
  });
  hits.push(...rungHits.slice(0,200));

  if (!hits.length) { toast("No matches for \""+q+"\" in compare diff","err"); return; }

  // Show dialog
  const old = qs("#dlgCmpFind"); if (old) old.remove();
  const dlg = document.createElement("dialog"); dlg.id="dlgCmpFind"; dlg.className="findDialog";
  dlg.innerHTML = `<h3>Find in Diff: "${q}"</h3>`;
  const body = mk("div","findBody"); dlg.appendChild(body);
  body.appendChild(mk("div","dlgRowsHead", `${hits.length} match${hits.length===1?"":"es"}`));
  hits.forEach(h => {
    const row = mk("div","findHit"); body.appendChild(row);
    const pill = mk("span","cmpTreePill cmpTreePill-"+(h.status||"changed"),
      h.status==="added"?"+":h.status==="removed"?"\u2212":"~");
    row.appendChild(pill);
    row.appendChild(document.createTextNode(" " + h.label));
    if (h.sub) {
      const sub = document.createElement("div"); sub.className="findHitText";
      sub.style.cssText="font-size:11px;color:var(--text3,#888);font-family:monospace;padding-left:22px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;";
      sub.textContent = h.sub; row.appendChild(sub);
    }
    row.style.cursor = "pointer";
    row.onclick = () => {
      dlg.close(); dlg.remove();
      // Navigate to the item in the compare pane
      const overlay = qs("#cmpOverlay");
      const paneA = overlay?.querySelector(".cmpSidePaneA .cmpSidePaneBody");
      const paneB = overlay?.querySelector(".cmpSidePaneB .cmpSidePaneBody");
      if (paneA && paneB) {
        paneA.innerHTML = ""; paneB.innerHTML = "";
        _renderCmpItem(paneA, paneB, h.item, tab);
        // Scroll to specific rung in the correct panel (A or B)
        if (h.rung != null) {
          const targetPane = h._side === "B" ? paneB : paneA;
          requestAnimationFrame(() => {
            const cards = targetPane.querySelectorAll(".rungCard");
            for (const card of cards) {
              const badge = card.querySelector(".rungNumBadge");
              if (badge && parseInt(badge.textContent, 10) === h.rung) {
                card.classList.add("cmpFindHighlight");
                card.scrollIntoView({block:"center", behavior:"smooth"});
                setTimeout(() => card.classList.remove("cmpFindHighlight"), 2500);
                break;
              }
            }
          });
        }
        // If there's a highlight target, request it
        if (h.highlight && h.item.type==="all-tags") {
          const tbl = paneA.querySelector(".cmpTagTbl") || paneB.querySelector(".cmpTagTbl");
          if (tbl) {
            tbl.querySelectorAll("tr").forEach(tr => {
              const nm = tr.querySelector(".bdName")?.textContent;
              if (nm === h.highlight) {
                tr.classList.add("cmpRowHighlight");
                setTimeout(()=>tr.scrollIntoView({block:"nearest",behavior:"smooth"}),80);
              }
            });
          }
        }
        // Also highlight matching tree row
        const treeScroll = overlay?.querySelector(".cmpTreeScroll");
        if (treeScroll) {
          treeScroll.querySelectorAll(".cmpDiffRow,.treeRow").forEach(el => {
            const lbl = el.querySelector(".rowLabel")?.textContent||"";
            if (lbl.toLowerCase().includes(qLo)) {
              el.classList.add("active");
              setTimeout(()=>el.scrollIntoView({block:"nearest",behavior:"smooth"}),50);
            }
          });
        }
      } else {
        toast("Navigate to the compare tab first","err");
      }
    };
  });
  const btnRow = mk("div","dlgBtns"); dlg.appendChild(btnRow);
  btnRow.appendChild(mkB("Close","",(()=>{ dlg.close(); dlg.remove(); })));
  document.body.appendChild(dlg); dlg.showModal();
}

function _renderCmpItem(paneA, paneB, item, tab) {
  // Routines use two-pane side-by-side; everything else uses single full-width pane
  // AOI manages its own layout (tabbed with inline two-col for logic)
  const rightGrid = paneA.closest(".cmpRightGrid");
  const useSingle = item.type !== "routine";
  if (rightGrid) rightGrid.classList.toggle("cmpSinglePane", useSingle);

  switch(item.type) {
    case "ctrl-prop":   _cmpCtrlProp(paneA,paneB,item.data); break;
    case "tag":         _cmpTagSplit(paneA,paneB,item.status,item.data,tab); break;
    case "all-tags":    _cmpTagSplit(paneA,paneB,"all",null,tab); break;
    case "dtype":       _cmpDtypeSplit(paneA,paneB,item.status,item.data,tab); break;
    case "all-dtypes":  _cmpAllDtypesView(paneA,tab); break;
    case "aoi":         _cmpAoiSplit(paneA,paneB,item.status,item.data,tab); break;
    case "routine":     _cmpRoutineSplit(paneA,paneB,item.status,item.program,item.data,tab); break;
    case "program":     _cmpProgramSplit(paneA,paneB,item.status,item.data); break;
    case "prog-tags":   _cmpProgTagsSplit(paneA,paneB,item.data); break;
    case "all-modules": _cmpAllModulesView(paneA,tab); break;
    case "all-tasks":   _cmpAllTasksView(paneA,tab); break;
    case "all-trends":  _cmpAllTrendsView(paneA,tab); break;
    default:            _cmpGenericSplit(paneA,paneB,item.status,item.data); break;
  }
}

/* shared helpers */
function _cmpKV(pane, label, val, cls) {
  const row = mk("div","cmpKVRow"+(cls?" "+cls:""));
  row.innerHTML = `<span class="cmpKVKey">${label}</span><span class="cmpKVVal">${val??"\u2014"}</span>`;
  pane.appendChild(row);
}
function _cmpAbsent(pane, msg) { pane.appendChild(mk("div","cmpAbsent",msg)); }
function _cmpSectionHdr(pane, txt) { pane.appendChild(mk("div","cmpSecHdr",txt)); }
function _cmpMemberTable(pane, members, hlFn) {
  if (!members.length) return;
  const tbl = mk("table","cmpDetailTbl"); pane.appendChild(tbl);
  tbl.innerHTML = "<tr><th>Name</th><th>Type / Usage</th></tr>";
  members.forEach(m => {
    const r = mk("tr", hlFn?hlFn(m.name):"");
    r.innerHTML = `<td>${m.name}</td><td>${m.type||m.dataType||m.usage||""}</td>`;
    tbl.appendChild(r);
  });
}

/* ctrl property — inline diff in single pane */
function _cmpCtrlProp(paneA, paneB, d) {
  if (d.from !== d.to) {
    const row = mk("div","cmpKVRow");
    row.innerHTML = `<span class="cmpKVKey">${d.prop}</span><span class="cmpKVVal"><span class="cmpCellRemoved">${d.from||"—"}</span> → <span class="cmpCellAdded">${d.to||"—"}</span></span>`;
    paneA.appendChild(row);
  } else {
    _cmpKV(paneA, d.prop, d.from);
  }
}

/* ── Tag table helper: renders a dataTable-style tag comparison ────────────── */
function _cmpTagTableHdr(tbl) {
  tbl.innerHTML = "<tr><th>Name</th><th>Data Type</th><th>Value</th><th>Description</th></tr>";
}
function _cmpTagTableRow(tbl, name, dataType, value, desc, rowCls, cellFlags) {
  // cellFlags: {dataType:"rem"|"add", value:"rem"|"add", desc:"rem"|"add"}
  const tr = mk("tr", rowCls||""); tbl.appendChild(tr);
  const clsMap = {rem:"cmpCellRemoved", add:"cmpCellAdded"};
  const nameTd = mk("td","",name||""); tr.appendChild(nameTd);
  const typeTd = mk("td","",dataType||""); if(cellFlags?.dataType) typeTd.className=clsMap[cellFlags.dataType]||""; tr.appendChild(typeTd);
  const valTd  = mk("td","",value||"");   if(cellFlags?.value)    valTd.className=clsMap[cellFlags.value]||"";    tr.appendChild(valTd);
  const descTd = mk("td","",desc||"");    if(cellFlags?.desc)     descTd.className=clsMap[cellFlags.desc]||"";    tr.appendChild(descTd);
  return tr;
}

/** Expand/collapse bit-level diff rows under a DINT/INT/SINT tag row in compare. */
function _cmpToggleBitExpand(btn, parentRow, tagName, dataType, valFrom, valTo, isDiff) {
  if (parentRow._cmpBitRows && parentRow._cmpBitRows.length) {
    parentRow._cmpBitRows.forEach(r => r.remove());
    parentRow._cmpBitRows = [];
    btn.textContent = "▶";
    return;
  }
  btn.textContent = "▼";
  const width = BIT_WIDTH[dataType] || 32;
  // Handle both diff mode (from vs to) and single-value mode (add/remove)
  const numFrom = valFrom != null ? (Number(valFrom) || 0) : null;
  const numTo   = valTo   != null ? (Number(valTo)   || 0) : null;
  const rows = []; let cursor = parentRow;
  for (let i = 0; i < width; i++) {
    const bFrom = numFrom != null ? (numFrom >>> i) & 1 : null;
    const bTo   = numTo   != null ? (numTo   >>> i) & 1 : null;
    if (isDiff && bFrom === bTo) continue;      // diff mode: skip unchanged bits
    if (!isDiff && bFrom === 0 && bTo === 0) continue; // single-value mode: skip zero bits
    if (!isDiff && bFrom === null && bTo === 0) continue;
    if (!isDiff && bFrom === 0 && bTo === null) continue;
    const isChgBit = isDiff && bFrom !== bTo;
    const rowCls = isChgBit ? "breakdownRow cmpRowChanged" : "breakdownRow";
    const tr = mk("tr", rowCls); cursor.after(tr); cursor = tr; rows.push(tr);
    const pill = mk("td"); tr.appendChild(pill);
    if (isChgBit) pill.appendChild(mk("span","cmpTreePill cmpTreePill-changed","~"));
    const ntd = mk("td"); ntd.style.paddingLeft = "32px";
    ntd.innerHTML = `<span class="bdName">${tagName}.${i}</span>`; tr.appendChild(ntd);
    tr.appendChild(mk("td","")); // Tag Type
    tr.appendChild(mk("td","type","BOOL"));
    const vtd = mk("td"); tr.appendChild(vtd);
    if (isDiff) {
      vtd.innerHTML = `<span class="cmpCellRemoved">${bFrom}</span> → <span class="cmpCellAdded">${bTo}</span>`;
    } else {
      const v = bFrom != null ? bFrom : bTo;
      vtd.innerHTML = `<span class="${v?"cmpCellAdded":""}"> ${v}</span>`;
    }
    tr.appendChild(mk("td","")); // Description
  }
  if (!rows.length) {
    const tr = mk("tr","breakdownRow"); cursor.after(tr); rows.push(tr);
    const ntd = mk("td",""); ntd.colSpan=6; ntd.style.paddingLeft="32px";
    ntd.style.color="var(--muted)"; ntd.style.fontStyle="italic";
    ntd.textContent = isDiff ? "No individual bit changes (values may differ by sign/overflow)" : "All bits are 0";
    tr.appendChild(ntd);
  }
  parentRow._cmpBitRows = rows;
}

/** Unified single-pane tag diff table.
 *  One row per changed tag: status pill | Name | Data Type | Value | Description
 *  Changed cells show "old → new" inline. */
function _cmpUnifiedTagsDiff(pane, tags, highlightName) {
  const rem = tags.removed||[], add = tags.added||[], chg = tags.changed||[];
  if (!rem.length && !add.length && !chg.length) {
    _cmpAbsent(pane, "No tag differences"); return;
  }
  const tbl = mk("table","dataTable cmpTagTbl"); pane.appendChild(tbl);
  tbl.innerHTML = "<tr><th></th><th>Name</th><th>Tag Type</th><th>Data Type</th><th>Value</th><th>Description</th></tr>";

  const rows = [
    ...rem.map(t=>({...t, _status:"removed"})),
    ...chg.map(t=>({...t, _status:"changed"})),
    ...add.map(t=>({...t, _status:"added"})),
  ].sort((a,b)=>a.name.localeCompare(b.name));

  rows.forEach(t => {
    const ch = t.changes||{};
    const descCh = ch.desc||ch.description;
    const isAdd=t._status==="added", isRem=t._status==="removed", isChg=t._status==="changed";
    const tr = mk("tr", isAdd?"cmpRowAdded":isRem?"cmpRowRemoved":""); tbl.appendChild(tr);

    const pill = mk("td"); tr.appendChild(pill);
    pill.appendChild(mk("span","cmpTreePill cmpTreePill-"+(isAdd?"added":isRem?"removed":"changed"),
      isAdd?"+":isRem?"−":"~"));

    // Name cell — expand button for integer tags (bits visible on add/remove, diff on change)
    const _cmpDt = t.dataType || (isChg && ch.dataType ? ch.dataType.to : "");
    const _bValFrom = isChg ? ch.value?.from : (isRem ? t.value : undefined);
    const _bValTo   = isChg ? ch.value?.to   : (isAdd ? t.value : undefined);
    const _canBitExpand = !!BIT_WIDTH[_cmpDt] && (_bValFrom != null || _bValTo != null);
    const _nameTd = mk("td");
    if (_canBitExpand) {
      const _expBtn = mk("button","expArrow","▶");
      _expBtn.title = isChg ? "Expand to see which bits changed" : "Expand to see bit values";
      _expBtn.onclick = () => _cmpToggleBitExpand(_expBtn, tr, t.name, _cmpDt, _bValFrom, _bValTo, isChg);
      _nameTd.appendChild(_expBtn);
    }
    _nameTd.appendChild(mk("span","bdName",t.name||""));
    tr.appendChild(_nameTd);

    // Tag Type
    const ttChg = isChg && ch.tagType;
    if (ttChg) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${ch.tagType.from||"Base"}</span> → <span class="cmpCellAdded">${ch.tagType.to||"Base"}</span>`;
    } else {
      const tt = t.tagType||"Base";
      const badge = tt==="Alias"?`<span class="tagTypeBadge tagTypeBadgeAlias">Alias</span>`
        : tt==="ProducedTag"?`<span class="tagTypeBadge tagTypeBadgeProd">Produced</span>`
        : tt==="ConsumedTag"?`<span class="tagTypeBadge tagTypeBadgeCons">Consumed</span>`
        : `<span class="tagTypeBadge tagTypeBadgeBase">Base</span>`;
      const td=mk("td"); td.innerHTML=badge; tr.appendChild(td);
    }

    // Data type: inline diff if changed
    if (isChg && ch.dataType) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${ch.dataType.from||""}</span> → <span class="cmpCellAdded">${ch.dataType.to||""}</span>`;
    } else { tr.appendChild(mk("td","",t.dataType||"")); }

    // Value
    if (isChg && ch.value) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${ch.value.from||""}</span> → <span class="cmpCellAdded">${ch.value.to||""}</span>`;
    } else { tr.appendChild(mk("td","",t.value||"")); }

    // Description
    if (isChg && descCh) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${descCh.from||""}</span> → <span class="cmpCellAdded">${descCh.to||""}</span>`;
    } else { tr.appendChild(mk("td","",t.desc||t.description||"")); }

    if (highlightName && t.name===highlightName) {
      tr.classList.add("cmpRowHighlight");
      setTimeout(()=>tr.scrollIntoView({block:"nearest",behavior:"smooth"}),80);
    }
  });
}

/* tag — unified single-pane table, scrolling to selected tag */
function _cmpTagSplit(paneA, paneB, st, d, tab) {
  const tags = tab?.data?.tags || {added:[], removed:[], changed:[]};
  _cmpUnifiedTagsDiff(paneA, tags, d?.name);
}

/* data type — unified member diff table (single pane) */
function _cmpUnifiedDtypeTable(pane, membersA, membersB, diff) {
  const added   = new Set((diff?.added||[]).map(m=>m.name));
  const removed = new Set((diff?.removed||[]).map(m=>m.name));
  const changed = new Set((diff?.changed||[]).map(m=>m.name));
  const aMap = Object.fromEntries((membersA||[]).map(m=>[m.name,m]));
  const bMap = Object.fromEntries((membersB||[]).map(m=>[m.name,m]));
  const allNames = [...new Set([...(membersA||[]).map(m=>m.name), ...(membersB||[]).map(m=>m.name)])];
  if (!allNames.length) { _cmpAbsent(pane,"No members"); return; }
  const tbl = mk("table","dataTable cmpTagTbl"); pane.appendChild(tbl);
  tbl.innerHTML = "<tr><th></th><th>Name</th><th>Type</th><th>Description</th></tr>";
  allNames.forEach(n => {
    const isAdd=added.has(n), isRem=removed.has(n), isChg=changed.has(n);
    const ma=aMap[n], mb=bMap[n], m=mb||ma;
    const tr = mk("tr", isAdd?"cmpRowAdded":isRem?"cmpRowRemoved":""); tbl.appendChild(tr);
    const pillTd = mk("td"); tr.appendChild(pillTd);
    if (isAdd||isRem||isChg) pillTd.appendChild(mk("span","cmpTreePill cmpTreePill-"+(isAdd?"added":isRem?"removed":"changed"),isAdd?"+":isRem?"−":"~"));
    tr.appendChild(mk("td","",n));
    if (isChg && ma && mb && (ma.type||ma.dataType) !== (mb.type||mb.dataType)) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${ma.type||ma.dataType||""}</span> → <span class="cmpCellAdded">${mb.type||mb.dataType||""}</span>`;
    } else { tr.appendChild(mk("td","",m?.type||m?.dataType||"")); }
    tr.appendChild(mk("td","",m?.description||""));
  });
}
function _cmpDtypeSplit(paneA, paneB, st, d, tab) {
  const label = st==="added" ? "Added to File B" : st==="removed" ? "Removed from File B" : null;
  if (label) _cmpSectionHdr(paneA, label);
  if (st==="added") {
    _cmpUnifiedDtypeTable(paneA, [], d.members||[], {added:(d.members||[]).map(m=>({name:m.name}))});
  } else if (st==="removed") {
    _cmpUnifiedDtypeTable(paneA, d.members||[], [], {removed:(d.members||[]).map(m=>({name:m.name}))});
  } else {
    _cmpUnifiedDtypeTable(paneA, d.membersA||[], d.membersB||[], d.memberDiff);
  }
}

/* AOI — tabbed view: Parameters | Local Tags | Logic */

/** Unified parameter diff table for AOI: status | Name | Type | Usage */
function _cmpUnifiedParamTable(pane, paramsA, paramsB, diff) {
  const added   = new Set((diff?.added||[]).map(m=>m.name));
  const removed = new Set((diff?.removed||[]).map(m=>m.name));
  const changed = new Set((diff?.changed||[]).map(m=>m.name));
  const aMap = Object.fromEntries((paramsA||[]).map(p=>[p.name,p]));
  const bMap = Object.fromEntries((paramsB||[]).map(p=>[p.name,p]));
  const allNames = [...new Set([...(paramsA||[]).map(p=>p.name), ...(paramsB||[]).map(p=>p.name)])];
  if (!allNames.length) { _cmpAbsent(pane,"No parameters"); return; }
  const tbl = mk("table","dataTable cmpTagTbl"); pane.appendChild(tbl);
  tbl.innerHTML = "<tr><th></th><th>Name</th><th>Type</th><th>Usage</th></tr>";
  allNames.forEach(n => {
    const isAdd=added.has(n), isRem=removed.has(n), isChg=changed.has(n);
    const pa=aMap[n], pb=bMap[n], p=pb||pa;
    const tr = mk("tr", isAdd?"cmpRowAdded":isRem?"cmpRowRemoved":""); tbl.appendChild(tr);
    const pillTd=mk("td"); tr.appendChild(pillTd);
    if (isAdd||isRem||isChg) pillTd.appendChild(mk("span","cmpTreePill cmpTreePill-"+(isAdd?"added":isRem?"removed":"changed"),isAdd?"+":isRem?"−":"~"));
    tr.appendChild(mk("td","",n));
    if (isChg && pa && pb && pa.type!==pb.type) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${pa.type||""}</span> → <span class="cmpCellAdded">${pb.type||""}</span>`;
    } else { tr.appendChild(mk("td","",p?.type||"")); }
    if (isChg && pa && pb && pa.usage!==pb.usage) {
      const td=mk("td"); tr.appendChild(td);
      td.innerHTML=`<span class="cmpCellRemoved">${pa.usage||""}</span> → <span class="cmpCellAdded">${pb.usage||""}</span>`;
    } else { tr.appendChild(mk("td","",p?.usage||"")); }
  });
}

function _cmpAoiSplit(paneA, paneB, st, d, tab) {
  // AOI always uses single-pane (manages its own two-col logic grid inline)
  const rightGrid = paneA.closest(".cmpRightGrid");
  if (rightGrid) rightGrid.classList.add("cmpSinglePane");

  const isAdded = st==="added", isRemoved = st==="removed";

  // Status banner for added/removed
  if (isAdded || isRemoved) {
    const banner = mk("div","cmpKVRow");
    banner.innerHTML = `<span class="cmpKVKey">Status</span><span class="cmpKVVal ${isAdded?"cmpValAdded":"cmpValRemoved"}">${isAdded?"New in File B":"Only in File A (removed)"}</span>`;
    paneA.appendChild(banner);
  } else {
    // Revision change banner for changed AOIs
    if (d.revisionA !== d.revisionB && (d.revisionA||d.revisionB)) {
      const rev = mk("div","cmpKVRow");
      rev.innerHTML=`<span class="cmpKVKey">Revision</span><span class="cmpKVVal"><span class="cmpCellRemoved">${d.revisionA||"—"}</span> → <span class="cmpCellAdded">${d.revisionB||"—"}</span></span>`;
      paneA.appendChild(rev);
    }
  }

  const tabBar = mk("div","aoiTabBar"); paneA.appendChild(tabBar);
  const tabContent = mk("div","aoiTabContent"); paneA.appendChild(tabContent);

  function switchAoiTab(name) {
    tabBar.querySelectorAll(".aoiTab").forEach(b=>b.classList.toggle("active",b.dataset.tab===name));
    tabContent.innerHTML = "";

    if (name==="Parameters") {
      if (isAdded) {
        _cmpUnifiedParamTable(tabContent, [], d.params||[],
          {added:(d.params||[]).map(p=>({name:p.name})), removed:[], changed:[]});
      } else if (isRemoved) {
        _cmpUnifiedParamTable(tabContent, d.params||[], [],
          {added:[], removed:(d.params||[]).map(p=>({name:p.name})), changed:[]});
      } else {
        _cmpUnifiedParamTable(tabContent, d.paramsA||[], d.paramsB||[], d.paramDiff);
      }

    } else if (name==="Local Tags") {
      if (isAdded || isRemoved) {
        const allLt = d.localTags||[];
        if (!allLt.length) { _cmpAbsent(tabContent,"No local tags"); return; }
        const ltTagDiff = {
          added:   isAdded   ? allLt.map(t=>({name:t.name,dataType:t.dataType,value:t.value,desc:t.desc})) : [],
          removed: isRemoved ? allLt.map(t=>({name:t.name,dataType:t.dataType,value:t.value,desc:t.desc})) : [],
          changed: [],
        };
        _cmpUnifiedTagsDiff(tabContent, ltTagDiff, null);
      } else {
        const ltTagDiff = {
          added:   (d.localTagDiff?.added||[]).map(t=>({name:t.name,dataType:t.dataType,value:t.value,desc:t.desc})),
          removed: (d.localTagDiff?.removed||[]).map(t=>({name:t.name,dataType:t.dataType,value:t.value,desc:t.desc})),
          changed: (d.localTagDiff?.changed||[]),
        };
        const allLt = [...(d.localTagsA||[]), ...(d.localTagsB||[])];
        if (!ltTagDiff.added.length && !ltTagDiff.removed.length && !ltTagDiff.changed.length && !allLt.length) {
          _cmpAbsent(tabContent,"No local tag differences");
        } else {
          _cmpUnifiedTagsDiff(tabContent, ltTagDiff, null);
        }
      }

    } else if (name==="Logic") {
      const viewMode = tab?.viewMode||"visual";
      if (isAdded || isRemoved) {
        // Show all routines with all rungs highlighted as added/removed
        const rtns = d.routines||{};
        const rtnNames = Object.keys(rtns);
        if (!rtnNames.length) { _cmpAbsent(tabContent,"No routines"); return; }
        rtnNames.forEach(rname => {
          _cmpSectionHdr(tabContent, "Routine: "+rname);
          const rungs = (rtns[rname]||[]);
          const allNums = new Set(rungs.map((_,j)=>j));
          _cmpRenderRungs(tabContent, rungs, new Set(),
                          isRemoved ? allNums : new Set(),
                          isAdded   ? allNums : new Set(), viewMode);
        });
      } else {
        // Changed AOI: show routine diffs with side-by-side
        const rtns = d.routineDiffs||{};
        const rtnNames = Object.keys(rtns);
        if (!rtnNames.length) { _cmpAbsent(tabContent,"No routine differences"); return; }
        rtnNames.forEach(rname => {
          const rd = rtns[rname];
          _cmpSectionHdr(tabContent, "Routine: "+rname);
          const logicGrid = mk("div","aoiLogicGrid"); tabContent.appendChild(logicGrid);
          const colA = mk("div","aoiLogicCol"); logicGrid.appendChild(colA);
          const colB = mk("div","aoiLogicCol"); logicGrid.appendChild(colB);
          colA.appendChild(mk("div","cmpSecHdr","File A"));
          colB.appendChild(mk("div","cmpSecHdr","File B"));
          const rungsA=rd.rungsA||[], rungsB=rd.rungsB||[], rdiff=rd.rungDiff||[];
          const remA=new Set(),chgA=new Set(),addB=new Set(),chgB=new Set();
          rdiff.forEach(r => {
            if (r.op==="removed") remA.add(r.numA);
            if (r.op==="changed") { chgA.add(r.numA); chgB.add(r.numB); }
            if (r.op==="added")   addB.add(r.numB);
          });
          _cmpRenderRungs(colA,rungsA,chgA,remA,new Set(),viewMode);
          _cmpRenderRungs(colB,rungsB,chgB,new Set(),addB,viewMode);
        });
      }
    }
  }

  ["Parameters","Local Tags","Logic"].forEach((name,i) => {
    const b = mk("button","aoiTab"+(i===0?" active":""), name);
    b.dataset.tab = name;
    b.onclick = () => switchAoiTab(name);
    tabBar.appendChild(b);
  });
  switchAoiTab("Parameters");
}

/* routine */
function _cmpRoutineSplit(paneA, paneB, st, program, d, tab) {
  if (st==="added") {
    _cmpAbsent(paneA,"Routine not in File A");
    _cmpRenderRungs(paneB,d.rungs_data||[],new Set(),new Set(),
      new Set((d.rungs_data||[]).map(r=>r.num)),tab.viewMode);
  } else if (st==="removed") {
    _cmpRenderRungs(paneA,d.rungs_data||[],new Set(),
      new Set((d.rungs_data||[]).map(r=>r.num)),new Set(),tab.viewMode);
    _cmpAbsent(paneB,"Routine not in File B");
  } else {
    const rungsA=d.rungsA||[], rungsB=d.rungsB||[], diff=d.rungDiff||[];
    const remA=new Set(),chgA=new Set(),addB=new Set(),chgB=new Set();
    diff.forEach(r => {
      if (r.op==="removed") remA.add(r.numA);
      if (r.op==="changed") { chgA.add(r.numA); chgB.add(r.numB); }
      if (r.op==="added")   addB.add(r.numB);
    });
    _cmpRenderRungs(paneA,rungsA,chgA,remA,new Set(),tab.viewMode);
    _cmpRenderRungs(paneB,rungsB,chgB,new Set(),addB,tab.viewMode);
  }
}

function _cmpRenderRungs(pane, rungs, changed, removed, added, viewMode) {
  if (!rungs.length) { _cmpAbsent(pane,"No rungs"); return; }
  // Both visual and raw modes use the same rungCard layout as the editor —
  // just pass the mode through to createRungBuilder (read-only, no edit buttons).
  const mode = viewMode === "raw" ? "raw" : "visual";
  let firstDiff = null;
  rungs.forEach(rg => {
    const card = mk("div","rungCard cmpRoRung");
    card.dataset.rungText = rg.text||"";
    const isRem=removed.has(rg.num), isChg=changed.has(rg.num), isAdd=added.has(rg.num);
    if (isRem) card.classList.add("cmpRungRemoved");
    else if (isAdd) card.classList.add("cmpRungAdded");
    else if (isChg) card.classList.add("cmpRungChanged");
    if ((isRem||isChg||isAdd) && !firstDiff) firstDiff = card;
    const hd = mk("div","rungCardHead"); card.appendChild(hd);
    hd.appendChild(mk("span","rungNumBadge", String(rg.num).padStart(4,"0")));
    if (rg.comment) {
      const ci = mk("input","rungCommentInline"); ci.value=rg.comment; ci.readOnly=true; hd.appendChild(ci);
    }
    const bd = mk("div","rungCardBody"); card.appendChild(bd);
    createRungBuilder(bd, rg.text||"", ()=>[], {mode, hideTabs:true});
    pane.appendChild(card);
  });
  if (firstDiff) requestAnimationFrame(()=>firstDiff.scrollIntoView({block:"nearest",behavior:"smooth"}));
}

/* program overview */
function _cmpProgramSplit(paneA, paneB, st, d) {
  const isAdd = st==="added", isRem = st==="removed";
  if (isAdd || isRem) {
    _cmpKV(paneA, "Status", isAdd ? "Only in File B (new program)" : "Only in File A (removed)", isAdd?"cmpValAdded":"cmpValRemoved");
    const rtns = d.routines || [];
    _cmpKV(paneA, "Routines", String(rtns.length));
    if (rtns.length) {
      _cmpSectionHdr(paneA, "Routines");
      const tbl = mk("table","dataTable"); paneA.appendChild(tbl);
      tbl.innerHTML = "<tr><th>Name</th><th>Type</th><th>Rungs</th></tr>";
      rtns.forEach(r => {
        const tr = mk("tr", isAdd?"cmpRowAdded":"cmpRowRemoved"); tbl.appendChild(tr);
        tr.innerHTML = `<td>${r.name}</td><td>${r.type||"RLL"}</td><td>${r.rungs||0}</td>`;
        tr.style.cursor = "pointer"; tr.title = "Click to preview this routine";
        tr.onclick = () => {
          paneB.innerHTML = "";
          _cmpSectionHdr(paneB, r.name + " (" + (r.type||"RLL") + ")");
          _cmpRenderRungs(paneB, r.rungs_data||[], new Set(), new Set(),
            isAdd ? new Set((r.rungs_data||[]).map(x=>x.num)) : new Set(), "visual");
        };
      });
    }
    return;
  }
  _cmpKV(paneA,"Tags in File A",String(d.tagCountA||0));
  _cmpKV(paneA,"Tags in File B",String(d.tagCountB||0));
  const rtns=d.routines||{};
  if (rtns.added?.length) _cmpKV(paneA,"Routines Added",rtns.added.map(r=>r.name).join(", "),"cmpValAdded");
  if (rtns.removed?.length) _cmpKV(paneA,"Routines Removed",rtns.removed.map(r=>r.name).join(", "),"cmpValRemoved");
  if (rtns.changed?.length) _cmpKV(paneA,"Routines Changed",rtns.changed.map(r=>r.name).join(", "),"cmpValChanged");
  paneA.appendChild(mk("div","cmpPaneHint","\u2193 Expand this program in the tree to see routine diffs."));
}

function _cmpProgTagsSplit(paneA, paneB, diff) {
  _cmpUnifiedTagsDiff(paneA, diff, null);
}

function _cmpGenericSplit(paneA, paneB, st, d) {
  const tbl = mk("table","dataTable cmpTagTbl"); paneA.appendChild(tbl);
  tbl.innerHTML = "<tr><th></th><th>Property</th><th>Value</th></tr>";
  if (st==="added" || st==="removed") {
    const cls = st==="added"?"cmpRowAdded":"cmpRowRemoved";
    const pill = st==="added"?"+":"−";
    const pillCls = st==="added"?"added":"removed";
    Object.entries(d||{}).forEach(([k,v]) => {
      if (k==="name") return;
      const tr = mk("tr",cls); tbl.appendChild(tr);
      const p = mk("td"); tr.appendChild(p); p.appendChild(mk("span","cmpTreePill cmpTreePill-"+pillCls,pill));
      tr.appendChild(mk("td","",k)); tr.appendChild(mk("td","",v??""));
    });
    if (!Object.keys(d||{}).filter(k=>k!=="name").length) {
      const tr=mk("tr",cls); tbl.appendChild(tr);
      const p=mk("td"); tr.appendChild(p); p.appendChild(mk("span","cmpTreePill cmpTreePill-"+pillCls,pill));
      tr.appendChild(mk("td","","Name")); tr.appendChild(mk("td","",d?.name||""));
    }
  } else {
    const allKeys = new Set([...Object.keys(d.from||{}), ...Object.keys(d.to||{})]);
    if (!allKeys.size) allKeys.add("name");
    allKeys.forEach(k => {
      const va = d.from?.[k] ?? d[k] ?? "";
      const vb = d.to?.[k] ?? d[k] ?? "";
      const tr = mk("tr"); tbl.appendChild(tr);
      const pillTd = mk("td"); tr.appendChild(pillTd);
      if (va !== vb) pillTd.appendChild(mk("span","cmpTreePill cmpTreePill-changed","~"));
      tr.appendChild(mk("td","",k));
      if (va !== vb) {
        const vtd=mk("td"); tr.appendChild(vtd);
        vtd.innerHTML=`<span class="cmpCellRemoved">${va}</span> → <span class="cmpCellAdded">${vb}</span>`;
      } else { tr.appendChild(mk("td","",String(va))); }
    });
  }
}

/* ── All-category compare views ─────────────────────────────────────────── */

/** All Data Types: show every added/removed/changed dtype in one scrollable pane */
function _cmpAllDtypesView(pane, tab) {
  const dts = tab?.data?.dataTypes||{added:[],removed:[],changed:[]};
  const all = [
    ...(dts.removed||[]).map(d=>({...d,_st:"removed"})),
    ...(dts.changed||[]).map(d=>({...d,_st:"changed"})),
    ...(dts.added||[]).map(d=>({...d,_st:"added"})),
  ];
  if (!all.length) { _cmpAbsent(pane,"No data type differences"); return; }
  all.forEach(d => {
    const hdr = mk("div","cmpSecHdr");
    const pill = mk("span","cmpTreePill cmpTreePill-"+d._st, d._st==="added"?"+":d._st==="removed"?"−":"~");
    hdr.appendChild(pill);
    hdr.appendChild(document.createTextNode(" "+d.name));
    pane.appendChild(hdr);
    if (d._st==="added") {
      _cmpUnifiedDtypeTable(pane, [], d.members||[], {added:(d.members||[]).map(m=>({name:m.name}))});
    } else if (d._st==="removed") {
      _cmpUnifiedDtypeTable(pane, d.members||[], [], {removed:(d.members||[]).map(m=>({name:m.name}))});
    } else {
      _cmpUnifiedDtypeTable(pane, d.membersA||[], d.membersB||[], d.memberDiff);
    }
  });
}

/** All Modules: show every added/removed/changed module as a property table */
function _cmpAllModulesView(pane, tab) {
  const mods = tab?.data?.modules||{added:[],removed:[],changed:[]};
  const all = [
    ...(mods.removed||[]).map(d=>({...d,_st:"removed"})),
    ...(mods.changed||[]).map(d=>({...d,_st:"changed"})),
    ...(mods.added||[]).map(d=>({...d,_st:"added"})),
  ];
  if (!all.length) { _cmpAbsent(pane,"No module differences"); return; }
  all.forEach(d => {
    const hdr = mk("div","cmpSecHdr");
    const pill = mk("span","cmpTreePill cmpTreePill-"+d._st, d._st==="added"?"+":d._st==="removed"?"−":"~");
    hdr.appendChild(pill);
    hdr.appendChild(document.createTextNode(" "+d.name));
    pane.appendChild(hdr);
    _cmpGenericSplit(pane, null, d._st, d);
  });
}

/** All Tasks: show every added/removed/changed task as a property table */
function _cmpAllTasksView(pane, tab) {
  const tasks = tab?.data?.tasks||{added:[],removed:[],changed:[]};
  const all = [
    ...(tasks.removed||[]).map(d=>({...d,_st:"removed"})),
    ...(tasks.changed||[]).map(d=>({...d,_st:"changed"})),
    ...(tasks.added||[]).map(d=>({...d,_st:"added"})),
  ];
  if (!all.length) { _cmpAbsent(pane,"No task differences"); return; }
  all.forEach(d => {
    const hdr = mk("div","cmpSecHdr");
    const pill = mk("span","cmpTreePill cmpTreePill-"+d._st, d._st==="added"?"+":d._st==="removed"?"−":"~");
    hdr.appendChild(pill);
    hdr.appendChild(document.createTextNode(" "+d.name));
    pane.appendChild(hdr);
    _cmpGenericSplit(pane, null, d._st, d);
  });
}

/** All Trends: unified summary table of added/removed/changed trends */
function _cmpAllTrendsView(pane, tab) {
  const trends = tab?.data?.trends||{added:[],removed:[],changed:[]};
  const all = [
    ...(trends.removed||[]).map(d=>({...d,_st:"removed"})),
    ...(trends.changed||[]).map(d=>({...d,_st:"changed"})),
    ...(trends.added||[]).map(d=>({...d,_st:"added"})),
  ];
  if (!all.length) { _cmpAbsent(pane,"No trend differences"); return; }
  const tbl = mk("table","dataTable cmpTagTbl"); pane.appendChild(tbl);
  tbl.innerHTML = "<tr><th></th><th>Name</th><th>Pens</th></tr>";
  all.forEach(d => {
    const tr = mk("tr", d._st==="added"?"cmpRowAdded":d._st==="removed"?"cmpRowRemoved":""); tbl.appendChild(tr);
    const pillTd = mk("td"); tr.appendChild(pillTd);
    pillTd.appendChild(mk("span","cmpTreePill cmpTreePill-"+d._st, d._st==="added"?"+":d._st==="removed"?"−":"~"));
    tr.appendChild(mk("td","",d.name||""));
    tr.appendChild(mk("td","",d.pens!==undefined?String(d.pens):""));
  });
}

/* ── Migrate ─────────────────────────────────────────────────────────────── */
async function _cmpMigrate(tab, direction, migrateInfo, treeContainer, oldData, onSelect) {
  if (!tab.pathA && !tab.pathB && !tab.fileA && !tab.fileB) { toast("Load files first","err"); return; }
  const {type, name, program} = migrateInfo;
  const srcLabel = direction==="AtoB" ? "A→B" : "B→A";
  startProgress(`Migrating ${name} (${srcLabel})…`);
  try {
    let result;
    if (tab.pathA || tab.pathB) {
      // Fast path: cached roots on server — no upload needed
      const fd = new FormData();
      fd.append("direction", direction); fd.append("change_type", type);
      fd.append("name", name); fd.append("program", program||"");
      fd.append("include_comments", tab.includeComments ? "true" : "false");
      fd.append("include_values",   tab.includeValues   ? "true" : "false");
      const r = await fetch(API+"/api/compare/migrate_and_compare_cached",{method:"POST",body:fd});
      if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.detail||r.statusText); }
      result = await r.json();
    } else {
      const fd = new FormData();
      fd.append("fileA", tab.fileA); fd.append("fileB", tab.fileB);
      fd.append("direction", direction); fd.append("change_type", type);
      fd.append("name", name); fd.append("program", program||"");
      const r = await fetch(API+"/api/compare/migrate_and_compare",{method:"POST",body:fd});
      if (!r.ok) { const e=await r.json().catch(()=>({})); throw new Error(e.detail||r.statusText); }
      result = await r.json();
      const bytes = Uint8Array.from(atob(result.modified_bytes), c=>c.charCodeAt(0));
      const origName = direction==="AtoB" ? tab.fileB?.name||"B.l5x" : tab.fileA?.name||"A.l5x";
      const modFile = new File([bytes], origName, {type:"application/xml"});
      if (direction==="AtoB") tab.fileB = modFile; else tab.fileA = modFile;
    }
    tab.data = result.comparison;
    toast(`Migrated ${name} ${srcLabel}`);
    // Re-render the compare panel
    const overlay = qs("#cmpOverlay");
    if (overlay && !overlay.classList.contains("hidden")) {
      overlay.innerHTML = "";
      _cmpShowPanel(overlay, tab);
    }
  } catch(e) { toast(e.message,"err"); }
  finally { endProgress(); }
}

/* ── Save / Open comparison ─────────────────────────────────────────────── */
function _cmpSave(tab) {
  if (!tab.data) { toast("No comparison data to save","err"); return; }
  const payload = JSON.stringify({
    v:1, fileAName:tab.fileA?.name||"", fileBName:tab.fileB?.name||"",
    label:tab.label, savedAt:new Date().toISOString(), data:tab.data
  }, null, 2);
  const blob = new Blob([payload],{type:"application/json"});
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = (tab.label||"comparison").replace(/[^a-z0-9_\-]/gi,"_")+".cmpjson";
  a.click();
  URL.revokeObjectURL(a.href);
  toast("Comparison saved");
}

async function _cmpLoadSaved(file, tab, body) {
  try {
    const text = await file.text();
    const saved = JSON.parse(text);
    if (!saved.data) throw new Error("Invalid comparison file");
    tab.data = saved.data;
    tab.label = saved.label || (saved.fileAName+" \u21c4 "+saved.fileBName);
    _tbRender();
    body.innerHTML = "";
    _renderCmpSplit(body, tab);
    _updateToolbarForMode();
    toast("Loaded: "+tab.label);
  } catch(e) { toast(e.message,"err"); }
}

/* ── Home navigation ────────────────────────────────────────────────────── */
function goHome() {
  // Guard: warn if there are unsaved editor changes
  const hasEditorChanges = _modified || _edTabs.some(t => t.modified);
  if (hasEditorChanges && !confirm("Go to home screen? Unsaved editor changes will be lost.")) return;
  // Guard: warn if there are open compare sessions with data
  const hasCmpData = _cmpTabs.some(t => t.data);
  if (hasCmpData && !confirm("Go to home screen? Open comparison sessions will be closed.")) return;

  _edSaveCurrent();
  // Clear all tabs
  _edTabs = []; _edActiveId = null; _cmpTabs = [];
  if (_cmpActiveTabId !== "editor") {
    const overlay = qs("#cmpOverlay");
    if (overlay) overlay.classList.add("hidden");
    _cmpActiveTabId = "editor";
  }
  _summary = null; _active = null; _exp.clear(); setModified(false);
  qs("#btnSave").disabled = qs("#btnValidate").disabled = qs("#btnClose").disabled = true;
  _setOrganizerVisible(false);
  qs("#docName").textContent = "";
  qs("#statusText").textContent = "Ready";
  _renderWelcome(qs("#content"));
  _tbRender();
  _updateToolbarForMode();
}

/* ── Wire buttons ─────────────────────────────────────────────────────────── */
try { if (qs("#btnCompare")) qs("#btnCompare").onclick = showCompare; } catch(e){}
try { _tbRender(); } catch(e){ console.error("_tbRender error:", e); }
try { _updateToolbarForMode(); } catch(e){ console.error("_updateToolbarForMode error:", e); }

/* ── Unsaved-changes guard on window/app close ─────────────────────────── */
// beforeunload is handled in the lifecycle IIFE above
