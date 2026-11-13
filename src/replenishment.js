// ChlorTainer replenishment forecasting engine.
// Pure functions: no React, no Supabase. Feed it rows, get recommendations back.
//
// Two purposes share one stock pool:
//   1. Manufacturing fulfillment: vessel order lines x control lists (Main/Loose/Spare).
//      Every list type is needed at the planned paint-start date minus pick/box/stage time,
//      because staged parts ship when vessels pass hydro and move to paint.
//   2. Customer maintenance POs: direct part lines and kits (confirmed POs only).
//
// Firmness: lists in PO Signed / Lists Draft are TENTATIVE; Lists Final onward are FIRM.
// Allocation: Released / Staged lines reserve stock (picked parts stay on the shelf until
// shipped but are no longer available). Optional unplanned usage is read from
// part_procurement.manual_monthly_usage (default 0) and history if supplied.
//
// Dates are ISO strings (YYYY-MM-DD); all day math is done in UTC.

const DAY = 86400000;
export const toDate = (s) => (s ? new Date(s + "T00:00:00Z") : null);
export const iso = (d) => d.toISOString().slice(0, 10);
export const addDays = (s, n) => iso(new Date(toDate(s).getTime() + n * DAY));
export const diffDays = (a, b) => Math.round((toDate(a) - toDate(b)) / DAY);

// Inverse normal CDF (Abramowitz & Stegun 26.2.23), good to ~4.5e-4.
export function zScore(p) {
  if (p <= 0.5) return 0;
  const t = Math.sqrt(-2 * Math.log(1 - p));
  return t - (2.515517 + 0.802853 * t + 0.010328 * t * t) /
             (1 + 1.432788 * t + 0.189269 * t * t + 0.001308 * t * t * t);
}

export const roundUpOrder = (qty, moq = 1, multiple = 1) => {
  if (qty <= 0) return 0;
  let q = Math.max(qty, moq);
  if (multiple > 1) q = Math.ceil(q / multiple) * multiple;
  return Math.ceil(q);
};

export const FIRM_STATUSES = ["Lists Final", "Released", "Staged"];
export const TENTATIVE_STATUSES = ["PO Signed", "Lists Draft"];
export const ALLOCATED_STATUSES = ["Released", "Staged"];

const DEFAULTS = {
  today: iso(new Date()),
  horizonDays: 180,   // how far ahead planned + unplanned demand is considered
  demandCv: 0.5,      // assumed demand variability when there is no history
  soonDays: 14,       // "order soon" window
  // One shared stock pool. On the same need date this source is served first and the
  // other is the one reported as short. Both are netted against the same stock.
  tieBreak: "maintenance", // "maintenance" | "manufacturing"
};

const PROCUREMENT_DEFAULT = {
  policy: "order_driven", preferred_supplier_id: null, backup_supplier_id: null,
  lead_time_days: null, lead_buffer_days: 0, service_level: 0.95,
  moq: 1, order_multiple: 1, manual_monthly_usage: 0,
  min_qty: null, max_qty: null, review_interval_days: null,
};

const ANCHOR_FIELD = { paint_start: "paint_start_date", ship_date: "ship_date", build_start: "build_start_date" };

// Vessel order lines x control lists -> dated demand events.
export function buildPlannedDemand({ orderLines, controlLines, listTypes, today }) {
  const typeInfo = Object.fromEntries(listTypes.map((t) => [t.name, t]));
  const byModel = {};
  for (const c of controlLines) (byModel[c.vessel_model_id] ||= []).push(c);

  const events = [];
  for (const ol of orderLines) {
    const firm = FIRM_STATUSES.includes(ol.status);
    if (!firm && !TENTATIVE_STATUSES.includes(ol.status)) continue; // Shipped / Cancelled
    for (const c of byModel[ol.vessel_model_id] || []) {
      const t = typeInfo[c.list_type] || { needed_by_anchor: "paint_start", lead_buffer_days: 0 };
      const primary = ANCHOR_FIELD[t.needed_by_anchor] || "paint_start_date";
      const anchor = ol[primary] || ol.paint_start_date || ol.ship_date || ol.build_start_date || null;
      events.push({
        source: "manufacturing", firm, allocated: ALLOCATED_STATUSES.includes(ol.status),
        part_id: c.part_id, qty: Number(c.qty_per_unit) * ol.units,
        needed_by: addDays(anchor || today, -(t.lead_buffer_days || 0)),
        order_id: ol.order_id, order_line_id: ol.id, list_type: c.list_type,
        undated: !anchor, date_fallback: !!anchor && !ol[primary],
      });
    }
  }
  return events;
}

