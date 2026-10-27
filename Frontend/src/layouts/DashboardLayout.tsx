"use client"

import { useState, useEffect } from "react"
import { Outlet, Link, useLocation, useNavigate } from "react-router-dom"
import {
  LayoutDashboard,
  Gauge,
  Package,
  Tags,
  ShoppingCart,
  Building2,
  LogOut,
  Menu,
  User,
  DollarSign,
  FileText,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Percent,
  ClipboardList,
  ClipboardPlus,
  Globe2,
  CreditCard,
  ArrowDownToLine,
  ArrowUpFromLine,
  BookOpen,
  Share2,
  Ship,
  Truck,
  Cpu,
  Wrench,
  BrainCircuit,
  MessageCircle,
  Coins,
  Wallet,
  Settings,
  Boxes,
  BadgeDollarSign,
  ShieldCheck,
  X,
  Mail,
  Moon,
  Sun,
} from "lucide-react"
import { useAuth } from "../contexts/AuthContext"
import { cn } from "../lib/utils"
import { useTheme } from "../lib/theme"
import { motion, AnimatePresence } from "framer-motion"
import { useKeyboardShortcuts } from "../contexts/KeyboardShortcutsContext"
import { features } from "../config/features"
import { HelpCircle } from "lucide-react"
import { BusinessHoursIndicator } from "../components/business-hours-indicator"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../components/ui/alert-dialog"

type NavChild = { path: string; label: string; icon: React.ReactNode }
type NavItem = { path: string; label: string; icon: React.ReactNode; children?: NavChild[] }

const LOGO_URL = `${import.meta.env.BASE_URL}logo-criscom.png`

// Recortes del logo (sprite). Medidas calibradas sobre el archivo de 1200 px de ancho.
const LogoSymbol = ({ width }: { width: number }) => (
  <span
    role="img"
    aria-label="Criscom Group"
    className="block shrink-0"
    style={{
      width,
      height: (width * 290) / 278,
      backgroundImage: `url(${LOGO_URL})`,
      backgroundRepeat: "no-repeat",
      backgroundSize: `${(width * 1200) / 278}px auto`,
      backgroundPosition: `${(-width * 452) / 278}px ${(-width * 148) / 278}px`,
    }}
  />
)

const LogoWordmark = ({ width }: { width: number }) => (
  <span
    aria-hidden="true"
    className="block shrink-0"
    style={{
      width,
      height: (width * 60) / 556,
      backgroundImage: `url(${LOGO_URL})`,
      backgroundRepeat: "no-repeat",
      backgroundSize: `${(width * 1200) / 556}px auto`,
      backgroundPosition: `${(-width * 322) / 556}px ${(-width * 440) / 556}px`,
    }}
  />
)

const focusRing = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
const navRow = `relative flex h-[var(--rh)] w-full items-center gap-2.5 rounded-lg px-2.5 text-left text-sm font-medium whitespace-nowrap text-nav-fg transition-colors hover:bg-sidebar-hover ${focusRing}`
const navRowOn = "bg-sidebar-active font-semibold text-sidebar-active-fg hover:bg-sidebar-active [&_.shell-ic]:text-vivo"
const navRowGroupOn = "font-semibold text-primary [&_.shell-ic]:text-vivo"
const navKid = `flex h-[var(--ch)] items-center gap-2 rounded-lg pl-2.5 pr-2 text-[13px] font-medium whitespace-nowrap text-nav-fg-2 transition-colors hover:bg-sidebar-hover ${focusRing}`
const iconBox = "shell-ic flex shrink-0 items-center justify-center [&>svg]:h-[18px] [&>svg]:w-[18px]"
const iconButton = `relative grid h-11 w-11 shrink-0 place-items-center rounded-lg text-nav-fg transition-colors hover:bg-sidebar-hover ${focusRing}`

