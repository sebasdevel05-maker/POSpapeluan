const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');
const { generateInvoicePDF } = require('../invoice');
const { generateReceipt } = require('../receipt');
const { printRaw } = require('../printer');

// POST /api/sales - Create a new sale
router.post('/', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const { customer_name, items, payment_method, discount_percent } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  const validMethods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi'];
  const method = validMethods.includes(payment_method) ? payment_method : 'Efectivo';
  const discount = Math.max(0, Math.min(100, parseFloat(discount_percent) || 0));

  // Generate invoice number
  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const localTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const localTimestamp = `${localDate} ${localTime}`;
  const dateStr = localDate.replace(/-/g, '');

  const lastSale = db.prepare(
    "SELECT invoice_number FROM sales WHERE invoice_number LIKE ? ORDER BY id DESC LIMIT 1"
  ).get(`FAC-${dateStr}-%`);

  let seq = 1;
  if (lastSale) {
    seq = parseInt(lastSale.invoice_number.split('-')[2]) + 1;
  }
  const invoiceNumber = `FAC-${dateStr}-${String(seq).padStart(4, '0')}`;

  // Validate stock and calculate totals
  const saleItems = [];
  let subtotal = 0;

  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (!product) {
      return res.status(400).json({ error: `Producto ID ${item.product_id} no encontrado` });
    }
    if (product.stock < item.quantity) {
      return res.status(400).json({
        error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}, Solicitado: ${item.quantity}`
      });
    }
    const itemSubtotal = product.sale_price * item.quantity;
    saleItems.push({
      product_id: product.id,
      product_name: product.name,
      barcode: product.barcode,
      quantity: item.quantity,
      unit_price: product.sale_price,
      subtotal: itemSubtotal
    });
    subtotal += itemSubtotal;
  }

  const discountAmount = subtotal * (discount / 100);
  const total = subtotal - discountAmount;

  const insertSale = db.transaction(() => {
    const saleResult = db.prepare(`
      INSERT INTO sales (invoice_number, customer_name, seller_id, seller_name, subtotal, total, payment_method, discount_percent, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(invoiceNumber, customer_name || 'Cliente General', req.user.id, req.user.name, subtotal, total, method, discount, localTimestamp);

    const saleId = saleResult.lastInsertRowid;

    for (const item of saleItems) {
      db.prepare(`
        INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, subtotal)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(saleId, item.product_id, item.product_name, item.barcode, item.quantity, item.unit_price, item.subtotal);

      db.prepare('UPDATE products SET stock = stock - ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
        .run(item.quantity, item.product_id);

      db.prepare(`
        INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
        VALUES (?, ?, 'salida', ?, ?, ?, ?)
      `).run(item.product_id, item.product_name, -item.quantity, `Venta ${invoiceNumber}`, req.user.id, req.user.name);
    }

    return saleId;
  });

  try {
    const saleId = insertSale();

    req.app.locals.io.emit('inventory-updated');
    req.app.locals.io.emit('new-sale', { saleId, invoiceNumber, total });

    const saleData = {
      id: saleId,
      invoice_number: invoiceNumber,
      customer_name: customer_name || 'Cliente General',
      seller_name: req.user.name,
      items: saleItems,
      subtotal,
      discount_percent: discount,
      total,
      payment_method: method,
      created_at: localTimestamp
    };

    // Auto-print receipt (fire and forget)
    try {
      const receipt = generateReceipt(saleData);
      printRaw(receipt).catch(err => console.error('Error imprimiendo recibo:', err.message));
    } catch (err) {
      console.error('Error generando recibo:', err.message);
    }

    res.status(201).json(saleData);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales - List sales
router.get('/', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  let sales;
  if (req.user.role === 'admin') {
    sales = db.prepare('SELECT * FROM sales ORDER BY created_at DESC LIMIT 200').all();
  } else {
    sales = db.prepare('SELECT * FROM sales WHERE seller_id = ? ORDER BY created_at DESC LIMIT 50').all(req.user.id);
  }
  res.json(sales);
});

// GET /api/sales/:id - Sale detail
router.get('/:id', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(parseInt(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);
  res.json({ ...sale, items });
});

// GET /api/sales/:id/invoice - Download PDF invoice
router.get('/:id/invoice', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(parseInt(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename=factura_${sale.invoice_number}.pdf`);

  generateInvoicePDF({ ...sale, items }, res);
});

// POST /api/sales/:id/print - Print receipt on thermal printer
router.post('/:id/print', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const sale = db.prepare('SELECT * FROM sales WHERE id = ?').get(parseInt(req.params.id));
  if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
  const items = db.prepare('SELECT * FROM sale_items WHERE sale_id = ?').all(sale.id);

  const receipt = generateReceipt({ ...sale, items });
  printRaw(receipt)
    .then(() => res.json({ success: true, message: `Recibo ${sale.invoice_number} impreso` }))
    .catch(err => res.status(500).json({ error: 'Error de impresion: ' + err.message }));
});

module.exports = router;
