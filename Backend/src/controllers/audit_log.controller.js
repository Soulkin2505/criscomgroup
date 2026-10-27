const { Op, fn, col, literal, where: sqlWhere } = require("sequelize")
const { sequelize } = require("../config/database")
const { AuditLog, User } = require("../models")
const { registrarEvento, normalizeTabla, tablaVariants } = require("../middlewares/audit.middleware")

const MAX_LIMIT = 100
const DEFAULT_LIMIT = 25
const EXPORT_CAP = 50000
const RETENTION_MONTHS = Math.max(1, Number(process.env.AUDIT_RETENTION_MONTHS) || 24)
const CONFIRM_PURGE = "PURGAR AUDITORIA"
const CONFIRM_ALL = "ELIMINAR TODO EL HISTORIAL"

// Errores: siempre JSON {message}. 500 nunca sin cuerpo.
const safe = (label, handler) => async (req, res) => {
  try {
    await handler(req, res)
  } catch (error) {
    console.error(`Error en logs de auditoría (${label}):`, error)
    if (!res.headersSent) res.status(500).json({ message: `No se pudo completar: ${label}` })
    else res.end()
  }
}

// La BD guarda hora de pared de Lima (timezone -05:00, dateStrings). En MySQL el valor leido ya es
// la hora de Lima (se lee como UTC explicito para no depender de la zona del proceso); en SQLite (tests)
// esta en UTC y se corrige. Un Date de JS siempre es un instante real y tambien se pasa a Lima.
const lima = sequelize.getDialect() !== "sqlite"
const WALL_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/
const iso = (value) => {
  if (!value) return null
  const wallText = lima && typeof value === "string" && WALL_TEXT.test(value)
  const date = wallText ? new Date(`${value.replace(" ", "T")}Z`) : new Date(value)
  if (Number.isNaN(date.getTime())) return null
  const shifted = lima && !(value instanceof Date) ? date : new Date(date.getTime() - 5 * 3600 * 1000)
  return shifted.toISOString().replace("Z", "-05:00")
}

// --- permisos -------------------------------------------------------------
const isExactMaster = (req) => {
  const configured = String(process.env.MASTER_ADMIN_EMAIL || "").trim().toLowerCase()
  return Boolean(configured) && req.user?.id_role === 1 && String(req.user.email || "").trim().toLowerCase() === configured
}

// --- filtros --------------------------------------------------------------
const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
const parseDay = (value) => {
  const m = DATE_RE.exec(String(value || ""))
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) ? d : null
}
const fmtDay = (d) => d.toISOString().slice(0, 10)
const addDays = (d, n) => new Date(d.getTime() + n * 86400000)
// Comparacion textual contra la hora de pared de Lima, sin conversion de zona.
const limaCompare = (op, text, qualified = true) =>
  sqlWhere(col(qualified ? "AuditLog.fecha_hora" : "fecha_hora"), op, literal(sequelize.escape(text)))
const startOf = (day) => `${fmtDay(day)} 00:00:00`

const buildWhere = (query) => {
  const errores = {}
  const and = []
  const first = (v) => (Array.isArray(v) ? v[0] : v)
  const usuario = first(query.usuario_id ?? query.usuario)
  if (usuario !== undefined && usuario !== "") {
    if (/^\d+$/.test(String(usuario))) and.push({ usuario_id: Number(usuario) })
    else errores.usuario_id = "Usuario inválido"
  }
  const tabla = first(query.tabla ?? query.modulo)
  if (tabla) and.push({ tabla: { [Op.in]: tablaVariants(String(tabla)) } })
  const accion = first(query.accion)
  if (accion) and.push({ accion: String(accion).toLowerCase().slice(0, 50) })
  const registro = first(query.registro_id)
  if (registro !== undefined && registro !== "") {
    if (/^\d+$/.test(String(registro))) and.push({ registro_id: Number(registro) })
    else errores.registro_id = "Registro inválido"
  }
  const desde = first(query.desde ?? query.fechaInicio)
  const hasta = first(query.hasta ?? query.fechaFin)
  const d1 = desde ? parseDay(desde) : null
  const d2 = hasta ? parseDay(hasta) : null
  if (desde && !d1) errores.desde = "Fecha inválida (use AAAA-MM-DD)"
  if (hasta && !d2) errores.hasta = "Fecha inválida (use AAAA-MM-DD)"
  if (d1 && d2 && d1 > d2) errores.hasta = "La fecha final es anterior a la inicial"
  if (d1) and.push(limaCompare(Op.gte, startOf(d1)))
  if (d2) and.push(limaCompare(Op.lt, startOf(addDays(d2, 1))))
  const q = String(first(query.q) || "").trim().slice(0, 100)
  if (q) {
    const like = { [Op.like]: `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%` }
    const or = [
      { accion: like }, { tabla: like }, { ip_cliente: like }, { registro_ref: like },
      { usuario_nombre: like }, { usuario_email: like },
      { "$usuario.name$": like }, { "$usuario.email$": like },
    ]
    if (/^\d+$/.test(q) && Number(q) <= 2147483647) or.push({ registro_id: Number(q) }, { id_log: Number(q) })
    and.push({ [Op.or]: or })
  }
  return { where: and.length ? { [Op.and]: and } : {}, errores }
}

