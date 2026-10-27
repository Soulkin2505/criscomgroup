import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { useNavigate, useSearchParams } from "react-router-dom"
import {
  ArrowRight, Camera, Check, ChevronDown, CircleAlert, CircleCheck, Clock, FileText, Image as ImageIcon,
  Key, Laptop, Plus, RefreshCw, Upload, User, Wrench, X, type LucideIcon,
} from "lucide-react"
import { toast } from "sonner"
import {
  addWorkOrderEvidence, createWorkOrder, setWorkOrderCredential, type WorkOrderType,
} from "../../services/workOrderService"
import { useDocumentTitle } from "../../hooks/useDocumentTitle"
import { CameraCodeScanner } from "../../components/scanner/CameraCodeScanner"
import { todayLima } from "../../components/erp/format"
import "../../styles/taller-ingreso.css"

const I = (Icon: LucideIcon, size = 16) => <Icon className="ic" size={size} strokeWidth={1.75} aria-hidden="true" />

const MAX_PHOTOS = 12
const MAX_BYTES = 10 * 1024 * 1024
const TIPOS: Record<WorkOrderType, { n: string; eq: string; det: string }> = {
  servicio_tecnico: { n: "Servicio técnico", eq: "Equipo, marca y modelo", det: "Falla indicada por el cliente" },
  mantenimiento: { n: "Mantenimiento", eq: "Equipo, marca y modelo", det: "Motivo, síntomas y alcance solicitado" },
  armado_pc: { n: "Armado de PC", eq: "Uso objetivo / proyecto", det: "Necesidad y presupuesto indicado" },
}
const SUB = [["preventivo", "Preventivo"], ["correctivo", "Correctivo"], ["optimizacion", "Optimización"], ["limpieza_profunda", "Limpieza profunda"]] as const
const TAR = [
  ["limpieza_interna", "Limpieza interna y eliminación de polvo"],
  ["sistema_refrigeracion", "Limpieza del sistema de refrigeración"],
  ["pasta_termica", "Cambio de pasta térmica"],
  ["almacenamiento_smart", "Diagnóstico SMART del almacenamiento"],
  ["memoria_ram", "Prueba de memoria RAM"],
  ["temperaturas", "Prueba de temperaturas y estabilidad"],
  ["optimizacion_software", "Optimización de sistema y programas"],
  ["actualizaciones", "Actualizaciones de sistema y controladores"],
] as const
const TXT = {
  clave: "Se cifra y elimina al vencer (72 horas). Nunca se incluye en PDFs, listados ni seguimiento del cliente.",
  fotos: "Toma o selecciona hasta 12 fotos (10 MB c/u). Se guardan privadas dentro del expediente.",
  conf: "Confirmo que el estado físico, accesorios y datos fueron verificados con el cliente antes de intervenir.",
  cons: "El cliente autoriza recibir por WhatsApp actualizaciones relacionadas únicamente con esta orden. Puede revocar el permiso.",
}
const code = (type: WorkOrderType) =>
  `${type === "armado_pc" ? "PC" : type === "mantenimiento" ? "MT" : "ST"}-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`
const ROUTE: Record<WorkOrderType, string> = { servicio_tecnico: "/services/technical", mantenimiento: "/services/maintenance", armado_pc: "/services/pc-builds" }

type Form = {
  tipo: WorkOrderType; subtipo_trabajo: string; tareas_solicitadas: string[]
  email: string; cliente: string; telefono: string; documento: string; equipo: string; numero_serie: string; detalle: string
  estado_fisico: string[]; accesorios_recibidos: string[]; credencial_temporal: string
  recepcion_conforme: boolean; whatsapp_consentimiento: boolean
}
const blank = (tipo: WorkOrderType = "servicio_tecnico"): Form => ({
  tipo, subtipo_trabajo: tipo === "mantenimiento" ? "preventivo" : "", tareas_solicitadas: [], email: "", cliente: "", telefono: "", documento: "", equipo: "", numero_serie: "",
  detalle: "", estado_fisico: [], accesorios_recibidos: [], credencial_temporal: "", recepcion_conforme: false, whatsapp_consentimiento: false,
})
type Created = { id: number; codigo: string; form: Form }

