exports.handler = async (event) => {
  if (event.httpMethod === "OPTIONS") return { statusCode:200, headers:{"Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS"}, body:"" };
  if (event.httpMethod !== "POST") return { statusCode:405, body:"Method Not Allowed" };

  const CORS = { "Access-Control-Allow-Origin":"*","Access-Control-Allow-Headers":"Content-Type","Access-Control-Allow-Methods":"POST, OPTIONS" };

  try {
    const { imageBase64, mimeType = "image/jpeg", barcodeOnly = false } = JSON.parse(event.body || "{}");
    if (!imageBase64) return { statusCode:400, headers:CORS, body: JSON.stringify({ success:false, error:"No image" }) };

    const prompt = barcodeOnly
      ? `Analiza esta imagen y extrae ÚNICAMENTE el número del código de barras (EAN, UPC, o código similar). 
Devuelve SOLO un JSON válido sin markdown: { "codigoBarras": "número exacto del código de barras" }
Si no hay código de barras visible o no puedes leerlo claramente, devuelve: { "codigoBarras": null }
No incluyas guiones, espacios ni caracteres especiales en el número.`
      : `Eres un experto en productos de consumo masivo de Colombia. Analiza esta imagen e identifica el producto.
Devuelve SOLO un JSON válido (sin markdown, sin backticks) con estos campos:
{
  "nombre": "nombre comercial completo con peso/volumen",
  "categoria": "una de: Granos y Cereales, Lácteos, Bebidas, Aseo Personal, Limpieza Hogar, Snacks, Enlatados, Panadería, Carnes y Embutidos, Frutas y Verduras, Condimentos, Suministros, Equipos, Otro",
  "envase": "una de: Bolsa, Botella, Caja, Lata, Tarro, Doypack, Sachet, Unidad, Paquete, Gramos, Litros",
  "codigoBarras": "código de barras si es visible, sino null",
  "codigo": "código interno sugerido de 3-6 letras",
  "unidad": "una de: unid, kg, g, lt, ml, paq",
  "precioVenta": número en COP sin puntos ni comas,
  "precioCompra": número en COP aproximado al 70% del precio de venta,
  "proveedor": "distribuidor o fabricante más probable",
  "fechaVencimiento": "YYYY-MM-DD si visible, sino null",
  "lote": "número de lote si visible, sino null",
  "nota": "observación relevante"
}
Precios de referencia Colombia 2024: Snacks 60-100g: 2500-4500 | Bebidas 250-500ml: 2000-5000 | Bebidas 1L+: 4000-9000 | Lácteos: 2000-5000 | Arroz/Azúcar 500g: 3000-5000.`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": process.env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4-20250514",
        max_tokens: barcodeOnly ? 100 : 1000,
        messages: [{
          role: "user",
          content: [
            { type:"image", source:{ type:"base64", media_type:mimeType, data:imageBase64 } },
            { type:"text", text: prompt }
          ]
        }]
      })
    });

    const data = await response.json();
    if (!response.ok) throw new Error(data.error?.message || "API error");

    const text = data.content?.[0]?.text || "";
    const clean = text.replace(/```json|```/g, "").trim();
    const parsed = JSON.parse(clean);

    // Para barcodeOnly, devolver en formato compatible
    if (barcodeOnly) {
      return {
        statusCode: 200,
        headers: { ...CORS, "Content-Type":"application/json" },
        body: JSON.stringify({ success:true, product: { codigoBarras: parsed.codigoBarras } })
      };
    }

    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type":"application/json" },
      body: JSON.stringify({ success:true, product: parsed })
    };

  } catch(e) {
    return {
      statusCode: 200,
      headers: { ...CORS, "Content-Type":"application/json" },
      body: JSON.stringify({ success:false, error: e.message })
    };
  }
};
