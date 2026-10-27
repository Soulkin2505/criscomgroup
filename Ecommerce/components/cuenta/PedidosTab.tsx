"use client"

// Pestaña Mis pedidos: tarjeta por pedido con chips estado + pago, total grande
// y "Ver seguimiento" a /seguimiento con el código puesto. Conserva el flujo de
// pago con tarjeta (Culqi) de la página anterior, con avisos inline (sin alert()).
import { useState } from "react"
import Link from "next/link"
import { ArrowRight, ShoppingBag, CircleCheck, CircleAlert } from "lucide-react"
import { orderService } from "@/services/orderService"
import { requestCulqiPayment, type CulqiOrderMetodo } from "@/lib/culqi"
import { getErrorMessage } from "@/lib/getErrorMessage"
import type { PedidoCuenta } from "./cuentaApi"
import { Chip, Cargando, ErrorCarga } from "./CuentaBits"
import {
  fmtMoney, fmtFecha, METODO_PAGO_LABEL, TIPO_ENTREGA_LABEL, COMPROBANTE_LABEL,
} from "./cuentaShared"

type AvisoPago = { tipo: "ok" | "err"; texto: string }
const METODOS_CON_ORDEN: Array<CulqiOrderMetodo> = ["billetera_digital", "pago_efectivo", "cuotealo"]

