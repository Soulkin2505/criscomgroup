import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { toast } from 'sonner'
import api from '../../../lib/api'
import { useAuth } from '../../../contexts/AuthContext'
import type { WorkOrder } from '../../../services/workOrderService'
import { money, errMsg } from './shared'

type Summary = { productos: number; honorarios: number; venta_id?: number; puede_emitir_productos: boolean; estado_productos: string; documento_productos?: string; referencia_honorarios?: string; modo_sunat: string }
export function WorkshopBilling({ order, refresh }: { order: WorkOrder; refresh: () => Promise<unknown> }) {
  const { user } = useAuth()
  const [reference, setReference] = useState('')
  const [busy, setBusy] = useState(false)
  const { data, isError, refetch } = useQuery({ queryKey: ['workshop-billing', order.id_orden_servicio, order.venta_id, order.adelanto], queryFn: async () => (await api.get<Summary>(`/ordenes-servicio/${order.id_orden_servicio}/facturacion`)).data })
  const action = async (url: string, body: object = {}) => {
    setBusy(true)
    try {
      const response = await api.post(url, body)
      if (response.data.success === false) throw new Error(response.data.documento?.mensaje || 'Comprobante rechazado')
      toast.success(response.data.sandbox ? 'Comprobante de prueba: sin validez fiscal' : response.data.message || 'Operación completada')
      await refetch(); await refresh()
    } catch (e) { toast.error(errMsg(e, 'No se pudo completar la operación')) } finally { setBusy(false) }
  }
  if (isError) return <p role="alert">No se pudo revisar el desglose fiscal de esta orden.</p>
  if (!data) return <p>Cargando desglose…</p>
  return <section className="inl" aria-label="Comprobantes de la orden">
    <div className="sh">Ticket mixto y comprobantes</div>
    <p className="hint">Un ticket interno reúne productos y mano de obra. Sus comprobantes fiscales se gestionan por separado.</p>
    <p>Productos: <strong>{money(data.productos)}</strong> · {data.documento_productos || (data.productos ? data.estado_productos : 'No corresponde')}{data.modo_sunat !== 'production' && ' · Modo de pruebas'}</p>
    {data.puede_emitir_productos && [1, 2, 3].includes(user?.id_role ?? 0) && <button type="button" className="btn out" disabled={busy} onClick={() => action(`/facturacion/emitir/${data.venta_id}`)}>Emitir comprobante de productos</button>}
    <p>Honorarios: <strong>{money(data.honorarios)}</strong> · {data.honorarios ? data.referencia_honorarios ? `Referencia registrada: ${data.referencia_honorarios} (sin validación SUNAT)` : 'Pendiente de emisión en SUNAT' : 'No corresponde'}</p>
    {data.honorarios > 0 && order.venta_id && <div className="frm">
      <label className="fld s6">Número del RHE emitido en SUNAT<input className="in" placeholder="E001-123" maxLength={13} value={reference} onChange={e => setReference(e.target.value.toUpperCase())} /></label>
      <button type="button" className="btn out" disabled={busy || !/^E001-\d{1,8}$/.test(reference)} onClick={() => action(`/ordenes-servicio/${order.id_orden_servicio}/honorarios/referencia`, { referencia: reference })}>Guardar referencia</button>
    </div>}
    <p className="hint">El facturador actual no emite recibos por honorarios. Guardar el número no valida ni emite el documento.</p>
    <button type="button" className="btn out" disabled={busy} onClick={() => action(`/ordenes-servicio/${order.id_orden_servicio}/ticket/correo`)}>Enviar ticket al correo del cliente</button>
  </section>
}
