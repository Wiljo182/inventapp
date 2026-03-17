import { useState, useEffect, useRef } from "react";
import { db } from "./firebase";
import {
  collection, addDoc, getDocs, updateDoc, deleteDoc, doc, orderBy, query,
} from "firebase/firestore";

// ─── CONSTANTES ──────────────────────────────────────────────────────────────
const CATS = [
  "Granos y Cereales","Lácteos","Bebidas","Aseo Personal",
  "Limpieza Hogar","Snacks","Enlatados","Panadería",
  "Carnes y Embutidos","Frutas y Verduras","Condimentos","Otro",
];
const ENVASES  = ["Bolsa","Botella","Caja","Lata","Tarro","Doypack","Sachet","Unidad"];
const UNIDADES = ["unid","kg","g","lt","ml","paq"];
const CAT_COLOR = {
  "Granos y Cereales":"#E8A020","Lácteos":"#60A5FA","Bebidas":"#34D399",
  "Aseo Personal":"#F472B6","Limpieza Hogar":"#A78BFA","Snacks":"#FB923C",
  "Enlatados":"#94A3B8","Panadería":"#FCD34D","Carnes y Embutidos":"#F87171",
  "Frutas y Verduras":"#4ADE80","Condimentos":"#FBBF24","Otro":"#94A3B8",
};

const emptyForm = () => ({
  nombre:"", codigo:"", codigoBarras:"", categoria:"", envase:"",
  stock:"", minimo:"5", precioCompra:"", precioVenta:"",
  proveedor:"", unidad:"unid", nota:"",
});

// ─── RESIZE IMAGEN ────────────────────────────────────────────────────────────
function resizeImage(file, maxPx = 1024) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = (ev) => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, maxPx / Math.max(img.width, img.height, 1));
        const w = Math.round(img.width * scale);
        const h = Math.round(img.height * scale);
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        canvas.getContext("2d").drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL("image/jpeg", 0.85);
        resolve({ dataUrl, base64: dataUrl.split(",")[1] });
      };
      img.src = ev.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ─── HELPERS ─────────────────────────────────────────────────────────────────
const fmt   = (n) => n ? "$" + Number(n).toLocaleString("es-CO") : "—";
const fmtDt = (iso) => new Date(iso).toLocaleDateString("es-CO",
  { day:"2-digit", month:"short", hour:"2-digit", minute:"2-digit" });
const stOf  = (p) => p.stock === 0 ? "critical" : p.stock <= p.minimo ? "low" : "ok";
const ST = {
  ok:       { label:"Normal",     bg:"#DCFCE7", tx:"#166534" },
  low:      { label:"Stock Bajo", bg:"#FEF3C7", tx:"#92400E" },
  critical: { label:"Sin Stock",  bg:"#FEE2E2", tx:"#991B1B" },
};

// ─── ESTILOS BASE ─────────────────────────────────────────────────────────────
const S = {
  hdr:   { background:"#1A3A5C", padding:"0 18px", display:"flex", alignItems:"center",
            justifyContent:"space-between", height:58, position:"sticky", top:0, zIndex:50,
            boxShadow:"0 2px 14px rgba(0,0,0,0.25)" },
  logo:  { fontWeight:900, fontSize:20, color:"#fff", letterSpacing:-0.5 },
  tabs:  { background:"#1A3A5C", display:"flex", padding:"0 14px",
            borderTop:"1px solid rgba(255,255,255,0.08)", overflowX:"auto", gap:2 },
  tab:   (a) => ({ padding:"11px 15px", cursor:"pointer", fontSize:13, fontWeight:600,
                   color: a ? "#E8A020" : "rgba(255,255,255,0.55)", background:"none",
                   border:"none", borderBottom: a ? "3px solid #E8A020" : "3px solid transparent",
                   whiteSpace:"nowrap" }),
  main:  { maxWidth:980, margin:"0 auto", padding:"20px 14px" },
  card:  { background:"#fff", borderRadius:16, padding:22,
            boxShadow:"0 3px 16px rgba(26,58,92,0.07)", border:"1px solid #EBE3D5", marginBottom:18 },
  secH:  { display:"flex", alignItems:"center", justifyContent:"space-between",
            marginBottom:18, flexWrap:"wrap", gap:10 },
  secT:  { fontWeight:900, fontSize:21, color:"#1A3A5C" },
  secS:  { fontSize:12, color:"#6B6557", marginTop:2 },
  kGrid: { display:"grid", gridTemplateColumns:"repeat(auto-fit,minmax(140px,1fr))",
            gap:12, marginBottom:18 },
  kCard: (c) => ({ background:"#fff", borderRadius:13, padding:"16px 14px",
                   boxShadow:"0 2px 10px rgba(0,0,0,0.06)", borderTop:`4px solid ${c}` }),
  fGrid: { display:"grid", gridTemplateColumns:"1fr 1fr", gap:13 },
  fGrp:  { display:"flex", flexDirection:"column", gap:5 },
  lbl:   { fontSize:11, fontWeight:700, color:"#6B6557",
            textTransform:"uppercase", letterSpacing:0.4 },
  inp:   { padding:"10px 13px", border:"1.5px solid #DDD4C5", borderRadius:9,
            fontSize:14, outline:"none", background:"#FEFCF7",
            width:"100%", transition:"border-color 0.15s" },
  btn:   (bg, tx="#fff", ex={}) => ({
            padding:"10px 18px", background:bg, color:tx, border:"none",
            borderRadius:9, cursor:"pointer", fontSize:14, fontWeight:700,
            display:"inline-flex", alignItems:"center", gap:6, ...ex }),
  bSm:   (bg, tx="#fff") => ({
            padding:"6px 11px", background:bg, color:tx, border:"none",
            borderRadius:7, cursor:"pointer", fontSize:12, fontWeight:700 }),
  badge: (s) => ({ padding:"3px 10px", borderRadius:20, fontSize:11, fontWeight:700,
                   background:ST[s].bg, color:ST[s].tx }),
  th:    { background:"#1A3A5C", color:"rgba(255,255,255,0.85)", padding:"10px 12px",
            textAlign:"left", fontSize:11, fontWeight:700,
            textTransform:"uppercase", letterSpacing:0.4, whiteSpace:"nowrap" },
  td:    { padding:"11px 12px", verticalAlign:"middle",
            borderBottom:"1px solid #F0E8DC", fontSize:13 },
  movI:  { display:"flex", alignItems:"center", gap:11,
            padding:"11px 0", borderBottom:"1px solid #F0E8DC" },
  ovrl:  { position:"fixed", inset:0, background:"rgba(0,0,0,0.55)", zIndex:200,
            display:"flex", alignItems:"center", justifyContent:"center", padding:18 },
  modal: { background:"#fff", borderRadius:18, padding:26,
            width:"100%", maxWidth:460, boxShadow:"0 20px 60px rgba(0,0,0,0.25)" },
};

