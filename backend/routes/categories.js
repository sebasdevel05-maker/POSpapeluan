const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

// GET /api/categories
router.get('/', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query('SELECT * FROM categories ORDER BY name');
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/categories (admin only)
router.post('/', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { name, description } = req.body;
  if (!name) return res.status(400).json({ error: 'Nombre requerido' });
  try {
    const { rows } = await pool.query(
      'INSERT INTO categories (name, description) VALUES ($1, $2) RETURNING id',
      [name, description || '']
    );
    res.status(201).json({ id: rows[0].id, name, description });
  } catch (err) {
    if (err.message.includes('unique')) return res.status(400).json({ error: 'Categoría ya existe' });
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
