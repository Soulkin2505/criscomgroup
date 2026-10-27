import { WorkshopBilling } from './WorkshopBilling'
import { useCallback, useEffect, useRef, useState } from "react"
import {
  CircleAlert, CircleCheck, ChevronRight, Clock, ExternalLink, FileText, Image as ImageIcon, Pencil, Plus, Send, ShieldCheck, Upload, Wallet,
} from "lucide-react"
import { toast } from "sonner"
import {
  addWorkOrderEvidence, addWorkOrderPart, addWorkOrderPayment, createWorkOrderQuote, getWorkOrderCredentialStatus, listWorkOrderEvidence,
  listWorkOrderHistory, listWorkOrderParts, listWorkOrderPayments, listWorkOrderQuotes, openWorkOrderEvidence, removeWorkOrderCredential,
  removeWorkOrderEvidence, removeWorkOrderPart, resolveWorkOrderQuote, revealWorkOrderCredential, setWorkOrderEvidenceVisibility, voidWorkOrderPayment,
  type WorkOrder, type WorkOrderCredentialStatus, type WorkOrderEvent, type WorkOrderEvidence, type WorkOrderPart, type WorkOrderPayment,
  type WorkOrderPaymentMethod, type WorkOrderQuote,
} from "../../../services/workOrderService"
import { commercialApi } from "../../../services/commercialService"
import { buscarProductoPorCodigoBarras } from "../../../services/codigoBarrasService"
import { useBarcodeScanner } from "../../../hooks/useBarcodeScanner"
import { SignaturePad } from "../../../components/services/SignaturePad"
import {
  ETAPA, FACT, FISCAL, I, METODO, ST, checklist, dayNum, errMsg, f2, fd, fin, ft, money, monto, saldo, type Tone,
} from "./shared"

export type ExData = {
  parts: WorkOrderPart[]; payments: WorkOrderPayment[]; quotes: WorkOrderQuote[]; evidence: WorkOrderEvidence[]; history: WorkOrderEvent[]
  loaded: boolean
}
export type TabProps = { o: WorkOrder; data: ExData; refresh: () => Promise<void> }

const empty: ExData = { parts: [], payments: [], quotes: [], evidence: [], history: [], loaded: false }
export function useExpedienteData(o: WorkOrder | undefined, reloadOrders: () => Promise<void>) {
  const id = o?.id_orden_servicio
  const [data, setData] = useState<ExData>(empty)
  const load = useCallback(async () => {
    if (!id) return
    try {
      const [parts, payments, quotes, evidence, history] = await Promise.all([
        listWorkOrderParts(id), listWorkOrderPayments(id), listWorkOrderQuotes(id), listWorkOrderEvidence(id), listWorkOrderHistory(id),
      ])
      setData({ parts, payments, quotes, evidence, history, loaded: true })
    } catch {
      toast.error("No se pudo cargar el detalle del expediente")
    }
  }, [id])
  useEffect(() => { setData(empty); void load() }, [load])
  const refresh = useCallback(async () => { await Promise.all([load(), reloadOrders()]) }, [load, reloadOrders])
  return { data, refresh }
}

const Tag = ({ children }: { children: React.ReactNode }) => <span className="tag">{children}</span>
const Tags = ({ list }: { list?: string[] | null }) => (list && list.length ? <div className="tgs">{list.map((x, i) => <Tag key={`${x}-${i}`}>{x}</Tag>)}</div> : <span className="mut">Sin observaciones</span>)
const Chip = ({ tone, icon, children }: { tone: Tone; icon: React.ReactNode; children: React.ReactNode }) => <span className={`st ${tone}`}>{icon}{children}</span>
const Fld = ({ label, req, cls = "", children }: { label: string; req?: boolean; cls?: string; children: React.ReactNode }) => (
  <label className={`fld ${cls}`}><span>{label}{req && <> <i>*</i></>}</span>{children}</label>
)
function Opts<T extends string>({ value, onChange, items, label }: { value: T; onChange: (v: T) => void; items: Record<string, string>; label: string }) {
  return (
    <div className="opts" role="radiogroup" aria-label={label}>
      {Object.entries(items).map(([k, l]) => <button type="button" key={k} className="opt" role="radio" aria-checked={value === k} onClick={() => onChange(k as T)}>{l}</button>)}
    </div>
  )
}
const Empty = ({ icon, title, text }: { icon: React.ReactNode; title: string; text?: string }) => <div className="empty" style={{ minHeight: 140 }}>{icon}<h3>{title}</h3>{text && <span>{text}</span>}</div>