const pageParams = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1)
  const limit = Math.min(MAX_LIMIT, Math.max(1, parseInt(query.limit, 10) || DEFAULT_LIMIT))
  return { page, limit, offset: (page - 1) * limit }
}

const LIST_ATTRS = [
  "id_log", "usuario_id", "usuario_nombre", "usuario_email", "usuario_rol", "accion", "tabla", "registro_id",
  "registro_ref", "estado_http", "ip_cliente", "user_agent", "fecha_hora",
  [literal("(AuditLog.datos_anteriores IS NOT NULL OR AuditLog.datos_nuevos IS NOT NULL)"), "tiene_detalle"],
]
const userInclude = { model: User, as: "usuario", attributes: ["name", "email"], required: false }

const wireRow = (log) => {
  const row = typeof log.toJSON === "function" ? log.toJSON() : { ...log }
  const u = row.usuario
  row.usuario = u ? { name: u.name, email: u.email } : row.usuario_nombre || row.usuario_email ? { name: row.usuario_nombre, email: row.usuario_email } : null
  row.fecha_hora = iso(row.fecha_hora)
  if ("tiene_detalle" in row) row.tiene_detalle = Boolean(Number(row.tiene_detalle))
  return row
}

// --- listado paginado en servidor -----------------------------------------
const doList = async (query, res) => {
  const { where, errores } = buildWhere(query)
  if (Object.keys(errores).length) return res.status(400).json({ message: "Filtros inválidos", errores })
  const { page, limit, offset } = pageParams(query)
  const { rows, count } = await AuditLog.findAndCountAll({
    where,
    attributes: LIST_ATTRS,
    include: [userInclude],
    order: [["fecha_hora", "DESC"], ["id_log", "DESC"]],
    limit,
    offset,
    distinct: true,
  })
  res.json({ rows: rows.map(wireRow), total: count, page, limit })
}
exports.list = safe("listar logs", (req, res) => doList(req.query, res))

// Alias historicos: mismos filtros, misma respuesta paginada.
const alias = (param, target) => safe("listar logs", (req, res) => doList({ ...req.query, [target]: req.params[param] }, res))
exports.getByUser = alias("usuario_id", "usuario_id")
exports.getByTable = alias("tabla", "tabla")
exports.getByAction = alias("accion", "accion")
exports.getByDateRange = safe("listar logs", (req, res) => {
  if (!req.query.fechaInicio || !req.query.fechaFin) return res.status(400).json({ message: "Se requieren fechas de inicio y fin" })
  return doList(req.query, res)
})

// --- detalle con cambios calculados ----------------------------------------
const parseJson = (text) => {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (e) {
    return { _texto: String(text).slice(0, 2000) }
  }
}
const same = (a, b) => (a !== null && typeof a === "object") || (b !== null && typeof b === "object")
  ? JSON.stringify(a) === JSON.stringify(b)
  : String(a ?? "") === String(b ?? "")
const computeChanges = (antes, despues) => {
  const after = despues && typeof despues === "object" ? despues : {}
  const before = antes && typeof antes === "object" ? antes : null
  const out = []
  for (const key of Object.keys(after)) {
    if (key.startsWith("_") || key === "timestamp") continue
    const prev = before ? before[key] : null
    if (before && same(prev, after[key])) continue
    out.push({ campo: key, antes: prev ?? null, despues: after[key], sensible: after[key] === "[REDACTADO]" })
  }
  return out
}

