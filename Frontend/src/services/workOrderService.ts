import api from "../lib/api";

export type WorkOrderType = "servicio_tecnico" | "armado_pc" | "mantenimiento";
export type WorkOrder = {
  id_orden_servicio: number;
  tipo: WorkOrderType;
  subtipo_trabajo?: "preventivo" | "correctivo" | "optimizacion" | "limpieza_profunda";
  tareas_solicitadas?: string[];
  codigo: string;
  cliente_servicio_id?: number;
  activo_tecnico_id?: number;
  cliente: string;
  telefono?: string;
  whatsapp_consentimiento?: boolean;
  whatsapp_consentimiento_en?: string;
  whatsapp_consentimiento_revocado_en?: string;
  whatsapp_consentimiento_fuente?: string;
  documento?: string;
  equipo: string;
  numero_serie?: string;
  detalle: string;
  accesorios?: string;
  estado_fisico?: string[];
  accesorios_recibidos?: string[];
  recepcion_conforme?: boolean;
  recepcion_conforme_en?: string;
  diagnostico_configuracion?: string;
  trabajo_realizado?: string;
  estado: string;
  moneda: "PEN" | "USD";
  costo_repuestos: string;
  costo_mano_obra: string;
  descuento: string;
  recargo: string;
  adelanto: string;
  fecha_ingreso: string;
  fecha_entrega_estimada?: string;
  garantia_dias: number;
  notas?: string;
  garantia_inicio?: string;
  garantia_fin?: string;
  garantia_cobertura?: string;
  garantia_exclusiones?: string;
  fecha_entrega_real?: string;
  orden_origen_garantia_id?: number;
  tecnico_id?: number | null;
  token_seguimiento?: string;
  venta_id?: number;
  clasificacion_fiscal?: "recibo_honorarios" | "boleta_factura" | "mixta";
  estado_facturacion?: "sin_facturar" | "pendiente_emision" | "emitido" | "error";
  referencia_comprobante?: string;
  cliente_registrado?: TechnicalClient;
  activo?: TechnicalAsset;
};
export type TechnicalClient = {
  id_cliente_servicio: number;
  nombre: string;
  tipo_documento?: string;
  documento?: string;
  telefono?: string;
  email?: string;
  notas?: string;
  activos?: TechnicalAsset[];
};
export type TechnicalAsset = {
  id_activo_tecnico: number;
  id_cliente_servicio: number;
  tipo: string;
  marca?: string;
  modelo?: string;
  numero_serie?: string;
  imei?: string;
  color?: string;
  alias?: string;
  notas?: string;
  cliente?: TechnicalClient;
};
export type WorkOrderTechnician = { id_user: number; name: string };
export type WorkOrderEvent = {
  id_evento: number;
  tipo: string;
  estado_anterior?: string;
  estado_nuevo?: string;
  detalle?: string;
  creado_en: string;
};
export type WorkOrderPaymentMethod =
  "efectivo" | "pos" | "qr" | "transferencia" | "otro" | "tarjeta" | "yape" | "plin" | "pago_link";
