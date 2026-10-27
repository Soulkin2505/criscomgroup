const router = require('express').Router();
const controller = require('../controllers/pedido.controller');
const auth = require('../middlewares/auth.middleware');
const { verificarRolesSinHorario } = require('../middlewares/restricciones.middleware');
const { registrarAuditoria, capturarEstadoOriginal } = require('../middlewares/audit.middleware');
const { webhookLimiter } = require('../middlewares/security.middleware');
const Pedido = require('../models/pedido.model');

router.post('/', controller.create);
router.post('/:id/pagar-culqi', controller.payWithCulqi);
router.post('/:id/reintentar-pago', controller.reissuePaymentToken);
router.post('/webhooks/culqi', webhookLimiter, controller.webhook);
router.get('/seguimiento/:numero', controller.track);
router.get('/mis-pedidos', controller.mine);
router.get('/admin/listado', auth, verificarRolesSinHorario([1, 2, 3, 5]), controller.adminList);
router.get('/admin/pagos', auth, verificarRolesSinHorario([1, 2, 3, 5]), controller.adminPayments);
router.get('/admin/deliveries', auth, verificarRolesSinHorario([1, 2, 3, 5]), controller.adminDeliveries);
router.patch('/admin/:id/estado', auth, verificarRolesSinHorario([1, 2, 5]), capturarEstadoOriginal(Pedido), registrarAuditoria('actualizar_estado', 'pedidos'), controller.updateStatus);
router.delete('/admin/:id', auth, verificarRolesSinHorario([1, 2]), capturarEstadoOriginal(Pedido), registrarAuditoria('eliminar', 'pedidos'), controller.adminDelete);
router.post('/:id/confirmar-pago-manual', auth, verificarRolesSinHorario([1, 3, 5]), capturarEstadoOriginal(Pedido), registrarAuditoria('confirmar_pago_manual', 'pedidos'), controller.confirmManualPayment);
router.get('/:id', controller.getById);

module.exports = router;
