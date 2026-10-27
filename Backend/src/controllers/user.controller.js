const User = require('../models/user.model');
const { Op } = require('sequelize');
const { Venta, Producto, AffiliateBusiness, sequelize } = require('../models');
const bcrypt = require('bcryptjs');
const { isMasterEmail, isProtectedAccount, isFuture } = require('../middlewares/master.middleware');
const saltRounds = 10;

// ---------------------------------------------------------------------------
// Utilidades compartidas (validacion, respuestas, usuario publico)
// ---------------------------------------------------------------------------
const PERSONAL_ROLES = [1, 2, 3, 5, 6];
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]+\.[^\s@]{2,}$/;
const HIDDEN_FIELDS = ['password', 'token_version', 'password_changed_at'];

// Respuesta de error uniforme: {message, error (alias legacy), errores?: {campo: msg}}.
const fail = (res, status, message, extra = {}) => res.status(status).json({ message, error: message, ...extra });
const invalid = (res, errores) => fail(res, 422, Object.values(errores)[0] || 'Datos inválidos', { errores });

const toPublic = (user) => {
  const json = typeof user.toJSON === 'function' ? user.toJSON() : { ...user };
  HIDDEN_FIELDS.forEach((field) => delete json[field]);
  const elevatedNow = Boolean(json.id_role === 2 && json.superusuario_temporal && isFuture(json.superusuario_expira_en));
  isoFields(json, ['acceso_expira_en', 'superusuario_expira_en', 'created_at', 'updated_at', 'createdAt', 'updatedAt']);
  json.es_maestra = Number(json.id_role) === 1 && isMasterEmail(json.email);
  json.superusuario_vigente = elevatedNow;
  return json;
};

const validateName = (value) => {
  const name = String(value || '').trim();
  if (name.length < 3) return 'El nombre debe tener al menos 3 caracteres';
  if (name.length > 120) return 'El nombre no puede superar 120 caracteres';
  return null;
};
const validateEmail = (value) => {
  const email = String(value || '').trim();
  if (!EMAIL_RE.test(email) || email.length > 180) return 'Ingresa un correo válido';
  return null;
};
// Politica unica para cuentas de personal: 8-72 caracteres con mayuscula, numero y simbolo
// (igual que el formulario). La cuenta maestra exige 12 (ver updateMasterAccount).
const validatePassword = (value, min = 8) => {
  const password = typeof value === 'string' ? value : '';
  if (password.length < min) return `La contraseña debe tener al menos ${min} caracteres`;
  if (Buffer.byteLength(password) > 72) return 'La contraseña no puede superar 72 caracteres';
  if (!/[A-Z]/.test(password) || !/\d/.test(password) || !/[^A-Za-z0-9]/.test(password)) {
    return 'La contraseña debe incluir mayúscula, número y símbolo';
  }
  return null;
};

// Fechas sin zona ("2026-10-12T10:00") se interpretan en hora de Lima (-05:00), no en la del servidor.
const parseLimaDate = (value) => {
  const text = String(value || '').trim();
  if (!text) return null;
  const hasZone = /(Z|[+-]\d{2}:?\d{2})$/i.test(text);
  const date = new Date(hasZone || !/T/.test(text) ? text : `${text}${text.length === 16 ? ':00' : ''}-05:00`);
  return Number.isNaN(date.getTime()) ? null : date;
};

// Fechas de respuesta: ISO con offset -05:00. Con MySQL las fechas leídas llegan como hora de pared de Lima
// (typeCast a texto, "AAAA-MM-DD HH:mm:ss"); se leen como UTC explícito para no depender de la zona del
// proceso. En SQLite ya son UTC reales (ver blog.controller.js). Un Date de JS (p. ej. recién creado y aún
// no releído de MySQL) siempre es un instante real: se pasa a Lima.
const limaWallClock = sequelize.getDialect() !== 'sqlite';
const WALL_TEXT = /^\d{4}-\d{2}-\d{2}[ T]\d{2}:\d{2}(:\d{2}(\.\d+)?)?$/;
const iso = (value) => {
  if (!value) return null;
  const date = limaWallClock && typeof value === 'string' && WALL_TEXT.test(value)
    ? new Date(`${value.replace(' ', 'T')}Z`)
    : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  const wallText = limaWallClock && !(value instanceof Date);
  const shifted = wallText ? date : new Date(date.getTime() - 5 * 3600 * 1000);
  return shifted.toISOString().replace('Z', '-05:00');
};
const isoFields = (row, keys) => {
  for (const key of keys) if (key in row) row[key] = iso(row[key]);
  return row;
};

