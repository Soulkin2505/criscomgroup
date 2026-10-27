import type { Company } from "../../../services/companyService"
import type { EmpDraft, EmpErrors } from "./empForm"
import { EmpCard, EmpField, EmpSecret } from "./empParts"

interface Props { d: EmpDraft; base: Company | null; errs: EmpErrors; alta: boolean; set: <K extends keyof EmpDraft>(k: K, v: EmpDraft[K]) => void }

/** Acceso SOL: usuario y clave. Nunca se muestran; vacio conserva lo guardado. */
export function EmpSol({ d, base, errs, alta, set }: Props) {
  const on = !!base?.sol_configurado
  return (
    <EmpCard sec="sol" title="Acceso SOL" help="Credenciales con las que se factura. Nunca se muestran.">
      <div className="gd">
        <EmpSecret cls="g6" label="Usuario SOL" type="text" required={alta} configured={on} value={d.sol_user} onChange={v => set("sol_user", v)} error={errs.sol_user} hint={alta ? "Obligatorio al registrar." : undefined} />
        <EmpSecret cls="g6" label="Clave SOL" required={alta} configured={on} value={d.sol_pass} onChange={v => set("sol_pass", v)} error={errs.sol_pass} hint={alta ? "Obligatorio al registrar." : undefined} />
      </div>
    </EmpCard>
  )
}

/** API SUNAT: client id y client secret (opcionales; guías de remisión). El modo vive en su propia tarjeta (EmpModo). */
export function EmpApi({ d, base, errs, set }: Omit<Props, "alta">) {
  return (
    <EmpCard sec="api" title="API SUNAT" help="Credenciales de la API (opcionales, para guías de remisión).">
      <div className="gd">
        <EmpField cls="g6" label="Client ID" value={d.client_id} onChange={v => set("client_id", v)} placeholder="Opcional" error={errs.client_id} />
        <EmpSecret cls="g6" label="Client secret" configured={!!base?.client_secret_configurado} value={d.client_secret} onChange={v => set("client_secret", v)} placeholder="Opcional — vacío conserva" error={errs.client_secret} />
      </div>
    </EmpCard>
  )
}
