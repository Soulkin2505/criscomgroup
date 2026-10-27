import { useCallback, useEffect, useState } from "react"
import { Link } from "react-router-dom"
import { Calendar, ChevronRight, CircleAlert, CircleMinus, Info, RefreshCw, TrendingDown, TrendingUp, type LucideIcon } from "lucide-react"
import { toast } from "sonner"
import { getCajaTallerResumen, type WorkOrderCashSummary } from "../../services/workOrderService"
import { resumenGastosTaller, type ResumenGastos } from "../../services/gastoTallerService"
import { useDocumentTitle } from "../../hooks/useDocumentTitle"
import { addDays, limaDate, longDate } from "../../components/erp/format"
import "../../styles/taller-caja.css"

type Periodo = "hoy" | "semana" | "mes"
const PER: [Periodo, string, string][] = [["hoy", "Hoy", "Hoy"], ["semana", "Últimos 7 días", "7 días"], ["mes", "Mes actual", "Mes"]]
const MET: Record<string, string> = { efectivo: "Efectivo", pos: "POS / Tarjeta", tarjeta: "Tarjeta", yape: "Yape", plin: "Plin", pago_link: "Enlace de pago", qr: "QR (Yape/Plin)", transferencia: "Transferencia", otro: "Otro" }
const CAT: Record<string, string> = {
  mano_obra_tercerizada: "Técnico externo", insumos: "Insumos", herramientas: "Herramientas", repuestos_stock: "Repuestos a stock", alquiler: "Alquiler", servicios: "Servicios",
  transporte: "Transporte", limpieza: "Limpieza", software: "Software", capacitacion: "Capacitación", otros: "Otros",
}
const nf = new Intl.NumberFormat("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const money = (n: number, cur = "S/") => `${cur} ${nf.format(Math.abs(n))}`
const signed = (n: number) => `${n < 0 ? "−" : ""}${money(n)}`
const I = (Icon: LucideIcon, size = 16) => <Icon className="ic" size={size} strokeWidth={1.75} aria-hidden="true" />
const Dash = () => <span className="dash" aria-label="Sin dato">-</span>
const Sk = ({ cls = "", style }: { cls?: string; style?: React.CSSProperties }) => <span className={`sk ${cls}`} style={style} />

type Rows = [string, number, number | null][]
function Lines({ items, total, names }: { items: Rows; total: number; names: Record<string, string> }) {
  return (
    <ul className="rl">
      {items.map(([k, v, n]) => {
        const pct = total > 0 ? (v / total) * 100 : 0
        return (
          <li className="rw num" key={k}>
            <span className="n">{names[k] || k}{n != null && <i style={{ display: "block", margin: 0 }}>{n} {n > 1 ? "gastos" : "gasto"}</i>}</span>
            <span className="tr" role="img" aria-label={`${Math.round(pct)} % del total`}><span style={{ width: `${pct.toFixed(1)}%` }} /></span>
            <span className="m">{money(v)}</span><span className="p">{Math.round(pct)} %</span>
          </li>
        )
      })}
    </ul>
  )
}

export default function CajaTallerPage() {
  useDocumentTitle("Caja del taller")
  const [periodo, setPeriodo] = useState<Periodo>("hoy")
  const [caja, setCaja] = useState<WorkOrderCashSummary | null>(null)
  const [gastos, setGastos] = useState<ResumenGastos | null>(null)
  const [status, setStatus] = useState<"load" | "ok" | "error">("load")

  const load = useCallback(() => {
    setStatus("load")
    Promise.all([getCajaTallerResumen({ periodo }), resumenGastosTaller({ periodo })])
      .then(([c, g]) => { setCaja(c); setGastos(g); setStatus("ok") })
      .catch(() => { setStatus("error"); toast.error("No se pudo cargar la Caja del taller") })
  }, [periodo])
  useEffect(() => { load() }, [load])

  const pen = caja?.monedas?.PEN
  const others = Object.entries(caja?.monedas || {}).filter(([m]) => m !== "PEN")
  const cobrado = Number(pen?.cobrado || 0)
  const costo = Number(pen?.costo_repuestos || 0)
  const gastosTotal = Number(caja?.gastos_taller ?? gastos?.total_gastos ?? 0)
  const saldo = Number(pen?.saldo_por_cobrar || 0)
  const g = Number(caja?.ganancia_estimada ?? cobrado - costo - gastosTotal)
  const load_ = status === "load"
  const err = status === "error"
  // La caja entrega el periodo como instantes ISO (hasta exclusivo, hora de Lima);
  // los gastos como YYYY-MM-DD inclusivo. Se normaliza antes de formatear.
  const rango = (() => {
    const c = caja?.periodo
    const desde = c ? limaDate(c.desde) : gastos?.periodo?.desde
    const hasta = c ? addDays(limaDate(c.hasta), -1) : gastos?.periodo?.hasta
    if (!desde || !hasta) return ""
    return desde === hasta ? longDate(desde) : `${longDate(desde)} \u2013 ${longDate(hasta)}`
  })()

  const tone = err ? "neu" : g < 0 ? "bad" : g > 0 ? "ok" : "neu"
  const word = err ? "Sin datos" : g < 0 ? "Diferencia negativa" : g > 0 ? "Diferencia positiva" : "Sin resultado"
  const HeroIcon = tone === "bad" ? TrendingDown : tone === "ok" ? TrendingUp : CircleMinus
  const falta = costo - cobrado
  const why = err ? "" : g < 0
    ? falta > 0
      ? <><b>Por qué sale negativa:</b> lo cobrado ({money(cobrado)}) aún no cubre el costo de repuestos ya consumido ({money(costo)}): faltan {money(falta)}{gastosTotal > 0 ? `, y los gastos del taller suman ${money(gastosTotal)} más` : ""}. Es un desfase entre cobro y costo, no una pérdida confirmada{saldo > 0 ? `; quedan ${money(saldo)} por cobrar` : ""}.</>
      : <><b>Por qué sale negativa:</b> lo cobrado ({money(cobrado)}) cubre el costo de repuestos ({money(costo)}) pero no los gastos del taller ({money(gastosTotal)}).</>
    : g > 0
      ? <><b>Por qué sale positiva:</b> lo cobrado ({money(cobrado)}) cubre el costo de repuestos ({money(costo)}) y los gastos del taller ({money(gastosTotal)}); sobran {money(g)}.</>
      : <><b>Sin movimiento:</b> no hay cobros ni gastos en este periodo, y el costo de repuestos y el saldo por cobrar están en cero.</>
  const v = (x: number) => (err ? <Dash /> : money(x))

  const kpis: [string, number, string, [string, string] | null, boolean][] = [
    ["Cobrado", cobrado, "Pagos confirmados / adelantos", null, false],
    ["Saldo por cobrar", saldo, "Órdenes con deuda activa", ["Ver órdenes", "/services/technical"], true],
    ["Venta de servicios", Number(pen?.cobrado_servicios || 0), "Mano de obra, diagnóstico y otros cargos", null, false],
    ["Venta de repuestos", Number(pen?.cobrado_repuestos || 0), "Parte cobrada correspondiente a productos", null, false],
    ["Costo de repuestos", costo, "Costo de repuestos consumidos/reservados", null, true],
    ["Gastos del taller", gastosTotal, "Egresos internos del periodo", ["Ver gastos", "/services/expenses"], false],
  ]
  const met: Rows = pen ? Object.entries(pen.por_metodo || {}).filter(([, x]) => Number(x) > 0).sort((a, b) => Number(b[1]) - Number(a[1])).map(([k, x]) => [k, Number(x), null]) : []
  const tm = met.reduce((a, x) => a + x[1], 0)
  const cats: Rows = (gastos?.por_categoria || []).filter(c => c.total > 0).sort((a, b) => b.total - a.total).map(c => [c.categoria, Number(c.total), c.cantidad])
  const noData = (t: string, Icon: LucideIcon = Info) => <div className="empty">{I(Icon)}{t}</div>

  return (
    <div className="pg-tcaj">
      <div className="pg">
        <div className="sticky">
          <div className="hd">
            <h1>Caja y ventas de servicio</h1>
            <div className="rt">
              <span className="rng">{rango && <b className="num">{rango}</b>}</span>
              <div className="seg" role="tablist" aria-label="Periodo">
                {PER.map(([k, l]) => <button type="button" key={k} role="tab" aria-selected={periodo === k} onClick={() => setPeriodo(k)}>{l}</button>)}
              </div>
            </div>
          </div>
        </div>

        <div className="pg" role="tabpanel"><p className="hint">Vista del taller. Estos cobros también aparecen en Caja diaria, junto con ventas, sin duplicarse. La diferencia de este periodo no equivale a la ganancia por trabajos entregados.</p>
          {err && (
            <div className="err" role="alert">{I(CircleAlert, 20)}<p><b>No se pudo cargar el resumen de caja.</b> Los importes aparecen como "-" hasta que vuelva a cargar; no son ceros.</p>
              <button type="button" className="btn" onClick={load}>{I(RefreshCw)}Reintentar</button></div>
          )}

          {load_ ? (
            <section className="card hero" aria-busy="true" aria-label="Cobros menos costos del periodo">
              <div className="top"><div><Sk cls="lg w3" style={{ width: 220 }} /><Sk cls="xl" style={{ marginTop: 8 }} /></div>
                <div className="eq" style={{ justifyContent: "flex-start" }}><Sk cls="lg" style={{ width: 100 }} /><Sk cls="lg" style={{ width: 120 }} /><Sk cls="lg" style={{ width: 110 }} /><Sk cls="lg" style={{ width: 110 }} /></div></div>
              <div className="why"><Sk cls="w1" /></div>
            </section>
          ) : (
            <section className="card hero" aria-labelledby="h-gan">
              <div className="top">
                <div>
                  <div className="lb"><span id="h-gan">Cobros menos costos del periodo</span><span className={`st ${tone}`}>{I(HeroIcon)}{word}</span></div>
                  <div className={`big num ${err ? "" : tone}`}>{err ? <Dash /> : signed(g)}</div>
                </div>
                <div className="eq num" role="group" aria-label="Fórmula: Cobrado menos Costo de repuestos menos Gastos del taller igual al resultado">
                  <div className="t"><span className="op0" /><div className="tx"><div className="l">Cobrado</div><div className="v">{v(cobrado)}</div></div></div>
                  <div className="t"><span className="op" aria-hidden="true">−</span><div className="tx"><div className="l">Costo de repuestos</div><div className="v">{v(costo)}</div></div></div>
                  <div className="t"><span className="op" aria-hidden="true">−</span><div className="tx"><div className="l">Gastos del taller</div><div className="v">{v(gastosTotal)}</div></div></div>
                  <div className="t res"><span className="op" aria-hidden="true">=</span><div className="tx"><div className="l">Resultado</div>
                    <div className="v" style={tone === "bad" ? { color: "hsl(var(--destructive-text))" } : tone === "ok" ? { color: "hsl(var(--success-text))" } : undefined}>{err ? <Dash /> : signed(g)}</div></div></div>
                </div>
              </div>
              {why && <p className="why">{I(Info)}<span>{why}</span></p>}
            </section>
          )}

          <div className="strip" role="group" aria-label="Indicadores del periodo" aria-busy={load_}>
            {kpis.map(([l, val, hint, link, np]) => {
              if (load_) return <div className="cell" key={l}><div className="r1">{l}</div><Sk cls="lg w3" style={{ margin: "4px 0" }} /><Sk cls="w1" /></div>
              const body = (
                <>
                  <div className="r1"><span>{l}</span>{link && <span className="go"><b>Ver</b>{I(ChevronRight, 14)}</span>}</div>
                  <div className="v num">{v(val)}</div><div className="s">{hint}</div>
                  {np && <div className="np">{I(Calendar, 14)}No depende del periodo</div>}
                </>
              )
              return link
                ? <Link className="cell" key={l} to={link[1]} aria-label={`${l}: ${err ? "sin dato" : money(val)}. ${link[0]}`}>{body}</Link>
                : <div className="cell" key={l}>{body}</div>
            })}
          </div>

          <div className="g2">
            <section className="card" aria-labelledby="h-met">
              <div className="ch"><div><h2 id="h-met">Cobrado por método de pago</h2><small>Solo pagos confirmados en soles</small></div></div>
              {load_ ? <div aria-busy="true">{[0, 1, 2].map(i => <div className="rw" key={i} style={{ gridTemplateColumns: "minmax(0,1fr) 92px" }}><Sk cls="w2" /><Sk /></div>)}</div>
                : err ? noData("No disponible por el error de carga.", CircleAlert) : met.length ? <Lines items={met} total={tm} names={MET} /> : noData("Sin cobros en este periodo.")}
            </section>
            <section className="card" aria-labelledby="h-cat">
              <div className="ch"><div><h2 id="h-cat">Gastos por categoría</h2></div><Link className="lnk" to="/services/expenses" aria-label="Ver gastos">Ver gastos{I(ChevronRight, 14)}</Link></div>
              {load_ ? <div aria-busy="true">{[0, 1, 2].map(i => <div className="rw" key={i} style={{ gridTemplateColumns: "minmax(0,1fr) 92px" }}><Sk cls="w2" /><Sk /></div>)}</div>
                : err ? noData("No disponible por el error de carga.", CircleAlert) : cats.length ? <Lines items={cats} total={gastosTotal} names={CAT} /> : noData("Sin gastos en este periodo.")}
            </section>
          </div>

          {!load_ && !err && others.length > 0 && (
            <section className="card om" aria-labelledby="h-om">
              <h2 id="h-om">Otras monedas</h2>
              {others.map(([c, m]) => (
                <div key={c} style={{ display: "contents" }}>
                  <div className="mo num"><b>{c}</b><span>Cobrado</span><strong>{money(Number(m.cobrado), c)}</strong></div>
                  <div className="mo num"><span>Saldo por cobrar</span><strong>{money(Number(m.saldo_por_cobrar), c)}</strong></div>
                </div>
              ))}
            </section>
          )}
        </div>
      </div>
    </div>
  )
}
