import { useState, useEffect, useRef } from "react";
import { db, auth } from "./firebase";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc,
  doc, orderBy, query, where, setDoc, getDoc
} from "firebase/firestore";
import {
  createUserWithEmailAndPassword, signInWithEmailAndPassword,
  signOut, onAuthStateChanged
} from "firebase/auth";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
// Categorías por tipo de proyecto — se detectan dinámicamente
const CATS_RETAIL = ["Granos y Cereales","Lácteos","Bebidas","Aseo Personal","Limpieza Hogar","Snacks","Enlatados","Panadería","Carnes y Embutidos","Frutas y Verduras","Condimentos","Otro"];
const CATS_CAFE   = ["Suministros","Equipos","Herramientas de apoyo","Herramientas y Elementos Decorativos","Jarras y recipientes","Limpieza y mantenimiento","Maquinas y equipos principales","Utensilios para espresso","Otros Equipos de apoyo","General","Otro"];
const CATS_GENERAL = ["Suministros","Equipos","Materiales","Herramientas","Decoración","Limpieza","Otros"];

function getCats(projectName, products) {
  // Detectar por nombre del proyecto
  const n = (projectName||"").toLowerCase();
  if (n.includes("café") || n.includes("cafe") || n.includes("coffee") || n.includes("wiljo")) return CATS_CAFE;
  if (n.includes("tienda") || n.includes("market") || n.includes("minimarket") || n.includes("prueba")) return CATS_RETAIL;
  // Detectar por categorías existentes en los productos
  const existing = [...new Set((products||[]).map(p=>p.categoria).filter(Boolean))];
  if (existing.some(c => CATS_CAFE.includes(c))) return [...new Set([...existing, ...CATS_CAFE])];
  if (existing.some(c => CATS_RETAIL.includes(c))) return [...new Set([...existing, ...CATS_RETAIL])];
  return [...new Set([...existing, ...CATS_GENERAL])];
}
const ENVASES = ["Bolsa","Botella","Caja","Lata","Tarro","Doypack","Sachet","Unidad"];
const UNITS   = ["unid","kg","g","lt","ml","paq"];

const CAT_COLOR = {
  "Granos y Cereales":"#16a34a","Lácteos":"#3b82f6","Bebidas":"#06b6d4",
  "Aseo Personal":"#ec4899","Limpieza Hogar":"#8b5cf6","Snacks":"#f97316",
  "Enlatados":"#6b7280","Panadería":"#d97706","Carnes y Embutidos":"#ef4444",
  "Frutas y Verduras":"#22c55e","Condimentos":"#eab308","Otro":"#9ca3af",
};

// Colores por armario — paleta profesional, texto siempre blanco
const ARM_COLORS = [
  {bg:"#1a5c38",text:"#fff",border:"#2d7a4f"},  // verde bosque
  {bg:"#1e3a8a",text:"#fff",border:"#2d52b0"},  // azul marino
  {bg:"#5b21b6",text:"#fff",border:"#7c3aed"},  // índigo
  {bg:"#9a3412",text:"#fff",border:"#c2410c"},  // terracota
  {bg:"#155e75",text:"#fff",border:"#0e7490"},  // petróleo
  {bg:"#3f3f46",text:"#fff",border:"#52525b"},  // carbón
  {bg:"#7f1d1d",text:"#fff",border:"#991b1b"},  // granate
  {bg:"#134e4a",text:"#fff",border:"#0f766e"},  // jade
  {bg:"#4c1d95",text:"#fff",border:"#6d28d9"},  // uva
  {bg:"#713f12",text:"#fff",border:"#92400e"},  // chocolate
];

// Colores pastel para segmentos (se ciclan)
const SEG_COLORS = [
  {bg:"#dbeafe",border:"#93c5fd",text:"#1e40af",num:"#1d4ed8"},
  {bg:"#ede9fe",border:"#c4b5fd",text:"#5b21b6",num:"#7c3aed"},
  {bg:"#dcfce7",border:"#86efac",text:"#14532d",num:"#16a34a"},
  {bg:"#fef3c7",border:"#fcd34d",text:"#78350f",num:"#b45309"},
  {bg:"#ffe4e6",border:"#fda4af",text:"#9f1239",num:"#be123c"},
  {bg:"#cffafe",border:"#67e8f9",text:"#164e63",num:"#0e7490"},
  {bg:"#fce7f3",border:"#f9a8d4",text:"#831843",num:"#be185d"},
  {bg:"#d1fae5",border:"#6ee7b7",text:"#064e3b",num:"#059669"},
];

const emptyForm = () => ({
  nombre:"", codigo:"", codigoBarras:"", categoria:"", envase:"",
  stock:"", minimo:"5", precioCompra:"", precioVenta:"",
  proveedor:"", unidad:"unid", nota:"", fechaVencimiento:"",
  lote:"", armario:"", segmento:"",
});

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt    = n => n ? "$" + Number(n).toLocaleString("es-CO") : "—";
const fmtDt  = iso => iso ? new Date(iso).toLocaleDateString("es-CO",{day:"2-digit",month:"short",hour:"2-digit",minute:"2-digit"}) : "";
const stOf   = p => p.stock===0?"critical":p.stock<=p.minimo?"low":"ok";
const ST     = { ok:{label:"Normal",bg:"#dcfce7",tx:"#166534"}, low:{label:"Stock Bajo",bg:"#fef3c7",tx:"#92400e"}, critical:{label:"Sin Stock",bg:"#fee2e2",tx:"#991b1b"} };

// Vencimiento
function expiryStatus(fechaVencimiento) {
  if (!fechaVencimiento) return null;
  const now  = new Date();
  const exp  = new Date(fechaVencimiento);
  const days = Math.ceil((exp - now) / 86400000);
  if (days < 0)  return { label:"Vencido",     bg:"#fee2e2", tx:"#991b1b", icon:"💀", level:"expired" };
  if (days <= 3) return { label:`Vence en ${days}d`, bg:"#fee2e2", tx:"#991b1b", icon:"🔴", level:"critical" };
  if (days <= 7) return { label:`Vence en ${days}d`, bg:"#fef3c7", tx:"#92400e", icon:"🟡", level:"warning" };
  return { label:`Vence en ${days}d`,   bg:"#dcfce7", tx:"#166534", icon:"🟢", level:"ok" };
}

function resizeImage(file, maxPx=1024) {
  return new Promise((res,rej) => {
    const r = new FileReader();
    r.onerror = rej;
    r.onload  = ev => {
      const img = new Image();
      img.onerror = rej;
      img.onload  = () => {
        const scale = Math.min(1, maxPx/Math.max(img.width,img.height,1));
        const w = Math.round(img.width*scale), h = Math.round(img.height*scale);
        const c = document.createElement("canvas");
        c.width=w; c.height=h;
        c.getContext("2d").drawImage(img,0,0,w,h);
        const dataUrl = c.toDataURL("image/jpeg",.85);
        res({ dataUrl, base64: dataUrl.split(",")[1] });
      };
      img.src = ev.target.result;
    };
    r.readAsDataURL(file);
  });
}

