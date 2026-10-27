"use client"

// Checkout (port criscom-ecom-checkout): contacto, entrega, pago, comprobante, notas.
// El servidor recalcula todo; el resumen es informativo. Un solo envio por pedido.
import { useEffect, useRef, useState } from "react"
import { useRouter } from "next/navigation"
import { AlertCircle, Loader, ShoppingBag, ShoppingCart } from "lucide-react"
import Link from "next/link"
import { cartService, type CartItem } from "@/services/cartService"
import { orderService, type CreateOrderRequest } from "@/services/orderService"
import { ecommerceAuthService } from "@/services/ecommerceApi"
import { requestCulqiPayment, type CulqiOrderMetodo } from "@/lib/culqi"
import { getErrorMessage } from "@/lib/getErrorMessage"
import { useConfigPublica } from "@/hooks/useSocialLinks"
import ContactSection from "./ContactSection"
import DeliverySection from "./DeliverySection"
import PaymentSection, { BILLETERA_MAX, BILLETERA_MIN, CUOTEALO_MAX, CUOTEALO_MIN, YAPE_LIMITE } from "./PaymentSection"
import { NotesSection, ReceiptSection } from "./ReceiptSection"
import { calcTotals, SummaryAside, SummaryMobile } from "./OrderSummary"
import { waAyuda, type MetodoPago, type Quote } from "./checkoutShared"
import "@/styles/checkout.css"

export type CheckoutForm = Omit<CreateOrderRequest, "items" | "metodo_pago"> & { metodo_pago: MetodoPago }
export type CheckoutErrors = Partial<Record<"cliente_nombre" | "cliente_email" | "cliente_telefono" | "direccion_departamento" | "direccion_provincia" | "direccion_distrito" | "direccion_envio" | "ruc" | "razon_social", string>>

// Métodos que Culqi resuelve con una Orden (creada y confirmada por el
// backend antes de abrir el checkout), en vez de un token del navegador.
const METODOS_CON_ORDEN: MetodoPago[] = ["billetera_digital", "pago_efectivo", "cuotealo"]

const INITIAL: CheckoutForm = {
  cliente_email: "", cliente_nombre: "", cliente_telefono: "",
  tipo_entrega: "domicilio", metodo_pago: "yape",
  requiere_factura: false, tipo_comprobante: "boleta",
}

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/
const TEL_RE = /^\+?[0-9\s-]{7,20}$/

const validate = (form: CheckoutForm, quote: Quote | null, quoteLoading: boolean, quoteError: string): CheckoutErrors => {
  const e: CheckoutErrors = {}
  if (!form.cliente_nombre.trim()) e.cliente_nombre = "Ingresa tu nombre completo."
  if (!EMAIL_RE.test(form.cliente_email.trim())) e.cliente_email = "Ingresa un correo válido, por ejemplo tucorreo@ejemplo.com."
  if (!TEL_RE.test(form.cliente_telefono.trim())) e.cliente_telefono = "Ingresa un teléfono válido, por ejemplo +51 900 000 000."
  if (form.tipo_entrega === "domicilio") {
    if (!form.direccion_departamento?.trim()) e.direccion_departamento = "Obligatorio para el envío."
    if (!form.direccion_provincia?.trim()) e.direccion_provincia = "Obligatorio para el envío."
    if (!form.direccion_distrito?.trim()) e.direccion_distrito = "Obligatorio para el envío."
    if (!form.direccion_envio?.trim()) e.direccion_envio = "Obligatorio para el envío."
    else if (quoteError) e.direccion_envio = quoteError
    else if (quoteLoading || !quote) e.direccion_envio = "Espera a que termine la cotización del envío."
  }
  if (form.tipo_comprobante === "factura") {
    const ruc = (form.cliente_documento_numero || "").trim()
    if (!/^\d{11}$/.test(ruc)) e.ruc = `El RUC debe tener 11 dígitos; ingresaste ${ruc.length}.`
    if (!form.razon_social?.trim()) e.razon_social = "Ingresa la razón social como figura en la SUNAT."
  }
  return e
}

