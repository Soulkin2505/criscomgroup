"use client"

// Seccion 3 - Pago: tarjetas-radio con la consecuencia exacta por metodo.
import { Banknote, Clock, CreditCard, Info, Landmark, QrCode, Smartphone, Wallet } from "lucide-react"
import RadioCard from "./RadioCard"
import type { LucideIcon } from "lucide-react"
import type { MetodoPago } from "./checkoutShared"
import { money } from "./checkoutShared"

// Yape vía Culqi ("cargo único") acepta hasta S/2,000 por pago; por encima el
// backend lo rechaza, así que se deshabilita antes de que el cliente lo intente.
export const YAPE_LIMITE = 2000
// Billetera digital usa "Órdenes de Pago" de Culqi: el mínimo real de la API
// es S/6 (confirmado contra la API); el máximo de S/500 no lo impone Culqi,
// es el límite práctico de las apps de Yape/Plin para pagar por QR.
export const BILLETERA_MIN = 6
export const BILLETERA_MAX = 500
// Cuotéalo (financiamiento BCP) acepta entre S/100 y S/50,000, según el manual
// de Culqi — confirmado también que la API acepta montos altos sin rechazarlos.
export const CUOTEALO_MIN = 100
export const CUOTEALO_MAX = 50000

// Rango de monto por método basado en Orden; null = sin tope documentado
// (PagoEfectivo no publica uno, así que no se bloquea por monto).
const RANGOS: Partial<Record<MetodoPago, [number, number]>> = {
  billetera_digital: [BILLETERA_MIN, BILLETERA_MAX],
  cuotealo: [CUOTEALO_MIN, CUOTEALO_MAX],
}

const METODOS: { value: MetodoPago; icon: LucideIcon; title: string; sub: string }[] = [
  { value: "yape", icon: Smartphone, title: "Yape", sub: "Se cobra automático con Culqi: ingresas tu código de aprobación de Yape." },
  { value: "billetera_digital", icon: QrCode, title: "Billetera digital", sub: "Plin, Yape u otra — escaneas un código QR desde tu app." },
  { value: "pago_efectivo", icon: Wallet, title: "PagoEfectivo", sub: "Pagas en un agente, bodega, banca móvil o desde la web, sin tarjeta." },
  { value: "cuotealo", icon: CreditCard, title: "Cuotéalo (BCP)", sub: "Financia tu compra con el BCP, sin necesitar tarjeta de crédito." },
  { value: "transferencia", icon: Landmark, title: "Transferencia bancaria", sub: "Queda pendiente de validación en el ERP." },
  { value: "tarjeta", icon: CreditCard, title: "Tarjeta de crédito o débito", sub: "Se abrirá Culqi para pagar. CRISCOM no almacena tu tarjeta." },
  { value: "contraentrega", icon: Banknote, title: "Contraentrega", sub: "Pagas al recibir tu pedido." },
]

const PayNote = ({ metodo }: { metodo: MetodoPago }) => {
  if (metodo === "tarjeta") {
    return (
      <>
        <p className="note">
          <CreditCard className="ck-ic" aria-hidden />
          <span>Al confirmar se abrirá Culqi para completar el pago. CRISCOM nunca almacena número ni CVV de tu tarjeta.</span>
        </p>
        <p className="note">
          <Info className="ck-ic" aria-hidden />
          <span>Recargo por tarjeta: 5 % solo sobre productos afiliados, calculado por el servidor.</span>
        </p>
      </>
    )
  }
  if (metodo === "yape") {
    return (
      <p className="note">
        <Smartphone className="ck-ic" aria-hidden />
        <span>Al confirmar se abrirá Culqi: ingresa tu celular y el código de aprobación de tu app Yape (válido 2 minutos). Acepta hasta {money(YAPE_LIMITE)}.</span>
      </p>
    )
  }
  if (metodo === "billetera_digital") {
    return (
      <p className="note">
        <QrCode className="ck-ic" aria-hidden />
        <span>Al confirmar se abrirá un código QR para escanear desde Plin, Yape u otra billetera. Acepta entre {money(BILLETERA_MIN)} y {money(BILLETERA_MAX)}. La confirmación puede tardar unos minutos; no vuelvas a pagar el mismo pedido.</span>
      </p>
    )
  }
  if (metodo === "pago_efectivo") {
    return (
      <p className="note">
        <Wallet className="ck-ic" aria-hidden />
        <span>Al confirmar se abrirá un código para pagar en un agente, bodega, banca móvil o internet. La confirmación llega cuando pagas, no al instante; no vuelvas a pagar el mismo pedido.</span>
      </p>
    )
  }
  if (metodo === "cuotealo") {
    return (
      <p className="note">
        <CreditCard className="ck-ic" aria-hidden />
        <span>Te redirige a Cuotéalo del BCP: necesitas cuenta corriente o de ahorros en el BCP. Acepta entre {money(CUOTEALO_MIN)} y {money(CUOTEALO_MAX)}. El BCP confirma el financiamiento al instante si calificas.</span>
      </p>
    )
  }
  if (metodo === "contraentrega") return null
  return (
    <p className="note">
      <Clock className="ck-ic" aria-hidden />
      <span>Queda pendiente de validación del ERP: tu pedido pasa a «Pendiente de pago» hasta que se valide. Esta pantalla no valida ningún pago.</span>
    </p>
  )
}

interface Props {
  metodo: MetodoPago
  onChange: (metodo: MetodoPago) => void
  total: number
}

const PaymentSection = ({ metodo, onChange, total }: Props) => {
  const yapeExcedeTope = total > YAPE_LIMITE
  return (
    <section className="card" id="ck-pago" aria-labelledby="ck-pago-t">
      <h2 className="sh" id="ck-pago-t"><span className="numball" aria-hidden>3</span>Pago</h2>
      <div className="opts" role="radiogroup" aria-label="Método de pago">
        {METODOS.map((m) => {
          const rango = RANGOS[m.value]
          const fueraDeRango = rango ? total < rango[0] || total > rango[1] : false
          const disabled = (m.value === "yape" && yapeExcedeTope) || fueraDeRango
          const sub = m.value === "yape" && disabled
            ? `Disponible hasta ${money(YAPE_LIMITE)}. Tu compra supera ese monto: elige otro método.`
            : rango && disabled
            ? `Disponible entre ${money(rango[0])} y ${money(rango[1])}. Elige otro método para este monto.`
            : m.sub
          return (
            <RadioCard
              key={m.value}
              name="metodo_pago" value={m.value} icon={m.icon}
              title={m.title}
              sub={sub}
              checked={metodo === m.value}
              disabled={disabled}
              onChange={(v) => onChange(v as MetodoPago)}
            />
          )
        })}
      </div>
      <PayNote metodo={metodo} />
    </section>
  )
}

export default PaymentSection
