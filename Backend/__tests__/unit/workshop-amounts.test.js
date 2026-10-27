const { workshopAmounts } = require('../../src/services/workshop-amounts.service');
test('el descuento se reparte y los productos no incluyen mano de obra', () => {
  const result = workshopAmounts({ costo_repuestos: 200, costo_mano_obra: 80, descuento: 28 }, [{ cantidad: 2, precio_unitario: 100 }]);
  expect(result).toMatchObject({ total: 252, productTotal: 180, serviceTotal: 72 });
  expect(result.lines[0].gross).toBe(180);
});
test('los redondeos conservan el total y detectan un detalle inconsistente', () => {
  const result = workshopAmounts({ costo_repuestos: 3, costo_mano_obra: 1, descuento: .01 }, Array.from({ length: 3 }, () => ({ cantidad: 1, precio_unitario: 1 })));
  expect(result.lines.reduce((s, l) => s + l.gross, 0)).toBeCloseTo(result.productTotal, 2);
  expect(result.productTotal + result.serviceTotal).toBeCloseTo(result.total, 2);
  expect(() => workshopAmounts({ costo_repuestos: 5 }, [])).toThrow(/no coincide/);
});
