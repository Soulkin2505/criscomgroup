"use client"

// Cabecera con búsqueda GET al catálogo, navegación y acciones existentes.
import { useCallback, useEffect, useRef, useState } from "react"
import Link from "next/link"
import { usePathname, useRouter } from "next/navigation"
import {
  ChevronDown, ClipboardList, LayoutDashboard, LogIn, LogOut,
  Menu, Package2, Search, User, X,
} from "lucide-react"
import { FaWhatsapp } from "react-icons/fa"
import { ecommerceAuthService, type User as EcomUser } from "@/services/ecommerceApi"
import { homeService, type HomeCategoria } from "@/services/homeService"
import { catIcon, waHref } from "@/components/home/homeShared"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import { formatTelefono } from "@/services/configPublicaService"
import CartDropdown from "@/components/layout/CartDropdown"
import "@/styles/chrome.css"

const NAV_LINKS = [
  { name: "Arma tu PC", to: "/armar-pc" },
  { name: "Importaciones", to: "/importaciones" },
  { name: "Servicio técnico", to: "/servicio-tecnico" },
]

const Header = () => {
  const [categories, setCategories] = useState<HomeCategoria[]>([])
  const [openMenu, setOpenMenu] = useState<"mega" | "acct" | "mobile" | null>(null)
  const [mobileCatsOpen, setMobileCatsOpen] = useState(false)
  const [cartCount, setCartCount] = useState(0)
  const [currentUser, setCurrentUser] = useState<EcomUser | null>(null)
  const headerRef = useRef<HTMLElement>(null)
  const pathname = usePathname()
  const router = useRouter()
  const configPublica = useConfigPublica()

  const waNumber = configPublica?.whatsapp_number || ""
  const waUrl = waHref(waNumber)
  const waLabel = formatTelefono(waNumber)
  // Logica de privilegio existente (rol 3 o cuenta maestra): enlace al ERP.
  const hasErpAccess =
    currentUser?.id_role === 3 ||
    currentUser?.email.trim().toLowerCase() === "cristophercalioro@gmail.com"

  useEffect(() => {
    let active = true
    homeService.categorias()
      .then((cats) => { if (active) setCategories(Array.isArray(cats) ? cats : []) })
      .catch(() => { if (active) setCategories([]) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    setCurrentUser(ecommerceAuthService.getCurrentUser())
  }, [pathname])

  // Cerrar menus al navegar
  useEffect(() => {
    setOpenMenu(null)
    setMobileCatsOpen(false)
  }, [pathname])

  // Cerrar con Escape y con clic fuera del header
  useEffect(() => {
    if (!openMenu) return
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpenMenu(null) }
    const onDown = (e: MouseEvent) => {
      if (headerRef.current && !headerRef.current.contains(e.target as Node)) setOpenMenu(null)
    }
    document.addEventListener("keydown", onKey)
    document.addEventListener("mousedown", onDown)
    return () => {
      document.removeEventListener("keydown", onKey)
      document.removeEventListener("mousedown", onDown)
    }
  }, [openMenu])

  const computeCartCount = useCallback(() => {
    try {
      const saved = localStorage.getItem("catalogo_cart_items")
      const arr = saved ? (JSON.parse(saved) as Array<{ quantity: number }>) : []
      setCartCount(arr.reduce((sum, it) => sum + (Number(it.quantity) || 0), 0))
    } catch {
      setCartCount(0)
    }
  }, [])

  useEffect(() => {
    computeCartCount()
    const onStorage = (e: StorageEvent) => {
      if (e.key === null || e.key === "catalogo_cart_items") computeCartCount()
    }
    window.addEventListener("storage", onStorage)
    window.addEventListener("focus", computeCartCount)
    window.addEventListener("catalogo_cart_items_updated", computeCartCount as EventListener)
    return () => {
      window.removeEventListener("storage", onStorage)
      window.removeEventListener("focus", computeCartCount)
      window.removeEventListener("catalogo_cart_items_updated", computeCartCount as EventListener)
    }
  }, [computeCartCount])

  const handleLogout = () => {
    ecommerceAuthService.logout()
    setCurrentUser(null)
    setOpenMenu(null)
    router.push("/")
  }

  const toggle = (menu: "mega" | "acct" | "mobile") =>
    setOpenMenu((prev) => (prev === menu ? null : menu))

  const catLinks = categories.map((c) => {
    const Icon = catIcon(c.nombre)
    return (
      <Link
        key={c.id_categoria}
        className="mcat"
        href={`/catalogo?categoria=${c.id_categoria}`}
        title={c.nombre}
        onClick={() => setOpenMenu(null)}
      >
        <span className="tile"><Icon className="pg-ic" aria-hidden /></span>
        <span className="t">{c.nombre}</span>
      </Link>
    )
  })

  return (
    <header className="pg-chrome" ref={headerRef}>
      <div className="nav">
        <div className="pg-wrap">
          <Link className="logo" href="/" aria-label="Criscom Group — ir al inicio">
                <img className="logo-l" src="/logo.png" alt="" width="196" height="38" />
                <img className="logo-d" src="/logo-dark.png" alt="" width="196" height="38" />
          </Link>

          <form className="header-search" action="/catalogo" method="get" role="search" aria-label="Búsqueda global">
            <label className="sr" htmlFor="header-search">Buscar productos o categorías</label>
            <input id="header-search" name="q" type="search" placeholder="¿Qué producto estás buscando?" maxLength={200} />
            <button type="submit" aria-label="Buscar en el catálogo"><Search className="pg-ic" aria-hidden /><span>Buscar</span></button>
          </form>

          <div className="nav-spacer only-m" />

          <div className="nav-util">
            {waUrl && (
              <a
                className="btn btn-wa only-d"
                href={waUrl}
                target="_blank"
                rel="noopener noreferrer"
                aria-label={`Escribir por WhatsApp al ${waLabel}`}
              >
                <FaWhatsapp className="pg-ic" aria-hidden />
                <span className="wa-copy"><strong>WhatsApp</strong><small>Te asesoramos</small></span>
              </a>
            )}

            <CartDropdown cartCount={cartCount} onCartUpdate={computeCartCount} />

            {currentUser ? (
              <div className="pos only-d">
                <button
                  type="button"
                  className="btn btn-outline"
                  aria-expanded={openMenu === "acct"}
                  aria-haspopup="menu"
                  onClick={() => toggle("acct")}
                >
                  <User className="pg-ic" aria-hidden />
                  Mi cuenta
                  <ChevronDown className="pg-ic chev" style={{ width: 16, height: 16 }} aria-hidden />
                </button>
                {openMenu === "acct" && (
                  <div className="menu" role="menu">
                    <div className="menu-id">
                      <b>{currentUser.name}</b>
                      <span>{currentUser.email}</span>
                    </div>
                    <Link role="menuitem" href="/mi-cuenta" onClick={() => setOpenMenu(null)}>
                      <User className="pg-ic" aria-hidden /> Mi cuenta
                    </Link>
                    <Link role="menuitem" href="/mi-cuenta?tab=pedidos" onClick={() => setOpenMenu(null)}>
                      <Package2 className="pg-ic" aria-hidden /> Mis pedidos
                    </Link>
                    <Link role="menuitem" href="/mi-cuenta?tab=solicitudes" onClick={() => setOpenMenu(null)}>
                      <ClipboardList className="pg-ic" aria-hidden /> Mis solicitudes
                    </Link>
                    {hasErpAccess && (
                      <a role="menuitem" href="/erp/" onClick={() => setOpenMenu(null)}>
                        <LayoutDashboard className="pg-ic" aria-hidden /> ERP
                      </a>
                    )}
                    <hr />
                    <button type="button" role="menuitem" onClick={handleLogout}>
                      <LogOut className="pg-ic" aria-hidden /> Salir
                    </button>
                  </div>
                )}
              </div>
            ) : (
              <Link className="btn btn-outline only-d" href="/iniciar-sesion">
                <LogIn className="pg-ic" aria-hidden /> Ingresar
              </Link>
            )}

            <button
              type="button"
              className="icon-btn only-m"
              aria-expanded={openMenu === "mobile"}
              aria-label={openMenu === "mobile" ? "Cerrar menú" : "Abrir menú"}
              onClick={() => toggle("mobile")}
            >
              {openMenu === "mobile" ? <X className="pg-ic" aria-hidden /> : <Menu className="pg-ic" aria-hidden />}
            </button>
          </div>
          <nav className="nav-links only-d" aria-label="Principal">
            <Link className="nl" href="/" aria-current={pathname === "/" ? "page" : undefined}>
              Inicio
            </Link>
            <button
              type="button"
              className="nl"
              aria-expanded={openMenu === "mega"}
              aria-haspopup="true"
              aria-controls="mega-catalogo"
              onClick={() => toggle("mega")}
            >
              Catálogo <ChevronDown className="pg-ic chev" style={{ width: 16, height: 16 }} aria-hidden />
            </button>
            {NAV_LINKS.map((item) => (
              <Link
                key={item.to}
                className="nl"
                href={item.to}
                aria-current={pathname === item.to ? "page" : undefined}
              >
                {item.name}
              </Link>
            ))}
          </nav>
        </div>

        {openMenu === "mega" && (
          <div className="mega only-d" id="mega-catalogo" role="region" aria-label="Categorías del catálogo">
            <div className="mega-hd">
              <span>Categorías</span>
              <span>{categories.length} disponibles</span>
            </div>
            <div className="mega-grid">{catLinks}</div>
            <div className="mega-ft">
              <Link className="more" href="/catalogo" onClick={() => setOpenMenu(null)}>
                Ver todo el catálogo →
              </Link>
            </div>
          </div>
        )}

        {openMenu === "mobile" && (
          <div className="mpanel only-m">
            <Link className="nl" href="/" aria-current={pathname === "/" ? "page" : undefined}>
              Inicio
            </Link>
            <button
              type="button"
              className="nl"
              aria-expanded={mobileCatsOpen}
              onClick={() => setMobileCatsOpen((v) => !v)}
            >
              Catálogo <ChevronDown className="pg-ic chev" style={{ width: 16, height: 16 }} aria-hidden />
            </button>
            {mobileCatsOpen && (
              <div className="acc">
                {catLinks}
                <Link className="more" href="/catalogo" onClick={() => setOpenMenu(null)}>
                  Ver todo el catálogo →
                </Link>
              </div>
            )}
            {NAV_LINKS.map((item) => (
              <Link
                key={item.to}
                className="nl"
                href={item.to}
                aria-current={pathname === item.to ? "page" : undefined}
              >
                {item.name}
              </Link>
            ))}
            <div className="m-ctas">
              {currentUser ? (
                <>
                  <Link className="btn btn-outline btn-block" href="/mi-cuenta" onClick={() => setOpenMenu(null)}>
                    <User className="pg-ic" aria-hidden /> Mi cuenta
                  </Link>
                  <Link className="btn btn-outline btn-block" href="/mi-cuenta?tab=pedidos" onClick={() => setOpenMenu(null)}>
                    <Package2 className="pg-ic" aria-hidden /> Mis pedidos
                  </Link>
                  {hasErpAccess && (
                    <a className="btn btn-outline btn-block" href="/erp/">
                      <LayoutDashboard className="pg-ic" aria-hidden /> ERP
                    </a>
                  )}
                  <button type="button" className="btn btn-outline btn-block" onClick={handleLogout}>
                    <LogOut className="pg-ic" aria-hidden /> Salir
                  </button>
                </>
              ) : (
                <Link className="btn btn-outline btn-block" href="/iniciar-sesion" onClick={() => setOpenMenu(null)}>
                  <LogIn className="pg-ic" aria-hidden /> Ingresar
                </Link>
              )}
              {waUrl && (
                <a className="btn btn-wa btn-block" href={waUrl} target="_blank" rel="noopener noreferrer">
                  <FaWhatsapp className="pg-ic" aria-hidden /> Escribir por WhatsApp
                </a>
              )}
            </div>
          </div>
        )}
      </div>
    </header>
  )
}

export default Header
