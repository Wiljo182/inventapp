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
const CATS    = ["Granos y Cereales","Lácteos","Bebidas","Aseo Personal","Limpieza Hogar","Snacks","Enlatados","Panadería","Carnes y Embutidos","Frutas y Verduras","Condimentos","Otro"];
const ENVASES = ["Bolsa","Botella","Caja","Lata","Tarro","Doypack","Sachet","Unidad"];
const UNITS   = ["unid","kg","g","lt","ml","paq"];

const CAT_COLOR = {
  "Granos y Cereales":"#16a34a","Lácteos":"#3b82f6","Bebidas":"#06b6d4",
  "Aseo Personal":"#ec4899","Limpieza Hogar":"#8b5cf6","Snacks":"#f97316",
  "Enlatados":"#6b7280","Panadería":"#d97706","Carnes y Embutidos":"#ef4444",
  "Frutas y Verduras":"#22c55e","Condimentos":"#eab308","Otro":"#9ca3af",
};

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
  hdr:     { background:"var(--white)", borderBottom:"1.5px solid var(--gray-200)", padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:60, position:"sticky", top:0, zIndex:50, boxShadow:"0 1px 8px rgba(0,0,0,0.06)" },
  logo:    { fontWeight:800, fontSize:20, color:"var(--green-700)", display:"flex", alignItems:"center", gap:8 },
  logoIcon:{ width:32, height:32, background:"linear-gradient(135deg,#22c55e,#16a34a)", borderRadius:8, display:"flex", alignItems:"center", justifyContent:"center", fontSize:16 },
  // Tabs
  tabs:    { background:"var(--white)", borderBottom:"1.5px solid var(--gray-200)", display:"flex", padding:"0 20px", overflowX:"auto", gap:2 },
  tab:     a => ({ padding:"14px 16px", cursor:"pointer", fontSize:13, fontWeight:600, color:a?"var(--green-700)":"var(--gray-500)", background:"none", border:"none", borderBottom:a?"2.5px solid var(--green-600)":"2.5px solid transparent", whiteSpace:"nowrap", transition:"all .15s" }),
  // Main
  main:    { maxWidth:1100, margin:"0 auto", padding:"24px 16px" },
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
  const [teamMembers,   setTeamMembers]   = useState([]);
  const [teamLoading,   setTeamLoading]   = useState(false);
  const [inviteLoading, setInviteLoading] = useState(false);
  const [clientModal,   setClientModal]   = useState(false);
  const [newClient,     setNewClient]     = useState({email:"",pass:"",name:""});
  const [loadingData,   setLoadingData]   = useState(false);
  const [invModal,      setInvModal]      = useState(false);  // inventario diferencial
  const [masterModal,   setMasterModal]   = useState(false);  // agregar al master
  const toastRef = useRef(null);

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

  // ── Scanner result ──
  function onScanResult(prod) {
    setForm(f => ({
      ...f,
      nombre:          prod.nombre        || f.nombre,
      codigo:          prod.codigo        || f.codigo,
      codigoBarras:    prod.codigoBarras  || f.codigoBarras,
      categoria:       CATS.includes(prod.categoria)   ? prod.categoria  : f.categoria,
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
  function startEdit(p) { setEditId(p.id); setEditData({stock:p.stock,minimo:p.minimo,precioCompra:p.precioCompra,precioVenta:p.precioVenta}); }
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
        {/* ── ☰ izquierda ── */}
        <div style={{display:"flex",alignItems:"center",gap:12}}>
          <button onClick={()=>setSidebarOpen(true)} style={{background:"none",border:"1.5px solid var(--gray-200)",borderRadius:8,width:36,height:36,display:"flex",flexDirection:"column",alignItems:"center",justifyContent:"center",gap:4,cursor:"pointer",padding:0,flexShrink:0}} aria-label="Menú">
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
            <span style={{display:"block",width:16,height:2,background:"var(--gray-600)",borderRadius:2}}/>
          </button>
          <div style={S.logo}>
            <div style={S.logoIcon}>🪴</div>
            Invent<span style={{color:"var(--green-500)"}}>App</span>
          </div>
        </div>
        {/* Proyecto activo + usuario */}
        <div style={{display:"flex",alignItems:"center",gap:10}}>
          {currentProject && (
            <div style={{fontSize:12,background:"var(--green-50)",border:"1px solid var(--green-200)",borderRadius:20,padding:"4px 12px",color:"var(--green-700)",fontWeight:600,maxWidth:160,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>
              📁 {currentProject.name}
            </div>
          )}
          <div style={{fontSize:12,color:"var(--gray-500)",display:"flex",alignItems:"center",gap:5}}>
            <span style={{width:7,height:7,borderRadius:"50%",background:"var(--green-500)",display:"inline-block"}}/>
            <span style={{maxWidth:100,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{userDoc?.name||user.email?.split("@")[0]}</span>
            <span style={{fontSize:10,background:"var(--green-100)",color:"var(--green-700)",padding:"2px 6px",borderRadius:20,fontWeight:700}}>{userDoc?.role||"consultor"}</span>
          </div>
        </div>
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
                  <div style={{fontWeight:800,fontSize:24,color:"var(--gray-900)",lineHeight:1.1}}>{currentProject.name}</div>
                  <div style={{fontSize:13,color:"var(--gray-400)",marginTop:3}}>{new Date().toLocaleDateString("es-CO",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
                </div>
                <button style={S.btn("var(--green-600)")} onClick={exportCSV}>⬇ CSV</button>
              </div>

              {/* ── Layout 2 columnas: principal + alertas ── */}
              <div style={{display:"grid",gridTemplateColumns:"1fr 280px",gap:16,alignItems:"start"}}>

                {/* ═══ COLUMNA PRINCIPAL ═══ */}
                <div>

                  {/* KPI Cards — 2 filas de 3 */}
                  <div style={{display:"grid",gridTemplateColumns:"repeat(3,1fr)",gap:12,marginBottom:16}}>
                    {[
                      {lbl:"Productos",    val:products.length,                               icon:"📦", accent:"#22c55e", bg:"#f0fdf4"},
                      {lbl:"Valor",        val:"$"+Math.round(totalVal/1000)+"K",             icon:"💰", accent:"#3b82f6", bg:"#eff6ff"},
                      {lbl:"Categorías",   val:[...new Set(products.map(p=>p.categoria).filter(Boolean))].length, icon:"🏷️", accent:"#8b5cf6", bg:"#f5f3ff"},
                      {lbl:"Stock Bajo",   val:alerts.filter(p=>p.stock>0).length,            icon:"⚠️", accent:"#f97316", bg:"#fff7ed"},
                      {lbl:"Sin Stock",    val:products.filter(p=>p.stock===0).length,        icon:"🚨", accent:"#ef4444", bg:"#fef2f2"},
                      {lbl:"Master DB",    val:masterProducts.length,                         icon:"🗄", accent:"#8b5cf6", bg:"#f5f3ff"},
                    ].map(({lbl,val,icon,accent,bg})=>(
                      <div key={lbl} style={{background:bg,borderRadius:14,padding:"14px 16px",border:`1.5px solid ${accent}22`,position:"relative",overflow:"hidden"}}>
                        <div style={{position:"absolute",top:8,right:12,fontSize:22,opacity:.18}}>{icon}</div>
                        <div style={{fontSize:11,fontWeight:700,color:"var(--gray-500)",textTransform:"uppercase",letterSpacing:.5,marginBottom:4}}>{lbl}</div>
                        <div style={{fontSize:28,fontWeight:900,color:accent,lineHeight:1}}>{val}</div>
                      </div>
                    ))}
                  </div>

                  {/* Barra de salud del inventario */}
                  {products.length > 0 && (()=>{
                    const ok    = products.filter(p=>p.stock>p.minimo).length;
                    const bajo  = alerts.filter(p=>p.stock>0).length;
                    const cero  = products.filter(p=>p.stock===0).length;
                    const total = products.length;
                    return (
                      <div style={{...S.card,marginBottom:16,padding:"16px 20px"}}>
                        <div style={{display:"flex",justifyContent:"space-between",alignItems:"center",marginBottom:10}}>
                          <div style={{fontWeight:700,fontSize:14,color:"var(--gray-800)"}}>📊 Salud del inventario</div>
                          <div style={{fontSize:12,color:"var(--gray-400)"}}>{total} productos</div>
                        </div>
                        <div style={{height:10,borderRadius:99,background:"var(--gray-100)",overflow:"hidden",display:"flex"}}>
                          <div style={{width:`${ok/total*100}%`,background:"#22c55e",transition:"width .5s"}}/>
                          <div style={{width:`${bajo/total*100}%`,background:"#f97316",transition:"width .5s"}}/>
                          <div style={{width:`${cero/total*100}%`,background:"#ef4444",transition:"width .5s"}}/>
                        </div>
                        <div style={{display:"flex",gap:16,marginTop:8}}>
                          {[[ok,"OK","#22c55e"],[bajo,"Bajo","#f97316"],[cero,"Sin stock","#ef4444"]].map(([n,l,c])=>(
                            <div key={l} style={{display:"flex",alignItems:"center",gap:5,fontSize:11}}>
                              <span style={{width:8,height:8,borderRadius:2,background:c,display:"inline-block"}}/>
                              <span style={{color:"var(--gray-500)"}}>{l}:</span>
                              <span style={{fontWeight:700,color:c}}>{n}</span>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })()}

                  {/* Últimos movimientos */}
                  <div style={S.card}>
                    <div style={{fontWeight:700,fontSize:14,color:"var(--gray-900)",marginBottom:12,display:"flex",alignItems:"center",gap:6}}>
                      <span>🕐</span> Últimos Movimientos
                      {movements.length>0 && <span style={{marginLeft:"auto",fontSize:11,color:"var(--gray-400)",fontWeight:400}}>{movements.length} total</span>}
                    </div>
                    {movements.length===0
                      ? <div style={{textAlign:"center",padding:"24px 0",color:"var(--gray-300)",fontSize:13}}>Sin movimientos aún</div>
                      : movements.slice(0,5).map(m=>(
                        <div key={m.id} style={{display:"flex",alignItems:"center",gap:10,padding:"10px 0",borderBottom:"1px solid var(--gray-50)"}}>
                          <div style={{width:30,height:30,borderRadius:8,flexShrink:0,display:"flex",alignItems:"center",justifyContent:"center",background:m.tipo==="entrada"?"#dcfce7":"#fee2e2",fontSize:14}}>{m.tipo==="entrada"?"📥":"📤"}</div>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontWeight:600,fontSize:12,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nombre}</div>
                            <div style={{fontSize:10,color:"var(--gray-400)"}}>{fmtDt(m.fecha)}</div>
                          </div>
                          <span style={{fontWeight:800,fontSize:13,color:m.tipo==="entrada"?"var(--green-600)":"var(--red-500)",flexShrink:0}}>{m.tipo==="entrada"?"+":"-"}{m.cantidad}</span>
                        </div>
                      ))
                    }
                  </div>
                </div>

                {/* ═══ COLUMNA DERECHA: ALERTAS ═══ */}
                <div style={{display:"flex",flexDirection:"column",gap:12}}>

                  {/* Alertas de vencimiento compactas */}
                  {expiryAlerts.length > 0 && (
                    <div style={{background:"#fffbeb",border:"1.5px solid #fcd34d",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                        ⏰ Vencimientos <span style={{marginLeft:"auto",background:"#f59e0b",color:"#fff",borderRadius:20,padding:"1px 8px",fontSize:11}}>{expiryAlerts.length}</span>
                      </div>
                      {expiryAlerts.slice(0,5).map(p=>{
                        const s = expiryStatus(p.fechaVencimiento);
                        return (
                          <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid #fde68a"}}>
                            <span style={{fontSize:14,flexShrink:0}}>{s.icon}</span>
                            <div style={{flex:1,minWidth:0}}>
                              <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:"#92400e"}}>{p.nombre}</div>
                              <div style={{fontSize:10,color:"#b45309"}}>{s.label}</div>
                            </div>
                          </div>
                        );
                      })}
                      {expiryAlerts.length>5 && <div style={{fontSize:10,color:"#92400e",marginTop:6,textAlign:"center"}}>+{expiryAlerts.length-5} más</div>}
                    </div>
                  )}

                  {/* Alertas de stock compactas */}
                  {alerts.length > 0 ? (
                    <div style={{background:"#fef2f2",border:"1.5px solid #fecaca",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontWeight:700,fontSize:13,color:"#991b1b",marginBottom:10,display:"flex",alignItems:"center",gap:6}}>
                        🚨 Stock <span style={{marginLeft:"auto",background:"#ef4444",color:"#fff",borderRadius:20,padding:"1px 8px",fontSize:11}}>{alerts.length}</span>
                      </div>
                      {alerts.slice(0,6).map(p=>(
                        <div key={p.id} style={{display:"flex",alignItems:"center",gap:8,padding:"7px 0",borderBottom:"1px solid #fee2e2"}}>
                          <span style={{fontSize:13,flexShrink:0}}>{p.stock===0?"🔴":"🟡"}</span>
                          <div style={{flex:1,minWidth:0}}>
                            <div style={{fontSize:11,fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",color:p.stock===0?"#991b1b":"#92400e"}}>{p.nombre}</div>
                            <div style={{fontSize:10,color:"var(--gray-400)"}}>Stock: {p.stock} · Mín: {p.minimo}</div>
                          </div>
                          {p.stock===0 && <span style={{fontSize:9,fontWeight:800,color:"#fff",background:"#ef4444",borderRadius:4,padding:"2px 5px",flexShrink:0,whiteSpace:"nowrap"}}>PEDIR</span>}
                        </div>
                      ))}
                      {alerts.length>6 && <div style={{fontSize:10,color:"#991b1b",marginTop:6,textAlign:"center"}}>+{alerts.length-6} más</div>}
                    </div>
                  ) : (
                    <div style={{background:"#f0fdf4",border:"1.5px solid #86efac",borderRadius:14,padding:"14px 16px",textAlign:"center"}}>
                      <div style={{fontSize:24,marginBottom:4}}>✅</div>
                      <div style={{fontSize:12,fontWeight:600,color:"#166534"}}>Inventario OK</div>
                      <div style={{fontSize:10,color:"var(--green-600)",marginTop:2}}>Todo bien abastecido</div>
                    </div>
                  )}

                  {/* Accesos rápidos */}
                  {isConsultor && (
                    <div style={{background:"var(--white)",border:"1.5px solid var(--gray-100)",borderRadius:14,padding:"14px 16px"}}>
                      <div style={{fontWeight:700,fontSize:12,color:"var(--gray-500)",textTransform:"uppercase",letterSpacing:.5,marginBottom:10}}>Accesos rápidos</div>
                      {[
                        {lbl:"📷 Registrar",   fn:()=>setTab("registrar"),   bg:"#f0fdf4",c:"#166534"},
                        {lbl:"↕ Movimiento",   fn:()=>setMovModal(true),     bg:"#eff6ff",c:"#1d4ed8"},
                        {lbl:"🗺 Bodega",       fn:()=>setTab("bodega"),      bg:"#f5f3ff",c:"#7c3aed"},
                        {lbl:"📈 Análisis",     fn:()=>setTab("analisis"),    bg:"#fff7ed",c:"#c2410c"},
                      ].map(({lbl,fn,bg,c})=>(
                        <button key={lbl} onClick={fn} style={{display:"block",width:"100%",padding:"8px 12px",marginBottom:6,background:bg,border:"none",borderRadius:8,cursor:"pointer",fontSize:12,fontWeight:600,color:c,textAlign:"left"}}>
                          {lbl}
                        </button>
                      ))}
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
                  <div style={S.fGrp}><label style={S.lbl}>Código de Barras</label><input style={S.inp} value={form.codigoBarras} placeholder="7702020012345" onChange={e=>setForm(f=>({...f,codigoBarras:e.target.value}))}/></div>
                  <div style={S.fGrp}><label style={S.lbl}>Categoría *</label>
                    <select style={S.inp} value={form.categoria} onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}>
                      <option value="">Seleccionar...</option>{CATS.map(x=><option key={x}>{x}</option>)}
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
                    <option value="">Todas las categorías</option>{CATS.map(x=><option key={x}>{x}</option>)}
                  </select>
                  {isConsultor && <button style={S.btn("var(--green-600)")} onClick={()=>setTab("registrar")}>+ Registrar</button>}
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
                            <tr key={p.id} style={{background:"#f0fdf4"}}>
                              <td style={S.td} colSpan={5}>
                                <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                                  {[["stock","Stock",editData.stock,70],["minimo","Mín",editData.minimo,60],["precioCompra","P.Compra",editData.precioCompra,100],["precioVenta","P.Venta",editData.precioVenta,100]].map(([k,lbl,v,w])=>(
                                    <div key={k}><div style={{fontSize:10,color:"var(--gray-500)",marginBottom:3}}>{lbl}</div>
                                    <input style={{...S.inp,width:w,padding:"7px 9px"}} type="number" value={v} onChange={e=>setEditData(d=>({...d,[k]:Number(e.target.value)}))}/></div>
                                  ))}
                                </div>
                              </td>
                              <td style={S.td}></td><td style={S.td}></td>
                              <td style={S.td}><div style={{display:"flex",gap:4}}>
                                <button style={S.bSm("var(--green-600)")} onClick={()=>saveEdit(p)}>✅</button>
                                <button style={S.bSm("var(--gray-100)","var(--gray-600)")} onClick={()=>setEditId(null)}>✖</button>
                              </div></td>
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
                  <button style={S.btn()} onClick={()=>setTab("master")}>Ir a Master DB →</button>
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
              <div style={S.secH}>
                <div><div style={S.secT}>🗺 Mapa de Bodega</div><div style={S.secS}>Visualización de armarios, estantes y ubicación de productos</div></div>
              </div>
              {(() => {
                const byArmario = {};
                products.forEach(p => {
                  const arm = p.armario || "__sin__";
                  if (!byArmario[arm]) byArmario[arm] = [];
                  byArmario[arm].push(p);
                });
                const ubicados   = Object.keys(byArmario).filter(k=>k!=="__sin__").sort();
                const sinUbicar  = byArmario["__sin__"] || [];

                return (
                  <div>
                    {sinUbicar.length > 0 && (
                      <div style={{...S.card,background:"#fffbeb",border:"1.5px solid #fcd34d",marginBottom:16}}>
                        <div style={{fontWeight:700,fontSize:13,color:"#92400e",marginBottom:8}}>⚠️ {sinUbicar.length} producto{sinUbicar.length>1?"s":""} sin ubicación asignada</div>
                        <div style={{display:"flex",flexWrap:"wrap",gap:6}}>
                          {sinUbicar.map(p=>(
                            <span key={p.id} style={{padding:"3px 10px",background:"#fef3c7",borderRadius:20,fontSize:11,color:"#92400e",fontWeight:600}}>{p.nombre}</span>
                          ))}
                        </div>
                      </div>
                    )}

                    {ubicados.length===0 && sinUbicar.length===0 && (
                      <div style={{...S.card,textAlign:"center",padding:"48px 20px"}}>
                        <div style={{fontSize:48,marginBottom:12}}>🗺</div>
                        <div style={{fontWeight:700,fontSize:18,color:"var(--gray-800)",marginBottom:8}}>El mapa está vacío</div>
                        <div style={{color:"var(--gray-500)",marginBottom:20}}>Registra productos y asígnales Armario y Segmento para visualizarlos aquí</div>
                        <button style={S.btn()} onClick={()=>setTab("registrar")}>📷 Ir a Registrar</button>
                      </div>
                    )}

                    <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(280px,1fr))",gap:16}}>
                      {ubicados.map(armario => {
                        const items = byArmario[armario];
                        const bySegmento = {};
                        items.forEach(p => {
                          const seg = p.segmento || "General";
                          if (!bySegmento[seg]) bySegmento[seg] = [];
                          bySegmento[seg].push(p);
                        });
                        const segs = Object.keys(bySegmento).sort();
                        return (
                          <div key={armario} style={{background:"var(--white)",borderRadius:16,overflow:"hidden",boxShadow:"var(--shadow-sm)",border:"1.5px solid var(--gray-200)"}}>
                            <div style={{background:"var(--green-700)",padding:"12px 16px",display:"flex",alignItems:"center",gap:8}}>
                              <span style={{fontSize:22}}>🗄</span>
                              <div>
                                <div style={{fontWeight:800,fontSize:15,color:"#fff"}}>{armario}</div>
                                <div style={{fontSize:11,color:"rgba(255,255,255,.7)"}}>{items.length} producto{items.length>1?"s":""}</div>
                              </div>
                            </div>
                            <div style={{padding:12,display:"flex",flexDirection:"column",gap:8}}>
                              {segs.map((seg,si) => (
                                <div key={seg} style={{border:"1.5px solid var(--gray-100)",borderRadius:10,overflow:"hidden"}}>
                                  <div style={{background:"var(--green-50)",padding:"6px 12px",fontSize:11,fontWeight:700,color:"var(--green-700)",borderBottom:"1px solid var(--gray-100)",display:"flex",alignItems:"center",gap:6}}>
                                    <span style={{background:"var(--green-600)",color:"#fff",width:18,height:18,borderRadius:5,display:"inline-flex",alignItems:"center",justifyContent:"center",fontSize:10,fontWeight:800,flexShrink:0}}>{si+1}</span>
                                    {seg}
                                    <span style={{marginLeft:"auto",fontSize:10,color:"var(--gray-400)"}}>{bySegmento[seg].length} ítem{bySegmento[seg].length>1?"s":""}</span>
                                  </div>
                                  <div style={{padding:"8px 12px",display:"flex",flexWrap:"wrap",gap:5}}>
                                    {bySegmento[seg].map(p => {
                                      const st  = p.stock===0?"#fee2e2":p.stock<=p.minimo?"#fef3c7":"#dcfce7";
                                      const stc = p.stock===0?"#991b1b":p.stock<=p.minimo?"#92400e":"#166534";
                                      return (
                                        <div key={p.id} title={`Stock: ${p.stock} | Lote: ${p.lote||"—"} | Vence: ${p.fechaVencimiento||"—"}`}
                                          style={{padding:"4px 10px",borderRadius:20,fontSize:11,fontWeight:600,background:st,color:stc,cursor:"default"}}>
                                          {p.nombre.length>22?p.nombre.slice(0,20)+"…":p.nombre}
                                          <span style={{marginLeft:4,opacity:.75}}>×{p.stock}</span>
                                        </div>
                                      );
                                    })}
                                  </div>
                                </div>
                              ))}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              })()}
            </div>
          )}

          {/* ════ ANÁLISIS ════ */}
          {tab==="analisis" && (
            <div className="fadeUp">
              <div style={S.secH}><div><div style={S.secT}>Análisis</div><div style={S.secS}>Inteligencia para tu negocio</div></div></div>

              <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:16,marginBottom:16}}>
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
              <div style={{width:110,background:"var(--green-50)",borderRight:"1px solid var(--gray-100)",padding:"12px 0",flexShrink:0,overflowY:"auto"}}>
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
                  <button key={id} onClick={()=>{setTab(id);setSidebarOpen(false);}} style={{display:"flex",alignItems:"center",gap:10,width:"100%",padding:"11px 16px",background:tab===id?"var(--green-50)":"none",border:"none",borderLeft:`3px solid ${tab===id?"var(--green-600)":"transparent"}`,cursor:"pointer",fontSize:13,fontWeight:tab===id?700:500,color:tab===id?"var(--green-800)":"var(--gray-700)",textAlign:"left"}}>
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
            <option value="">Seleccionar...</option>{CATS.map(c=><option key={c}>{c}</option>)}
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
