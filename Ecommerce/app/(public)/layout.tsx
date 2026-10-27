"use client"

// Layout publico: navbar + footer (chrome global port criscom-ecom-home).
// La barra de accesos secundaria murio: sus accesos viven en el navbar y el home.
import Header from "@/components/layout/Header"
import Footer from "@/components/layout/Footer"
import styled from "styled-components"
import ThemeToggle from "@/components/ThemeToggle"
import { FaWhatsapp } from "react-icons/fa"
import { PageTransition } from "@/components/layout/PageTransition"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import { waHref } from "@/components/home/homeShared"

const PublicThemeVars = styled.div`
  /* Mapear variables usadas en el sitio público a las variables globales */
  --bg-card: var(--card);
  --bg-secondary: var(--muted);
  --text-primary: var(--foreground);
  --text-secondary: var(--muted-foreground);
  --border-color: var(--border);
  --accent-primary: var(--primary);
  --accent-secondary: var(--secondary);
  --accent-glow: var(--primary);
  /* Sombra coherente para modo claro/oscuro */
  --shadow-sm: 0 1px 3px rgba(0,0,0,0.08);
  --shadow-md: 0 4px 12px rgba(0,0,0,0.08);
  --shadow-lg: 0 10px 25px rgba(0,0,0,0.12);
`

export default function PublicLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const configPublica = useConfigPublica()
  const whatsappUrl = waHref(configPublica?.whatsapp_number)

  return (
    <PublicThemeVars>
      <div className="flex flex-col min-h-screen bg-background text-foreground">
        <Header />
        <main className="flex-grow w-full">
          <PageTransition>
            {children}
          </PageTransition>
        </main>
        <Footer />

        {/* Boton fijo de cambio de tema visible en todas las paginas publicas */}
        <div className="fixed bottom-4 left-4 z-[1100]">
          <ThemeToggle />
        </div>

        {/* Boton flotante de WhatsApp: config-driven, oculto si no hay numero */}
        {whatsappUrl && (
          <div className="pg-chrome">
            <a
              className="wa-float"
              href={whatsappUrl}
              target="_blank"
              rel="noopener noreferrer"
              aria-label="Contactar por WhatsApp"
            >
              <FaWhatsapp aria-hidden />
            </a>
          </div>
        )}
      </div>
    </PublicThemeVars>
  )
}
