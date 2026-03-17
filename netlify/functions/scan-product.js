exports.handler = async function (event) {
  if (event.httpMethod !== "POST") {
    return { statusCode: 405, body: "Method Not Allowed" };
  }

  const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
  if (!ANTHROPIC_API_KEY) {
    return { statusCode: 500, body: JSON.stringify({ error: "API key no configurada" }) };
  }

  let body;
  try {
    body = JSON.parse(event.body);
  } catch {
    return { statusCode: 400, body: JSON.stringify({ error: "Body inválido" }) };
  }

  const { imageBase64, mimeType } = body;
  if (!imageBase64) {
    return { statusCode: 400, body: JSON.stringify({ error: "Imagen requerida" }) };
  }

  const prompt = `Eres experto en productos de consumo masivo vendidos en tiendas de barrio y minimercados de Colombia, especialmente en Cartagena.

Analiza esta imagen con MUCHO detalle. Lee TODO el texto visible en el empaque: marca, nombre del producto, gramaje, volumen, código de barras si se ve.

Responde ÚNICAMENTE con este JSON válido, sin backticks, sin texto extra:

{
  "nombre": "Nombre completo: MARCA + PRODUCTO + PRESENTACIÓN (ej: Papi Papa Delgadas 60g, Arroz Roa 1kg, Leche Colanta 900ml)",
  "categoria": "Una de exactamente: Granos y Cereales, Lácteos, Bebidas, Aseo Personal, Limpieza Hogar, Snacks, Enlatados, Panadería, Carnes y Embutidos, Frutas y Verduras, Condimentos, Otro",
  "envase": "Uno de exactamente: Bolsa, Botella, Caja, Lata, Tarro, Doypack, Sachet, Unidad",
  "codigoBarras": "el número del código de barras si es visible, si no vacío",
  "codigo": "Código corto sugerido tipo SNA-001, LAC-002, etc.",
  "unidad": "Uno de: unid, kg, g, lt, ml, paq",
  "precioVenta": número en pesos colombianos COP estimado para tienda de barrio,
  "precioCompra": número en pesos colombianos COP estimado mayorista,
  "proveedor": "Empresa distribuidora típica en Colombia para este producto",
  "nota": "Observación útil para el tendero: rotación, conservación, etc."
}

Rangos de precios COP de referencia:
- Snacks pequeños (40-80g): venta 1800-3500, compra 1200-2200
- Bebidas (250-600ml): venta 1500-4000, compra 900-2500
- Lácteos (900ml-1L): venta 3500-5000, compra 2500-3500
- Granos (500g-1kg): venta 3500-7000, compra 2500-5000
- Aseo personal: venta 4000-25000, compra 2800-18000
- Limpieza hogar: venta 3500-15000, compra 2500-10000

IMPORTANTE: Aunque no puedas leer todo el empaque, usa tu conocimiento del producto para completar los campos. Siempre devuelve JSON.`;

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-opus-4-5-20251101",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image",
                source: {
                  type: "base64",
                  media_type: mimeType || "image/jpeg",
                  data: imageBase64,
                },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      throw new Error(data?.error?.message || `HTTP ${response.status}`);
    }

    const raw = data.content?.find((b) => b.type === "text")?.text || "";
    const match = raw.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Sin JSON en respuesta");

    const product = JSON.parse(match[0]);

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ success: true, product }),
    };
  } catch (err) {
    console.error("Error Claude Vision:", err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: err.message || "Error interno" }),
    };
  }
};