const PedidosTab = ({
  pedidos, error, onRetry,
}: {
  pedidos: PedidoCuenta[] | null
  error: boolean
  onRetry: () => void
}) => {
  const [payingId, setPayingId] = useState<number | null>(null)
  const [avisoPago, setAvisoPago] = useState<Record<number, AvisoPago>>({})

  if (error) {
    return (
      <ErrorCarga
        titulo="No pudimos cargar tus pedidos"
        detalle="Esto no significa que no tengas pedidos: la consulta falló. Revisa tu conexión e inténtalo de nuevo."
        onRetry={onRetry}
      />
    )
  }
  if (!pedidos) return <Cargando texto="Cargando tus pedidos…" />
  if (pedidos.length === 0) {
    return (
      <div className="card empty">
        <ShoppingBag size={28} strokeWidth={1.75} aria-hidden />
        <h2>Aún no tienes pedidos</h2>
        <p className="mut">Cuando compres en la tienda, tus pedidos aparecerán aquí.</p>
        <Link className="btn p" href="/catalogo">Ir al catálogo</Link>
      </div>
    )
  }

  const handlePagarAhora = async (pedido: PedidoCuenta) => {
    setPayingId(pedido.id_pedido)
    try {
      const reissue = await orderService.reissuePaymentToken(pedido.id_pedido)
      if (!reissue.success) throw new Error(reissue.message || "No se pudo iniciar el pago")
      const publicKey = reissue.culqi_public_key || process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY
      const ordenMetodo = METODOS_CON_ORDEN.includes(pedido.metodo_pago as CulqiOrderMetodo) ? (pedido.metodo_pago as CulqiOrderMetodo) : undefined
      const result = await requestCulqiPayment(
        { total_final: Number(pedido.total_final), cliente_email: pedido.cliente_email },
        publicKey,
        reissue.culqi_order_id,
        ordenMetodo,
      )
      if (result.kind === "order") {
        setAvisoPago((m) => ({ ...m, [pedido.id_pedido]: { tipo: "ok", texto: `Pedido ${pedido.numero_pedido}: paga el QR desde tu billetera. Confirmamos apenas se acredite.` } }))
        await onRetry()
        return
      }
      const paymentResult = await orderService.payWithCulqi(pedido.id_pedido, result.id, reissue.payment_token)
      if (paymentResult.pending_reconciliation) {
        setAvisoPago((m) => ({ ...m, [pedido.id_pedido]: { tipo: "ok", texto: `Tu pago quedó en verificación para el pedido ${pedido.numero_pedido}.` } }))
      } else if (paymentResult.success) {
        setAvisoPago((m) => ({ ...m, [pedido.id_pedido]: { tipo: "ok", texto: `Pago realizado. Pedido ${pedido.numero_pedido} confirmado.` } }))
      }
      await onRetry()
    } catch (e: unknown) {
      const message = getErrorMessage(e, "intenta nuevamente")
      if (message !== "Pago cancelado") {
        setAvisoPago((m) => ({ ...m, [pedido.id_pedido]: { tipo: "err", texto: `No se pudo completar el pago: ${message}` } }))
      }
    } finally {
      setPayingId(null)
    }
  }

  return (
    <div className="stack">
      {pedidos.map((pedido) => {
        const unidades = pedido.detalles.reduce((a, d) => a + Number(d.cantidad), 0)
        const puedePagar = pedido.estado_pago === "pendiente" && ["tarjeta", "yape", ...METODOS_CON_ORDEN].includes(pedido.metodo_pago)
        const aviso = avisoPago[pedido.id_pedido]
        const meta = [
          METODO_PAGO_LABEL[pedido.metodo_pago] ?? pedido.metodo_pago,
          TIPO_ENTREGA_LABEL[pedido.tipo_entrega] ?? pedido.tipo_entrega,
          pedido.tipo_comprobante ? COMPROBANTE_LABEL[pedido.tipo_comprobante] ?? pedido.tipo_comprobante : null,
        ].filter(Boolean).join(" · ")
        return (
          <article className="card" key={pedido.id_pedido}>
            <div className="ph2">
              <span className="no mono">{pedido.numero_pedido}</span>
              <small className="mut num meta">{`${fmtFecha(pedido.fecha_creacion)} · ${meta}`}</small>
              <span style={{ display: "flex", gap: 8, flexWrap: "wrap", marginLeft: "auto" }}>
                <Chip estado={pedido.estado} />
                <Chip estado={pedido.estado_pago} texto={pedido.estado_pago === "pendiente" ? "Pago: Pendiente" : undefined} />
              </span>
            </div>
            {pedido.detalles.map((d) => (
              <div className="pl" key={d.id_detalle}>
                <div>
                  <b>{d.producto_nombre}</b>
                  <small className="mut">
                    {[d.condicion === "segunda_mano" ? "De segunda" : "Nuevo",
                      d.garantia_meses ? `garantía de ${d.garantia_meses} meses` : null,
                    ].filter(Boolean).join(" · ")}
                  </small>
                </div>
                <span className="num mut pu">{`${d.cantidad} × ${fmtMoney(d.precio_unitario_con_igv)}`}</span>
                <span className="r num"><b>{fmtMoney(d.subtotal_con_igv)}</b></span>
              </div>
            ))}
            {aviso && (
              <div style={{ padding: "12px 20px", borderTop: "1px solid var(--border)" }}>
                {aviso.tipo === "ok" ? (
                  <p className="hint" role="status"><CircleCheck size={14} strokeWidth={1.75} aria-hidden />{aviso.texto}</p>
                ) : (
                  <p className="err" role="alert"><CircleAlert size={14} strokeWidth={1.75} aria-hidden />{aviso.texto}</p>
                )}
              </div>
            )}
            <div className="pf">
              <div>
                <p className="mut num">
                  {`${pedido.detalles.length} ${pedido.detalles.length === 1 ? "producto" : "productos"} (${unidades} ${unidades === 1 ? "unidad" : "unidades"}) · Envío ${fmtMoney(pedido.costo_envio ?? 0)}`}
                </p>
              </div>
              <div className="acc">
                <div className="tt">
                  <p className="mut" style={{ fontSize: 13 }}>Total</p>
                  <p className="tot num">{fmtMoney(pedido.total_final)}</p>
                </div>
                {puedePagar && (
                  <button
                    className="btn p"
                    type="button"
                    disabled={payingId === pedido.id_pedido}
                    onClick={() => handlePagarAhora(pedido)}
                  >
                    {payingId === pedido.id_pedido ? "Procesando…" : "Pagar ahora"}
                  </button>
                )}
                <Link className={puedePagar ? "btn o" : "btn p"} href={`/seguimiento?codigo=${encodeURIComponent(pedido.numero_pedido)}`}>
                  Ver seguimiento
                  <ArrowRight size={16} strokeWidth={1.75} aria-hidden />
                </Link>
              </div>
            </div>
          </article>
        )
      })}
    </div>
  )
}

export default PedidosTab
