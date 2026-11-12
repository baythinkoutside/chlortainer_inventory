// QuickBooks packing-slip reader. Pure functions: feed it positioned text items, get slip lines back.
// Items: [{str, x, y, page}] (PDF coordinates; y grows upward). Nothing here touches the DOM or Supabase.

const ROW_TOL = 2.5;

function clusterRows(items) {
  const sorted = [...items].filter(i => i.str && i.str.trim()).sort((a, b) => a.page - b.page || b.y - a.y || a.x - b.x);
  const rows = [];
  for (const it of sorted) {
    const last = rows[rows.length - 1];
    if (last && last.page === it.page && Math.abs(last.y - it.y) <= ROW_TOL) last.items.push(it);
    else rows.push({ page: it.page, y: it.y, items: [it] });
  }
  rows.forEach(r => r.items.sort((a, b) => a.x - b.x));
  return rows;
}
const rowText = (r, pred = () => true) => r.items.filter(pred).map(i => i.str.trim()).join(" ").replace(/\s+/g, " ").trim();

export function parseSlip(items) {
  const rows = clusterRows(items);
  if (rows.length === 0) return { error: "No text found in this PDF (it may be a scanned image)." };

  const title = rowText(rows[0]);
  const hdrIdx = rows.findIndex(r => r.items.some(i => i.str.trim() === "Ordered") && r.items.some(i => /^Description/i.test(i.str.trim())));
  if (hdrIdx < 0) return { error: "Could not find the Description / Ordered columns. Is this a QuickBooks packing slip?" };
  const hdr = rows[hdrIdx];
  const ordered = hdr.items.find(i => i.str.trim() === "Ordered");
  const shipped = hdr.items.find(i => i.str.trim() === "Shipped");
  const qtyMin = ordered.x - 30;
  const qtyMax = shipped ? shipped.x - 4 : ordered.x + 70;

  // Quote number / dates (row under the "Quote Number" header)
  let quote = "", slipDate = "", po = "";
  const qIdx = rows.findIndex(r => r.items.some(i => /Quote Number/i.test(i.str)));
  if (qIdx >= 0 && rows[qIdx + 1]) {
    const joined = rowText(rows[qIdx + 1]);
    quote = (joined.match(/^\S+/) || [""])[0];
    const dates = (joined.replace(/\s*\/\s*/g, "/").match(/\d{1,2}\/\d{1,2}\/\d{4}/g)) || [];
    slipDate = dates[0] || "";
    po = (joined.match(/(\d{3,}-\d{2,})\s*$/) || [, ""])[1];
  }

  const lines = []; const qtys = [];
  for (let k = hdrIdx + 1; k < rows.length; k++) {
    const r = rows[k];
    if (/Shipping Discrepancies/i.test(rowText(r))) break;
    const desc = rowText(r, i => i.x < qtyMin);
    r.items.filter(i => i.x >= qtyMin && i.x <= qtyMax && /^\d+(\.\d+)?$/.test(i.str.trim()))
      .forEach(i => qtys.push({ y: r.y, page: r.page, val: parseFloat(i.str) }));
    const m = desc.match(/^(\d{4}[A-Z]?)(?:\s*[-–]\s*|\s+)(.*)$/);
    if (m) lines.push({ no: m[1], desc: m[2].trim(), y: r.y, page: r.page, qty: null, row: lines.length + 1 });
    else if (desc && lines.length) lines[lines.length - 1].desc += " " + desc;   // wrapped description
  }
  // Attach each quantity to the nearest line that still has none (same-row matches win first)
  const pairs = [];
  qtys.forEach((q, qi) => lines.forEach((l, li) => { if (l.page === q.page) pairs.push({ d: Math.abs(q.y - l.y), qi, li }); }));
  pairs.sort((a, b) => a.d - b.d);
  const usedQ = new Set(), usedL = new Set();
  for (const p of pairs) {
    if (usedQ.has(p.qi) || usedL.has(p.li)) continue;
    if (p.d > 30) continue;                       // too far away to trust
    lines[p.li].qty = qtys[p.qi].val; usedQ.add(p.qi); usedL.add(p.li);
  }
  return { title, quote, slipDate, po, lines: lines.map(({ y, page, ...l }) => l) };
}

// Which list does the slip title name? ("Ton Main Parts" -> "Main Parts")
export function guessListType(title, listNames) {
  const t = (title || "").toLowerCase();
  return listNames.find(n => t.includes(n.toLowerCase())) ||
         listNames.find(n => t.includes(n.toLowerCase().split(" ")[0])) || "";
}

const words = s => new Set((s || "").toLowerCase().replace(/[^a-z0-9"/. ]+/g, " ").split(/\s+/).filter(w => w.length > 2));
export function similarity(a, b) {
  const A = words(a), B = words(b);
  if (!A.size || !B.size) return 0;
  let n = 0; A.forEach(w => { if (B.has(w)) n++; });
  return n / Math.min(A.size, B.size);
}

// Match one printed number + description to parts. Slips may print the old OR the new number.
export function matchPart(parts, no, desc) {
  const n = String(no).toUpperCase();
  const hits = parts.filter(p =>
    String(p.new_part_no || "").toUpperCase() === n || String(p.legacy_part_no || "").toUpperCase() === n);
  const scored = hits.map(p => ({ part: p, score: similarity(desc, p.description), via: String(p.new_part_no || "").toUpperCase() === n ? "new" : "old" }))
    .sort((a, b) => b.score - a.score);
  const flags = [];
  let pick = null;
  if (scored.length === 1) {
    pick = scored[0].part;
    if (scored[0].score < 0.34) flags.push("Description differs from this part. Check it.");
  } else if (scored.length > 1) {
    flags.push("This number belongs to more than one part. Check the match.");
    if (scored[0].score >= 0.5 && scored[0].score - scored[1].score >= 0.2) pick = scored[0].part;
  } else {
    // number not found: suggest by description
    const guess = parts.map(p => ({ part: p, score: similarity(desc, p.description), via: "desc" }))
      .filter(x => x.score >= 0.6).sort((a, b) => b.score - a.score).slice(0, 4);
    scored.push(...guess);
    flags.push("Part number not found. Pick the part or skip the line.");
  }
  return { candidates: scored, pick, flags };
}
