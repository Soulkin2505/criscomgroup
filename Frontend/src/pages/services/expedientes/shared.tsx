import { Activity, CircleCheck, CircleX, FileText, Inbox, Package, Search, Truck, Wrench, type LucideIcon } from "lucide-react"
import type { WorkOrder } from "../../../services/workOrderService"
import { dateTimeLima, longDate } from "../../../components/erp/format"

export const I = (Icon: LucideIcon, size = 16, cls = "") => <Icon className={`ic${cls ? ` ${cls}` : ""}`} size={size} strokeWidth={1.75} aria-hidden="true" />

export type Tone = "neu" | "warn" | "ok" | "bad"
export const ST: Record<string, [string, LucideIcon, Tone]> = {
  recibido: ["Recibido", Inbox, "neu"],
  diagnostico: ["En diagnóstico", Search, "neu"],
  cotizado: ["Cotizado", FileText, "neu"],
  aprobado: ["Aprobado", CircleCheck, "neu"],
  en_proceso: ["En reparación", Wrench, "warn"],
  pruebas: ["En pruebas", Activity, "warn"],
  listo: ["Listo para entregar", Package, "ok"],
  entregado: ["Entregado", Truck, "ok"],
  cancelado: ["Cancelado", CircleX, "bad"],
}
export const FLOW = ["recibido", "diagnostico", "cotizado", "aprobado", "en_proceso", "pruebas", "listo", "entregado"]
export const NEXT: Record<string, string[]> = {
  recibido: ["diagnostico", "cancelado"], diagnostico: ["cotizado", "en_proceso", "cancelado"], cotizado: ["diagnostico", "aprobado", "cancelado"],
  aprobado: ["en_proceso", "cancelado"], en_proceso: ["pruebas", "cancelado"], pruebas: ["en_proceso", "listo", "cancelado"],
  listo: ["pruebas", "entregado", "cancelado"], entregado: [], cancelado: [],
}
export const PRIM: Record<string, [string, string]> = {
  recibido: ["Iniciar diagnóstico", "diagnostico"], diagnostico: ["Pasar a Cotizado", "cotizado"], cotizado: ["Marcar Aprobado", "aprobado"],
  aprobado: ["Iniciar reparación", "en_proceso"], en_proceso: ["Pasar a En pruebas", "pruebas"], pruebas: ["Marcar Listo para entregar", "listo"], listo: ["Entregar", "entregado"],
}
export const METODO: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", yape: "Yape", plin: "Plin", pago_link: "Enlace de pago", qr: "QR sin especificar", transferencia: "Transferencia", otro: "Otro" }
export const FISCAL: Record<string, string> = { mixta: "Productos: boleta/factura · Servicio: RHE", recibo_honorarios: "Recibo por honorarios (RHE)", boleta_factura: "Boleta / factura" }
export const FACT: Record<string, string> = { sin_facturar: "Sin facturar", pendiente_emision: "Pendiente de emisión", emitido: "Emitido", error: "Error" }
export const ETAPA: Record<string, string> = {
  recepcion: "Recepción", diagnostico: "Diagnóstico", reparacion: "Reparación", pruebas: "Pruebas", entrega: "Entrega", otro: "Otro",
  firma_recepcion: "Firma de recepción", firma_garantia: "Firma de garantía",
}
export const TIPO_LABEL: Record<string, string> = { servicio_tecnico: "Servicio técnico", mantenimiento: "Mantenimiento", armado_pc: "Armado de PC" }

const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
export const f2 = (n: number | string) => nf.format(Number(n))
export const money = (n: number | string) => `S/ ${f2(n)}`
export const sgn = (n: number) => `${n < 0 ? "−" : ""}S/ ${f2(Math.abs(n))}`
export const fd = (iso?: string | null) => (iso ? longDate(String(iso).slice(0, 10)) : "—")
export const ft = (iso?: string | null) => (iso ? dateTimeLima(iso) : "—")
export const monto = (o: WorkOrder) => Number(o.costo_repuestos) + Number(o.costo_mano_obra) + Number(o.recargo || 0) - Number(o.descuento || 0)
export const saldo = (o: WorkOrder) => Math.max(0, monto(o) - Number(o.adelanto || 0))
export const fin = (o: WorkOrder) => o.estado === "entregado" || o.estado === "cancelado"
export const dayNum = (s: string) => Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 864e5
export const tel = (t?: string) => (t && t.length >= 11 ? `+${t.slice(0, 2)} ${t.slice(2, 5)} ${t.slice(5, 8)} ${t.slice(8)}` : t || "Sin teléfono")
export const errMsg = (e: unknown, fallback: string) => (e as { response?: { data?: { message?: string } } })?.response?.data?.message || fallback

export function StateChip({ estado, size = 16 }: { estado: string; size?: number }) {
  const x = ST[estado] || [estado, Inbox, "neu" as Tone]
  return <span className={`st ${x[2]}`}>{I(x[1], size)}{x[0]}</span>
}

/** Requisitos reales del backend: solo el pago completo y un importe > 0 bloquean la entrega.
 *  La venta contable, la clasificación fiscal y el consumo de repuestos los hace el propio backend al entregar. */
export function checklist(o: WorkOrder, reservedParts: number) {
  const s = saldo(o)
  const total = monto(o)
  return [
    { k: "Pago completo", ok: s <= 0.001, blocks: true, d: s <= 0.001 ? `Pagado ${money(o.adelanto)} de ${money(total)}` : `Falta cobrar ${money(s)} de ${money(total)}`, m: `falta cobrar ${money(s)}` },
    { k: "Importe facturable", ok: total > 0, blocks: true, d: total > 0 ? `Total ${money(total)}` : "El total de la orden debe ser mayor que S/ 0.00", m: "el total debe ser mayor que S/ 0.00" },
    { k: "Venta contable", ok: !!o.venta_id, blocks: false, d: o.venta_id ? "Venta creada" : "Se crea sola al entregar", m: "" },
    { k: "Clasificación fiscal", ok: !!o.clasificacion_fiscal, blocks: false, d: o.clasificacion_fiscal ? FISCAL[o.clasificacion_fiscal] : "Se asigna sola al entregar (según DNI / RUC del cliente)", m: "" },
    { k: "Repuestos reservados", ok: reservedParts === 0, blocks: false, d: reservedParts === 0 ? "Ninguno reservado" : `${reservedParts} reservado(s): pasan a consumidos al entregar`, m: "" },
  ]
}
export const blockReason = (o: WorkOrder) => checklist(o, 0).filter(x => x.blocks && !x.ok).map(x => x.m).join(" y ")
