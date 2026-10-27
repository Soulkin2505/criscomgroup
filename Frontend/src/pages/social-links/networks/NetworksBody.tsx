import { CircleAlert, Loader, RotateCcw } from "lucide-react"
import { I } from "../shared"
import { EmpresaPublicaCard } from "./EmpresaPublicaCard"
import { NetPreview } from "./NetPreview"
import { NetRow } from "./NetRow"
import { NET } from "./netCheck"
import { useEmpresaPublica } from "./useEmpresaPublica"
import type { Networks } from "./useNetworks"

export function NetworksBody({ nw }: { nw: Networks }) {
  const { links, loading, loadError } = nw
  const ep = useEmpresaPublica()
  const form = loading
    ? <section className="card" aria-busy="true"><div className="lc-h"><span className="st neu" role="status">{I(Loader, 16)}Cargando configuración…</span></div></section>
    : loadError
      ? <section className="card"><div className="empty" role="alert">
          <div className="dic bad">{I(CircleAlert, 22)}</div>
          <h2>No se pudieron cargar las redes</h2>
          <p>{loadError}. No se puede guardar para no pisar los enlaces actuales. Vuelve a intentarlo.</p>
          <button type="button" className="btn rp" onClick={nw.load}>{I(RotateCcw, 16)}Reintentar</button>
        </div></section>
      : <section className="card" aria-label="Redes oficiales">{NET.map(n => <NetRow key={n.k} n={n} value={links[n.k]} disabled={nw.saving} onChange={v => nw.set(n.k, v)} />)}</section>
  return <div className="rd">{form}<EmpresaPublicaCard ep={ep} />{!loading && !loadError ? <NetPreview links={links} /> : <aside className="card pv"><h2>Así se verá en la web</h2><div className="ftr"><span className="mut">Sin datos: la carga de redes no terminó.</span></div></aside>}</div>
}
