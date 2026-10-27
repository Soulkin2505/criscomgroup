"use client"

// Footer global (port criscom-ecom-home): 4 columnas (marca / Comprar / Ayuda / Legales),
// redes y WhatsApp siempre config-driven (si el dato no llega, no se muestra). Sin emojis.
import Link from "next/link"
import { ChevronDown, Clock, Mail, MapPin } from "lucide-react"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import { waHref } from "@/components/home/homeShared"

// Iconos de redes en SVG inline (trazo 1.75, como la maqueta; lucide ya no trae marcas).
const SOCIAL_PATHS: Record<string, React.ReactNode> = {
  instagram: (
    <>
      <rect width="20" height="20" x="2" y="2" rx="5" ry="5" />
      <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z" />
      <path d="M17.5 6.5h.01" />
    </>
  ),
  facebook: <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z" />,
  tiktok: (
    <>
      <circle cx="8" cy="18" r="4" />
      <path d="M12 18V2l7 4" />
    </>
  ),
  youtube: (
    <>
      <path d="M2.5 17a24.12 24.12 0 0 1 0-10 2 2 0 0 1 1.4-1.4 49.56 49.56 0 0 1 16.2 0A2 2 0 0 1 21.5 7a24.12 24.12 0 0 1 0 10 2 2 0 0 1-1.4 1.4 49.55 49.55 0 0 1-16.2 0A2 2 0 0 1 2.5 17" />
      <path d="m10 15 5-3-5-3z" />
    </>
  ),
  whatsapp: <path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z" />,
}

export const SocialIcon = ({ name, className }: { name: keyof typeof SOCIAL_PATHS | string; className?: string }) => (
  <svg
    className={className}
    viewBox="0 0 24 24"
    aria-hidden="true"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.75"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    {SOCIAL_PATHS[name]}
  </svg>
)

const FOOTER_COLS: { title: string; links: [string, string][] }[] = [
  {
    title: "Comprar",
    links: [
      ["Catálogo", "/catalogo"],
      ["Ofertas", "/catalogo?ofertas=1"],
      ["Arma tu PC", "/armar-pc"],
      ["Importaciones", "/importaciones"],
    ],
  },
  {
    title: "Ayuda",
    links: [
      ["Servicio técnico", "/servicio-tecnico"],
      ["Mis solicitudes", "/seguimiento"],
      ["Blog", "/blog"],
    ],
  },
  {
    title: "Legales",
    links: [
      ["Términos y condiciones", "/terminos"],
      ["Política de privacidad", "/privacidad"],
      ["Cambios y devoluciones", "/cambios-devoluciones"],
      ["Libro de Reclamaciones", "/libro-reclamaciones"],
    ],
  },
]

const Footer = () => {
  const config = useConfigPublica()
  const year = new Date().getFullYear()
  const nombre = config?.nombre_comercial || "Criscom Group"
  const horario = config?.horario
  const waUrl = waHref(config?.whatsapp_number)
  const ruc = config?.ruc
  const correo = config?.correo

  const redes = (
    [
      ["instagram", config?.redes?.instagram_url, "Instagram"],
      ["facebook", config?.redes?.facebook_url, "Facebook"],
      ["tiktok", config?.redes?.tiktok_url, "TikTok"],
      ["youtube", config?.redes?.youtube_url, "YouTube"],
    ] as [string, string | undefined, string][]
  ).filter(([, url]) => Boolean(url))

  const brand = (
    <div className="ft-brand">
      <Link className="logo" href="/" aria-label="Criscom Group — inicio">
        <img className="logo-l" src="/logo.png" alt="" width="196" height="38" />
        <img className="logo-d" src="/logo-dark.png" alt="" width="196" height="38" />
      </Link>
      <p><b>{nombre}</b></p>
      {ruc && <p><span>RUC {ruc}</span></p>}
      {config?.direccion && (
        <p>
          <MapPin style={{ width: 16, height: 16 }} aria-hidden />
          <span>{config.direccion}</span>
        </p>
      )}
      {correo && (
        <p>
          <Mail style={{ width: 16, height: 16 }} aria-hidden />
          <a href={`mailto:${correo}`}>{correo}</a>
        </p>
      )}
      {horario?.inicio && horario?.fin && (
        <p>
          <Clock style={{ width: 16, height: 16 }} aria-hidden />
          <span className="num">Atención de {horario.inicio} a {horario.fin} h</span>
        </p>
      )}
    </div>
  )

  return (
    <footer className="pg-chrome ft">
      <div className="pg-wrap">
        <div className="ft-grid only-d">
          {brand}
          {FOOTER_COLS.map((col) => (
            <div key={col.title}>
              <h3>{col.title}</h3>
              <div className="ft-lk">
                {col.links.map(([label, href]) => (
                  <Link key={href} href={href}>{label}</Link>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="only-m" style={{ flexDirection: "column" }}>
          {brand}
          <div className="ft-acc" style={{ marginTop: 8 }}>
            {FOOTER_COLS.map((col, i) => (
              <details key={col.title} open={i === 0}>
                <summary>
                  {col.title}
                  <ChevronDown style={{ width: 16, height: 16 }} aria-hidden />
                </summary>
                <div className="ft-lk">
                  {col.links.map(([label, href]) => (
                    <Link key={href} href={href}>{label}</Link>
                  ))}
                </div>
              </details>
            ))}
          </div>
        </div>

        <div className="ft-bar">
          {redes.map(([key, url, label]) => (
            <a key={key} className="icon-btn" href={url} target="_blank" rel="noopener noreferrer" aria-label={label}>
              <SocialIcon name={key} className="pg-ic" />
            </a>
          ))}
          {waUrl && (
            <a className="btn btn-wa" href={waUrl} target="_blank" rel="noopener noreferrer" style={{ marginLeft: 8 }}>
              <SocialIcon name="whatsapp" className="pg-ic" />
              Escribir por WhatsApp
            </a>
          )}
          <span className="sp" />
          <span className="cp">© {year} {nombre}</span>
        </div>
      </div>
    </footer>
  )
}

export default Footer
