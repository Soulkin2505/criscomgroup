import { API_URL } from "../../../config/api"

/** Utilidades puras de Empresa y horario (sin React): formato es-PE, RUC modulo 11 y horario. */

export const SEP = " · "
export const DASH = "—"
export const ARROW = "→"

export const pl = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`

/** Digito verificador de un RUC (pesos 5,4,3,2,7,6,5,4,3,2; 10 -> 0, 11 -> 1). */
export function rucDv(ruc: string): number {
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2]
  let s = 0
  for (let i = 0; i < 10; i++) s += w[i] * Number(ruc[i])
  const d = 11 - (s % 11)
  return d === 10 ? 0 : d === 11 ? 1 : d
}

export type RucCheck = "vacio" | "formato" | "ok" | "dv"
/** Estado del RUC: formato (11 digitos, 10 o 20) y digito verificador. */
export function rucCheck(ruc: string): RucCheck {
  if (!ruc) return "vacio"
  if (!/^(10|20)\d{9}$/.test(ruc)) return "formato"
  return rucDv(ruc) === Number(ruc[10]) ? "ok" : "dv"
}

export const isHHmm = (t: string) => /^([01]\d|2[0-3]):[0-5]\d$/.test(t)
export const toMin = (t: string) => {
  const [h, m] = t.split(":").map(Number)
  return h * 60 + m
}

/** 20:31 -> 8:31 p. m. */
export function h12(t: string): string {
  const [h0, m] = t.split(":").map(Number)
  const ap = h0 < 12 ? "a. m." : "p. m."
  return `${h0 % 12 || 12}:${String(m).padStart(2, "0")} ${ap}`
}

/** Duracion de la jornada (soporta turno nocturno). */
export function durLabel(a: string, b: string): string {
  const x = toMin(a)
  const y = toMin(b)
  const m = x < y ? y - x : 1440 - x + y
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")} min`
}

/** "2026-10-09 15:12:00" (hora de Lima) o ISO con zona -> "09/10/2026 · 3:12 p. m." */
export function fmtStamp(s?: string | null): string {
  if (!s) return ""
  if (/T.*(Z|[+-]\d{2}:?\d{2})$/.test(s)) {
    const d = new Date(s)
    if (Number.isNaN(d.getTime())) return s
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Lima", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d).map(x => [x.type, x.value]))
    return `${p.day}/${p.month}/${p.year}${SEP}${h12(`${p.hour === "24" ? "00" : p.hour}:${p.minute}`)}`
  }
  const [d, t] = s.replace("T", " ").split(" ")
  const [y, mo, da] = d.split("-")
  return t ? `${da}/${mo}/${y}${SEP}${h12(t.slice(0, 5))}` : `${da}/${mo}/${y}`
}

/** "2027-03-14" (o ISO) -> "14/03/2027" */
export function fmtDate(s?: string | null): string {
  if (!s) return ""
  const [y, mo, da] = s.slice(0, 10).split("-")
  return `${da}/${mo}/${y}`
}

export const fmtKb = (bytes?: number | null): string => {
  if (bytes == null) return ""
  return bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(bytes / 1024))} KB`
}

/** Hora actual de Lima como "h:mm a. m." para el sello de guardado. */
export function nowLimaStamp(): string {
  const f = new Intl.DateTimeFormat("es-PE", { timeZone: "America/Lima", day: "2-digit", month: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true })
  return f.format(new Date()).replace(",", SEP.trimEnd()).replace(/a\.\s?m\./i, "a. m.").replace(/p\.\s?m\./i, "p. m.")
}

export const LIM_LOGO = "JPG, PNG o WebP · máx. 2 MB · no se admite SVG"
export const LIM_FICHA = "PDF, JPG o PNG · máx. 5 MB"
export const LIM_CERT = ".p12 / .pfx de SUNAT con su contraseña, o PEM con certificado y clave privada · máx. 256 KB"
export const MAX_LOGO = 2 * 1048576
export const MAX_FICHA = 5 * 1048576
export const MAX_CERT = 256 * 1024

/** URL absoluta del logo guardado (ruta relativa /uploads/logos/<archivo> o URL completa). */
export function logoSrc(raw?: string | null): string | null {
  if (!raw) return null
  if (raw.startsWith("http")) return raw
  const base = API_URL.replace("/api", "")
  if (raw.includes("/uploads/")) return `${base}${raw.replace(/\\/g, "/")}`
  return `${base}/uploads/logos/${raw.split("\\").pop()?.split("/").pop() ?? raw}`
}