/* ============ Resumen ============ */
export function ResumenTab({ o, data, goTab }: TabProps & { goTab: (t: string) => void }) {
  const reserved = data.parts.filter(r => r.estado_stock === "reservado").length
  const ck = checklist(o, reserved)
  const blocking = ck.filter(x => x.blocks)
  const dueD = o.fecha_entrega_estimada ? dayNum(String(o.fecha_entrega_estimada).slice(0, 10)) - dayNum(new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)) : null
  const vigente = o.estado === "entregado" && o.garantia_fin && String(o.garantia_fin).slice(0, 10) >= new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
  const [cred, setCred] = useState<WorkOrderCredentialStatus | null>(null)
  const [secret, setSecret] = useState<string | null>(null)
  const loadCred = useCallback(() => { getWorkOrderCredentialStatus(o.id_orden_servicio).then(setCred).catch(() => setCred(null)) }, [o.id_orden_servicio])
  useEffect(() => { setSecret(null); loadCred() }, [loadCred])
  const reveal = async () => {
    try { const r = await revealWorkOrderCredential(o.id_orden_servicio); setSecret(r.secreto); window.setTimeout(() => setSecret(null), 30000); loadCred() }
    catch (e) { toast.error(errMsg(e, "No se pudo revelar la clave")) }
  }
  const remove = async () => {
    try { await removeWorkOrderCredential(o.id_orden_servicio); setSecret(null); toast.success("Clave temporal eliminada"); loadCred() }
    catch (e) { toast.error(errMsg(e, "No se pudo eliminar la clave")) }
  }
  return (
    <div className="pn">
      {o.estado === "listo" && (
        <div>
          <div className="sh">Requisitos para entregar<small>{blocking.filter(x => x.ok).length} de {blocking.length} obligatorios cumplidos</small></div>
          <ul className="ck" data-od-id="checklist-entrega">
            {ck.map(x => {
              const tone: Tone = x.ok ? "ok" : x.blocks ? "bad" : "neu"
              return (
                <li key={x.k}>
                  <span className={`st ${tone}`}>{I(x.ok ? CircleCheck : x.blocks ? CircleAlert : Clock, 18)}</span>
                  <div>
                    <div className="t">{x.k}</div><div className="d">{x.d}</div>
                    {!x.ok && x.k === "Pago completo" && <button type="button" className="lnk" onClick={() => goTab("pagos")} style={{ marginLeft: -6 }}>Registrar pago {I(ChevronRight, 14)}</button>}
                  </div>
                  <span className={`st ${tone}`}>{x.ok ? "Cumplido" : x.blocks ? "Pendiente" : "Al entregar"}</span>
                </li>
              )
            })}
          </ul>
        </div>
      )}
      <dl className="dl">
        <div className="full"><dt>Falla indicada</dt><dd>{o.detalle}</dd></div>
        <div><dt>Estado físico</dt><dd><Tags list={o.estado_fisico as string[] | undefined} /></dd></div>
        <div><dt>Accesorios recibidos</dt><dd><Tags list={o.accesorios_recibidos as string[] | undefined} /></dd></div>
        <div className="full"><dt>Diagnóstico y trabajo</dt><dd>{o.diagnostico_configuracion || o.trabajo_realizado ? [o.diagnostico_configuracion, o.trabajo_realizado && `Trabajo realizado: ${o.trabajo_realizado}`].filter(Boolean).join(" . ") : <span className="mut">Sin diagnóstico registrado en el expediente.</span>}</dd></div>
        <div><dt>Ingreso . entrega estimada</dt><dd className="num">{fd(o.fecha_ingreso)} . {fd(o.fecha_entrega_estimada)}{!fin(o) && dueD !== null && dueD < 0 && <><br /><Chip tone="bad" icon={I(CircleAlert, 14)}>Vencida hace {-dueD} día(s)</Chip></>}</dd></div>
        <div><dt>Recepción conforme</dt><dd>{o.recepcion_conforme ? <Chip tone="ok" icon={I(CircleCheck, 14)}>Conforme</Chip> : <Chip tone="bad" icon={I(CircleAlert, 14)}>Sin conformidad</Chip>}</dd></div>
        <div><dt>Garantía del trabajo</dt><dd>{o.garantia_inicio
          ? <>{o.garantia_dias} días . del {fd(o.garantia_inicio)} al {fd(o.garantia_fin)} {vigente ? <Chip tone="ok" icon={I(ShieldCheck, 14)}>Vigente</Chip> : <Chip tone="bad" icon={I(CircleAlert, 14)}>Vencida</Chip>}</>
          : <>{o.garantia_dias} días . empieza a contar al entregar</>}</dd></div>
        <div><dt>Fiscal</dt><dd>{o.clasificacion_fiscal ? FISCAL[o.clasificacion_fiscal] : <span className="mut">Sin clasificar</span>} <Tag>{FACT[o.estado_facturacion || "sin_facturar"]}</Tag></dd></div>
      </dl>
      <div className="sep ra">
        <Chip tone="neu" icon={I(Clock, 16)}>Clave temporal</Chip>
        <span className="mut">{secret ? <b className="num" style={{ color: "hsl(var(--foreground))" }}>{secret}</b> : cred?.configurada ? `Oculta . vence ${ft(cred.expira_en)}` : cred?.expirada ? "Venció y se eliminó" : "No hay clave guardada"}</span>
        <span className="sp" />
        {cred?.configurada && <><button type="button" className="btn out" onClick={reveal}>Revelar</button><button type="button" className="btn out" onClick={remove}>Eliminar</button></>}
      </div>
      <div className="hint">Revelar la clave queda registrado en el historial. Se muestra 30 segundos.</div>
    </div>
  )
}