// ─── COMPONENTE SCANNER ───────────────────────────────────────────────────────
function Scanner({ onResult }) {
  const [state, setState]   = useState("idle"); // idle | loading | ok | error
  const [msg,   setMsg]     = useState("");
  const [photo, setPhoto]   = useState(null);

  const scanColors = {
    loading:{ bg:"#EFF6FF", bd:"#93C5FD", tx:"#1D4ED8" },
    ok:     { bg:"#DCFCE7", bd:"#86EFAC", tx:"#166534" },
    error:  { bg:"#FEF3C7", bd:"#FCD34D", tx:"#92400E" },
  };

  async function handleFile(file) {
    if (!file) return;
    setState("loading");
    setMsg("🔍 Claude Vision analizando el producto...");

    try {
      const { dataUrl, base64 } = await resizeImage(file, 1024);
      setPhoto(dataUrl);

      const res  = await fetch("/.netlify/functions/scan-product", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ imageBase64: base64, mimeType: "image/jpeg" }),
      });

      const data = await res.json();
      if (!res.ok || !data.success) throw new Error(data.error || "Error del servidor");

      setState("ok");
      setMsg("✅ " + (data.product.nombre || "Producto identificado") + " — revisa y ajusta si es necesario");
      onResult(data.product, dataUrl);

    } catch (err) {
      console.error(err);
      setState("error");
      setMsg("⚠️ No se pudo identificar — completa los datos manualmente. (" + err.message + ")");
    }
  }

  function reset() { setState("idle"); setMsg(""); setPhoto(null); }

  return (
    <div>
      {/* PREVIEW */}
      {photo && (
        <div style={{ position:"relative", marginBottom:14, borderRadius:13,
                      overflow:"hidden", maxHeight:270 }}>
          <img src={photo} alt="producto"
               style={{ width:"100%", objectFit:"cover", display:"block", maxHeight:270 }} />
          {state === "loading" && (
            <div style={{ position:"absolute", inset:0, background:"rgba(26,58,92,0.82)",
                          display:"flex", flexDirection:"column",
                          alignItems:"center", justifyContent:"center", gap:14 }}>
              <div style={{ width:48, height:48,
                            border:"4px solid rgba(255,255,255,0.25)",
                            borderTop:"4px solid #E8A020", borderRadius:"50%",
                            animation:"spin 0.75s linear infinite" }} />
              <div style={{ color:"#fff", fontWeight:700, fontSize:15 }}>
                Claude Vision analizando...
              </div>
              <div style={{ color:"rgba(255,255,255,0.65)", fontSize:12 }}>
                Identificando marca, categoría y precios COP
              </div>
            </div>
          )}
        </div>
      )}

      {/* BANNER ESTADO */}
      {state !== "idle" && scanColors[state] && (
        <div style={{ padding:"12px 15px", borderRadius:10, marginBottom:14,
                      background:scanColors[state].bg, border:`1.5px solid ${scanColors[state].bd}`,
                      color:scanColors[state].tx, fontSize:13, fontWeight:600,
                      display:"flex", gap:8, alignItems:"flex-start" }}>
          <span style={{ flexShrink:0 }}>
            {state==="loading" ? "⏳" : state==="ok" ? "✅" : "⚠️"}
          </span>
          <span>{msg}</span>
        </div>
      )}

      {/* PLACEHOLDER sin foto */}
      {!photo && (
        <div style={{ background:"#F0F4F8", borderRadius:13, padding:"28px 20px",
                      textAlign:"center", marginBottom:14,
                      border:"2px dashed #B8CCE0" }}>
          <div style={{ fontSize:42, marginBottom:8 }}>📷</div>
          <div style={{ fontSize:14, color:"#1A3A5C", fontWeight:700, marginBottom:4 }}>
            Toca un botón para escanear
          </div>
          <div style={{ fontSize:12, color:"#6B6557" }}>
            Claude Vision leerá el empaque e identificará el producto automáticamente
          </div>
        </div>
      )}

      {/* BOTONES — label nativo que iOS respeta */}
      <div style={{ display:"flex", gap:10, flexWrap:"wrap" }}>
        {/* Cámara trasera */}
        <label style={{ ...S.btn("#1A3A5C"), cursor:"pointer" }}>
          📷 Cámara
          <input type="file" accept="image/*" capture="environment"
                 onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value=""; }} />
        </label>

        {/* Galería */}
        <label style={{ ...S.btn("#fff","#1A3A5C",{border:"2px solid #1A3A5C"}), cursor:"pointer" }}>
          🖼 Galería
          <input type="file" accept="image/*"
                 onChange={e => { if (e.target.files[0]) handleFile(e.target.files[0]); e.target.value=""; }} />
        </label>

        {photo && (
          <button style={S.btn("#FEE2E2","#C0392B")} onClick={reset}>✖ Quitar</button>
        )}
      </div>
    </div>
  );
}