const likeEscape = (text) => String(text).replace(/[\\%_]/g, (char) => `\\${char}`);

// Cada fila de un listado indica lo que la UI necesita para pintar estados sin datos sensibles.
const withStatus = (user) => {
  const json = toPublic(user);
  json.acceso_vencido = Boolean(json.id_role === 5 && !isFuture(json.acceso_expira_en));
  return json;
};

const bumpSession = (user) => ({ token_version: Number(user.token_version || 0) + 1 });

// ---------------------------------------------------------------------------
// Reglas de actor: la maestra real puede todo salvo tocar cuentas protegidas;
// el rol 2 elevado nunca toca roles 1-2 ni a si mismo.
// ---------------------------------------------------------------------------
const actorGuard = (req, target, { allowSelf = false } = {}) => {
  const self = Number(target.id_user) === Number(req.user.id_user);
  if (self && !allowSelf) return { status: 403, message: 'No puedes aplicar este cambio sobre tu propia cuenta' };
  if (isProtectedAccount(target) && !(self && allowSelf)) return { status: 403, message: 'La cuenta maestra está protegida' };
  if (!req.isExactMaster && Number(target.id_role) === 2) {
    return { status: 403, message: 'Un superusuario temporal no puede modificar cuentas de Administrador' };
  }
  return null;
};


// ---------------------------------------------------------------------------
// Cuenta maestra (solo la maestra real; ver users.routes.js)
// ---------------------------------------------------------------------------
const getMasterAccount = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id, { attributes: ['id_user', 'name', 'email', 'id_role'] });
    if (!user) return fail(res, 404, 'Cuenta no encontrada');
    return res.json({ ...user.toJSON(), es_maestra: true });
  } catch (error) {
    console.error('Error al leer la cuenta maestra:', error);
    return fail(res, 500, 'No se pudo cargar la cuenta maestra');
  }
};

const updateMasterAccount = async (req, res) => {
  try {
    const user = await User.findByPk(req.user.id);
    if (!user || user.id_role !== 1) return fail(res, 403, 'Cuenta maestra no válida');
    const currentPassword = String(req.body.current_password || '');
    if (!currentPassword || !(await bcrypt.compare(currentPassword, user.password))) {
      return fail(res, 422, 'La contraseña actual no es correcta', { errores: { current_password: 'La contraseña actual no es correcta' } });
    }
    const name = String(req.body.name || '').trim();
    const newPassword = String(req.body.new_password || '');
    const errores = {};
    const nameError = validateName(name);
    if (nameError) errores.name = nameError;
    if (newPassword) {
      const passwordError = validatePassword(newPassword, 12);
      if (passwordError) errores.new_password = passwordError;
      else if (newPassword === currentPassword) errores.new_password = 'La nueva contraseña debe ser distinta de la actual';
    }
    if (Object.keys(errores).length) return invalid(res, errores);
    const updates = { name };
    if (newPassword) {
      updates.password = await bcrypt.hash(newPassword, saltRounds);
      updates.password_changed_at = new Date();
      Object.assign(updates, bumpSession(user)); // invalida los JWT anteriores
    }
    await user.update(updates);
    res.locals.auditoria = { registro_id: user.id_user, despues: { clave_cambiada: Boolean(newPassword) } };
    return res.json({ id_user: user.id_user, name: user.name, email: user.email, id_role: user.id_role, es_maestra: true, sesiones_cerradas: Boolean(newPassword) });
  } catch (error) {
    console.error('Error al actualizar la cuenta maestra:', error);
    return fail(res, 500, 'No se pudo actualizar la cuenta maestra');
  }
};

/**
 * Verifica que el usuario tenga alguno de los roles permitidos (el rol 2 elevado cuenta como rol 1).
 */
const checkRole = (allowedRoles, req, res) => {
  const elevated = req.user?.superusuario_temporal && allowedRoles.includes(1);
  if (!req.user || (!allowedRoles.includes(req.user.id_role) && !elevated)) {
    res.status(403).json({ message: 'Acceso denegado' });
    return false;
  }
  return true;
};

