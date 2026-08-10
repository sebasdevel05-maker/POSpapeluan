const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/products - List all products (vendedor: without stock, admin: full)
router.get('/', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const products = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.active = 1
    ORDER BY p.name
  `).all();

  if (req.user.role === 'vendedor') {
    const filtered = products.map(({ min_stock, cost_price, ...rest }) => rest);
    return res.json(filtered);
  }

  res.json(products);
});

// GET /api/products/barcode/:code - Lookup by barcode
router.get('/barcode/:code', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const product = db.prepare(`
    SELECT p.*, c.name as category_name
    FROM products p
    LEFT JOIN categories c ON p.category_id = c.id
    WHERE p.barcode = ? AND p.active = 1
  `).get(req.params.code);

  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  if (req.user.role === 'vendedor') {
    const { stock, min_stock, cost_price, ...rest } = product;
    // Only tell them if it's available, not the exact count
    return res.json({ ...rest, available: stock > 0 });
  }

  res.json(product);
});

// POST /api/products - Create product (admin only)
router.post('/', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { barcode, name, description, category_id, cost_price, sale_price, stock, min_stock } = req.body;

  if (!barcode || !name || sale_price == null) {
    return res.status(400).json({ error: 'Código de barras, nombre y precio de venta son requeridos' });
  }

  try {
    const result = db.prepare(`
      INSERT INTO products (barcode, name, description, category_id, cost_price, sale_price, stock, min_stock)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run(barcode, name, description || '', category_id || null, cost_price || 0, sale_price, stock || 0, min_stock || 5);

    // Log inventory movement
    if (stock > 0) {
      db.prepare(`
        INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
        VALUES (?, ?, 'entrada', ?, 'Stock inicial al crear producto', ?, ?)
      `).run(result.lastInsertRowid, name, stock, req.user.id, req.user.name);
    }

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(result.lastInsertRowid);
    req.app.locals.io.emit('inventory-updated');
    res.status(201).json(product);
  } catch (err) {
    if (err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'Ya existe un producto con ese código de barras' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id - Update product (admin only)
router.put('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { barcode, name, description, category_id, cost_price, sale_price, stock, min_stock } = req.body;

  const existing = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

  // If stock changed, log movement
  const newStock = stock != null ? stock : existing.stock;
  if (newStock !== existing.stock) {
    const diff = newStock - existing.stock;
    db.prepare(`
      INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
      VALUES (?, ?, 'ajuste', ?, 'Ajuste manual de inventario', ?, ?)
    `).run(existing.id, existing.name, diff, req.user.id, req.user.name);
  }

  db.prepare(`
    UPDATE products SET barcode=?, name=?, description=?, category_id=?, cost_price=?, sale_price=?, stock=?, min_stock=?, updated_at=CURRENT_TIMESTAMP
    WHERE id=?
  `).run(
    barcode || existing.barcode, name || existing.name, description ?? existing.description,
    category_id ?? existing.category_id, cost_price ?? existing.cost_price,
    sale_price ?? existing.sale_price, newStock, min_stock ?? existing.min_stock,
    req.params.id
  );

  const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
  req.app.locals.io.emit('inventory-updated');
  res.json(updated);
});

// DELETE /api/products/:id - Soft delete (admin only)
router.delete('/:id', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  db.prepare('UPDATE products SET active = 0 WHERE id = ?').run(req.params.id);
  req.app.locals.io.emit('inventory-updated');
  res.json({ message: 'Producto eliminado' });
});

// POST /api/products/labels - Generate label PDF (admin only)
router.post('/labels', authMiddleware, adminOnly, (req, res) => {
  const { generateLabels } = require('../labels');
  const db = req.app.locals.db;
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos un producto' });
  }

  const products = [];
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (product) {
      products.push({
        name: product.name,
        barcode: product.barcode,
        sale_price: product.sale_price,
        quantity: parseInt(item.quantity) || 1,
      });
    }
  }

  if (products.length === 0) {
    return res.status(400).json({ error: 'No se encontraron productos válidos' });
  }

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', 'inline; filename=etiquetas.pdf');
  generateLabels(products, res);
});

// POST /api/products/labels/print - Print labels directly to thermal printer (admin only)
router.post('/labels/print', authMiddleware, adminOnly, (req, res) => {
  const { generateTSPL } = require('../labels');
  const { printRaw } = require('../printer');
  const db = req.app.locals.db;
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos un producto' });
  }

  const products = [];
  for (const item of items) {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(item.product_id);
    if (product) {
      products.push({
        name: product.name,
        barcode: product.barcode,
        sale_price: product.sale_price,
        quantity: parseInt(item.quantity) || 1,
      });
    }
  }

  if (products.length === 0) {
    return res.status(400).json({ error: 'No se encontraron productos válidos' });
  }

  const tspl = generateTSPL(products);
  const totalLabels = products.reduce((sum, p) => sum + p.quantity, 0);

  printRaw(tspl)
    .then(() => res.json({ success: true, message: `${totalLabels} etiqueta(s) enviadas a la impresora` }))
    .catch(err => res.status(500).json({ error: 'Error de impresion: ' + err.message }));
});

module.exports = router;
