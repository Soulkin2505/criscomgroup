const router = require("express").Router();
const auth = require("../middlewares/auth.middleware");
const masterOnly = require("../middlewares/master.middleware");
const areaAccess = require("../middlewares/area.middleware");
const controller = require("../controllers/ordenServicio.controller");
const diagnostic = require('../controllers/diagnosticoAsistido.controller');
const messages = require('../controllers/ordenServicioMensaje.controller');
const upload = require("../middlewares/upload.middleware");
const { registrarAuditoria: audit, capturarEstadoOriginal } = require("../middlewares/audit.middleware");
const OrdenServicio = require("../models/orden_servicio.model");

router.use(auth, (req, res, next) => {
  if (req.user.id_role === 1 || req.user.superusuario_temporal || req.user.id_role === 6) return next();
  return areaAccess('servicio_tecnico')(req, res, next);
});
router.get("/caja/resumen", controller.cashSummary);
router.get("/tecnicos", controller.technicians);
router.get("/", controller.list);
router.get("/:id/historial", controller.history);
router.get('/:id/credencial-temporal', controller.credentialStatus);
router.post('/:id/credencial-temporal', audit("definir_credencial", "ordenes_servicio"), controller.setCredential);
router.post('/:id/credencial-temporal/revelar', audit("revelar_credencial", "ordenes_servicio"), controller.revealCredential);
router.delete('/:id/credencial-temporal', audit("eliminar_credencial", "ordenes_servicio"), controller.removeCredential);
router.get('/:id/diagnosticos-asistidos', diagnostic.list);
router.post('/:id/diagnosticos-asistidos', audit("generar_diagnostico", "ordenes_servicio"), diagnostic.generate);
router.post('/:id/diagnosticos-asistidos/:diagnosticId/revisar', audit("revisar_diagnostico", "ordenes_servicio"), diagnostic.review);
router.get('/:id/mensajes', messages.list);
router.get('/:id/canal-whatsapp', messages.channelTimeline);
router.post('/:id/mensajes/preparar', audit("preparar_mensaje", "ordenes_servicio"), messages.prepare);
router.post('/:id/mensajes/:messageId/abierto', messages.markOpened);
router.get('/:id/facturacion', controller.billingSummary);
router.post('/:id/honorarios/referencia', audit('registrar_referencia_rhe', 'ordenes_servicio'), controller.registerHonorarios);
router.post('/:id/ticket/correo', controller.emailTicket);
router.get("/:id/pagos", controller.payments);
router.post("/:id/pagos", audit("agregar_pago", "ordenes_servicio"), controller.addPayment);
router.post("/:id/pagos/:paymentId/anular", audit("anular_pago", "ordenes_servicio"), controller.voidPayment);
router.get("/:id/repuestos", controller.parts);
router.post("/:id/repuestos", audit("agregar_repuesto", "ordenes_servicio"), controller.addPart);
router.post("/:id/repuestos/:partId/retirar", audit("retirar_repuesto", "ordenes_servicio"), controller.removePart);
router.get("/:id/evidencias", controller.evidence);
router.post(
  "/:id/evidencias",
  upload.single("evidencia_servicio"),
  audit("agregar_evidencia", "ordenes_servicio"),
  controller.addEvidence,
);
router.get("/:id/evidencias/:evidenceId/archivo", controller.evidenceFile);
router.put("/:id/evidencias/:evidenceId/visibilidad", audit("cambiar_visibilidad_evidencia", "ordenes_servicio"), controller.setEvidenceVisibility);
router.post("/:id/evidencias/:evidenceId/retirar", audit("retirar_evidencia", "ordenes_servicio"), controller.removeEvidence);
router.get("/:id/cotizaciones", controller.quotes);
router.post("/:id/cotizaciones", audit("crear_cotizacion", "ordenes_servicio"), controller.createQuote);
router.post("/:id/cotizaciones/:quoteId/resolver", audit("resolver_cotizacion", "ordenes_servicio"), controller.resolveQuote);
router.post("/:id/reingreso-garantia", audit("reingreso_garantia", "ordenes_servicio"), controller.createWarrantyReentry);
router.post("/", audit("crear", "ordenes_servicio"), controller.create);
router.put("/:id", capturarEstadoOriginal(OrdenServicio), audit("actualizar", "ordenes_servicio"), controller.update);
router.delete("/:id", capturarEstadoOriginal(OrdenServicio), audit("eliminar", "ordenes_servicio"), controller.remove);

module.exports = router;