/**
 * GET /users?search=&rol=&estado=&grupo=&page=&limit=
 * Paginado en servidor. Sin contrasenas ni versiones de sesion.
 * grupo: personal (roles ERP) | clientes (rol 4, ecommerce) | todos (por defecto).
 * estado: activo | inactivo | vigente | vencido (rol 5) | elevado (rol 2 con superusuario vigente).
 */
const getAllUsers = async (req, res) => {
  try {
    const page = Math.max(1, Number.parseInt(req.query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, Number.parseInt(req.query.limit, 10) || 25));
    const where = [];
    const search = String(req.query.search || '').trim().slice(0, 100);
    if (search) {
      const pattern = `%${likeEscape(search)}%`;
      where.push({ [Op.or]: [{ name: { [Op.like]: pattern } }, { email: { [Op.like]: pattern } }] });
    }
    const grupo = String(req.query.grupo || 'todos');
    if (grupo === 'personal') where.push({ id_role: { [Op.in]: PERSONAL_ROLES } });
    else if (grupo === 'clientes') where.push({ id_role: 4 });
    const roles = String(req.query.rol || '').split(',').map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= 6);
    if (roles.length) where.push({ id_role: { [Op.in]: roles } });
    const now = new Date();
    const estado = String(req.query.estado || '');
    if (estado === 'activo') where.push({ activo: true });
    else if (estado === 'inactivo') where.push({ activo: false });
    else if (estado === 'vigente') where.push({ id_role: 5, acceso_expira_en: { [Op.gt]: now } });
    else if (estado === 'vencido') where.push({ id_role: 5, [Op.or]: [{ acceso_expira_en: null }, { acceso_expira_en: { [Op.lte]: now } }] });
    else if (estado === 'elevado') where.push({ id_role: 2, superusuario_temporal: true, superusuario_expira_en: { [Op.gt]: now } });
    const filter = where.length ? { [Op.and]: where } : {};
    const { rows, count } = await User.findAndCountAll({
      where: filter,
      attributes: { exclude: HIDDEN_FIELDS },
      order: [['name', 'ASC'], ['id_user', 'ASC']],
      limit,
      offset: (page - 1) * limit,
    });
    const [personal, clientes] = await Promise.all([
      User.count({ where: { id_role: { [Op.in]: PERSONAL_ROLES } } }),
      User.count({ where: { id_role: 4 } }),
    ]);
    return res.status(200).json({ data: rows.map(withStatus), total: count, page, limit, pages: Math.max(1, Math.ceil(count / limit)), conteos: { personal, clientes } });
  } catch (error) {
    console.error('Error al obtener usuarios:', error);
    return fail(res, 500, 'Error al obtener usuarios');
  }
};

const getVendorsWithStats = async (req, res) => {
  if (!checkRole([1], req, res)) return;
  try {
    const vendors = await User.findAll({
      where: { id_role: [3, 5] },
      attributes: ['id_user', 'name', 'email', 'id_role', 'tipo_vendedor', 'comision_servicio_porcentaje', 'acceso_expira_en', 'acceso_otorgado_por', 'affiliate_business_id', 'activo'],
      order: [['name', 'ASC']],
    });
    const ids = vendors.map((vendor) => vendor.id_user);
    const totals = ids.length ? await Venta.unscoped().findAll({
      attributes: [
        'id_cajero',
        [sequelize.fn('COUNT', sequelize.col('venta_id')), 'sales_count'],
        [sequelize.fn('SUM', sequelize.col('total_con_igv')), 'sales_total'],
        [sequelize.fn('MAX', sequelize.col('fecha')), 'last_sale_at'],
        [sequelize.fn('SUM', sequelize.col('comision_servicio')), 'service_fee'],
        [sequelize.fn('SUM', sequelize.col('neto_vendedor')), 'vendor_net'],
      ],
      where: { id_cajero: ids },
      group: ['id_cajero'],
      raw: true,
    }) : [];
    const byVendor = new Map(totals.map((row) => [Number(row.id_cajero), row]));
    const inventory = ids.length ? await Producto.findAll({ attributes: ['propietario_id', [sequelize.fn('COUNT', sequelize.col('id_producto')), 'products_count'], [sequelize.fn('SUM', sequelize.col('stock')), 'stock_total']], where: { propietario_id: ids }, group: ['propietario_id'], raw: true }) : [];
    const byInventory = new Map(inventory.map((row) => [Number(row.propietario_id), row]));
    return res.json(vendors.map((vendor) => {
      const stats = byVendor.get(vendor.id_user) || {};
      const stock = byInventory.get(vendor.id_user) || {};
      return { ...vendor.toJSON(), stats: {
        sales_count: Number(stats.sales_count || 0),
        sales_total: Number(stats.sales_total || 0),
        last_sale_at: stats.last_sale_at || null,
        service_fee: Number(stats.service_fee || 0),
        vendor_net: Number(stats.vendor_net || 0),
        products_count: Number(stock.products_count || 0),
        stock_total: Number(stock.stock_total || 0),
      } };
    }));
  } catch (error) {
    console.error('Error al obtener vendedores:', error);
    return fail(res, 500, 'Error al obtener vendedores');
  }
};

