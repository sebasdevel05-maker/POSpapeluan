const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/products
router.get('/', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.active = 1
      ORDER BY p.name
    `);

    if (req.user.role === 'vendedor') {
      const filtered = rows.map(({ min_stock, cost_price, ...rest }) => rest);
      return res.json(filtered);
    }

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/products/barcode/:code
router.get('/barcode/:code', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query(`
      SELECT p.*, c.name as category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.barcode = $1 AND p.active = 1
    `, [req.params.code]);

    const product = rows[0];
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    if (req.user.role === 'vendedor') {
      const { stock, min_stock, cost_price, ...rest } = product;
      return res.json({ ...rest, available: stock > 0 });
    }

    res.json(product);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products (admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { barcode, name, description, category_id, cost_price, sale_price, stock, min_stock } = req.body;

  if (!barcode || !name || sale_price == null) {
    return res.status(400).json({ error: 'Código de barras, nombre y precio de venta son requeridos' });
  }

  try {
    const { rows } = await pool.query(`
      INSERT INTO products (barcode, name, description, category_id, cost_price, sale_price, stock, min_stock)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id
    `, [barcode, name, description || '', category_id || null, cost_price || 0, sale_price, stock || 0, min_stock || 5]);

    const productId = rows[0].id;

    if (stock > 0) {
      await pool.query(`
        INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
        VALUES ($1, $2, 'entrada', $3, 'Stock inicial al crear producto', $4, $5)
      `, [productId, name, stock, req.user.id, req.user.name]);
    }

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [productId]);
    req.app.locals.io.emit('inventory-updated');
    res.status(201).json(result.rows[0]);
  } catch (err) {
    if (err.message.includes('unique')) {
      return res.status(400).json({ error: 'Ya existe un producto con ese código de barras' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/products/:id (admin only)
router.put('/:id', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { barcode, name, description, category_id, cost_price, sale_price, stock, min_stock } = req.body;

  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    const existing = rows[0];
    if (!existing) return res.status(404).json({ error: 'Producto no encontrado' });

    const newStock = stock != null ? stock : existing.stock;
    if (newStock !== existing.stock) {
      const diff = newStock - existing.stock;
      await pool.query(`
        INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
        VALUES ($1, $2, 'ajuste', $3, 'Ajuste manual de inventario', $4, $5)
      `, [existing.id, existing.name, diff, req.user.id, req.user.name]);
    }

    await pool.query(`
      UPDATE products SET barcode=$1, name=$2, description=$3, category_id=$4, cost_price=$5, sale_price=$6, stock=$7, min_stock=$8, updated_at=NOW()
      WHERE id=$9
    `, [
      barcode || existing.barcode, name || existing.name, description ?? existing.description,
      category_id ?? existing.category_id, cost_price ?? existing.cost_price,
      sale_price ?? existing.sale_price, newStock, min_stock ?? existing.min_stock,
      req.params.id
    ]);

    const result = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    req.app.locals.io.emit('inventory-updated');
    res.json(result.rows[0]);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/products/:id (admin only)
router.delete('/:id', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    await pool.query('UPDATE products SET active = 0 WHERE id = $1', [req.params.id]);
    req.app.locals.io.emit('inventory-updated');
    res.json({ message: 'Producto eliminado' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/labels (admin only)
router.post('/labels', authMiddleware, adminOnly, async (req, res) => {
  const { generateLabels } = require('../labels');
  const pool = req.app.locals.db;
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos un producto' });
  }

  try {
    const products = [];
    for (const item of items) {
      const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND active = 1', [item.product_id]);
      if (rows[0]) {
        products.push({
          name: rows[0].name,
          barcode: rows[0].barcode,
          sale_price: parseFloat(rows[0].sale_price),
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/products/labels/print (admin only)
router.post('/labels/print', authMiddleware, adminOnly, async (req, res) => {
  const { generateTSPL } = require('../labels');
  const { printRaw } = require('../printer');
  const pool = req.app.locals.db;
  const { items } = req.body;

  if (!items || items.length === 0) {
    return res.status(400).json({ error: 'Seleccione al menos un producto' });
  }

  try {
    const products = [];
    for (const item of items) {
      const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND active = 1', [item.product_id]);
      if (rows[0]) {
        products.push({
          name: rows[0].name,
          barcode: rows[0].barcode,
          sale_price: parseFloat(rows[0].sale_price),
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
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
