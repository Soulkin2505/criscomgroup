import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { Link, useSearchParams } from "react-router-dom"
import { ArrowLeft, ChevronDown, ChevronRight, Download, FileText, Inbox, Plus, Search } from "lucide-react"
import { toast } from "sonner"
import {
  annulWorkOrder, createWarrantyReentry, getCajaTallerResumen, listWorkOrderParts, listWorkOrderPayments, listWorkOrderQuotes, listWorkOrders,
  updateWorkOrder, type WorkOrder, type WorkOrderCashSummary, type WorkOrderType,
} from "../../services/workOrderService"
import { openWorkOrderDocument, type WorkOrderDocumentKind } from "../../utils/workOrderDocuments"
import { useDocumentTitle } from "../../hooks/useDocumentTitle"
import { todayLima } from "../../components/erp/format"
import { ErpDialog } from "../../components/erp/ErpDialog"
import { ExpedienteView } from "./expedientes/ExpedienteView"
import { EditSheet } from "./expedientes/EditSheet"
import { useExpedienteData } from "./expedientes/tabs"
import { FLOW, I, PRIM, ST, StateChip, checklist, dayNum, errMsg, fd, fin, money, monto, saldo, sgn } from "./expedientes/shared"
import "../../styles/taller-expedientes.css"

const TITLES: Record<WorkOrderType, string> = { servicio_tecnico: "Expedientes técnicos", mantenimiento: "Mantenimientos", armado_pc: "Armado de PCs" }
const CHIPS = ["todos", ...FLOW.slice(0, 7), "entregado", "cancelado"]
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase()
type Dlg = { kind: "anular" | "reingreso" | "estado"; to?: string } | null

function due(o: WorkOrder, hoy: string) {
  if (fin(o)) return { t: o.estado === "entregado" ? `Entregado ${fd(o.fecha_entrega_real)}` : "Cancelado", chip: null as React.ReactNode }
  const e = o.fecha_entrega_estimada ? String(o.fecha_entrega_estimada).slice(0, 10) : ""
  if (!e) return { t: "Sin fecha de entrega", chip: null }
  const d = dayNum(e) - dayNum(hoy)
  if (d < 0) return { t: "", chip: <span className="st bad">Vencida . {fd(e).slice(0, 5)}</span> }
  if (d === 0) return { t: "", chip: <span className="st warn">Vence hoy</span> }
  return { t: `Entrega ${fd(e)}`, chip: null }
}