// ---------------------------------------------------------------------------
// Perfil de acceso (vendedor / auditor temporal / tecnico): una sola logica para
// "crear cuenta" y "cambiar acceso".
// ---------------------------------------------------------------------------
const parseAccessProfile = async (body, role, { requireTipo = true, excludeUserId = null } = {}) => {
  const errores = {};
  const values = { tipo_vendedor: null, comision: 0, expires: null, telefono: null, nombre_comercial: null };
  if (role === 3) {
    const tipo = String(body.tipo_vendedor || '');
    if (tipo || requireTipo) {
      if (!['fisico', 'virtual', 'afiliado'].includes(tipo)) errores.tipo_vendedor = 'Tipo de vendedor inválido';
      else values.tipo_vendedor = tipo;
    }
    if (values.tipo_vendedor === 'afiliado') {
      const fee = Number(body.comision_servicio_porcentaje ?? 8);
      if (!Number.isFinite(fee) || fee < 0 || fee > 100) errores.comision_servicio_porcentaje = 'Comisión inválida (0 a 100)';
      else values.comision = fee;
      const commercial = String(body.nombre_comercial || '').trim();
      if (commercial.length > 120) errores.nombre_comercial = 'El nombre comercial no puede superar 120 caracteres';
      values.nombre_comercial = commercial || null;
    }
  }
  if (role === 5) {
    const expires = parseLimaDate(body.acceso_expira_en);
    if (!expires || expires <= new Date()) errores.acceso_expira_en = 'La caducidad debe ser una fecha futura';
    else values.expires = expires;
  }
  if (role === 6) {
    // El tecnico requiere un celular de Peru (9 digitos) para vincular WhatsApp con sus ordenes.
    const telefono = String(body.telefono || '').replace(/\D/g, '');
    if (!/^9\d{8}$/.test(telefono)) errores.telefono = 'Ingresa un celular válido de 9 dígitos para el técnico';
    else {
      const where = { telefono, id_role: 6 };
      if (excludeUserId) where.id_user = { [Op.ne]: excludeUserId };
      if (await User.findOne({ where })) return { conflict: 'Ese teléfono ya está asignado a otro técnico' };
      values.telefono = telefono;
    }
  }
  return Object.keys(errores).length ? { errores } : { values };
};

// Aplica el perfil sobre el usuario (dentro de una transaccion) y limpia lo que quedaba del rol anterior.
const applyAccessProfile = async (user, role, values, actorId, transaction) => {
  const wasAffiliate = user.tipo_vendedor === 'afiliado' && user.affiliate_business_id;
  let businessId = null;
  if (values.tipo_vendedor === 'afiliado') {
    const trialStart = new Date();
    const trialEnd = new Date(trialStart);
    trialEnd.setMonth(trialEnd.getMonth() + 2);
    const commercial = values.nombre_comercial || user.name;
    const [business] = await AffiliateBusiness.findOrCreate({
      where: { owner_user_id: user.id_user },
      defaults: { owner_user_id: user.id_user, nombre_comercial: commercial, comision_porcentaje: values.comision, prueba_inicia_en: trialStart, prueba_finaliza_en: trialEnd },
      transaction,
    });
    await business.update({ nombre_comercial: values.nombre_comercial || business.nombre_comercial, comision_porcentaje: values.comision }, { transaction });
    businessId = business.id_affiliate_business;
  } else if (wasAffiliate) {
    // Deja de ser afiliado: se suspende su negocio (reversible) en vez de dejarlo operando sin responsable.
    await AffiliateBusiness.update({ estado: 'suspendido' }, { where: { id_affiliate_business: user.affiliate_business_id }, transaction });
  }
  await user.update({
    id_role: role,
    tipo_vendedor: values.tipo_vendedor,
    comision_servicio_porcentaje: values.comision,
    acceso_expira_en: values.expires,
    acceso_otorgado_por: role === 5 ? actorId : null,
    affiliate_business_id: businessId,
    telefono: role === 6 ? values.telefono : user.telefono,
    superusuario_temporal: false,
    superusuario_expira_en: null,
    ...bumpSession(user),
  }, { transaction });
};

