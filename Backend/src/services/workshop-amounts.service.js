'use strict';
const { round } = require('./cash-ledger.service');

// Allocate a global discount proportionally, in cents. The last line absorbs rounding.
function workshopAmounts(order, parts) {
  const products = parts.reduce((sum, p) => sum + Number(p.precio_unitario) * Number(p.cantidad), 0);
  const labor = Number(order.costo_mano_obra || 0) + Number(order.recargo || 0);
  const discount = Number(order.descuento || 0);
  if (![products, labor, discount].every(Number.isFinite) || products < 0 || labor < 0 || discount < 0 || discount > products + labor)
    throw new Error('Importes de la orden inválidos');
  if (Math.abs(products - Number(order.costo_repuestos || 0)) > 0.01)
    throw new Error('El importe de repuestos no coincide con el detalle; revisa la orden');
  const total = round(products + labor - discount);
  const productTotal = products + labor ? round(total * products / (products + labor)) : 0;
  let allocated = 0;
  const lines = parts.map((part, index) => {
    const gross = index === parts.length - 1 ? round(productTotal - allocated) : round(productTotal * Number(part.precio_unitario) * Number(part.cantidad) / products);
    allocated = round(allocated + gross);
    return { part, gross, net: round(gross / 1.18) };
  });
  return { total, productTotal, serviceTotal: round(total - productTotal), lines };
}
module.exports = { workshopAmounts };
