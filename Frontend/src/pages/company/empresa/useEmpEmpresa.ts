import { useCallback, useEffect, useMemo, useState } from "react"
import { apiFailure, createCompany, fetchCompany, updateCompany, type ApiFailure, type Company } from "../../../services/companyService"
import { buildBody, changedFields, draftFrom, EMPTY_DRAFT, validate, type EmpDraft, type EmpErrors, type EmpField } from "./empForm"
import { fmtKb, MAX_CERT, MAX_LOGO, nowLimaStamp } from "./empFormat"

export type EmpLoad = "load" | "ok" | "error" | "forbidden"
export interface EmpSaved { avisos: string[]; vence: string | null; at: string; created: boolean }

const LOGO_OK = /\.(jpe?g|png|webp)$/i
const CERT_OK = /\.(pem|txt|crt|cer|cert|p12|pfx)$/i
const CERT_MIMES = ["application/x-pem-file", "text/plain", "application/x-x509-ca-cert", "application/x-pkcs12"]

/** Windows no registra MIME para .pem/.p12 (llega vacio u octet-stream): se fija uno, por servidores que aun filtren por MIME. */
const certWithMime = (f: File) => (CERT_MIMES.includes(f.type) ? f : new File([f], f.name, { type: /\.(p12|pfx)$/i.test(f.name) ? "application/x-pkcs12" : "application/x-pem-file", lastModified: f.lastModified }))

/** Mensaje persistente del rechazo de un archivo (logo o certificado), antes de enviarlo. */
export function fileProblem(kind: "logo" | "cert", f: File): string | null {
  if (kind === "logo") {
    if (/\.svg$/i.test(f.name) || f.type === "image/svg+xml") return `«${f.name}» no se subió: los SVG no se admiten. Usa un archivo JPG, PNG o WebP.`
    if (!LOGO_OK.test(f.name)) return `«${f.name}» no se subió: el logo debe ser JPG, PNG o WebP.`
    if (f.size > MAX_LOGO) return `«${f.name}» no se subió: pesa ${fmtKb(f.size)} y el máximo es 2 MB.`
    return null
  }
  if (!CERT_OK.test(f.name)) return `«${f.name}» no se subió: usa el .p12 / .pfx de SUNAT o un archivo .pem, .txt, .crt, .cer o .cert.`
  if (f.size > MAX_CERT) return `«${f.name}» no se subió: pesa ${fmtKb(f.size)} y el máximo es 256 KB.`
  return null
}

export function useEmpEmpresa(onDirty?: (n: number) => void) {
  const [company, setCompany] = useState<Company | null>(null)
  const [status, setStatus] = useState<EmpLoad>("load")
  const [failure, setFailure] = useState<ApiFailure | null>(null)
  const [creating, setCreating] = useState(false)
  const [draft, setDraft] = useState<EmpDraft>(EMPTY_DRAFT)
  const [tried, setTried] = useState(false)
  const [server, setServer] = useState<EmpErrors>({})
  const [fileErr, setFileErr] = useState<EmpErrors>({})
  const [msg, setMsg] = useState<string | null>(null)
  const [c409, setC409] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState<EmpSaved | null>(null)
  const [vence, setVence] = useState<string | null>(null)

  const load = useCallback(async (keepSaved = false) => {
    if (!keepSaved) setStatus("load")
    setFailure(null)
    try {
      const c = await fetchCompany()
      setCompany(c); setDraft(draftFrom(c)); setStatus("ok")
    } catch (error) {
      const f = apiFailure(error, "No se pudo cargar la empresa")
      setFailure(f); setStatus(f.status === 403 ? "forbidden" : "error")
    }
    if (!keepSaved) setSaved(null)
  }, [])
  useEffect(() => { void load() }, [load])

  const base = company
  const changed = useMemo(() => changedFields(draft, base), [draft, base])
  const clientErrs = useMemo(() => validate(draft, base, tried), [draft, base, tried])
  const errs: EmpErrors = useMemo(() => {
    const out: EmpErrors = { ...clientErrs }
    for (const src of [fileErr, server]) for (const k of Object.keys(src) as EmpField[]) if (src[k]) out[k] = src[k]
    return out
  }, [clientErrs, fileErr, server])
  useEffect(() => { onDirty?.(changed.length) }, [changed.length, onDirty])

  const set = useCallback(<K extends keyof EmpDraft>(k: K, v: EmpDraft[K]) => {
    setDraft(d => ({ ...d, [k]: v }))
    setServer(s => { if (!s[k as EmpField]) return s; const n = { ...s }; delete n[k as EmpField]; return n })
    setSaved(null); setMsg(null)
    if (k === "ruc") setC409(null)
  }, [])

  const pick = useCallback((kind: "logo" | "cert", f: File | null) => {
    // La contrasena pertenece al archivo elegido: se borra al quitarlo o cambiarlo.
    if (kind === "cert") set("cert_password", "")
    if (!f) { set(kind, null); setFileErr(e => ({ ...e, [kind]: undefined })); return }
    const p = fileProblem(kind, f)
    setFileErr(e => ({ ...e, [kind]: p ?? undefined }))
    if (!p) set(kind, kind === "cert" ? certWithMime(f) : f)
  }, [set])

  const discard = useCallback(() => {
    setDraft(draftFrom(base)); setTried(false); setServer({}); setFileErr({}); setMsg(null); setC409(null)
  }, [base])

  const startCreate = useCallback(() => { setCreating(true); setDraft(EMPTY_DRAFT); setTried(false) }, [])
  const cancelCreate = useCallback(() => { setCreating(false); discard() }, [discard])

  const submit = useCallback(async () => {
    setTried(true); setMsg(null); setC409(null)
    const bad = validate(draft, base, true)
    if (Object.values(bad).some(Boolean) || Object.values(fileErr).some(Boolean)) return false
    setSaving(true)
    try {
      const body = buildBody(draft)
      const res = base ? await updateCompany(base.id_company, body) : await createCompany(body)
      const created = !base
      setServer({}); setFileErr({}); setTried(false); setCreating(false)
      setVence(res.certificado?.vence_en ?? null)
      setSaved({ avisos: res.avisos, vence: res.certificado?.vence_en ?? null, at: nowLimaStamp(), created })
      await load(true)
      return true
    } catch (error) {
      const f = apiFailure(error, "No se pudo guardar la empresa")
      const map = f.errores as EmpErrors
      setServer(map)
      if (f.status === 409) setC409(f.message)
      else if (!Object.keys(map).length) setMsg(f.message)
      return false
    } finally { setSaving(false) }
  }, [draft, base, fileErr, load])

  const alta = !base && creating
  return { company, status, failure, creating, alta, draft, set, pick, changed, errs, tried, msg, c409, saving, saved, vence, load, discard, startCreate, cancelCreate, submit, dismissSaved: () => setSaved(null) }
}
