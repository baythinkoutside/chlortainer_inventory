-- ChlorTainer Inventory System — Manufacturing fulfillment workflow
-- Run after supabase-migration-replenishment.sql.
--
-- Workflow: customer vessel PO signed -> packing lists + control list created ->
-- lists finalized -> released for fulfillment (parts selected, boxed, staged) ->
-- vessels pass hydro and move to paint (1-2 weeks) -> staged parts ship to the manufacturer.
-- Every list type is therefore needed at the planned paint-start date, minus pick/box/stage time.

-- 1. Planned hydro-pass / paint-start date on each vessel order line -------
alter table order_lines add column if not exists paint_start_date date;

-- 2. Fulfillment statuses (replaces Open / In Build) -----------------------
alter table order_lines drop constraint if exists order_lines_status_check;
update order_lines set status = 'PO Signed'   where status = 'Open';
update order_lines set status = 'Lists Final' where status = 'In Build';
alter table order_lines
  add constraint order_lines_status_check
  check (status in ('PO Signed','Lists Draft','Lists Final','Released','Staged','Shipped','Cancelled'));
alter table order_lines alter column status set default 'PO Signed';

-- 3. All list types are anchored to paint start ----------------------------
--    lead_buffer_days on packing_slip_types = pick / box / stage time for that list type.
alter table packing_slip_types drop constraint if exists packing_slip_types_needed_by_anchor_check;
alter table packing_slip_types
  add constraint packing_slip_types_needed_by_anchor_check
  check (needed_by_anchor in ('paint_start','build_start','ship_date'));
alter table packing_slip_types alter column needed_by_anchor set default 'paint_start';
update packing_slip_types set needed_by_anchor = 'paint_start';

-- 4. Pick / box / stage time: one day for every list type -------------------
--    Parts must be on hand the day before paint start. If parts are still on order,
--    the pick waits for receipt (the forecast flags open POs that arrive too late).
alter table packing_slip_types alter column lead_buffer_days set default 1;
update packing_slip_types set lead_buffer_days = 1;