export type WorkOrderPayment = {
  id_pago_servicio: number;
  id_orden_servicio: number;
  metodo: WorkOrderPaymentMethod;
  monto: string;
  moneda: "PEN" | "USD";
  referencia?: string;
  nota?: string;
  estado: "confirmado" | "anulado";
  anulacion_motivo?: string;
  creado_en: string;
};
export type WorkOrderPart = {
  id_repuesto_servicio: number;
  id_orden_servicio: number;
  id_producto?: number;
  sku?: string;
  descripcion: string;
  cantidad: number;
  costo_unitario: string;
  precio_unitario: string;
  estado_stock: "no_aplica" | "reservado" | "consumido" | "devuelto";
  creado_en: string;
};
export type WorkOrderEvidence = {
  id_evidencia_servicio: number;
  id_orden_servicio: number;
  etapa:
    "recepcion" | "diagnostico" | "reparacion" | "pruebas" | "entrega" | "otro" | "firma_recepcion" | "firma_garantia";
  tipo: "imagen" | "audio" | "documento" | "firma";
  nombre_original: string;
  mime: string;
  tamano: number;
  descripcion?: string;
  firmante_nombre?: string;
  firmante_dni?: string;
  hash_sha256?: string;
  origen: string;
  visible_cliente: boolean;
  publicada_en?: string;
  archivo_url: string;
  creado_en: string;
};
export type WorkOrderQuote = {
  id_cotizacion_servicio: number;
  id_orden_servicio: number;
  version: number;
  moneda: "PEN" | "USD";
  repuestos: string;
  mano_obra: string;
  descuento: string;
  recargo: string;
  total: string;
  diagnostico?: string;
  trabajo_propuesto?: string;
  condiciones?: string;
  estado: "borrador" | "enviada" | "aprobada" | "rechazada" | "reemplazada";
  enviada_en?: string;
  resuelta_en?: string;
  aprobador_nombre?: string;
  canal_respuesta?: "presencial" | "whatsapp" | "correo" | "web" | "otro";
  evidencia_consentimiento?: string;
  creada_en: string;
};
export type WorkOrderCashSummary = {
  fecha: string;
  periodo?: { desde: string; hasta: string };
  monedas: Record<string, {
    cobrado: number;
    cobrado_servicios: number;
    cobrado_repuestos: number;
    anulado: number;
    costo_repuestos: number;
    saldo_por_cobrar: number;
    margen_bruto: number;
    por_metodo: Record<WorkOrderPaymentMethod, number>;
  }>;
  gastos_taller?: number;
  ganancia_estimada?: number;
};
export type AssistedDiagnostic = {
  id_diagnostico_asistido: number;
  id_orden_servicio: number;
  version: number;
  sintomas: string;
  pruebas: Record<string, unknown>;
  resultado: { hypotheses: Array<{ cause: string; confidence: number; evidence: string[]; actions: string[] }>; next_tests: string[]; red_flags: string[]; disclaimer: string; engine: string };
  estado: 'borrador' | 'aceptado' | 'rechazado' | 'reemplazado';
  diagnostico_final?: string;
  revision_nota?: string;
  creado_en: string;
};
export type WorkOrderMessage = { id_mensaje_servicio: number; plantilla: string; contenido: string; estado: 'preparado' | 'abierto' | 'cancelado'; consentimiento_fuente: string; creado_en: string };
export type WorkOrderChannelEvent = {
  id_canal_evento: number;
  direccion: "entrante" | "saliente";
  remitente_tipo: "cliente" | "tecnico" | "sistema";
  remitente_nombre?: string;
  remitente_ultimos4?: string;
  contenido?: string;
  tipo_contenido: "texto" | "imagen" | "archivo";
  recibido_en: string;
  evidencia?: Pick<WorkOrderEvidence, "id_evidencia_servicio" | "tipo" | "mime" | "descripcion" | "origen" | "visible_cliente" | "creado_en" | "archivo_url">;
};
export const listWorkOrders = async (
  tipo: WorkOrderType,
): Promise<WorkOrder[]> =>
  (await api.get("/ordenes-servicio", { params: { tipo } })).data;
export const getWorkOrderCashSummary = async (fecha?: string): Promise<WorkOrderCashSummary> =>
  (await api.get("/ordenes-servicio/caja/resumen", { params: { fecha } })).data;
export const getCajaTallerResumen = async (
  params: { periodo?: "hoy" | "semana" | "mes"; desde?: string; hasta?: string } = {},
): Promise<WorkOrderCashSummary> =>
  (await api.get("/ordenes-servicio/caja/resumen", { params })).data;
export const listWorkOrderTechnicians = async (): Promise<WorkOrderTechnician[]> =>
  (await api.get("/ordenes-servicio/tecnicos")).data;
export const listTechnicalClients = async (q?: string): Promise<TechnicalClient[]> =>
  (await api.get('/servicio-tecnico/clientes', { params: { q } })).data;
