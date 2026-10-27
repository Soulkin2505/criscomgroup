// Compartido de cuenta/seguimiento: etiquetas del backend, iconos, formatos.
import {
  Inbox, Search, FileText, CircleCheck, CircleX, Clock, Truck, Wrench,
  Package, PackageCheck, Phone, Undo2, CircleHelp, ShoppingBag, Globe, Cpu,
  type LucideIcon,
} from "lucide-react"

export type Tono = "n" | "a" | "g" | "r" | "l"

// Estados del backend: etiqueta + [icono, tono]. Desconocido = neutro.
export const ESTADO_LABEL: Record<string, string> = {
  recibida: "Recibida", en_revision: "En revisión", cotizada: "Cotizada",
  aprobada: "Aprobada", en_transito: "En tránsito", en_ensamble: "En ensamble",
  entregada: "Entregada", rechazada: "Rechazada", pendiente: "Pendiente",
  contactado: "Contactado", recibido: "Recibido", descartado: "Descartado",
  pendiente_pago: "Pendiente de pago", confirmado: "Confirmado",
  preparando: "Preparando", enviado: "Enviado", entregado: "Entregado",
  cancelado: "Cancelado", pagado: "Pagado", fallido: "Pago fallido",
  devuelto: "Pago devuelto",
}

export const ESTADO_ICONO: Record<string, [LucideIcon, Tono]> = {
  recibida: [Inbox, "n"], en_revision: [Search, "a"], cotizada: [FileText, "l"],
  aprobada: [CircleCheck, "g"], en_transito: [Truck, "a"], en_ensamble: [Wrench, "a"],
  entregada: [PackageCheck, "g"], rechazada: [CircleX, "r"], pendiente: [Clock, "a"],
  contactado: [Phone, "l"], recibido: [Inbox, "n"], descartado: [CircleX, "r"],
  pendiente_pago: [Clock, "a"], confirmado: [CircleCheck, "l"], preparando: [Package, "a"],
  enviado: [Truck, "a"], entregado: [PackageCheck, "g"], cancelado: [CircleX, "r"],
  pagado: [CircleCheck, "g"], fallido: [CircleX, "r"], devuelto: [Undo2, "n"],
}

export const estadoVisual = (estado: string): [LucideIcon, Tono] =>
  ESTADO_ICONO[estado] ?? [CircleHelp, "n"]

export const estadoLabel = (estado: string) => ESTADO_LABEL[estado] ?? estado

export const TIPO_SOLICITUD: Record<string, [LucideIcon, string]> = {
  importacion: [Globe, "Importación"],
  ensamble: [Cpu, "Ensamble"],
  servicio: [Wrench, "Servicio"],
  pedido: [ShoppingBag, "Pedido"],
}

export type TipoCodigo = "importacion" | "ensamble" | "servicio" | "pedido"

// El front elige el endpoint por el prefijo del código; lo demás es pedido.
export const detectarTipo = (codigo: string): TipoCodigo => {
  const c = codigo.trim().toUpperCase()
  if (c.startsWith("SOL-")) return "importacion"
  if (c.startsWith("ARM-")) return "ensamble"
  if (c.startsWith("WEB-")) return "servicio"
  return "pedido"
}

// Moneda: S/ 1,234.56 (USD US$ 4,350.00), miles con coma, tabular-nums en CSS.
export const fmtMoney = (n: number | string, moneda: "PEN" | "USD" = "PEN") =>
  (moneda === "USD" ? "US$ " : "S/ ") +
  Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Fechas: el backend ya las manda en hora de Lima; se leen crudas (sin correr zona).
// Las civiles (AAAA-MM-DD) se leen como fecha local para no correrlas un día.
const pad = (n: number) => String(n).padStart(2, "0")

export const fmtFecha = (iso?: string | null) => {
  if (!iso) return "—"
  const [y, m, d] = iso.slice(0, 10).split("-")
  return `${d}/${m}/${y}`
}

export const fmtHora = (iso?: string | null) => {
  if (!iso || iso.length < 16) return ""
  const [h, m] = iso.slice(11, 16).split(":").map(Number)
  return `${h % 12 || 12}:${pad(m)} ${h < 12 ? "a. m." : "p. m."}`
}

export const fmtFechaHora = (iso?: string | null) => {
  if (!iso) return "—"
  const h = fmtHora(iso)
  return h ? `${fmtFecha(iso)} · ${h}` : fmtFecha(iso)
}

// Días entre hoy y una fecha civil (para "válida hasta" / "vencida").
export const diasHasta = (fechaCivil: string) => {
  const [y, m, d] = fechaCivil.slice(0, 10).split("-").map(Number)
  const hoy = new Date()
  const a = new Date(y, m - 1, d).getTime()
  const b = new Date(hoy.getFullYear(), hoy.getMonth(), hoy.getDate()).getTime()
  return Math.round((a - b) / 86400000)
}

// Segundo factor del seguimiento: correo o últimos 4 dígitos del teléfono.
export type FactorSeg = { email?: string; telefono4?: string }
export const leerFactor = (texto: string): FactorSeg | null => {
  const t = texto.trim()
  if (t.includes("@")) return { email: t }
  if (/^\d{4}$/.test(t)) return { telefono4: t }
  return null
}

export const METODO_PAGO_LABEL: Record<string, string> = {
  contraentrega: "Contraentrega", tarjeta: "Tarjeta", yape: "Yape", plin: "Plin",
  billetera_digital: "Billetera digital", pago_efectivo: "PagoEfectivo", cuotealo: "Cuotéalo",
  transferencia: "Transferencia", mercadopago: "Mercado Pago", niubiz: "Niubiz",
}
export const TIPO_ENTREGA_LABEL: Record<string, string> = {
  domicilio: "A domicilio", recojo_tienda: "Recojo en tienda",
}
export const COMPROBANTE_LABEL: Record<string, string> = {
  boleta: "Boleta", factura: "Factura",
}
