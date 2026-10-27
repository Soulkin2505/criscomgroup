"use client"

// Estados del catalogo: carga (esqueleto plano), vacio con Limpiar filtros, error con Reintentar (D10).
import { RefreshCw, SearchX, WifiOff } from "lucide-react"
import Link from "next/link"

export const CatalogoSkeletonGrid = ({ count = 12 }: { count?: number }) => (
  <div className="grid" aria-busy="true" aria-label="Cargando productos">
    {Array.from({ length: count }, (_, i) => (
      <article key={i} className="pc skl" aria-hidden="true">
        <div className="pim" />
        <div className="pb">
          <div className="sk" style={{ height: 24, width: "40%" }} />
          <div className="sk" style={{ height: 18 }} />
          <div className="sk" style={{ height: 18, width: "70%" }} />
          <div className="sk" style={{ height: 24, width: "50%", marginTop: 6 }} />
          <div className="sk" style={{ height: 44, marginTop: "auto" }} />
        </div>
      </article>
    ))}
  </div>
)

export const CatalogoError = ({ onRetry }: { onRetry: () => void }) => (
  <div className="stt err" role="alert">
    <span className="tile">
      <WifiOff className="ic" aria-hidden />
    </span>
    <h2>No pudimos cargar el catálogo</h2>
    <p>Revisa tu conexión e inténtalo de nuevo. Tus productos del carrito se conservan.</p>
    <div className="acts">
      <button type="button" className="btn btn-primary" onClick={onRetry}>
        <RefreshCw className="ic" aria-hidden />
        Reintentar
      </button>
    </div>
  </div>
)

export const CatalogoVacio = ({ q, emptyCatalog = false, onClear }: { q: string; emptyCatalog?: boolean; onClear: () => void }) => (
  <div className="stt" role="status">
    <span className="tile">
      <SearchX className="ic" aria-hidden />
    </span>
    <h2>{emptyCatalog ? "Estamos preparando nuestro catálogo" : q ? `Sin resultados para «${q}»` : "Ningún producto coincide con los filtros"}</h2>
    <p>{emptyCatalog ? "Aún no hay productos publicados. Puedes explorar nuestros servicios mientras incorporamos novedades." : "Prueba con otra palabra, revisa la ortografía o quita algún filtro para ver más productos."}</p>
    <div className="acts">
      {emptyCatalog ? <Link className="btn btn-primary" href="/armar-pc">Armar mi PC</Link> : <button type="button" className="btn btn-primary" onClick={onClear}>
        Limpiar filtros
      </button>}
    </div>
  </div>
)
