import { useState, useEffect, useRef } from "react";
import { supabase } from "./supabase.js";

// ─── ChlorTainer Brand Tokens ─────────────────────────────────────────────────
const C = {
  navy:      "#1C2B3A", navyLight: "#2C3E50",
  red:       "#C8102E", redHover:  "#A50D25", redLight: "#FFF0F2", redBorder: "#F5A0AE",
  amber:     "#F5A623", amberHov:  "#D9911A", amberLight: "#FEF6E7", amberBdr: "#F5C842",
  white:     "#FFFFFF", offWhite:  "#F5F6F7", border: "#E0E3E7",
  textDark:  "#1C2B3A", textMid:   "#4A5568", textLight: "#8A9BB0",
  greenBg:   "#EDFBF3", greenText: "#1A6B42", greenBdr: "#7ECFA4",
  warnBg:    "#FFF8E6", warnText:  "#8A5A00", warnBdr:  "#F5C842",
};

// Supabase client is imported from ./supabase.js which reads VITE_SUPABASE_URL
// and VITE_SUPABASE_ANON_KEY from Netlify environment variables.

// ─── Shared UI primitives ─────────────────────────────────────────────────────

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

const inputStyle={border:`1.5px solid ${C.border}`,borderRadius:5,padding:"9px 12px",fontSize:14,fontFamily:"sans-serif",color:C.textDark,outline:"none",background:C.white};