const ROLE_ERROR = 'Rol no permitido';

/**
 * Alta de personal. La usan POST /users y POST /auth/register: las mismas restricciones en ambas.
 * - Rol 1 nunca se crea desde la API.
 * - Rol 2 solo lo crea un gerente (rol 1); el rol 2 elevado no.
 * - Roles 3, 5 y 6 aceptan el perfil de acceso en la misma peticion (transaccional).
 */
const createStaffUser = async (req, input = {}) => {
  const name = String(input.name || '').trim();
  const email = String(input.email || '').trim().toLowerCase();
  const rawRole = input.id_role === undefined || input.id_role === null || input.id_role === '' ? 3 : Number(input.id_role);
  const errores = {};
  const nameError = validateName(name);
  if (nameError) errores.name = nameError;
  const emailError = validateEmail(email);
  if (emailError) errores.email = emailError;
  const passwordError = validatePassword(input.password);
  if (passwordError) errores.password = passwordError;
  if (![2, 3, 4, 5, 6].includes(rawRole)) errores.id_role = ROLE_ERROR;
  if (Object.keys(errores).length) return { status: 422, body: { message: Object.values(errores)[0], error: Object.values(errores)[0], errores } };
  if (rawRole === 2 && Number(req.user.id_role) !== 1) {
    return { status: 403, body: { message: 'Solo un gerente puede crear cuentas de Administrador', error: 'Solo un gerente puede crear cuentas de Administrador' } };
  }
  const parsed = await parseAccessProfile(input, rawRole, { requireTipo: false });
  if (parsed.conflict) return { status: 409, body: { message: parsed.conflict, error: parsed.conflict } };
  if (parsed.errores) return { status: 422, body: { message: Object.values(parsed.errores)[0], error: Object.values(parsed.errores)[0], errores: parsed.errores } };
  if (await User.findOne({ where: { email } })) {
    return { status: 409, body: { message: 'Ya existe una cuenta con ese correo', error: 'Ya existe una cuenta con ese correo', errores: { email: 'Ya existe una cuenta con ese correo' } } };
  }
  const hashedPassword = await bcrypt.hash(input.password, saltRounds);
  const needsProfile = rawRole === 5 || rawRole === 6 || (rawRole === 3 && parsed.values.tipo_vendedor);
  const created = needsProfile
    ? await sequelize.transaction(async (transaction) => {
      const user = await User.create({ name, email, password: hashedPassword, id_role: rawRole }, { transaction });
      await applyAccessProfile(user, rawRole, parsed.values, req.user.id_user, transaction);
      return user;
    })
    : await User.create({ name, email, password: hashedPassword, id_role: rawRole });
  await created.reload();
  return { status: 201, user: created, body: toPublic(created) };
};

const createUser = async (req, res) => {
  try {
    const result = await createStaffUser(req, req.body || {});
    return res.status(result.status).json(result.body);
  } catch (error) {
    console.error('Error al crear usuario:', error);
    return fail(res, 500, 'Error al crear usuario');
  }
};

// Cambio de rol "simple" (Administrador <-> Cliente). Limpia los residuos de privilegio del rol anterior.
const performRoleChange = async (req, target, role) => {
  if (![2, 4].includes(role)) {
    return { status: 422, message: 'Aquí solo se asigna Administrador o Cliente. Vendedor, Auditor y Técnico se configuran en el perfil de acceso' };
  }
  const denied = actorGuard(req, target);
  if (denied) return denied;
  if (role === 2 && Number(req.user.id_role) !== 1) return { status: 403, message: 'Solo un gerente puede asignar el rol de Administrador' };
  if (Number(target.id_role) === role) return null;
  await sequelize.transaction(async (transaction) => {
    if (target.tipo_vendedor === 'afiliado' && target.affiliate_business_id) {
      await AffiliateBusiness.update({ estado: 'suspendido' }, { where: { id_affiliate_business: target.affiliate_business_id }, transaction });
    }
    await target.update({
      id_role: role,
      tipo_vendedor: null,
      comision_servicio_porcentaje: 0,
      acceso_expira_en: null,
      acceso_otorgado_por: null,
      affiliate_business_id: null,
      superusuario_temporal: false,
      superusuario_expira_en: null,
      ...bumpSession(target),
    }, { transaction });
  });
  return null;
};