const CheckoutPage = () => {
  const router = useRouter()
  const config = useConfigPublica()
  const formRef = useRef<HTMLFormElement>(null)
  const [mounted, setMounted] = useState(false)
  const [cartItems, setCartItems] = useState<CartItem[]>([])
  const [cartReady, setCartReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState("")
  const [form, setForm] = useState<CheckoutForm>(INITIAL)
  const [errors, setErrors] = useState<CheckoutErrors>({})
  const [quote, setQuote] = useState<Quote | null>(null)
  const [quoteLoading, setQuoteLoading] = useState(false)
  const [quoteError, setQuoteError] = useState("")

  useEffect(() => { setMounted(true) }, [])

  // Carga del carrito (localStorage) y prellenado si hay sesion; sin alertas.
  useEffect(() => {
    if (!mounted) return
    try {
      const raw = localStorage.getItem("catalogo_cart_items")
      const cart = raw ? JSON.parse(raw) : []
      if (Array.isArray(cart)) setCartItems(cart)
      const user = ecommerceAuthService.getCurrentUser()
      if (user) {
        setForm((prev) => ({
          ...prev,
          cliente_email: user.email || prev.cliente_email,
          cliente_nombre: user.name || prev.cliente_nombre,
          cliente_telefono: user.celular || prev.cliente_telefono,
        }))
      }
    } catch {
      setCartItems([])
    } finally {
      setCartReady(true)
    }
  }, [mounted])

  const update = <K extends keyof CheckoutForm>(key: K, value: CheckoutForm[K]) => {
    setForm((prev) => ({ ...prev, [key]: value }))
    setErrors((prev) => {
      const next = { ...prev }
      delete next[key as keyof CheckoutErrors]
      if (key === "cliente_documento_numero" || key === "tipo_comprobante") delete next.ruc
      return next
    })
  }

  // Cotizacion de envio en vivo (debounce 600ms). Nunca "GRATIS" sin cotizar.
  useEffect(() => {
    if (form.tipo_entrega !== "domicilio") {
      setQuote({ amount: 0, zone: "recojo_tienda", distance_km: null })
      setQuoteError("")
      return
    }
    if (!form.direccion_envio || !form.direccion_departamento || !form.direccion_provincia || !form.direccion_distrito) {
      setQuote(null)
      setQuoteError("")
      return
    }
    const timer = window.setTimeout(async () => {
      setQuoteLoading(true)
      setQuoteError("")
      try {
        const result = await orderService.getShippingQuote({
          tipo_entrega: form.tipo_entrega,
          direccion_envio: form.direccion_envio,
          direccion_departamento: form.direccion_departamento,
          direccion_provincia: form.direccion_provincia,
          direccion_distrito: form.direccion_distrito,
        })
        setQuote(result)
      } catch (error: unknown) {
        setQuote(null)
        setQuoteError(getErrorMessage(error, "No pudimos ubicar esta dirección: agrega avenida, número y distrito."))
      } finally {
        setQuoteLoading(false)
      }
    }, 600)
    return () => window.clearTimeout(timer)
  }, [form.tipo_entrega, form.direccion_envio, form.direccion_departamento, form.direccion_provincia, form.direccion_distrito])

  const totals = calcTotals(cartItems, form.tipo_entrega, quote, form.metodo_pago)
  const waUrl = waAyuda(config?.whatsapp_number, "")

  // Yape vía Culqi tiene un tope de S/2,000; si el carrito ya lo supera (o creció
  // por encima tras elegir Yape), no dejamos ese método seleccionado en silencio.
  useEffect(() => {
    if (form.metodo_pago === "yape" && totals.total > YAPE_LIMITE) {
      update("metodo_pago", "tarjeta")
    }
    if (form.metodo_pago === "billetera_digital" && (totals.total < BILLETERA_MIN || totals.total > BILLETERA_MAX)) {
      update("metodo_pago", "tarjeta")
    }
    if (form.metodo_pago === "cuotealo" && (totals.total < CUOTEALO_MIN || totals.total > CUOTEALO_MAX)) {
      update("metodo_pago", "tarjeta")
    }
  }, [form.metodo_pago, totals.total])

  // Un solo envio: validacion de cliente por campo; error del servidor arriba (400).
  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (busy) return
    setServerError("")
    const found = validate(form, quote, quoteLoading, quoteError)
    setErrors(found)
    if (Object.keys(found).length > 0) {
      const first = document.querySelector(".pg-checkout .fld.err input, .pg-checkout .fld.err select") as HTMLElement | null
      first?.focus()
      first?.scrollIntoView({ block: "center", behavior: "smooth" })
      return
    }
    setBusy(true)
    try {
      const orderData: CreateOrderRequest = {
        ...form,
        items: cartItems.map((item) => ({ productId: item.productId, quantity: item.quantity })),
      }
      const response = await orderService.createOrder(orderData)
      if (response.success) {
        const numero = response.pedido.numero_pedido as string
        const pagaPorCulqi = ["tarjeta", "yape", ...METODOS_CON_ORDEN].includes(form.metodo_pago)
        if (pagaPorCulqi && response.payment_required) {
          try {
            const publicKey = response.culqi_public_key || process.env.NEXT_PUBLIC_CULQI_PUBLIC_KEY
            const ordenMetodo = METODOS_CON_ORDEN.includes(form.metodo_pago) ? (form.metodo_pago as CulqiOrderMetodo) : undefined
            const result = await requestCulqiPayment(response.pedido, publicKey, response.culqi_order_id, ordenMetodo)
            if (result.kind === "order") {
              // Métodos basados en Orden: ya está confirmada en Culqi, pero el
              // pago llega después por webhook (el cliente puede tardar en
              // pagar el QR o el código). No hay nada más que enviar aquí.
              await cartService.clearCart()
              router.push(`/order-confirmation/${numero}?pago=verificacion`)
              return
            }
            const paymentResult = await orderService.payWithCulqi(response.pedido.id_pedido, result.id, response.payment_token)
            await cartService.clearCart()
            if (paymentResult.pending_reconciliation) {
              router.push(`/order-confirmation/${numero}?pago=verificacion`)
            } else {
              router.push(`/payment-success?pedido=${encodeURIComponent(numero)}`)
            }
          } catch (paymentError: unknown) {
            // El pedido ya quedo creado (pendiente de pago); el carrito NO se limpia.
            const message = getErrorMessage(paymentError, "intenta nuevamente")
            if (message === "Pago cancelado") {
              router.push(`/order-confirmation/${numero}?pago=pendiente`)
            } else {
              router.push(`/payment-error?pedido=${encodeURIComponent(numero)}&id=${response.pedido.id_pedido}&error=${encodeURIComponent(message)}`)
            }
          }
        } else if (METODOS_CON_ORDEN.includes(form.metodo_pago) && response.billetera_setup_error) {
          // El pedido se creó pero Culqi no pudo generar la orden de pago todavía.
          await cartService.clearCart()
          router.push(`/payment-error?pedido=${encodeURIComponent(numero)}&id=${response.pedido.id_pedido}&error=${encodeURIComponent(response.billetera_setup_error)}`)
        } else {
          await cartService.clearCart()
          router.push(`/order-confirmation/${numero}`)
        }
        return
      }
      setServerError(response.message || "No pudimos crear tu pedido.")
      window.scrollTo({ top: 0, behavior: "smooth" })
    } catch (error: unknown) {
      setServerError(getErrorMessage(error, "Error al procesar el pedido"))
      window.scrollTo({ top: 0, behavior: "smooth" })
    } finally {
      setBusy(false)
    }
  }

  if (!cartReady) {
    return (
      <div className="pg-checkout">
        <div className="empty" role="status">
          <span className="big"><Loader className="ck-ic spin" aria-hidden /></span>
          <p>Cargando tu carrito…</p>
        </div>
      </div>
    )
  }

  if (cartItems.length === 0) {
    return (
      <div className="pg-checkout">
        <main className="empty">
          <span className="big"><ShoppingCart className="ck-ic" aria-hidden /></span>
          <h1>Tu carrito está vacío</h1>
          <p>Agrega productos para continuar con tu compra.</p>
          <Link className="btn btn-p" href="/catalogo" style={{ marginTop: 8 }}>
            <ShoppingBag className="ck-ic" aria-hidden />Ir al catálogo
          </Link>
        </main>
      </div>
    )
  }

  const dirError = errors.direccion_envio || (quoteError && form.tipo_entrega === "domicilio" ? quoteError : undefined)
  const summaryProps = {
    items: cartItems,
    totals,
    quoteLoading,
    recojo: form.tipo_entrega === "recojo_tienda",
    busy,
    waUrl,
    onSubmit: () => formRef.current?.requestSubmit(),
  }

  return (
    <div className="pg-checkout">
      <main className="ck-wrap">
        <div className="ck-titlebar">
          <h1>Finalizar compra</h1>
          <p className="sub">{cartItems.reduce((a, i) => a + i.quantity, 0)} productos · Total final confirmado por el servidor</p>
        </div>

        {serverError ? (
          <div className="alert" role="alert">
            <AlertCircle className="ck-ic" aria-hidden />
            <div className="grow"><b>No pudimos crear tu pedido</b><p>{serverError}</p></div>
            <a href="#ck-resumen">Ir al resumen</a>
          </div>
        ) : null}

        <SummaryMobile {...summaryProps} />

        <form ref={formRef} onSubmit={handleSubmit} noValidate>
          <div className="grid">
            <div className="form">
              <ContactSection form={form} errors={errors} update={update} />
              <DeliverySection
                form={form}
                errors={{ ...errors, direccion_envio: dirError }}
                update={update}
                quote={form.tipo_entrega === "domicilio" ? quote : null}
                quoteLoading={quoteLoading}
                quoteError={quoteError}
                config={config}
              />
              <PaymentSection metodo={form.metodo_pago} onChange={(m) => update("metodo_pago", m)} total={totals.total} />
              <ReceiptSection form={form} errors={errors} update={update} />
              <NotesSection form={form} update={update} />
            </div>
            <div id="ck-resumen"><SummaryAside {...summaryProps} /></div>
          </div>
        </form>
      </main>
    </div>
  )
}

export default CheckoutPage