function Field({ id, label, req, hint, error, children }: { id: string; label: string; req?: boolean; hint?: string; error?: string; children: React.ReactNode }) {
  return (
    <div className={`f${error ? " bad" : ""}`}>
      <label htmlFor={id}>{label}{req && <span className="rq" aria-hidden="true">*</span>}</label>
      {children}
      {error ? <div className="er" id={`${id}-h`} role="alert">{I(CircleAlert, 14)}<span>{error}</span></div> : hint ? <div className="hint" id={`${id}-h`}>{hint}</div> : null}
    </div>
  )
}

function Chips({ id, label, ph, hint, list, onChange, disabled }: { id: string; label: string; ph: string; hint: string; list: string[]; onChange: (l: string[]) => void; disabled: boolean }) {
  const [draft, setDraft] = useState("")
  const add = () => { const v = draft.trim(); if (v) { onChange([...list, v]); setDraft("") } }
  const key = (e: KeyboardEvent<HTMLInputElement>) => { if (e.key === "Enter") { e.preventDefault(); add() } }
  return (
    <div className="f">
      <label htmlFor={id}>{label}</label>
      <div className="cb2">
        {list.map((t, i) => (
          <span className="chip" key={`${t}-${i}`}>{t}
            <button type="button" aria-label={`Quitar «${t}»`} disabled={disabled} onClick={() => onChange(list.filter((_, j) => j !== i))}>{I(X, 16)}</button>
          </span>
        ))}
        <input className="cin" id={id} placeholder={list.length ? "Añadir otro" : ph} value={draft} disabled={disabled}
          aria-describedby={`${id}-h`} onChange={e => setDraft(e.target.value)} onKeyDown={key} onBlur={add} />
      </div>
      <div className="hint" id={`${id}-h`}>{hint}</div>
    </div>
  )
}