// Customer maintenance POs: direct part lines and kit lines (kits expand to parts).
export function buildMaintenanceDemand({ maintenanceLines, kitLines, today }) {
  const kitMap = {};
  for (const k of kitLines) (kitMap[k.kit_id] ||= []).push(k);
  const events = [];
  for (const ml of maintenanceLines) {
    if (ml.status !== "Open") continue;
    const base = {
      source: "maintenance", firm: true, allocated: false,
      needed_by: ml.needed_by || today, order_id: ml.order_id, order_line_id: ml.id,
      undated: !ml.needed_by, date_fallback: false,
    };
    if (ml.line_type === "kit") {
      for (const k of kitMap[ml.kit_id] || []) {
        events.push({ ...base, part_id: k.part_id, qty: Number(k.qty) * Number(ml.qty), list_type: `Kit ${ml.kit_id}` });
      }
    } else {
      events.push({ ...base, part_id: ml.part_id, qty: Number(ml.qty), list_type: "Direct" });
    }
  }
  return events;
}

// Pick preferred -> cheapest linked supplier, with backup.
export function chooseSuppliers(partId, proc, links) {
  const mine = links.filter((l) => l.part_id === partId);
  const find = (id) => mine.find((l) => l.supplier_id === id) || null;
  let primary = find(proc.preferred_supplier_id);
  if (!primary && mine.length) {
    primary = [...mine].sort((a, b) => (a.unit_cost ?? Infinity) - (b.unit_cost ?? Infinity))[0];
  }
  let backup = find(proc.backup_supplier_id);
  if (!backup) backup = mine.filter((l) => l !== primary).sort((a, b) => (a.unit_cost ?? Infinity) - (b.unit_cost ?? Infinity))[0] || null;
  return { primary, backup };
}

// Net one set of demand events against stock + open POs for one part under its policy.
function evaluate({ stock, planned, onOrder, proc, lead, monthly, opts }) {
  const { today, horizonDays, demandCv } = opts;
  const prio = (src) => (src === opts.tieBreak ? 0 : 1);

  const plannedTotal = planned.reduce((s, e) => s + e.qty, 0);
  const dailyRate = monthly / 30 + plannedTotal / Math.max(horizonDays, 1);
  const review = proc.review_interval_days || 30;
  const z = zScore(proc.service_level);
  const periodDays = proc.policy === "fixed_interval" ? lead + review : lead;
  let safety = z * demandCv * dailyRate * Math.sqrt(Math.max(periodDays, 1));
  if (proc.min_qty != null) safety = Math.max(safety, Number(proc.min_qty));
  safety = Math.ceil(safety);

  // Released/Staged stock is reserved: those events consume stock first (sorted at today)
  // but keep their real need-by date for the deadline.
  const timeline = [
    ...planned.map((e) => ({ date: e.allocated ? today : e.needed_by, needDate: e.needed_by, delta: -e.qty, kind: "demand", e })),
    ...onOrder.map((o) => ({ date: o.due, needDate: o.due, delta: o.qty, kind: "receipt" })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1
    : a.kind !== b.kind ? (a.kind === "receipt" ? -1 : 1)
    : prio(a.e?.source) - prio(b.e?.source)));

  let bal = stock, firstShort = null, shortQty = 0, shortSource = null;
  const lateReceipts = []; // open PO receipts that land after parts were already needed
  for (const ev of timeline) {
    bal += ev.delta;
    if (ev.kind === "receipt" && firstShort && ev.date > firstShort) {
      lateReceipts.push({ qty: ev.delta, due: ev.date, days_late: diffDays(ev.date, firstShort) });
    }
    const unplannedUsed = (monthly / 30) * Math.max(diffDays(ev.date, today), 0);
    if (bal - unplannedUsed < safety && ev.kind === "demand") {
      if (!firstShort || ev.needDate < firstShort) { firstShort = ev.needDate; shortSource = ev.e.source; }
      shortQty = Math.max(shortQty, safety - (bal - unplannedUsed));
    }
  }
  // Pure unplanned items (no dated demand): short when stock cannot cover lead + safety.
  if (!timeline.length && monthly > 0) {
    const cover = (monthly / 30) * lead + safety;
    if (stock < cover) {
      firstShort = addDays(today, Math.max(Math.floor((stock - safety) / (monthly / 30)), 0));
      shortQty = cover - stock;
    }
  }

  const position = stock + onOrder.reduce((s, o) => s + o.qty, 0);
  let orderQty = 0, needBy = firstShort, reason = "";
  const flags = [];

  switch (proc.policy) {
    case "do_not_reorder":
      if (firstShort) flags.push("shortage_but_do_not_reorder");
      break;
    case "min_max": {
      const min = Number(proc.min_qty ?? safety), max = Number(proc.max_qty ?? min * 2);
      if (position - plannedTotal < min || firstShort) { orderQty = max - (position - plannedTotal); reason = "position at/below min"; needBy = needBy || today; }
      break;
    }
    case "reorder_point": {
      const rop = Math.ceil(dailyRate * lead + safety);
      if (position <= rop || firstShort) {
        const cover = Math.ceil(dailyRate * review) + Math.ceil(shortQty);
        orderQty = Math.max(cover, rop - position + 1); reason = `position ${position} <= reorder point ${rop}`; needBy = needBy || today;
      }
      break;
    }
    case "fixed_interval": {
      const target = Math.ceil(dailyRate * (lead + review)) + safety;
      if (position < target) { orderQty = target - position; reason = "below order-up-to level"; needBy = needBy || addDays(today, review); }
      break;
    }
    default: // order_driven
      if (firstShort) { orderQty = Math.ceil(shortQty) + Math.ceil((monthly / 30) * review); reason = "projected shortage vs. dated demand"; }
      // Minimum stock is a floor even with no dated demand: top back up to the minimum.
      else if (proc.min_qty != null && position < Number(proc.min_qty)) {
        orderQty = Number(proc.min_qty) - position; reason = `on hand + on order ${position} below minimum ${proc.min_qty}`;
        needBy = addDays(today, lead);   // order today; not "late" just because it dipped below min
      }
  }
  orderQty = proc.policy === "do_not_reorder" ? 0 : roundUpOrder(orderQty, proc.moq, proc.order_multiple);
  return { orderQty, needBy, reason, flags, safety, position, shortSource, lateReceipts };
}