exports.getOne = safe("detalle del log", async (req, res) => {
  if (!/^\d+$/.test(req.params.id)) return res.status(400).json({ message: "Identificador inválido" })
  const log = await AuditLog.findByPk(Number(req.params.id), { include: [userInclude] })
  if (!log) return res.status(404).json({ message: "Registro de auditoría no encontrado" })
  const row = wireRow(log)
  const antes = parseJson(log.datos_anteriores)
  const despues = parseJson(log.datos_nuevos)
  res.json({ ...row, datos_anteriores: antes, datos_nuevos: despues, cambios: computeChanges(antes, despues) })
})

// --- catalogo para los filtros ---------------------------------------------
exports.catalogo = safe("catálogo", async (req, res) => {
  const [tablas, acciones, usuarios] = await Promise.all([
    AuditLog.findAll({ attributes: [[fn("DISTINCT", col("tabla")), "tabla"]], raw: true }),
    AuditLog.findAll({ attributes: [[fn("DISTINCT", col("accion")), "accion"]], raw: true }),
    AuditLog.findAll({
      attributes: ["usuario_id", [fn("MAX", col("usuario_nombre")), "nombre"], [fn("MAX", col("usuario_email")), "email"]],
      where: { usuario_id: { [Op.ne]: null } },
      group: ["usuario_id"],
      raw: true,
    }),
  ])
  const names = await User.findAll({ attributes: ["id_user", "name", "email"], where: { id_user: { [Op.in]: usuarios.map((u) => u.usuario_id) } }, raw: true })
  const byId = new Map(names.map((u) => [u.id_user, u]))
  res.json({
    tablas: [...new Set(tablas.map((t) => normalizeTabla(t.tabla)))].sort(),
    acciones: acciones.map((a) => a.accion).sort(),
    usuarios: usuarios.map((u) => ({
      id: u.usuario_id,
      name: byId.get(u.usuario_id)?.name || u.nombre || `Usuario ${u.usuario_id}`,
      email: byId.get(u.usuario_id)?.email || u.email || null,
    })),
  })
})

exports.permisos = (req, res) => {
  res.json({
    puede_ver: true,
    puede_exportar: true,
    puede_purgar: isExactMaster(req),
    retencion_meses: RETENTION_MONTHS,
    confirmacion_purga: isExactMaster(req) ? { fecha: CONFIRM_PURGE, total: CONFIRM_ALL } : null,
  })
}

// --- estadisticas / retencion ------------------------------------------------
exports.getLogStats = safe("estadísticas", async (req, res) => {
  const total = await AuditLog.count()
  const monthExpr = sequelize.getDialect() === "sqlite" ? fn("strftime", "%Y-%m", col("fecha_hora")) : fn("DATE_FORMAT", col("fecha_hora"), "%Y-%m")
  const monthlyStats = await AuditLog.findAll({
    attributes: [[monthExpr, "month"], [fn("COUNT", "*"), "count"]],
    group: [monthExpr],
    order: [[monthExpr, "DESC"]],
    limit: 12,
    raw: true,
  })
  const oldest = await AuditLog.findOne({ order: [["fecha_hora", "ASC"]], attributes: ["fecha_hora"] })
  const nowLima = new Date(Date.now() - 5 * 3600000)
  const cut = new Date(Date.UTC(nowLima.getUTCFullYear(), nowLima.getUTCMonth() - RETENTION_MONTHS, nowLima.getUTCDate()))
  const fueraRetencion = await AuditLog.count({ where: limaCompare(Op.lt, startOf(cut), false) })
  res.json({
    totalLogs: total,
    monthlyStats,
    oldestLog: oldest ? iso(oldest.fecha_hora) : null,
    retencion_meses: RETENTION_MONTHS,
    fecha_corte: fmtDay(cut),
    logsFueraDeRetencion: fueraRetencion,
    oldLogsCount: fueraRetencion,
  })
})

// --- exportacion CSV (mismos filtros que el listado) ------------------------
// Evita inyeccion de formulas en Excel: celdas que empiezan con = + - @ se prefijan con '.
const csvCell = (v) => {
  let s = v === null || v === undefined ? "" : String(v)
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\n\r;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}
const CSV_HEAD = ["id_log", "fecha_hora", "usuario", "email", "rol", "accion", "modulo", "registro", "estado_http", "ip", "campos_cambiados"]

