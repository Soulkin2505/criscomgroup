import { useRef } from "react"
import { Info } from "lucide-react"
import { fieldName, isPkcs12, type EmpField } from "./empForm"
import { EmpApi, EmpSol } from "./EmpSecrets"
import { EmpCert } from "./EmpCert"
import { EmpFicha } from "./EmpFicha"
import { EmpIdent } from "./EmpIdent"
import { EmpLogo } from "./EmpLogo"
import { EmpModo } from "./EmpModo"
import { EmpNote } from "./empParts"
import { EmpSaveBar, type SaveKind } from "./EmpSaveBar"
import { EmpEmpty, EmpError, EmpForbidden, EmpLoading } from "./EmpStates"
import { pl } from "./empFormat"
import { useEmpEmpresa } from "./useEmpEmpresa"
import type { EmpFichaCtl } from "./useEmpEstado"

export interface EmpTabProps { mob: boolean; ficha: EmpFichaCtl; onDirty?: (n: number) => void; onGoto?: (tab: string) => void }
const REASON = "Solo Gerencia (rol 1) puede ver y editar los datos de la empresa."

export function EmpEmpresaTab({ ficha, onDirty }: EmpTabProps) {
  const h = useEmpEmpresa(onDirty)
  const zone = useRef<HTMLDivElement>(null)
  const { draft: d, errs, company: base, alta } = h

  if (h.status === "load") return <EmpLoading what="los datos de la empresa" />
  if (h.status === "forbidden") return <EmpForbidden reason={REASON} />
  if (h.status === "error") return <EmpError what="los datos de la empresa" message={h.failure?.message} onRetry={() => void h.load()} />
  if (!base && !h.creating) return <EmpEmpty onCreate={h.startCreate} />

  const errFields = (Object.keys(errs) as EmpField[]).filter(f => errs[f])
  const missing = [!d.razon_social && "razón social", !d.ruc && "RUC", !d.direccion && "dirección", !d.sol_user && "usuario SOL", !d.sol_pass && "clave SOL", !d.cert && "certificado", isPkcs12(d.cert) && !d.cert_password && "contraseña del certificado"].filter(Boolean) as string[]
  const sum = h.tried && errFields.length > 0
  let kind: SaveKind = "clean"
  if (h.saving) kind = "saving"
  else if (alta) kind = missing.length ? "alta" : "altaok"
  else if (sum) kind = "err"
  else if (h.changed.length) kind = "dirty"
  else if (h.saved) kind = "saved"
  const names = (kind === "err" ? errFields : h.changed).map(fieldName)

  const save = async () => {
    const ok = await h.submit()
    window.setTimeout(() => {
      const z = zone.current
      if (!z) return
      if (ok) z.scrollTo({ top: 0 })
      else z.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()
    }, 60)
  }
  const sv = h.saved

  return (
    <>
      <div className="zn" ref={zone}>
        {alta && <EmpNote kind="inf" icon={Info}><strong>Aún no hay empresa registrada</strong>Completa los datos obligatorios para registrar la empresa emisora y poder facturar.</EmpNote>}
        {sum && (
          <EmpNote kind="bad">
            <strong>Revisa {pl(errFields.length, "campo")} antes de guardar</strong>
            <ul>{errFields.map(f => <li key={f}><b>{fieldName(f)}:</b> {errs[f]}</li>)}</ul>
          </EmpNote>
        )}
        {h.c409 && <EmpNote kind="bad"><strong>409 · No se puede guardar</strong>{h.c409}</EmpNote>}
        {h.msg && <EmpNote kind="bad"><strong>No se pudo guardar</strong>{h.msg}</EmpNote>}
        {sv && (
          <EmpNote kind="ok" acts={<button type="button" className="btn out" onClick={h.dismissSaved}>Entendido</button>}>
            <strong>{sv.created ? "Empresa registrada" : "Empresa guardada"}</strong>
            {sv.avisos.length > 0 ? <>El servidor devolvió {pl(sv.avisos.length, "aviso")}:<ul>{sv.avisos.map(a => <li key={a}>{a}</li>)}</ul></> : "No hubo avisos."}
          </EmpNote>
        )}
        <div className="cards">
          <EmpIdent d={d} base={base} errs={errs} set={h.set} />
          <EmpLogo base={base} file={d.logo} error={errs.logo} onPick={f => h.pick("logo", f)} />
          <EmpSol d={d} base={base} errs={errs} alta={alta} set={h.set} />
          <EmpCert
            base={base} file={d.cert} vence={h.vence} error={errs.cert} alta={alta} onPick={f => h.pick("cert", f)}
            password={d.cert_password} passwordError={errs.cert_password} onPassword={v => h.set("cert_password", v)}
          />
          <EmpApi d={d} base={base} errs={errs} set={h.set} />
          {/* Subir la ficha puede pasar la empresa a produccion: se relee para mostrar el modo nuevo. */}
          <EmpFicha ctl={{ ...ficha, onSheet: s => { ficha.onSheet(s); void h.load(true) } }} alta={alta} cert={!!base?.certificado_configurado} />
          <EmpModo base={base} onChanged={() => { void h.load(true); ficha.reload() }} />
        </div>
      </div>
      <EmpSaveBar
        kind={kind} tab="Empresa" count={kind === "err" ? errFields.length : h.changed.length} names={names} savedAt={sv?.at}
        missing={`Falta: ${missing.join(", ")}.`} saveLabel={alta ? "Registrar empresa" : "Guardar cambios"}
        onSave={() => void save()} onDiscard={alta ? h.cancelCreate : h.discard}
      />
    </>
  )
}