function Field({label,children}){
  return <div style={{display:"flex",flexDirection:"column",gap:5}}>
    <label style={{fontSize:11,fontWeight:700,color:C.textMid,textTransform:"uppercase",letterSpacing:.8}}>{label}</label>
    {children}
  </div>;
}
function Input({label,...props}){
  const el=<input {...props} style={{...inputStyle,...(props.style||{})}}/>;
  return label?<Field label={label}>{el}</Field>:el;
}
function Sel({label,children,...props}){
  const el=<select {...props} style={{...inputStyle,background:C.white}}>{children}</select>;
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
function Modal({title,onClose,children}){
  return <div style={{position:"fixed",inset:0,background:"rgba(28,43,58,0.72)",zIndex:1000,display:"flex",alignItems:"center",justifyContent:"center",padding:16}}>
    <div style={{background:C.white,borderRadius:8,width:"100%",maxWidth:580,maxHeight:"92vh",overflowY:"auto",boxShadow:"0 24px 64px rgba(0,0,0,.35)"}}>
      <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 24px",borderBottom:`3px solid ${C.amber}`,background:C.navy}}>
        <h3 style={{margin:0,fontSize:16,fontWeight:800,color:C.white,letterSpacing:.3}}>{title}</h3>
        <button onClick={onClose} style={{background:"none",border:"none",cursor:"pointer",fontSize:24,color:"#8A9BB0",lineHeight:1,padding:0}}>×</button>
      </div>
      <div style={{padding:24}}>{children}</div>
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

// ─── Supabase data hook ───────────────────────────────────────────────────────

function useSupabaseData() {
  const [parts,     setParts]     = useState([]);
  const [suppliers, setSuppliers] = useState([]);
  const [lps,       setLps]       = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);

  const fetchAll = async () => {
    const [{ data: sups }, { data: rawParts }, { data: links }, { data: plates }] = await Promise.all([
      supabase.from("suppliers").select("*").order("name"),
      supabase.from("parts").select("*").order("id"),
      supabase.from("part_suppliers").select("*"),
      supabase.from("license_plates").select("*").order("created_at", { ascending: false }),
    ]);
    const stitched = (rawParts||[]).map(p => ({
      ...p, minStock: p.min_stock,
      suppliers: (links||[]).filter(l=>l.part_id===p.id).map(l=>({
        supplierId: l.supplier_id, mfgPartNo: l.mfg_part_no,
        leadDays: l.lead_days, unitCost: parseFloat(l.unit_cost)
      }))
    }));
    setSuppliers(sups||[]);
    setParts(stitched);
    setLps((plates||[]).map(lp=>({...lp, createdAt: lp.created_at, items: lp.items||[]})));
  };

  useEffect(() => {
    let subs = [];
    (async () => {
      try {
        await fetchAll();
        setLoading(false);
        const refresh = () => fetchAll();
        subs = [
          supabase.channel("parts-ch").on("postgres_changes",{event:"*",schema:"public",table:"parts"},refresh).subscribe(),
          supabase.channel("sups-ch").on("postgres_changes",{event:"*",schema:"public",table:"suppliers"},refresh).subscribe(),
          supabase.channel("links-ch").on("postgres_changes",{event:"*",schema:"public",table:"part_suppliers"},refresh).subscribe(),
          supabase.channel("lps-ch").on("postgres_changes",{event:"*",schema:"public",table:"license_plates"},refresh).subscribe(),
        ];
      } catch(e) { setError(e.message); setLoading(false); }
    })();
    return () => { subs.forEach(s => s.unsubscribe()); };
  }, []);

  // ── Write helpers ──

  async function addPart(form) {
    const id = `CT-BC-${String(parts.length+1).padStart(4,"0")}`;
    await supabase.from("parts").insert({ id, description:form.description, category:form.category,
      uom:form.uom, stock:+form.stock||0, min_stock:+form.minStock||0, location:form.location });
  }

  async function updateStock(partId, newStock) {
    await supabase.from("parts").update({ stock: newStock }).eq("id", partId);
  }

  async function addSupplier(form) {
    const id = `SUP-${String(suppliers.length+1).padStart(3,"0")}`;
    await supabase.from("suppliers").insert({ id, name:form.name, contact:form.contact, phone:form.phone });
  }

  async function linkSupplier(partId, form) {
    await supabase.from("part_suppliers").upsert({
      part_id:partId, supplier_id:form.supplierId, mfg_part_no:form.mfgPartNo,
      lead_days:+form.leadDays||0, unit_cost:+form.unitCost||0
    });
  }

  async function unlinkSupplier(partId, supplierId) {
    await supabase.from("part_suppliers").delete().eq("part_id",partId).eq("supplier_id",supplierId);
  }

  async function createLP(form, items) {
    const today = new Date().toISOString().slice(0,10).replace(/-/g,"");
    const suffix = Math.random().toString(36).slice(2,6).toUpperCase();
    const id = `LP-${today}-${suffix}`;
    await supabase.from("license_plates").insert({
      id, type:form.type, destination:form.destination,
      status:form.status, created_at:new Date().toISOString().slice(0,10), items,
    });
    return id;
  }

  async function updateLPStatus(lpId, status) {
    await supabase.from("license_plates").update({ status }).eq("id", lpId);
  }

  return { parts, suppliers, lps, loading, error,
    actions: { addPart, updateStock, addSupplier, linkSupplier, unlinkSupplier, createLP, updateLPStatus } };
}

// ─── Camera Scanner ───────────────────────────────────────────────────────────

function CameraScanner({ onScan, onClose, hint="" }) {
  const videoRef  = useRef(null);
  const canvasRef = useRef(null);
  const streamRef = useRef(null);
  const loopRef   = useRef(null);
  const lastRef   = useRef("");
  const [status, setStatus] = useState("starting");
  const [errMsg, setErrMsg] = useState("");
  const [lastScan, setLastScan] = useState("");

  useEffect(() => {
    let cancelled = false;

    async function start() {
      // Step 1 — load ZXing
      if (!window.ZXing) {
        await new Promise((res, rej) => {
          const s = document.createElement("script");
          s.src = "https://cdnjs.cloudflare.com/ajax/libs/zxing-js/0.21.2/zxing.min.js";
          s.onload = res; s.onerror = rej;
          document.head.appendChild(s);
        });
      }
      if (cancelled) return;

      // Step 2 — request camera using iOS-specific constraints
      // iOS Safari requires: facingMode environment, NO deviceId, video only
      let stream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: { ideal: "environment" },
            width:  { ideal: 1280 },
            height: { ideal: 720 },
          },
          audio: false,
        });
      } catch(e) {
        if (!cancelled) {
          setStatus("error");
          setErrMsg(
            e.name === "NotAllowedError"
              ? "Camera access denied. Go to iPhone Settings → Safari → Camera and set to Allow."
              : e.name === "NotFoundError"
              ? "No camera found on this device."
              : `Camera error: ${e.message}`
          );
        }
        return;
      }

      if (cancelled) { stream.getTracks().forEach(t => t.stop()); return; }

      // Step 3 — attach stream to video element
      streamRef.current = stream;
      const video = videoRef.current;
      video.srcObject = stream;
      video.setAttribute("playsinline", "true"); // critical for iOS
      video.setAttribute("muted", "true");
      await video.play();
      if (cancelled) return;
      setStatus("scanning");

      // Step 4 — decode loop: grab canvas frames and feed to ZXing
      const reader = new window.ZXing.BrowserMultiFormatReader();
      const canvas = canvasRef.current;
      const ctx    = canvas.getContext("2d");

      async function tick() {
        if (cancelled) return;
        if (video.readyState === video.HAVE_ENOUGH_DATA) {
          canvas.width  = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
          const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
          try {
            const lum = window.ZXing.RGBLuminanceSource
              ? new window.ZXing.RGBLuminanceSource(imgData.data, canvas.width, canvas.height)
              : null;
            let decoded = null;
            if (lum) {
              const bmp = new window.ZXing.BinaryBitmap(new window.ZXing.HybridBinarizer(lum));
              decoded = reader.decodeBitmap(bmp);
            } else {
              // Fallback: use decodeFromImageElement via canvas toDataURL
              const img = new Image();
              img.src = canvas.toDataURL();
              await new Promise(r => { img.onload = r; });
              decoded = await reader.decodeFromImageElement(img);
            }
            if (decoded) {
              const text = decoded.getText();
              if (text && text !== lastRef.current) {
                lastRef.current = text;
                setLastScan(text);
                if (navigator.vibrate) navigator.vibrate(80);
                onScan(text);
              }
            }
          } catch(_) { /* ZXing throws when no barcode found — ignore */ }
        }
        if (!cancelled) loopRef.current = setTimeout(tick, 200);
      }
      loopRef.current = setTimeout(tick, 500);
    }

    start();

    return () => {
      cancelled = true;
      clearTimeout(loopRef.current);
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
    };
  }, []);

  return (
    <div style={{display:"flex",flexDirection:"column",gap:0}}>
      {/* Hidden canvas used for frame decoding */}
      <canvas ref={canvasRef} style={{display:"none"}}/>
      <div style={{position:"relative",background:"#000",borderRadius:8,overflow:"hidden",aspectRatio:"4/3"}}>
        <video ref={videoRef} style={{width:"100%",height:"100%",objectFit:"cover",display:"block"}} playsInline muted/>
        {status==="scanning"&&<>
          {[["0","0","right","bottom"],["auto","0","left","bottom"],["0","auto","right","top"],["auto","auto","left","top"]].map(([b,r,br,tr],i)=>(
            <div key={i} style={{position:"absolute",bottom:b,right:r,top:tr==="top"?24:"auto",left:br==="left"?24:"auto",width:32,height:32,
              borderTop:tr==="top"?`3px solid ${C.amber}`:"none",borderBottom:tr==="bottom"?`3px solid ${C.amber}`:"none",
              borderLeft:br==="left"?`3px solid ${C.amber}`:"none",borderRight:br==="right"?`3px solid ${C.amber}`:"none"}}/>
          ))}
          <div style={{position:"absolute",left:24,right:24,height:2,background:C.amber,opacity:.85,animation:"scanline 2s ease-in-out infinite",top:"50%"}}/>
          <style>{`@keyframes scanline{0%,100%{top:25%}50%{top:75%}}`}</style>
        </>}
        {status==="starting"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:12}}>
          <div style={{width:36,height:36,border:`3px solid ${C.amber}`,borderTopColor:"transparent",borderRadius:"50%",animation:"spin 1s linear infinite"}}/>
          <span style={{color:"#fff",fontSize:13}}>Starting camera…</span>
        </div>}
        {status==="error"&&<div style={{position:"absolute",inset:0,display:"flex",alignItems:"center",justifyContent:"center",flexDirection:"column",gap:10,padding:20}}>
          <span style={{fontSize:32}}>📵</span>
          <span style={{color:"#fff",fontSize:13,textAlign:"center"}}>{errMsg}</span>
        </div>}
        {lastScan&&<div style={{position:"absolute",bottom:0,left:0,right:0,background:"rgba(28,43,58,.85)",padding:"8px 14px",display:"flex",alignItems:"center",gap:8}}>
          <span style={{fontSize:16}}>✅</span>
          <span style={{color:"#fff",fontFamily:"monospace",fontSize:13,fontWeight:700}}>{lastScan}</span>
        </div>}
      </div>
      {hint&&<div style={{background:C.amberLight,border:`1px solid ${C.amberBdr}`,borderRadius:6,padding:"10px 14px",marginTop:12,fontSize:13,color:C.warnText,display:"flex",gap:8,alignItems:"center"}}><span>💡</span><span>{hint}</span></div>}
      <div style={{display:"flex",justifyContent:"center",marginTop:14}}>
        <Btn variant="outline" onClick={onClose}>Close Camera</Btn>
      </div>
    </div>
  );
}

// ─── Scan Tab ─────────────────────────────────────────────────────────────────