const urgencyOf = (orderBy, today, soonDays) => {
  const d = diffDays(orderBy, today);
  return d < 0 ? "late" : d <= soonDays ? "order_soon" : "planned";
};

export function forecast(input, optsIn = {}) {
  const opts = { ...DEFAULTS, ...optsIn };
  const { today, horizonDays, soonDays } = opts;
  const {
    parts = [], procurement = [], supplierLinks = [], controlLines = [], orderLines = [],
    listTypes = [], openPoLines = [], historyMonthlyUsage = {},
    maintenanceLines = [], kitLines = [],
  } = input;

  const procMap = Object.fromEntries(procurement.map((p) => [p.part_id, { ...PROCUREMENT_DEFAULT, ...p }]));
  const events = [
    ...buildPlannedDemand({ orderLines, controlLines, listTypes, today }),
    ...buildMaintenanceDemand({ maintenanceLines, kitLines, today }),
  ];
  const eventsByPart = {};
  for (const e of events) (eventsByPart[e.part_id] ||= []).push(e);
  const poByPart = {};
  for (const l of openPoLines) {
    const outstanding = Number(l.qty) - Number(l.qty_received || 0);
    if (outstanding > 0) (poByPart[l.part_id] ||= []).push({ qty: outstanding, due: l.expected_date || l.needed_by || today });
  }

  const recs = [];
  const horizonEnd = addDays(today, horizonDays);

  for (const part of parts) {
    const proc = procMap[part.id] || { ...PROCUREMENT_DEFAULT, part_id: part.id };
    const all = (eventsByPart[part.id] || []).filter((e) => e.needed_by <= horizonEnd);
    const firmEvents = all.filter((e) => e.firm);
    const tentEvents = all.filter((e) => !e.firm);
    const onOrder = poByPart[part.id] || [];
    const monthly = Math.max(proc.manual_monthly_usage || 0, historyMonthlyUsage[part.id] || 0);
    if (!(all.length || monthly > 0 || proc.min_qty != null || proc.policy === "min_max")) continue;

    const { primary, backup } = chooseSuppliers(part.id, proc, supplierLinks);
    const flags = [];
    const leadBase = proc.lead_time_days ?? primary?.lead_days ?? null;
    if (leadBase == null || leadBase === 0) flags.push("lead_time_unknown");
    if (!primary) flags.push("no_supplier");
    const lead = (leadBase || 0) + (proc.lead_buffer_days || 0);
    const stock = Number(part.stock || 0);

    const ctx = { stock, onOrder, proc, lead, monthly, opts };
    const total = evaluate({ ...ctx, planned: all });
    const firm = evaluate({ ...ctx, planned: firmEvents });
    flags.push(...total.flags);

    // Picking waits for parts that are still on order. When an open PO lands after the date
    // parts must be on hand, flag it. If a new order could not arrive any sooner, don't
    // recommend a duplicate: the action is to expedite the open PO.
    let poLateDays = 0;
    if (total.lateReceipts.length) {
      flags.push("po_arrives_late");
      poLateDays = Math.max(...total.lateReceipts.map((r) => r.days_late));
      const lateQty = total.lateReceipts.reduce((s, r) => s + r.qty, 0);
      const lastDue = total.lateReceipts.map((r) => r.due).sort().pop();
      if (total.orderQty <= lateQty && addDays(today, lead) >= lastDue) {
        total.orderQty = 0; firm.orderQty = 0;
        total.reason = `open PO arrives ${poLateDays} day(s) after need-by; a new order would not arrive sooner`;
        flags.push("expedite_open_po");
      }
    }
    if (!total.orderQty && !flags.includes("shortage_but_do_not_reorder") && !flags.includes("po_arrives_late")) continue;

    const firmQty = Math.min(firm.orderQty, total.orderQty);
    const tentQty = Math.max(total.orderQty - firmQty, 0);
    const firmOrderBy = firmQty && firm.needBy ? addDays(firm.needBy, -lead) : null;
    const tentNeed = tentEvents.length ? tentEvents.map((e) => e.needed_by).sort()[0] : total.needBy;
    const tentOrderBy = tentQty && tentNeed ? addDays(tentNeed, -lead) : null;
    const orderBy = firmOrderBy || tentOrderBy || (total.needBy ? addDays(total.needBy, -lead) : today);
    const urgency = urgencyOf(orderBy, today, soonDays);
    if (firmOrderBy && urgencyOf(firmOrderBy, today, soonDays) === "late") flags.push("expedite");
    if (all.some((e) => e.undated)) flags.push("undated_demand");
    if (all.some((e) => e.date_fallback)) flags.push("paint_start_missing");

    const allocatedQty = all.filter((e) => e.allocated).reduce((s, e) => s + e.qty, 0);
    const by = (list, key, val) => list.filter((e) => e[key] === val).reduce((s, e) => s + e.qty, 0);
    const cost = (q) => (primary?.unit_cost != null ? Math.round(primary.unit_cost * q * 100) / 100 : null);

    recs.push({
      part_id: part.id, description: part.description, policy: proc.policy,
      on_hand: stock, allocated_qty: allocatedQty, available: stock - allocatedQty,
      on_order: total.position - stock, safety_stock: total.safety,
      order_qty: total.orderQty, firm_order_qty: firmQty, tentative_order_qty: tentQty,
      need_by: total.needBy, order_by: orderBy, firm_order_by: firmOrderBy, tentative_order_by: tentOrderBy,
      days_to_order: diffDays(orderBy, today), urgency, reason: total.reason,
      supplier_id: primary?.supplier_id || null, backup_supplier_id: backup?.supplier_id || null,
      mfg_part_no: primary?.mfg_part_no || null, unit_cost: primary?.unit_cost ?? null,
      ext_cost: cost(total.orderQty), firm_ext_cost: cost(firmQty), tentative_ext_cost: cost(tentQty),
      lead_days: lead, flags,
      demand_by_source: { manufacturing: by(all, "source", "manufacturing"), maintenance: by(all, "source", "maintenance") },
      demand_by_firmness: { firm: firmEvents.reduce((s, e) => s + e.qty, 0), tentative: tentEvents.reduce((s, e) => s + e.qty, 0) },
      short_source: total.shortSource,
      po_late_days: poLateDays,           // days the latest open PO lands after the need-by date
      source_orders: [...new Set(all.map((e) => e.order_id))],
    });
  }

  const rank = { late: 0, order_soon: 1, planned: 2 };
  recs.sort((a, b) => rank[a.urgency] - rank[b.urgency] || (a.order_by < b.order_by ? -1 : 1));
  return {
    today, recommendations: recs,
    purchaseOrders: groupIntoPurchaseOrders(recs, "firm"),
    tentativePurchaseOrders: groupIntoPurchaseOrders(recs, "tentative"),
  };
}

