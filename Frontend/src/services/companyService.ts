import api from "../lib/api"
import type { AxiosError } from 'axios'

export interface Company {
  id_company: number
  razon_social: string
  ruc: string
  tipo_ruc?: '10' | '20'
  direccion: string
  logo_url: string | null
  // Si esta empresa es la que muestra su razon social/RUC/direccion en la web publica (una a la vez).
  mostrar_en_web?: boolean
  client_id?: string | null
  // Los secretos (usuario/clave SOL, certificado, client_secret) nunca llegan al navegador: solo estas marcas.
  sol_configurado?: boolean
  certificado_configurado?: boolean
  client_secret_configurado?: boolean
  ruc_valido?: boolean
  // Modo real de la empresa: automatico (servidor + SOL + certificado + ficha RUC) salvo pruebas manuales.
  production?: boolean
  modo_sunat?: 'production' | 'sandbox'
  modo_sunat_estado?: SunatModeState
  sunat_pruebas_manual?: boolean
  sunat_produccion_desde?: string | null
  id_user?: number
  creado_en?: string
  actualizado_en?: string
}

/** Por que la empresa esta en pruebas o produccion: servidor (SUNAT_MODE), manual, incompleto o automatico. */
export type SunatModeReason = 'servidor' | 'manual' | 'incompleto' | 'automatico'
export interface SunatModeState { motivo: SunatModeReason; pendientes: string[]; activada: boolean; servidor: 'production' | 'sandbox'; aviso_servidor: string | null }

export interface SaveCompanyResult { company: Company; avisos: string[]; certificado?: { vence_en: string } | null }

export interface BusinessHours {
  horario_inicio: string
  horario_fin: string
  horario_restriccion_activa: boolean
  horario_valido?: boolean
  configurada?: boolean
  zona_horaria?: string
  ahora_lima?: string
  dentro_de_horario?: boolean
  bloquea_a?: string
  avisos?: string[]
}

export interface ApiFailure { status: number | null; message: string; errores: Record<string, string>; extra: Record<string, unknown> }
// Normaliza un error de axios para distinguir sin permiso (403), error de servidor (5xx) y errores de validacion.
export const apiFailure = (error: unknown, fallback: string): ApiFailure => {
  const err = error as AxiosError<{ message?: string; error?: string; errores?: Record<string, string> } & Record<string, unknown>>
  const data = err?.response?.data
  const status = err?.response?.status ?? null
  const message = data?.message || data?.error || (status === 403 ? 'No tienes permisos para esta sección' : status && status >= 500 ? 'Error del servidor. Inténtalo de nuevo.' : fallback)
  return { status, message, errores: data?.errores || {}, extra: (data as Record<string, unknown>) || {} }
}

export interface IntegrationStatus {
  sunat: {
    mode: 'production' | 'sandbox'; mode_valid: boolean; warning: string | null
    motivo?: SunatModeReason; pendientes?: string[]; pruebas_manual?: boolean; produccion_desde?: string | null; servidor?: 'production' | 'sandbox'
    credentials: boolean; certificate: boolean; connected: boolean; credentials_source?: string; certificate_source?: string }
  culqi: { mode: string; source: string; public_key: boolean; secret_key: boolean; connected: boolean } | null
}
export interface RucSheet { uploaded: boolean; original_name?: string; updated_at?: string; size?: number | null; mime?: string | null }

export const fetchBusinessHours = async (): Promise<BusinessHours> => (await api.get('/companies/settings/business-hours')).data
export const updateBusinessHours = async (hours: BusinessHours): Promise<BusinessHours> => (await api.patch('/companies/settings/business-hours', {
  horario_inicio: hours.horario_inicio,
  horario_fin: hours.horario_fin,
  horario_restriccion_activa: hours.horario_restriccion_activa,
})).data
export const fetchIntegrations = async (): Promise<IntegrationStatus> => (await api.get('/companies/settings/integrations')).data
export const fetchRucSheet = async (): Promise<RucSheet> => (await api.get('/companies/settings/ruc-sheet')).data
export const uploadRucSheet = async (file: File): Promise<RucSheet> => {
  const body = new FormData(); body.append('ficha_ruc', file)
  // El cliente axios trae Content-Type JSON por defecto: sin forzar multipart el FormData viaja como JSON y el servidor no ve el archivo.
  return (await api.post('/companies/settings/ruc-sheet', body, { headers: { 'Content-Type': 'multipart/form-data' } })).data
}
export const deleteRucSheet = async (): Promise<void> => { await api.delete('/companies/settings/ruc-sheet') }
// Activa/desactiva el modo pruebas manual; el servidor exige escribir PRUEBAS o PRODUCCION.
export const setSunatTestMode = async (pruebas: boolean, confirmacion: string): Promise<{ mode: 'production' | 'sandbox'; motivo: SunatModeReason; pendientes: string[] }> =>
  (await api.patch('/companies/settings/sunat-mode', { pruebas, confirmacion })).data
export const downloadRucSheet = async (): Promise<Blob> => (await api.get('/companies/settings/ruc-sheet/download', { responseType: 'blob' })).data

// Devuelve null SOLO cuando no hay empresa; cualquier error (403, 500, red) se propaga para no confundirlo con "sin empresa".
export const fetchCompany = async (): Promise<Company | null> => {
  const response = await api.get(`/companies`)
  return Array.isArray(response.data) && response.data.length > 0 ? response.data[0] : null
}

export const fetchCompanyByRuc = async (ruc: string): Promise<Company> => {
  const response = await api.get(`/companies/${ruc}`)
  return response.data.data
}

// Todas las empresas registradas (para elegir cual se muestra en la web publica).
export const fetchCompanies = async (): Promise<Company[]> => {
  const response = await api.get('/companies')
  return Array.isArray(response.data) ? response.data : []
}

export const setCompanyMostrarEnWeb = async (id: number, mostrar: boolean): Promise<Company> => {
  const response = await api.patch(`/companies/${id}/mostrar-en-web`, { mostrar_en_web: mostrar })
  return response.data.company
}

export const createCompany = async (formData: FormData): Promise<SaveCompanyResult> => {
  const response = await api.post(`/companies`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  })
  return { company: response.data.company, avisos: response.data.avisos || [], certificado: response.data.certificado }
}

export const updateCompany = async (id: number, formData: FormData): Promise<SaveCompanyResult> => {
  const response = await api.put(`/companies/${id}`, formData, {
    headers: {
      "Content-Type": "multipart/form-data",
    },
  })
  return { company: response.data.company, avisos: response.data.avisos || [], certificado: response.data.certificado }
}

export const deleteCompany = async (ruc: string): Promise<void> => {
  await api.delete(`/companies/${ruc}`)
}

export const fetchCompanyForSales = async (): Promise<Company | null> => {
  try {
    // Primero intentamos obtener las empresas del usuario actual (para administradores)
    const response = await api.get('/companies');

    if (response.data && response.data.length > 0) {
      return response.data[0]; // Usar la primera empresa encontrada
    }

    // Si no hay empresas para el usuario actual o no es admin, usar la ruta especial
    const fallbackResponse = await api.get('/companies/for-sales');
    if (fallbackResponse.data && fallbackResponse.data.data) {
      return fallbackResponse.data.data;
    }

    // Empresa no configurada — estado de dominio válido (D5 Opción C)
    return null;
  } catch (error) {
    const err = error as AxiosError
    console.error('Error al obtener empresa para ventas:', {
      status: err?.response?.status,
      url: err?.config?.url,
      message: err?.message,
    })
    throw error;
  }
};