const changeUserRole = async (req, res) => {
  try {
    const user = await User.findByPk(Number(req.params.id));
    if (!user) return fail(res, 404, 'Usuario no encontrado');
    const problem = await performRoleChange(req, user, Number(req.body.id_role));
    if (problem) return fail(res, problem.status, problem.message);
    await user.reload();
    return res.status(200).json(toPublic(user));
  } catch (error) {
    console.error('Error al cambiar el rol del usuario:', error);
    return fail(res, 500, 'Error al cambiar el rol del usuario');
  }
};

const configureAccess = async (req, res) => {
  try {
    const user = await User.findByPk(Number(req.params.id));
    if (!user) return fail(res, 404, 'Cuenta no encontrada');
    const denied = actorGuard(req, user);
    if (denied) return fail(res, denied.status, denied.message);
    const role = Number(req.body.id_role);
    if (![3, 5, 6].includes(role)) return fail(res, 422, 'Selecciona Vendedor, Auditor temporal o Técnico');
    const parsed = await parseAccessProfile(req.body, role, { requireTipo: true, excludeUserId: user.id_user });
    if (parsed.conflict) return fail(res, 409, parsed.conflict);
    if (parsed.errores) return invalid(res, parsed.errores);
    await sequelize.transaction((transaction) => applyAccessProfile(user, role, parsed.values, req.user.id_user, transaction));
    await user.reload();
    return res.json(toPublic(user));
  } catch (error) {
    console.error('Error al configurar acceso:', error);
    return fail(res, 500, 'No se pudo configurar el acceso');
  }
};

// Solo la maestra real (ruta con exactMaster): un rol 2 elevado no puede concederse ni prorrogarse la elevacion.
const configureTemporarySuperuser = async (req, res) => {
  try {
    if (!req.isExactMaster) return fail(res, 403, 'Solo la cuenta maestra puede conceder o cambiar esta elevación');
    const user = await User.findByPk(Number(req.params.id));
    if (!user || user.id_role !== 2) return fail(res, 404, 'Selecciona una cuenta Administrador');
    if (user.activo === false) return fail(res, 409, 'La cuenta está desactivada');
    const enabled = req.body.enabled === true || req.body.enabled === 'true';
    let expires = null;
    if (enabled) {
      expires = parseLimaDate(req.body.expires_at);
      if (!expires || expires <= new Date()) return invalid(res, { expires_at: 'La caducidad debe ser una fecha futura' });
    }
    await user.update({ superusuario_temporal: enabled, superusuario_expira_en: expires, acceso_otorgado_por: enabled ? req.user.id_user : null });
    return res.json(toPublic(user));
  } catch (error) {
    console.error('Error al configurar superusuario temporal:', error);
    return fail(res, 500, 'No se pudo configurar el superusuario temporal');
  }
};

// Baja logica / reactivacion (solo la maestra real). Desactivar cierra las sesiones abiertas.
const setUserStatus = async (req, res) => {
  try {
    const user = await User.findByPk(Number(req.params.id));
    if (!user) return fail(res, 404, 'Usuario no encontrado');
    if (typeof req.body.activo !== 'boolean') return invalid(res, { activo: 'Indica activo: true o false' });
    const denied = actorGuard(req, user);
    if (denied) return fail(res, denied.status, denied.message);
    const updates = { activo: req.body.activo };
    if (!req.body.activo) Object.assign(updates, bumpSession(user), { superusuario_temporal: false, superusuario_expira_en: null });
    await user.update(updates);
    return res.json(toPublic(user));
  } catch (error) {
    console.error('Error al cambiar el estado del usuario:', error);
    return fail(res, 500, 'No se pudo cambiar el estado de la cuenta');
  }
};

