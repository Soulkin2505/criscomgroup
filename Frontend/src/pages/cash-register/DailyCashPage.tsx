"use client"

import "../../styles/caja.css"
import { useMemo, useState } from "react"
import { useMutation, useQueries, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "react-router-dom"
import { toast } from "sonner"
import { Calculator, Calendar, ChevronLeft, ChevronRight, CircleArrowDown, CircleArrowUp, CircleCheck, Clock, Info, Lock, LockOpen, Plus, RefreshCw, ShoppingCart, TriangleAlert, User, type LucideIcon } from "lucide-react"
import { useAuth } from "../../contexts/AuthContext"
import { useBusinessHours } from "../../hooks/useBusinessHours"
import { useDocumentTitle } from "../../hooks/useDocumentTitle"
import { ErpDialog } from "../../components/erp/ErpDialog"
import { addDays, dateTimeLima, limaDate, longDate, money, saleAmount, todayLima, weekdayOf } from "../../components/erp/format"
import { obtenerResumenDiario, actualizarCierreCaja, obtenerTodosLosCierresCaja, registrarCierreCaja } from "../../services/cierreCajaService"
import { fetchSaleById, fetchSales, type Sale } from "../../services/saleService"
import { fetchUserBasicInfo } from "../../services/userService"

const stroke = { strokeWidth: 1.75, "aria-hidden": true } as const
const DOW = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"]
const r2 = (n: number) => Math.round(n * 100) / 100
const plural = (n: number, a: string, b: string) => `${n} ${n === 1 ? a : b}`
const dow = (iso: string, short?: boolean) => { const w = DOW[new Date(`${iso}T12:00:00Z`).getUTCDay()]; return short ? w.slice(0, 3) : w }
const pct = (v: number, t: number) => (t > 0 ? Math.round((v / t) * 1000) / 10 : 0)
const hm = (iso: string) => dateTimeLima(iso).split(" ").slice(1).join(" ")
const METHODS = ["efectivo", "tarjeta", "yape", "plin", "transferencia", "pago_link", "qr", "otro"] as const

interface Closing { id_cierre: number; fecha_apertura: string; fecha_cierre?: string | null; cajero_id: number; saldo_efectivo: string | number; total_efectivo: string | number; total_tarjeta: string | number; total_transferencia: string | number; total_yape: string | number; total_plin: string | number; cantidad_ventas: number; estado: "abierto" | "cerrado"; observaciones?: string | null }
const n = (v: unknown) => Number(v) || 0

function diff(expected: number, counted: number | null) {
  if (counted == null) return { k: "na" as const }
  const d = r2(counted - expected)
  if (Math.abs(d) < 0.01) return { k: "ok" as const, d: 0, w: "Cuadrado", i: CircleCheck as LucideIcon, v: money(0) }
  if (d > 0) return { k: "up" as const, d, w: `Sobra ${money(d)}`, i: CircleArrowUp as LucideIcon, v: `+ ${money(d)}` }
  return { k: "dn" as const, d, w: `Falta ${money(-d)}`, i: CircleArrowDown as LucideIcon, v: `− ${money(-d)}` }
}
const Bar = ({ p }: { p: number }) => <svg className="bar" width="100%" height="6" aria-hidden="true"><rect width="100%" height="6" rx="3" fill="hsl(var(--border-strong))" opacity="0.55" /><rect width={`${p}%`} height="6" rx="3" fill="hsl(var(--primary))" /></svg>
const NoDetail = ({ text }: { text: string }) => <div className="empty"><div className="ei"><Info size={22} {...stroke} /></div><p>{text}</p></div>
const TABS = ["Resumen", "Productos", "Cajeros", "Historial de cierres"] as const
const DENOMS = [200, 100, 50, 20, 10, 5, 2, 1, 0.5, 0.2, 0.1]

export default function DailyCashPage() {
  useDocumentTitle("Caja diaria")
  const { user } = useAuth()
  const role = user?.id_role ?? 3
  const { isWithinBusinessHours, businessHoursMessage } = useBusinessHours()
  const queryClient = useQueryClient()
  const today = todayLima()
  const [day, setDay] = useState(today)
  const [tab, setTab] = useState<(typeof TABS)[number]>("Resumen")
  const [raw, setRaw] = useState("")
  const [obs, setObs] = useState("")
  const [editing, setEditing] = useState(false)
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [countOpen, setCountOpen] = useState(false)
  const [counts, setCounts] = useState<Record<number, string>>({})
  const [from, setFrom] = useState(`${today.slice(0, 8)}01`)
  const [to, setTo] = useState(today)

  const { data: sales, isLoading: loadingSales, refetch: refetchSales } = useQuery({ queryKey: ["sales"], queryFn: fetchSales })
  const { data: closings = [], refetch: refetchClosings } = useQuery({ queryKey: ["cierres-caja"], queryFn: obtenerTodosLosCierresCaja as () => Promise<Closing[]> })

  const { data: result, isLoading: loadingResult, isError: resultError, refetch: refetchResult } = useQuery({ queryKey: ['daily-result', day], queryFn: () => obtenerResumenDiario(day) });
  const daySales = useMemo(() => (sales ?? []).filter(s => limaDate(s.fecha) === day && !(s as Sale & { orden_servicio_id?: number }).orden_servicio_id).sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime()), [sales, day])
  const closing = closings.find(c => String(c.fecha_apertura).startsWith(day)) ?? null
  const closed = closing?.estado === "cerrado"

  const detailQueries = useQueries({ queries: daySales.map(s => ({ queryKey: ["sale", String(s.venta_id)], queryFn: () => fetchSaleById(s.venta_id), staleTime: 60_000 })) })
  const details = detailQueries.map(q => q.data).filter(Boolean) as Sale[]
  const cashierIds = useMemo(() => [...new Set(daySales.map(s => s.id_cajero))], [daySales])
  const cashierQueries = useQueries({ queries: cashierIds.map(id => ({ queryKey: ["user", id], queryFn: () => fetchUserBasicInfo(id), staleTime: 300_000, retry: 1 })) })
  const cashierName = (id: number) => cashierQueries[cashierIds.indexOf(id)]?.data?.name ?? `Cajero #${id}`

  const sum = useMemo(() => {
    const pm: Record<string, [number, number]> = Object.fromEntries(METHODS.map(m => [m, [0, 0]]))
    let discount = 0, nDiscount = 0
    for (const s of daySales) {
      const m = String(s.metodo_pago).toLowerCase(); const key = pm[m] ? m : "otro"
      pm[key][0] = r2(pm[key][0] + saleAmount(s)); pm[key][1] += 1
      if (s.es_descuento && s.descuento) { discount += Number(s.descuento); nDiscount += 1 }
    }
    const directTotal = r2(daySales.reduce((a, s) => a + saleAmount(s), 0))
    if (result) for (const [key, bucket] of Object.entries(result.por_metodo)) pm[key] = [bucket.total, bucket.cantidad];
    const total = result?.cobrado ?? directTotal;
    return { pm, total, directTotal, count: Object.values(pm).reduce((a, b) => a + b[1], 0), ticket: daySales.length ? r2(directTotal / daySales.length) : null, discount: r2(discount), nDiscount, cash: pm.efectivo }
  }, [daySales, result])

  const products = useMemo(() => {
    const map = new Map<string, { p: string; u: number; t: number; may: boolean }>()
    for (const s of details) for (const d of s.detalles ?? []) {
      const name = (d as { producto?: { nombre?: string } }).producto?.nombre ?? `Producto #${d.producto_id}`
      const may = !!d.es_venta_mayorista, key = `${name}|${may}`
      const cur = map.get(key) ?? { p: name, u: 0, t: 0, may }
      cur.u += d.cantidad; cur.t += Number(d.subtotal_con_igv); map.set(key, cur)
    }
    return [...map.values()].sort((a, b) => b.u - a.u)
  }, [details])
  const cashiers = useMemo(() => cashierIds.map(id => { const own = daySales.filter(s => s.id_cajero === id); return { id, ventas: r2(own.reduce((a, s) => a + saleAmount(s), 0)), tr: own.length } }), [daySales, cashierIds])

  // ---- cuadre ----
  const expected = closed ? n(closing?.total_efectivo) : result?.efectivo_neto ?? 0
  const counted = closed && !editing ? n(closing?.saldo_efectivo) : raw === "" ? null : Number(raw.replace(/,/g, ""))
  const df = diff(expected, Number.isFinite(counted as number) ? counted : null)
  const hasSales = sum.count > 0 || (result?.egresos_efectivo ?? 0) > 0
  const offHours = role === 3 && !isWithinBusinessHours
  const why = resultError || loadingResult ? "Espera a que se cargue el resumen de caja" : closed && !editing ? (offHours ? "Fuera de horario laboral: no se puede corregir el cierre" : "")
    : offHours ? `Fuera de horario laboral · ${businessHoursMessage}` : !hasSales && !editing ? "Sin ventas: no hay nada que cerrar" : counted == null ? "Digita el efectivo contado" : ""
  const reviewObs = !closed || editing ? df.k === "up" || df.k === "dn" : false

  const save = useMutation({
    mutationFn: async () => {
      const body = {
        saldo_efectivo: counted ?? 0, total_efectivo: sum.pm.efectivo[0], total_tarjeta: sum.pm.tarjeta[0], total_transferencia: sum.pm.transferencia[0], total_yape: sum.pm.yape[0], total_plin: sum.pm.plin[0],
        cantidad_ventas: sum.count, estado: "cerrado", observaciones: obs || (closing?.observaciones ?? undefined), fecha_cierre: new Date().toISOString(),
      }
      if (closing) return actualizarCierreCaja(closing.id_cierre, body)
      return registrarCierreCaja({ fecha_apertura: `${day}T00:00:00-05:00`, cajero_id: Number(user?.id) || daySales[0]?.id_cajero || 1, ...body, fecha_cierre: `${addDays(day, 1)}T00:00:00-05:00`, observaciones: obs || undefined })
    },
    onSuccess: () => { toast.success(editing ? "Cierre corregido" : "Caja cerrada correctamente"); setConfirmOpen(false); setEditing(false); setRaw(""); setObs(""); void refetchClosings() },
    onError: () => toast.error("No se pudo registrar el cierre de caja"),
  })

  const goDay = (d: string) => { setDay(d); setRaw(""); setObs(""); setEditing(false) }
  const refresh = () => { void refetchResult(); void refetchSales(); void refetchClosings(); void queryClient.invalidateQueries({ queryKey: ["sale"] }) }
  const ro = closed && !editing

  const act = (() => {
    const disabled = !!why
    if (ro) return { btn: <button type="button" className="btn out lg" aria-disabled={disabled || undefined} aria-describedby={disabled ? "why-caja" : undefined} onClick={() => { if (!disabled) { setEditing(true); setRaw(String(n(closing?.saldo_efectivo))); setObs(closing?.observaciones ?? "") } }}>Corregir cierre</button> }
    return { btn: <button type="button" className="btn lg" aria-disabled={disabled || undefined} aria-describedby={disabled ? "why-caja" : undefined} onClick={() => { if (!disabled) setConfirmOpen(true) }}>{editing ? "Guardar corrección" : "Cerrar caja"}</button> }
  })()
  const whyEl = why ? <span className="why" id="why-caja"><Info size={14} {...stroke} /><span>{why}</span></span> : null
  const value = ro ? n(closing?.saldo_efectivo).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : raw

  const isToday = day === today
  const { data: closer } = useQuery({ queryKey: ["user", closing?.cajero_id], queryFn: () => fetchUserBasicInfo(closing!.cajero_id), enabled: !!closing, staleTime: 300_000, retry: 1 })
  const closedAtLabel = closing?.fecha_cierre ? `${dateTimeLima(String(closing.fecha_cierre)).split(" ")[0]} a las ${hm(String(closing.fecha_cierre))}` : ""

  // ---- historial ----
  const histRows = closings.filter(c => { const d = String(c.fecha_apertura).slice(0, 10); return (!from || d >= from) && (!to || d <= to) }).sort((a, b) => String(b.fecha_apertura).localeCompare(String(a.fecha_apertura)))
  const histDiff = (c: Closing) => (c.estado === "abierto" ? null : diff(n(c.total_efectivo), n(c.saldo_efectivo)))
  const DiffChip = ({ c }: { c: Closing }) => { const x = histDiff(c); return x && x.k !== "na" ? <span className={`st ${x.k}`}><x.i size={14} {...stroke} />{x.w}</span> : <span className="st neu"><Clock size={14} {...stroke} />En curso</span> }

  const methodRow = (label: string, key: string) => {
    const [amount, count] = sum.pm[key]
    return <li key={key} className="pm"><span className="n">{label}<span className="tag">{plural(count, "cobro", "cobros")}</span></span><span className="p num">{pct(amount, sum.total)}%</span><span className="m num">{money(amount)}</span><Bar p={pct(amount, sum.total)} /></li>
  }
  const digital = r2(sum.pm.tarjeta[0] + sum.pm.transferencia[0] + sum.pm.yape[0] + sum.pm.plin[0] + sum.pm.pago_link[0] + sum.pm.qr[0] + sum.pm.otro[0])
  const unitsTotal = products.reduce((a, p) => a + p.u, 0), minU = products.filter(p => !p.may).reduce((a, p) => a + p.u, 0)

  const docName = (s: Sale) => (s.tipo_documento === "3" ? "Boleta" : s.tipo_documento === "1" ? "Factura" : "Nota de venta")
  const docNo = (s: Sale) => (s.serie && s.correlativo ? `${s.serie}-${String(s.correlativo).padStart(8, "0")}` : `#${s.venta_id}`)
  const METHOD_LABEL: Record<string, string> = { efectivo: "Efectivo", tarjeta: "Tarjeta", yape: "Yape", plin: "Plin", transferencia: "Transferencia" }

  const salesCard = !hasSales ? (
    <section className="card p0"><div className="ch"><h2>Ventas del día</h2></div>
      {closed ? <><NoDetail text="El cierre guarda totales, no el detalle de cada venta. Revísalas en el Historial de ventas." /><div className="mfoot"><Link className="lnk" to="/sales" style={{ margin: "-7px 0" }}>Ver ventas del {longDate(day)} <ChevronRight size={16} {...stroke} /></Link></div></>
        : <div className="empty"><div className="ei"><ShoppingCart size={22} {...stroke} /></div><h3>No hay ventas el {dow(day)} {longDate(day)}</h3><p>Las ventas del día aparecerán aquí en cuanto se registren.</p><Link className="btn" to="/sales/new"><Plus size={16} {...stroke} />Nueva venta</Link></div>}
    </section>
  ) : (
    <section className="card p0">
      <div className="ch"><h2>Ventas del día</h2><Link className="lnk" to="/sales" style={{ margin: "-7px 0" }}>Historial de ventas <ChevronRight size={16} {...stroke} /></Link></div>
      <table className="tbl erp-only-desk"><colgroup><col style={{ width: "27%" }} /><col style={{ width: "15%" }} /><col style={{ width: "16%" }} /><col style={{ width: "27%" }} /><col style={{ width: "15%" }} /></colgroup>
        <thead><tr><th>Documento</th><th>Hora</th><th>Método</th><th className="r">Importe</th><th className="r"><span className="sr">Detalle</span></th></tr></thead>
        <tbody>{daySales.map(s => <tr key={s.venta_id}><td><span className="two"><b>{docNo(s)}</b><small>{docName(s)}</small></span></td><td className="num">{hm(s.fecha)}</td><td><span className="tag">{METHOD_LABEL[s.metodo_pago] ?? s.metodo_pago}</span></td><td className="r"><span className="two"><b>{money(saleAmount(s))}</b>{s.es_descuento && s.descuento ? <small>− {money(Number(s.descuento))} dscto.</small> : null}</span></td><td className="r"><Link className="vr" to={`/sales/${s.venta_id}`} aria-label={`Ver detalle de ${docNo(s)}`}>Ver <ChevronRight size={16} {...stroke} /></Link></td></tr>)}</tbody></table>
      <div className="erp-only-mob">{daySales.map(s => <Link key={s.venta_id} className="rw" to={`/sales/${s.venta_id}`}><span className="a">{docNo(s)}<span className="sub">{docName(s)} · {hm(s.fecha)} · {METHOD_LABEL[s.metodo_pago] ?? s.metodo_pago}{s.es_descuento && s.descuento ? ` · − ${money(Number(s.descuento))} dscto.` : ""}</span></span><span className="m num">{money(saleAmount(s))}</span><span className="go"><ChevronRight size={18} {...stroke} /></span></Link>)}</div>
    </section>
  )
  const mmCard = products.length ? (
    <section className="card"><div className="ch"><h2>Mayorista / Minorista</h2></div><ul className="rl">
      {[["Minorista", minU], ["Mayorista", unitsTotal - minU]].map(([label, x]) => <li key={label as string} className="pm" style={{ gridTemplateColumns: "minmax(0,1fr) auto auto" }}><span className="n">{label}<span className="tag">{plural(x as number, "unidad", "unidades")}</span></span><span className="p num">{pct(x as number, unitsTotal)}%</span><span /><Bar p={pct(x as number, unitsTotal)} /></li>)}
    </ul></section>
  ) : null
  const pmCard = (
    <section className="card"><div className="ch"><h2>Por método de pago</h2></div>
      <div className="gh"><span>Efectivo</span><span>es lo que cuadra</span></div><ul className="rl">{methodRow("Efectivo", "efectivo")}</ul>
      <div className="gh"><span>Dinero digital: tarjeta, Yape, Plin, transferencia</span><b className="num">{money(digital)}</b></div><ul className="rl">{methodRow("Tarjeta", "tarjeta")}{methodRow("Yape", "yape")}{methodRow("Plin", "plin")}{methodRow("Transferencia", "transferencia")}{methodRow("Enlace de pago", "pago_link")}{methodRow("QR sin especificar", "qr")}{methodRow("Otros", "otro")}</ul>
    </section>
  )

  const panel = tab === "Resumen" ? <div className="pgrid"><div className="col">{salesCard}{mmCard}</div><div className="col">{pmCard}</div></div>
    : tab === "Productos" ? (
      !products.length ? <section className="card p0"><div className="ch"><h2>Productos vendidos</h2></div><NoDetail text={closed ? "El cierre no guarda el detalle de productos." : "Sin productos vendidos este día."} /></section> : (
        <section className="card p0"><div className="ch"><h2>Productos vendidos</h2></div>
          <table className="tbl erp-only-desk"><colgroup><col style={{ width: "34%" }} /><col style={{ width: "12%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /><col style={{ width: "18%" }} /></colgroup>
            <thead><tr><th>Producto</th><th className="r">Cantidad</th><th>Tipo de venta</th><th className="r">Precio unitario</th><th className="r">Total</th></tr></thead>
            <tbody>{products.map(p => <tr key={p.p + p.may}><td><b>{p.p}</b></td><td className="r">{p.u}</td><td><span className="tag">{p.may ? "Mayorista" : "Minorista"}</span></td><td className="r">{money(p.t / p.u)}</td><td className="r"><b>{money(p.t)}</b></td></tr>)}</tbody>
            <tfoot>{daySales.filter(s => s.es_descuento && s.descuento).map(s => <tr key={s.venta_id}><td colSpan={4}>Descuento de la venta {docNo(s)}</td><td className="r">− {money(Number(s.descuento))}</td></tr>)}<tr><td colSpan={4}>Ventas directas del día</td><td className="r">{money(sum.directTotal)}</td></tr></tfoot></table>
          <div className="erp-only-mob">{products.map(p => <div key={p.p + p.may} className="rw nog"><span className="a">{p.p}<span className="sub">{p.u} × {money(p.t / p.u)} · {p.may ? "Mayorista" : "Minorista"}</span></span><span className="m num">{money(p.t)}</span></div>)}<div className="rw nog" style={{ borderTop: "1px solid hsl(var(--border-strong))" }}><span className="a">Ventas directas del día</span><span className="m num">{money(sum.directTotal)}</span></div></div>
        </section>))
    : tab === "Cajeros" ? (
      !cashiers.length ? <section className="card p0"><div className="ch"><h2>Cajeros</h2></div><NoDetail text="Sin ventas este día." /></section> : (
        <section className="card p0"><div className="ch"><h2>Cajeros</h2></div>
          <table className="tbl erp-only-desk"><colgroup><col style={{ width: "34%" }} /><col style={{ width: "22%" }} /><col style={{ width: "20%" }} /><col style={{ width: "24%" }} /></colgroup><thead><tr><th>Cajero</th><th className="r">Ventas</th><th className="r">Transacciones</th><th className="r">Ticket promedio</th></tr></thead>
            <tbody>{cashiers.map(c => <tr key={c.id}><td><b>{cashierName(c.id)}</b></td><td className="r"><b>{money(c.ventas)}</b></td><td className="r">{c.tr}</td><td className="r">{money(c.ventas / c.tr)}</td></tr>)}</tbody></table>
          <div className="erp-only-mob">{cashiers.map(c => <div key={c.id} className="rw nog"><span className="a">{cashierName(c.id)}<span className="sub">{plural(c.tr, "transacción", "transacciones")} · ticket {money(c.ventas / c.tr)}</span></span><span className="m num">{money(c.ventas)}</span></div>)}</div>
        </section>))
    : (
      <>
        <section className="card p0 erp-only-desk"><div className="ch"><h2>Historial de cierres</h2></div>
          <div className="flt"><label className="dfd"><span>Desde</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Desde" /></label><label className="dfd"><span>Hasta</span><input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Hasta" /></label>
            <button type="button" className="chip" aria-pressed={from === addDays(today, -6) && to === today} onClick={() => { setFrom(addDays(today, -6)); setTo(today) }}>7 días</button><button type="button" className="chip" aria-pressed={from === `${today.slice(0, 8)}01`} onClick={() => { setFrom(`${today.slice(0, 8)}01`); setTo(today) }}>Este mes</button><span className="cnt2">{plural(histRows.length, "cierre", "cierres")}</span></div>
          {histRows.length ? (
            <table className="tbl hx"><colgroup>{[21, 5, 10, 10, 13, 10, 11, 10, 10].map((w, i) => <col key={i} style={{ width: `${w}%` }} />)}</colgroup>
              <thead><tr><th className="gr0" colSpan={2} /><th className="gr" colSpan={3}>Efectivo</th><th className="gr" colSpan={4}>Dinero digital</th></tr><tr><th>Día</th><th className="r">Ventas</th><th className="r">Esperado</th><th className="r">Contado</th><th>Diferencia</th><th className="r">Tarjeta</th><th className="r">Transferencia</th><th className="r">Yape</th><th className="r">Plin</th></tr></thead>
              <tbody>{histRows.map(c => { const d = String(c.fecha_apertura).slice(0, 10); return (
                <tr key={c.id_cierre}><td><a className="go" href="#" onClick={e => { e.preventDefault(); goDay(d); setTab("Resumen") }}><span className="two"><b>{longDate(d)}</b><small>{c.estado === "abierto" ? "Abierto" : "Cerrado"} · Cajero #{c.cajero_id}</small></span><ChevronRight size={16} {...stroke} /></a></td><td className="r">{c.cantidad_ventas}</td><td className="r">{money(n(c.total_efectivo))}</td><td className="r">{money(n(c.saldo_efectivo))}</td><td><DiffChip c={c} /></td><td className="r">{money(n(c.total_tarjeta))}</td><td className="r">{money(n(c.total_transferencia))}</td><td className="r">{money(n(c.total_yape))}</td><td className="r">{money(n(c.total_plin))}</td></tr>) })}</tbody></table>
          ) : <NoDetail text="No hay cierres en este rango de fechas." />}
        </section>
        <div className="mcs erp-only-mob">
          <div className="mflt"><div className="row"><label className="dfd"><span>Desde</span><input type="date" value={from} onChange={e => setFrom(e.target.value)} aria-label="Desde" /></label><label className="dfd"><span>Hasta</span><input type="date" value={to} onChange={e => setTo(e.target.value)} aria-label="Hasta" /></label></div></div>
          {histRows.map(c => { const x = histDiff(c); const d = String(c.fecha_apertura).slice(0, 10); return (
            <article key={c.id_cierre} className="mc"><div className="top"><a href="#" onClick={e => { e.preventDefault(); goDay(d); setTab("Resumen") }}>{longDate(d)} <ChevronRight size={16} {...stroke} /></a><span className="st neu">{c.estado === "abierto" ? <LockOpen size={14} {...stroke} /> : <Lock size={14} {...stroke} />}{c.estado === "abierto" ? "Abierto" : "Cerrado"}</span></div>
              <div className={`dif ${x?.k ?? "na"}`}><span className="sub" style={{ color: "inherit" }}>Diferencia</span><span className="v"><DiffChip c={c} /></span></div>
              <dl><dt>Cajero</dt><dd>#{c.cajero_id}</dd><dt>Ventas</dt><dd>{c.cantidad_ventas}</dd><dt className="gl">Efectivo</dt><dt>Esperado</dt><dd>{money(n(c.total_efectivo))}</dd><dt>Contado</dt><dd>{money(n(c.saldo_efectivo))}</dd><dt className="gl">Dinero digital</dt><dt>Tarjeta</dt><dd>{money(n(c.total_tarjeta))}</dd><dt>Transferencia</dt><dd>{money(n(c.total_transferencia))}</dd><dt>Yape</dt><dd>{money(n(c.total_yape))}</dd><dt>Plin</dt><dd>{money(n(c.total_plin))}</dd></dl></article>) })}
        </div>
      </>
    )

  const countTotal = r2(DENOMS.reduce((a, d) => a + d * (Number(counts[d]) || 0), 0))

  return (
    <div className="pg-caja">
      <div className="pg">
        <div className="hd">
          <h1>Caja diaria</h1>
          <div className="dayp" role="group" aria-label="Día">
            <button type="button" aria-label="Día anterior" onClick={() => goDay(addDays(day, -1))}><ChevronLeft size={18} {...stroke} /></button>
            <label className="dt" style={{ position: "relative", cursor: "pointer" }}><Calendar size={16} {...stroke} />{weekdayOf(day).toLowerCase() && dow(day)} {longDate(day)}<input type="date" value={day} max={today} onChange={e => e.target.value && goDay(e.target.value)} aria-label="Elegir fecha" style={{ position: "absolute", inset: 0, opacity: 0, cursor: "pointer" }} /></label>
            <button type="button" aria-label="Día siguiente" aria-disabled={isToday || undefined} onClick={() => !isToday && goDay(addDays(day, 1))}><ChevronRight size={18} {...stroke} /></button>
            <button type="button" className="hoy" aria-pressed={isToday} onClick={() => goDay(today)}>Hoy</button>
          </div>
          {closed ? <span className="pill neu"><Lock size={14} {...stroke} />Caja cerrada</span> : <span className="pill ok"><LockOpen size={14} {...stroke} />Caja abierta</span>}
          {role === 3 && <span className="pill neu erp-only-desk"><User size={14} {...stroke} />Solo tus ventas y tus cierres</span>}
          <span className="sp" />
          <button type="button" className="btn out" onClick={refresh}><RefreshCw size={16} {...stroke} />Actualizar</button>
        </div>

        {resultError && <p role="alert">No se pudo cargar la caja unificada. Actualiza antes de cerrar.</p>}
        {result && <section className="card" aria-label="Resultado diario del negocio">
          <h2>Cobros y resultado del día</h2>
          <p>{result.alcance}. Ventas cobradas: {money(result.cobrado_ventas)} · Taller cobrado: {money(result.cobrado_taller)}</p>
          <div style={{ overflowX: 'auto' }}><table className="tbl"><thead><tr><th>Actividad</th><th>Ingreso reconocido</th><th>Costo registrado</th><th>Margen estimado</th></tr></thead><tbody>
            <tr><td>Productos y repuestos</td><td>{money(result.ingresos_productos)}</td><td>{money(result.costo_productos)}</td><td>{result.margen_productos === null ? 'Faltan costos' : money(result.margen_productos)}</td></tr>
            <tr><td>Servicio y mano de obra</td><td>{money(result.ingresos_servicios)}</td><td>{money(result.costo_servicios)}</td><td>{money(result.margen_servicios)}</td></tr>
          </tbody></table></div>
          <p>Gastos generales: {money(result.gastos_generales)} · <strong>Resultado estimado: {result.resultado_estimado === null ? 'Pendiente de completar costos' : money(result.resultado_estimado)}</strong></p>
          <p className="nt">{result.criterio} La mano de obra propia no tiene un sueldo imputado; registra los pagos a técnicos externos en Gastos del taller, vinculados a su orden.</p>
          <p className="nt">Egresos de efectivo: {money(result.egresos_efectivo)}. El cuadre descuenta gastos registrados; no incluye fondo inicial ni retiros sin registrar.</p>
        </section>}
        {loadingSales || loadingResult ? (
          <div className="card" aria-busy="true"><div className="empty" role="status"><p>Cargando las ventas del {longDate(day)}…</p></div></div>
        ) : (
          <>
            <section className="card p0" aria-labelledby="h-cuadre">
              <div className="hh"><h2 id="h-cuadre">Cuadre de efectivo</h2><span className="ctx">{role === 3 ? "Solo tus ventas · " : ""}Efectivo contra efectivo; el dinero digital va aparte</span></div>
              <div className="cu">
                <div className="cq esp"><div className="l">Esperado en efectivo</div><div className="v num">{money(expected)}</div><div className="s">{!hasSales && closed ? "Efectivo registrado en el cierre" : plural(sum.cash[1], "venta", "ventas") + " en efectivo"}</div></div>
                <div className="cq"><div className="l"><label htmlFor="cnt-caja">Contado</label>{!ro && <button type="button" className="lnk" aria-label="Contar billetes y monedas" onClick={() => setCountOpen(true)}><Calculator size={16} {...stroke} /><span className="erp-only-desk">Contar billetes</span></button>}</div>
                  <div className={`inp${ro ? " ro" : ""}`}><span className="pre" aria-hidden="true">S/</span><input className="cnt" id="cnt-caja" inputMode="decimal" autoComplete="off" readOnly={ro} placeholder="0.00" value={value} onChange={e => /^\d*[.,]?\d{0,2}$/.test(e.target.value) && setRaw(e.target.value.replace(",", "."))} aria-describedby={!ro && why && counted == null ? "why-caja" : undefined} /></div>
                  <div className="s">{ro ? "Digitado al cerrar" : ""}</div></div>
                {df.k === "na"
                  ? <div className="cq dif"><div className="l">Diferencia</div><div className="v num" aria-hidden="true">—</div><div className="w"><span className="st neu"><Clock size={16} {...stroke} />Sin contar</span></div><div className="s">Se calcula al digitar el contado</div></div>
                  : <div className={`cq dif ${df.k}`} aria-live="polite"><div className="l">Diferencia</div><div className="v num">{df.v}</div><div className="w"><df.i size={18} {...stroke} />{df.w}</div><div className="s" /></div>}
              </div>
              {ro && closing && <div className="mr meta"><span>Cerrado el <b>{closedAtLabel.split(" a las ")[0]}</b> a las <b>{closedAtLabel.split(" a las ")[1]}</b></span><span>Cajero <b>{closer?.name ?? `#${closing.cajero_id}`}</b></span><span><b>{closing.cantidad_ventas}</b> ventas</span></div>}
              <div className="hf">
                <div className={`fld${reviewObs ? " hi" : ""}${ro ? " ro" : ""}`}><input aria-label="Observaciones" placeholder="Observaciones (opcional)" value={ro ? (closing?.observaciones ?? "") : obs} readOnly={ro} onChange={e => setObs(e.target.value)} />{reviewObs && <span className="hint"><TriangleAlert size={14} {...stroke} />Recomendado: anota a qué se debe la diferencia</span>}</div>
                <div className="act erp-only-desk">{act.btn}{whyEl}</div>
              </div>
            </section>

            <div className="strip" role="group" aria-label="Indicadores del día">
              <div className="cell"><span className="r1">Cobros del día · ventas + taller</span><span className="v num">{money(sum.total)}</span></div>
              <div className="cell"><span className="r1">Transacciones</span><span className="v num">{sum.count}</span></div>
              <div className="cell"><span className="r1">Ticket promedio</span><span className="v num">{sum.ticket == null ? "—" : money(sum.ticket)}</span></div>
              <div className="cell"><span className="r1">Descuentos</span><span className="v num">{money(sum.discount)}</span><span className="s">{plural(sum.nDiscount, "venta con descuento", "ventas con descuento")}</span></div>
            </div>

            <div className="tabs" role="tablist" aria-label="Secciones de caja diaria">
              {TABS.filter(t => !(role === 3 && t === "Cajeros")).map(t => <button key={t} type="button" className="tab" role="tab" aria-selected={tab === t} onClick={() => setTab(t)}>{t}</button>)}
            </div>
            <div className="panel" role="tabpanel" aria-label={tab}>{panel}</div>
            <div className="mbar erp-only-mob">{whyEl}{act.btn}</div>
          </>
        )}
      </div>

      <ErpDialog open={confirmOpen} onOpenChange={setConfirmOpen} title={`¿${editing ? "Guardar la corrección del" : "Cerrar la"} ${editing ? "cierre" : "caja"} del ${dow(day)} ${longDate(day)}?`} description="Revisa el cuadre. Al confirmar, el cierre queda registrado.">
        <div className="pg-caja"><div className="dlg" style={{ position: "static", transform: "none", boxShadow: "none", border: 0, padding: 0, width: "auto" }}>
          <dl><div><dt>Esperado en efectivo</dt><dd>{money(expected)}</dd></div><div><dt>Contado</dt><dd>{money(counted ?? 0)}</dd></div><div className={`dif ${df.k}`}><dt>Diferencia</dt><dd>{df.k !== "na" && <span className={`st ${df.k}`}><df.i size={16} {...stroke} />{df.w}</span>}</dd></div><div><dt>Ventas del día</dt><dd>{sum.count}</dd></div>{obs && <div><dt>Observaciones</dt><dd>{obs}</dd></div>}</dl>
          <p className="nt"><Info size={16} {...stroke} /><span>Podrás corregir el cierre después, solo en horario laboral.</span></p>
          <div className="acts"><button type="button" className="btn out" onClick={() => setConfirmOpen(false)}>Cancelar</button><button type="button" className="btn" disabled={save.isPending} onClick={() => save.mutate()}>Confirmar cierre</button></div>
        </div></div>
      </ErpDialog>

      <ErpDialog open={countOpen} onOpenChange={setCountOpen} title="Contar billetes y monedas" description="Digita cuántos hay de cada uno; el total se usa como efectivo contado.">
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 14 }}>
          {DENOMS.map(d => <label key={d} style={{ margin: 0, display: "flex", alignItems: "center", gap: 8, fontWeight: 500 }}><span style={{ width: 52 }}>S/ {d}</span><input className="inp" style={{ margin: 0 }} inputMode="numeric" value={counts[d] ?? ""} onChange={e => /^\d*$/.test(e.target.value) && setCounts(c => ({ ...c, [d]: e.target.value }))} aria-label={`Cantidad de S/ ${d}`} /></label>)}
        </div>
        <div className="erp-amt ok"><span className="l">Total contado</span><b>{money(countTotal)}</b></div>
        <div className="acts"><button type="button" className="erp-btn out" onClick={() => setCountOpen(false)}>Cancelar</button><button type="button" className="erp-btn" onClick={() => { setRaw(String(countTotal)); setCountOpen(false) }}>Usar {money(countTotal)}</button></div>
      </ErpDialog>
    </div>
  )
}
