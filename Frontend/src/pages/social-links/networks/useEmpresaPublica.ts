import { useCallback, useEffect, useState } from "react"
import { toast } from "sonner"
import { fetchCompanies, setCompanyMostrarEnWeb, type Company } from "../../../services/companyService"
import { getApiErrorMessage } from "../../../services/marketingService"

export function useEmpresaPublica() {
  const [empresas, setEmpresas] = useState<Company[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [savingId, setSavingId] = useState<number | null>(null)

  const load = useCallback(() => {
    setLoading(true)
    setLoadError(null)
    fetchCompanies()
      .then(setEmpresas)
      .catch(e => {
        const m = getApiErrorMessage(e, "No se pudieron cargar las empresas registradas")
        setLoadError(m)
        toast.error(m)
      })
      .finally(() => setLoading(false))
  }, [])
  useEffect(() => { load() }, [load])

  const elegir = async (id: number) => {
    if (savingId) return
    setSavingId(id)
    try {
      await setCompanyMostrarEnWeb(id, true)
      setEmpresas(list => list.map(c => ({ ...c, mostrar_en_web: c.id_company === id })))
      toast.success("RUC público actualizado en la web")
    } catch (e) {
      toast.error(getApiErrorMessage(e, "No se pudo actualizar el RUC público"))
    } finally {
      setSavingId(null)
    }
  }

  return { empresas, loading, loadError, savingId, load, elegir }
}
export type EmpresaPublica = ReturnType<typeof useEmpresaPublica>