const assignInventory = async (req, res) => {
  try {
    const user = await User.findByPk(Number(req.params.id));
    if (!user || user.id_role !== 3) return fail(res, 404, 'Vendedor no encontrado');
    const productIds = Array.isArray(req.body.product_ids) ? [...new Set(req.body.product_ids.map(Number).filter((n) => Number.isInteger(n) && n > 0))] : [];
    if (productIds.length) {
      const found = await Producto.unscoped().findAll({ attributes: ['id_producto', 'propietario_id'], where: { id_producto: productIds }, raw: true });
      const missing = productIds.filter((id) => !found.some((row) => row.id_producto === id));
      if (missing.length) return fail(res, 404, 'Algunos productos no existen', { missing });
      const taken = found.filter((row) => row.propietario_id && Number(row.propietario_id) !== user.id_user).map((row) => row.id_producto);
      if (taken.length) return fail(res, 409, 'Algunos productos ya pertenecen a otro vendedor', { taken });
    }
    await sequelize.transaction(async (transaction) => {
      await Producto.update({ propietario_id: null }, { where: { propietario_id: user.id_user }, transaction });
      if (productIds.length) await Producto.update({ propietario_id: user.id_user }, { where: { id_producto: productIds }, transaction });
    });
    return res.json({ message: 'Mercadería asignada', product_ids: productIds });
  } catch (error) {
    console.error('Error al asignar mercadería:', error);
    return fail(res, 500, 'No se pudo asignar la mercadería');
  }
};

const getUserById = async (req, res) => {
  const { id } = req.params;
  // Gerente (1), administrador (2) o el propio usuario.
  if (!req.user || (![1, 2].includes(req.user.id_role) && parseInt(id, 10) !== req.user.id_user)) {
    return res.status(403).json({ message: 'Acceso denegado' });
  }
  try {
    const user = await User.findByPk(id);
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.status(200).json(toPublic(user));
  } catch (error) {
    console.error('Error al obtener usuario:', error);
    return fail(res, 500, 'Error al obtener usuario');
  }
};

/**
 * PUT /users/:id  (completo) y PATCH /users/:id (parcial).
 * Lista blanca: name, email, password. Nunca rol, elevacion, caducidades ni negocio.
 * (id_role se acepta solo por compatibilidad y pasa por las mismas reglas que /role.)
 */
const editUser = (partial) => async (req, res) => {
  try {
    const id = Number.parseInt(req.params.id, 10);
    const user = Number.isInteger(id) ? await User.findByPk(id) : null;
    if (!user) return fail(res, 404, 'Usuario no encontrado');
    const denied = actorGuard(req, user);
    if (denied) return fail(res, denied.status, denied.message);
    const body = req.body || {};
    const errores = {};
    const updates = {};
    if (!partial || body.name !== undefined) {
      const nameError = validateName(body.name);
      if (nameError) errores.name = nameError;
      else updates.name = String(body.name).trim();
    }
    if (!partial || body.email !== undefined) {
      const email = String(body.email || '').trim().toLowerCase();
      const emailError = validateEmail(email);
      if (emailError) errores.email = emailError;
      else if (email !== String(user.email).toLowerCase()) {
        if (await User.findOne({ where: { email, id_user: { [Op.ne]: user.id_user } } })) errores.email = 'Ya existe una cuenta con ese correo';
        else updates.email = email;
      }
    }
    if (body.password !== undefined && body.password !== '' && body.password !== null) {
      const passwordError = validatePassword(body.password);
      if (passwordError) errores.password = passwordError;
    }
    if (Object.keys(errores).length) return invalid(res, errores);
    if (body.password) {
      updates.password = await bcrypt.hash(body.password, saltRounds);
      updates.password_changed_at = new Date();
      Object.assign(updates, bumpSession(user));
    }
    const requestedRole = body.id_role === undefined || body.id_role === null || body.id_role === '' ? null : Number(body.id_role);
    if (requestedRole !== null && requestedRole !== Number(user.id_role)) {
      const problem = await performRoleChange(req, user, requestedRole);
      if (problem) return fail(res, problem.status, problem.message);
    }
    if (Object.keys(updates).length) await user.update(updates);
    else if (requestedRole === null || requestedRole === Number(user.id_role)) return fail(res, 422, 'No hay cambios válidos para guardar');
    await user.reload();
    return res.status(200).json(toPublic(user));
  } catch (error) {
    console.error('Error al actualizar usuario:', error);
    return fail(res, 500, 'Error al actualizar usuario');
  }
};
const updateUser = editUser(false);
const patchUser = editUser(true);

