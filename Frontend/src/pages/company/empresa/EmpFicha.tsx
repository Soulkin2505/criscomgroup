import { useRef, useState } from "react"
import { CircleCheck, Clock, Download, Eye, FileText, Lock, RefreshCw, Trash2, Upload } from "lucide-react"
import { apiFailure, deleteRucSheet, downloadRucSheet, uploadRucSheet } from "../../../services/companyService"
import { fmtKb, fmtStamp, LIM_FICHA, MAX_FICHA, SEP } from "./empFormat"
import { EmpCard, EmpWhy, ic } from "./empParts"
import type { EmpFichaCtl } from "./useEmpEstado"

const FICHA_OK = /\.(pdf|jpe?g|png)$/i
const mimeLabel = (m?: string | null) => (m === "application/pdf" ? "PDF" : m === "image/png" ? "PNG" : m ? "JPG" : "")

/**
 * Ficha RUC: ultimo paso. Se habilita solo con la empresa registrada y su certificado configurado;
 * subir, reemplazar y eliminar se aplican al instante (sin Guardar).
 */
export function EmpFicha({ ctl, alta, cert }: { ctl: EmpFichaCtl; alta: boolean; cert: boolean }) {
  const input = useRef<HTMLInputElement>(null)
  const [busy, setBusy] = useState<"" | "up" | "del" | "view" | "dl">("")
  const [ask, setAsk] = useState(false)
  const [err, setErr] = useState("")
  const s = ctl.sheet
  const help = "Último paso · se aplica al instante, sin pulsar Guardar."

  if (alta || (!cert && !s.uploaded)) {
    const why = alta
      ? "Primero completa los datos, el acceso SOL y el certificado digital, y pulsa «Registrar empresa»."
      : "Primero sube el certificado digital y pulsa «Guardar cambios»."
    return (
      <EmpCard sec="ficha" title="Ficha RUC" help={help}>
        <div className="row">
          <div className="box dash">{ic(Lock, 24)}</div>
          <div className="meta"><b>Se habilita después del certificado</b><span id="emp-ficha-why">{why}</span></div>
          <button type="button" className="btn out" disabled aria-describedby="emp-ficha-why">{ic(Upload, 16)}Subir ficha RUC</button>
        </div>
      </EmpCard>
    )
  }
  if (ctl.error) {
    return (
      <EmpCard sec="ficha" title="Ficha RUC" help={help}>
        <EmpWhy alert>{ctl.error.status === 403 ? "Sin permiso para ver la ficha RUC. " : ""}{ctl.error.message}</EmpWhy>
        {ctl.error.status !== 403 && <button type="button" className="btn out" style={{ marginTop: 8 }} onClick={ctl.reload}>{ic(RefreshCw, 16)}Reintentar</button>}
      </EmpCard>
    )
  }

  const send = async (f?: File) => {
    if (!f || busy) return
    setErr("")
    if (!FICHA_OK.test(f.name)) return setErr(`«${f.name}» no se subió: usa un archivo PDF, JPG o PNG. No se reemplazó nada.`)
    if (f.size > MAX_FICHA) return setErr(`«${f.name}» no se subió: pesa ${fmtKb(f.size)} y el máximo es 5 MB. No se reemplazó nada.`)
    setBusy("up")
    try { ctl.onSheet(await uploadRucSheet(f)); setAsk(false) }
    catch (e) { setErr(`«${f.name}» no se subió: ${apiFailure(e, "no se pudo guardar la ficha RUC").message} No se reemplazó nada.`) }
    finally { setBusy("") }
  }
  const fetchFile = async () => {
    const blob = await downloadRucSheet()
    return new Blob([blob], { type: s.mime || blob.type })
  }
  const view = async () => {
    if (busy) return
    setErr(""); setBusy("view")
    const w = window.open("", "_blank")
    try {
      const url = URL.createObjectURL(await fetchFile())
      if (w) w.location.href = url; else window.location.assign(url)
      setTimeout(() => URL.revokeObjectURL(url), 120000)
    } catch (e) { w?.close(); setErr(apiFailure(e, "No se pudo abrir la ficha RUC").message) }
    finally { setBusy("") }
  }
  const save = async () => {
    if (busy) return
    setErr(""); setBusy("dl")
    try {
      const url = URL.createObjectURL(await fetchFile())
      const a = document.createElement("a"); a.href = url; a.download = s.original_name || "ficha-ruc"; a.click()
      URL.revokeObjectURL(url)
    } catch (e) { setErr(apiFailure(e, "No se pudo descargar la ficha RUC").message) }
    finally { setBusy("") }
  }
  const remove = async () => {
    if (busy) return
    setErr(""); setBusy("del")
    try { await deleteRucSheet(); ctl.onSheet({ uploaded: false }); setAsk(false) }
    catch (e) { setErr(apiFailure(e, "No se pudo eliminar la ficha RUC").message) }
    finally { setBusy("") }
  }
  const pick = <input ref={input} type="file" className="fi" tabIndex={-1} aria-label="Archivo de ficha RUC" accept="application/pdf,image/jpeg,image/png" onChange={e => { void send(e.target.files?.[0]); e.target.value = "" }} />

  return (
    <EmpCard sec="ficha" title="Ficha RUC" help={help}>
      {!s.uploaded ? (
        <div className="row">
          <div className="box dash">{ic(FileText, 24)}</div>
          <div className="meta"><span className="pend warn">{ic(Clock, 16)}Pendiente</span><span>Aún no hay ficha RUC. {LIM_FICHA}</span></div>
          <button type="button" className="btn out" aria-disabled={busy === "up"} onClick={() => input.current?.click()}>{ic(Upload, 16)}{busy === "up" ? "Subiendo…" : "Subir ficha RUC"}</button>
          {pick}
        </div>
      ) : (
        <>
          <div className="row">
            <div className="box">{ic(FileText, 24)}</div>
            <div className="meta">
              <b>{s.original_name}</b>
              <span><span className="st ok">{ic(CircleCheck, 14)}Subida</span>{[mimeLabel(s.mime), fmtKb(s.size), fmtStamp(s.updated_at)].filter(Boolean).map(x => `${SEP}${x}`).join("")}</span>
              <span>{LIM_FICHA}</span>
            </div>
          </div>
          <div className="acs sub">
            <button type="button" className="btn out" aria-disabled={!!busy} onClick={() => void view()}>{ic(Eye, 16)}Ver</button>
            <button type="button" className="btn out" aria-disabled={!!busy} onClick={() => void save()}>{ic(Download, 16)}Descargar</button>
            <button type="button" className="btn out" aria-disabled={!!busy} onClick={() => input.current?.click()}>{ic(Upload, 16)}{busy === "up" ? "Subiendo…" : "Reemplazar"}</button>
            <span className="sp" />
            <button type="button" className="btn out" aria-expanded={ask} onClick={() => setAsk(a => !a)}>{ic(Trash2, 16)}Eliminar</button>
          </div>
          {pick}
          {ask && (
            <div className="inl" role="alertdialog" aria-labelledby="emp-del-t" style={{ marginTop: 12 }}>
              <h3 id="emp-del-t">¿Eliminar la ficha RUC?</h3>
              <p>Se borrará «{s.original_name}»{s.size != null ? ` (${fmtKb(s.size)})` : ""} del servidor al instante. No se puede deshacer; la empresa quedará con la ficha «Pendiente» hasta que subas otra.</p>
              <div className="acts">
                <button type="button" className="btn out" onClick={() => setAsk(false)}>Cancelar</button>
                <button type="button" className="btn dng" aria-disabled={busy === "del"} onClick={() => void remove()}>{ic(Trash2, 16)}{busy === "del" ? "Eliminando…" : "Sí, eliminar ficha"}</button>
              </div>
            </div>
          )}
        </>
      )}
      {err && <div style={{ marginTop: 8 }}><EmpWhy alert>{err}</EmpWhy></div>}
    </EmpCard>
  )
}
