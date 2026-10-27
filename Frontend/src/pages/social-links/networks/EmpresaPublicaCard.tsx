import { Building2, CircleAlert, Loader, RotateCcw } from "lucide-react"
import { I } from "../shared"
import type { EmpresaPublica } from "./useEmpresaPublica"

// Solo una empresa (RUC) se muestra a la vez en la web: razon social, RUC y direccion en el pie
// de pagina y en /api/ecommerce/config-publica. Si no hay ninguna aun, no hay nada que elegir.
export function EmpresaPublicaCard({ ep }: { ep: EmpresaPublica }) {
  const { empresas, loading, loadError, savingId } = ep

  if (loading) return <section className="card" aria-busy="true"><div className="lc-h"><span className="st neu" role="status">{I(Loader, 16)}Cargando empresas…</span></div></section>
  if (loadError) return (
    <section className="card"><div className="empty" role="alert">
      <div className="dic bad">{I(CircleAlert, 22)}</div>
      <h2>No se pudieron cargar las empresas</h2>
      <p>{loadError}</p>
      <button type="button" className="btn rp" onClick={ep.load}>{I(RotateCcw, 16)}Reintentar</button>
    </div></section>
  )
  if (!empresas.length) return (
    <section className="card" aria-label="RUC público">
      <div className="lc-h"><h2>{I(Building2, 18)}RUC público</h2></div>
      <p className="mut">Aún no hay ninguna empresa registrada en Configuración &gt; Empresa. Registra al menos una (razón social, RUC y dirección) para poder mostrarla en la web.</p>
    </section>
  )

  return (
    <section className="card" aria-label="RUC público">
      <div className="lc-h"><h2>{I(Building2, 18)}RUC público</h2></div>
      <p className="mut">Elige qué empresa muestra su razón social, RUC y dirección en el pie de la página web y en el checkout. Solo una a la vez.</p>
      <div role="radiogroup" aria-label="Empresa que se muestra en la web">
        {empresas.map(c => {
          const checked = Boolean(c.mostrar_en_web)
          const busy = savingId === c.id_company
          return (
            <label key={c.id_company} className="nr" style={{ cursor: "pointer" }}>
              <div className="t">
                <span>
                  <input type="radio" name="empresa_publica" checked={checked} disabled={Boolean(savingId)}
                    onChange={() => ep.elegir(c.id_company)} style={{ marginRight: 8 }} />
                  {c.razon_social} <span className="mut">· RUC {c.ruc}</span>
                </span>
                {busy && <span className="st neu">{I(Loader, 16)}Guardando…</span>}
                {checked && !busy && <span className="st ok">Visible en la web</span>}
              </div>
            </label>
          )
        })}
      </div>
    </section>
  )
}