function ScanTab({ parts, suppliers, lps, actions }) {
  const [mode,      setMode]      = useState(null);
  const [scanning,  setScanning]  = useState(false);
  const [result,    setResult]    = useState(null);
  const [notFound,  setNotFound]  = useState("");
  const [receiveQty,setReceiveQty]= useState(1);
  const [shipItems, setShipItems] = useState([]);
  const [shipDest,  setShipDest]  = useState("");
  const [shipType,  setShipType]  = useState("Outbound");
  const [toast,     setToast]     = useState("");
  const [saving,    setSaving]    = useState(false);

  function showToast(msg){setToast(msg);setTimeout(()=>setToast(""),3000);}

  function handleScan(code){
    setNotFound("");
    const t=code.trim();
    if(mode==="lookup"||mode==="receive"){
      const part=parts.find(p=>p.id===t);
      if(part){setResult({type:"part",data:part});setScanning(false);}
      else{setNotFound(t);setScanning(false);}
    }
    if(mode==="ship"){
      const part=parts.find(p=>p.id===t);
      const lp=lps.find(l=>l.id===t);
      if(part){
        if(!shipItems.find(i=>i.partId===t)){setShipItems(prev=>[...prev,{partId:t,qty:1}]);showToast(`Added ${t} to shipment`);}
        else showToast(`${t} already in list`);
      } else if(lp){setResult({type:"lp",data:lp});setScanning(false);}
      else setNotFound(t);
    }
  }

  async function applyReceive(){
    if(!result||result.type!=="part") return;
    setSaving(true);
    const live=parts.find(p=>p.id===result.data.id);
    await actions.updateStock(live.id, live.stock+(+receiveQty));
    showToast(`✅ Received ${receiveQty} ${live.uom} of ${live.id}`);
    setSaving(false); setResult(null); setReceiveQty(1);
  }

  async function createShipment(){
    if(!shipDest||shipItems.length===0) return;
    setSaving(true);
    const id=await actions.createLP({type:shipType,destination:shipDest,status:"Pending"},shipItems);
    showToast(`✅ License Plate ${id} created`);
    setSaving(false); setShipItems([]); setShipDest(""); setResult(null); setMode(null);
  }

  function reset(){setMode(null);setResult(null);setNotFound("");setScanning(false);setShipItems([]);setShipDest("");}

  const modes=[
    {id:"lookup", icon:"🔍",label:"Look Up Part",   desc:"Scan a SKU to view part details & stock level"},
    {id:"receive",icon:"📥",label:"Receive Stock",  desc:"Scan a SKU then enter quantity received"},
    {id:"ship",   icon:"📤",label:"Create Shipment",desc:"Scan multiple SKUs to build a license plate"},
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
              <line x1="24" y1="80" x2="66" y2="80" stroke={C.amber} strokeWidth="1.5" strokeOpacity="0.85">
                <animateTransform attributeName="transform" type="translate" values="0,0;0,-20;0,20;0,0" dur="2.5s" repeatCount="indefinite"/>
              </line>
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
          <div style={{display:"inline-flex",alignItems:"center",gap:6,marginTop:8,background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:20,padding:"4px 12px",fontSize:11,color:C.greenText,fontWeight:700}}>
            🟢 Live — connected to Supabase
          </div>
        </div>
        <div style={{display:"grid",gap:12}}>
          {modes.map(m=>(
            <button key={m.id} onClick={()=>setMode(m.id)} style={{background:C.white,border:`2px solid ${C.border}`,borderRadius:10,padding:"18px 20px",display:"flex",alignItems:"center",gap:16,cursor:"pointer",textAlign:"left",transition:"border-color .15s,box-shadow .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;e.currentTarget.style.boxShadow=`0 4px 16px rgba(245,166,35,.2)`;}}
              onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow="none";}}>
              <div style={{fontSize:32,flexShrink:0}}>{m.icon}</div>
              <div><div style={{fontSize:15,fontWeight:800,color:C.navy}}>{m.label}</div><div style={{fontSize:12,color:C.textMid,marginTop:2}}>{m.desc}</div></div>
              <div style={{marginLeft:"auto",fontSize:18,color:C.textLight}}>›</div>
            </button>
          ))}
        </div>
        <div style={{marginTop:20,background:C.warnBg,border:`1px solid ${C.warnBdr}`,borderRadius:8,padding:"12px 16px",fontSize:12,color:C.warnText}}>
          <strong>iPhone tip:</strong> When prompted tap <em>Allow</em> to grant camera access. Point the rear camera at any ChlorTainer barcode or license plate label.
        </div>
      </div>}

      {mode&&<div style={{display:"flex",alignItems:"center",gap:12,marginBottom:20}}>
        <button onClick={reset} style={{background:"none",border:"none",cursor:"pointer",fontSize:20,color:C.textMid,padding:0}}>‹</button>
        <div><div style={{fontSize:16,fontWeight:800,color:C.navy}}>{modes.find(m2=>m2.id===mode)?.label}</div>
          <div style={{fontSize:12,color:C.textMid}}>{modes.find(m2=>m2.id===mode)?.desc}</div></div>
      </div>}

      {/* LOOKUP */}
      {mode==="lookup"&&!result&&(!scanning
        ? <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Btn variant="amber" style={{width:"100%",justifyContent:"center",padding:"14px",fontSize:15}} onClick={()=>{setNotFound("");setScanning(true);}}>📷 Open Camera to Scan</Btn>
            <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
            <div style={{display:"flex",gap:8}}>
              <input placeholder="Type SKU e.g. CT-BC-0001" style={{...inputStyle,flex:1}} onKeyDown={e=>e.key==="Enter"&&handleScan(e.target.value)}/>
              <Btn variant="outline" onClick={e=>handleScan(e.target.previousSibling.value)}>Go</Btn>
            </div>
            {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
          </div>
        : <CameraScanner onScan={handleScan} onClose={()=>setScanning(false)} hint="Point at any CT-BC-#### barcode label"/>
      )}
      {mode==="lookup"&&result?.type==="part"&&(()=>{
        const live=parts.find(x=>x.id===result.data.id)||result.data;
        const sc=live.stock===0?"red":live.stock<live.minStock?"amber":"green";
        return <div style={{display:"grid",gap:14}}>
          <div style={{display:"flex",justifyContent:"center",background:C.offWhite,borderRadius:8,padding:16}}><BarcodeDisplay code={live.id} size="lg"/></div>
          <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:16}}>
            <div style={{fontWeight:800,fontSize:16,color:C.navy,marginBottom:8}}>{live.description}</div>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
              {[["Category",<Badge color="navy">{live.category}</Badge>],["Location",<code style={{fontSize:13}}>{live.location}</code>],
                ["On Hand",<span style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:C.navy}}>{live.stock} {live.uom}</span>],
                ["Status",<Badge color={sc}>{live.stock===0?"Out of Stock":live.stock<live.minStock?"Low Stock":"In Stock"}</Badge>]
              ].map(([l,v])=><div key={l}><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>{l}</div>{v}</div>)}
            </div>
          </div>
          {live.suppliers?.map((s,i)=>{const sup=suppliers.find(x=>x.id===s.supplierId);return <div key={i} style={{border:`1px solid ${C.border}`,borderRadius:8,padding:12}}>
            <div style={{fontWeight:700,color:C.navy}}>{sup?.name}</div>
            <div style={{fontFamily:"monospace",fontSize:12,color:C.textMid,marginTop:2}}>{s.mfgPartNo} · ${s.unitCost?.toFixed(2)}/{live.uom} · {s.leadDays}d lead</div>
          </div>;})}
          <Btn variant="outline" onClick={()=>setResult(null)} style={{justifyContent:"center"}}>Scan Another</Btn>
        </div>;
      })()}

      {/* RECEIVE */}
      {mode==="receive"&&!result&&(!scanning
        ? <div style={{display:"flex",flexDirection:"column",gap:12}}>
            <Btn variant="amber" style={{width:"100%",justifyContent:"center",padding:"14px",fontSize:15}} onClick={()=>{setNotFound("");setScanning(true);}}>📷 Scan Part Barcode</Btn>
            <div style={{textAlign:"center",color:C.textLight,fontSize:12}}>— or enter manually —</div>
            <div style={{display:"flex",gap:8}}>
              <input placeholder="Type SKU e.g. CT-BC-0001" style={{...inputStyle,flex:1}} onKeyDown={e=>e.key==="Enter"&&handleScan(e.target.value)}/>
              <Btn variant="outline" onClick={e=>handleScan(e.target.previousSibling.value)}>Go</Btn>
            </div>
            {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
          </div>
        : <CameraScanner onScan={handleScan} onClose={()=>setScanning(false)} hint="Point at the part's barcode to receive stock"/>
      )}
      {mode==="receive"&&result?.type==="part"&&(()=>{
        const live=parts.find(x=>x.id===result.data.id)||result.data;
        return <div style={{display:"grid",gap:14}}>
          <div style={{background:C.white,border:`2px solid ${C.amber}`,borderRadius:8,padding:16}}>
            <div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>Receiving into</div>
            <div style={{fontFamily:"monospace",fontSize:13,color:C.amber,fontWeight:700}}>{live.id}</div>
            <div style={{fontWeight:700,fontSize:15,color:C.navy,marginTop:2}}>{live.description}</div>
            <div style={{display:"flex",gap:16,marginTop:8}}>
              <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Current Stock</div><div style={{fontFamily:"monospace",fontSize:18,fontWeight:700,color:C.navy}}>{live.stock} {live.uom}</div></div>
              <div><div style={{fontSize:10,color:C.textLight,textTransform:"uppercase"}}>Location</div><div style={{fontFamily:"monospace",fontSize:14,color:C.navy}}>{live.location}</div></div>
            </div>
          </div>
          <Field label="Quantity Received">
            <div style={{display:"flex",alignItems:"center",gap:10}}>
              <button onClick={()=>setReceiveQty(q=>Math.max(1,+q-1))} style={{width:40,height:40,borderRadius:6,border:`1.5px solid ${C.border}`,background:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>−</button>
              <input type="number" min="1" value={receiveQty} onChange={e=>setReceiveQty(e.target.value)} style={{...inputStyle,flex:1,textAlign:"center",fontSize:22,fontFamily:"monospace",fontWeight:700}}/>
              <button onClick={()=>setReceiveQty(q=>+q+1)} style={{width:40,height:40,borderRadius:6,border:`1.5px solid ${C.border}`,background:C.white,fontSize:20,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center"}}>+</button>
            </div>
          </Field>
          <div style={{background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.greenText}}>
            New stock total: <strong>{live.stock+(+receiveQty)} {live.uom}</strong>
          </div>
          <div style={{display:"flex",gap:10}}>
            <Btn variant="outline" style={{flex:1,justifyContent:"center"}} onClick={()=>setResult(null)}>← Back</Btn>
            <Btn style={{flex:1,justifyContent:"center"}} disabled={saving} onClick={applyReceive}>{saving?"Saving…":"✅ Confirm Receipt"}</Btn>
          </div>
        </div>;
      })()}

      {/* SHIP */}
      {mode==="ship"&&<div style={{display:"grid",gap:14}}>
        <div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:14}}>
          <SectionTitle>Scanned Items ({shipItems.length})</SectionTitle>
          {shipItems.length===0&&<div style={{textAlign:"center",padding:"20px 0",color:C.textLight,fontSize:13}}>No items yet — scan a part barcode to add it</div>}
          {shipItems.map((it,i)=>{
            const p=parts.find(x=>x.id===it.partId);
            return <div key={i} style={{display:"flex",alignItems:"center",gap:10,padding:"8px 0",borderBottom:i<shipItems.length-1?`1px solid ${C.border}`:"none"}}>
              <div style={{flex:1}}><div style={{fontFamily:"monospace",fontSize:12,color:C.amber,fontWeight:700}}>{it.partId}</div><div style={{fontSize:12,color:C.textMid}}>{p?.description}</div></div>
              <div style={{display:"flex",alignItems:"center",gap:6}}>
                <button onClick={()=>setShipItems(prev=>prev.map((x,j)=>j===i?{...x,qty:Math.max(1,x.qty-1)}:x))} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer"}}>−</button>
                <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,minWidth:24,textAlign:"center"}}>{it.qty}</span>
                <button onClick={()=>setShipItems(prev=>prev.map((x,j)=>j===i?{...x,qty:x.qty+1}:x))} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.border}`,background:C.white,cursor:"pointer"}}>+</button>
                <button onClick={()=>setShipItems(prev=>prev.filter((_,j)=>j!==i))} style={{width:28,height:28,borderRadius:4,border:`1px solid ${C.redBorder}`,background:C.white,cursor:"pointer",color:C.red,fontSize:14}}>✕</button>
              </div>
            </div>;
          })}
        </div>
        {scanning
          ? <CameraScanner onScan={handleScan} onClose={()=>setScanning(false)} hint="Scan each part — keep scanning to add multiple items"/>
          : <Btn variant="amber" style={{width:"100%",justifyContent:"center",padding:"12px"}} onClick={()=>setScanning(true)}>📷 {shipItems.length===0?"Scan First Part":"Scan Another Part"}</Btn>
        }
        {notFound&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:6,padding:"10px 14px",fontSize:13,color:C.red}}>❌ No part found for <strong>{notFound}</strong></div>}
        {shipItems.length>0&&<div style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:8,padding:14,display:"grid",gap:12}}>
          <SectionTitle>Shipment Details</SectionTitle>
          <Sel label="Type" value={shipType} onChange={e=>setShipType(e.target.value)}><option>Outbound</option><option>Inbound</option><option>Transfer</option></Sel>
          <Input label="Destination / Ship To" value={shipDest} onChange={e=>setShipDest(e.target.value)} placeholder="Customer or manufacturer name"/>
          <Btn style={{width:"100%",justifyContent:"center"}} disabled={!shipDest||saving} onClick={createShipment}>{saving?"Creating…":"🏷️ Generate License Plate"}</Btn>
        </div>}
      </div>}
    </div>
  );
}

// ─── Parts Tab ────────────────────────────────────────────────────────────────

function PartsTab({ parts, suppliers, actions }) {
  const [search,  setSearch]  = useState("");
  const [filter,  setFilter]  = useState("All");
  const [showAdd, setShowAdd] = useState(false);
  const [viewPart,setViewPart]= useState(null);
  const [form,    setForm]    = useState({description:"",category:"Containment",uom:"EA",location:"",minStock:"",stock:""});
  const [saving,  setSaving]  = useState(false);

  const cats=["All",...Array.from(new Set(parts.map(p=>p.category)))];
  const filtered=parts.filter(p=>(filter==="All"||p.category===filter)&&
    (p.id.toLowerCase().includes(search.toLowerCase())||p.description.toLowerCase().includes(search.toLowerCase())));

  async function addPart(){
    if(!form.description) return;
    setSaving(true); await actions.addPart(form); setSaving(false);
    setForm({description:"",category:"Containment",uom:"EA",location:"",minStock:"",stock:""}); setShowAdd(false);
  }

  const sc=p=>p.stock===0?"red":p.stock<p.minStock?"amber":"green";
  const sl=p=>p.stock===0?"Out of Stock":p.stock<p.minStock?"Low Stock":"In Stock";

  return <div>
    <div style={{display:"flex",gap:10,marginBottom:18,flexWrap:"wrap",alignItems:"center"}}>
      <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search by SKU or description…" style={{...inputStyle,flex:1,minWidth:180}}/>
      <select value={filter} onChange={e=>setFilter(e.target.value)} style={inputStyle}>{cats.map(c=><option key={c}>{c}</option>)}</select>
      <Btn onClick={()=>setShowAdd(true)}>+ Add Part</Btn>
    </div>
    <div style={{display:"grid",gap:10}}>
      {filtered.map(p=>(
        <div key={p.id} onClick={()=>setViewPart(p)}
          style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px",display:"flex",alignItems:"center",gap:16,cursor:"pointer",transition:"border-color .15s,box-shadow .15s"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;e.currentTarget.style.boxShadow=`0 4px 16px rgba(245,166,35,.15)`;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow="none";}}>
          <div style={{flexShrink:0}}><BarcodeDisplay code={p.id}/></div>
          <div style={{flex:1,minWidth:0}}>
            <div style={{fontWeight:700,fontSize:14,color:C.textDark,marginBottom:4}}>{p.description}</div>
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
    {showAdd&&<Modal title="Add New Part" onClose={()=>setShowAdd(false)}>
      <div style={{display:"grid",gap:14}}>
        <Input label="Description" value={form.description} onChange={e=>setForm(f=>({...f,description:e.target.value}))} placeholder="e.g. HDPE Containment Body"/>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Sel label="Category" value={form.category} onChange={e=>setForm(f=>({...f,category:e.target.value}))}>
            {["Containment","Seals & Gaskets","Valves","Instrumentation","Filtration","Hardware","Other"].map(c=><option key={c}>{c}</option>)}
          </Sel>
          <Sel label="Unit of Measure" value={form.uom} onChange={e=>setForm(f=>({...f,uom:e.target.value}))}>
            {["EA","LB","FT","M","L","KG","PKG"].map(u=><option key={u}>{u}</option>)}
          </Sel>
        </div>
        <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
          <Input label="Stock Qty" type="number" value={form.stock} onChange={e=>setForm(f=>({...f,stock:e.target.value}))}/>
          <Input label="Min Stock" type="number" value={form.minStock} onChange={e=>setForm(f=>({...f,minStock:e.target.value}))}/>
        </div>
        <Input label="Location (e.g. A-01-03)" value={form.location} onChange={e=>setForm(f=>({...f,location:e.target.value}))}/>
        <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:6}}>
          <Btn variant="outline" onClick={()=>setShowAdd(false)}>Cancel</Btn>
          <Btn onClick={addPart} disabled={saving}>{saving?"Saving…":"Create Part"}</Btn>
        </div>
      </div>
    </Modal>}
    {viewPart&&<PartDetailModal part={viewPart} suppliers={suppliers} parts={parts} actions={actions} onClose={()=>setViewPart(null)}/>}
  </div>;
}

function PartDetailModal({ part, suppliers, parts, actions, onClose }) {
  const live=parts.find(x=>x.id===part.id)||part;
  const [addSupForm,setAddSupForm]=useState({supplierId:"",mfgPartNo:"",leadDays:"",unitCost:""});
  const [editStock, setEditStock]=useState(false);
  const [stockAdj,  setStockAdj] =useState(0);
  const [saving,    setSaving]   =useState(false);

  async function adjustStock(){
    setSaving(true);
    await actions.updateStock(live.id, Math.max(0, live.stock+(+stockAdj)));
    setSaving(false); setEditStock(false); setStockAdj(0);
  }
  async function addSup(){
    if(!addSupForm.supplierId||!addSupForm.mfgPartNo) return;
    setSaving(true); await actions.linkSupplier(live.id,addSupForm); setSaving(false);
    setAddSupForm({supplierId:"",mfgPartNo:"",leadDays:"",unitCost:""});
  }
  async function removeSup(supplierId){ setSaving(true); await actions.unlinkSupplier(live.id,supplierId); setSaving(false); }

  const avail=suppliers.filter(s=>!live.suppliers?.find(x=>x.supplierId===s.id));
  const sc=live.stock===0?"red":live.stock<live.minStock?"amber":"green";

  return <Modal title={live.id} onClose={onClose}>
    <div style={{display:"grid",gap:20}}>
      <div style={{display:"flex",justifyContent:"center",padding:"14px 0",background:C.offWhite,borderRadius:6}}><BarcodeDisplay code={live.id} size="lg"/></div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {[["Description",live.description],["Category",<Badge color="navy">{live.category}</Badge>],
          ["Location",<span style={{fontFamily:"monospace",fontSize:14,color:C.navy}}>{live.location||"—"}</span>],["UOM",live.uom]]
          .map(([l,v])=><div key={l}><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:4}}>{l}</div><div style={{fontSize:14,fontWeight:600,color:C.textDark}}>{v}</div></div>)}
      </div>
      <div style={{background:C.offWhite,borderRadius:7,padding:16,border:`1px solid ${C.border}`}}>
        <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:10}}>
          <SectionTitle>Inventory</SectionTitle>
          <Btn variant="outline" style={{padding:"5px 12px",fontSize:12}} onClick={()=>setEditStock(v=>!v)}>Adjust Stock</Btn>
        </div>
        <div style={{display:"flex",gap:24,alignItems:"center"}}>
          <div><div style={{fontFamily:"monospace",fontSize:30,fontWeight:700,color:C.navy}}>{live.stock}</div><div style={{fontSize:11,color:C.textLight}}>on hand</div></div>
          <div><div style={{fontFamily:"monospace",fontSize:18,color:C.textMid}}>{live.minStock}</div><div style={{fontSize:11,color:C.textLight}}>minimum</div></div>
          <Badge color={sc}>{live.stock===0?"Out of Stock":live.stock<live.minStock?"Low Stock":"In Stock"}</Badge>
        </div>
        {editStock&&<div style={{display:"flex",gap:8,marginTop:12,alignItems:"center"}}>
          <input type="number" value={stockAdj} onChange={e=>setStockAdj(e.target.value)} placeholder="±qty" style={{...inputStyle,width:80,fontFamily:"monospace"}}/>
          <span style={{fontSize:12,color:C.textMid}}>New: {Math.max(0,live.stock+(+stockAdj))} {live.uom}</span>
          <Btn style={{padding:"7px 14px",fontSize:12}} disabled={saving} onClick={adjustStock}>{saving?"…":"Apply"}</Btn>
        </div>}
      </div>
      <div>
        <SectionTitle>Suppliers ({live.suppliers?.length||0})</SectionTitle>
        {live.suppliers?.map((s,i)=>{
          const sup=suppliers.find(x=>x.id===s.supplierId);
          return <div key={i} style={{border:`1.5px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"flex-start"}}>
            <div>
              <div style={{fontWeight:700,fontSize:13,color:C.navy}}>{sup?.name||s.supplierId}</div>
              <div style={{fontFamily:"monospace",fontSize:12,color:C.textMid,marginTop:3}}>{s.mfgPartNo}</div>
              <div style={{display:"flex",gap:14,marginTop:6}}>
                <span style={{fontSize:11,color:C.textLight}}>⏱ {s.leadDays}d lead</span>
                <span style={{fontSize:11,color:C.greenText,fontWeight:700}}>${(+s.unitCost).toFixed(2)} / {live.uom}</span>
              </div>
            </div>
            <Btn variant="danger" style={{padding:"4px 10px",fontSize:11}} disabled={saving} onClick={()=>removeSup(s.supplierId)}>Remove</Btn>
          </div>;
        })}
        {avail.length>0&&<div style={{background:"#EBF2FA",border:"1px solid #9DC3E6",borderRadius:7,padding:14,marginTop:6}}>
          <div style={{fontSize:12,fontWeight:700,color:C.navy,marginBottom:10}}>+ Link Supplier</div>
          <div style={{display:"grid",gap:8}}>
            <Sel value={addSupForm.supplierId} onChange={e=>setAddSupForm(f=>({...f,supplierId:e.target.value}))}>
              <option value="">Select supplier…</option>
              {avail.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}
            </Sel>
            <Input placeholder="Mfg Part No." value={addSupForm.mfgPartNo} onChange={e=>setAddSupForm(f=>({...f,mfgPartNo:e.target.value}))}/>
            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:8}}>
              <Input placeholder="Lead days" type="number" value={addSupForm.leadDays} onChange={e=>setAddSupForm(f=>({...f,leadDays:e.target.value}))}/>
              <Input placeholder="Unit cost $" type="number" value={addSupForm.unitCost} onChange={e=>setAddSupForm(f=>({...f,unitCost:e.target.value}))}/>
            </div>
            <Btn disabled={saving} onClick={addSup}>{saving?"Saving…":"Add Supplier Link"}</Btn>
          </div>
        </div>}
      </div>
    </div>
  </Modal>;
}