export default function QuickIntakePage() {
  useDocumentTitle("Nuevo ingreso")
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedType = params.get("tipo")
  const initialType: WorkOrderType = requestedType === "mantenimiento" || requestedType === "armado_pc" ? requestedType : "servicio_tecnico"
  const [f, setF] = useState<Form>(() => blank(initialType))
  useEffect(() => {
    setF(current => ({ ...current, tipo: initialType, subtipo_trabajo: initialType === "mantenimiento" ? "preventivo" : "" }))
  }, [initialType])
  const [photos, setPhotos] = useState<File[]>([])
  const [errors, setErrors] = useState<Record<string, string>>({})
  const [claveOpen, setClaveOpen] = useState(false)
  const [mode, setMode] = useState<"form" | "saving" | "partial" | "ok">("form")
  const [progress, setProgress] = useState({ done: 0, total: 0 })
  const [created, setCreated] = useState<Created | null>(null)
  const [pending, setPending] = useState<File[]>([])
  const [cam, setCam] = useState(false)
  const [camError, setCamError] = useState("")
  const videoRef = useRef<HTMLVideoElement>(null)
  const streamRef = useRef<MediaStream | null>(null)
  const fileRef = useRef<HTMLInputElement>(null)
  const set = <K extends keyof Form>(k: K, v: Form[K]) => {
    setF(c => ({ ...c, [k]: v }))
    setErrors(e => { if (!e[k as string]) return e; const n = { ...e }; delete n[k as string]; return n })
  }
  const busy = mode !== "form"

  const previews = useMemo(() => photos.map(p => URL.createObjectURL(p)), [photos])
  useEffect(() => () => previews.forEach(u => URL.revokeObjectURL(u)), [previews])
  const stopCam = () => { streamRef.current?.getTracks().forEach(t => t.stop()); streamRef.current = null; setCam(false) }
  useEffect(() => () => streamRef.current?.getTracks().forEach(t => t.stop()), [])

  const addFiles = (incoming: File[]) => {
    const valid = incoming.filter(file => file.type.startsWith("image/") && file.size <= MAX_BYTES)
    if (valid.length < incoming.length) toast.error("Solo imágenes de hasta 10 MB")
    setPhotos(cur => [...cur, ...valid].slice(0, MAX_PHOTOS))
  }
  const openCam = async () => {
    setCamError("")
    setCam(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" } }, audio: false })
      streamRef.current = stream
      window.setTimeout(() => { if (videoRef.current) videoRef.current.srcObject = stream }, 0)
    } catch {
      setCamError("No se pudo abrir la cámara. Revisa el permiso del navegador o usa «Elegir fotos».")
    }
  }
  const shot = () => {
    const v = videoRef.current
    if (!v?.videoWidth || !v.videoHeight) return
    const c = document.createElement("canvas")
    c.width = v.videoWidth; c.height = v.videoHeight
    c.getContext("2d")?.drawImage(v, 0, 0)
    c.toBlob(b => { if (b) addFiles([new File([b], `recepcion-${Date.now()}.jpg`, { type: "image/jpeg" })]) }, "image/jpeg", 0.9)
  }

  const validate = () => {
    const e: Record<string, string> = {}
    if (f.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = "Revisa el correo del cliente."
    if (f.telefono && !/^[+]?[0-9 -]{7,20}$/.test(f.telefono)) e.telefono = "Escribe el WhatsApp con código de país, solo números."
    if (f.documento && !/^([0-9]{8}|[0-9]{11})$/.test(f.documento)) e.documento = "El DNI tiene 8 dígitos y el RUC 11."
    return e
  }
  const reason = () => {
    const n = Object.keys(errors).length
    if (n) return `Corrige ${n} ${n === 1 ? "campo" : "campos"} para registrar`
    if (!f.cliente.trim()) return "Falta el cliente"
    if (!f.equipo.trim()) return `Falta ${f.tipo === "armado_pc" ? "el uso objetivo" : "el equipo"}`
    if (!f.detalle.trim()) return `Falta ${f.tipo === "armado_pc" ? "la necesidad" : "la falla"}`
    if (f.tipo === "mantenimiento" && !f.subtipo_trabajo) return "Falta la modalidad de mantenimiento"
    if (!f.recepcion_conforme) return "Falta la conformidad de recepción"
    return ""
  }
  const why = reason()

  const uploadPhotos = async (id: number, files: File[], offset: number, total: number) => {
    const failed: File[] = []
    setProgress({ done: offset, total })
    for (let i = 0; i < files.length; i += 1) {
      try {
        await addWorkOrderEvidence(id, { archivo: files[i], etapa: "recepcion", descripcion: `Foto de recepción ${offset + i + 1}` })
      } catch { failed.push(files[i]) }
      setProgress({ done: offset + i + 1, total })
    }
    return failed
  }

  const submit = async () => {
    const e = validate()
    if (why && !Object.keys(e).length) return
    if (Object.keys(e).length) { setErrors(e); return }
    setMode("saving")
    try {
      const codigo = code(f.tipo)
      const accesorios = [...f.estado_fisico, ...f.accesorios_recibidos].join(". ")
      const { credencial_temporal, ...rest } = f
      const order = await createWorkOrder({
        ...rest, accesorios, whatsapp_consentimiento_fuente: "recepción presencial", codigo, estado: "recibido", moneda: "PEN",
        costo_repuestos: 0, costo_mano_obra: 0, adelanto: 0, fecha_ingreso: todayLima(), garantia_dias: 30,
        diagnostico_configuracion: "", trabajo_realizado: "", notas: "",
      })
      const info: Created = { id: order.id_orden_servicio, codigo, form: f }
      setCreated(info)
      if (credencial_temporal) {
        try { await setWorkOrderCredential(order.id_orden_servicio, { secreto: credencial_temporal, horas_vigencia: 72 }) }
        catch { toast.error("La orden se creó, pero no se pudo guardar la clave temporal") }
      }
      const failed = await uploadPhotos(order.id_orden_servicio, photos, 0, photos.length)
      if (failed.length) { setPending(failed); setMode("partial"); return }
      setMode("ok")
      toast.success(`Ingreso registrado: ${codigo}`)
    } catch (error: any) {
      setMode("form")
      toast.error(error.response?.data?.message || "No se pudo registrar el ingreso")
    }
  }

  const retry = async () => {
    if (!created) return
    setMode("saving")
    const total = photos.length
    const failed = await uploadPhotos(created.id, pending, total - pending.length, total)
    if (failed.length) { setPending(failed); setMode("partial") } else { setMode("ok"); toast.success(`Ingreso registrado: ${created.codigo}`) }
  }
  const reset = () => { setF(blank()); setPhotos([]); setErrors({}); setCreated(null); setPending([]); setClaveOpen(false); setMode("form") }
  const toOrder = () => navigate(`${ROUTE[(created?.form.tipo || f.tipo)]}?orden=${created?.id}`)

  const T = TIPOS[f.tipo]
  const dis = busy

  return (
    <div className="pg-ting">
      <div className="sc">
        <div className="pg">
          <div className="hd">
            <h1>Nuevo ingreso</h1>
            {mode !== "ok" && (
              <div className="seg" role="radiogroup" aria-label="Tipo de orden">
                {(Object.keys(TIPOS) as WorkOrderType[]).map(k => (
                  <button type="button" key={k} role="radio" aria-checked={f.tipo === k} disabled={dis}
                    onClick={() => { set("tipo", k); set("subtipo_trabajo", k === "mantenimiento" ? "preventivo" : ""); }}>
                    {f.tipo === k && I(Check, 14)}{TIPOS[k].n}
                  </button>
                ))}
              </div>
            )}
          </div>

          {mode === "ok" && created ? (
            <section className="card ban" role="status">
              <div className="st ok" style={{ fontSize: 15 }}>{I(CircleCheck, 18)}Ingreso registrado</div>
              <div className="code num">{created.codigo}</div>
              <dl className="dl">
                <dt>Cliente</dt><dd>{created.form.cliente}</dd>
                <dt>Equipo</dt><dd>{created.form.equipo}</dd>
                <dt>Tipo</dt><dd>{TIPOS[created.form.tipo].n}</dd>
                <dt>Fotos</dt><dd>{photos.length} subidas</dd>
                <dt>Estado</dt><dd><span className="st neu">{I(Clock, 14)}Recibido</span></dd>
              </dl>
              <div className="ac">
                <button className="btn" type="button" onClick={reset}>{I(Plus, 16)}Nuevo ingreso</button>
                <button className="btn out" type="button" onClick={toOrder}>{I(FileText, 16)}Ver expediente</button>
              </div>
            </section>
          ) : (
            <>
              {mode === "saving" && (
                <section className="card ban row2" role="status" aria-live="polite">
                  <div className="stack" style={{ gap: 8 }}>
                    <div className="tt">{I(Clock, 18)}Registrando...</div>
                    <div className="ds">{created ? `Orden creada . subiendo foto ${Math.min(progress.done + 1, progress.total)} de ${progress.total}` : "Creando la orden"}</div>
                    {progress.total > 0 && <div className="pb" role="progressbar" aria-label="Fotos subidas" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done}><i style={{ width: `${(progress.done / progress.total) * 100}%` }} /></div>}
                  </div>
                </section>
              )}
              {mode === "partial" && created && (
                <section className="card ban row2" role="alert">
                  <div className="stack" style={{ gap: 6 }}>
                    <div className="tt st bad" style={{ fontSize: 15 }}>{I(CircleAlert, 18)}Ingreso creado, falta {pending.length === 1 ? "una foto" : `${pending.length} fotos`}</div>
                    <div className="ds">La orden {created.codigo} quedó registrada. Se subieron {photos.length - pending.length} de {photos.length} fotos.</div>
                  </div>
                  <div className="ac">
                    <button className="btn" type="button" onClick={retry}>{I(RefreshCw, 16)}Reintentar fotos</button>
                    <button className="btn out" type="button" onClick={toOrder}>Ir al expediente {I(ArrowRight, 16)}</button>
                  </div>
                </section>
              )}

              {f.tipo === "mantenimiento" && (
                <section className="card plan" aria-labelledby="ting-ph">
                  <div className="ch2 pt">
                    <h2 id="ting-ph">{I(Wrench, 16)}Plan de mantenimiento</h2>
                    <div className="seg sub" role="radiogroup" aria-label="Modalidad">
                      {SUB.map(([v, l]) => (
                        <button type="button" key={v} role="radio" aria-checked={f.subtipo_trabajo === v} disabled={dis} onClick={() => set("subtipo_trabajo", v)}>
                          {f.subtipo_trabajo === v && I(Check, 14)}{l}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div className="tareas">
                    {TAR.map(([v, l]) => (
                      <label className="ck t" key={v}>
                        <input type="checkbox" disabled={dis} checked={f.tareas_solicitadas.includes(v)}
                          onChange={() => set("tareas_solicitadas", f.tareas_solicitadas.includes(v) ? f.tareas_solicitadas.filter(x => x !== v) : [...f.tareas_solicitadas, v])} />
                        <span>{l}</span>
                      </label>
                    ))}
                  </div>
                </section>
              )}

              <div className="cols">
                <div className="col">
                  <section className="card" aria-labelledby="ting-h1">
                    <div className="ch2"><h2 id="ting-h1">{I(User, 16)}Cliente</h2></div>
                    <div className="row r3">
                      <Field id="ting-cliente" label="Nombre del cliente" req>
                        <input className="in" id="ting-cliente" value={f.cliente} autoComplete="off" required aria-required="true" autoFocus disabled={dis} onChange={e => set("cliente", e.target.value)} />
                      </Field>
                      <Field id="ting-telefono" label="WhatsApp" hint="Incluye código de país para abrir WhatsApp correctamente." error={errors.telefono}>
                        <input className="in" id="ting-telefono" inputMode="tel" placeholder="51987654321" value={f.telefono} disabled={dis}
                          aria-invalid={!!errors.telefono} aria-describedby={`ting-telefono-h`} onChange={e => set("telefono", e.target.value)} />
                      </Field>
                      <Field id="ting-email" label="Correo electrónico" hint="Para enviar el ticket al cliente." error={errors.email}>
                        <input className="in" id="ting-email" type="email" maxLength={160} value={f.email} disabled={dis} onChange={e => set("email", e.target.value)} />
                      </Field>
                      <Field id="ting-documento" label="DNI / RUC" hint="8 dígitos para DNI o 11 para RUC." error={errors.documento}>
                        <input className="in" id="ting-documento" inputMode="numeric" value={f.documento} disabled={dis}
                          aria-invalid={!!errors.documento} aria-describedby={`ting-documento-h`} onChange={e => set("documento", e.target.value.replace(/\D/g, "").slice(0, 11))} />
                      </Field>
                    </div>
                  </section>

                  <section className="card" aria-labelledby="ting-h2">
                    <div className="ch2"><h2 id="ting-h2">{I(Laptop, 16)}Equipo</h2></div>
                    <div className="row rs">
                      <Field id="ting-equipo" label={T.eq} req>
                        <input className="in eq" id="ting-equipo" value={f.equipo} required aria-required="true" disabled={dis} onChange={e => set("equipo", e.target.value)} />
                      </Field>
                      <Field id="ting-serie" label="Número de serie / código">
                        <input className="in" id="ting-serie" value={f.numero_serie} disabled={dis} onChange={e => set("numero_serie", e.target.value)} />
                      </Field>
                      <CameraCodeScanner label="Escanear" onDetected={c => set("numero_serie", c)} className="btn out" />
                    </div>
                  </section>

                  <section className="card">
                    <div className="ch2"><h2 id="ting-h3">{I(FileText, 16)}{T.det}<span className="rq" style={{ color: "hsl(var(--nav-fg-2))" }} aria-hidden="true">*</span></h2></div>
                    <div className="f">
                      <textarea className="in" id="ting-detalle" aria-labelledby="ting-h3" required aria-required="true" value={f.detalle} disabled={dis} onChange={e => set("detalle", e.target.value)} />
                    </div>
                  </section>

                  <details className="acc" open={claveOpen} onToggle={e => setClaveOpen((e.target as HTMLDetailsElement).open)}>
                    <summary><span className="l">{I(Key, 16)}Clave temporal de desbloqueo</span><ChevronDown className="ic chv" size={16} strokeWidth={1.75} aria-hidden="true" /></summary>
                    <div className="bd">
                      <div className="f">
                        <label className="sr" htmlFor="ting-clave">Clave temporal de desbloqueo</label>
                        <input className="in" type="password" id="ting-clave" value={f.credencial_temporal} autoComplete="new-password" disabled={dis}
                          aria-describedby="ting-clave-h" onChange={e => set("credencial_temporal", e.target.value)} />
                        <div className="hint on" id="ting-clave-h">{TXT.clave}</div>
                      </div>
                    </div>
                  </details>
                </div>

                <div className="col">
                  <section className="card" aria-labelledby="ting-h4">
                    <div className="ch2"><h2 id="ting-h4">{I(FileText, 16)}Estado físico y accesorios</h2></div>
                    <div className="stack">
                      <Chips id="ting-fisico" label="Estado físico observable" ph="ej. golpe en esquina" hint="Una condición por vez: pulsa Enter para añadirla. Se guarda como lista." list={f.estado_fisico} disabled={dis} onChange={l => set("estado_fisico", l)} />
                      <Chips id="ting-acc" label="Accesorios recibidos" ph="ej. cargador 65 W" hint="Uno por vez: pulsa Enter para añadirlo. Se guarda como lista." list={f.accesorios_recibidos} disabled={dis} onChange={l => set("accesorios_recibidos", l)} />
                    </div>
                  </section>

                  <section className="card" aria-labelledby="ting-h5">
                    <div className="ch2"><h2 id="ting-h5">{I(Camera, 16)}Evidencia fotográfica de recepción</h2><span className="cap num">{photos.length} de {MAX_PHOTOS}</span></div>
                    <div className="pa">
                      <button type="button" className="btn out" disabled={dis || photos.length >= MAX_PHOTOS} aria-describedby="ting-fh" onClick={openCam}>{I(Camera, 16)}Tomar foto</button>
                      <button type="button" className="btn out" disabled={dis || photos.length >= MAX_PHOTOS} aria-describedby="ting-fh" onClick={() => fileRef.current?.click()}>{I(Upload, 16)}Elegir fotos</button>
                      <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addFiles(Array.from(e.target.files || [])); e.target.value = "" }} />
                    </div>
                    {photos.length > 0 && (
                      <div className="th">
                        {photos.map((p, i) => (
                          <div className="it" key={`${p.name}-${i}`}>
                            <div className="tile" role="img" aria-label={`Foto ${i + 1} de recepción`}>
                              {previews[i] ? <img src={previews[i]} alt="" /> : I(ImageIcon, 20)}
                            </div>
                            <button type="button" className="btn out" aria-label={`Quitar foto ${i + 1}`} disabled={dis} onClick={() => setPhotos(cur => cur.filter((_, j) => j !== i))}>{I(X, 14)}Quitar</button>
                          </div>
                        ))}
                      </div>
                    )}
                    <p className="hint" id="ting-fh">{TXT.fotos}</p>
                  </section>
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {mode !== "ok" && (
        <div className="foot">
          <div className="fi">
            <div className="cks">
              <label className="ck">
                <input type="checkbox" checked={f.recepcion_conforme} required aria-required="true" disabled={dis} onChange={e => set("recepcion_conforme", e.target.checked)} />
                <span className="tx"><b>Conformidad de recepción (obligatoria).</b> {TXT.conf}</span>
              </label>
              <label className="ck">
                <input type="checkbox" checked={f.whatsapp_consentimiento} disabled={dis} onChange={e => set("whatsapp_consentimiento", e.target.checked)} />
                <span className="tx"><b>Consentimiento WhatsApp.</b> {TXT.cons}</span>
              </label>
            </div>
            <div className="act">
              {mode === "saving" && <span className="why st neu" id="ting-why">{I(Clock, 14)}No cierres esta pantalla</span>}
              {mode === "partial" && <span className="why st warn" id="ting-why">{I(CircleAlert, 14)}La orden ya está creada: reintenta las fotos</span>}
              {mode === "form" && (why
                ? <span className="why st bad" id="ting-why">{I(CircleAlert, 14)}{why}</span>
                : <span className="why st ok" id="ting-why">{I(CircleCheck, 14)}Listo para registrar</span>)}
              <button className="btn" type="button" aria-disabled={mode !== "form" || !!why} aria-describedby="ting-why"
                aria-busy={mode === "saving"} onClick={() => { if (mode === "form") void submit() }}>
                {mode === "saving" ? "Registrando..." : <>{I(Check, 16)}Registrar ingreso</>}
              </button>
            </div>
          </div>
        </div>
      )}

      {cam && (
        <div className="scrim">
          <div className="dlg" role="dialog" aria-modal="true" aria-labelledby="ting-cam">
            <div className="ch2" style={{ margin: 0 }}>
              <h2 id="ting-cam" style={{ fontSize: 15, fontWeight: 600 }}>Tomar foto</h2>
              <span className="cap num" style={{ fontSize: 12.5, color: "hsl(var(--muted-foreground))" }}>{photos.length} de {MAX_PHOTOS}</span>
            </div>
            <div className="vid">
              {camError ? <span>{camError}</span> : <video ref={videoRef} autoPlay playsInline muted style={{ width: "100%", height: "100%", objectFit: "cover", borderRadius: 8 }} />}
            </div>
            <div className="ac">
              <button className="btn out" type="button" onClick={stopCam}>Cerrar</button>
              <button className="btn" type="button" disabled={!!camError || photos.length >= MAX_PHOTOS} onClick={shot}>{I(Camera, 16)}Tomar foto</button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
