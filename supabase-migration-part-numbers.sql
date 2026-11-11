-- Part numbers: new number is primary (id = 'CT-' || new_part_no); old number kept as legacy_part_no.
-- Parts without a confirmed new number keep their old id (CT-BC-####) and are flagged new_no_pending.
-- Applied 2026-11-11. Safe to re-run: guarded by IF NOT EXISTS / existence checks.

-- 1) snapshots (restore point)
create table if not exists parts_backup_20261111 as select * from parts;
create table if not exists license_plates_backup_20261111 as select * from license_plates;

-- 2) columns
alter table parts add column if not exists new_part_no text;
alter table parts add column if not exists legacy_part_no text;
alter table parts add column if not exists new_no_pending boolean not null default false;
create unique index if not exists parts_new_part_no_uq on parts(new_part_no) where new_part_no is not null;
create index if not exists parts_legacy_part_no_ix on parts(legacy_part_no);

-- 3) legacy number = current id without the CT-BC- prefix (only where not yet set)
update parts set legacy_part_no = regexp_replace(id,'^CT-BC-','') where legacy_part_no is null and id like 'CT-BC-%';

-- 4) make every foreign key to parts(id) cascade on update, preserving delete behaviour
alter table part_suppliers drop constraint if exists part_suppliers_part_id_fkey;
alter table part_suppliers add constraint part_suppliers_part_id_fkey foreign key (part_id) references parts(id) on update cascade on delete cascade;
alter table purchase_order_lines drop constraint if exists purchase_order_lines_part_id_fkey;
alter table purchase_order_lines add constraint purchase_order_lines_part_id_fkey foreign key (part_id) references parts(id) on update cascade;
alter table maintenance_kit_lines drop constraint if exists maintenance_kit_lines_part_id_fkey;
alter table maintenance_kit_lines add constraint maintenance_kit_lines_part_id_fkey foreign key (part_id) references parts(id) on update cascade;
alter table maintenance_order_lines drop constraint if exists maintenance_order_lines_part_id_fkey;
alter table maintenance_order_lines add constraint maintenance_order_lines_part_id_fkey foreign key (part_id) references parts(id) on update cascade;
alter table control_list_lines drop constraint if exists control_list_lines_part_id_fkey;
alter table control_list_lines add constraint control_list_lines_part_id_fkey foreign key (part_id) references parts(id) on update cascade;
alter table mfg_barcodes drop constraint if exists mfg_barcodes_part_id_fkey;
alter table mfg_barcodes add constraint mfg_barcodes_part_id_fkey foreign key (part_id) references parts(id) on update cascade on delete cascade;
alter table supplier_stock drop constraint if exists supplier_stock_part_id_fkey;
alter table supplier_stock add constraint supplier_stock_part_id_fkey foreign key (part_id) references parts(id) on update cascade on delete cascade;
alter table part_procurement drop constraint if exists part_procurement_part_id_fkey;
alter table part_procurement add constraint part_procurement_part_id_fkey foreign key (part_id) references parts(id) on update cascade on delete cascade;

-- 5) rename helper: re-keys a part and rewrites partId inside license_plates.items (not a foreign key)
create or replace function rename_part(p_old text, p_new_no text) returns void language plpgsql as $$
declare v_new text := 'CT-' || p_new_no;
begin
  if not exists (select 1 from parts where id = p_old) then raise exception 'part % not found', p_old; end if;
  if exists (select 1 from parts where id = v_new) then raise exception 'part % already exists', v_new; end if;
  update parts set id = v_new, new_part_no = p_new_no, new_no_pending = false where id = p_old;
  update license_plates
     set items = (select coalesce(jsonb_agg(case when e->>'partId' = p_old then jsonb_set(e,'{partId}',to_jsonb(v_new)) else e end), '[]'::jsonb)
                  from jsonb_array_elements(items) e)
   where items @> jsonb_build_array(jsonb_build_object('partId', p_old));
end $$;

-- 6) apply the crosswalk (new numbers confirmed in the QuickBooks list; one new number per part)
do $$
declare r record;
begin
  for r in select * from (values
    ('1999','3502'),
    ('2098','6200'),
    ('2099','6201'),
    ('2100','5100'),
    ('2101','4200'),
    ('2102','1801'),
    ('2103','5508'),
    ('2201','4201'),
    ('2202','1800'),
    ('2203','5509'),
    ('2204','4403'),
    ('2205A','1600'),
    ('2206','3900'),
    ('2206A','3901'),
    ('2206B','3902'),
    ('2206C','3903'),
    ('2207','4404'),
    ('2209','2500'),
    ('2210','4406'),
    ('2303','4103'),
    ('2305','4600'),
    ('2306','4104'),
    ('2308','4105'),
    ('2309','4106'),
    ('2311','3500'),
    ('2401','5800'),
    ('3002A','5102'),
    ('3002B','5103'),
    ('3002C','5104'),
    ('3002D','5105'),
    ('3002E','5106'),
    ('3005A','5400'),
    ('3005B','5401'),
    ('3005C','5402'),
    ('3005D','5403'),
    ('3005E','5404'),
    ('3005F','5405'),
    ('3005H','5513'),
    ('3009','2800'),
    ('3010','2801'),
    ('3011','2802'),
    ('3012','4110'),
    ('3013','4111'),
    ('3014D','1700'),
    ('3014E','1701'),
    ('3014F','1702'),
    ('3014H','4500'),
    ('3014J','1705'),
    ('3014K','1706'),
    ('3016','5113'),
    ('3017','2803'),
    ('3018','3100'),
    ('3019','2900'),
    ('3021','4409'),
    ('3021B','1601'),
    ('3022','5801'),
    ('3024','6204'),
    ('3025','6205'),
    ('3026','6206'),
    ('3027','4604'),
    ('3028','4605'),
    ('3029','3600'),
    ('3030','4606'),
    ('3031','4607'),
    ('3201','4000'),
    ('3305','4001'),
    ('3401A','5802'),
    ('3401B','5803'),
    ('3402','3601'),
    ('3403A','5114'),
    ('3403B','5115'),
    ('3408','5000'),
    ('3504','3000'),
    ('3601','4800'),
    ('3602','2300'),
    ('4405','4116'),
    ('4501','5200'),
    ('4603','2700'),
    ('4701','1900'),
    ('6001','4414'),
    ('6002','4415'),
    ('6007','1500'),
    ('6008','4416'),
    ('6010','4417'),
    ('6011','3907'),
    ('6012','4418'),
    ('6034','2609'),
    ('6035','2611'),
    ('6036','2612'),
    ('6037','2613'),
    ('6039','3200'),
    ('6042','3503'),
    ('8002','2600'),
    ('8013','2603')
  ) as m(legacy, newno) loop
    if exists (select 1 from parts where legacy_part_no = r.legacy and new_part_no is null) then
      perform rename_part((select id from parts where legacy_part_no = r.legacy), r.newno);
    end if;
  end loop;
end $$;

-- 7) flag the rest as pending
update parts set new_no_pending = true where new_part_no is null;

-- 2026-11-11: pending parts drop the BC segment (CT-BC-2205 -> CT-2205). Applied as migration drop_bc_from_pending_part_ids.
-- update parts set id = 'CT-' || replace(id,'CT-BC-','') where id like 'CT-BC-%' and new_no_pending;
