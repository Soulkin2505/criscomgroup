'use strict';
/**
 * MVP tracking de solicitudes de importación (hot-patch B).
 *
 * Estrategia: tres endpoints públicos (create + seguimiento) que no requieren
 * auth de cliente, más dos endpoints admin autenticados por JWT del ERP.
 * El cliente identifica su solicitud con un `codigo_seguimiento` único
 * generado en el POST (p. ej. `SOL-20260421-ABC123`).
 *
 * Las imágenes del form NO se soportan aún (MVP solo campos text/number).
 * Cuando se agreguen, debe reutilizarse el upload middleware para fieldname
 * `imagenes` y hacer mkdir self-healing (patrón de fix-wave-1.1 hot-patch).
 */
const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente, vendedor } = require('../fixtures/users.fixture');

const payloadValido = {
  nombre_solicitante: 'Juan Pérez',
  email_solicitante: 'juan@example.com',
  telefono_solicitante: '999111222',
  nombre_producto: 'MacBook Pro M3',
  tipo_producto: 'laptop',
  marca: 'Apple',
  modelo: 'MacBook Pro 14 M3 Pro',
  cantidad: 1,
  nivel_urgencia: 'media',
  mensaje: 'Necesito para trabajo',
};

describe('Solicitudes de importación — MVP público (POST + seguimiento)', () => {
  beforeAll(async () => {
    await setupTestDb();
  });

  it('POST /api/ecommerce/solicitudes-importacion crea solicitud y devuelve codigo_seguimiento', async () => {
    const res = await request(app)
      .post('/api/ecommerce/solicitudes-importacion')
      .send(payloadValido);

    expect(res.statusCode).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toBeDefined();
    expect(res.body.data.codigo_seguimiento).toMatch(/^SOL-\d{8}-[A-Z0-9]+$/);
    expect(res.body.data.estado).toBe('recibida');
    expect(res.body.data.nombre_producto).toBe('MacBook Pro M3');
  });

  it('POST rechaza payload sin nombre_solicitante con 400', async () => {
    const { nombre_solicitante, ...invalido } = payloadValido;
    const res = await request(app)
      .post('/api/ecommerce/solicitudes-importacion')
      .send(invalido);

    expect(res.statusCode).toBe(400);
  });

  it('POST rechaza email inválido con 400', async () => {
    const res = await request(app)
      .post('/api/ecommerce/solicitudes-importacion')
      .send({ ...payloadValido, email_solicitante: 'no-es-email' });

    expect(res.statusCode).toBe(400);
  });

  it('POST rechaza tipo_producto fuera del enum con 400', async () => {
    const res = await request(app)
      .post('/api/ecommerce/solicitudes-importacion')
      .send({ ...payloadValido, tipo_producto: 'auto_partes' });

    expect(res.statusCode).toBe(400);
  });

  it('GET /api/ecommerce/seguimiento/:codigo devuelve estado cuando existe', async () => {
    const created = await request(app)
      .post('/api/ecommerce/solicitudes-importacion')
      .send({ ...payloadValido, nombre_producto: 'iPhone 16 Pro' });
    const codigo = created.body.data.codigo_seguimiento;

    // Sin segundo factor no se entrega nada; con el correo registrado sí.
    const sinFactor = await request(app).get(`/api/ecommerce/seguimiento/${codigo}`);
    expect(sinFactor.statusCode).toBe(400);
    const res = await request(app).get(`/api/ecommerce/seguimiento/${codigo}?email=${payloadValido.email_solicitante}`);

    expect(res.statusCode).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.codigo_seguimiento).toBe(codigo);
    expect(res.body.data.estado).toBe('recibida');
    expect(res.body.data.nombre_producto).toBe('iPhone 16 Pro');
    // el cliente NO debe ver notas internas del admin
    expect(res.body.data.notas_admin).toBeUndefined();
  });

  it('GET seguimiento con código inexistente devuelve 404', async () => {
    const res = await request(app).get('/api/ecommerce/seguimiento/SOL-99999999-NOEXISTE?email=a@b.co');
    expect(res.statusCode).toBe(404);
  });
});

