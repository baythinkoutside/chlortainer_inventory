// ChlorTainer Inventory System — Bin Labels tab
// Prints part bin labels (photo, part ID, description, UOM/Min, QR + Code 128),
// and small item (SKU) labels that go on the parts themselves (part ID + Code 128).
import { useState, useMemo } from "react";

// Label stock presets. Sizes in inches.
export const LABEL_SIZES = {
  "3x2": {
    name: '3" × 2" thermal roll — full label (recommended)',
    w: 3, h: 2, mode: "roll", full: true,
  },
  "2x1": {
    name: '2" × 1" thermal roll — compact (no photo / QR)',
    w: 2, h: 1, mode: "roll", full: false,
  },
  "avery5163": {
    name: 'Letter sheet, 4" × 2", 10 per sheet — Avery 5163 / 5523 (laser)',
    w: 4, h: 2, mode: "sheet", full: true,
    // Avery 5163 geometry
    perPage: 10, cols: 2, top: 0.5, left: 0.15625, colGap: 0.1875,
  },
  // ── Item (SKU) labels: stuck on the part or its bag ──
  "item1x05": {
    name: '1" × 0.5" thermal roll — part #, description, barcode (TGO item label)',
    w: 1, h: 0.5, mode: "roll", kind: "item", tiny: true, mini: true, desc: true,
  },
  "item2x1": {
    name: '2" × 1" thermal roll — part #, barcode, short description',
    w: 2, h: 1, mode: "roll", kind: "item", desc: true,
  },
  "item125": {
    name: '1.25" × 0.75" thermal roll — part # and barcode (small parts)',
    w: 1.25, h: 0.75, mode: "roll", kind: "item", tiny: true,
  },
  "avery5167": {
    name: 'Letter sheet, 1.75" × 0.5", 80 per sheet — Avery 5167 (laser)',
    w: 1.75, h: 0.5, mode: "sheet", kind: "item", tiny: true,
    perPage: 80, cols: 4, top: 0.5, left: 0.28125, colGap: 0.3125,
  },
};
const kindOf = (size) => size.kind || "bin";

