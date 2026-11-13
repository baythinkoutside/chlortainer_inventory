// ChlorTainer Inventory System v2.1
import { useState, useEffect, useRef, useMemo, useId } from "react";
import { forecast, FIRM_STATUSES } from "./replenishment.js";
import BinLabelsTab from "./BinLabels.jsx";
import { parseSlip, guessListType, matchPart } from "./slipParser.js";

// ─── Supabase via CDN ─────────────────────────────────────────────────────────
const STORAGE_KEY = "chlortainer_sb_config";
let _sb = null;

// Built-in connection: the project URL and anon (public) key are safe to ship in the
// client (access is controlled by Supabase RLS/auth), so new users skip the setup screen.
// Netlify env vars VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY override these defaults.
const DEFAULT_CONFIG = {
  url: import.meta.env.VITE_SUPABASE_URL || "https://mwvxbxbxwwmekdfwmfao.supabase.co",
  key: import.meta.env.VITE_SUPABASE_ANON_KEY || "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im13dnhieGJ4d3dtZWtkZndtZmFvIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODI3NDUxNzMsImV4cCI6MjA5ODMyMTE3M30.JhGyJrpwZyxIU7otUILVg6a_a7B85mLV0VAsVU60QdI",
};
function loadConfig() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || DEFAULT_CONFIG; } catch { return DEFAULT_CONFIG; }
}
function saveConfig(cfg) { localStorage.setItem(STORAGE_KEY, JSON.stringify(cfg)); }
function clearConfig() { localStorage.removeItem(STORAGE_KEY); _sb = null; }

async function initSB(url, key) {
  if (_sb) return _sb;
  if (!window.supabase) {
    await new Promise((res, rej) => {
      const s = document.createElement("script");
      s.src = "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js";
      s.onload = res; s.onerror = rej;
      document.head.appendChild(s);
    });
  }
  _sb = window.supabase.createClient(url, key);
  return _sb;
}

// ─── Current User ─────────────────────────────────────────────────────────────
let _currentUser = null;
function getCurrentUser() { return _currentUser; }
function setCurrentUser(u) { _currentUser = u; }

// Write to audit log — call after any data change
async function logAudit(action, entityType, entityId, details={}) {
  try {
    const u = getCurrentUser();
    await _sb.from("audit_log").insert({
      user_id: u?.id || null,
      user_email: u?.email || "unknown",
      action, entity_type: entityType, entity_id: entityId,
      details,
    });
  } catch(_) {} // never block the main action
}

const C = {
  navy:"#1C2B3A", navyLight:"#2C3E50",
  red:"#C8102E", redLight:"#FFF0F2", redBorder:"#F5A0AE",
  amber:"#F5A623", amberLight:"#FEF6E7", amberBdr:"#F5C842",
  white:"#FFFFFF", offWhite:"#F5F6F7", border:"#E0E3E7",
  textDark:"#1C2B3A", textMid:"#4A5568", textLight:"#8A9BB0",
  greenBg:"#EDFBF3", greenText:"#1A6B42", greenBdr:"#7ECFA4",
  warnBg:"#FFF8E6", warnText:"#8A5A00", warnBdr:"#F5C842",
};

// ─── UI Primitives ────────────────────────────────────────────────────────────
function BarcodeDisplay({ code, size="md" }) {
  const h=size==="lg"?52:30, w=size==="lg"?176:112, fs=size==="lg"?12:9;
  const chars=code.split("").map(c=>c.charCodeAt(0));
  return (
    <div style={{display:"inline-flex",flexDirection:"column",alignItems:"center",gap:3}}>
      <svg width={w} height={h} style={{display:"block"}}>
        <rect width={w} height={h} fill="#fff"/>
        {chars.map((c,i)=>i%2===0?<rect key={i} x={(i/chars.length)*w} width={(c%3)+1} height={h} fill={C.navy}/>:null)}
      </svg>
      <span style={{fontFamily:"monospace",fontSize:fs,color:C.textDark,letterSpacing:1.5,fontWeight:600}}>{code}</span>
    </div>
  );
}

function Badge({ children, color="blue" }) {
  const map={blue:{bg:"#EBF2FA",text:"#1C4E80",bd:"#9DC3E6"},red:{bg:C.redLight,text:C.red,bd:C.redBorder},
    green:{bg:C.greenBg,text:C.greenText,bd:C.greenBdr},amber:{bg:C.warnBg,text:C.warnText,bd:C.warnBdr},
    gray:{bg:C.offWhite,text:C.textMid,bd:C.border},navy:{bg:"#E8EDF2",text:C.navy,bd:"#B0BEC5"}};
  const s=map[color]||map.gray;
  return <span style={{background:s.bg,color:s.text,border:`1px solid ${s.bd}`,borderRadius:3,padding:"2px 8px",fontSize:11,fontWeight:700,letterSpacing:.3}}>{children}</span>;
}

const inputStyle={boxSizing:"border-box",maxWidth:"100%",minWidth:0,border:`1.5px solid ${C.border}`,borderRadius:5,padding:"9px 12px",fontSize:14,fontFamily:"sans-serif",color:C.textDark,outline:"none",background:C.white};

function Field({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:5,minWidth:0}}>
    <label style={{fontSize:11,fontWeight:700,color:C.textMid,textTransform:"uppercase",letterSpacing:.8}}>{label}</label>
    {children}
  </div>;
}
function Input({label,...props}){
  const el=<input {...props} style={{...inputStyle,...(props.style||{})}}/>;
  return label?<Field label={label}>{el}</Field>:el;
}
function Sel({label,children,...props}){
  const el=<select {...props} style={{...inputStyle,background:C.white,width:"100%"}}>{children}</select>;
  return label?<Field label={label}>{el}</Field>:el;
}
function Btn({children,variant="primary",onClick,style={},disabled=false}){
  const v={primary:{background:C.red,color:"#fff",border:"none"},navy:{background:C.navy,color:"#fff",border:"none"},
    amber:{background:C.amber,color:C.navy,border:"none"},outline:{background:C.white,color:C.navy,border:`1.5px solid ${C.navy}`},
    ghost:{background:"transparent",color:C.textLight,border:"none"},danger:{background:C.white,color:C.red,border:`1.5px solid ${C.redBorder}`}};
  const s=v[variant]||v.primary;
  return <button onClick={onClick} disabled={disabled} style={{...s,borderRadius:5,padding:"9px 18px",fontSize:13,fontWeight:700,cursor:disabled?"not-allowed":"pointer",opacity:disabled?.5:1,display:"inline-flex",alignItems:"center",gap:6,letterSpacing:.2,...style}}>{children}</button>;
}
function SectionTitle({children}){
  return <div style={{display:"flex",alignItems:"center",gap:10,marginBottom:14}}>
    <div style={{width:4,height:20,background:C.amber,borderRadius:2,flexShrink:0}}/>
    <span style={{fontSize:14,fontWeight:800,color:C.navy,textTransform:"uppercase",letterSpacing:.5}}>{children}</span>
  </div>;
}
// Popups: Esc or a tap outside closes the top one; confirmClose asks first when there is unsaved input.
// "Top" = the last popup in the page (a nested popup sits inside, and after, its parent).
let _openModals=0;
function Modal({title,onClose,children,width=620,confirmClose=null}){
  const isPhone=useIsPhone();
  const rootRef=useRef(null);
  const downOnBackdrop=useRef(false);
  const tryClose=()=>{ if(confirmClose&&!window.confirm(confirmClose)) return; onClose(); };
  const closeRef=useRef(tryClose); closeRef.current=tryClose;
  useEffect(()=>{
    if(_openModals++===0) document.body.dataset.prevOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    const onKey=e=>{
      if(e.key!=="Escape"||e.defaultPrevented) return;
      const all=document.querySelectorAll("[data-modal]");
      if(all[all.length-1]!==rootRef.current) return;
      e.preventDefault(); closeRef.current();
    };
    window.addEventListener("keydown",onKey);
    return ()=>{ window.removeEventListener("keydown",onKey); if(--_openModals===0){ document.body.style.overflow=document.body.dataset.prevOverflow||""; delete document.body.dataset.prevOverflow; } };
  },[]);
  return <div ref={rootRef} data-modal="" onMouseDown={e=>{downOnBackdrop.current=e.target===e.currentTarget;}} onClick={e=>{ if(downOnBackdrop.current&&e.target===e.currentTarget) tryClose(); }}
    style={{position:"fixed",inset:0,background:"rgba(28,43,58,0.72)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:isPhone?0:16}}>
    <div role="dialog" aria-modal="true" aria-label={typeof title==="string"?title:undefined}
      style={{background:C.white,borderRadius:isPhone?0:8,width:"100%",maxWidth:isPhone?"100%":width,height:isPhone?"100%":"auto",maxHeight:isPhone?"100dvh":"92vh",overflowY:"auto",overflowX:"hidden",boxShadow:"0 24px 64px rgba(0,0,0,.35)",WebkitOverflowScrolling:"touch"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:isPhone?"6px 8px 6px 16px":"10px 12px 10px 24px",borderBottom:`3px solid ${C.amber}`,background:C.navy,position:"sticky",top:0,zIndex:5,paddingTop:isPhone?"calc(6px + env(safe-area-inset-top))":undefined}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:800,color:C.white,letterSpacing:.3,minWidth:0,overflowWrap:"anywhere"}}>{title}</h3>
        <button onClick={tryClose} aria-label="Close" title="Close (Esc)" style={{background:"none",border:"none",cursor:"pointer",fontSize:26,color:"#C9D3DE",lineHeight:1,width:44,height:44,flexShrink:0}}>×</button>
      </div>
      <div style={{padding:isPhone?"16px 16px calc(24px + env(safe-area-inset-bottom))":24}}>{children}</div>
    </div>
  </div>;
}
function Spinner({text="Loading…"}){
  return <div style={{display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",padding:60,gap:14}}>
    <div style={{width:36,height:36,border:`3px solid ${C.amber}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
    <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    <span style={{fontSize:13,color:C.textMid}}>{text}</span>
  </div>;
}

// ─── Setup Screen ─────────────────────────────────────────────────────────────
function SetupScreen({ onConnected }) {
  const [url,setUrl]=useState("");
  const [key,setKey]=useState("");
  const [testing,setTesting]=useState(false);
  const [err,setErr]=useState("");
  const [copied,setCopied]=useState(false);

  const SQL=`-- Run in Supabase SQL Editor → New Query
create table if not exists suppliers(id text primary key,name text not null,contact text,phone text,created_at timestamptz default now());
create table if not exists parts(id text primary key,description text not null,category text,uom text default 'EA',stock integer default 0,min_stock integer default 0,location text,created_at timestamptz default now());
create table if not exists part_suppliers(id uuid primary key default gen_random_uuid(),part_id text references parts(id) on delete cascade,supplier_id text references suppliers(id) on delete cascade,mfg_part_no text,lead_days integer default 0,unit_cost numeric(10,2) default 0,unique(part_id,supplier_id));
create table if not exists license_plates(id text primary key,type text default 'Outbound',destination text,status text default 'Pending',created_at date default current_date,items jsonb default '[]');
alter table parts disable row level security;
alter table suppliers disable row level security;
alter table part_suppliers disable row level security;
alter table license_plates disable row level security;
insert into suppliers(id,name,contact,phone) values('SUP-001','Aldrich Chemical Co.','orders@aldrichchem.com','800-325-3010'),('SUP-002','Parker Hannifin','industrial@parker.com','216-896-3000'),('SUP-003','Swagelok','info@swagelok.com','440-349-5934'),('SUP-004','McMaster-Carr','orders@mcmaster.com','630-833-0300') on conflict do nothing;
insert into parts(id,description,category,uom,stock,min_stock,location) values('CT-BC-0001','HDPE Containment Body 55gal','Containment','EA',24,10,'A-01-03'),('CT-BC-0002','PTFE Gasket 2-inch','Seals & Gaskets','EA',8,25,'B-03-01'),('CT-BC-0003','316 SS Ball Valve 1/2"','Valves','EA',42,15,'C-02-04'),('CT-BC-0004','Chlorine Sensor Probe','Instrumentation','EA',5,5,'D-01-01'),('CT-BC-0005','HDPE Lid Assembly','Containment','EA',19,8,'A-01-04'),('CT-BC-0006','Vent Filter HEPA 4"','Filtration','EA',3,12,'B-04-02') on conflict do nothing;
insert into part_suppliers(part_id,supplier_id,mfg_part_no,lead_days,unit_cost) values('CT-BC-0001','SUP-002','HB-55-HDPE',7,142),('CT-BC-0001','SUP-004','MC-HDPE-55G',5,138.50),('CT-BC-0002','SUP-003','SS-PTFE-2',3,4.75),('CT-BC-0002','SUP-004','MC-GKT-PTFE',2,5.10),('CT-BC-0003','SUP-003','SW-BV-SS-050',4,67.80),('CT-BC-0004','SUP-001','AC-CLR-PRB-01',14,312),('CT-BC-0005','SUP-002','HB-LID-ASM',7,58.25),('CT-BC-0005','SUP-004','MC-LID-HDPE',4,55),('CT-BC-0006','SUP-004','MC-VNT-HEPA4',2,18.40) on conflict do nothing;`;

  async function connect() {
    if (!url||!key) return;
    setTesting(true); setErr("");
    try {
      const sb = await initSB(url.trim(), key.trim());
      const { error } = await sb.from("parts").select("id").limit(1);
      if (error) throw new Error(error.message);
      saveConfig({ url:url.trim(), key:key.trim() });
      onConnected();
    } catch(e) { setErr(e.message||"Connection failed"); setTesting(false); _sb=null; }
  }

  return (
    <div style={{minHeight:"100vh",background:C.offWhite}}>
      <div style={{background:C.navy,borderBottom:`4px solid ${C.amber}`,padding:"16px 24px",display:"flex",alignItems:"center",gap:10}}>
        <div style={{background:C.amber,width:5,height:32,borderRadius:2}}/>
        <div><div style={{fontSize:18,fontWeight:900,color:C.white}}>ChlorTainer</div>
          <div style={{fontSize:9,fontWeight:700,color:C.amber,letterSpacing:2.5,textTransform:"uppercase"}}>Inventory System — Setup</div></div>
      </div>
      <div style={{maxWidth:600,margin:"32px auto",padding:"0 20px"}}>
        <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:10,padding:24,marginBottom:16}}>
          <SectionTitle>Step 1 — Run SQL in Supabase</SectionTitle>
          <p style={{fontSize:13,color:C.textMid,margin:"0 0 12px"}}>Go to <strong>Supabase → SQL Editor → New Query</strong>, paste and run:</p>
          <div style={{position:"relative"}}>
            <pre style={{background:"#0D1520",color:"#A8C8E8",borderRadius:8,padding:16,fontSize:10,overflowX:"auto",margin:0,lineHeight:1.6,maxHeight:180,overflowY:"auto"}}>{SQL}</pre>
            <button onClick={()=>{navigator.clipboard.writeText(SQL);setCopied(true);setTimeout(()=>setCopied(false),2000);}}
              style={{position:"absolute",top:8,right:8,background:copied?C.greenText:C.amber,color:copied?"#fff":C.navy,border:"none",borderRadius:5,padding:"4px 10px",fontSize:11,fontWeight:700,cursor:"pointer"}}>
              {copied?"✅ Copied":"Copy SQL"}
            </button>
          </div>
        </div>
        <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:10,padding:24}}>
          <SectionTitle>Step 2 — Enter Credentials</SectionTitle>
          <p style={{fontSize:13,color:C.textMid,margin:"0 0 16px"}}>From <strong>Supabase → Project Settings → API</strong>:</p>
          <div style={{display:"grid",gap:14}}>
            <Input label="Project URL" value={url} onChange={e=>setUrl(e.target.value)} placeholder="https://xxxx.supabase.co"/>
            <Input label="Anon Public Key" value={key} onChange={e=>setKey(e.target.value)} placeholder="eyJ..." style={{fontFamily:"monospace",fontSize:12}}/>
          </div>
          {err&&<div style={{marginTop:12,background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ {err}</div>}
          <div style={{marginTop:16}}>
            <Btn onClick={connect} disabled={!url||!key||testing} style={{width:"100%",justifyContent:"center"}}>
              {testing?"Connecting…":"Connect to Supabase"}
            </Btn>
          </div>
          <p style={{fontSize:11,color:C.textLight,margin:"10px 0 0"}}>Credentials saved to this browser only.</p>
        </div>
      </div>
    </div>
  );
}

// ─── Login Screen ─────────────────────────────────────────────────────────────
function LoginScreen({ onLogin }) {
  const [email,setEmail]=useState("");
  const [loading,setLoading]=useState(false);
  const [sent,setSent]=useState(false);
  const [err,setErr]=useState("");

  async function sendLink(){
    if(!email) return;
    setLoading(true); setErr("");
    try {
      const {error} = await _sb.auth.signInWithOtp({
        email:email.trim(),
        options:{ shouldCreateUser:false, emailRedirectTo:window.location.origin }
      });
      if(error) throw new Error(error.message);
      setSent(true);
    } catch(e){ setErr(e.message); }
    setLoading(false);
  }

  return (
    <div style={{minHeight:"100vh",background:C.offWhite,display:"flex",alignItems:"center",justifyContent:"center",padding:20}}>
      <div style={{width:"100%",maxWidth:400}}>
        <div style={{background:C.navy,borderBottom:`4px solid ${C.amber}`,borderRadius:"10px 10px 0 0",padding:"24px 28px",display:"flex",alignItems:"center",gap:10}}>
          <div style={{background:C.amber,width:5,height:36,borderRadius:2}}/>
          <div>
            <div style={{fontSize:20,fontWeight:900,color:C.white}}>ChlorTainer</div>
            <div style={{fontSize:10,fontWeight:700,color:C.amber,letterSpacing:2.5,textTransform:"uppercase"}}>Inventory System</div>
          </div>
        </div>
        <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderTop:"none",borderRadius:"0 0 10px 10px",padding:28}}>
          {sent ? (
            <>
              <div style={{fontSize:15,fontWeight:700,color:C.navy,marginBottom:10}}>📧 Check your email</div>
              <p style={{fontSize:13,color:C.textMid,margin:0,lineHeight:1.5}}>
                We sent a sign-in link to <b>{email.trim()}</b>. Open it on this device to sign in.
              </p>
              <Btn onClick={()=>{setSent(false);setErr("");}}
                style={{width:"100%",justifyContent:"center",marginTop:16}}>
                Use a different email
              </Btn>
            </>
          ) : (
            <>
              <div style={{fontSize:15,fontWeight:700,color:C.navy,marginBottom:20}}>Sign in to continue</div>
              <Field label="Email">
                <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                  onKeyDown={e=>e.key==="Enter"&&sendLink()}
                  placeholder="you@chlortainer.com"
                  style={{...inputStyle,width:"100%"}}/>
              </Field>
              {err&&<div style={{marginTop:12,background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ {err}</div>}
              <Btn onClick={sendLink} disabled={!email||loading}
                style={{width:"100%",justifyContent:"center",marginTop:16}}>
                {loading?"Sending…":"Email me a sign-in link"}
              </Btn>
              <p style={{fontSize:11,color:C.textLight,margin:"12px 0 0",textAlign:"center"}}>
                Only registered users can sign in. Contact your administrator for access.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Data Hook ────────────────────────────────────────────────────────────────
function useData() {
  const [parts,setParts]=useState([]);
  const [suppliers,setSuppliers]=useState([]);
  const [lps,setLps]=useState([]);
  const [mfgBarcodes,setMfgBarcodes]=useState([]);
  const [supplierStock,setSupplierStock]=useState([]);
  const [packingSlipTypes,setPackingSlipTypes]=useState([]);
  const [customers,setCustomers]=useState([]);
  const [fabricators,setFabricators]=useState([]);
  const [vesselModels,setVesselModels]=useState([]);
  const [controlLines,setControlLines]=useState([]);
  const [orders,setOrders]=useState([]);
  const [orderLines,setOrderLines]=useState([]);
  const [packingLines,setPackingLines]=useState([]);
  const [maintKits,setMaintKits]=useState([]);
  const [kitLines,setKitLines]=useState([]);
  const [maintLines,setMaintLines]=useState([]);
  const [procurement,setProcurement]=useState([]);
  const [purchaseOrders,setPurchaseOrders]=useState([]);
  const [poLines,setPoLines]=useState([]);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState(null);

  const fetchAll = async () => {
    const sb = _sb;
    const [{data:sups},{data:rawParts},{data:links},{data:plates},{data:barcodes},{data:supStock},{data:pst},{data:custs},
           {data:vms},{data:cls},{data:ords},{data:ols},{data:kits},{data:kls},{data:mls},{data:procs},{data:pos},{data:pols},{data:fabs}] = await Promise.all([
      sb.from("suppliers").select("*").order("name"),
      sb.from("parts").select("*").order("id"),
      sb.from("part_suppliers").select("*"),
      sb.from("license_plates").select("*").order("created_at",{ascending:false}),
      sb.from("mfg_barcodes").select("*").order("created_at",{ascending:false}),
      sb.from("supplier_stock").select("*"),
      sb.from("packing_slip_types").select("*").order("sort_order"),
      sb.from("customers").select("*").order("name"),
      sb.from("vessel_models").select("*").order("name"),
      sb.from("control_list_lines").select("*").order("line_no",{nullsFirst:false}).order("created_at"),
      sb.from("orders").select("*").order("created_at",{ascending:false}),
      sb.from("order_lines").select("*").order("created_at"),
      sb.from("maintenance_kits").select("*").order("name"),
      sb.from("maintenance_kit_lines").select("*"),
      sb.from("maintenance_order_lines").select("*").order("created_at"),
      sb.from("part_procurement").select("*"),
      sb.from("purchase_orders").select("*").order("created_at",{ascending:false}),
      sb.from("purchase_order_lines").select("*").order("created_at"),
      sb.from("fabricators").select("*").order("name"),
    ]);
    const stitched=(rawParts||[]).map(p=>({...p,minStock:p.min_stock,
      suppliers:(links||[]).filter(l=>l.part_id===p.id).map(l=>({supplierId:l.supplier_id,mfgPartNo:l.mfg_part_no,leadDays:l.lead_days,unitCost:parseFloat(l.unit_cost),shipsDirect:!!l.ships_direct}))}));
    setSuppliers(sups||[]);
    setParts(stitched);
    setLps((plates||[]).map(lp=>({...lp,createdAt:lp.created_at,items:lp.items||[]})));
    setMfgBarcodes(barcodes||[]);
    setSupplierStock(supStock||[]);
    setPackingSlipTypes(pst||[]);
    setCustomers(custs||[]);
    setFabricators(fabs||[]);
    setVesselModels(vms||[]);
    setControlLines(cls||[]);
    setOrders(ords||[]);
    setOrderLines(ols||[]);
    { const {data:opl}=await sb.from("order_packing_lines").select("*").order("list_type").order("line_no",{nullsFirst:false}).order("created_at"); setPackingLines(opl||[]); }
    setMaintKits(kits||[]);
    setKitLines(kls||[]);
    setMaintLines(mls||[]);
    setProcurement(procs||[]);
    setPurchaseOrders(pos||[]);
    setPoLines(pols||[]);
  };

  useEffect(()=>{
    let subs=[];
    (async()=>{
      try {
        await fetchAll();
        setLoading(false);
        const refresh=()=>fetchAll();
        subs=[
          _sb.channel("p").on("postgres_changes",{event:"*",schema:"public",table:"parts"},refresh).subscribe(),
          _sb.channel("s").on("postgres_changes",{event:"*",schema:"public",table:"suppliers"},refresh).subscribe(),
          _sb.channel("l").on("postgres_changes",{event:"*",schema:"public",table:"part_suppliers"},refresh).subscribe(),
          _sb.channel("lp").on("postgres_changes",{event:"*",schema:"public",table:"license_plates"},refresh).subscribe(),
          _sb.channel("mb").on("postgres_changes",{event:"*",schema:"public",table:"mfg_barcodes"},refresh).subscribe(),
          _sb.channel("ss").on("postgres_changes",{event:"*",schema:"public",table:"supplier_stock"},refresh).subscribe(),
          _sb.channel("pst").on("postgres_changes",{event:"*",schema:"public",table:"packing_slip_types"},refresh).subscribe(),
          _sb.channel("cust").on("postgres_changes",{event:"*",schema:"public",table:"customers"},refresh).subscribe(),
        ];
      } catch(e){setError(e.message);setLoading(false);}
    })();
    return ()=>subs.forEach(s=>s.unsubscribe());
  },[]);

  async function addPart(form){
    const newNo=(form.newPartNo||"").trim();
    const legacyNo=(form.legacyPartNo||"").trim();
    if(!newNo) throw new Error("A new part number is required.");
    const id=`${PART_PREFIX}${newNo}`;
    if(parts.some(p=>p.id.toUpperCase()===id.toUpperCase())) throw new Error(`${id} already exists.`);
    await dbRun(_sb.from("parts").insert({id,new_part_no:newNo,legacy_part_no:legacyNo||null,new_no_pending:false,description:form.description,category:form.category,uom:form.uom,stock:+form.stock||0,min_stock:+form.minStock||0,location:form.location}));
    await logAudit("part_add","part",id,{description:form.description,category:form.category,stock:+form.stock||0,new_part_no:newNo,legacy_part_no:legacyNo||null});
  }
  async function uploadPartImage(partId, file) {
    const ext = file.name.split('.').pop() || 'jpg';
    const path = `${partId}.${ext}`;
    // Remove old image first
    await _sb.storage.from("part-images").remove([`${partId}.jpg`,`${partId}.jpeg`,`${partId}.png`,`${partId}.webp`]).catch(()=>{});
    const { error } = await _sb.storage.from("part-images").upload(path, file, { upsert: true, contentType: file.type });
    if (error) throw new Error(error.message);
    const { data } = _sb.storage.from("part-images").getPublicUrl(path);
    const url = data.publicUrl + `?t=${Date.now()}`; // cache bust
    await _sb.from("parts").update({ image_url: url }).eq("id", partId);
    await logAudit("image_upload","part",partId,{url});
  }
  async function removePartImage(partId) {
    await _sb.storage.from("part-images").remove([`${partId}.jpg`,`${partId}.jpeg`,`${partId}.png`,`${partId}.webp`]).catch(()=>{});
    await _sb.from("parts").update({ image_url: null }).eq("id", partId);
    await logAudit("image_remove","part",partId,{});
  }
  async function updateStock(partId,newStock,details={}){
    const part=parts.find(p=>p.id===partId);
    await _sb.from("parts").update({stock:newStock}).eq("id",partId);
    await logAudit("stock_adjust","part",partId,{from:part?.stock,to:newStock,...details});
  }
  async function addSupplier(form){
    const id=`SUP-${String(suppliers.length+1).padStart(3,"0")}`;
    await _sb.from("suppliers").insert({id,name:form.name,contact:form.contact,phone:form.phone});
    await logAudit("supplier_add","supplier",id,{name:form.name});
  }
  async function linkSupplier(partId,form){
    await _sb.from("part_suppliers").upsert({part_id:partId,supplier_id:form.supplierId,mfg_part_no:form.mfgPartNo,lead_days:+form.leadDays||0,unit_cost:+form.unitCost||0,...(form.shipsDirect!==undefined?{ships_direct:!!form.shipsDirect}:{})});
    await logAudit("supplier_link","part",partId,{supplier_id:form.supplierId,mfg_part_no:form.mfgPartNo});
  }
  async function unlinkSupplier(partId,supplierId){
    await _sb.from("part_suppliers").delete().eq("part_id",partId).eq("supplier_id",supplierId);
    await logAudit("supplier_unlink","part",partId,{supplier_id:supplierId});
  }
  async function createLP(form,items){
    const today=new Date().toISOString().slice(0,10).replace(/-/g,"");
    const suffix=Math.random().toString(36).slice(2,6).toUpperCase();
    const id=`LP-${today}-${suffix}`;
    await dbRun(_sb.from("license_plates").insert({id,type:form.type,destination:form.destination,status:form.status,created_at:new Date().toISOString().slice(0,10),items,packing_slip_type:form.packing_slip_type||null,quote_number:form.quote_number||null,po_number:form.po_number||null,customer_id:form.customer_id||null,order_id:form.order_id||null}));   // errors surface instead of a silent no-op
    await logAudit("lp_create","license_plate",id,{type:form.type,destination:form.destination,packing_slip_type:form.packing_slip_type,quote_number:form.quote_number,po_number:form.po_number,items});
    return id;
  }
  // ── Packing lists loaded from QuickBooks slips (the source for an order's LP) ──
  async function savePackingList(orderId, listType, lines, meta={}){
    await dbRun(_sb.from("order_packing_lines").delete().eq("order_id",orderId).eq("list_type",listType));
    const rows=lines.map((l,i)=>({order_id:orderId,list_type:listType,line_no:i+1,part_id:l.partId,qty:+l.qty,printed_no:l.no||null,printed_desc:l.desc||null,slip_date:meta.slipDate||null,source_file:meta.file||null}));
    if(rows.length) await dbRun(_sb.from("order_packing_lines").insert(rows));
    await logAudit("packing_list_load","order",orderId,{list_type:listType,lines:rows.length,file:meta.file,slip_date:meta.slipDate});
    await fetchAll();
  }
  async function deletePackingList(orderId, listType){
    await dbRun(_sb.from("order_packing_lines").delete().eq("order_id",orderId).eq("list_type",listType));
    await logAudit("packing_list_delete","order",orderId,{list_type:listType});
    await fetchAll();
  }
  // ── Build a shipment LP from an order: control list x units (manufacturing) or its part/kit lines (maintenance) ──
  function buildOrderLpItems(order){
    const map=new Map(); const skipped=[];
    const add=(partId,qty,list)=>{
      const p=parts.find(x=>x.id===partId);
      if(!p){ skipped.push(partId); return; }
      const q=Math.ceil((+qty)||0); if(q<=0) return;
      const key=`${list}|${partId}`;
      if(map.has(key)){ map.get(key).qty+=q; return; }
      const links=p.suppliers||[];
      const direct=links.length>0&&links.every(x=>x.shipsDirect);
      const it={partId,qty:q,picked:0,list,box:"",source:direct?"direct":"warehouse",seq:map.size+1};
      if(direct){
        const sup=suppliers.find(x=>x.id===links[0].supplierId);
        it.supplier=sup?.name||links[0].supplierId; it.direct_status="To order";
      }
      map.set(key,it);
    };
    const pl=packingLines.filter(l=>l.order_id===order.id);
    if(pl.length>0){
      pl.forEach(l=>add(l.part_id,l.qty,l.list_type));
    } else if((order.order_type||"manufacturing")==="maintenance"){
      maintLines.filter(l=>l.order_id===order.id&&l.status!=="Cancelled").forEach(l=>{
        if(l.line_type==="part") add(l.part_id,l.qty,"Maintenance Parts");
        else kitLines.filter(k=>k.kit_id===l.kit_id).forEach(k=>add(k.part_id,k.qty*(+l.qty||1),maintKits.find(m=>m.id===l.kit_id)?.name||"Kit"));
      });
    } else {
      orderLines.filter(l=>l.order_id===order.id&&l.status!=="Cancelled").forEach(l=>{
        controlLines.filter(c=>c.vessel_model_id===l.vessel_model_id).forEach(c=>add(c.part_id,(+c.qty_per_unit)*(+l.units||1),c.list_type));
      });
    }
    const order_of=t=>{const i=packingSlipTypes.findIndex(x=>x.name===t);return i<0?99:i;};
    // Packing-list types in the app's order; within a list, lines stay in packing-slip order.
    const items=[...map.values()].sort((a,b)=>order_of(a.list)-order_of(b.list)||a.seq-b.seq).map(({seq,...it})=>it);
    return {items,skipped,fromPacking:pl.length>0};
  }
  async function createLpFromOrder(orderId){
    const order=orders.find(o=>o.id===orderId);
    if(!order) throw new Error("Order not found.");
    const {items,skipped,fromPacking}=buildOrderLpItems(order);
    if(items.length===0) throw new Error("Nothing to load: this order has no control-list lines (or no vessel/part lines yet).");
    const cust=customers.find(c=>c.id===order.customer_id);
    const id=await createLP({type:"Outbound",destination:[cust?.name,order.project_name].filter(Boolean).join(" - ")||order.id,status:"Open",quote_number:order.quote_number,po_number:order.po_number,customer_id:order.customer_id,order_id:order.id},items);
    await fetchAll();
    return {id,lines:items.length,direct:items.filter(i=>i.source==="direct").length,skipped,fromPacking};
  }
  // ── Picking into a license plate (shipping container) ─────────────────────
  // A pick removes stock from the TGO warehouse immediately. Stock is drawn from the
  // supplier-attributed rows first (preferred supplier first), then from any unassigned
  // remainder of parts.stock. Each pick records its source chunks so an undo, or a
  // cancelled LP, returns the stock exactly where it came from.
  // A part can sit on several lines of one LP (one per packing list). lineIdx targets one line exactly;
  // otherwise a scan fills the first warehouse line of that part that is not yet full.
  const pickable=i=>i.source!=="direct"&&!i.no_stock;
  async function pickLpItem(lpId, items, partId, qty=1, lineIdx=null){
    let idx=lineIdx!=null?lineIdx:items.findIndex(i=>i.partId===partId&&pickable(i)&&(i.picked||0)<i.qty);
    if(idx<0) idx=items.findIndex(i=>i.partId===partId&&pickable(i));
    if(idx<0) throw new Error("That part is not on this license plate.");
    const it=items[idx];
    const n=Math.min(Math.max(1,+qty||1), it.qty-(it.picked||0));
    if(n<=0) throw new Error("This line is already fully picked.");
    const {data:pr,error:pe}=await _sb.from("parts").select("stock,description").eq("id",partId).single();
    if(pe||!pr) throw new Error("Part not found.");
    const onHand=pr.stock||0;
    if(onHand<n) throw new Error(`Only ${onHand} of ${partId} in stock. Adjust the stock count, or leave the line short.`);
    const {data:rows}=await _sb.from("supplier_stock").select("supplier_id,qty").eq("part_id",partId);
    const pref=procurement.find(p=>p.part_id===partId)?.preferred_supplier_id;
    const src=(rows||[]).filter(r=>r.qty>0).sort((a,b)=>((b.supplier_id===pref)-(a.supplier_id===pref))||(b.qty-a.qty));
    let left=n; const taken=[];
    for(const r of src){
      if(left<=0) break;
      const t=Math.min(r.qty,left);
      await dbRun(_sb.from("supplier_stock").update({qty:r.qty-t,updated_at:new Date().toISOString()}).eq("part_id",partId).eq("supplier_id",r.supplier_id));
      taken.push({supplierId:r.supplier_id,qty:t}); left-=t;
    }
    if(left>0) taken.push({supplierId:null,qty:left});   // stock not attributed to a supplier
    await dbRun(_sb.from("parts").update({stock:onHand-n}).eq("id",partId));
    const next=items.map((x,i)=>i===idx?{...x,picked:(x.picked||0)+n,picks:[...(x.picks||[]),...taken]}:x);
    await dbRun(_sb.from("license_plates").update({items:next}).eq("id",lpId));
    await logAudit("stock_adjust","part",partId,{from:onHand,to:onHand-n,source:"lp_pick",license_plate:lpId,qty:n,taken});
    await fetchAll();
    return next;
  }
  // Put stock back where it came from. chunks = [{supplierId, qty}]
  async function restoreStock(partId, chunks, lpId, why){
    const total=chunks.reduce((s,c)=>s+c.qty,0);
    if(total<=0) return;
    const {data:pr}=await _sb.from("parts").select("stock").eq("id",partId).single();
    const onHand=pr?.stock||0;
    for(const c of chunks){
      if(!c.supplierId) continue;
      const {data:row}=await _sb.from("supplier_stock").select("qty").eq("part_id",partId).eq("supplier_id",c.supplierId).maybeSingle();
      await dbRun(_sb.from("supplier_stock").upsert({part_id:partId,supplier_id:c.supplierId,qty:(row?.qty||0)+c.qty,updated_at:new Date().toISOString()},{onConflict:"part_id,supplier_id"}));
    }
    await dbRun(_sb.from("parts").update({stock:onHand+total}).eq("id",partId));
    await logAudit("stock_adjust","part",partId,{from:onHand,to:onHand+total,source:why,license_plate:lpId,qty:total});
  }
  async function unpickLpItem(lpId, items, partId, qty=1, lineIdx=null){
    let idx=lineIdx!=null?lineIdx:-1;
    if(idx<0) for(let k=items.length-1;k>=0;k--) if(items[k].partId===partId&&pickable(items[k])&&(items[k].picked||0)>0){idx=k;break;}
    if(idx<0) idx=items.findIndex(i=>i.partId===partId&&pickable(i));
    if(idx<0) throw new Error("That part is not on this license plate.");
    const it=items[idx];
    const n=Math.min(Math.max(1,+qty||1), it.picked||0);
    if(n<=0) throw new Error("Nothing picked on this line to undo.");
    let left=n; const back=[]; const kept=[...(it.picks||[])];
    while(left>0&&kept.length){            // newest picks come back first
      const c=kept[kept.length-1]; const t=Math.min(c.qty,left);
      back.push({supplierId:c.supplierId,qty:t}); left-=t;
      if(t===c.qty) kept.pop(); else kept[kept.length-1]={...c,qty:c.qty-t};
    }
    await restoreStock(partId,back,lpId,"lp_unpick");
    const next=items.map((x,i)=>i===idx?{...x,picked:(x.picked||0)-n,picks:kept}:x);
    await dbRun(_sb.from("license_plates").update({items:next}).eq("id",lpId));
    await fetchAll();
    return next;
  }
  // Cancelled LP: every picked part goes back to stock. Returns the cleaned items.
  async function releasePicks(lpId, items){
    const out=[];
    for(const it of items||[]){
      if((it.picked||0)>0&&!it.no_stock&&it.source!=="direct") await restoreStock(it.partId,it.picks||[{supplierId:null,qty:it.picked}],lpId,"lp_cancel");
      out.push({...it,picked:0,picks:[]});
    }
    return out;
  }
  async function updateLPStatus(lpId,status,meta={}){
    const lp=lps.find(l=>l.id===lpId);
    const upd={status};
    if(status==="Cancelled"&&lp?.status!=="Cancelled") upd.items=await releasePicks(lpId,lp?.items);
    await dbRun(_sb.from("license_plates").update(upd).eq("id",lpId));
    await logAudit("lp_status","license_plate",lpId,{from:lp?.status,to:status,...meta});
  }
  async function updateLP(lpId, changes, meta={}) {
    const lp=lps.find(l=>l.id===lpId);
    if(changes.status==="Cancelled"&&lp?.status!=="Cancelled") changes={...changes,items:await releasePicks(lpId,changes.items||lp?.items)};
    await dbRun(_sb.from("license_plates").update(changes).eq("id",lpId));
    await logAudit("lp_edit","license_plate",lpId,{before:{type:lp?.type,destination:lp?.destination,items:lp?.items},after:changes,...meta});
  }
  async function addMfgBarcode(partId,supplierId,barcode,description){
    await _sb.from("mfg_barcodes").insert({part_id:partId,supplier_id:supplierId||null,barcode:barcode.trim(),description:description||null});
    await logAudit("barcode_add","part",partId,{barcode,supplier_id:supplierId});
  }
  async function deleteMfgBarcode(id){
    const mb=mfgBarcodes.find(m=>m.id===id);
    await _sb.from("mfg_barcodes").delete().eq("id",id);
    await logAudit("barcode_remove","part",mb?.part_id||"unknown",{barcode:mb?.barcode});
  }

  // Adjust stock per supplier — updates supplier_stock rows then recalculates parts.stock total
  // Physical count: set on-hand to what was counted, with a reason. A shortfall comes off the
  // stock not tied to a supplier first, then the largest supplier rows; an overage stays unassigned.
  async function countStock(partId, counted, {reason="Cycle count", note=""}={}){
    counted=Math.max(0,Math.round(+counted));
    if(!Number.isFinite(counted)) throw new Error("Enter the counted quantity.");
    const {data:pr,error}=await _sb.from("parts").select("stock").eq("id",partId).single();
    if(error) throw new Error(error.message);
    const before=pr?.stock||0; const delta=counted-before;
    if(delta<0){
      const {data:rows}=await _sb.from("supplier_stock").select("supplier_id,qty").eq("part_id",partId);
      const assigned=(rows||[]).reduce((s,r)=>s+(r.qty||0),0);
      let take=Math.max(0,-delta-Math.max(0,before-assigned));
      for(const r of (rows||[]).filter(r=>r.qty>0).sort((a,b)=>b.qty-a.qty)){
        if(take<=0) break;
        const t=Math.min(r.qty,take);
        await dbRun(_sb.from("supplier_stock").update({qty:r.qty-t,updated_at:new Date().toISOString()}).eq("part_id",partId).eq("supplier_id",r.supplier_id));
        take-=t;
      }
    }
    await dbRun(_sb.from("parts").update({stock:counted}).eq("id",partId));
    await logAudit("stock_adjust","part",partId,{from:before,to:counted,variance:delta,source:"count",reason,note:note||null});
    await fetchAll();
    return {before,counted,delta};
  }
  async function adjustSupplierStock(partId, adjustments, {reason="Correction", note=""}={}) {
    const {data:pr}=await _sb.from("parts").select("stock").eq("id",partId).single();
    const {data:prev}=await _sb.from("supplier_stock").select("qty").eq("part_id",partId);
    const unassigned=Math.max(0,(pr?.stock||0)-(prev||[]).reduce((s,r)=>s+(r.qty||0),0));   // kept, not wiped
    for (const adj of adjustments) {
      await _sb.from("supplier_stock").upsert(
        {part_id:partId, supplier_id:adj.supplierId, qty:Math.max(0,adj.qty), updated_at:new Date().toISOString()},
        {onConflict:"part_id,supplier_id"}
      );
    }
    const {data:rows} = await _sb.from("supplier_stock").select("qty").eq("part_id",partId);
    const total = (rows||[]).reduce((sum,r)=>sum+(r.qty||0),0)+unassigned;
    await dbRun(_sb.from("parts").update({stock:total}).eq("id",partId));
    await logAudit("stock_adjust","part",partId,{from:pr?.stock,to:total,variance:total-(pr?.stock||0),adjustments,unassigned,source:"supplier_split",reason,note:note||null});
    await fetchAll();
  }

  async function addPackingSlipType(name){
    await _sb.from("packing_slip_types").insert({name,sort_order:packingSlipTypes.length+1});
    await logAudit("packing_slip_type_add","packing_slip_types",name,{name});
  }
  async function addCustomer(form){
    const {data,error} = await _sb.from("customers").insert({
      name:form.name, contact:form.contact, phone:form.phone, email:form.email,
      address_line1:form.address_line1, address_line2:form.address_line2,
      city:form.city, state:form.state, zip:form.zip
    }).select().single();
    if(error) throw new Error(error.message);
    await logAudit("customer_add","customer",data.id,{name:form.name});
    return data;
  }
  async function updateCustomer(id,form){
    await _sb.from("customers").update({
      name:form.name, contact:form.contact, phone:form.phone, email:form.email,
      address_line1:form.address_line1, address_line2:form.address_line2,
      city:form.city, state:form.state, zip:form.zip
    }).eq("id",id);
    await logAudit("customer_edit","customer",id,{name:form.name});
  }
  async function deleteCustomer(id){
    await _sb.from("customers").delete().eq("id",id);
    await logAudit("customer_delete","customer",id,{});
  }

  // ── Replenishment / orders / purchase orders ────────────────────────────────
  // Every action writes, logs to the audit trail, then refreshes so the UI updates
  // immediately (these tables may not be in the realtime publication).
  const dbRun = async (q) => { const {error} = await q; if(error) throw new Error(error.message); };
  const newId = (prefix) => `${prefix}-${new Date().toISOString().slice(0,10).replace(/-/g,"")}-${Math.random().toString(36).slice(2,6).toUpperCase()}`;
  const slugId = (prefix,name) => `${prefix}-${name.trim().toUpperCase().replace(/[^A-Z0-9]+/g,"-").replace(/^-|-$/g,"")}`;
  const numOrNull = (v) => (v===""||v===null||v===undefined||isNaN(+v)) ? null : +v;

  async function saveVesselModel(form){
    const id = form.id || slugId("VM",form.name);
    await dbRun(_sb.from("vessel_models").upsert({id,name:form.name.trim(),description:form.description||null}));
    await logAudit(form.id?"vessel_model_edit":"vessel_model_add","vessel_model",id,{name:form.name});
    await fetchAll(); return id;
  }
  async function deleteVesselModel(id){
    await dbRun(_sb.from("vessel_models").delete().eq("id",id));
    await logAudit("vessel_model_delete","vessel_model",id,{}); await fetchAll();
  }
  async function saveControlLine(l){
    const same=controlLines.filter(c=>c.vessel_model_id===l.vessel_model_id&&c.list_type===l.list_type);
    const lineNo=l.line_no??same.find(c=>c.part_id===l.part_id)?.line_no??(Math.max(0,...same.map(c=>+c.line_no||0))+1);
    await dbRun(_sb.from("control_list_lines").upsert({vessel_model_id:l.vessel_model_id,list_type:l.list_type,part_id:l.part_id,qty_per_unit:+l.qty_per_unit,line_no:lineNo},{onConflict:"vessel_model_id,list_type,part_id"}));
    await logAudit("control_line_save","vessel_model",l.vessel_model_id,{list_type:l.list_type,part_id:l.part_id,qty_per_unit:+l.qty_per_unit}); await fetchAll();
  }
  // Import control lists. groups: [{mName, lName, modelId|null, lines:[{partId, qty, notes}]}], in file order.
  async function importControlLists(groups,{mode="replace",newTypes=[]}={}){
    let models=0, lines=0, removed=0;
    for(const name of newTypes){ if(!packingSlipTypes.some(t=>t.name.toLowerCase()===name.toLowerCase())) await addPackingSlipType(name); }
    const made=new Map();
    for(const g of groups){
      let modelId=g.modelId||made.get(g.mName.toLowerCase());
      if(!modelId){
        modelId=slugId("VM",g.mName);
        await dbRun(_sb.from("vessel_models").upsert({id:modelId,name:g.mName.trim()}));
        made.set(g.mName.toLowerCase(),modelId); models++;
      }
      if(mode==="replace"){
        const keep=g.lines.map(l=>l.partId);
        const {data:gone}=await _sb.from("control_list_lines").select("id,part_id").eq("vessel_model_id",modelId).eq("list_type",g.lName);
        const del=(gone||[]).filter(r=>!keep.includes(r.part_id));
        if(del.length){ await dbRun(_sb.from("control_list_lines").delete().in("id",del.map(r=>r.id))); removed+=del.length; }
      }
      const base=mode==="merge"?Math.max(0,...controlLines.filter(c=>c.vessel_model_id===modelId&&c.list_type===g.lName&&!g.lines.some(l=>l.partId===c.part_id)).map(c=>+c.line_no||0)):0;
      const rows=g.lines.map((l,i)=>({vessel_model_id:modelId,list_type:g.lName,part_id:l.partId,qty_per_unit:+l.qty,notes:l.notes||null,line_no:base+i+1}));
      await dbRun(_sb.from("control_list_lines").upsert(rows,{onConflict:"vessel_model_id,list_type,part_id"}));
      lines+=rows.length;
      await logAudit("control_list_import","vessel_model",modelId,{list_type:g.lName,mode,lines:rows.length});
    }
    await fetchAll();
    return {groups:groups.length,lines,models,removed};
  }
  async function deleteControlLine(line){
    await dbRun(_sb.from("control_list_lines").delete().eq("id",line.id));
    await logAudit("control_line_delete","vessel_model",line.vessel_model_id,{list_type:line.list_type,part_id:line.part_id}); await fetchAll();
  }
  async function saveKit(form){
    const id = form.id || slugId("KIT",form.name);
    await dbRun(_sb.from("maintenance_kits").upsert({id,name:form.name.trim(),description:form.description||null}));
    await logAudit(form.id?"kit_edit":"kit_add","kit",id,{name:form.name}); await fetchAll(); return id;
  }
  async function deleteKit(id){
    await dbRun(_sb.from("maintenance_kits").delete().eq("id",id));
    await logAudit("kit_delete","kit",id,{}); await fetchAll();
  }
  async function saveKitLine(l){
    await dbRun(_sb.from("maintenance_kit_lines").upsert({kit_id:l.kit_id,part_id:l.part_id,qty:+l.qty},{onConflict:"kit_id,part_id"}));
    await logAudit("kit_line_save","kit",l.kit_id,{part_id:l.part_id,qty:+l.qty}); await fetchAll();
  }
  async function deleteKitLine(line){
    await dbRun(_sb.from("maintenance_kit_lines").delete().eq("id",line.id));
    await logAudit("kit_line_delete","kit",line.kit_id,{part_id:line.part_id}); await fetchAll();
  }
  async function updateListType(id,changes){
    await dbRun(_sb.from("packing_slip_types").update(changes).eq("id",id));
    await logAudit("list_type_edit","packing_slip_types",id,changes); await fetchAll();
  }

  async function createOrder(form){
    const id = newId("ORD");
    await dbRun(_sb.from("orders").insert({id,order_type:form.order_type,customer_id:form.customer_id||null,quote_number:form.quote_number||null,po_number:form.po_number||null,project_name:form.project_name||null,notes:form.notes||null,status:"Open",created_by:getCurrentUser()?.id||null}));
    await logAudit("order_create","order",id,{order_type:form.order_type,quote_number:form.quote_number,po_number:form.po_number,project_name:form.project_name});
    await fetchAll(); return id;
  }
  async function updateOrder(id,changes){
    await dbRun(_sb.from("orders").update(changes).eq("id",id));
    await logAudit("order_edit","order",id,changes); await fetchAll();
  }
  async function deleteOrder(id){
    await dbRun(_sb.from("orders").delete().eq("id",id));
    await logAudit("order_delete","order",id,{}); await fetchAll();
  }
  async function addOrderLine(f){
    await dbRun(_sb.from("order_lines").insert({order_id:f.order_id,vessel_model_id:f.vessel_model_id,units:+f.units||1,paint_start_date:f.paint_start_date||null,ship_date:f.ship_date||null,status:f.status||"PO Signed",notes:f.notes||null}));
    await logAudit("order_line_add","order",f.order_id,{vessel_model_id:f.vessel_model_id,units:+f.units||1,paint_start_date:f.paint_start_date}); await fetchAll();
  }
  async function updateOrderLine(line,changes){
    await dbRun(_sb.from("order_lines").update(changes).eq("id",line.id));
    await logAudit("order_line_edit","order",line.order_id,{line_id:line.id,vessel_model_id:line.vessel_model_id,before:Object.fromEntries(Object.keys(changes).map(k=>[k,line[k]])),after:changes}); await fetchAll();
  }
  async function deleteOrderLine(line){
    await dbRun(_sb.from("order_lines").delete().eq("id",line.id));
    await logAudit("order_line_delete","order",line.order_id,{line_id:line.id,vessel_model_id:line.vessel_model_id}); await fetchAll();
  }
  async function addMaintLine(f){
    await dbRun(_sb.from("maintenance_order_lines").insert({order_id:f.order_id,line_type:f.line_type,part_id:f.line_type==="part"?f.part_id:null,kit_id:f.line_type==="kit"?f.kit_id:null,qty:+f.qty,needed_by:f.needed_by||null,notes:f.notes||null}));
    await logAudit("maint_line_add","order",f.order_id,{line_type:f.line_type,part_id:f.part_id,kit_id:f.kit_id,qty:+f.qty,needed_by:f.needed_by}); await fetchAll();
  }
  async function updateMaintLine(line,changes){
    await dbRun(_sb.from("maintenance_order_lines").update(changes).eq("id",line.id));
    await logAudit("maint_line_edit","order",line.order_id,{line_id:line.id,before:Object.fromEntries(Object.keys(changes).map(k=>[k,line[k]])),after:changes}); await fetchAll();
  }
  async function deleteMaintLine(line){
    await dbRun(_sb.from("maintenance_order_lines").delete().eq("id",line.id));
    await logAudit("maint_line_delete","order",line.order_id,{line_id:line.id}); await fetchAll();
  }

  async function saveProcurement(partId,f){
    const row = {
      part_id:partId, policy:f.policy||"order_driven",
      preferred_supplier_id:f.preferred_supplier_id||null, backup_supplier_id:f.backup_supplier_id||null,
      lead_time_days:numOrNull(f.lead_time_days), lead_buffer_days:numOrNull(f.lead_buffer_days)??0,
      service_level:numOrNull(f.service_level)??0.95, moq:numOrNull(f.moq)??1, order_multiple:numOrNull(f.order_multiple)??1,
      manual_monthly_usage:numOrNull(f.manual_monthly_usage)??0, min_qty:numOrNull(f.min_qty), max_qty:numOrNull(f.max_qty),
      review_interval_days:numOrNull(f.review_interval_days), notes:f.notes||null, updated_at:new Date().toISOString(),
    };
    await dbRun(_sb.from("part_procurement").upsert(row));
    await logAudit("procurement_save","part",partId,{policy:row.policy,preferred_supplier_id:row.preferred_supplier_id,moq:row.moq,order_multiple:row.order_multiple,service_level:row.service_level});
    await fetchAll();
  }

  async function createPurchaseOrder({supplier_id,notes,lines}){
    const id = newId("PO");
    await dbRun(_sb.from("purchase_orders").insert({id,supplier_id,status:"Draft",notes:notes||null,created_by:getCurrentUser()?.id||null}));
    await dbRun(_sb.from("purchase_order_lines").insert(lines.map(l=>({po_id:id,part_id:l.part_id,qty:+l.qty,unit_cost:l.unit_cost??null,mfg_part_no:l.mfg_part_no||null,needed_by:l.needed_by||null,source_orders:l.source_orders||[]}))));
    await logAudit("po_create","purchase_order",id,{supplier_id,lines:lines.map(l=>({part_id:l.part_id,qty:l.qty}))});
    await fetchAll(); return id;
  }
  async function updatePurchaseOrder(id,changes){
    const po = purchaseOrders.find(p=>p.id===id);
    await dbRun(_sb.from("purchase_orders").update(changes).eq("id",id));
    await logAudit(changes.status&&changes.status!==po?.status?"po_status":"po_edit","purchase_order",id,{before:Object.fromEntries(Object.keys(changes).map(k=>[k,po?.[k]])),after:changes}); await fetchAll();
  }
  async function deletePurchaseOrder(id){
    await dbRun(_sb.from("purchase_orders").delete().eq("id",id));
    await logAudit("po_delete","purchase_order",id,{}); await fetchAll();
  }
  // Receive stock with no PO (found stock, returns, deliveries not entered as a PO).
  async function receiveWithoutPo(partId,qty,{supplierId=null,upc=null}={}){
    qty=+qty;
    if(!(qty>0)) throw new Error("Enter a quantity greater than zero.");
    const {data:p,error}=await _sb.from("parts").select("stock").eq("id",partId).single();
    if(error) throw new Error(error.message);
    const before=p?.stock||0;
    await dbRun(_sb.from("parts").update({stock:before+qty}).eq("id",partId));
    if(supplierId){
      const {data:row}=await _sb.from("supplier_stock").select("qty").eq("part_id",partId).eq("supplier_id",supplierId).maybeSingle();
      await dbRun(_sb.from("supplier_stock").upsert({part_id:partId,supplier_id:supplierId,qty:(row?.qty||0)+qty,updated_at:new Date().toISOString()},{onConflict:"part_id,supplier_id"}));
    }
    const sup=suppliers.find(s=>s.id===supplierId);
    await logAudit("stock_adjust","part",partId,{from:before,to:before+qty,source:"receive_no_po",qty_received:qty,supplier_id:supplierId,supplier_name:sup?.name||null,upc});
    await fetchAll();
  }
  // Receive qty against a PO line: bumps parts.stock and the supplier's own stock row, then rolls up PO status.
  async function receivePoLine(po,line,qty){
    qty = +qty;
    if(!(qty>0)) throw new Error("Enter a quantity greater than zero.");
    await dbRun(_sb.from("purchase_order_lines").update({qty_received:(+line.qty_received||0)+qty}).eq("id",line.id));
    const {data:p} = await _sb.from("parts").select("stock").eq("id",line.part_id).single();
    const before = p?.stock||0;
    await dbRun(_sb.from("parts").update({stock:before+qty}).eq("id",line.part_id));
    if(po.supplier_id){
      const {data:row} = await _sb.from("supplier_stock").select("qty").eq("part_id",line.part_id).eq("supplier_id",po.supplier_id).maybeSingle();
      await dbRun(_sb.from("supplier_stock").upsert({part_id:line.part_id,supplier_id:po.supplier_id,qty:(row?.qty||0)+qty,updated_at:new Date().toISOString()},{onConflict:"part_id,supplier_id"}));
    }
    const {data:all} = await _sb.from("purchase_order_lines").select("qty,qty_received").eq("po_id",po.id);
    const done = (all||[]).every(l=>(+l.qty_received||0)>=+l.qty);
    const any = (all||[]).some(l=>(+l.qty_received||0)>0);
    const status = done ? "Received" : any ? "Partially Received" : po.status;
    if(status!==po.status) await dbRun(_sb.from("purchase_orders").update({status}).eq("id",po.id));
    await logAudit("stock_adjust","part",line.part_id,{from:before,to:before+qty,source:"po_receive",po_id:po.id,qty_received:qty,supplier_id:po.supplier_id});
    await fetchAll();
  }

  return {fabricators,parts,suppliers,lps,mfgBarcodes,supplierStock,packingSlipTypes,customers,
    vesselModels,controlLines,orders,orderLines,packingLines,maintKits,kitLines,maintLines,procurement,purchaseOrders,poLines,
    loading,error,actions:{savePackingList,deletePackingList,addPart,updateStock,adjustSupplierStock,countStock,addSupplier,linkSupplier,unlinkSupplier,createLP,createLpFromOrder,updateLPStatus,updateLP,pickLpItem,unpickLpItem,addMfgBarcode,deleteMfgBarcode,uploadPartImage,removePartImage,addPackingSlipType,addCustomer,updateCustomer,deleteCustomer,
      saveVesselModel,deleteVesselModel,saveControlLine,deleteControlLine,importControlLists,saveKit,deleteKit,saveKitLine,deleteKitLine,updateListType,
      createOrder,updateOrder,deleteOrder,addOrderLine,updateOrderLine,deleteOrderLine,addMaintLine,updateMaintLine,deleteMaintLine,
      saveProcurement,createPurchaseOrder,updatePurchaseOrder,deletePurchaseOrder,receivePoLine,receiveWithoutPo}};
}

// ─── Camera Scanner ───────────────────────────────────────────────────────────
// ─── Barcode decoder (shared by every camera view) ───────────────────────────
// Returns async (canvas) => string|null. Built once per page load.
const NATIVE_FORMATS=["code_128","code_39","ean_13","ean_8","qr_code","upc_a","upc_e","itf","codabar"];
let _decoderPromise=null;
function getBarcodeDecoder(){
  if(_decoderPromise) return _decoderPromise;
  _decoderPromise=(async()=>{
    if("BarcodeDetector" in window){
      try{
        const supported=await window.BarcodeDetector.getSupportedFormats?.()||NATIVE_FORMATS;
        const formats=NATIVE_FORMATS.filter(f=>supported.includes(f));
        if(formats.includes("code_128")){
          const bd=new window.BarcodeDetector({formats});
          return async(canvas)=>{ const rs=await bd.detect(canvas); return rs.length?rs[0].rawValue.trim():null; };
        }
      }catch(_){}
    }
    try{
      const Z=await import("@zxing/library");
      const hints=new Map();
      hints.set(Z.DecodeHintType.POSSIBLE_FORMATS,[Z.BarcodeFormat.CODE_128,Z.BarcodeFormat.CODE_39,Z.BarcodeFormat.EAN_13,Z.BarcodeFormat.EAN_8,
        Z.BarcodeFormat.UPC_A,Z.BarcodeFormat.UPC_E,Z.BarcodeFormat.ITF,Z.BarcodeFormat.CODABAR,Z.BarcodeFormat.QR_CODE]);
      hints.set(Z.DecodeHintType.TRY_HARDER,true);
      const reader=new Z.MultiFormatReader(); reader.setHints(hints);
      return async(canvas)=>{
        try{
          const bmp=new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.HTMLCanvasElementLuminanceSource(canvas)));
          return reader.decodeWithState(bmp).getText().trim();
        }catch(_){ return null; }        // NotFoundException = nothing in this frame
        finally{ reader.reset(); }
      };
    }catch(_){ return null; }
  })();
  return _decoderPromise;
}

function CameraScanner({ onScan, onClose, hint="" }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef   = useRef(null);
  const lastRef   = useRef("");
  const missRef   = useRef(0);
  const onScanRef = useRef(onScan);
  onScanRef.current = onScan;          // the decode loop always calls the latest handler
  const [status,   setStatus]   = useState("starting");
  const [errMsg,   setErrMsg]   = useState("");
  const [lastScan, setLastScan] = useState("");

  useEffect(()=>{
    let cancelled = false;

    async function start(){
      // 1. Get camera stream
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video:{ facingMode:{ ideal:"environment" } }, audio:false
        });
      } catch(e){
        if(!cancelled){
          setStatus("error");
          setErrMsg(e.name==="NotAllowedError"
            ? (/iPhone|iPad|iPod/.test(navigator.userAgent)
                ? "Camera blocked. Tap aA in the address bar → Website Settings → Camera → Allow, then reload."
                : "Camera blocked. Tap the lock icon in the address bar → Permissions → Camera → Allow, then reload.")
            : "Camera error: "+e.message);
        }
        return;
      }
      if(cancelled){ stream.getTracks().forEach(t=>t.stop()); return; }
      streamRef.current = stream;

      // 2. Show video
      const video = videoRef.current;
      if(!video) return;
      video.srcObject = stream;
      await new Promise(res=>{ video.onloadedmetadata=()=>video.play().then(res).catch(res); });
      if(cancelled) return;
      setStatus("scanning");

      // 3. Settle
      await new Promise(res=>setTimeout(res,600));
      if(cancelled) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext("2d",{willReadFrequently:true});

      // 4. Decoder — native BarcodeDetector where it exists (Android Chrome),
      //    otherwise ZXing (iPhone/iPad Safari, Firefox, desktop Safari).
      const decoder = await getBarcodeDecoder();
      if(cancelled) return;
      if(!decoder){ setStatus("error"); setErrMsg("This browser cannot read barcodes. Type the code in the box below."); return; }

      async function decode(){
        if(cancelled) return;
        try {
          // Draw frame (scaled so ZXing stays fast on phones)
          let ok = false;
          const vw=video.videoWidth||1280, vh=video.videoHeight||720;
          const scale=Math.min(1, 1280/Math.max(vw,vh));
          canvas.width=Math.round(vw*scale); canvas.height=Math.round(vh*scale);
          try { ctx.drawImage(video,0,0,canvas.width,canvas.height); ok=true; } catch(_){}

          if(ok){
            let decoded = null;
            try { decoded = await decoder(canvas); } catch(_){}

            // Same code won't fire twice while it stays in view. Once it has been
            // out of view ~1.5 s it can be scanned again (e.g. picking qty 2 one at a time).
            if(!decoded){ missRef.current++; if(missRef.current>=6) lastRef.current=""; }
            else missRef.current=0;
            if(decoded && decoded!==lastRef.current){
              lastRef.current = decoded;
              setLastScan(decoded);
              if(navigator.vibrate) navigator.vibrate(80);
              onScanRef.current(decoded);
            }
          }
        } catch(_){}
        if(!cancelled) loopRef.current = setTimeout(decode,250);
      }

      decode();
    }

    start();
    return ()=>{
      cancelled=true;
      clearTimeout(loopRef.current);
      streamRef.current?.getTracks().forEach(t=>t.stop());
    };
  },[]);


  return (
    <div style={{display:"flex",flexDirection:"column",gap:10}}>
      <canvas ref={canvasRef} style={{display:"none"}}/>
      <div style={{position:"relative",background:"#000",borderRadius:10,overflow:"hidden",aspectRatio:"4/3"}}>
        <video ref={videoRef} playsInline muted autoPlay style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}}/>
        {status==="scanning"&&<>
          {[{t:16,l:16,bt:"top",bl:"left"},{t:16,r:16,bt:"top",bl:"right"},{b:16,l:16,bt:"bottom",bl:"left"},{b:16,r:16,bt:"bottom",bl:"right"}].map((pos,i)=>(
            <div key={i} style={{position:"absolute",...pos,width:28,height:28,
              borderTop:pos.bt==="top"?`3px solid ${C.amber}`:"none",
              borderBottom:pos.bt==="bottom"?`3px solid ${C.amber}`:"none",
              borderLeft:pos.bl==="left"?`3px solid ${C.amber}`:"none",
              borderRight:pos.bl==="right"?`3px solid ${C.amber}`:"none"}}/>
          ))}
          <div style={{position:"absolute",left:28,right:28,height:2,background:C.amber,opacity:.9,animation:"scanline 2s ease-in-out infinite"}}/>
          <style>{`@keyframes scanline{0%,100%{top:20%}50%{top:80%}}`}</style>
          <div style={{position:"absolute",top:8,left:0,right:0,textAlign:"center"}}>
            <span style={{background:"rgba(28,43,58,.75)",color:C.amber,fontSize:11,fontWeight:700,padding:"3px 12px",borderRadius:10}}>SCANNING</span>
          </div>
        </>}
        {status==="starting"&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:12,background:"rgba(0,0,0,.65)"}}>
          <div style={{width:36,height:36,border:`3px solid ${C.amber}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
          <span style={{color:"#fff",fontSize:13}}>Starting camera…</span>
        </div>}
        {status==="error"&&<div style={{position:"absolute",inset:0,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:10,padding:20,background:"rgba(0,0,0,.85)"}}>
          <span style={{fontSize:32}}>📵</span>
          <span style={{color:"#fff",fontSize:12,textAlign:"center",lineHeight:1.5}}>{errMsg}</span>
        </div>}
        {lastScan&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(28,43,58,.9)",padding:"10px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:18}}>✅</span>
          <span style={{color:"#fff",fontFamily:"monospace",fontSize:13,fontWeight:700}}>{lastScan}</span>
        </div>}
      </div>
      {hint&&<div style={{background:C.amberLight,border:`1px solid ${C.amberBdr}`,borderRadius:6,padding:"10px 14px",fontSize:12,color:C.warnText,display:"flex",gap:8,alignItems:"center"}}><span>💡</span><span>{hint}</span></div>}
      <Btn variant="outline" onClick={onClose} style={{justifyContent:"center"}}>Close Camera</Btn>
    </div>
  );
}

// ─── Part numbers ─────────────────────────────────────────────────────────────
// Primary id = "CT-" + new part number (e.g. CT-5100). The old number is kept as legacy_part_no.
// Parts still waiting for a new number keep CT-<old number> and show a Pending flag (old CT-BC-#### labels still scan).
const PART_PREFIX = "CT-";
function findPartsByCode(parts, raw){
  const t=(raw||"").trim().toUpperCase();
  if(!t) return [];
  const exact=parts.find(x=>x.id.toUpperCase()===t);
  if(exact) return [exact];
  const out=[];
  const add=p=>{ if(!out.includes(p)) out.push(p); };
  parts.filter(x=>x.new_part_no&&String(x.new_part_no).toUpperCase()===t).forEach(add);
  parts.filter(x=>x.legacy_part_no&&(String(x.legacy_part_no).toUpperCase()===t||`CT-${x.legacy_part_no}`.toUpperCase()===t||`CT-BC-${x.legacy_part_no}`.toUpperCase()===t)).forEach(add);
  return out;
}
function findPartByCode(parts, raw){
  const r=findPartsByCode(parts,raw);
  return r.length===1?r[0]:null;
}
function matchKind(p, raw){
  const t=(raw||"").trim().toUpperCase().replace(/^CT-(BC-)?/,"");
  if(p.new_part_no&&String(p.new_part_no).toUpperCase()===t) return "matches NEW #";
  if(p.legacy_part_no&&String(p.legacy_part_no).toUpperCase()===t) return "matches OLD #";
  return "";
}
function PartChooser({ code, choices, onPick, onCancel }){
  return <div style={{background:"#fffbeb",border:"1px solid #f59e0b",borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontSize:13,fontWeight:700,marginBottom:6}}>⚠ "{code}" matches more than one part. Which one?</div>
    {choices.map(p=><button key={p.id} onClick={()=>onPick(p)} style={{display:"block",width:"100%",textAlign:"left",marginBottom:6,padding:"8px 10px",border:`1px solid ${C.border}`,borderRadius:6,background:"#fff",cursor:"pointer"}}>
      <div style={{fontFamily:"monospace",fontWeight:700}}>{p.id} <span style={{fontWeight:400,fontSize:11,color:C.textLight}}>{matchKind(p,code)}</span></div>
      <div style={{fontSize:12}}>{p.description}</div>
      <LegacyNote p={p}/>
    </button>)}
    <button onClick={onCancel} style={{fontSize:12,background:"none",border:"none",color:C.textLight,cursor:"pointer"}}>Cancel</button>
  </div>;
}
function partMatchesSearch(p, q){
  const s=(q||"").toLowerCase();
  if(!s) return true;
  return [p.id,p.new_part_no,p.legacy_part_no,p.description].some(v=>(v||"").toString().toLowerCase().includes(s));
}
function LegacyNote({ p }){
  if(!p) return null;
  return <span style={{fontSize:11,color:C.textLight,fontFamily:"monospace"}}>
    {p.legacy_part_no?`Old #${p.legacy_part_no}`:""}{p.new_no_pending?`${p.legacy_part_no?" · ":""}New # pending`:""}
  </span>;
}

// ─── Manual Entry ─────────────────────────────────────────────────────────────
function ManualEntry({ onSubmit }) {
  const [val,setVal]=useState("");
  function submit(){const t=val.trim().toUpperCase();if(t){onSubmit(t);setVal("");}}
  return (
    <div style={{display:"flex",gap:8}}>
      <input value={val} onChange={e=>setVal(e.target.value)} onKeyDown={e=>e.key==="Enter"&&submit()}
        placeholder="Type part no. e.g. CT-5100" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
        style={{...inputStyle,flex:1,fontFamily:"monospace",textTransform:"uppercase"}}/>
      <Btn variant="outline" onClick={submit}>Go</Btn>
    </div>
  );
}

// ─── Lookup Result ────────────────────────────────────────────────────────────
function LookupResult({ result, parts, suppliers, onClear, replenByPart }) {
  const live=parts.find(x=>x.id===result.data.id)||result.data;
  const st=stockStatus(live,replenByPart?.get(live.id));
  return (
    <div style={{display:"grid",gap:14}}>
      <div style={{display:"flex",justifyContent:"center",background:C.offWhite,borderRadius:8,padding:16}}>
        <BarcodeDisplay code={live.id} size="lg"/>
        <div style={{marginTop:6,textAlign:"center"}}><LegacyNote p={live}/></div>
      </div>
      <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:16}}>
        <div style={{fontWeight:800,fontSize:16,color:C.navy,marginBottom:8}}>{live.description}</div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10}}>
          {[["Category",<Badge color="navy">{live.category}</Badge>],
            ["Location",<code style={{fontSize:13}}>{live.location}</code>],
            ["On Hand",<span style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:C.navy}}>{live.stock} {live.uom}</span>],
            ["Status",<Badge color={st.color}>{st.label}</Badge>]
          ].map(([l,v])=>(
            <div key={l}><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>{l}</div>{v}</div>
          ))}
        </div>
      </div>
      {live.suppliers?.map((s,i)=>{
        const sup=suppliers.find(x=>x.id===s.supplierId);
        return <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
          <div style={{fontWeight:700,color:C.navy}}>{sup?.name}</div>
          <div style={{fontFamily:"monospace",fontSize:12,color:C.textMid,marginTop:2}}>{s.mfgPartNo} · ${s.unitCost?.toFixed(2)}/{live.uom} · {s.leadDays}d lead</div>
        </div>;
      })}
      <Btn variant="outline" onClick={onClear} style={{justifyContent:"center"}}>Scan Another</Btn>
    </div>
  );
}

// ─── Receive Result ───────────────────────────────────────────────────────────
function ReceiveResult({ result, parts, suppliers, mfgBarcodes, lastScanned, receiveQty, setReceiveQty, saving, onBack, onConfirm, purchaseOrders=[], poLines=[] }) {
  const live=parts.find(x=>x.id===result.data.id)||result.data;
  const mfgMatch=lastScanned?mfgBarcodes.find(m=>m.barcode.toUpperCase()===lastScanned.toUpperCase()):null;
  const sup=mfgMatch?suppliers.find(s=>s.id===mfgMatch.supplier_id):null;
  const supName=id=>suppliers.find(s=>s.id===id)?.name||id||"No supplier";
  // Open PO lines for this part. The scanned product barcode's supplier comes first, then the earliest expected.
  const openLines=useMemo(()=>{
    const open=new Map(purchaseOrders.filter(p=>["Sent","Partially Received"].includes(p.status)).map(p=>[p.id,p]));
    return poLines.filter(l=>l.part_id===live.id&&open.has(l.po_id)&&(+l.qty-(+l.qty_received||0))>0)
      .map(l=>({line:l,po:open.get(l.po_id),out:+l.qty-(+l.qty_received||0)}))
      .sort((a,b)=>((b.po.supplier_id===sup?.id)-(a.po.supplier_id===sup?.id))||String(a.po.expected_date||"9999").localeCompare(String(b.po.expected_date||"9999")));
  },[purchaseOrders,poLines,live.id,sup?.id]);
  const [choice,setChoice]=useState(null);           // line id, or "none"
  const [noPoSupplier,setNoPoSupplier]=useState(sup?.id||"");
  useEffect(()=>{                                     // default: the first open PO line, received in full
    if(openLines.length){ setChoice(openLines[0].line.id); setReceiveQty(openLines[0].out); }
    else setChoice("none");
  },[openLines.length]);
  const sel=openLines.find(o=>o.line.id===choice);
  const partSup=live.suppliers?.find(s=>s.supplierId===(sel?sel.po.supplier_id:noPoSupplier));
  const unitCost=sel?.line.unit_cost??partSup?.unitCost;
  const over=sel?Math.max(0,+receiveQty-sel.out):0;
  function pick(id){ setChoice(id); const o=openLines.find(x=>x.line.id===id); if(o) setReceiveQty(o.out); }
  const opt=(active)=>({display:"flex",gap:10,alignItems:"flex-start",textAlign:"left",width:"100%",padding:"10px 12px",borderRadius:8,cursor:"pointer",
    border:`2px solid ${active?C.navy:C.border}`,background:active?"#EEF3F8":C.white,font:"inherit",color:C.navy,minHeight:48});
  return (
    <div style={{display:"grid",gap:14}}>
      <div style={{background:C.white,border:`2px solid ${C.amber}`,borderRadius:8,padding:16}}>
        <div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>Receiving into</div>
        <div style={{fontFamily:"monospace",fontSize:13,color:C.amber,fontWeight:700}}>{live.id}</div>
        <div style={{fontWeight:700,fontSize:15,color:C.navy,marginTop:2}}>{live.description}</div>
        <div style={{display:"flex",gap:16,marginTop:8,flexWrap:"wrap"}}>
          <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Current Stock</div><div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:C.navy}}>{live.stock} {live.uom}</div></div>
          <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Location</div><div style={{fontFamily:"monospace",fontSize:14,color:C.navy}}>{live.location||"—"}</div></div>
          {mfgMatch&&<div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Scanned product barcode</div><div style={{fontSize:13,color:C.navy}}><span style={{fontFamily:"monospace"}}>{mfgMatch.barcode}</span>{sup?` · ${sup.name}`:""}</div></div>}
        </div>
      </div>

      <div style={{display:"grid",gap:8}}>
        <div style={{fontSize:12,fontWeight:800,color:C.navy,textTransform:"uppercase",letterSpacing:.6}}>Receive against</div>
        {openLines.map(o=><button key={o.line.id} onClick={()=>pick(o.line.id)} style={opt(choice===o.line.id)}>
          <span style={{fontSize:18,lineHeight:"20px"}}>{choice===o.line.id?"◉":"○"}</span>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:"block",fontWeight:800,fontSize:14}}><span style={{fontFamily:"monospace"}}>{o.po.id}</span> · {supName(o.po.supplier_id)}{o.po.supplier_id&&o.po.supplier_id===sup?.id?" ✓":""}</span>
            <span style={{display:"block",fontSize:12,color:C.textMid}}>{o.out} outstanding of {o.line.qty}{+o.line.qty_received?` (${o.line.qty_received} already received)`:""}{o.po.expected_date?` · expected ${fmtDate(o.po.expected_date)}`:""}</span>
          </span>
        </button>)}
        <button onClick={()=>setChoice("none")} style={opt(choice==="none")}>
          <span style={{fontSize:18,lineHeight:"20px"}}>{choice==="none"?"◉":"○"}</span>
          <span style={{flex:1,minWidth:0}}>
            <span style={{display:"block",fontWeight:800,fontSize:14}}>No purchase order</span>
            <span style={{display:"block",fontSize:12,color:C.textMid}}>{openLines.length?"Found stock, a return, or a delivery with no PO in the app.":"There are no open POs for this part. Stock is added without a PO."}</span>
          </span>
        </button>
        {choice==="none"&&(live.suppliers||[]).length>0&&<Sel label="Supplier (optional)" value={noPoSupplier} onChange={e=>setNoPoSupplier(e.target.value)}>
          <option value="">Unknown / not from a supplier</option>
          {live.suppliers.map(s=><option key={s.supplierId} value={s.supplierId}>{supName(s.supplierId)}</option>)}
        </Sel>}
      </div>

      <Field label="Quantity Received">
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={()=>setReceiveQty(q=>Math.max(1,+q-1))} style={{width:48,height:48,borderRadius:6,border:`1.5px solid ${C.border}`,background:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
          <input type="number" inputMode="numeric" min="1" value={receiveQty} onChange={e=>setReceiveQty(e.target.value)} style={{...inputStyle,flex:1,textAlign:"center",fontSize:22,fontFamily:"monospace",fontWeight:700,minHeight:48}}/>
          <button onClick={()=>setReceiveQty(q=>+q+1)} style={{width:48,height:48,borderRadius:6,border:`1.5px solid ${C.border}`,background:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
        </div>
      </Field>
      {over>0&&<div style={{background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.warnText}}>
        ⚠ That is <b>{over} more</b> than the {sel.out} outstanding on {sel.po.id}. The extra still goes into stock and is recorded on the PO as over-received.</div>}
      <div style={{background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.greenText}}>
        New stock total: <strong>{live.stock+(+receiveQty||0)} {live.uom}</strong>
        {unitCost!=null&&<span style={{marginLeft:12}}>· Receipt value: <strong>${((+receiveQty||0)*unitCost).toFixed(2)}</strong></span>}
        {sel&&<div style={{marginTop:2}}>{sel.po.id} will show {(+sel.line.qty_received||0)+(+receiveQty||0)} of {sel.line.qty} received.</div>}
      </div>
      <div style={{display:"flex",gap:10}}>
        <Btn variant="outline" style={{flex:1,justifyContent:"center",minHeight:48}} onClick={onBack}>← Back</Btn>
        <Btn style={{flex:1,justifyContent:"center",minHeight:48}} disabled={saving||!choice||!(+receiveQty>0)}
          onClick={()=>{ if(over>0&&!window.confirm(`Receive ${receiveQty} on ${sel.po.id}? Only ${sel.out} are outstanding.`)) return;
            onConfirm(sel?{po:sel.po,line:sel.line}:{supplierId:noPoSupplier||null,upc:mfgMatch?.barcode||null}); }}>
          {saving?"Saving…":"✅ Confirm Receipt"}</Btn>
      </div>
    </div>
  );
}

// ─── Scan Tab ─────────────────────────────────────────────────────────────────
// ─── Stock count / adjustment with a reason ──────────────────────────────────
const STOCK_REASONS=["Cycle count","Damaged","Lost / missing","Found","Used for repair","Correction","Other"];
function StockCountForm({ part, actions, onDone, onCancel }){
  const [counted,setCounted]=useState(String(part.stock??0));
  const [reason,setReason]=useState("Cycle count");
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  const system=part.stock??0; const n=Math.max(0,Math.round(+counted||0)); const delta=n-system;
  const needNote=reason==="Other"||(delta!==0&&reason==="Correction");
  async function save(){
    if(counted===""||!Number.isFinite(+counted)){ setErr("Enter the counted quantity."); return; }
    if(needNote&&!note.trim()){ setErr("Add a note saying why."); return; }
    if(Math.abs(delta)>=Math.max(10,system)&&!window.confirm(`That changes ${part.id} by ${delta>0?"+":""}${delta} ${part.uom||"EA"}. Save it?`)) return;
    setBusy(true); setErr("");
    try{ const r=await actions.countStock(part.id,n,{reason,note:note.trim()}); onDone?.(r); }
    catch(e){ setErr(e.message||String(e)); }
    setBusy(false);
  }
  const btn={width:48,height:48,borderRadius:6,border:`1.5px solid ${C.border}`,background:C.white,fontSize:20,cursor:"pointer"};
  return <div style={{display:"grid",gap:12}}>
    <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
      <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>In the app</div><div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:C.navy}}>{system} {part.uom||"EA"}</div></div>
      <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Difference</div><div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:delta===0?C.greenText:delta>0?C.navy:C.red}}>{delta>0?"+":""}{delta}</div></div>
      {part.location&&<div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Bin</div><div style={{fontFamily:"monospace",fontSize:16,color:C.navy}}>{part.location}</div></div>}
    </div>
    <Field label="Counted on the shelf">
      <div style={{display:"flex",alignItems:"center",gap:10}}>
        <button onClick={()=>setCounted(c=>String(Math.max(0,(+c||0)-1)))} style={btn}>−</button>
        <input type="number" inputMode="numeric" min="0" value={counted} onChange={e=>setCounted(e.target.value)} onFocus={e=>e.target.select()}
          style={{...inputStyle,flex:1,textAlign:"center",fontSize:22,fontFamily:"monospace",fontWeight:700,minHeight:48}}/>
        <button onClick={()=>setCounted(c=>String((+c||0)+1))} style={btn}>+</button>
      </div>
    </Field>
    <Sel label="Reason" value={reason} onChange={e=>setReason(e.target.value)}>{STOCK_REASONS.map(r=><option key={r}>{r}</option>)}</Sel>
    <Input label={needNote?"Note (required)":"Note (optional)"} value={note} onChange={e=>setNote(e.target.value)} placeholder="e.g. 2 found in Rack 2"/>
    {err&&<div style={{color:C.red,fontSize:13}}>⚠ {err}</div>}
    <div style={{display:"flex",gap:10}}>
      {onCancel&&<Btn variant="outline" style={{flex:1,justifyContent:"center",minHeight:48}} onClick={onCancel}>Cancel</Btn>}
      <Btn style={{flex:1,justifyContent:"center",minHeight:48}} disabled={busy} onClick={save}>{busy?"Saving…":delta===0?"✅ Confirm count":"✅ Save count"}</Btn>
    </div>
  </div>;
}

// ─── Picking screen (full screen) ─────────────────────────────────────────────
// Picks parts from the warehouse into a pending outbound license plate.
// Lines are sorted by bin location so the list follows the walk through the racks.
function resolvePartOnLp(parts, mfgBarcodes, items, code){
  const c=(code||"").trim();
  if(!c) return null;
  const cands=findPartsByCode(parts,c);
  if(cands.length===1) return cands[0].id;
  if(cands.length>1){
    const onLp=cands.filter(p=>items.find(i=>i.partId===p.id));
    if(onLp.length===1) return onLp[0].id;
    return {ambiguous:cands};
  }
  const mb=(mfgBarcodes||[]).find(b=>(b.barcode||"").trim().toUpperCase()===c.toUpperCase());
  return mb?mb.part_id:null;
}
const isWarehouseLine=it=>it.source!=="direct"&&!it.no_stock;
function lpPickProgress(items){
  const w=(items||[]).filter(isWarehouseLine);
  return {picked:w.reduce((s,i)=>s+Math.min(i.picked||0,i.qty),0), qty:w.reduce((s,i)=>s+i.qty,0), direct:(items||[]).filter(i=>i.source==="direct"&&!i.checked).length};
}
const binSortKey=l=>{ const s=(l||"").trim().toUpperCase(); return s||"￿"; };   // no location → end of list
const isTouch=()=>typeof window!=="undefined"&&("ontouchstart" in window);

function PickScreen({ lpId, lps, parts, mfgBarcodes, actions, onClose }) {
  const lp=lps.find(l=>l.id===lpId);
  const [items,setItems]=useState(lp?.items||[]);
  useEffect(()=>{ if(lp) setItems(lp.items||[]); },[lp]);
  const [code,setCode]=useState("");
  const [qty,setQty]=useState(1);
  const [cam,setCam]=useState(false);
  const [show,setShow]=useState("remaining");
  const [msg,setMsg]=useState(null);       // {ok, text}
  const [busy,setBusy]=useState(false);
  const inputRef=useRef(null);
  const itemsRef=useRef(items); itemsRef.current=items;
  const busyRef=useRef(false);
  useEffect(()=>{ const prev=document.body.style.overflow; document.body.style.overflow="hidden"; return ()=>{ document.body.style.overflow=prev; }; },[]);

  const bigBtn=(x={})=>({minWidth:52,minHeight:48,padding:"0 12px",borderRadius:8,border:`1.5px solid ${C.border}`,background:C.white,fontSize:15,fontWeight:800,cursor:"pointer",color:C.navy,...x});
  const shell=(body)=><div style={{position:"fixed",inset:0,zIndex:1500,background:C.offWhite,display:"flex",flexDirection:"column"}}>{body}</div>;

  if(!lp) return shell(<div style={{padding:24,textAlign:"center"}}>
    <div style={{fontWeight:700,marginBottom:12}}>License plate {lpId} was not found.</div>
    <Btn onClick={onClose}>Close</Btn></div>);

  const pickedOf=it=>it.picked||0;
  const rows=items.map((it,idx)=>({it,idx,p:parts.find(x=>x.id===it.partId)}));
  const pickRows=rows.filter(r=>isWarehouseLine(r.it))
    .sort((a,b)=>binSortKey(a.p?.location).localeCompare(binSortKey(b.p?.location))||a.idx-b.idx);   // no bin yet → packing-list order
  const otherRows=rows.filter(r=>!isWarehouseLine(r.it));
  const {picked:totalPicked,qty:totalQty}=lpPickProgress(items);
  const remaining=pickRows.filter(r=>pickedOf(r.it)<r.it.qty);
  const shown=show==="remaining"?remaining:pickRows;
  const canPick=lpIsPrep(lp.status)&&(lp.type||"Outbound")==="Outbound";

  function feedback(ok,text){ setMsg({ok,text}); if(!ok&&navigator.vibrate) navigator.vibrate([60,60,60]); }
  function refocus(){ if(!isTouch()) inputRef.current?.focus(); }   // keeps a USB/Bluetooth scanner typing into the box

  async function doPick(partId,n,lineIdx=null){
    if(busyRef.current) return; busyRef.current=true; setBusy(true);
    const before=itemsRef.current;
    try{
      const next=await actions.pickLpItem(lp.id,before,partId,n,lineIdx);
      setItems(next);
      const p=parts.find(x=>x.id===partId);
      const ch=next.find((x,k)=>(x.picked||0)!==(before[k]?.picked||0));
      feedback(true,`${p?.description||partId}: ${ch?.picked??"?"} of ${ch?.qty??"?"} picked`);
    }catch(e){ feedback(false,e.message||String(e)); }
    busyRef.current=false; setBusy(false); refocus();
  }
  async function doUndo(partId,lineIdx){
    if(busyRef.current) return; busyRef.current=true; setBusy(true);
    try{
      const next=await actions.unpickLpItem(lp.id,itemsRef.current,partId,1,lineIdx);
      setItems(next);
      feedback(true,`Returned 1 × ${partId} to inventory.`);
    }catch(e){ feedback(false,e.message||String(e)); }
    busyRef.current=false; setBusy(false); refocus();
  }
  function onCode(raw){
    const c=(raw||"").trim(); if(!c) return;
    if(c.toUpperCase()===lp.id.toUpperCase()){ feedback(true,"That is this license plate. Now scan a part."); return; }
    const r=resolvePartOnLp(parts,mfgBarcodes,itemsRef.current,c);
    if(r&&r.ambiguous){ feedback(false,`"${c}" matches ${r.ambiguous.map(p=>p.id).join(" and ")}. Scan the CT- label instead.`); return; }
    if(!r){ feedback(false,`Unknown barcode "${c}".`); return; }
    const lines=itemsRef.current.filter(i=>i.partId===r);
    if(!lines.length){ feedback(false,`${r} is not on this license plate. Nothing changed.`); return; }
    if(!lines.some(isWarehouseLine)){ feedback(false,`${r} ships direct from the supplier. It is not picked here.`); return; }
    if(!lines.some(i=>isWarehouseLine(i)&&pickedOf(i)<i.qty)){ feedback(false,`${r} is already fully picked.`); return; }
    doPick(r,Math.max(1,+qty||1));
  }

  return shell(<>
    {/* Header */}
    <div style={{background:C.navy,borderBottom:`4px solid ${C.amber}`,color:"#fff",padding:"10px 14px"}}>
      <div style={{maxWidth:720,margin:"0 auto"}}>
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          <button onClick={onClose} aria-label="Close picking" style={bigBtn({background:"transparent",color:"#fff",border:"1.5px solid rgba(255,255,255,.35)",fontSize:22})}>‹</button>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontSize:10,fontWeight:700,color:C.amber,letterSpacing:2,textTransform:"uppercase"}}>Picking</div>
            <div style={{fontFamily:"monospace",fontSize:18,fontWeight:800}}>{lp.id}</div>
            <div style={{fontSize:12,color:"#C9D3DE",whiteSpace:"nowrap",overflow:"hidden",textOverflow:"ellipsis"}}>{lp.destination}{lp.po_number?` · PO ${lp.po_number}`:""}</div>
          </div>
          <div style={{textAlign:"right"}}>
            <div style={{fontFamily:"monospace",fontSize:22,fontWeight:800,color:C.amber}}>{totalPicked}/{totalQty}</div>
            <div style={{fontSize:10,color:"#C9D3DE"}}>picked</div>
          </div>
        </div>
        <div style={{background:"rgba(255,255,255,.15)",height:8,borderRadius:4,marginTop:8,overflow:"hidden"}}>
          <div style={{height:"100%",width:`${totalQty?totalPicked/totalQty*100:0}%`,background:totalQty>0&&totalPicked>=totalQty?"#2e9d5b":C.amber,transition:"width .3s"}}/>
        </div>
      </div>
    </div>

    {/* Body */}
    <div style={{flex:1,overflowY:"auto",WebkitOverflowScrolling:"touch"}}>
      <div style={{maxWidth:720,margin:"0 auto",padding:14,display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:12,boxSizing:"border-box"}}>
        {!canPick
          ? <div style={{background:C.warnBg,border:`1.5px solid ${C.warnBdr}`,borderRadius:8,padding:14,fontSize:14,color:C.warnText}}>
              This license plate is <b>{lp.status}</b>{(lp.type||"Outbound")!=="Outbound"?` (${lp.type})`:""}. Only Open or Picking outbound license plates can be picked.
            </div>
          : <>
            {/* Scan bar */}
            <div style={{background:C.white,border:`1.5px solid ${C.amber}`,borderRadius:10,padding:12,display:"grid",gridTemplateColumns:"minmax(0,1fr)",gap:10,...(cam?{}:{position:"sticky",top:0,zIndex:2,boxShadow:"0 4px 12px rgba(28,43,58,.08)"})}}>
              <div style={{display:"flex",gap:8,alignItems:"stretch"}}>
                <input ref={inputRef} autoFocus={!isTouch()} value={code} onChange={e=>setCode(e.target.value)}
                  onKeyDown={e=>{ if(e.key==="Enter"&&code.trim()){ onCode(code); setCode(""); } }}
                  placeholder="Scan or type part #" autoCapitalize="characters" autoCorrect="off" spellCheck={false}
                  style={{...inputStyle,flex:1,fontFamily:"monospace",fontSize:16,minHeight:48}}/>
                <input type="number" inputMode="numeric" min="1" value={qty} onChange={e=>setQty(e.target.value)} aria-label="Quantity per scan"
                  style={{...inputStyle,width:64,minHeight:48,fontSize:16,textAlign:"center",fontFamily:"monospace"}}/>
                <button onClick={()=>setCam(v=>!v)} aria-label="Camera" style={bigBtn({background:cam?C.navy:C.white,color:cam?"#fff":C.navy})}>📷</button>
              </div>
              <div style={{fontSize:11,color:C.textLight}}>Each scan picks <b>{Math.max(1,+qty||1)}</b>. Works with the phone camera or a USB/Bluetooth scanner.</div>
              {cam&&<CameraScanner onScan={onCode} onClose={()=>setCam(false)} hint="Hold on the part label. Move away and back to scan the same part again."/>}
              {msg&&<div role="status" style={{borderRadius:8,padding:"12px 14px",fontSize:15,fontWeight:700,background:msg.ok?C.greenBg:C.redLight,color:msg.ok?C.greenText:C.red,border:`1.5px solid ${msg.ok?C.greenBdr:C.redBorder}`}}>{msg.ok?"✓ ":"⚠ "}{msg.text}</div>}
            </div>

            {/* Filter */}
            <div style={{display:"flex",gap:8}}>
              {[["remaining",`Remaining (${remaining.length})`],["all",`All lines (${pickRows.length})`]].map(([k,l])=>
                <button key={k} onClick={()=>setShow(k)} style={bigBtn({flex:1,minHeight:44,fontSize:13,background:show===k?C.navy:C.white,color:show===k?"#fff":C.navy,border:`1.5px solid ${C.navy}`})}>{l}</button>)}
            </div>

            {pickRows.length>0&&remaining.length===0&&<div style={{background:C.greenBg,border:`1.5px solid ${C.greenBdr}`,borderRadius:10,padding:14,display:"grid",gap:10}}>
              <div style={{fontWeight:800,fontSize:15,color:C.greenText}}>✅ Every warehouse line is picked.</div>
              <div style={{fontSize:13,color:C.textMid}}>Close this screen and mark the license plate Shipped from the License Plates tab.</div>
              <Btn variant="navy" onClick={onClose} style={{justifyContent:"center",minHeight:48}}>Done</Btn>
            </div>}
            {pickRows.length===0&&<div style={{textAlign:"center",padding:24,color:C.textLight}}>This license plate has no warehouse lines to pick.</div>}

            {/* Lines, in bin order */}
            {shown.map(({it,idx,p})=>{
              const done=pickedOf(it)>=it.qty, left=it.qty-pickedOf(it);
              return <div key={idx} style={{background:done?"#F1FAF4":C.white,border:`2px solid ${done?"#6FBF8E":C.border}`,borderRadius:10,padding:12,display:"grid",gap:10}}>
                <div style={{display:"flex",gap:12,alignItems:"flex-start"}}>
                  <div style={{flexShrink:0,minWidth:64,textAlign:"center",background:C.navy,color:C.amber,borderRadius:8,padding:"6px 8px",fontFamily:"monospace",fontWeight:800,fontSize:14}}>
                    <div style={{fontSize:9,color:"#C9D3DE",letterSpacing:1}}>BIN</div>{p?.location||"—"}
                  </div>
                  <div style={{flex:1,minWidth:0}}>
                    <div style={{fontWeight:800,fontSize:15,color:C.navy}}>{p?.description||it.description||"—"}</div>
                    <div style={{fontFamily:"monospace",fontSize:12,color:C.amber,fontWeight:700}}>{it.partId} <LegacyNote p={p}/></div>
                    {(it.list||it.box)&&<div style={{fontSize:12,color:C.textMid}}>📋 {it.list}{it.box&&it.box!==it.list?` · ${it.box}`:""}</div>}
                  </div>
                  {p?.image_url&&<img src={p.image_url} alt="" style={{width:56,height:56,objectFit:"cover",borderRadius:6,border:`1px solid ${C.border}`,flexShrink:0}}/>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
                  <div style={{flex:"1 1 90px",fontFamily:"monospace",fontSize:22,fontWeight:800,color:done?C.greenText:C.navy}}>
                    {pickedOf(it)}<span style={{fontSize:14,color:C.textLight}}> / {it.qty} {p?.uom||""}</span>
                    {p&&!done&&(p.stock||0)<left&&<div style={{fontSize:11,color:C.red,fontFamily:"sans-serif",fontWeight:700}}>Only {p.stock||0} in stock</div>}
                  </div>
                  <button disabled={busy||pickedOf(it)<=0} onClick={()=>doUndo(it.partId,idx)} style={bigBtn({opacity:pickedOf(it)<=0?.4:1})}>↩ Undo</button>
                  <button disabled={busy||done} onClick={()=>doPick(it.partId,1,idx)} style={bigBtn({opacity:done?.4:1})}>+1</button>
                  {left>1&&<button disabled={busy} onClick={()=>doPick(it.partId,left,idx)} style={bigBtn({background:C.navy,color:"#fff",border:"none"})}>All {left}</button>}
                </div>
              </div>;
            })}

            {otherRows.length>0&&<div style={{fontSize:12,color:C.textMid,background:C.white,border:`1px dashed ${C.border}`,borderRadius:8,padding:"10px 12px"}}>
              <b>Not picked from the warehouse ({otherRows.length}):</b> {otherRows.map(r=>`${r.it.partId}${r.it.source==="direct"?" (ships direct)":" (no stock line)"}`).join(", ")}
            </div>}
          </>}
      </div>
    </div>
  </>);
}

function ScanTab({ parts, suppliers, lps, mfgBarcodes, actions, replenByPart, purchaseOrders, poLines }) {
  const [mode,setMode]=useState(null);
  const [result,setResult]=useState(null);
  const [notFound,setNotFound]=useState("");
  const [receiveQty,setReceiveQty]=useState(1);
  const [lastScanned,setLastScanned]=useState("");
  const [pickLpId,setPickLpId]=useState(null);
  const [lpMsg,setLpMsg]=useState("");
  const [toast,setToast]=useState("");
  const [saving,setSaving]=useState(false);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(""),3000);}

  const [choices,setChoices]=useState(null); // {code, list}
  function handleLpScan(code){
    const t=(code||"").trim().toUpperCase();
    setLpMsg("");
    if(!t) return;
    const lp=lps.find(l=>l.id.toUpperCase()===t);
    if(lp){
      if(!lpIsPrep(lp.status)||(lp.type||"Outbound")!=="Outbound"){ setLpMsg(`${lp.id} is ${lp.status}${(lp.type||"Outbound")!=="Outbound"?` (${lp.type})`:""}. Only Open or Picking outbound license plates can be picked.`); return; }
      setPickLpId(lp.id); return;
    }
    if(findPartsByCode(parts,t).length||mfgBarcodes.some(m=>m.barcode.toUpperCase()===t)){ setLpMsg("That is a part barcode. Scan the license plate label first, or choose the license plate below."); return; }
    setLpMsg(`No license plate found for ${t}.`);
  }
  function handleScan(code){
    if(mode==="pick"){ handleLpScan(code); return; }
    setNotFound(""); setChoices(null);
    const t=code.trim().toUpperCase();
    setLastScanned(code.trim());
    const cands=findPartsByCode(parts,t);
    if(cands.length>1){ setChoices({code:code.trim(),list:cands}); return; }
    let part=cands[0]||null;
    if(!part){
      const mfgMatch=mfgBarcodes.find(m=>m.barcode.toUpperCase()===t);
      if(mfgMatch) part=parts.find(p=>p.id===mfgMatch.part_id);
    }
    applyScan(t,part);
  }
  function applyScan(t,part){
    setChoices(null);
    if(mode==="lookup"||mode==="receive"||mode==="count"){
      if(part) setResult({type:"part",data:part});
      else setNotFound(t);
    }
  }

  async function applyReceive(choice){
    if(!result||result.type!=="part")return;
    const live=parts.find(p=>p.id===result.data.id);
    setSaving(true);
    try{
      if(choice?.po){ await actions.receivePoLine(choice.po,choice.line,+receiveQty); showToast(`✅ Received ${receiveQty} ${live.uom} of ${live.id} on ${choice.po.id}`); }
      else { await actions.receiveWithoutPo(live.id,+receiveQty,choice||{}); showToast(`✅ Received ${receiveQty} ${live.uom} of ${live.id} (no PO)`); }
      setResult(null);setReceiveQty(1);setLastScanned("");
    }catch(e){ showToast(`⚠ Not saved: ${e.message||e}`); }
    setSaving(false);
  }


  function reset(){setMode(null);setResult(null);setNotFound("");setLpMsg("");setPickLpId(null);}

  const modes=[
    {id:"lookup",icon:"🔍",label:"Look Up Part",desc:"Scan a SKU to view part details & stock level"},
    {id:"receive",icon:"📥",label:"Receive Stock",desc:"Scan a part, pick its open PO, confirm the quantity"},
    {id:"count",icon:"🔢",label:"Count Stock",desc:"Scan a part and enter how many are on the shelf"},
    {id:"pick",icon:"📤",label:"Pick a License Plate",desc:"Scan the LP label, then pick its parts into the container"},
  ];

  return (
    <div style={{maxWidth:560,margin:"0 auto"}}>
      {toast&&<div style={{position:"fixed",top:16,left:"50%",transform:"translateX(-50%)",background:C.navy,color:"#fff",borderRadius:8,padding:"10px 20px",fontSize:13,fontWeight:700,zIndex:2000,boxShadow:"0 8px 24px rgba(0,0,0,.3)",border:`2px solid ${C.amber}`}}>{toast}</div>}

      {!mode&&<div>
        <div style={{textAlign:"center",marginBottom:24}}>
          <div style={{display:"flex",justifyContent:"center",marginBottom:16}}>
            <svg width="90" height="160" viewBox="0 0 90 160" fill="none">
              <rect x="4" y="2" width="82" height="156" rx="14" fill={C.navy}/>
              <rect x="8" y="16" width="74" height="128" rx="6" fill="#0D1520"/>
              <rect x="10" y="18" width="70" height="124" rx="5" fill="#111D2B"/>
              <rect x="30" y="6" width="30" height="8" rx="4" fill="#0D1520"/>
              <rect x="86" y="48" width="4" height="20" rx="2" fill={C.navyLight}/>
              <rect x="0" y="44" width="4" height="14" rx="2" fill={C.navyLight}/>
              <rect x="0" y="62" width="4" height="14" rx="2" fill={C.navyLight}/>
              <rect x="33" y="134" width="24" height="3" rx="1.5" fill="#2C3E50"/>
              <rect x="22" y="42" width="46" height="76" rx="4" fill="#0A1628"/>
              <path d="M28 52 L28 48 L32 48" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M58 48 L62 48 L62 52" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M28 108 L28 112 L32 112" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <path d="M58 112 L62 112 L62 108" stroke={C.amber} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" fill="none"/>
              <rect x="28" y="66" width="2" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="32" y="66" width="4" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="38" y="66" width="2" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="42" y="66" width="3" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="47" y="66" width="2" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="51" y="66" width="4" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="57" y="66" width="2" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <rect x="61" y="66" width="3" height="28" rx="1" fill="#4A90D9" opacity="0.6"/>
              <circle cx="68" cy="10" r="3" fill="#0D1520" stroke="#2C3E50" strokeWidth="1"/>
            </svg>
          </div>
          <div style={{fontSize:18,fontWeight:800,color:C.navy,marginBottom:4}}>Barcode Scanner</div>
          <div style={{fontSize:13,color:C.textMid}}>Select a scanning mode to begin</div>
          <div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:20,padding:"4px 12px",fontSize:11,color:C.greenText,fontWeight:700}}>🟢 Live — connected to Supabase</div>
        </div>
        <div style={{display:"grid",gap:12}}>
          {modes.map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} style={{background:C.white,border:`2px solid ${C.border}`,borderRadius:10,padding:"18px 20px",display:"flex",alignItems:"center",gap:16,cursor:"pointer",textAlign:"left",transition:"border-color .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
              <div style={{fontSize:32,flexShrink:0}}>{m.icon}</div>
              <div><div style={{fontSize:15,fontWeight:800,color:C.navy}}>{m.label}</div><div style={{fontSize:12,color:C.textMid,marginTop:2}}>{m.desc}</div></div>
              <div style={{marginLeft:"auto",fontSize:18,color:C.textLight}}>›</div>
            </button>
          ))}
        </div>
        <div style={{marginTop:20,background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:8,padding:"12px 16px",fontSize:12,color:C.warnText}}>
          <strong>iPhone tip:</strong> When prompted tap <em>Allow</em> for camera access.
        </div>
      </div>}

      {mode&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={reset} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:C.textMid,padding:0}}>‹</button>
        <div><div style={{fontSize:16,fontWeight:800,color:C.navy}}>{modes.find(m2=>m2.id===mode)?.label}</div>
          <div style={{fontSize:12,color:C.textMid}}>{modes.find(m2=>m2.id===mode)?.desc}</div></div>
      </div>}

      {mode==="lookup"&&!result&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <CameraScanner onScan={handleScan} onClose={reset} hint="Point at any CT-#### barcode"/>
        <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
        <ManualEntry onSubmit={handleScan}/>
        {choices&&<PartChooser code={choices.code} choices={choices.list} onPick={p=>applyScan(choices.code.toUpperCase(),p)} onCancel={()=>setChoices(null)}/>}
        {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
      </div>}
      {mode==="lookup"&&result?.type==="part"&&<LookupResult replenByPart={replenByPart} result={result} parts={parts} suppliers={suppliers} onClear={()=>setResult(null)}/>}

      {mode==="receive"&&!result&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <CameraScanner onScan={handleScan} onClose={reset} hint="Point at the part barcode to receive stock"/>
        <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
        <ManualEntry onSubmit={handleScan}/>
        {choices&&<PartChooser code={choices.code} choices={choices.list} onPick={p=>applyScan(choices.code.toUpperCase(),p)} onCancel={()=>setChoices(null)}/>}
        {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
      </div>}
      {mode==="count"&&!result&&<div style={{display:"flex",flexDirection:"column",gap:12}}>
        <CameraScanner onScan={handleScan} onClose={reset} hint="Point at the part or bin label to count"/>
        <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
        <ManualEntry onSubmit={handleScan}/>
        {choices&&<PartChooser code={choices.code} choices={choices.list} onPick={p=>applyScan(choices.code.toUpperCase(),p)} onCancel={()=>setChoices(null)}/>}
        {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
      </div>}
      {mode==="count"&&result?.type==="part"&&(()=>{ const live=parts.find(x=>x.id===result.data.id)||result.data; return <div style={{display:"grid",gap:12}}>
        <div style={{background:C.white,border:`2px solid ${C.amber}`,borderRadius:8,padding:14}}>
          <div style={{fontFamily:"monospace",fontSize:13,color:C.amber,fontWeight:700}}>{live.id} <LegacyNote p={live}/></div>
          <div style={{fontWeight:700,fontSize:15,color:C.navy,marginTop:2}}>{live.description}</div>
        </div>
        <StockCountForm key={live.id} part={live} actions={actions} onCancel={()=>setResult(null)}
          onDone={r=>{ showToast(r.delta===0?`✅ ${live.id} count confirmed: ${r.counted}`:`✅ ${live.id}: ${r.before} → ${r.counted} (${r.delta>0?"+":""}${r.delta})`); setResult(null); }}/>
      </div>; })()}
      {mode==="receive"&&result?.type==="part"&&<ReceiveResult purchaseOrders={purchaseOrders} poLines={poLines} result={result} parts={parts} suppliers={suppliers} mfgBarcodes={mfgBarcodes} lastScanned={lastScanned} receiveQty={receiveQty} setReceiveQty={setReceiveQty} saving={saving} onBack={()=>setResult(null)} onConfirm={applyReceive}/>}

      {mode==="pick"&&<div style={{display:"grid",gap:12}}>
        {!pickLpId&&<CameraScanner onScan={handleScan} onClose={reset} hint="Point at the license plate barcode (LP-…)"/>}
        <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
        <ManualEntry onSubmit={handleScan}/>
        {lpMsg&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>⚠ {lpMsg}</div>}
        {(()=>{
          const open=lps.filter(l=>lpIsPrep(l.status)&&(l.type||"Outbound")==="Outbound");
          return <div style={{display:"grid",gap:8}}>
            <SectionTitle>Ready to pick ({open.length})</SectionTitle>
            {open.length===0&&<div style={{textAlign:"center",padding:16,color:C.textLight,fontSize:13}}>No pending outbound license plates. Create one from an order first.</div>}
            {open.map(l=>{ const pr=lpPickProgress(l.items); const pct=pr.qty?pr.picked/pr.qty:0;
              return <button key={l.id} onClick={()=>setPickLpId(l.id)} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:10,padding:"12px 14px",textAlign:"left",cursor:"pointer",display:"grid",gap:6,minHeight:56}}>
                <div style={{display:"flex",justifyContent:"space-between",gap:8,alignItems:"baseline"}}>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color:C.navy}}>{l.id}</span>
                  <span style={{fontFamily:"monospace",fontWeight:800,fontSize:14,color:pr.qty&&pr.picked>=pr.qty?C.greenText:C.amber}}>{pr.picked}/{pr.qty}</span>
                </div>
                <div style={{fontSize:12,color:C.textMid}}>{l.destination}{l.po_number?` · PO ${l.po_number}`:""}{pr.direct?` · ${pr.direct} direct-ship open`:""}</div>
                <div style={{background:C.border,height:6,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pct*100}%`,background:pct>=1?C.greenText:C.amber}}/></div>
              </button>; })}
          </div>;
        })()}
        {pickLpId&&<PickScreen lpId={pickLpId} lps={lps} parts={parts} mfgBarcodes={mfgBarcodes} actions={actions} onClose={()=>setPickLpId(null)}/>}
      </div>}
    </div>
  );
}

// ─── Parts Tab ────────────────────────────────────────────────────────────────
function PartsTab({ parts, suppliers, mfgBarcodes, supplierStock, actions, replenByPart }) {
  const [search,setSearch]=useState("");
  const [filter,setFilter]=useState("All");
  const [showAdd,setShowAdd]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [viewPart,setViewPart]=useState(null);
  const [form,setForm]=useState({newPartNo:"",legacyPartNo:"",description:"",category:"Containment",uom:"EA",location:"",minStock:"",stock:""});
  const [saving,setSaving]=useState(false);
  const cats=["All",...Array.from(new Set(parts.map(p=>p.category)))];
  const filtered=parts.filter(p=>(filter==="All"||p.category===filter)&&partMatchesSearch(p,search));
  async function addPart(){if(!form.description||!form.newPartNo.trim())return;setSaving(true);try{await actions.addPart(form);setForm({newPartNo:"",legacyPartNo:"",description:"",category:"Containment",uom:"EA",location:"",minStock:"",stock:""});setShowAdd(false);}catch(e){alert(e.message);}setSaving(false);}
  const sc=p=>stockStatus(p,replenByPart?.get(p.id)).color;
  const sl=p=>stockStatus(p,replenByPart?.get(p.id)).label;
  return <div>
    <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search part no., old no. or description…" style={{...inputStyle,flex:1,minWidth:180}}/>
      <select value={filter} onChange={e=>setFilter(e.target.value)} style={inputStyle}>{cats.map(c=><option key={c}>{c}</option>)}</select>
      <Btn variant="outline" onClick={()=>setShowImport(true)}>📂 Import CSV</Btn>
      <Btn onClick={()=>setShowAdd(true)}>+ Add Part</Btn>
    </div>
    <div style={{display:"grid",gap:10}}>
      {filtered.map(p=>(
        <div key={p.id} onClick={()=>setViewPart(p)} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px",display:"flex",alignItems:"center",gap:16,cursor:"pointer",transition:"border-color .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
          <div style={{flexShrink:0,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
            {p.image_url
              ? <img src={p.image_url} alt={p.id} style={{width:56,height:56,objectFit:"cover",borderRadius:6,border:`1px solid ${C.border}`}}/>
              : <div style={{width:56,height:56,borderRadius:6,border:`1.5px dashed ${C.border}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,color:C.textLight}}>📷</div>
            }
            <BarcodeDisplay code={p.id}/>
          </div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,color:C.textDark,marginBottom:2}}>{p.description}</div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginBottom:4}}><span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:C.amber}}>{p.id}</span><LegacyNote p={p}/></div>
            <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center"}}>
              <Badge color="navy">{p.category}</Badge>
              <span style={{fontSize:12,color:C.textLight}}>📍 {p.location||"—"}</span>
              <span style={{fontSize:12,color:C.textLight}}>{p.suppliers?.length||0} supplier{p.suppliers?.length!==1?"s":""}</span>
            </div>
          </div>
          <div style={{textAlign:"right",flexShrink:0}}>
            <div style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:C.navy}}>{p.stock}</div>
            <div style={{fontSize:11,color:C.textLight,marginBottom:4}}>{p.uom} on hand</div>
            <Badge color={sc(p)}>{sl(p)}</Badge>
          </div>
        </div>
      ))}
      {filtered.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No parts found.</div>}
    </div>
    {showAdd&&<Modal title="Add New Part" onClose={()=>setShowAdd(false)} confirmClose={form.newPartNo||form.description?"Discard this new part?":null}>
      <div style={{display:"grid",gap:14}}>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
          <Input label="New part number (required)" value={form.newPartNo} onChange={e=>setForm(f=>({...f,newPartNo:e.target.value}))} placeholder="e.g. 5100 → CT-5100"/>
          <Input label="Old part number (optional)" value={form.legacyPartNo} onChange={e=>setForm(f=>({...f,legacyPartNo:e.target.value}))} placeholder="e.g. 2100"/>
        </div>
        <Input label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. HDPE Containment Body"/>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
          <Sel label="Category" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>{["Containment","Seals & Gaskets","Valves","Instrumentation","Filtration","Hardware","Other"].map(c=><option key={c}>{c}</option>)}</Sel>
          <Sel label="UOM" value={form.uom} onChange={e=>setForm(f=>({...f,uom:e.target.value}))}>{["EA","LB","FT","M","L","KG","PKG"].map(u=><option key={u}>{u}</option>)}</Sel>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
          <Input label="Stock Qty" type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))}/>
          <Input label="Min Stock" type="number" value={form.minStock} onChange={e=>setForm(f=>({...f,minStock:e.target.value}))}/>
        </div>
        <Input label="Location" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))} placeholder="e.g. A-01-03"/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
          <Btn variant="outline" onClick={()=>setShowAdd(false)}>Cancel</Btn>
          <Btn onClick={addPart} disabled={saving}>{saving?"Saving…":"Create Part"}</Btn>
        </div>
      </div>
    </Modal>}
    {viewPart&&<PartDetailModal replenByPart={replenByPart} part={viewPart} suppliers={suppliers} parts={parts} mfgBarcodes={mfgBarcodes} supplierStock={supplierStock} actions={actions} onClose={()=>setViewPart(null)}/>}
    {showImport&&<CsvImportModal type="parts" actions={actions} existingRecords={parts} onClose={()=>setShowImport(false)}/>}
  </div>;
}

function PartDetailModal({ part, suppliers, parts, mfgBarcodes, supplierStock, actions, onClose, replenByPart }) {
  const live=parts.find(x=>x.id===part.id)||part;
  const partMfgBarcodes=mfgBarcodes.filter(m=>m.part_id===live.id);
  const partSupplierStock=supplierStock.filter(s=>s.part_id===live.id);
  const [addSupForm,setAddSupForm]=useState({supplierId:"",mfgPartNo:"",leadDays:"",unitCost:""});
  const [addBcForm,setAddBcForm]=useState({barcode:"",supplierId:"",description:""});
  const [editStock,setEditStock]=useState(false);
  const [counting,setCounting]=useState(false);
  const [adjReason,setAdjReason]=useState("Correction");
  const [adjNote,setAdjNote]=useState("");
  const [supQtys,setSupQtys]=useState({});
  const [saving,setSaving]=useState(false);
  const [scanningBc,setScanningBc]=useState(false);
  const [uploading,setUploading]=useState(false);
  const imgInputRef=useRef(null);

  // Initialize qty inputs from existing supplier_stock when opening adjust panel
  function openAdjust(){
    const init={};
    (live.suppliers||[]).forEach(s=>{
      const existing=partSupplierStock.find(r=>r.supplier_id===s.supplierId);
      init[s.supplierId]=existing?existing.qty:0;
    });
    setSupQtys(init);
    setEditStock(true);
  }

  async function applySupplierAdj(){
    if(!Object.keys(supQtys).length) return;
    setSaving(true);
    const adjustments=Object.entries(supQtys).map(([supplierId,qty])=>({supplierId,qty:+qty||0}));
    if((adjReason==="Other"||adjReason==="Correction")&&!adjNote.trim()){ alert("Add a note saying why."); setSaving(false); return; }
    await actions.adjustSupplierStock(live.id, adjustments, {reason:adjReason, note:adjNote.trim()});
    setAdjNote("");
    setSaving(false);
    setEditStock(false);
  }

  async function addSup(){if(!addSupForm.supplierId||!addSupForm.mfgPartNo)return;setSaving(true);await actions.linkSupplier(live.id,addSupForm);setSaving(false);setAddSupForm({supplierId:"",mfgPartNo:"",leadDays:"",unitCost:"",shipsDirect:false});}
  async function removeSup(sid){setSaving(true);await actions.unlinkSupplier(live.id,sid);setSaving(false);}
  async function addBc(){if(!addBcForm.barcode)return;setSaving(true);try{await actions.addMfgBarcode(live.id,addBcForm.supplierId||null,addBcForm.barcode,addBcForm.description);}catch(e){alert("Barcode already exists: "+addBcForm.barcode);}setSaving(false);setAddBcForm({barcode:"",supplierId:"",description:""});setScanningBc(false);}
  async function deleteBc(id){setSaving(true);await actions.deleteMfgBarcode(id);setSaving(false);}
  const avail=suppliers.filter(s=>!live.suppliers?.find(x=>x.supplierId===s.id));
  const st=stockStatus(live,replenByPart?.get(live.id));

  async function handleImageUpload(e){
    const file=e.target.files?.[0];
    if(!file)return;
    setUploading(true);
    try{ await actions.uploadPartImage(live.id,file); }
    catch(err){ alert("Upload failed: "+err.message); }
    setUploading(false);
    e.target.value="";
  }

  return <Modal title={live.id} onClose={onClose}>
    <div style={{display:"grid",gap:20}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"14px 0",background:C.offWhite,borderRadius:6,gap:10}}>
        {/* Part image */}
        {live.image_url
          ? <div style={{position:"relative"}}>
              <img src={live.image_url} alt={live.id} style={{width:180,height:140,objectFit:"cover",borderRadius:8,border:`1.5px solid ${C.border}`}}/>
              <button onClick={async()=>{if(window.confirm("Remove image?")){ setUploading(true); await actions.removePartImage(live.id); setUploading(false);}}}
                style={{position:"absolute",top:-8,right:-8,background:C.red,color:"#fff",border:"none",borderRadius:"50%",width:22,height:22,cursor:"pointer",fontSize:12,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>
          : <div onClick={()=>imgInputRef.current?.click()}
              style={{width:180,height:140,borderRadius:8,border:`2px dashed ${C.border}`,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:6,cursor:"pointer",background:C.white}}>
              <span style={{fontSize:32}}>📷</span>
              <span style={{fontSize:11,color:C.textLight}}>Tap to add photo</span>
            </div>
        }
        <input ref={imgInputRef} type="file" accept="image/*" capture="environment" style={{display:"none"}} onChange={handleImageUpload}/>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="outline" style={{padding:"5px 12px",fontSize:11}} onClick={()=>imgInputRef.current?.click()} disabled={uploading}>
            {uploading?"Uploading…":(live.image_url?"🔄 Replace Photo":"📷 Add Photo")}
          </Btn>
          <Btn variant="outline" style={{padding:"5px 12px",fontSize:11}} onClick={()=>{
            const imgTag=live.image_url?`<img src="${live.image_url}" style="width:100%;max-height:160px;object-fit:contain;border-radius:6px;margin-bottom:8px;"/>` : "";
            const w=window.open("","_blank");
            w.document.write(`<!DOCTYPE html><html><head><title>${live.id}</title>
              <script src="https://cdn.jsdelivr.net/npm/jsbarcode@3.11.5/dist/JsBarcode.all.min.js"><\/script>
              <style>body{font-family:Arial,sans-serif;padding:20px;display:flex;justify-content:center;}
              .label{border:1.5px solid #E0E3E7;border-radius:8px;padding:16px;width:300px;text-align:center;}
              .bar{width:4px;height:20px;background:#F5A623;border-radius:2px;display:inline-block;margin-right:6px;vertical-align:middle;}
              p{margin:4px 0;font-size:12px;color:#1C2B3A;}
              .meta{font-size:10px;color:#8A9BB0;margin-top:8px;}</style></head>
              <body onload="window.print()"><div class="label">
              <div><span class="bar"></span><strong style="font-size:10px;text-transform:uppercase;letter-spacing:1px;color:#1C2B3A;">ChlorTainer</strong></div>
              ${imgTag}
              <svg id="bc"></svg>
              <p><strong>${live.description}</strong></p>
              <div class="meta">${live.category} · ${live.uom} · ${live.location||"—"}</div>
              </div>
              <script>JsBarcode("#bc","${live.id}",{format:"CODE128",width:2,height:50,displayValue:true,fontSize:11,margin:4,lineColor:"#1C2B3A"});<\/script>
              </body></html>`);
            w.document.close();
          }}>🖨️ Print Label</Btn>
        </div>
        <BarcodeDisplay code={live.id} size="lg"/>
        <div style={{marginTop:6,textAlign:"center"}}><LegacyNote p={live}/></div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        {[["Description",live.description],["Category",<Badge color="navy">{live.category}</Badge>],
          ["Location",<span style={{fontFamily:"monospace",fontSize:14,color:C.navy}}>{live.location||"—"}</span>],["UOM",live.uom]]
          .map(([l,v])=><div key={l}><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>{l}</div><div style={{fontSize:14,fontWeight:600,color:C.textDark}}>{v}</div></div>)}
      </div>
      <div style={{background:C.offWhite,borderRadius:7,padding:16,border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <SectionTitle>Inventory</SectionTitle>
          <div style={{display:"flex",gap:6}}>
            <Btn style={{padding:"5px 12px",fontSize:12}} onClick={()=>{setEditStock(false);setCounting(true);}}>🔢 Count</Btn>
            {live.suppliers?.length>0&&<Btn variant="outline" style={{padding:"5px 12px",fontSize:12}} onClick={()=>{setCounting(false);openAdjust();}}>By supplier</Btn>}
          </div>
        </div>
        {counting&&<div style={{background:C.white,border:`1.5px solid ${C.amber}`,borderRadius:7,padding:12,marginBottom:12}}>
          <StockCountForm key={live.id} part={live} actions={actions} onCancel={()=>setCounting(false)} onDone={()=>setCounting(false)}/>
        </div>}
        <div style={{display:"flex",gap:24,alignItems:"center",marginBottom:12}}>
          <div><div style={{fontFamily:"monospace",fontSize:30,fontWeight:700,color:C.navy}}>{live.stock}</div><div style={{fontSize:11,color:C.textLight}}>total on hand</div></div>
          <div><div style={{fontFamily:"monospace",fontSize:18,color:C.textMid}}>{live.minStock}</div><div style={{fontSize:11,color:C.textLight}}>minimum</div></div>
          <Badge color={st.color}>{st.label}</Badge>
        </div>
        {/* Per-supplier stock breakdown */}
        {partSupplierStock.length>0&&!editStock&&(
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:10}}>
            <div style={{fontSize:10,fontWeight:700,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Stock by Supplier</div>
            {partSupplierStock.map((row,i)=>{
              const sup=suppliers.find(s=>s.id===row.supplier_id);
              return <div key={i} style={{display:"flex",justifyContent:"space-between",alignItems:"center",padding:"5px 0",borderBottom:i<partSupplierStock.length-1?`1px solid ${C.border}`:"none"}}>
                <span style={{fontSize:13,color:C.navy,fontWeight:600}}>{sup?.name||row.supplier_id}</span>
                <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.navy}}>{row.qty} <span style={{fontSize:11,color:C.textLight}}>{live.uom}</span></span>
              </div>;
            })}
          </div>
        )}
        {/* Adjust panel — per-supplier qty inputs */}
        {editStock&&(
          <div style={{borderTop:`1px solid ${C.border}`,paddingTop:12,marginTop:4}}>
            <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:10}}>Set quantity on hand by supplier:</div>
            {(live.suppliers||[]).map((s,i)=>{
              const sup=suppliers.find(x=>x.id===s.supplierId);
              const existing=partSupplierStock.find(r=>r.supplier_id===s.supplierId);
              return <div key={i} style={{display:"flex",alignItems:"center",gap:10,marginBottom:10}}>
                <div style={{flex:1}}>
                  <div style={{fontSize:12,fontWeight:700,color:C.navy}}>{sup?.name}</div>
                  <div style={{fontSize:10,color:C.textLight}}>{s.mfgPartNo} · ${(+s.unitCost).toFixed(2)}/{live.uom}</div>
                  {existing&&<div style={{fontSize:10,color:C.textMid}}>Current: {existing.qty} {live.uom}</div>}
                </div>
                <div style={{display:"flex",alignItems:"center",gap:6}}>
                  <button onClick={()=>setSupQtys(q=>({...q,[s.supplierId]:Math.max(0,(+q[s.supplierId]||0)-1)}))}
                    style={{width:32,height:32,borderRadius:5,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:16}}>−</button>
                  <input type="number" min="0" value={supQtys[s.supplierId]??existing?.qty??0}
                    onChange={e=>setSupQtys(q=>({...q,[s.supplierId]:+e.target.value||0}))}
                    style={{...inputStyle,width:70,textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:15}}/>
                  <button onClick={()=>setSupQtys(q=>({...q,[s.supplierId]:(+q[s.supplierId]||0)+1}))}
                    style={{width:32,height:32,borderRadius:5,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer",fontSize:16}}>+</button>
                </div>
              </div>;
            })}
            <div style={{background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:6,padding:"8px 12px",fontSize:13,color:C.greenText,marginBottom:10}}>
              New total: <strong>{Object.values(supQtys).reduce((a,b)=>a+(+b||0),0)+Math.max(0,(live.stock||0)-partSupplierStock.reduce((a,r)=>a+(r.qty||0),0))} {live.uom}</strong>
              {Math.max(0,(live.stock||0)-partSupplierStock.reduce((a,r)=>a+(r.qty||0),0))>0&&<span style={{color:C.textMid}}> (includes {Math.max(0,(live.stock||0)-partSupplierStock.reduce((a,r)=>a+(r.qty||0),0))} not tied to a supplier)</span>}
            </div>
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1.4fr)",gap:10,marginBottom:10}}>
              <Sel label="Reason" value={adjReason} onChange={e=>setAdjReason(e.target.value)}>{STOCK_REASONS.map(r=><option key={r}>{r}</option>)}</Sel>
              <Input label={adjReason==="Other"||adjReason==="Correction"?"Note (required)":"Note"} value={adjNote} onChange={e=>setAdjNote(e.target.value)}/>
            </div>
            <div style={{display:"flex",gap:8}}>
              <Btn variant="outline" style={{flex:1,justifyContent:"center"}} onClick={()=>setEditStock(false)}>Cancel</Btn>
              <Btn style={{flex:1,justifyContent:"center"}} disabled={saving} onClick={applySupplierAdj}>{saving?"Saving…":"✅ Apply Adjustment"}</Btn>
            </div>
          </div>
        )}
      </div>
      <div>
        <SectionTitle>Suppliers ({live.suppliers?.length||0})</SectionTitle>
        {live.suppliers?.map((s,i)=>{const sup=suppliers.find(x=>x.id===s.supplierId);return(
          <div key={i} style={{border:`1.5px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{sup?.name||s.supplierId}</div>
              <div style={{fontFamily:"monospace",fontSize:12,color:C.textMid,marginTop:3}}>{s.mfgPartNo}</div>
              <div style={{display:"flex",gap:14,marginTop:6}}><span style={{fontSize:11,color:C.textLight}}>⏱ {s.leadDays}d lead</span>{s.shipsDirect&&<Badge color="amber">Ships direct</Badge>}<span style={{fontSize:11,color:C.greenText,fontWeight:700}}>${(+s.unitCost).toFixed(2)} / {live.uom}</span></div>
            </div>
            <Btn variant="danger" style={{padding:"4px 10px",fontSize:11}} disabled={saving} onClick={()=>removeSup(s.supplierId)}>Remove</Btn>
          </div>
        );})}
        {avail.length>0&&<div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:7,padding:14,marginTop:6}}>
          <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:10}}>+ Link Supplier</div>
          <div style={{display:"grid",gap:8}}>
            <Sel value={addSupForm.supplierId} onChange={e=>setAddSupForm(f=>({...f,supplierId:e.target.value}))}><option value="">Select supplier…</option>{avail.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Sel>
            <Input placeholder="Mfg Part No." value={addSupForm.mfgPartNo} onChange={e=>setAddSupForm(f=>({...f,mfgPartNo:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:8}}>
              <Input placeholder="Lead days" type="number" value={addSupForm.leadDays} onChange={e=>setAddSupForm(f=>({...f,leadDays:e.target.value}))}/>
              <label style={{display:"flex",alignItems:"center",gap:6,fontSize:12,color:C.textMid,gridColumn:"1 / -1"}}><input type="checkbox" checked={!!addSupForm.shipsDirect} onChange={e=>setAddSupForm(f=>({...f,shipsDirect:e.target.checked}))}/> Ships direct from supplier to the fabricator (never held in TGO stock)</label>
              <Input placeholder="Unit cost $" type="number" value={addSupForm.unitCost} onChange={e=>setAddSupForm(f=>({...f,unitCost:e.target.value}))}/>
            </div>
            <Btn disabled={saving} onClick={addSup}>{saving?"Saving…":"Add Supplier Link"}</Btn>
          </div>
        </div>}
      </div>
      <div>
        <SectionTitle>Product Barcodes ({partMfgBarcodes.length})</SectionTitle>
        {partMfgBarcodes.map((mb,i)=>{
          const sup=suppliers.find(s=>s.id===mb.supplier_id);
          return <div key={i} style={{border:`1.5px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
            <div>
              <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.navy}}>{mb.barcode}</div>
              {sup&&<div style={{fontSize:12,color:C.textMid,marginTop:2}}>📦 {sup.name}</div>}
              {mb.description&&<div style={{fontSize:11,color:C.textLight,marginTop:2}}>{mb.description}</div>}
            </div>
            <Btn variant="danger" style={{padding:"4px 10px",fontSize:11}} disabled={saving} onClick={()=>deleteBc(mb.id)}>Remove</Btn>
          </div>;
        })}
        {/* Add barcode form */}
        <div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:7,padding:14,marginTop:6}}>
          <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:10}}>+ Add Product Barcode</div>
          {scanningBc
            ? <div style={{marginBottom:10}}>
                <CameraScanner onScan={bc=>{setAddBcForm(f=>({...f,barcode:bc}));setScanningBc(false);}} onClose={()=>setScanningBc(false)} hint="Scan the product barcode"/>
              </div>
            : <Btn variant="outline" style={{width:"100%",justifyContent:"center",marginBottom:10}} onClick={()=>setScanningBc(true)}>📷 Scan Barcode</Btn>
          }
          <div style={{display:"grid",gap:8}}>
            <div style={{display:"flex",gap:8}}>
              <input value={addBcForm.barcode} onChange={e=>setAddBcForm(f=>({...f,barcode:e.target.value}))}
                placeholder="Barcode value" style={{...inputStyle,flex:1,fontFamily:"monospace"}}/>
            </div>
            <Sel value={addBcForm.supplierId} onChange={e=>setAddBcForm(f=>({...f,supplierId:e.target.value}))}>
              <option value="">Select supplier (optional)…</option>
              {suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <input value={addBcForm.description} onChange={e=>setAddBcForm(f=>({...f,description:e.target.value}))}
              placeholder="Description (optional)" style={inputStyle}/>
            <Btn disabled={!addBcForm.barcode||saving} onClick={addBc}>{saving?"Saving…":"Add Barcode"}</Btn>
          </div>
        </div>
      </div>
    </div>
  </Modal>;
}

// ─── CSV Import ───────────────────────────────────────────────────────────────
const CSV_TEMPLATES = {
  customers: {
    columns: ["name","contact","phone","email","address_line1","address_line2","city","state","zip"],
    required: ["name"],
    example: "Murphy Builders,John Smith,(505) 863-6274,orders@murphy.com,808 Boardman Dr,,Gallup,NM,87301",
    matchOn: "name",
  },
  parts: {
    columns: ["id","description","category","uom","stock","min_stock","location","legacy_part_no"],
    required: ["id","description"],
    example: "CT-5300,Pressure Relief Valve,Valves,EA,10,5,C-03-01,2310",
    matchOn: "id",
  },
  suppliers: {
    columns: ["id","name","contact","phone"],
    required: ["name"],
    example: "SUP-005,Grainger,orders@grainger.com,800-472-4643",
    matchOn: "name",
  },
};

function CsvImportModal({ type, actions, existingRecords, onClose }) {
  const tmpl = CSV_TEMPLATES[type];
  const [step, setStep] = useState("upload"); // upload | preview | done
  const [rows, setRows] = useState([]);
  const [errors, setErrors] = useState([]);
  const [importing, setImporting] = useState(false);
  const [results, setResults] = useState({added:0,updated:0,failed:0});
  const fileRef = useRef(null);

  function parseCSV(text) {
    const lines = text.trim().split("\n").filter(l=>l.trim());
    // Detect if first line is a header
    const firstLine = lines[0].split(",").map(s=>s.trim().toLowerCase());
    const hasHeader = tmpl.columns.some(c=>firstLine.includes(c));
    const dataLines = hasHeader ? lines.slice(1) : lines;

    const parsed = [];
    const errs = [];
    dataLines.forEach((line, i) => {
      const vals = line.split(",").map(s=>s.trim().replace(/^"|"$/g,""));
      const row = {};
      tmpl.columns.forEach((col, j) => { row[col] = vals[j] || ""; });
      // Check required
      const missing = tmpl.required.filter(r=>!row[r]);
      if (missing.length) {
        errs.push(`Row ${i+1}: missing required field(s): ${missing.join(", ")}`);
      } else {
        // Check if record exists
        const match = existingRecords.find(r =>
          (r[tmpl.matchOn]||"").toLowerCase() === (row[tmpl.matchOn]||"").toLowerCase()
        );
        row._action = match ? "update" : "add";
        row._matchId = match?.id || null;
        parsed.push(row);
      }
    });
    return { parsed, errs };
  }

  function handleFile(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => {
      const { parsed, errs } = parseCSV(ev.target.result);
      setRows(parsed);
      setErrors(errs);
      setStep("preview");
    };
    reader.readAsText(file);
    e.target.value = "";
  }

  async function runImport() {
    setImporting(true);
    let added=0, updated=0, failed=0;
    for (const row of rows) {
      try {
        if (type === "customers") {
          if (row._action === "update") await actions.updateCustomer(row._matchId, row);
          else await actions.addCustomer(row);
        } else if (type === "parts") {
          const form = {...row, minStock: row.min_stock};
          if (row._action === "update") {
            await _sb.from("parts").update({description:row.description,category:row.category,uom:row.uom,stock:+row.stock||0,min_stock:+row.min_stock||0,location:row.location}).eq("id",row.id);
            await logAudit("part_edit","part",row.id,{source:"csv_import"});
          } else {
            const nm=/^CT-(\w+)$/i.exec(row.id||""); const isNew=!!nm&&String(row.legacy_part_no||"")!==nm[1]; // CT-<same as old no.> = new number still pending
            await _sb.from("parts").insert({id:row.id,new_part_no:isNew?nm[1]:null,legacy_part_no:row.legacy_part_no||null,new_no_pending:!isNew,description:row.description,category:row.category,uom:row.uom||"EA",stock:+row.stock||0,min_stock:+row.min_stock||0,location:row.location});
            await logAudit("part_add","part",row.id,{source:"csv_import"});
          }
        } else if (type === "suppliers") {
          if (row._action === "update") {
            await _sb.from("suppliers").update({name:row.name,contact:row.contact,phone:row.phone}).eq("id",row._matchId);
            await logAudit("supplier_edit","supplier",row._matchId,{source:"csv_import"});
          } else {
            const id = row.id || `SUP-${String(Math.floor(Math.random()*9000)+1000)}`;
            await _sb.from("suppliers").insert({id,name:row.name,contact:row.contact,phone:row.phone});
            await logAudit("supplier_add","supplier",id,{source:"csv_import"});
          }
        }
        row._action === "update" ? updated++ : added++;
      } catch(e) { failed++; }
    }
    setResults({added,updated,failed});
    setImporting(false);
    setStep("done");
  }

  function downloadTemplate() {
    const header = tmpl.columns.join(",");
    const content = `${header}\n${tmpl.example}`;
    const blob = new Blob([content], {type:"text/csv"});
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `chlortainer-${type}-template.csv`;
    a.click(); URL.revokeObjectURL(url);
  }

  const typeLabel = type.charAt(0).toUpperCase()+type.slice(1);

  return <Modal title={`Import ${typeLabel} from CSV`} width={900} onClose={onClose}>
    <div style={{display:"grid",gap:16}}>

      {step==="upload"&&<>
        <div style={{background:C.offWhite,borderRadius:8,padding:16}}>
          <div style={{fontSize:13,fontWeight:700,color:C.navy,marginBottom:8}}>Required columns:</div>
          <div style={{display:"flex",flexWrap:"wrap",gap:6,marginBottom:12}}>
            {tmpl.columns.map(c=><span key={c} style={{background:tmpl.required.includes(c)?C.amber:"#E8EDF2",color:tmpl.required.includes(c)?C.navy:C.textMid,borderRadius:4,padding:"2px 8px",fontSize:11,fontFamily:"monospace",fontWeight:tmpl.required.includes(c)?700:400}}>{c}{tmpl.required.includes(c)?" *":""}</span>)}
          </div>
          <Btn variant="outline" style={{fontSize:12,padding:"5px 12px"}} onClick={downloadTemplate}>⬇️ Download Template CSV</Btn>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={handleFile}/>
        <Btn style={{width:"100%",justifyContent:"center",padding:"14px"}} onClick={()=>fileRef.current?.click()}>
          📂 Choose CSV File
        </Btn>
        <p style={{fontSize:11,color:C.textLight,textAlign:"center"}}>First row can be a header or data. Existing records matched on <strong>{tmpl.matchOn}</strong> will be updated.</p>
      </>}

      {step==="preview"&&<>
        {errors.length>0&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:12}}>
          <div style={{fontSize:12,fontWeight:700,color:C.red,marginBottom:6}}>⚠️ {errors.length} row(s) with errors — will be skipped:</div>
          {errors.map((e,i)=><div key={i} style={{fontSize:11,color:C.red}}>{e}</div>)}
        </div>}
        <div style={{fontSize:13,color:C.textMid}}>
          <strong>{rows.filter(r=>r._action==="add").length}</strong> to add &nbsp;·&nbsp;
          <strong>{rows.filter(r=>r._action==="update").length}</strong> to update &nbsp;·&nbsp;
          <strong>{errors.length}</strong> skipped
        </div>
        <div style={{maxHeight:280,overflowY:"auto",border:`1px solid ${C.border}`,borderRadius:6}}>
          <table style={{width:"100%",borderCollapse:"collapse",fontSize:11}}>
            <thead style={{background:C.navy,position:"sticky",top:0}}>
              <tr>
                <th style={{padding:"6px 10px",color:C.amber,textAlign:"left",fontWeight:700}}>Action</th>
                {tmpl.columns.slice(0,4).map(c=><th key={c} style={{padding:"6px 10px",color:"#8A9BB0",textAlign:"left"}}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.map((row,i)=><tr key={i} style={{background:i%2===0?C.white:C.offWhite,borderBottom:`1px solid ${C.border}`}}>
                <td style={{padding:"5px 10px"}}><Badge color={row._action==="add"?"green":"amber"}>{row._action==="add"?"+ Add":"↻ Update"}</Badge></td>
                {tmpl.columns.slice(0,4).map(c=><td key={c} style={{padding:"5px 10px",color:C.textDark,fontFamily:c==="id"?"monospace":"sans-serif"}}>{row[c]||<span style={{color:C.textLight}}>—</span>}</td>)}
              </tr>)}
            </tbody>
          </table>
        </div>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
          <Btn variant="outline" onClick={()=>setStep("upload")}>← Back</Btn>
          <Btn onClick={runImport} disabled={importing||rows.length===0}>
            {importing?`Importing…`:`✅ Import ${rows.length} Records`}
          </Btn>
        </div>
      </>}

      {step==="done"&&<>
        <div style={{textAlign:"center",padding:"20px 0"}}>
          <div style={{fontSize:48,marginBottom:12}}>✅</div>
          <div style={{fontSize:18,fontWeight:700,color:C.navy,marginBottom:8}}>Import Complete</div>
          <div style={{display:"flex",justifyContent:"center",gap:24,marginTop:12}}>
            <div style={{textAlign:"center"}}><div style={{fontFamily:"monospace",fontSize:28,fontWeight:700,color:C.greenText}}>{results.added}</div><div style={{fontSize:12,color:C.textLight}}>Added</div></div>
            <div style={{textAlign:"center"}}><div style={{fontFamily:"monospace",fontSize:28,fontWeight:700,color:C.amber}}>{results.updated}</div><div style={{fontSize:12,color:C.textLight}}>Updated</div></div>
            {results.failed>0&&<div style={{textAlign:"center"}}><div style={{fontFamily:"monospace",fontSize:28,fontWeight:700,color:C.red}}>{results.failed}</div><div style={{fontSize:12,color:C.textLight}}>Failed</div></div>}
          </div>
        </div>
        <Btn style={{width:"100%",justifyContent:"center"}} onClick={onClose}>Done</Btn>
      </>}

    </div>
  </Modal>;
}

// ─── Customers Tab ────────────────────────────────────────────────────────────
function CustomersTab({ customers, lps, actions }) {
  const [showAdd,setShowAdd]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [editCust,setEditCust]=useState(null);
  const [search,setSearch]=useState("");
  const emptyForm={name:"",contact:"",phone:"",email:"",address_line1:"",address_line2:"",city:"",state:"",zip:""};

  const filtered=customers.filter(c=>c.name.toLowerCase().includes(search.toLowerCase())||c.city?.toLowerCase().includes(search.toLowerCase()));

  return <div>
    <div style={{display:"flex",gap:10,marginBottom:18,alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search customers…" style={{...inputStyle,flex:1}}/>
      <Btn variant="outline" onClick={()=>setShowImport(true)}>📂 Import CSV</Btn>
      <Btn onClick={()=>setShowAdd(true)}>+ Add Customer</Btn>
    </div>
    <div style={{display:"grid",gap:10}}>
      {filtered.map(c=>{
        const custLps=lps.filter(l=>l.customer_id===c.id);
        return <div key={c.id} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"16px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
            <div style={{flex:1}}>
              <div style={{fontWeight:800,fontSize:15,color:C.navy,marginBottom:4}}>{c.name}</div>
              {(c.address_line1||c.city)&&<div style={{fontSize:12,color:C.textMid,marginBottom:4}}>
                {[c.address_line1,c.address_line2,c.city,c.state,c.zip].filter(Boolean).join(", ")}
              </div>}
              <div style={{display:"flex",gap:16,flexWrap:"wrap"}}>
                {c.contact&&<span style={{fontSize:12,color:C.textMid}}>👤 {c.contact}</span>}
                {c.email&&<span style={{fontSize:12,color:C.textMid}}>✉ {c.email}</span>}
                {c.phone&&<span style={{fontSize:12,color:C.textMid}}>📞 {c.phone}</span>}
              </div>
            </div>
            <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:8}}>
              <div style={{textAlign:"right"}}>
                <div style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:C.amber}}>{custLps.length}</div>
                <div style={{fontSize:11,color:C.textLight}}>shipments</div>
              </div>
              <Btn variant="outline" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setEditCust(c)}>Edit</Btn>
            </div>
          </div>
          {custLps.length>0&&<div style={{marginTop:10,paddingTop:10,borderTop:`1px solid ${C.border}`,display:"flex",flexWrap:"wrap",gap:6}}>
            {custLps.slice(0,5).map(lp=><span key={lp.id} style={{background:"#EBF2FA",color:C.navy,border:"1px solid #9DC3E6",borderRadius:3,padding:"2px 8px",fontSize:11,fontFamily:"monospace"}}>{lp.id}</span>)}
            {custLps.length>5&&<span style={{fontSize:11,color:C.textLight}}>+{custLps.length-5} more</span>}
          </div>}
        </div>;
      })}
      {filtered.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No customers found.</div>}
    </div>
    {showAdd&&<CustomerModal title="Add Customer" initialForm={emptyForm} actions={actions} onClose={()=>setShowAdd(false)}/>}
    {editCust&&<CustomerModal title="Edit Customer" initialForm={editCust} customerId={editCust.id} actions={actions} onClose={()=>setEditCust(null)}/>}
    {showImport&&<CsvImportModal type="customers" actions={actions} existingRecords={customers} onClose={()=>setShowImport(false)}/>}
  </div>;
}


function CustomerModal({ title, initialForm, customerId, actions, onClose }) {
  const [form,setForm]=useState({
    name:initialForm.name||"", contact:initialForm.contact||"", phone:initialForm.phone||"",
    email:initialForm.email||"", address_line1:initialForm.address_line1||"",
    address_line2:initialForm.address_line2||"", city:initialForm.city||"",
    state:initialForm.state||"", zip:initialForm.zip||""
  });
  const [saving,setSaving]=useState(false);
  const f=k=>e=>setForm(p=>({...p,[k]:e.target.value}));

  async function save(){
    if(!form.name)return;
    setSaving(true);
    try {
      if(customerId) await actions.updateCustomer(customerId,form);
      else await actions.addCustomer(form);
      onClose();
    } catch(e){ alert(e.message); setSaving(false); }
  }

  return <Modal title={title} onClose={onClose}>
    <div style={{display:"grid",gap:14}}>
      <Input label="Company Name *" value={form.name} onChange={f("name")} placeholder="e.g. Murphy Builders"/>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Input label="Contact Name" value={form.contact} onChange={f("contact")} placeholder="Full name"/>
        <Input label="Phone" value={form.phone} onChange={f("phone")} placeholder="(555) 000-0000"/>
      </div>
      <Input label="Email" value={form.email} onChange={f("email")} placeholder="orders@company.com"/>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
        <SectionTitle>Ship To Address</SectionTitle>
        <div style={{display:"grid",gap:10}}>
          <Input label="Address Line 1" value={form.address_line1} onChange={f("address_line1")} placeholder="808 Boardman Dr"/>
          <Input label="Address Line 2" value={form.address_line2} onChange={f("address_line2")} placeholder="Suite 100 (optional)"/>
          <div style={{display:"grid",gridTemplateColumns:"2fr 1fr 1fr",gap:10}}>
            <Input label="City" value={form.city} onChange={f("city")} placeholder="Gallup"/>
            <Input label="State" value={form.state} onChange={f("state")} placeholder="NM"/>
            <Input label="ZIP" value={form.zip} onChange={f("zip")} placeholder="87301"/>
          </div>
        </div>
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={save} disabled={!form.name||saving}>{saving?"Saving…":customerId?"Save Changes":"Add Customer"}</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────
function SuppliersTab({ suppliers, parts, actions }) {
  const [showAdd,setShowAdd]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const [form,setForm]=useState({name:"",contact:"",phone:""});
  const [saving,setSaving]=useState(false);
  async function add(){if(!form.name)return;setSaving(true);await actions.addSupplier(form);setSaving(false);setForm({name:"",contact:"",phone:""});setShowAdd(false);}
  return <div>
    <div style={{display:"flex",justifyContent:"flex-end",gap:10,marginBottom:18}}>
      <Btn variant="outline" onClick={()=>setShowImport(true)}>📂 Import CSV</Btn>
      <Btn onClick={()=>setShowAdd(true)}>+ Add Supplier</Btn>
    </div>
    <div style={{display:"grid",gap:10}}>
      {suppliers.map(s=>{
        const linked=parts.filter(p=>p.suppliers?.find(x=>x.supplierId===s.id));
        return <div key={s.id} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"16px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontWeight:800,fontSize:15,color:C.navy}}>{s.name}</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:C.textLight,marginTop:2}}>{s.id}</div>
              <div style={{display:"flex",gap:18,marginTop:8}}><span style={{fontSize:12,color:C.textMid}}>✉ {s.contact}</span><span style={{fontSize:12,color:C.textMid}}>📞 {s.phone}</span></div>
            </div>
            <div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:24,fontWeight:700,color:C.amber}}>{linked.length}</div><div style={{fontSize:11,color:C.textLight}}>linked SKUs</div></div>
          </div>
          {linked.length>0&&<div style={{marginTop:12,paddingTop:12,borderTop:`1px solid ${C.border}`,display:"flex",flexWrap:"wrap",gap:6}}>
            {linked.map(p=><span key={p.id} style={{background:"#EBF2FA",color:C.navy,border:"1px solid #9DC3E6",borderRadius:3,padding:"2px 8px",fontSize:11,fontFamily:"monospace"}}>{p.id}</span>)}
          </div>}
        </div>;
      })}
    </div>
    {showAdd&&<Modal title="Add Supplier" onClose={()=>setShowAdd(false)}>
      <div style={{display:"grid",gap:14}}>
        <Input label="Supplier Name" value={form.name} onChange={e=>setForm(f=>({...f,name:e.target.value}))}/>
        <Input label="Contact Email" value={form.contact} onChange={e=>setForm(f=>({...f,contact:e.target.value}))}/>
        <Input label="Phone" value={form.phone} onChange={e=>setForm(f=>({...f,phone:e.target.value}))}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
          <Btn variant="outline" onClick={()=>setShowAdd(false)}>Cancel</Btn>
          <Btn onClick={add} disabled={saving}>{saving?"Saving…":"Add Supplier"}</Btn>
        </div>
      </div>
    </Modal>}
    {showImport&&<CsvImportModal type="suppliers" actions={actions} existingRecords={suppliers} onClose={()=>setShowImport(false)}/>}
  </div>;
}
function InventoryTab({ parts, suppliers, replen, onOpenReplenishment }) {
  const {byPart,result}=replen;
  const [search,setSearch]=useState("");
  const statusOf=p=>stockStatus(p,byPart.get(p.id));
  const needs=p=>{ const r=byPart.get(p.id); return !!r&&((r.order_qty||0)>0||r.flags.some(f=>f==="expedite_open_po"||f==="shortage_but_do_not_reorder")); };
  const counts={needs:parts.filter(needs).length, out:parts.filter(p=>!(p.stock>0)).length, all:parts.length};
  const [filter,setFilter]=useState(counts.needs>0?"needs":"all");
  const rank={red:0,amber:1,blue:2,gray:3,green:4};
  const view=parts.filter(p=>(filter==="all"||(filter==="needs"?needs(p):!(p.stock>0)))&&partMatchesSearch(p,search))
    .sort((a,b)=>(rank[statusOf(a).color]-rank[statusOf(b).color])||(String(a.location||"~").localeCompare(String(b.location||"~")))||a.id.localeCompare(b.id));
  const supName=id=>suppliers.find(s=>s.id===id)?.name;
  const chip=(k,label)=><button key={k} onClick={()=>setFilter(k)} style={{border:`1.5px solid ${filter===k?C.navy:C.border}`,background:filter===k?C.navy:C.white,color:filter===k?"#fff":C.navy,
    borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{label} <span style={{opacity:.7}}>{counts[k]}</span></button>;
  const num=(v,l,color)=><div style={{textAlign:"right",minWidth:54}}><div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:color||C.navy}}>{v}</div><div style={{fontSize:10,color:C.textLight}}>{l}</div></div>;
  return <div>
    <div style={{background:C.offWhite,border:`1px solid ${C.border}`,borderRadius:7,padding:"10px 14px",marginBottom:12,fontSize:12,color:C.textMid,display:"flex",gap:10,alignItems:"center",flexWrap:"wrap"}}>
      <span style={{flex:1,minWidth:200}}>Order suggestions come from <b>Replenishment</b>. It weighs open orders, open POs, lead times and each part's minimum stock, so every screen gives the same answer.</span>
      <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={onOpenReplenishment}>📈 Open Replenishment</Btn>
    </div>
    <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search part no., old no. or description…" style={{...inputStyle,flex:"1 1 220px"}}/>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
      {chip("needs","Needs ordering")}{chip("out","Out of stock")}{chip("all","All parts")}
    </div>
    <div style={{display:"grid",gap:10}}>
      {view.map(p=>{
        const r=byPart.get(p.id); const st=statusOf(p);
        const qty=r?(r.firm_order_qty||r.order_qty):0;
        return <div key={p.id} style={{background:C.white,border:`1.5px solid ${st.color==="red"?C.redBorder:C.border}`,borderRadius:7,padding:"12px 16px",display:"grid",gap:8}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}><span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:C.amber}}>{p.id}</span><Badge color={st.color}>{st.label}</Badge></div>
              <div style={{fontWeight:700,fontSize:14,color:C.navy,marginTop:2}}>{p.description}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:2}}>📍 {p.location||"—"} · {p.category}{+p.minStock>0?` · min ${p.minStock}`:""}</div>
            </div>
            <div style={{display:"flex",gap:10}}>
              {num(p.stock??0,`${p.uom||"EA"} on hand`,!(p.stock>0)?C.red:C.navy)}
              {r?.allocated_qty>0&&num(r.allocated_qty,"reserved",C.textMid)}
              {r?.on_order>0&&num(r.on_order,"on order",C.greenText)}
            </div>
          </div>
          {r&&(qty>0||r.flags.length>0)&&<div onClick={onOpenReplenishment} style={{cursor:"pointer",background:st.color==="red"?C.redLight:st.color==="amber"?C.warnBg:"#EBF2FA",border:`1px solid ${st.color==="red"?C.redBorder:st.color==="amber"?C.warnBdr:"#9DC3E6"}`,borderRadius:6,padding:"8px 12px",fontSize:12,color:C.navy,display:"flex",gap:10,flexWrap:"wrap",alignItems:"center"}}>
            <span style={{flex:1,minWidth:180}}>
              {qty>0?<><b>Order {qty} {p.uom||"EA"}</b>{r.order_by?` by ${fmtDate(r.order_by)}`:""}{r.need_by?` · needed ${fmtDate(r.need_by)}`:""}{r.supplier_id?` · ${supName(r.supplier_id)||r.supplier_id}`:" · no supplier set"}</>
                :<b>{r.flags.includes("expedite_open_po")?`Open PO arrives ${r.po_late_days} day(s) late. Expedite it.`:"Short, but set to do not reorder."}</b>}
              <div style={{color:C.textMid,marginTop:2}}>{r.reason}</div>
            </span>
            <span style={{fontWeight:700,color:C.navy,whiteSpace:"nowrap"}}>Replenishment ›</span>
          </div>}
        </div>;
      })}
      {view.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>{filter==="needs"?"Nothing needs ordering right now.":"No parts match."}</div>}
    </div>
  </div>;
}


// ─── License Plates Tab ───────────────────────────────────────────────────────
function LicensePlatesTab({ fabricators, lps, parts, customers, packingSlipTypes, mfgBarcodes, actions, focus, onFocusDone, onOpenOrder }) {
  const [showCreate,setShowCreate]=useState(false);
  const [viewLp,setViewLp]=useState(null);
  const [pickId,setPickId]=useState(null);
  const [search,setSearch]=useState("");
  const [statusFilter,setStatusFilter]=useState("Active");
  // Opened from another tab (e.g. an order): show that LP, or go straight to picking.
  useEffect(()=>{
    if(!focus) return;
    if(focus.pick) setPickId(focus.id); else setViewLp({id:focus.id});
    setStatusFilter("All");
    onFocusDone?.();
  },[focus]);
  const sc=lpStatusColor;
  const custName=id=>customers?.find(c=>c.id===id)?.name||"";
  const openIssues=lp=>(lp.items||[]).filter(i=>i.issue&&!i.issue.resolved_at).length;
  const FILTERS={Active:l=>!["Delivered","Cancelled"].includes(l.status), "To pick":l=>lpIsPrep(l.status), "At fabricator":l=>lpAtFabricator(l.status),
    Shipped:l=>l.status==="Shipped", Delivered:l=>l.status==="Delivered", Cancelled:l=>l.status==="Cancelled", All:()=>true, Problems:l=>openIssues(l)>0};
  const counts=Object.fromEntries(Object.entries(FILTERS).map(([k,f])=>[k,lps.filter(f).length]));
  const q=search.trim().toLowerCase();
  const shown=lps.filter(lp=>{
    if(!(FILTERS[statusFilter]||FILTERS.All)(lp)) return false;
    if(!q) return true;
    const hay=[lp.id,lp.destination,custName(lp.customer_id),lp.quote_number,lp.po_number,lp.order_id,lp.packing_slip_type,
      fabricators?.find(f=>f.id===lp.fabricator_id)?.name,...(lp.items||[]).map(i=>i.partId)].filter(Boolean).join(" ").toLowerCase();
    return hay.includes(q);
  });
  const chip=(k,label)=><button key={k} onClick={()=>setStatusFilter(k)} style={{border:`1.5px solid ${statusFilter===k?C.navy:C.border}`,background:statusFilter===k?C.navy:C.white,color:statusFilter===k?"#fff":C.navy,
    borderRadius:16,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer",whiteSpace:"nowrap"}}>{label} <span style={{opacity:.7}}>{counts[k]}</span></button>;
  return <div>
    <div style={{display:"flex",gap:10,marginBottom:10,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search LP, customer, quote, PO, order, part…" style={{...inputStyle,flex:"1 1 220px"}}/>
      <Btn onClick={()=>setShowCreate(true)}>+ Create License Plate</Btn>
    </div>
    <div style={{display:"flex",gap:6,marginBottom:14,overflowX:"auto",paddingBottom:2}}>
      {["Active","To pick","At fabricator","Shipped","Delivered","Cancelled","All"].map(k=>chip(k,k))}
      {counts.Problems>0&&chip("Problems","⚠ Problems")}
    </div>
    <div style={{display:"grid",gap:10}}>
      {shown.map(lp=>{
        const pr=lpPickProgress(lp.items); const issues=openIssues(lp);
        const outbound=(lp.type||"Outbound")==="Outbound";
        const checked=(lp.items||[]).filter(i=>i.checked).length; const hasChecklist=(lp.items||[]).some(i=>i.list||i.source);
        const done=pr.qty>0&&pr.picked>=pr.qty;
        const created=String(lp.createdAt||lp.created_at||"").slice(0,10);
        return <div key={lp.id} onClick={()=>setViewLp(lp)} style={{background:C.white,border:`1.5px solid ${issues?C.redBorder:C.border}`,borderRadius:7,padding:"12px 16px",cursor:"pointer",transition:"border-color .15s",display:"grid",gap:8}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=issues?C.redBorder:C.border;}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:10}}>
            <div style={{minWidth:0,flex:1}}>
              <div style={{display:"flex",alignItems:"center",gap:6,marginBottom:4,flexWrap:"wrap"}}>
                <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.navy}}>{lp.id}</span>
                <Badge color={sc(lp.status)}>{lp.status}</Badge>
                {!outbound&&<Badge color="navy">{lp.type}</Badge>}
                {lp.order_id&&<button onClick={e=>{e.stopPropagation();onOpenOrder?.(lp.order_id);}} title="Open the order"
                  style={{border:"1px solid #9DC3E6",background:"#EBF2FA",color:C.navy,borderRadius:4,padding:"1px 8px",fontSize:11,fontWeight:700,cursor:"pointer",fontFamily:"monospace"}}>📑 {lp.order_id}</button>}
                {lp.fabricator_id&&<Badge color="blue">🏭 {fabricators?.find(f=>f.id===lp.fabricator_id)?.name||lp.fabricator_id}</Badge>}
                {issues>0&&<Badge color="red">⚠ {issues} problem{issues>1?"s":""}</Badge>}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy,overflowWrap:"anywhere"}}>{custName(lp.customer_id)||lp.destination}</div>
              {custName(lp.customer_id)&&lp.destination&&lp.destination!==custName(lp.customer_id)&&<div style={{fontSize:12,color:C.textMid}}>→ {lp.destination}</div>}
              <div style={{fontSize:11,color:C.textLight,marginTop:2,display:"flex",gap:10,flexWrap:"wrap"}}>
                {created&&<span>Created {fmtDate(created)}</span>}
                {lp.quote_number&&<span>Quote <strong>{lp.quote_number}</strong></span>}
                {lp.po_number&&<span>PO <strong>{lp.po_number}</strong></span>}
                <span>{(lp.items||[]).length} line{(lp.items||[]).length!==1?"s":""}</span>
              </div>
            </div>
            {outbound&&lpIsPrep(lp.status)&&pr.qty>0&&<button onClick={e=>{e.stopPropagation();setPickId(lp.id);}}
              style={{flexShrink:0,minHeight:44,minWidth:72,borderRadius:8,border:"none",background:done?C.greenText:C.navy,color:"#fff",fontWeight:800,fontSize:13,cursor:"pointer"}}>{done?"✓ Picked":"▶ Pick"}</button>}
          </div>
          {outbound&&pr.qty>0&&<div>
            <div style={{display:"flex",justifyContent:"space-between",fontSize:11,color:C.textMid,marginBottom:3,gap:8,flexWrap:"wrap"}}>
              <span><b style={{color:done?C.greenText:C.navy}}>{pr.picked} of {pr.qty}</b> picked</span>
              <span>{pr.direct>0&&<span style={{color:C.amber,fontWeight:700}}>🚚 {pr.direct} direct-ship open</span>}{hasChecklist&&<span style={{marginLeft:pr.direct?10:0}}>☑ {checked}/{(lp.items||[]).length} checked</span>}</span>
            </div>
            <div style={{background:C.border,height:6,borderRadius:3,overflow:"hidden"}}><div style={{height:"100%",width:`${pr.picked/pr.qty*100}%`,background:done?C.greenText:C.amber}}/></div>
          </div>}
        </div>;
      })}
      {shown.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>{lps.length===0?"No license plates yet. Create one from an order.":"No license plates match."}</div>}
    </div>
    {showCreate&&<CreateLpModal parts={parts} customers={customers} packingSlipTypes={packingSlipTypes} actions={actions} onClose={()=>setShowCreate(false)}/>}
    {viewLp&&lps.find(l=>l.id===viewLp.id)&&<LpDetailModal fabricators={fabricators} lp={lps.find(l=>l.id===viewLp.id)} parts={parts} customers={customers} packingSlipTypes={packingSlipTypes} mfgBarcodes={mfgBarcodes||[]} actions={actions}
      onClose={()=>setViewLp(null)} onStartPick={id=>{setViewLp(null);setPickId(id);}} onOpenOrder={onOpenOrder}/>}
    {pickId&&<PickScreen lpId={pickId} lps={lps} parts={parts} mfgBarcodes={mfgBarcodes||[]} actions={actions} onClose={()=>setPickId(null)}/>}
  </div>;
}

function CreateLpModal({ parts, customers, packingSlipTypes, actions, onClose }) {
  const [form,setForm]=useState({type:"Outbound",destination:"",status:"Open",packing_slip_type:"",quote_number:"",po_number:"",customer_id:""});
  const [items,setItems]=useState([]);
  const [pickPart,setPickPart]=useState(""); const [pickQty,setPickQty]=useState(1);
  const [saving,setSaving]=useState(false);
  const [newTypeInput,setNewTypeInput]=useState("");
  const [addingType,setAddingType]=useState(false);

  function addItem(){if(!pickPart||pickQty<1||items.find(i=>i.partId===pickPart))return;setItems(p=>[...p,{partId:pickPart,qty:+pickQty}]);setPickPart("");setPickQty(1);}
  async function create(){if(!form.destination||items.length===0)return;setSaving(true);await actions.createLP(form,items);setSaving(false);onClose();}
  async function addCustomType(){if(!newTypeInput.trim())return;await actions.addPackingSlipType(newTypeInput.trim());setForm(f=>({...f,packing_slip_type:newTypeInput.trim()}));setNewTypeInput("");setAddingType(false);}
  const available=parts.filter(p=>!items.find(i=>i.partId===p.id));

  const unsaved=items.length>0||!!form.destination||!!form.quote_number||!!form.po_number;
  return <Modal title="Create License Plate" onClose={onClose} confirmClose={unsaved?"Discard this new license plate?":null}>
    <div style={{display:"grid",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Sel label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}><option>Outbound</option><option>Inbound</option><option>Transfer</option></Sel>
        <div style={{fontSize:12,color:C.textMid,alignSelf:"end",paddingBottom:10}}>Starts as <b>Open</b>; picking moves it to Picking.</div>
      </div>
      <Field label="Customer">
        <select value={form.customer_id} onChange={e=>{
          const c=customers.find(x=>x.id===e.target.value);
          setForm(f=>({...f,customer_id:e.target.value,destination:c?c.name:f.destination}));
        }} style={{...inputStyle,width:"100%"}}>
          <option value="">Select customer…</option>
          {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </Field>
      <Input label="Destination / Ship To" value={form.destination} onChange={e=>setForm(f=>({...f,destination:e.target.value}))} placeholder="Customer or location name"/>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Input label="Quote Number" value={form.quote_number} onChange={e=>setForm(f=>({...f,quote_number:e.target.value}))} placeholder="e.g. 4113"/>
        <Input label="P.O. Number" value={form.po_number} onChange={e=>setForm(f=>({...f,po_number:e.target.value}))} placeholder="e.g. 26-200-02"/>
      </div>
      <div>
        <Field label="Packing Slip Type">
          <div style={{display:"flex",gap:8}}>
            <select value={form.packing_slip_type} onChange={e=>setForm(f=>({...f,packing_slip_type:e.target.value}))} style={{...inputStyle,flex:1}}>
              <option value="">Select type…</option>
              {packingSlipTypes.map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
            </select>
            <Btn variant="outline" style={{padding:"6px 12px",fontSize:12,whiteSpace:"nowrap"}} onClick={()=>setAddingType(v=>!v)}>+ New</Btn>
          </div>
        </Field>
        {addingType&&<div style={{display:"flex",gap:8,marginTop:8}}>
          <input value={newTypeInput} onChange={e=>setNewTypeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomType()}
            placeholder="e.g. Bulk Parts" style={{...inputStyle,flex:1}}/>
          <Btn onClick={addCustomType} disabled={!newTypeInput.trim()}>Add</Btn>
        </div>}
      </div>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
        <SectionTitle>Line Items</SectionTitle>
        {items.map((it,i)=>{const p=parts.find(x=>x.id===it.partId);return(
          <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:8,padding:"8px 12px",background:C.offWhite,borderRadius:6,marginBottom:6}}>
            <div style={{minWidth:0,overflowWrap:"anywhere"}}><span style={{fontFamily:"monospace",fontSize:12,color:C.amber}}>{it.partId}</span><span style={{fontSize:12,color:C.textMid,marginLeft:8}}>{p?.description}</span></div>
            <div style={{display:"flex",alignItems:"center",gap:8,flexShrink:0}}><span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.navy}}>×{it.qty}</span><Btn variant="ghost" style={{padding:"2px 6px",fontSize:12}} onClick={()=>setItems(p=>p.filter((_,j)=>j!==i))}>✕</Btn></div>
          </div>
        );})}
        {available.length>0&&<div style={{display:"flex",flexWrap:"wrap",gap:8,marginTop:8,alignItems:"flex-end"}}>
          <div style={{flex:"1 1 100%",minWidth:0}}><PartPicker parts={available} value={pickPart} onChange={setPickPart}/></div>
          <input type="number" inputMode="numeric" min={1} value={pickQty} onChange={e=>setPickQty(e.target.value)} style={{...inputStyle,width:72,minHeight:44,fontFamily:"monospace"}}/>
          <Btn variant="outline" onClick={addItem} disabled={!pickPart} style={{minHeight:44}}>Add</Btn>
        </div>}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={create} disabled={!form.destination||items.length===0||saving}>{saving?"Creating…":"Create LP"}</Btn>
      </div>
    </div>
  </Modal>;
}

// ─── License plate statuses ──────────────────────────────────────────────────
// Open → Picking (automatic on first pick) → Sent to Fabricator (TGO) → Received / Received with
// issues (automatic from the fabricator's check-off) → Shipped (fabricator, to the customer) →
// Delivered (TGO). Maintenance LPs can go Open/Picking → Shipped directly. The database trigger
// lp_auto_status keeps the automatic steps right whoever edits the LP.
const LP_STATUSES=["Open","Picking","Sent to Fabricator","Received","Received with issues","Shipped","Delivered","Cancelled"];
const lpStatusColor=s=>({Open:"gray",Picking:"amber","Sent to Fabricator":"blue",Received:"green","Received with issues":"red",Shipped:"navy",Delivered:"green",Cancelled:"red"}[s]||"gray");
const lpIsPrep=s=>s==="Open"||s==="Picking";          // still being picked at TGO: editable, pickable
const lpAtFabricator=s=>s==="Sent to Fabricator"||s==="Received"||s==="Received with issues";

// ─── License plate print (packing list) ──────────────────────────────────────
// Letter-size, table layout: grouped by packing list type (Main / Loose / Spare…), then by box,
// lines in bin order. Direct-ship items listed separately. Photos and line barcodes can be
// switched off in the print window before printing.
async function printLicensePlate({ lp, items, parts, customer, packingSlipTypes=[], fabricator }){
  const w=window.open("","_blank");           // open first, inside the click, so pop-up blockers allow it
  if(!w){ alert("Allow pop-ups to print the license plate."); return; }
  w.document.write("<p style='font:14px Arial;padding:24px'>Preparing license plate…</p>");
  // Barcodes are drawn here with the bundled library, then written into the page as SVG,
  // so printing works offline and never waits on a CDN.
  let JsBarcode=null;
  try{ JsBarcode=(await import("jsbarcode")).default; }catch(_){ }
  const partOf=id=>parts.find(p=>p.id===id);
  const isDirect=it=>it.source==="direct";
  const listOf=it=>it.list||lp.packing_slip_type||"Items";
  const typeOrder=packingSlipTypes.map(t=>t.name);
  const rank=n=>{ const i=typeOrder.indexOf(n); return i<0?999:i; };
  const warehouse=items.map((it,i)=>({it,i})).filter(x=>!isDirect(x.it));
  const direct=items.filter(isDirect);
  const lists=[...new Set(warehouse.map(x=>listOf(x.it)))].sort((a,b)=>rank(a)-rank(b)||a.localeCompare(b));
  const sumQty=arr=>arr.reduce((s,x)=>s+(+x.qty||0),0);
  const shipped=!lpIsPrep(lp.status)&&lp.status!=="Cancelled";
  const hasBins=items.some(it=>!isDirect(it)&&String(partOf(it.partId)?.location||"").trim());
  const pcs=n=>`${n} pc${n===1?"":"s"}`;
  const bcSvg=(code,cls)=>{
    if(!JsBarcode) return `<div class="nobc">${esc(code)}</div>`;
    try{
      const el=document.createElementNS("http://www.w3.org/2000/svg","svg");
      JsBarcode(el,String(code),cls==="lp"?{format:"CODE128",width:2.2,height:56,displayValue:false,margin:0,lineColor:"#1C2B3A"}
                                         :{format:"CODE128",width:1.25,height:30,displayValue:false,margin:0,lineColor:"#1C2B3A"});
      el.setAttribute("class",cls);
      return el.outerHTML;
    }catch(_){ return `<div class="nobc">${esc(code)}</div>`; }
  };

  const row=(it)=>{
    const p=partOf(it.partId);
    const picked=+it.picked||0;
    const short=shipped&&!it.no_stock&&picked<it.qty?`<div class="short">short ${it.qty-picked}</div>`:"";
    return `<tr>
      <td class="ck"><span class="box"></span></td>
      <td class="qty">${esc(it.qty)}<div class="uom">${esc(p?.uom||"EA")}</div>${short}</td>
      <td class="pn"><b>${esc(it.partId)}</b>${p?.legacy_part_no?`<div class="old">Old #${esc(p.legacy_part_no)}</div>`:""}</td>
      <td class="desc">${esc(p?.description||it.description||"—")}</td>
      <td class="bin">${esc(p?.location||"")}</td>
      <td class="bcc lbc">${bcSvg(it.partId,"line")}</td>
      <td class="ph">${p?.image_url?`<img src="${esc(p.image_url)}" alt="">`:""}</td>
    </tr>`;
  };
  const colHead=`<tr class="cols"><th class="ck">✓</th><th class="qty">Qty</th><th class="pn">Part #</th><th class="desc">Description</th><th class="bin">Bin</th><th class="bcc lbc">Barcode</th><th class="ph">Photo</th></tr>`;

  const sections=lists.map(name=>{
    const rows=warehouse.filter(x=>listOf(x.it)===name).map(x=>x.it);
    const boxes=[...new Set(rows.map(it=>it.box&&it.box!==name?it.box:""))];   // in the order they first appear
    const body=boxes.map(bx=>{
      const r=rows.filter(it=>(it.box&&it.box!==name?it.box:"")===bx);   // same order as the packing list
      const label=bx?bx.replace(new RegExp("^"+name.replace(/[.*+?^${}()|[\]\\]/g,"\\$&")+"\\s*","i"),"")||bx:"";
      return `<tbody class="${r.length<=16?"keep":""}">${bx?`<tr class="boxrow"><td colspan="7">📦 ${esc(label)} <span>· ${r.length} line${r.length!==1?"s":""} · ${pcs(sumQty(r))}</span></td></tr>`:""}${r.map(row).join("")}</tbody>`;
    }).join("");
    return `<table class="lines">
      <thead><tr class="grp"><th colspan="7"><span class="type">${esc(name)}</span><span class="gmeta">${rows.length} line${rows.length!==1?"s":""} · ${pcs(sumQty(rows))}${boxes.filter(Boolean).length?` · ${boxes.filter(Boolean).length} box${boxes.filter(Boolean).length!==1?"es":""}`:""}</span><span class="gid">${esc(lp.id)}</span></th></tr>${colHead}</thead>
      ${body}</table>`;
  }).join("");

  const directSec=direct.length?`<table class="lines direct">
      <thead><tr class="grp"><th colspan="5"><span class="type">Ships direct from supplier</span><span class="gmeta">Not in this container · ${direct.length} line${direct.length!==1?"s":""}</span><span class="gid">${esc(lp.id)}</span></th></tr>
      <tr class="cols"><th class="ck">✓</th><th class="qty">Qty</th><th class="pn">Part #</th><th class="desc">Description</th><th>Supplier / PO</th></tr></thead>
      <tbody>${direct.map(it=>{const p=partOf(it.partId);return `<tr><td class="ck"><span class="box"></span></td><td class="qty">${esc(it.qty)}<div class="uom">${esc(p?.uom||"EA")}</div></td><td class="pn"><b>${esc(it.partId)}</b></td><td class="desc">${esc(p?.description||it.description||"—")}</td><td>${esc(it.supplier||"—")}${it.supplier_po?`<div class="old">PO ${esc(it.supplier_po)}</div>`:""}</td></tr>`;}).join("")}</tbody></table>`:"";

  const summary=lists.map(name=>{const r=warehouse.filter(x=>listOf(x.it)===name).map(x=>x.it); const nb=new Set(r.map(it=>it.box).filter(b=>b&&b!==name)).size;
    return `<tr><td><b>${esc(name)}</b></td><td>${r.length}</td><td>${sumQty(r)}</td><td>${nb||"—"}</td></tr>`;}).join("")
    +(direct.length?`<tr class="dim"><td>Ships direct (not in container)</td><td>${direct.length}</td><td>${sumQty(direct)}</td><td>—</td></tr>`:"");
  const addr=customer?[customer.address_line1,customer.address_line2,[customer.city,customer.state].filter(Boolean).join(", ")+(customer.zip?" "+customer.zip:"")].filter(x=>x&&x.trim()).map(esc).join("<br>"):"";
  const created=String(lp.createdAt||lp.created_at||"").slice(0,10);
  const kv=(k,v)=>v?`<div class="kv"><span>${k}</span><b>${esc(v)}</b></div>`:"";

  let prefs={photos:true,barcodes:true};
  try{ prefs={...prefs,...JSON.parse(localStorage.getItem("ct_lp_print")||"{}")}; }catch(_){}

  w.document.open();
  w.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>${esc(lp.id)} — License Plate</title>
<style>
@page{size:letter;margin:0.45in 0.4in 0.5in;
  @bottom-left{content:"${esc(lp.id)}";font:9px Arial,sans-serif;color:#556}
  @bottom-right{content:"Page " counter(page) " of " counter(pages);font:9px Arial,sans-serif;color:#556}}
*{box-sizing:border-box}body{font-family:Arial,Helvetica,sans-serif;color:#1C2B3A;margin:0;font-size:11px;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.wrap{max-width:7.7in;margin:0 auto}
.bar{position:sticky;top:0;background:#1C2B3A;color:#fff;padding:10px 14px;display:flex;gap:16px;align-items:center;flex-wrap:wrap;font-size:13px;z-index:5}
.bar label{display:flex;gap:6px;align-items:center;cursor:pointer}.bar button{margin-left:auto;background:#F5A623;color:#1C2B3A;border:0;border-radius:6px;padding:8px 18px;font-weight:800;font-size:14px;cursor:pointer}
.head{display:grid;grid-template-columns:1fr 2.9in;gap:14px;border:2px solid #1C2B3A;border-top:5px solid #F5A623;border-radius:6px;padding:10px 12px;margin:12px 0 10px}
.co{font-size:18px;font-weight:900}.co small{display:block;font-size:9px;letter-spacing:2px;color:#8A5A00;text-transform:uppercase}
.kvs{display:grid;grid-template-columns:1fr 1fr;gap:4px 14px;margin-top:8px}.kv span{display:block;font-size:8.5px;text-transform:uppercase;letter-spacing:.6px;color:#667}.kv b{font-size:11.5px}
.lpbc{text-align:center}.lpbc svg{width:100%;height:.9in}.nobc{font:700 11px monospace}.lpid{font:800 15px monospace;margin-top:2px}
.badges{margin-top:4px}.badge{display:inline-block;font-size:9px;font-weight:800;text-transform:uppercase;border:1px solid #9AA;border-radius:3px;padding:1px 6px;margin:0 2px}
.sum{width:100%;border-collapse:collapse;margin:0 0 12px;font-size:11px}.sum th{background:#E8EDF2;text-align:left;padding:4px 8px;font-size:9px;text-transform:uppercase;letter-spacing:.5px}.sum td{padding:4px 8px;border-bottom:1px solid #E0E3E7}.sum .dim td{color:#667}
table.lines{width:100%;border-collapse:collapse;margin:0 0 12px;page-break-inside:auto}
.lines thead{display:table-header-group}
.grp th{background:#FEF3DC;color:#1C2B3A;text-align:left;padding:6px 8px;border-left:7px solid #F5A623;border-top:2px solid #1C2B3A}
.grp .type{font-size:15px;font-weight:900;text-transform:uppercase;letter-spacing:.8px}.grp .gmeta{font-size:10px;font-weight:400;margin-left:10px;color:#4A5568}.grp .gid{float:right;font:700 10px monospace;color:#4A5568}
.cols th{font-size:8.5px;text-transform:uppercase;letter-spacing:.5px;color:#556;text-align:left;padding:3px 6px;border-bottom:1.5px solid #1C2B3A}
.boxrow td{background:#F5F6F7;font-weight:800;font-size:11px;padding:4px 8px;border-bottom:1px solid #C9D3DE}.boxrow span{font-weight:400;color:#556}
.lines td{padding:2px 6px;border-bottom:1px solid #E0E3E7;vertical-align:middle}
.lines tr{page-break-inside:avoid;break-inside:avoid}
.lines tbody.keep{break-inside:avoid;page-break-inside:avoid}   /* a box of up to 16 lines stays on one page */
.boxrow{break-after:avoid;page-break-after:avoid}
td.ck,th.ck{width:.3in;text-align:center}.box{display:inline-block;width:13px;height:13px;border:1.5px solid #1C2B3A;border-radius:2px}
td.qty,th.qty{width:.55in;text-align:center}td.qty{font:800 14px Arial;line-height:1.05}.uom{font-size:8px;font-weight:400;color:#667}.short{font-size:8.5px;color:#C8102E;font-weight:800}
td.pn,th.pn{width:1in}td.pn b{font:700 11px monospace}.old{font-size:8.5px;color:#667}
td.bin,th.bin{width:.6in;font-family:monospace}
td.bcc,th.bcc{width:1.55in}svg.line{width:1.45in;height:.28in;display:block}
td.ph,th.ph{width:.45in}td.ph img{width:.36in;height:.36in;object-fit:cover;border-radius:3px;border:1px solid #E0E3E7;display:block}
.direct .grp th{border-left-color:#8A9BB0;background:#EEF1F4}
.sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:22px;page-break-inside:avoid}.sign div{border-top:1.5px solid #1C2B3A;padding-top:4px;font-size:9.5px;color:#556}
body.no-photos .ph{display:none}body.no-bc .lbc{display:none}body.no-bins .bin{display:none}
@media print{.bar{display:none}.head{margin-top:0}}
</style></head>
<body class="${prefs.photos?"":"no-photos"} ${prefs.barcodes?"":"no-bc"} ${hasBins?"":"no-bins"}">
<div class="bar"><b>${esc(lp.id)}</b>
  <label><input type="checkbox" id="opPh" ${prefs.photos?"checked":""}> Photos</label>
  <label><input type="checkbox" id="opBc" ${prefs.barcodes?"checked":""}> Line barcodes</label>
  <button onclick="window.print()">🖨 Print</button></div>
<div class="wrap">
<div class="head">
  <div>
    <div class="co">ChlorTainer<small>TGO Technologies · License Plate / Packing List</small></div>
    <div class="kvs">
      ${kv("Customer",customer?.name)}${kv("Ship to",lp.destination&&lp.destination!==customer?.name?lp.destination:"")}
      ${kv("Order",lp.order_id)}${kv("Quote",lp.quote_number)}${kv("Customer PO",lp.po_number)}${kv("Created",created)}
      ${kv("Fabricator",fabricator?.name)}
    </div>
    ${addr?`<div class="kv" style="margin-top:6px"><span>Address</span><b style="font-weight:400">${addr}</b></div>`:""}
  </div>
  <div class="lpbc">${bcSvg(lp.id,"lp")}<div class="lpid">${esc(lp.id)}</div>
    <div class="badges"><span class="badge">${esc(lp.type||"Outbound")}</span><span class="badge">${esc(lp.status||"")}</span></div></div>
</div>
<table class="sum"><thead><tr><th>Packing list</th><th>Lines</th><th>Pieces</th><th>Boxes</th></tr></thead><tbody>${summary}
  <tr><td><b>Total</b></td><td><b>${items.length}</b></td><td><b>${sumQty(items)}</b></td><td></td></tr></tbody></table>
${sections}${directSec}
<div class="sign"><div>Packed by / date</div><div>Received by / date</div></div>
</div>
<script>
function save(){ try{ localStorage.setItem("ct_lp_print",JSON.stringify({photos:document.getElementById("opPh").checked,barcodes:document.getElementById("opBc").checked})); }catch(e){} }
document.getElementById("opPh").onchange=function(e){ document.body.classList.toggle("no-photos",!e.target.checked); save(); };
document.getElementById("opBc").onchange=function(e){ document.body.classList.toggle("no-bc",!e.target.checked); save(); };
<\/script>
</body></html>`);
  w.document.close();
}

function LpDetailModal({ fabricators, lp, parts, customers, packingSlipTypes, mfgBarcodes, actions, onClose, onStartPick, onOpenOrder }) {
  // Every change saves as soon as it is made (text fields when you leave the box,
  // quantities ~0.7 s after the last change). Status changes use the buttons at the top.
  const [status,setStatus]=useState(lp.status);
  useEffect(()=>{ setStatus(lp.status); },[lp.status]);
  const isPending = lpIsPrep(status);   // Open or Picking: fields and lines editable
  const [destination,setDestination]=useState(lp.destination||"");
  const [type,setType]=useState(lp.type||"Outbound");
  const [customerId,setCustomerId]=useState(lp.customer_id||"");
  const [packingSlipType,setPackingSlipType]=useState(lp.packing_slip_type||"");
  const [quoteNumber,setQuoteNumber]=useState(lp.quote_number||"");
  const [poNumber,setPoNumber]=useState(lp.po_number||"");
  const customer=customers?.find(c=>c.id===(customerId||lp.customer_id));
  const [items,setItems]=useState(lp.items||[]);
  const itemsRef=useRef(items); itemsRef.current=items;
  const itemsTimer=useRef(null);
  // Follow picks / check-offs made elsewhere (picking screen, fabricator) unless a local edit is waiting to save.
  useEffect(()=>{ if(!itemsTimer.current) setItems(lp.items||[]); },[lp.items]);
  const [addPartId,setAddPartId]=useState("");
  const [addQty,setAddQty]=useState(1);
  const [busy,setBusy]=useState(false);
  const [saveState,setSaveState]=useState({s:"idle",err:""});   // idle | pending | saving | saved | error
  async function persist(changes,meta={}){
    setSaveState({s:"saving",err:""});
    try{ await actions.updateLP(lp.id,changes,meta); setSaveState({s:"saved",err:""}); return true; }
    catch(e){ setSaveState({s:"error",err:e.message||String(e)}); return false; }
  }
  const saveFields=(changes)=>persist(changes,{field_edit:Object.keys(changes)});
  function queueItemsSave(next){
    itemsRef.current=next; setItems(next);
    clearTimeout(itemsTimer.current);
    setSaveState({s:"pending",err:""});
    itemsTimer.current=setTimeout(flushItems,700);
  }
  async function flushItems(){
    if(!itemsTimer.current) return true;
    clearTimeout(itemsTimer.current); itemsTimer.current=null;
    return persist({items:itemsRef.current},{items_edit:true});
  }
  async function close(){ await flushItems(); onClose(); }
  const [newTypeInput,setNewTypeInput]=useState("");
  const [addingType,setAddingType]=useState(false);

  // ── Picking (Outbound, Pending): scanning a part moves stock into this container ──
  const canPick = isPending && type==="Outbound";
  const [scanQty,setScanQty]=useState(1);
  const [pickMsg,setPickMsg]=useState(null);   // {ok:boolean, text:string}
  const pickedOf=it=>it.picked||0;
  const isDirect=it=>it.source==="direct";
  const shortLines=items.filter(it=>!isDirect(it)&&pickedOf(it)<it.qty);
  const directOpen=items.filter(it=>isDirect(it)&&!it.checked);
  const checkedCount=items.filter(it=>it.checked).length;
  const hasChecklist=items.some(it=>it.list||it.source);
  const [fabricatorId,setFabricatorId]=useState(lp.fabricator_id||"");
  async function toggleResolved(i){
    if(!(await flushItems())) return;
    const who=(getCurrentUser()?.email||"TGO staff");
    const next=items.map((x,k)=>{ if(k!==i||!x.issue) return x; const {resolved_by,resolved_at,...rest}=x.issue; return {...x,issue:x.issue.resolved_at?rest:{...rest,resolved_by:who,resolved_at:new Date().toISOString()}}; });
    setItems(next);
    try{ await actions.updateLP(lp.id,{items:next},{issue_resolve:true}); }catch(e){ setItems(items); setPickMsg({ok:false,text:"Could not save: "+(e.message||e)}); }
  }
  async function toggleCheck(i){
    if(!(await flushItems())) return;
    const who=(getCurrentUser()?.email||"TGO staff");
    const next=items.map((x,k)=>{ if(k!==i) return x; const {checked,checked_by,checked_at,...rest}=x; return x.checked?rest:{...rest,checked:true,checked_by:who,checked_at:new Date().toISOString()}; });
    setItems(next);
    try{ await actions.updateLP(lp.id,{items:next},{checklist:true}); }catch(e){ setItems(items); setPickMsg({ok:false,text:"Could not save check-off: "+(e.message||e)}); }
  }

  function resolvePart(code){
    const c=(code||"").trim();
    if(!c) return null;
    const cands=findPartsByCode(parts,c);
    if(cands.length===1) return cands[0].id;
    if(cands.length>1){
      const onLp=cands.filter(p=>items.find(i=>i.partId===p.id));
      if(onLp.length===1) return onLp[0].id;
      return {ambiguous:cands};
    }
    const mb=(mfgBarcodes||[]).find(b=>(b.barcode||"").trim()===c);
    return mb?mb.part_id:null;
  }
  async function pick(code, qty=scanQty, lineIdx=null){
    if(!(await flushItems())) return;
    const partId=resolvePart(code);
    if(partId&&partId.ambiguous){ setPickMsg({ok:false,text:`"${code}" matches ${partId.ambiguous.map(p=>p.id).join(" and ")}. Scan the full ID instead.`}); return; }
    if(!partId){ setPickMsg({ok:false,text:`Unknown barcode "${code}".`}); return; }
    if(!items.find(i=>i.partId===partId)){ setPickMsg({ok:false,text:`${partId} is not on this license plate. Nothing changed.`}); return; }
    try{
      const next=await actions.pickLpItem(lp.id,items,partId,qty,lineIdx);
      setItems(next);
      const it=next.find((x,k)=>(x.picked||0)!==(items[k]?.picked||0))||next.find(i=>i.partId===partId); const p=parts.find(x=>x.id===partId);
      setPickMsg({ok:true,text:`Picked ${p?.description||partId} — ${it.picked} of ${it.qty}`});
    }catch(e){ setPickMsg({ok:false,text:e.message}); }
  }
  async function unpick(partId, lineIdx=null){
    if(!(await flushItems())) return;
    try{
      const next=await actions.unpickLpItem(lp.id,items,partId,1,lineIdx);
      setItems(next);
      setPickMsg({ok:true,text:`Returned 1 × ${partId} to inventory.`});
    }catch(e){ setPickMsg({ok:false,text:e.message}); }
  }

  async function changeStatus(next){
    // Shipping alert: an outbound LP can ship short, but never silently.
    let meta={};
    const leavingTGO=lpIsPrep(status)&&(next==="Sent to Fabricator"||next==="Shipped");
    if(leavingTGO&&type==="Outbound"&&shortLines.length>0){
      const lines=shortLines.map(it=>`• ${it.partId}: picked ${pickedOf(it)} of ${it.qty} (${it.qty-pickedOf(it)} short)`).join("\n");
      if(!window.confirm(`⚠ This license plate is SHORT.\n\n${lines}\n\nShip anyway?`)) return;
      meta={shipped_short:shortLines.map(it=>({partId:it.partId,ordered:it.qty,picked:pickedOf(it),short:it.qty-pickedOf(it)}))};
    }
    if(next==="Shipped"&&directOpen.length>0&&!lpAtFabricator(status)){
      const lines=directOpen.map(it=>`• ${it.partId} x${it.qty}${it.supplier?` (${it.supplier})`:""}`).join("\n");
      if(!window.confirm(`⚠ These direct-ship items are not checked off as received/packed:\n\n${lines}\n\nShip anyway?`)) return;
      meta={...meta,shipped_with_direct_open:directOpen.map(it=>it.partId)};
    }
    if(next==="Cancelled"){
      const hasPicks=items.some(it=>pickedOf(it)>0&&!it.no_stock&&!isDirect(it));
      if(!window.confirm(hasPicks?"Cancel this license plate? Everything picked into it will be returned to inventory.":"Cancel this license plate?")) return;
    }
    if(next==="Open"&&status==="Cancelled"&&!window.confirm("Reopen this license plate? Its parts went back to stock and will need to be picked again.")) return;
    if(next==="Sent to Fabricator"&&lpIsPrep(status)&&!fabricatorId&&!lp.fabricator_id&&!window.confirm("No fabricator is assigned, so no fabricator will see this license plate. Send anyway?")) return;
    if((next==="Open"&&!lpIsPrep(status)&&status!=="Cancelled")||(next==="Sent to Fabricator"&&status==="Shipped")||(next==="Shipped"&&status==="Delivered"))
      if(!window.confirm(`Move this license plate back to ${next}? Only do this if the last step was a mistake.`)) return;
    if(next==="Shipped"&&lpAtFabricator(status)&&status!=="Received"&&!window.confirm(status==="Received with issues"?"The fabricator reported a problem that is still open. Mark Shipped to the customer anyway?":"The fabricator hasn't checked off every item. Mark Shipped to the customer anyway?")) return;
    setBusy(true);
    if(!(await flushItems())){ setBusy(false); return; }
    setSaveState({s:"saving",err:""});
    try{ await actions.updateLPStatus(lp.id,next,meta); setStatus(next); setSaveState({s:"saved",err:""}); }
    catch(e){ setSaveState({s:"error",err:e.message||String(e)}); }
    setBusy(false);
  }
  async function addCustomType(){if(!newTypeInput.trim())return;const n=newTypeInput.trim();await actions.addPackingSlipType(n);setPackingSlipType(n);setNewTypeInput("");setAddingType(false);saveFields({packing_slip_type:n});}

  function addItem(){
    const cur=itemsRef.current;
    if(!addPartId||cur.find(i=>i.partId===addPartId))return;
    queueItemsSave([...cur,{partId:addPartId,qty:+addQty||1}]);
    setAddPartId(""); setAddQty(1);
  }
  function removeItem(idx){
    const it=itemsRef.current[idx];
    if(!it) return;
    if(pickedOf(it)>0){ setPickMsg({ok:false,text:`Undo the picks on ${it.partId} before removing the line.`}); return; }   // picked lines: undo first
    queueItemsSave(itemsRef.current.filter((_,i)=>i!==idx));
  }
  function updateQty(idx,qty){ queueItemsSave(itemsRef.current.map((it,i)=>i===idx?{...it,qty:Math.max(pickedOf(it),1,+qty||1)}:it)); }

  const availParts=parts.filter(p=>!items.find(i=>i.partId===p.id));

  const saveNote={idle:null,pending:["Saving…",C.textLight],saving:["Saving…",C.textLight],saved:["✓ All changes saved",C.greenText],error:[`⚠ Not saved: ${saveState.err}`,C.red]}[saveState.s];
  const wide={flex:"1 1 150px",justifyContent:"center",minHeight:44};
  return <Modal title={lp.id} onClose={close}>
    <div style={{display:"grid",gap:18}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",background:C.offWhite,borderRadius:6,gap:8}}>
        <BarcodeDisplay code={lp.id} size="lg"/>
        <div style={{display:"flex",gap:8}}>
          <Badge color={type==="Outbound"?"red":"navy"}>{type}</Badge>
          <Badge color={lpStatusColor(status)}>{status}</Badge>
          {isPending&&<Badge color="green">✏️ Editable</Badge>}
        </div>
        {lp.order_id&&onOpenOrder&&<button onClick={async()=>{ if(!(await flushItems())) return; onClose(); onOpenOrder(lp.order_id); }}
          style={{border:"1px solid #9DC3E6",background:"#EBF2FA",color:C.navy,borderRadius:6,padding:"6px 12px",fontSize:12,fontWeight:700,cursor:"pointer"}}>📑 Order {lp.order_id} ›</button>}
        <Btn variant="outline" style={{padding:"6px 14px",fontSize:12}} onClick={()=>printLicensePlate({lp:{...lp,type,status,destination,quote_number:quoteNumber,po_number:poNumber,packing_slip_type:packingSlipType},items,parts,customer,packingSlipTypes,fabricator:(fabricators||[]).find(f=>f.id===(fabricatorId||lp.fabricator_id))})}>🖨️ Print License Plate</Btn>
      </div>

      {/* Status actions */}
      <div style={{display:"grid",gap:6}}>
        <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
          {lpIsPrep(status)&&<>
            <Btn variant={fabricatorId?"navy":"outline"} disabled={busy} onClick={()=>changeStatus("Sent to Fabricator")} style={{...wide,flex:"2 1 180px"}}>🏭 Send to Fabricator</Btn>
            <Btn variant={fabricatorId?"outline":"navy"} disabled={busy} onClick={()=>changeStatus("Shipped")} style={wide}>🚚 Ship to Customer</Btn>
            <Btn variant="danger" disabled={busy} onClick={()=>changeStatus("Cancelled")} style={wide}>Cancel LP</Btn>
          </>}
          {lpAtFabricator(status)&&<>
            <Btn variant="navy" disabled={busy} onClick={()=>changeStatus("Shipped")} style={{...wide,flex:"2 1 180px"}}>🚚 Mark Shipped to Customer</Btn>
            <Btn variant="outline" disabled={busy} onClick={()=>changeStatus("Open")} style={wide}>Back to Open</Btn>
          </>}
          {status==="Shipped"&&<>
            <Btn variant="navy" disabled={busy} onClick={()=>changeStatus("Delivered")} style={{...wide,flex:"2 1 180px"}}>✓ Mark Delivered</Btn>
            <Btn variant="outline" disabled={busy} onClick={()=>changeStatus(lp.fabricator_id||fabricatorId?"Sent to Fabricator":"Open")} style={wide}>Undo Shipped</Btn>
          </>}
          {status==="Delivered"&&<Btn variant="outline" disabled={busy} onClick={()=>changeStatus("Shipped")} style={wide}>Undo Delivered</Btn>}
          {status==="Cancelled"&&<Btn variant="outline" disabled={busy} onClick={()=>changeStatus("Open")} style={wide}>Reopen as Open</Btn>}
        </div>
        {lpAtFabricator(status)&&<div style={{fontSize:12,color:C.textMid}}>Received updates on its own as the fabricator checks items off. The fabricator can also mark Shipped from their screen.</div>}
        {isPending&&type==="Outbound"&&shortLines.length>0&&<div style={{fontSize:12,color:C.warnText}}>{shortLines.length} line{shortLines.length>1?"s":""} not fully picked. You will be asked to confirm before shipping short.</div>}
        {saveNote&&<div style={{fontSize:12,fontWeight:600,color:saveNote[1]}}>{saveNote[0]}</div>}
      </div>

      {/* Editable fields — only when Pending (each saves on its own) */}
      {isPending
        ? <div style={{display:"grid",gap:12}}>
            <Sel label="Type" value={type} onChange={e=>{setType(e.target.value);saveFields({type:e.target.value});}}>
              <option>Outbound</option><option>Inbound</option><option>Transfer</option>
            </Sel>
            <Field label="Customer">
              <select value={customerId} onChange={e=>{
                const c=customers?.find(x=>x.id===e.target.value);
                setCustomerId(e.target.value);
                if(c) setDestination(c.name);
                saveFields(c?{customer_id:c.id,destination:c.name}:{customer_id:null});
              }} style={{...inputStyle,width:"100%"}}>
                <option value="">Select customer…</option>
                {(customers||[]).map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
            <Field label="Destination">
              <input value={destination} onChange={e=>setDestination(e.target.value)}
                onBlur={()=>{ if(destination!==(lp.destination||"")) saveFields({destination}); }}
                placeholder="Customer or location name" style={{...inputStyle,width:"100%"}}/>
            </Field>
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
              <Field label="Quote Number">
                <input value={quoteNumber} onChange={e=>setQuoteNumber(e.target.value)}
                  onBlur={()=>{ if(quoteNumber!==(lp.quote_number||"")) saveFields({quote_number:quoteNumber||null}); }}
                  placeholder="e.g. 4113" style={inputStyle}/>
              </Field>
              <Field label="P.O. Number">
                <input value={poNumber} onChange={e=>setPoNumber(e.target.value)}
                  onBlur={()=>{ if(poNumber!==(lp.po_number||"")) saveFields({po_number:poNumber||null}); }}
                  placeholder="e.g. 26-200-02" style={inputStyle}/>
              </Field>
            </div>
            <div>
              <Field label="Packing Slip Type">
                <div style={{display:"flex",gap:8}}>
                  <select value={packingSlipType} onChange={e=>{setPackingSlipType(e.target.value);saveFields({packing_slip_type:e.target.value||null});}} style={{...inputStyle,flex:1}}>
                    <option value="">Select type…</option>
                    {(packingSlipTypes||[]).map(t=><option key={t.id} value={t.name}>{t.name}</option>)}
                  </select>
                  <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={()=>setAddingType(v=>!v)}>+ New</Btn>
                </div>
              </Field>
              {addingType&&<div style={{display:"flex",gap:8,marginTop:8}}>
                <input value={newTypeInput} onChange={e=>setNewTypeInput(e.target.value)} onKeyDown={e=>e.key==="Enter"&&addCustomType()}
                  placeholder="e.g. Bulk Parts" style={{...inputStyle,flex:1}}/>
                <Btn onClick={addCustomType} disabled={!newTypeInput.trim()}>Add</Btn>
              </div>}
            </div>
          </div>
        : <div style={{display:"grid",gap:12}}>
            <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
              {[["Destination",destination],["Created",lp.createdAt||lp.created_at],["Line Items",items.length],["Total Qty",items.reduce((a,b)=>a+b.qty,0)]].map(([l,v])=>(
                <div key={l}><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>{l}</div>
                  <div style={{fontFamily:["Line Items","Total Qty"].includes(l)?"monospace":"sans-serif",fontSize:["Line Items","Total Qty"].includes(l)?22:14,fontWeight:700,color:C.navy}}>{v}</div></div>
              ))}
            </div>
            {customer&&<div style={{background:C.offWhite,borderRadius:6,padding:"10px 14px"}}>
              <div style={{fontSize:10,fontWeight:700,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>Customer</div>
              <div style={{fontWeight:700,fontSize:14,color:C.navy}}>{customer.name}</div>
              {(customer.address_line1||customer.city)&&<div style={{fontSize:12,color:C.textMid,marginTop:2}}>{[customer.address_line1,customer.city,customer.state,customer.zip].filter(Boolean).join(", ")}</div>}
              {customer.phone&&<div style={{fontSize:12,color:C.textMid}}>📞 {customer.phone}</div>}
            </div>}
            {lp.packing_slip_type&&<div><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>Packing Slip Type</div><Badge color="gray">📋 {lp.packing_slip_type}</Badge></div>}
            {(lp.quote_number||lp.po_number)&&<div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
              {lp.quote_number&&<div><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>Quote Number</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.navy}}>{lp.quote_number}</div></div>}
              {lp.po_number&&<div><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>P.O. Number</div><div style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.navy}}>{lp.po_number}</div></div>}
            </div>}
          </div>
      }

      {/* Picking happens on its own full-screen view */}
      {canPick&&(()=>{ const pr=lpPickProgress(items); return (
        <div style={{background:"#FFF8E8",border:`1.5px solid ${C.amber}`,borderRadius:7,padding:12,display:"grid",gap:8}}>
          <div style={{fontWeight:800,fontSize:12,color:C.navy,letterSpacing:1,textTransform:"uppercase"}}>Picking · {pr.picked} of {pr.qty} picked</div>
          <Btn variant="navy" style={{justifyContent:"center",minHeight:48,fontSize:15}} onClick={async()=>{
            if(!(await flushItems())) return;
            onStartPick?.(lp.id);
          }}>▶ Open picking screen</Btn>
        </div>);})()}
      {pickMsg&&<div style={{fontSize:12,fontWeight:600,color:pickMsg.ok?"#1A6B42":C.red}}>{pickMsg.ok?"✓ ":"⚠ "}{pickMsg.text}</div>}

      {/* Line items — editable when Pending */}
      <div>
        <SectionTitle>Shipment Contents ({items.length} items · {items.reduce((a,b)=>a+b.qty,0)} total qty)</SectionTitle>
        {hasChecklist&&<div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:7,padding:"8px 12px",marginBottom:8,fontSize:12}}>
          <div style={{fontWeight:700,color:C.navy}}>Checklist · {checkedCount} of {items.length} checked{directOpen.length>0?` · ${directOpen.length} direct-ship item${directOpen.length>1?"s":""} outstanding`:""}</div>
          <div style={{marginTop:6,display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
            <span style={{color:C.textMid}}>Fabricator who sees this LP:</span>
            <select value={fabricatorId} disabled={lp.status==="Cancelled"} onChange={async e=>{
                const v=e.target.value; setFabricatorId(v);
                try{ await actions.updateLP(lp.id,{fabricator_id:v||null},{fabricator:v||null}); }catch(x){ setFabricatorId(fabricatorId); setPickMsg({ok:false,text:"Could not assign: "+(x.message||x)}); }
              }} style={{...inputStyle,padding:"3px 8px",fontSize:12}}>
              <option value="">— not assigned (staff only) —</option>
              {(fabricators||[]).filter(f=>f.active||f.id===fabricatorId).map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </div>
        </div>}
        {!lpIsPrep(lp.status)&&lp.status!=="Cancelled"&&shortLines.length>0&&type==="Outbound"&&(
          <div style={{background:"#FFF0F2",border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"8px 12px",marginBottom:8,fontSize:12,color:C.red,fontWeight:700}}>
            ⚠ Shipped short — {shortLines.map(it=>`${it.partId} (${it.qty-pickedOf(it)} short)`).join(", ")}
          </div>
        )}
        {items.map((it,i)=>{
          const p=parts.find(x=>x.id===it.partId);
          return (
            <div key={i} style={{border:`1.5px solid ${pickedOf(it)>=it.qty&&canPick?"#6FBF8E":C.border}`,background:pickedOf(it)>=it.qty&&canPick?"#F1FAF4":C.white,borderRadius:7,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
              <div style={{flex:1}}>
                {p?.image_url&&<img src={p.image_url} alt={it.partId} style={{width:40,height:40,objectFit:"cover",borderRadius:4,float:"right",marginLeft:8}}/>}
                <BarcodeDisplay code={it.partId}/>
                <div style={{fontWeight:700,fontSize:13,color:C.navy,marginTop:4}}>{p?.description||"—"}</div>
                <div style={{fontSize:11,color:C.textLight,marginTop:2}}>{p?.category} · {p?.uom}{p?.location&&!isDirect(it)?` · 📍 ${p.location}`:""}</div>
                {(it.list||it.box)&&<div style={{fontSize:11,color:C.textMid,marginTop:2}}>📋 {it.list}{it.box&&it.box!==it.list?` · ${it.box}`:""}</div>}
                {isDirect(it)&&<div style={{marginTop:4,fontSize:12,color:C.amber,fontWeight:700}}>🚚 Ships direct from {it.supplier||"supplier"}{it.supplier_po?` · PO ${it.supplier_po}`:""}{it.direct_status?` · ${it.direct_status}`:""} <span style={{fontWeight:400,color:C.textLight}}>(not from TGO stock)</span></div>}
                {hasChecklist&&<div style={{marginTop:6}}><button onClick={()=>toggleCheck(i)} style={{border:`1.5px solid ${it.checked?"#6FBF8E":C.border}`,background:it.checked?"#F1FAF4":C.white,color:it.checked?C.greenText:C.textMid,borderRadius:5,padding:"3px 10px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{it.checked?"✓ Checked":"☐ Check off"}</button>{it.checked&&it.checked_by&&<span style={{fontSize:11,color:C.textLight,marginLeft:8}}>{it.checked_by}{it.checked_at?` · ${new Date(it.checked_at).toLocaleDateString()}`:""}</span>}</div>}
                {it.issue&&<div style={{marginTop:6,border:`1px solid ${it.issue.resolved_at?"#6FBF8E":C.redBorder}`,background:it.issue.resolved_at?"#F1FAF4":C.redLight,borderRadius:5,padding:"6px 10px",fontSize:12,color:it.issue.resolved_at?C.greenText:C.red}}>
                  <b>⚠ {issueLabel(it.issue.type)}</b>{it.issue.note?` — ${it.issue.note}`:""} <span style={{color:C.textLight}}>({it.issue.by}{it.issue.at?`, ${new Date(it.issue.at).toLocaleString()}`:""})</span>
                  <PhotoThumbs paths={it.issue.photos}/>
                  <button onClick={()=>toggleResolved(i)} style={{marginTop:6,border:`1px solid ${C.border}`,background:C.white,borderRadius:4,padding:"2px 10px",fontSize:12,cursor:"pointer",color:C.textMid}}>{it.issue.resolved_at?"Reopen":"Mark resolved"}</button>
                </div>}
                {!isDirect(it)&&(canPick||pickedOf(it)>0)&&!it.no_stock&&<div style={{display:"flex",alignItems:"center",gap:8,marginTop:6}}>
                  <Badge color={pickedOf(it)>=it.qty?"green":pickedOf(it)>0?"amber":"gray"}>Picked {pickedOf(it)} / {it.qty}</Badge>
                  {canPick&&<>
                    <button onClick={()=>pick(it.partId,1,i)} disabled={pickedOf(it)>=it.qty} style={{border:`1px solid ${C.border}`,background:C.white,borderRadius:4,padding:"2px 8px",fontSize:12,cursor:"pointer"}}>+1</button>
                    <button onClick={()=>unpick(it.partId,i)} disabled={pickedOf(it)<=0} style={{border:`1px solid ${C.border}`,background:C.white,borderRadius:4,padding:"2px 8px",fontSize:12,cursor:"pointer"}}>↩ Undo</button>
                  </>}
                </div>}
              </div>
              <div style={{display:"flex",alignItems:"center",gap:6,flexShrink:0,marginLeft:10}}>
                {isPending&&<>
                  <button onClick={()=>updateQty(i,it.qty-1)} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer"}}>−</button>
                </>}
                <div style={{textAlign:"center"}}>
                  {isPending
                    ? <input type="number" min="1" value={it.qty} onChange={e=>updateQty(i,e.target.value)}
                        style={{...inputStyle,width:56,textAlign:"center",fontFamily:"monospace",fontWeight:700,fontSize:16,padding:"4px"}}/>
                    : <div style={{fontFamily:"monospace",fontSize:24,fontWeight:700,color:C.amber}}>{it.qty}</div>
                  }
                  <div style={{fontSize:11,color:C.textLight}}>{p?.uom}</div>
                </div>
                {isPending&&<>
                  <button onClick={()=>updateQty(i,it.qty+1)} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer"}}>+</button>
                  <button onClick={()=>removeItem(i)} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.redBorder}`,background:C.white,cursor:"pointer",color:C.red,fontSize:13}}>✕</button>
                </>}
              </div>
            </div>
          );
        })}

        {/* Add item — only when Pending */}
        {isPending&&availParts.length>0&&(
          <div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:7,padding:12,marginTop:8,display:"flex",flexWrap:"wrap",gap:8,alignItems:"flex-end"}}>
            <div style={{flex:"1 1 100%",minWidth:0}}>
              <PartPicker parts={availParts} value={addPartId} onChange={setAddPartId} placeholder="Add a part: search no. or description…"/>
            </div>
            <input type="number" min="1" value={addQty} onChange={e=>setAddQty(e.target.value)}
              style={{...inputStyle,width:64,fontFamily:"monospace"}} placeholder="Qty"/>
            <Btn variant="outline" onClick={addItem} disabled={!addPartId}>Add</Btn>
          </div>
        )}
      </div>
    </div>
  </Modal>;
}

// ═══ REPLENISHMENT UI START ═══════════════════════════════════════════════════
// ─── Shared helpers for the replenishment tabs ───────────────────────────────
const localToday = () => { const d=new Date(); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,"0")}-${String(d.getDate()).padStart(2,"0")}`; };
const fmtDate = (s) => s ? new Date(s+"T00:00:00").toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}) : "—";
const money = (n) => n==null ? "—" : `$${(+n).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})}`;
const esc = (s) => String(s ?? "").replace(/[&<>"]/g,(c)=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const LINE_STATUSES = ["PO Signed","Lists Draft","Lists Final","Released","Staged","Shipped","Cancelled"];
const lineStatusColor = (s) => ({"PO Signed":"gray","Lists Draft":"amber","Lists Final":"blue","Released":"navy","Staged":"navy","Shipped":"green","Cancelled":"red"}[s]||"gray");
const PO_STATUSES = ["Draft","Sent","Partially Received","Received","Cancelled"];
const poStatusColor = (s) => ({"Draft":"gray","Sent":"blue","Partially Received":"amber","Received":"green","Cancelled":"red"}[s]||"gray");
const FLAG_LABELS = {
  expedite:"Expedite", expedite_open_po:"Chase open PO", po_arrives_late:"PO arrives late", no_supplier:"No supplier",
  lead_time_unknown:"Lead time unknown", shortage_but_do_not_reorder:"Short · no-reorder item",
  undated_demand:"Undated demand", paint_start_missing:"Paint date missing",
};
const flagColor = (f) => (["expedite","expedite_open_po","po_arrives_late","no_supplier","shortage_but_do_not_reorder"].includes(f) ? "red" : "amber");

function useRun(){
  const [busy,setBusy]=useState(false);
  const run=async(fn)=>{ setBusy(true); try{ await fn(); return true; }catch(e){ alert(e.message||String(e)); return false; }finally{ setBusy(false); } };
  return [busy,run];
}

function SubTabs({ value, onChange, items }) {
  return <div style={{display:"flex",gap:8,marginBottom:18,flexWrap:"wrap"}}>
    {items.map(([id,label])=><button key={id} onClick={()=>onChange(id)} style={{background:value===id?C.navy:C.white,color:value===id?C.amber:C.navy,border:`1.5px solid ${value===id?C.navy:C.border}`,borderRadius:6,padding:"8px 16px",fontSize:13,fontWeight:700,cursor:"pointer"}}>{label}</button>)}
  </div>;
}

// Type or pick a SKU from the catalog (works with 100+ parts).
// Type-ahead part search: matches new #, old #, CT- id or description. value = selected part id.
function PartPicker({ parts, value, onChange, placeholder="Search part no. or description…" }) {
  const match=parts.find(p=>p.id===value);
  const [q,setQ]=useState(value||"");
  const [open,setOpen]=useState(false);
  const [hi,setHi]=useState(0);
  const selfChange=useRef(false);
  useEffect(()=>{ if(selfChange.current){ selfChange.current=false; return; } setQ(value||""); },[value]);   // parent reset/set
  const results=useMemo(()=>{
    const s=q.trim().toLowerCase();
    const list=s?parts.filter(p=>partMatchesSearch(p,s)):parts;
    const score=p=>{ const id=p.id.toLowerCase();
      if(id===s||String(p.new_part_no??"").toLowerCase()===s||String(p.legacy_part_no??"").toLowerCase()===s) return 0;
      if(id.startsWith(s)||id.replace(/^ct-/,"").startsWith(s)) return 1;
      if((p.description||"").toLowerCase().startsWith(s)) return 2; return 3; };
    return [...list].sort((a,b)=>score(a)-score(b)||a.id.localeCompare(b.id)).slice(0,8);
  },[q,parts]);
  function choose(p){ selfChange.current=true; setQ(p.id); setOpen(false); onChange(p.id); }
  function onKey(e){
    if(e.key==="ArrowDown"){ e.preventDefault(); setOpen(true); setHi(h=>Math.min(h+1,results.length-1)); }
    else if(e.key==="ArrowUp"){ e.preventDefault(); setHi(h=>Math.max(h-1,0)); }
    else if(e.key==="Enter"&&open&&results[hi]){ e.preventDefault(); choose(results[hi]); }
    else if(e.key==="Escape"&&open){ e.preventDefault(); setOpen(false); }   // close the list, not the popup
  }
  return <div style={{position:"relative"}}>
    <input value={q} onChange={e=>{ setQ(e.target.value); setOpen(true); setHi(0); if(value){ selfChange.current=true; onChange(""); } }}
      onFocus={()=>setOpen(true)} onBlur={()=>setTimeout(()=>setOpen(false),120)} onKeyDown={onKey}
      placeholder={placeholder} autoCapitalize="off" autoCorrect="off" spellCheck={false} role="combobox" aria-expanded={open} aria-autocomplete="list"
      style={{...inputStyle,width:"100%",fontSize:15,minHeight:44}}/>
    {open&&<div role="listbox" style={{position:"absolute",left:0,right:0,top:"calc(100% + 4px)",zIndex:20,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,boxShadow:"0 10px 28px rgba(28,43,58,.18)",maxHeight:300,overflowY:"auto"}}>
      {results.length===0&&<div style={{padding:"12px 14px",fontSize:13,color:C.textLight}}>No matching parts.</div>}
      {results.map((p,i)=><div key={p.id} role="option" aria-selected={i===hi} onMouseDown={e=>{e.preventDefault();choose(p);}} onMouseEnter={()=>setHi(i)}
        style={{padding:"8px 12px",minHeight:44,boxSizing:"border-box",cursor:"pointer",background:i===hi?"#EEF3F8":C.white,borderBottom:`1px solid ${C.border}`,display:"flex",gap:10,alignItems:"center"}}>
        <div style={{flex:1,minWidth:0}}>
          <div style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.amber}}>{p.id} <LegacyNote p={p}/></div>
          <div style={{fontSize:13,color:C.navy,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.description}</div>
        </div>
        <div style={{textAlign:"right",fontSize:11,color:C.textLight,flexShrink:0}}>{p.location?`📍 ${p.location}`:""}<div>{p.stock??0} {p.uom||"EA"}</div></div>
      </div>)}
    </div>}
    {value&&match&&!open&&<div style={{fontSize:11,marginTop:3,color:C.textMid}}>{match.description}</div>}
    {!value&&q.trim()&&!open&&<div style={{fontSize:11,marginTop:3,color:C.red}}>Pick a part from the list</div>}
  </div>;
}

function downloadCsv(filename, rows){
  const cell=(v)=>{ const t=String(v ?? ""); return /[",\n]/.test(t) ? `"${t.replace(/"/g,'""')}"` : t; };
  const blob=new Blob([rows.map(r=>r.map(cell).join(",")).join("\n")],{type:"text/csv"});
  const url=URL.createObjectURL(blob); const a=document.createElement("a");
  a.href=url; a.download=filename; a.click(); URL.revokeObjectURL(url);
}

function printPurchaseOrder({ po, supplier, lines, parts }) {
  const rows=lines.map(l=>{
    const p=parts.find(x=>x.id===l.part_id);
    const ext=l.unit_cost!=null?l.qty*l.unit_cost:null;
    return `<tr><td class="m">${esc(l.part_id)}</td><td class="m">${esc(l.mfg_part_no||"—")}</td><td>${esc(p?.description||"")}</td><td class="r">${esc(l.qty)}</td><td class="r">${l.unit_cost!=null?esc(money(l.unit_cost)):"—"}</td><td class="r">${ext!=null?esc(money(ext)):"—"}</td><td>${esc(fmtDate(l.needed_by))}</td></tr>`;
  }).join("");
  const total=lines.reduce((s,l)=>s+(l.unit_cost!=null?l.qty*l.unit_cost:0),0);
  const w=window.open("","_blank");
  if(!w){ alert("Allow pop-ups to print."); return; }
  w.document.write(`<!DOCTYPE html><html><head><title>${esc(po.id||"Draft PO")}</title><style>
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;padding:28px;color:#1C2B3A;max-width:820px;margin:0 auto}
    .top{display:flex;justify-content:space-between;border-bottom:4px solid #F5A623;padding-bottom:10px;margin-bottom:16px}
    h1{margin:0;font-size:22px}.sub{font-size:11px;color:#8A9BB0;letter-spacing:2px;text-transform:uppercase}
    .po{text-align:right}.po b{font-size:18px;font-family:monospace}
    .meta{display:flex;gap:40px;margin-bottom:16px;font-size:12px}.meta div b{display:block;font-size:10px;color:#8A9BB0;text-transform:uppercase;letter-spacing:.6px;margin-bottom:2px}
    table{width:100%;border-collapse:collapse;font-size:12px}th{background:#1C2B3A;color:#fff;text-align:left;padding:7px 8px;font-size:10px;text-transform:uppercase;letter-spacing:.5px}
    td{padding:7px 8px;border-bottom:1px solid #E0E3E7}.m{font-family:monospace}.r{text-align:right}
    .total{text-align:right;margin-top:12px;font-size:15px;font-weight:700}.notes{margin-top:18px;font-size:12px;color:#4A5568}
    @media print{body{padding:8px}}</style></head><body onload="window.print()">
    <div class="top"><div><h1>ChlorTainer</h1><div class="sub">TGO Technologies, Inc. · Purchase Order</div></div>
    <div class="po"><b>${esc(po.id||"DRAFT")}</b><div>${esc(po.status||"Draft")}</div></div></div>
    <div class="meta">
      <div><b>Supplier</b>${esc(supplier?.name||"—")}<br>${esc(supplier?.contact||"")}<br>${esc(supplier?.phone||"")}</div>
      <div><b>Order date</b>${esc(fmtDate(po.order_date))}</div>
      <div><b>Expected</b>${esc(fmtDate(po.expected_date))}</div>
    </div>
    <table><thead><tr><th>SKU</th><th>Supplier Part No.</th><th>Description</th><th class="r">Qty</th><th class="r">Unit</th><th class="r">Extended</th><th>Needed by</th></tr></thead><tbody>${rows}</tbody></table>
    <div class="total">Total: ${esc(money(total))}</div>
    ${po.notes?`<div class="notes"><b>Notes:</b> ${esc(po.notes)}</div>`:""}
  </body></html>`);
  w.document.close();
}

// ─── Control Lists Tab ───────────────────────────────────────────────────────
function NewNameForm({ label, onCreate, onCancel }) {
  const [name,setName]=useState(""); const [desc,setDesc]=useState(""); const [busy,run]=useRun();
  return <div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:8,padding:12,display:"grid",gap:8,marginBottom:12}}>
    <Input label={label} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Dual 150"/>
    <Input label="Description (optional)" value={desc} onChange={e=>setDesc(e.target.value)}/>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
      <Btn variant="outline" onClick={onCancel}>Cancel</Btn>
      <Btn disabled={!name.trim()||busy} onClick={()=>run(async()=>{await onCreate({name,description:desc});})}>{busy?"Saving…":"Create"}</Btn>
    </div>
  </div>;
}

function NameHeader({ record, onSave, onDelete, deleteLabel }) {
  const [name,setName]=useState(record.name); const [desc,setDesc]=useState(record.description||""); const [busy,run]=useRun();
  const dirty = name!==record.name || desc!==(record.description||"");
  return <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:12,display:"grid",gap:10}}>
    <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10}}>
      <Input label="Name" value={name} onChange={e=>setName(e.target.value)}/>
      <Input label="Description" value={desc} onChange={e=>setDesc(e.target.value)}/>
    </div>
    <div style={{display:"flex",gap:8,justifyContent:"space-between",alignItems:"center"}}>
      <span style={{fontFamily:"monospace",fontSize:11,color:C.textLight}}>{record.id}</span>
      <div style={{display:"flex",gap:8}}>
        <Btn variant="danger" disabled={busy} onClick={()=>{ if(window.confirm(`${deleteLabel} "${record.name}"? This cannot be undone.`)) run(()=>onDelete(record.id)); }}>Delete</Btn>
        <Btn disabled={!dirty||!name.trim()||busy} onClick={()=>run(()=>onSave({id:record.id,name,description:desc}))}>{busy?"Saving…":"Save"}</Btn>
      </div>
    </div>
  </div>;
}

function LineEditor({ title, subtitle, lines, parts, qtyLabel, onAdd, onQty, onRemove }) {
  const [partId,setPartId]=useState(""); const [qty,setQty]=useState(1); const [busy,run]=useRun();
  const valid = parts.some(p=>p.id===partId) && +qty>0;
  const q = (l) => l.qty_per_unit ?? l.qty;
  return <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:14,marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"baseline",marginBottom:8,gap:8,flexWrap:"wrap"}}>
      <span style={{fontWeight:800,fontSize:14,color:C.navy}}>{title} <span style={{fontWeight:600,color:C.textLight,fontSize:12}}>({lines.length})</span></span>
      <span style={{fontSize:11,color:C.textLight}}>{subtitle}</span>
    </div>
    {lines.length===0&&<div style={{fontSize:12,color:C.textLight,padding:"6px 0"}}>No parts yet.</div>}
    {lines.map(l=>{
      const p=parts.find(x=>x.id===l.part_id);
      return <div key={l.id} style={{display:"flex",alignItems:"center",gap:10,padding:"6px 0",borderBottom:`1px solid ${C.border}`,flexWrap:"wrap"}}>
        <span style={{fontFamily:"monospace",fontSize:12,color:C.amber,fontWeight:700,minWidth:96}}>{l.part_id}</span>
        <span style={{flex:"1 1 160px",fontSize:12,color:C.textMid}}>{p?.description||"—"}</span>
        <input key={l.id+":"+q(l)} type="number" min="0.01" step="any" defaultValue={q(l)}
          onBlur={e=>{const v=+e.target.value; if(v>0&&v!==+q(l)) run(()=>onQty(l,v));}}
          style={{...inputStyle,width:70,padding:"4px 8px",textAlign:"center",fontFamily:"monospace",fontWeight:700}}/>
        <span style={{fontSize:11,color:C.textLight,minWidth:54}}>{qtyLabel}</span>
        <button disabled={busy} onClick={()=>{ if(window.confirm(`Remove ${l.part_id}?`)) run(()=>onRemove(l)); }}
          style={{width:26,height:26,borderRadius:4,border:`1px solid ${C.redBorder}`,background:C.white,cursor:"pointer",color:C.red,fontSize:12}}>✕</button>
      </div>;
    })}
    <div style={{display:"flex",gap:8,marginTop:10,alignItems:"flex-start",flexWrap:"wrap"}}>
      <div style={{flex:"2 1 200px"}}><PartPicker parts={parts} value={partId} onChange={setPartId}/></div>
      <input type="number" min="0.01" step="any" value={qty} onChange={e=>setQty(e.target.value)} style={{...inputStyle,width:70,textAlign:"center",fontFamily:"monospace"}}/>
      <Btn variant="outline" disabled={!valid||busy} onClick={()=>run(async()=>{await onAdd(partId,+qty);setPartId("");setQty(1);})}>+ Add</Btn>
    </div>
  </div>;
}

// ─── Control List import (CSV) ───────────────────────────────────────────────
// One row per part line: vessel_model, list_type, part, qty_per_unit, notes.
// Row order in the file = line order on the checklist. Each vessel model + list in the
// file is replaced as a whole (lines not in the file are removed), or merged if chosen.
function parseCsvText(text){
  const rows=[]; let row=[], cell="", q=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(q){ if(ch==='"'){ if(text[i+1]==='"'){cell+='"';i++;} else q=false; } else cell+=ch; }
    else if(ch==='"') q=true;
    else if(ch===","){ row.push(cell); cell=""; }
    else if(ch==="\n"||ch==="\r"){ if(ch==="\r"&&text[i+1]==="\n") i++; row.push(cell); rows.push(row); row=[]; cell=""; }
    else cell+=ch;
  }
  if(cell!==""||row.length){ row.push(cell); rows.push(row); }
  return rows.map(r=>r.map(c=>c.trim())).filter(r=>r.some(c=>c!==""));
}
const CL_COLUMNS=["vessel_model","list_type","part","qty_per_unit","notes"];
function ControlListImportModal({ vesselModels, controlLines, parts, packingSlipTypes, actions, onClose }){
  const [plan,setPlan]=useState(null);       // {rows:[...], groups:[...], newModels:[], newTypes:[]}
  const [mode,setMode]=useState("replace");
  const [busy,setBusy]=useState(false);
  const [done,setDone]=useState(null);
  const [err,setErr]=useState("");
  const fileRef=useRef(null);
  const norm=s=>String(s||"").trim().toLowerCase();

  function analyse(text){
    const all=parseCsvText(text);
    if(!all.length){ setErr("The file is empty."); return; }
    const head=all[0].map(norm);
    const hasHeader=head.includes("vessel_model")||head.includes("part");
    const idx=c=>{ if(!hasHeader) return CL_COLUMNS.indexOf(c); const alias={vessel_model:["vessel_model","vessel model","model"],list_type:["list_type","list type","list","packing list"],part:["part","part_id","part #","part no","sku"],qty_per_unit:["qty_per_unit","qty","quantity","qty per vessel"],notes:["notes","note"]}[c]; return head.findIndex(h=>alias.includes(h)); };
    const col=Object.fromEntries(CL_COLUMNS.map(c=>[c,idx(c)]));
    if(col.vessel_model<0||col.list_type<0||col.part<0||col.qty_per_unit<0){ setErr("The file needs columns vessel_model, list_type, part and qty_per_unit."); return; }
    const data=hasHeader?all.slice(1):all;
    const newModels=new Set(), newTypes=new Set();
    const rows=data.map((r,i)=>{
      const get=c=>col[c]>=0?(r[col[c]]||""):"";
      const mName=get("vessel_model"), lName=get("list_type"), pRaw=get("part"), qRaw=get("qty_per_unit");
      const model=vesselModels.find(m=>norm(m.name)===norm(mName)||norm(m.id)===norm(mName));
      const type=packingSlipTypes.find(t=>norm(t.name)===norm(lName));
      const cands=findPartsByCode(parts,pRaw);
      const out={n:i+(hasHeader?2:1),mName,lName:type?.name||lName,pRaw,qty:+qRaw,notes:get("notes"),modelId:model?.id||null,partId:cands.length===1?cands[0].id:null,problem:""};
      if(!mName) out.problem="No vessel model";
      else if(!lName) out.problem="No list type";
      else if(!pRaw) out.problem="No part";
      else if(cands.length>1) out.problem=`"${pRaw}" matches ${cands.map(c=>c.id).join(" and ")}`;
      else if(!cands.length) out.problem=`Part "${pRaw}" not found`;
      else if(!(out.qty>0)) out.problem=`Quantity "${qRaw}" is not above 0`;
      if(!out.problem){ if(!model) newModels.add(mName); if(!type) newTypes.add(lName); }
      return out;
    });
    const good=rows.filter(r=>!r.problem);
    const keyOf=r=>`${norm(r.mName)}|${norm(r.lName)}`;
    const seen=new Set(); const dupes=[];
    good.forEach(r=>{ const k=keyOf(r)+"|"+r.partId; if(seen.has(k)) dupes.push(r); else seen.add(k); });
    dupes.forEach(r=>{ r.problem=`${r.partId} is listed twice in ${r.mName} · ${r.lName}`; });
    const ok=rows.filter(r=>!r.problem);
    const groups=[...new Map(ok.map(r=>[keyOf(r),{mName:r.mName,lName:r.lName,modelId:r.modelId}])).values()].map(g=>{
      const lines=ok.filter(r=>keyOf(r)===`${norm(g.mName)}|${norm(g.lName)}`);
      const existing=g.modelId?controlLines.filter(c=>c.vessel_model_id===g.modelId&&c.list_type===g.lName):[];
      const removed=existing.filter(c=>!lines.some(l=>l.partId===c.part_id));
      return {...g,lines,existing:existing.length,removed};
    });
    setPlan({rows,groups,newModels:[...newModels],newTypes:[...newTypes]}); setErr("");
  }
  function onFile(e){ const f=e.target.files?.[0]; e.target.value=""; if(!f) return; const rd=new FileReader(); rd.onload=ev=>analyse(String(ev.target.result||"")); rd.readAsText(f); }
  async function run(){
    setBusy(true); setErr("");
    try{ const r=await actions.importControlLists(plan.groups,{mode,newTypes:plan.newTypes}); setDone(r); }
    catch(e){ setErr(e.message||String(e)); }
    setBusy(false);
  }
  function template(){
    const ex=[CL_COLUMNS.join(","),`Dual 150,Main Parts,CT-5109,1,`,`Dual 150,Main Parts,CT-6200,2,`,`Dual 150,Loose Parts,3017,4,old number works too`];
    const blob=new Blob([ex.join("\n")],{type:"text/csv"}); const u=URL.createObjectURL(blob); const a=document.createElement("a"); a.href=u; a.download="chlortainer-control-lists-template.csv"; a.click(); URL.revokeObjectURL(u);
  }
  const bad=plan?plan.rows.filter(r=>r.problem):[];
  const okCount=plan?plan.groups.reduce((s,g)=>s+g.lines.length,0):0;
  const removedCount=plan&&mode==="replace"?plan.groups.reduce((s,g)=>s+g.removed.length,0):0;
  return <Modal title="Import control lists from CSV" width={900} onClose={onClose} confirmClose={plan&&!done?"Discard this import? Nothing has been saved yet.":null}>
    <div style={{display:"grid",gap:14}}>
      {!plan&&!done&&<>
        <div style={{background:C.offWhite,borderRadius:8,padding:14,fontSize:13,color:C.textMid,display:"grid",gap:8}}>
          <div>One row per part line, in checklist order. Columns:</div>
          <div style={{display:"flex",gap:6,flexWrap:"wrap"}}>{CL_COLUMNS.map(c=><span key={c} style={{background:c==="notes"?"#E8EDF2":C.amber,color:C.navy,borderRadius:4,padding:"2px 8px",fontSize:11,fontFamily:"monospace",fontWeight:700}}>{c}</span>)}</div>
          <div style={{fontSize:12}}>Vessel models are matched by name, and new ones are created. Parts match on the CT- number, new number or old number. List types: {packingSlipTypes.map(t=>t.name).join(", ")}.</div>
          <div><Btn variant="outline" style={{fontSize:12,padding:"5px 12px"}} onClick={template}>⬇️ Download template</Btn></div>
        </div>
        <input ref={fileRef} type="file" accept=".csv,text/csv" style={{display:"none"}} onChange={onFile}/>
        <Btn style={{justifyContent:"center",minHeight:48}} onClick={()=>fileRef.current?.click()}>📂 Choose CSV file</Btn>
        {err&&<div style={{color:C.red,fontSize:13}}>⚠ {err}</div>}
      </>}
      {plan&&!done&&<>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",fontSize:13}}>
          <Badge color="green">{okCount} lines ready</Badge>
          {bad.length>0&&<Badge color="red">{bad.length} rows skipped</Badge>}
          {plan.newModels.length>0&&<Badge color="blue">New models: {plan.newModels.join(", ")}</Badge>}
          {plan.newTypes.length>0&&<Badge color="amber">New list types: {plan.newTypes.join(", ")}</Badge>}
        </div>
        <div style={{display:"flex",gap:16,flexWrap:"wrap",fontSize:13}}>
          <label style={{display:"flex",gap:6,alignItems:"center"}}><input type="radio" checked={mode==="replace"} onChange={()=>setMode("replace")}/> <b>Replace</b> each list in the file (lines not in the file are removed)</label>
          <label style={{display:"flex",gap:6,alignItems:"center"}}><input type="radio" checked={mode==="merge"} onChange={()=>setMode("merge")}/> <b>Merge</b> (add or update; keep other lines)</label>
        </div>
        <table style={{width:"100%",borderCollapse:"collapse",fontSize:12}}>
          <thead><tr style={{background:C.navy,color:"#fff",textAlign:"left"}}><th style={{padding:"6px 8px"}}>Vessel model</th><th style={{padding:"6px 8px"}}>List</th><th style={{padding:"6px 8px"}}>Lines in file</th><th style={{padding:"6px 8px"}}>Lines now</th><th style={{padding:"6px 8px"}}>Removed</th></tr></thead>
          <tbody>{plan.groups.map((g,i)=><tr key={i} style={{borderBottom:`1px solid ${C.border}`}}>
            <td style={{padding:"6px 8px",fontWeight:700}}>{g.mName}{!g.modelId&&<span style={{color:C.textLight,fontWeight:400}}> (new)</span>}</td>
            <td style={{padding:"6px 8px"}}>{g.lName}</td><td style={{padding:"6px 8px"}}>{g.lines.length}</td><td style={{padding:"6px 8px"}}>{g.existing}</td>
            <td style={{padding:"6px 8px",color:mode==="replace"&&g.removed.length?C.red:C.textLight}}>{mode==="replace"?(g.removed.length?g.removed.map(r=>r.part_id).join(", "):"—"):"kept"}</td></tr>)}</tbody>
        </table>
        {bad.length>0&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:10,fontSize:12,color:C.red,maxHeight:160,overflowY:"auto"}}>
          {bad.map(r=><div key={r.n}>Row {r.n}: {r.problem}</div>)}</div>}
        {err&&<div style={{color:C.red,fontSize:13}}>⚠ {err}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <Btn variant="outline" onClick={()=>setPlan(null)}>← Choose another file</Btn>
          <Btn disabled={busy||okCount===0} onClick={()=>{ if(removedCount&&!window.confirm(`Replace mode removes ${removedCount} line(s) that are not in the file. Continue?`)) return; run(); }}>{busy?"Importing…":`Import ${okCount} lines`}</Btn>
        </div>
      </>}
      {done&&<div style={{textAlign:"center",padding:16,display:"grid",gap:10}}>
        <div style={{fontSize:40}}>✅</div>
        <div style={{fontWeight:800,color:C.navy}}>Control lists imported</div>
        <div style={{fontSize:13,color:C.textMid}}>{done.lines} lines saved in {done.groups} list(s){done.models?` · ${done.models} new vessel model(s)`:""}{done.removed?` · ${done.removed} line(s) removed`:""}</div>
        <Btn style={{justifyContent:"center"}} onClick={onClose}>Done</Btn>
      </div>}
    </div>
  </Modal>;
}

function ControlListsTab({ vesselModels, controlLines, maintKits, kitLines, parts, packingSlipTypes, actions }) {
  const [view,setView]=useState("models");
  const [modelId,setModelId]=useState(null);
  const [kitId,setKitId]=useState(null);
  const [showNew,setShowNew]=useState(false);
  const [showImport,setShowImport]=useState(false);
  const model = vesselModels.find(m=>m.id===modelId) || null;
  const kit = maintKits.find(k=>k.id===kitId) || null;

  const pickList = (items, countOf, selectedId, onSelect, newLabel) => (
    <div style={{flex:"1 1 220px",maxWidth:300}}>
      <Btn style={{width:"100%",justifyContent:"center",marginBottom:10}} onClick={()=>setShowNew(true)}>+ {newLabel}</Btn>
      {items.map(it=><button key={it.id} onClick={()=>onSelect(it.id)} style={{display:"block",width:"100%",textAlign:"left",background:selectedId===it.id?C.navy:C.white,color:selectedId===it.id?C.white:C.navy,border:`1.5px solid ${selectedId===it.id?C.navy:C.border}`,borderRadius:7,padding:"10px 12px",marginBottom:8,cursor:"pointer"}}>
        <div style={{fontWeight:800,fontSize:13}}>{it.name}</div>
        <div style={{fontSize:11,opacity:.75,marginTop:2}}>{countOf(it)} part line(s)</div>
      </button>)}
      {items.length===0&&<div style={{fontSize:12,color:C.textLight,textAlign:"center",padding:20}}>None yet.</div>}
    </div>
  );

  return <div>
    <div style={{display:"flex",gap:10,alignItems:"flex-start",flexWrap:"wrap",justifyContent:"space-between"}}>
      <SubTabs value={view} onChange={v=>{setView(v);setShowNew(false);}} items={[["models","🚢 Vessel Models"],["kits","🧰 Maintenance Kits"],["picktime","⏱ Pick Time"]]}/>
      {view==="models"&&<Btn variant="outline" onClick={()=>setShowImport(true)}>📂 Import CSV</Btn>}
    </div>
    {showImport&&<ControlListImportModal vesselModels={vesselModels} controlLines={controlLines} parts={parts} packingSlipTypes={packingSlipTypes} actions={actions} onClose={()=>setShowImport(false)}/>}

    {view==="models"&&<div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"flex-start"}}>
      {pickList(vesselModels, m=>controlLines.filter(c=>c.vessel_model_id===m.id).length, modelId, setModelId, "New Vessel Model")}
      <div style={{flex:"3 1 360px",minWidth:0}}>
        {showNew&&<NewNameForm label="Vessel model name" onCancel={()=>setShowNew(false)} onCreate={async f=>{const id=await actions.saveVesselModel(f);setModelId(id);setShowNew(false);}}/>}
        {!model&&!showNew&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>Select a vessel model to edit its control lists, or create one.</div>}
        {model&&<>
          <NameHeader key={model.id} record={model} onSave={actions.saveVesselModel} onDelete={async id=>{await actions.deleteVesselModel(id);setModelId(null);}} deleteLabel="Delete vessel model"/>
          {packingSlipTypes.map(t=><LineEditor key={t.id} title={t.name} subtitle={`Staged ${t.lead_buffer_days??0} day(s) before paint start`}
            lines={controlLines.filter(c=>c.vessel_model_id===model.id&&c.list_type===t.name)} parts={parts} qtyLabel="per vessel"
            onAdd={(partId,qty)=>actions.saveControlLine({vessel_model_id:model.id,list_type:t.name,part_id:partId,qty_per_unit:qty})}
            onQty={(l,v)=>actions.saveControlLine({...l,qty_per_unit:v})} onRemove={actions.deleteControlLine}/>)}
        </>}
      </div>
    </div>}

    {view==="kits"&&<div style={{display:"flex",gap:18,flexWrap:"wrap",alignItems:"flex-start"}}>
      {pickList(maintKits, k=>kitLines.filter(l=>l.kit_id===k.id).length, kitId, setKitId, "New Kit")}
      <div style={{flex:"3 1 360px",minWidth:0}}>
        {showNew&&<NewNameForm label="Kit name" onCancel={()=>setShowNew(false)} onCreate={async f=>{const id=await actions.saveKit(f);setKitId(id);setShowNew(false);}}/>}
        {!kit&&!showNew&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>Select a kit to edit its contents, or create one (e.g. an annual service kit).</div>}
        {kit&&<>
          <NameHeader key={kit.id} record={kit} onSave={actions.saveKit} onDelete={async id=>{await actions.deleteKit(id);setKitId(null);}} deleteLabel="Delete kit"/>
          <LineEditor title="Kit contents" subtitle="Parts used each time this kit is ordered" lines={kitLines.filter(l=>l.kit_id===kit.id)} parts={parts} qtyLabel="per kit"
            onAdd={(partId,qty)=>actions.saveKitLine({kit_id:kit.id,part_id:partId,qty})}
            onQty={(l,v)=>actions.saveKitLine({kit_id:l.kit_id,part_id:l.part_id,qty:v})} onRemove={actions.deleteKitLine}/>
        </>}
      </div>
    </div>}

    {view==="picktime"&&<div style={{maxWidth:560}}>
      <div style={{background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:8,padding:"10px 14px",fontSize:12,color:C.warnText,marginBottom:14}}>
        Parts ship when vessels pass hydro and move to paint. Each list must be picked, boxed and staged this many days <strong>before</strong> the planned paint-start date, so parts must be on hand by then. If parts are still on order, picking waits for receipt.
      </div>
      {packingSlipTypes.map(t=><div key={t.id} style={{display:"flex",alignItems:"center",gap:12,background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"12px 16px",marginBottom:8}}>
        <span style={{flex:1,fontWeight:700,color:C.navy}}>{t.name}</span>
        <input key={t.id+":"+t.lead_buffer_days} type="number" min="0" step="1" defaultValue={t.lead_buffer_days??0}
          onBlur={e=>{const v=Math.max(0,Math.round(+e.target.value||0)); if(v!==(t.lead_buffer_days??0)) actions.updateListType(t.id,{lead_buffer_days:v}).catch(err=>alert(err.message));}}
          style={{...inputStyle,width:72,textAlign:"center",fontFamily:"monospace",fontWeight:700}}/>
        <span style={{fontSize:12,color:C.textLight,minWidth:120}}>days before paint start</span>
      </div>)}
    </div>}
  </div>;
}

// ─── Orders Tab (manufacturing vessel orders + customer maintenance POs) ──────
function NewOrderModal({ customers, actions, onClose, onCreated }) {
  const [f,setF]=useState({order_type:"manufacturing",customer_id:"",quote_number:"",po_number:"",project_name:"",notes:""});
  const [busy,run]=useRun();
  const set=(k)=>(e)=>setF(p=>({...p,[k]:e.target.value}));
  return <Modal title="New Order" onClose={onClose}>
    <div style={{display:"grid",gap:12}}>
      <Sel label="Order type" value={f.order_type} onChange={set("order_type")}>
        <option value="manufacturing">Manufacturing — vessel build (control lists)</option>
        <option value="maintenance">Maintenance — customer purchase order (parts / kits)</option>
      </Sel>
      <Sel label="Customer" value={f.customer_id} onChange={set("customer_id")}>
        <option value="">Select customer…</option>
        {customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}
      </Sel>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Input label="Quote number" value={f.quote_number} onChange={set("quote_number")} placeholder="e.g. 4113"/>
        <Input label="Customer P.O. number" value={f.po_number} onChange={set("po_number")} placeholder="e.g. 26-200-02"/>
      </div>
      <Input label="Project name" value={f.project_name} onChange={set("project_name")} placeholder="e.g. Gallup G-80 POD 8 and 13"/>
      <Input label="Notes" value={f.notes} onChange={set("notes")}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={()=>run(async()=>{const id=await actions.createOrder(f);onCreated(id);})}>{busy?"Creating…":"Create Order"}</Btn>
      </div>
    </div>
  </Modal>;
}

function VesselLines({ order, lines, vesselModels, controlLines, actions }) {
  const [busy,run]=useRun();
  const [add,setAdd]=useState({vessel_model_id:"",units:1,paint_start_date:"",ship_date:""});
  const modelName=(id)=>vesselModels.find(m=>m.id===id)?.name||id;
  const nextOf=(s)=>{const i=LINE_STATUSES.indexOf(s); return (i>=0&&i<LINE_STATUSES.indexOf("Shipped"))?LINE_STATUSES[i+1]:null;};
  return <div>
    {lines.length===0&&<div style={{fontSize:12,color:C.textLight,padding:"8px 0"}}>No vessels on this order yet.</div>}
    {lines.map(ol=>{
      const counts=controlLines.filter(c=>c.vessel_model_id===ol.vessel_model_id);
      const firm=FIRM_STATUSES.includes(ol.status);
      const next=nextOf(ol.status);
      return <div key={ol.id} style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:10,background:C.white}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <span style={{fontWeight:800,color:C.navy,fontSize:14}}>{modelName(ol.vessel_model_id)}</span>
            <Badge color={lineStatusColor(ol.status)}>{ol.status}</Badge>
            {!["Shipped","Cancelled"].includes(ol.status)&&<Badge color={firm?"green":"amber"}>{firm?"Firm demand":"Tentative"}</Badge>}
          </div>
          <button disabled={busy} onClick={()=>{if(window.confirm("Remove this vessel line?"))run(()=>actions.deleteOrderLine(ol));}} style={{width:26,height:26,borderRadius:4,border:`1px solid ${C.redBorder}`,background:C.white,cursor:"pointer",color:C.red,fontSize:12}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:10,alignItems:"end"}}>
          <Field label="Vessels">
            <input key={ol.id+":u"+ol.units} type="number" min="1" step="1" defaultValue={ol.units} style={{...inputStyle,fontFamily:"monospace",fontWeight:700}}
              onBlur={e=>{const v=Math.max(1,Math.round(+e.target.value||1)); if(v!==ol.units)run(()=>actions.updateOrderLine(ol,{units:v}));}}/>
          </Field>
          <Field label="Paint start (planned)">
            <input key={ol.id+":p"+ol.paint_start_date} type="date" defaultValue={ol.paint_start_date||""} style={inputStyle}
              onBlur={e=>{const v=e.target.value||null; if(v!==(ol.paint_start_date||null))run(()=>actions.updateOrderLine(ol,{paint_start_date:v}));}}/>
          </Field>
          <Field label="Ship date (optional)">
            <input key={ol.id+":s"+ol.ship_date} type="date" defaultValue={ol.ship_date||""} style={inputStyle}
              onBlur={e=>{const v=e.target.value||null; if(v!==(ol.ship_date||null))run(()=>actions.updateOrderLine(ol,{ship_date:v}));}}/>
          </Field>
          <Field label="Status">
            <select value={ol.status} disabled={busy} style={inputStyle} onChange={e=>run(()=>actions.updateOrderLine(ol,{status:e.target.value}))}>
              {LINE_STATUSES.map(s=><option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginTop:10}}>
          <div style={{fontSize:11,color:C.textMid}}>
            {packingTypeSummary(counts)}
            {counts.length===0&&<span style={{color:C.red,fontWeight:700}}>⚠ No control list for this model — nothing will be forecast.</span>}
            {!ol.paint_start_date&&<div style={{color:C.warnText,fontWeight:700,marginTop:2}}>⚠ Set the planned paint-start date — all parts are dated from it.</div>}
          </div>
          {next&&<Btn variant="outline" style={{padding:"5px 12px",fontSize:12}} disabled={busy}
            onClick={()=>{if(next==="Shipped"&&!window.confirm("Mark as shipped? Parts leave for the manufacturer."))return; run(()=>actions.updateOrderLine(ol,{status:next}));}}>→ {next}</Btn>}
        </div>
      </div>;
    })}
    <div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:8,padding:12}}>
      <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:8}}>+ Add vessels</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(130px,1fr))",gap:8,alignItems:"end"}}>
        <Sel value={add.vessel_model_id} onChange={e=>setAdd(a=>({...a,vessel_model_id:e.target.value}))}>
          <option value="">Vessel model…</option>{vesselModels.map(m=><option key={m.id} value={m.id}>{m.name}</option>)}
        </Sel>
        <input type="number" min="1" value={add.units} onChange={e=>setAdd(a=>({...a,units:e.target.value}))} style={{...inputStyle,fontFamily:"monospace"}} title="Number of vessels"/>
        <input type="date" value={add.paint_start_date} onChange={e=>setAdd(a=>({...a,paint_start_date:e.target.value}))} style={inputStyle} title="Planned paint start"/>
        <Btn variant="outline" disabled={!add.vessel_model_id||busy} onClick={()=>run(async()=>{await actions.addOrderLine({order_id:order.id,...add});setAdd({vessel_model_id:"",units:1,paint_start_date:"",ship_date:""});})}>Add</Btn>
      </div>
      {vesselModels.length===0&&<div style={{fontSize:11,color:C.red,marginTop:6}}>Create a vessel model on the Control Lists tab first.</div>}
    </div>
  </div>;
}

function packingTypeSummary(counts){
  if(!counts.length) return null;
  const by={}; counts.forEach(c=>{by[c.list_type]=(by[c.list_type]||0)+1;});
  return <span>Control list: {Object.entries(by).map(([k,v])=>`${k} ${v}`).join(" · ")} part line(s). </span>;
}

function MaintenanceLines({ order, lines, parts, maintKits, kitLines, actions }) {
  const [busy,run]=useRun();
  const [add,setAdd]=useState({line_type:"part",part_id:"",kit_id:"",qty:1,needed_by:""});
  const valid = +add.qty>0 && (add.line_type==="part" ? parts.some(p=>p.id===add.part_id) : !!add.kit_id);
  return <div>
    {lines.length===0&&<div style={{fontSize:12,color:C.textLight,padding:"8px 0"}}>No lines on this purchase order yet.</div>}
    {lines.map(ml=>{
      const p=parts.find(x=>x.id===ml.part_id); const k=maintKits.find(x=>x.id===ml.kit_id);
      const kitSize=ml.line_type==="kit"?kitLines.filter(l=>l.kit_id===ml.kit_id).length:0;
      return <div key={ml.id} style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:12,marginBottom:10,background:C.white}}>
        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:8}}>
          <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap"}}>
            <Badge color={ml.line_type==="kit"?"navy":"blue"}>{ml.line_type==="kit"?"Kit":"Part"}</Badge>
            {ml.line_type==="kit"
              ? <span style={{fontWeight:800,color:C.navy,fontSize:13}}>{k?.name||ml.kit_id} <span style={{fontWeight:500,color:C.textLight,fontSize:11}}>({kitSize} part line(s))</span></span>
              : <span><span style={{fontFamily:"monospace",fontSize:12,color:C.amber,fontWeight:700}}>{ml.part_id}</span> <span style={{fontSize:12,color:C.textMid}}>{p?.description}</span></span>}
          </div>
          <button disabled={busy} onClick={()=>{if(window.confirm("Remove this line?"))run(()=>actions.deleteMaintLine(ml));}} style={{width:26,height:26,borderRadius:4,border:`1px solid ${C.redBorder}`,background:C.white,cursor:"pointer",color:C.red,fontSize:12}}>✕</button>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(120px,1fr))",gap:10,alignItems:"end"}}>
          <Field label={ml.line_type==="kit"?"Kits":"Quantity"}>
            <input key={ml.id+":q"+ml.qty} type="number" min="1" step="any" defaultValue={ml.qty} style={{...inputStyle,fontFamily:"monospace",fontWeight:700}}
              onBlur={e=>{const v=+e.target.value; if(v>0&&v!==+ml.qty)run(()=>actions.updateMaintLine(ml,{qty:v}));}}/>
          </Field>
          <Field label="Needed by">
            <input key={ml.id+":n"+ml.needed_by} type="date" defaultValue={ml.needed_by||""} style={inputStyle}
              onBlur={e=>{const v=e.target.value||null; if(v!==(ml.needed_by||null))run(()=>actions.updateMaintLine(ml,{needed_by:v}));}}/>
          </Field>
          <Field label="Status">
            <select value={ml.status} disabled={busy} style={inputStyle} onChange={e=>run(()=>actions.updateMaintLine(ml,{status:e.target.value}))}>
              {["Open","Shipped","Cancelled"].map(s=><option key={s}>{s}</option>)}
            </select>
          </Field>
        </div>
        {!ml.needed_by&&ml.status==="Open"&&<div style={{color:C.warnText,fontSize:11,fontWeight:700,marginTop:6}}>⚠ No needed-by date — treated as needed today.</div>}
      </div>;
    })}
    <div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:8,padding:12}}>
      <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:8}}>+ Add line</div>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:8,alignItems:"start"}}>
        <Sel value={add.line_type} onChange={e=>setAdd(a=>({...a,line_type:e.target.value,part_id:"",kit_id:""}))}>
          <option value="part">Part (SKU)</option><option value="kit">Maintenance kit</option>
        </Sel>
        {add.line_type==="part"
          ? <PartPicker parts={parts} value={add.part_id} onChange={v=>setAdd(a=>({...a,part_id:v}))}/>
          : <Sel value={add.kit_id} onChange={e=>setAdd(a=>({...a,kit_id:e.target.value}))}><option value="">Select kit…</option>{maintKits.map(k=><option key={k.id} value={k.id}>{k.name}</option>)}</Sel>}
        <input type="number" min="1" step="any" value={add.qty} onChange={e=>setAdd(a=>({...a,qty:e.target.value}))} style={{...inputStyle,fontFamily:"monospace"}} title="Quantity"/>
        <input type="date" value={add.needed_by} onChange={e=>setAdd(a=>({...a,needed_by:e.target.value}))} style={inputStyle} title="Needed by"/>
        <Btn variant="outline" disabled={!valid||busy} onClick={()=>run(async()=>{await actions.addMaintLine({order_id:order.id,...add});setAdd({line_type:add.line_type,part_id:"",kit_id:"",qty:1,needed_by:""});})}>Add</Btn>
      </div>
    </div>
  </div>;
}

async function readSlipPdf(file){
  const pdfjs=await import("pdfjs-dist");
  pdfjs.GlobalWorkerOptions.workerSrc=(await import("pdfjs-dist/build/pdf.worker.min.mjs?url")).default;
  const doc=await pdfjs.getDocument({data:new Uint8Array(await file.arrayBuffer())}).promise;
  const items=[];
  for(let p=1;p<=doc.numPages;p++){
    const tc=await (await doc.getPage(p)).getTextContent();
    tc.items.forEach(i=>{ if(i.transform&&typeof i.str==="string") items.push({str:i.str,x:i.transform[4],y:i.transform[5],page:p}); });
  }
  return parseSlip(items);
}

function OrderPackingPanel({ order, packingLines, parts, packingSlipTypes, actions }) {
  const isPhone=useIsPhone();
  const [busy,run]=useRun();
  const [slips,setSlips]=useState(null);     // review state: [{file,title,quote,slipDate,po,listType,error,lines:[...]}]
  const [reading,setReading]=useState(false);
  const [msg,setMsg]=useState(null);
  const mine=packingLines.filter(l=>l.order_id===order.id);
  const listNames=packingSlipTypes.map(t=>t.name);
  const groups=listNames.map(n=>({n,rows:mine.filter(l=>l.list_type===n)})).filter(g=>g.rows.length>0)
    .concat([...new Set(mine.map(l=>l.list_type))].filter(n=>!listNames.includes(n)).map(n=>({n,rows:mine.filter(l=>l.list_type===n)})));

  async function onFiles(e){
    const files=[...(e.target.files||[])]; e.target.value="";
    if(!files.length) return;
    setReading(true); setMsg(null);
    const out=[];
    for(const f of files){
      try{
        const r=await readSlipPdf(f);
        if(r.error){ out.push({file:f.name,error:r.error,lines:[]}); continue; }
        out.push({file:f.name,title:r.title,quote:r.quote,slipDate:r.slipDate,po:r.po,listType:guessListType(r.title,listNames),
          lines:r.lines.map((l,k)=>{
            const m=matchPart(parts,l.no,l.desc);
            const flags=[...m.flags]; if(l.qty==null) flags.push("No quantity found. Type it in, or skip the line.");
            return {id:k,no:l.no,desc:l.desc,qty:l.qty==null?"":String(l.qty),partId:m.pick?.id||"",candidates:m.candidates.map(c=>c.part.id),flags,include:true};
          })});
      }catch(err){ out.push({file:f.name,error:"Could not read this file: "+(err.message||err),lines:[]}); }
    }
    setReading(false); setSlips(out);
  }
  const upd=(si,fn)=>setSlips(prev=>prev.map((s,i)=>i===si?fn(s):s));
  const updLine=(si,li,ch)=>upd(si,s=>({...s,lines:s.lines.map((l,k)=>k===li?{...l,...ch}:l)}));

  const problems=(slips||[]).flatMap((s,si)=>{
    if(s.error) return [];
    const p=[];
    if(!s.listType) p.push(`${s.file}: choose the packing list type.`);
    if((slips||[]).findIndex(x=>!x.error&&x.listType===s.listType)!==si&&s.listType) p.push(`${s.file}: another file in this upload is also "${s.listType}". Load one at a time.`);
    s.lines.filter(l=>l.include).forEach(l=>{ if(!l.partId) p.push(`${s.file}: ${l.no} needs a part.`); if(!(+l.qty>0)) p.push(`${s.file}: ${l.no} needs a quantity above 0.`); });
    if(s.lines.filter(l=>l.include).length===0) p.push(`${s.file}: no lines selected.`);
    return p;
  });
  const goodSlips=(slips||[]).filter(s=>!s.error);

  async function saveAll(){
    for(const s of goodSlips){
      const had=mine.some(l=>l.list_type===s.listType);
      if(had&&!window.confirm(`"${s.listType}" is already loaded for this order. Replace it with ${s.file}?`)) continue;
      await actions.savePackingList(order.id,s.listType,s.lines.filter(l=>l.include),{slipDate:(()=>{const m=(s.slipDate||"").match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);return m?`${m[3]}-${m[1].padStart(2,"0")}-${m[2].padStart(2,"0")}`:null;})(),file:s.file});
    }
    setMsg({ok:true,text:`Loaded ${goodSlips.length} packing list${goodSlips.length>1?"s":""}.`}); setSlips(null);
  }
  const sel={fontSize:12,padding:"4px 6px",border:`1px solid ${C.border}`,borderRadius:4,maxWidth:"100%"};
  return <div style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:12,background:C.white}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <div>
        <div style={{fontWeight:800,fontSize:13,color:C.navy}}>Packing lists</div>
        <div style={{fontSize:12,color:C.textLight}}>{mine.length===0?"None loaded. Upload the QuickBooks packing slip PDFs (Main, Loose, Spare). The LP is built from them.":`${groups.length} loaded · ${mine.length} lines`}</div>
      </div>
      <label style={{display:"inline-block",padding:"7px 14px",borderRadius:6,background:C.navy,color:"#fff",fontSize:13,fontWeight:700,cursor:reading?"wait":"pointer"}}>
        {reading?"Reading…":"Upload slip PDF(s)"}<input type="file" accept="application/pdf,.pdf" multiple disabled={reading} onChange={onFiles} style={{display:"none"}}/>
      </label>
    </div>
    {groups.map(g=><div key={g.n} style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginTop:8,fontSize:12,borderTop:`1px solid ${C.border}`,paddingTop:6}}>
      <span><b>{g.n}</b> · {g.rows.length} lines{g.rows[0].slip_date?` · slip ${fmtDate(g.rows[0].slip_date)}`:""}{g.rows[0].source_file?` · ${g.rows[0].source_file}`:""}</span>
      <button disabled={busy} onClick={()=>{if(window.confirm(`Remove the ${g.n} packing list from this order?`))run(()=>actions.deletePackingList(order.id,g.n));}} style={{border:`1px solid ${C.redBorder}`,background:C.white,color:C.red,borderRadius:4,padding:"2px 8px",fontSize:12,cursor:"pointer"}}>Remove</button>
    </div>)}
    {msg&&<div style={{marginTop:8,fontSize:12,fontWeight:600,color:msg.ok?C.greenText:C.red}}>{msg.text}</div>}
    {slips&&<Modal title="Review packing lists before loading" width={1000} onClose={()=>setSlips(null)} confirmClose="Discard these packing lists? Nothing has been loaded yet.">
      <div style={{display:"grid",gap:14}}>
        <div style={{fontSize:12,color:C.textMid}}>Check each line. Amber lines need a look. Nothing is saved until you press Load. Slips may print the old or the new part number; the match uses both plus the description.</div>
        {slips.map((s,si)=>s.error
          ?<div key={si} style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:10,fontSize:12,color:C.red}}><b>{s.file}</b><br/>{s.error}</div>
          :<div key={si} style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:10}}>
            <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginBottom:8}}>
              <b style={{fontSize:13}}>{s.title||s.file}</b>
              <span style={{fontSize:11,color:C.textLight}}>{s.file}</span>
              <span style={{fontSize:11,color:C.textMid}}>Quote {s.quote||"?"}{s.slipDate?` · ${s.slipDate}`:""}{s.po?` · PO ${s.po}`:""}</span>
              <select value={s.listType} onChange={e=>upd(si,x=>({...x,listType:e.target.value}))} style={sel}><option value="">Packing list type…</option>{listNames.map(n=><option key={n}>{n}</option>)}</select>
            </div>
            {order.quote_number&&s.quote&&order.quote_number!==s.quote&&<div style={{fontSize:12,color:C.amber,fontWeight:700,marginBottom:6}}>⚠ Slip quote number {s.quote} does not match this order ({order.quote_number}).</div>}
            {s.lines.map((l,li)=>{
              const cands=l.candidates.map(id=>parts.find(p=>p.id===id)).filter(Boolean);
              const rest=parts.filter(p=>!l.candidates.includes(p.id));
              const warn=l.flags.length>0;
              return <div key={l.id} style={{display:"grid",gridTemplateColumns:isPhone?"24px minmax(0,1fr) 64px":"24px minmax(0,1.2fr) 64px minmax(0,1.4fr)",gap:8,alignItems:"start",padding:"6px 4px",borderTop:`1px solid ${C.border}`,background:!l.include?"#f4f4f4":warn?"#FFF8E6":"transparent",opacity:l.include?1:.6}}>
                <input type="checkbox" checked={l.include} onChange={e=>updLine(si,li,{include:e.target.checked})} style={{marginTop:4}}/>
                <div style={{fontSize:12}}><b style={{fontFamily:"monospace"}}>{l.no}</b> {l.desc}{l.flags.map((f,k)=><div key={k} style={{color:C.amber,fontWeight:700,fontSize:11}}>⚠ {f}</div>)}</div>
                <input type="number" min="0" value={l.qty} onChange={e=>updLine(si,li,{qty:e.target.value})} style={{...sel,width:60,fontFamily:"monospace"}}/>
                <select value={l.partId} onChange={e=>updLine(si,li,{partId:e.target.value})} style={{...sel,...(isPhone?{gridColumn:"2 / -1",minHeight:40}:{})}}>
                  <option value="">Choose part…</option>
                  {cands.length>0&&<optgroup label="Suggested">{cands.map(p=><option key={p.id} value={p.id}>{p.id} · {p.description}</option>)}</optgroup>}
                  <optgroup label="All parts">{rest.map(p=><option key={p.id} value={p.id}>{p.id} · {p.description}</option>)}</optgroup>
                </select>
              </div>;
            })}
          </div>)}
        {problems.length>0&&<div style={{fontSize:12,color:C.red}}>{problems.slice(0,6).map((p,i)=><div key={i}>• {p}</div>)}{problems.length>6&&<div>…and {problems.length-6} more</div>}</div>}
        <div style={{display:"flex",justifyContent:"flex-end",gap:8}}>
          <Btn variant="outline" onClick={()=>setSlips(null)}>Cancel</Btn>
          <Btn disabled={busy||goodSlips.length===0||problems.length>0} onClick={()=>run(saveAll)}>Load {goodSlips.length} packing list{goodSlips.length===1?"":"s"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

function OrderLpPanel({ order, lps, actions, disabled, packingCount=0, onOpenLp }) {
  const [busy,run]=useRun();
  const [msg,setMsg]=useState(null);
  const mine=lps.filter(l=>l.order_id===order.id);
  async function create(){
    if(mine.length>0&&!window.confirm(`This order already has ${mine.length} license plate${mine.length>1?"s":""} (${mine.map(l=>l.id).join(", ")}).\n\nCreate another one?`)) return;
    try{
      const r=await actions.createLpFromOrder(order.id);
      setMsg({ok:true,text:`Created ${r.id}: ${r.lines} lines${r.direct?` (${r.direct} ship direct from supplier)`:""}.${r.skipped.length?` Skipped unknown parts: ${[...new Set(r.skipped)].join(", ")}.`:""}`});
    }catch(e){ setMsg({ok:false,text:e.message||String(e)}); }
  }
  const sc=lpStatusColor;
  const small={minHeight:36,padding:"0 12px",borderRadius:6,fontSize:12,fontWeight:700,cursor:"pointer"};
  return <div style={{border:`1.5px solid ${C.border}`,borderRadius:8,padding:12,background:C.white,display:"grid",gap:8}}>
    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",gap:8,flexWrap:"wrap"}}>
      <div>
        <div style={{fontWeight:800,fontSize:13,color:C.navy}}>Shipment license plate</div>
        {mine.length===0&&<div style={{fontSize:12,color:C.textLight}}>{packingCount>0?"None yet. Will load every line from this order's packing lists.":"None yet. No packing lists loaded, so it will load the control list(s) for this order's vessels and units."}</div>}
      </div>
      <Btn variant={mine.length>0?"outline":"primary"} disabled={busy||disabled} onClick={()=>run(create)}>{busy?"Creating…":mine.length>0?"Create another LP":"Create LP from order"}</Btn>
    </div>
    {mine.map(l=>{ const pr=lpPickProgress(l.items); const canPick=lpIsPrep(l.status)&&(l.type||"Outbound")==="Outbound"&&pr.qty>0;
      return <div key={l.id} style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",borderTop:`1px solid ${C.border}`,paddingTop:8}}>
        <span style={{fontFamily:"monospace",fontWeight:800,fontSize:13,color:C.navy}}>{l.id}</span>
        <Badge color={sc(l.status)}>{l.status}</Badge>
        {pr.qty>0&&<span style={{fontSize:12,color:C.textMid}}>{pr.picked}/{pr.qty} picked</span>}
        <span style={{flex:1}}/>
        {onOpenLp&&<button onClick={()=>onOpenLp(l.id)} style={{...small,border:`1.5px solid ${C.navy}`,background:C.white,color:C.navy}}>Open</button>}
        {onOpenLp&&canPick&&<button onClick={()=>onOpenLp(l.id,true)} style={{...small,border:"none",background:C.navy,color:"#fff"}}>▶ Pick</button>}
      </div>; })}
    {msg&&<div style={{fontSize:12,fontWeight:600,color:msg.ok?C.greenText:C.red}}>{msg.text}</div>}
  </div>;
}

function OrderDetailModal({ packingLines, packingSlipTypes, lps, order, customers, orderLines, maintLines, vesselModels, controlLines, maintKits, kitLines, parts, actions, onClose, onOpenLp }) {
  const [f,setF]=useState({customer_id:order.customer_id||"",quote_number:order.quote_number||"",po_number:order.po_number||"",project_name:order.project_name||"",notes:order.notes||"",status:order.status||"Open"});
  const [busy,run]=useRun();
  const set=(k)=>(e)=>setF(p=>({...p,[k]:e.target.value}));
  const isMaint=(order.order_type||"manufacturing")==="maintenance";
  const dirty=["customer_id","quote_number","po_number","project_name","notes","status"].some(k=>(f[k]||"")!==(order[k]||(k==="status"?"Open":"")));
  return <Modal title={order.id} onClose={onClose}>
    <div style={{display:"grid",gap:14}}>
      <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap"}}>
        <Badge color={isMaint?"navy":"blue"}>{isMaint?"Maintenance PO":"Manufacturing"}</Badge>
        <span style={{fontSize:11,color:C.textLight}}>Created {fmtDate((order.created_at||"").slice(0,10))}</span>
      </div>
      <div style={{display:"grid",gap:10,background:C.offWhite,borderRadius:8,padding:12}}>
        <Sel label="Customer" value={f.customer_id} onChange={set("customer_id")}><option value="">Select customer…</option>{customers.map(c=><option key={c.id} value={c.id}>{c.name}</option>)}</Sel>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10}}>
          <Input label="Quote number" value={f.quote_number} onChange={set("quote_number")}/>
          <Input label="Customer P.O. number" value={f.po_number} onChange={set("po_number")}/>
        </div>
        <Input label="Project name" value={f.project_name} onChange={set("project_name")}/>
        <Input label="Notes" value={f.notes} onChange={set("notes")}/>
        <Sel label="Order status" value={f.status} onChange={set("status")}><option>Open</option><option>Closed</option><option>Cancelled</option></Sel>
        <div style={{display:"flex",justifyContent:"space-between",gap:8}}>
          <Btn variant="danger" disabled={busy} onClick={()=>{if(window.confirm(`Delete order ${order.id} and all its lines?`))run(async()=>{await actions.deleteOrder(order.id);onClose();});}}>Delete order</Btn>
          <Btn disabled={!dirty||busy} onClick={()=>run(()=>actions.updateOrder(order.id,{customer_id:f.customer_id||null,quote_number:f.quote_number||null,po_number:f.po_number||null,project_name:f.project_name||null,notes:f.notes||null,status:f.status}))}>{busy?"Saving…":"Save order"}</Btn>
        </div>
      </div>
      <OrderPackingPanel order={order} packingLines={packingLines||[]} parts={parts} packingSlipTypes={packingSlipTypes||[]} actions={actions}/>
      <OrderLpPanel order={order} lps={lps||[]} actions={actions} onOpenLp={onOpenLp} packingCount={(packingLines||[]).filter(l=>l.order_id===order.id).length} disabled={(order.status||"Open")!=="Open"}/>
      <SectionTitle>{isMaint?"Purchase order lines":"Vessels on this order"}</SectionTitle>
      {isMaint
        ? <MaintenanceLines order={order} lines={maintLines.filter(l=>l.order_id===order.id)} parts={parts} maintKits={maintKits} kitLines={kitLines} actions={actions}/>
        : <VesselLines order={order} lines={orderLines.filter(l=>l.order_id===order.id)} vesselModels={vesselModels} controlLines={controlLines} actions={actions}/>}
    </div>
  </Modal>;
}

function OrdersTab({ packingLines, packingSlipTypes, lps, orders, orderLines, maintLines, customers, vesselModels, controlLines, maintKits, kitLines, parts, actions, focus, onFocusDone, onOpenLp }) {
  const [typeFilter,setTypeFilter]=useState("all");
  const [search,setSearch]=useState("");
  const [showNew,setShowNew]=useState(false);
  const [openId,setOpenId]=useState(null);
  useEffect(()=>{ if(focus){ setOpenId(focus.id); onFocusDone?.(); } },[focus]);   // opened from an LP
  const custName=(id)=>customers.find(c=>c.id===id)?.name||"";
  const shown=orders.filter(o=>(typeFilter==="all"||(o.order_type||"manufacturing")===typeFilter)
    && `${o.id} ${o.quote_number||""} ${o.po_number||""} ${o.project_name||""} ${custName(o.customer_id)}`.toLowerCase().includes(search.toLowerCase()));
  const open=orders.find(o=>o.id===openId);
  return <div>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search order, quote, PO, project, customer…" style={{...inputStyle,flex:"1 1 220px"}}/>
      <select value={typeFilter} onChange={e=>setTypeFilter(e.target.value)} style={inputStyle}>
        <option value="all">All orders</option><option value="manufacturing">Manufacturing</option><option value="maintenance">Maintenance</option>
      </select>
      <Btn onClick={()=>setShowNew(true)}>+ New Order</Btn>
    </div>
    <div style={{display:"grid",gap:10}}>
      {shown.map(o=>{
        const isMaint=(o.order_type||"manufacturing")==="maintenance";
        const vl=orderLines.filter(l=>l.order_id===o.id); const ml=maintLines.filter(l=>l.order_id===o.id);
        const byStatus={}; vl.forEach(l=>{byStatus[l.status]=(byStatus[l.status]||0)+1;});
        return <div key={o.id} onClick={()=>setOpenId(o.id)} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px",cursor:"pointer"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,flexWrap:"wrap",marginBottom:4}}>
                <span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.navy}}>{o.id}</span>
                <Badge color={isMaint?"navy":"blue"}>{isMaint?"Maintenance":"Manufacturing"}</Badge>
                {o.status&&o.status!=="Open"&&<Badge color={o.status==="Closed"?"green":"red"}>{o.status}</Badge>}
              </div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy}}>{custName(o.customer_id)||"No customer"}{o.project_name?` · ${o.project_name}`:""}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:2,display:"flex",gap:12,flexWrap:"wrap"}}>
                {o.quote_number&&<span>Quote: <strong>{o.quote_number}</strong></span>}{o.po_number&&<span>PO: <strong>{o.po_number}</strong></span>}
              </div>
            </div>
            <div style={{display:"flex",gap:6,flexWrap:"wrap",alignItems:"flex-start",justifyContent:"flex-end"}}>
              {isMaint
                ? <Badge color="gray">{ml.length} line(s) · {ml.filter(l=>l.status==="Open").length} open</Badge>
                : Object.entries(byStatus).map(([s,n])=><Badge key={s} color={lineStatusColor(s)}>{n} × {s}</Badge>)}
              {!isMaint&&vl.length===0&&<Badge color="amber">No vessels yet</Badge>}
              {lps.filter(l=>l.order_id===o.id).map(l=>{const pr=lpPickProgress(l.items);return <Badge key={l.id} color={lpStatusColor(l.status)}>🏷️ {l.id}{lpIsPrep(l.status)&&pr.qty?` · ${pr.picked}/${pr.qty}`:` · ${l.status}`}</Badge>;})}
            </div>
          </div>
        </div>;
      })}
      {shown.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No orders yet. Create one to start planning demand.</div>}
    </div>
    {showNew&&<NewOrderModal customers={customers} actions={actions} onClose={()=>setShowNew(false)} onCreated={id=>{setShowNew(false);setOpenId(id);}}/>}
    {open&&<OrderDetailModal packingLines={packingLines} packingSlipTypes={packingSlipTypes} lps={lps} order={open} customers={customers} orderLines={orderLines} maintLines={maintLines} vesselModels={vesselModels} controlLines={controlLines} maintKits={maintKits} kitLines={kitLines} parts={parts} actions={actions} onClose={()=>setOpenId(null)} onOpenLp={onOpenLp}/>}
  </div>;
}

// ─── Replenishment Tab ───────────────────────────────────────────────────────
const POLICY_INFO = {
  order_driven:   ["Order-driven","Order only what confirmed and tentative orders require. Default for vessel parts."],
  reorder_point:  ["Reorder point","Reorder when stock falls to lead-time demand plus safety stock."],
  min_max:        ["Min / Max","Order up to Max whenever the position drops below Min."],
  fixed_interval: ["Fixed interval","Review on a schedule; order up to cover the lead time plus the review period."],
  do_not_reorder: ["Do not reorder","Never recommend an order (still flags a shortage). For items bought ad hoc."],
};
const SERVICE_LEVELS = [["0.9","90%"],["0.95","95% (default)"],["0.975","97.5%"],["0.99","99%"]];

function ItemSettingsModal({ part, procurement, suppliers, actions, onClose }) {
  const cur = procurement.find(p=>p.part_id===part.id) || {};
  const [f,setF]=useState({
    policy:cur.policy||"order_driven", preferred_supplier_id:cur.preferred_supplier_id||"", backup_supplier_id:cur.backup_supplier_id||"",
    lead_time_days:cur.lead_time_days??"", lead_buffer_days:cur.lead_buffer_days??0, service_level:String(cur.service_level??0.95),
    moq:cur.moq??1, order_multiple:cur.order_multiple??1, manual_monthly_usage:cur.manual_monthly_usage??0,
    min_qty:cur.min_qty??"", max_qty:cur.max_qty??"", review_interval_days:cur.review_interval_days??"", notes:cur.notes||"",
  });
  const [busy,run]=useRun();
  const set=(k)=>(e)=>setF(p=>({...p,[k]:e.target.value}));
  const linked=part.suppliers||[];
  const supName=(id)=>suppliers.find(s=>s.id===id)?.name||id;
  return <Modal title={`Procurement · ${part.id}`} onClose={onClose}>
    <div style={{display:"grid",gap:14}}>
      <div style={{fontSize:13,fontWeight:700,color:C.navy}}>{part.description}</div>
      <div style={{background:C.offWhite,borderRadius:8,padding:10}}>
        <div style={{fontSize:10,fontWeight:700,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:6}}>Linked suppliers</div>
        {linked.length===0&&<div style={{fontSize:12,color:C.red,fontWeight:700}}>⚠ No supplier linked. Link one in Parts Catalog → this part, or nothing can be ordered.</div>}
        {linked.map(s=><div key={s.supplierId} style={{display:"flex",justifyContent:"space-between",fontSize:12,padding:"3px 0",gap:8,flexWrap:"wrap"}}>
          <span style={{fontWeight:700,color:C.navy}}>{supName(s.supplierId)}</span>
          <span style={{fontFamily:"monospace",color:C.textMid}}>{s.mfgPartNo||"—"} · {s.leadDays||0}d lead · {money(s.unitCost)}</span>
        </div>)}
      </div>
      <Sel label="Reorder policy" value={f.policy} onChange={set("policy")}>
        {Object.entries(POLICY_INFO).map(([k,[n]])=><option key={k} value={k}>{n}</option>)}
      </Sel>
      <div style={{fontSize:11,color:C.textMid,marginTop:-6}}>{POLICY_INFO[f.policy][1]}</div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Sel label="Preferred supplier" value={f.preferred_supplier_id} onChange={set("preferred_supplier_id")}>
          <option value="">Cheapest linked supplier</option>{linked.map(s=><option key={s.supplierId} value={s.supplierId}>{supName(s.supplierId)}</option>)}
        </Sel>
        <Sel label="Backup supplier" value={f.backup_supplier_id} onChange={set("backup_supplier_id")}>
          <option value="">Next cheapest</option>{linked.map(s=><option key={s.supplierId} value={s.supplierId}>{supName(s.supplierId)}</option>)}
        </Sel>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Input label="Lead time override (days)" type="number" min="0" value={f.lead_time_days} onChange={set("lead_time_days")} placeholder="Use supplier lead time"/>
        <Input label="Extra lead-time buffer (days)" type="number" min="0" value={f.lead_buffer_days} onChange={set("lead_buffer_days")}/>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr 1fr",gap:12}}>
        <Input label="Min order qty (MOQ)" type="number" min="1" value={f.moq} onChange={set("moq")}/>
        <Input label="Order multiple (pack)" type="number" min="1" value={f.order_multiple} onChange={set("order_multiple")}/>
        <Sel label="Service level" value={f.service_level} onChange={set("service_level")}>{SERVICE_LEVELS.map(([v,l])=><option key={v} value={v}>{l}</option>)}</Sel>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:12}}>
        <Input label={f.policy==="min_max"?"Min qty":"Minimum on hand (safety floor)"} type="number" min="0" value={f.min_qty} onChange={set("min_qty")} placeholder="optional"/>
        {f.policy==="min_max"&&<Input label="Max qty" type="number" min="0" value={f.max_qty} onChange={set("max_qty")}/>}
        {["reorder_point","fixed_interval"].includes(f.policy)&&<Input label="Review / cover period (days)" type="number" min="1" value={f.review_interval_days} onChange={set("review_interval_days")} placeholder="30"/>}
      </div>
      <Input label="Extra expected usage per month (optional)" type="number" min="0" value={f.manual_monthly_usage} onChange={set("manual_monthly_usage")}/>
      <div style={{fontSize:11,color:C.textLight,marginTop:-6}}>Leave at 0 to forecast only from confirmed and tentative orders.</div>
      <Input label="Notes" value={f.notes} onChange={set("notes")}/>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end"}}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn disabled={busy} onClick={()=>run(async()=>{await actions.saveProcurement(part.id,f);onClose();})}>{busy?"Saving…":"Save settings"}</Btn>
      </div>
    </div>
  </Modal>;
}

const dueText=(d)=>d<0?`${Math.abs(d)}d overdue`:d===0?"today":`in ${d}d`;
const urgencyBadge=(u)=><Badge color={u==="late"?"red":u==="order_soon"?"amber":"gray"}>{u==="late"?"LATE":u==="order_soon"?"ORDER SOON":"PLANNED"}</Badge>;
const thS={padding:"8px 10px",textAlign:"left",fontSize:10,textTransform:"uppercase",letterSpacing:.5,color:"#8A9BB0",background:C.navy,position:"sticky",top:0,whiteSpace:"nowrap"};
const tdS={padding:"8px 10px",borderBottom:`1px solid ${C.border}`,fontSize:12,verticalAlign:"top"};

function PoGroupCard({ g, supplier, parts, draftKeys, canCreate, onCreate, busy, tentative }) {
  const unassigned=g.supplier_id==="UNASSIGNED";
  const inDraft=g.lines.filter(l=>draftKeys.has(`${g.supplier_id}|${l.part_id}`)).length;
  const csv=()=>downloadCsv(`${tentative?"tentative-":""}po-${(supplier?.name||g.supplier_id).replace(/\W+/g,"-")}-${localToday()}.csv`,
    [["Supplier","SKU","Supplier part no","Description","Qty","Unit cost","Extended","Needed by"],
     ...g.lines.map(l=>[supplier?.name||g.supplier_id,l.part_id,l.mfg_part_no||"",parts.find(p=>p.id===l.part_id)?.description||"",l.qty,l.unit_cost??"",l.unit_cost!=null?(l.qty*l.unit_cost).toFixed(2):"",l.needed_by||""])]);
  const print=()=>printPurchaseOrder({po:{id:null,status:tentative?"Tentative preview":"Draft (forecast)",notes:`Generated from replenishment forecast ${localToday()}`},supplier,lines:g.lines,parts});
  return <div style={{background:C.white,border:`1.5px ${tentative?"dashed":"solid"} ${unassigned?C.redBorder:C.border}`,borderRadius:8,padding:14,marginBottom:12}}>
    <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",marginBottom:8}}>
      <div>
        <div style={{fontWeight:800,fontSize:15,color:unassigned?C.red:C.navy}}>{unassigned?"No supplier linked":(supplier?.name||g.supplier_id)}</div>
        <div style={{fontSize:11,color:C.textLight}}>Order by <strong style={{color:C.navy}}>{fmtDate(g.order_by)}</strong> · {g.lines.length} line(s)</div>
      </div>
      <div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:C.navy}}>{money(g.total)}</div><div style={{fontSize:10,color:C.textLight}}>est. total</div></div>
    </div>
    {unassigned&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"8px 12px",fontSize:12,color:C.red,marginBottom:8}}>These items have no linked supplier. Link one on the part (Parts Catalog) before ordering.</div>}
    {inDraft>0&&<div style={{background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:6,padding:"6px 12px",fontSize:11,color:C.warnText,marginBottom:8}}>⚠ {inDraft} of {g.lines.length} line(s) are already on a draft PO for this supplier. Creating another would duplicate them.</div>}
    <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse"}}>
      <thead><tr>{["SKU","Description","Supplier part no.","Qty","Unit","Extended","Need by"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
      <tbody>{g.lines.map(l=><tr key={l.part_id}>
        <td style={{...tdS,fontFamily:"monospace",fontWeight:700,color:C.amber}}>{l.part_id}</td>
        <td style={tdS}>{parts.find(p=>p.id===l.part_id)?.description}</td>
        <td style={{...tdS,fontFamily:"monospace"}}>{l.mfg_part_no||"—"}</td>
        <td style={{...tdS,fontFamily:"monospace",fontWeight:700}}>{l.qty}</td>
        <td style={{...tdS,fontFamily:"monospace"}}>{money(l.unit_cost)}</td>
        <td style={{...tdS,fontFamily:"monospace"}}>{l.unit_cost!=null?money(l.qty*l.unit_cost):"—"}</td>
        <td style={tdS}>{fmtDate(l.needed_by)}</td>
      </tr>)}</tbody>
    </table></div>
    <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:10,flexWrap:"wrap"}}>
      <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={csv}>⬇ CSV</Btn>
      <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={print}>🖨 Print</Btn>
      {canCreate&&!unassigned&&!tentative&&<Btn disabled={busy} onClick={onCreate}>{busy?"Creating…":"Create draft PO"}</Btn>}
    </div>
  </div>;
}

// ─── Shared replenishment forecast ───────────────────────────────────────────
// One forecast drives the header badge, the Inventory and Parts tabs, and the Replenishment tab,
// so every screen gives the same answer. A part's Min Stock acts as its minimum unless the
// item's procurement settings give one.
function useReplenishmentForecast({ parts, procurement, controlLines, packingSlipTypes, purchaseOrders, poLines, kitLines, orderLines, maintLines, orders }, { horizon="180", tieBreak="maintenance" }={}) {
  const supplierLinks=useMemo(()=>parts.flatMap(p=>(p.suppliers||[]).map(s=>({part_id:p.id,supplier_id:s.supplierId,mfg_part_no:s.mfgPartNo,lead_days:s.leadDays,unit_cost:s.unitCost}))),[parts]);
  const liveOrders=useMemo(()=>new Set(orders.filter(o=>!["Cancelled","Closed"].includes(o.status)).map(o=>o.id)),[orders]);
  const openPoLines=useMemo(()=>{
    const open=new Map(purchaseOrders.filter(p=>["Sent","Partially Received"].includes(p.status)).map(p=>[p.id,p]));
    return poLines.filter(l=>open.has(l.po_id)).map(l=>({part_id:l.part_id,qty:l.qty,qty_received:l.qty_received,expected_date:open.get(l.po_id).expected_date||l.needed_by}));
  },[purchaseOrders,poLines]);
  const directIds=useMemo(()=>new Set(parts.filter(p=>(p.suppliers||[]).length>0&&p.suppliers.every(x=>x.shipsDirect)).map(p=>p.id)),[parts]);
  const procWithMins=useMemo(()=>{
    const byPart=new Map(procurement.map(p=>[p.part_id,p]));
    const out=procurement.map(p=>{ const part=parts.find(x=>x.id===p.part_id); return p.min_qty==null&&+part?.minStock>0?{...p,min_qty:+part.minStock}:p; });
    parts.forEach(p=>{ if(!byPart.has(p.id)&&+p.minStock>0&&!directIds.has(p.id)) out.push({part_id:p.id,min_qty:+p.minStock}); });
    return out;
  },[procurement,parts,directIds]);
  const result=useMemo(()=>forecast({
    parts,procurement:procWithMins,supplierLinks,controlLines:controlLines.filter(c=>!directIds.has(c.part_id)),listTypes:packingSlipTypes,openPoLines,kitLines,
    orderLines:orderLines.filter(l=>liveOrders.has(l.order_id)),
    maintenanceLines:maintLines.filter(l=>liveOrders.has(l.order_id)&&!directIds.has(l.part_id)),
  },{today:localToday(),horizonDays:+horizon,tieBreak}),[directIds,parts,procWithMins,supplierLinks,controlLines,packingSlipTypes,openPoLines,kitLines,orderLines,maintLines,liveOrders,horizon,tieBreak]);
  const byPart=useMemo(()=>new Map(result.recommendations.map(r=>[r.part_id,r])),[result]);
  // Same rule as the Replenishment tab's "Late" + "Order soon" cards.
  const toOrderNow=useMemo(()=>result.recommendations.filter(r=>["late","order_soon"].includes(r.urgency)&&(r.firm_order_qty>0||r.flags.includes("expedite_open_po"))).length,[result]);
  return {result,byPart,toOrderNow};
}
// Stock status for a part, from the shared forecast.
function stockStatus(part, rec){
  if(rec){
    if(rec.flags.includes("expedite_open_po")) return {label:"Expedite PO",color:"red"};
    if(rec.flags.includes("shortage_but_do_not_reorder")) return {label:"Short · no reorder",color:"red"};
    const qty=rec.firm_order_qty||rec.order_qty;
    if(qty>0&&rec.urgency==="late") return {label:"Order now (late)",color:"red"};
    if(qty>0&&rec.urgency==="order_soon") return {label:"Order soon",color:"amber"};
    if(qty>0) return {label:rec.firm_order_qty?"Order planned":"Tentative need",color:"blue"};
  }
  if(!(part?.stock>0)) return {label:"Out of stock",color:"gray"};
  return {label:"OK",color:"green"};
}

function ReplenishmentTab({ parts, suppliers, orders, orderLines, controlLines, packingSlipTypes, maintLines, kitLines, procurement, purchaseOrders, poLines, actions }) {
  const [view,setView]=useState("recs");
  const [horizon,setHorizon]=useState("180");
  const [tieBreak,setTieBreak]=useState("maintenance");
  const [showTentative,setShowTentative]=useState(true);
  const [filter,setFilter]=useState("all");
  const [settingsPart,setSettingsPart]=useState(null);
  const [search,setSearch]=useState("");
  const [busy,run]=useRun();
  const [msg,setMsg]=useState("");

  const {result}=useReplenishmentForecast({parts,procurement,controlLines,packingSlipTypes,purchaseOrders,poLines,kitLines,orderLines,maintLines,orders},{horizon,tieBreak});

  const draftKeys=useMemo(()=>{
    const d=new Map(purchaseOrders.filter(p=>p.status==="Draft").map(p=>[p.id,p.supplier_id]));
    return new Set(poLines.filter(l=>d.has(l.po_id)).map(l=>`${d.get(l.po_id)}|${l.part_id}`));
  },[purchaseOrders,poLines]);

  const recs=result.recommendations;
  const firmTotal=result.purchaseOrders.reduce((s,g)=>s+g.total,0);
  const tentTotal=result.tentativePurchaseOrders.reduce((s,g)=>s+g.total,0);
  const count=(u)=>recs.filter(r=>r.urgency===u&&(r.firm_order_qty>0||r.flags.includes("expedite_open_po"))).length;
  const attention=recs.filter(r=>r.flags.some(f=>flagColor(f)==="red")).length;
  const supplierOf=(id)=>suppliers.find(s=>s.id===id);
  const hasDemandData=orderLines.length>0||maintLines.length>0||procurement.length>0||recs.length>0;   // min-stock items count too

  const shownRecs=recs.filter(r=>(showTentative||r.firm_order_qty>0||r.flags.includes("expedite_open_po")||r.flags.includes("shortage_but_do_not_reorder"))
    && (filter==="all"||r.urgency===filter));

  const createPo=(g)=>run(async()=>{
    const id=await actions.createPurchaseOrder({supplier_id:g.supplier_id,notes:`Generated from replenishment forecast ${localToday()}`,lines:g.lines});
    setMsg(`Created ${id} as a Draft. Review and send it on the Purchase Orders tab.`);
  });

  const statCard=(label,value,color)=><div style={{flex:"1 1 130px",background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:"12px 14px"}}>
    <div style={{fontFamily:"monospace",fontSize:24,fontWeight:700,color:color||C.navy}}>{value}</div>
    <div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.5}}>{label}</div></div>;

  const itemRows=useMemo(()=>{
    const procSet=new Set(procurement.map(p=>p.part_id)); const recSet=new Set(recs.map(r=>r.part_id));
    const q=search.toLowerCase();
    return parts.filter(p=>!q||partMatchesSearch(p,q))
      .sort((a,b)=>((procSet.has(b.id)||recSet.has(b.id))-(procSet.has(a.id)||recSet.has(a.id)))||a.id.localeCompare(b.id));
  },[parts,procurement,recs,search]);

  return <div>
    <div style={{display:"flex",gap:10,flexWrap:"wrap",marginBottom:14}}>
      {statCard("Late",count("late"),count("late")?C.red:C.navy)}
      {statCard("Order soon",count("order_soon"),count("order_soon")?C.amber:C.navy)}
      {statCard("Planned",count("planned"))}
      {statCard("Firm to order",money(firmTotal),C.greenText)}
      {statCard("Tentative",money(tentTotal),C.textMid)}
      {statCard("Need attention",attention,attention?C.red:C.navy)}
    </div>
    <div style={{display:"flex",gap:12,flexWrap:"wrap",alignItems:"center",marginBottom:14,background:C.offWhite,borderRadius:8,padding:"10px 14px"}}>
      <label style={{fontSize:12,color:C.textMid}}>Look ahead&nbsp;
        <select value={horizon} onChange={e=>setHorizon(e.target.value)} style={{...inputStyle,padding:"4px 8px",fontSize:12}}>{["60","90","180","365"].map(d=><option key={d} value={d}>{d} days</option>)}</select></label>
      <label style={{fontSize:12,color:C.textMid}}>Same-day tie goes to&nbsp;
        <select value={tieBreak} onChange={e=>setTieBreak(e.target.value)} style={{...inputStyle,padding:"4px 8px",fontSize:12}}><option value="maintenance">Maintenance POs</option><option value="manufacturing">Vessel builds</option></select></label>
      <label style={{fontSize:12,color:C.textMid,display:"flex",alignItems:"center",gap:6}}><input type="checkbox" checked={showTentative} onChange={e=>setShowTentative(e.target.checked)}/>Include tentative (lists not final)</label>
      <span style={{fontSize:11,color:C.textLight,marginLeft:"auto"}}>As of {fmtDate(localToday())}</span>
    </div>
    {msg&&<div style={{background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.greenText,marginBottom:12,display:"flex",justifyContent:"space-between",gap:8}}>
      <span>✅ {msg}</span><button onClick={()=>setMsg("")} style={{background:"none",border:"none",cursor:"pointer",color:C.greenText}}>✕</button></div>}

    <SubTabs value={view} onChange={setView} items={[["recs",`📈 Recommendations (${shownRecs.length})`],["pos","🧾 Draft Purchase Orders"],["items","⚙ Item Settings"]]}/>

    {view==="recs"&&<div>
      {!hasDemandData&&<div style={{background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:8,padding:16,marginBottom:14,fontSize:13,color:C.warnText}}>
        <strong>Nothing to forecast yet.</strong> 1) Define vessel models and their Main/Loose/Spare lists on <em>Control Lists</em>. 2) Enter vessel and maintenance orders on <em>Orders</em> with a planned paint-start date. 3) Link suppliers (with lead time and cost) on each part.</div>}
      <div style={{display:"flex",gap:8,marginBottom:10,flexWrap:"wrap"}}>
        {[["all","All"],["late","Late"],["order_soon","Order soon"],["planned","Planned"]].map(([k,l])=><button key={k} onClick={()=>setFilter(k)} style={{background:filter===k?C.amber:C.white,color:C.navy,border:`1.5px solid ${filter===k?C.amber:C.border}`,borderRadius:16,padding:"4px 14px",fontSize:12,fontWeight:700,cursor:"pointer"}}>{l}</button>)}
      </div>
      <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:8,background:C.white}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:900}}>
          <thead><tr>{["Status","Part","Stock","Demand","Order qty","Order by","Need by","Supplier","Cost",""].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>
            {shownRecs.map(r=>{
              const sup=supplierOf(r.supplier_id); const bk=supplierOf(r.backup_supplier_id);
              const tentOnly=r.firm_order_qty===0&&r.tentative_order_qty>0;
              const date=r.firm_order_by||r.tentative_order_by||r.order_by;
              return <tr key={r.part_id} style={{background:r.urgency==="late"?"#FFF5F6":C.white}}>
                <td style={tdS}>{urgencyBadge(r.urgency)}{tentOnly&&<div style={{marginTop:4}}><Badge color="amber">Tentative</Badge></div>}</td>
                <td style={tdS}>
                  <div style={{fontFamily:"monospace",fontWeight:700,color:C.amber}}>{r.part_id}</div>
                  <div style={{color:C.textMid,maxWidth:240}}>{r.description}</div>
                  <div style={{display:"flex",gap:4,flexWrap:"wrap",marginTop:4}}>
                    {r.flags.map(f=><Badge key={f} color={flagColor(f)}>{f==="po_arrives_late"?`PO ${r.po_late_days}d late`:(FLAG_LABELS[f]||f)}</Badge>)}
                    {draftKeys.has(`${r.supplier_id}|${r.part_id}`)&&<Badge color="blue">In draft PO</Badge>}
                  </div>
                </td>
                <td style={{...tdS,fontFamily:"monospace",whiteSpace:"nowrap"}}>{r.on_hand} on hand{r.allocated_qty>0&&<div style={{color:C.textLight}}>{r.allocated_qty} reserved</div>}{r.on_order>0&&<div style={{color:C.textLight}}>{r.on_order} on order</div>}</td>
                <td style={{...tdS,whiteSpace:"nowrap"}}>{r.demand_by_source.manufacturing>0&&<div>🏭 {r.demand_by_source.manufacturing} build</div>}{r.demand_by_source.maintenance>0&&<div>🔧 {r.demand_by_source.maintenance} maint.</div>}
                  <div style={{fontSize:10,color:C.textLight}}>{r.demand_by_firmness.firm} firm · {r.demand_by_firmness.tentative} tent.</div></td>
                <td style={{...tdS,fontFamily:"monospace",whiteSpace:"nowrap"}}>
                  <div style={{fontWeight:700,fontSize:15,color:C.navy}}>{r.firm_order_qty}</div>
                  {r.tentative_order_qty>0&&<div style={{color:C.textLight}}>+{r.tentative_order_qty} tentative</div>}
                  {r.order_qty===0&&<div style={{color:C.red,fontSize:10}}>no new order</div>}
                </td>
                <td style={{...tdS,whiteSpace:"nowrap"}}><div style={{fontWeight:700,color:r.urgency==="late"?C.red:C.navy}}>{fmtDate(date)}</div><div style={{fontSize:10,color:C.textLight}}>{dueText(diffDaysLocal(date))}</div></td>
                <td style={{...tdS,whiteSpace:"nowrap"}}>{fmtDate(r.need_by)}</td>
                <td style={tdS}>{sup?<div style={{fontWeight:600,color:C.navy}}>{sup.name}</div>:<span style={{color:C.red}}>—</span>}{bk&&<div style={{fontSize:10,color:C.textLight}}>backup: {bk.name}</div>}<div style={{fontSize:10,color:C.textLight}}>{r.lead_days}d lead</div></td>
                <td style={{...tdS,fontFamily:"monospace",whiteSpace:"nowrap"}}>{money(r.firm_ext_cost)}{r.tentative_ext_cost>0&&<div style={{color:C.textLight}}>+{money(r.tentative_ext_cost)}</div>}</td>
                <td style={tdS}><button title="Procurement settings" onClick={()=>setSettingsPart(parts.find(p=>p.id===r.part_id))} style={{border:`1px solid ${C.border}`,background:C.white,borderRadius:5,cursor:"pointer",padding:"4px 8px"}}>⚙</button></td>
              </tr>;
            })}
            {shownRecs.length===0&&<tr><td colSpan={10} style={{...tdS,textAlign:"center",padding:36,color:C.textLight}}>{hasDemandData?"Nothing needs ordering within the look-ahead window. 🎉":"No demand to forecast yet."}</td></tr>}
          </tbody>
        </table>
      </div>
      <div style={{fontSize:11,color:C.textLight,marginTop:8}}>Order qty = firm demand (lists final or later, and maintenance POs). Tentative adds demand from signed POs whose lists are not final. Stock reserved for released/staged vessels is held back.</div>
    </div>}

    {view==="pos"&&<div>
      <SectionTitle>Ready to order — firm demand</SectionTitle>
      {result.purchaseOrders.length===0&&<div style={{textAlign:"center",padding:30,color:C.textLight}}>No firm orders are needed right now.</div>}
      {result.purchaseOrders.map(g=><PoGroupCard key={g.supplier_id} g={g} supplier={supplierOf(g.supplier_id)} parts={parts} draftKeys={draftKeys} canCreate busy={busy} onCreate={()=>createPo(g)}/>)}
      {showTentative&&<>
        <div style={{marginTop:22}}><SectionTitle>Preview — tentative demand (lists not final)</SectionTitle></div>
        {result.tentativePurchaseOrders.length===0&&<div style={{textAlign:"center",padding:30,color:C.textLight}}>No tentative orders.</div>}
        {result.tentativePurchaseOrders.map(g=><PoGroupCard key={"t"+g.supplier_id} g={g} supplier={supplierOf(g.supplier_id)} parts={parts} draftKeys={draftKeys} tentative/>)}
      </>}
    </div>}

    {view==="items"&&<div>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search part no., old no. or description…" style={{...inputStyle,width:"100%",marginBottom:10}}/>
      <div style={{overflowX:"auto",border:`1.5px solid ${C.border}`,borderRadius:8,background:C.white}}>
        <table style={{width:"100%",borderCollapse:"collapse",minWidth:760}}>
          <thead><tr>{["Part","Policy","Preferred supplier","Lead","MOQ / pack","Service","Usage / mo",""].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
          <tbody>{itemRows.slice(0,60).map(p=>{
            const pr=procurement.find(x=>x.part_id===p.id);
            return <tr key={p.id}>
              <td style={tdS}><div style={{fontFamily:"monospace",fontWeight:700,color:C.amber}}>{p.id}</div><div style={{color:C.textMid,maxWidth:260}}>{p.description}</div>{(p.suppliers||[]).length===0&&<Badge color="red">No supplier</Badge>}</td>
              <td style={tdS}>{POLICY_INFO[pr?.policy||"order_driven"][0]}{!pr&&<div style={{fontSize:10,color:C.textLight}}>default</div>}</td>
              <td style={tdS}>{pr?.preferred_supplier_id?suppliers.find(s=>s.id===pr.preferred_supplier_id)?.name:<span style={{color:C.textLight}}>cheapest</span>}</td>
              <td style={{...tdS,fontFamily:"monospace"}}>{pr?.lead_time_days??p.suppliers?.[0]?.leadDays??"—"}d</td>
              <td style={{...tdS,fontFamily:"monospace"}}>{pr?.moq??1} / {pr?.order_multiple??1}</td>
              <td style={{...tdS,fontFamily:"monospace"}}>{Math.round((pr?.service_level??0.95)*1000)/10}%</td>
              <td style={{...tdS,fontFamily:"monospace"}}>{pr?.manual_monthly_usage??0}</td>
              <td style={tdS}><Btn variant="outline" style={{padding:"4px 10px",fontSize:11}} onClick={()=>setSettingsPart(p)}>Edit</Btn></td>
            </tr>;})}
          </tbody>
        </table>
      </div>
      {itemRows.length>60&&<div style={{fontSize:11,color:C.textLight,marginTop:8}}>Showing the first 60 of {itemRows.length}. Items with settings or demand are listed first; search to find others.</div>}
    </div>}

    {settingsPart&&<ItemSettingsModal part={settingsPart} procurement={procurement} suppliers={suppliers} actions={actions} onClose={()=>setSettingsPart(null)}/>}
  </div>;
}
const diffDaysLocal=(d)=>Math.round((new Date(d+"T00:00:00")-new Date(localToday()+"T00:00:00"))/86400000);

// ─── Purchase Orders Tab ─────────────────────────────────────────────────────
function PoDetailModal({ po, lines, supplier, parts, actions, onClose }) {
  const [f,setF]=useState({order_date:po.order_date||"",expected_date:po.expected_date||"",notes:po.notes||""});
  const [recv,setRecv]=useState({});
  const [busy,run]=useRun();
  const total=lines.reduce((s,l)=>s+(l.unit_cost!=null?l.qty*l.unit_cost:0),0);
  const canReceive=["Sent","Partially Received"].includes(po.status);
  const out=(l)=>Math.max((+l.qty)-(+l.qty_received||0),0);
  const dirty=f.order_date!==(po.order_date||"")||f.expected_date!==(po.expected_date||"")||f.notes!==(po.notes||"");
  const fields=()=>({order_date:f.order_date||null,expected_date:f.expected_date||null,notes:f.notes||null});
  const csv=()=>downloadCsv(`${po.id}.csv`,[["PO","Supplier","SKU","Supplier part no","Description","Ordered","Received","Unit cost","Needed by"],
    ...lines.map(l=>[po.id,supplier?.name||"",l.part_id,l.mfg_part_no||"",parts.find(p=>p.id===l.part_id)?.description||"",l.qty,l.qty_received,l.unit_cost??"",l.needed_by||""])]);
  return <Modal title={po.id} onClose={onClose}>
    <div style={{display:"grid",gap:14}}>
      <div style={{display:"flex",justifyContent:"space-between",gap:10,flexWrap:"wrap",alignItems:"center"}}>
        <div><div style={{fontWeight:800,fontSize:15,color:C.navy}}>{supplier?.name||po.supplier_id||"No supplier"}</div>
          <div style={{fontSize:11,color:C.textLight}}>{supplier?.contact} {supplier?.phone&&`· ${supplier.phone}`}</div></div>
        <div style={{textAlign:"right"}}><Badge color={poStatusColor(po.status)}>{po.status}</Badge><div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:C.navy,marginTop:4}}>{money(total)}</div></div>
      </div>
      <div style={{background:C.offWhite,borderRadius:8,padding:12,display:"grid",gap:10}}>
        <div style={{display:"grid",gridTemplateColumns:"minmax(0,1fr) minmax(0,1fr)",gap:10}}>
          <Field label="Order date"><input type="date" value={f.order_date} onChange={e=>setF(p=>({...p,order_date:e.target.value}))} style={inputStyle}/></Field>
          <Field label="Expected delivery"><input type="date" value={f.expected_date} onChange={e=>setF(p=>({...p,expected_date:e.target.value}))} style={inputStyle}/></Field>
        </div>
        <Input label="Notes" value={f.notes} onChange={e=>setF(p=>({...p,notes:e.target.value}))}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",flexWrap:"wrap"}}>
          {po.status==="Draft"&&<Btn variant="danger" disabled={busy} onClick={()=>{if(window.confirm(`Delete draft ${po.id}?`))run(async()=>{await actions.deletePurchaseOrder(po.id);onClose();});}}>Delete draft</Btn>}
          {["Sent","Partially Received"].includes(po.status)&&<Btn variant="danger" disabled={busy} onClick={()=>{if(window.confirm(`Cancel ${po.id}? Quantities already received stay in stock.`))run(()=>actions.updatePurchaseOrder(po.id,{status:"Cancelled"}));}}>Cancel PO</Btn>}
          <Btn variant="outline" disabled={!dirty||busy} onClick={()=>run(()=>actions.updatePurchaseOrder(po.id,fields()))}>Save details</Btn>
          {po.status==="Draft"&&<Btn disabled={!f.expected_date||busy} onClick={()=>run(()=>actions.updatePurchaseOrder(po.id,{...fields(),order_date:f.order_date||localToday(),status:"Sent"}))}>Mark as sent</Btn>}
        </div>
        {po.status==="Draft"&&!f.expected_date&&<div style={{fontSize:11,color:C.warnText}}>Set the expected delivery date to mark this PO as sent. The forecast uses it to net open orders against demand.</div>}
      </div>
      <SectionTitle>Lines</SectionTitle>
      <div style={{overflowX:"auto"}}><table style={{width:"100%",borderCollapse:"collapse",minWidth:520}}>
        <thead><tr>{["SKU","Ordered","Received","Unit","Receive"].map(h=><th key={h} style={thS}>{h}</th>)}</tr></thead>
        <tbody>{lines.map(l=>{
          const o=out(l);
          return <tr key={l.id}>
            <td style={tdS}><div style={{fontFamily:"monospace",fontWeight:700,color:C.amber}}>{l.part_id}</div><div style={{color:C.textMid}}>{parts.find(p=>p.id===l.part_id)?.description}</div>{l.mfg_part_no&&<div style={{fontSize:10,color:C.textLight,fontFamily:"monospace"}}>{l.mfg_part_no}</div>}</td>
            <td style={{...tdS,fontFamily:"monospace",fontWeight:700}}>{l.qty}</td>
            <td style={{...tdS,fontFamily:"monospace",color:o===0?C.greenText:C.navy}}>{l.qty_received}{o>0&&<span style={{color:C.textLight}}> ({o} due)</span>}</td>
            <td style={{...tdS,fontFamily:"monospace"}}>{money(l.unit_cost)}</td>
            <td style={tdS}>{canReceive&&o>0
              ? <div style={{display:"flex",gap:6}}>
                  <input type="number" min="1" max={o} value={recv[l.id]??o} onChange={e=>setRecv(r=>({...r,[l.id]:e.target.value}))} style={{...inputStyle,width:64,padding:"4px 6px",fontFamily:"monospace"}}/>
                  <Btn variant="outline" style={{padding:"4px 10px",fontSize:11}} disabled={busy} onClick={()=>run(()=>actions.receivePoLine(po,l,recv[l.id]??o))}>Receive</Btn>
                </div>
              : <span style={{fontSize:11,color:C.textLight}}>{o===0?"✓ complete":"—"}</span>}</td>
          </tr>;
        })}</tbody>
      </table></div>
      <div style={{display:"flex",gap:8,justifyContent:"space-between",flexWrap:"wrap"}}>
        <div style={{display:"flex",gap:8}}>
          <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={csv}>⬇ CSV</Btn>
          <Btn variant="outline" style={{padding:"6px 12px",fontSize:12}} onClick={()=>printPurchaseOrder({po,supplier,lines,parts})}>🖨 Print</Btn>
        </div>
        {canReceive&&lines.some(l=>out(l)>0)&&<Btn disabled={busy} onClick={()=>{if(window.confirm("Receive every outstanding line in full into stock?"))run(async()=>{for(const l of lines){const o=out(l);if(o>0)await actions.receivePoLine(po,l,o);}});}}>📥 Receive all outstanding</Btn>}
      </div>
      {canReceive&&<div style={{fontSize:11,color:C.textLight}}>Receiving adds to on-hand stock and to this supplier's stock, and is recorded in the Audit Log.</div>}
    </div>
  </Modal>;
}

function PurchaseOrdersTab({ purchaseOrders, poLines, suppliers, parts, actions }) {
  const [status,setStatus]=useState("open");
  const [search,setSearch]=useState("");
  const [openId,setOpenId]=useState(null);
  const supplierOf=(id)=>suppliers.find(s=>s.id===id);
  const totalOf=(id)=>poLines.filter(l=>l.po_id===id).reduce((s,l)=>s+(l.unit_cost!=null?l.qty*l.unit_cost:0),0);
  const shown=purchaseOrders.filter(p=>(status==="all"||(status==="open"?["Draft","Sent","Partially Received"].includes(p.status):p.status===status))
    && `${p.id} ${supplierOf(p.supplier_id)?.name||""}`.toLowerCase().includes(search.toLowerCase()));
  const open=purchaseOrders.find(p=>p.id===openId);
  return <div>
    <div style={{display:"flex",gap:10,marginBottom:14,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search PO number or supplier…" style={{...inputStyle,flex:"1 1 220px"}}/>
      <select value={status} onChange={e=>setStatus(e.target.value)} style={inputStyle}>
        <option value="open">Open (draft / sent / partial)</option><option value="all">All</option>{PO_STATUSES.map(s=><option key={s} value={s}>{s}</option>)}
      </select>
    </div>
    <div style={{display:"grid",gap:10}}>
      {shown.map(p=>{
        const ls=poLines.filter(l=>l.po_id===p.id); const recd=ls.reduce((s,l)=>s+(+l.qty_received||0),0); const ord=ls.reduce((s,l)=>s+(+l.qty),0);
        return <div key={p.id} onClick={()=>setOpenId(p.id)} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px",cursor:"pointer"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;}} onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;}}>
          <div style={{display:"flex",justifyContent:"space-between",gap:8,flexWrap:"wrap"}}>
            <div>
              <div style={{display:"flex",gap:8,alignItems:"center",flexWrap:"wrap",marginBottom:4}}><span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.navy}}>{p.id}</span><Badge color={poStatusColor(p.status)}>{p.status}</Badge></div>
              <div style={{fontSize:13,fontWeight:600,color:C.navy}}>{supplierOf(p.supplier_id)?.name||p.supplier_id||"No supplier"}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:2}}>{ls.length} line(s) · ordered {fmtDate(p.order_date)} · expected {fmtDate(p.expected_date)}</div>
            </div>
            <div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:C.navy}}>{money(totalOf(p.id))}</div><div style={{fontSize:11,color:C.textLight}}>{recd}/{ord} received</div></div>
          </div>
        </div>;
      })}
      {shown.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No purchase orders. Create a draft from the Replenishment tab.</div>}
    </div>
    {open&&<PoDetailModal po={open} lines={poLines.filter(l=>l.po_id===open.id)} supplier={supplierOf(open.supplier_id)} parts={parts} actions={actions} onClose={()=>setOpenId(null)}/>}
  </div>;
}

// ═══ REPLENISHMENT UI END ═════════════════════════════════════════════════════

// ─── App Shell ────────────────────────────────────────────────────────────────
const TAB_META={
  scan:{label:"Scan",icon:"📷"}, inventory:{label:"Inventory",icon:"📦"}, parts:{label:"Parts Catalog",icon:"🔩"}, binlabels:{label:"Bin Labels",icon:"🖨️"},
  orders:{label:"Orders",icon:"📑"}, lp:{label:"License Plates",icon:"🏷️"}, controllists:{label:"Control Lists",icon:"🧾"}, customers:{label:"Customers",icon:"🏢"},
  replenish:{label:"Replenishment",icon:"📈"}, pos:{label:"Purchase Orders",icon:"🛒"}, suppliers:{label:"Suppliers",icon:"🏭"},
  audit:{label:"Audit Log",icon:"📋"}, users:{label:"Users",icon:"👥"},
};
function useIsPhone(){
  const q="(max-width: 719px)";
  const [m,setM]=useState(()=>typeof window!=="undefined"&&!!window.matchMedia?.(q).matches);
  useEffect(()=>{ const mq=window.matchMedia?.(q); if(!mq) return; const f=e=>setM(e.matches); mq.addEventListener?.("change",f); return ()=>mq.removeEventListener?.("change",f); },[]);
  return m;
}
function MainApp({ user, onSignOut }) {
  // The open tab lives in the URL (#lp, #orders…) so refresh keeps your place and Back works.
  const [tab,setTabRaw]=useState(()=>{ const h=(window.location.hash||"").slice(1); return TAB_META[h]?h:"scan"; });
  const setTab=(t)=>{ if(!TAB_META[t]) return; setTabRaw(t); try{ if(window.location.hash!=="#"+t) window.history.pushState(null,"","#"+t); }catch(_){ } window.scrollTo(0,0); };
  useEffect(()=>{ const f=()=>{ const h=(window.location.hash||"").slice(1); if(TAB_META[h]) setTabRaw(h); }; window.addEventListener("popstate",f); return ()=>window.removeEventListener("popstate",f); },[]);
  const isPhone=useIsPhone();
  const [menuOpen,setMenuOpen]=useState(false);
  const lastTabRef=useRef({});
  const [lpFocus,setLpFocus]=useState(null);       // {id, pick} — open an LP from another tab
  const [orderFocus,setOrderFocus]=useState(null); // {id} — open an order from another tab
  const openLp=(id,pick=false)=>{ setLpFocus({id,pick}); setTab("lp"); };
  const openOrder=(id)=>{ setOrderFocus({id}); setTab("orders"); };
  const {fabricators,parts,suppliers,lps,mfgBarcodes,supplierStock,packingSlipTypes,customers,
    vesselModels,controlLines,orders,orderLines,packingLines,maintKits,kitLines,maintLines,procurement,purchaseOrders,poLines,
    loading,error,actions}=useData();
  const replen=useReplenishmentForecast({parts,procurement,controlLines,packingSlipTypes,purchaseOrders,poLines,kitLines,orderLines,maintLines,orders});
  const alerts=replen.toOrderNow;   // parts to order now: same count as Replenishment's Late + Order soon
  const [isAdmin,setIsAdmin]=useState(user?.app_metadata?.role==="admin");
  useEffect(()=>{ if(tab==="users"&&!isAdmin) setTabRaw("scan"); },[tab,isAdmin]);   // #users link opened by a non-admin
  useEffect(()=>{ // re-read from server so admin changes apply without signing out
    _sb.auth.getUser().then(({data})=>{ if(data?.user) setIsAdmin(data.user.app_metadata?.role==="admin"); });
  },[]);
  // ── Navigation: 4 sections, each with its own tabs. Phones get a bottom bar. ──
  const SECTIONS=[
    {id:"warehouse",label:"Warehouse",icon:"📦",tabs:["scan","inventory","parts","binlabels"]},
    {id:"shipping",label:"Orders",full:"Orders & Shipping",icon:"🚚",tabs:["orders","lp","controllists","customers"]},
    {id:"purchasing",label:"Purchasing",icon:"🛒",tabs:["replenish","pos","suppliers"]},
    {id:"admin",label:isAdmin?"Admin":"Activity",icon:isAdmin?"⚙️":"📋",tabs:["audit",...(isAdmin?["users"]:[])]},
  ];
  const sectionOf=t=>SECTIONS.find(s=>s.tabs.includes(t))||SECTIONS[0];
  const section=sectionOf(tab);
  lastTabRef.current[section.id]=tab;
  const lpProblems=lps.filter(l=>l.status!=="Cancelled"&&(l.items||[]).some(i=>i.issue&&!i.issue.resolved_at)).length;
  const tabBadge={replenish:alerts?{n:alerts,bg:C.amber,fg:C.navy}:null, lp:lpProblems?{n:lpProblems,bg:C.red,fg:"#fff"}:null};
  const sectionBadge=s=>{ const b=s.tabs.map(t=>tabBadge[t]).filter(Boolean); return b.length?{n:b.reduce((a,x)=>a+x.n,0),bg:b.some(x=>x.bg===C.red)?C.red:C.amber,fg:b.some(x=>x.bg===C.red)?"#fff":C.navy}:null; };
  const pill=b=>b?<span style={{background:b.bg,color:b.fg,borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:800,lineHeight:"14px"}}>{b.n}</span>:null;
  const goSection=s=>setTab(lastTabRef.current[s.id]&&s.tabs.includes(lastTabRef.current[s.id])?lastTabRef.current[s.id]:s.tabs[0]);
  const subTabs=section.tabs.length>1&&<div style={{display:"flex",gap:isPhone?6:0,overflowX:"auto",WebkitOverflowScrolling:"touch",...(isPhone?{padding:"8px 12px",background:C.white,borderBottom:`1px solid ${C.border}`}:{})}}>
    {section.tabs.map(id=>{ const t=TAB_META[id]; const on=tab===id;
      return isPhone
        ? <button key={id} onClick={()=>setTab(id)} style={{flexShrink:0,minHeight:36,padding:"0 12px",borderRadius:18,border:`1.5px solid ${on?C.navy:C.border}`,background:on?C.navy:C.white,color:on?"#fff":C.navy,fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:5,cursor:"pointer",whiteSpace:"nowrap"}}>{t.icon} {t.label}{pill(tabBadge[id])}</button>
        : <button key={id} onClick={()=>setTab(id)} style={{background:"none",border:"none",cursor:"pointer",padding:"11px 16px",fontSize:12,fontWeight:700,
            color:on?C.amber:"#8A9BB0",borderBottom:on?`3px solid ${C.amber}`:"3px solid transparent",display:"flex",alignItems:"center",gap:5,whiteSpace:"nowrap",letterSpacing:.2}}>{t.icon} {t.label}{pill(tabBadge[id])}</button>; })}
  </div>;
  const accountMenu=<div style={{position:"relative"}}>
    <button onClick={()=>setMenuOpen(v=>!v)} aria-label="Account" style={{background:"rgba(255,255,255,.08)",border:"1px solid rgba(255,255,255,.2)",color:"#fff",borderRadius:18,minHeight:36,padding:"0 12px",fontSize:12,fontWeight:700,cursor:"pointer",display:"flex",alignItems:"center",gap:6,maxWidth:isPhone?44:220}}>
      <span>👤</span>{!isPhone&&<span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:C.amber}}>{user?.email}</span>}
    </button>
    {menuOpen&&<>
      <div onClick={()=>setMenuOpen(false)} style={{position:"fixed",inset:0,zIndex:950}}/>
      <div style={{position:"absolute",right:0,top:"calc(100% + 6px)",zIndex:951,background:C.white,borderRadius:8,boxShadow:"0 12px 32px rgba(0,0,0,.25)",minWidth:230,overflow:"hidden",border:`1px solid ${C.border}`}}>
        <div style={{padding:"12px 14px",borderBottom:`1px solid ${C.border}`}}>
          <div style={{fontSize:11,color:C.textLight}}>Signed in as</div>
          <div style={{fontSize:13,fontWeight:700,color:C.navy,overflowWrap:"anywhere"}}>{user?.email}</div>
          <div style={{fontSize:11,color:C.textLight,marginTop:2}}>{isAdmin?"Administrator":"Staff"} · {loading?"Syncing…":"🟢 Live"}</div>
        </div>
        <button onClick={()=>{setMenuOpen(false);onSignOut();}} style={{display:"block",width:"100%",textAlign:"left",padding:"12px 14px",minHeight:44,background:"none",border:"none",fontSize:14,fontWeight:600,color:C.navy,cursor:"pointer"}}>Sign out</button>
        {isAdmin&&<button onClick={()=>{ setMenuOpen(false);
            if(window.confirm("Disconnect this device from the database?\n\nThe app will ask for the Supabase URL and key again. Only do this to switch databases."))
              { clearConfig(); window.location.reload(); } }}
          style={{display:"block",width:"100%",textAlign:"left",padding:"12px 14px",minHeight:44,background:"none",border:"none",borderTop:`1px solid ${C.border}`,fontSize:13,color:C.red,cursor:"pointer"}}>⚙ Disconnect database…</button>}
      </div>
    </>}
  </div>;
  return (
    <div style={{minHeight:"100vh",background:C.offWhite}}>
      <div style={{background:C.navy,borderBottom:`4px solid ${C.amber}`,position:isPhone?"sticky":"static",top:0,zIndex:900}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:isPhone?"0 12px":"0 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:10,padding:isPhone?"8px 0":"14px 0",borderBottom:isPhone?"none":`1px solid rgba(255,255,255,.1)`}}>
            <div style={{display:"flex",alignItems:"center",minWidth:0}}>
              <div style={{background:C.amber,width:5,height:isPhone?28:36,borderRadius:2,marginRight:10,flexShrink:0}}/>
              <div style={{minWidth:0}}><div style={{fontSize:isPhone?17:20,fontWeight:900,color:C.white,letterSpacing:-.3,lineHeight:1.1}}>ChlorTainer</div>
                <div style={{fontSize:isPhone?9:10,fontWeight:700,color:C.amber,letterSpacing:2.5,textTransform:"uppercase",whiteSpace:"nowrap"}}>{isPhone?(TAB_META[tab]?.label||"Inventory"):"Inventory System"}</div></div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:8}}>
              {!isPhone&&(loading?<span style={{fontSize:11,color:C.textLight}}>Syncing…</span>
                :<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.greenText,background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:12,padding:"3px 10px",fontWeight:700}}>🟢 Live</div>)}
              {alerts>0&&<button onClick={()=>setTab("replenish")} title="Parts to order now (Replenishment: Late + Order soon)" style={{background:C.amber,color:C.navy,border:"none",cursor:"pointer",borderRadius:20,minHeight:32,padding:"0 12px",fontSize:12,fontWeight:800,whiteSpace:"nowrap"}}>⚠ {alerts}{isPhone?"":" to order"}</button>}
              {accountMenu}
            </div>
          </div>
          {!isPhone&&<>
            <div style={{display:"flex",gap:6,padding:"10px 0 0"}}>
              {SECTIONS.map(s=>{ const on=s.id===section.id;
                return <button key={s.id} onClick={()=>goSection(s)} style={{border:"none",cursor:"pointer",borderRadius:"6px 6px 0 0",padding:"8px 16px",fontSize:13,fontWeight:800,letterSpacing:.2,
                  background:on?"rgba(255,255,255,.1)":"transparent",color:on?"#fff":"#8A9BB0",display:"flex",alignItems:"center",gap:6}}>{s.icon} {s.full||s.label}{!on&&pill(sectionBadge(s))}</button>; })}
            </div>
            <div style={{background:"rgba(255,255,255,.06)",borderRadius:"0 6px 0 0",marginBottom:0}}>{subTabs||<div style={{height:8}}/>}</div>
          </>}
        </div>
        {isPhone&&subTabs}
      </div>
      <div style={{maxWidth:960,margin:"0 auto",padding:isPhone?"14px 12px calc(96px + env(safe-area-inset-bottom))":"24px 20px"}}>
        {!isPhone&&<div style={{fontSize:12,color:C.textLight,marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
          <span style={{color:C.amber,fontWeight:700}}>{section.full||section.label}</span><span>›</span>
          <span>{TAB_META[tab]?.label}</span>
        </div>}
        {error&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:8,padding:"14px 18px",marginBottom:16,color:C.red,fontSize:13}}>❌ {error}</div>}
        {loading?<Spinner text="Loading from Supabase…"/>
          :tab==="scan"?<ScanTab purchaseOrders={purchaseOrders} poLines={poLines} replenByPart={replen.byPart} parts={parts} suppliers={suppliers} lps={lps} mfgBarcodes={mfgBarcodes} actions={actions}/>
          :tab==="parts"?<PartsTab replenByPart={replen.byPart} parts={parts} suppliers={suppliers} mfgBarcodes={mfgBarcodes} supplierStock={supplierStock} actions={actions}/>
          :tab==="suppliers"?<SuppliersTab suppliers={suppliers} parts={parts} actions={actions}/>
          :tab==="customers"?<CustomersTab customers={customers} lps={lps} actions={actions}/>
          :tab==="inventory"?<InventoryTab parts={parts} suppliers={suppliers} replen={replen} onOpenReplenishment={()=>setTab("replenish")}/>
          :tab==="lp"?<LicensePlatesTab fabricators={fabricators} lps={lps} parts={parts} customers={customers} packingSlipTypes={packingSlipTypes} mfgBarcodes={mfgBarcodes} actions={actions} focus={lpFocus} onFocusDone={()=>setLpFocus(null)} onOpenOrder={openOrder}/>
          :tab==="binlabels"?<BinLabelsTab parts={parts} ui={{C,Btn,Input,Sel,SectionTitle}}/>
          :tab==="orders"?<OrdersTab packingLines={packingLines} packingSlipTypes={packingSlipTypes} lps={lps} orders={orders} orderLines={orderLines} maintLines={maintLines} customers={customers} vesselModels={vesselModels} controlLines={controlLines} maintKits={maintKits} kitLines={kitLines} parts={parts} actions={actions} focus={orderFocus} onFocusDone={()=>setOrderFocus(null)} onOpenLp={openLp}/>
          :tab==="controllists"?<ControlListsTab vesselModels={vesselModels} controlLines={controlLines} maintKits={maintKits} kitLines={kitLines} parts={parts} packingSlipTypes={packingSlipTypes} actions={actions}/>
          :tab==="replenish"?<ReplenishmentTab parts={parts} suppliers={suppliers} orders={orders} orderLines={orderLines} controlLines={controlLines} packingSlipTypes={packingSlipTypes} maintLines={maintLines} kitLines={kitLines} procurement={procurement} purchaseOrders={purchaseOrders} poLines={poLines} actions={actions}/>
          :tab==="pos"?<PurchaseOrdersTab purchaseOrders={purchaseOrders} poLines={poLines} suppliers={suppliers} parts={parts} actions={actions}/>
          :tab==="audit"?<AuditLogTab/>
          :tab==="users"&&isAdmin?<UsersTab currentUserId={user?.id}/>
          :null}
      </div>
      {!isPhone&&<div style={{borderTop:`1px solid ${C.border}`,padding:"14px 20px",textAlign:"center",background:C.white}}>
        <span style={{fontSize:11,color:C.textLight}}>© 2026 TGO Technologies, Inc. — ChlorTainer Inventory System · Keeping Operators Safe. Protecting Our Communities.</span>
      </div>}
      {isPhone&&<nav style={{position:"fixed",left:0,right:0,bottom:0,zIndex:900,background:C.white,borderTop:`1px solid ${C.border}`,boxShadow:"0 -4px 16px rgba(28,43,58,.08)",
          display:"grid",gridTemplateColumns:`repeat(${SECTIONS.length},minmax(0,1fr))`,paddingBottom:"env(safe-area-inset-bottom)"}}>
        {SECTIONS.map(s=>{ const on=s.id===section.id; const b=sectionBadge(s);
          return <button key={s.id} onClick={()=>goSection(s)} aria-current={on?"page":undefined} style={{position:"relative",minHeight:60,border:"none",background:"none",cursor:"pointer",
            display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:2,color:on?C.navy:C.textLight,fontWeight:on?800:600,fontSize:11,
            borderTop:`3px solid ${on?C.amber:"transparent"}`}}>
            <span style={{fontSize:22,lineHeight:"24px",filter:on?"none":"grayscale(.6)",opacity:on?1:.75}}>{s.icon}</span>{s.label}
            {b&&<span style={{position:"absolute",top:6,left:"calc(50% + 8px)",background:b.bg,color:b.fg,borderRadius:10,padding:"0 6px",fontSize:10,fontWeight:800,lineHeight:"16px"}}>{b.n}</span>}
          </button>; })}
      </nav>}
    </div>
  );
}

// ─── Users Tab (admin only) ───────────────────────────────────────────────────
async function callManageUsers(body){
  const {data,error}=await _sb.functions.invoke("manage-users",{body});
  if(error){
    let msg=error.message;
    try{ const j=await error.context.json(); if(j?.error) msg=j.error; }catch(_){}
    throw new Error(msg);
  }
  if(data?.error) throw new Error(data.error);
  return data;
}

function UsersTab({ currentUserId }) {
  const [users,setUsers]=useState([]);
  const [loading,setLoading]=useState(true);
  const [email,setEmail]=useState("");
  const [role,setRole]=useState("staff");
  const [fabId,setFabId]=useState("");
  const [fabs,setFabs]=useState([]);
  const [busy,setBusy]=useState(false);
  const [msg,setMsg]=useState(null); // {type:"ok"|"err", text}

  async function load(){
    setLoading(true);
    try{ const d=await callManageUsers({action:"list"}); setUsers(d.users||[]); }
    catch(e){ setMsg({type:"err",text:e.message}); }
    setLoading(false);
  }
  useEffect(()=>{ load(); _sb.from("fabricators").select("*").eq("active",true).order("name").then(({data})=>setFabs(data||[])); },[]);
  const fabName=id=>fabs.find(f=>f.id===id)?.name||id;

  async function changeRole(u,newRole,newFab){
    if(newRole==="fabricator"&&!newFab){ setMsg({type:"err",text:"Choose the fabricator company first."}); return; }
    if(!window.confirm(`Change ${u.email} to ${newRole==="fabricator"?"Fabricator ("+fabName(newFab)+")":newRole==="admin"?"Admin":"Staff"}?`)) return;
    setBusy(true); setMsg(null);
    try{ await callManageUsers({action:"set_role",userId:u.id,role:newRole,fabricatorId:newFab||undefined}); await load(); }
    catch(e){ setMsg({type:"err",text:e.message}); }
    setBusy(false);
  }

  async function invite(){
    const addr=email.trim().toLowerCase();
    if(!addr) return;
    if(role==="fabricator"&&!fabId){ setMsg({type:"err",text:"Choose the fabricator company."}); return; }
    setBusy(true); setMsg(null);
    try{
      await callManageUsers({action:"invite",email:addr,role,fabricatorId:role==="fabricator"?fabId:undefined,redirectTo:window.location.origin});
      setMsg({type:"ok",text:`Invitation sent to ${addr}. They'll get an email with a sign-in link.`});
      setEmail(""); setRole("staff"); setFabId("");
      await load();
    }catch(e){ setMsg({type:"err",text:e.message}); }
    setBusy(false);
  }

  async function toggleAdmin(u){
    const verb=u.isAdmin?"Remove admin rights from":"Make admin:";
    if(!window.confirm(`${verb} ${u.email}?`)) return;
    setBusy(true); setMsg(null);
    try{ await callManageUsers({action:"set_admin",userId:u.id,isAdmin:!u.isAdmin}); await load(); }
    catch(e){ setMsg({type:"err",text:e.message}); }
    setBusy(false);
  }

  async function remove(u){
    if(!window.confirm(`Remove ${u.email}? They will no longer be able to sign in.`)) return;
    setBusy(true); setMsg(null);
    try{ await callManageUsers({action:"remove",userId:u.id}); setMsg({type:"ok",text:`${u.email} removed.`}); await load(); }
    catch(e){ setMsg({type:"err",text:e.message}); }
    setBusy(false);
  }

  const fmt=d=>d?new Date(d).toLocaleDateString(undefined,{month:"short",day:"numeric",year:"numeric"}):null;
  const card={background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:20,marginBottom:20};

  return (
    <div>
      <div style={card}>
        <SectionTitle>Add User</SectionTitle>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"flex-end"}}>
          <div style={{flex:"1 1 240px"}}>
            <Field label="Email">
              <input type="email" value={email} onChange={e=>setEmail(e.target.value)}
                onKeyDown={e=>e.key==="Enter"&&invite()} placeholder="name@company.com"
                style={{...inputStyle,width:"100%"}}/>
            </Field>
          </div>
          <Btn variant="navy" onClick={invite} disabled={!email.trim()||busy}>{busy?"Working…":"✉ Send Invite"}</Btn>
        </div>
        <div style={{display:"flex",gap:10,flexWrap:"wrap",marginTop:12,alignItems:"center",fontSize:13,color:C.textMid}}>
          <span>Access:</span>
          <select value={role} onChange={e=>setRole(e.target.value)} style={{...inputStyle,padding:"4px 8px"}}>
            <option value="staff">TGO staff (full app)</option>
            <option value="admin">Admin (full app + users)</option>
            <option value="fabricator">Fabricator (checklist only)</option>
          </select>
          {role==="fabricator"&&<select value={fabId} onChange={e=>setFabId(e.target.value)} style={{...inputStyle,padding:"4px 8px"}}>
            <option value="">— company —</option>
            {fabs.map(f=><option key={f.id} value={f.id}>{f.name}</option>)}
          </select>}
        </div>
        {msg&&<div style={{marginTop:14,borderRadius:6,padding:"10px 14px",fontSize:13,
          background:msg.type==="ok"?C.greenBg:C.redLight,border:`1px solid ${msg.type==="ok"?C.greenBdr:C.redBorder}`,
          color:msg.type==="ok"?C.greenText:C.red}}>{msg.type==="ok"?"✅":"❌"} {msg.text}</div>}
      </div>

      <div style={card}>
        <SectionTitle>Users ({users.length})</SectionTitle>
        {loading?<Spinner text="Loading users…"/>:
          <div style={{display:"grid",gap:10}}>
            {users.map(u=>{
              const self=u.id===currentUserId;
              return (
                <div key={u.id} style={{border:`1px solid ${C.border}`,borderRadius:6,padding:"12px 14px",display:"flex",flexWrap:"wrap",gap:10,alignItems:"center",justifyContent:"space-between"}}>
                  <div style={{minWidth:0,flex:"1 1 220px"}}>
                    <div style={{fontSize:14,fontWeight:700,color:C.navy,wordBreak:"break-all"}}>
                      {u.email} {self&&<span style={{fontSize:11,color:C.textLight,fontWeight:400}}>(you)</span>}
                    </div>
                    <div style={{display:"flex",gap:6,marginTop:6,flexWrap:"wrap",alignItems:"center"}}>
                      {u.role==="admin"&&<Badge color="amber">Admin</Badge>}
                      {u.role==="fabricator"&&<Badge color="blue">🏭 Fabricator · {fabName(u.fabricatorId)}</Badge>}
                      {u.lastSignInAt
                        ?<span style={{fontSize:11,color:C.textLight}}>Last sign-in {fmt(u.lastSignInAt)}</span>
                        :<Badge color="gray">Invited {fmt(u.invitedAt||u.createdAt)} · not signed in yet</Badge>}
                    </div>
                  </div>
                  {!self&&<div style={{display:"flex",gap:8}}>
                    {u.role!=="fabricator"&&<Btn variant="outline" onClick={()=>toggleAdmin(u)} disabled={busy} style={{padding:"6px 12px",fontSize:12}}>
                      {u.isAdmin?"Remove admin":"Make admin"}
                    </Btn>}
                    <select value="" disabled={busy} onChange={e=>{ const v=e.target.value; e.target.value=""; if(!v) return;
                        if(v==="staff"||v==="admin") changeRole(u,v); else changeRole(u,"fabricator",v); }}
                      style={{...inputStyle,padding:"4px 8px",fontSize:12}}>
                      <option value="">Change access…</option>
                      {u.role!=="staff"&&<option value="staff">→ TGO staff</option>}
                      {fabs.filter(f=>!(u.role==="fabricator"&&u.fabricatorId===f.id)).map(f=><option key={f.id} value={f.id}>→ Fabricator: {f.name}</option>)}
                    </select>
                    <Btn variant="danger" onClick={()=>remove(u)} disabled={busy} style={{padding:"6px 12px",fontSize:12}}>Remove</Btn>
                  </div>}
                </div>
              );
            })}
          </div>}
      </div>
    </div>
  );
}

// ─── Audit Log Tab ────────────────────────────────────────────────────────────
function AuditLogTab() {
  const [logs,setLogs]=useState([]);
  const [loading,setLoading]=useState(true);
  const [filterAction,setFilterAction]=useState("All");
  const [filterUser,setFilterUser]=useState("All");

  useEffect(()=>{
    (async()=>{
      const {data}=await _sb.from("audit_log").select("*").order("created_at",{ascending:false}).limit(200);
      setLogs(data||[]);
      setLoading(false);
    })();
  },[]);

  const actionLabels={
    stock_adjust:"Stock Adjust",part_add:"Part Added",supplier_add:"Supplier Added",
    supplier_link:"Supplier Linked",supplier_unlink:"Supplier Unlinked",
    lp_create:"LP Created",lp_status:"LP Status",barcode_add:"Barcode Added",barcode_remove:"Barcode Removed",
    order_create:"Order Created",order_edit:"Order Edited",order_delete:"Order Deleted",
    order_line_add:"Vessel Added",order_line_edit:"Vessel Line Edited",order_line_delete:"Vessel Line Removed",
    maint_line_add:"Maint. Line Added",maint_line_edit:"Maint. Line Edited",maint_line_delete:"Maint. Line Removed",
    vessel_model_add:"Vessel Model Added",vessel_model_edit:"Vessel Model Edited",vessel_model_delete:"Vessel Model Deleted",
    control_line_save:"Control List Line",control_line_delete:"Control List Line Removed",
    kit_add:"Kit Added",kit_edit:"Kit Edited",kit_delete:"Kit Deleted",kit_line_save:"Kit Line",kit_line_delete:"Kit Line Removed",
    list_type_edit:"Pick Time Changed",packing_list_load:"Packing List Loaded",packing_list_delete:"Packing List Removed",procurement_save:"Procurement Settings",
    po_create:"PO Created",po_status:"PO Status",po_edit:"PO Edited",po_delete:"PO Deleted",
  };
  const actionColors={
    stock_adjust:"green",part_add:"blue",supplier_add:"blue",supplier_link:"navy",
    supplier_unlink:"red",lp_create:"amber",lp_status:"amber",barcode_add:"navy",barcode_remove:"red",
    order_create:"blue",order_edit:"blue",order_delete:"red",order_line_add:"blue",order_line_edit:"blue",order_line_delete:"red",
    maint_line_add:"navy",maint_line_edit:"navy",maint_line_delete:"red",
    vessel_model_add:"blue",vessel_model_edit:"blue",vessel_model_delete:"red",control_line_save:"navy",control_line_delete:"red",
    kit_add:"blue",kit_edit:"blue",kit_delete:"red",kit_line_save:"navy",kit_line_delete:"red",
    list_type_edit:"amber",procurement_save:"amber",po_create:"green",po_status:"amber",po_edit:"navy",po_delete:"red",
  };

  const users=[...new Set(logs.map(l=>l.user_email))].filter(Boolean);
  const actions=[...new Set(logs.map(l=>l.action))].filter(Boolean);
  const filtered=logs.filter(l=>
    (filterAction==="All"||l.action===filterAction)&&
    (filterUser==="All"||l.user_email===filterUser)
  );

  if(loading) return <Spinner text="Loading audit log…"/>;

  return (
    <div>
      <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
        <select value={filterAction} onChange={e=>setFilterAction(e.target.value)} style={inputStyle}>
          <option>All</option>
          {actions.map(a=><option key={a} value={a}>{actionLabels[a]||a}</option>)}
        </select>
        <select value={filterUser} onChange={e=>setFilterUser(e.target.value)} style={inputStyle}>
          <option>All</option>
          {users.map(u=><option key={u} value={u}>{u}</option>)}
        </select>
        <span style={{fontSize:12,color:C.textLight,marginLeft:"auto"}}>{filtered.length} records</span>
      </div>
      <div style={{display:"grid",gap:8}}>
        {filtered.map((log,i)=>{
          const color=actionColors[log.action]||"gray";
          const ts=new Date(log.created_at);
          return (
            <div key={i} style={{background:C.white,border:`1.5px solid ${C.border}`,borderLeft:`4px solid ${color==="green"?C.greenText:color==="red"?C.red:color==="amber"?C.amber:C.navy}`,borderRadius:7,padding:"12px 16px"}}>
              <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",gap:8,flexWrap:"wrap"}}>
                <div style={{display:"flex",alignItems:"center",gap:8}}>
                  <Badge color={color}>{actionLabels[log.action]||log.action}</Badge>
                  <span style={{fontFamily:"monospace",fontSize:12,fontWeight:700,color:C.navy}}>{log.entity_id}</span>
                </div>
                <div style={{textAlign:"right"}}>
                  <div style={{fontSize:11,color:C.textMid,fontWeight:600}}>{log.user_email}</div>
                  <div style={{fontSize:10,color:C.textLight}}>{ts.toLocaleDateString()} {ts.toLocaleTimeString()}</div>
                </div>
              </div>
              {log.details&&Object.keys(log.details).length>0&&(
                <div style={{marginTop:8,display:"flex",flexWrap:"wrap",gap:6}}>
                  {Object.entries(log.details).filter(([,v])=>v!==null&&v!==undefined).map(([k,v])=>(
                    <span key={k} style={{background:C.offWhite,border:`1px solid ${C.border}`,borderRadius:4,padding:"2px 8px",fontSize:11,color:C.textMid}}>
                      <strong>{k}:</strong> {typeof v==="object"?JSON.stringify(v):String(v)}
                    </span>
                  ))}
                </div>
              )}
            </div>
          );
        })}
        {filtered.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No audit records found.</div>}
      </div>
    </div>
  );
}

// ─── Issue flags + photos (shared by fabricator screen and staff LP view) ─────
const ISSUE_TYPES=[["missing","Missing"],["damaged","Damaged"],["wrong","Wrong item"],["other","Other"]];
const issueLabel=t=>(ISSUE_TYPES.find(x=>x[0]===t)||[0,"Problem"])[1];

function PhotoThumbs({ paths }) {
  const [urls,setUrls]=useState([]);
  const key=(paths||[]).join("|");
  useEffect(()=>{
    let dead=false;
    (async()=>{
      const out=[];
      for(const p of (paths||[])){
        const {data}=await _sb.storage.from("lp-photos").createSignedUrl(p,3600);
        if(data?.signedUrl) out.push({p,u:data.signedUrl});
      }
      if(!dead) setUrls(out);
    })();
    return ()=>{dead=true;};
  },[key]);
  if(!urls.length) return null;
  return <div style={{display:"flex",gap:6,flexWrap:"wrap",marginTop:6}}>
    {urls.map(x=><a key={x.p} href={x.u} target="_blank" rel="noreferrer"><img src={x.u} alt="issue photo" style={{width:64,height:64,objectFit:"cover",borderRadius:6,border:"1px solid #9DC3E6"}}/></a>)}
  </div>;
}

// Shrink a phone photo to ~1280px JPEG before upload
async function shrinkImage(file){
  const bmp=await createImageBitmap(file);
  const s=Math.min(1,1280/Math.max(bmp.width,bmp.height));
  const cv=document.createElement("canvas"); cv.width=Math.round(bmp.width*s); cv.height=Math.round(bmp.height*s);
  cv.getContext("2d").drawImage(bmp,0,0,cv.width,cv.height);
  return await new Promise(res=>cv.toBlob(res,"image/jpeg",0.72));
}

// ─── Fabricator screen: only LPs assigned to their company ───────────────────
function FabricatorApp({ user, onSignOut }) {
  const [list,setList]=useState(null);
  const [openId,setOpenId]=useState(null);
  const [lp,setLp]=useState(null);
  const [err,setErr]=useState("");
  const [busy,setBusy]=useState("");
  const [flagFor,setFlagFor]=useState(null); // line being flagged
  const wrap={maxWidth:640,margin:"0 auto",padding:16,fontFamily:"system-ui,-apple-system,Segoe UI,sans-serif",color:"#1c2b3a"};

  async function loadList(){
    const {data,error}=await _sb.rpc("fab_list_lps");
    if(error){ setErr(error.message); return; }
    setList(data||[]); setErr("");
  }
  async function loadLp(id){
    const {data,error}=await _sb.rpc("fab_get_lp",{p_lp:id});
    if(error||!data){ setErr(error?.message||"That shipment is not available."); return; }
    setLp(data); setErr("");
  }
  useEffect(()=>{ loadList(); },[]);
  useEffect(()=>{ if(openId) loadLp(openId); else setLp(null); },[openId]);

  async function setLpStatus(next){
    const items=lp.items||[]; const done=items.filter(i=>i.checked).length; const open=items.filter(i=>i.issue&&!i.issue.resolved_at).length;
    if(next==="Shipped"){
      const warn=open?`${open} problem(s) are still open. `:"";
      const left=items.length-done; const w2=left?`${left} item(s) are not checked off. `:"";
      if(!window.confirm(`${warn}${w2}Mark ${lp.id} as shipped to the customer?`)) return;
    } else if(!window.confirm("Undo Shipped for this shipment?")) return;
    setBusy("status");
    const {data,error}=await _sb.rpc("fab_set_status",{p_lp:lp.id,p_status:next});
    setBusy("");
    if(error||!data){ window.alert(error?.message||"Could not change the status. Check your connection and try again."); return; }
    await loadLp(lp.id);
  }
  async function toggle(it){
    setBusy(it.key);
    const {data,error}=await _sb.rpc("fab_set_checked",{p_lp:lp.id,p_key:it.key,p_checked:!it.checked});
    setBusy("");
    if(error||!data){ window.alert("Could not save. Check your connection and try again."); return; }
    await loadLp(lp.id);
  }

  const top=<div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:12}}>
    <div style={{fontWeight:900,fontSize:18}}>ChlorTainer <span style={{fontSize:11,color:"#a35d00",letterSpacing:1.5}}>FABRICATOR</span></div>
    <button onClick={onSignOut} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #9DC3E6",background:"#fff",fontSize:13}}>Sign out</button>
  </div>;

  if(openId&&lp){
    const items=lp.items||[]; const done=items.filter(i=>i.checked).length;
    const groups=[]; items.forEach(it=>{ const g=(it.list||"Items"); let x=groups.find(a=>a.g===g); if(!x){x={g,rows:[]};groups.push(x);} x.rows.push(it); });
    return <div style={wrap}>
      {top}
      <button onClick={()=>{setOpenId(null);loadList();}} style={{padding:"6px 12px",borderRadius:8,border:"1px solid #9DC3E6",background:"#fff",fontSize:14,marginBottom:10}}>← All shipments</button>
      <h2 style={{margin:"0 0 4px"}}>{lp.id}</h2>
      <div style={{fontSize:14,color:"#445"}}>{lp.destination}{lp.po_number?` · Customer PO ${lp.po_number}`:""}</div>
      <div style={{background:"#eef2f6",borderRadius:8,height:14,overflow:"hidden",marginTop:12}}><div style={{width:`${items.length?Math.round(done/items.length*100):0}%`,background:"#2e9d5b",height:"100%"}}/></div>
      <div style={{fontSize:14,margin:"6px 0 10px"}}><b>{done}</b> of <b>{items.length}</b> checked · <b>{lp.status}</b></div>
      {lpAtFabricator(lp.status)&&<button onClick={()=>setLpStatus("Shipped")} disabled={busy==="status"} style={{width:"100%",minHeight:48,marginBottom:14,borderRadius:10,border:"none",background:"#1c2b3a",color:"#fff",fontSize:16,fontWeight:800}}>🚚 Mark Shipped to Customer</button>}
      {lp.status==="Shipped"&&<div style={{display:"flex",gap:10,alignItems:"center",marginBottom:14,padding:"10px 12px",borderRadius:10,background:"#eef2f6",fontSize:14}}>🚚 Shipped to the customer<button onClick={()=>setLpStatus("Sent to Fabricator")} disabled={busy==="status"} style={{marginLeft:"auto",padding:"6px 12px",borderRadius:8,border:"1px solid #9DC3E6",background:"#fff",fontSize:13}}>Undo</button></div>}
      {lp.status==="Delivered"&&<div style={{marginBottom:14,padding:"10px 12px",borderRadius:10,background:"#f1faf4",fontSize:14,color:"#2e7d4f"}}>✓ Delivered to the customer</div>}
      {err&&<p style={{color:"#b00020"}}>{err}</p>}
      {groups.map(g=><div key={g.g} style={{marginBottom:18}}>
        <div style={{fontWeight:800,fontSize:15,margin:"6px 0",textTransform:"uppercase",letterSpacing:.5}}>{g.g}</div>
        {g.rows.map(it=>{
          const open=it.issue&&!it.issue.resolved_at;
          return <div key={it.key} style={{marginBottom:10,padding:12,border:`2px solid ${open?"#d9534f":it.checked?"#2e9d5b":"#c9d6e2"}`,borderRadius:10,background:open?"#fff5f5":it.checked?"#f1faf4":"#fff"}}>
            <button onClick={()=>toggle(it)} disabled={busy===it.key} style={{display:"flex",gap:12,alignItems:"flex-start",width:"100%",textAlign:"left",background:"none",border:"none",padding:0,cursor:"pointer",font:"inherit",color:"inherit"}}>
              <span style={{fontSize:28,lineHeight:"28px"}}>{it.checked?"✅":"⬜"}</span>
              <span style={{flex:1}}>
                <span style={{display:"block",fontWeight:700,fontSize:16}}>{it.qty} × {it.description||it.partId}</span>
                <span style={{display:"block",fontSize:12,color:"#667",fontFamily:"monospace"}}>{it.partId}{it.box&&it.box!==it.list?` · ${it.box}`:""}</span>
                {it.source==="direct"&&<span style={{display:"block",fontSize:13,color:"#a35d00",marginTop:2}}>🚚 Comes direct from {it.supplier||"the supplier"}{it.supplier_po?` (PO ${it.supplier_po})`:""}. Check it when it arrives.</span>}
                {it.checked&&it.checked_by&&<span style={{display:"block",fontSize:12,color:"#2e7d4f",marginTop:2}}>Checked by {it.checked_by}</span>}
              </span>
            </button>
            {it.issue&&<div style={{marginTop:8,fontSize:13,color:it.issue.resolved_at?"#2e7d4f":"#b00020"}}>
              ⚠ {issueLabel(it.issue.type)}{it.issue.note?`: ${it.issue.note}`:""}{it.issue.resolved_at?" — resolved by TGO":""}
              <PhotoThumbs paths={it.issue.photos}/>
            </div>}
            <button onClick={()=>setFlagFor(it)} style={{marginTop:8,padding:"6px 12px",borderRadius:8,border:"1px solid #d9a0a0",background:"#fff",fontSize:13,color:"#b00020"}}>{it.issue?"Edit problem":"⚠ Report a problem"}</button>
          </div>;
        })}
      </div>)}
      <button onClick={()=>loadLp(lp.id)} style={{padding:"10px 16px",fontSize:15,borderRadius:8,border:"1px solid #9DC3E6",background:"#fff"}}>↻ Refresh</button>
      {flagFor&&<FlagSheet lpId={lp.id} line={flagFor} onClose={()=>setFlagFor(null)} onSaved={async()=>{setFlagFor(null);await loadLp(lp.id);}}/>}
    </div>;
  }

  return <div style={wrap}>
    {top}
    <h2 style={{margin:"0 0 10px"}}>Your shipments</h2>
    {err&&<p style={{color:"#b00020"}}>{err}</p>}
    {!list?<div>Loading…</div>:list.length===0?<div style={{color:"#667"}}>No shipments are assigned to your company right now.</div>:
      list.map(l=><button key={l.id} onClick={()=>setOpenId(l.id)} style={{display:"block",width:"100%",textAlign:"left",marginBottom:10,padding:14,border:"2px solid #c9d6e2",borderRadius:10,background:"#fff",cursor:"pointer",font:"inherit",color:"inherit"}}>
        <div style={{fontWeight:800,fontSize:16}}>{l.id}</div>
        <div style={{fontSize:13,color:"#445"}}>{l.destination}{l.po_number?` · PO ${l.po_number}`:""}</div>
        <div style={{fontSize:13,marginTop:4}}><b>{l.status}</b> · <b>{l.checked}</b> of <b>{l.total}</b> checked{l.issues>0?<span style={{color:"#b00020"}}> · ⚠ {l.issues} problem{l.issues>1?"s":""}</span>:null}</div>
      </button>)}
    <div style={{fontSize:12,color:"#889",marginTop:16}}>Signed in as {user?.email}</div>
  </div>;
}

function FlagSheet({ lpId, line, onClose, onSaved }) {
  const cur=line.issue||{};
  const [type,setType]=useState(cur.type||"missing");
  const [note,setNote]=useState(cur.note||"");
  const [photos,setPhotos]=useState(cur.photos||[]);
  const [busy,setBusy]=useState(false);
  const [err,setErr]=useState("");
  async function addPhoto(e){
    const f=e.target.files?.[0]; e.target.value="";
    if(!f) return;
    if(photos.length>=6){ setErr("Up to 6 photos."); return; }
    setBusy(true); setErr("");
    try{
      const blob=await shrinkImage(f);
      const path=`${lpId}/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
      const {error}=await _sb.storage.from("lp-photos").upload(path,blob,{contentType:"image/jpeg"});
      if(error) throw error;
      setPhotos(p=>[...p,path]);
    }catch(x){ setErr("Photo upload failed: "+(x.message||x)); }
    setBusy(false);
  }
  async function save(clear){
    setBusy(true); setErr("");
    const {data,error}=await _sb.rpc("fab_set_issue",{p_lp:lpId,p_key:line.key,p_type:clear?"":type,p_note:clear?"":note,p_photos:clear?[]:photos});
    setBusy(false);
    if(error||!data){ setErr(error?.message||"Could not save."); return; }
    onSaved();
  }
  const btn=a=>({padding:"10px 14px",borderRadius:8,border:`2px solid ${a?"#b00020":"#c9d6e2"}`,background:a?"#fff5f5":"#fff",fontSize:15,fontWeight:700});
  return <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,.45)",display:"flex",alignItems:"flex-end",justifyContent:"center",zIndex:50}}>
    <div style={{background:"#fff",width:"100%",maxWidth:640,borderRadius:"14px 14px 0 0",padding:16,maxHeight:"90vh",overflow:"auto"}}>
      <div style={{fontWeight:800,fontSize:17}}>Report a problem</div>
      <div style={{fontSize:13,color:"#445",marginBottom:10}}>{line.qty} × {line.description||line.partId}</div>
      <div style={{display:"flex",gap:8,flexWrap:"wrap",marginBottom:10}}>{ISSUE_TYPES.map(([k,l])=><button key={k} onClick={()=>setType(k)} style={btn(type===k)}>{l}</button>)}</div>
      <textarea value={note} onChange={e=>setNote(e.target.value)} maxLength={500} rows={3} placeholder="What is wrong? (optional)" style={{width:"100%",boxSizing:"border-box",fontSize:16,padding:10,border:"1.5px solid #9DC3E6",borderRadius:8}}/>
      <PhotoThumbs paths={photos}/>
      <label style={{display:"inline-block",marginTop:10,padding:"10px 14px",borderRadius:8,border:"1.5px solid #9DC3E6",background:"#eef6ff",fontSize:15,fontWeight:700}}>
        📷 {busy?"Working…":"Add photo"}
        <input type="file" accept="image/*" capture="environment" onChange={addPhoto} disabled={busy} style={{display:"none"}}/>
      </label>
      {err&&<div style={{color:"#b00020",marginTop:8,fontSize:13}}>{err}</div>}
      <div style={{display:"flex",gap:8,marginTop:14,flexWrap:"wrap"}}>
        <button onClick={()=>save(false)} disabled={busy} style={{...btn(true),flex:1}}>Save problem</button>
        {line.issue&&<button onClick={()=>save(true)} disabled={busy} style={btn(false)}>Clear</button>}
        <button onClick={onClose} disabled={busy} style={btn(false)}>Cancel</button>
      </div>
    </div>
  </div>;
}

export default function App() {
  return <AppMain/>;
}
function AppMain() {
  const [config,setConfig]=useState(()=>loadConfig());
  const [user,setUser]=useState(null);

  if (!config) {
    return <SetupScreen onConnected={async()=>{
      const cfg=loadConfig();
      await initSB(cfg.url,cfg.key);
      setConfig(cfg);
    }}/>;
  }

  return <SupabaseLoader config={config} user={user} setUser={setUser} onDisconnect={()=>{clearConfig();setConfig(null);}}/>;
}

function SupabaseLoader({ config, user, setUser, onDisconnect }) {
  const [ready,setReady]=useState(false);
  const [err,setErr]=useState(null);

  useEffect(()=>{
    initSB(config.url,config.key).then(sb=>{
      // Check for existing session
      sb.auth.getSession().then(({data:{session}})=>{
        if(session?.user){ setCurrentUser(session.user); setUser(session.user); }
        setReady(true);
      });
    }).catch(e=>setErr(e.message));
  },[]);

  async function handleSignOut(){
    await _sb.auth.signOut();
    setCurrentUser(null);
    setUser(null);
  }

  if (err) return <div style={{padding:40,textAlign:"center",color:C.red}}>❌ Failed to connect: {err}<br/><button onClick={onDisconnect} style={{marginTop:16,padding:"8px 16px",cursor:"pointer"}}>Reconnect</button></div>;
  if (!ready) return <Spinner text="Connecting to Supabase…"/>;
  if (!user) return <LoginScreen onLogin={u=>{ setCurrentUser(u); setUser(u); }}/>;
  if (user?.app_metadata?.role==="fabricator") return <FabricatorApp user={user} onSignOut={handleSignOut}/>;
  return <MainApp user={user} onSignOut={handleSignOut}/>;
}
