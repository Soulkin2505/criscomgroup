// Entrada fina de /servicio-tecnico (port criscom-ecom-servicios): el formulario
// vive en components/servicios/ServicioTecnicoForm.
import type { Metadata } from "next"
import Link from "next/link"
import { ArrowRight } from "lucide-react"
import ServicioTecnicoForm from "@/components/servicios/ServicioTecnicoForm"

export const metadata: Metadata = {
  title: "Servicio técnico",
  description: "Deja tu equipo para revisión: PC, laptop, celular, monitor, impresora o consola. Te contactamos para coordinar el ingreso.",
}

export default function ServicioTecnicoPage() {
  return (
    <div className="pg-servicios technical-page">
      <div className="cx">
        <header className="hd">
          <div className="service-intro">
            <p className="service-eyebrow">SERVICIO TÉCNICO CRISCOM</p>
            <h1>Volvamos a poner tu equipo en marcha.</h1>
            <p>Cuéntanos qué sucede. Te contactaremos para coordinar el ingreso y la revisión de tu equipo.</p>
          </div>
          <Link className="btn out" href="/servicio-tecnico/seguimiento">
            <span>Tengo una orden: consultar con mi token</span>
            <ArrowRight size={18} className="ic" aria-hidden />
          </Link>
        </header>
        <ServicioTecnicoForm />
      </div>
    </div>
  )
}
