const { summarizeReceipts, method } = require('../../src/services/cash-ledger.service');

describe('Una sola fuente de cobros', () => {
  it('cuenta los adelantos y no vuelve a contar la venta del taller', () => {
    const result = summarizeReceipts([
      { total_con_igv: 118, metodo_pago: 'tarjeta' },
      { total_con_igv: 500, metodo_pago: 'efectivo+pos', origen_tipo: 'orden_servicio', orden_servicio_id: 1 },
    ], [
      { monto: 100, moneda: 'PEN', estado: 'confirmado', metodo: 'efectivo' },
      { monto: 150, moneda: 'PEN', estado: 'confirmado', metodo: 'pos' },
      { monto: 50, moneda: 'PEN', estado: 'anulado', metodo: 'efectivo' },
      { monto: 60, moneda: 'USD', estado: 'confirmado', metodo: 'efectivo' },
    ]);
    expect(result.cobrado).toBe(368);
    expect(result.por_metodo.efectivo.total).toBe(100);
    expect(result.por_metodo.tarjeta.total).toBe(268);
  });
  it('no transforma QR histórico ni métodos desconocidos en efectivo', () => {
    expect(method('qr')).toBe('qr');
    expect(method('pago_link')).toBe('pago_link');
    expect(method('efectivo+pos')).toBe('otro');
    expect(method('yape')).toBe('yape');
  });
});