// One draft PO per supplier for the firm (or tentative) quantities.
// Items with no supplier land under "UNASSIGNED".
export function groupIntoPurchaseOrders(recs, kind = "firm") {
  const qtyKey = kind === "firm" ? "firm_order_qty" : "tentative_order_qty";
  const costKey = kind === "firm" ? "firm_ext_cost" : "tentative_ext_cost";
  const byKey = kind === "firm" ? "firm_order_by" : "tentative_order_by";
  const groups = {};
  for (const r of recs) {
    if (!r[qtyKey]) continue;
    const key = r.supplier_id || "UNASSIGNED";
    const orderBy = r[byKey] || r.order_by;
    (groups[key] ||= { supplier_id: key, kind, lines: [], total: 0, order_by: orderBy });
    const g = groups[key];
    g.lines.push({ part_id: r.part_id, qty: r[qtyKey], unit_cost: r.unit_cost, mfg_part_no: r.mfg_part_no, needed_by: r.need_by, source_orders: r.source_orders });
    g.total += r[costKey] || 0;
    if (orderBy < g.order_by) g.order_by = orderBy;
  }
  return Object.values(groups).map((g) => ({ ...g, total: Math.round(g.total * 100) / 100 }))
    .sort((a, b) => (a.order_by < b.order_by ? -1 : 1));
}
