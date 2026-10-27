// Utilidades compartidas del checkout y confirmaciones (port criscom-ecom-checkout).
import type { LucideIcon } from "lucide-react"
import {
  Check, CheckCircle2, Clock, Package, Truck, Undo2, XCircle,
} from "lucide-react"

// Moneda peruana con separador de miles: S/ 1,234.56 (tabular-nums via CSS .tn).
export const money = (v: number | string): string =>
  "S/ " + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })

// Fecha larga es-PE ("2 de octubre de 2026"). El backend ya manda hora de Lima.
export const fechaLarga = (iso: string): string => {
  const d = new Date(String(iso).replace(" ", "T"))
  if (Number.isNaN(d.getTime())) return String(iso)
  return new Intl.DateTimeFormat("es-PE", { day: "numeric", month: "long", year: "numeric" }).format(d)
}

export const r2 = (n: number): number => Math.round(n * 100) / 100

export interface Quote { amount: number; zone: string; distance_km: number | null }

export type MetodoPago = "yape" | "billetera_digital" | "pago_efectivo" | "cuotealo" | "transferencia" | "tarjeta" | "contraentrega"

// Chips de estado: icono + palabra (contrato: estados_pedido de checkout-data.json).
export interface ChipDef { label: string; kind: "ok" | "warn" | "err" | "neu"; icon: LucideIcon }

export const ESTADO_PEDIDO: Record<string, ChipDef> = {
  pendiente_pago: { label: "Pendiente de pago", kind: "warn", icon: Clock },
  confirmado: { label: "Confirmado", kind: "neu", icon: CheckCircle2 },
  preparando: { label: "Preparando", kind: "neu", icon: Package },
  enviado: { label: "Enviado", kind: "neu", icon: Truck },
  entregado: { label: "Entregado", kind: "ok", icon: Package },
  cancelado: { label: "Cancelado", kind: "err", icon: XCircle },
}

export const ESTADO_PAGO: Record<string, ChipDef> = {
  pendiente: { label: "Pago pendiente", kind: "warn", icon: Clock },
  pagado: { label: "Pagado", kind: "ok", icon: Check },
  fallido: { label: "Pago fallido", kind: "err", icon: XCircle },
  devuelto: { label: "Pago devuelto", kind: "neu", icon: Undo2 },
}

export const chipOf = (map: Record<string, ChipDef>, key: string): ChipDef =>
  map[key] || { label: key, kind: "neu", icon: Clock }

// URL wa.me de ayuda con el numero de pedido; null si no hay numero configurado.
export const waAyuda = (numero: string | null | undefined, pedido: string): string | null => {
  const digitos = String(numero || "").replace(/\D/g, "")
  if (!digitos) return null
  const msg = pedido
    ? "Hola, necesito ayuda con mi pedido " + pedido
    : "Hola, tengo una duda sobre mi compra en Criscom Group"
  return `https://wa.me/${digitos}?text=${encodeURIComponent(msg)}`
}