// ─── Suppliers Tab ────────────────────────────────────────────────────────────

function SuppliersTab({ suppliers, parts, actions }) {
  const [showAdd,setShowAdd]=useState(false);
  const [form,setForm]=useState({name:"",contact:"",phone:""});
  const [saving,setSaving]=useState(false);

  async function addSupplier(){
    if(!form.name) return;
    setSaving(true); await actions.addSupplier(form); setSaving(false);
    setForm({name:"",contact:"",phone:""}); setShowAdd(false);
  }

  return <div>
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:18}}><Btn onClick={()=>setShowAdd(true)}>+ Add Supplier</Btn></div>
    <div style={{display:"grid",gap:10}}>
      {suppliers.map(s=>{
        const linked=parts.filter(p=>p.suppliers?.find(x=>x.supplierId===s.id));
        return <div key={s.id} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"16px 20px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{fontWeight:800,fontSize:15,color:C.navy}}>{s.name}</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:C.textLight,marginTop:2}}>{s.id}</div>
              <div style={{display:"flex",gap:18,marginTop:8}}>
                <span style={{fontSize:12,color:C.textMid}}>✉ {s.contact}</span>
                <span style={{fontSize:12,color:C.textMid}}>📞 {s.phone}</span>
              </div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"monospace",fontSize:24,fontWeight:700,color:C.amber}}>{linked.length}</div>
              <div style={{fontSize:11,color:C.textLight}}>linked SKUs</div>
            </div>
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
          <Btn onClick={addSupplier} disabled={saving}>{saving?"Saving…":"Add Supplier"}</Btn>
        </div>
      </div>
    </Modal>}
  </div>;
}