export default function WorkOrdersPage({ tipo }: { tipo: WorkOrderType }) {
  const title = TITLES[tipo]
  const intakeUrl = `/services/intake?tipo=${tipo}`
  useDocumentTitle(title)
  const hoy = todayLima()
  const [params, setParams] = useSearchParams()
  const [records, setRecords] = useState<WorkOrder[]>([])
  const [status, setStatus] = useState<"load" | "ok" | "error">("load")
  const [cash, setCash] = useState<WorkOrderCashSummary | null>(null)
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("hoy")
  const [cashOpen, setCashOpen] = useState(false)
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState("todos")
  const [tab, setTab] = useState("resumen")
  const [editing, setEditing] = useState(false)
  const [dlg, setDlg] = useState<Dlg>(null)
  const [motivo, setMotivo] = useState("")
  const [busy, setBusy] = useState(false)
  const [mobEx, setMobEx] = useState(false)
  const [width, setWidth] = useState(1200)
  const host = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const el = host.current
    if (!el) return
    const ro = new ResizeObserver(([r]) => setWidth(Math.round(r.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const mob = width < 900

  const load = useCallback(async () => {
    try { setRecords(await listWorkOrders(tipo)); setStatus("ok") } catch { setStatus("error"); toast.error(`No se pudieron cargar las órdenes de ${title.toLowerCase()}`) }
  }, [tipo, title])
  useEffect(() => { setStatus("load"); setFilter("todos"); setQuery(""); void load() }, [load])
  useEffect(() => { getCajaTallerResumen({ periodo }).then(setCash).catch(() => setCash(null)) }, [periodo, records])

  const selParam = Number(params.get("orden")) || null
  const [selState, setSelState] = useState<number | null>(null)
  const selId = selParam ?? selState
  const list = useMemo(() => {
    const q = norm(query.trim())
    return [...records]
      .sort((a, b) => Number(fin(a)) - Number(fin(b)) || (fin(a) ? 0 : String(a.fecha_entrega_estimada || "9999").localeCompare(String(b.fecha_entrega_estimada || "9999"))))
      .filter(o => (filter === "todos" || o.estado === filter) && (!q || norm([o.codigo, o.cliente, o.equipo, o.numero_serie, o.telefono, o.documento].join(" ")).includes(q)))
  }, [records, query, filter])
  const selected = records.find(o => o.id_orden_servicio === selId)
  const visible = !!selected && list.some(o => o.id_orden_servicio === selected.id_orden_servicio)
  useEffect(() => { if (!mob && status === "ok" && !selId && list[0]) setSelState(list[0].id_orden_servicio) }, [mob, status, selId, list])
  useEffect(() => { if (selParam && mob) setMobEx(true) }, [selParam, mob])
  const select = (id: number) => { setSelState(id); setTab("resumen"); setEditing(false); if (selParam) { params.delete("orden"); setParams(params, { replace: true }) } if (mob) setMobEx(true) }

  const { data, refresh: refreshDetail } = useExpedienteData(selected, load)
  const counts = (k: string) => (k === "todos" ? records.length : records.filter(o => o.estado === k).length)

  const changeStatus = async (o: WorkOrder, estado: string) => {
    setBusy(true)
    try { await updateWorkOrder(o.id_orden_servicio, { ...o, estado }); toast.success(`Estado actualizado: ${ST[estado][0]}`); setDlg(null); await refreshDetail() }
    catch (e) { toast.error(errMsg(e, "No se pudo actualizar el estado")) } finally { setBusy(false) }
  }
  const requestStatus = (o: WorkOrder, to: string) => { if (to === "entregado" || to === "cancelado") { setDlg({ kind: "estado", to }) } else void changeStatus(o, to) }
  const openDoc = async (o: WorkOrder, kind: WorkOrderDocumentKind) => {
    try {
      const [parts, payments, quotes] = await Promise.all([listWorkOrderParts(o.id_orden_servicio), listWorkOrderPayments(o.id_orden_servicio), listWorkOrderQuotes(o.id_orden_servicio)])
      openWorkOrderDocument(kind, { order: o, parts, payments, quotes })
    } catch (e) { toast.error((e as Error).message || "No se pudo generar el documento") }
  }
  const anular = async (o: WorkOrder) => {
    setBusy(true)
    try { await annulWorkOrder(o.id_orden_servicio, motivo.trim()); toast.success("Orden anulada y conservada para auditoría"); setDlg(null); setMotivo(""); await refreshDetail() }
    catch (e) { toast.error(errMsg(e, "No se pudo anular la orden")) } finally { setBusy(false) }
  }
  const reingreso = async (o: WorkOrder) => {
    setBusy(true)
    try { const c = await createWarrantyReentry(o.id_orden_servicio, { motivo: motivo.trim() }); toast.success(`Reingreso ${c.codigo} creado y vinculado`); setDlg(null); setMotivo(""); await load(); select(c.id_orden_servicio) }
    catch (e) { toast.error(errMsg(e, "No se pudo crear el reingreso")) } finally { setBusy(false) }
  }
  const exportCsv = () => {
    const rows = records.map(o => [o.codigo, o.cliente, o.telefono, o.equipo, o.numero_serie, o.detalle, ST[o.estado]?.[0], monto(o), o.adelanto, saldo(o), o.fecha_ingreso, o.fecha_entrega_estimada, o.garantia_dias])
    const csv = [["Código", "Cliente", "Teléfono", "Equipo", "Serie", "Detalle", "Estado", "Total", "Adelanto", "Saldo", "Ingreso", "Entrega", "Garantía"], ...rows]
      .map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob(["\ufeff" + csv], { type: "text/csv;charset=utf-8" }))
    a.download = `${tipo}-${hoy}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const k = cash?.monedas?.PEN
  const cajaItems: [string, string, boolean?][] = k ? [
    ["Cobrado", money(k.cobrado)], ["Efectivo", money(k.por_metodo?.efectivo || 0)], ["POS/QR", money((k.por_metodo?.pos || 0) + (k.por_metodo?.qr || 0))],
    ["Costo repuestos", money(k.costo_repuestos)], ["Margen bruto", sgn(k.margen_bruto), k.margen_bruto < 0],
  ] : []
  const caja = k && (
    <>
      {!mob ? (
        <div className="cj1" role="group" aria-label="Caja técnica">
          <span className="cjt" style={{ display: "inline-flex", alignItems: "center", paddingLeft: 12, fontWeight: 600 }}>Caja técnica</span>
          {cajaItems.map(([l, v, neg]) => <span key={l} className={`ci${neg ? " neg" : ""}`}>{l} <b className="num">{v}</b></span>)}
          <div className="seg" role="radiogroup" aria-label="Periodo">
            {(["hoy", "semana", "mes"] as const).map(p => <button type="button" key={p} role="radio" aria-checked={periodo === p} onClick={() => setPeriodo(p)}>{p[0].toUpperCase() + p.slice(1)}</button>)}
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn out" style={{ flex: 1 }} aria-expanded={cashOpen} onClick={() => setCashOpen(o => !o)}>Caja técnica {I(ChevronDown, 16)}</button>
            <button type="button" className="btn out" style={{ flex: 1 }} onClick={exportCsv}>{I(Download, 16)}Exportar CSV</button>
          </div>
          {cashOpen && <div className="cjx">{cajaItems.map(([l, v, neg]) => <span key={l} className={`ci${neg ? " neg" : ""}`}>{l} <b className="num">{v}</b></span>)}</div>}
        </>
      )}
    </>
  )

  const search = (
    <label className="srch"><span className="sr">Buscar por código, cliente, equipo, serie o teléfono</span>{I(Search, 18)}
      <input className="in" type="search" placeholder="Código, cliente, equipo, serie o teléfono" value={query} disabled={status === "load"} onChange={e => setQuery(e.target.value)} /></label>
  )
  const chips = (
    <div className="chips" role="tablist" aria-label="Filtrar por estado">
      {CHIPS.map(c => <button type="button" key={c} className="chip" role="tab" aria-selected={filter === c} onClick={() => setFilter(c)}>{c === "todos" ? "Todos" : c === "listo" ? "Listo" : ST[c][0]} <b>{counts(c)}</b></button>)}
    </div>
  )
  const rowsEl = (() => {
    if (status === "load") return <div className="list" aria-busy="true">{[0, 1, 2, 3, 4, 5, 6, 7].map(i => <div className="rw2" key={i} aria-hidden="true"><span className="rb" style={{ gap: 6 }}><span className="sk" style={{ width: "38%" }} /><span className="sk" style={{ width: "80%" }} /><span className="sk" style={{ width: "55%" }} /></span></div>)}</div>
    if (status === "error") return <div className="list"><div className="empty">{I(Inbox, 28)}<h3>No se pudieron cargar las órdenes</h3><button type="button" className="btn out" onClick={() => { setStatus("load"); void load() }}>Reintentar</button></div></div>
    if (!records.length) return <div className="list"><div className="empty">{I(Inbox, 28)}<h3>Aún no hay órdenes</h3><span>Las órdenes aparecen aquí cuando se registra un ingreso.</span><Link className="btn out" to={intakeUrl}>{I(Plus, 16)}Nuevo ingreso</Link></div></div>
    if (!list.length) return <div className="list"><div className="empty">{I(Search, 28)}<h3>Sin resultados</h3><span>{query ? `Ninguna orden coincide con «${query}»` : "No hay órdenes en este estado"}{filter !== "todos" ? ` en «${ST[filter][0]}»` : ""}.</span><button type="button" className="btn out" onClick={() => { setQuery(""); setFilter("todos") }}>Limpiar filtros</button></div></div>
    let g = false
    return (
      <div className="list" role="listbox" aria-label="Órdenes de servicio">
        {list.map(o => {
          const d = due(o, hoy)
          const head = fin(o) && !g && filter === "todos" ? (g = true, <div className="gh" key={`gh-${o.id_orden_servicio}`}>Cerradas . {list.filter(fin).length}</div>) : null
          return (
            <span key={o.id_orden_servicio} style={{ display: "contents" }}>
              {head}
              <button type="button" className="rw2" role="option" aria-selected={selId === o.id_orden_servicio} onClick={() => select(o.id_orden_servicio)}>
                <span className="rb">
                  <span className="l1"><b>{o.codigo}</b><StateChip estado={o.estado} size={15} /></span>
                  <span className="l2">{o.cliente} . {o.equipo}</span>
                  <span className="l3"><span className="num">Saldo {money(saldo(o))}</span>{d.chip || <span>{d.t}</span>}</span>
                </span>
                {I(ChevronRight, 16, "ch")}
              </button>
            </span>
          )
        })}
      </div>
    )
  })()

  const actions = (o: WorkOrder) => ({
    status: (to: string) => requestStatus(o, to),
    doc: (kind: WorkOrderDocumentKind) => void openDoc(o, kind),
    edit: () => setEditing(true),
    whatsapp: () => window.location.assign(`/erp/services/whatsapp?order=${o.id_orden_servicio}`),
    anular: () => { setMotivo(""); setDlg({ kind: "anular" }) },
    reingreso: () => { setMotivo(""); setDlg({ kind: "reingreso" }) },
  })
  const ex = selected && (
    <ExpedienteView o={selected} data={data} refresh={refreshDetail} tab={tab} setTab={setTab} act={actions(selected)} />
  )
  const placeholder = (t: string) => <section className="ex card"><div className="empty">{I(FileText, 28)}<h3>{t}</h3><span>El expediente aparece aquí.</span></div></section>

  const nuevo = <Link className="btn" to={intakeUrl}>{I(Plus, 16)}Nuevo ingreso</Link>
  const hd = (
    <div className="hd">
      <h1>{title}</h1>
      <div className="ac">
        {!mob && <button type="button" className="btn out" onClick={exportCsv} disabled={!records.length}>{I(Download, 16)}Exportar CSV</button>}
        {nuevo}
      </div>
    </div>
  )

  const exScreen = mob && mobEx && selected
  const fx = !mob || exScreen
  const reserved = data.parts.filter(r => r.estado_stock === "reservado").length
  const ready = selected ? checklist(selected, reserved).filter(x => x.blocks).every(x => x.ok) : false
  const prim = selected ? PRIM[selected.estado] : undefined

  return (
    <div className={`pg-texp${fx ? " fx" : ""}`} ref={host}>
      {editing && selected ? (
        <EditSheet order={selected} onClose={() => setEditing(false)} onSaved={refreshDetail} />
      ) : exScreen ? (
        <>
          <div className="mscr">
            <div className="mtop"><button type="button" className="btn out" onClick={() => setMobEx(false)}>{I(ArrowLeft, 16)}Volver</button><span className="mut">{title}</span></div>
            {ex}
          </div>
          {!fin(selected) && prim && (
            <div className="mbar">
              <button type="button" className="btn out" onClick={() => setTab("pagos")}>Cobrar</button>
              <button type="button" className="btn" aria-disabled={selected.estado === "listo" && !ready} onClick={() => { if (selected.estado !== "listo" || ready) requestStatus(selected, prim[1]) }}>{prim[0]}</button>
            </div>
          )}
        </>
      ) : (
        <div className="pg">
          {hd}
          {caja}
          <div className="md">
            <div className="lc">{search}{chips}{rowsEl}</div>
            {!mob && (status === "load" ? <section className="ex card" aria-busy="true"><div className="exh"><span className="sk" style={{ width: "30%", height: 24 }} /><span className="sk" style={{ width: "70%" }} /></div></section> : visible ? ex : placeholder(records.length ? "Elige una orden" : "Sin órdenes"))}
          </div>
        </div>
      )}

      {selected && dlg?.kind === "anular" && (
        <ErpDialog open onOpenChange={o => { if (!o) setDlg(null) }} title={`Anular orden ${selected.codigo}`}>
          <div className="pg-texp"><div className="dlgi">
            <div className="cons"><b>Qué pasa:</b> la orden se conserva para auditoría («Orden anulada y conservada para auditoría»), deja de poder modificarse y no admite nuevos pagos.<br /><b>Qué no cambia aquí:</b> los pagos ya cobrados ({money(selected.adelanto)}) y los repuestos se gestionan en sus pestañas, cada uno con su motivo.<br /><b>No se puede deshacer.</b></div>
            <label className="fld"><span>Motivo de la anulación <i>*</i></span><textarea className="ta" placeholder="Obligatorio: queda registrado en el historial" value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
            <div className="ft"><button type="button" className="btn out" onClick={() => setDlg(null)}>Cancelar</button><button type="button" className="btn dng" disabled={busy || !motivo.trim()} onClick={() => void anular(selected)}>Anular orden</button></div>
          </div></div>
        </ErpDialog>
      )}
      {selected && dlg?.kind === "reingreso" && (
        <ErpDialog open onOpenChange={o => { if (!o) setDlg(null) }} title={`Reingreso por garantía . ${selected.codigo}`}>
          <div className="pg-texp"><div className="dlgi">
            <div className="cons">Se registrará un reingreso vinculado a <b>{selected.codigo}</b> ({selected.equipo}). La garantía está vigente hasta el <b>{fd(selected.garantia_fin)}</b>. La orden original no cambia: sigue en «Entregado».</div>
            <label className="fld"><span>Motivo del reingreso <i>*</i></span><textarea className="ta" placeholder="Qué falla vuelve a presentar el equipo" value={motivo} onChange={e => setMotivo(e.target.value)} /></label>
            <div className="ft"><button type="button" className="btn out" onClick={() => setDlg(null)}>Cancelar</button><button type="button" className="btn" disabled={busy || !motivo.trim()} onClick={() => void reingreso(selected)}>Registrar reingreso</button></div>
          </div></div>
        </ErpDialog>
      )}
      {selected && dlg?.kind === "estado" && dlg.to && (
        <ErpDialog open onOpenChange={o => { if (!o) setDlg(null) }} title={dlg.to === "entregado" ? `Entregar la orden ${selected.codigo}` : `Cancelar orden ${selected.codigo}`}>
          <div className="pg-texp"><div className="dlgi">
            {dlg.to === "entregado"
              ? <div className="cons">Al entregar se <b>crea la venta contable</b> ({money(monto(selected))}), se <b>clasifica fiscalmente</b> según el DNI / RUC del cliente, los repuestos reservados pasan a <b>consumidos</b> y <b>empieza la garantía</b> de {selected.garantia_dias} días. No se puede deshacer.</div>
              : <div className="cons">La orden pasa a «Cancelado», un estado final: no se podrá volver a avanzar. Los repuestos reservados se devuelven al stock y el cambio queda en el historial.</div>}
            <div className="ft"><button type="button" className="btn out" onClick={() => setDlg(null)}>Volver</button><button type="button" className={`btn${dlg.to === "cancelado" ? " dng" : ""}`} disabled={busy} onClick={() => void changeStatus(selected, dlg.to!)}>{dlg.to === "entregado" ? "Entregar orden" : "Cancelar orden"}</button></div>
          </div></div>
        </ErpDialog>
      )}
    </div>
  )
}