const PREF_KEY = "chlortainer_binlabel_prefs_v2";
function loadPrefs() {
  try { return JSON.parse(localStorage.getItem(PREF_KEY)) || {}; } catch { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem(PREF_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

const esc = (s) => String(s ?? "")
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  .replace(/"/g, "&quot;").replace(/'/g, "&#39;");

function labelHtml(p, size, opts) {
  const id = esc(p.id);
  const desc = esc(p.description);
  if (size.kind === "item") {
    return `<div class="lbl item${size.tiny ? " tiny" : ""}${size.mini ? " mini" : ""}">
      <div class="row"><span class="pid">${id}</span>${size.tiny ? "" : `<span class="uom">${esc(p.uom || "EA")}</span>`}</div>
      ${size.desc ? `<div class="desc1">${desc}</div>` : ""}
      <svg class="c128 nb" data-code="${id}"></svg>
    </div>`;
  }
  const meta = [`UOM: ${esc(p.uom || "EA")}`];
  if (opts.showMin && +p.minStock > 0) meta.push(`Min: ${+p.minStock}`);
  if (p.legacy_part_no) meta.push(`Old #${esc(p.legacy_part_no)}`);
  if (opts.showLoc && p.location) meta.push(`<b class="loc">Bin ${esc(p.location)}</b>`);

  if (!size.full) {
    return `<div class="lbl compact">
      <div class="row"><span class="pid">${id}</span><span class="meta">${meta.join(" · ")}</span></div>
      <div class="desc1">${desc}</div>
      <svg class="c128" data-code="${id}"></svg>
    </div>`;
  }
  const photo = opts.showPhoto && p.image_url
    ? `<div class="photo"><img src="${esc(p.image_url)}" alt=""/></div>` : "";
  return `<div class="lbl full">
    <div class="top">
      ${photo}
      <div class="txt">
        <div class="pid">${id}</div>
        <div class="desc">${desc}</div>
        <div class="meta">${meta.join(" &nbsp;·&nbsp; ")}</div>
      </div>
    </div>
    <div class="bot">
      <div class="qr" data-code="${id}"></div>
      <svg class="c128" data-code="${id}"></svg>
    </div>
  </div>`;
}

function buildDoc(list, size, opts, autoPrint) {
  const W = size.w, H = size.h;
  // Scale typography with label width (3" label = 1.0)
  const k = size.full ? W / 3 : 1;
  const f = Math.min(k, 1.1); // font scale, capped so 4" labels don't overflow
  const labels = list.map((p) => labelHtml(p, size, opts));

  let body, pageCss;
  if (size.mode === "sheet") {
    const skip = Math.max(0, Math.min(size.perPage - 1, +opts.skip || 0));
    const cells = [...Array(skip).fill(null), ...labels];
    const pages = [];
    for (let i = 0; i < cells.length; i += size.perPage) pages.push(cells.slice(i, i + size.perPage));
    // Each label is placed at a fixed position on its sheet (not flowed in a grid),
    // so phones, tablets and desktops all paginate the same way: perPage labels per sheet.
    body = pages.map((pg) => `<div class="sheet">${pg.map((c, j) => c === null ? "" :
      `<div class="cell" style="left:${(size.left + (j % size.cols) * (W + size.colGap)).toFixed(4)}in;top:${(size.top + Math.floor(j / size.cols) * H).toFixed(4)}in">${c}</div>`).join("")}</div>`).join("");
    pageCss = `@page{size:letter;margin:0}
      html,body{width:8.5in}
      .sheet{position:relative;width:8.5in;height:10.99in;overflow:hidden;page-break-after:always;break-after:page}
      .sheet:last-child{page-break-after:auto;break-after:auto}
      .cell{position:absolute}
      @media screen{.sheet{outline:1px dashed #bbb;margin:0 auto 16px;background:#fff}}`;
  } else {
    body = labels.map((l) => `<div class="pg">${l}</div>`).join("");
    pageCss = `@page{size:${W}in ${H}in;margin:0}
      .pg{width:${W}in;height:${H}in;page-break-after:always;break-after:page;overflow:hidden}
      .pg:last-child{page-break-after:auto;break-after:auto}
      @media screen{.pg{outline:1px dashed #bbb;margin:0 auto 12px;background:#fff}}`;
  }

  return `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=816"><title>${kindOf(size) === "item" ? "Item" : "Bin"} Labels (${list.length})</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{font-family:Arial,Helvetica,sans-serif;color:#000;-webkit-print-color-adjust:exact;print-color-adjust:exact}
@media screen{body{background:#eee;padding:16px}}
${pageCss}
.lbl{width:${W}in;height:${H}in;overflow:hidden;display:flex;flex-direction:column}
.lbl.empty{visibility:hidden}
.full{padding:${0.09 * k}in ${0.1 * k}in}
.full .top{display:flex;gap:${0.08 * k}in;height:52%;min-height:0}
.full .photo{flex:0 0 ${0.95 * k}in;height:100%;display:flex;align-items:center;justify-content:center;border:1px solid #000;border-radius:${0.04 * k}in;overflow:hidden}
.full .photo img{max-width:100%;max-height:100%;object-fit:contain;${size.mode === "roll" ? "filter:grayscale(1) contrast(1.15)" : ""}}
.full .txt{flex:1;min-width:0;min-height:0;overflow:hidden;display:flex;flex-direction:column;gap:${0.03 * k}in}
.full .pid{font-family:"Courier New",monospace;font-weight:900;font-size:${14 * f}pt;letter-spacing:.3px;line-height:1}
.full .desc{flex:0 1 auto;min-height:0;font-weight:700;font-size:${9 * f}pt;line-height:1.15;display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.full .meta{flex-shrink:0;font-size:${7.5 * f}pt;margin-top:auto}
.full .loc{color:#C8102E;font-size:${9.5 * f}pt}
.full .bot{flex:1;display:flex;align-items:center;gap:${0.08 * k}in;min-height:0;padding-top:${0.05 * k}in;border-top:1.5px solid #000;margin-top:${0.05 * k}in}
.full .qr{flex:0 0 auto;height:100%;aspect-ratio:1}
.full .qr svg{width:100%;height:100%;display:block}
.full .c128{flex:1;height:100%;min-width:0;display:block}
.compact{padding:.05in .08in;gap:.02in}
.compact .row{display:flex;justify-content:space-between;align-items:baseline;gap:.05in}
.compact .pid{font-family:"Courier New",monospace;font-weight:900;font-size:10pt;line-height:1}
.compact .meta{font-size:6pt;white-space:nowrap}
.compact .desc1{font-size:6.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}
.compact .c128{flex:1;width:100%;min-height:0;display:block}
.item{padding:.04in .07in;gap:.015in}
.item .row{display:flex;justify-content:space-between;align-items:baseline;gap:.04in}
.item .pid{font-family:"Courier New",monospace;font-weight:900;font-size:10pt;line-height:1}
.item .uom{font-size:6pt}
.item .desc1{font-size:6.5pt;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;line-height:1.1}
.item .c128{flex:1;width:100%;min-height:0;display:block}
.item.tiny{padding:.03in .05in;gap:.01in}
.item.tiny .pid{font-size:7.5pt;text-align:center;width:100%}
.item.tiny .row{justify-content:center}
.item.mini{padding:.02in .03in .015in;gap:0}
.item.mini .pid{font-size:6.5pt;letter-spacing:0}
.item.mini .desc1{font-size:5pt;font-weight:700;text-align:center;line-height:1.15;margin-bottom:.01in}
</style></head><body>
${body}
<script>
${autoPrint ? 'window.addEventListener("load",function(){setTimeout(function(){window.print();},300);});' : ""}
<\/script>
</body></html>`;
}

// Item labels get a blank margin each side so scanners find the start and end.
// Barcodes and QR codes are drawn here with the bundled libraries and written into the page
// as SVG, so label printing works offline and never waits on a CDN.
async function drawCodes(html) {
  let JsBarcode = null, qrcode = null;
  try { JsBarcode = (await import("jsbarcode")).default; } catch { /* drawn as text below */ }
  try { qrcode = (await import("qrcode-generator")).default; } catch { /* QR left blank */ }
  const unesc = (t) => t.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&");
  const bar = new Map();
  html = html.replace(/<svg class="c128( nb)?" data-code="([^"]*)"><\/svg>/g, (m, nb, code) => {
    const key = (nb ? "n|" : "t|") + code;
    if (!bar.has(key)) {
      if (!JsBarcode) { bar.set(key, `<div class="c128" style="font:700 9pt monospace">${code}</div>`); }
      else {
        try {
          const el = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          JsBarcode(el, unesc(code), { format: "CODE128", width: 2, height: 60, displayValue: !nb, fontSize: 13, textMargin: 1, margin: nb ? 8 : 0, lineColor: "#000" });
          const w = el.getAttribute("width"), h = el.getAttribute("height");
          if (w && h) el.setAttribute("viewBox", `0 0 ${parseFloat(w)} ${parseFloat(h)}`);
          el.removeAttribute("width"); el.removeAttribute("height");
          el.setAttribute("preserveAspectRatio", "none");
          el.setAttribute("class", "c128" + (nb ? " nb" : ""));
          bar.set(key, el.outerHTML);
        } catch { bar.set(key, '<div style="color:red;font-size:8pt">Barcode error</div>'); }
      }
    }
    return bar.get(key);
  });
  html = html.replace(/<div class="qr" data-code="([^"]*)"><\/div>/g, (m, code) => {
    if (!qrcode) return '<div class="qr"></div>';
    try {
      const q = qrcode(0, "M"); q.addData(unesc(code)); q.make();
      const n = q.getModuleCount(); let d = "";
      for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (q.isDark(r, c)) d += `M${c} ${r}h1v1h-1z`;
      return `<div class="qr"><svg viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges"><path d="${d}" fill="#000"/></svg></div>`;
    } catch { return '<div class="qr"></div>'; }
  });
  return html;
}