// ─── Inventory Tab ────────────────────────────────────────────────────────────

function InventoryTab({ parts, suppliers, actions }) {
  const [filter,setFilter]=useState("All");
  const alerts=parts.filter(p=>p.stock<p.minStock);
  const view=filter==="Low/Out"?alerts:parts;

  return <div>
    <div style={{background:C.warnBg,border:`1.5px solid ${C.warnBdr}`,borderLeft:`4px solid ${C.warnText}`,borderRadius:7,padding:"14px 18px",marginBottom:18,display:"flex",alignItems:"center",gap:12}}>
      <span style={{fontSize:22}}>⚠️</span>
      <div style={{flex:1}}>
        <div style={{fontWeight:800,fontSize:14,color:C.warnText}}>{alerts.length} SKU{alerts.length!==1?"s":""} need replenishment</div>
        <div style={{fontSize:12,color:C.warnText,opacity:.8,marginTop:1}}>Items below minimum stock level</div>
      </div>
      <select value={filter} onChange={e=>setFilter(e.target.value)} style={{...inputStyle,fontSize:13}}>
        <option>All</option><option>Low/Out</option>
      </select>
    </div>
    <div style={{display:"grid",gap:10}}>
      {view.map(p=>{
        const pct=p.minStock>0?Math.min(1,p.stock/p.minStock):1;
        const barColor=p.stock===0?C.red:p.stock<p.minStock?C.warnText:C.greenText;
        const cheapest=[...(p.suppliers||[])].sort((a,b)=>a.unitCost-b.unitCost)[0];
        const sup=cheapest?suppliers.find(s=>s.id===cheapest.supplierId):null;
        return <div key={p.id} style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px"}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",marginBottom:10}}>
            <div>
              <span style={{fontFamily:"monospace",fontSize:11,color:C.textLight}}>{p.id}</span>
              <div style={{fontWeight:700,fontSize:14,color:C.navy,marginTop:2}}>{p.description}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:2}}>📍 {p.location||"—"} · {p.category}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"monospace",fontSize:20,fontWeight:700,color:C.navy}}>{p.stock}<span style={{fontSize:13,color:C.textLight}}>/{p.minStock}</span></div>
              <div style={{fontSize:10,color:C.textLight}}>on hand / min</div>
            </div>
          </div>
          <div style={{background:C.border,borderRadius:4,height:6,marginBottom:p.stock<p.minStock?12:0}}>
            <div style={{background:barColor,height:"100%",borderRadius:4,width:`${pct*100}%`,transition:"width .4s"}}/>
          </div>
          {p.stock<p.minStock&&sup&&<div style={{background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderLeft:`4px solid ${C.greenText}`,borderRadius:6,padding:"10px 14px",display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
            <div style={{flex:1}}>
              <div style={{fontSize:10,fontWeight:700,color:C.greenText,textTransform:"uppercase",letterSpacing:.6,marginBottom:2}}>Best Supplier to Order From</div>
              <div style={{fontSize:13,fontWeight:700,color:C.navy}}>{sup.name}</div>
              <div style={{fontFamily:"monospace",fontSize:11,color:C.textMid,marginTop:2}}>{cheapest.mfgPartNo} · ${cheapest.unitCost.toFixed(2)}/{p.uom} · {cheapest.leadDays}d lead</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontSize:13,fontWeight:700,color:C.greenText}}>Order {p.minStock-p.stock+Math.round(p.minStock*.5)} {p.uom}</div>
              <div style={{fontSize:11,color:C.textMid}}>≈ ${((p.minStock-p.stock+Math.round(p.minStock*.5))*cheapest.unitCost).toFixed(2)}</div>
            </div>
          </div>}
        </div>;
      })}
    </div>
  </div>;
}

