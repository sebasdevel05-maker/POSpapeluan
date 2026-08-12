const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');
const { generateInvoicePDF } = require('../invoice');
const { generateReceipt } = require('../receipt');
const { printRaw } = require('../printer');

// POST /api/sales - Create a new sale
router.post('/', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  const { customer_name, items, payment_method, discount_percent } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'La venta debe tener al menos un producto' });
  }

  const validMethods = ['Efectivo', 'Tarjeta', 'Transferencia', 'Nequi'];
  const method = validMethods.includes(payment_method) ? payment_method : 'Efectivo';
  const discount = Math.max(0, Math.min(100, parseFloat(discount_percent) || 0));

  const now = new Date();
  const localDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
  const localTime = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}:${String(now.getSeconds()).padStart(2,'0')}`;
  const localTimestamp = `${localDate} ${localTime}`;
  const dateStr = localDate.replace(/-/g, '');

  const client = await pool.connect();

  try {
    const lastSaleRes = await client.query(
      "SELECT invoice_number FROM sales WHERE invoice_number LIKE $1 ORDER BY id DESC LIMIT 1",
      [`FAC-${dateStr}-%`]
    );

    let seq = 1;
    if (lastSaleRes.rows[0]) {
      seq = parseInt(lastSaleRes.rows[0].invoice_number.split('-')[2]) + 1;
    }
    const invoiceNumber = `FAC-${dateStr}-${String(seq).padStart(4, '0')}`;

    // Validate stock and calculate totals
    const saleItems = [];
    let subtotal = 0;

    for (const item of items) {
      const { rows } = await client.query('SELECT * FROM products WHERE id = $1 AND active = 1', [item.product_id]);
      const product = rows[0];
      if (!product) {
        return res.status(400).json({ error: `Producto ID ${item.product_id} no encontrado` });
      }
      if (product.stock < item.quantity) {
        return res.status(400).json({
          error: `Stock insuficiente para "${product.name}". Disponible: ${product.stock}, Solicitado: ${item.quantity}`
        });
      }
      const itemSubtotal = parseFloat(product.sale_price) * item.quantity;
      saleItems.push({
        product_id: product.id,
        product_name: product.name,
        barcode: product.barcode,
        quantity: item.quantity,
        unit_price: parseFloat(product.sale_price),
        subtotal: itemSubtotal
      });
      subtotal += itemSubtotal;
    }

    const discountAmount = subtotal * (discount / 100);
    const total = subtotal - discountAmount;

    await client.query('BEGIN');

    const saleResult = await client.query(`
      INSERT INTO sales (invoice_number, customer_name, seller_id, seller_name, subtotal, total, payment_method, discount_percent, created_at)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id
    `, [invoiceNumber, customer_name || 'Cliente General', req.user.id, req.user.name, subtotal, total, method, discount, localTimestamp]);

    const saleId = saleResult.rows[0].id;

    for (const item of saleItems) {
      await client.query(`
        INSERT INTO sale_items (sale_id, product_id, product_name, barcode, quantity, unit_price, subtotal)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
      `, [saleId, item.product_id, item.product_name, item.barcode, item.quantity, item.unit_price, item.subtotal]);

      await client.query('UPDATE products SET stock = stock - $1, updated_at = NOW() WHERE id = $2',
        [item.quantity, item.product_id]);

      await client.query(`
        INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
        VALUES ($1, $2, 'salida', $3, $4, $5, $6)
      `, [item.product_id, item.product_name, -item.quantity, `Venta ${invoiceNumber}`, req.user.id, req.user.name]);
    }

    await client.query('COMMIT');

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

    try {
      const receipt = generateReceipt(saleData);
      printRaw(receipt).catch(err => console.error('Error imprimiendo recibo:', err.message));
    } catch (err) {
      console.error('Error generando recibo:', err.message);
    }

    res.status(201).json(saleData);
  } catch (err) {
    try { await client.query('ROLLBACK'); } catch (e) {}
    res.status(500).json({ error: err.message });
  } finally {
    client.release();
  }
});

function parseSaleNumerics(s) {
  return { ...s, total: parseFloat(s.total), subtotal: parseFloat(s.subtotal), discount_percent: parseFloat(s.discount_percent) };
}

// GET /api/sales
router.get('/', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    let result;
    if (req.user.role === 'admin') {
      result = await pool.query('SELECT * FROM sales ORDER BY created_at DESC LIMIT 200');
    } else {
      result = await pool.query('SELECT * FROM sales WHERE seller_id = $1 ORDER BY created_at DESC LIMIT 50', [req.user.id]);
    }
    res.json(result.rows.map(parseSaleNumerics));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id
router.get('/:id', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query('SELECT * FROM sales WHERE id = $1', [parseInt(req.params.id)]);
    const sale = rows[0];
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    const items = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);
    const saleItems = items.rows.map(i => ({ ...i, unit_price: parseFloat(i.unit_price), subtotal: parseFloat(i.subtotal) }));
    res.json({ ...parseSaleNumerics(sale), items: saleItems });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/sales/:id/invoice
router.get('/:id/invoice', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query('SELECT * FROM sales WHERE id = $1', [parseInt(req.params.id)]);
    const sale = rows[0];
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    const items = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);

    // Ensure numeric fields are numbers
    sale.total = parseFloat(sale.total);
    sale.subtotal = parseFloat(sale.subtotal);
    sale.discount_percent = parseFloat(sale.discount_percent);
    const saleItems = items.rows.map(i => ({ ...i, unit_price: parseFloat(i.unit_price), subtotal: parseFloat(i.subtotal) }));

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename=factura_${sale.invoice_number}.pdf`);

    generateInvoicePDF({ ...sale, items: saleItems }, res);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/sales/:id/print
router.post('/:id/print', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query('SELECT * FROM sales WHERE id = $1', [parseInt(req.params.id)]);
    const sale = rows[0];
    if (!sale) return res.status(404).json({ error: 'Venta no encontrada' });
    const items = await pool.query('SELECT * FROM sale_items WHERE sale_id = $1', [sale.id]);

    sale.total = parseFloat(sale.total);
    sale.subtotal = parseFloat(sale.subtotal);
    const saleItems = items.rows.map(i => ({ ...i, unit_price: parseFloat(i.unit_price), subtotal: parseFloat(i.subtotal) }));

    const receipt = generateReceipt({ ...sale, items: saleItems });
    printRaw(receipt)
      .then(() => res.json({ success: true, message: `Recibo ${sale.invoice_number} impreso` }))
      .catch(err => res.status(500).json({ error: 'Error de impresion: ' + err.message }));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