describe('Solicitudes de importación — Admin (autenticación ERP)', () => {
  let crisitusToken;
  let otroGerenteToken;
  let vendedorToken;

  beforeAll(async () => {
    await setupTestDb();
    // El área es exclusiva de la cuenta maestra: no depender de que otra suite haya definido la variable antes.
    process.env.MASTER_ADMIN_EMAIL = 'cristophercalioro@gmail.com';
    const g = await createUser({ ...gerente, email: 'cristophercalioro@gmail.com' });
    const otroGerente = await createUser({ ...gerente, email: 'otro-gerente@test.local' });
    const v = await createUser(vendedor);
    crisitusToken = getAuthToken(g);
    otroGerenteToken = getAuthToken(otroGerente);
    vendedorToken = getAuthToken(v);
    // Sembrar 2 solicitudes
    await request(app).post('/api/ecommerce/solicitudes-importacion').send(payloadValido);
    await request(app).post('/api/ecommerce/solicitudes-importacion').send({
      ...payloadValido,
      nombre_producto: 'Segunda solicitud',
    });
  });

  it('GET /api/solicitudes-importacion sin token devuelve 401', async () => {
    const res = await request(app).get('/api/solicitudes-importacion');
    expect(res.statusCode).toBe(401);
  });

  it('GET bloquea incluso a otro gerente y a un vendedor', async () => {
    await request(app)
      .get('/api/solicitudes-importacion')
      .set('Authorization', `Bearer ${otroGerenteToken}`)
      .expect(403);
    await request(app)
      .get('/api/solicitudes-importacion')
      .set('Authorization', `Bearer ${vendedorToken}`)
      .expect(403);
  });

  it('GET con identidad exacta de Crisitus devuelve listado completo', async () => {
    const res = await request(app)
      .get('/api/solicitudes-importacion')
      .set('Authorization', `Bearer ${crisitusToken}`);

    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(2);
    // Admin SÍ ve campos completos, incluido potenciales notas_admin
    expect(res.body.data[0]).toHaveProperty('codigo_seguimiento');
    expect(res.body.data[0]).toHaveProperty('email_solicitante');
  });

  it('PUT /api/solicitudes-importacion/:id/estado actualiza estado y notas_admin', async () => {
    const lista = await request(app)
      .get('/api/solicitudes-importacion')
      .set('Authorization', `Bearer ${crisitusToken}`);
    const id = lista.body.data[0].id_solicitud;

    const res = await request(app)
      .put(`/api/solicitudes-importacion/${id}/estado`)
      .set('Authorization', `Bearer ${crisitusToken}`)
      .send({ estado: 'cotizada', notas_admin: 'Cotización enviada por email', cotizacion_monto: 850, cotizacion_nota: 'Incluye flete.' });

    expect(res.statusCode).toBe(200);
    expect(res.body.data.estado).toBe('cotizada');
    expect(res.body.data.notas_admin).toBe('Cotización enviada por email');

    // Verificar que el cambio se refleja en la vista pública de seguimiento
    const codigo = lista.body.data[0].codigo_seguimiento;
    const pub = await request(app).get(`/api/ecommerce/seguimiento/${codigo}?email=${payloadValido.email_solicitante}`);
    expect(pub.body.data.estado).toBe('cotizada');
  });

  it('PUT rechaza estado fuera del enum con 400', async () => {
    const lista = await request(app)
      .get('/api/solicitudes-importacion')
      .set('Authorization', `Bearer ${crisitusToken}`);
    const id = lista.body.data[0].id_solicitud;

    const res = await request(app)
      .put(`/api/solicitudes-importacion/${id}/estado`)
      .set('Authorization', `Bearer ${crisitusToken}`)
      .send({ estado: 'estado_inexistente' });

    expect(res.statusCode).toBe(400);
  });
});