// ─── License Plates Tab ───────────────────────────────────────────────────────

function LicensePlatesTab({ lps, parts, actions }) {
  const [showCreate,setShowCreate]=useState(false);
  const [viewLp,setViewLp]=useState(null);
  const statusColor=s=>({Pending:"amber",Shipped:"blue",Received:"green",Cancelled:"red"}[s]||"gray");

  return <div>
    <div style={{display:"flex",justifyContent:"flex-end",marginBottom:18}}><Btn onClick={()=>setShowCreate(true)}>+ Create License Plate</Btn></div>
    <div style={{display:"grid",gap:10}}>
      {lps.map(lp=>(
        <div key={lp.id} onClick={()=>setViewLp(lp)}
          style={{background:C.white,border:`1.5px solid ${C.border}`,borderRadius:7,padding:"14px 18px",cursor:"pointer"}}
          onMouseEnter={e=>{e.currentTarget.style.borderColor=C.amber;e.currentTarget.style.boxShadow=`0 4px 16px rgba(245,166,35,.15)`;}}
          onMouseLeave={e=>{e.currentTarget.style.borderColor=C.border;e.currentTarget.style.boxShadow="none";}}>
          <div style={{display:"flex",justifyContent:"space-between",alignItems:"flex-start",flexWrap:"wrap",gap:8}}>
            <div>
              <div style={{display:"flex",alignItems:"center",gap:8,marginBottom:4}}>
                <span style={{fontFamily:"monospace",fontSize:14,fontWeight:700,color:C.navy}}>{lp.id}</span>
                <Badge color={statusColor(lp.status)}>{lp.status}</Badge>
                <Badge color={lp.type==="Outbound"?"red":"navy"}>{lp.type}</Badge>
              </div>
              <div style={{fontSize:13,color:C.textMid}}>→ {lp.destination}</div>
              <div style={{fontSize:11,color:C.textLight,marginTop:2}}>Created {lp.createdAt||lp.created_at}</div>
            </div>
            <div style={{textAlign:"right"}}>
              <div style={{fontFamily:"monospace",fontSize:22,fontWeight:700,color:C.amber}}>{lp.items?.length||0}</div>
              <div style={{fontSize:11,color:C.textLight}}>line items</div>
            </div>
          </div>
          <div style={{marginTop:10,display:"flex",flexWrap:"wrap",gap:6}}>
            {lp.items?.map((it,i)=><span key={i} style={{background:"#EBF2FA",color:C.navy,border:"1px solid #9DC3E6",borderRadius:3,padding:"2px 8px",fontSize:11,fontFamily:"monospace"}}>{it.partId} ×{it.qty}</span>)}
          </div>
        </div>
      ))}
      {lps.length===0&&<div style={{textAlign:"center",padding:48,color:C.textLight}}>No license plates yet.</div>}
    </div>
    {showCreate&&<CreateLpModal parts={parts} actions={actions} onClose={()=>setShowCreate(false)}/>}
    {viewLp&&<LpDetailModal lp={viewLp} parts={parts} actions={actions} onClose={()=>setViewLp(null)}/>}
  </div>;
}

