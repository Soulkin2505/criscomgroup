const request = require('supertest');
const { app } = require('../../src/app');
const { setupTestDb } = require('../helpers/db');
const { createUser, createProducto } = require('../helpers/seed');
const { getAuthToken } = require('../helpers/auth');
const { gerente } = require('../fixtures/users.fixture');
const { Venta, OrdenServicio, MovimientoInventario, GastoTaller } = require('../../src/models');
const { limaDay } = require('../../src/services/cash-ledger.service');

describe('Cobros unificados, resultado y comprobantes separados', () => {
  let user, token;
  beforeAll(async () => { await setupTestDb(); user = await createUser(gerente); token = getAuthToken(user); });
  it('conserva adelantos, separa producto/servicio y no duplica el cobro al finalizar', async () => {
    const day = limaDay(new Date());
    const product = await createProducto({ sku: 'CASH-001', stock: 5 });
    const sale = await Venta.create({ fecha: new Date(), total: 100, total_con_igv: 118, id_cajero: user.id_user, metodo_pago: 'tarjeta' });
    await MovimientoInventario.create({ producto_id: product.id_producto, tipo: 'venta', cantidad: -1, stock_anterior: 5, stock_nuevo: 4, costo_unitario: 60, referencia_tipo: 'venta', referencia_id: sale.venta_id, usuario_id: user.id_user });
    const order = await OrdenServicio.create({ tipo: 'servicio_tecnico', codigo: 'CASH-ST-001', cliente: 'Prueba', documento: '12345678', equipo: 'PC', detalle: 'Reparación', estado: 'listo', moneda: 'PEN', costo_repuestos: 0, costo_mano_obra: 41, fecha_ingreso: day, creado_por: user.id_user });
    const call = (url, data) => request(app).post(url).set('Authorization', `Bearer ${token}`).send(data);
    expect((await call(`/api/ordenes-servicio/${order.id_orden_servicio}/repuestos`, { id_producto: product.id_producto, cantidad: 1, precio_unitario: 59, costo_unitario: 30 })).statusCode).toBe(201);
    expect((await call(`/api/ordenes-servicio/${order.id_orden_servicio}/pagos`, { metodo: 'yape', monto: 40, referencia: 'TEST-001' })).statusCode).toBe(201);
    await order.reload(); expect(order.venta_id).toBeNull();
    expect((await call(`/api/ordenes-servicio/${order.id_orden_servicio}/pagos`, { metodo: 'efectivo', monto: 60 })).statusCode).toBe(201);
    await order.reload();
    const mirror = await Venta.findByPk(order.venta_id);
    expect(Number(mirror.total_con_igv)).toBe(59);
    expect((await request(app).put(`/api/ordenes-servicio/${order.id_orden_servicio}`).set('Authorization', `Bearer ${token}`).send({ ...order.toJSON(), estado: 'entregado' })).statusCode).toBe(200);
    await GastoTaller.bulkCreate([
      { fecha: day, categoria: 'mano_obra_tercerizada', descripcion: 'Técnico prueba', monto: 10, medio_pago: 'efectivo', orden_servicio_id: order.id_orden_servicio, registrado_por: user.id_user },
      { fecha: day, categoria: 'insumos', descripcion: 'Gasto general prueba', monto: 5, medio_pago: 'efectivo', registrado_por: user.id_user },
    ]);
    const result = await request(app).get(`/api/cierre-caja/resumen-diario?fecha=${day}`).set('Authorization', `Bearer ${token}`);
    expect(result.statusCode).toBe(200);
    expect(result.body).toMatchObject({ cobrado: 218, cobrado_ventas: 118, cobrado_taller: 100, efectivo_neto: 45, ingresos_productos: 177, ingresos_servicios: 41, costo_productos: 90, costo_servicios: 10, gastos_generales: 5, resultado_estimado: 113 });
    expect(result.body.por_metodo.yape.total).toBe(40);
    expect((await call(`/api/ordenes-servicio/${order.id_orden_servicio}/honorarios/referencia`, { referencia: 'E001-123' })).statusCode).toBe(200);
    await order.reload(); expect(order.estado_facturacion).toBe('pendiente_emision');
    const tomorrow = new Date(new Date(`${day}T00:00:00-05:00`).getTime() + 86400000).toISOString();
    const closing = await call('/api/cierre-caja', { fecha_apertura: `${day}T00:00:00-05:00`, fecha_cierre: tomorrow, cajero_id: user.id_user, saldo_efectivo: 45, estado: 'cerrado' });
    expect(closing.statusCode).toBe(201);
    expect(Number(closing.body.cierre.total_efectivo)).toBe(45);
    expect(Number(closing.body.cierre.total_yape)).toBe(40);
    expect(closing.body.cierre.cantidad_ventas).toBe(3);
    const mail = await call(`/api/ordenes-servicio/${order.id_orden_servicio}/ticket/correo`, {});
    expect(mail.statusCode).toBe(400); // No client email, no outbound mail.
  });
});
