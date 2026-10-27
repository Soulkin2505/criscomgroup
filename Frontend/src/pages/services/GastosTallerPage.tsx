import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Link } from "react-router-dom"
import {
  ArrowLeft, ChevronDown, CircleAlert, Download, Loader2, Pencil, Plus, Search, SearchX, Trash2, Wallet, X, ArrowUpRight, type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  createGastoTaller, deleteGastoTaller, listGastosTaller, updateGastoTaller, type CategoriaGasto, type ComprobanteGasto, type GastoTaller,
} from "../../services/gastoTallerService"
import { listWorkOrders, type WorkOrder } from "../../services/workOrderService"
import { useDocumentTitle } from "../../hooks/useDocumentTitle"
import { addDays, norm, todayLima } from "../../components/erp/format"
import "../../styles/taller-gastos.css"

const Q = (s: string) => `\u00ab${s}\u00bb`
const I = (Icon: LucideIcon, size = 16) => <Icon className="ic" size={size} strokeWidth={1.75} aria-hidden="true" />
const CATS: [CategoriaGasto, string, string][] = [
  ["insumos", "Insumos", "Insumos (pasta térmica, alcohol, estaño)"], ["herramientas", "Herramientas", "Herramientas y equipos"],
  ["repuestos_stock", "Repuestos a stock", "Repuestos a stock"], ["alquiler", "Alquiler", "Alquiler del local"],
  ["mano_obra_tercerizada", "Técnico externo", "Mano de obra tercerizada"], ["servicios", "Servicios", "Servicios (luz, agua, internet)"], ["transporte", "Transporte", "Transporte y envíos"],
  ["limpieza", "Limpieza", "Limpieza y mantenimiento"], ["software", "Software", "Software y licencias"],
  ["capacitacion", "Capacitación", "Capacitación del personal"], ["otros", "Otros", "Otros"],
]
const CAT = Object.fromEntries(CATS.map(c => [c[0], c])) as Record<CategoriaGasto, [CategoriaGasto, string, string]>
const PERIODOS: ["hoy" | "semana" | "mes", string][] = [["hoy", "Hoy"], ["semana", "Últimos 7 días"], ["mes", "Mes actual"]]
const PLB = { hoy: "Total de hoy", semana: "Total de los últimos 7 días", mes: "Total del mes" }
const MEDIOS = ["Efectivo", "Yape", "Plin", "Transferencia", "Tarjeta", "Otro"]
const COMP: Record<ComprobanteGasto, string> = { ninguno: "Sin comprobante", boleta: "Boleta", factura: "Factura", recibo: "Recibo", otro: "Otro" }
const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"]
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number | string) => `S/ ${nf.format(Number(n))}`
const dmy = (f: string) => f.split("-").reverse().join("/")
const dayLab = (f: string) => `${DOW[new Date(`${f}T12:00:00Z`).getUTCDay()]} ${dmy(f).slice(0, 5)}`
const sum = (a: GastoTaller[]) => a.reduce((s, g) => s + Number(g.monto || 0), 0)
const plu = (n: number, s: string, p: string) => `${n} ${n === 1 ? s : p}`
const day = (f: string) => String(f).slice(0, 10)

type Form = { monto: string; categoria: CategoriaGasto; descripcion: string; fecha: string; medio_pago: string; proveedor: string; comprobante_tipo: ComprobanteGasto; comprobante_numero: string; orden_servicio_id: number | null; notas: string }
const blank = (): Form => ({ monto: "", categoria: "insumos", descripcion: "", fecha: todayLima(), medio_pago: "Efectivo", proveedor: "", comprobante_tipo: "ninguno", comprobante_numero: "", orden_servicio_id: null, notas: "" })

function Radio<T extends string>({ items, value, onChange, label }: { items: [T, string][]; value: T; onChange: (v: T) => void; label: string }) {
  return (
    <div className="opts" role="radiogroup" aria-label={label}>
      {items.map(([k, l]) => <button type="button" key={k} className="opt" role="radio" aria-checked={value === k} onClick={() => onChange(k)}>{l}</button>)}
    </div>
  )
}

