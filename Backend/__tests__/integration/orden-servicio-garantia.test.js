'use strict';

const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente } = require('../fixtures/users.fixture');
const { OrdenServicio, OrdenServicioEvento } = require('../../src/models');

describe('Reingresos por garantía de Servicio Técnico', () => {
  let token;

  beforeAll(async () => {
    await setupTestDb();
    const master = await createUser({ ...gerente, email: 'master-garantia@test.local' });
    process.env.MASTER_ADMIN_EMAIL = master.email;
    token = getAuthToken(master);
  });

  const deliveredOrder = overrides => OrdenServicio.create({
    tipo: 'servicio_tecnico',
    codigo: `ST-GAR-${Date.now()}-${Math.floor(Math.random() * 9999)}`,
    cliente: 'Cliente Garantía',
    telefono: '999999999',
    equipo: 'Laptop',
    numero_serie: 'SERIE-GAR-1',
    detalle: 'Reparación original',
    estado: 'entregado',
    moneda: 'PEN',
    costo_repuestos: 100,
    costo_mano_obra: 50,
    descuento: 0,
    recargo: 0,
    adelanto: 150,
    fecha_ingreso: '2026-08-01',
    fecha_entrega_real: '2026-08-05',
    garantia_dias: 30,
    garantia_inicio: '2026-08-05',
    garantia_fin: new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10),
    garantia_cobertura: 'Trabajo realizado',
    garantia_exclusiones: 'Golpes y humedad',
    creado_por: 1,
    ...overrides,
  });

  it('crea una orden nueva enlazada y registra eventos en ambos expedientes', async () => {
    const origin = await deliveredOrder();
    const response = await request(app)
      .post(`/api/ordenes-servicio/${origin.id_orden_servicio}/reingreso-garantia`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'La falla reapareció durante las pruebas del cliente' });

    expect(response.statusCode).toBe(201);
    expect(response.body.orden_origen_garantia_id).toBe(origin.id_orden_servicio);
    expect(response.body.estado).toBe('recibido');
    expect(Number(response.body.costo_repuestos)).toBe(0);
    const originEvents = await OrdenServicioEvento.findAll({ where: { id_orden_servicio: origin.id_orden_servicio } });
    const reentryEvents = await OrdenServicioEvento.findAll({ where: { id_orden_servicio: response.body.id_orden_servicio } });
    expect(originEvents.some(event => event.tipo === 'reingreso_garantia')).toBe(true);
    expect(reentryEvents.some(event => event.tipo === 'creacion_garantia')).toBe(true);
  });

  it('rechaza garantías vencidas', async () => {
    const origin = await deliveredOrder({ garantia_inicio: '2026-01-01', garantia_fin: '2026-01-31' });
    const response = await request(app)
      .post(`/api/ordenes-servicio/${origin.id_orden_servicio}/reingreso-garantia`)
      .set('Authorization', `Bearer ${token}`)
      .send({ motivo: 'Falla fuera de vigencia' });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/venció/i);
  });
});
