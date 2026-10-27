'use strict';
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser, createProducto } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente } = require('../fixtures/users.fixture');
const M = require('../../src/models');
const mail = require('../../src/services/solicitudMail.service');

// Datos de prueba con marca seed-adm
let n = 0;
const imp = (over = {}) => ({
  nombre_solicitante: 'Cliente seed-adm', email_solicitante: `seed-adm-${++n}@test.local`, telefono_solicitante: '999 123 4567',
  nombre_producto: `Laptop seed-adm ${n}`, tipo_producto: 'laptop', marca: 'Lenovo', cantidad: 2, nivel_urgencia: 'alta', ...over,
});
const arm = (over = {}) => ({
  nombre_solicitante: 'Cliente seed-adm', telefono_solicitante: `9${String(10000000 + ++n)}`, email_solicitante: 'seed-adm@test.local',
  ciudad: 'Arequipa', modo: 'presupuesto', tier_presupuesto: 'gamer', ...over,
});

describe('Solicitudes de importación y armado - lógica admin', () => {
  let token;
  let spy;
  const auth = (r) => r.set('Authorization', `Bearer ${token}`);
  const postImp = (over) => request(app).post('/api/ecommerce/solicitudes-importacion').send(imp(over));
  const postArm = (over) => request(app).post('/api/ecommerce/solicitudes-ensamble').send(arm(over));
  const putImp = (id, body) => auth(request(app).put(`/api/solicitudes-importacion/${id}/estado`)).send(body);
  const putArm = (id, body) => auth(request(app).put(`/api/solicitudes-ensamble/${id}/estado`)).send(body);
  const nuevaImp = async (over) => { const r = await postImp(over); return M.SolicitudImportacion.findOne({ where: { codigo_seguimiento: r.body.data.codigo_seguimiento } }); };
  const nuevaArm = async (over) => { const r = await postArm(over); return M.SolicitudEnsamble.findOne({ where: { codigo_seguimiento: r.body.data.codigo_seguimiento } }); };
  const COTIZA = { estado: 'cotizada', cotizacion_monto: 1500, cotizacion_nota: 'Incluye flete aéreo y aduanas.' };

  beforeAll(async () => {
    await setupTestDb();
    // El área es exclusiva de la cuenta maestra: no depender de que otra suite haya definido la variable antes.
    process.env.MASTER_ADMIN_EMAIL = 'cristophercalioro@gmail.com';
    const g = await createUser({ ...gerente, email: 'cristophercalioro@gmail.com' });
    token = getAuthToken(g);
    spy = jest.spyOn(mail, 'enviarCorreo').mockResolvedValue(true);
  });
  afterAll(() => spy.mockRestore());

  describe('importación - entrada pública', () => {
    it('crea con código nuevo en fecha Lima, fechas ISO y correo de recibido', async () => {
      spy.mockClear();
      const res = await postImp();
      expect(res.statusCode).toBe(201);
      expect(res.body.data.codigo_seguimiento).toMatch(/^SOL-\d{8}-[A-HJ-NP-Z2-9]{10}$/);
      expect(res.body.data.created_at).toMatch(/-05:00$/);
      expect(res.body.data.updated_at).toMatch(/-05:00$/);
      expect(res.body.data.moneda).toBe('USD');
      const hoy = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Lima' }).format(new Date()).replaceAll('-', '');
      expect(res.body.data.codigo_seguimiento).toContain(`SOL-${hoy}-`);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][1]).toContain(res.body.data.codigo_seguimiento);
    });

    it('valida por campo y rechaza textos largos con 400 (no 500)', async () => {
      const mal = await request(app).post('/api/ecommerce/solicitudes-importacion').send({
        nombre_solicitante: 'a', email_solicitante: 'x', telefono_solicitante: '12', nombre_producto: '', tipo_producto: 'auto',
        cantidad: 0, presupuesto_min: 50, presupuesto_max: 10, nivel_urgencia: 'ya', imagenes_urls: ['ftp://x', 'javascript:1'],
      });
      expect(mal.statusCode).toBe(400);
      expect(mal.body.message).toBeTruthy();
      ['nombre_solicitante', 'email_solicitante', 'telefono_solicitante', 'nombre_producto', 'tipo_producto', 'cantidad',
        'presupuesto_min', 'nivel_urgencia', 'imagenes_urls'].forEach((k) => expect(mal.body.errores).toHaveProperty(k));
      const largo = await postImp({ marca: 'm'.repeat(81), especificaciones: 'e'.repeat(4001) });
      expect(largo.statusCode).toBe(400);
      expect(largo.body.errores).toHaveProperty('marca');
      expect(largo.body.errores).toHaveProperty('especificaciones');
    });

    it('honeypot no guarda y dedupe de 24 h responde 409', async () => {
      const antes = await M.SolicitudImportacion.count();
      const bot = await postImp({ website: 'http://spam' });
      expect(bot.statusCode).toBe(201);
      expect(await M.SolicitudImportacion.count()).toBe(antes);
      const base = imp();
      expect((await request(app).post('/api/ecommerce/solicitudes-importacion').send(base)).statusCode).toBe(201);
      const dup = await request(app).post('/api/ecommerce/solicitudes-importacion').send(base);
      expect(dup.statusCode).toBe(409);
      expect(dup.body.message).toMatch(/24 horas/);
    });
  });

  describe('importación - seguimiento público', () => {
    it('exige segundo factor, 404 uniforme y no filtra datos internos', async () => {
      const item = await nuevaImp();
      const cod = item.codigo_seguimiento;
      const sin = await request(app).get(`/api/ecommerce/seguimiento/${cod}`);
      expect(sin.statusCode).toBe(400);
      const mal = await request(app).get(`/api/ecommerce/seguimiento/${cod}?email=otro@x.com`);
      const noExiste = await request(app).get('/api/ecommerce/seguimiento/SOL-20260101-ZZZZZZZZZZ?email=a@b.co');
      expect(mal.statusCode).toBe(404);
      expect(noExiste.statusCode).toBe(404);
      expect(mal.body.message).toBe(noExiste.body.message);
      const ok = await request(app).post('/api/ecommerce/seguimiento').send({ codigo: cod, email: item.email_solicitante });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.data.created_at).toMatch(/-05:00$/);
      expect(ok.body.data.updated_at).toMatch(/-05:00$/);
      ['notas_admin', 'nombre_solicitante', 'email_solicitante', 'telefono_solicitante', 'importacion_id'].forEach((k) => expect(ok.body.data).not.toHaveProperty(k));
      const tel = await request(app).post('/api/ecommerce/seguimiento').send({ codigo: cod.toLowerCase(), telefono4: '4567' });
      expect(tel.statusCode).toBe(200);
      expect((await request(app).post('/api/ecommerce/seguimiento').send({ codigo: cod, telefono4: '0000' })).statusCode).toBe(404);
    });
  });

  describe('importación - admin', () => {
    it('lista paginada con búsqueda, filtro y resumen; limit/offset inválidos usan el defecto', async () => {
      await nuevaImp({ nombre_producto: 'Monitor seed-adm buscable', tipo_producto: 'monitor' });
      const res = await auth(request(app).get('/api/solicitudes-importacion?limit=2&page=1'));
      expect(res.statusCode).toBe(200);
      expect(res.body).toEqual(expect.objectContaining({ page: 1, limit: 2 }));
      expect(res.body.rows).toHaveLength(2);
      expect(res.body.total).toBeGreaterThan(2);
      expect(res.body.resumen.recibida).toBeGreaterThan(0);
      expect(res.body.resumen.total).toBe(res.body.total);
      const q = await auth(request(app).get('/api/solicitudes-importacion?q=buscable'));
      expect(q.body.total).toBe(1);
      const malo = await auth(request(app).get('/api/solicitudes-importacion?limit=abc&offset=-4&page=x'));
      expect(malo.statusCode).toBe(200);
      expect(malo.body.limit).toBe(20);
      expect((await auth(request(app).get('/api/solicitudes-importacion?estado=inventado'))).statusCode).toBe(400);
      const sin = await request(app).get('/api/solicitudes-importacion');
      expect(sin.statusCode).toBe(401);
    });

    it('matriz de transiciones: salto inválido 409, estado null/inválido 400', async () => {
      const item = await nuevaImp();
      const salto = await putImp(item.id_solicitud, { estado: 'aprobada' });
      expect(salto.statusCode).toBe(409);
      expect(salto.body.message).toMatch(/No se puede pasar/);
      expect((await putImp(item.id_solicitud, { estado: null })).statusCode).toBe(400);
      expect((await putImp(item.id_solicitud, { estado: 'x' })).statusCode).toBe(400);
      expect((await putImp(item.id_solicitud, { cotizacion_monto: 'abc', fecha_entrega_estimada: '31/12' })).body.errores)
        .toEqual(expect.objectContaining({ cotizacion_monto: expect.any(String), fecha_entrega_estimada: expect.any(String) }));
      expect((await putImp(item.id_solicitud, { cotizacion_monto: -5 })).statusCode).toBe(400);
      expect((await putImp(999999, { estado: 'en_revision' })).statusCode).toBe(404);
    });

    it('cotizada exige monto > 0 y nota; null no sella fecha ni borra la nota', async () => {
      const item = await nuevaImp();
      const id = item.id_solicitud;
      const sin = await putImp(id, { estado: 'cotizada' });
      expect(sin.statusCode).toBe(400);
      expect(sin.body.errores).toHaveProperty('cotizacion_monto');
      expect(sin.body.errores).toHaveProperty('cotizacion_nota');
      const nulo = await putImp(id, { cotizacion_monto: null, cotizacion_nota: 'Nota visible previa', notas_admin: 'interna' });
      expect(nulo.statusCode).toBe(200);
      expect(nulo.body.data.cotizacion_fecha).toBeNull();
      expect(nulo.body.data.valida_hasta).toBeNull();
      const otra = await putImp(id, { cotizacion_monto: null });
      expect(otra.body.data.cotizacion_nota).toBe('Nota visible previa');
      spy.mockClear();
      const ok = await putImp(id, { ...COTIZA, cotizacion_nota: undefined });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.data.estado).toBe('cotizada');
      expect(ok.body.data.cotizacion_monto).toBe(1500);
      expect(ok.body.data.cotizacion_fecha).toMatch(/-05:00$/);
      const dias = (new Date(ok.body.data.valida_hasta) - new Date(ok.body.data.cotizacion_fecha)) / 86400000;
      expect(Math.round(dias)).toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]).toContain('1500.00');
    });

    it('registra historial y auditoría; re-cotizar renueva fecha; aprobada bloquea el monto', async () => {
      const item = await nuevaImp();
      const id = item.id_solicitud;
      await putImp(id, COTIZA);
      const r2 = await putImp(id, { cotizacion_monto: 1400 });
      expect(r2.statusCode).toBe(200);
      const hist = await M.SolicitudImportacionHistorial.findAll({ where: { solicitud_id: id }, order: [['id_historial', 'ASC']] });
      expect(hist.map((h) => h.accion)).toEqual(expect.arrayContaining(['estado', 'cotizacion']));
      const cot = hist.filter((h) => h.accion === 'cotizacion');
      expect(Number(cot[cot.length - 1].monto_anterior)).toBe(1500);
      expect(Number(cot[cot.length - 1].monto_nuevo)).toBe(1400);
      const logs = await M.AuditLog.findAll({ where: { tabla: 'solicitudes_importacion' } });
      expect(logs.length).toBeGreaterThanOrEqual(2);
      expect((await putImp(id, { estado: 'aprobada' })).statusCode).toBe(200);
      const bloqueo = await putImp(id, { cotizacion_monto: 900 });
      expect(bloqueo.statusCode).toBe(409);
      const det = await auth(request(app).get(`/api/solicitudes-importacion/${id}`));
      expect(det.body.data.historial.length).toBeGreaterThanOrEqual(3);
    });

    it('convierte en importación planificada, es idempotente y no mueve dinero', async () => {
      const item = await nuevaImp({ pais_origen: 'China' });
      const id = item.id_solicitud;
      expect((await auth(request(app).post(`/api/solicitudes-importacion/${id}/convertir`))).statusCode).toBe(409);
      await putImp(id, { ...COTIZA, fecha_entrega_estimada: '2026-12-15' });
      const a = await auth(request(app).post(`/api/solicitudes-importacion/${id}/convertir`));
      expect(a.statusCode).toBe(201);
      expect(a.body.ya_convertida).toBe(false);
      const b = await auth(request(app).post(`/api/solicitudes-importacion/${id}/convertir`));
      expect(b.statusCode).toBe(200);
      expect(b.body.ya_convertida).toBe(true);
      expect(b.body.importacion_id).toBe(a.body.importacion_id);
      const imps = await M.Importacion.findAll({ where: { referencia: item.codigo_seguimiento } });
      expect(imps).toHaveLength(1);
      expect(imps[0].estado).toBe('planificada');
      expect(imps[0].moneda).toBe('USD');
      expect(Number(imps[0].costo_mercancia)).toBe(0);
      expect(imps[0].pais_origen).toBe('China');
      await item.reload();
      expect(item.importacion_id).toBe(imps[0].id_importacion);
    });
  });

  describe('armado - entrada pública y precios', () => {
    let cpu; let gpu;
    beforeAll(async () => {
      cpu = await createProducto({ nombre: 'CPU seed-adm', precio_unitario: 400, precio_unitario_con_igv: 472, stock: 3 });
      gpu = await createProducto({ nombre: 'GPU seed-adm', precio_unitario: 1000, precio_unitario_con_igv: 1180, stock: 0 });
    });
    const market = (over = {}) => arm({ modo: 'marketplace', tier_presupuesto: undefined, ...over });

    it('recalcula precio y nombre contra el catálogo e ignora lo que manda el navegador', async () => {
      const res = await postArm(market({ productos: [{ id_producto: cpu.id_producto, nombre: 'Gratis', precio: 1, cantidad: 2 }] }));
      expect(res.statusCode).toBe(201);
      expect(res.body.data.productos).toEqual([{ nombre: 'CPU seed-adm', cantidad: 2, precio: 472 }]);
      expect(res.body.data.total_referencial).toBe(944);
      const fila = await M.SolicitudEnsamble.findOne({ where: { codigo_seguimiento: res.body.data.codigo_seguimiento } });
      expect(fila.productos[0]).toEqual(expect.objectContaining({ precio: 472, precio_declarado: 1, stock_momento: 3 }));
      ['nombre_solicitante', 'ciudad', 'telefono_solicitante', 'email_solicitante', 'notas_admin'].forEach((k) => expect(res.body.data).not.toHaveProperty(k));
    });

    it('rechaza productos inexistentes y valida por campo', async () => {
      const r = await postArm(market({ productos: [{ id_producto: 987654, cantidad: 1 }] }));
      expect(r.statusCode).toBe(400);
      expect(r.body.errores).toHaveProperty('productos');
      const mal = await request(app).post('/api/ecommerce/solicitudes-ensamble').send({
        nombre_solicitante: 'x', telefono_solicitante: 'abc', email_solicitante: 'no', ciudad: '', modo: 'ensamble_propio', mensaje: 'corto',
      });
      expect(mal.statusCode).toBe(400);
      ['nombre_solicitante', 'telefono_solicitante', 'email_solicitante', 'ciudad', 'mensaje'].forEach((k) => expect(mal.body.errores).toHaveProperty(k));
      expect((await postArm({ tier_presupuesto: 'otro' })).body.errores).toHaveProperty('presupuesto_personalizado');
    });

    it('dedupe de 24 h por teléfono y contenido; honeypot no guarda', async () => {
      const body = market({ productos: [{ id_producto: gpu.id_producto, cantidad: 1 }] });
      expect((await request(app).post('/api/ecommerce/solicitudes-ensamble').send(body)).statusCode).toBe(201);
      expect((await request(app).post('/api/ecommerce/solicitudes-ensamble').send(body)).statusCode).toBe(409);
      const antes = await M.SolicitudEnsamble.count();
      expect((await postArm({ website: 'x' })).statusCode).toBe(201);
      expect(await M.SolicitudEnsamble.count()).toBe(antes);
    });

    it('seguimiento: segundo factor por correo o 4 últimos del teléfono', async () => {
      const item = await nuevaArm();
      const cod = item.codigo_seguimiento;
      expect((await request(app).get(`/api/ecommerce/seguimiento-ensamble/${cod}`)).statusCode).toBe(400);
      expect((await request(app).post('/api/ecommerce/seguimiento-ensamble').send({ codigo: cod, email: 'otro@x.com' })).statusCode).toBe(404);
      const ok = await request(app).post('/api/ecommerce/seguimiento-ensamble').send({ codigo: cod, telefono4: item.telefono_solicitante.slice(-4) });
      expect(ok.statusCode).toBe(200);
      expect(ok.body.data.created_at).toMatch(/-05:00$/);
      expect(ok.body.data.updated_at).toMatch(/-05:00$/);
      const porMail = await request(app).get(`/api/ecommerce/seguimiento-ensamble/${cod}?email=SEED-ADM@test.local`);
      expect(porMail.statusCode).toBe(200);
    });
  });

  describe('armado - admin', () => {
    it('detalle con precio/stock vigentes, desglose con IGV y estado de cotización en soles', async () => {
      const p = await createProducto({ nombre: 'RAM seed-adm', precio_unitario: 100, precio_unitario_con_igv: 118, stock: 5 });
      const item = await nuevaArm({ modo: 'marketplace', tier_presupuesto: undefined, productos: [{ id_producto: p.id_producto, cantidad: 2 }] });
      await p.update({ precio_unitario_con_igv: 130, stock: 1 });
      const det = await auth(request(app).get(`/api/solicitudes-ensamble/${item.id_solicitud}`));
      expect(det.statusCode).toBe(200);
      const l = det.body.data.productos[0];
      expect(l).toEqual(expect.objectContaining({ precio: 118, precio_actual: 130, stock_actual: 1, disponible: false, precio_cambio: true }));
      expect(det.body.data.resumen_catalogo).toEqual({ subtotal_sin_igv: 200, igv: 36, total_catalogo: 236 });
      expect(det.body.data.moneda).toBe('PEN');
      expect(det.body.data.whatsapp_url).toMatch(/^https:\/\/wa\.me\/51/);
      expect(det.body.data.transiciones).toEqual(['en_revision', 'cotizada', 'rechazada']);
    });

    it('transiciones con 409, cotización con vigencia de 7 días y correo solo si hay email', async () => {
      const item = await nuevaArm();
      const id = item.id_solicitud;
      expect((await putArm(id, { estado: 'en_ensamble' })).statusCode).toBe(409);
      expect((await putArm(id, { estado: null })).statusCode).toBe(400);
      expect((await putArm(id, { estado: 'cotizada', cotizacion_monto: 3500 })).body.errores).toHaveProperty('cotizacion_nota');
      spy.mockClear();
      const ok = await putArm(id, { estado: 'cotizada', cotizacion_monto: 3500, cotizacion_nota: 'Armado con garantía de 12 meses.' });
      expect(ok.statusCode).toBe(200);
      expect(Math.round((new Date(ok.body.data.valida_hasta) - new Date(ok.body.data.cotizacion_fecha)) / 86400000)).toBe(7);
      expect(spy).toHaveBeenCalledTimes(1);
      expect(spy.mock.calls[0][2]).toContain('S/ 3500.00');
      expect((await putArm(id, { estado: 'aprobada' })).statusCode).toBe(200);
      expect((await putArm(id, { estado: 'en_ensamble' })).statusCode).toBe(200);
      expect((await putArm(id, { estado: 'entregada' })).statusCode).toBe(200);
      expect((await putArm(id, { estado: 'recibida' })).statusCode).toBe(409);
      const logs = await M.AuditLog.findAll({ where: { tabla: 'solicitudes_ensamble' } });
      expect(logs.length).toBeGreaterThanOrEqual(4);
    });

    it('convierte marketplace en cotización borrador por el monto acordado, idempotente', async () => {
      const p = await createProducto({ nombre: 'SSD seed-adm', precio_unitario: 200, precio_unitario_con_igv: 236, stock: 4 });
      const item = await nuevaArm({ modo: 'marketplace', tier_presupuesto: undefined, productos: [{ id_producto: p.id_producto, cantidad: 2 }] });
      const id = item.id_solicitud;
      expect((await auth(request(app).post(`/api/solicitudes-ensamble/${id}/convertir`))).statusCode).toBe(409);
      await putArm(id, { estado: 'cotizada', cotizacion_monto: 600, cotizacion_nota: 'Incluye armado y pruebas.' });
      const a = await auth(request(app).post(`/api/solicitudes-ensamble/${id}/convertir`));
      expect(a.statusCode).toBe(201);
      const b = await auth(request(app).post(`/api/solicitudes-ensamble/${id}/convertir`));
      expect(b.statusCode).toBe(200);
      expect(b.body.ya_convertida).toBe(true);
      expect(b.body.cotizacion_id).toBe(a.body.cotizacion_id);
      const cot = await M.Cotizacion.findByPk(a.body.cotizacion_id, { include: [{ model: M.CotizacionDetalle, as: 'detalles' }] });
      expect(cot.estado).toBe('borrador');
      expect(Number(cot.total)).toBe(600);
      expect(cot.detalles).toHaveLength(2);
      expect(await M.Cotizacion.count()).toBe(1);
    });

    it('presupuesto y ensamble_propio no se convierten (pendiente documentado)', async () => {
      const item = await nuevaArm();
      await putArm(item.id_solicitud, { estado: 'cotizada', cotizacion_monto: 2800, cotizacion_nota: 'Propuesta gamer.' });
      const r = await auth(request(app).post(`/api/solicitudes-ensamble/${item.id_solicitud}/convertir`));
      expect(r.statusCode).toBe(409);
      expect(r.body.message).toMatch(/catálogo/);
    });
  });
});