export const createTechnicalClient = async (data: Partial<TechnicalClient>): Promise<TechnicalClient> =>
  (await api.post('/servicio-tecnico/clientes', data)).data;
export const listTechnicalAssets = async (params: { q?: string; cliente_id?: number } = {}): Promise<TechnicalAsset[]> =>
  (await api.get('/servicio-tecnico/activos', { params })).data;
export const createTechnicalAsset = async (data: Partial<TechnicalAsset>): Promise<TechnicalAsset> =>
  (await api.post('/servicio-tecnico/activos', data)).data;
export const createWorkOrder = async (data: Record<string, unknown>) =>
  (await api.post("/ordenes-servicio", data)).data;
export const setWorkOrderCredential = async (id: number, data: { secreto: string; tipo?: string; horas_vigencia?: number }) =>
  (await api.post(`/ordenes-servicio/${id}/credencial-temporal`, data)).data;
export const createWarrantyReentry = async (
  id: number,
  data: { motivo: string; accesorios?: string },
): Promise<WorkOrder> =>
  (await api.post(`/ordenes-servicio/${id}/reingreso-garantia`, data)).data;
export const updateWorkOrder = async (
  id: number,
  data: Record<string, unknown>,
) => (await api.put(`/ordenes-servicio/${id}`, data)).data;
export const listWorkOrderHistory = async (
  id: number,
): Promise<WorkOrderEvent[]> =>
  (await api.get(`/ordenes-servicio/${id}/historial`)).data;
export const listAssistedDiagnostics = async (id: number): Promise<AssistedDiagnostic[]> =>
  (await api.get(`/ordenes-servicio/${id}/diagnosticos-asistidos`)).data;
export const generateAssistedDiagnostic = async (id: number, data: { sintomas: string; pruebas: Record<string, unknown> }): Promise<AssistedDiagnostic> =>
  (await api.post(`/ordenes-servicio/${id}/diagnosticos-asistidos`, data)).data;
export const reviewAssistedDiagnostic = async (id: number, diagnosticId: number, data: { estado: 'aceptado' | 'rechazado'; diagnostico_final?: string; nota?: string }): Promise<AssistedDiagnostic> =>
  (await api.post(`/ordenes-servicio/${id}/diagnosticos-asistidos/${diagnosticId}/revisar`, data)).data;
export const listWorkOrderMessages = async (id: number): Promise<WorkOrderMessage[]> =>
  (await api.get(`/ordenes-servicio/${id}/mensajes`)).data;
export const listWorkOrderChannelTimeline = async (id: number): Promise<WorkOrderChannelEvent[]> =>
  (await api.get(`/ordenes-servicio/${id}/canal-whatsapp`)).data;
export const prepareWorkOrderMessage = async (id: number, plantilla: string): Promise<{ id_mensaje_servicio: number; contenido: string; url: string; estado: string }> =>
  (await api.post(`/ordenes-servicio/${id}/mensajes/preparar`, { plantilla })).data;
export const markWorkOrderMessageOpened = async (id: number, messageId: number) =>
  (await api.post(`/ordenes-servicio/${id}/mensajes/${messageId}/abierto`)).data;
export const listWorkOrderPayments = async (
  id: number,
): Promise<WorkOrderPayment[]> =>
  (await api.get(`/ordenes-servicio/${id}/pagos`)).data;
export const addWorkOrderPayment = async (
  id: number,
  data: {
    metodo: WorkOrderPaymentMethod;
    monto: number;
    referencia?: string;
    nota?: string;
  },
) => (await api.post(`/ordenes-servicio/${id}/pagos`, data)).data;
export const voidWorkOrderPayment = async (
  id: number,
  paymentId: number,
  motivo: string,
) =>
  (
    await api.post(`/ordenes-servicio/${id}/pagos/${paymentId}/anular`, {
      motivo,
    })
  ).data;
export const listWorkOrderParts = async (
  id: number,
): Promise<WorkOrderPart[]> =>
  (await api.get(`/ordenes-servicio/${id}/repuestos`)).data;