function CreateLpModal({ parts, actions, onClose }) {
  const [form,setForm]=useState({type:"Outbound",destination:"",status:"Pending"});
  const [items,setItems]=useState([]);
  const [pickPart,setPickPart]=useState(""); const [pickQty,setPickQty]=useState(1);
  const [saving,setSaving]=useState(false);

  function addItem(){ if(!pickPart||pickQty<1||items.find(i=>i.partId===pickPart)) return; setItems(p=>[...p,{partId:pickPart,qty:+pickQty}]); setPickPart(""); setPickQty(1); }
  async function create(){
    if(!form.destination||items.length===0) return;
    setSaving(true); await actions.createLP(form,items); setSaving(false); onClose();
  }
  const available=parts.filter(p=>!items.find(i=>i.partId===p.id));

  return <Modal title="Create License Plate" onClose={onClose}>
    <div style={{display:"grid",gap:14}}>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        <Sel label="Type" value={form.type} onChange={e=>setForm(f=>({...f,type:e.target.value}))}><option>Outbound</option><option>Inbound</option><option>Transfer</option></Sel>
        <Sel label="Status" value={form.status} onChange={e=>setForm(f=>({...f,status:e.target.value}))}><option>Pending</option><option>Shipped</option><option>Received</option></Sel>
      </div>
      <Input label="Destination / Ship To" value={form.destination} onChange={e=>setForm(f=>({...f,destination:e.target.value}))} placeholder="Customer or manufacturer name"/>
      <div style={{borderTop:`1px solid ${C.border}`,paddingTop:14}}>
        <SectionTitle>Line Items</SectionTitle>
        {items.map((it,i)=>{const p=parts.find(x=>x.id===it.partId); return <div key={i} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"8px 12px",background:C.offWhite,borderRadius:6,marginBottom:6}}>
          <div><span style={{fontFamily:"monospace",fontSize:12,color:C.amber}}>{it.partId}</span><span style={{fontSize:12,color:C.textMid,marginLeft:8}}>{p?.description}</span></div>
          <div style={{display:"flex",alignItems:"center",gap:8}}><span style={{fontFamily:"monospace",fontSize:13,fontWeight:700,color:C.navy}}>×{it.qty}</span>
            <Btn variant="ghost" style={{padding:"2px 6px",fontSize:12}} onClick={()=>setItems(p=>p.filter((_,j)=>j!==i))}>✕</Btn></div>
        </div>;})}
        {available.length>0&&<div style={{display:"flex",gap:8,marginTop:8,alignItems:"flex-end"}}>
          <div style={{flex:1}}><Sel value={pickPart} onChange={e=>setPickPart(e.target.value)}><option value="">Add SKU…</option>{available.map(p=><option key={p.id} value={p.id}>{p.id} — {p.description}</option>)}</Sel></div>
          <input type="number" min={1} value={pickQty} onChange={e=>setPickQty(e.target.value)} style={{...inputStyle,width:64,fontFamily:"monospace"}}/>
          <Btn variant="outline" onClick={addItem}>Add</Btn>
        </div>}
      </div>
      <div style={{display:"flex",gap:8,justifyContent:"flex-end",marginTop:4}}>
        <Btn variant="outline" onClick={onClose}>Cancel</Btn>
        <Btn onClick={create} disabled={!form.destination||items.length===0||saving}>{saving?"Creating…":"Create LP"}</Btn>
      </div>
    </div>
  </Modal>;
}