export async function printBinLabels(list, sizeKey, opts, autoPrint = true) {
  const size = LABEL_SIZES[sizeKey] || LABEL_SIZES["3x2"];
  const w = window.open("", "_blank");            // open inside the click so pop-up blockers allow it
  if (!w) { alert("Allow pop-ups to print labels."); return; }
  w.document.write("<p style='font:14px Arial;padding:24px'>Preparing labels…</p>");
  const html = await drawCodes(buildDoc(list, size, opts, autoPrint));
  w.document.open();
  w.document.write(html);
  w.document.close();
}

export default function BinLabelsTab({ parts, ui }) {
  const { C, Btn, Input, Sel, SectionTitle } = ui;
  const prefs = useMemo(loadPrefs, []);
  const [kind, setKind] = useState(prefs.kind === "item" ? "item" : "bin");
  const [binKey, setBinKey] = useState(prefs.sizeKey && LABEL_SIZES[prefs.sizeKey] && kindOf(LABEL_SIZES[prefs.sizeKey]) === "bin" ? prefs.sizeKey : "avery5163");
  const [itemKey, setItemKey] = useState(prefs.itemKey && LABEL_SIZES[prefs.itemKey] ? prefs.itemKey : "item1x05");
  const sizeKey = kind === "item" ? itemKey : binKey;
  const setSizeKey = kind === "item" ? setItemKey : setBinKey;
  const [perUnit, setPerUnit] = useState(false);   // item labels: one per unit on hand
  const [showPhoto, setShowPhoto] = useState(prefs.showPhoto ?? true);
  const [showMin, setShowMin] = useState(prefs.showMin ?? true);
  const [showLoc, setShowLoc] = useState(prefs.showLoc ?? true);
  const [copies, setCopies] = useState(1);
  const [skip, setSkip] = useState(0);
  const [q, setQ] = useState("");
  const [cat, setCat] = useState("");
  const [sel, setSel] = useState(() => new Set());

  const size = LABEL_SIZES[sizeKey];
  const sorted = useMemo(() => [...parts].sort((a, b) => a.id.localeCompare(b.id, undefined, { numeric: true })), [parts]);
  const cats = useMemo(() => [...new Set(parts.map((p) => p.category).filter(Boolean))].sort(), [parts]);
  const shown = sorted.filter((p) =>
    (!cat || p.category === cat) &&
    (!q || `${p.id} ${p.new_part_no || ""} ${p.legacy_part_no || ""} ${p.description}`.toLowerCase().includes(q.toLowerCase())));

  const toggle = (id) => setSel((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const selectShown = () => setSel((s) => { const n = new Set(s); shown.forEach((p) => n.add(p.id)); return n; });
  const clearAll = () => setSel(new Set());

  const chosen = sorted.filter((p) => sel.has(p.id));
  const n = Math.max(1, Math.min(500, +copies || 1));
  const each = (p) => (kind === "item" && perUnit ? Math.max(0, Math.min(500, Math.round(+p.stock || 0))) : n);
  const list = chosen.flatMap((p) => Array(each(p)).fill(p));
  const noPhoto = chosen.filter((p) => !p.image_url).length;
  const sheets = size.mode === "sheet" ? Math.ceil((list.length + (+skip || 0)) / size.perPage) : 0;

  const go = (auto) => {
    savePrefs({ kind, sizeKey: binKey, itemKey, showPhoto, showMin, showLoc });
    printBinLabels(list, sizeKey, { showPhoto, showMin, showLoc, skip }, auto);
  };

  const chk = { display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: C.textDark, cursor: "pointer" };

  return (
    <div>
      <SectionTitle>Print Labels</SectionTitle>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        {[["bin", "🗄️ Bin labels", "For shelves and bins"], ["item", "🏷️ Item labels", "Small SKU labels for the parts themselves"]].map(([k, l, d]) =>
          <button key={k} onClick={() => setKind(k)} style={{ flex: 1, textAlign: "left", padding: "10px 14px", borderRadius: 8, cursor: "pointer", minHeight: 52,
            border: `2px solid ${kind === k ? C.navy : C.border}`, background: kind === k ? "#EEF3F8" : C.white }}>
            <div style={{ fontWeight: 800, color: C.navy, fontSize: 14 }}>{l}</div><div style={{ fontSize: 12, color: C.textMid }}>{d}</div>
          </button>)}
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, padding: 16, marginBottom: 16, display: "grid", gap: 12 }}>
        <Sel label="Label stock" value={sizeKey} onChange={(e) => setSizeKey(e.target.value)}>
          {Object.entries(LABEL_SIZES).filter(([, v]) => kindOf(v) === kind).map(([k, v]) => <option key={k} value={k}>{v.name}</option>)}
        </Sel>
        <div style={{ display: "flex", gap: 18, flexWrap: "wrap", alignItems: "flex-end" }}>
          {size.full && <label style={chk}><input type="checkbox" checked={showPhoto} onChange={(e) => setShowPhoto(e.target.checked)} /> Include photo</label>}
          {kind === "bin" && <label style={chk}><input type="checkbox" checked={showMin} onChange={(e) => setShowMin(e.target.checked)} /> Show Min qty</label>}
          {kind === "item" && <label style={chk}><input type="checkbox" checked={perUnit} onChange={(e) => setPerUnit(e.target.checked)} /> One per unit on hand</label>}
          {size.full && <label style={chk}><input type="checkbox" checked={showLoc} onChange={(e) => setShowLoc(e.target.checked)} /> Show bin location</label>}
          {!(kind === "item" && perUnit) && <div style={{ width: 110 }}><Input label="Copies each" type="number" min="1" max={kind === "item" ? 500 : 50} value={copies} onChange={(e) => setCopies(e.target.value)} /></div>}
          {size.mode === "sheet" && <div style={{ width: 150 }}><Input label="Skip used labels" type="number" min="0" max={size.perPage - 1} value={skip} onChange={(e) => setSkip(e.target.value)} /></div>}
        </div>
        <div style={{ fontSize: 12, color: C.textMid }}>
          {size.mode === "roll"
            ? <>Print with the label printer selected, paper size <b>{size.w}" × {size.h}"</b>, scale <b>100%</b> / "Actual size", margins <b>None</b>, headers &amp; footers <b>off</b>.</>
            : <>Print on <b>Letter</b>, scale <b>100%</b> / "Actual size", margins <b>None</b>, headers &amp; footers <b>off</b>. {sheets > 0 && <>Needs <b>{sheets}</b> sheet{sheets > 1 ? "s" : ""}.</>}</>}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <Btn variant="navy" disabled={!list.length} onClick={() => go(true)}>🖨️ Print {list.length || ""} Label{list.length === 1 ? "" : "s"}</Btn>
          <Btn variant="outline" disabled={!list.length} onClick={() => go(false)}>👁 Preview</Btn>
          {size.full && showPhoto && noPhoto > 0 && <span style={{ fontSize: 12, color: C.warnText }}>⚠ {noPhoto} selected part{noPhoto > 1 ? "s have" : " has"} no photo</span>}
        </div>
      </div>

      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, alignItems: "flex-end" }}>
        <div style={{ flex: "1 1 220px" }}><Input placeholder="Search part # or description…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: "100%" }} /></div>
        {cats.length > 0 && <Sel value={cat} onChange={(e) => setCat(e.target.value)}>
          <option value="">All categories</option>
          {cats.map((c) => <option key={c} value={c}>{c}</option>)}
        </Sel>}
        <Btn variant="outline" style={{ padding: "8px 12px", fontSize: 12 }} onClick={selectShown}>Select all shown ({shown.length})</Btn>
        <Btn variant="ghost" style={{ padding: "8px 12px", fontSize: 12 }} onClick={clearAll} disabled={!sel.size}>Clear ({sel.size})</Btn>
      </div>

      <div style={{ background: C.white, border: `1px solid ${C.border}`, borderRadius: 8, maxHeight: 520, overflowY: "auto" }}>
        {shown.map((p) => (
          <label key={p.id} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 12px", borderBottom: `1px solid ${C.border}`, cursor: "pointer", background: sel.has(p.id) ? C.amberLight : C.white }}>
            <input type="checkbox" checked={sel.has(p.id)} onChange={() => toggle(p.id)} />
            {p.image_url
              ? <img src={p.image_url} alt="" style={{ width: 36, height: 36, objectFit: "cover", borderRadius: 4, border: `1px solid ${C.border}` }} />
              : <div style={{ width: 36, height: 36, borderRadius: 4, background: C.offWhite, border: `1px dashed ${C.border}` }} />}
            <span style={{ fontFamily: "monospace", fontWeight: 700, color: C.amber, fontSize: 12, minWidth: 104 }}>{p.id}</span>
            <span style={{ fontSize: 13, color: C.textDark, flex: 1 }}>{p.description}</span>
            <span style={{ fontSize: 11, color: C.textLight }}>{kind === "item" ? `${p.stock ?? 0} ${p.uom || "EA"} on hand` : `${p.uom}${+p.minStock > 0 ? ` · Min ${p.minStock}` : ""}`}</span>
          </label>
        ))}
        {!shown.length && <div style={{ padding: 32, textAlign: "center", color: C.textLight }}>No parts match.</div>}
      </div>
    </div>
  );
}
