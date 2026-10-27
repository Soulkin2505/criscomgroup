'use strict';

const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser, createProducto } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente } = require('../fixtures/users.fixture');
const { OrdenServicio, Venta, DetalleVenta, MovimientoInventario } = require('../../src/models');

describe('Facturación automática de Servicio Técnico', () => {
  let token;
  let master;
  let sequence = 0;

  beforeAll(async () => {
    await setupTestDb();
    master = await createUser({ ...gerente, email: 'master-servicios@test.local' });
    token = getAuthToken(master);
  });

  const createOrder = overrides => OrdenServicio.create({
    tipo: 'servicio_tecnico', codigo: `ST-BILL-${++sequence}`, cliente: 'Cliente Servicio',
    documento: '12345678', equipo: 'Laptop', detalle: 'Diagnóstico y reparación',
    trabajo_realizado: 'Mantenimiento preventivo', estado: 'listo', moneda: 'PEN',
    costo_repuestos: 0, costo_mano_obra: 100, descuento: 0, recargo: 0, adelanto: 0,
    fecha_ingreso: '2026-08-13', garantia_dias: 30, creado_por: master.id_user,
    ...overrides,
  });

  it('genera una venta de servicios clasificada como RHE al completar el pago sin repuestos', async () => {
    const order = await createOrder();
    const response = await request(app).post(`/api/ordenes-servicio/${order.id_orden_servicio}/pagos`)
      .set('Authorization', `Bearer ${token}`).send({ metodo: 'efectivo', monto: 100 });
    expect(response.statusCode).toBe(201);
    const stored = await OrdenServicio.findByPk(order.id_orden_servicio);
    const sale = await Venta.unscoped().findByPk(stored.venta_id);
    expect(stored.clasificacion_fiscal).toBe('recibo_honorarios');
    expect(stored.estado_facturacion).toBe('pendiente_emision');
    expect(sale.categoria_ingreso).toBe('servicios');
    expect(sale.tipo_documento).toBeNull();
    expect(Number(sale.total)).toBe(100);
    const beforeCount = await Venta.unscoped().count({ where: { orden_servicio_id: order.id_orden_servicio } });
    const delivered = await request(app).put(`/api/ordenes-servicio/${order.id_orden_servicio}`)
      .set('Authorization', `Bearer ${token}`).send({ ...stored.toJSON(), estado: 'entregado' });
    expect(delivered.statusCode).toBe(200);
    expect(await Venta.unscoped().count({ where: { orden_servicio_id: order.id_orden_servicio } })).toBe(beforeCount);
  });

  it('clasifica como boleta/factura cuando la orden contiene un repuesto y registra su reserva en kardex', async () => {
    const product = await createProducto({ sku: 'REP-SERV-001', nombre: 'Repuesto servicio', stock: 2, precio_unitario_con_igv: 59 });
    const order = await createOrder({ documento: '20123456789', costo_mano_obra: 41 });
    const partResponse = await request(app).post(`/api/ordenes-servicio/${order.id_orden_servicio}/repuestos`)
      .set('Authorization', `Bearer ${token}`).send({ id_producto: product.id_producto, cantidad: 1, precio_unitario: 59, costo_unitario: 30 });
    expect(partResponse.statusCode).toBe(201);
    const payment = await request(app).post(`/api/ordenes-servicio/${order.id_orden_servicio}/pagos`)
      .set('Authorization', `Bearer ${token}`).send({ metodo: 'efectivo', monto: 100 });
    expect(payment.statusCode).toBe(201);
    const stored = await OrdenServicio.findByPk(order.id_orden_servicio);
    const sale = await Venta.unscoped().findByPk(stored.venta_id);
    const lines = await DetalleVenta.findAll({ where: { venta_id: sale.venta_id } });
    const movement = await MovimientoInventario.findOne({ where: { referencia_tipo: 'orden_servicio', referencia_id: order.id_orden_servicio, tipo: 'reserva' } });
    expect(stored.clasificacion_fiscal).toBe('mixta');
    expect(Number(sale.total_con_igv)).toBe(59);
    expect(Number(sale.total)).toBe(50);
    expect(sale.tipo_documento).toBe('1');
    expect(lines).toHaveLength(1);
    expect(movement.stock_anterior).toBe(2);
    expect(movement.stock_nuevo).toBe(1);
  });

  it('impide cerrar y entregar una orden con saldo pendiente', async () => {
    const order = await createOrder();
    const response = await request(app).put(`/api/ordenes-servicio/${order.id_orden_servicio}`)
      .set('Authorization', `Bearer ${token}`).send({ ...order.toJSON(), estado: 'entregado' });
    expect(response.statusCode).toBe(400);
    expect(response.body.message).toMatch(/saldo pendiente/i);
  });
});