function LpDetailModal({ lp, parts, actions, onClose }) {
  const [status,setStatus]=useState(lp.status);
  const [saving,setSaving]=useState(false);
  async function save(){ setSaving(true); await actions.updateLPStatus(lp.id,status); setSaving(false); onClose(); }

  return <Modal title={lp.id} onClose={onClose}>
    <div style={{display:"grid",gap:18}}>
      <div style={{display:"flex",flexDirection:"column",alignItems:"center",padding:"16px 0",background:C.offWhite,borderRadius:6,gap:8}}>
        <BarcodeDisplay code={lp.id} size="lg"/>
        <div style={{display:"flex",gap:8}}>
          <Badge color={lp.type==="Outbound"?"red":"navy"}>{lp.type}</Badge>
          <Badge color={{Pending:"amber",Shipped:"blue",Received:"green",Cancelled:"red"}[lp.status]||"gray"}>{lp.status}</Badge>
        </div>
      </div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:12}}>
        {[["Destination",lp.destination],["Created",lp.createdAt||lp.created_at],
          ["Line Items",lp.items?.length||0],["Total Qty",(lp.items||[]).reduce((a,b)=>a+b.qty,0)]].map(([l,v])=>(
          <div key={l}><div style={{fontSize:11,color:C.textLight,textTransform:"uppercase",letterSpacing:.6,marginBottom:3}}>{l}</div>
            <div style={{fontFamily:["Line Items","Total Qty"].includes(l)?"monospace":"sans-serif",fontSize:["Line Items","Total Qty"].includes(l)?22:14,fontWeight:700,color:C.navy}}>{v}</div></div>
        ))}
      </div>
      <div style={{display:"flex",gap:10,alignItems:"flex-end"}}>
        <div style={{flex:1}}><Sel label="Update Status" value={status} onChange={e=>setStatus(e.target.value)}><option>Pending</option><option>Shipped</option><option>Received</option><option>Cancelled</option></Sel></div>
        <Btn onClick={save} disabled={saving}>{saving?"Saving…":"Save"}</Btn>
      </div>
      <div>
        <SectionTitle>Shipment Contents</SectionTitle>
        {(lp.items||[]).map((it,i)=>{const p=parts.find(x=>x.id===it.partId); return <div key={i} style={{border:`1.5px solid ${C.border}`,borderRadius:7,padding:12,marginBottom:8,display:"flex",justifyContent:"space-between",alignItems:"center"}}>
          <div><BarcodeDisplay code={it.partId}/><div style={{fontWeight:700,fontSize:13,color:C.navy,marginTop:6}}>{p?.description||"—"}</div><div style={{fontSize:11,color:C.textLight,marginTop:2}}>{p?.category} · {p?.uom}</div></div>
          <div style={{textAlign:"right"}}><div style={{fontFamily:"monospace",fontSize:24,fontWeight:700,color:C.amber}}>{it.qty}</div><div style={{fontSize:11,color:C.textLight}}>{p?.uom}</div></div>
        </div>;})}
      </div>
    </div>
  </Modal>;
}

// ─── App Shell ────────────────────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState("scan");
  const [showDisconnect, setShowDisconnect] = useState(false);
  const { parts, suppliers, lps, loading, error, actions } = useSupabaseData();

  const tabs=[
    {id:"scan",      label:"Scan",          icon:"📷"},
    {id:"parts",     label:"Parts Catalog", icon:"🔩"},
    {id:"suppliers", label:"Suppliers",     icon:"🏭"},
    {id:"inventory", label:"Inventory",     icon:"📦"},
    {id:"lp",        label:"License Plates",icon:"🏷️"},
  ];

  const alerts=parts.filter(p=>p.stock<p.minStock).length;

  return (
    <div style={{minHeight:"100vh",background:C.offWhite}}>
      <div style={{background:C.navy,borderBottom:`4px solid ${C.amber}`}}>
        <div style={{maxWidth:960,margin:"0 auto",padding:"0 20px"}}>
          <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"14px 0",borderBottom:`1px solid rgba(255,255,255,.1)`}}>
            <div style={{display:"flex",alignItems:"center",gap:0}}>
              <div style={{background:C.amber,width:5,height:36,borderRadius:2,marginRight:10}}/>
              <div>
                <div style={{fontSize:20,fontWeight:900,color:C.white,letterSpacing:-.3,lineHeight:1.1}}>ChlorTainer</div>
                <div style={{fontSize:10,fontWeight:700,color:C.amber,letterSpacing:2.5,textTransform:"uppercase"}}>Inventory System</div>
              </div>
            </div>
            <div style={{display:"flex",alignItems:"center",gap:12}}>
              {loading&&<span style={{fontSize:11,color:C.textLight}}>Syncing…</span>}
              {!loading&&<div style={{display:"flex",alignItems:"center",gap:6,fontSize:11,color:C.greenText,background:C.greenBg,border:`1px solid ${C.greenBdr}`,borderRadius:12,padding:"3px 10px",fontWeight:700}}>🟢 Live</div>}
              {alerts>0&&<div style={{background:C.amber,color:C.navy,borderRadius:20,padding:"4px 12px",fontSize:12,fontWeight:800}}>⚠ {alerts} Low Stock</div>}
            </div>
          </div>
          <div style={{display:"flex",gap:0,overflowX:"auto"}}>
            {tabs.map(t=>(
              <button key={t.id} onClick={()=>setTab(t.id)} style={{background:"none",border:"none",cursor:"pointer",padding:"12px 16px",fontSize:12,fontWeight:700,
                color:tab===t.id?C.amber:"#8A9BB0",borderBottom:tab===t.id?`3px solid ${C.amber}`:"3px solid transparent",
                display:"flex",alignItems:"center",gap:5,transition:"color .15s",whiteSpace:"nowrap",letterSpacing:.2}}>
                {t.icon} {t.label}
                {t.id==="inventory"&&alerts>0&&<span style={{background:C.amber,color:C.navy,borderRadius:10,padding:"1px 6px",fontSize:10,fontWeight:800}}>{alerts}</span>}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div style={{maxWidth:960,margin:"0 auto",padding:"24px 20px"}}>
        <div style={{fontSize:12,color:C.textLight,marginBottom:18,display:"flex",alignItems:"center",gap:6}}>
          <span style={{color:C.amber,fontWeight:700}}>ChlorTainer</span><span>›</span>
          <span>{tabs.find(t=>t.id===tab)?.label}</span>
        </div>
        {error&&<div style={{background:C.redLight,border:`1px solid ${C.redBorder}`,borderRadius:8,padding:"14px 18px",marginBottom:16,color:C.red,fontSize:13}}>❌ Database error: {error}</div>}
        {loading ? <Spinner text="Loading from Supabase…"/>
          : tab==="scan"      ? <ScanTab      parts={parts} suppliers={suppliers} lps={lps} actions={actions}/>
          : tab==="parts"     ? <PartsTab     parts={parts} suppliers={suppliers} actions={actions}/>
          : tab==="suppliers" ? <SuppliersTab suppliers={suppliers} parts={parts} actions={actions}/>
          : tab==="inventory" ? <InventoryTab parts={parts} suppliers={suppliers} actions={actions}/>
          : tab==="lp"        ? <LicensePlatesTab lps={lps} parts={parts} actions={actions}/>
          : null}
      </div>

      <div style={{borderTop:`1px solid ${C.border}`,padding:"14px 20px",textAlign:"center",background:C.white}}>
        <span style={{fontSize:11,color:C.textLight}}>© 2026 TGO Technologies, Inc. — ChlorTainer Inventory System · Keeping Operators Safe. Protecting Our Communities.</span>
      </div>
    </div>
  );
}
