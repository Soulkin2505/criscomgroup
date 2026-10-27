// Config pública de empresa (GET /api/ecommerce/config-publica), con caché de módulo.
// ecom-logica T1: el front NUNCA hardcodea teléfono/correo; si un dato no llega, se oculta.
import { ECOMMERCE_API_URL } from "@/config/constants"

export interface ConfigPublica {
  nombre_comercial: string | null
  razon_social: string | null
  ruc: string | null
  direccion: string | null
  correo: string | null
  horario: { inicio: string | null; fin: string | null }
  telefono: string | null
  whatsapp_number: string | null
  redes: {
    instagram_url: string
    facebook_url: string
    tiktok_url: string
    youtube_url: string
  }
}

let cache: Promise<ConfigPublica | null> | null = null

export const getConfigPublica = (): Promise<ConfigPublica | null> => {
  if (!cache) {
    cache = fetch(`${ECOMMERCE_API_URL}/config-publica`)
      .then((res) => (res.ok ? (res.json() as Promise<ConfigPublica>) : null))
      .catch(() => null)
  }
  return cache
}

// Solo para pruebas/hot-reload: invalida la caché del módulo.
export const resetConfigPublicaCache = () => { cache = null }

// Variante server-side (RSC): pega directo al backend (el browser usa el
// rewrites same-origin). La cachea Next con revalidate, sin forzar render dinámico.
export const getConfigPublicaServer = async (): Promise<ConfigPublica | null> => {
  try {
    const base = (process.env.BACKEND_INTERNAL_URL || "http://127.0.0.1:3100").replace(/\/$/, "")
    const res = await fetch(`${base}/api/ecommerce/config-publica`, { next: { revalidate: 300 } })
    return res.ok ? ((await res.json()) as ConfigPublica) : null
  } catch {
    return null
  }
}

// URL wa.me con mensaje; null si no hay número configurado (fallback = no mostrar).
export const buildWhatsAppUrl = (config: ConfigPublica | null, message: string): string | null => {
  const numero = config?.whatsapp_number?.replace(/\D/g, "")
  if (!numero) return null
  return `https://wa.me/${numero}?text=${encodeURIComponent(message)}`
}

// "51XXXXXXXXX" -> "+51 XXX XXX XXX" (solo formato; nunca inventa el dato).
export const formatTelefono = (numero: string | null | undefined): string | null => {
  const digitos = (numero || "").replace(/\D/g, "")
  if (!digitos) return null
  const local = digitos.startsWith("51") && digitos.length === 11 ? digitos.slice(2) : digitos
  if (local.length !== 9) return `+${digitos}`
  return `+51 ${local.slice(0, 3)} ${local.slice(3, 6)} ${local.slice(6)}`
}