/* ============ Cotizaciones ============ */
export function CotizacionesTab({ o, data, refresh }: TabProps) {
  const quotes = [...data.quotes].sort((a, b) => b.version - a.version)
  const [creating, setCreating] = useState(false)
  const [form, setForm] = useState({ trabajo: "", condiciones: "" })
  const [resp, setResp] = useState<Record<number, { r: "aprobar" | "rechazar"; nombre: string; canal: NonNullable<WorkOrderQuote["canal_respuesta"]>; evid: string }>>({})
  const [busy, setBusy] = useState(false)
  const run = async (fn: () => Promise<unknown>, ok: string, fail: string) => {
    setBusy(true)
    try { await fn(); toast.success(ok); await refresh() } catch (e) { toast.error(errMsg(e, fail)) } finally { setBusy(false) }
  }
  const create = () => run(async () => { await createWorkOrderQuote(o.id_orden_servicio, { trabajo_propuesto: form.trabajo.trim() || undefined, condiciones: form.condiciones.trim() || undefined }); setCreating(false); setForm({ trabajo: "", condiciones: "" }) }, "Cotización creada en borrador", "No se pudo crear la cotización")
  const locked = o.estado === "cancelado" || !!o.venta_id
  return (
    <div className="pn">
      <div className="sh">Versiones de la cotización
        <button type="button" className="btn out" disabled={locked} onClick={() => setCreating(c => !c)}>{I(Plus, 16)}Crear versión</button>
      </div>
      {creating && (
        <div className="inl">
          <div className="sh" style={{ minHeight: 32 }}>Nueva versión (borrador)</div>
          <div className="frm">
            <Fld label="Trabajo propuesto" cls="s3"><textarea className="ta" value={form.trabajo} onChange={e => setForm(f => ({ ...f, trabajo: e.target.value }))} /></Fld>
            <Fld label="Condiciones" cls="s3"><textarea className="ta" placeholder="Condiciones específicas de esta cotización" value={form.condiciones} onChange={e => setForm(f => ({ ...f, condiciones: e.target.value }))} /></Fld>
            <div className="ft"><span className="hint">Toma los importes y el diagnóstico actuales de la orden ({money(monto(o))}).</span><button type="button" className="btn" disabled={busy} onClick={create}>Crear borrador</button></div>
          </div>
        </div>
      )}
      {!quotes.length ? <Empty icon={I(FileText, 28)} title="Sin cotizaciones" text="Crea la versión 1 para enviarla al cliente." /> : quotes.map(q => {
        const rs = resp[q.id_cotizacion_servicio] || { r: "aprobar" as const, nombre: "", canal: "whatsapp" as const, evid: "" }
        const setR = (p: Partial<typeof rs>) => setResp(c => ({ ...c, [q.id_cotizacion_servicio]: { ...rs, ...p } }))
        return (
          <div className="sep" key={q.id_cotizacion_servicio}>
            <div className="sh" style={{ minHeight: 32 }}>
              <span>Versión {q.version} <span className="st neu" style={{ marginLeft: 8 }}>{I(Send, 16)}{q.estado[0].toUpperCase() + q.estado.slice(1)}</span></span>
              <small>{q.enviada_en ? `Enviada ${ft(q.enviada_en)}` : "Sin enviar"}</small>
            </div>
            <div className="mny c5">
              {([["Repuestos", q.repuestos], ["Mano de obra", q.mano_obra], ["Descuento", q.descuento], ["Recargo", q.recargo]] as const).map(([l, v]) => <div key={l}><div className="l">{l}</div><div className="v num">{money(v)}</div></div>)}
              <div><div className="l">Total</div><div className="v big num">{money(q.total)}</div></div>
            </div>
            <dl className="dl" style={{ marginTop: 12 }}>
              <div><dt>Diagnóstico</dt><dd>{q.diagnostico || <span className="mut">-</span>}</dd></div>
              <div><dt>Trabajo propuesto</dt><dd>{q.trabajo_propuesto || <span className="mut">-</span>}</dd></div>
              <div className="full"><dt>Condiciones</dt><dd>{q.condiciones || <span className="mut">-</span>}</dd></div>
              {q.aprobador_nombre && <div className="full"><dt>Respuesta</dt><dd>{q.aprobador_nombre} . {q.canal_respuesta}</dd></div>}
            </dl>
            {q.estado === "borrador" && (
              <div className="ra" style={{ marginTop: 10 }}><span className="sp" />
                <button type="button" className="btn" disabled={busy} onClick={() => run(() => resolveWorkOrderQuote(o.id_orden_servicio, q.id_cotizacion_servicio, { accion: "enviar" }), "Cotización enviada", "No se pudo enviar la cotización")}>{I(Send, 16)}Enviar al cliente</button>
              </div>
            )}
            {q.estado === "enviada" && (
              <div className="inl">
                <div className="sh" style={{ minHeight: 32 }}>Registrar respuesta</div>
                <div className="frm">
                  <div className="fld s3"><span>Respuesta <i>*</i></span><Opts label="Respuesta" value={rs.r} onChange={v => setR({ r: v })} items={{ aprobar: "Aprobada", rechazar: "Rechazada" }} /></div>
                  <Fld label="Aprobador" req cls="s3"><input className="in" placeholder="Nombre de quien responde" value={rs.nombre} onChange={e => setR({ nombre: e.target.value })} /></Fld>
                  <Fld label="Canal de respuesta" req cls="s3">
                    <select className="sl" value={rs.canal} onChange={e => setR({ canal: e.target.value as typeof rs.canal })}>
                      <option value="whatsapp">WhatsApp</option><option value="presencial">Presencial</option><option value="correo">Correo</option><option value="web">Web</option><option value="otro">Otro</option>
                    </select>
                  </Fld>
                  <Fld label="Evidencia de consentimiento" cls="s3"><input className="in" placeholder="Captura o nota del consentimiento" value={rs.evid} onChange={e => setR({ evid: e.target.value })} /></Fld>
                  <div className="ft">
                    <span className="hint">Solo una cotización enviada puede resolverse. Al enviarla quedaron congelados importes, diagnóstico, condiciones y consentimiento.</span>
                    <button type="button" className="btn" disabled={busy || !rs.nombre.trim()} onClick={() => run(() => resolveWorkOrderQuote(o.id_orden_servicio, q.id_cotizacion_servicio, { accion: rs.r, aprobador_nombre: rs.nombre.trim(), canal_respuesta: rs.canal, evidencia_consentimiento: rs.evid.trim() || undefined }), "Respuesta registrada", "No se pudo registrar la respuesta")}>Guardar respuesta</button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

/* ============ Repuestos ============ */
type InvProduct = { id_producto: number; nombre: string; sku?: string; stock: number; precio_unitario?: string; precio_unitario_con_igv?: string; quants?: { id_quant_inventario: number; ubicacion_id: number; lote?: string; numero_serie?: string; cantidad?: number }[] }
const STK: Record<string, [Tone, string]> = { reservado: ["warn", "Reservado"], consumido: ["ok", "Consumido"], devuelto: ["neu", "Devuelto"], no_aplica: ["neu", "No aplica"] }
export function RepuestosTab({ o, data, refresh }: TabProps) {
  const [products, setProducts] = useState<InvProduct[]>([])
  const [f, setF] = useState({ productId: "manual", quantId: "global", descripcion: "", sku: "", cantidad: "1", costo: "", precio: "" })
  const [ret, setRet] = useState<{ part: WorkOrderPart; motivo: string } | null>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { commercialApi.dashboard().then(d => setProducts(d.products as unknown as InvProduct[])).catch(() => setProducts([])) }, [])
  const product = products.find(p => String(p.id_producto) === f.productId)
  const locked = o.estado === "cancelado" || !!o.venta_id
  const scan = useCallback(async (code: string) => {
    try {
      const r = await buscarProductoPorCodigoBarras(code)
      const found = r?.producto
      if (!found) { toast.error(`Código '${code}' no encontrado en inventario`); return }
      const inv = products.find(c => c.id_producto === found.id_producto)
      if (inv && inv.stock <= 0) { toast.warning(`${found.nombre} sin stock disponible`); return }
      const precio = inv ? inv.precio_unitario_con_igv || inv.precio_unitario : ""
      setF(c => ({ ...c, productId: String(found.id_producto), quantId: "global", descripcion: "", precio: precio ? String(precio) : c.precio }))
      toast.success(`Repuesto seleccionado: ${found.sku ? `${found.sku} . ` : ""}${found.nombre}`)
    } catch (e) { toast.error((e as Error)?.message || `No se pudo buscar el código '${code}'`) }
  }, [products])
  useBarcodeScanner({ onScan: scan, enabled: true, minLength: 5 })
  const add = async () => {
    const cantidad = Number(f.cantidad), precio = Number(f.precio)
    if (!Number.isInteger(cantidad) || cantidad <= 0) return toast.error("La cantidad debe ser un entero mayor que cero")
    if (f.productId === "manual" && !f.descripcion.trim()) return toast.error("Escribe la descripción del repuesto")
    if (!Number.isFinite(precio) || precio < 0) return toast.error("Ingresa un precio válido")
    const quant = f.quantId !== "global" ? product?.quants?.find(q => String(q.id_quant_inventario) === f.quantId) : undefined
    setBusy(true)
    try {
      await addWorkOrderPart(o.id_orden_servicio, {
        id_producto: f.productId === "manual" ? undefined : Number(f.productId), descripcion: f.descripcion.trim() || undefined, sku: f.sku.trim() || undefined,
        cantidad, precio_unitario: precio, costo_unitario: f.costo ? Number(f.costo) : undefined,
        ...(quant ? { ubicacion_id: quant.ubicacion_id, lote: quant.lote || undefined, numero_serie: quant.numero_serie || undefined } : {}),
      })
      toast.success(`Repuesto agregado a ${o.codigo}`)
      setF({ productId: "manual", quantId: "global", descripcion: "", sku: "", cantidad: "1", costo: "", precio: "" })
      await refresh()
    } catch (e) { toast.error(errMsg(e, "No se pudo agregar el repuesto")) } finally { setBusy(false) }
  }
  const retire = async () => {
    if (!ret || !ret.motivo.trim()) return
    setBusy(true)
    try { await removeWorkOrderPart(o.id_orden_servicio, ret.part.id_repuesto_servicio, ret.motivo.trim()); toast.success("Repuesto retirado y stock restaurado"); setRet(null); await refresh() }
    catch (e) { toast.error(errMsg(e, "No se pudo retirar el repuesto")) } finally { setBusy(false) }
  }
  const alta = (
    <div className="inl">
      <div className="sh" style={{ minHeight: 32 }}>Agregar repuesto</div>
      <div className="frm">
        <Fld label="Producto de inventario" cls="s4">
          <select className="sl" disabled={locked} value={f.productId} onChange={e => setF(c => ({ ...c, productId: e.target.value, quantId: "global" }))}>
            <option value="manual">Repuesto manual (sin inventario)</option>
            {products.map(p => <option key={p.id_producto} value={p.id_producto}>{p.sku ? `${p.sku} . ` : ""}{p.nombre} ({p.stock})</option>)}
          </select>
        </Fld>
        {product?.quants && product.quants.length > 0 && (
          <Fld label="Ubicación / lote" cls="s4">
            <select className="sl" value={f.quantId} onChange={e => setF(c => ({ ...c, quantId: e.target.value }))}>
              <option value="global">Stock global sin asignar</option>
              {product.quants.map(q => <option key={q.id_quant_inventario} value={q.id_quant_inventario}>{[`Ubic. ${q.ubicacion_id}`, q.lote && `lote ${q.lote}`, q.numero_serie && `serie ${q.numero_serie}`, q.cantidad != null && `(${q.cantidad})`].filter(Boolean).join(" . ")}</option>)}
            </select>
          </Fld>
        )}
        <Fld label="SKU" cls="s2"><input className="in" value={f.sku} disabled={locked} onChange={e => setF(c => ({ ...c, sku: e.target.value }))} /></Fld>
        <Fld label="Descripción" req={f.productId === "manual"} cls="s3"><input className="in" value={f.descripcion} disabled={locked} onChange={e => setF(c => ({ ...c, descripcion: e.target.value }))} /></Fld>
        <Fld label="Cantidad" req><input className="in num" inputMode="numeric" value={f.cantidad} disabled={locked} onChange={e => setF(c => ({ ...c, cantidad: e.target.value.replace(/\D/g, "") }))} /></Fld>
        <Fld label="Costo unit."><input className="in num" inputMode="decimal" placeholder="0.00" value={f.costo} disabled={locked} onChange={e => setF(c => ({ ...c, costo: e.target.value }))} /></Fld>
        <Fld label="Precio unit." req><input className="in num" inputMode="decimal" placeholder="0.00" value={f.precio} disabled={locked} onChange={e => setF(c => ({ ...c, precio: e.target.value }))} /></Fld>
        <div className="ft">
          <span className="hint">{locked ? "La orden ya no admite repuestos." : "Con un producto de inventario, el stock se reserva o consume. También puedes escanear su código."}</span>
          <button type="button" className="btn" disabled={busy || locked} onClick={add}>{I(Plus, 16)}Agregar repuesto</button>
        </div>
      </div>
    </div>
  )
  const tabla = (
    <div>
      <div className="sh">Repuestos de la orden<small>Costo repuestos {money(o.costo_repuestos)}</small></div>
      {data.parts.length ? (
        <table className="tbl">
          <thead><tr><th>Repuesto</th><th className="r">Cant.</th><th className="r">Costo unit.</th><th className="r">Precio unit.</th><th>Stock</th><th><span className="sr">Acciones</span></th></tr></thead>
          <tbody>{data.parts.map(r => {
            const s = STK[r.estado_stock] || STK.no_aplica
            return (
              <tr key={r.id_repuesto_servicio}>
                <td><div className="a">{r.descripcion}</div><div className="b">{r.sku || "Sin SKU"}</div></td>
                <td className="r num">{r.cantidad}</td><td className="r num">{money(r.costo_unitario)}</td><td className="r num">{money(r.precio_unitario)}</td>
                <td><span className={`st ${s[0]}`}>{I(r.estado_stock === "consumido" ? CircleCheck : Clock, 14)}{s[1]}</span></td>
                <td className="r">{r.estado_stock !== "devuelto" && <button type="button" className="btn out" disabled={locked} onClick={() => setRet({ part: r, motivo: "" })}>Retirar</button>}</td>
              </tr>
            )
          })}</tbody>
        </table>
      ) : <div className="empty" style={{ minHeight: 100 }}>Sin repuestos registrados.</div>}
    </div>
  )
  const rp = ret && (
    <div className="inl">
      <div className="sh" style={{ minHeight: 32 }}>Retirar «{ret.part.descripcion}»</div>
      <Fld label="Motivo del retiro" req><textarea className="ta" placeholder="Por qué se retira este repuesto" value={ret.motivo} onChange={e => setRet({ ...ret, motivo: e.target.value })} /></Fld>
      <div className="hint">Se restaura el stock ({ret.part.cantidad} × {ret.part.sku || "repuesto"}) y el costo de repuestos baja {money(Number(ret.part.precio_unitario) * ret.part.cantidad)}. El retiro queda registrado con su motivo.</div>
      <div className="ra"><span className="sp" /><button type="button" className="btn out" onClick={() => setRet(null)}>Cancelar</button><button type="button" className="btn dng" disabled={busy || !ret.motivo.trim()} onClick={retire}>Retirar repuesto</button></div>
    </div>
  )
  return <div className="pn">{ret ? <>{tabla}{rp}{alta}</> : <>{alta}{tabla}</>}</div>
}

/* ============ Pagos ============ */
export function PagosTab({ o, data, refresh }: TabProps) {
  const s = saldo(o), m = monto(o), pct = m ? Math.min(100, Math.round((Number(o.adelanto) / m) * 100)) : 0
  const off = o.estado === "cancelado" || s <= 0.001
  const [f, setF] = useState({ monto: "", metodo: "efectivo" as WorkOrderPaymentMethod, referencia: "", nota: "" })
  const [void_, setVoid] = useState<{ p: WorkOrderPayment; motivo: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const montoN = Number(f.monto)
  const invalid = !Number.isFinite(montoN) || montoN <= 0 ? "Escribe un monto mayor que 0" : montoN > s + 0.001 ? `El monto supera el saldo (${money(s)})` : ""
  const add = async () => {
    if (invalid) return toast.error(invalid)
    setBusy(true)
    try {
      await addWorkOrderPayment(o.id_orden_servicio, { metodo: f.metodo, monto: montoN, referencia: f.referencia.trim() || undefined, nota: f.nota.trim() || undefined })
      toast.success(`Pago registrado en ${o.codigo}`)
      setF({ monto: "", metodo: "efectivo", referencia: "", nota: "" })
      await refresh()
    } catch (e) { toast.error(errMsg(e, "No se pudo registrar el pago")) } finally { setBusy(false) }
  }
  const anular = async () => {
    if (!void_ || !void_.motivo.trim()) return
    setBusy(true)
    try { await voidWorkOrderPayment(o.id_orden_servicio, void_.p.id_pago_servicio, void_.motivo.trim()); toast.success("Pago anulado con trazabilidad"); setVoid(null); await refresh() }
    catch (e) { toast.error(errMsg(e, "No se pudo anular el pago")) } finally { setBusy(false) }
  }
  return (
    <div className="pn">
      <div>
        <div className="sh" style={{ minHeight: 32 }}><span className="num">Pagado {money(o.adelanto)} de {money(m)}</span><small className="num">Saldo {money(s)}</small></div>
        <div className="bar" role="img" aria-label={`Pagado ${pct} %`}><i style={{ width: `${pct}%` }} /></div>
      </div>
      <WorkshopBilling order={o} refresh={refresh} />
      <div className="inl">
        <div className="sh" style={{ minHeight: 32 }}>Registrar pago</div>
        <div className="frm">
          <Fld label="Monto (S/)" req cls="s2"><input className="in num" inputMode="decimal" placeholder={f2(s)} value={f.monto} disabled={off} onChange={e => setF(c => ({ ...c, monto: e.target.value.replace(/[^\d.]/g, "") }))} /></Fld>
          <div className="fld s4"><span>Método <i>*</i></span><Opts label="Método de pago" value={f.metodo} onChange={v => setF(c => ({ ...c, metodo: v }))} items={METODO} /></div>
          <Fld label="Referencia" cls="s3"><input className="in" maxLength={100} placeholder="N.º de operación" value={f.referencia} disabled={off} onChange={e => setF(c => ({ ...c, referencia: e.target.value }))} /></Fld>
          <Fld label="Nota" cls="s3"><input className="in" maxLength={255} value={f.nota} disabled={off} onChange={e => setF(c => ({ ...c, nota: e.target.value }))} /></Fld>
          <div className="ft">
            <span className="hint">{off ? (s <= 0.001 ? "La orden no tiene saldo pendiente." : "No se registran pagos en una orden cancelada.") : <>Debe ser mayor que 0 y no superar el saldo pendiente ({money(s)}). <button type="button" className="lnk" style={{ minHeight: 44 }} onClick={() => setF(c => ({ ...c, monto: s.toFixed(2) }))}>Cobrar saldo completo</button></>}</span>
            <button type="button" className="btn" disabled={off || busy} onClick={add}>{I(Wallet, 16)}Registrar pago</button>
          </div>
        </div>
      </div>
      <div>
        <div className="sh">Pagos de la orden<small>{data.payments.length} movimiento(s)</small></div>
        {data.payments.length ? (
          <table className="tbl">
            <thead><tr><th>Fecha</th><th>Método</th><th>Referencia y nota</th><th className="r">Monto</th><th>Estado</th><th><span className="sr">Acciones</span></th></tr></thead>
            <tbody>{data.payments.map(p => (
              <tr key={p.id_pago_servicio}>
                <td className="num">{ft(p.creado_en)}</td><td><Tag>{METODO[p.metodo] || p.metodo}</Tag></td>
                <td><div className="a">{p.referencia || "Sin referencia"}</div><div className="b">{p.nota || ""}</div></td>
                <td className="r a num">{money(p.monto)}</td>
                <td>{p.estado === "confirmado" ? <span className="st ok">{I(CircleCheck, 14)}Confirmado</span> : <span className="st bad">{I(CircleAlert, 14)}Anulado</span>}</td>
                <td className="r">{p.estado === "confirmado" && <button type="button" className="btn out" onClick={() => setVoid({ p, motivo: "" })}>Anular pago</button>}</td>
              </tr>
            ))}</tbody>
          </table>
        ) : <div className="empty" style={{ minHeight: 100 }}>Sin pagos registrados.</div>}
      </div>
      {void_ && (
        <div className="inl">
          <div className="sh" style={{ minHeight: 32 }}>Anular el pago de {money(void_.p.monto)} ({METODO[void_.p.metodo] || void_.p.metodo}{void_.p.referencia ? ` . ${void_.p.referencia}` : ""})</div>
          <Fld label="Motivo de la anulación" req><textarea className="ta" maxLength={255} placeholder="Hasta 255 caracteres" value={void_.motivo} onChange={e => setVoid({ ...void_, motivo: e.target.value })} /></Fld>
          <div className="hint">Queda trazado: estado Anulado, quién y cuándo. El pagado baja a {money(Number(o.adelanto) - Number(void_.p.monto))} y el saldo sube a {money(s + Number(void_.p.monto))}. Si el pago es de una venta ya facturada, solo se anula por el flujo contable.</div>
          <div className="ra"><span className="sp" /><button type="button" className="btn out" onClick={() => setVoid(null)}>Cancelar</button><button type="button" className="btn dng" disabled={busy || !void_.motivo.trim()} onClick={anular}>Anular pago</button></div>
        </div>
      )}
    </div>
  )
}

/* ============ Evidencias ============ */
export function EvidenciasTab({ o, data, refresh }: TabProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [f, setF] = useState<{ archivo: File | null; etapa: WorkOrderEvidence["etapa"]; descripcion: string; nombre: string; dni: string }>({ archivo: null, etapa: "reparacion", descripcion: "", nombre: "", dni: "" })
  const [ret, setRet] = useState<{ e: WorkOrderEvidence; motivo: string } | null>(null)
  const [busy, setBusy] = useState(false)
  const sig = f.etapa.startsWith("firma_")
  const upload = async () => {
    if (!f.archivo) return toast.error("Selecciona un archivo")
    if (sig && !f.nombre.trim()) return toast.error("Registra el nombre de quien firma")
    setBusy(true)
    try {
      await addWorkOrderEvidence(o.id_orden_servicio, { archivo: f.archivo, etapa: f.etapa, descripcion: f.descripcion.trim() || undefined, firmante_nombre: sig ? f.nombre.trim() : undefined, firmante_dni: sig ? f.dni.trim() || undefined : undefined })
      toast.success("Evidencia agregada al expediente privado")
      setF({ archivo: null, etapa: "reparacion", descripcion: "", nombre: "", dni: "" })
      await refresh()
    } catch (e) { toast.error(errMsg(e, "No se pudo subir la evidencia")) } finally { setBusy(false) }
  }
  const retire = async () => {
    if (!ret || !ret.motivo.trim()) return
    try { await removeWorkOrderEvidence(o.id_orden_servicio, ret.e.id_evidencia_servicio, ret.motivo.trim()); toast.success("Evidencia retirada con trazabilidad"); setRet(null); await refresh() }
    catch (e) { toast.error(errMsg(e, "No se pudo retirar la evidencia")) }
  }
  const toggle = async (e: WorkOrderEvidence) => {
    try { await setWorkOrderEvidenceVisibility(o.id_orden_servicio, e.id_evidencia_servicio, !e.visible_cliente); toast.success(e.visible_cliente ? "Evidencia ocultada al cliente" : "Evidencia publicada en el seguimiento"); await refresh() }
    catch (er) { toast.error(errMsg(er, "No se pudo cambiar la visibilidad")) }
  }
  return (
    <div className="pn">
      <div className="inl">
        <div className="sh" style={{ minHeight: 32 }}>Adjuntar evidencia</div>
        <div className="frm">
          <Fld label="Etapa" req cls="s2">
            <select className="sl" value={f.etapa} onChange={e => setF(c => ({ ...c, etapa: e.target.value as typeof f.etapa, archivo: null }))}>
              {Object.entries(ETAPA).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
            </select>
          </Fld>
          {sig ? (
            <>
              <Fld label="Nombre del firmante" req cls="s2"><input className="in" value={f.nombre} onChange={e => setF(c => ({ ...c, nombre: e.target.value }))} /></Fld>
              <Fld label="DNI (opcional)" cls="s2"><input className="in" inputMode="numeric" value={f.dni} onChange={e => setF(c => ({ ...c, dni: e.target.value.replace(/\D/g, "").slice(0, 12) }))} /></Fld>
              <div className="fld s4"><span>Firma <i>*</i></span><SignaturePad onChange={archivo => setF(c => ({ ...c, archivo }))} /></div>
            </>
          ) : (
            <div className="fld s2"><span>Archivo <i>*</i></span>
              <button type="button" className="btn out" style={{ justifyContent: "flex-start" }} onClick={() => fileRef.current?.click()}>{I(Upload, 16)}{f.archivo ? f.archivo.name : "Elegir archivo"}</button>
              <input ref={fileRef} type="file" hidden accept="image/*,audio/*,application/pdf" onChange={e => setF(c => ({ ...c, archivo: e.target.files?.[0] || null }))} />
            </div>
          )}
          <Fld label="Descripción" cls="s2"><input className="in" value={f.descripcion} onChange={e => setF(c => ({ ...c, descripcion: e.target.value }))} /></Fld>
          <div className="ft">
            <span className="hint">Imagen, audio o PDF. Para firmas se pide nombre y DNI del firmante y la firma dibujada.</span>
            <button type="button" className="btn" disabled={busy || o.estado === "cancelado"} onClick={upload}>{I(Upload, 16)}Subir evidencia</button>
          </div>
        </div>
      </div>
      <div>
        <div className="sh">Evidencias de la orden<small>{data.evidence.length} archivo(s)</small></div>
        {data.evidence.length ? (
          <div className="grid3">{data.evidence.map(e => {
            const isSig = e.tipo === "firma"
            return (
              <div className="gc" key={e.id_evidencia_servicio}>
                <div className="ph">{I(isSig ? Pencil : ImageIcon, 24)}</div>
                <div className="a" style={{ fontWeight: 600, overflowWrap: "anywhere" }}>{e.nombre_original}</div>
                <div><Tag>{ETAPA[e.etapa] || e.etapa}</Tag></div>
                <div className="hint">{isSig ? `${e.firmante_nombre || ""}${e.firmante_dni ? ` . DNI ${e.firmante_dni}` : ""}` : e.descripcion}</div>
                <button type="button" className="sw" role="switch" aria-checked={!!e.visible_cliente} aria-disabled={isSig} onClick={() => { if (!isSig) void toggle(e) }}>
                  <span className="tr" />{isSig ? "Las firmas no se publican" : "Visible al cliente"}
                </button>
                <button type="button" className="btn out" onClick={() => void openWorkOrderEvidence(e)}>{I(ExternalLink, 16)}Abrir</button>
                <button type="button" className="btn out" onClick={() => setRet({ e, motivo: "" })}>Retirar</button>
              </div>
            )
          })}</div>
        ) : <div className="empty" style={{ minHeight: 100 }}>Sin evidencias.</div>}
        <div className="hint" style={{ marginTop: 8 }}>Cada archivo guarda su huella SHA-256 y su origen. Retirar exige un motivo.</div>
      </div>
      {ret && (
        <div className="inl">
          <div className="sh" style={{ minHeight: 32 }}>Retirar «{ret.e.nombre_original}»</div>
          <Fld label="Motivo" req><textarea className="ta" value={ret.motivo} onChange={e => setRet({ ...ret, motivo: e.target.value })} /></Fld>
          <div className="ra"><span className="sp" /><button type="button" className="btn out" onClick={() => setRet(null)}>Cancelar</button><button type="button" className="btn dng" disabled={!ret.motivo.trim()} onClick={retire}>Retirar evidencia</button></div>
        </div>
      )}
    </div>
  )
}

/* ============ Historial ============ */
export function HistorialTab({ data }: TabProps) {
  const l = [...data.history].sort((a, b) => String(b.creado_en).localeCompare(String(a.creado_en)))
  if (!l.length) return <Empty icon={I(Clock, 28)} title="Sin eventos" text="Los cambios de estado aparecen aquí." />
  return (
    <ol className="tl">
      {l.map(h => {
        const Icon = (ST[h.estado_nuevo || ""] || ST.recibido)[1]
        return (
          <li key={h.id_evento}>
            <span className="dot">{I(Icon, 16)}</span>
            <div>
              <div className="tt">{h.estado_anterior && h.estado_nuevo && h.estado_anterior !== h.estado_nuevo ? `${ST[h.estado_anterior]?.[0] || h.estado_anterior} -> ${ST[h.estado_nuevo]?.[0] || h.estado_nuevo}` : h.tipo === "edicion" ? "Datos actualizados" : ST[h.estado_nuevo || ""]?.[0] || h.tipo}</div>
              <div className="dd num">{ft(h.creado_en)}</div>
              <div>{h.detalle}</div>
            </div>
          </li>
        )
      })}
    </ol>
  )
}