export const addWorkOrderPart = async (
  id: number,
  data: {
    id_producto?: number;
    descripcion?: string;
    sku?: string;
    cantidad: number;
    costo_unitario?: number;
    precio_unitario?: number;
    ubicacion_id?: number;
    lote?: string;
    numero_serie?: string;
  },
) => (await api.post(`/ordenes-servicio/${id}/repuestos`, data)).data;
export const removeWorkOrderPart = async (
  id: number,
  partId: number,
  motivo: string,
) =>
  (
    await api.post(`/ordenes-servicio/${id}/repuestos/${partId}/retirar`, {
      motivo,
    })
  ).data;
export const listWorkOrderEvidence = async (
  id: number,
): Promise<WorkOrderEvidence[]> =>
  (await api.get(`/ordenes-servicio/${id}/evidencias`)).data;
export const addWorkOrderEvidence = async (
  id: number,
  data: {
    archivo: File;
    etapa: WorkOrderEvidence["etapa"];
    descripcion?: string;
    firmante_nombre?: string;
    firmante_dni?: string;
  },
) => {
  const form = new FormData();
  form.append("evidencia_servicio", data.archivo);
  form.append("etapa", data.etapa);
  if (data.descripcion) form.append("descripcion", data.descripcion);
  if (data.firmante_nombre) form.append("firmante_nombre", data.firmante_nombre);
  if (data.firmante_dni) form.append("firmante_dni", data.firmante_dni);
  return (await api.post(`/ordenes-servicio/${id}/evidencias`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
};
export const openWorkOrderEvidence = async (evidence: WorkOrderEvidence) => {
  const response = await api.get(evidence.archivo_url, {
    responseType: "blob",
  });
  const url = URL.createObjectURL(response.data);
  window.open(url, "_blank", "noopener,noreferrer");
  window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
};
export const removeWorkOrderEvidence = async (
  id: number,
  evidenceId: number,
  motivo: string,
) =>
  (
    await api.post(`/ordenes-servicio/${id}/evidencias/${evidenceId}/retirar`, {
      motivo,
    })
  ).data;
export const setWorkOrderEvidenceVisibility = async (
  id: number,
  evidenceId: number,
  visible_cliente: boolean,
) => (await api.put(`/ordenes-servicio/${id}/evidencias/${evidenceId}/visibilidad`, { visible_cliente })).data;
export const listWorkOrderQuotes = async (
  id: number,
): Promise<WorkOrderQuote[]> =>
  (await api.get(`/ordenes-servicio/${id}/cotizaciones`)).data;
export const createWorkOrderQuote = async (
  id: number,
  data: { trabajo_propuesto?: string; condiciones?: string },
) => (await api.post(`/ordenes-servicio/${id}/cotizaciones`, data)).data;
export const resolveWorkOrderQuote = async (
  id: number,
  quoteId: number,
  data: {
    accion: "enviar" | "aprobar" | "rechazar";
    aprobador_nombre?: string;
    canal_respuesta?: WorkOrderQuote["canal_respuesta"];
    evidencia_consentimiento?: string;
  },
) =>
  (
    await api.post(
      `/ordenes-servicio/${id}/cotizaciones/${quoteId}/resolver`,
      data,
    )
  ).data;

export type WorkOrderCredentialStatus = { configurada: boolean; expirada?: boolean; tipo?: string; expira_en?: string; consultado_en?: string | null };
export const getWorkOrderCredentialStatus = async (id: number): Promise<WorkOrderCredentialStatus> =>
  (await api.get(`/ordenes-servicio/${id}/credencial-temporal`)).data;
export const revealWorkOrderCredential = async (id: number): Promise<{ secreto: string; tipo: string; expira_en: string }> =>
  (await api.post(`/ordenes-servicio/${id}/credencial-temporal/revelar`)).data;
export const removeWorkOrderCredential = async (id: number) =>
  (await api.delete(`/ordenes-servicio/${id}/credencial-temporal`)).data;
export const annulWorkOrder = async (id: number, motivo: string) =>
  (await api.delete(`/ordenes-servicio/${id}`, { data: { motivo } })).data;
