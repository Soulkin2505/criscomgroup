import api from '../lib/api'

export type CategoriaGasto =
  | 'insumos' | 'herramientas' | 'repuestos_stock' | 'alquiler' | 'servicios'
  | 'mano_obra_tercerizada' | 'transporte' | 'limpieza' | 'software' | 'capacitacion' | 'otros'

export type ComprobanteGasto = 'ninguno' | 'boleta' | 'factura' | 'recibo' | 'otro'

export type GastoTaller = {
  id_gasto: number
  fecha: string
  categoria: CategoriaGasto
  descripcion: string
  monto: string
  medio_pago?: string | null
  proveedor?: string | null
  comprobante_tipo: ComprobanteGasto
  comprobante_numero?: string | null
  orden_servicio_id?: number | null
  notas?: string | null
  registrado_por: number
  creado_en?: string
}

export type ResumenGastos = {
  periodo: { desde: string; hasta: string }
  total_gastos: number
  por_categoria: { categoria: CategoriaGasto; total: number; cantidad: number }[]
}

type Filtro = { periodo?: 'hoy' | 'semana' | 'mes'; desde?: string; hasta?: string; categoria?: CategoriaGasto }

const qs = (filtro: Filtro = {}) => {
  const params = new URLSearchParams()
  Object.entries(filtro).forEach(([key, value]) => { if (value) params.append(key, String(value)) })
  const s = params.toString()
  return s ? `?${s}` : ''
}

export const listGastosTaller = async (filtro?: Filtro): Promise<GastoTaller[]> =>
  (await api.get(`/gastos-taller${qs(filtro)}`)).data
export const resumenGastosTaller = async (filtro?: Filtro): Promise<ResumenGastos> =>
  (await api.get(`/gastos-taller/resumen${qs(filtro)}`)).data
export const createGastoTaller = async (data: Record<string, unknown>) =>
  (await api.post('/gastos-taller', data)).data
export const updateGastoTaller = async (id: number, data: Record<string, unknown>) =>
  (await api.put(`/gastos-taller/${id}`, data)).data
export const deleteGastoTaller = async (id: number) =>
  (await api.delete(`/gastos-taller/${id}`)).data
