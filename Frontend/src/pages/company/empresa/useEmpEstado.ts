import { useCallback, useEffect, useState } from "react"
import { apiFailure, fetchIntegrations, fetchRucSheet, type ApiFailure, type IntegrationStatus, type RucSheet } from "../../../services/companyService"

/** Ficha RUC compartida entre la barra de estado y la pestana Empresa. */
export interface EmpFichaCtl {
  sheet: RucSheet
  error: ApiFailure | null
  loading: boolean
  onSheet: (s: RucSheet) => void
  reload: () => void
}

/**
 * Estado real de la cabecera: integraciones (SUNAT/Culqi) y ficha RUC.
 * Cada lectura falla por separado; un 403 o un 500 se dicen, no se confunden con "incompleto".
 */
export function useEmpEstado(canStatus: boolean, canSheet: boolean) {
  const [status, setStatus] = useState<IntegrationStatus | null>(null)
  const [statusError, setStatusError] = useState<ApiFailure | null>(null)
  const [sheet, setSheet] = useState<RucSheet>({ uploaded: false })
  const [sheetError, setSheetError] = useState<ApiFailure | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!canStatus && !canSheet) return
    setLoading(true); setStatusError(null); setSheetError(null)
    await Promise.all([
      canStatus
        ? fetchIntegrations().then(setStatus).catch(e => { setStatus(null); setStatusError(apiFailure(e, "No se pudo leer el estado")) })
        : Promise.resolve(),
      canSheet
        ? fetchRucSheet().then(setSheet).catch(e => setSheetError(apiFailure(e, "No se pudo leer la ficha RUC")))
        : Promise.resolve(),
    ])
    setLoading(false)
  }, [canStatus, canSheet])
  useEffect(() => { void load() }, [load])

  // La ficha RUC puede cambiar el modo SUNAT (paso automatico a produccion): se relee el estado de la cabecera.
  const onSheet = (s: RucSheet) => {
    setSheet(s)
    if (canStatus) void fetchIntegrations().then(setStatus).catch(() => {})
  }
  const ficha: EmpFichaCtl = { sheet, error: sheetError, loading, onSheet, reload: () => void load() }
  return { status, statusError, sheetError, sheet, ficha, reload: load }
}
