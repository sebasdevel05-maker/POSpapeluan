const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/inventory/movements - Movement history
router.get('/movements', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { type, from, to, product_id } = req.query;

  let conditions = [];
  let params = [];
  if (type) { conditions.push('type = ?'); params.push(type); }
  if (product_id) { conditions.push('product_id = ?'); params.push(parseInt(product_id)); }
  if (from) { conditions.push("date(created_at) >= ?"); params.push(from); }
  if (to) { conditions.push("date(created_at) <= ?"); params.push(to); }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  const movements = db.prepare(`
    SELECT * FROM inventory_movements ${whereClause}
    ORDER BY created_at DESC LIMIT 500
  `).all(...params);

  res.json(movements);
});

// POST /api/inventory/entry - Register inventory entry (admin only)
router.post('/entry', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { product_id, quantity, reason } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad válida son requeridos' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(quantity, product_id);

  db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
    VALUES (?, ?, 'entrada', ?, ?, ?, ?)
  `).run(product_id, product.name, quantity, reason || 'Entrada de mercancía', req.user.id, req.user.name);

  req.app.locals.io.emit('inventory-updated');
  res.json({ message: 'Entrada registrada', new_stock: product.stock + quantity });
});

// POST /api/inventory/return - Register return (admin only)
router.post('/return', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { product_id, quantity, reason } = req.body;

  if (!product_id || !quantity || quantity <= 0) {
    return res.status(400).json({ error: 'Producto y cantidad válida son requeridos' });
  }

  const product = db.prepare('SELECT * FROM products WHERE id = ? AND active = 1').get(product_id);
  if (!product) return res.status(404).json({ error: 'Producto no encontrado' });

  db.prepare('UPDATE products SET stock = stock + ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?')
    .run(quantity, product_id);

  db.prepare(`
    INSERT INTO inventory_movements (product_id, product_name, type, quantity, reason, user_id, user_name)
    VALUES (?, ?, 'devolucion', ?, ?, ?, ?)
  `).run(product_id, product.name, quantity, reason || 'Devolución de producto', req.user.id, req.user.name);

  req.app.locals.io.emit('inventory-updated');
  res.json({ message: 'Devolución registrada', new_stock: product.stock + quantity });
});

module.exports = router;