exports.exportCsv = safe("exportar CSV", async (req, res) => {
  const { where, errores } = buildWhere(req.query)
  if (Object.keys(errores).length) return res.status(400).json({ message: "Filtros inválidos", errores })
  const total = await AuditLog.count({ where, include: [userInclude], distinct: true })
  const exported = Math.min(total, EXPORT_CAP)
  const stamp = new Date(Date.now() - 5 * 3600000).toISOString().slice(0, 10)
  res.setHeader("Content-Type", "text/csv; charset=utf-8")
  res.setHeader("Content-Disposition", `attachment; filename="auditoria-${stamp}.csv"`)
  res.setHeader("X-Total-Count", String(total))
  res.setHeader("X-Truncated", total > EXPORT_CAP ? "true" : "false")
  res.write("\uFEFF" + CSV_HEAD.join(",") + "\n")
  let written = 0
  let lastId = null
  while (written < exported) {
    const batchWhere = lastId === null ? where : { [Op.and]: [where, { id_log: { [Op.lt]: lastId } }] }
    const batch = await AuditLog.findAll({
      where: batchWhere,
      include: [userInclude],
      order: [["id_log", "DESC"]],
      limit: Math.min(1000, exported - written),
    })
    if (!batch.length) break
    for (const log of batch) {
      const cambios = computeChanges(parseJson(log.datos_anteriores), parseJson(log.datos_nuevos))
      const nombre = log.usuario?.name || log.usuario_nombre || ""
      const email = log.usuario?.email || log.usuario_email || ""
      res.write([
        log.id_log, iso(log.fecha_hora), nombre, email, log.usuario_rol, log.accion, normalizeTabla(log.tabla),
        log.registro_id ?? log.registro_ref, log.estado_http, log.ip_cliente, cambios.map((c) => c.campo).join("|"),
      ].map(csvCell).join(",") + "\n")
    }
    written += batch.length
    lastId = batch[batch.length - 1].id_log
  }
  await registrarEvento({
    req, accion: "exportar", tabla: "auditoria", despues: { filtros: req.query, filas: written, total, truncado: total > EXPORT_CAP }, estado_http: 200,
  }).catch((e) => console.error("Error al auditar exportación:", e))
  res.end()
})

// --- purga (solo cuenta maestra real, rol 1; nunca superusuario temporal) ----
exports.purge = safe("purgar logs", async (req, res) => {
  if (!isExactMaster(req)) return res.status(403).json({ message: "Solo la cuenta maestra puede purgar la auditoría" })
  const { ids, deleteAll, beforeDate, confirmacion, dryRun } = req.body || {}
  const modes = [Array.isArray(ids) && ids.length > 0, deleteAll === true, Boolean(beforeDate)].filter(Boolean).length
  if (modes !== 1) {
    return res.status(400).json({ message: "Indique exactamente un criterio: ids, beforeDate o deleteAll" })
  }
  let where
  let criterio
  if (deleteAll === true) {
    where = {}
    criterio = { modo: "deleteAll" }
  } else if (beforeDate) {
    const day = parseDay(beforeDate)
    if (!day) return res.status(400).json({ message: "Fecha inválida", errores: { beforeDate: "Use AAAA-MM-DD" } })
    where = limaCompare(Op.lt, startOf(day), false)
    criterio = { modo: "beforeDate", anteriores_a: `${fmtDay(day)} 00:00:00-05:00` }
  } else {
    const clean = [...new Set(ids.map((n) => Number(n)))]
    if (clean.length > 500 || clean.some((n) => !Number.isInteger(n) || n <= 0)) {
      return res.status(400).json({ message: "ids debe contener hasta 500 enteros positivos" })
    }
    where = { id_log: { [Op.in]: clean } }
    criterio = { modo: "ids", ids: clean }
  }
  const count = await AuditLog.count({ where })
  if (dryRun === true) return res.json({ dryRun: true, count, criterio })
  const expected = deleteAll === true ? CONFIRM_ALL : CONFIRM_PURGE
  if (confirmacion !== expected) {
    return res.status(400).json({ message: `Confirmación requerida: envíe confirmacion = "${expected}"`, count, criterio })
  }
  if (count === 0) return res.status(404).json({ message: "No se encontraron logs para eliminar con los criterios especificados" })
  const entry = await sequelize.transaction(async (transaction) => {
    const deleted = await AuditLog.destroy({ where, transaction })
    return registrarEvento({
      req,
      accion: deleteAll === true ? "purgar_total" : "purgar",
      tabla: "auditoria",
      despues: { ...criterio, eliminados: deleted },
      estado_http: 200,
      transaction,
    }).then((log) => ({ log, deleted }))
  })
  res.json({
    message: `Se eliminaron ${entry.deleted} logs de auditoría`,
    deletedCount: entry.deleted,
    auditoria_id: entry.log.id_log,
  })
})
exports.deleteLogs = exports.purge
