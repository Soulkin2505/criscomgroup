import type {
  WorkOrder,
  WorkOrderPart,
  WorkOrderPayment,
  WorkOrderQuote,
} from "../services/workOrderService";

export type WorkOrderDocumentKind =
  "orden" | "cotizacion" | "ticket" | "etiqueta" | "entrega" | "garantia";

type DocumentData = {
  order: WorkOrder;
  parts?: WorkOrderPart[];
  payments?: WorkOrderPayment[];
  quotes?: WorkOrderQuote[];
};

const escapeHtml = (value?: string | number) =>
  String(value ?? "").replace(
    /[&<>'"]/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[
        char
      ] || char,
  );
const money = (value: number, currency: string) =>
  new Intl.NumberFormat("es-PE", { style: "currency", currency }).format(value);
const totalFor = (order: WorkOrder) =>
  Math.max(
    0,
    Number(order.costo_repuestos) +
      Number(order.costo_mano_obra) +
      Number(order.recargo || 0) -
      Number(order.descuento || 0),
  );

const commonDetails = (order: WorkOrder) => `
  <div class="grid">
    <div class="box"><small>CLIENTE</small><b>${escapeHtml(order.cliente)}</b></div>
    <div class="box"><small>TELÉFONO / DOCUMENTO</small><b>${escapeHtml(order.telefono)} · ${escapeHtml(order.documento)}</b></div>
    <div class="box"><small>EQUIPO</small><b>${escapeHtml(order.equipo)}</b></div>
    <div class="box"><small>SERIE / IMEI</small><b>${escapeHtml(order.numero_serie)}</b></div>
    <div class="box full"><small>FALLA O REQUERIMIENTO</small><p>${escapeHtml(order.detalle)}</p></div>
    <div class="box full"><small>ESTADO FÍSICO Y ACCESORIOS</small><p>${escapeHtml(order.accesorios)}</p></div>
  </div>`;

const totals = (order: WorkOrder) => {
  const total = totalFor(order);
  const paid = Number(order.adelanto || 0);
  return `<div class="totals">
    <div><span>Repuestos</span><b>${money(Number(order.costo_repuestos), order.moneda)}</b></div>
    <div><span>Mano de obra</span><b>${money(Number(order.costo_mano_obra), order.moneda)}</b></div>
    <div><span>Recargo</span><b>${money(Number(order.recargo || 0), order.moneda)}</b></div>
    <div><span>Descuento</span><b>-${money(Number(order.descuento || 0), order.moneda)}</b></div>
    <div class="strong"><span>Total</span><b>${money(total, order.moneda)}</b></div>
    <div><span>Pagado</span><b>${money(paid, order.moneda)}</b></div>
    <div class="strong"><span>Saldo</span><b>${money(Math.max(0, total - paid), order.moneda)}</b></div>
  </div>`;
};

const rowsForParts = (parts: WorkOrderPart[], currency: string) =>
  parts
    .filter((part) => part.estado_stock !== "devuelto")
    .map(
      (part) =>
        `<tr><td>${part.cantidad}</td><td>${escapeHtml(part.descripcion)}</td><td>${escapeHtml(part.sku)}</td><td>${money(Number(part.precio_unitario), currency)}</td><td>${money(Number(part.precio_unitario) * part.cantidad, currency)}</td></tr>`,
    )
    .join("");

