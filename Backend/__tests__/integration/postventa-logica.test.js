'use strict';
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser, createEmpresa, createProducto } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente, admin } = require('../fixtures/users.fixture');
const { SolicitudPostventa, SolicitudPostventaHistorial, AuditLog, Pedido, PedidoDetalle } = require('../../src/models');

// Datos de prueba con marca seed-care
const caso = (over = {}) => ({
  nombre: 'Cliente seed-care', email: 'seed-care@test.local', telefono: '999 123 4567', numero_pedido: 'PED-SEED-1',
  tipo: 'garantia', producto_servicio: 'Laptop seed-care', motivo: 'No enciende el equipo',
  detalle: 'El equipo dejo de encender luego de una semana de uso normal.', solucion_solicitada: 'Reparacion o cambio',
  acepta_declaracion: true, ...over,
});
const CODIGO = /^POS-\d{8}-[A-HJ-NP-Z2-9]{10}$/;
const RESP = 'Revisamos tu caso y lo atenderemos en tienda.';

describe('Postventa - logica', () => {
  let tokens = {};
  let n = 0;
  const as = (role, req) => req.set('Authorization', `Bearer ${tokens[role]}`);
  const crear = (over = {}) => request(app).post('/api/ecommerce/postventa').send(caso({ numero_pedido: `PED-SEED-${++n}`, ...over }));
  const put = (role, id, body) => as(role, request(app).put(`/api/postventa/${id}`)).send(body);
  const nuevo = async (over = {}) => { const r = await crear(over); return SolicitudPostventa.findOne({ where: { codigo_seguimiento: r.body.data.codigo_seguimiento } }); };

  beforeAll(async () => {
    await setupTestDb();
    const g = await createUser(gerente);
    await createEmpresa(g.id_user);
    const a = await createUser(admin);
    const au = await createUser({ name: 'Auditor Test', email: 'auditor@test.local', password: 'Auditor123!', id_role: 5 });
    await au.update({ acceso_expira_en: new Date(Date.now() + 86400000) });
    tokens = { 1: getAuthToken(g), 2: getAuthToken(a), 5: getAuthToken(au) };
  });

  it('crea una solicitud valida con codigo nuevo e historial inicial', async () => {
    const res = await crear();
    expect(res.statusCode).toBe(201);
    expect(res.body.data.codigo_seguimiento).toMatch(CODIGO);
    expect(res.body.data.fecha_creacion).toMatch(/-05:00$/);
    expect(res.body.data).not.toHaveProperty('email');
    const item = await SolicitudPostventa.findOne({ where: { codigo_seguimiento: res.body.data.codigo_seguimiento } });
    expect(item.estado).toBe('recibida');
    expect(item.vinculado).toBeFalsy();
    const h = await SolicitudPostventaHistorial.findAll({ where: { solicitud_id: item.id_solicitud } });
    expect(h).toHaveLength(1);
  });

  it('valida cada campo con errores por campo', async () => {
    const res = await request(app).post('/api/ecommerce/postventa').send({ nombre: 'a', email: 'x', telefono: '12', numero_pedido: '', tipo: 'otro', producto_servicio: '', motivo: 'no', detalle: 'corto', solucion_solicitada: '', cantidad: 0 });
    expect(res.statusCode).toBe(400);
    expect(res.body.message).toBeTruthy();
    ['nombre', 'email', 'telefono', 'numero_pedido', 'tipo', 'producto_servicio', 'motivo', 'detalle', 'solucion_solicitada', 'cantidad', 'acepta_declaracion']
      .forEach(k => expect(res.body.errores).toHaveProperty(k));
    const largo = await crear({ nombre: 'n'.repeat(151), motivo: 'm'.repeat(181), detalle: 'd'.repeat(4001) });
    expect(largo.statusCode).toBe(400);
    ['nombre', 'motivo', 'detalle'].forEach(k => expect(largo.body.errores).toHaveProperty(k));
  });

  it('vincula con pedido real solo si el email coincide', async () => {
    const pedido = await Pedido.create({
      numero_pedido: 'PED-REAL-1', cliente_email: 'Real-Seed@Test.local', cliente_nombre: 'Real seed-care', cliente_telefono: '999000111',
      tipo_entrega: 'recojo_tienda', metodo_pago: 'efectivo', estado: 'entregado', estado_pago: 'pagado', subtotal: 100, total_final: 100,
    });
    const prod = await createProducto({ nombre: 'Mouse seed-care' });
    await PedidoDetalle.create({ id_pedido: pedido.id_pedido, producto_id: prod.id_producto, producto_nombre: 'Mouse seed-care', cantidad: 1, precio_unitario_con_igv: 100, subtotal_con_igv: 100, condicion: 'nuevo', garantia_meses: 12 });
    const ok = await nuevo({ numero_pedido: 'PED-REAL-1', email: 'real-seed@test.local', producto_servicio: 'Mouse seed-care' });
    expect(ok.vinculado).toBeTruthy();
    expect(ok.pedido_id).toBe(pedido.id_pedido);
    expect(ok.fuera_de_plazo).toBe(false);
    const dev = await nuevo({ numero_pedido: 'PED-REAL-1', email: 'real-seed@test.local', producto_servicio: 'Mouse seed-care 2', tipo: 'devolucion' });
    expect(dev.vinculado).toBeTruthy();
    expect(dev.fuera_de_plazo).toBe(false);
    const otro = await nuevo({ numero_pedido: 'PED-REAL-1', email: 'otro-seed@test.local' });
    expect(otro.vinculado).toBeFalsy();
    expect(otro.pedido_id).toBeNull();
    const nada = await nuevo({ numero_pedido: 'NO-EXISTE-9' });
    expect(nada.vinculado).toBeFalsy();
  });

  it('dedupe 24h, honeypot y colision de codigo', async () => {
    const payload = caso({ numero_pedido: 'PED-DUP-1' });
    expect((await request(app).post('/api/ecommerce/postventa').send(payload)).statusCode).toBe(201);
    const dup = await request(app).post('/api/ecommerce/postventa').send(payload);
    expect(dup.statusCode).toBe(409);
    const antes = await SolicitudPostventa.count();
    const bot = await request(app).post('/api/ecommerce/postventa').send(caso({ numero_pedido: 'PED-BOT', website: 'http://spam' }));
    expect(bot.statusCode).toBe(201);
    expect(await SolicitudPostventa.count()).toBe(antes);
    const svc = require('../../src/services/postventa.service');
    const real = svc.codigoNuevo;
    const existente = (await SolicitudPostventa.findOne()).codigo_seguimiento;
    let llamadas = 0;
    svc.codigoNuevo = () => (llamadas++ < 2 ? existente : real());
    const res = await crear();
    svc.codigoNuevo = real;
    expect(res.statusCode).toBe(201);
    expect(llamadas).toBe(3);
  });

  it('matriz de transiciones: invalidas dan 409, validas pasan', async () => {
    const it1 = await nuevo();
    expect((await put(1, it1.id_solicitud, { estado: 'aprobada', respuesta_cliente: RESP })).statusCode).toBe(409);
    expect((await put(1, it1.id_solicitud, { estado: 'resuelta', respuesta_cliente: RESP })).statusCode).toBe(409);
    expect((await put(1, it1.id_solicitud, { estado: 'en_revision' })).statusCode).toBe(200);
    expect((await put(1, it1.id_solicitud, { estado: 'esperando_cliente' })).statusCode).toBe(200);
    expect((await put(1, it1.id_solicitud, { estado: 'aprobada', respuesta_cliente: RESP })).statusCode).toBe(409);
    expect((await put(1, it1.id_solicitud, { estado: 'en_revision' })).statusCode).toBe(200);
    expect((await put(1, it1.id_solicitud, { estado: 'aprobada', respuesta_cliente: RESP })).statusCode).toBe(200);
    expect((await put(1, it1.id_solicitud, { estado: 'en_revision' })).statusCode).toBe(409);
    expect((await put(1, it1.id_solicitud, { estado: 'resuelta' })).statusCode).toBe(200);
    expect((await put(1, it1.id_solicitud, { estado: 'inventado' })).statusCode).toBe(400);
  });

  it('respuesta obligatoria (>=10) al aprobar, rechazar y resolver', async () => {
    const it1 = await nuevo();
    await put(1, it1.id_solicitud, { estado: 'en_revision' });
    for (const estado of ['aprobada', 'rechazada']) {
      const sin = await put(1, it1.id_solicitud, { estado });
      expect(sin.statusCode).toBe(400);
      expect(sin.body.errores).toHaveProperty('respuesta_cliente');
      const corta = await put(1, it1.id_solicitud, { estado, respuesta_cliente: 'corta' });
      expect(corta.statusCode).toBe(400);
    }
    const ok = await put(1, it1.id_solicitud, { estado: 'aprobada', respuesta_cliente: RESP });
    expect(ok.statusCode).toBe(200);
    await SolicitudPostventa.update({ respuesta_cliente: null }, { where: { id_solicitud: it1.id_solicitud } });
    expect((await put(1, it1.id_solicitud, { estado: 'resuelta' })).statusCode).toBe(400);
  });

  it('reapertura solo rol 1; accion posterior solo al aprobar/resolver; historial y auditoria', async () => {
    const it1 = await nuevo();
    const id = it1.id_solicitud;
    await put(2, id, { estado: 'en_revision' });
    const early = await put(2, id, { accion_posterior: 'nota_credito' });
    expect(early.statusCode).toBe(400);
    expect(early.body.errores).toHaveProperty('accion_posterior');
    // 'otra' y no 'reembolso': esta solicitud no está vinculada a un pedido
    // real con un pago Culqi detrás, y 'reembolso' ahora intenta un reembolso
    // de verdad (ver postventa.controller.js) — eso se prueba aparte.
    const aprob = await put(2, id, { estado: 'aprobada', respuesta_cliente: RESP, accion_posterior: 'otra', accion_posterior_nota: 'Yape seed-care', notas_admin: 'interno' });
    expect(aprob.statusCode).toBe(200);
    expect(aprob.body.data.accion_posterior).toBe('otra');
    expect((await put(2, id, { accion_posterior: 'inexistente' })).statusCode).toBe(400);
    await put(2, id, { estado: 'resuelta' });
    const noReabre = await put(2, id, { estado: 'en_revision' });
    expect(noReabre.statusCode).toBe(403);
    const reabre = await put(1, id, { estado: 'en_revision' });
    expect(reabre.statusCode).toBe(200);
    expect(reabre.body.data.estado).toBe('en_revision');
    const det = await as(1, request(app).get(`/api/postventa/${id}`));
    expect(det.statusCode).toBe(200);
    expect(det.body.data.historial.map(h => h.a)).toEqual(['recibida', 'en_revision', 'aprobada', 'resuelta', 'en_revision']);
    expect(det.body.data.historial[2].usuario_id).toBeTruthy();
    expect(det.body.data.historial[2].creado).toMatch(/-05:00$/);
    await new Promise(r => setTimeout(r, 300));
    const logs = await AuditLog.findAll({ where: { tabla: 'solicitudes_postventa' } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(logs[0].datos_anteriores).toBeTruthy();
    expect((await as(1, request(app).get('/api/postventa/999999'))).statusCode).toBe(404);
  });

  it('rol 5 lee pero no escribe; sin token 401', async () => {
    const it1 = await nuevo();
    expect((await as(5, request(app).get('/api/postventa'))).statusCode).toBe(200);
    expect((await as(5, request(app).get(`/api/postventa/${it1.id_solicitud}`))).statusCode).toBe(200);
    expect((await put(5, it1.id_solicitud, { estado: 'en_revision' })).statusCode).toBe(403);
    expect((await request(app).get('/api/postventa')).statusCode).toBe(401);
  });

  it('seguimiento publico exige segundo factor y no filtra datos', async () => {
    const r = await crear({ email: 'Track-Seed@Test.local', telefono: '+51 987 654 321' });
    const codigo = r.body.data.codigo_seguimiento;
    const get = (q) => request(app).get(`/api/ecommerce/postventa/seguimiento/${codigo}${q}`);
    expect((await get('')).statusCode).toBe(400);
    expect((await get('?email=otro@x.com')).statusCode).toBe(404);
    expect((await get('?tel4=0000')).statusCode).toBe(404);
    const ok = await get('?email=track-seed@test.local');
    expect(ok.statusCode).toBe(200);
    expect(ok.body.data.linea_tiempo[0].estado).toBe('recibida');
    ['email', 'telefono', 'notas_admin', 'detalle', 'numero_pedido'].forEach(k => expect(ok.body.data).not.toHaveProperty(k));
    expect((await get('?tel4=4321')).statusCode).toBe(200);
    const post = await request(app).post('/api/ecommerce/postventa/seguimiento').send({ codigo, telefono4: '4321' });
    expect(post.statusCode).toBe(200);
    expect((await request(app).post('/api/ecommerce/postventa/seguimiento').send({ codigo, email: 'x@y.com' })).statusCode).toBe(404);
    expect((await request(app).post('/api/ecommerce/postventa/seguimiento').send({ codigo: 'POS-1', email: 'a@b.co' })).statusCode).toBe(404);
    expect((await request(app).post('/api/ecommerce/postventa/seguimiento').send({ codigo })).statusCode).toBe(400);
  });

  it('listado: paginacion, filtros y resumen por estado', async () => {
    const todos = await SolicitudPostventa.count();
    const p1 = await as(1, request(app).get('/api/postventa?limit=3&page=1'));
    expect(p1.statusCode).toBe(200);
    expect(p1.body.rows).toHaveLength(3);
    expect(p1.body.total).toBe(todos);
    expect(p1.body.resumen.total).toBe(todos);
    const sumaEstados = ['recibida', 'en_revision', 'esperando_cliente', 'aprobada', 'rechazada', 'resuelta'].reduce((a, k) => a + p1.body.resumen[k], 0);
    expect(sumaEstados).toBe(todos);
    const p2 = await as(1, request(app).get('/api/postventa?limit=3&page=2'));
    expect(p2.body.rows[0].id_solicitud).not.toBe(p1.body.rows[0].id_solicitud);
    const vinc = await as(1, request(app).get('/api/postventa?vinculado=true'));
    expect(vinc.body.rows.length).toBeGreaterThan(0);
    vinc.body.rows.forEach(x => expect(x.vinculado).toBe(true));
    const q = await as(1, request(app).get('/api/postventa?q=Track-Seed&tipo=garantia&estado=recibida'));
    expect(q.body.total).toBe(1);
    expect(q.body.rows[0].fecha_creacion).toMatch(/-05:00$/);
    expect((await as(1, request(app).get('/api/postventa?estado=zzz'))).statusCode).toBe(400);
  });

  afterAll(async () => {
    const ids = (await SolicitudPostventa.findAll({ attributes: ['id_solicitud'] })).map(x => x.id_solicitud);
    if (ids.length) await SolicitudPostventaHistorial.destroy({ where: { solicitud_id: ids } });
    await SolicitudPostventa.destroy({ where: {} });
    await PedidoDetalle.destroy({ where: {} });
    await Pedido.destroy({ where: { numero_pedido: 'PED-REAL-1' } });
  });
});
