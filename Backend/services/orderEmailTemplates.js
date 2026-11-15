const safe = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
}[char]));

const clp = (amount) => "$" + Number(amount).toLocaleString("es-CL");

export function createOrderEmail(kind, id, order, items) {
  if (!["payment_confirmed", "admin_new_order"].includes(kind)) {
    throw new Error("Tipo de correo no admitido");
  }
  if (items.length === 0) throw new Error("Pedido sin productos");

  const admin = kind === "admin_new_order";
  const heading = admin ? "¡Nuevo pedido pagado!" : "¡Gracias por elegir MALFI!";
  const intro = admin
    ? "Hay un pedido confirmado que puedes revisar en el administrador."
    : "Tu pago fue confirmado. Te informaremos cuando tu pedido avance.";
  const subject = admin
    ? `MALFI · Nuevo pedido pagado #${id} [PRUEBA]`
    : `MALFI · Confirmación de compra #${id} [PRUEBA]`;
  const lines = items.map((i) =>
    `${i.product_name} x${i.quantity}: ${clp(i.line_total_clp)}`
  );
  const text = [
    "MALFI · MENSAJE DE PRUEBA", heading, intro, `Pedido #${id}`,
    `Cliente: ${order.customer_name}`, "", "Productos:", ...lines,
    `Despacho (${order.carrier ?? "Por definir"}): ${clp(order.shipping_clp)}`,
    `Total pagado: ${clp(order.total_clp)}`, "",
    "Esta es una simulación. No es una boleta ni factura tributaria."
  ].join("\n");

  const rows = items.map((i) => `
    <tr><td style="padding:12px 0;border-bottom:1px solid #E9DFD1;color:#49382E;">
      ${safe(i.product_name)} <span style="color:#92745F;">× ${safe(i.quantity)}</span>
    </td><td style="padding:12px 0;border-bottom:1px solid #E9DFD1;text-align:right;white-space:nowrap;color:#49382E;">
      ${safe(clp(i.line_total_clp))}
    </td></tr>`).join("");

  // HTML table e inline styles para compatibilidad con clientes de correo.
  // Todos los campos de la base de datos se escapan antes de insertarse.
  const html = `<!doctype html><html lang="es"><head><meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;background:#FAF8F5;font-family:Arial,Helvetica,sans-serif;color:#49382E;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAF8F5;padding:28px 12px;">
      <tr><td align="center"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"
        style="max-width:560px;background:white;border:1px solid #E9DFD1;">
        <tr><td style="background:#49382E;padding:27px;text-align:center;color:#FAF8F5;">
          <div style="font-family:Georgia,serif;font-size:32px;letter-spacing:5px;">MALFI</div>
          <div style="margin-top:8px;font-size:10px;letter-spacing:2px;">VELAS Y DECORACIÓN ARTESANAL</div>
        </td></tr>
        <tr><td style="padding:34px 30px;">
          <div style="color:#92745F;font-size:11px;letter-spacing:2px;">CONFIRMACIÓN DE PRUEBA</div>
          <h1 style="font-family:Georgia,serif;font-weight:normal;font-size:25px;line-height:1.3;margin:14px 0;">${safe(heading)}</h1>
          <p style="line-height:1.7;color:#67574D;margin:0 0 24px;">${safe(intro)}</p>
          <p style="font-size:14px;"><strong>Pedido #${safe(id)}</strong><br>Cliente: ${safe(order.customer_name)}</p>
          <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="font-size:14px;margin-top:20px;">${rows}
          <tr><td style="padding:17px 0;color:#92745F;">Despacho (${safe(order.carrier ?? "Por definir")})</td>
            <td style="text-align:right;color:#49382E;">${safe(clp(order.shipping_clp))}</td></tr>
          <tr><td style="border-top:2px solid #E9DFD1;padding-top:17px;"><strong>Total pagado</strong></td>
            <td style="border-top:2px solid #E9DFD1;padding-top:17px;text-align:right;"><strong>${safe(clp(order.total_clp))}</strong></td></tr></table>
        </td></tr>
        <tr><td style="background:#E9DFD1;padding:18px 28px;font-size:12px;line-height:1.6;color:#49382E;text-align:center;">
          Mensaje de prueba · No es una boleta ni factura tributaria.<br>
          <a href="https://www.instagram.com/malfi.candles/" style="color:#49382E;">Instagram MALFI</a>
        </td></tr>
      </table></td></tr>
    </table>
  </body></html>`;

  return { subject, text, html };
}