// Tablas/columnas que referencian a un usuario y que impiden borrarlo (se ofrece desactivarlo).
const DEPENDENCIES = [
  ['ventas', 'id_cajero', 'ventas'], ['cierres_caja', 'cajero_id', 'cierres de caja'],
  ['productos', 'propietario_id', 'productos asignados'], ['affiliate_businesses', 'owner_user_id', 'negocio afiliado'],
  ['libro_reclamaciones', 'respondido_por', 'reclamos respondidos'], ['companies', 'id_user', 'empresa emisora'],
  ['movimientos_inventario', 'usuario_id', 'movimientos de inventario'], ['compras', 'creado_por', 'compras'],
  ['cotizaciones_comerciales', 'creado_por', 'cotizaciones'], ['ordenes_servicio', 'creado_por', 'órdenes de servicio'],
  ['pedidos', 'id_usuario', 'pedidos'], ['postventa_historial', 'usuario_id', 'historial de postventa'],
  ['importaciones', 'creado_por', 'importaciones'], ['solicitudes_importacion', 'id_usuario', 'solicitudes de importación'],
  ['solicitudes_ensamble', 'id_usuario', 'solicitudes de ensamble'],
];

const countDependencies = async (userId) => {
  const found = {};
  const queries = DEPENDENCIES.map(([table, column, label]) => [`SELECT COUNT(*) AS n FROM \`${table}\` WHERE \`${column}\` = :id`, label])
    .concat([["SELECT COUNT(*) AS n FROM `audit_logs` WHERE `usuario_id` = :id AND `accion` <> 'login'", 'registros de auditoría']]);
  for (const [sql, label] of queries) {
    try {
      const [[row]] = await sequelize.query(sql, { replacements: { id: userId } });
      if (Number(row.n) > 0) found[label] = Number(row.n);
    } catch (error) {
      if (!/doesn't exist|no such table/i.test(String(error?.parent?.message || error.message))) throw error;
    }
  }
  return found;
};

/**
 * DELETE /users/:id (solo la maestra real). Borrado fisico unicamente si no hay movimientos;
 * si los hay responde 409 y propone desactivar (PATCH /users/:id/status).
 */
const deleteUser = async (req, res) => {
  try {
    if (!req.isExactMaster) return fail(res, 403, 'Solo la cuenta maestra puede eliminar usuarios');
    const user = await User.findByPk(Number.parseInt(req.params.id, 10));
    if (!user) return fail(res, 404, 'Usuario no encontrado');
    const denied = actorGuard(req, user);
    if (denied) return fail(res, denied.status, denied.message);
    if ([1, 2].includes(Number(user.id_role))) {
      const remaining = await User.count({ where: { id_role: { [Op.in]: [1, 2] }, activo: true, id_user: { [Op.ne]: user.id_user } } });
      if (remaining < 1) return fail(res, 409, 'No se puede eliminar al último administrador');
    }
    const dependencias = await countDependencies(user.id_user);
    if (Object.keys(dependencias).length) {
      return fail(res, 409, 'La cuenta tiene historial y no se puede eliminar. Desactívala para conservar ventas, caja y auditoría', {
        code: 'USER_HAS_HISTORY', dependencias, puede_desactivar: true,
      });
    }
    await user.destroy();
    return res.status(200).json({ message: 'Usuario eliminado' });
  } catch (error) {
    console.error('Error al eliminar usuario:', error);
    return fail(res, 500, 'Error al eliminar usuario');
  }
};

/**
 * GET /users/:id/basic — solo id y nombre.
 */
const getUserBasicInfo = async (req, res) => {
  const { id } = req.params;
  if (!req.user || ![1, 2, 3].includes(req.user.id_role)) {
    return res.status(403).json({ message: 'Acceso denegado' });
  }
  try {
    const user = await User.findByPk(id, { attributes: ['id_user', 'name'] });
    if (!user) return res.status(404).json({ message: 'Usuario no encontrado' });
    return res.status(200).json(user);
  } catch (error) {
    console.error('Error al obtener información básica del usuario:', error);
    return fail(res, 500, 'Error al obtener información básica del usuario');
  }
};

module.exports = {
  getAllUsers,
  getUserById,
  createUser,
  createStaffUser,
  updateUser,
  patchUser,
  deleteUser,
  getUserBasicInfo,
  getVendorsWithStats,
  changeUserRole,
  configureAccess,
  configureTemporarySuperuser,
  setUserStatus,
  assignInventory,
  getMasterAccount,
  updateMasterAccount,
  validatePassword,
  parseLimaDate,
  iso,
  isoFields,
  toPublic,
};
