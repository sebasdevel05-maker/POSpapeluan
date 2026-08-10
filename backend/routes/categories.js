const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/categories
router.get('/', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const categories = db.prepare('SELECT * FROM categories ORDER BY name').all();
  res.json(categories);
});

// POST /api/categories (admin only)
router.post('/', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const result = db.prepare('INSERT INTO categories (name, description) VALUES (?, ?)').run(name, description || '');
    res.status(201).json({ id: result.lastInsertRowid, name, description });
  } catch (err) {
    if (err.message.includes('UNIQUE')) return res.status(400).json({ error: 'Categoría ya existe' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