// ─── ESTILOS ─────────────────────────────────────────────────────────────────
const S = {
  // Layout
  page:    { fontFamily:"'Plus Jakarta Sans',system-ui,sans-serif", background:"var(--gray-50)", minHeight:"100vh" },
  // Header
  hdr:     { background:"var(--white)", borderBottom:"1.5px solid var(--gray-200)", padding:"0 12px", display:"flex", alignItems:"center", justifyContent:"space-between", height:56, position:"sticky", top:0, zIndex:50, boxShadow:"0 1px 8px rgba(0,0,0,0.06)", overflow:"hidden", minWidth:0 },
  logo:    { fontWeight:800, fontSize:20, color:"var(--green-700)", display:"flex", alignItems:"center", gap:8 },
  logoIcon:{ width:32, height:32, background:"linear-gradient(135deg,#22c55e,#16a34a)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 },
  // Tabs
  tabs:    { background:"var(--white)", borderBottom:"1.5px solid var(--gray-200)", display:"flex", padding:"0 20px", overflowX:"auto", gap:2 },
  tab:     a => ({ padding:"14px 16px", cursor:"pointer", fontSize:13, fontWeight:600, color:a?"var(--green-700)":"var(--gray-500)", background:"none", border:"none", borderBottom:a?"2.5px solid var(--green-600)":"2.5px solid transparent", whiteSpace:"nowrap", transition:"all .15s" }),
  // Main
  main:    { maxWidth:1100, margin:"0 auto", padding:"16px 12px" },
  // Cards
  card:    { background:"var(--white)", borderRadius:"var(--radius-lg)", padding:24, boxShadow:"var(--shadow-sm)", border:"1px solid var(--gray-200)", marginBottom:20 },
  cardSm:  { background:"var(--white)", borderRadius:"var(--radius)", padding:20, boxShadow:"var(--shadow-sm)", border:"1px solid var(--gray-200)" },
  // KPIs
  kGrid:   { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(160px,1fr))", gap:14, marginBottom:20 },
  kCard:   (accent) => ({ background:"var(--white)", borderRadius:"var(--radius-lg)", padding:"20px 18px", boxShadow:"var(--shadow-sm)", border:"1px solid var(--gray-200)", borderLeft:`4px solid ${accent}` }),
  // Forms
  fGrid:   { display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 },
  fGrp:    { display:"flex", flexDirection:"column", gap:6 },
  lbl:     { fontSize:11, fontWeight:700, color:"var(--gray-500)", textTransform:"uppercase", letterSpacing:.5 },
  inp:     { padding:"10px 13px", border:"1.5px solid var(--gray-200)", borderRadius:"var(--radius)", fontSize:14, outline:"none", background:"var(--white)", width:"100%", transition:"border-color .15s", color:"var(--gray-800)" },
  // Buttons
  btn:     (bg="#16a34a",tx="#fff",ex={}) => ({ padding:"10px 20px", background:bg, color:tx, border:"none", borderRadius:"var(--radius)", cursor:"pointer", fontSize:14, fontWeight:600, display:"inline-flex", alignItems:"center", gap:6, transition:"all .15s", ...ex }),
  bSm:     (bg,tx="#fff") => ({ padding:"6px 12px", background:bg, color:tx, border:"none", borderRadius:8, cursor:"pointer", fontSize:12, fontWeight:600 }),
  // Section
  secH:    { display:"flex", alignItems:"center", justifyContent:"space-between", marginBottom:20, flexWrap:"wrap", gap:10 },
  secT:    { fontWeight:800, fontSize:22, color:"var(--gray-900)" },
  secS:    { fontSize:13, color:"var(--gray-500)", marginTop:2 },
  // Table
  th:      { background:"var(--green-700)", color:"rgba(255,255,255,.9)", padding:"11px 13px", textAlign:"left", fontSize:11, fontWeight:700, textTransform:"uppercase", letterSpacing:.5, whiteSpace:"nowrap" },
  td:      { padding:"12px 13px", verticalAlign:"middle", borderBottom:"1px solid var(--gray-100)", fontSize:13 },
  // Modal
  ovrl:    { position:"fixed", inset:0, background:"rgba(0,0,0,.45)", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center", padding:16 },
  modal:   { background:"var(--white)", borderRadius:"var(--radius-xl)", padding:28, width:"100%", maxWidth:500, boxShadow:"var(--shadow-lg)" },
  // Badge
  badge:   s => ({ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700, background:ST[s].bg, color:ST[s].tx }),
  // Row
  movI:    { display:"flex", alignItems:"center", gap:12, padding:"12px 0", borderBottom:"1px solid var(--gray-100)" },
};

// ─── LOGIN PAGE ───────────────────────────────────────────────────────────────
function LoginPage({ onLogin }) {
  const [email,    setEmail]    = useState("");
  const [pass,     setPass]     = useState("");
  const [error,    setError]    = useState("");
  const [loading,  setLoading]  = useState(false);
  const [isSignup, setIsSignup] = useState(false);
  const [name,     setName]     = useState("");

  async function handle() {
    setError(""); setLoading(true);
    try {
      if (isSignup) {
        const cred = await createUserWithEmailAndPassword(auth, email, pass);
        await setDoc(doc(db, "users", cred.user.uid), {
          email, name, role:"consultor", createdAt: new Date().toISOString()
        });
      } else {
        await signInWithEmailAndPassword(auth, email, pass);
      }
    } catch(e) {
      setError(e.code === "auth/invalid-credential" ? "Email o contraseña incorrectos" : e.message);
    } finally { setLoading(false); }
  }

  return (
    <div style={{ minHeight:"100vh", background:"linear-gradient(135deg,#f0fdf4 0%,#dcfce7 50%,#f0fdf4 100%)", display:"flex", alignItems:"center", justifyContent:"center", padding:20 }}>
      <div style={{ width:"100%", maxWidth:400 }}>
        {/* Logo */}
        <div style={{ textAlign:"center", marginBottom:32 }}>
          <div style={{ width:64, height:64, background:"linear-gradient(135deg,#22c55e,#15803d)", borderRadius:20, display:"flex", alignItems:"center", justifyContent:"center", fontSize:30, margin:"0 auto 14px" }}>🏪</div>
          <div style={{ fontWeight:800, fontSize:26, color:"var(--green-800)" }}>Invent<span style={{color:"var(--green-500)"}}>App</span></div>
          <div style={{ fontSize:13, color:"var(--gray-500)", marginTop:4 }}>Consultoría Retail — Cartagena 🇨🇴</div>
        </div>
        {/* Card */}
        <div style={{ background:"var(--white)", borderRadius:20, padding:32, boxShadow:"0 20px 60px rgba(0,0,0,0.12)" }}>
          <div style={{ fontWeight:700, fontSize:18, color:"var(--gray-900)", marginBottom:24 }}>
            {isSignup ? "Crear cuenta" : "Iniciar sesión"}
          </div>
          <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
            {isSignup && (
              <div style={S.fGrp}>
                <label style={S.lbl}>Nombre completo</label>
                <input style={S.inp} value={name} placeholder="Tu nombre" onChange={e=>setName(e.target.value)} />
              </div>
            )}
            <div style={S.fGrp}>
              <label style={S.lbl}>Email</label>
              <input style={S.inp} type="email" value={email} placeholder="correo@ejemplo.com" onChange={e=>setEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} />
            </div>
            <div style={S.fGrp}>
              <label style={S.lbl}>Contraseña</label>
              <input style={S.inp} type="password" value={pass} placeholder="••••••••" onChange={e=>setPass(e.target.value)} onKeyDown={e=>e.key==="Enter"&&handle()} />
            </div>
            {error && <div style={{ background:"var(--red-100)", color:"#991b1b", borderRadius:8, padding:"10px 14px", fontSize:13 }}>{error}</div>}
            <button style={{ ...S.btn(), width:"100%", justifyContent:"center", padding:"12px 20px", fontSize:15, marginTop:4 }} onClick={handle} disabled={loading}>
              {loading ? <div className="spinner"/> : isSignup ? "Crear cuenta" : "Entrar"}
            </button>
          </div>
          <div style={{ textAlign:"center", marginTop:20, fontSize:13, color:"var(--gray-500)" }}>
            {isSignup ? "¿Ya tienes cuenta? " : "¿No tienes cuenta? "}
            <span style={{ color:"var(--green-600)", fontWeight:600, cursor:"pointer" }} onClick={()=>setIsSignup(!isSignup)}>
              {isSignup ? "Inicia sesión" : "Regístrate"}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── SCANNER ──────────────────────────────────────────────────────────────────
function Scanner({ onResult, masterProducts }) {
  const [state,  setState]  = useState("idle");
  const [msg,    setMsg]    = useState("");
  const [photo,  setPhoto]  = useState(null);

  const scanColors = {
    loading:{ bg:"#eff6ff", bd:"#93c5fd", tx:"#1d4ed8" },
    ok:     { bg:"#f0fdf4", bd:"#86efac", tx:"#166534" },
    error:  { bg:"#fef3c7", bd:"#fcd34d", tx:"#92400e" },
  };

  async function handleFile(file) {
    if (!file) return;
    setState("loading"); setMsg("🔍 Claude Vision analizando el producto...");
    try {
      const { dataUrl, base64 } = await resizeImage(file, 1024);
      setPhoto(dataUrl);
      const res  = await fetch("/.netlify/functions/scan-product", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({ imageBase64:base64, mimeType:"image/jpeg" })
      });
      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Error");

      // Cruzar con master database
      const prod = data.product;
      if (masterProducts && masterProducts.length > 0) {
        const master = masterProducts.find(m =>
          (m.codigoBarras && m.codigoBarras === prod.codigoBarras) ||
          m.nombre?.toLowerCase().includes(prod.nombre?.toLowerCase()?.split(" ")[0]) ||
          prod.nombre?.toLowerCase().includes(m.nombre?.toLowerCase()?.split(" ")[0])
        );
        if (master) {
          prod.precioCompra = master.precioCompra || prod.precioCompra;
          prod.precioVenta  = master.precioVenta  || prod.precioVenta;
          prod.proveedor    = master.proveedor     || prod.proveedor;
          prod.codigo       = master.codigo        || prod.codigo;
          prod._matchedMaster = master.nombre;
        }
      }

      setState("ok");
      const matchMsg = prod._matchedMaster ? ` · ✅ Precio del master: ${prod._matchedMaster}` : "";
      setMsg(`✅ ${prod.nombre || "Identificado"} — revisa y ajusta${matchMsg}`);
      onResult(prod, dataUrl);
    } catch(e) {
      setState("error");
      setMsg(`⚠️ No se pudo identificar — (${e.message})`);
    }
  }

  return (
    <div>
      {photo && (
        <div style={{ position:"relative", marginBottom:16, borderRadius:"var(--radius-lg)", overflow:"hidden", maxHeight:280 }}>
          <img src={photo} alt="producto" style={{ width:"100%", objectFit:"cover", display:"block", maxHeight:280 }}/>
          {state==="loading" && (
            <div style={{ position:"absolute", inset:0, background:"rgba(15,60,20,.8)", display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14 }}>
              <div style={{ width:48,height:48,border:"4px solid rgba(255,255,255,.2)",borderTop:"4px solid #4ade80",borderRadius:"50%",animation:"spin .75s linear infinite" }}/>
              <div style={{ color:"#fff",fontWeight:700,fontSize:15 }}>Claude Vision analizando...</div>
              <div style={{ color:"rgba(255,255,255,.65)",fontSize:12 }}>Identificando marca, precio, fecha de vencimiento</div>
            </div>
          )}
        </div>
      )}

      {state !== "idle" && scanColors[state] && (
        <div style={{ padding:"12px 15px", borderRadius:"var(--radius)", marginBottom:14, background:scanColors[state].bg, border:`1.5px solid ${scanColors[state].bd}`, color:scanColors[state].tx, fontSize:13, fontWeight:600, display:"flex", gap:8, alignItems:"flex-start" }}>
          <span>{state==="loading"?"⏳":state==="ok"?"✅":"⚠️"}</span>
          <span>{msg}</span>
        </div>
      )}

      {!photo && (
        <div style={{ background:"var(--green-50)", border:"2px dashed var(--green-200)", borderRadius:"var(--radius-lg)", padding:"32px 20px", textAlign:"center", marginBottom:16 }}>
          <div style={{ fontSize:40, marginBottom:10 }}>📷</div>
          <div style={{ fontSize:14, color:"var(--green-800)", fontWeight:700, marginBottom:4 }}>Escanea el producto</div>
          <div style={{ fontSize:12, color:"var(--green-700)" }}>Claude Vision identifica marca, categoría, precios COP y fecha de vencimiento</div>
        </div>
      )}

      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        <label style={{ ...S.btn(), cursor:"pointer", background:"var(--green-600)" }}>
          📷 Cámara
          <input type="file" accept="image/*" capture="environment" onChange={e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=""; }}/>
        </label>
        <label style={{ ...S.btn("var(--white)","var(--green-700)",{border:"1.5px solid var(--green-300)"}), cursor:"pointer" }}>
          🖼 Galería
          <input type="file" accept="image/*" onChange={e=>{ if(e.target.files[0]) handleFile(e.target.files[0]); e.target.value=""; }}/>
        </label>
        {photo && <button style={S.btn("var(--red-100)","#991b1b")} onClick={()=>{ setPhoto(null); setState("idle"); setMsg(""); }}>✖ Quitar</button>}
      </div>
    </div>
  );
}

// ─── EXPIRY BADGE ─────────────────────────────────────────────────────────────
function ExpiryBadge({ fecha }) {
  const s = expiryStatus(fecha);
  if (!s) return null;
  return <span style={{ padding:"3px 9px", borderRadius:20, fontSize:11, fontWeight:700, background:s.bg, color:s.tx }}>{s.icon} {s.label}</span>;
}

// ─── ALERTA VENCIMIENTO CARD ──────────────────────────────────────────────────
function ExpiryAlertCard({ products }) {
  const alerts = products.filter(p => {
    const s = expiryStatus(p.fechaVencimiento);
    return s && (s.level === "critical" || s.level === "warning" || s.level === "expired");
  }).sort((a,b) => new Date(a.fechaVencimiento) - new Date(b.fechaVencimiento));

  if (!alerts.length) return null;
  return (
    <div style={{ ...S.card, border:"1.5px solid #fcd34d", background:"#fffbeb", marginBottom:20 }}>
      <div style={{ fontWeight:700, fontSize:15, color:"#92400e", marginBottom:14 }}>⚠️ Alertas de Vencimiento</div>
      {alerts.map(p => {
        const s = expiryStatus(p.fechaVencimiento);
        return (
          <div key={p.id} style={{ display:"flex", alignItems:"center", gap:12, padding:"10px 14px", borderRadius:"var(--radius)", marginBottom:8, background:s.bg, border:`1.5px solid ${s.bd||s.bg}` }}>
            <span style={{ fontSize:20 }}>{s.icon}</span>
            <div style={{ flex:1 }}>
              <div style={{ fontWeight:600, fontSize:14, color:s.tx }}>{p.nombre}</div>
              <div style={{ fontSize:12, color:s.tx, opacity:.8 }}>Vence: {new Date(p.fechaVencimiento).toLocaleDateString("es-CO")} · Stock: {p.stock}</div>
            </div>
            {(s.level==="critical"||s.level==="expired") && (
              <span style={{ fontSize:11, fontWeight:700, color:s.tx, whiteSpace:"nowrap" }}>¡LIQUIDAR YA!</span>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [user,          setUser]          = useState(null);
  const [userDoc,       setUserDoc]       = useState(null);
  const [authLoading,   setAuthLoading]   = useState(true);
  const [tab,           setTab]           = useState("dashboard");
  const [tabHistory,    setTabHistory]    = useState([]);  // historial para ← Atrás

  // Wrapper que guarda historial
  function goTab(newTab) {
    setTabHistory(h => [...h.slice(-9), tab]);  // máx 10 en historial
    setTab(newTab);
  }
  function goBack() {
    setTabHistory(h => {
      if (h.length === 0) return h;
      const prev = h[h.length - 1];
      setTab(prev);
      return h.slice(0, -1);
    });
  }
  const [projects,      setProjects]      = useState([]);
  const [currentProject,setCurrentProject]= useState(null);
  const [products,      setProducts]      = useState([]);
  const [movements,     setMovements]     = useState([]);
  const [masterProducts,setMasterProducts]= useState([]);
  const [form,          setForm]          = useState(emptyForm());
  const [toast,         setToast]         = useState(null);
  const [search,        setSearch]        = useState("");
  const [catFilter,     setCatF]          = useState("");
  const [editId,        setEditId]        = useState(null);
  const [editData,      setEditData]      = useState({});
  const [movModal,      setMovModal]      = useState(false);
  const [movForm,       setMovForm]       = useState({pid:"",tipo:"entrada",qty:"",motivo:""});
  const [projModal,     setProjModal]     = useState(false);
  const [newProjName,   setNewProjName]   = useState("");
  const [inviteEmail,   setInviteEmail]   = useState("");
  const [inviteRole,    setInviteRole]    = useState("consultor");
  const [inviteModal,   setInviteModal]   = useState(false);
  const [teamModal,     setTeamModal]     = useState(false);
  const [sidebarOpen,   setSidebarOpen]   = useState(false);
  const [isMobile,      setIsMobile]      = useState(window.innerWidth < 640);
  const [editQuickId,   setEditQuickId]   = useState(null);  // edición rápida desde bodega
  const [armarioVista,  setArmarioVista]  = useState(null);  // vista ampliada de armario
  const [addToCajaModal,setAddToCajaModal] = useState(null); // {armario, segmento} — modal agregar producto a caja
  const [addSearch,     setAddSearch]      = useState("");   // búsqueda en modal agregar
  const [addSegmento,   setAddSegmento]    = useState("");   // segmento seleccionado
  const [bodegaEditId,  setBodegaEditId]   = useState(null); // id del producto en edición inline en bodega
  const [bodegaEditData,setBodegaEditData] = useState({});   // datos en edición
  const [movCajaModal,  setMovCajaModal]   = useState(null); // {prod} — modal movimiento desde bodega
  const [projDropdown,  setProjDropdown]  = useState(false); // dropdown selector de proyectos
  const [userDropdown,  setUserDropdown]  = useState(false); // dropdown usuario/cerrar sesión
  const [bodegaHighlight,setBodegaHighlight]=useState(null); // id producto resaltado en bodega
  const [teamMembers,   setTeamMembers]   = useState([]);
  const [teamLoading,   setTeamLoading]   = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [clientModal,   setClientModal]   = useState(false);
  const [newClient,     setNewClient]     = useState({email:"",pass:"",name:""});
  const [loadingData,   setLoadingData]   = useState(false);
  const [invModal,      setInvModal]      = useState(false);  // inventario diferencial
  const [masterModal,   setMasterModal]   = useState(false);  // agregar al master
  const toastRef = useRef(null);

  // ── Responsive: detectar mobile ──
  useEffect(() => {
    const check = () => setIsMobile(window.innerWidth < 640);
    window.addEventListener("resize", check);
    return () => window.removeEventListener("resize", check);
  }, []);

  // ── Auth listener ──
  useEffect(() => {
    return onAuthStateChanged(auth, async u => {
      setUser(u);
      if (u) {
        const snap = await getDoc(doc(db,"users",u.uid));
        if (snap.exists()) {
          const data = snap.data();
          if (data.disabled) {
            // Cuenta desactivada — forzar logout
            await signOut(auth);
            return;
          }
          setUserDoc(data);
        } else {
          await setDoc(doc(db,"users",u.uid), { email:u.email, role:"consultor", createdAt:new Date().toISOString() });
          setUserDoc({ email:u.email, role:"consultor" });
        }
      } else { setUserDoc(null); setCurrentProject(null); }
      setAuthLoading(false);
    });
  }, []);

  // ── Cargar proyectos ──
  useEffect(() => {
    if (!user) return;
    async function load() {
      const snap = await getDocs(query(collection(db,"projects"), where("members","array-contains",user.uid)));
      const list = snap.docs.map(d => ({ id:d.id, ...d.data() }));
      setProjects(list);
      if (list.length > 0 && !currentProject) setCurrentProject(list[0]);
    }
    load();
  }, [user]);

  // ── Cargar datos del proyecto actual ──
  useEffect(() => {
    if (!currentProject) return;
    setLoadingData(true);
    async function load() {
      try {
        const [pSnap, mSnap, masterSnap] = await Promise.all([
          getDocs(query(collection(db,`projects/${currentProject.id}/products`), orderBy("fechaReg","desc"))),
          getDocs(query(collection(db,`projects/${currentProject.id}/movements`), orderBy("fecha","desc"))),
          getDocs(collection(db,`projects/${currentProject.id}/masterProducts`)),
        ]);
        setProducts(pSnap.docs.map(d=>({id:d.id,...d.data()})));
        setMovements(mSnap.docs.map(d=>({id:d.id,...d.data()})));
        setMasterProducts(masterSnap.docs.map(d=>({id:d.id,...d.data()})));
      } finally { setLoadingData(false); }
    }
    load();
  }, [currentProject]);

  // ── Toast ──
  function showToast(msg, type="info") {
    clearTimeout(toastRef.current);
    setToast({msg,type});
    toastRef.current = setTimeout(()=>setToast(null), 3500);
  }

  // ── Crear proyecto ──
  async function createProject() {
    if (!newProjName.trim()) return;
    const ref = await addDoc(collection(db,"projects"), {
      name: newProjName.trim(),
      members: [user.uid],
      owner: user.uid,
      createdAt: new Date().toISOString(),
    });
    const np = { id:ref.id, name:newProjName.trim(), members:[user.uid], owner:user.uid };
    setProjects(prev=>[...prev,np]);
    setCurrentProject(np);
    setNewProjName(""); setProjModal(false);
    showToast(`✅ Proyecto "${np.name}" creado`,"success");
  }


  // ── Invitar miembro al proyecto ──
  async function inviteMember() {
    if (!inviteEmail.trim() || !currentProject) return;
    setInviteLoading(true);
    try {
      const snap = await getDocs(query(collection(db,"users"), where("email","==",inviteEmail.trim().toLowerCase())));
      if (snap.empty) { showToast("⚠️ No hay cuenta con ese email. Pídele que se registre primero.","warning"); setInviteLoading(false); return; }
      const memberUid = snap.docs[0].id;
      if ((currentProject.members||[]).includes(memberUid)) { showToast("⚠️ Ya tiene acceso","warning"); setInviteLoading(false); return; }
      const upd = [...(currentProject.members||[]), memberUid];
      await updateDoc(doc(db,"projects",currentProject.id),{members:upd});
      setCurrentProject(p=>({...p,members:upd}));
      setProjects(prev=>prev.map(p=>p.id===currentProject.id?{...p,members:upd}:p));
      setInviteEmail(""); setInviteModal(false);
      showToast(`✅ ${inviteEmail.trim()} agregado al proyecto`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
    finally { setInviteLoading(false); }
  }

  // ── Crear cuenta cliente/consultor extra (API REST — no cierra sesión) ──
  async function createClientAccount() {
    if (!newClient.email||!newClient.pass||!newClient.name) { showToast("⚠️ Completa todos los campos","warning"); return; }
    if (!currentProject) { showToast("⚠️ Selecciona un proyecto primero","warning"); return; }
    if (newClient.pass.length < 6) { showToast("⚠️ Contraseña mínimo 6 caracteres","warning"); return; }
    setInviteLoading(true);
    try {
      const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;
      const res = await fetch(`https://identitytoolkit.googleapis.com/v1/accounts:signUp?key=${apiKey}`, {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({email:newClient.email.toLowerCase(),password:newClient.pass,returnSecureToken:false})
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error?.message === "EMAIL_EXISTS") {
          const snap = await getDocs(query(collection(db,"users"),where("email","==",newClient.email.toLowerCase())));
          if (!snap.empty) {
            const uid = snap.docs[0].id;
            await updateDoc(doc(db,"users",uid),{role:inviteRole,proyectoId:currentProject.id,name:newClient.name});
            const upd = [...(currentProject.members||[]),uid];
            await updateDoc(doc(db,"projects",currentProject.id),{members:upd});
            setCurrentProject(p=>({...p,members:upd}));
            setProjects(prev=>prev.map(p=>p.id===currentProject.id?{...p,members:upd}:p));
            showToast(`✅ Usuario existente asignado como ${inviteRole}`,"success");
            setClientModal(false); setNewClient({email:"",pass:"",name:""});
          }
        } else { throw new Error(data.error?.message||"Error al crear cuenta"); }
        return;
      }
      const uid = data.localId;
      await setDoc(doc(db,"users",uid),{
        email:newClient.email.toLowerCase(), name:newClient.name,
        role:inviteRole, proyectoId:currentProject.id,
        createdAt:new Date().toISOString(), createdBy:user.uid
      });
      const upd = [...(currentProject.members||[]),uid];
      await updateDoc(doc(db,"projects",currentProject.id),{members:upd});
      setCurrentProject(p=>({...p,members:upd}));
      setProjects(prev=>prev.map(p=>p.id===currentProject.id?{...p,members:upd}:p));
      showToast(`✅ ${inviteRole==="cliente"?"Cliente":"Consultor"} ${newClient.name} creado — puede entrar con ${newClient.email}`,"success");
      setClientModal(false); setNewClient({email:"",pass:"",name:""});
    } catch(e) { showToast("❌ "+e.message,"warning"); }
    finally { setInviteLoading(false); }
  }

  // ── Cargar miembros del proyecto ──
  async function loadTeamMembers() {
    if (!currentProject?.members?.length) { setTeamMembers([]); return; }
    setTeamLoading(true);
    try {
      const members = [];
      for (const uid of currentProject.members) {
        const snap = await getDoc(doc(db,"users",uid));
        if (snap.exists()) members.push({ uid, ...snap.data() });
        else members.push({ uid, email:"(sin perfil)", role:"consultor", name:"" });
      }
      setTeamMembers(members);
    } catch(e) { showToast("❌ "+e.message,"warning"); }
    finally { setTeamLoading(false); }
  }

  // ── Quitar miembro del proyecto ──
  async function removeMember(uid) {
    if (!window.confirm("¿Quitar este miembro del proyecto?")) return;
    try {
      const upd = (currentProject.members||[]).filter(m => m !== uid);
      await updateDoc(doc(db,"projects",currentProject.id),{members:upd});
      setCurrentProject(p=>({...p,members:upd}));
      setProjects(prev=>prev.map(p=>p.id===currentProject.id?{...p,members:upd}:p));
      setTeamMembers(prev=>prev.filter(m=>m.uid!==uid));
      showToast("✅ Miembro quitado del proyecto","success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Desactivar cuenta completamente (Firebase Identity Toolkit) ──
  async function disableAccount(uid, email) {
    if (!window.confirm(`¿Desactivar la cuenta de ${email}? No podrá iniciar sesión en ningún proyecto.`)) return;
    try {
      // Primero quitar del proyecto
      await removeMember(uid);
      // Luego desactivar via Admin SDK a través de nuestra Netlify function
      const apiKey = process.env.REACT_APP_FIREBASE_API_KEY;
      // Usamos la API de Firebase Admin para deshabilitar — necesitamos token de admin
      // Por ahora: marcar como desactivado en Firestore y bloquear en el login
      await updateDoc(doc(db,"users",uid),{ disabled: true, disabledAt: new Date().toISOString(), disabledBy: user.uid });
      showToast(`🚫 Cuenta de ${email} desactivada`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Edición inline en bodega ──
  function startBodegaEdit(p) {
    setBodegaEditId(p.id);
    setBodegaEditData({
      nombre: p.nombre, stock: p.stock, minimo: p.minimo,
      precioCompra: p.precioCompra, precioVenta: p.precioVenta,
      lote: p.lote||"", categoria: p.categoria||"", nota: p.nota||""
    });
  }
  async function saveBodegaEdit(p) {
    try {
      const upd = {
        nombre: bodegaEditData.nombre||p.nombre,
        stock: parseInt(bodegaEditData.stock)||0,
        minimo: parseInt(bodegaEditData.minimo)||0,
        precioCompra: parseFloat(bodegaEditData.precioCompra)||0,
        precioVenta: parseFloat(bodegaEditData.precioVenta)||0,
        lote: bodegaEditData.lote||"",
        categoria: bodegaEditData.categoria||p.categoria,
        nota: bodegaEditData.nota||"",
      };
      await updateDoc(doc(db,`projects/${currentProject.id}/products`,p.id), upd);
      setProducts(prev=>prev.map(x=>x.id===p.id?{...x,...upd}:x));
      // Actualizar armarioVista si está abierta
      if (armarioVista) {
        setArmarioVista(av=>{
          if(!av) return av;
          const newItems = av.items.map(x=>x.id===p.id?{...x,...upd}:x);
          const bySegmento={};
          newItems.forEach(x=>{const s=x.segmento||"General";if(!bySegmento[s])bySegmento[s]=[];bySegmento[s].push(x);});
          return {...av,items:newItems,bySegmento,segs:Object.keys(bySegmento).sort()};
        });
      }
      setBodegaEditId(null); setBodegaEditData({});
      showToast("✅ Producto actualizado","success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Movimiento rápido desde bodega ──
  async function saveMovCaja(prod, tipo, qty, motivo) {
    qty = parseInt(qty)||0;
    if (!prod || qty<=0) { showToast("⚠️ Cantidad inválida","warning"); return; }
    if (tipo==="salida" && qty>prod.stock) { showToast("⚠️ Stock insuficiente","warning"); return; }
    try {
      const newStock = tipo==="entrada" ? prod.stock+qty : prod.stock-qty;
      await updateDoc(doc(db,`projects/${currentProject.id}/products`,prod.id),{stock:newStock});
      const mov = {productoId:prod.id,nombre:prod.nombre,tipo,cantidad:qty,motivo:motivo||"Desde bodega",fecha:new Date().toISOString()};
      const mRef = await addDoc(collection(db,`projects/${currentProject.id}/movements`),mov);
      setProducts(prev=>prev.map(x=>x.id===prod.id?{...x,stock:newStock}:x));
      setMovements(prev=>[{id:mRef.id,...mov},...prev]);
      // Actualizar armarioVista
      if (armarioVista) {
        setArmarioVista(av=>{
          if(!av) return av;
          const newItems = av.items.map(x=>x.id===prod.id?{...x,stock:newStock}:x);
          return {...av,items:newItems};
        });
      }
      setMovCajaModal(null);
      showToast(`✅ ${tipo==="salida"?"Salida":"Entrada"} registrada — Stock: ${newStock}`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Remover producto de caja (sin eliminar del inventario) ──
  async function removerDeCaja(prod) {
    if (!window.confirm(`¿Quitar "${prod.nombre}" de ${prod.armario}? El producto quedará sin ubicación en inventario.`)) return;
    try {
      await updateDoc(doc(db,`projects/${currentProject.id}/products`,prod.id),{armario:"",segmento:""});
      setProducts(prev=>prev.map(x=>x.id===prod.id?{...x,armario:"",segmento:""}:x));
      if (armarioVista) {
        setArmarioVista(av=>{
          if(!av) return av;
          const newItems = av.items.filter(x=>x.id!==prod.id);
          if(newItems.length===0){setArmarioVista(null);return null;}
          const bySegmento={};
          newItems.forEach(x=>{const s=x.segmento||"General";if(!bySegmento[s])bySegmento[s]=[];bySegmento[s].push(x);});
          return {...av,items:newItems,bySegmento,segs:Object.keys(bySegmento).sort()};
        });
      }
      showToast(`✅ "${prod.nombre}" removido de la caja`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Eliminar caja/armario completo ──
  async function eliminarCaja(armario, items) {
    if (!window.confirm(`¿Eliminar la caja "${armario}"?\n\nLos ${items.length} productos quedarán sin ubicación en inventario. Esta acción no se puede deshacer.`)) return;
    try {
      // Quitar armario y segmento de todos los productos de esta caja
      await Promise.all(items.map(p=>
        updateDoc(doc(db,`projects/${currentProject.id}/products`,p.id),{armario:"",segmento:""})
      ));
      setProducts(prev=>prev.map(p=>items.some(x=>x.id===p.id)?{...p,armario:"",segmento:""}:p));
      setArmarioVista(null);
      showToast(`✅ Caja "${armario}" eliminada — ${items.length} productos sin ubicar`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Asignar/mover producto a caja desde bodega ──
  async function asignarProductoACaja(prod, armario, segmento) {
    try {
      await updateDoc(doc(db,`projects/${currentProject.id}/products`, prod.id), {armario, segmento});
      setProducts(prev => prev.map(p => p.id===prod.id ? {...p, armario, segmento} : p));
      showToast(`✅ ${prod.nombre} → ${armario} / ${segmento}`, "success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Crear y asignar nuevo producto a caja ──
  async function crearYAsignarACaja(nombre, armario, segmento) {
    if (!nombre.trim() || !currentProject) return;
    try {
      const data = {
        nombre: nombre.trim(), codigo:"", codigoBarras:"", 
        categoria: getCats(currentProject?.name, products)[0] || "General",
        envase:"Unidad", stock:1, minimo:1,
        precioCompra:0, precioVenta:0, proveedor:"", unidad:"unid",
        nota:"", fechaVencimiento:"", lote:"",
        armario, segmento: segmento || "General",
        fechaReg: new Date().toISOString()
      };
      const ref = await addDoc(collection(db,`projects/${currentProject.id}/products`), data);
      const np = {id: ref.id, ...data};
      setProducts(prev=>[np,...prev]);
      showToast(`✅ "${nombre}" agregado a ${armario}`, "success");
      setAddToCajaModal(null); setAddSearch(""); setAddSegmento("");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Mover producto existente a otra caja ──
  async function moverProductoACaja(prod, armario, segmento) {
    try {
      await updateDoc(doc(db,`projects/${currentProject.id}/products`, prod.id), {armario, segmento: segmento||prod.segmento});
      setProducts(prev => prev.map(p => p.id===prod.id ? {...p, armario, segmento:segmento||prod.segmento} : p));
      showToast(`✅ "${prod.nombre}" movido a ${armario}`, "success");
      setAddToCajaModal(null); setAddSearch(""); setAddSegmento("");
      // Actualizar armarioVista si está abierta
      if (armarioVista?.armario === armario) {
        setArmarioVista(av => {
          if (!av) return av;
          const newItems = [...av.items, {...prod, armario, segmento:segmento||prod.segmento}];
          const bySegmento = {};
          newItems.forEach(p => { const s = p.segmento||"General"; if(!bySegmento[s]) bySegmento[s]=[]; bySegmento[s].push(p); });
          return {...av, items:newItems, bySegmento, segs:Object.keys(bySegmento).sort()};
        });
      }
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Scanner result ──
  function onScanResult(prod) {
    setForm(f => ({
      ...f,
      nombre:          prod.nombre        || f.nombre,
      codigo:          prod.codigo        || f.codigo,
      codigoBarras:    prod.codigoBarras  || f.codigoBarras,
      categoria:       prod.categoria  || f.categoria,
      envase:          ENVASES.includes(prod.envase)   ? prod.envase     : f.envase,
      unidad:          UNITS.includes(prod.unidad)     ? prod.unidad     : f.unidad,
      precioVenta:     prod.precioVenta   ? String(prod.precioVenta)  : f.precioVenta,
      precioCompra:    prod.precioCompra  ? String(prod.precioCompra) : f.precioCompra,
      proveedor:       prod.proveedor     || f.proveedor,
      nota:            prod.nota          || f.nota,
      fechaVencimiento: prod.fechaVencimiento || f.fechaVencimiento,
      lote:             prod.lote             || f.lote,
      armario:          prod.armario          || f.armario,
      segmento:         prod.segmento         || f.segmento,
    }));
    setTimeout(()=>document.getElementById("form-nombre")?.scrollIntoView({behavior:"smooth",block:"center"}),300);
  }

  // ── Guardar producto ──
  async function saveProduct() {
    if (!currentProject) { showToast("Selecciona un proyecto primero","warning"); return; }
    if (!form.nombre.trim()||!form.categoria) { showToast("⚠️ Nombre y categoría son obligatorios","warning"); return; }
    try {
      const data = { ...form, stock:parseInt(form.stock)||0, minimo:parseInt(form.minimo)||5,
        precioCompra:parseFloat(form.precioCompra)||0, precioVenta:parseFloat(form.precioVenta)||0,
        fechaReg:new Date().toISOString() };
      const ref = await addDoc(collection(db,`projects/${currentProject.id}/products`), data);
      const np  = { id:ref.id, ...data };
      setProducts(prev=>[np,...prev]);
      if (data.stock>0) {
        const mov = { productoId:ref.id, nombre:data.nombre, tipo:"entrada", cantidad:data.stock, motivo:"Registro inicial", fecha:new Date().toISOString() };
        const mRef = await addDoc(collection(db,`projects/${currentProject.id}/movements`), mov);
        setMovements(prev=>[{id:mRef.id,...mov},...prev]);
      }
      // Auto-alertas vencimiento
      const exp = expiryStatus(data.fechaVencimiento);
      if (exp && (exp.level==="critical"||exp.level==="warning")) {
        showToast(`${exp.icon} Alerta: ${data.nombre} ${exp.label}`,"warning");
      }
      setForm(emptyForm());
      showToast(`✅ ${data.nombre} guardado`,"success");
      setTab("inventario");
    } catch(e) { showToast("❌ Error: "+e.message,"warning"); }
  }

  // ── Editar ──
  function startEdit(p) { setEditId(p.id); setEditData({stock:p.stock,minimo:p.minimo,precioCompra:p.precioCompra,precioVenta:p.precioVenta,lote:p.lote||"",armario:p.armario||"",segmento:p.segmento||""}); }
  async function saveEdit(p) {
    try {
      await updateDoc(doc(db,`projects/${currentProject.id}/products`,p.id), editData);
      setProducts(prev=>prev.map(x=>x.id===p.id?{...x,...editData}:x));
      setEditId(null); showToast("✅ Actualizado","success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Eliminar ──
  async function deleteProd(p) {
    if (!window.confirm(`¿Eliminar "${p.nombre}"?`)) return;
    await deleteDoc(doc(db,`projects/${currentProject.id}/products`,p.id));
    setProducts(prev=>prev.filter(x=>x.id!==p.id));
    showToast("🗑 Eliminado");
  }

  // ── Movimiento ──
  async function saveMovement() {
    const p = products.find(x=>x.id===movForm.pid);
    const qty = parseInt(movForm.qty)||0;
    if (!p||qty<=0) { showToast("⚠️ Completa todos los campos","warning"); return; }
    if (movForm.tipo==="salida"&&qty>p.stock) { showToast("⚠️ Stock insuficiente","warning"); return; }
    try {
      const newStock = movForm.tipo==="entrada"?p.stock+qty:p.stock-qty;
      await updateDoc(doc(db,`projects/${currentProject.id}/products`,p.id),{stock:newStock});
      const mov = {productoId:p.id,nombre:p.nombre,tipo:movForm.tipo,cantidad:qty,motivo:movForm.motivo||"Sin motivo",fecha:new Date().toISOString()};
      const mRef = await addDoc(collection(db,`projects/${currentProject.id}/movements`),mov);
      setProducts(prev=>prev.map(x=>x.id===p.id?{...x,stock:newStock}:x));
      setMovements(prev=>[{id:mRef.id,...mov},...prev]);
      setMovModal(false); setMovForm({pid:"",tipo:"entrada",qty:"",motivo:""});
      showToast(`✅ Movimiento registrado`,"success");
    } catch(e) { showToast("❌ "+e.message,"warning"); }
  }

  // ── Inventario diferencial ──
  function calcDiff() {
    return products.map(p => {
      const master = masterProducts.find(m => m.nombre?.toLowerCase()===p.nombre?.toLowerCase() || m.codigoBarras===p.codigoBarras);
      if (!master) return null;
      const diff  = p.stock - (master.stockInicial || 0);
      const merma = diff < 0 ? Math.abs(diff) : 0;
      const valorMerma = merma * (p.precioVenta || 0);
      return { ...p, stockInicial:master.stockInicial||0, diff, merma, valorMerma };
    }).filter(Boolean);
  }

  // ── CSV ──
  function exportCSV() {
    const rows = products.map(p=>[p.nombre,p.codigo,p.codigoBarras||"",p.categoria,p.envase,p.stock,p.minimo,p.precioCompra,p.precioVenta,p.proveedor,p.unidad,p.fechaVencimiento||"",p.lote||"",p.armario||"",p.segmento||""].join(","));
    const csv  = ["Nombre,Codigo,CodigoBarras,Categoria,Envase,Stock,Minimo,PCompra,PVenta,Proveedor,Unidad,FechaVencimiento,Lote,Armario,Segmento",...rows].join("\n");
    const a = Object.assign(document.createElement("a"),{href:URL.createObjectURL(new Blob([csv],{type:"text/csv"})),download:`inventario_${new Date().toISOString().slice(0,10)}.csv`});
    a.click(); showToast("📥 CSV exportado","success");
  }

  // ── KPIs ──
  const alerts    = products.filter(p=>p.stock<=p.minimo);
  const totalVal  = products.reduce((s,p)=>s+(p.stock*(p.precioVenta||0)),0);
  const expiryAlerts = products.filter(p=>{ const s=expiryStatus(p.fechaVencimiento); return s&&s.level!=="ok"; });
  const filtered  = products.filter(p=>{
    const ms = p.nombre?.toLowerCase().includes(search.toLowerCase())||p.codigo?.toLowerCase().includes(search.toLowerCase())||p.codigoBarras?.includes(search);
    return ms&&(!catFilter||p.categoria===catFilter);
  });

  // ── Auth loading ──
  if (authLoading) return (
    <div style={{display:"flex",alignItems:"center",justifyContent:"center",height:"100vh",background:"var(--green-50)",flexDirection:"column",gap:16}}>
      <div style={{width:48,height:48,border:"4px solid var(--green-200)",borderTop:"4px solid var(--green-600)",borderRadius:"50%",animation:"spin .8s linear infinite"}}/>
      <div style={{color:"var(--green-800)",fontWeight:600}}>Cargando InventApp...</div>
    </div>
  );

  if (!user) return <LoginPage />;

  const isConsultor = !userDoc || userDoc.role === "consultor" || userDoc.role === "admin";

  // ── Tabs según rol ──
  const allTabs = isConsultor
    ? [["dashboard","📊 Dashboard"],["registrar","📷 Registrar"],["inventario","📦 Inventario"],["movimientos","↕ Movimientos"],["diferencial","📋 Diferencial"],["master","🗄 Master DB"],["bodega","🗺 Bodega"],["analisis","📈 Análisis"]]
    : [["dashboard","📊 Dashboard"],["inventario","📦 Inventario"],["analisis","📈 Análisis"]];

  return (
    <div style={S.page}>
      {/* HEADER */}
      <header style={S.hdr}>
        {/* ── ☰ izquierda + ← Atrás ── */}
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <button onClick={()=>setSidebarOpen(true)} style={{background:"none",border:"1.5px solid var(--gray-200)",borderRadius:8,width:36,height:36,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",padding:0,flexShrink:0}} aria-label="Menú">
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
          </button>
          {/* ← Atrás — solo visible cuando hay historial */}
          {tabHistory.length > 0 && (
            <button onClick={goBack}
              title={`Volver a ${tabHistory[tabHistory.length-1]}`}
              style={{background:"none",border:"1.5px solid var(--gray-200)",borderRadius:8,width:36,height:36,display:"flex",alignItems:"center",justifyContent:"center",cursor:"pointer",flexShrink:0,color:"var(--gray-600)",transition:"all .15s"}}
              onMouseEnter={e=>{e.currentTarget.style.background="var(--gray-100)";e.currentTarget.style.borderColor="var(--gray-300)";}}
              onMouseLeave={e=>{e.currentTarget.style.background="none";e.currentTarget.style.borderColor="var(--gray-200)";}}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="15 18 9 12 15 6"/>
              </svg>
            </button>
          )}
          <div style={S.logo}>
            <div style={S.logoIcon}>🪴</div>
            Invent<span style={{color:"var(--green-500)"}}>App</span>
          </div>
        </div>
        {/* ── Header derecho: proyecto + usuario ── */}
        <div style={{display:"flex",alignItems:"center",gap:8,position:"relative"}}>

          {/* Atajos rápidos — solo desktop */}
          {!isMobile && (
            <div style={{display:"flex",gap:4,marginRight:4}}>
              {[
                {lbl:"📦",title:"Inventario",id:"inventario"},
                {lbl:"📷",title:"Registrar",id:"registrar"},
                {lbl:"↕",title:"Movimientos",id:"movimientos"},
              ].map(({lbl,title,id})=>(
                <button key={id} onClick={()=>goTab(id)} title={title}
                  style={{background:tab===id?"var(--green-50)":"none",border:"1.5px solid",borderColor:tab===id?"var(--green-300)":"var(--gray-200)",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:14,display:"flex",alignItems:"center",justifyContent:"center",color:tab===id?"var(--green-700)":"var(--gray-500)",transition:"all .15s"}}
                  onMouseEnter={e=>{if(tab!==id){e.currentTarget.style.background="var(--gray-50)";e.currentTarget.style.borderColor="var(--gray-300)";}}}
                  onMouseLeave={e=>{if(tab!==id){e.currentTarget.style.background="none";e.currentTarget.style.borderColor="var(--gray-200)";}}}
                >{lbl}</button>
              ))}
            </div>
          )}

          {/* Botón Home */}
          <button onClick={()=>goTab("dashboard")} title="Ir al Dashboard"
            style={{background:tab==="dashboard"?"var(--green-50)":"none",border:"1.5px solid",borderColor:tab==="dashboard"?"var(--green-300)":"var(--gray-200)",borderRadius:8,width:32,height:32,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",transition:"all .15s",flexShrink:0}}
            onMouseEnter={e=>{if(tab!=="dashboard"){e.currentTarget.style.background="var(--gray-50)";}}}
            onMouseLeave={e=>{if(tab!=="dashboard"){e.currentTarget.style.background="none";}}}>
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke={tab==="dashboard"?"var(--green-700)":"var(--gray-500)"} strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>
            </svg>
          </button>

          {/* Dropdown proyecto */}
          {currentProject && (
            <div style={{position:"relative"}}>
              <button onClick={()=>{setProjDropdown(d=>!d);setUserDropdown(false);}}
                style={{fontSize:11,background:projDropdown?"var(--green-100)":"var(--green-50)",border:"1px solid var(--green-200)",borderRadius:20,padding:"5px 10px",color:"var(--green-700)",fontWeight:700,maxWidth:"clamp(60px,22vw,150px)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",cursor:"pointer",display:"flex",alignItems:"center",gap:5,transition:"all .15s"}}>
                <span>📁</span>
                <span style={{overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{currentProject.name}</span>
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" style={{flexShrink:0,transform:projDropdown?"rotate(180deg)":"rotate(0deg)",transition:"transform .2s"}}><polyline points="6 9 12 15 18 9"/></svg>
              </button>
              {projDropdown && (
                <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"#fff",borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.14)",border:"1px solid var(--gray-100)",minWidth:200,zIndex:300,overflow:"hidden"}}>
                  <div style={{padding:"10px 14px 6px",fontSize:10,fontWeight:700,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.5}}>Proyectos</div>
                  {projects.map(pr=>(
                    <button key={pr.id} onClick={()=>{setCurrentProject(pr);setProjDropdown(false);}}
                      style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 14px",background:pr.id===currentProject.id?"var(--green-50)":"none",border:"none",cursor:"pointer",textAlign:"left",transition:"background .12s"}}
                      onMouseEnter={e=>{if(pr.id!==currentProject.id)e.currentTarget.style.background="var(--gray-50)";}}
                      onMouseLeave={e=>{if(pr.id!==currentProject.id)e.currentTarget.style.background="none";}}>
                      <div style={{width:28,height:28,borderRadius:8,background:pr.id===currentProject.id?"var(--green-600)":"var(--gray-200)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>
                        {pr.id===currentProject.id?"✓":"📁"}
                      </div>
                      <div style={{minWidth:0}}>
                        <div style={{fontWeight:pr.id===currentProject.id?700:500,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:pr.id===currentProject.id?"var(--green-800)":"var(--gray-800)"}}>{pr.name}</div>
                      </div>
                    </button>
                  ))}
                  <div style={{borderTop:"1px solid var(--gray-100)",margin:"4px 0"}}/>
                  <button onClick={()=>{setProjDropdown(false);setProjModal(true);}}
                    style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"10px 14px",background:"none",border:"none",cursor:"pointer",textAlign:"left",color:"var(--green-700)",fontWeight:600,fontSize:13}}
                    onMouseEnter={e=>e.currentTarget.style.background="var(--green-50)"}
                    onMouseLeave={e=>e.currentTarget.style.background="none"}>
                    <div style={{width:28,height:28,borderRadius:8,background:"var(--green-100)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>+</div>
                    Nuevo proyecto
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Dropdown usuario */}
          <div style={{position:"relative"}}>
            <button onClick={()=>{setUserDropdown(d=>!d);setProjDropdown(false);}}
              style={{display:"flex",alignItems:"center",gap:5,background:userDropdown?"var(--gray-100)":"none",border:"1.5px solid",borderColor:userDropdown?"var(--gray-300)":"var(--gray-200)",borderRadius:20,padding:"4px 10px 4px 5px",cursor:"pointer",transition:"all .15s",maxWidth:160}}>
              <div style={{width:24,height:24,borderRadius:"50%",background:"var(--green-600)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:11,fontWeight:800,flexShrink:0}}>
                {(userDoc?.name||user.email||"U")[0].toUpperCase()}
              </div>
              <span style={{fontSize:12,fontWeight:600,color:"var(--gray-700)",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:80}}>{userDoc?.name||user.email?.split("@")[0]}</span>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="var(--gray-400)" strokeWidth="2.5" style={{flexShrink:0,transform:userDropdown?"rotate(180deg)":"rotate(0deg)",transition:"transform .2s"}}><polyline points="6 9 12 15 18 9"/></svg>
            </button>
            {userDropdown && (
              <div style={{position:"absolute",top:"calc(100% + 8px)",right:0,background:"#fff",borderRadius:14,boxShadow:"0 8px 32px rgba(0,0,0,0.14)",border:"1px solid var(--gray-100)",minWidth:180,zIndex:300,overflow:"hidden"}}>
                <div style={{padding:"12px 14px 8px",borderBottom:"1px solid var(--gray-100)"}}>
                  <div style={{fontWeight:700,fontSize:13,color:"var(--gray-900)"}}>{userDoc?.name||user.email?.split("@")[0]}</div>
                  <div style={{fontSize:11,color:"var(--gray-400)",marginTop:2}}>{user.email}</div>
                  <div style={{marginTop:4,display:"inline-block",fontSize:10,background:"var(--green-100)",color:"var(--green-700)",borderRadius:20,padding:"2px 8px",fontWeight:700}}>{userDoc?.role||"consultor"}</div>
                </div>
                <button onClick={()=>{setUserDropdown(false);signOut(auth);}}
                  style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"12px 14px",background:"none",border:"none",cursor:"pointer",textAlign:"left",color:"#dc2626",fontWeight:600,fontSize:13,transition:"background .12s"}}
                  onMouseEnter={e=>e.currentTarget.style.background="#fef2f2"}
                  onMouseLeave={e=>e.currentTarget.style.background="none"}>
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
                  Cerrar sesión
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Overlay para cerrar dropdowns al tocar fuera */}
        {(projDropdown||userDropdown) && (
          <div style={{position:"fixed",inset:0,zIndex:299}} onClick={()=>{setProjDropdown(false);setUserDropdown(false);}}/>
        )}
      </header>



      {/* Sin proyecto */}
      {!currentProject && (
        <div style={{...S.main,textAlign:"center",paddingTop:60}}>
          <div style={{fontSize:48,marginBottom:16}}>📁</div>
          <div style={{fontWeight:700,fontSize:20,color:"var(--gray-800)",marginBottom:8}}>No hay proyectos</div>
          <div style={{color:"var(--gray-500)",marginBottom:24}}>Crea un proyecto para cada tienda cliente</div>
          <button style={S.btn()} onClick={()=>setProjModal(true)}>+ Crear primer proyecto</button>
        </div>
      )}

      {currentProject && (
        <main style={S.main}>

          {/* ════ DASHBOARD ════ */}
          {tab==="dashboard" && (
            <div className="fadeUp">

              {/* ── Cabecera ── */}
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",marginBottom:20,flexWrap:"wrap",gap:10}}>
                <div>
                  <div style={{fontWeight:800,fontSize:isMobile?20:24,color:"var(--gray-900)",lineHeight:1.1}}>{currentProject.name}</div>
                  <div style={{fontSize:12,color:"var(--gray-400)",marginTop:3}}>{new Date().toLocaleDateString("es-CO",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
                </div>
                <button style={S.btn("var(--green-600)")} onClick={exportCSV}>⬇ CSV</button>
              </div>

              {/* ── KPIs: 2 columnas en móvil, 3 en desktop ── */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr 1fr":"repeat(3,1fr)",gap:10,marginBottom:14}}>
                {[
                  {lbl:"Productos",  val:products.length,                                                    icon:"📦", ac:"#22c55e", bg:"#f0fdf4"},
                  {lbl:"Valor",      val:"$"+Math.round(totalVal/1000)+"K",                                  icon:"💰", ac:"#3b82f6", bg:"#eff6ff"},
                  {lbl:"Categorías", val:[...new Set(products.map(p=>p.categoria).filter(Boolean))].length,  icon:"🏷️", ac:"#8b5cf6", bg:"#f5f3ff"},
                  {lbl:"Stock Bajo", val:alerts.filter(p=>p.stock>0).length,                                 icon:"⚠️", ac:"#f97316", bg:"#fff7ed"},
                  {lbl:"Sin Stock",  val:products.filter(p=>p.stock===0).length,                             icon:"🚨", ac:"#ef4444", bg:"#fef2f2"},
                  {lbl:"Master DB",  val:masterProducts.length,                                              icon:"🗄", ac:"#8b5cf6", bg:"#f5f3ff"},
                ].map(({lbl,val,icon,ac,bg})=>(
                  <div key={lbl} style={{background:bg,borderRadius:12,padding:isMobile?"12px 14px":"14px 16px",border:`1.5px solid ${ac}22`,position:"relative",overflow:"hidden"}}>
                    <div style={{position:"absolute",top:8,right:10,fontSize:isMobile?18:22,opacity:.15}}>{icon}</div>
                    <div style={{fontSize:10,fontWeight:700,color:"var(--gray-500)",textTransform:"uppercase",letterSpacing:.4,marginBottom:3,lineHeight:1.2}}>{lbl}</div>
                    <div style={{fontSize:isMobile?22:28,fontWeight:900,color:ac,lineHeight:1}}>{val}</div>
                  </div>
                ))}
              </div>

              {/* ── Barra de salud ── */}
              {products.length > 0 && (()=>{
                const ok   = products.filter(p=>p.stock>p.minimo).length;
                const bajo = alerts.filter(p=>p.stock>0).length;
                const cero = products.filter(p=>p.stock===0).length;
                const tot  = products.length;
                return (
                  <div style={{...S.card,marginBottom:14,padding:"14px 16px"}}>
                    <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:8}}>
                      <div style={{fontWeight:700,fontSize:13,color:"var(--gray-800)"}}>📊 Salud del inventario</div>
                      <div style={{fontSize:11,color:"var(--gray-400)"}}>{tot} productos</div>
                    </div>
                    <div style={{height:8,borderRadius:99,background:"var(--gray-100)",overflow:"hidden",display:"flex"}}>
                      <div style={{width:`${ok/tot*100}%`,background:"#22c55e"}}/>
                      <div style={{width:`${bajo/tot*100}%`,background:"#f97316"}}/>
                      <div style={{width:`${cero/tot*100}%`,background:"#ef4444"}}/>
                    </div>
                    <div style={{display:"flex",gap:12,marginTop:6,flexWrap:"wrap"}}>
                      {[[ok,"OK","#22c55e"],[bajo,"Bajo","#f97316"],[cero,"Sin stock","#ef4444"]].map(([n,l,c])=>(
                        <div key={l} style={{display:"flex",alignItems:"center",gap:4,fontSize:11}}>
                          <span style={{width:8,height:8,borderRadius:2,background:c,display:"inline-block"}}/>
                          <span style={{color:"var(--gray-500)"}}>{l}:</span>
                          <span style={{fontWeight:700,color:c}}>{n}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                );
              })()}

              {/* ── Layout adaptativo: stacked en móvil, 2 col en desktop ── */}
              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 260px",gap:14,alignItems:"start"}}>

                {/* Movimientos */}
                <div style={S.card}>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--gray-900)",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                    🕐 Últimos Movimientos
                    {movements.length>0 && <span style={{marginLeft:"auto",fontSize:11,color:"var(--gray-400)",fontWeight:400}}>{movements.length} total</span>}
                  </div>
                  {movements.length===0
                    ? <div style={{textAlign:"center",padding:"20px 0",color:"var(--gray-300)",fontSize:13}}>Sin movimientos aún</div>
                    : movements.slice(0,5).map(m=>(
                      <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"9px 0",borderBottom:"1px solid var(--gray-50)"}}>
                        <div style={{width:28,height:28,borderRadius:7,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:m.tipo==="entrada"?"#dcfce7":"#fee2e2",fontSize:13}}>{m.tipo==="entrada"?"📥":"📤"}</div>
                        <div style={{flex:1,minWidth:0}}>
                          <div style={{fontWeight:600,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nombre}</div>
                          <div style={{fontSize:10,color:"var(--gray-400)"}}>{fmtDt(m.fecha)}</div>
                        </div>
                        <span style={{fontWeight:800,fontSize:13,color:m.tipo==="entrada"?"var(--green-600)":"var(--red-500)",flexShrink:0}}>{m.tipo==="entrada"?"+":"-"}{m.cantidad}</span>
                      </div>
                    ))
                  }
                </div>

                {/* Columna alertas + accesos — en móvil va completa debajo */}
                <div style={{display:"flex",flexDirection:"column",gap:10}}>

                  {/* Alertas vencimiento */}
                  {expiryAlerts.length > 0 && (
                    <div style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:12,padding:"12px 14px"}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#92400e",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                        ⏰ Vencimientos <span style={{marginLeft:"auto",background:"#f59e0b",color:"#fff",borderRadius:20,padding:"1px 7px",fontSize:10}}>{expiryAlerts.length}</span>
                      </div>
                      {expiryAlerts.slice(0,4).map(p=>{
                        const s=expiryStatus(p.fechaVencimiento);
                        return (
                          <div key={p.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:"1px solid #fde68a"}}>
                            <span style={{fontSize:13,flexShrink:0}}>{s.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#92400e"}}>{p.nombre}</div>
                              <div style={{fontSize:10,color:"#b45309"}}>{s.label}</div>
                            </div>
                          </div>
                        );
                      })}
                      {expiryAlerts.length>4 && <div style={{fontSize:10,color:"#92400e",marginTop:4,textAlign:"center"}}>+{expiryAlerts.length-4} más</div>}
                    </div>
                  )}

                  {/* Alertas stock */}
                  {alerts.length > 0 ? (
                    <div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:12,padding:"12px 14px"}}>
                      <div style={{fontWeight:700,fontSize:12,color:"#991b1b",marginBottom:8,display:"flex",alignItems:"center",gap:6}}>
                        🚨 Stock crítico <span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:20,padding:"1px 7px",fontSize:10}}>{alerts.length}</span>
                      </div>
                      {alerts.slice(0,5).map(p=>(
                        <div key={p.id} style={{display:"flex",alignItems:"center",gap:6,padding:"5px 0",borderBottom:"1px solid #fee2e2"}}>
                          <span style={{fontSize:12,flexShrink:0}}>{p.stock===0?"🔴":"🟡"}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:p.stock===0?"#991b1b":"#92400e"}}>{p.nombre}</div>
                            <div style={{fontSize:10,color:"var(--gray-400)"}}>Stock: {p.stock} · Mín: {p.minimo}</div>
                          </div>
                          {p.stock===0 && <span style={{fontSize:9,fontWeight:800,color:"#fff",background:"#ef4444",borderRadius:4,padding:"2px 4px",flexShrink:0}}>PEDIR</span>}
                        </div>
                      ))}
                      {alerts.length>5 && <div style={{fontSize:10,color:"#991b1b",marginTop:4,textAlign:"center"}}>+{alerts.length-5} más</div>}
                    </div>
                  ) : (
                    <div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:12,padding:"12px 14px",textAlign:"center"}}>
                      <div style={{fontSize:22,marginBottom:4}}>✅</div>
                      <div style={{fontSize:12,fontWeight:600,color:"#166534"}}>Inventario OK</div>
                      <div style={{fontSize:10,color:"var(--green-600)",marginTop:2}}>Todo bien abastecido</div>
                    </div>
                  )}

                  {/* Accesos rápidos */}
                  {isConsultor && (
                    <div style={{background:"var(--white)",border:"1.5px solid var(--gray-100)",borderRadius:12,padding:"12px 14px"}}>
                      <div style={{fontWeight:700,fontSize:10,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.5,marginBottom:8}}>Accesos rápidos</div>
                      <div style={{display:isMobile?"grid":"flex",gridTemplateColumns:"1fr 1fr",flexDirection:"column",gap:6}}>
                        {[
                          {lbl:"📷 Registrar", fn:()=>setTab("registrar"), bg:"#f0fdf4",c:"#166534"},
                          {lbl:"↕ Movimiento", fn:()=>setMovModal(true),   bg:"#eff6ff",c:"#1d4ed8"},
                          {lbl:"🗺 Bodega",     fn:()=>setTab("bodega"),    bg:"#f5f3ff",c:"#7c3aed"},
                          {lbl:"📈 Análisis",   fn:()=>setTab("analisis"),  bg:"#fff7ed",c:"#c2410c"},
                        ].map(({lbl,fn,bg,c})=>(
                          <button key={lbl} onClick={fn} style={{padding:"8px 10px",background:bg,border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,color:c,textAlign:"left"}}>
                            {lbl}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

                    {/* ════ REGISTRAR ════ */}
          {tab==="registrar" && isConsultor && (
            <div className="fadeUp">
              <div style={S.secH}>
                <div><div style={S.secT}>Registrar Producto</div><div style={S.secS}>Escanea con Claude Vision — autopopula automáticamente</div></div>
              </div>
              <div style={S.card}>
                <div style={{fontWeight:700,fontSize:15,color:"var(--gray-900)",marginBottom:16}}>📷 Escanear con Claude Vision</div>
                <Scanner onResult={onScanResult} masterProducts={masterProducts} />
              </div>
              <div style={S.card}>
                <div style={{fontWeight:700,fontSize:15,color:"var(--gray-900)",marginBottom:16}}>✏️ Datos del Producto</div>
                <div style={S.fGrid}>
                  <div style={{...S.fGrp,gridColumn:"1/-1"}}>
                    <label style={S.lbl}>Nombre del Producto *</label>
                    <input id="form-nombre" style={S.inp} value={form.nombre} placeholder="Ej: Papi Papa Delgadas 60g" onChange={e=>setForm(f=>({...f,nombre:e.target.value}))}/>
                  </div>
                  <div style={S.fGrp}><label style={S.lbl}>Código Interno</label><input style={S.inp} value={form.codigo} placeholder="SNA-001" onChange={e=>setForm(f=>({...f,codigo:e.target.value}))}/></div>
                  <div style={S.fGrp}>
                    <label style={S.lbl}>Código de Barras</label>
                    <div style={{display:"flex",gap:8,alignItems:"center"}}>
                      <input style={{...S.inp,flex:1}} value={form.codigoBarras} placeholder="7702020012345" onChange={e=>setForm(f=>({...f,codigoBarras:e.target.value}))}/>
                      <label style={{
                        display:"inline-flex",alignItems:"center",gap:6,
                        padding:"9px 14px",borderRadius:"var(--radius)",
                        background:"var(--gray-800)",color:"#fff",
                        fontSize:12,fontWeight:600,cursor:"pointer",
                        flexShrink:0,whiteSpace:"nowrap",
                        border:"none",transition:"background .15s",
                      }}
                      title="Escanear solo el código de barras"
                      onMouseEnter={e=>e.currentTarget.style.background="#111"}
                      onMouseLeave={e=>e.currentTarget.style.background="var(--gray-800)"}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <rect x="3" y="3" width="4" height="18" rx="1"/><rect x="9" y="3" width="2" height="18" rx="1"/><rect x="13" y="3" width="4" height="18" rx="1"/><rect x="19" y="3" width="2" height="18" rx="1"/>
                        </svg>
                        Escanear código
                        <input type="file" accept="image/*" capture="environment" onChange={e=>{
                          if(!e.target.files[0]) return;
                          const file = e.target.files[0];
                          e.target.value="";
                          // Usar Claude Vision solo para extraer código de barras
                          const r = new FileReader();
                          r.onload = async ev => {
                            const b64 = ev.target.result.split(",")[1];
                            try {
                              const res = await fetch("/.netlify/functions/scan-product", {
                                method:"POST", headers:{"Content-Type":"application/json"},
                                body: JSON.stringify({imageBase64:b64, mimeType:"image/jpeg", barcodeOnly:true})
                              });
                              const data = await res.json();
                              const cb = data.product?.codigoBarras || data.codigoBarras;
                              if (cb && cb !== "N/A" && cb.length > 4) {
                                setForm(f=>({...f, codigoBarras:cb}));
                              } else {
                                alert("No se detectó código de barras. Intenta con mejor iluminación o más cerca.");
                              }
                            } catch(ex) { alert("Error al escanear: "+ex.message); }
                          };
                          r.readAsDataURL(file);
                        }}/>
                      </label>
                    </div>
                    {form.codigoBarras && (
                      <div style={{fontSize:11,color:"var(--gray-400)",marginTop:4,display:"flex",alignItems:"center",gap:4}}>
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12"/></svg>
                        Código detectado: <strong style={{color:"var(--gray-700)"}}>{form.codigoBarras}</strong>
                      </div>
                    )}
                  </div>
                  <div style={S.fGrp}><label style={S.lbl}>Categoría *</label>
                    <select style={S.inp} value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}>
                      <option value="">Seleccionar...</option>{getCats(currentProject?.name, products).map(x=><option key={x}>{x}</option>)}
                    </select>
                  </div>
                  <div style={S.fGrp}><label style={S.lbl}>Envase</label>
                    <select style={S.inp} value={form.envase} onChange={e=>setForm(f=>({...f,envase:e.target.value}))}>
                      <option value="">Seleccionar...</option>{ENVASES.map(x=><option key={x}>{x}</option>)}
                    </select>
                  </div>
                  <div style={S.fGrp}><label style={S.lbl}>Stock Actual *</label><input style={S.inp} type="number" value={form.stock} placeholder="0" onChange={e=>setForm(f=>({...f,stock:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Stock Mínimo</label><input style={S.inp} type="number" value={form.minimo} placeholder="5" onChange={e=>setForm(f=>({...f,minimo:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Precio Compra (COP)</label><input style={S.inp} type="number" value={form.precioCompra} placeholder="0" onChange={e=>setForm(f=>({...f,precioCompra:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Precio Venta (COP)</label><input style={S.inp} type="number" value={form.precioVenta} placeholder="0" onChange={e=>setForm(f=>({...f,precioVenta:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Proveedor</label><input style={S.inp} value={form.proveedor} placeholder="Distribuidora Caribe" onChange={e=>setForm(f=>({...f,proveedor:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Unidad</label>
                    <select style={S.inp} value={form.unidad} onChange={e=>setForm(f=>({...f,unidad:e.target.value}))}>
                      {UNITS.map(x=><option key={x}>{x}</option>)}
                    </select>
                  </div>
                  {/* FECHA DE VENCIMIENTO */}
                  <div style={S.fGrp}>
                    <label style={S.lbl}>📅 Fecha de Vencimiento</label>
                    <input style={S.inp} type="date" value={form.fechaVencimiento} onChange={e=>setForm(f=>({...f,fechaVencimiento:e.target.value}))}/>
                    {form.fechaVencimiento && <ExpiryBadge fecha={form.fechaVencimiento} />}
                  </div>
                  {/* LOTE */}
                  <div style={S.fGrp}>
                    <label style={S.lbl}>🏷️ Lote</label>
                    <input style={S.inp} value={form.lote} placeholder="Ej: L-2024-03A" onChange={e=>setForm(f=>({...f,lote:e.target.value}))}/>
                  </div>
                  {/* UBICACIÓN: ARMARIO + SEGMENTO */}
                  <div style={{...S.fGrp,gridColumn:"1/-1"}}>
                    <label style={S.lbl}>📦 Ubicación en bodega</label>
                    <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:10}}>
                      <div style={S.fGrp}>
                        <label style={{fontSize:11,color:"var(--gray-400)",fontWeight:600}}>Armario / Estante</label>
                        <input style={S.inp} value={form.armario} placeholder="Ej: A1, B2, Caja-3" onChange={e=>setForm(f=>({...f,armario:e.target.value}))}/>
                      </div>
                      <div style={S.fGrp}>
                        <label style={{fontSize:11,color:"var(--gray-400)",fontWeight:600}}>Segmento / Posición</label>
                        <input style={S.inp} value={form.segmento} placeholder="Ej: Fila-1, Nivel-2, Izq" onChange={e=>setForm(f=>({...f,segmento:e.target.value}))}/>
                      </div>
                    </div>
                    {(form.armario||form.segmento) && (
                      <div style={{marginTop:6,padding:"6px 12px",background:"var(--green-50)",borderRadius:8,fontSize:12,color:"var(--green-700)",fontWeight:600}}>
                        📍 {form.armario||"—"} › {form.segmento||"—"}
                      </div>
                    )}
                  </div>
                  <div style={{...S.fGrp,gridColumn:"1/-1"}}><label style={S.lbl}>Nota</label><textarea style={{...S.inp,minHeight:60,resize:"vertical"}} value={form.nota} placeholder="Observaciones..." onChange={e=>setForm(f=>({...f,nota:e.target.value}))}/></div>
                </div>
                <div style={{display:"flex",gap:10,marginTop:18,flexWrap:"wrap"}}>
                  <button style={S.btn("var(--green-600)")} onClick={saveProduct}>💾 Guardar en Firebase</button>
                  <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>setForm(emptyForm())}>🗑 Limpiar</button>
                </div>
              </div>
            </div>
          )}

          {/* ════ INVENTARIO ════ */}
          {tab==="inventario" && (
            <div className="fadeUp">
              <div style={S.secH}>
                <div><div style={S.secT}>Inventario</div><div style={S.secS}>{products.length} productos · {currentProject.name}</div></div>
                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                  <select style={{...S.inp,width:"auto",fontSize:12,padding:"7px 10px"}} value={catFilter} onChange={e=>setCatF(e.target.value)}>
                    <option value="">Todas las categorías</option>{getCats(currentProject?.name, products).map(x=><option key={x}>{x}</option>)}
                  </select>
                  {isConsultor && <button style={S.btn("var(--green-600)")} onClick={()=>goTab("registrar")}>+ Registrar</button>}
                </div>
              </div>
              <div style={S.card}>
                <input style={{...S.inp,marginBottom:14}} placeholder="🔍 Buscar nombre, código o código de barras..." value={search} onChange={e=>setSearch(e.target.value)}/>
                {filtered.length===0
                  ? <div style={{textAlign:"center",padding:"32px 0",color:"var(--gray-400)"}}>📦 No hay productos</div>
                  : <div style={{overflowX:"auto"}}><table>
                      <thead><tr>{["Producto","Categoría","Stock","Mín","Estado","Vencimiento","P.Venta",""].map((h,i)=>(
                        <th key={i} style={{...S.th,...(i===0?{borderRadius:"var(--radius) 0 0 var(--radius)"}:{}),...(i===7?{borderRadius:"0 var(--radius) var(--radius) 0"}:{})}}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {filtered.map(p=>{
                          const st  = stOf(p);
                          const col = CAT_COLOR[p.categoria]||"#9ca3af";
                          return editId===p.id ? (
                            <tr key={p.id} id={"inv-row-"+p.id} style={{background:"#f0fdf4"}}>
                              <td style={S.td} colSpan={6}>
                                <div style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"flex-end"}}>
                                  {[["stock","Stock",editData.stock,65],["minimo","Mín",editData.minimo,55],["precioCompra","P.Compra",editData.precioCompra,95],["precioVenta","P.Venta",editData.precioVenta,95]].map(([k,lbl,v,w])=>(
                                    <div key={k}><div style={{fontSize:10,color:"var(--gray-500)",marginBottom:3}}>{lbl}</div>
                                    <input style={{...S.inp,width:w,padding:"7px 9px"}} type="number" value={v} onChange={e=>setEditData(d=>({...d,[k]:Number(e.target.value)}))}/></div>
                                  ))}
                                  <div><div style={{fontSize:10,color:"var(--gray-500)",marginBottom:3}}>Lote</div>
                                  <input style={{...S.inp,width:80,padding:"7px 9px"}} value={editData.lote||""} placeholder="L-001" onChange={e=>setEditData(d=>({...d,lote:e.target.value}))}/></div>
                                  <div><div style={{fontSize:10,color:"var(--green-700)",fontWeight:700,marginBottom:3}}>📦 Armario</div>
                                  <input style={{...S.inp,width:85,padding:"7px 9px",borderColor:"#86efac"}} value={editData.armario||""} placeholder="Ej: A1" onChange={e=>setEditData(d=>({...d,armario:e.target.value}))}/></div>
                                  <div><div style={{fontSize:10,color:"var(--green-700)",fontWeight:700,marginBottom:3}}>📍 Segmento</div>
                                  <input style={{...S.inp,width:95,padding:"7px 9px",borderColor:"#86efac"}} value={editData.segmento||""} placeholder="Ej: Fila-2" onChange={e=>setEditData(d=>({...d,segmento:e.target.value}))}/></div>
                                  <div style={{display:"flex",gap:4,paddingBottom:1}}>
                                    <button style={S.bSm("var(--green-600)")} onClick={()=>saveEdit(p)}>✅ Guardar</button>
                                    <button style={S.bSm("var(--gray-100)","var(--gray-600)")} onClick={()=>setEditId(null)}>✖</button>
                                  </div>
                                </div>
                              </td>
                              <td style={S.td}></td>
                            </tr>
                          ) : (
                            <tr key={p.id}>
                              <td style={S.td}><div style={{fontWeight:600}}>{p.nombre}</div><div style={{fontSize:11,color:"var(--gray-400)"}}>{p.codigo}{p.codigoBarras?" · 🔲"+p.codigoBarras:""}</div></td>
                              <td style={S.td}><span style={{display:"inline-flex",alignItems:"center",gap:5}}><span style={{width:8,height:8,borderRadius:"50%",background:col,display:"inline-block"}}/>{p.categoria}</span></td>
                              <td style={S.td}><strong>{p.stock}</strong></td>
                              <td style={S.td}>{p.minimo}</td>
                              <td style={S.td}><span style={S.badge(st)}>{ST[st].label}</span></td>
                              <td style={S.td}><ExpiryBadge fecha={p.fechaVencimiento}/></td>
                              <td style={S.td}>{fmt(p.precioVenta)}</td>
                              <td style={S.td}>{isConsultor && <div style={{display:"flex",gap:4}}>
                                <button style={S.bSm("var(--blue-100)","var(--blue-500)")} onClick={()=>startEdit(p)}>✏️</button>
                                <button style={S.bSm("var(--red-100)","var(--red-500)")} onClick={()=>deleteProd(p)}>🗑</button>
                              </div>}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table></div>
                }
              </div>
            </div>
          )}

          {/* ════ MOVIMIENTOS ════ */}
          {tab==="movimientos" && isConsultor && (
            <div className="fadeUp">
              <div style={S.secH}>
                <div><div style={S.secT}>Movimientos</div><div style={S.secS}>Entradas y salidas de inventario</div></div>
                <button style={S.btn("var(--green-600)")} onClick={()=>setMovModal(true)}>+ Registrar</button>
              </div>
              <div style={S.card}>
                {movements.length===0
                  ? <div style={{textAlign:"center",padding:"32px 0",color:"var(--gray-400)"}}>Sin movimientos</div>
                  : movements.map(m=>(
                    <div key={m.id} style={S.movI}>
                      <div style={{width:34,height:34,borderRadius:10,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:m.tipo==="entrada"?"var(--green-100)":"var(--red-100)"}}>{m.tipo==="entrada"?"📥":"📤"}</div>
                      <div style={{flex:1,minWidth:0}}>
                        <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nombre}</div>
                        <div style={{fontSize:11,color:"var(--gray-400)"}}>{fmtDt(m.fecha)} · {m.motivo}</div>
                      </div>
                      <span style={{fontWeight:700,color:m.tipo==="entrada"?"var(--green-600)":"var(--red-500)",flexShrink:0}}>{m.tipo==="entrada"?"+":"-"}{m.cantidad}</span>
                    </div>
                  ))
                }
              </div>
            </div>
          )}

          {/* ════ DIFERENCIAL ════ */}
          {tab==="diferencial" && isConsultor && (
            <div className="fadeUp">
              <div style={S.secH}>
                <div><div style={S.secT}>Inventario Diferencial</div><div style={S.secS}>Compara stock actual vs inventario inicial · Calcula merma</div></div>
              </div>
              {masterProducts.length===0 ? (
                <div style={{...S.card,textAlign:"center",padding:"48px 20px"}}>
                  <div style={{fontSize:40,marginBottom:12}}>🗄</div>
                  <div style={{fontWeight:700,fontSize:18,color:"var(--gray-800)",marginBottom:8}}>No hay Master Database</div>
                  <div style={{color:"var(--gray-500)",marginBottom:20}}>Primero carga el inventario inicial en la pestaña "Master DB"</div>
                  <button style={S.btn()} onClick={()=>goTab("master")}>Ir a Master DB →</button>
                </div>
              ) : (
                <div style={S.card}>
                  <div style={{overflowX:"auto"}}><table>
                    <thead><tr>{["Producto","Stock Inicial","Stock Actual","Diferencia","Merma","Valor Merma","Estado"].map((h,i)=>(
                      <th key={i} style={{...S.th,...(i===0?{borderRadius:"var(--radius) 0 0 var(--radius)"}:{}),...(i===6?{borderRadius:"0 var(--radius) var(--radius) 0"}:{})}}>{h}</th>
                    ))}</tr></thead>
                    <tbody>
                      {calcDiff().length===0
                        ? <tr><td colSpan={7} style={{...S.td,textAlign:"center",color:"var(--gray-400)",padding:"32px 0"}}>No hay cruces entre el inventario actual y el master</td></tr>
                        : calcDiff().map((p,i)=>(
                          <tr key={i}>
                            <td style={S.td}><div style={{fontWeight:600}}>{p.nombre}</div></td>
                            <td style={S.td}>{p.stockInicial}</td>
                            <td style={S.td}><strong>{p.stock}</strong></td>
                            <td style={S.td}><span style={{color:p.diff>=0?"var(--green-600)":"var(--red-500)",fontWeight:700}}>{p.diff>=0?"+":""}{p.diff}</span></td>
                            <td style={S.td}><span style={{color:p.merma>0?"var(--red-500)":"var(--gray-400)",fontWeight:p.merma>0?700:400}}>{p.merma}</span></td>
                            <td style={S.td}><span style={{color:p.valorMerma>0?"var(--red-500)":"var(--gray-400)",fontWeight:p.valorMerma>0?700:400}}>{p.valorMerma>0?fmt(p.valorMerma):"—"}</span></td>
                            <td style={S.td}><span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:p.merma>0?"var(--red-100)":"var(--green-100)",color:p.merma>0?"#991b1b":"#166534"}}>{p.merma>0?"Con merma":"OK"}</span></td>
                          </tr>
                        ))
                      }
                    </tbody>
                  </table></div>
                  {calcDiff().length > 0 && (
                    <div style={{marginTop:16,padding:"14px 18px",background:"var(--red-100)",borderRadius:"var(--radius)",display:"flex",gap:20,flexWrap:"wrap"}}>
                      <div><div style={{fontSize:11,fontWeight:700,color:"#991b1b",textTransform:"uppercase"}}>Total Merma</div>
                      <div style={{fontSize:22,fontWeight:800,color:"#991b1b"}}>{calcDiff().reduce((s,p)=>s+p.merma,0)} unid</div></div>
                      <div><div style={{fontSize:11,fontWeight:700,color:"#991b1b",textTransform:"uppercase"}}>Valor Merma</div>
                      <div style={{fontSize:22,fontWeight:800,color:"#991b1b"}}>{fmt(calcDiff().reduce((s,p)=>s+p.valorMerma,0))}</div></div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ════ MASTER DB ════ */}
          {tab==="master" && isConsultor && (
            <div className="fadeUp">
              <div style={S.secH}>
                <div><div style={S.secT}>Master Database</div><div style={S.secS}>Catálogo de productos con precios reales y stock inicial</div></div>
                <button style={S.btn("var(--green-600)")} onClick={()=>setMasterModal(true)}>+ Agregar al Master</button>
              </div>
              <div style={S.card}>
                {masterProducts.length===0
                  ? <div style={{textAlign:"center",padding:"32px 0",color:"var(--gray-400)"}}>
                      <div style={{fontSize:36,marginBottom:12}}>🗄</div>
                      <div style={{fontWeight:600,marginBottom:8}}>Sin productos en el master</div>
                      <div style={{fontSize:13,marginBottom:16}}>Agrega el inventario inicial aquí con precios reales</div>
                    </div>
                  : <div style={{overflowX:"auto"}}><table>
                      <thead><tr>{["Nombre","Código Barras","P.Compra","P.Venta","Stock Inicial","Proveedor",""].map((h,i)=>(
                        <th key={i} style={{...S.th,...(i===0?{borderRadius:"var(--radius) 0 0 var(--radius)"}:{}),...(i===6?{borderRadius:"0 var(--radius) var(--radius) 0"}:{})}}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {masterProducts.map(m=>(
                          <tr key={m.id}>
                            <td style={S.td}><div style={{fontWeight:600}}>{m.nombre}</div></td>
                            <td style={S.td}><span style={{fontSize:12,color:"var(--gray-400)"}}>{m.codigoBarras||"—"}</span></td>
                            <td style={S.td}>{fmt(m.precioCompra)}</td>
                            <td style={S.td}>{fmt(m.precioVenta)}</td>
                            <td style={S.td}><strong>{m.stockInicial||0}</strong></td>
                            <td style={S.td}>{m.proveedor||"—"}</td>
                            <td style={S.td}><button style={S.bSm("var(--red-100)","var(--red-500)")} onClick={async()=>{ await deleteDoc(doc(db,`projects/${currentProject.id}/masterProducts`,m.id)); setMasterProducts(p=>p.filter(x=>x.id!==m.id)); }}>🗑</button></td>
                          </tr>
                        ))}
                      </tbody>
                    </table></div>
                }
              </div>
            </div>
          )}

          {/* ════ MAPA DE BODEGA ════ */}
          {tab==="bodega" && isConsultor && (
            <div className="fadeUp">
              {/* ── Header bodega ── */}
              <div style={{marginBottom:20}}>
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:10,marginBottom:14}}>
                  <div><div style={S.secT}>🗺 Mapa de Bodega</div><div style={S.secS}>Toca un armario para ver detalle</div></div>
                  <button onClick={()=>{setAddToCajaModal({armario:"",segmento:""});setAddSearch("");setAddSegmento("");}} style={{
                    display:"flex",alignItems:"center",gap:8,
                    padding:"10px 18px",background:"var(--green-700)",color:"#fff",
                    border:"none",borderRadius:12,cursor:"pointer",
                    fontSize:13,fontWeight:700,boxShadow:"0 2px 8px rgba(21,128,61,.3)",
                  }}>
                    <span style={{fontSize:18,lineHeight:1}}>+</span> Agregar producto
                  </button>
                </div>

                {/* ── Barra de búsqueda ── */}
                {products.length > 0 && (
                  <div style={{position:"relative"}}>
                    <svg style={{position:"absolute",left:14,top:"50%",transform:"translateY(-50%)",color:"var(--gray-400)",pointerEvents:"none",zIndex:1}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                    <input
                      style={{...S.inp, paddingLeft:42, paddingRight:16, borderRadius:12, fontSize:14, boxShadow:"0 1px 4px rgba(0,0,0,0.06)"}}
                      placeholder="Buscar producto en bodega..."
                      value={addSearch}
                      onChange={e=>setAddSearch(e.target.value)}
                      onFocus={e=>{e.target.style.boxShadow="0 0 0 3px rgba(21,128,61,.15)";e.target.style.borderColor="var(--green-400)";}}
                      onBlur={e=>{e.target.style.boxShadow="0 1px 4px rgba(0,0,0,0.06)";e.target.style.borderColor="var(--gray-200)";}}
                    />
                    {/* Resultados de búsqueda */}
                    {addSearch.trim().length > 0 && (()=>{
                      const q = addSearch.trim().toLowerCase();
                      const results = products.filter(p =>
                        p.nombre?.toLowerCase().includes(q) ||
                        p.codigo?.toLowerCase().includes(q) ||
                        p.codigoBarras?.includes(q)
                      ).slice(0, 8);
                      return results.length > 0 ? (
                        <div style={{
                          position:"absolute", top:"calc(100% + 6px)", left:0, right:0,
                          background:"#fff", borderRadius:14, zIndex:200,
                          boxShadow:"0 8px 32px rgba(0,0,0,0.14)", border:"1px solid var(--gray-100)",
                          overflow:"hidden",
                        }}>
                          {results.map(p => {
                            const ai = [...new Set(products.filter(x=>x.armario).map(x=>x.armario))].sort().indexOf(p.armario);
                            const ac = p.armario ? ARM_COLORS[ai % ARM_COLORS.length] : null;
                            return (
                              <button key={p.id} onClick={()=>{
                                setAddSearch("");
                                if (p.armario) {
                                  // Abrir la vista del armario y resaltar el producto
                                  const armItems = products.filter(x=>x.armario===p.armario);
                                  const armBySegmento = {};
                                  armItems.forEach(x=>{const s=x.segmento||"General";if(!armBySegmento[s])armBySegmento[s]=[];armBySegmento[s].push(x);});
                                  const armSegs = Object.keys(armBySegmento).sort();
                                  const armAi = [...new Set(products.filter(x=>x.armario).map(x=>x.armario))].sort().indexOf(p.armario);
                                  const armAc = ARM_COLORS[armAi % ARM_COLORS.length];
                                  setArmarioVista({armario:p.armario,items:armItems,bySegmento:armBySegmento,segs:armSegs,ac:armAc});
                                  setBodegaHighlight(p.id);
                                  setTimeout(()=>{
                                    const el = document.getElementById("bodega-prod-"+p.id);
                                    el?.scrollIntoView({behavior:"smooth",block:"center"});
                                  }, 300);
                                  setTimeout(()=>setBodegaHighlight(null), 2500);
                                }
                              }} style={{
                                display:"flex",alignItems:"center",gap:12,width:"100%",
                                padding:"11px 16px",background:"none",border:"none",
                                borderBottom:"1px solid var(--gray-50)",cursor:"pointer",
                                textAlign:"left",transition:"background .12s",
                              }}
                              onMouseEnter={e=>e.currentTarget.style.background="#f0fdf4"}
                              onMouseLeave={e=>e.currentTarget.style.background="none"}>
                                {/* Dot color categoría */}
                                <div style={{width:8,height:8,borderRadius:"50%",background:CAT_COLOR[p.categoria]||"#9ca3af",flexShrink:0}}/>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                                  <div style={{fontSize:11,color:"var(--gray-400)",marginTop:1}}>{p.categoria||""}</div>
                                </div>
                                {/* Pill de ubicación */}
                                {p.armario ? (
                                  <div style={{
                                    display:"flex",alignItems:"center",gap:5,
                                    background:ac?ac.bg:"var(--gray-700)",
                                    color:"#fff",borderRadius:20,
                                    padding:"3px 10px",fontSize:11,fontWeight:700,flexShrink:0,
                                  }}>
                                    📦 {p.armario}{p.segmento?` / ${p.segmento}`:""}
                                  </div>
                                ) : (
                                  <span style={{fontSize:11,color:"#f59e0b",fontWeight:600,flexShrink:0}}>Sin ubicar</span>
                                )}
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <div style={{position:"absolute",top:"calc(100% + 6px)",left:0,right:0,background:"#fff",borderRadius:14,zIndex:200,boxShadow:"0 8px 32px rgba(0,0,0,0.14)",border:"1px solid var(--gray-100)",padding:"16px",textAlign:"center",color:"var(--gray-400)",fontSize:13}}>
                          Sin resultados para "{addSearch}"
                        </div>
                      );
                    })()}
                  </div>
                )}
              </div>
              {(() => {
                const byArmario = {};
                products.forEach(p => {
                  const arm = p.armario || "__sin__";
                  if (!byArmario[arm]) byArmario[arm] = [];
                  byArmario[arm].push(p);
                });
                const ubicados  = Object.keys(byArmario).filter(k=>k!=="__sin__").sort();
                const sinUbicar = byArmario["__sin__"] || [];

                return (
                  <div>
                    {/* ── Sin ubicar ── */}
                    {sinUbicar.length > 0 && (
                      <div style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:14,padding:"14px 16px",marginBottom:16}}>
                        <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:10}}>
                          ⚠️ {sinUbicar.length} producto{sinUbicar.length>1?"s":""} sin ubicación — toca para asignar
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {sinUbicar.map(p=>(
                            <button key={p.id} onClick={()=>{
                              setEditQuickId(p.id); setTab("inventario"); startEdit(p);
                              setTimeout(()=>document.getElementById("inv-row-"+p.id)?.scrollIntoView({behavior:"smooth",block:"center"}),400);
                            }} style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"10px 14px",background:"#fff",border:"1.5px solid #fcd34d",borderRadius:10,cursor:"pointer",textAlign:"left",width:"100%"}}
                            onMouseEnter={e=>e.currentTarget.style.background="#fef3c7"}
                            onMouseLeave={e=>e.currentTarget.style.background="#fff"}>
                              <div>
                                <div style={{fontWeight:600,fontSize:13,color:"#92400e"}}>{p.nombre}</div>
                                <div style={{fontSize:11,color:"#b45309",marginTop:2}}>Stock: {p.stock} · {p.categoria||"Sin categoría"}</div>
                              </div>
                              <span style={{fontSize:11,fontWeight:700,color:"#fff",background:"#f59e0b",borderRadius:20,padding:"3px 10px",flexShrink:0,whiteSpace:"nowrap"}}>📍 Asignar →</span>
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {ubicados.length===0 && sinUbicar.length===0 && (
                      <div style={{...S.card,textAlign:"center",padding:"48px 20px"}}>
                        <div style={{fontSize:48,marginBottom:12}}>🗺</div>
                        <div style={{fontWeight:700,fontSize:18,color:"var(--gray-800)",marginBottom:8}}>El mapa está vacío</div>
                        <div style={{color:"var(--gray-500)",marginBottom:20}}>Registra productos y asígnales Armario y Segmento para verlos aquí</div>
                        <button style={S.btn()} onClick={()=>goTab("registrar")}>📷 Ir a Registrar</button>
                      </div>
                    )}

                    {/* ── Grid de armarios ── */}
                    <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"repeat(auto-fill,minmax(280px,1fr))",gap:14}}>
                      {ubicados.map((armario, ai) => {
                        const ac = ARM_COLORS[ai % ARM_COLORS.length];
                        const items = byArmario[armario];
                        const armCardId = "arm-card-"+armario.replace(/\s+/g,"-");
                        const bySegmento = {};
                        items.forEach(p => {
                          const seg = p.segmento || "General";
                          if (!bySegmento[seg]) bySegmento[seg] = [];
                          bySegmento[seg].push(p);
                        });
                        const segs = Object.keys(bySegmento).sort();
                        return (
                          <div key={armario} id={armCardId} style={{background:"var(--white)",borderRadius:16,overflow:"hidden",boxShadow:"var(--shadow-sm)",border:`1.5px solid ${ac.border}`}}>
                            {/* Cabecera armario */}
                            <div style={{display:"flex",alignItems:"stretch"}}>
                              <button onClick={()=>setArmarioVista({armario,items,bySegmento,segs,ac})}
                                style={{flex:1,background:ac.bg,padding:"14px 16px",display:"flex",alignItems:"center",gap:10,border:"none",cursor:"pointer",textAlign:"left",borderRadius:"16px 0 0 0"}}>
                                <div style={{width:38,height:38,borderRadius:10,background:"rgba(255,255,255,0.2)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:20,flexShrink:0}}>🗄</div>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontWeight:800,fontSize:16,color:ac.text}}>{armario}</div>
                                  <div style={{fontSize:11,color:"rgba(255,255,255,0.75)"}}>{items.length} producto{items.length>1?"s":""} · {segs.length} segmento{segs.length>1?"s":""}</div>
                                </div>
                                <span style={{fontSize:11,color:"rgba(255,255,255,0.6)",flexShrink:0}}>ver →</span>
                              </button>
                              {/* Botón + con color del armario */}
                              <button onClick={e=>{e.stopPropagation();setAddToCajaModal({armario,segmento:""});setAddSegmento("");setAddSearch("");}}
                                style={{background:ac.bg,border:"none",borderLeft:"1.5px solid rgba(255,255,255,0.2)",cursor:"pointer",
                                  padding:"0 18px",color:"#fff",fontSize:24,fontWeight:300,display:"flex",alignItems:"center",justifyContent:"center",
                                  borderRadius:"0 16px 0 0",flexShrink:0,minWidth:48,transition:"filter .15s"}}
                                onMouseEnter={e=>e.currentTarget.style.filter="brightness(1.2)"}
                                onMouseLeave={e=>e.currentTarget.style.filter="brightness(1)"}
                                title={`Agregar producto a ${armario}`}>
                                +
                              </button>
                            </div>

                            {/* ── Descripción de la caja (segmentos como resumen) ── */}
                            <div style={{padding:"10px 12px 12px",display:"flex",flexDirection:"column",gap:6}}>
                              {/* KPIs rápidos */}
                              <div style={{display:"flex",gap:8,marginBottom:4}}>
                                <div style={{flex:1,textAlign:"center",padding:"7px 4px",background:"var(--gray-50)",borderRadius:8}}>
                                  <div style={{fontSize:16,fontWeight:800,color:"var(--gray-800)"}}>{items.length}</div>
                                  <div style={{fontSize:9,color:"var(--gray-400)",fontWeight:600,textTransform:"uppercase"}}>Productos</div>
                                </div>
                                <div style={{flex:1,textAlign:"center",padding:"7px 4px",background:items.filter(p=>p.stock===0).length>0?"#fef2f2":"var(--gray-50)",borderRadius:8}}>
                                  <div style={{fontSize:16,fontWeight:800,color:items.filter(p=>p.stock===0).length>0?"#dc2626":"var(--gray-800)"}}>{items.filter(p=>p.stock===0).length}</div>
                                  <div style={{fontSize:9,color:"var(--gray-400)",fontWeight:600,textTransform:"uppercase"}}>Sin stock</div>
                                </div>
                                <div style={{flex:1,textAlign:"center",padding:"7px 4px",background:"var(--gray-50)",borderRadius:8}}>
                                  <div style={{fontSize:16,fontWeight:800,color:"var(--gray-800)"}}>{segs.length}</div>
                                  <div style={{fontSize:9,color:"var(--gray-400)",fontWeight:600,textTransform:"uppercase"}}>Secciones</div>
                                </div>
                              </div>
                              {/* Pills de segmentos */}
                              <div style={{display:"flex",flexWrap:"wrap",gap:5}}>
                                {segs.map((seg,si)=>{
                                  const sc = SEG_COLORS[si % SEG_COLORS.length];
                                  const cnt = bySegmento[seg].length;
                                  const lowStock = bySegmento[seg].filter(p=>p.stock===0).length;
                                  return (
                                    <div key={seg} style={{display:"flex",alignItems:"center",gap:4,padding:"4px 10px",borderRadius:20,background:sc.bg,border:`1px solid ${sc.border}`,fontSize:11,fontWeight:600,color:sc.text}}>
                                      {seg}
                                      <span style={{background:sc.num,color:"#fff",borderRadius:20,padding:"0 5px",fontSize:10,fontWeight:800,minWidth:16,textAlign:"center"}}>{cnt}</span>
                                      {lowStock>0 && <span style={{background:"#ef4444",color:"#fff",borderRadius:20,padding:"0 4px",fontSize:9,fontWeight:800}}>!{lowStock}</span>}
                                    </div>
                                  );
                                })}
                              </div>
                              {/* Botón ver detalle */}
                              <button onClick={()=>setArmarioVista({armario,items,bySegmento,segs,ac})}
                                style={{marginTop:4,padding:"8px",background:"var(--gray-50)",border:"1px dashed var(--gray-200)",borderRadius:10,cursor:"pointer",fontSize:12,color:"var(--gray-500)",fontWeight:600,textAlign:"center",transition:"all .15s"}}
                                onMouseEnter={e=>{e.currentTarget.style.background=ac.bg;e.currentTarget.style.color="#fff";e.currentTarget.style.borderColor=ac.bg;}}
                                onMouseLeave={e=>{e.currentTarget.style.background="var(--gray-50)";e.currentTarget.style.color="var(--gray-500)";e.currentTarget.style.borderColor="var(--gray-200)";}}>
                                Ver contenido completo →
                              </button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}

              {/* ── VISTA COMPLETA DE ARMARIO (full screen) ── */}
              {armarioVista && (
                <div style={{
                  position:"fixed", inset:0, zIndex:500,
                  background:"#f8fafc",
                  display:"flex", flexDirection:"column",
                  overflowY:"auto",
                }}>
                  {/* ── Barra superior del armario ── */}
                  <div style={{
                    background:armarioVista.ac.bg,
                    padding:"0 20px",
                    display:"flex", alignItems:"center", gap:14,
                    height:64, flexShrink:0,
                    position:"sticky", top:0, zIndex:10,
                    boxShadow:"0 2px 12px rgba(0,0,0,0.18)",
                  }}>
                    <button onClick={()=>setArmarioVista(null)} style={{
                      background:"rgba(255,255,255,0.18)", border:"none",
                      color:"#fff", width:36, height:36, borderRadius:10,
                      cursor:"pointer", fontSize:18, display:"flex",
                      alignItems:"center", justifyContent:"center", flexShrink:0,
                    }}>←</button>
                    <div style={{
                      width:42, height:42, borderRadius:12,
                      background:"rgba(255,255,255,0.18)",
                      display:"flex", alignItems:"center", justifyContent:"center",
                      fontSize:22, flexShrink:0,
                    }}>🗄</div>
                    <div style={{flex:1, minWidth:0}}>
                      <div style={{fontWeight:800, fontSize:20, color:"#fff", lineHeight:1.1}}>
                        {armarioVista.armario}
                      </div>
                      <div style={{fontSize:12, color:"rgba(255,255,255,0.72)", marginTop:2}}>
                        {armarioVista.items.length} producto{armarioVista.items.length>1?"s":""} · {armarioVista.segs.length} segmento{armarioVista.segs.length>1?"s":""}
                      </div>
                    </div>
                    <div style={{display:"flex",gap:8,flexShrink:0}}>
                      <button onClick={()=>{setAddToCajaModal({armario:armarioVista.armario,segmento:""});setAddSearch("");setAddSegmento("");}}
                        style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",height:36,padding:"0 14px",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
                        <span style={{fontSize:18,lineHeight:1}}>+</span> Agregar
                      </button>
                      <button onClick={()=>eliminarCaja(armarioVista.armario, armarioVista.items)}
                        title="Eliminar esta caja"
                        style={{background:"rgba(239,68,68,0.25)",border:"none",color:"#fff",height:36,padding:"0 12px",borderRadius:10,cursor:"pointer",fontSize:13,fontWeight:700,display:"flex",alignItems:"center",gap:5}}>
                        🗑 Caja
                      </button>
                      <button onClick={()=>setArmarioVista(null)} style={{
                        background:"rgba(255,255,255,0.18)", border:"none",
                        color:"#fff", width:36, height:36, borderRadius:10,
                        cursor:"pointer", fontSize:16, display:"flex",
                        alignItems:"center", justifyContent:"center", flexShrink:0,
                      }}>✕</button>
                    </div>
                  </div>

                  {/* ── Resumen rápido ── */}
                  <div style={{
                    display:"flex", gap:10, padding:"16px 20px 0",
                    flexWrap:"wrap",
                  }}>
                    {[
                      {lbl:"Total productos", val:armarioVista.items.length, icon:"📦"},
                      {lbl:"Con stock",        val:armarioVista.items.filter(p=>p.stock>0).length, icon:"✅"},
                      {lbl:"Sin stock",        val:armarioVista.items.filter(p=>p.stock===0).length, icon:"🚨"},
                      {lbl:"Segmentos",        val:armarioVista.segs.length, icon:"🗂"},
                    ].map(({lbl,val,icon})=>(
                      <div key={lbl} style={{
                        background:"#fff", borderRadius:12, padding:"12px 16px",
                        border:"1px solid #e5e7eb", flex:"1 1 120px",
                        display:"flex", alignItems:"center", gap:10,
                      }}>
                        <span style={{fontSize:20}}>{icon}</span>
                        <div>
                          <div style={{fontSize:10, color:"#9ca3af", fontWeight:700, textTransform:"uppercase", letterSpacing:.4}}>{lbl}</div>
                          <div style={{fontSize:22, fontWeight:900, color:"#111827", lineHeight:1.1}}>{val}</div>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* ── Segmentos ── */}
                  <div style={{padding:"16px 20px 32px", display:"flex", flexDirection:"column", gap:14}}>
                    {armarioVista.segs.map((seg, si) => {
                      const sc    = SEG_COLORS[si % SEG_COLORS.length];
                      const prods = armarioVista.bySegmento[seg];
                      const conStock = prods.filter(p=>p.stock>0).length;
                      const sinStock = prods.filter(p=>p.stock===0).length;
                      return (
                        <div key={seg} style={{
                          background:"#fff", borderRadius:16,
                          border:`2px solid ${sc.border}`,
                          overflow:"hidden",
                          boxShadow:"0 1px 4px rgba(0,0,0,0.06)",
                        }}>
                          {/* Cabecera segmento */}
                          <div style={{
                            background:sc.bg, padding:"12px 18px",
                            display:"flex", alignItems:"center", gap:10,
                          }}>
                            <span style={{
                              background:sc.num, color:"#fff",
                              width:26, height:26, borderRadius:7,
                              display:"inline-flex", alignItems:"center",
                              justifyContent:"center", fontSize:13,
                              fontWeight:800, flexShrink:0,
                            }}>{si+1}</span>
                            <span style={{fontWeight:700, fontSize:15, color:sc.text, flex:1}}>{seg}</span>
                            <div style={{display:"flex", gap:8, alignItems:"center"}}>
                              {sinStock > 0 && (
                                <span style={{fontSize:11, fontWeight:700, color:"#991b1b", background:"#fee2e2", borderRadius:20, padding:"2px 8px"}}>
                                  {sinStock} sin stock
                                </span>
                              )}
                              <span style={{fontSize:11, color:sc.text, opacity:.65, fontWeight:600}}>
                                {prods.length} item{prods.length>1?"s":""}
                              </span>
                            </div>
                          </div>

                          {/* Lista de productos con acciones */}
                          <div style={{padding:"8px 10px", display:"flex", flexDirection:"column", gap:6}}>
                            {prods.map((p, pi) => {
                              const stBg  = p.stock===0?"#fef2f2":p.stock<=p.minimo?"#fffbeb":"#f0fdf4";
                              const stCol = p.stock===0?"#991b1b":p.stock<=p.minimo?"#92400e":"#166534";
                              const stBd  = p.stock===0?"#fecaca":p.stock<=p.minimo?"#fde68a":"#bbf7d0";
                              const isEditing = bodegaEditId === p.id;
                              return (
                                <div key={p.id} id={"bodega-prod-"+p.id} style={{
                                  borderRadius:12, overflow:"hidden",
                                  border: bodegaHighlight===p.id ? "2.5px solid var(--green-500)" : isEditing ? "2px solid var(--green-400)" : "1px solid #f0f0f0",
                                  background: bodegaHighlight===p.id ? "#dcfce7" : isEditing ? "#f0fdf4" : "#fafafa",
                                  transition:"all .3s",
                                  boxShadow: bodegaHighlight===p.id ? "0 0 0 4px rgba(34,197,94,.2)" : "none",
                                }}>
                                  {/* Fila principal */}
                                  <div style={{display:"flex", alignItems:"center", gap:10, padding:"10px 12px"}}>
                                    {/* Número */}
                                    <span style={{
                                      width:22, height:22, borderRadius:6,
                                      background:sc.bg, color:"#fff",
                                      display:"inline-flex", alignItems:"center",
                                      justifyContent:"center", fontSize:10,
                                      fontWeight:800, flexShrink:0,
                                    }}>{pi+1}</span>

                                    {/* Nombre + meta */}
                                    <div style={{flex:1, minWidth:0}}>
                                      {isEditing ? (
                                        <input value={bodegaEditData.nombre||""} onChange={e=>setBodegaEditData(d=>({...d,nombre:e.target.value}))}
                                          style={{...S.inp,fontSize:13,padding:"5px 8px",marginBottom:0}} placeholder="Nombre"/>
                                      ) : (
                                        <div style={{fontWeight:600,fontSize:13,color:"#111827",overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                                      )}
                                      {!isEditing && (
                                        <div style={{display:"flex",gap:6,marginTop:3,flexWrap:"wrap"}}>
                                          {p.categoria && <span style={{fontSize:10,color:"#6b7280",background:"#f3f4f6",borderRadius:20,padding:"1px 7px",fontWeight:600}}>{p.categoria}</span>}
                                          {p.lote && <span style={{fontSize:10,color:"#6b7280",background:"#f3f4f6",borderRadius:20,padding:"1px 7px"}}>Lote: {p.lote}</span>}
                                          {p.fechaVencimiento && <span style={{fontSize:10,color:"#92400e",background:"#fef3c7",borderRadius:20,padding:"1px 7px",fontWeight:600}}>Vence: {new Date(p.fechaVencimiento).toLocaleDateString("es-CO",{day:"2-digit",month:"short"})}</span>}
                                        </div>
                                      )}
                                    </div>

                                    {/* Stock — editable */}
                                    {isEditing ? (
                                      <input type="number" value={bodegaEditData.stock||""} onChange={e=>setBodegaEditData(d=>({...d,stock:e.target.value}))}
                                        style={{...S.inp,width:64,fontSize:13,padding:"5px 8px",textAlign:"center"}} placeholder="Stock"/>
                                    ) : (
                                      <div style={{display:"flex",flexDirection:"column",alignItems:"flex-end",gap:3,flexShrink:0}}>
                                        <span style={{padding:"4px 11px",borderRadius:20,fontSize:13,fontWeight:800,background:stBg,color:stCol,border:`1px solid ${stBd}`}}>
                                          {p.stock} {p.unidad||"unid"}
                                        </span>
                                        {p.stock===0 && <span style={{fontSize:9,fontWeight:800,color:"#fff",background:"#ef4444",borderRadius:4,padding:"2px 6px"}}>PEDIR YA</span>}
                                        {p.stock>0&&p.stock<=p.minimo && <span style={{fontSize:9,fontWeight:800,color:"#92400e",background:"#fef3c7",borderRadius:4,padding:"2px 6px"}}>BAJO</span>}
                                      </div>
                                    )}

                                    {/* Botones de acción */}
                                    {isEditing ? (
                                      <div style={{display:"flex",gap:5,flexShrink:0}}>
                                        <button onClick={()=>saveBodegaEdit(p)} style={{background:"var(--green-600)",border:"none",color:"#fff",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12,fontWeight:700}}>✓</button>
                                        <button onClick={()=>{setBodegaEditId(null);setBodegaEditData({});}} style={{background:"var(--gray-100)",border:"none",color:"var(--gray-600)",borderRadius:8,padding:"6px 10px",cursor:"pointer",fontSize:12}}>✕</button>
                                      </div>
                                    ) : (
                                      <div style={{display:"flex",gap:4,flexShrink:0}}>
                                        {/* Movimiento */}
                                        <button onClick={()=>setMovCajaModal({prod:p})}
                                          title="Registrar movimiento"
                                          style={{background:"#eff6ff",border:"none",color:"#1d4ed8",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:14,flexShrink:0}}>
                                          ↕
                                        </button>
                                        {/* Editar */}
                                        <button onClick={()=>startBodegaEdit(p)}
                                          title="Editar producto"
                                          style={{background:"#f0fdf4",border:"none",color:"var(--green-700)",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>
                                          ✏️
                                        </button>
                                        {/* Remover de caja */}
                                        <button onClick={()=>removerDeCaja(p)}
                                          title="Remover de esta caja"
                                          style={{background:"#fff7ed",border:"none",color:"#c2410c",borderRadius:8,width:30,height:30,cursor:"pointer",display:"flex",alignItems:"center",justifyContent:"center",fontSize:13,flexShrink:0}}>
                                          ⊖
                                        </button>
                                      </div>
                                    )}
                                  </div>

                                  {/* Fila extra de edición */}
                                  {isEditing && (
                                    <div style={{padding:"0 12px 10px",display:"flex",gap:8,flexWrap:"wrap"}}>
                                      <input type="number" value={bodegaEditData.minimo||""} onChange={e=>setBodegaEditData(d=>({...d,minimo:e.target.value}))}
                                        style={{...S.inp,flex:1,minWidth:80,fontSize:12,padding:"5px 8px"}} placeholder="Mínimo"/>
                                      <input type="number" value={bodegaEditData.precioCompra||""} onChange={e=>setBodegaEditData(d=>({...d,precioCompra:e.target.value}))}
                                        style={{...S.inp,flex:1,minWidth:80,fontSize:12,padding:"5px 8px"}} placeholder="P.Compra"/>
                                      <input type="number" value={bodegaEditData.precioVenta||""} onChange={e=>setBodegaEditData(d=>({...d,precioVenta:e.target.value}))}
                                        style={{...S.inp,flex:1,minWidth:80,fontSize:12,padding:"5px 8px"}} placeholder="P.Venta"/>
                                      <input value={bodegaEditData.lote||""} onChange={e=>setBodegaEditData(d=>({...d,lote:e.target.value}))}
                                        style={{...S.inp,flex:1,minWidth:80,fontSize:12,padding:"5px 8px"}} placeholder="Lote"/>
                                    </div>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ════ ANÁLISIS ════ */}
          {tab==="analisis" && (
            <div className="fadeUp">
              <div style={S.secH}><div><div style={S.secT}>Análisis</div><div style={S.secS}>Inteligencia para tu negocio</div></div></div>

              <div style={{display:"grid",gridTemplateColumns:isMobile?"1fr":"1fr 1fr",gap:14,marginBottom:14}}>
                {/* Gráfica por categoría */}
                <div style={{...S.card,marginBottom:0}}>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--gray-900)",marginBottom:12}}>📦 Stock por Categoría</div>
                  {(()=>{
                    const cats={};products.forEach(p=>{cats[p.categoria]=(cats[p.categoria]||0)+p.stock;});
                    const entries=Object.entries(cats);const max=Math.max(...entries.map(([,v])=>v),1);
                    return entries.length===0?<div style={{color:"var(--gray-400)",fontSize:13}}>Sin datos</div>
                      :<div style={{display:"flex",gap:5,alignItems:"flex-end",height:130}}>
                        {entries.map(([cat,val])=>(
                          <div key={cat} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                            <span style={{fontSize:10,fontWeight:700,color:"var(--gray-600)"}}>{val}</span>
                            <div style={{width:"100%",height:Math.max(10,val/max*110),background:CAT_COLOR[cat]||"#9ca3af",borderRadius:"6px 6px 0 0"}} title={cat}/>
                            <span style={{fontSize:9,color:"var(--gray-400)",textAlign:"center"}}>{cat.split(" ")[0]}</span>
                          </div>
                        ))}
                      </div>;
                  })()}
                </div>

                {/* Márgenes */}
                <div style={{...S.card,marginBottom:0}}>
                  <div style={{fontWeight:700,fontSize:14,color:"var(--gray-900)",marginBottom:12}}>💰 Top Márgenes</div>
                  {(()=>{
                    const wm=products.filter(p=>p.precioVenta>0&&p.precioCompra>0).map(p=>({...p,mg:((p.precioVenta-p.precioCompra)/p.precioVenta*100)})).sort((a,b)=>b.mg-a.mg);
                    return wm.length===0?<div style={{color:"var(--gray-400)",fontSize:13}}>Agrega precios</div>
                      :wm.slice(0,6).map(p=>{
                        const col=p.mg>25?"var(--green-600)":p.mg>15?"#d97706":"var(--red-500)";
                        return <div key={p.id} style={{marginBottom:10}}>
                          <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                            <span style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"75%"}}>{p.nombre}</span>
                            <span style={{fontWeight:800,color:col,flexShrink:0}}>{p.mg.toFixed(1)}%</span>
                          </div>
                          <div style={{height:5,background:"var(--gray-100)",borderRadius:3}}><div style={{height:"100%",width:`${Math.min(p.mg,60)/60*100}%`,background:col,borderRadius:3}}/></div>
                        </div>;
                      });
                  })()}
                </div>
              </div>

              {/* Recomendaciones */}
              <div style={S.card}>
                <div style={{fontWeight:700,fontSize:14,color:"var(--gray-900)",marginBottom:14}}>🔮 Recomendaciones de Pedido</div>
                {alerts.length===0?<div style={{textAlign:"center",padding:"20px 0",color:"var(--gray-400)"}}>✅ Inventario bien abastecido</div>
                  :<div style={{overflowX:"auto"}}><table>
                    <thead><tr>{["Producto","Stock","Mín","Sugerido Pedir","Costo Est.","Proveedor"].map((h,i)=>(
                      <th key={i} style={{...S.th,...(i===0?{borderRadius:"var(--radius) 0 0 var(--radius)"}:{}),...(i===5?{borderRadius:"0 var(--radius) var(--radius) 0"}:{})}}>{h}</th>
                    ))}</tr></thead>
                    <tbody>{alerts.map(p=>{const tp=Math.max(p.minimo*3-p.stock,p.minimo);return(
                      <tr key={p.id}>
                        <td style={S.td}><div style={{fontWeight:600}}>{p.nombre}</div></td>
                        <td style={S.td}><span style={S.badge(stOf(p))}>{p.stock}</span></td>
                        <td style={S.td}>{p.minimo}</td>
                        <td style={S.td}><strong>{tp}</strong> {p.unidad}</td>
                        <td style={S.td}>{tp*(p.precioCompra||0)>0?fmt(tp*p.precioCompra):"—"}</td>
                        <td style={S.td}>{p.proveedor||"—"}</td>
                      </tr>
                    );})}</tbody>
                  </table></div>
                }
              </div>
            </div>
          )}

        </main>
      )}

      {/* ════ MODAL PROYECTO ════ */}
      {projModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setProjModal(false)}}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:20}}>📁 Nuevo Proyecto</div>
            <div style={S.fGrp}>
              <label style={S.lbl}>Nombre de la tienda / cliente</label>
              <input style={S.inp} value={newProjName} placeholder="Ej: Tienda Don Carlos — Manga" onChange={e=>setNewProjName(e.target.value)} onKeyDown={e=>e.key==="Enter"&&createProject()} autoFocus/>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
              <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>setProjModal(false)}>Cancelar</button>
              <button style={S.btn("var(--green-600)")} onClick={createProject}>✅ Crear Proyecto</button>
            </div>
          </div>
        </div>
      )}


      {/* ══════════════════════════════════════════
           SIDEBAR PRINCIPAL (estilo H&M)
      ══════════════════════════════════════════ */}
      {sidebarOpen && (
        <>
          {/* Overlay */}
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.45)",zIndex:300}} onClick={()=>setSidebarOpen(false)}/>

          {/* Panel */}
          <div style={{position:"fixed",top:0,left:0,bottom:0,width:"min(88vw,360px)",background:"var(--white)",zIndex:301,display:"flex",flexDirection:"column",boxShadow:"4px 0 32px rgba(0,0,0,0.18)",overflowY:"auto"}}>

            {/* Header del sidebar */}
            <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",padding:"18px 20px",borderBottom:"1.5px solid var(--gray-100)",background:"var(--green-700)"}}>
              <div style={{display:"flex",alignItems:"center",gap:10}}>
                <div style={{width:32,height:32,background:"rgba(255,255,255,0.2)",borderRadius:8,display:"flex",alignItems:"center",justifyContent:"center",fontSize:16}}>🪴</div>
                <div>
                  <div style={{fontWeight:800,fontSize:15,color:"#fff"}}>Invent<span style={{color:"#86efac"}}>App</span></div>
                  <div style={{fontSize:11,color:"rgba(255,255,255,0.7)"}}>{userDoc?.name||user.email?.split("@")[0]} · <span style={{fontWeight:700}}>{userDoc?.role||"consultor"}</span></div>
                </div>
              </div>
              <button onClick={()=>setSidebarOpen(false)} style={{background:"rgba(255,255,255,0.15)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:18,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
            </div>

            <div style={{display:"flex",flex:1,overflow:"hidden"}}>

              {/* ── Columna 1: Proyectos ── */}
              <div style={{width:isMobile?90:110,background:"var(--green-50)",borderRight:"1px solid var(--gray-100)",padding:"12px 0",flexShrink:0,overflowY:"auto"}}>
                <div style={{fontSize:9,fontWeight:800,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.5,padding:"0 12px 8px"}}>Proyectos</div>
                {projects.map(p=>(
                  <button key={p.id} onClick={()=>{setCurrentProject(p);setSidebarOpen(false);}} style={{display:"block",width:"100%",padding:"10px 12px",background:currentProject?.id===p.id?"var(--green-100)":"none",border:"none",borderLeft:`3px solid ${currentProject?.id===p.id?"var(--green-600)":"transparent"}`,cursor:"pointer",textAlign:"left",fontSize:12,fontWeight:currentProject?.id===p.id?700:500,color:currentProject?.id===p.id?"var(--green-800)":"var(--gray-600)",lineHeight:1.3,wordBreak:"break-word"}}>
                    {p.name}
                  </button>
                ))}
                {isConsultor && (
                  <button onClick={()=>{setSidebarOpen(false);setProjModal(true);}} style={{display:"flex",alignItems:"center",gap:4,width:"100%",padding:"10px 12px",background:"none",border:"none",borderLeft:"3px solid transparent",cursor:"pointer",fontSize:12,color:"var(--green-700)",fontWeight:600,marginTop:4}}>
                    <span style={{fontSize:16}}>+</span> Nuevo
                  </button>
                )}
              </div>

              {/* ── Columna 2: Navegación ── */}
              <div style={{flex:1,padding:"12px 0",overflowY:"auto"}}>
                <div style={{fontSize:9,fontWeight:800,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.5,padding:"0 16px 8px"}}>Navegación</div>
                {allTabs.map(([id,lbl])=>(
                  <button key={id} onClick={()=>{goTab(id);setSidebarOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:tab===id?"var(--green-50)":"none",border:"none",borderLeft:`3px solid ${tab===id?"var(--green-600)":"transparent"}`,cursor:"pointer",fontSize:13,fontWeight:tab===id?700:500,color:tab===id?"var(--green-800)":"var(--gray-700)",textAlign:"left"}}>
                    {lbl}
                  </button>
                ))}

                {/* ── Divisor Acciones ── */}
                <div style={{borderTop:"1px solid var(--gray-100)",margin:"12px 0"}}/>
                <div style={{fontSize:9,fontWeight:800,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.5,padding:"0 16px 8px"}}>Acciones</div>

                {isConsultor && currentProject && (
                  <button onClick={()=>{setSidebarOpen(false);setInviteModal(true);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:"none",border:"none",borderLeft:"3px solid transparent",cursor:"pointer",fontSize:13,fontWeight:500,color:"#1d4ed8",textAlign:"left"}}>
                    👥 Invitar colega
                  </button>
                )}
                {isConsultor && currentProject && (
                  <button onClick={()=>{setSidebarOpen(false);loadTeamMembers();setTeamModal(true);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:"none",border:"none",borderLeft:"3px solid transparent",cursor:"pointer",fontSize:13,fontWeight:500,color:"#7c3aed",textAlign:"left"}}>
                    ⚙️ Gestión equipo
                  </button>
                )}
                {isConsultor && currentProject && (
                  <button onClick={()=>{setSidebarOpen(false);setClientModal(true);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:"none",border:"none",borderLeft:"3px solid transparent",cursor:"pointer",fontSize:13,fontWeight:500,color:"#92400e",textAlign:"left"}}>
                    👤 + Cliente
                  </button>
                )}

                <div style={{borderTop:"1px solid var(--gray-100)",margin:"12px 0"}}/>
                <button onClick={()=>{setSidebarOpen(false);signOut(auth);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:"none",border:"none",borderLeft:"3px solid transparent",cursor:"pointer",fontSize:13,fontWeight:500,color:"#991b1b",textAlign:"left"}}>
                  🚪 Cerrar sesión
                </button>
              </div>
            </div>
          </div>
        </>
      )}

      {/* ══════════════════════════════════════════
           MODAL — MOVIMIENTO DESDE BODEGA
      ══════════════════════════════════════════ */}
      {movCajaModal && (()=>{
        const prod = movCajaModal.prod;
        let movTipo = movCajaModal.tipo||"salida";
        let movQty = movCajaModal.qty||"";
        let movMotivo = movCajaModal.motivo||"";
        return (
          <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:410,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}
            onClick={e=>{if(e.target===e.currentTarget) setMovCajaModal(null);}}>
            <div style={{background:"#fff",borderRadius:20,width:"100%",maxWidth:420,boxShadow:"0 20px 60px rgba(0,0,0,0.25)",overflow:"hidden"}}>
              {/* Header */}
              <div style={{background:"var(--green-700)",padding:"18px 20px",display:"flex",alignItems:"center",justifyContent:"space-between"}}>
                <div>
                  <div style={{fontWeight:800,fontSize:16,color:"#fff"}}>↕ Registrar Movimiento</div>
                  <div style={{fontSize:12,color:"rgba(255,255,255,.75)",marginTop:2,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:280}}>{prod.nombre}</div>
                </div>
                <button onClick={()=>setMovCajaModal(null)} style={{background:"rgba(255,255,255,0.2)",border:"none",color:"#fff",width:32,height:32,borderRadius:8,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>

              {/* Body */}
              <div style={{padding:"20px"}}>
                {/* Stock actual */}
                <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16,padding:"10px 14px",background:"#f8fafc",borderRadius:10,border:"1px solid var(--gray-100)"}}>
                  <span style={{fontSize:13,color:"var(--gray-500)",fontWeight:600}}>Stock actual</span>
                  <span style={{fontSize:20,fontWeight:800,color:prod.stock===0?"#ef4444":prod.stock<=prod.minimo?"#f59e0b":"var(--green-700)"}}>{prod.stock} {prod.unidad||"unid"}</span>
                </div>

                {/* Tipo */}
                <div style={{display:"flex",gap:8,marginBottom:14}}>
                  {["salida","entrada"].map(t=>(
                    <button key={t} onClick={()=>setMovCajaModal(m=>({...m,tipo:t}))}
                      style={{flex:1,padding:"10px",border:"2px solid",borderColor:movTipo===t?(t==="salida"?"#ef4444":"var(--green-500)"):"var(--gray-200)",borderRadius:10,cursor:"pointer",fontWeight:700,fontSize:13,
                        background:movTipo===t?(t==="salida"?"#fef2f2":"#f0fdf4"):"#fff",
                        color:movTipo===t?(t==="salida"?"#dc2626":"var(--green-700)"):"var(--gray-500)",
                      }}>
                      {t==="salida"?"⬇ Salida":"⬆ Entrada"}
                    </button>
                  ))}
                </div>

                {/* Cantidad */}
                <div style={{marginBottom:14}}>
                  <label style={S.lbl}>Cantidad</label>
                  <input type="number" min="1" value={movQty}
                    onChange={e=>setMovCajaModal(m=>({...m,qty:e.target.value}))}
                    style={{...S.inp,marginTop:6,fontSize:20,textAlign:"center",fontWeight:700}}
                    placeholder="0"/>
                </div>

                {/* Motivo */}
                <div style={{marginBottom:18}}>
                  <label style={S.lbl}>Motivo (opcional)</label>
                  <input value={movMotivo}
                    onChange={e=>setMovCajaModal(m=>({...m,motivo:e.target.value}))}
                    style={{...S.inp,marginTop:6}}
                    placeholder="Ej: Consumo del día, Reposición..."/>
                </div>

                <button onClick={()=>saveMovCaja(prod,movTipo,movQty,movMotivo)}
                  style={{...S.btn(movTipo==="salida"?"#dc2626":"var(--green-700)"),width:"100%",justifyContent:"center",padding:"12px",fontSize:15,fontWeight:700}}>
                  {movTipo==="salida"?"⬇ Registrar Salida":"⬆ Registrar Entrada"}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ══════════════════════════════════════════
           MODAL — AGREGAR PRODUCTO A CAJA
      ══════════════════════════════════════════ */}
      {addToCajaModal && (
        <div style={{position:"fixed",inset:0,background:"rgba(0,0,0,0.5)",zIndex:400,display:"flex",alignItems:"center",justifyContent:"center",padding:"20px"}}
          onClick={e=>{if(e.target===e.currentTarget){setAddToCajaModal(null);setAddSearch("");setAddSegmento("");}}}>
          <div style={{
            background:"#fff", width:"100%", maxWidth:540,
            borderRadius:20,
            maxHeight:"88vh", display:"flex", flexDirection:"column",
            boxShadow:"0 20px 60px rgba(0,0,0,0.25)",
          }}>
            {/* Header */}
            <div style={{padding:"20px 20px 0",flexShrink:0}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",marginBottom:16}}>
                <div>
                  <div style={{fontWeight:800,fontSize:17,color:"var(--gray-900)"}}>
                    {addToCajaModal.armario ? `Agregar a ${addToCajaModal.armario}` : "Agregar producto a bodega"}
                  </div>
                  <div style={{fontSize:12,color:"var(--gray-400)",marginTop:2}}>Busca un producto existente o crea uno nuevo</div>
                </div>
                <button onClick={()=>{setAddToCajaModal(null);setAddSearch("");setAddSegmento("");}}
                  style={{background:"var(--gray-100)",border:"none",borderRadius:8,width:32,height:32,cursor:"pointer",fontSize:16,display:"flex",alignItems:"center",justifyContent:"center"}}>✕</button>
              </div>
              <div style={{position:"relative",marginBottom:12}}>
                <svg style={{position:"absolute",left:12,top:"50%",transform:"translateY(-50%)",color:"var(--gray-400)",pointerEvents:"none"}} width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                <input autoFocus style={{...S.inp,paddingLeft:38}} placeholder="Escribe el nombre del producto..."
                  value={addSearch} onChange={e=>setAddSearch(e.target.value)}/>
              </div>
              <div style={{display:"flex",gap:8,marginBottom:4,flexWrap:"wrap"}}>
                <select value={addSegmento} onChange={e=>setAddSegmento(e.target.value)}
                  style={{...S.inp,flex:1,fontSize:12,padding:"7px 10px"}}>
                  <option value="">— Segmento / Fila —</option>
                  {[...new Set(products.filter(p=>addToCajaModal.armario?p.armario===addToCajaModal.armario:true).map(p=>p.segmento).filter(Boolean))].sort().map(s=>(
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
                <button onClick={()=>{const s=prompt("Nombre del nuevo segmento/fila:");if(s?.trim())setAddSegmento(s.trim());}}
                  style={{...S.bSm("var(--green-100)","var(--green-800)"),flexShrink:0,fontSize:11}}>+ Segmento</button>
              </div>
            </div>
            <div style={{overflowY:"auto",flex:1,padding:"8px 20px 20px"}}>
              {(()=>{
                const q = addSearch.trim().toLowerCase();
                const armarioTarget = addToCajaModal.armario;
                const enCajaIds = new Set(products.filter(p=>p.armario===armarioTarget).map(p=>p.id));
                const coincidencias = q.length>0 ? products.filter(p=>!enCajaIds.has(p.id)&&(
                  p.nombre?.toLowerCase().includes(q)||p.codigo?.toLowerCase().includes(q)||p.codigoBarras?.includes(q))) : [];
                const esNuevo = q.length>1 && !products.some(p=>p.nombre?.toLowerCase()===q);
                return (
                  <div>
                    {esNuevo && (
                      <div style={{marginBottom:10}}>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>Crear nuevo</div>
                        <button onClick={()=>crearYAsignarACaja(addSearch,addToCajaModal.armario||"Sin asignar",addSegmento||"General")}
                          style={{display:"flex",alignItems:"center",gap:12,width:"100%",padding:"12px 14px",background:"var(--green-50)",border:"1.5px solid var(--green-300)",borderRadius:12,cursor:"pointer",textAlign:"left"}}
                          onMouseEnter={e=>e.currentTarget.style.background="var(--green-100)"}
                          onMouseLeave={e=>e.currentTarget.style.background="var(--green-50)"}>
                          <div style={{width:36,height:36,borderRadius:10,background:"var(--green-600)",display:"flex",alignItems:"center",justifyContent:"center",color:"#fff",fontSize:22,flexShrink:0}}>+</div>
                          <div>
                            <div style={{fontWeight:700,fontSize:14,color:"var(--green-800)"}}>Crear "{addSearch}"</div>
                            <div style={{fontSize:11,color:"var(--green-600)",marginTop:2}}>→ {addToCajaModal.armario||"Sin asignar"} / {addSegmento||"General"}</div>
                          </div>
                        </button>
                      </div>
                    )}
                    {coincidencias.length>0 && (
                      <div>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--gray-400)",textTransform:"uppercase",letterSpacing:.4,marginBottom:6}}>
                          {armarioTarget?`Mover a ${armarioTarget}`:"Asignar"} ({coincidencias.length})
                        </div>
                        <div style={{display:"flex",flexDirection:"column",gap:6}}>
                          {coincidencias.slice(0,8).map(p=>{
                            const stBg=p.stock===0?"#fee2e2":p.stock<=p.minimo?"#fef3c7":"#dcfce7";
                            const stCol=p.stock===0?"#991b1b":p.stock<=p.minimo?"#92400e":"#166534";
                            return (
                              <button key={p.id} onClick={()=>moverProductoACaja(p,addToCajaModal.armario||p.armario||"Sin asignar",addSegmento||p.segmento)}
                                style={{display:"flex",alignItems:"center",gap:12,padding:"10px 12px",background:"#fafafa",border:"1px solid var(--gray-100)",borderRadius:10,cursor:"pointer",textAlign:"left",width:"100%"}}
                                onMouseEnter={e=>e.currentTarget.style.background="#f0fdf4"}
                                onMouseLeave={e=>e.currentTarget.style.background="#fafafa"}>
                                <div style={{flex:1,minWidth:0}}>
                                  <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{p.nombre}</div>
                                  <div style={{fontSize:11,color:"var(--gray-400)",marginTop:2}}>
                                    {p.armario?`📦 ${p.armario}${p.segmento?` / ${p.segmento}`:""}` : "Sin ubicar"} · {p.categoria}
                                  </div>
                                </div>
                                <span style={{padding:"3px 9px",borderRadius:20,fontSize:11,fontWeight:700,background:stBg,color:stCol,flexShrink:0}}>×{p.stock}</span>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="var(--green-600)" strokeWidth="2.5" style={{flexShrink:0}}><polyline points="9 18 15 12 9 6"/></svg>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                    {q.length===0 && <div style={{textAlign:"center",padding:"28px 0",color:"var(--gray-300)"}}>
                      <div style={{fontSize:32,marginBottom:8}}>🔍</div>
                      <div style={{fontSize:13,fontWeight:500}}>Escribe para buscar un producto</div>
                      <div style={{fontSize:11,marginTop:4,color:"var(--gray-400)"}}>o escribe un nombre nuevo para crearlo</div>
                    </div>}
                    {q.length>0&&coincidencias.length===0&&!esNuevo&&<div style={{textAlign:"center",padding:"20px 0",color:"var(--gray-400)",fontSize:13}}>Sin coincidencias</div>}
                  </div>
                );
              })()}
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL GESTIÓN DE EQUIPO ════ */}
      {teamModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setTeamModal(false)}}>
          <div style={{...S.modal, maxWidth:580}}>
            <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:6}}>⚙️ Gestión de Equipo</div>
            <div style={{fontSize:13,color:"var(--gray-500)",marginBottom:20}}>Proyecto: <strong>{currentProject?.name}</strong></div>
            {teamLoading ? (
              <div style={{textAlign:"center",padding:"32px 0",color:"var(--gray-400)"}}>
                <div style={{width:32,height:32,border:"3px solid var(--gray-200)",borderTop:"3px solid var(--green-600)",borderRadius:"50%",animation:"spin .7s linear infinite",margin:"0 auto 12px"}}/>
                Cargando miembros...
              </div>
            ) : (
              <div style={{display:"flex",flexDirection:"column",gap:8}}>
                {teamMembers.length === 0 ? (
                  <div style={{textAlign:"center",padding:"20px 0",color:"var(--gray-400)"}}>Sin miembros</div>
                ) : teamMembers.map(m => (
                  <div key={m.uid} style={{display:"flex",alignItems:"center",gap:12,padding:"12px 16px",borderRadius:"var(--radius)",background:m.disabled?"#fef2f2":"var(--gray-50)",border:`1.5px solid ${m.disabled?"#fecaca":"var(--gray-200)"}`,opacity:m.disabled?.8:1}}>
                    <div style={{width:36,height:36,borderRadius:"50%",background:m.role==="cliente"?"#fef3c7":m.disabled?"#fee2e2":"var(--green-100)",display:"flex",alignItems:"center",justifyContent:"center",fontSize:18,flexShrink:0}}>
                      {m.disabled?"🚫":m.role==="cliente"?"🧑‍💼":"🔧"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:14,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.name||m.email}</div>
                      <div style={{fontSize:11,color:"var(--gray-400)"}}>{m.email} · <span style={{fontWeight:600,color:m.role==="cliente"?"#92400e":m.disabled?"#991b1b":"var(--green-700)"}}>{m.disabled?"DESACTIVADO":m.role}</span></div>
                    </div>
                    {m.uid !== user.uid && !m.disabled && (
                      <div style={{display:"flex",gap:6,flexShrink:0}}>
                        <button style={{...S.bSm("#fef3c7","#92400e"),fontSize:11,padding:"5px 10px"}} onClick={()=>removeMember(m.uid)} title="Quitar del proyecto">
                          🚫 Quitar
                        </button>
                        <button style={{...S.bSm("#fee2e2","#991b1b"),fontSize:11,padding:"5px 10px"}} onClick={()=>disableAccount(m.uid,m.email||m.name)} title="Desactivar cuenta">
                          🗑️ Bloquear
                        </button>
                      </div>
                    )}
                    {m.uid === user.uid && (
                      <span style={{fontSize:11,color:"var(--gray-400)",fontWeight:600}}>Tú</span>
                    )}
                    {m.disabled && (
                      <span style={{fontSize:11,color:"#991b1b",fontWeight:700}}>BLOQUEADO</span>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
              <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>setTeamModal(false)}>Cerrar</button>
              <button style={S.btn("var(--green-600)")} onClick={()=>{setTeamModal(false);setInviteModal(true);}}>👥 + Invitar</button>
              <button style={S.btn("#d97706")} onClick={()=>{setTeamModal(false);setClientModal(true);}}>+ Cliente</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL INVITAR MIEMBRO ════ */}
      {inviteModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget){setInviteModal(false);setInviteEmail("");}}}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:6}}>👥 Invitar a "{currentProject?.name}"</div>
            <div style={{fontSize:13,color:"var(--gray-500)",marginBottom:20}}>La persona debe tener cuenta creada en InventApp.</div>
            <div style={S.fGrp}>
              <label style={S.lbl}>Email del colaborador</label>
              <input style={S.inp} type="email" value={inviteEmail} placeholder="colega@email.com" onChange={e=>setInviteEmail(e.target.value)} onKeyDown={e=>e.key==="Enter"&&inviteMember()} autoFocus/>
            </div>
            <div style={{fontSize:12,color:"var(--gray-500)",marginTop:10,background:"var(--green-50)",borderRadius:8,padding:"10px 14px"}}>
              💡 <strong>Tip:</strong> Tu colega debe registrarse primero en la app con su email. Luego lo invitas aquí y podrá ver y editar este proyecto.
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
              <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>{setInviteModal(false);setInviteEmail("");}}>Cancelar</button>
              <button style={S.btn("var(--blue-500)")} onClick={inviteMember} disabled={inviteLoading}>
                {inviteLoading ? <div style={{width:18,height:18,border:"2.5px solid rgba(255,255,255,.3)",borderTop:"2.5px solid #fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> : "✅ Invitar"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL CREAR CLIENTE / CONSULTOR ════ */}
      {clientModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setClientModal(false)}}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:6}}>👤 Crear Cuenta de Acceso</div>
            <div style={{fontSize:13,color:"var(--gray-500)",marginBottom:20}}>Crea acceso para un cliente o consultor y asígnalo al proyecto actual.</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={S.fGrp}>
                <label style={S.lbl}>Nombre</label>
                <input style={S.inp} value={newClient.name} placeholder="Nombre completo" onChange={e=>setNewClient(c=>({...c,name:e.target.value}))}/>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Email</label>
                <input style={S.inp} type="email" value={newClient.email} placeholder="email@ejemplo.com" onChange={e=>setNewClient(c=>({...c,email:e.target.value}))}/>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Contraseña inicial</label>
                <input style={S.inp} type="text" value={newClient.pass} placeholder="Mínimo 6 caracteres" onChange={e=>setNewClient(c=>({...c,pass:e.target.value}))}/>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Rol</label>
                <select style={S.inp} value={inviteRole} onChange={e=>setInviteRole(e.target.value)}>
                  <option value="cliente">🧑‍💼 Cliente — Solo ve Dashboard, Inventario y Análisis</option>
                  <option value="consultor">🔧 Consultor — Acceso completo al proyecto</option>
                </select>
              </div>
              <div style={{fontSize:12,background:"#fffbeb",borderRadius:8,padding:"10px 14px",color:"#92400e",border:"1px solid #fcd34d"}}>
                📋 <strong>Proyecto asignado:</strong> {currentProject?.name}<br/>
                {inviteRole==="cliente" ? "El cliente verá Dashboard, Inventario y Análisis de su tienda." : "El consultor tendrá acceso completo al proyecto."}
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
              <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>setClientModal(false)}>Cancelar</button>
              <button style={S.btn(inviteRole==="cliente"?"#d97706":"var(--green-600)")} onClick={createClientAccount} disabled={inviteLoading}>
                {inviteLoading ? <div style={{width:18,height:18,border:"2.5px solid rgba(255,255,255,.3)",borderTop:"2.5px solid #fff",borderRadius:"50%",animation:"spin .7s linear infinite"}}/> : `✅ Crear ${inviteRole}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL MOVIMIENTO ════ */}
      {movModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setMovModal(false)}}>
          <div style={S.modal}>
            <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:20}}>↕ Registrar Movimiento</div>
            <div style={{display:"flex",flexDirection:"column",gap:14}}>
              <div style={S.fGrp}><label style={S.lbl}>Producto *</label>
                <select style={S.inp} value={movForm.pid} onChange={e=>setMovForm(f=>({...f,pid:e.target.value}))}>
                  <option value="">Seleccionar...</option>{products.map(p=><option key={p.id} value={p.id}>{p.nombre} (Stock: {p.stock})</option>)}
                </select>
              </div>
              <div style={S.fGrp}><label style={S.lbl}>Tipo *</label>
                <select style={S.inp} value={movForm.tipo} onChange={e=>setMovForm(f=>({...f,tipo:e.target.value}))}>
                  <option value="entrada">📥 Entrada (compra)</option>
                  <option value="salida">📤 Salida (venta)</option>
                </select>
              </div>
              <div style={S.fGrp}><label style={S.lbl}>Cantidad *</label><input style={S.inp} type="number" min="1" value={movForm.qty} placeholder="1" onChange={e=>setMovForm(f=>({...f,qty:e.target.value}))}/></div>
              <div style={S.fGrp}><label style={S.lbl}>Motivo</label><input style={S.inp} value={movForm.motivo} placeholder="Compra proveedor..." onChange={e=>setMovForm(f=>({...f,motivo:e.target.value}))}/></div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
              <button style={S.btn("var(--white)","var(--gray-600)",{border:"1.5px solid var(--gray-200)"})} onClick={()=>setMovModal(false)}>Cancelar</button>
              <button style={S.btn("var(--green-600)")} onClick={saveMovement}>✅ Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ MODAL MASTER ════ */}
      {masterModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setMasterModal(false)}}>
          <MasterForm currentProject={currentProject} onSave={prod=>{ setMasterProducts(p=>[...p,prod]); setMasterModal(false); showToast("✅ Producto agregado al master","success"); }} onClose={()=>setMasterModal(false)} />
        </div>
      )}

      {/* ════ TOAST ════ */}
      {toast && (
        <div style={{ position:"fixed", bottom:22, left:"50%", transform:"translateX(-50%)",
          background: toast.type==="success"?"var(--green-700)":toast.type==="warning"?"#d97706":"var(--gray-800)",
          color:"#fff", padding:"13px 22px", borderRadius:"var(--radius)", fontSize:14, fontWeight:600,
          boxShadow:"var(--shadow-lg)", zIndex:999, whiteSpace:"nowrap", maxWidth:"90vw" }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}

// ─── MASTER FORM ──────────────────────────────────────────────────────────────
function MasterForm({ currentProject, onSave, onClose }) {
  const [f, setF] = useState({ nombre:"", codigoBarras:"", precioCompra:"", precioVenta:"", stockInicial:"", proveedor:"", categoria:"" });

  async function save() {
    if (!f.nombre.trim()) return;
    const data = { ...f, precioCompra:parseFloat(f.precioCompra)||0, precioVenta:parseFloat(f.precioVenta)||0, stockInicial:parseInt(f.stockInicial)||0, creadoEn:new Date().toISOString() };
    const ref  = await addDoc(collection(db,`projects/${currentProject.id}/masterProducts`), data);
    onSave({ id:ref.id, ...data });
  }

  const S2 = { fGrp:{display:"flex",flexDirection:"column",gap:6}, lbl:{fontSize:11,fontWeight:700,color:"var(--gray-500)",textTransform:"uppercase",letterSpacing:.5}, inp:{padding:"10px 13px",border:"1.5px solid var(--gray-200)",borderRadius:10,fontSize:14,outline:"none",background:"var(--white)",width:"100%"} };

  return (
    <div style={{ background:"var(--white)",borderRadius:20,padding:28,width:"100%",maxWidth:500,boxShadow:"var(--shadow-lg)" }}>
      <div style={{fontWeight:800,fontSize:18,color:"var(--gray-900)",marginBottom:20}}>🗄 Agregar al Master</div>
      <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14}}>
        <div style={{...S2.fGrp,gridColumn:"1/-1"}}><label style={S2.lbl}>Nombre *</label><input style={S2.inp} value={f.nombre} placeholder="Nombre del producto" onChange={e=>setF(x=>({...x,nombre:e.target.value}))}/></div>
        <div style={S2.fGrp}><label style={S2.lbl}>Código de Barras</label><input style={S2.inp} value={f.codigoBarras} placeholder="7702020012345" onChange={e=>setF(x=>({...x,codigoBarras:e.target.value}))}/></div>
        <div style={S2.fGrp}><label style={S2.lbl}>Categoría</label>
          <select style={S2.inp} value={f.categoria} onChange={e=>setF(x=>({...x,categoria:e.target.value}))}>
            <option value="">Seleccionar...</option>{getCats(currentProject?.name, []).map(c=><option key={c}>{c}</option>)}
          </select>
        </div>
        <div style={S2.fGrp}><label style={S2.lbl}>Precio Compra (COP)</label><input style={S2.inp} type="number" value={f.precioCompra} placeholder="0" onChange={e=>setF(x=>({...x,precioCompra:e.target.value}))}/></div>
        <div style={S2.fGrp}><label style={S2.lbl}>Precio Venta (COP)</label><input style={S2.inp} type="number" value={f.precioVenta} placeholder="0" onChange={e=>setF(x=>({...x,precioVenta:e.target.value}))}/></div>
        <div style={S2.fGrp}><label style={S2.lbl}>Stock Inicial</label><input style={S2.inp} type="number" value={f.stockInicial} placeholder="0" onChange={e=>setF(x=>({...x,stockInicial:e.target.value}))}/></div>
        <div style={S2.fGrp}><label style={S2.lbl}>Proveedor</label><input style={S2.inp} value={f.proveedor} placeholder="Distribuidora Caribe" onChange={e=>setF(x=>({...x,proveedor:e.target.value}))}/></div>
      </div>
      <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:20}}>
        <button style={{padding:"10px 20px",background:"var(--white)",color:"var(--gray-600)",border:"1.5px solid var(--gray-200)",borderRadius:10,cursor:"pointer",fontWeight:600}} onClick={onClose}>Cancelar</button>
        <button style={{padding:"10px 20px",background:"var(--green-600)",color:"#fff",border:"none",borderRadius:10,cursor:"pointer",fontWeight:600}} onClick={save}>✅ Agregar</button>
      </div>
    </div>
  );
}
