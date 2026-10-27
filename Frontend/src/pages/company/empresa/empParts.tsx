import { useId, type ReactNode } from "react"
import { Check, CircleAlert, CircleCheck, CircleMinus, Info, RefreshCw, TriangleAlert, type LucideIcon } from "lucide-react"

/** Icono lucide con el trazo del sistema (1,75). */
export const ic = (Icon: LucideIcon, size = 16, cls = "") => <Icon className={`ic ${cls}`.trim()} size={size} strokeWidth={1.75} aria-hidden="true" />

export type NoteKind = "" | "warn" | "bad" | "ok" | "inf"
const NOTE_ICON: Record<string, LucideIcon> = { warn: TriangleAlert, bad: CircleAlert, ok: CircleCheck, inf: Info, "": Info }

/** Aviso plano con icono (nunca solo color). */
export function EmpNote({ kind = "", icon, children, acts, id }: { kind?: NoteKind; icon?: LucideIcon; children: ReactNode; acts?: ReactNode; id?: string }) {
  return (
    <div className={`nt ${kind}`.trim()} role={kind === "bad" ? "alert" : "status"} id={id}>
      {ic(icon ?? NOTE_ICON[kind], 16)}
      <div className="bd">{children}{acts && <div className="acts">{acts}</div>}</div>
    </div>
  )
}

/** Mensaje de error / ayuda bajo un control. */
export function EmpWhy({ children, id, kind = "bad", alert = false }: { children: ReactNode; id?: string; kind?: "bad" | "warn"; alert?: boolean }) {
  return <div id={id} className={`why ${kind === "bad" ? "bad" : ""}`.trim()} role={alert ? "alert" : undefined}>{ic(CircleAlert, 14)}<span>{children}</span></div>
}

/** Chip de secreto: Configurado / Sin configurar / Se reemplazara al guardar. */
export function EmpCfgChip({ on, typed }: { on: boolean; typed?: boolean }) {
  if (typed) return <span className="cp chg">{ic(RefreshCw, 12)}Se reemplazará al guardar</span>
  return on ? <span className="cp ok">{ic(CircleCheck, 12)}Configurado</span> : <span className="cp neu">{ic(CircleMinus, 12)}Sin configurar</span>
}

export interface EmpFieldProps {
  label: string
  value: string
  onChange?: (v: string) => void
  onBlur?: () => void
  cls?: string
  type?: "text" | "password"
  required?: boolean
  readOnly?: boolean
  disabled?: boolean
  placeholder?: string
  error?: string
  hint?: ReactNode
  chip?: ReactNode
  max?: number
  extra?: ReactNode
  time?: boolean
  inputMode?: "numeric" | "text"
  autoComplete?: string
}

/** Campo del sistema (etiqueta, control de 44 px, error o ayuda ligados con aria-describedby). */
export function EmpField(p: EmpFieldProps) {
  const id = useId()
  const desc = p.error ? `${id}e` : p.hint ? `${id}h` : undefined
  const over = p.max != null && p.value.length > p.max
  const showCnt = p.max != null && p.value.length >= p.max * 0.8
  return (
    <div className={`fld ${p.cls ?? ""}`.trim()}>
      <div className="lb">
        <label htmlFor={id}>{p.label}{p.required && <> <i aria-hidden="true">*</i></>}</label>
        {p.chip ?? (showCnt && <span className={`cnt ${over ? "bad" : ""}`.trim()}>{p.value.length}/{p.max}</span>)}
      </div>
      <input
        id={id} className={`in${p.error ? " er" : ""}${p.time ? " tm" : ""}`} type={p.type ?? "text"} value={p.value}
        onChange={e => p.onChange?.(e.target.value)} onBlur={p.onBlur} placeholder={p.placeholder}
        readOnly={p.readOnly} aria-readonly={p.readOnly || undefined} disabled={p.disabled}
        inputMode={p.inputMode} autoComplete={p.autoComplete ?? "off"} aria-invalid={p.error ? true : undefined}
        aria-required={p.required || undefined} aria-describedby={desc} spellCheck={false}
      />
      {p.error && <EmpWhy id={`${id}e`}>{p.error}</EmpWhy>}
      {!p.error && p.hint && <div id={`${id}h`} className="hint">{p.hint}</div>}
      {p.extra}
    </div>
  )
}

/** Campo secreto: jamas muestra ni rellena el valor guardado; vacio = conservar. */
export function EmpSecret(p: { label: string; value: string; onChange: (v: string) => void; configured: boolean; cls?: string; required?: boolean; error?: string; hint?: ReactNode; placeholder?: string; type?: "text" | "password" }) {
  const typed = p.value !== ""
  const ph = typed ? "" : p.configured ? "Configurado — déjalo vacío para conservarlo" : (p.placeholder ?? "Sin configurar")
  return (
    <EmpField
      cls={p.cls} label={p.label} required={p.required} type={p.type ?? "password"} value={p.value} onChange={p.onChange} placeholder={ph}
      chip={<EmpCfgChip on={p.configured} typed={typed} />} error={p.error} autoComplete="new-password"
      hint={typed ? "Vacía el campo para conservar el valor guardado." : p.hint}
    />
  )
}

export function EmpCheck({ on, onToggle, title, sub }: { on: boolean; onToggle: () => void; title: string; sub?: string }) {
  return (
    <button type="button" className="cbx" role="checkbox" aria-checked={on} onClick={onToggle}>
      <span className="bx">{on && ic(Check, 16)}</span>
      <span className="tx">{title}{sub && <small>{sub}</small>}</span>
    </button>
  )
}

/** Tarjeta plana de seccion: el submenu de la izquierda ya dice el titulo, asi
 * que aqui solo se ve la ayuda; el titulo queda para lectores de pantalla. */
export function EmpCard({ sec, title, help, children, cls = "" }: { sec: string; title: string; help: string; children: ReactNode; cls?: string }) {
  const id = useId()
  return (
    <section className={`cd ${cls}`.trim()} data-sec={sec} id={`emp-sec-${sec}`} aria-labelledby={id}>
      <h2 className="lg" id={id}><span className="sr-only">{title}</span><small>{help}</small></h2>
      {children}
    </section>
  )
}
