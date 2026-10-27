"use client"

// payment-error: estado, Reintentar pago (reintentar-pago), Volver al catalogo y WhatsApp.
// Sin "razones comunes" inventadas: solo lo que el backend sabe.
// Reintentar pago requiere sesion (el backend valida propiedad del pedido, 401 sin token).
import { useEffect, useState } from "react"
import { useRouter, useSearchParams } from "next/navigation"
import Link from "next/link"
import { Loader, MessageCircle, RotateCcw, ShoppingBag, XCircle } from "lucide-react"
import { orderService } from "@/services/orderService"
import { ecommerceAuthService } from "@/services/ecommerceApi"
import { requestCulqiPayment, type CulqiOrderMetodo } from "@/lib/culqi"
import { getErrorMessage } from "@/lib/getErrorMessage"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import { chipOf, ESTADO_PAGO, ESTADO_PEDIDO, money, waAyuda } from "./checkoutShared"
import "@/styles/checkout.css"

const METODOS_CON_ORDEN: Array<CulqiOrderMetodo> = ["billetera_digital", "pago_efectivo", "cuotealo"]

const PaymentErrorView = () => {
  const router = useRouter()
  const searchParams = useSearchParams()
  const config = useConfigPublica()
  const numero = searchParams.get("pedido") || searchParams.get("order") || ""
  const idPedido = Number(searchParams.get("id") || 0)
  const errorParam = searchParams.get("error") || ""
  const [chips, setChips] = useState<{ estado: string; estado_pago: string; metodo_pago: string; total_final: string } | null>(null)
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [retrying, setRetrying] = useState(false)
  const [retryError, setRetryError] = useState("")

  useEffect(() => {
    setIsAuthenticated(ecommerceAuthService.isAuthenticated())
  }, [])

  useEffect(() => {
    if (!numero) return
    orderService.trackOrder(numero)
      .then((r) => { if (r?.success) setChips({ estado: r.pedido.estado, estado_pago: r.pedido.estado_pago, metodo_pago: r.pedido.metodo_pago, total_final: r.pedido.total_final }) })
      .catch(() => setChips(null))
  }, [numero])

  const waUrl = waAyuda(config?.whatsapp_number, numero)

  const reintentar = async () => {
    if (retrying || !idPedido) return
    setRetrying(true)
    setRetryError("")
    try {
      const reissue = await orderService.reissuePaymentToken(idPedido)
      if (!reissue.success) throw new Error(reissue.message || "No se pudo iniciar el pago")
      const publicKey = reissue.culqi_public_key || process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY
      const ordenMetodo = METODOS_CON_ORDEN.includes(chips?.metodo_pago as CulqiOrderMetodo) ? (chips?.metodo_pago as CulqiOrderMetodo) : undefined
      const result = await requestCulqiPayment({ total_final: chips?.total_final || 0, cliente_email: "" }, publicKey, reissue.culqi_order_id, ordenMetodo)
      if (result.kind === "order") {
        router.push(`/order-confirmation/${encodeURIComponent(numero)}?pago=verificacion`)
        return
      }
      const paymentResult = await orderService.payWithCulqi(idPedido, result.id, reissue.payment_token)
      if (paymentResult.pending_reconciliation) {
        router.push(`/order-confirmation/${encodeURIComponent(numero)}?pago=verificacion`)
      } else {
        router.push(`/payment-success?pedido=${encodeURIComponent(numero)}`)
      }
    } catch (error: unknown) {
      const message = getErrorMessage(error, "intenta nuevamente")
      if (message !== "Pago cancelado") setRetryError(message)
    } finally {
      setRetrying(false)
    }
  }

  const renderChip = (mapKey: string, map: typeof ESTADO_PEDIDO) => {
    const def = chipOf(map, mapKey)
    const Icon = def.icon
    return <span className={`chip ${def.kind}`}><Icon className="ck-ic" aria-hidden />{def.label}</span>
  }

  return (
    <div className="pg-checkout">
      <main className="narrow">
        <section className="card">
          <span className="st err"><XCircle className="ck-ic" aria-hidden /></span>
          <h1>No se pudo completar el pago</h1>
          {numero ? (
            <div>
              <span className="lab" style={{ color: "var(--muted-foreground)", fontWeight: 400 }}>Pedido</span>
              <div className="onum tn">{numero}</div>
            </div>
          ) : null}
          {chips ? (
            <div className="chips">
              <div><span className="lab">Estado</span>{renderChip(chips.estado, ESTADO_PEDIDO)}</div>
              <div><span className="lab">Pago</span>{renderChip(chips.estado_pago, ESTADO_PAGO)}</div>
            </div>
          ) : null}
          <p>El pago no se completó y tu pedido sigue pendiente de pago. Puedes reintentar el pago.</p>
          {errorParam ? <p role="alert" style={{ color: "var(--destructive-text)" }}>{errorParam}</p> : null}
          {chips ? (
            <dl className="kv">
              <div className="tt" style={{ border: 0, padding: 0 }}>
                <dt>Total</dt><dd className="tn">{money(chips.total_final)}</dd>
              </div>
            </dl>
          ) : null}
          {retryError ? <p role="alert" style={{ color: "var(--destructive-text)" }}>No se pudo completar el pago: {retryError}</p> : null}
          <div className="acts">
            {idPedido > 0 ? (
              isAuthenticated ? (
                <button className="btn btn-p" type="button" onClick={reintentar} disabled={retrying} aria-busy={retrying}>
                  {retrying ? <Loader className="ck-ic spin" aria-hidden /> : <RotateCcw className="ck-ic" aria-hidden />}
                  {retrying ? "Reintentando…" : "Reintentar pago"}
                </button>
              ) : (
                <>
                  <button className="btn btn-p" type="button" disabled title="Inicia sesión para reintentar el pago">
                    <RotateCcw className="ck-ic" aria-hidden />Reintentar pago
                  </button>
                  <p className="fine" style={{ margin: 0 }}>
                    Para reintentar el pago necesitas <Link className="lnki" href="/iniciar-sesion">iniciar sesión</Link>.
                  </p>
                </>
              )
            ) : null}
            <Link className="btn btn-s" href="/catalogo"><ShoppingBag className="ck-ic" aria-hidden />Volver al catálogo</Link>
            {waUrl
              ? <a className="btn btn-wa" href={waUrl} target="_blank" rel="noopener noreferrer"><MessageCircle className="ck-ic" aria-hidden />Escribir por WhatsApp</a>
              : null}
          </div>
        </section>
      </main>
    </div>
  )
}

export default PaymentErrorView