const DashboardLayout = () => {
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [isDesktop, setIsDesktop] = useState(() => window.innerWidth >= 1024)
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [logoutConfirmOpen, setLogoutConfirmOpen] = useState(false)
  const location = useLocation()
  const [openMenu, setOpenMenu] = useState<string | null>(() =>
    (location.pathname === '/services' || location.pathname.startsWith('/services/')) ? '/services-area' :
    ['/sales', '/sales/new', '/web-orders', '/deliveries', '/cash-register'].includes(location.pathname) ? '/sales-area' :
    ['/products', '/categories', '/acquisitions', '/imports', '/commercial-control'].includes(location.pathname) ? '/inventory-area' :
    ['/offers', '/social-links', '/blog'].includes(location.pathname) ? '/marketing-area' :
    ['/libro-reclamaciones', '/postventa'].includes(location.pathname) ? '/customer-care' :
    ['/payments', '/company', '/vendors', '/master-account', '/generate-ticket-pdf', '/generate-excel-products', '/audit-logs', '/solicitudes-importacion', '/solicitudes-ensamble'].includes(location.pathname) ? '/administration' : null
  )
  const navigate = useNavigate()
  const { user, logout } = useAuth()
  const { theme } = useTheme()
  const { setShowShortcutModal } = useKeyboardShortcuts()

  useEffect(() => {
    if (location.pathname === '/services' || location.pathname.startsWith('/services/')) setOpenMenu('/services-area')
    else if (['/sales', '/sales/new', '/web-orders', '/deliveries', '/cash-register'].includes(location.pathname)) setOpenMenu('/sales-area')
    else if (['/products', '/categories', '/acquisitions', '/imports', '/commercial-control'].includes(location.pathname)) setOpenMenu('/inventory-area')
    else if (['/offers', '/social-links', '/blog'].includes(location.pathname)) setOpenMenu('/marketing-area')
    else if (['/libro-reclamaciones', '/postventa'].includes(location.pathname)) setOpenMenu('/customer-care')
    else if (['/payments', '/company', '/vendors', '/master-account', '/generate-ticket-pdf', '/generate-excel-products', '/audit-logs', '/solicitudes-importacion', '/solicitudes-ensamble'].includes(location.pathname)) setOpenMenu('/administration')
  }, [location.pathname])

  // Determinar el rol del usuario (por defecto, asumimos No Autorizado - 4)
    const userRole = user?.id_role || 4
    const isTemporarySuperuser = Boolean(user?.id_role === 2 && user.superusuario_temporal && user.superusuario_expira_en && new Date(user.superusuario_expira_en) > new Date())
    const isCrisitus = user?.email?.trim().toLowerCase() === "cristophercalioro@gmail.com"
    const isMasterLike = isCrisitus || isTemporarySuperuser

  const handleLogoutRequest = () => {
    setLogoutConfirmOpen(true)
  }

  const handleLogoutConfirm = () => {
    logout()
    navigate("/login")
    setLogoutConfirmOpen(false)
  }

  // Efecto para manejar el cambio de tamaño de la ventana
  useEffect(() => {
    const handleResize = () => {
      const desktop = window.innerWidth >= 1024
      setIsDesktop(desktop)
      if (!desktop) {
        setSidebarOpen(false)
        setMobileMenuOpen(false)
      } else {
        setSidebarOpen(true)
        setMobileMenuOpen(false)
      }
    }

    // Configuración inicial
    handleResize()

    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [])

  // Añadir atajos de teclado
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.altKey && e.key === "s") {
        e.preventDefault()
        setSidebarOpen(prev => !prev)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [])
  // Filtrar los elementos de navegación según el rol
  const getNavItems = () => {
    const baseItems = [
      { path: "/", label: "Dashboard", icon: <LayoutDashboard className="h-5 w-5" />, allowedRoles: [1, 2, 3, 5, 6] },
    ]

    const roleSpecificItems = [
      { path: "/sales-area", label: "Ventas", icon: <BadgeDollarSign className="h-5 w-5" />, allowedRoles: [1, 2, 3, 5], children: [
        { path: "/sales/new", label: "Registrar venta", icon: <ArrowUpFromLine className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
        { path: "/sales", label: "Historial de ventas", icon: <ShoppingCart className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
        { path: "/web-orders", label: "Pedidos y pagos web", icon: <Globe2 className="h-4 w-4" />, allowedRoles: user?.tipo_vendedor === 'afiliado' ? [1, 2, 3, 5] : [1, 2, 5] },
        { path: "/deliveries", label: "Entregas por confirmar", icon: <Truck className="h-4 w-4" />, allowedRoles: [1, 2, 5] },
        { path: "/cash-register", label: "Caja diaria", icon: <DollarSign className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
      ] },
      ...(isMasterLike || [1, 6].includes(userRole) || user?.area_grants?.includes('servicio_tecnico') ? [{ path: "/services-area", label: "Servicio técnico", icon: <Wrench className="h-5 w-5" />, allowedRoles: user?.area_grants?.includes('servicio_tecnico') ? [1, 2, 3, 5, 6] : [1, 2, 3, 6], children: [
        { path: "/services", label: "Resumen del taller", icon: <Gauge className="h-4 w-4" /> },
        ...(!user?.affiliate_business_id ? [{ path: "/services/web-requests", label: "Solicitudes web", icon: <Globe2 className="h-4 w-4" /> }] : []),
        { path: "/services/intake", label: "Nuevo ingreso", icon: <ClipboardPlus className="h-4 w-4" /> },
        { path: "/services/technical", label: "Expedientes técnicos", icon: <ClipboardList className="h-4 w-4" /> },
        { path: "/services/maintenance", label: "Mantenimientos", icon: <Wrench className="h-4 w-4" /> },
        { path: "/services/pc-builds", label: "Armado de PCs", icon: <Cpu className="h-4 w-4" /> },
        { path: "/services/diagnostics", label: "Diagnóstico asistido", icon: <BrainCircuit className="h-4 w-4" /> },
        { path: "/services/whatsapp", label: "Comunicación al cliente", icon: <MessageCircle className="h-4 w-4" /> },
        { path: "/services/cash", label: "Caja y ventas de servicio", icon: <Coins className="h-4 w-4" /> },
        { path: "/services/expenses", label: "Gastos del taller", icon: <Wallet className="h-4 w-4" /> },
      ] }] : []),
      { path: "/inventory-area", label: "Inventario y compras", icon: <Boxes className="h-5 w-5" />, allowedRoles: user?.area_grants?.some(area => ['inventario','compras','cotizaciones'].includes(area)) ? [1,2,3,5,6] : [1, 2, 3], children: [
        { path: "/products", label: user?.tipo_vendedor === 'afiliado' ? "Mis productos e inventario" : "Productos e inventario", icon: <Package className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
        { path: "/commercial-control?tab=purchases", label: "Compras y proveedores", icon: <Truck className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
        { path: "/commercial-control?tab=quotes", label: "Cotizaciones profesionales", icon: <FileText className="h-4 w-4" />, allowedRoles: [1, 2, 3] },
        { path: "/categories", label: "Categorías", icon: <Tags className="h-4 w-4" />, allowedRoles: [1, 2] },
        { path: "/acquisitions", label: "Adquisiciones de segunda mano", icon: <ArrowDownToLine className="h-4 w-4" />, allowedRoles: [1, 2] },
        ...(isCrisitus ? [{ path: "/imports", label: "Compra por importación", icon: <Ship className="h-4 w-4" />, allowedRoles: [1] }] : []),
      ] },
      { path: "/marketing-area", label: "Marketing", icon: <Share2 className="h-5 w-5" />, allowedRoles: user?.area_grants?.includes('marketing') ? [1,2,3,5,6] : [1, 2], children: [
        { path: "/offers", label: "Ofertas", icon: <Percent className="h-4 w-4" />, allowedRoles: [1, 2] },
        { path: "/social-links", label: "Redes y banners", icon: <Share2 className="h-4 w-4" />, allowedRoles: [1, 2] },
        { path: "/blog", label: "Blog y contenidos", icon: <BookOpen className="h-4 w-4" />, allowedRoles: [1, 2] },
        { path: "/community", label: "Comunidad y correos", icon: <Mail className="h-4 w-4" />, allowedRoles: [1, 2] },
      ] },
      { path: "/customer-care", label: "Atención al cliente", icon: <MessageCircle className="h-5 w-5" />, allowedRoles: [1, 2], children: [
        ...(features.libroReclamaciones ? [{ path: "/libro-reclamaciones", label: "Libro de reclamaciones", icon: <AlertTriangle className="h-4 w-4" />, allowedRoles: [1, 2] }] : []),
        ...(features.ecommerce ? [{ path: "/postventa", label: "Cambios y garantías", icon: <ShieldCheck className="h-4 w-4" />, allowedRoles: [1, 2] }] : []),
      ] },
      { path: "/administration", label: "Administración", icon: <Settings className="h-5 w-5" />, allowedRoles: user?.area_grants?.some(area => ['auditoria','empresa_sunat','pagos_pos'].includes(area)) ? [1,2,3,5,6] : [1, 2, 5], children: [
        { path: "/company", label: "Empresa, SUNAT y pagos", icon: <Building2 className="h-4 w-4" />, allowedRoles: [1, 2] },
        ...(user?.area_grants?.includes('empresa_sunat') && ![1, 2].includes(userRole) ? [{ path: "/company?tab=sunat", label: "Empresa y SUNAT", icon: <Building2 className="h-4 w-4" /> }] : []),
        ...(user?.area_grants?.includes('pagos_pos') && ![1, 2].includes(userRole) ? [{ path: "/company?tab=payments", label: "Pasarelas y POS", icon: <CreditCard className="h-4 w-4" /> }] : []),
        ...(isCrisitus ? [{ path: "/master-account", label: "Cuenta maestra", icon: <ShieldCheck className="h-4 w-4" />, allowedRoles: [1] }] : []),
        ...(isCrisitus ? [{ path: "/vendors", label: "Usuarios y afiliados", icon: <User className="h-4 w-4" />, allowedRoles: [1] }] : []),
        { path: "/generate-ticket-pdf", label: "Tickets PDF", icon: <FileText className="h-4 w-4" />, allowedRoles: [1, 2] },
        { path: "/generate-excel-products", label: "Exportar productos", icon: <FileText className="h-4 w-4" />, allowedRoles: [1, 2] },
        ...(features.ecommerce && isCrisitus ? [{ path: "/solicitudes-importacion", label: "Solicitudes de importación", icon: <ClipboardList className="h-4 w-4" />, allowedRoles: [1] }] : []),
        ...(features.ecommerce && isCrisitus ? [{ path: "/solicitudes-ensamble", label: "Cotizaciones de armado", icon: <Cpu className="h-4 w-4" />, allowedRoles: [1] }] : []),
        { path: "/audit-logs", label: "Logs de auditoría", icon: <FileText className="h-4 w-4" />, allowedRoles: [1, 5] },
      ] },
      { path: "/manuals", label: "Manual de mi perfil", icon: <BookOpen className="h-5 w-5" />, allowedRoles: [1, 2, 3, 5, 6] },
      { path: "/access-center", label: "Solicitudes de acceso", icon: <ShieldCheck className="h-5 w-5" />, allowedRoles: [1, 2, 3, 5, 6] },
      ...(user?.tipo_vendedor === 'afiliado' ? [{ path: "/affiliate-subscription", label: "Logo, nombre y suscripción", icon: <CreditCard className="h-5 w-5" />, allowedRoles: [3] }] : []),
    ]

    return [...baseItems, ...roleSpecificItems
      .filter((item) => item.allowedRoles.includes(userRole))
      .map((item) => {
        if (!('children' in item)) return item
        const canSeeGrantedChild = (path: string) => (item.path === '/marketing-area' && user?.area_grants?.includes('marketing'))
          || (item.path === '/services-area' && user?.area_grants?.includes('servicio_tecnico'))
          || (item.path === '/inventory-area' && path.includes('tab=inventory') && user?.area_grants?.includes('inventario'))
          || (item.path === '/inventory-area' && path.includes('tab=purchases') && user?.area_grants?.includes('compras'))
          || (item.path === '/inventory-area' && path.includes('tab=quotes') && user?.area_grants?.includes('cotizaciones'))
          || (item.path === '/inventory-area' && ['/products', '/categories'].includes(path) && user?.area_grants?.includes('inventario'))
          || (item.path === '/inventory-area' && path === '/acquisitions' && user?.area_grants?.includes('compras'))
          || (item.path === '/administration' && path === '/audit-logs' && user?.area_grants?.includes('auditoria'))
          || (item.path === '/administration' && path.startsWith('/company') && path !== '/company' && user?.area_grants?.includes('empresa_sunat') && !path.includes('tab=payments'))
          || (item.path === '/administration' && path === '/company?tab=payments' && user?.area_grants?.includes('pagos_pos'))
        return { ...item, children: (item.children! as Array<{ path: string; label: string; icon: React.ReactNode; allowedRoles?: number[] }>).filter(child => canSeeGrantedChild(child.path) || (child.allowedRoles?.includes(userRole) ?? true)) }
      })]
  }

  const navItems = (getNavItems() as unknown as NavItem[]).filter((item) => !item.children || item.children.length > 0)
  const isNavPathActive = (path: string) => {
    const [pathname, query = ''] = path.split('?')
    if (location.pathname !== pathname) return false
    if (!query) return true
    const expected = new URLSearchParams(query)
    const current = new URLSearchParams(location.search)
    return [...expected.entries()].every(([key, value]) => current.get(key) === value)
  }

  // Pantalla actual: hoja o hijo exacto; si no hay coincidencia exacta (p. ej. /products/12), el prefijo más largo.
  const currentNav = (() => {
    for (const item of navItems) {
      if (!item.children && isNavPathActive(item.path)) return { title: item.label, leafPath: item.path }
      for (const child of item.children ?? []) {
        if (isNavPathActive(child.path)) return { title: child.label, crumb: item.label, groupPath: item.path, leafPath: child.path }
      }
    }
    let best: { title: string; crumb?: string; groupPath?: string; leafPath: string } | null = null
    let bestLen = 0
    const consider = (path: string, title: string, crumb?: string, groupPath?: string) => {
      const base = path.split("?")[0]
      if (base !== "/" && location.pathname.startsWith(`${base}/`) && base.length > bestLen) {
        best = { title, crumb, groupPath, leafPath: path }
        bestLen = base.length
      }
    }
    for (const item of navItems) {
      if (!item.children) consider(item.path, item.label)
      for (const child of item.children ?? []) consider(child.path, child.label, item.label, item.path)
    }
    return best ?? { title: location.pathname === "/" ? "Dashboard" : "Criscom Group", leafPath: "" }
  })() as { title: string; crumb?: string; groupPath?: string; leafPath: string }

  const closeMobile = () => setMobileMenuOpen(false)
  const toggleThemeNow = useTheme((state) => state.toggleTheme)

  useEffect(() => {
    const onToggleTheme = () => toggleThemeNow()
    window.addEventListener("toggleTheme", onToggleTheme)
    return () => window.removeEventListener("toggleTheme", onToggleTheme)
  }, [toggleThemeNow])

  const themeLabel = theme === "dark" ? "Cambiar a modo claro" : "Cambiar a modo oscuro"

  const brandLink = (compact: boolean) => (
    <a
      href="/"
      aria-label="Volver a la tienda Criscom Group"
      className={cn(
        "flex h-11 items-center gap-2 rounded-lg dark:bg-white",
        compact ? "w-11 justify-center" : "px-2.5",
        focusRing
      )}
    >
      <LogoSymbol width={30} />
      {!compact && <LogoWordmark width={150} />}
    </a>
  )

  const logoutButton = (variant: "full" | "rail") => {
    const button = (
      <button
        type="button"
        onClick={handleLogoutRequest}
        aria-label={variant === "rail" ? "Cerrar Sesión" : undefined}
        className={cn(navRow, "hover:bg-destructive/10 hover:text-destructive-text", variant === "rail" && "h-11 w-11 justify-center px-0")}
      >
        <span className={iconBox}><LogOut /></span>
        {variant === "full" && <span className="flex-1">Cerrar Sesión</span>}
      </button>
    )
    if (variant === "full") return button
    return (
      <Tooltip>
        <TooltipTrigger asChild>{button}</TooltipTrigger>
        <TooltipContent side="right" sideOffset={12}>Cerrar Sesión</TooltipContent>
      </Tooltip>
    )
  }

  const renderNav = (variant: "full" | "rail") =>
    navItems.map((item) => {
      const children = item.children
      if (!children) {
        const on = currentNav.leafPath === item.path
        const link = (
          <Link
            key={item.path}
            to={item.path}
            onClick={closeMobile}
            aria-current={on ? "page" : undefined}
            aria-label={variant === "rail" ? item.label : undefined}
            className={cn(navRow, variant === "rail" && "h-11 w-11 justify-center px-0", on && navRowOn)}
          >
            <span className={iconBox}>{item.icon}</span>
            {variant === "full" && <span className="flex-1 truncate">{item.label}</span>}
          </Link>
        )
        if (variant === "full") return link
        return (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>{link}</TooltipTrigger>
            <TooltipContent side="right" sideOffset={12}>{item.label}</TooltipContent>
          </Tooltip>
        )
      }

      const hasOn = currentNav.groupPath === item.path
      if (variant === "rail") {
        return (
          <Tooltip key={item.path}>
            <TooltipTrigger asChild>
              <button
                type="button"
                aria-label={item.label}
                aria-haspopup="true"
                onClick={() => { setSidebarOpen(true); setOpenMenu(item.path) }}
                className={cn(navRow, "h-11 w-11 justify-center px-0", hasOn && navRowOn)}
              >
                <span className={iconBox}>{item.icon}</span>
                <ChevronRight className="absolute right-px top-1/2 -mt-[5px] h-2.5 w-2.5 text-muted-foreground" aria-hidden="true" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="right" sideOffset={12}>
              {item.label}
              <span className="block text-[11.5px] opacity-80">{children.length} enlace{children.length > 1 ? "s" : ""}</span>
            </TooltipContent>
          </Tooltip>
        )
      }

      const open = openMenu === item.path
      return (
        <div key={item.path}>
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpenMenu((current) => (current === item.path ? null : item.path))}
            className={cn(navRow, hasOn && navRowGroupOn)}
          >
            <span className={iconBox}>{item.icon}</span>
            <span className="flex-1 truncate">{item.label}</span>
            <ChevronDown className={cn("shell-ic h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-180", hasOn && "text-vivo")} aria-hidden="true" />
          </button>
          <AnimatePresence initial={false}>
            {open && (
              <motion.div
                role="group"
                aria-label={item.label}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.15 }}
                className="mb-1 ml-2 mt-0.5 flex flex-col gap-px overflow-hidden border-l border-border-strong"
              >
                {children.map((child) => {
                  const childOn = currentNav.leafPath === child.path
                  return (
                    <Link
                      key={child.path}
                      to={child.path}
                      onClick={closeMobile}
                      aria-current={childOn ? "page" : undefined}
                      className={cn(navKid, "shell-kid", childOn && navRowOn)}
                    >
                      <span className="shell-ic flex shrink-0 items-center justify-center">{child.icon}</span>
                      <span className="truncate">{child.label}</span>
                    </Link>
                  )
                })}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      )
    })

  const sidebarWidth = sidebarOpen ? "17rem" : "4rem"
  const railMode = !sidebarOpen

  return (
    <TooltipProvider>
      <div className={`min-h-screen bg-background ${theme}`}>
        {/* Fondo del menú móvil */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 z-40 bg-[hsl(222_84%_5%/0.5)] lg:hidden"
              onClick={closeMobile}
            />
          )}
        </AnimatePresence>

        {/* Drawer móvil */}
        <AnimatePresence>
          {mobileMenuOpen && (
            <motion.aside
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", stiffness: 300, damping: 30 }}
              style={{ "--rh": "44px", "--ch": "44px" } as React.CSSProperties}
              className="fixed left-0 top-0 z-50 flex h-[100dvh] w-[min(18rem,84vw)] flex-col border-r border-border bg-card shadow-[8px_0_24px_hsl(222_47%_11%/0.18)] lg:hidden"
            >
              <div className="flex h-[60px] shrink-0 items-center justify-between border-b border-border px-2">
                {brandLink(false)}
                <button type="button" aria-label="Cerrar menú" onClick={closeMobile} className={iconButton}>
                  <X className="h-5 w-5" />
                </button>
              </div>
              <nav aria-label="Navegación principal" className="flex min-h-0 flex-1 flex-col overflow-y-auto overscroll-contain p-2 [&_.shell-kid]:text-sm">
                {renderNav("full")}
              </nav>
              <div className="shrink-0 border-t border-border p-2">{logoutButton("full")}</div>
            </motion.aside>
          )}
        </AnimatePresence>

        {/* Sidebar de escritorio */}
        <motion.aside
          initial={false}
          animate={{ width: sidebarWidth }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
          className="fixed left-0 top-0 z-30 hidden h-full flex-col border-r border-border bg-card lg:flex"
        >
          <div className={cn("flex h-[60px] shrink-0 items-center border-b border-border", railMode ? "justify-center" : "px-2")}>
            {brandLink(railMode)}
          </div>
          <nav
            aria-label="Navegación principal"
            className={cn("flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto overscroll-contain p-2", railMode && "items-center px-0")}
          >
            {renderNav(railMode ? "rail" : "full")}
          </nav>
          <div className={cn("shrink-0 border-t border-border p-2", railMode && "flex justify-center px-0")}>
            {logoutButton(railMode ? "rail" : "full")}
          </div>
        </motion.aside>

        {/* Contenido */}
        <motion.div
          className="relative z-10 flex min-h-screen flex-col"
          animate={{ paddingLeft: isDesktop ? sidebarWidth : "0rem" }}
          transition={{ type: "spring", stiffness: 300, damping: 30 }}
        >
          <header className="sticky top-0 z-20 flex h-[60px] items-center gap-1 border-b border-border bg-card pl-1 pr-2 lg:pl-2 lg:pr-4">
            <button type="button" aria-label="Abrir menú" onClick={() => setMobileMenuOpen(true)} className={cn(iconButton, "lg:hidden")}>
              <Menu className="h-[22px] w-[22px]" />
            </button>
            <a
              href="/"
              aria-label="Volver a la tienda Criscom Group"
              className={cn(iconButton, "rounded-[10px] dark:bg-white lg:hidden")}
            >
              <LogoSymbol width={28} />
            </a>

            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label={`${sidebarOpen ? "Colapsar menú" : "Expandir menú"} (Alt + S)`}
                  onClick={() => setSidebarOpen((open) => !open)}
                  className={cn(iconButton, "hidden lg:grid")}
                >
                  <ChevronLeft className={cn("h-5 w-5 transition-transform duration-200", !sidebarOpen && "rotate-180")} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom">
                {sidebarOpen ? "Colapsar menú" : "Expandir menú"}
                <span className="block text-[11.5px] opacity-80">Alt + S</span>
              </TooltipContent>
            </Tooltip>

            <div className="ml-1.5 flex min-w-0 flex-col justify-center">
              {currentNav.crumb && <span className="whitespace-nowrap text-xs leading-tight text-muted-foreground">{currentNav.crumb}</span>}
              <h2 className="truncate text-base font-semibold leading-tight">{currentNav.title}</h2>
            </div>

            <div className="ml-auto flex shrink-0 items-center gap-1">
              <div className="mr-1 hidden sm:block"><BusinessHoursIndicator /></div>

              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" aria-label="Atajos de teclado" onClick={() => setShowShortcutModal(true)} className={cn(iconButton, "hidden sm:grid")}>
                    <HelpCircle className="h-5 w-5" />
                  </button>
                </TooltipTrigger>
                <TooltipContent side="bottom">Atajos de teclado</TooltipContent>
              </Tooltip>

              <button type="button" aria-label={themeLabel} onClick={toggleThemeNow} className={iconButton}>
                {theme === "dark" ? <Sun className="h-5 w-5" /> : <Moon className="h-5 w-5" />}
              </button>

              <div className="flex h-11 items-center gap-2 rounded-full pl-1.5 pr-1.5 text-sm font-medium text-nav-fg sm:pr-2.5">
                <span className="grid h-8 w-8 place-items-center rounded-full bg-sidebar-active text-sidebar-active-fg">
                  <User className="h-4 w-4" />
                </span>
                <span className="hidden sm:block">{user?.name || "Usuario"}</span>
              </div>
            </div>
          </header>

          <main className="min-w-0 flex-1 overflow-x-hidden bg-main-bg p-3 lg:p-6">
            <Outlet />
          </main>
        </motion.div>

        {/* Confirmación de cierre de sesión */}
        <AlertDialog open={logoutConfirmOpen} onOpenChange={setLogoutConfirmOpen}>
          <AlertDialogContent className="max-w-md">
            <AlertDialogHeader>
              <div className="mb-4 flex items-center justify-center">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-[hsl(var(--destructive)/0.12)]">
                  <AlertTriangle className="h-[22px] w-[22px] text-destructive-text" />
                </div>
              </div>
              <AlertDialogTitle className="text-center text-lg font-semibold">¿Cerrar sesión?</AlertDialogTitle>
              <AlertDialogDescription className="text-center text-muted-foreground">
                ¿Estás seguro de que deseas cerrar tu sesión? Tendrás que volver a iniciar sesión para acceder a tu cuenta.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter className="mt-6 flex justify-center gap-3">
              <AlertDialogCancel className="h-11">Cancelar</AlertDialogCancel>
              <AlertDialogAction onClick={handleLogoutConfirm} className="h-11 bg-destructive text-white hover:bg-destructive/90">
                <LogOut className="mr-2 h-4 w-4" />
                Cerrar Sesión
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
    </TooltipProvider>
  )
}

export default DashboardLayout