export default function GastosTallerPage() {
  useDocumentTitle("Gastos del taller")
  const hoy = todayLima()
  const [periodo, setPeriodo] = useState<"hoy" | "semana" | "mes">("mes")
  const [records, setRecords] = useState<GastoTaller[]>([])
  const [status, setStatus] = useState<"load" | "ok" | "error">("load")
  const [cat, setCat] = useState<CategoriaGasto | "">("")
  const [panel, setPanel] = useState<{ mode: "new" | "edit"; id?: number } | null>(null)
  const [f, setF] = useState<Form>(blank)
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [open, setOpen] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [del, setDel] = useState<GastoTaller | null>(null)
  const [orders, setOrders] = useState<WorkOrder[]>([])
  const [oq, setOq] = useState("")
  const [mob, setMob] = useState(() => window.innerWidth < 664)
  const montoRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    const on = () => setMob(window.innerWidth < 664)
    window.addEventListener("resize", on)
    return () => window.removeEventListener("resize", on)
  }, [])
  useEffect(() => {
    Promise.all([listWorkOrders("servicio_tecnico"), listWorkOrders("mantenimiento"), listWorkOrders("armado_pc")]).then(([a, b, c]) => setOrders([...a, ...b, ...c])).catch(() => undefined)
  }, [])
  const load = useCallback(() => {
    setStatus("load")
    listGastosTaller({ periodo }).then(r => { setRecords(r); setStatus("ok") }).catch(() => setStatus("error"))
  }, [periodo])
  useEffect(() => { load() }, [load])
  useEffect(() => { setCat("") }, [periodo])
  useEffect(() => {
    if (!panel && !del) return
    const k = (e: KeyboardEvent) => { if (e.key === "Escape") { if (del) setDel(null); else setPanel(null) } }
    document.addEventListener("keydown", k)
    return () => document.removeEventListener("keydown", k)
  }, [panel, del])
  useEffect(() => { if (panel) window.setTimeout(() => montoRef.current?.focus(), 50) }, [panel])

  const sorted = useMemo(() => [...records].sort((a, b) => day(b.fecha).localeCompare(day(a.fecha)) || b.id_gasto - a.id_gasto), [records])
  const list = cat ? sorted.filter(g => g.categoria === cat) : sorted
  const groups = useMemo(() => { const m = new Map<string, GastoTaller[]>(); list.forEach(g => { const k = day(g.fecha); m.set(k, [...(m.get(k) || []), g]) }); return [...m] }, [list])
  const orderCode = (id?: number | null) => orders.find(o => o.id_orden_servicio === id)?.codigo || (id ? `#${id}` : "")
  const chipCats = useMemo(() => {
    const totals = CATS.map(c => [c[0], sum(sorted.filter(g => g.categoria === c[0])), sorted.filter(g => g.categoria === c[0]).length] as const).filter(x => x[2] > 0)
    return totals.sort((a, b) => b[1] - a[1])
  }, [sorted])

  const openNew = () => { setF(blank()); setErrors({}); setOpen([]); setOq(""); setPanel({ mode: "new" }) }
  const openEdit = (g: GastoTaller) => {
    setF({ monto: String(g.monto), categoria: g.categoria, descripcion: g.descripcion, fecha: day(g.fecha), medio_pago: g.medio_pago || "Efectivo", proveedor: g.proveedor || "", comprobante_tipo: g.comprobante_tipo, comprobante_numero: g.comprobante_numero || "", orden_servicio_id: g.orden_servicio_id || null, notas: g.notas || "" })
    setErrors({}); setOq("")
    setOpen([g.proveedor && "proveedor", g.comprobante_tipo !== "ninguno" && "comprobante", g.orden_servicio_id && "orden", g.notas && "notas"].filter(Boolean) as string[])
    setPanel({ mode: "edit", id: g.id_gasto })
  }
  const set = <K extends keyof Form>(k: K, v: Form[K]) => { setF(c => ({ ...c, [k]: v })); setErrors(e => { const n = { ...e }; delete n[k as string]; return n }) }
  const toggle = (k: string) => setOpen(o => (o.includes(k) ? o.filter(x => x !== k) : [...o, k]))

  const save = async () => {
    const e: Record<string, string> = {}
    if (!(Number(f.monto) > 0)) e.monto = "Escribe el monto del gasto"
    if (!f.descripcion.trim()) e.descripcion = "Describe qué se compró o pagó"
    if (Object.keys(e).length) { setErrors(e); return }
    setSaving(true)
    try {
      const payload = { fecha: f.fecha, categoria: f.categoria, descripcion: f.descripcion.trim(), monto: f.monto, medio_pago: f.medio_pago, proveedor: f.proveedor.trim(), comprobante_tipo: f.comprobante_tipo, comprobante_numero: f.comprobante_numero.trim(), orden_servicio_id: f.orden_servicio_id, notas: f.notas.trim() }
      if (panel?.mode === "edit" && panel.id) await updateGastoTaller(panel.id, payload); else await createGastoTaller(payload)
      toast.success(panel?.mode === "edit" ? "Gasto actualizado" : "Gasto registrado")
      setPanel(null); load()
    } catch (er) { toast.error((er as { response?: { data?: { message?: string } } }).response?.data?.message || "No se pudo guardar el gasto") } finally { setSaving(false) }
  }
  const remove = async () => {
    if (!del) return
    try { await deleteGastoTaller(del.id_gasto); toast.success("Gasto eliminado"); setDel(null); setPanel(null); load() }
    catch (er) { toast.error((er as { response?: { data?: { message?: string } } }).response?.data?.message || "No se pudo eliminar") }
  }
  const exportCsv = () => {
    const rows = records.map(g => [day(g.fecha), CAT[g.categoria]?.[1] || g.categoria, g.descripcion, g.monto, g.medio_pago || "", g.proveedor || "", g.comprobante_tipo, g.comprobante_numero || "", g.orden_servicio_id || "", g.notas || ""])
    const csv = [["Fecha", "Categoría", "Descripción", "Monto", "Medio de pago", "Proveedor", "Comprobante", "Número", "Orden", "Notas"], ...rows].map(r => r.map(v => `"${String(v ?? "").replace(/"/g, '""')}"`).join(",")).join("\n")
    const a = document.createElement("a")
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }))
    a.download = `gastos-taller-${hoy}.csv`; a.click(); URL.revokeObjectURL(a.href)
  }

  const acts = (g: GastoTaller) => (
    <>
      <button type="button" className="btn out sq" aria-label={`Editar gasto ${Q(g.descripcion)}`} onClick={() => openEdit(g)}>{I(Pencil)}</button>
      <button type="button" className="btn out sq" aria-label={`Eliminar gasto ${Q(g.descripcion)}`} onClick={() => setDel(g)}>{I(Trash2)}</button>
    </>
  )
  const ordLink = (g: GastoTaller) => g.orden_servicio_id ? <Link className="ord" to={`/services/technical?orden=${g.orden_servicio_id}`}>{I(ArrowUpRight, 14)}Orden {orderCode(g.orden_servicio_id)}</Link> : null
  const empty = (Icon: LucideIcon, h: string, p: string, btn?: React.ReactNode, cls = "") => <div className={`card empty ${cls}`}><div className="ico">{I(Icon, 22)}</div><h3>{h}</h3><p>{p}</p>{btn}</div>

  const total = sum(records)
  const medios = MEDIOS.includes(f.medio_pago) ? MEDIOS : [...MEDIOS, f.medio_pago]
  const oRes = oq.trim() ? orders.filter(o => norm(`${o.codigo} ${o.cliente} ${o.equipo}`).includes(norm(oq))).slice(0, 6) : []
  const nerr = Object.keys(errors).length
  const pl = (k: string, tit: string, sm: string, body: React.ReactNode) => (
    <details open={open.includes(k)} onToggle={e => { const o = (e.target as HTMLDetailsElement).open; if (o !== open.includes(k)) toggle(k) }}>
      <summary>{I(ChevronDown, 16)}<span>{tit}</span><span className="sm">{sm}</span></summary><div className="bd">{body}</div>
    </details>
  )

  return (
    <div className="pg-tgas">
      <div className="pg">
        <div className="hd">
          <h1>Gastos del taller</h1>
          <div className="ac">
            {mob ? <button type="button" className="btn out sq" aria-label="Exportar CSV" disabled={!records.length} onClick={exportCsv}>{I(Download)}</button>
              : <button type="button" className="btn out" disabled={!records.length} onClick={exportCsv}>{I(Download)}Exportar CSV</button>}
            <button type="button" className="btn pri" onClick={openNew}>{I(Plus)}Registrar gasto</button>
          </div>
        </div>

        <div className="tb">
          <div className="tot"><span className="k">{PLB[periodo]}</span><div className="v"><b className="num">{status === "ok" ? money(total) : "-"}</b>{status === "ok" && <span className="n">{plu(records.length, "gasto", "gastos")}</span>}</div></div>
          <div className="segp" role="radiogroup" aria-label="Periodo">
            {PERIODOS.map(([k, l]) => <button type="button" key={k} role="radio" aria-checked={periodo === k} onClick={() => setPeriodo(k)}>{l}</button>)}
          </div>
        </div>

        {status === "load" && (
          <div className="card" aria-busy="true">
            <div className="ld" role="status">{I(Loader2)}Cargando gastos...</div>
            <div className="sk">{Array.from({ length: mob ? 5 : 8 }).map((_, i) => <div className="row" key={i}><i style={{ width: 80 }} /><i style={{ width: 90 }} /><i style={{ flex: 1, maxWidth: 340 }} /><i style={{ width: 120 }} /></div>)}</div>
          </div>
        )}
        {status === "error" && empty(CircleAlert, "No pudimos cargar los gastos", "Revisa tu conexión e inténtalo de nuevo. Tus gastos registrados no se han modificado.", <button type="button" className="btn" onClick={load}>Reintentar</button>, "bad")}
        {status === "ok" && !records.length && empty(Wallet, "Aún no hay gastos en este periodo", "Cuando registres el primero, aparecerá aquí y bajará la ganancia estimada de la Caja del taller.", <button type="button" className="btn out" onClick={openNew}>{I(Plus)}Registrar gasto</button>)}
        {status === "ok" && records.length > 0 && (
          <>
            <div className="chips" role="tablist" aria-label="Categoría">
              <button type="button" className="chip" role="tab" aria-selected={cat === ""} onClick={() => setCat("")}><span className="a">Todas</span><span className="b">{money(total)} . {records.length}</span></button>
              {chipCats.map(([c, t, n]) => <button type="button" key={c} className="chip" role="tab" aria-selected={cat === c} onClick={() => setCat(c)}><span className="a">{CAT[c][1]}</span><span className="b">{money(t)} . {n}</span></button>)}
            </div>
            {!list.length ? empty(SearchX, `Sin gastos de ${Q(CAT[cat as CategoriaGasto]?.[1] || "")} en este periodo`, "Prueba con otra categoría o vuelve a ver todas.", <button type="button" className="btn out" onClick={() => setCat("")}>Ver todas las categorías</button>)
              : mob ? (
                <div className="gcs">
                  {groups.map(([d, arr]) => (
                    <section key={d}>
                      <div className="dgh"><b>{dayLab(d)}{d === hoy ? " . Hoy" : ""}</b>{arr.length > 1 && <span className="num">Subtotal {money(sum(arr))}</span>}</div>
                      {arr.map(g => (
                        <article className="card gc" key={g.id_gasto}>
                          <div>
                            <div className="t"><span>{g.descripcion}</span><b className="num">{money(g.monto)}</b></div>
                            <div className="m"><span className="tag">{CAT[g.categoria]?.[1]}</span><span>{g.medio_pago}</span>{g.comprobante_tipo === "ninguno" ? <span>Sin comprobante</span> : <span className="num">{COMP[g.comprobante_tipo]} {g.comprobante_numero}</span>}</div>
                            {g.proveedor && <div className="p">{g.proveedor}</div>}{g.orden_servicio_id ? <div>{ordLink(g)}</div> : null}
                          </div>
                          <div className="ra">{acts(g)}</div>
                        </article>
                      ))}
                    </section>
                  ))}
                </div>
              ) : (
                <div className="card lst">
                  <table className="tbl">
                    <caption className="sr">Gastos registrados, agrupados por día</caption>
                    <colgroup><col className="c1" /><col className="c2" /><col /><col className="c4" /><col className="c5" /><col className="c6" /><col className="c7" /></colgroup>
                    <thead><tr><th scope="col">Fecha</th><th scope="col">Categoría</th><th scope="col">Descripción</th><th scope="col">Proveedor</th><th scope="col">Comprobante</th><th scope="col" className="r">Monto</th><th scope="col"><span className="sr">Acciones</span></th></tr></thead>
                    {groups.map(([d, arr]) => (
                      <tbody key={d}>
                        {arr.map((g, i) => (
                          <tr key={g.id_gasto}>
                            {i === 0 && <th scope="rowgroup" rowSpan={arr.length} className="day"><b>{dayLab(d)}</b>{d === hoy && <span>Hoy</span>}{arr.length > 1 && <span className="num">Subtotal {money(sum(arr))}</span>}</th>}
                            <td><span className="tag">{CAT[g.categoria]?.[1]}</span></td>
                            <td className="ds"><div className="a">{g.descripcion}</div>{ordLink(g)}</td>
                            <td>{g.proveedor || <span className="mut" aria-label="Sin proveedor">-</span>}</td>
                            <td>{g.comprobante_tipo === "ninguno" ? <span className="mut">{COMP.ninguno}</span> : <><div className="a">{COMP[g.comprobante_tipo]}</div><div className="b num">{g.comprobante_numero}</div></>}</td>
                            <td className="r"><div className="a num">{money(g.monto)}</div><div className="b">{g.medio_pago}</div></td>
                            <td><div className="acc">{acts(g)}</div></td>
                          </tr>
                        ))}
                      </tbody>
                    ))}
                  </table>
                </div>
              )}
          </>
        )}
      </div>

      {panel && (
        <>
          <div className="scrim" onClick={() => setPanel(null)} />
          <aside className={`pnl${mob ? " sheet" : ""}`} role="dialog" aria-modal="true" aria-labelledby="pt">
            <div className="ph">
              {mob && <button type="button" className="btn out sq" style={{ border: 0 }} aria-label="Cerrar" onClick={() => setPanel(null)}>{I(ArrowLeft, 20)}</button>}
              <h2 id="pt" style={mob ? { flex: 1, marginLeft: 4 } : undefined}>{panel.mode === "edit" ? "Editar gasto" : "Registrar gasto"}</h2>
              {!mob && <button type="button" className="btn out sq" style={{ border: 0 }} aria-label="Cerrar panel" onClick={() => setPanel(null)}>{I(X, 20)}</button>}
            </div>
            <div className="pb">
              <div className="fld">
                <label className="l" htmlFor="f-monto">Monto (S/) <i aria-hidden="true">*</i></label>
                <div className="mw"><span className="pre" aria-hidden="true">S/</span>
                  <input id="f-monto" ref={montoRef} className="in big num" inputMode="decimal" autoComplete="off" required placeholder="0.00" value={f.monto}
                    aria-invalid={!!errors.monto} aria-describedby={errors.monto ? "e-monto" : undefined} onChange={e => set("monto", e.target.value.replace(/[^\d.]/g, ""))} /></div>
                {errors.monto && <div className="why" id="e-monto" role="alert">{I(CircleAlert)}<span>{errors.monto}</span></div>}
              </div>
              <div className="fld"><span className="l">Categoría</span>
                <Radio label="Categoría" value={f.categoria} onChange={v => set("categoria", v)} items={CATS.map(c => [c[0], c[1]] as [CategoriaGasto, string])} />
                <div className="hint">{CAT[f.categoria][2]}</div>
              </div>
              <div className="fld">
                <label className="l" htmlFor="f-desc">Descripción del gasto <i aria-hidden="true">*</i></label>
                <input id="f-desc" className="in" maxLength={200} required placeholder="Qué se compró o pagó" value={f.descripcion} aria-invalid={!!errors.descripcion}
                  aria-describedby={errors.descripcion ? "e-desc" : undefined} onChange={e => set("descripcion", e.target.value)} />
                {errors.descripcion && <div className="why" id="e-desc" role="alert">{I(CircleAlert)}<span>{errors.descripcion}</span></div>}
              </div>
              <div className="fld"><label className="l" htmlFor="f-fecha">Fecha</label>
                <div className="fr"><input id="f-fecha" className="in num" type="date" max={addDays(hoy, 1)} value={f.fecha} onChange={e => set("fecha", e.target.value || todayLima())} />
                  <span className="hint">{f.fecha === hoy ? "Hoy . hora de Lima" : dayLab(f.fecha)}</span></div></div>
              <div className="fld"><span className="l">Medio de pago</span>
                <Radio label="Medio de pago" value={f.medio_pago} onChange={v => set("medio_pago", v)} items={medios.map(m => [m, m] as [string, string])} /></div>
              <div className="pls">
                {pl("proveedor", "Proveedor", f.proveedor || "Opcional", <label className="fld"><span className="l">Proveedor</span><input className="in" maxLength={160} value={f.proveedor} onChange={e => set("proveedor", e.target.value)} /></label>)}
                {pl("comprobante", "Comprobante", f.comprobante_tipo !== "ninguno" ? `${COMP[f.comprobante_tipo]} ${f.comprobante_numero}` : "Sin comprobante",
                  <><div className="fld"><span className="l">Tipo de comprobante</span><Radio label="Tipo de comprobante" value={f.comprobante_tipo} onChange={v => set("comprobante_tipo", v)} items={Object.entries(COMP) as [ComprobanteGasto, string][]} /></div>
                    <label className="fld"><span className="l">N.º de comprobante</span><input className="in num" maxLength={60} value={f.comprobante_numero} onChange={e => set("comprobante_numero", e.target.value)} /></label></>)}
                {pl("orden", "Orden imputada", f.orden_servicio_id ? orderCode(f.orden_servicio_id) : "Opcional",
                  <div className="fld"><span className="l">Orden imputada</span>
                    {f.orden_servicio_id ? (
                      <div className="sel"><span className="num">{orderCode(f.orden_servicio_id)}</span><button type="button" className="btn sq" aria-label={`Quitar la orden ${orderCode(f.orden_servicio_id)}`} onClick={() => set("orden_servicio_id", null)}>{I(X)}</button></div>
                    ) : (
                      <>
                        <div className="srch">{I(Search)}<input className="in" role="combobox" aria-expanded={oRes.length > 0} aria-label="Orden imputada" placeholder="Código de la orden" value={oq} onChange={e => setOq(e.target.value)} /></div>
                        {oRes.length > 0 && <div className="opts" style={{ flexDirection: "column", alignItems: "stretch" }}>{oRes.map(o => <button type="button" key={o.id_orden_servicio} className="opt" style={{ justifyContent: "flex-start" }} onClick={() => { set("orden_servicio_id", o.id_orden_servicio); setOq("") }}><b>{o.codigo}</b>&nbsp;. {o.cliente} . {o.equipo}</button>)}</div>}
                      </>
                    )}
                    <div className="hint">Busca por código: ST-..., MT-... o PC-...</div></div>)}
                {pl("notas", "Notas", f.notas ? `${f.notas.slice(0, 30)}...` : "Opcional", <label className="fld"><span className="l">Notas</span><textarea className="ta" value={f.notas} onChange={e => set("notas", e.target.value)} /></label>)}
              </div>
            </div>
            <div className="pf">
              {nerr > 0 && <div className="why" role="alert">{I(CircleAlert)}<span>Faltan {nerr} {nerr === 1 ? "campo obligatorio" : "campos obligatorios"}</span></div>}
              {panel.mode === "edit" && (() => { const g = records.find(x => x.id_gasto === panel.id); return g ? <button type="button" className="btn out dz" style={{ marginRight: "auto" }} onClick={() => setDel(g)}>{I(Trash2)}Eliminar gasto</button> : null })()}
              {!(mob && panel.mode === "new") && <button type="button" className="btn out" onClick={() => setPanel(null)}>Cancelar</button>}
              <button type="button" className="btn" disabled={saving} onClick={() => void save()}>{saving ? "Guardando..." : panel.mode === "edit" ? "Guardar cambios" : "Guardar gasto"}</button>
            </div>
          </aside>
        </>
      )}

      {del && (
        <>
          <div className="scrim" style={{ zIndex: 80 }} />
          <div className="dlgw" style={{ zIndex: 81 }}>
            <div className="dlg" role="alertdialog" aria-labelledby="dt" aria-describedby="dd">
              <h3 id="dt">Eliminar gasto</h3>
              <p id="dd">Vas a eliminar {Q(del.descripcion)} por <b className="num">{money(del.monto)}</b>, registrado el {dmy(day(del.fecha))}.</p>
              <div className="cons"><b>Qué cambia:</b> el gasto sale de la lista y la Caja del taller se recalcula: los gastos del periodo bajan de {money(total)} a {money(total - Number(del.monto))} y la ganancia estimada sube {money(del.monto)}.{del.orden_servicio_id ? ` También deja de contar en el costo de la orden ${orderCode(del.orden_servicio_id)}.` : ""} Esta acción no se puede deshacer.</div>
              <div className="ft"><button type="button" className="btn out" autoFocus onClick={() => setDel(null)}>Cancelar</button><button type="button" className="btn dng" onClick={() => void remove()}>Eliminar gasto</button></div>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
