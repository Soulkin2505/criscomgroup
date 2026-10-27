const express = require("express")
const router = express.Router()
const cierreCajaController = require("../controllers/cierre_caja.controller")
const authMiddleware = require("../middlewares/auth.middleware")
const { verificarHorarioLaboral, verificarRolesSinHorario } = require("../middlewares/restricciones.middleware")
const { registrarAuditoria, capturarEstadoOriginal } = require("../middlewares/audit.middleware")
const CierreCaja = require("../models/cierre_caja.model")

// Aplicar middleware de autenticación a todas las rutas
router.use(authMiddleware)
// Solo Gerentes (rol 1) y Administradores (rol 2) pueden acceder a caja diaria
router.use(verificarRolesSinHorario([1, 2, 3]))

// Rutas de cierre de caja
router.post("/", verificarHorarioLaboral, registrarAuditoria("crear", "cierres_caja"), cierreCajaController.create)
router.get("/", cierreCajaController.getAll)
router.get("/resumen-diario", async (req, res) => {
  try {
    const { dailyResult } = require('../services/daily-result.service');
    const { limaDay } = require('../services/cash-ledger.service');
    res.json(await dailyResult(req.user, String(req.query.fecha || limaDay(new Date()))));
  } catch (error) { res.status(400).json({ message: error.message }); }
})
router.get("/rango-fechas", cierreCajaController.getByDateRange)
router.get("/cajero/:cajero_id", cierreCajaController.getByCajero)
router.get("/:id", cierreCajaController.getById)
router.put(
  "/:id",
  verificarHorarioLaboral,
  capturarEstadoOriginal(CierreCaja),
  registrarAuditoria("actualizar", "cierres_caja"),
  cierreCajaController.update,
)
router.delete(
  "/:id",
  verificarHorarioLaboral,
  capturarEstadoOriginal(CierreCaja),
  registrarAuditoria("eliminar", "cierres_caja"),
  cierreCajaController.delete,
)

module.exports = router
