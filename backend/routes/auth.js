const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'pos_secret_key_2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1] || req.query.token;
  if (!token) return res.status(401).json({ error: 'Token requerido' });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    next();
  } catch {
    res.status(401).json({ error: 'Token invalido' });
  }
}

function adminOnly(req, res, next) {
  if (req.user.role !== 'admin') return res.status(403).json({ error: 'Acceso denegado' });
  next();
}

// POST /api/auth/login
router.post('/login', (req, res) => {
  const { username, password } = req.body;
  const db = req.app.locals.db;

  const user = db.prepare('SELECT * FROM users WHERE username = ? AND active = 1').get(username);
  if (!user) return res.status(401).json({ error: 'Usuario no encontrado' });

  if (!bcrypt.compareSync(password, user.password)) {
    return res.status(401).json({ error: 'Contrasena incorrecta' });
  }

  const token = jwt.sign(
    { id: user.id, username: user.username, name: user.name, role: user.role },
    JWT_SECRET,
    { expiresIn: '12h' }
  );

  res.json({
    token,
    user: { id: user.id, username: user.username, name: user.name, role: user.role }
  });
});

// GET /api/auth/me
router.get('/me', authMiddleware, (req, res) => {
  res.json({ user: req.user });
});

// GET /api/auth/users - List all users (admin only)
router.get('/users', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const users = db.prepare('SELECT id, username, name, role, active, created_at FROM users ORDER BY created_at DESC').all();
  res.json(users);
});

// POST /api/auth/users - Create user (admin only)
router.post('/users', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { username, password, name, role } = req.body;

  if (!username || !password || !name || !role) {
    return res.status(400).json({ error: 'Todos los campos son requeridos' });
  }
  if (!['admin', 'vendedor'].includes(role)) {
    return res.status(400).json({ error: 'Rol invalido' });
  }

  try {
    const hashed = bcrypt.hashSync(password, 10);
    const result = db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)')
      .run(username, hashed, name, role);
    res.status(201).json({ id: result.lastInsertRowid, username, name, role, active: 1 });
  } catch (err) {
    if (err.message && err.message.includes('UNIQUE')) {
      return res.status(400).json({ error: 'El nombre de usuario ya existe' });
    }
    res.status(500).json({ error: err.message });
  }
});

// PUT /api/auth/users/:id - Update user (admin only)
router.put('/users/:id', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { name, role, password, active } = req.body;
  const userId = parseInt(req.params.id);

  const existing = db.prepare('SELECT * FROM users WHERE id = ?').get(userId);
  if (!existing) return res.status(404).json({ error: 'Usuario no encontrado' });

  if (password) {
    const hashed = bcrypt.hashSync(password, 10);
    db.prepare('UPDATE users SET password = ? WHERE id = ?').run(hashed, userId);
  }

  db.prepare('UPDATE users SET name = ?, role = ?, active = ? WHERE id = ?')
    .run(name || existing.name, role || existing.role, active !== undefined ? active : existing.active, userId);

  const updated = db.prepare('SELECT id, username, name, role, active, created_at FROM users WHERE id = ?').get(userId);
  res.json(updated);
});

module.exports = router;
module.exports.authMiddleware = authMiddleware;
module.exports.adminOnly = adminOnly;
