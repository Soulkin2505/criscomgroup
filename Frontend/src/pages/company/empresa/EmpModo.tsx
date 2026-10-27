import { useState } from "react"
import { CircleCheck, Clock, FlaskConical, Lock, Send } from "lucide-react"
import { apiFailure, setSunatTestMode, type Company } from "../../../services/companyService"
import { EmpCard, EmpField, EmpWhy, ic } from "./empParts"

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").trim().toUpperCase()

/**
 * Modo SUNAT: automatico. La empresa pasa sola a produccion con SOL + certificado + ficha RUC.
 * El modo pruebas manual desactiva el envio a SUNAT y exige escribir la palabra de confirmacion.
 */
export function EmpModo({ base, onChanged }: { base: Company | null; onChanged: () => void }) {
  const [ask, setAsk] = useState(false)
  const [typed, setTyped] = useState("")
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState("")
  const help = "Automático: pasa a producción al completar los datos."
  const st = base?.modo_sunat_estado

  if (!base || !st) {
    return (
      <EmpCard sec="modo" title="Modo SUNAT" help={help}>
        <div className="row">
          <div className="box dash">{ic(Lock, 24)}</div>
          <div className="meta"><b>Pruebas</b><span>Se define al registrar la empresa.</span></div>
        </div>
      </EmpCard>
    )
  }

  const manual = !!base.sunat_pruebas_manual
  const prod = base.modo_sunat === "production"
  const word = manual ? "PRODUCCION" : "PRUEBAS"
  const ok = norm(typed) === word
  const locked = st.motivo === "servidor"

  let title = prod ? "Producción" : "Pruebas"
  let detail = ""
  if (st.motivo === "automatico") detail = "Los comprobantes se envían a SUNAT con validez legal."
  else if (st.motivo === "manual") detail = "Modo pruebas activado manualmente: los comprobantes se generan pero NO se envían a SUNAT."
  else if (st.motivo === "incompleto") detail = `Pasará a producción automáticamente al completar: ${st.pendientes.join(", ")}.`
  else { title = "Pruebas (servidor)"; detail = st.aviso_servidor || "El servidor está fijado en pruebas (SUNAT_MODE=sandbox)." }

  const confirm = async () => {
    if (!ok || busy) return
    setBusy(true); setErr("")
    try { await setSunatTestMode(!manual, typed); setAsk(false); setTyped(""); onChanged() }
    catch (e) { setErr(apiFailure(e, "No se pudo cambiar el modo SUNAT").message) }
    finally { setBusy(false) }
  }

  return (
    <EmpCard sec="modo" title="Modo SUNAT" help={help}>
      <div className="row">
        <div className={`box${prod ? "" : " dash"}`}>{ic(prod ? Send : manual ? FlaskConical : Clock, 24)}</div>
        <div className="meta">
          <b>{title}</b>
          <span className={`st ${prod ? "ok" : "warn"}`}>{ic(prod ? CircleCheck : manual ? FlaskConical : Clock, 14)}{detail}</span>
        </div>
        {!locked && (
          <button type="button" className={`btn ${manual ? "" : "out"}`.trim()} aria-expanded={ask} onClick={() => { setAsk(a => !a); setTyped(""); setErr("") }}>
            {ic(manual ? Send : FlaskConical, 16)}{manual ? "Volver a producción" : "Activar modo pruebas"}
          </button>
        )}
      </div>
      {ask && (
        <div className="inl" role="alertdialog" aria-labelledby="emp-modo-t" style={{ marginTop: 12 }}>
          <h3 id="emp-modo-t">{manual ? "¿Volver a enviar comprobantes a SUNAT?" : "¿Desactivar el envío a SUNAT?"}</h3>
          <p>
            {manual
              ? st.pendientes.length && !st.activada
                ? `Se desactiva el modo pruebas, pero seguirá en pruebas hasta completar: ${st.pendientes.join(", ")}.`
                : "Las facturas y boletas que emitas desde ahora se enviarán a SUNAT con validez legal."
              : "Las facturas y boletas que emitas se generarán y firmarán, pero no se enviarán a SUNAT y no tendrán validez legal. Úsalo solo para probar; las ventas reales emitidas en este modo habrá que volver a declararlas."}
          </p>
          <EmpField label={`Escribe ${manual ? "PRODUCCIÓN" : "PRUEBAS"} para confirmar`} value={typed} onChange={setTyped} hint="Se acepta sin tildes ni mayúsculas." />
          {err && <div style={{ marginTop: 8 }}><EmpWhy alert>{err}</EmpWhy></div>}
          <div className="acts">
            <button type="button" className="btn out" onClick={() => setAsk(false)}>Cancelar</button>
            <button type="button" className={`btn ${manual ? "" : "dng"}`.trim()} disabled={!ok || busy} onClick={() => void confirm()}>
              {busy ? "Guardando…" : manual ? "Volver a producción" : "Activar modo pruebas"}
            </button>
          </div>
        </div>
      )}
    </EmpCard>
  )
}
