"use client"

// /catalogo (port criscom-ecom-catalogo): cabecera de una linea, filtros en una linea,
// grid plano con quick-view, paginacion cliente (12 por pagina), estados honestos.
// Contrato pendiente implementado: lee ?categoria=<id> y ?ofertas=1 (navbar/home ya enlazan asi).
import { useCallback, useEffect, useMemo, useState } from "react"
import { useSearchParams } from "next/navigation"
import { createPortal } from "react-dom"
import { Search, X } from "lucide-react"
import { ecommerceCategoryService, ecommerceProductService, type Category, type Product } from "@/services/ecommerceApi"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import { addToCartHome } from "@/components/home/homeShared"
import { F0, filtrar, nActivos, PER_PAGE, precioEfectivo, precioLbl, type Filtros } from "./catShared"
import "@/styles/catalogo.css"
import CatCard from "./CatCard"
import CatQuickView from "./CatQuickView"
import CatFilterBar, { FiltrosMovil, FiltrosSheet } from "./CatFilters"
import { CatalogoError, CatalogoSkeletonGrid, CatalogoVacio } from "./CatStates"

type Status = "loading" | "error" | "ready"

const CatalogoClient = () => {
  const searchParams = useSearchParams()
  const configPublica = useConfigPublica()
  const [status, setStatus] = useState<Status>("loading")
  const [productos, setProductos] = useState<Product[]>([])
  const [categorias, setCategorias] = useState<Category[]>([])
  const [f, setF] = useState<Filtros>(F0)
  const [qv, setQv] = useState<Product | null>(null)
  const [sheet, setSheet] = useState(false)

  const load = useCallback(() => {
    setStatus("loading")
    Promise.all([ecommerceProductService.getAll(), ecommerceCategoryService.getAll()])
      .then(([prods, cats]) => {
        setProductos(Array.isArray(prods.data) ? prods.data : [])
        setCategorias(Array.isArray(cats.data) ? cats.data : [])
        setStatus("ready")
      })
      .catch(() => setStatus("error"))
  }, [])

  useEffect(() => { load() }, [load])

  // La búsqueda global reutiliza filtrar y los controles existentes mediante ?q=.
  useEffect(() => {
    const cat = Number(searchParams.get("categoria"))
    const ofertas = searchParams.get("ofertas") === "1"
    setF((prev) => ({
      ...prev,
      q: (searchParams.get("q") || "").trim(),
      cats: Number.isInteger(cat) && cat > 0 ? [cat] : [],
      oferta: ofertas,
      page: 1,
    }))
  }, [searchParams])

  const patch = useCallback((p: Partial<Filtros>) => setF((prev) => ({ ...prev, ...p, page: p.page ?? 1 })), [])
  const toggleCat = useCallback((id: number) =>
    setF((prev) => ({ ...prev, cats: prev.cats.includes(id) ? prev.cats.filter((x) => x !== id) : [...prev.cats, id], page: 1 })), [])
  const toggleFlag = useCallback((key: "oferta" | "stock") => setF((prev) => ({ ...prev, [key]: !prev[key], page: 1 })), [])
  const clearAll = useCallback(() => setF((prev) => ({ ...F0(), orden: prev.orden })), [])

  const list = useMemo(() => filtrar(productos, f), [productos, f])
  const pages = Math.max(1, Math.ceil(list.length / PER_PAGE))
  const page = Math.min(f.page, pages)
  const pageItems = list.slice((page - 1) * PER_PAGE, page * PER_PAGE)
  const catCount = useCallback((id: number) => productos.filter((p) => p.category_id === id).length, [productos])
  const countFor = useCallback((d: Filtros) => filtrar(productos, d).length, [productos])
  const nAct = nActivos(f)

  const addOne = useCallback((p: Product) => {
    addToCartHome({
      productId: p.id,
      name: p.name,
      price: precioEfectivo(p),
      imagen: p.imagen || undefined,
      affiliate_business_id: p.affiliate_business_id ?? null,
    })
  }, [])

  const filterProps = {
    f, categorias, catCount,
    onToggleCat: toggleCat,
    onToggle: toggleFlag,
    onPrecio: (min: string, max: string) => patch({ min, max }),
    onOrden: (orden: Filtros["orden"]) => patch({ orden }),
    onClear: clearAll,
    onApply: (next: Filtros) => setF(next),
  }

  const chips: [string, string][] = [
    ...f.cats.map((id): [string, string] => [`cat:${id}`, categorias.find((c) => c.id === id)?.name || "Categoría"]),
    ...(f.oferta ? [["oferta", "Solo ofertas"] as [string, string]] : []),
    ...(f.stock ? [["stock", "Solo con stock"] as [string, string]] : []),
    ...(f.min !== "" || f.max !== "" ? [["prc", precioLbl(f)] as [string, string]] : []),
    ...(f.q ? [["q", `Búsqueda: «${f.q}»`] as [string, string]] : []),
  ]
  const quitarChip = (id: string) => {
    if (id.startsWith("cat:")) toggleCat(Number(id.slice(4)))
    else if (id === "oferta" || id === "stock") toggleFlag(id)
    else if (id === "prc") patch({ min: "", max: "" })
    else if (id === "q") patch({ q: "" })
  }

  return (
    <div className="pg-catalogo">
      <div className="pg-wrap pg">
        <div className="ph">
          <h1>Catálogo</h1>
          {status === "ready" && <span className="cnt num">{productos.length} productos</span>}
          <span className="sp" />
          <div className="sx" role="search">
            <Search className="ic" aria-hidden />
            <input
              className="inp"
              type="search"
              aria-label="Buscar en el catálogo"
              placeholder="Buscar producto o categoría"
              value={f.q}
              onChange={(e) => patch({ q: e.target.value })}
            />
            {f.q && (
              <button type="button" className="icon-btn clr" aria-label="Borrar búsqueda" onClick={() => patch({ q: "" })}>
                <X className="ic" aria-hidden />
              </button>
            )}
          </div>
        </div>

        {status !== "error" && (
          <>
            <CatFilterBar {...filterProps} />
            <FiltrosMovil f={f} onOrden={(orden) => patch({ orden })} onOpen={() => setSheet(true)} />
          </>
        )}

        {status === "ready" && (
          <div className="rs" aria-live="polite">
            {nAct + (f.q ? 1 : 0) > 0 ? (
              <span className="txt">
                <b className="num">{productos.length}</b> {"→"} <b className="num">{list.length}</b> {list.length === 1 ? "producto" : "productos"}
              </span>
            ) : (
              <span className="txt">
                <b className="num">{list.length ? (page - 1) * PER_PAGE + 1 : 0}{"–"}{Math.min(page * PER_PAGE, list.length)}</b> de <b className="num">{list.length}</b> productos
              </span>
            )}
            {chips.map(([id, label]) => (
              <button key={id} type="button" className="fc" aria-label={`Quitar filtro ${label}`} onClick={() => quitarChip(id)}>
                <span>{label}</span>
                <X className="ic s16" aria-hidden />
              </button>
            ))}
            {chips.length > 0 && (
              <button type="button" className="lnk" onClick={clearAll}>
                Limpiar filtros
              </button>
            )}
          </div>
        )}

        <div style={{ marginTop: 8 }}>
          {status === "loading" && <CatalogoSkeletonGrid />}
          {status === "error" && <CatalogoError onRetry={load} />}
          {status === "ready" && list.length === 0 && <CatalogoVacio q={f.q} emptyCatalog={productos.length === 0} onClear={clearAll} />}
          {status === "ready" && list.length > 0 && (
            <>
              <div className="grid">
                {pageItems.map((p) => (
                  <CatCard key={p.id} product={p} selected={qv?.id === p.id} onQuickView={setQv} onAdd={addOne} />
                ))}
              </div>
              {pages > 1 && (
                <nav className="pgn" aria-label="Paginación">
                  <span className="txt num">
                    {(page - 1) * PER_PAGE + 1}{"–"}{Math.min(page * PER_PAGE, list.length)} de {list.length}
                  </span>
                  <div className="ctl">
                    <button type="button" className="btn btn-outline" disabled={page <= 1} onClick={() => patch({ page: page - 1 })}>
                      Anterior
                    </button>
                    <span className="only-d" style={{ display: "contents" }}>
                      {Array.from({ length: pages }, (_, i) => i + 1).map((n) => (
                        <button key={n} type="button" className="pgb" aria-current={n === page ? "page" : undefined} aria-label={`Página ${n}`} onClick={() => patch({ page: n })}>
                          {n}
                        </button>
                      ))}
                    </span>
                    <button type="button" className="btn btn-outline" disabled={page >= pages} onClick={() => patch({ page: page + 1 })}>
                      Siguiente
                    </button>
                  </div>
                </nav>
              )}
            </>
          )}
        </div>
      </div>

      {qv && <CatQuickView product={qv} whatsapp={configPublica?.whatsapp_number ?? null} onClose={() => setQv(null)} />}
      {sheet && <FiltrosSheetPortal {...filterProps} countFor={countFor} onClose={() => setSheet(false)} />}
    </div>
  )
}

// La hoja se monta en portal (fixed real) con su propio ambito .pg-catalogo.
const FiltrosSheetPortal = (props: Parameters<typeof FiltrosSheet>[0]) =>
  createPortal(
    <div className="pg-catalogo">
      <FiltrosSheet {...props} />
    </div>,
    document.body,
  )

export default CatalogoClient