// ─── APP PRINCIPAL ────────────────────────────────────────────────────────────
export default function App() {
  const [tab,      setTab]      = useState("dashboard");
  const [products, setProducts] = useState([]);
  const [movements,setMovements]= useState([]);
  const [loading,  setLoading]  = useState(true);
  const [form,     setForm]     = useState(emptyForm());
  const [toast,    setToast]    = useState(null);
  const [search,   setSearch]   = useState("");
  const [catFilter,setCatF]     = useState("");
  const [editId,   setEditId]   = useState(null);
  const [editData, setEditData] = useState({});
  const [movModal, setMovModal] = useState(false);
  const [movForm,  setMovForm]  = useState({pid:"",tipo:"entrada",qty:"",motivo:""});
  const toastRef = useRef(null);

  // ── Firebase: cargar datos ──
  useEffect(() => {
    async function load() {
      try {
        const [pSnap, mSnap] = await Promise.all([
          getDocs(query(collection(db,"products"), orderBy("fechaReg","desc"))),
          getDocs(query(collection(db,"movements"), orderBy("fecha","desc"))),
        ]);
        setProducts(pSnap.docs.map(d => ({ id:d.id, ...d.data() })));
        setMovements(mSnap.docs.map(d => ({ id:d.id, ...d.data() })));
      } catch(e) {
        console.error(e);
        showToast("⚠️ Error cargando datos de Firebase","warning");
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // ── Toast ──
  function showToast(msg, type="info") {
    clearTimeout(toastRef.current);
    setToast({ msg, type });
    toastRef.current = setTimeout(() => setToast(null), 3500);
  }

  // ── Scanner callback ──
  function onScanResult(product) {
    setForm(f => ({
      ...f,
      nombre:       product.nombre        || f.nombre,
      codigo:       product.codigo        || f.codigo,
      codigoBarras: product.codigoBarras  || f.codigoBarras,
      categoria:    CATS.includes(product.categoria) ? product.categoria : f.categoria,
      envase:       ENVASES.includes(product.envase) ? product.envase    : f.envase,
      unidad:       UNIDADES.includes(product.unidad)? product.unidad    : f.unidad,
      precioVenta:  product.precioVenta   ? String(product.precioVenta)  : f.precioVenta,
      precioCompra: product.precioCompra  ? String(product.precioCompra) : f.precioCompra,
      proveedor:    product.proveedor     || f.proveedor,
      nota:         product.nota          || f.nota,
    }));
    // scroll al form
    setTimeout(() => document.getElementById("form-nombre")?.scrollIntoView({ behavior:"smooth", block:"center" }), 300);
  }

  // ── Guardar producto ──
  async function saveProduct() {
    if (!form.nombre.trim() || !form.categoria) {
      showToast("⚠️ Nombre y categoría son obligatorios","warning"); return;
    }
    try {
      const data = {
        ...form,
        stock:        parseInt(form.stock)        || 0,
        minimo:       parseInt(form.minimo)        || 5,
        precioCompra: parseFloat(form.precioCompra)|| 0,
        precioVenta:  parseFloat(form.precioVenta) || 0,
        fechaReg:     new Date().toISOString(),
      };
      const ref = await addDoc(collection(db,"products"), data);
      const newP = { id:ref.id, ...data };
      setProducts(prev => [newP, ...prev]);
      if (data.stock > 0) {
        const mov = { productoId:ref.id, nombre:data.nombre, tipo:"entrada",
                      cantidad:data.stock, motivo:"Registro inicial", fecha:new Date().toISOString() };
        const mRef = await addDoc(collection(db,"movements"), mov);
        setMovements(prev => [{ id:mRef.id, ...mov }, ...prev]);
      }
      setForm(emptyForm());
      showToast("✅ " + data.nombre + " guardado en Firebase","success");
      setTab("inventario");
    } catch(e) {
      showToast("❌ Error guardando: " + e.message,"warning");
    }
  }

  // ── Editar ──
  function startEdit(p) { setEditId(p.id); setEditData({ stock:p.stock, minimo:p.minimo, precioCompra:p.precioCompra, precioVenta:p.precioVenta }); }
  async function saveEdit(p) {
    try {
      await updateDoc(doc(db,"products",p.id), editData);
      setProducts(prev => prev.map(x => x.id===p.id ? {...x,...editData} : x));
      setEditId(null);
      showToast("✅ Actualizado","success");
    } catch(e) { showToast("❌ Error: "+e.message,"warning"); }
  }

  // ── Eliminar ──
  async function deleteProduct(p) {
    if (!window.confirm("¿Eliminar " + p.nombre + "?")) return;
    try {
      await deleteDoc(doc(db,"products",p.id));
      setProducts(prev => prev.filter(x => x.id !== p.id));
      showToast("🗑 Eliminado","info");
    } catch(e) { showToast("❌ Error: "+e.message,"warning"); }
  }

  // ── Movimiento ──
  async function saveMovement() {
    const p = products.find(x => x.id === movForm.pid);
    const qty = parseInt(movForm.qty)||0;
    if (!p || qty<=0) { showToast("⚠️ Completa todos los campos","warning"); return; }
    if (movForm.tipo==="salida" && qty>p.stock) { showToast("⚠️ Stock insuficiente","warning"); return; }
    try {
      const newStock = movForm.tipo==="entrada" ? p.stock+qty : p.stock-qty;
      await updateDoc(doc(db,"products",p.id), { stock:newStock });
      const mov = { productoId:p.id, nombre:p.nombre, tipo:movForm.tipo,
                    cantidad:qty, motivo:movForm.motivo||"Sin motivo", fecha:new Date().toISOString() };
      const mRef = await addDoc(collection(db,"movements"), mov);
      setProducts(prev => prev.map(x => x.id===p.id ? {...x, stock:newStock} : x));
      setMovements(prev => [{ id:mRef.id, ...mov }, ...prev]);
      setMovModal(false);
      setMovForm({pid:"",tipo:"entrada",qty:"",motivo:""});
      showToast("✅ Movimiento registrado","success");
    } catch(e) { showToast("❌ Error: "+e.message,"warning"); }
  }

  // ── Exportar CSV ──
  function exportCSV() {
    const rows = products.map(p =>
      [p.nombre,p.codigo,p.codigoBarras||"",p.categoria,p.envase,p.stock,p.minimo,p.precioCompra,p.precioVenta,p.proveedor,p.unidad].join(","));
    const csv = ["Nombre,Codigo,CodigoBarras,Categoria,Envase,Stock,Minimo,PCompra,PVenta,Proveedor,Unidad",...rows].join("\n");
    const a = Object.assign(document.createElement("a"),{
      href: URL.createObjectURL(new Blob([csv],{type:"text/csv"})),
      download:`inventario_${new Date().toISOString().slice(0,10)}.csv`
    });
    a.click();
    showToast("📥 CSV exportado","success");
  }

  // ── KPIs ──
  const alerts   = products.filter(p => p.stock <= p.minimo);
  const totalVal = products.reduce((s,p) => s + (p.stock * p.precioVenta), 0);
  const filtered = products.filter(p => {
    const ms = p.nombre?.toLowerCase().includes(search.toLowerCase()) ||
               p.codigo?.toLowerCase().includes(search.toLowerCase()) ||
               p.codigoBarras?.includes(search);
    return ms && (!catFilter || p.categoria===catFilter);
  });

  if (loading) return (
    <div style={{ display:"flex", alignItems:"center", justifyContent:"center",
                  height:"100vh", flexDirection:"column", gap:16, background:"#F5EFE0" }}>
      <div style={{ width:50, height:50, border:"4px solid #DDD4C5",
                    borderTop:"4px solid #1A3A5C", borderRadius:"50%",
                    animation:"spin 0.8s linear infinite" }} />
      <div style={{ color:"#1A3A5C", fontWeight:700, fontSize:16 }}>Cargando InventApp...</div>
    </div>
  );

  return (
    <div style={{ fontFamily:"Inter,system-ui,sans-serif", background:"#F5EFE0", minHeight:"100vh" }}>

      {/* ── HEADER ── */}
      <header style={S.hdr}>
        <span style={S.logo}>🏪 Invent<span style={{color:"#E8A020"}}>App</span></span>
        <span style={{ background:"rgba(255,255,255,0.12)", color:"#fff",
                       padding:"5px 12px", borderRadius:20, fontSize:12, fontWeight:600 }}>
          Cartagena 🇨🇴
        </span>
      </header>

      {/* ── TABS ── */}
      <nav style={S.tabs}>
        {[["dashboard","📊 Dashboard"],["registrar","📷 Registrar"],
          ["inventario","📦 Inventario"],["movimientos","↕ Movimientos"],
          ["analisis","📈 Análisis"]].map(([id,lbl]) => (
          <button key={id} style={S.tab(tab===id)} onClick={() => setTab(id)}>{lbl}</button>
        ))}
      </nav>

      <main style={S.main}>

        {/* ════ DASHBOARD ════ */}
        {tab==="dashboard" && (
          <div className="fadeIn">
            <div style={S.secH}>
              <div>
                <div style={S.secT}>Dashboard</div>
                <div style={S.secS}>{new Date().toLocaleDateString("es-CO",{weekday:"long",year:"numeric",month:"long",day:"numeric"})}</div>
              </div>
              <button style={S.btn("#1A3A5C")} onClick={exportCSV}>⬇ Exportar CSV</button>
            </div>

            <div style={S.kGrid}>
              {[
                ["Productos",    products.length,                                              "#2A5F8F"],
                ["Valor Est.",   "$"+Math.round(totalVal/1000)+"K",                           "#2E7D52"],
                ["Stock Bajo",   alerts.filter(p=>p.stock>0).length,                          "#C4522A"],
                ["Sin Stock",    products.filter(p=>p.stock===0).length,                      "#C0392B"],
                ["Categorías",   new Set(products.map(p=>p.categoria).filter(Boolean)).size,  "#E8A020"],
              ].map(([lbl,val,col]) => (
                <div key={lbl} style={S.kCard(col)}>
                  <div style={{fontSize:11,fontWeight:700,color:"#6B6557",textTransform:"uppercase",marginBottom:5}}>{lbl}</div>
                  <div style={{fontSize:26,fontWeight:900}}>{val}</div>
                </div>
              ))}
            </div>

            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:15,color:"#1A3A5C",marginBottom:14}}>🚨 Alertas de Stock</div>
              {alerts.length===0
                ? <div style={{textAlign:"center",padding:24,color:"#6B6557"}}>✅ Todo el inventario bien abastecido</div>
                : alerts.map(p => (
                  <div key={p.id} style={{display:"flex",alignItems:"center",gap:11,padding:"12px 15px",
                                          borderRadius:11,marginBottom:8,
                                          background:p.stock===0?"#FFF5F5":"#FFFBF0",
                                          borderLeft:`4px solid ${p.stock===0?"#C0392B":"#E8A020"}`}}>
                    <span style={{fontSize:20}}>{p.stock===0?"🚨":"⚠️"}</span>
                    <div style={{flex:1}}>
                      <div style={{fontWeight:700,fontSize:14}}>{p.nombre}</div>
                      <div style={{fontSize:12,color:"#6B6557"}}>Stock: {p.stock} · Mín: {p.minimo} · {p.proveedor||"Sin proveedor"}</div>
                    </div>
                    <span style={{fontSize:12,fontWeight:700,color:p.stock===0?"#C0392B":"#92400E"}}>
                      {p.stock===0?"¡PEDIR YA!":"Pedir pronto"}
                    </span>
                  </div>
                ))
              }
            </div>

            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:15,color:"#1A3A5C",marginBottom:14}}>🕐 Últimos Movimientos</div>
              {movements.length===0
                ? <div style={{textAlign:"center",padding:20,color:"#6B6557"}}>Sin movimientos aún</div>
                : movements.slice(0,6).map(m => (
                  <div key={m.id} style={S.movI}>
                    <div style={{width:34,height:34,borderRadius:9,flexShrink:0,display:"flex",
                                 alignItems:"center",justifyContent:"center",fontSize:16,
                                 background:m.tipo==="entrada"?"#DCFCE7":"#FEE2E2"}}>
                      {m.tipo==="entrada"?"📥":"📤"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nombre}</div>
                      <div style={{fontSize:11,color:"#6B6557"}}>{fmtDt(m.fecha)} · {m.motivo}</div>
                    </div>
                    <span style={{fontWeight:800,flexShrink:0,color:m.tipo==="entrada"?"#2E7D52":"#C0392B"}}>
                      {m.tipo==="entrada"?"+":"-"}{m.cantidad}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* ════ REGISTRAR ════ */}
        {tab==="registrar" && (
          <div className="fadeIn">
            <div style={S.secH}>
              <div>
                <div style={S.secT}>Registrar Producto</div>
                <div style={S.secS}>Escanea con la cámara — Claude Vision identifica automáticamente</div>
              </div>
            </div>

            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:15,color:"#1A3A5C",marginBottom:16}}>
                📷 Escanear con Claude Vision
              </div>
              <Scanner onResult={onScanResult} />
            </div>

            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:15,color:"#1A3A5C",marginBottom:16}}>
                ✏️ Datos del Producto
              </div>
              <div style={S.fGrid}>
                <div style={{...S.fGrp, gridColumn:"1/-1"}}>
                  <label style={S.lbl}>Nombre del Producto *</label>
                  <input id="form-nombre" style={S.inp} type="text" value={form.nombre}
                         placeholder="Ej: Papi Papa Delgadas 60g"
                         onChange={e=>setForm(f=>({...f,nombre:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Código Interno</label>
                  <input style={S.inp} type="text" value={form.codigo}
                         placeholder="Ej: SNA-001"
                         onChange={e=>setForm(f=>({...f,codigo:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Código de Barras</label>
                  <input style={S.inp} type="text" value={form.codigoBarras}
                         placeholder="Ej: 7702020012345"
                         onChange={e=>setForm(f=>({...f,codigoBarras:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Categoría *</label>
                  <select style={S.inp} value={form.categoria}
                          onChange={e=>setForm(f=>({...f,categoria:e.target.value}))}>
                    <option value="">Seleccionar...</option>
                    {CATS.map(x => <option key={x}>{x}</option>)}
                  </select>
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Tipo de Envase</label>
                  <select style={S.inp} value={form.envase}
                          onChange={e=>setForm(f=>({...f,envase:e.target.value}))}>
                    <option value="">Seleccionar...</option>
                    {ENVASES.map(x => <option key={x}>{x}</option>)}
                  </select>
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Stock Actual *</label>
                  <input style={S.inp} type="number" value={form.stock} placeholder="0"
                         onChange={e=>setForm(f=>({...f,stock:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Stock Mínimo (alerta)</label>
                  <input style={S.inp} type="number" value={form.minimo} placeholder="5"
                         onChange={e=>setForm(f=>({...f,minimo:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Precio Compra (COP)</label>
                  <input style={S.inp} type="number" value={form.precioCompra} placeholder="0"
                         onChange={e=>setForm(f=>({...f,precioCompra:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Precio Venta (COP)</label>
                  <input style={S.inp} type="number" value={form.precioVenta} placeholder="0"
                         onChange={e=>setForm(f=>({...f,precioVenta:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Proveedor</label>
                  <input style={S.inp} type="text" value={form.proveedor}
                         placeholder="Ej: Distribuidora Caribe"
                         onChange={e=>setForm(f=>({...f,proveedor:e.target.value}))} />
                </div>

                <div style={S.fGrp}>
                  <label style={S.lbl}>Unidad de Medida</label>
                  <select style={S.inp} value={form.unidad}
                          onChange={e=>setForm(f=>({...f,unidad:e.target.value}))}>
                    {UNIDADES.map(x => <option key={x}>{x}</option>)}
                  </select>
                </div>

                <div style={{...S.fGrp, gridColumn:"1/-1"}}>
                  <label style={S.lbl}>Nota / Observación</label>
                  <textarea style={{...S.inp,minHeight:64,resize:"vertical"}}
                            value={form.nota} placeholder="Alta rotación, refrigerar, etc."
                            onChange={e=>setForm(f=>({...f,nota:e.target.value}))} />
                </div>
              </div>

              <div style={{display:"flex",gap:10,marginTop:18,flexWrap:"wrap"}}>
                <button style={S.btn("#C4522A")} onClick={saveProduct}>💾 Guardar en Firebase</button>
                <button style={S.btn("#fff","#6B6557",{border:"1.5px solid #DDD4C5"})}
                        onClick={() => setForm(emptyForm())}>🗑 Limpiar</button>
              </div>
            </div>
          </div>
        )}

        {/* ════ INVENTARIO ════ */}
        {tab==="inventario" && (
          <div className="fadeIn">
            <div style={S.secH}>
              <div>
                <div style={S.secT}>Inventario</div>
                <div style={S.secS}>{products.length} productos registrados</div>
              </div>
              <div style={{display:"flex",gap:8,flexWrap:"wrap"}}>
                <select style={{...S.inp,width:"auto",fontSize:12,padding:"7px 10px"}}
                        value={catFilter} onChange={e=>setCatF(e.target.value)}>
                  <option value="">Todas las categorías</option>
                  {CATS.map(x=><option key={x}>{x}</option>)}
                </select>
                <button style={S.btn("#C4522A")} onClick={()=>setTab("registrar")}>+ Registrar</button>
              </div>
            </div>

            <div style={S.card}>
              <input style={{...S.inp,marginBottom:14}}
                     placeholder="🔍 Buscar por nombre, código o código de barras..."
                     value={search} onChange={e=>setSearch(e.target.value)} />

              {filtered.length===0
                ? <div style={{textAlign:"center",padding:"28px 0",color:"#6B6557"}}>
                    📦 No hay productos. ¡Registra el primero!
                  </div>
                : <div style={{overflowX:"auto"}}>
                    <table>
                      <thead>
                        <tr>
                          {["Producto","Categoría","Stock","Mín","Estado","P.Venta",""].map((h,i) => (
                            <th key={i} style={{...S.th,
                              ...(i===0?{borderRadius:"9px 0 0 9px"}:{}),
                              ...(i===6?{borderRadius:"0 9px 9px 0"}:{})}}>{h}</th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map(p => {
                          const st = stOf(p);
                          const col = CAT_COLOR[p.categoria]||"#94A3B8";
                          return editId===p.id ? (
                            <tr key={p.id} style={{background:"#FFFDF5"}}>
                              <td style={S.td} colSpan={4}>
                                <div style={{display:"flex",gap:7,flexWrap:"wrap"}}>
                                  {[["stock","Stock",editData.stock,80],
                                    ["minimo","Mín",editData.minimo,70],
                                    ["precioCompra","P.Compra",editData.precioCompra,100],
                                    ["precioVenta","P.Venta",editData.precioVenta,100]
                                  ].map(([k,lbl,v,w])=>(
                                    <div key={k}>
                                      <div style={{fontSize:10,color:"#6B6557",marginBottom:3}}>{lbl}</div>
                                      <input style={{...S.inp,width:w,padding:"7px 9px"}} type="number"
                                             value={editData[k]}
                                             onChange={e=>setEditData(d=>({...d,[k]:Number(e.target.value)}))}/>
                                    </div>
                                  ))}
                                </div>
                              </td>
                              <td style={S.td}></td>
                              <td style={S.td}></td>
                              <td style={S.td}>
                                <div style={{display:"flex",gap:4}}>
                                  <button style={S.bSm("#2E7D52")} onClick={()=>saveEdit(p)}>✅</button>
                                  <button style={S.bSm("#f0f0f0","#666")} onClick={()=>setEditId(null)}>✖</button>
                                </div>
                              </td>
                            </tr>
                          ) : (
                            <tr key={p.id}>
                              <td style={S.td}>
                                <div style={{fontWeight:700}}>{p.nombre}</div>
                                <div style={{fontSize:11,color:"#6B6557"}}>
                                  {p.codigo}{p.codigoBarras?" · 🔲"+p.codigoBarras:""}
                                </div>
                              </td>
                              <td style={S.td}>
                                <span style={{display:"inline-flex",alignItems:"center",gap:5}}>
                                  <span style={{width:8,height:8,borderRadius:"50%",background:col,display:"inline-block",flexShrink:0}}/>
                                  {p.categoria}
                                </span>
                              </td>
                              <td style={S.td}><strong>{p.stock}</strong></td>
                              <td style={S.td}>{p.minimo}</td>
                              <td style={S.td}><span style={S.badge(st)}>{ST[st].label}</span></td>
                              <td style={S.td}>{fmt(p.precioVenta)}</td>
                              <td style={S.td}>
                                <div style={{display:"flex",gap:4}}>
                                  <button style={S.bSm("#EFF6FF","#1D4ED8")} onClick={()=>startEdit(p)}>✏️</button>
                                  <button style={S.bSm("#FEE2E2","#C0392B")} onClick={()=>deleteProduct(p)}>🗑</button>
                                </div>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              }
            </div>
          </div>
        )}

        {/* ════ MOVIMIENTOS ════ */}
        {tab==="movimientos" && (
          <div className="fadeIn">
            <div style={S.secH}>
              <div><div style={S.secT}>Movimientos</div><div style={S.secS}>Entradas y salidas de inventario</div></div>
              <button style={S.btn("#2E7D52")} onClick={()=>setMovModal(true)}>+ Registrar</button>
            </div>
            <div style={S.card}>
              {movements.length===0
                ? <div style={{textAlign:"center",padding:28,color:"#6B6557"}}>Sin movimientos</div>
                : movements.map(m => (
                  <div key={m.id} style={S.movI}>
                    <div style={{width:34,height:34,borderRadius:9,flexShrink:0,display:"flex",
                                 alignItems:"center",justifyContent:"center",
                                 background:m.tipo==="entrada"?"#DCFCE7":"#FEE2E2"}}>
                      {m.tipo==="entrada"?"📥":"📤"}
                    </div>
                    <div style={{flex:1,minWidth:0}}>
                      <div style={{fontWeight:600,fontSize:13,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap"}}>{m.nombre}</div>
                      <div style={{fontSize:11,color:"#6B6557"}}>{fmtDt(m.fecha)} · {m.motivo}</div>
                    </div>
                    <span style={{fontWeight:800,flexShrink:0,color:m.tipo==="entrada"?"#2E7D52":"#C0392B"}}>
                      {m.tipo==="entrada"?"+":"-"}{m.cantidad}
                    </span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* ════ ANÁLISIS ════ */}
        {tab==="analisis" && (
          <div className="fadeIn">
            <div style={S.secH}><div><div style={S.secT}>Análisis</div><div style={S.secS}>Inteligencia para tu negocio</div></div></div>

            <div style={{display:"grid",gridTemplateColumns:"1fr 1fr",gap:14,marginBottom:14}}>
              <div style={{...S.card,marginBottom:0}}>
                <div style={{fontWeight:800,fontSize:14,color:"#1A3A5C",marginBottom:12}}>📦 Stock por Categoría</div>
                {(() => {
                  const cats={};
                  products.forEach(p=>{cats[p.categoria]=(cats[p.categoria]||0)+p.stock;});
                  const entries=Object.entries(cats);
                  const max=Math.max(...entries.map(([,v])=>v),1);
                  return entries.length===0
                    ? <div style={{color:"#6B6557",fontSize:13}}>Sin datos</div>
                    : <div style={{display:"flex",gap:5,alignItems:"flex-end",height:120}}>
                        {entries.map(([cat,val])=>(
                          <div key={cat} style={{flex:1,display:"flex",flexDirection:"column",alignItems:"center",gap:3}}>
                            <span style={{fontSize:10,fontWeight:700,color:"#444"}}>{val}</span>
                            <div style={{width:"100%",height:Math.max(10,val/max*100),
                                         background:CAT_COLOR[cat]||"#94A3B8",borderRadius:"4px 4px 0 0"}} title={cat}/>
                            <span style={{fontSize:9,color:"#6B6557",textAlign:"center"}}>{cat.split(" ")[0]}</span>
                          </div>
                        ))}
                      </div>;
                })()}
              </div>

              <div style={{...S.card,marginBottom:0}}>
                <div style={{fontWeight:800,fontSize:14,color:"#1A3A5C",marginBottom:12}}>💰 Márgenes</div>
                {(() => {
                  const wm = products.filter(p=>p.precioVenta>0&&p.precioCompra>0);
                  return wm.length===0
                    ? <div style={{color:"#6B6557",fontSize:13}}>Agrega precios</div>
                    : wm.slice(0,5).map(p=>{
                        const mg=((p.precioVenta-p.precioCompra)/p.precioVenta*100).toFixed(1);
                        const col=mg>20?"#2E7D52":mg>10?"#E8A020":"#C0392B";
                        return (
                          <div key={p.id} style={{marginBottom:9}}>
                            <div style={{display:"flex",justifyContent:"space-between",fontSize:12,marginBottom:3}}>
                              <span style={{fontWeight:600,overflow:"hidden",textOverflow:"ellipsis",whiteSpace:"nowrap",maxWidth:"75%"}}>{p.nombre}</span>
                              <span style={{fontWeight:800,color:col,flexShrink:0}}>{mg}%</span>
                            </div>
                            <div style={{height:5,background:"#F0EAE0",borderRadius:3}}>
                              <div style={{height:"100%",width:`${Math.min(mg,60)/60*100}%`,background:col,borderRadius:3}}/>
                            </div>
                          </div>
                        );
                      });
                })()}
              </div>
            </div>

            <div style={S.card}>
              <div style={{fontWeight:800,fontSize:14,color:"#1A3A5C",marginBottom:14}}>🔮 Recomendaciones de Pedido</div>
              {alerts.length===0
                ? <div style={{textAlign:"center",padding:20,color:"#6B6557"}}>✅ Inventario bien abastecido</div>
                : <div style={{overflowX:"auto"}}>
                    <table>
                      <thead><tr>{["Producto","Stock","Mín","Pedir","Costo Est.","Proveedor"].map((h,i)=>(
                        <th key={i} style={S.th}>{h}</th>
                      ))}</tr></thead>
                      <tbody>
                        {alerts.map(p => {
                          const tp = Math.max(p.minimo*3-p.stock, p.minimo);
                          return (
                            <tr key={p.id}>
                              <td style={S.td}><div style={{fontWeight:700}}>{p.nombre}</div></td>
                              <td style={S.td}><span style={S.badge(stOf(p))}>{p.stock}</span></td>
                              <td style={S.td}>{p.minimo}</td>
                              <td style={S.td}><strong>{tp}</strong> {p.unidad}</td>
                              <td style={S.td}>{tp*p.precioCompra>0?fmt(tp*p.precioCompra):"—"}</td>
                              <td style={S.td}>{p.proveedor||"—"}</td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
              }
            </div>
          </div>
        )}

      </main>

      {/* ════ MODAL MOVIMIENTO ════ */}
      {movModal && (
        <div style={S.ovrl} onClick={e=>{if(e.target===e.currentTarget)setMovModal(false)}}>
          <div style={S.modal}>
            <div style={{fontWeight:900,fontSize:18,color:"#1A3A5C",marginBottom:18}}>↕ Registrar Movimiento</div>
            <div style={{display:"flex",flexDirection:"column",gap:13}}>
              <div style={S.fGrp}>
                <label style={S.lbl}>Producto *</label>
                <select style={S.inp} value={movForm.pid} onChange={e=>setMovForm(f=>({...f,pid:e.target.value}))}>
                  <option value="">Seleccionar...</option>
                  {products.map(p=><option key={p.id} value={p.id}>{p.nombre} (Stock: {p.stock})</option>)}
                </select>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Tipo *</label>
                <select style={S.inp} value={movForm.tipo} onChange={e=>setMovForm(f=>({...f,tipo:e.target.value}))}>
                  <option value="entrada">📥 Entrada (compra / recepción)</option>
                  <option value="salida">📤 Salida (venta / consumo)</option>
                </select>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Cantidad *</label>
                <input style={S.inp} type="number" min="1" value={movForm.qty}
                       placeholder="1" onChange={e=>setMovForm(f=>({...f,qty:e.target.value}))}/>
              </div>
              <div style={S.fGrp}>
                <label style={S.lbl}>Motivo</label>
                <input style={S.inp} value={movForm.motivo}
                       placeholder="Ej: Compra proveedor, venta cliente..."
                       onChange={e=>setMovForm(f=>({...f,motivo:e.target.value}))}/>
              </div>
            </div>
            <div style={{display:"flex",gap:10,justifyContent:"flex-end",marginTop:18}}>
              <button style={S.btn("#fff","#6B6557",{border:"1.5px solid #DDD4C5"})}
                      onClick={()=>setMovModal(false)}>Cancelar</button>
              <button style={S.btn("#2E7D52")} onClick={saveMovement}>✅ Registrar</button>
            </div>
          </div>
        </div>
      )}

      {/* ════ TOAST ════ */}
      {toast && (
        <div style={{
          position:"fixed", bottom:22, left:"50%", transform:"translateX(-50%)",
          background: toast.type==="success"?"#2E7D52":toast.type==="warning"?"#E8A020":"#1A3A5C",
          color: toast.type==="warning"?"#1A1A1A":"#fff",
          padding:"13px 22px", borderRadius:12, fontSize:14, fontWeight:700,
          boxShadow:"0 8px 32px rgba(0,0,0,0.22)", zIndex:999,
          whiteSpace:"nowrap", maxWidth:"90vw", overflow:"hidden", textOverflow:"ellipsis"
        }}>
          {toast.msg}
        </div>
      )}
    </div>
  );
}
