import type { KeyboardEvent } from "react"
import { CircleAlert, CircleCheck, CircleMinus, Clock, Lock, RefreshCw, TriangleAlert } from "lucide-react"
import type { ApiFailure, IntegrationStatus, RucSheet } from "../../../services/companyService"
import { EmpNote, ic } from "./empParts"
import type { EmpTabDef, EmpTabKey } from "./empTabs"
import { SEP } from "./empFormat"

interface HeadProps {
  title: "h1" | "p"
  status: IntegrationStatus | null
  statusError: ApiFailure | null
  sheet: RucSheet
  sheetError: ApiFailure | null
  showSheet: boolean
  onRefresh: () => void
}

/** Titulo + estado real (SUNAT, Culqi, ficha RUC) con icono + palabra. */
export function EmpHeader({ title, status, statusError, sheet, sheetError, showSheet, onRefresh }: HeadProps) {
  const s = status?.sunat
  const c = status?.culqi
  return (
    <header className="hd">
      {title === "h1" ? <h1>Empresa y horario</h1> : <p className="ttl">Empresa y horario</p>}
      <div className="est" role="group" aria-label="Estado real">
        {statusError ? (
          <>
            <span className="st bad">{ic(statusError.status === 403 ? Lock : CircleAlert, 16)}{statusError.status === 403 ? "Sin permiso para ver el estado" : "No se pudo leer el estado"}</span>
            {statusError.status !== 403 && <button type="button" className="btn out" onClick={onRefresh}>{ic(RefreshCw, 16)}Actualizar estado</button>}
          </>
        ) : (
          <>
            {s && <span className={`pl ${s.connected ? "ok" : "warn"}`}>{ic(s.connected ? CircleCheck : CircleAlert, 14)}SUNAT{SEP}{s.mode === "production" ? "Producción" : "Pruebas"}{SEP}{s.connected ? "Listo" : "Incompleto"}</span>}
            {c && (
              <span className={`pl ${c.connected ? "ok" : c.public_key || c.secret_key ? "warn" : "neu"}`}>
                {ic(c.connected ? CircleCheck : c.public_key || c.secret_key ? CircleAlert : CircleMinus, 14)}Culqi{SEP}{c.connected ? "Conectado" : c.public_key || c.secret_key ? "Llaves incompletas" : "Sin llaves"}
              </span>
            )}
          </>
        )}
        {showSheet && (sheetError
          ? <span className="pl bad">{ic(CircleAlert, 14)}Ficha RUC{SEP}No se pudo leer</span>
          : <span className={`pl ${sheet.uploaded ? "ok" : "warn"}`}>{ic(sheet.uploaded ? CircleCheck : Clock, 14)}Ficha RUC{SEP}{sheet.uploaded ? "Subida" : "Pendiente"}</span>)}
      </div>
    </header>
  )
}

/** Aviso de SUNAT: servidor fijado en pruebas, pruebas manuales o produccion pendiente de datos. */
export function EmpModeWarning({ status }: { status: IntegrationStatus | null }) {
  const s = status?.sunat
  if (!s) return null
  const w = s.warning || (s.mode_valid === false ? "SUNAT_MODE tiene un valor inválido: se usa modo pruebas (beta)." : "")
  if (w) return <EmpNote kind="warn" icon={TriangleAlert}><strong>Modo SUNAT</strong>{w}</EmpNote>
  if (s.motivo === "manual") return <EmpNote kind="warn" icon={TriangleAlert}><strong>Modo pruebas activado</strong>Los comprobantes no se envían a SUNAT. Vuelve a producción en Empresa › Modo SUNAT.</EmpNote>
  if (s.motivo === "incompleto" && s.pendientes?.length) return <EmpNote kind="inf"><strong>Modo SUNAT: pruebas</strong>Pasará a producción automáticamente al completar: {s.pendientes.join(", ")}.</EmpNote>
  return null
}

interface TabsProps { tabs: EmpTabDef[]; current: EmpTabKey | null; onSelect: (k: EmpTabKey) => void }

/** Barra de pestanas siempre completa; las no permitidas con candado y el motivo escrito. */
export function EmpTabs({ tabs, current, onSelect }: TabsProps) {
  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([aria-disabled="true"])')]
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    if (i < 0) return
    const to = e.key === "ArrowRight" ? items[(i + 1) % items.length] : e.key === "ArrowLeft" ? items[(i - 1 + items.length) % items.length] : e.key === "Home" ? items[0] : e.key === "End" ? items[items.length - 1] : null
    if (to) { e.preventDefault(); to.focus() }
  }
  const off = tabs.filter(t => !t.enabled)
  return (
    <>
      <div className="tabs" role="tablist" aria-label="Secciones de Empresa y horario" data-n={tabs.length} style={{ ["--tn" as string]: tabs.length }} onKeyDown={key}>
        {tabs.map(t => (
          <button
            key={t.key} type="button" role="tab" id={`emp-tab-${t.key}`} className="tb" aria-selected={t.key === current}
            aria-disabled={!t.enabled || undefined} aria-describedby={t.enabled ? undefined : `emp-rs-${t.key}`}
            onClick={() => { if (t.enabled && t.key !== current) onSelect(t.key) }}
          >
            {!t.enabled && <span className="lk">{ic(Lock, 14)}</span>}{t.label}
          </button>
        ))}
      </div>
      {off.length > 0 && (
        <div className="rs">
          {off.map(t => <span key={t.key} id={`emp-rs-${t.key}`}>{ic(Lock, 14)}<span><b>{t.label}:</b> {t.reason}</span></span>)}
        </div>
      )}
    </>
  )
}
