/* ladder.js — instruction catalog + visual rung builder + ladder-diagram
   rendering (contacts/coils/blocks styled like Studio 5000), including
   parallel OR-branches ("[leg1,leg2,...]") which are extremely common in
   real-world ladder logic. */

const INSTRUCTION_CATALOG = [
  { category: "Bit", code: "XIC", label: "Examine On (XIC)", kind: "condition", symbol: "contact", operands: ["Bit"] },
  { category: "Bit", code: "XIO", label: "Examine Off (XIO)", kind: "condition", symbol: "contact-neg", operands: ["Bit"] },
  { category: "Bit", code: "OTE", label: "Output Energize (OTE)", kind: "output", symbol: "coil", operands: ["Bit"] },
  { category: "Bit", code: "OTL", label: "Output Latch (OTL)", kind: "output", symbol: "coil-l", operands: ["Bit"] },
  { category: "Bit", code: "OTU", label: "Output Unlatch (OTU)", kind: "output", symbol: "coil-u", operands: ["Bit"] },
  { category: "Bit", code: "ONS", label: "One Shot (ONS)", kind: "condition", symbol: "block", operands: ["Bit"] },
  { category: "Bit", code: "OSR", label: "One Shot Rising (OSR)", kind: "output", symbol: "block", operands: ["Bit", "Storage Bit", "Output Bit"] },
  { category: "Bit", code: "OSF", label: "One Shot Falling (OSF)", kind: "output", symbol: "block", operands: ["Bit", "Storage Bit", "Output Bit"] },

  { category: "Timer/Counter", code: "TON", label: "Timer On-Delay (TON)", kind: "output", symbol: "block", operands: ["Timer", "Preset", "Accum"] },
  { category: "Timer/Counter", code: "TOF", label: "Timer Off-Delay (TOF)", kind: "output", symbol: "block", operands: ["Timer", "Preset", "Accum"] },
  { category: "Timer/Counter", code: "RTO", label: "Retentive Timer On (RTO)", kind: "output", symbol: "block", operands: ["Timer", "Preset", "Accum"] },
  { category: "Timer/Counter", code: "CTU", label: "Count Up (CTU)", kind: "output", symbol: "block", operands: ["Counter", "Preset", "Accum"] },
  { category: "Timer/Counter", code: "CTD", label: "Count Down (CTD)", kind: "output", symbol: "block", operands: ["Counter", "Preset", "Accum"] },
  { category: "Timer/Counter", code: "RES", label: "Reset (RES)", kind: "output", symbol: "block", operands: ["Tag"] },

  { category: "Compare", code: "EQU", label: "Equal (EQU)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "NEQ", label: "Not Equal (NEQ)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "GRT", label: "Greater Than (GRT)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "GEQ", label: "Greater Than or Equal (GEQ)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "LES", label: "Less Than (LES)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "LEQ", label: "Less Than or Equal (LEQ)", kind: "condition", symbol: "block", operands: ["Source A", "Source B"] },
  { category: "Compare", code: "LIM", label: "Limit Test (LIM)", kind: "condition", symbol: "block", operands: ["Low Limit", "Test", "High Limit"] },
  { category: "Compare", code: "MEQ", label: "Mask Equal (MEQ)", kind: "condition", symbol: "block", operands: ["Source", "Mask", "Compare"] },

  { category: "Compute/Math", code: "ADD", label: "Add (ADD)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Compute/Math", code: "SUB", label: "Subtract (SUB)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Compute/Math", code: "MUL", label: "Multiply (MUL)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Compute/Math", code: "DIV", label: "Divide (DIV)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Compute/Math", code: "MOD", label: "Modulo (MOD)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Compute/Math", code: "SQR", label: "Square Root (SQR)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute/Math", code: "NEG", label: "Negate (NEG)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute/Math", code: "ABS", label: "Absolute Value (ABS)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },

  { category: "Move/Logical", code: "MOV", label: "Move (MOV)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Move/Logical", code: "MVM", label: "Masked Move (MVM)", kind: "output", symbol: "block", operands: ["Source", "Mask", "Dest"] },
  { category: "Move/Logical", code: "AND", label: "Bitwise AND (AND)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Move/Logical", code: "OR", label: "Bitwise OR (OR)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Move/Logical", code: "XOR", label: "Bitwise XOR (XOR)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "Move/Logical", code: "NOT", label: "Bitwise NOT (NOT)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Move/Logical", code: "CLR", label: "Clear (CLR)", kind: "output", symbol: "block", operands: ["Dest"] },

  { category: "Program Control", code: "JSR", label: "Jump to Subroutine (JSR)", kind: "output", symbol: "block", operands: ["Routine Name"] },
  { category: "Program Control", code: "JMP", label: "Jump (JMP)", kind: "output", symbol: "block", operands: ["Label Name"] },
  { category: "Program Control", code: "LBL", label: "Label (LBL)", kind: "output", symbol: "block", operands: ["Label Name"] },
  { category: "Program Control", code: "MCR", label: "Master Control Reset (MCR)", kind: "output", symbol: "block", operands: [] },
  { category: "Program Control", code: "NOP", label: "No Operation (NOP)", kind: "output", symbol: "block", operands: [] },
  { category: "Program Control", code: "RET", label: "Return from Subroutine (RET)", kind: "output", symbol: "block", operands: [] },
  { category: "Program Control", code: "TND", label: "Temporary End (TND)", kind: "output", symbol: "block", operands: [] },
  { category: "Program Control", code: "AFI", label: "Always False Input (AFI)", kind: "condition", symbol: "block", operands: [] },
  { category: "Program Control", code: "UID", label: "User Interrupt Disable (UID)", kind: "output", symbol: "block", operands: [] },
  { category: "Program Control", code: "UIE", label: "User Interrupt Enable (UIE)", kind: "output", symbol: "block", operands: [] },

  { category: "File/Misc", code: "COP", label: "Copy File (COP)", kind: "output", symbol: "block", operands: ["Source", "Dest", "Length"] },
  { category: "File/Misc", code: "CPS", label: "Copy Synchronized (CPS)", kind: "output", symbol: "block", operands: ["Source", "Dest", "Length"] },
  { category: "File/Misc", code: "FLL", label: "Fill File (FLL)", kind: "output", symbol: "block", operands: ["Source", "Dest", "Length"] },
  { category: "File/Misc", code: "BTD", label: "Bit Field Distribute (BTD)", kind: "output", symbol: "block", operands: ["Source", "Src Bit", "Dest", "Dest Bit", "Length"] },
  { category: "File/Misc", code: "BSL", label: "Bit Shift Left (BSL)", kind: "output", symbol: "block", operands: ["Array", "Control", "Src Bit", "Length"] },
  { category: "File/Misc", code: "BSR", label: "Bit Shift Right (BSR)", kind: "output", symbol: "block", operands: ["Array", "Control", "Src Bit", "Length"] },
  { category: "File/Misc", code: "SWP", label: "Swap (SWP)", kind: "output", symbol: "block", operands: ["Source", "Length"] },
  { category: "File/Misc", code: "MSG", label: "Message (MSG)", kind: "output", symbol: "block", operands: ["Message Control"] },

  { category: "Compute", code: "CPT", label: "Compute (CPT)", kind: "output", symbol: "block", operands: ["Dest", "Expression"] },
  { category: "Compute", code: "CMP", label: "Compare (CMP)", kind: "condition", symbol: "block", operands: ["Expression"] },
  { category: "Compute", code: "SIN", label: "Sine (SIN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "COS", label: "Cosine (COS)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "TAN", label: "Tangent (TAN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "ASIN", label: "Arc Sine (ASIN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "ACOS", label: "Arc Cosine (ACOS)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "ATAN", label: "Arc Tangent (ATAN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "LN", label: "Natural Log (LN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "LOG", label: "Log Base 10 (LOG)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "TRN", label: "Truncate (TRN)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "Compute", code: "SRT", label: "Sort (SRT)", kind: "output", symbol: "block", operands: ["Array", "Control", "Length"] },

  { category: "String", code: "MID", label: "Mid String (MID)", kind: "output", symbol: "block", operands: ["Source", "Qty", "Start", "Dest"] },
  { category: "String", code: "CONCAT", label: "Concatenate (CONCAT)", kind: "output", symbol: "block", operands: ["Source A", "Source B", "Dest"] },
  { category: "String", code: "FIND", label: "Find String (FIND)", kind: "output", symbol: "block", operands: ["Source", "Search", "Start", "Result"] },
  { category: "String", code: "INSERT", label: "Insert String (INSERT)", kind: "output", symbol: "block", operands: ["Source", "Insert", "Start", "Dest"] },
  { category: "String", code: "DELETE", label: "Delete String (DELETE)", kind: "output", symbol: "block", operands: ["Source", "Qty", "Start", "Dest"] },
  { category: "String", code: "UPPER", label: "Upper Case (UPPER)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "String", code: "LOWER", label: "Lower Case (LOWER)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "String", code: "STOD", label: "String To DINT (STOD)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "String", code: "STOR", label: "String To REAL (STOR)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "String", code: "DTOS", label: "DINT To String (DTOS)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },
  { category: "String", code: "RTOS", label: "REAL To String (RTOS)", kind: "output", symbol: "block", operands: ["Source", "Dest"] },

  { category: "System", code: "GSV", label: "Get System Value (GSV)", kind: "output", symbol: "block", operands: ["Class Name", "Instance Name", "Attribute Name", "Dest"] },
  { category: "System", code: "SSV", label: "Set System Value (SSV)", kind: "output", symbol: "block", operands: ["Class Name", "Instance Name", "Attribute Name", "Source"] },
  { category: "System", code: "IOT", label: "Immediate Output (IOT)", kind: "output", symbol: "block", operands: ["Data Table Address"] },
  { category: "System", code: "IIN", label: "Immediate Input (IIN)", kind: "output", symbol: "block", operands: ["Data Table Address"] },
  { category: "System", code: "EVENT", label: "Trigger Event (EVENT)", kind: "output", symbol: "block", operands: ["Event Task"] },

  { category: "Sequencer", code: "SQI", label: "Sequencer Input (SQI)", kind: "condition", symbol: "block", operands: ["Array", "Mask", "Source", "Control", "Length", "Position"] },
  { category: "Sequencer", code: "SQO", label: "Sequencer Output (SQO)", kind: "output", symbol: "block", operands: ["Array", "Mask", "Dest", "Control", "Length", "Position"] },
  { category: "Sequencer", code: "SQL", label: "Sequencer Load (SQL)", kind: "output", symbol: "block", operands: ["Array", "Source", "Control", "Length", "Position"] },

  { category: "PID", code: "PID", label: "PID (PID)", kind: "output", symbol: "block", operands: ["PID", "Process Var", "Tieback", "Control Var", "PID Master Loop", "Inhold Bit", "Inhold Value"] },
  { category: "PID", code: "PIDE", label: "PID Enhanced (PIDE)", kind: "output", symbol: "block", operands: ["PIDE", "Process Var", "Tieback", "Control Var"] },
];

/** Populated at runtime from the open document's AOI definitions so users
 * can drop custom Add-On Instructions into the visual builder too. */
let CUSTOM_INSTRUCTIONS = [];
function setCustomInstructions(list) { CUSTOM_INSTRUCTIONS = list || []; }
function allInstructions() { return INSTRUCTION_CATALOG.concat(CUSTOM_INSTRUCTIONS); }
/** Case-insensitive lookup so AOI names from rung text match AOI definitions
 *  regardless of how they were typed (Studio 5000 is case-insensitive for AOIs). */
function instructionByCode(code) {
  if (!code) return null;
  const upper = code.toUpperCase();
  return allInstructions().find(i => i.code.toUpperCase() === upper);
}
function instructionCategories() { return [...new Set(allInstructions().map(i => i.category))]; }

/** Returns true if any instruction anywhere inside `elements` (including
 *  nested branch legs) is a known output-kind instruction.  Used so that a
 *  parallel branch of coils/blocks is correctly placed on the output side. */
function _hasOutput(elements) {
  return elements.some(el => {
    if (el.kind === "branch") return el.legs.some(leg => _hasOutput(leg));
    const instr = instructionByCode(el.code);
    return instr && instr.kind === "output";
  });
}

/** Returns the index of the first top-level element that is — or contains —
 *  an output instruction.  Outputs are pushed to the right rail; everything
 *  before them (conditions, compare blocks) stays on the left. */
function _firstOutputIdx(arr) {
  for (let i = 0; i < arr.length; i++) {
    const el = arr[i];
    if (el.kind === "instr") {
      const instr = instructionByCode(el.code);
      if (instr && instr.kind === "output") return i;
    } else if (el.kind === "branch") {
      // A branch whose legs contain any output belongs on the output side
      if (el.legs.some(leg => _hasOutput(leg))) return i;
    }
  }
  return arr.length;
}

/* ── element model ─────────────────────────────────────────────────────────
 * A rung's logic is a flat top-level LIST of "elements":
 *   { kind:"instr",  code, args:[...] }
 *   { kind:"branch", legs:[ [element,...], [element,...], ... ] }
 * Branch legs are themselves lists of elements, so branches CAN nest
 * (a branch inside a leg) - the parser below supports arbitrary nesting,
 * matching real AB syntax like  A[B,C[D,E]]F;
 * ──────────────────────────────────────────────────────────────────────── */

function stepToText(step) {
  const instr = instructionByCode(step.code);
  if (!instr) return `${step.code}(${(step.args||[]).join(",")})`;
  if (!instr.operands.length) return `${step.code}()`;
  return `${step.code}(${step.args.join(",")})`;
}

function elementToText(el) {
  if (el.kind === "branch") {
    return "[" + el.legs.map(legToText).join(",") + "]";
  }
  return stepToText(el);
}
function legToText(leg) { return leg.map(elementToText).join(""); }
function elementsToText(elements) { return elements.map(elementToText).join(""); }
function stepsToRungText(elements) { return elementsToText(elements) + ";"; }

/**
 * Recursive-descent parser: turns raw AB instruction text into the element
 * tree described above. Returns null if the text can't be safely
 * round-tripped (unrecognised syntax) - callers fall back to raw-text mode.
 */
function parseRungTextToSteps(text) {
  if (text == null) return [];
  const trimmed = text.trim().replace(/;\s*$/, "");
  if (trimmed === "") return [];

  let i = 0;
  const n = trimmed.length;
  function skipWs() { while (i < n && /\s/.test(trimmed[i])) i++; }

  function parseInstr() {
    const m = /^([A-Za-z_][A-Za-z0-9_]*)\(/.exec(trimmed.slice(i));
    if (!m) return null;
    const code = m[1];
    let j = i + m[0].length;
    // Find the MATCHING closing paren using depth count (handles nested parens in args)
    let depth = 1, k = j;
    while (k < n && depth > 0) {
      if (trimmed[k] === "(") depth++;
      else if (trimmed[k] === ")") depth--;
      k++;
    }
    if (depth !== 0) return null;
    const close = k - 1;
    const argsRaw = trimmed.slice(j, close).trim();
    // Split on commas only at depth 0
    const args = [];
    if (argsRaw) {
      let d2 = 0, start2 = 0;
      for (let x = 0; x < argsRaw.length; x++) {
        if (argsRaw[x] === "(") d2++;
        else if (argsRaw[x] === ")") d2--;
        else if (argsRaw[x] === "," && d2 === 0) {
          args.push(argsRaw.slice(start2, x).trim());
          start2 = x + 1;
        }
      }
      args.push(argsRaw.slice(start2).trim());
    }
    i = close + 1;
    return { kind: "instr", code, args };
  }

  function parseBranch() {
    // trimmed[i] === '['
    i++;
    const legs = [];
    while (true) {
      skipWs();
      const leg = parseSeq();
      if (leg === null) return null;
      legs.push(leg);
      skipWs();
      if (trimmed[i] === ",") { i++; continue; }
      if (trimmed[i] === "]") { i++; break; }
      return null;
    }
    return { kind: "branch", legs };
  }

  function parseSeq() {
    const elems = [];
    while (true) {
      skipWs();
      if (i >= n || trimmed[i] === "," || trimmed[i] === "]") break;
      if (trimmed[i] === "[") {
        const br = parseBranch();
        if (br === null) return null;
        elems.push(br);
      } else {
        const inst = parseInstr();
        if (inst === null) return null;
        elems.push(inst);
      }
    }
    return elems;
  }

  const elements = parseSeq();
  if (elements === null) return null;
  skipWs();
  if (i !== n) return null; // trailing junk we couldn't consume
  return elements;
}

/* ── Ladder diagram visual rendering ──────────────────────────────────── *
 * The diagram itself IS the editor now (click a contact/coil/block to
 * edit it, click the small ✕ to delete it, click + / OR at the end of a
 * wire or leg to append) - there's no separate always-on text list
 * cluttering the view. A "Show element list" toggle (off by default,
 * remembered via localStorage) still exposes the old reorderable text
 * list for anyone who wants it. Raw text mode pretty-prints branches with
 * indentation instead of one giant one-line blob. ──────────────────────── */

function _el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function mkBtn(label, onclick) { const b = document.createElement("button"); b.type = "button"; b.textContent = label; b.onclick = onclick; return b; }
function iconBtn(label, onclick) { const b = mkBtn(label, onclick); b.className = "icon"; return b; }

/** Builds the {onEdit,onDelete} pair for the i'th item of `arr`, calling
 * `onChange` (a re-render) after any mutation. Returns null (= read-only)
 * if `parentCtx` is null. */
function _itemCtx(arr, idx, parentCtx) {
  if (!parentCtx) return null;
  return {
    datalistId: parentCtx.datalistId,
    onChange: () => parentCtx.onChange(),   // REQUIRED: renderBranch reads ctx.onChange to build legCtx
    _dragMeta: { arr, idx },
    onEdit: () => openStepEditor(parentCtx.datalistId, arr[idx], (step) => { arr[idx] = step; parentCtx.onChange(); }),
    onDelete: () => { arr.splice(idx, 1); parentCtx.onChange(); },
    onDirectEdit: (newStep) => { arr[idx] = newStep; parentCtx.onChange(); },
    onDirectEditSilent: (newStep) => { arr[idx] = newStep; },
  };
}


/* ── Drag state (shared with app.js toolbar buttons via window) ────────────── */
window._ldDrag = null;       // { kind:"new-instr"|"move-instr", arr, idx, code }
window._ldClipboard = null;  // deep-copy of last copied element (Ctrl+C/V)
window._ldInsertPos = null;  // { arr, idx, dot, onChange } — wire cursor from click-to-select

/** Called by toolbar drag start to begin a drag operation */
function _dragBegin(data) {
  window._ldDrag = data;
  document.body.classList.add("ldDragging");
  console.log("[L5X drag] begin:", data.kind, data.code||"");
}
function _dragEnd() {
  window._ldDrag = null;
  document.body.classList.remove("ldDragging");
}

/** Clear the wire-cursor selection (click-to-select workflow) */
function _clearInsertPos() {
  if (window._ldInsertPos && window._ldInsertPos.dot) {
    window._ldInsertPos.dot.classList.remove("insertSelected");
  }
  window._ldInsertPos = null;
  if (typeof window._onInsertPosChange === "function") window._onInsertPosChange();
}
var _selElem = null;    // currently selected .ladderElem DOM node

function _selectElem(el) {
  if (_selElem && _selElem !== el) _selElem.classList.remove("selected");
  _selElem = el;
  if (el) {
    el.classList.add("selected");
    // Bubble up so the parent rungCard gets highlighted/focused too
    const card = el.closest(".rungCard");
    if (card && card._selectSelf) card._selectSelf();
  }
}

function renderInstrSymbol(step, ctx) {
  const instr = instructionByCode(step.code);
  const kind  = instr ? instr.kind : "output";
  const sym   = instr ? instr.symbol : "block";
  const args  = step.args || [];
  const wrap = _el("div", "ladderElem " + kind + (ctx ? " editable" : ""));
  let box = null, body = null;

  if (sym === "contact" || sym === "contact-neg") {
    box = _el("div", "symContact" + (sym === "contact-neg" ? " neg" : ""));
    box.appendChild(_el("div", "cBar")); box.appendChild(_el("div", "cBar"));
    if (sym === "contact-neg") box.appendChild(_el("div", "cSlash"));
    box.title = step.code;
    wrap.appendChild(box);
    const lbl = _el("div", "elemLabel", args[0] || "?"); lbl.title = args[0] || ""; wrap.appendChild(lbl);
  } else if (sym === "coil" || sym === "coil-l" || sym === "coil-u") {
    box = _el("div", "symCoil");
    box.appendChild(_el("span", "coilChar", sym === "coil-l" ? "L" : sym === "coil-u" ? "U" : ""));
    box.title = step.code;
    wrap.appendChild(box);
    const lbl = _el("div", "elemLabel", args[0] || "?"); lbl.title = args[0] || ""; wrap.appendChild(lbl);
  } else {
    box = _el("div", "symBlock");
    box.appendChild(_el("div", "blockTitle", step.code));
    body = _el("div", "blockBody");
    if (!instr) console.warn(`[L5X] Unknown instruction "${step.code}" — showing P1/P2/P3 labels. Check CUSTOM_INSTRUCTIONS is loaded.`);
    const opNames = instr ? instr.operands : args.map((_, i) => `P${i + 1}`);
    opNames.forEach((opName, i) => {
      if (args[i] !== undefined) {
        const row = _el("div", "blockRow", `${opName}: ${args[i]}`); row.title = `${opName}: ${args[i]}`;
        body.appendChild(row);
      }
    });
    if (!body.children.length) body.appendChild(_el("div", "blockRow", "\u00A0"));
    box.appendChild(body);
    wrap.appendChild(box);
  }
  if (ctx) {
    // Single-click → select; double-click → open full step editor dialog
    wrap.onclick = (e) => { e.stopPropagation(); _selectElem(wrap); };
    wrap.ondblclick = (e) => { e.stopPropagation(); _selectElem(wrap); ctx.onEdit(); };
    wrap.title = "Click to select · Double-click to edit";

    // Store delete context so keyboard Delete (in app.js) can remove this instruction
    wrap._delCtx = ctx;
    // Drag-and-drop: store element index for reordering
    wrap.draggable = true;
    wrap.ondragstart = (e) => {
      e.stopPropagation();  // prevent rung-card dragstart from overwriting _ldDrag
      if (ctx._dragMeta) _dragBegin({ kind:"move-instr", arr: ctx._dragMeta.arr, idx: ctx._dragMeta.idx });
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", step.code);
      setTimeout(() => wrap.classList.add("dragging"), 0);
    };
    wrap.ondragend = () => { wrap.classList.remove("dragging"); _dragEnd(); };

    // Drag-over: instruction elements ARE drop targets so user gets visual feedback
    // (left half = insert before, right half = insert after this element)
    wrap.ondragover = (e) => {
      const drag = window._ldDrag;
      if (!drag || drag.kind === "rung") return;
      e.preventDefault(); e.stopPropagation();
      e.dataTransfer.dropEffect = drag.kind === "new-instr" ? "copy" : "move";
      const r = wrap.getBoundingClientRect();
      const side = e.clientX < r.left + r.width / 2 ? "before" : "after";
      if (wrap.dataset.dropSide !== side) { wrap.dataset.dropSide = side; }
    };
    wrap.ondragleave = (e) => {
      if (!wrap.contains(e.relatedTarget)) delete wrap.dataset.dropSide;
    };
    wrap.ondrop = (e) => {
      e.preventDefault(); e.stopPropagation();
      const side = wrap.dataset.dropSide || "after";
      delete wrap.dataset.dropSide;
      const drag = window._ldDrag;
      if (!drag || drag.kind === "rung" || !ctx._dragMeta) return;
      const selfArr = ctx._dragMeta.arr;
      const selfIdx = ctx._dragMeta.idx;
      const insertAt = side === "before" ? selfIdx : selfIdx + 1;
      _clearInsertPos();
      if (drag.kind === "new-instr") {
        const instr = instructionByCode(drag.code);
        const el = { kind:"instr", code:drag.code, args:instr?instr.operands.map(()=>""):[] };
        selfArr.splice(insertAt, 0, el);
        _dragEnd(); ctx.onChange();
      } else if (drag.kind === "new-branch") {
        selfArr.splice(insertAt, 0, { kind:"branch", legs:[[],[]] });
        _dragEnd(); ctx.onChange();
      } else if (drag.kind === "move-instr") {
        const { arr:srcArr, idx:srcIdx } = drag;
        if (srcArr === selfArr && (srcIdx === selfIdx || srcIdx === insertAt)) { _dragEnd(); return; }
        const el = srcArr.splice(srcIdx, 1)[0];
        const adj = srcArr === selfArr && srcIdx < insertAt ? insertAt - 1 : insertAt;
        selfArr.splice(adj, 0, el);
        _dragEnd(); ctx.onChange();
      }
    };

    // Inline tag edit: double-click the tag label for contacts/coils
    if ((sym === "contact" || sym === "contact-neg" || sym === "coil" ||
         sym === "coil-l" || sym === "coil-u") && wrap.querySelector(".elemLabel")) {
      const lbl = wrap.querySelector(".elemLabel");
      lbl.title = "Double-click to edit tag";
      lbl.style.cursor = "text";
      lbl.ondblclick = (e) => {
        e.stopPropagation();
        const orig = args[0] || "";
        const inp = document.createElement("input");
        inp.value = orig; inp.className = "tagInlineEdit"; inp.list = ctx.datalistId;
        lbl.textContent = ""; lbl.appendChild(inp); inp.focus(); inp.select();
        function commit() {
          const nv = inp.value.trim(); lbl.textContent = nv || orig; lbl.title = "Double-click to edit tag";
          if (nv && nv !== orig) { const na=[...step.args]; na[0]=nv; ctx.onDirectEditSilent({...step,args:na}); }
        }
        inp.onblur = commit;
        inp.onkeydown = e2=>{if(e2.key==="Enter"){e2.preventDefault();commit();}if(e2.key==="Escape"){lbl.textContent=orig;}};
      };
    }

    // Block instructions: inline arg editing per row + inline code change
    if (sym === "block") {
      const titleEl = box ? box.querySelector(".blockTitle") : null;
      if (titleEl) {
        titleEl.title = "Double-click to change instruction code";
        titleEl.style.cursor = "text";
        titleEl.ondblclick = (e) => {
          e.stopPropagation();
          const orig = step.code;
          const inp = document.createElement("input");
          inp.value = orig; inp.style.cssText = "width:60px;font-size:11px;font-weight:600;text-transform:uppercase;padding:1px;";
          titleEl.textContent = ""; titleEl.appendChild(inp); inp.focus(); inp.select();
          function commit() {
            const nv = (inp.value.trim() || orig).toUpperCase();
            titleEl.textContent = nv;
            if (nv !== orig) ctx.onDirectEdit({...step, code:nv});
          }
          inp.onblur = commit;
          inp.onkeydown = e2=>{if(e2.key==="Enter"){e2.preventDefault();commit();}if(e2.key==="Escape"){titleEl.textContent=orig;}};
        };
      }
      if (body) {
        Array.from(body.querySelectorAll(".blockRow")).forEach((row, argIdx) => {
          const opName = (instr && instr.operands[argIdx]) || ("P"+(argIdx+1));
          row.title = "Double-click to edit"; row.style.cursor = "text";
          row.ondblclick = (e) => {
            e.stopPropagation();
            const orig = args[argIdx] || "";
            const inp = document.createElement("input");
            inp.value = orig; inp.className = "tagInlineEdit"; inp.list = ctx.datalistId; inp.style.width="120px";
            row.textContent = ""; row.appendChild(inp); inp.focus(); inp.select();
            function commit() {
              const nv = inp.value.trim();
              row.textContent = opName+": "+(nv||orig); row.title = "Double-click to edit";
              if (nv !== orig) { const na=[...step.args]; na[argIdx]=nv; ctx.onDirectEditSilent({...step,args:na}); }
            }
            inp.onblur = commit;
            inp.onkeydown = e2=>{if(e2.key==="Enter"){e2.preventDefault();commit();}if(e2.key==="Escape"){row.textContent=opName+": "+orig;}};
          };
        });
      }
    }

    const del = _el("button", "elemDel", "✕"); del.type = "button";
    del.title = "Delete instruction";
    del.onclick = (e) => { e.stopPropagation(); ctx.onDelete(); };
    wrap.appendChild(del);
  }
  return wrap;
}

function renderElement(el, ctx) {
  if (el.kind === "branch") return renderBranch(el, ctx);
  return renderInstrSymbol(el, ctx);
}

/** Small interactable dot on the wire — click to insert an instruction
 *  or branch AT that position (before the element that follows). */
function _insertDot(arr, insertIdx, ctx) {
  const dot = _el("button", "insertDot");
  dot.type = "button"; dot.title = "Click to insert · Drag instruction here";
  function collapse() { dot.innerHTML = ""; dot.classList.remove("expanded"); }

  // No onclick — clicking the wire selects the rung (handled by capture-phase in app.js)
  // These dots are purely visual separators + precision drop targets during drag.

  // Drag-and-drop: accept instruction drops (not rung reorder) and stop bubbling
  dot.ondragover = (e) => {
    const drag = window._ldDrag;
    if (!drag || drag.kind === "rung") return;
    e.preventDefault();
    e.stopPropagation();
    e.dataTransfer.dropEffect = drag.kind === "move-instr" ? "move" : "copy";
    dot.classList.add("dragOver");
  };
  dot.ondragleave = () => dot.classList.remove("dragOver");
  dot.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation(); // prevent wire.ondrop from double-handling
    dot.classList.remove("dragOver");
    const drag = window._ldDrag;
    if (!drag || drag.kind === "rung") return;
    collapse();
    _clearInsertPos(); // drag supersedes any click-to-select cursor
    if (drag.kind === "new-instr") {
      const instr = instructionByCode(drag.code);
      const el = { kind:"instr", code:drag.code, args: instr ? instr.operands.map(()=>"") : [] };
      arr.splice(insertIdx, 0, el);
      _dragEnd(); ctx.onChange();
    } else if (drag.kind === "new-branch") {
      arr.splice(insertIdx, 0, { kind:"branch", legs:[[],[]] });
      _dragEnd(); ctx.onChange();
    } else if (drag.kind === "move-instr") {
      const { arr:srcArr, idx:srcIdx } = drag;
      const el = srcArr[srcIdx];
      if (srcArr === arr && srcIdx === insertIdx) { _dragEnd(); return; }
      srcArr.splice(srcIdx, 1);
      const adj = (srcArr === arr && srcIdx < insertIdx) ? insertIdx - 1 : insertIdx;
      arr.splice(adj, 0, el);
      _dragEnd(); ctx.onChange();
    }
  };

  // Click-to-select: clicking the wire sets a persistent insert cursor
  // (capture-phase listener on rungCard selects the rung; bubble phase here sets insert position)
  dot.onclick = (e) => {
    e.stopPropagation();
    // Toggle: click same dot again to deselect
    if (window._ldInsertPos && window._ldInsertPos.dot === dot) {
      _clearInsertPos();
      return;
    }
    _clearInsertPos();
    window._ldInsertPos = { arr, idx: insertIdx, dot, onChange: ctx.onChange };
    dot.classList.add("insertSelected");
    if (typeof window._onInsertPosChange === "function") window._onInsertPosChange();
  };

  return dot;
}

/** Appends wire-segment + element pairs for `arr` into `container`. If
 * `ctx` ({onChange,datalistId}) is given, each element becomes clickable
 * (edit) / gets a ✕ (delete), and insert-dots appear between elements so
 * you can add instructions or branches at any position.
 * When `splitOutputs` is true (top-level rung wire only), a flex-grow spacer
 * is inserted before the first output instruction so inputs stay left and
 * outputs are pushed to the right rail — matching Studio 5000 convention. */
function appendSeq(container, arr, ctx, splitOutputs) {
  if (!arr.length) {
    if (!ctx) {
      container.appendChild(_el("div", "wireSeg long"));
      container.appendChild(_el("div", "elemLabel dim", "(empty)"));
    } else {
      // Empty rung in edit mode: single full-width insertDot covers the whole wire
      const dot = _insertDot(arr, 0, ctx);
      dot.classList.add("wireSplit");
      container.appendChild(dot);
    }
    return;
  }
  const splitAt = splitOutputs ? _firstOutputIdx(arr) : arr.length;
  arr.forEach((el, i) => {
    if (ctx) {
      // Edit mode: insertDot IS the wire.
      // At the condition/output split, make the dot fill all available space.
      const dot = _insertDot(arr, i, ctx);
      if (splitOutputs && i === splitAt) dot.classList.add("wireSplit");
      container.appendChild(dot);
    } else {
      if (splitOutputs && i === splitAt) container.appendChild(_el("div", "wireSeg long"));
      container.appendChild(_el("div", "wireSeg"));
    }
    container.appendChild(renderElement(el, _itemCtx(arr, i, ctx)));
    if (!ctx) container.appendChild(_el("div", "wireSeg"));
  });
  if (!ctx && splitOutputs && splitAt === arr.length && arr.length > 0) {
    container.appendChild(_el("div", "wireSeg long"));
  }
  if (ctx) {
    const dot = _insertDot(arr, arr.length, ctx);
    // All-condition rung: trailing insertDot takes the remaining space
    if (splitOutputs && splitAt === arr.length) dot.classList.add("wireSplit");
    container.appendChild(dot);
  }
}

function renderBranch(branchEl, ctx) {
  const wrap = _el("div", "ladderBranch");
  if (ctx) {
    // Branches can be selected via single-click on the wrap
    wrap.onclick = (e) => { e.stopPropagation(); _selectElem(wrap); };
    wrap.classList.add("editable");
    wrap.title = "Click to select branch · Del key to delete";
    if (ctx._dragMeta) {
      // Store branch reference so keyboard Delete knows what to remove
      wrap._delCtx = ctx;
    }
    // Broad dragover on the branch wrap catches dead zones outside leg wires
    wrap.ondragover = (e) => {
      if (!window._ldDrag || window._ldDrag.kind === "rung") return;
      e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    };
  }
  const legCtx = ctx ? { onChange: ctx.onChange, datalistId: ctx.datalistId } : null;
  branchEl.legs.forEach((leg, legIdx) => {
    const legRow = _el("div", "ladderBranchLeg");
    const wire = _el("div", "branchLegWire");
    appendSeq(wire, leg, legCtx);
    // Broad drag-drop target on each branch leg wire (same pattern as rungWire)
    if (legCtx) {
      wire.ondragover = (e) => {
        if (!window._ldDrag) return;
        e.preventDefault(); e.dataTransfer.dropEffect = "copy";
        wire.classList.add("wireDragOver");
      };
      wire.ondragleave = (e) => {
        if (!wire.contains(e.relatedTarget)) wire.classList.remove("wireDragOver");
      };
      wire.ondrop = (e) => {
        e.preventDefault();
        e.stopPropagation();
        wire.classList.remove("wireDragOver");
        const drag = window._ldDrag;
        if (!drag || drag.kind === "rung") return;
        const dots = Array.from(wire.children).filter(c => c.classList.contains("insertDot"));
        let bestIdx = leg.length;
        if (dots.length) {
          let bestDist = Infinity;
          dots.forEach((dot, di) => {
            const r = dot.getBoundingClientRect();
            const dist = Math.abs(e.clientX - (r.left + r.width / 2));
            if (dist < bestDist) { bestDist = dist; bestIdx = di; }
          });
        }
        if (drag.kind === "new-instr") {
          const instr = instructionByCode(drag.code);
          leg.splice(bestIdx, 0, { kind:"instr", code:drag.code, args: instr ? instr.operands.map(()=>"") : [] });
          _dragEnd(); legCtx.onChange();
        } else if (drag.kind === "new-branch") {
          leg.splice(bestIdx, 0, { kind:"branch", legs:[[],[]] });
          _dragEnd(); legCtx.onChange();
        } else if (drag.kind === "move-instr") {
          const { arr:srcArr, idx:srcIdx } = drag;
          const el = srcArr[srcIdx];
          if (srcArr === leg && srcIdx === bestIdx) { _dragEnd(); return; }
          srcArr.splice(srcIdx, 1);
          const adj = (srcArr === leg && srcIdx < bestIdx) ? bestIdx - 1 : bestIdx;
          leg.splice(adj, 0, el); _dragEnd(); legCtx.onChange();
        }
      };
    }
    legRow.appendChild(wire);
    // No per-leg ✕ button; leg management is via toolbar
    wrap.appendChild(legRow);
  });
  return wrap;
}

/** Renders a full rung as a rail-to-rail ladder diagram (read-only). */
function buildLadderPreview(elements) {
  const rung = _el("div", "ladderRung");
  rung.appendChild(_el("div", "rail"));
  const wire = _el("div", "rungWire");
  appendSeq(wire, elements, null, true);
  rung.appendChild(wire);
  rung.appendChild(_el("div", "rail"));
  return rung;
}

/** Same diagram, but interactive - this is the primary rung editor now. */
function buildLadderEditor(elements, datalistId, onChange) {
  const rung = _el("div", "ladderRung editable");
  // Broad dragover/drop on the WHOLE ladderRung container (catches padding & rail dead-zones)
  rung.ondragover = (e) => {
    if (!window._ldDrag || window._ldDrag.kind === "rung") return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
  };
  rung.ondrop = (e) => {
    if (!window._ldDrag || window._ldDrag.kind === "rung") return;
    e.preventDefault();
    const drag = window._ldDrag;
    if (!drag) return;
    if (drag.kind === "new-instr") {
      const instr = instructionByCode(drag.code);
      elements.push({kind:"instr",code:drag.code,args:instr?instr.operands.map(()=>""):[]});
      onChange();
    } else if (drag.kind === "move-instr") {
      const {arr:srcArr,idx:srcIdx} = drag;
      const el = srcArr.splice(srcIdx, 1)[0];
      elements.push(el); onChange();
    }
    _dragEnd();
  };
  rung.appendChild(_el("div", "rail"));
  const wire = _el("div", "rungWire");
  appendSeq(wire, elements, { datalistId, onChange }, true);

  // Wire-level click: clicking anywhere on the wire (between elements) selects an insert position
  wire.onclick = (e) => {
    if (e.target.closest(".ladderElem") || e.target.closest(".ladderBranch") || e.target.closest(".insertDot")) return;
    const topChildren = Array.from(wire.children).filter(c => !c.classList.contains("insertDot") && !c.classList.contains("wireSeg"));
    let bestIdx = elements.length;
    for (let i = 0; i < topChildren.length; i++) {
      const r = topChildren[i].getBoundingClientRect();
      if (e.clientX < (r.left + r.right) / 2) { bestIdx = i; break; }
    }
    const dots = Array.from(wire.children).filter(c => c.classList.contains("insertDot"));
    const dot = dots[bestIdx] || null;
    if (window._ldInsertPos && window._ldInsertPos.arr === elements && window._ldInsertPos.idx === bestIdx) {
      _clearInsertPos(); return;
    }
    _clearInsertPos();
    window._ldInsertPos = { arr: elements, idx: bestIdx, dot, onChange };
    if (dot) dot.classList.add("insertSelected");
    if (typeof window._onInsertPosChange === "function") window._onInsertPosChange();
  };

  // Rung wire drag: nearest-insert-position drop (fires when not over an element)
  wire.ondragover = (e) => {
    if (!window._ldDrag || window._ldDrag.kind === "rung") return;
    e.preventDefault(); e.dataTransfer.dropEffect = "copy";
    wire.classList.add("wireDragOver");
  };
  wire.ondragleave = (e) => {
    if (!wire.contains(e.relatedTarget)) wire.classList.remove("wireDragOver");
  };
  wire.ondrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    wire.classList.remove("wireDragOver");
    const drag = window._ldDrag;
    if (!drag || drag.kind === "rung") return;
    // Direct-child insertDots only (not nested inside branches) for correct index
    const dots = Array.from(wire.children).filter(c => c.classList.contains("insertDot"));
    let bestIdx = elements.length;
    if (dots.length) {
      let bestDist = Infinity;
      dots.forEach((dot, di) => {
        const r = dot.getBoundingClientRect();
        const dist = Math.abs(e.clientX - (r.left + r.width / 2));
        if (dist < bestDist) { bestDist = dist; bestIdx = di; }
      });
    }
    if (drag.kind === "new-instr") {
      const instr = instructionByCode(drag.code);
      const el = { kind:"instr", code:drag.code, args: instr ? instr.operands.map(()=>"") : [] };
      elements.splice(bestIdx, 0, el); _dragEnd(); onChange();
    } else if (drag.kind === "new-branch") {
      elements.splice(bestIdx, 0, { kind:"branch", legs:[[],[]] });
      _dragEnd(); onChange();
    } else if (drag.kind === "move-instr") {
      const { arr:srcArr, idx:srcIdx } = drag;
      const el = srcArr[srcIdx];
      if (srcArr === elements && srcIdx === bestIdx) { _dragEnd(); return; }
      srcArr.splice(srcIdx, 1);
      const adj = (srcArr === elements && srcIdx < bestIdx) ? bestIdx - 1 : bestIdx;
      elements.splice(adj, 0, el); _dragEnd(); onChange();
    }
  };
  rung.appendChild(wire);
  rung.appendChild(_el("div", "rail"));
  return rung;
}

function renderEditableList(elements, datalistId, onChange) {
  const box = _el("div", "instrList");
  if (!elements.length) box.appendChild(_el("p", "hint", "Empty — add an instruction or branch."));

  elements.forEach((el, i) => {
    if (el.kind === "branch") {
      const card = _el("div", "branchCard");
      const head = _el("div", "branchCardHead");
      head.appendChild(_el("span", "branchCardTitle", `Branch (${el.legs.length} legs — any one true)`));
      const acts = _el("span", "instrActs");
      if (i > 0) acts.appendChild(iconBtn("↑", () => { [elements[i-1], elements[i]] = [elements[i], elements[i-1]]; onChange(); }));
      if (i < elements.length - 1) acts.appendChild(iconBtn("↓", () => { [elements[i+1], elements[i]] = [elements[i], elements[i+1]]; onChange(); }));
      acts.appendChild(iconBtn("+ Leg", () => { el.legs.push([]); onChange(); }));
      acts.appendChild(iconBtn("✕ Branch", () => { elements.splice(i, 1); onChange(); }));
      head.appendChild(acts);
      card.appendChild(head);

      el.legs.forEach((leg, legIdx) => {
        const legBox = _el("div", "branchLegEditor");
        const legHead = _el("div", "branchLegHead");
        legHead.appendChild(_el("span", "", `Leg ${legIdx + 1}`));
        if (el.legs.length > 2) {
          const rm = iconBtn("✕", () => { el.legs.splice(legIdx, 1); onChange(); });
          legHead.appendChild(rm);
        }
        legBox.appendChild(legHead);
        legBox.appendChild(renderEditableList(leg, datalistId, onChange));
        const addBtn = mkBtn("+ Add to Leg", () => openStepEditor(datalistId, null, (step) => { leg.push(step); onChange(); }));
        addBtn.className = "sm";
        legBox.appendChild(addBtn);
        card.appendChild(legBox);
      });
      box.appendChild(card);
    } else {
      const chip = _el("div", "instrChip " + (instructionByCode(el.code) ? instructionByCode(el.code).kind : "output"));
      chip.appendChild(_el("span", "instrText", stepToText(el)));
      const acts = _el("span", "instrActs");
      if (i > 0) acts.appendChild(iconBtn("↑", () => { [elements[i-1], elements[i]] = [elements[i], elements[i-1]]; onChange(); }));
      if (i < elements.length - 1) acts.appendChild(iconBtn("↓", () => { [elements[i+1], elements[i]] = [elements[i], elements[i+1]]; onChange(); }));
      acts.appendChild(iconBtn("✎", () => openStepEditor(datalistId, el, (step) => { elements[i] = step; onChange(); })));
      acts.appendChild(iconBtn("✕", () => { elements.splice(i, 1); onChange(); }));
      chip.appendChild(acts);
      box.appendChild(chip);
    }
  });
  return box;
}

/* ── pretty-printed raw text (branches indented, not one long blob) ─────── */

function _prettySeqLines(arr, indent) {
  const pad = "  ".repeat(indent);
  const lines = [];
  arr.forEach(el => {
    if (el.kind === "branch") {
      lines.push(pad + "[");
      el.legs.forEach((leg, i) => {
        const legLines = _prettySeqLines(leg, indent + 1);
        if (!legLines.length) legLines.push("  ".repeat(indent + 1));
        if (i < el.legs.length - 1) legLines[legLines.length - 1] += ",";
        lines.push(...legLines);
      });
      lines.push(pad + "]");
    } else {
      lines.push(pad + stepToText(el));
    }
  });
  return lines;
}
function prettyRungText(elements) {
  if (!elements.length) return "";
  return _prettySeqLines(elements, 0).join("\n") + ";";
}

/** Modal dialog to pick an instruction + fill operands. Calls onSave(step). */
function openStepEditor(datalistId, editing, onSave) {
  const dlg = document.createElement("dialog");
  dlg.className = "instrDialog";

  const catSel = document.createElement("select");
  instructionCategories().forEach(cat => {
    const opt = document.createElement("option"); opt.value = cat; opt.textContent = cat;
    catSel.appendChild(opt);
  });

  const instrSel = document.createElement("select");
  function refreshInstrOptions() {
    instrSel.innerHTML = "";
    allInstructions().filter(ins => ins.category === catSel.value).forEach(ins => {
      const opt = document.createElement("option"); opt.value = ins.code; opt.textContent = ins.label;
      instrSel.appendChild(opt);
    });
  }
  catSel.onchange = () => { refreshInstrOptions(); refreshOperandInputs(); };

  const operandsBox = document.createElement("div");
  operandsBox.className = "operandsBox";
  function refreshOperandInputs() {
    operandsBox.innerHTML = "";
    const instr = instructionByCode(instrSel.value);
    if (!instr) return;
    instr.operands.forEach((opName, idx) => {
      const lbl = document.createElement("label");
      lbl.textContent = opName;
      const inp = document.createElement("input");
      inp.setAttribute("list", datalistId);
      if (editing && editing.code === instr.code && editing.args[idx] !== undefined) inp.value = editing.args[idx];
      lbl.appendChild(inp);
      operandsBox.appendChild(lbl);
    });
    if (instr.operands.length === 0) operandsBox.appendChild(_el("p", "hint", "This instruction has no operands."));
  }

  if (editing) { const ei = instructionByCode(editing.code); if (ei) catSel.value = ei.category; }
  refreshInstrOptions();
  if (editing) instrSel.value = editing.code;
  instrSel.onchange = refreshOperandInputs;
  refreshOperandInputs();

  dlg.innerHTML = `<h3>${editing ? "Edit" : "Add"} Instruction</h3>`;
  const catLbl = document.createElement("label"); catLbl.textContent = "Category"; catLbl.appendChild(catSel);
  const instrLbl = document.createElement("label"); instrLbl.textContent = "Instruction"; instrLbl.appendChild(instrSel);
  dlg.append(catLbl, instrLbl, operandsBox);

  const btnRow = document.createElement("div");
  btnRow.className = "dlgBtns";
  const cancelB = document.createElement("button"); cancelB.textContent = "Cancel";
  cancelB.onclick = () => { dlg.close(); dlg.remove(); };
  const saveB = document.createElement("button"); saveB.className = "primary";
  saveB.textContent = editing ? "Save" : "Add";
  saveB.onclick = () => {
    const instr = instructionByCode(instrSel.value);
    const args = Array.from(operandsBox.querySelectorAll("input")).map(inp => inp.value.trim());
    dlg.close(); dlg.remove();
    onSave({ kind: "instr", code: instr.code, args });
  };
  btnRow.append(cancelB, saveB);
  dlg.appendChild(btnRow);
  document.body.appendChild(dlg);
  dlg.showModal();
}

/**
 * Renders an interactive rung builder into `container`.
 * `initialText` seeds it (parsed into elements if possible, else raw mode).
 * `getTagNames()` supplies known tag names for the operand autocomplete list.
 * Returns { getText(): string }.
 */

/* ── Syntax highlighting helpers ─────────────────────────────────────────── */
function _hlEsc(s){return String(s).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;");}
/** Tokeniser-based RLL highlighter — safe against span self-corruption. */
function _hlRll(s) {
  if (!s) return '<span class="hl-empty">— empty —</span>';
  let r = "", i = 0, n = s.length, depth = 0;
  while (i < n) {
    const c = s[i];
    if (c === "(") { depth++; r += "("; i++; continue; }
    if (c === ")") { depth--; r += ")"; i++; continue; }
    if (c === ";" && depth === 0) { r += '<span class="hl-sc">;</span>'; i++; continue; }
    // Branch brackets (top-level only — inside paren depth==0)
    if ((c === "[" || c === "]") && depth === 0) {
      r += `<span class="hl-br">${c}</span>`; i++; continue;
    }
    // Instruction mnemonic: uppercase word before '('
    if (depth === 0 && /[A-Z]/.test(c)) {
      let j = i; while (j < n && /[A-Z0-9_]/.test(s[j])) j++;
      if (s[j] === "(") { r += `<span class="hl-i">${s.slice(i,j)}</span>`; i = j; continue; }
    }
    // Tag operand inside parens — word chars + dot + subscript
    if (depth > 0 && /[A-Za-z_]/.test(c)) {
      let j = i; while (j < n && /[A-Za-z0-9_.\[\]]/.test(s[j])) j++;
      r += `<span class="hl-tag">${_hlEsc(s.slice(i,j))}</span>`; i = j; continue;
    }
    // Numeric literal
    if (/\d/.test(c) || (c === "-" && depth > 0 && /\d/.test(s[i+1]||""))) {
      let j = i; if (c==="-") j++;
      while (j < n && /[\d.eE+\-]/.test(s[j])) j++;
      r += `<span class="hl-num">${_hlEsc(s.slice(i,j))}</span>`; i = j; continue;
    }
    // Comma (branch separator at top level is part of [...,...]
    if (c === "," && depth === 0) { r += '<span class="hl-op">,</span>'; i++; continue; }
    r += _hlEsc(c); i++;
  }
  return r;
}

/** Tokeniser-based ST highlighter — safe against span self-corruption. */
const _HL_KW   = new Set("IF THEN ELSE ELSIF END_IF WHILE DO END_WHILE FOR TO BY END_FOR CASE OF END_CASE REPEAT UNTIL END_REPEAT RETURN EXIT".split(" "));
const _HL_LOP  = new Set("AND OR NOT XOR MOD".split(" "));
const _HL_BOOL = new Set(["TRUE","FALSE"]);
function _hlSt(s) {
  if (!s) return '<span class="hl-empty">— empty —</span>';
  let r = "", i = 0, n = s.length;
  while (i < n) {
    const c = s[i];
    // Line comment
    if (c === "/" && s[i+1] === "/") {
      let j = i; while (j < n && s[j] !== "\n") j++;
      r += `<span class="hl-cm">${_hlEsc(s.slice(i,j))}</span>`; i = j; continue;
    }
    // Block comment
    if (c === "/" && s[i+1] === "*") {
      let j = s.indexOf("*/", i+2); j = j < 0 ? n : j+2;
      r += `<span class="hl-cm">${_hlEsc(s.slice(i,j))}</span>`; i = j; continue;
    }
    // String literal
    if (c === "'") {
      let j = i+1; while (j < n && s[j] !== "'") j++;
      r += `<span class="hl-str">${_hlEsc(s.slice(i,j+1))}</span>`; i = j+1; continue;
    }
    // :=  assignment
    if (c === ":" && s[i+1] === "=") { r += '<span class="hl-op">:=</span>'; i += 2; continue; }
    // <> <=  >= < >  operators
    if (c === "<" || c === ">") {
      let op = c, adv = 1;
      if (c === "<" && s[i+1] === ">") { op = "<>"; adv = 2; }
      else if (s[i+1] === "=") { op = c+"="; adv = 2; }
      r += `<span class="hl-op">${_hlEsc(op)}</span>`; i += adv; continue;
    }
    // Arithmetic + - * /  (skip - when part of number handled below)
    if (["+","*","/"].includes(c)) { r += `<span class="hl-op">${c}</span>`; i++; continue; }
    if (c === "-" && !/\d/.test(s[i+1]||"")) { r += `<span class="hl-op">-</span>`; i++; continue; }
    // Semicolon
    if (c === ";") { r += '<span class="hl-sc">;</span>'; i++; continue; }
    // Number (including leading -)
    if (/\d/.test(c) || (c === "-" && /\d/.test(s[i+1]||""))) {
      let j = i; if (c==="-") j++;
      while (j < n && /[\d.eE+\-]/.test(s[j])) j++;
      r += `<span class="hl-num">${_hlEsc(s.slice(i,j))}</span>`; i = j; continue;
    }
    // Word — keyword / logical op / bool / instruction / identifier
    if (/[A-Za-z_]/.test(c)) {
      let j = i; while (j < n && /\w/.test(s[j])) j++;
      const word = s.slice(i,j), up = word.toUpperCase();
      let k = j; while (k < n && s[k] === " ") k++;
      if (_HL_KW.has(up))         r += `<span class="hl-kw">${_hlEsc(word)}</span>`;
      else if (_HL_LOP.has(up))   r += `<span class="hl-lop">${_hlEsc(word)}</span>`;
      else if (_HL_BOOL.has(up))  r += `<span class="hl-bool">${_hlEsc(word)}</span>`;
      else if (s[k]==="(" && up===word) r += `<span class="hl-i">${_hlEsc(word)}</span>`;  // uppercase fn call
      else                        r += _hlEsc(word);
      i = j; continue;
    }
    r += _hlEsc(c); i++;
  }
  return r;
}
/** mkSyntaxEditor — a thin code-view/edit widget.
 *  Shows highlighted HTML by default; click to switch to textarea for editing.
 *  `lang` = "rll" | "st". Returns {getValue, setValue}. */
function mkSyntaxEditor(container, initialText, lang, onInput) {
  const wrap = document.createElement("div"); wrap.className = "syntaxEditorWrap";
  const pre  = document.createElement("pre");  pre.className  = "syntaxPre"; pre.title = "Click to edit";
  const ta   = document.createElement("textarea"); ta.className = "syntaxTa rawRungText";
  ta.value = initialText; ta.spellcheck = false;
  function hl() {
    const src = ta.value || "";
    pre.innerHTML = (lang === "st" ? _hlSt(src) : _hlRll(src)) || '<span class="hl-empty">— empty —</span>';
  }
  function showPre() { ta.style.display = "none"; pre.style.display = ""; }
  function showTa()  {
    pre.style.display = "none"; ta.style.display = "";
    ta.rows = Math.max(5, ta.value.split("\n").length + 2); ta.focus();
  }
  pre.onclick = showTa;
  ta.onblur   = () => { hl(); showPre(); };
  ta.oninput  = () => { if (onInput) onInput(ta.value); };
  hl(); showPre();
  wrap.append(pre, ta);
  container.appendChild(wrap);
  return {
    getValue: () => ta.value,
    setValue: (v) => { ta.value = v; hl(); showPre(); },
  };
}

function createRungBuilder(container, initialText, getTagNames, opts) {
  opts = opts || {};
  const parsed = parseRungTextToSteps(initialText);
  const wantMode = opts.mode === "raw" ? "raw" : (opts.mode === "visual" ? "visual" : null);
  const state = {
    mode: wantMode || (parsed === null ? "raw" : "visual"),
    elements: parsed || [],
    rawText: parsed === null ? (initialText || "") : prettyRungText(parsed),
    showList: false,  // element list hidden; no longer surfaced as a toggle
  };
  if (state.mode === "visual" && parsed === null) state.mode = "raw"; // can't force visual on unparseable text

  const wrap = document.createElement("div");
  wrap.className = "builderWrap";
  container.appendChild(wrap);

  const datalistId = "tagNamesList_" + Math.random().toString(36).slice(2);
  const datalist = document.createElement("datalist");
  datalist.id = datalistId;
  (getTagNames() || []).forEach(n => { const opt = document.createElement("option"); opt.value = n; datalist.appendChild(opt); });
  wrap.appendChild(datalist);

  function render() {
    wrap.querySelectorAll(":scope > *:not(datalist)").forEach(n => n.remove());

    if (!opts.hideTabs) {
      const tabs = document.createElement("div");
      tabs.className = "modeTabs";
      const visualBtn = mkBtn("Visual Builder", () => {
        if (state.mode !== "visual") {
          const reparsed = parseRungTextToSteps(state.rawText);
          if (reparsed === null) {
            if (!confirm("This rung uses syntax the visual builder can't represent yet. Switching will let you rebuild it from scratch. Continue?")) return;
            state.elements = [];
          } else state.elements = reparsed;
        }
        state.mode = "visual"; render();
      });
      visualBtn.className = state.mode === "visual" ? "primary" : "";
      const rawBtn = mkBtn("Raw Text", () => {
        if (state.mode === "visual") state.rawText = prettyRungText(state.elements);
        state.mode = "raw"; render();
      });
      rawBtn.className = state.mode === "raw" ? "primary" : "";
      tabs.append(visualBtn, rawBtn);
      wrap.appendChild(tabs);
        } else if (state.mode === "raw" && parsed === null && !opts.hideTabs) {
      wrap.appendChild(_el("p", "hint", "\u26a0 This rung uses syntax the visual builder can't represent \u2014 showing raw text (still fully editable)."));
    }

    if (state.mode === "raw") {
      const _syntaxEd = mkSyntaxEditor(wrap, state.rawText, "rll", (v) => { state.rawText = v; });
      return;
    }

    wrap.appendChild(buildLadderEditor(state.elements, datalistId, render));
    // Element list toggle is available as a debug aid but hidden by default;
    // the visual diagram already provides click-to-edit and ✕ delete on every element.
    if (state.showList) wrap.appendChild(renderEditableList(state.elements, datalistId, render));
  }

  render();
  return {
    getText() {
      if (state.mode === "visual") return stepsToRungText(state.elements);
      const reparsed = parseRungTextToSteps(state.rawText);
      if (reparsed !== null) return stepsToRungText(reparsed);
      const t = state.rawText.trim();
      return t.endsWith(";") ? t : t + ";";
    },
    getMode() { return state.mode; },
    /** Directly switch to "visual" or "raw" — used by the global routine toggle. */
    setMode(m) {
      if (m === state.mode) return;
      if (m === "raw") {
        state.rawText = prettyRungText(state.elements);
        state.mode = "raw";
      } else {
        const rep = parseRungTextToSteps(state.rawText);
        if (rep === null) return; // unparseable — stay in raw, caller should handle
        state.elements = rep;
        state.mode = "visual";
      }
      render();
    },
    /** Append an element to the end of this rung (toolbar quick-insert).
     *  Returns true if successful (visual mode), false if raw mode. */
    addElement(el) {
      if (state.mode !== "visual") return false;
      state.elements.push(el);
      state.rawText = prettyRungText(state.elements);
      render();
      return true;
    },
  };
}
