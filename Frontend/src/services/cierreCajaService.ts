import api from "../lib/api"

export interface CierreCajaPayload {
  fecha_apertura: string;
  fecha_cierre: string;
  cajero_id: number;
  saldo_efectivo: number; // Changed from monto_total to saldo_efectivo
  total_efectivo: number;
  total_tarjeta: number;
  total_transferencia: number;
  total_yape?: number;
  total_plin?: number;
  cantidad_ventas: number;
  estado: string;
  observaciones?: string;
}

export interface UpdateCierreCajaPayload {
  saldo_efectivo?: number; // Changed from monto_total to saldo_efectivo
  total_efectivo?: number;
  total_tarjeta?: number;
  total_transferencia?: number;
  total_yape?: number;
  total_plin?: number;
  fecha_cierre?: string;
  cantidad_ventas?: number;
  estado?: string;
  observaciones?: string;
}

export async function registrarCierreCaja(data: CierreCajaPayload) {
  const response = await api.post("/cierre-caja", data)
  return response.data
}

export async function actualizarCierreCaja(id: number, data: UpdateCierreCajaPayload) {
  const response = await api.put(`/cierre-caja/${id}`, data)
  return response.data
}

export async function obtenerCierreCajaPorFecha(fecha_apertura: string) {
  // Se asume que el backend acepta el query param ?fecha_apertura=YYYY-MM-DD
  const response = await api.get(`/cierre-caja?fecha_apertura=${fecha_apertura}`);
  return response.data;
}

export async function obtenerCierresCajaPorRango(fechaInicio: string, fechaFin: string) {
  const response = await api.get(`/cierre-caja/rango-fechas?fechaInicio=${fechaInicio}&fechaFin=${fechaFin}`);
  return response.data;
}

export async function obtenerTodosLosCierresCaja() {
  const response = await api.get("/cierre-caja");
  return response.data;
}

export interface DailyResult {
  cobrado: number; cobrado_ventas: number; cobrado_taller: number;
  egresos_efectivo: number; efectivo_neto: number;
  por_metodo: Record<string, { total: number; cantidad: number }>;
  ingresos_productos: number; ingresos_servicios: number; costo_productos: number; costo_servicios: number;
  gastos_generales: number; margen_productos: number | null; margen_servicios: number; resultado_estimado: number | null;
  costos_sin_registrar: number; criterio: string; alcance: string;
}
export const obtenerResumenDiario = async (fecha: string): Promise<DailyResult> => (await api.get('/cierre-caja/resumen-diario', { params: { fecha } })).data;
