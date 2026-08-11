const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/inventory/movements
router.get('/movements', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { type, from, to, product_id } = req.query;

  let conditions = [];
  let params = [];
  let idx = 1;
  if (type) { conditions.push(`type = $${idx++}`); params.push(type); }
  if (product_id) { conditions.push(`product_id = $${idx++}`); params.push(parseInt(product_id)); }
  if (from) { conditions.push(`DATE(created_at) >= $${idx++}`); params.push(from); }
  if (to) { conditions.push(`DATE(created_at) <= $${idx++}`); params.push(to); }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  try {
    const { rows } = await pool.query(`
      SELECT * FROM inventory_movements ${whereClause}
      ORDER BY created_at DESC LIMIT 500
    `, params);

    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/entry (admin only)
router.post('/entry', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { product_id, quantity, reason } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad válida son requeridos' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND active = 1', [product_id]);
    const product = rows[0];
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    await pool.query('UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
      [quantity, product_id]);

    await pool.query(`
      INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
      VALUES ($1, $2, 'entrada', $3, $4, $5, $6)
    `, [product_id, product.name, quantity, reason || 'Entrada de mercancía', req.user.id, req.user.name]);

    req.app.locals.io.emit('inventory-updated');
    res.json({ message: 'Entrada registrada', new_stock: product.stock + quantity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/inventory/return (admin only)
router.post('/return', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { product_id, quantity, reason } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad válida son requeridos' });
  }

  try {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1 AND active = 1', [product_id]);
    const product = rows[0];
    if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

    await pool.query('UPDATE products SET stock = stock + $1, updated_at = NOW() WHERE id = $2',
      [quantity, product_id]);

    await pool.query(`
      INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
      VALUES ($1, $2, 'devolucion', $3, $4, $5, $6)
    `, [product_id, product.name, quantity, reason || 'Devolución de producto', req.user.id, req.user.name]);

    req.app.locals.io.emit('inventory-updated');
    res.json({ message: 'Devolución registrada', new_stock: product.stock + quantity });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
