const { sequelize, Venta, DetalleVenta, Producto, CodigoBarras, Company, PagoPos, AdquirentePos, User } = require('../models');
const { validatePaymentInput } = require('./pos.controller');
const { siguienteCorrelativo } = require('../services/correlativo.service');
const { aplicarMovimiento } = require('../services/stock.service');
const { Op } = require('sequelize');
const saleModelFor = req => req.user?.affiliate_business_id ? Venta.unscoped() : Venta;
const saleWhereFor = (req, extra = {}) => req.user?.affiliate_business_id
  ? { ...extra, affiliate_business_id: req.user.affiliate_business_id }
  : req.user?.id_role === 3 ? { ...extra, id_cajero: req.user.id_user, affiliate_business_id: null } : { ...extra, affiliate_business_id: null };

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#039;');

const ventaController = {
  create: async (req, res) => {
    // M5: idempotencia del POS — un reintento con la misma clave devuelve la venta ya creada
    const idempotencyKey = String(req.get('Idempotency-Key') || req.body?.idempotency_key || '').trim().slice(0, 64) || null;
    if (idempotencyKey) {
      const existente = await saleModelFor(req).findOne({ where: { idempotency_key: idempotencyKey } });
      if (existente) {
        return res.status(200).json({
          message: 'Venta ya registrada (reintento)',
          venta: {
            venta_id: existente.venta_id,
            fecha: existente.fecha,
            id_cajero: existente.id_cajero,
            metodo_pago: existente.metodo_pago,
            total: existente.total,
            total_con_igv: existente.total_con_igv
          },
          duplicada: true
        });
      }
    }
    const t = await sequelize.transaction();
    try {
      const { id_cajero, metodo_pago, observaciones, items, comprobante, es_descuento, descuento, fecha, pos_pago } = req.body;
      const cashierId = req.user.id_role === 3 ? req.user.id_user : Number(id_cajero);

      if (!Number.isInteger(cashierId) || cashierId <= 0) {
        await t.rollback();
        return res.status(400).json({ message: 'Cajero no valido' });
      }
      const seller = await User.findByPk(cashierId, { transaction: t });
      if (!seller) { await t.rollback(); return res.status(400).json({ message: 'Vendedor no válido' }); }

      let total = 0;
      let totalConIgv = 0;
      const detallesValidados = [];
      const productosMap = new Map();

      // Orden de bloqueo consistente entre ventas concurrentes (anti-deadlock)
      const itemsOrdenados = [...items].sort((a, b) => String(a.codigo_barras).localeCompare(String(b.codigo_barras)));
      for (const item of itemsOrdenados) {
        if (!item.codigo_barras) {
          await t.rollback();
          return res.status(400).json({
            message: `Cada item debe contener un código de barras válido`
          });
        }
        const cantidadDescontar = item.cantidad && parseInt(item.cantidad) > 0
          ? parseInt(item.cantidad)
          : 1;
        const codigoBarras = await CodigoBarras.findOne({
          where: {
            codigo_barras: item.codigo_barras,
          },
          include: [{
            model: Producto.unscoped(),
            as: 'producto'
          }],
          transaction: t
        });
        if (!codigoBarras) {
          await t.rollback();
          return res.status(400).json({
            message: `Código de barras "${item.codigo_barras}" inválido o no disponible`
          });
        }
        const producto = codigoBarras.producto;
        const sellerBusinessId = seller.tipo_vendedor === 'afiliado' ? Number(seller.affiliate_business_id || 0) : null;
        if ((sellerBusinessId && Number(producto.affiliate_business_id || 0) !== sellerBusinessId) || (!sellerBusinessId && producto.affiliate_business_id)) {
          await t.rollback();
          return res.status(403).json({ message: 'La mercadería pertenece a otro negocio' });
        }
        if (producto.stock < cantidadDescontar) {
          await t.rollback();
          return res.status(400).json({
            message: `Stock insuficiente para ${producto.nombre}. Solicitado: ${cantidadDescontar}, Disponible: ${producto.stock}`,
            stockActual: producto.stock
          });
        }
        // T3: el codigo de barras vuelve a ser solo identificador. Su columna
        // cantidad queda legada y ya no se lee ni se descuenta aqui: la fuente
        // unica de stock es productos.stock (stock.service.js, fase de detalle).

        if (!productosMap.has(producto.id_producto)) {
          productosMap.set(producto.id_producto, {
            producto: producto,
            cantidad: 0,
            codigos_barras: [],
            es_mayorista: false,
            precio_variable_con_igv: null // Agregar campo para precio variable
          });
        }
        const productoInfo = productosMap.get(producto.id_producto);
        productoInfo.cantidad += cantidadDescontar;
        productoInfo.codigos_barras.push({
          codigo: item.codigo_barras,
          cantidad: cantidadDescontar,
          es_mayorista: item.es_mayorista || false
        });
        if (item.es_mayorista) {
          productoInfo.es_mayorista = true;
        }
        // Si el item tiene precio variable, validar y almacenarlo (S9)
        if (item.precio_unitario_con_igv) {
          const pVariable = parseFloat(item.precio_unitario_con_igv);
          if (!Number.isFinite(pVariable) || pVariable <= 0) {
            await t.rollback();
            return res.status(400).json({ message: 'El precio variable debe ser un número positivo.' });
          }
          productoInfo.precio_variable_con_igv = pVariable;
        }
      }
      for (const [_producto_id, info] of productosMap.entries()) {
        const { producto, cantidad, codigos_barras, es_mayorista, precio_variable_con_igv } = info;
        let precioUnitario, precioUnitarioConIgv, esDescuento = false;
        
        // Si hay precio variable, usarlo directamente
        if (precio_variable_con_igv !== null) {
          precioUnitarioConIgv = precio_variable_con_igv;
          precioUnitario = parseFloat((precio_variable_con_igv / 1.18).toFixed(2));
        } else if (producto.es_oferta && producto.precio_oferta_con_igv) {
          precioUnitarioConIgv = parseFloat(producto.precio_oferta_con_igv);
          precioUnitario = parseFloat(producto.precio_oferta);
          esDescuento = true;
        } else {
          const cantidadMayorista = 10;
          const esMayoristaPorCantidad = cantidad >= cantidadMayorista && producto.precio_mayoritario !== null;
          const usarPrecioMayorista = (es_mayorista || esMayoristaPorCantidad) && producto.precio_mayoritario !== null;
          precioUnitario = usarPrecioMayorista ?
            producto.precio_mayoritario :
            producto.precio_unitario;
          precioUnitarioConIgv = usarPrecioMayorista ?
            producto.precio_mayoritario_con_igv :
            producto.precio_unitario_con_igv || (producto.precio_unitario * 1.18);
        }
        const subtotal = parseFloat(precioUnitario) * cantidad;
        const subtotalConIgv = parseFloat(precioUnitarioConIgv) * cantidad;
        total += subtotal;
        totalConIgv += subtotalConIgv;
        detallesValidados.push({
          producto_id: producto.id_producto,
          cantidad: cantidad,
          precio_unitario: precioUnitario,
          precio_unitario_con_igv: precioUnitarioConIgv,
          subtotal: subtotal,
          subtotal_con_igv: subtotalConIgv,
          producto: producto,
          codigos_barras: codigos_barras,
          es_venta_mayorista: es_mayorista,
          es_descuento: esDescuento
        });
      }
      const totalFinalCentimos = Math.round(Number(totalConIgv.toFixed(2)) * 100);
      const externalChannel = metodo_pago === 'tarjeta' ? 'pos' : ['yape', 'plin'].includes(metodo_pago) ? 'qr' : metodo_pago === 'pago_link' ? 'link' : null;
      const validatedPos = externalChannel ? await validatePaymentInput({ ...pos_pago, canal: externalChannel }, totalFinalCentimos, t) : null;
      // Crear la venta
      const ventaData = {
        fecha: fecha ? new Date(fecha.replace(' ', 'T') + '-05:00') : new Date(),
        total: parseFloat(total.toFixed(2)),
        total_con_igv: parseFloat(totalConIgv.toFixed(2)),
        id_cajero: cashierId,
        metodo_pago,
        observaciones: observaciones || null,
        es_descuento: es_descuento || false,
        descuento: es_descuento ? parseFloat(descuento) : null,
        tipo_documento: '0',
        serie: 'NV01',
        correlativo: await siguienteCorrelativo('POS:NV01', { transaction: t }),
        estado_comprobante: 'sin_emitir',
        idempotency_key: idempotencyKey
      };
      const affiliateFee = seller.id_role === 3 && seller.tipo_vendedor === 'afiliado' ? Number(seller.comision_servicio_porcentaje || 8) : 0;
      ventaData.tipo_vendedor_snapshot = seller.tipo_vendedor || (seller.id_role === 5 ? 'auditor' : null);
      ventaData.comision_porcentaje = affiliateFee;
      ventaData.comision_servicio = Number((totalConIgv * affiliateFee / 100).toFixed(2));
      ventaData.neto_vendedor = affiliateFee > 0 ? Number((totalConIgv - ventaData.comision_servicio).toFixed(2)) : 0;
      ventaData.affiliate_business_id = seller.tipo_vendedor === 'afiliado' ? seller.affiliate_business_id : null;
      // Si hay datos de comprobante, añadirlos a la venta PERO NO marcar como emitido
      if (comprobante) {
        // Validar datos del comprobante
        if (!comprobante.tipo_documento || !['0', '1', '3'].includes(comprobante.tipo_documento)) {
          await t.rollback();
          return res.status(400).json({ message: 'Tipo de documento inválido' });
        }
        if (comprobante.tipo_documento !== '0' && (!comprobante.cliente_tipo_documento || !['1', '6'].includes(comprobante.cliente_tipo_documento))) {
          await t.rollback();
          return res.status(400).json({ message: 'Tipo de documento del cliente inválido' });
        }
        if (comprobante.tipo_documento === '1' && comprobante.cliente_tipo_documento !== '6') {
          await t.rollback();
          return res.status(400).json({ message: 'Para facturas, el cliente debe tener RUC' });
        }
        if (comprobante.cliente_tipo_documento === '1' && comprobante.cliente_numero_documento.length !== 8) {
          await t.rollback();
          return res.status(400).json({ message: 'El DNI debe tener 8 dígitos' });
        } else if (comprobante.cliente_tipo_documento === '6' && comprobante.cliente_numero_documento.length !== 11) {
          await t.rollback();
          return res.status(400).json({ message: 'El RUC debe tener 11 dígitos' });
        }
        const serie = comprobante.tipo_documento === '1' ? 'F001' : comprobante.tipo_documento === '3' ? 'B001' : 'NV01';
        // Asignacion atomica: dos ventas concurrentes nunca reciben el mismo correlativo
        const correlativo = await siguienteCorrelativo(`POS:${serie}`, { transaction: t });
        ventaData.tipo_documento = comprobante.tipo_documento;
        ventaData.serie = serie;
        ventaData.correlativo = correlativo;
        ventaData.cliente_tipo_documento = comprobante.cliente_tipo_documento;
        ventaData.cliente_numero_documento = comprobante.cliente_numero_documento;
        ventaData.cliente_nombre = comprobante.cliente_nombre;
        ventaData.cliente_direccion = comprobante.cliente_direccion || null;
        ventaData.cliente_email = comprobante.cliente_email || null;
        // CAMBIO IMPORTANTE: NO marcar automáticamente como emitido
        ventaData.comprobante_emitido = false;
        ventaData.estado_comprobante = comprobante.tipo_documento === '0' ? 'sin_emitir' : 'pendiente';
      }
      const venta = await Venta.create(ventaData, { transaction: t });
      if (validatedPos) {
        await PagoPos.create({
          venta_id: venta.venta_id,
          id_adquirente: validatedPos.adquirente.id_adquirente,
          canal: validatedPos.canal,
          numero_operacion: validatedPos.numero_operacion,
          monto_centimos: validatedPos.monto_centimos,
          registrado_por: req.user.id_user,
          ultimos_cuatro: /^\d{4}$/.test(String(pos_pago.ultimos_cuatro || '')) ? String(pos_pago.ultimos_cuatro) : null,
          marca_tarjeta: String(pos_pago.marca_tarjeta || '').trim().slice(0, 30) || null,
        }, { transaction: t });
      }
      const detallesCreados = [];
      for (const detalle of detallesValidados) {
        const detalleCreado = await DetalleVenta.create({
          venta_id: venta.venta_id,
          producto_id: detalle.producto_id,
          cantidad: detalle.cantidad,
          es_venta_mayorista: detalle.es_venta_mayorista,
          precio_unitario: detalle.precio_unitario,
          precio_unitario_con_igv: detalle.precio_unitario_con_igv,
          subtotal: detalle.subtotal,
          subtotal_con_igv: detalle.subtotal_con_igv,
          condicion: detalle.producto.condicion || 'nuevo',
          garantia_meses: detalle.producto.garantia_meses ?? (detalle.producto.condicion === 'segunda_mano' ? 3 : 12),
          estado_observaciones: detalle.producto.estado_observaciones || null,
          codigos_barras: JSON.stringify(detalle.codigos_barras),
          es_descuento: detalle.es_descuento
        }, { transaction: t });
        detallesCreados.push(detalleCreado);
        const producto = detalle.producto;
        // Fuente unica de stock: UPDATE guardado atomico + kardex, mismo patron
        // para todas las entradas/salidas (stock.service.js).
        let movimiento;
        try {
          movimiento = await aplicarMovimiento({
            productoId: producto.id_producto,
            delta: -detalle.cantidad,
            tipo: 'venta',
            referenciaTipo: 'venta',
            referenciaId: venta.venta_id,
            motivo: `Venta ${venta.serie}-${String(venta.correlativo).padStart(8, '0')}`,
            usuarioId: req.user.id_user,
            affiliateBusinessId: venta.affiliate_business_id || null,
            costoUnitario: producto.costo_promedio || null,
            transaction: t
          });
        } catch (error) {
          if (error.status !== 400) throw error;
          await t.rollback();
          return res.status(400).json({
            message: `Stock insuficiente para ${producto.nombre}. Solicitado: ${detalle.cantidad}, Disponible: ${error.stockActual}`,
            stockActual: error.stockActual
          });
        }
        producto.stock = movimiento.stockNuevo;
      }
      await t.commit();
      const ventaJSON = {
        venta_id: venta.venta_id,
        fecha: venta.fecha,
        id_cajero: venta.id_cajero,
        metodo_pago: venta.metodo_pago,
        observaciones: venta.observaciones,
        total: venta.total,
        total_con_igv: venta.total_con_igv,
        es_descuento: detallesValidados.some(d => d.es_descuento),
        descuento: detallesValidados.find(d => d.es_descuento)?.producto?.oferta?.descuento || null
      };
      const respuesta = {
        message: 'Venta creada exitosamente',
        venta: ventaJSON
      };
      if (comprobante) {
        respuesta.comprobante = {
          venta_id: venta.venta_id,
          tipo_documento: venta.tipo_documento,
          serie: venta.serie,
          correlativo: venta.correlativo,
          numero_completo: `${venta.serie}-${venta.correlativo.toString().padStart(8, '0')}`,
          cliente: {
            tipo_documento: venta.cliente_tipo_documento,
            numero_documento: venta.cliente_numero_documento,
            nombre: venta.cliente_nombre
          },
          total: venta.total,
          total_con_igv: venta.total_con_igv,
          detalles: detallesCreados.map(detalle => ({
            producto_id: detalle.producto_id,
            cantidad: detalle.cantidad,
            precio_unitario: detalle.precio_unitario,
            precio_unitario_con_igv: detalle.precio_unitario_con_igv,
            subtotal: detalle.subtotal,
            subtotal_con_igv: detalle.subtotal_con_igv,
            es_venta_mayorista: detalle.es_venta_mayorista,
            es_descuento: detalle.es_descuento
          }))
        };
      }
      return res.status(201).json(respuesta);
    } catch (error) {
      await t.rollback();
      // M5: carrera de reintentos — la otra peticion gano; devolver la venta existente
      if (idempotencyKey && error.name === 'SequelizeUniqueConstraintError') {
        const existente = await saleModelFor(req).findOne({ where: { idempotency_key: idempotencyKey } });
        if (existente) {
          return res.status(200).json({
            message: 'Venta ya registrada (reintento)',
            venta: {
              venta_id: existente.venta_id,
              fecha: existente.fecha,
              id_cajero: existente.id_cajero,
              metodo_pago: existente.metodo_pago,
              total: existente.total,
              total_con_igv: existente.total_con_igv
            },
            duplicada: true
          });
        }
      }
      console.error('Error al crear la venta:', error);
      return res.status(error.status || (error.name === 'SequelizeUniqueConstraintError' ? 409 : 500)).json({
        message: 'Error al crear la venta',
        error: error.name === 'SequelizeUniqueConstraintError' ? 'Ese numero de operacion POS ya fue registrado' : error.message
      });
    }
  },

  // Nuevo método para actualizar el estado del comprobante
  updateComprobanteStatus: async (req, res) => {
    const t = await sequelize.transaction();
    try {
      const { venta_id } = req.params;
      const { comprobante_emitido } = req.body;
      // Buscar la venta
      const venta = await Venta.findByPk(venta_id, { transaction: t });
      if (!venta) {
        await t.rollback();
        return res.status(404).json({ message: "Venta no encontrada" });
      }
      // Actualizar solo el estado del comprobante
      await venta.update(
        {
          comprobante_emitido: comprobante_emitido,
        },
        { transaction: t },
      );
      await t.commit();
      return res.status(200).json({
        message: "Estado del comprobante actualizado correctamente",
        venta_id: venta.venta_id,
        comprobante_emitido: comprobante_emitido,
      });
    } catch (error) {
      await t.rollback();
      console.error("Error al actualizar estado del comprobante:", error);
      return res.status(500).json({
        message: "Error al actualizar estado del comprobante",
        error: error.message,
      });
    }
  },

  // Obtener todas las ventas
  getAll: async (req, res) => {
    try {
      const saleModel = req.user.tipo_vendedor === 'afiliado' ? Venta.unscoped() : Venta;
      const ventas = await saleModel.findAll({
        where: req.user.tipo_vendedor === 'afiliado' ? { affiliate_business_id: req.user.affiliate_business_id } : req.user.id_role === 3 ? { id_cajero: req.user.id_user } : undefined,
        include: [{ model: PagoPos, as: 'pago_pos', required: false, include: [{ model: AdquirentePos, as: 'adquirente', attributes: ['id_adquirente', 'nombre', 'marca'] }] }],
        order: [['fecha', 'DESC']]
      });

      return res.status(200).json(ventas);
    } catch (error) {
      console.error('Error al obtener ventas:', error);
      return res.status(500).json({
        message: 'Error al obtener ventas',
        error: error.message
      });
    }
  },

  // Obtener una venta por ID
  getById: async (req, res) => {
    try {
      const { id } = req.params;

      const venta = await saleModelFor(req).findOne({ where: saleWhereFor(req, { venta_id: id }),
        include: [{
          model: DetalleVenta, as: 'detalles', include: { model: Producto, as: 'producto', attributes: ['id_producto', 'nombre', 'sku'] }
        }, { model: PagoPos, as: 'pago_pos', required: false, include: [{ model: AdquirentePos, as: 'adquirente', attributes: ['id_adquirente', 'nombre', 'marca'] }] }]
      });

      if (!venta) {
        return res.status(404).json({ message: 'Venta no encontrada' });
      }

      if (req.user.id_role === 3 && Number(venta.id_cajero) !== Number(req.user.id_user)) {
        return res.status(403).json({ message: 'Acceso denegado' });
      }

      return res.status(200).json(venta);
    } catch (error) {
      console.error('Error al obtener la venta:', error);
      return res.status(500).json({
        message: 'Error al obtener la venta',
        error: error.message
      });
    }
  },


  // Obtener ventas por cajero
  getByCajero: async (req, res) => {
    try {
      const { id_cajero } = req.params;

      if (req.user.id_role === 3 && Number(id_cajero) !== Number(req.user.id_user)) {
        return res.status(403).json({ message: 'Acceso denegado' });
      }

      const ventas = await saleModelFor(req).findAll({
        where: saleWhereFor(req, { id_cajero: req.user.id_role === 3 ? req.user.id_user : id_cajero }),
        order: [['fecha', 'DESC']]
      });

      return res.status(200).json(ventas);
    } catch (error) {
      console.error('Error al obtener ventas por cajero:', error);
      return res.status(500).json({
        message: 'Error al obtener ventas por cajero',
        error: error.message
      });
    }
  },

  // Obtener ventas por fecha
  getByDate: async (req, res) => {
    try {
      const { fecha } = req.params;
      const ventas = await saleModelFor(req).findAll({
        where: saleWhereFor(req, {
          [Op.and]: [
            sequelize.where(sequelize.fn('DATE', sequelize.col('fecha')), fecha),
            ...(req.user.id_role === 3 ? [{ id_cajero: req.user.id_user }] : []),
          ],
        }),
        order: [['fecha', 'DESC']]
      });

      return res.status(200).json(ventas);
    } catch (error) {
      console.error('Error al obtener ventas por fecha:', error);
      return res.status(500).json({
        message: 'Error al obtener ventas por fecha',
        error: error.message
      });
    }
  },

  // Obtener ventas por rango de fechas
  getByDateRange: async (req, res) => {
    try {
      const { fechaInicio, fechaFin } = req.query;


      if (!fechaInicio || !fechaFin) {
        return res.status(400).json({
          message: 'Debe proporcionar fechaInicio y fechaFin'
        });
      }

      // Usamos una consulta más directa
      const ventas = await saleModelFor(req).findAll({
        where: saleWhereFor(req),
      });


      // Filtramos manualmente para aislar problemas de consulta SQL
      const ventasFiltradas = ventas.filter(venta => {
        const fechaVenta = new Date(venta.fecha).toISOString().split('T')[0];
        return fechaVenta >= fechaInicio && fechaVenta <= fechaFin;
      });


      return res.status(200).json(ventasFiltradas);
    } catch (error) {
      console.error('Error:', error);
      return res.status(500).json({
        message: 'Error al obtener ventas',
        error: error.message
      });
    }
  },
  // Método para generar un comprobante (factura/boleta)
  generateComprobante: async (req, res) => {
    const t = await sequelize.transaction();

    try {
      const { venta_id } = req.params;
      const {
        tipo_documento,
        cliente_tipo_documento,
        cliente_numero_documento,
        cliente_nombre,
        // Eliminar cliente_direccion y cliente_email de los parámetros recibidos
      } = req.body;

      // Buscar la venta
      const venta = await Venta.findByPk(venta_id, {
        transaction: t,
        include: [{
          model: DetalleVenta,
          as: 'detalles',
          include: [{
            model: Producto,
            as: 'producto'
          }]
        }]
      });

      if (!venta) {
        await t.rollback();
        return res.status(404).json({ message: 'Venta no encontrada' });
      }

      // Verificar si ya tiene comprobante
      if (venta.comprobante_emitido) {
        await t.rollback();
        return res.status(400).json({
          message: 'Esta venta ya tiene un comprobante emitido',
          tipo_documento: venta.tipo_documento,
          serie: venta.serie,
          correlativo: venta.correlativo
        });
      }

      // Generar serie según tipo de documento
      const serie = tipo_documento === '1' ? 'F001' : 'B001';

      // Obtener el último correlativo para esta serie
      const ultimaVenta = await Venta.findOne({
        where: {
          serie,
          correlativo: { [Op.ne]: null }
        },
        order: [['correlativo', 'DESC']],
        transaction: t
      });

      // Incrementar correlativo
      const correlativo = ultimaVenta ? ultimaVenta.correlativo + 1 : 1;

      // Actualizar la venta con los datos del comprobante
      await venta.update({
        tipo_documento,
        serie,
        correlativo,
        cliente_tipo_documento,
        cliente_numero_documento,
        cliente_nombre,
        comprobante_emitido: true
      }, { transaction: t });

      await t.commit();

      // Usar una estructura más organizada para la respuesta
      return res.status(200).json({
        message: 'Comprobante generado correctamente',
        comprobante: {
          venta_id: venta.venta_id,
          tipo_documento,
          serie,
          correlativo,
          numero_completo: `${serie}-${correlativo.toString().padStart(8, '0')}`,
          cliente: {
            tipo_documento: cliente_tipo_documento,
            numero_documento: cliente_numero_documento,
            nombre: cliente_nombre
          },
          total: venta.total,
          total_con_igv: venta.total_con_igv,
          detalles: venta.detalles.map(detalle => ({
            producto_id: detalle.producto_id,
            cantidad: detalle.cantidad,
            precio_unitario: detalle.precio_unitario,
            precio_unitario_con_igv: detalle.precio_unitario_con_igv,
            subtotal: detalle.subtotal,
            subtotal_con_igv: detalle.subtotal_con_igv,
            es_venta_mayorista: detalle.es_venta_mayorista
          }))
        }
      });

    } catch (error) {
      await t.rollback();
      console.error('Error al generar comprobante:', error);
      return res.status(500).json({
        message: 'Error al generar comprobante',
        error: error.message
      });
    }
  },

  // Obtener comprobantes por cliente
  getComprobantesByCliente: async (req, res) => {
    try {
      const { documento } = req.params;

      const comprobantes = await Venta.findAll({
        where: {
          cliente_numero_documento: documento,
          comprobante_emitido: true
        },
        order: [['fecha', 'DESC']]
      });

      return res.status(200).json(comprobantes);
    } catch (error) {
      console.error('Error al obtener comprobantes por cliente:', error);
      return res.status(500).json({
        message: 'Error al obtener comprobantes por cliente',
        error: error.message
      });
    }
  },

  getLastCorrelativo: async (req, res) => {
    try {
      const { tipoDocumento } = req.params;

      // Validar el tipo de documento
      if (!tipoDocumento || !['1', '3'].includes(tipoDocumento)) {
        return res.status(400).json({
          message: 'Tipo de documento inválido. Debe ser 1 (Factura) o 3 (Boleta)'
        });
      }

      // Determinar la serie según el tipo de documento
      const serie = tipoDocumento === '1' ? 'F001' : 'B001';

      // Buscar la última venta con esta serie
      const ultimaVenta = await Venta.findOne({
        where: {
          serie,
          correlativo: { [Op.ne]: null }
        },
        order: [['correlativo', 'DESC']]
      });

      // Si existe, devolver el correlativo + 1 (próximo a usar)
      // Si no existe, devolver 1 (primer documento de la serie)
      const correlativo = ultimaVenta ? ultimaVenta.correlativo : 1;

      return res.status(200).json({
        correlativo,
        serie,
        tipo_documento: tipoDocumento
      });

    } catch (error) {
      console.error('Error al obtener último correlativo:', error);
      return res.status(500).json({
        message: 'Error al obtener último correlativo',
        error: error.message
      });
    }
  },
  
  // Generar ticket de venta (no comprobante fiscal)
  generateTicketVenta: async (req, res) => {
    try {
      const { venta_id } = req.params;

      // Buscar la venta con sus detalles
      const venta = await Venta.findByPk(venta_id, {
        include: [{
          model: DetalleVenta,
          as: 'detalles',
          include: [{
            model: Producto,
            as: 'producto'
          }]
        }]
      });

      if (!venta) {
        return res.status(404).json({
          message: 'Venta no encontrada'
        });
      }

      // Obtener datos de la empresa desde la base de datos
      const empresa = await Company.findOne({
        order: [['id_company', 'ASC']]
      });

      if (!empresa) {
        return res.status(404).json({
          message: 'No se encontró información de la empresa'
        });
      }

      // Calcular totales
      const subtotal = parseFloat(venta.total);
      const igv = parseFloat(venta.total_con_igv) - parseFloat(venta.total);
      const total = parseFloat(venta.total_con_igv);

      // Formatear fecha
      const fechaFormateada = new Date(venta.fecha).toLocaleString('es-PE', {
        timeZone: 'America/Lima',
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit'
      });

      // Generar HTML del ticket con la misma configuración exacta de ticket.html.twig
      const ticketHtml = `
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <!-- Forzar tamaño de página y márgenes -->
  <style>
  /* RESET COMPLETO PARA IMPRESORAS TÉRMICAS */
  @page {
    size: 80mm auto;
    margin: 0 !important;
    padding: 0 !important;
  }

  /* ESTILOS PRINCIPALES CON MÁRGEN AUMENTADO IZQUIERDO */
  body {
    width: 76mm !important;       /* Reducción de 4mm para margen físico */
    max-width: 76mm !important;
    margin: 0 0 0 6mm !important; /* Aumentamos compensación izquierda a 6mm */
    padding: 1mm 2mm 1mm 0 !important;
    font-family: 'Courier New', monospace !important;
    font-size: 11px !important;
    line-height: 1.15 !important;
    -webkit-print-color-adjust: exact !important;
    color-adjust: exact !important;
    box-sizing: border-box !important;
    overflow: hidden !important;
    position: relative;
    left: 2mm !important;       /* Aumentamos ajuste fino */
  }

  /* CLASES UTILITARIAS */
  .center { 
    text-align: center !important;
    padding-left: 0 !important;
  }
  .right { 
    text-align: right !important;
    padding-right: 1mm !important;
  }
  .bold { 
    font-weight: bold !important; 
  }
  .dashed { 
    border-top: 1px dashed #000 !important;
    margin: 3px 0 !important;
  }

  /* TABLAS PRINCIPALES */
  table {
    width: 72mm !important;       /* 76mm - 4mm compensación */
    max-width: 72mm !important;
    margin-left: -1.5mm !important; /* Mayor compensación */
    border-collapse: collapse !important;
    table-layout: fixed !important;
  }

  td {
    padding: 2px 0 2px 2.5mm !important; /* Sangría izquierda aumentada */
    vertical-align: top !important;
    word-break: break-word !important;
  }

  /* CABECERA */
  .header img {
    max-height: 45px !important;
    display: block !important;
    margin: 0 auto 3px auto !important;
  }

  /* TABLA DE DETALLES CON MÁRGEN EXTRA */
  .detalle-table {
    width: 72mm !important;
    margin-left: -1mm !important;
  }

  .detalle-table thead td {
    padding-bottom: 3px !important;
  }

  /* COLUMNAS CON PROTECCIÓN EXTRA IZQUIERDA */
  .col-cant {
    width: 14% !important;
    text-align: left !important;
    padding-left: 3.5mm !important; /* Aumentamos protección izquierda */
    min-width: 10mm !important;
  }

  .col-desc {
    width: 56% !important;
    text-align: left !important;
    padding-left: 1.5mm !important;
    hyphens: auto !important;
  }

  .col-total {
    width: 20% !important;
    text-align: right !important;
    padding-right: 1mm !important;
  }

  /* QR AJUSTADO */
  .qr {
    width: 68mm !important;
    margin: 5px auto !important;
  }

  .qr img {
    width: 70px !important;
    height: 70px !important;
    display: block !important;
    margin: 0 auto !important;
  }

  /* PIE DE PÁGINA */
  .footer-note {
    font-size: 9px !important;
    margin-top: 3px !important;
    padding-left: 0 !important;
  }

  /* MEDIA PRINT (AJUSTES FINALES CON MÁRGEN EXTRA) */
  @media print {
    body {
      width: 76mm !important;
      margin-left: 8mm !important; /* MÁRGEN IZQUIERDO AUMENTADO A 8mm */
      padding-right: 1mm !important;
      left: 0 !important;
    }

    table, .detalle-table {
      width: 70mm !important;     /* Reducción final para impresión */
      margin-left: 0 !important;
    }

    .col-cant {
      padding-left: 4mm !important; /* Máxima protección izquierda */
    }

    /* FUERZA SALTO DE LÍNEA EN DESCRIPCIONES */
    .col-desc {
      overflow-wrap: anywhere !important;
      hyphens: manual !important;
    }

    /* GARANTIZAR VISIBILIDAD DE BORDES */
    td {
      padding-left: 3mm !important; /* Aumentamos padding izquierdo */
    }
  }
</style>
</head>
<body>
  <!-- HEADER -->
  <table class="header">
    <tr><td class="center bold">${empresa.razon_social.toUpperCase()}</td></tr>
    <tr><td class="center">RUC ${empresa.ruc}</td></tr>
    <tr><td class="center">${empresa.direccion}</td></tr>
    ${empresa.ubigeo ? `<tr><td class="center">${empresa.ubigeo}</td></tr>` : ''}
  </table>

  <div class="dashed"></div>

  <!-- DATOS DEL DOCUMENTO -->
  <table>
    <tr><td class="center bold">NOTA DE VENTA INTERNA</td></tr>
    <tr><td class="center bold"># ${String(venta.venta_id).padStart(8, '0')}</td></tr>
    <tr><td class="dashed"></td></tr>
    <tr><td><strong>Fecha:</strong> ${fechaFormateada}</td></tr>
    <tr><td><strong>Método:</strong> ${venta.metodo_pago}</td></tr>
    ${venta.observaciones ? `<tr><td><strong>Observaciones:</strong> ${venta.observaciones}</td></tr>` : ''}
  </table>

  <div class="dashed"></div>

  <!-- DETALLE CON ESPACIADO MEJORADO -->
  <table class="detalle-table">
    <thead>
      <tr>
        <td class="bold col-cant">Cant</td>
        <td class="bold col-desc">Descripción</td>
        <td class="bold col-total">Total</td>
      </tr>
    </thead>
    <tbody>
      ${venta.detalles.map(detalle => `
      <tr>
        <td class="col-cant">${detalle.cantidad}</td>
        <td class="col-desc">${escapeHtml(detalle.producto?.nombre || `Producto #${detalle.producto_id}`)}<br><small>${detalle.condicion === 'segunda_mano' ? 'SEGUNDA MANO' : 'NUEVO'} · Garantía: ${detalle.garantia_meses} mes(es)${detalle.estado_observaciones ? `<br>Estado informado: ${escapeHtml(detalle.estado_observaciones)}` : ''}</small></td>
        <td class="col-total">${parseFloat(detalle.subtotal_con_igv).toFixed(2)}</td>
      </tr>
      `).join('')}
    </tbody>
  </table>

  <div class="dashed"></div>

  <!-- TOTALES -->
  <table>
    <tr>
      <td>Subtotal:</td>
      <td class="right">${subtotal.toFixed(2)}</td>
    </tr>
    <tr>
      <td>IGV:</td>
      <td class="right">${igv.toFixed(2)}</td>
    </tr>
    ${venta.descuento && venta.descuento > 0 ? `
    <tr>
      <td>Descuento:</td>
      <td class="right">-${parseFloat(venta.descuento).toFixed(2)}</td>
    </tr>
    ` : ''}
    <tr>
      <td class="bold">Importe Total</td>
      <td class="bold right">${total.toFixed(2)}</td>
    </tr>
  </table>

  <div class="dashed"></div>

  <!-- PIE -->
  <table class="footer">
    <tr>
      <td class="center">*** NOTA DE VENTA INTERNA ***</td>
    </tr>
    <tr>
      <td class="center">No válido como comprobante de pago</td>
    </tr>
    <tr><td class="footer-note center">Garantía comercial según cada producto y desde la fecha de entrega. No cubre daños posteriores por golpes, líquidos, manipulación no autorizada, uso contrario a especificaciones o desgaste normal. Estas condiciones no limitan las garantías legales ni los derechos reconocidos al consumidor.</td></tr>
    <tr>
      <td class="center">Generado por Criscom Group</td>
    </tr>
  </table>

  <div class="dashed"></div>
  <p class="center bold">¡Gracias por su compra!</p>

</body>
</html>`;

      return res.status(200).json({
        message: 'Ticket de venta generado correctamente',
        html: ticketHtml,
        data: {
          venta_id: venta.venta_id,
          fecha: fechaFormateada,
          empresa: {
            razon_social: empresa.razon_social,
            ruc: empresa.ruc,
            direccion: empresa.direccion
          },
          totales: {
            subtotal: subtotal.toFixed(2),
            igv: igv.toFixed(2),
            total: total.toFixed(2),
            descuento: venta.descuento || 0
          }
        }
      });

    } catch (error) {
      console.error('Error al generar ticket de venta:', error);
      return res.status(500).json({
        message: 'Error al generar ticket de venta',
        error: error.message
      });
    }
  },

  // Eliminar una venta (solo para gerentes y solo ventas simples)
  delete: async (req, res) => {
    const t = await sequelize.transaction();

    try {
      const { id } = req.params;

      // Verificar que el usuario sea gerente (rol 1)
      if (!req.user || req.user.id_role !== 1) {
        await t.rollback();
        return res.status(403).json({
          message: 'Solo los gerentes pueden eliminar ventas'
        });
      }

      // Buscar la venta con sus detalles (bloqueada: nadie la modifica mientras se anula)
      const venta = await Venta.findByPk(id, {
        include: [{
          model: DetalleVenta,
          as: 'detalles',
          include: [{
            model: Producto,
            as: 'producto'
          }]
        }],
        transaction: t,
        lock: t.LOCK.UPDATE
      });

      if (!venta) {
        await t.rollback();
        return res.status(404).json({ message: 'Venta no encontrada' });
      }

      if (venta.orden_servicio_id) {
        await t.rollback();
        return res.status(400).json({ message: 'Esta venta pertenece a una orden de taller; no se puede eliminar desde ventas' });
      }
      // Solo se bloquea lo que SUNAT ya conoce: comprobante emitido o documento electronico creado.
      // (Antes bastaba tipo_documento='0' --truthy-- y NINGUNA venta del POS se podia anular.)
      if (venta.comprobante_emitido) {
        await t.rollback();
        return res.status(400).json({
          message: 'No se puede eliminar: el comprobante ya fue emitido a SUNAT'
        });
      }
      const { DocumentoElectronico } = require('../models');
      const docElectronico = await DocumentoElectronico.findOne({ where: { venta_id: venta.venta_id }, transaction: t });
      if (docElectronico) {
        await t.rollback();
        return res.status(400).json({
          message: 'No se puede eliminar: la venta ya tiene un documento electrónico iniciado'
        });
      }

      // Restaurar stock por la fuente unica, con asiento de reversa en el kardex.
      // Las lineas de servicio (sin producto_id) no mueven stock: se omiten.
      for (const detalle of venta.detalles) {
        const producto = detalle.producto;
        if (!producto) continue;
        await aplicarMovimiento({
          productoId: producto.id_producto,
          delta: detalle.cantidad,
          tipo: 'ajuste_entrada',
          referenciaTipo: 'anulacion_venta',
          referenciaId: venta.venta_id,
          motivo: `Anulación venta ${venta.serie || 'NV'}-${String(venta.correlativo || venta.venta_id).padStart(8, '0')}`,
          usuarioId: req.user.id_user,
          affiliateBusinessId: venta.affiliate_business_id || null,
          costoUnitario: producto.costo_promedio || null,
          transaction: t
        });
      }

      // codigos_barras.cantidad es legada (T3): no se restaura ni se recrea nada.

      // Pagos POS ligados a la venta: se eliminan con ella (sin huerfanos)
      await PagoPos.destroy({ where: { venta_id: venta.venta_id }, transaction: t });

      // Eliminar detalles de venta
      await DetalleVenta.destroy({
        where: { venta_id: id },
        transaction: t
      });

      // Eliminar la venta
      await venta.destroy({ transaction: t });

      await t.commit();

      return res.status(200).json({
        message: 'Venta eliminada exitosamente',
        venta_eliminada: {
          id: venta.venta_id,
          fecha: venta.fecha,
          total: venta.total_con_igv,
          metodo_pago: venta.metodo_pago
        }
      });

    } catch (error) {
      await t.rollback();
      console.error('Error al eliminar venta:', error);
      return res.status(500).json({
        message: 'Error al eliminar venta',
        error: error.message
      });
    }
  }

};

module.exports = ventaController;