const fullDocument = (kind: WorkOrderDocumentKind, data: DocumentData) => {
  const { order } = data;
  const activeQuote =
    data.quotes?.find((quote) => quote.estado === "aprobada") ||
    data.quotes?.[0];
  const titles: Record<WorkOrderDocumentKind, string> = {
    orden: "ORDEN DE SERVICIO",
    cotizacion: "COTIZACIÓN",
    ticket: "COMPROBANTE INTERNO",
    etiqueta: "ETIQUETA",
    entrega: "CONSTANCIA DE ENTREGA",
    garantia: "CERTIFICADO DE GARANTÍA",
  };
  if (kind === "etiqueta")
    return `<main class="label"><b>CRISCOM · ${escapeHtml(order.codigo)}</b><strong>${escapeHtml(order.cliente)}</strong><span>${escapeHtml(order.equipo)}</span><span>Serie: ${escapeHtml(order.numero_serie)}</span><span>Tel: ${escapeHtml(order.telefono)}</span></main>`;
  if (kind === "ticket")
    return `<main class="ticket"><h2>CRISCOM</h2><p>${titles[kind]}</p><b>${escapeHtml(order.codigo)}</b><hr><p>${escapeHtml(order.cliente)}</p><p>${escapeHtml(order.equipo)}</p><p>${escapeHtml(order.detalle)}</p><hr>${(data.parts || []).filter(p => p.estado_stock !== "devuelto").map(p => `<p>${escapeHtml(p.cantidad)} × ${escapeHtml(p.descripcion)}: ${money(Number(p.cantidad) * Number(p.precio_unitario), order.moneda)}</p>`).join("")}${totals(order)}${order.referencia_comprobante ? `<p>Referencia RHE: ${escapeHtml(order.referencia_comprobante)}</p>` : ""}<p class="center">Documento interno no fiscal</p></main>`;
  return `<main><header><div><h1>CRISCOM</h1><p>Servicio técnico y soluciones informáticas</p></div><div><h2>${titles[kind]}</h2><b>${escapeHtml(order.codigo)}</b></div></header>
    ${commonDetails(order)}
    ${kind === "cotizacion" ? `<section><h3>Diagnóstico</h3><p>${escapeHtml(activeQuote?.diagnostico || order.diagnostico_configuracion)}</p><h3>Trabajo propuesto</h3><p>${escapeHtml(activeQuote?.trabajo_propuesto || order.trabajo_realizado)}</p></section>` : ""}
    ${kind === "orden" ? `<section><h3>Diagnóstico</h3><p>${escapeHtml(order.diagnostico_configuracion)}</p><h3>Trabajo y pruebas</h3><p>${escapeHtml(order.trabajo_realizado)}</p></section>` : ""}
    ${data.parts?.length ? `<table><thead><tr><th>Cant.</th><th>Repuesto</th><th>SKU</th><th>Unitario</th><th>Total</th></tr></thead><tbody>${rowsForParts(data.parts, order.moneda)}</tbody></table>` : ""}
    ${kind !== "garantia" ? totals(order) : ""}
    ${kind === "garantia" ? `<section><h3>Vigencia</h3><p>${escapeHtml(order.garantia_inicio)} al ${escapeHtml(order.garantia_fin)} (${escapeHtml(order.garantia_dias)} días)</p><h3>Cobertura</h3><p>${escapeHtml(order.garantia_cobertura)}</p><h3>Exclusiones</h3><p>${escapeHtml(order.garantia_exclusiones)}</p></section>` : ""}
    ${kind === "entrega" ? `<section><h3>Conformidad</h3><p>El cliente declara recibir el equipo y accesorios descritos, con explicación del trabajo y pruebas realizadas.</p></section>` : ""}
    ${activeQuote?.condiciones && kind === "cotizacion" ? `<section><h3>Condiciones</h3><p>${escapeHtml(activeQuote.condiciones)}</p></section>` : ""}
    <div class="signatures"><div>Firma del cliente</div><div>Responsable CRISCOM</div></div>
  </main>`;
};

export const openWorkOrderDocument = (
  kind: WorkOrderDocumentKind,
  data: DocumentData,
) => {
  const compact = kind === "ticket" || kind === "etiqueta";
  const popup = window.open(
    "",
    "_blank",
    compact ? "width=480,height=700" : "width=1000,height=800",
  );
  if (!popup)
    throw new Error("Permite ventanas emergentes para generar el documento");
  popup.document
    .write(`<!doctype html><html><head><meta charset="utf-8"><title>${kind}-${escapeHtml(data.order.codigo)}</title><style>
    @page{size:${kind === "ticket" ? "80mm auto" : kind === "etiqueta" ? "40mm 30mm" : "A4"};margin:${compact ? "3mm" : "14mm"}}
    *{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#111;margin:0}main{max-width:190mm;margin:auto}header{display:flex;justify-content:space-between;gap:20px;border-bottom:3px solid #111;padding-bottom:14px}h1,h2,p{margin:0 0 8px}.grid{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:18px 0}.box{border:1px solid #bbb;border-radius:7px;padding:10px}.box b,.box p{display:block;margin-top:5px}.full{grid-column:1/-1}small{color:#555}.totals{width:320px;margin:18px 0 18px auto}.totals div{display:flex;justify-content:space-between;padding:5px}.strong{font-size:17px;border-top:2px solid #111}table{width:100%;border-collapse:collapse;margin:18px 0}th,td{border:1px solid #bbb;padding:7px;text-align:left}section{margin:18px 0}.signatures{display:grid;grid-template-columns:1fr 1fr;gap:70px;margin-top:65px}.signatures div{border-top:1px solid;text-align:center;padding-top:7px}.ticket{width:72mm;font-size:12px}.ticket .totals{width:100%}.center{text-align:center}.label{width:34mm;height:24mm;display:flex;flex-direction:column;justify-content:center;gap:2px;font-size:8px;overflow:hidden}.label b{font-size:9px}.label strong{font-size:11px}@media print{body{print-color-adjust:exact}}
  </style></head><body>${fullDocument(kind, data)}<script>window.onload=()=>window.print()</script></body></html>`);
  popup.document.close();
};
