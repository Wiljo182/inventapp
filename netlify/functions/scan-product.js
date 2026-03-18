exports.handler = async (event) => {
  if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };

  const CORS = {
    "Access-Control-Allow-Origin":  "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
  };

  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:CORS, body:"" };

  try {
    const { imageBase64, mimeType = "image/jpeg" } = JSON.parse(event.body || "{}");
    if (!imageBase64) return { statusCode:400, headers:CORS, body: JSON.stringify({ success:false, error:"No image" }) };

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type":      "application/json",
        "x-api-key":         process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model:      "claude-sonnet-4-20250514",
        max_tokens: 1000,
        messages: [{
          role: "user",
          content: [
            { type:"image", source:{ type:"base64", media_type:mimeType, data:imageBase64 } },
            { type:"text",  text: `Eres un experto en productos de consumo masivo de Colombia.
Analiza esta imagen e identifica el producto. Devuelve SOLO un JSON válido (sin markdown, sin backticks) con estos campos:

{
  "nombre": "nombre comercial completo con peso/volumen",
  "categoria": "una de: Granos y Cereales, Lácteos, Bebidas, Aseo Personal, Limpieza Hogar, Snacks, Enlatados, Panadería, Carnes y Embutidos, Frutas y Verduras, Condimentos, Otro",
  "envase": "una de: Bolsa, Botella, Caja, Lata, Tarro, Doypack, Sachet, Unidad",
  "codigoBarras": "código de barras si es visible, sino null",
  "codigo": "código interno sugerido de 3-6 letras",
  "unidad": "una de: unid, kg, g, lt, ml, paq",
  "precioVenta": número en COP basado en precios reales de Colombia (sin puntos ni comas),
  "precioCompra": número en COP aproximado al 70% del precio de venta,
  "proveedor": "distribuidor o fabricante colombiano más probable",
  "fechaVencimiento": "fecha de vencimiento en formato YYYY-MM-DD si es visible en el empaque, sino null",
  "nota": "observación relevante del producto"
}

Precios de referencia Colombia 2024:
- Snacks pequeños (60-100g): venta 2500-4500
- Bebidas 250-500ml: venta 2000-5000  
- Bebidas 1L+: venta 4000-9000
- Lácteos 200-500ml: venta 2000-5000
- Arroz/Azúcar 500g: venta 3000-5000
- Jabones/Detergentes: venta 3000-12000
- Enlatados: venta 4000-15000

Si no puedes identificar el producto con certeza, usa los campos que puedas ver claramente y deja null en el resto.`
          }]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "API error");

    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const product = JSON.parse(clean);

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type":"application/json" },
      body: JSON.stringify({ success:true, product })
    };
  } catch(e) {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type":"application/json" },
      body: JSON.stringify({ success:false, error: e.message })
    };
  }
};
