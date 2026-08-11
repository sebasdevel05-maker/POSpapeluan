const express = require('express');
const http = require('http');
const https = require('https');
const fs = require('fs');
const { Server } = require('socket.io');
const path = require('path');
const cors = require('cors');
const { initDatabase } = require('./db/init');

async function start() {
  // Initialize database (PostgreSQL)
  const db = await initDatabase();

  // Express app
  const app = express();
  const server = http.createServer(app);

  // HTTPS server for camera access on tablets/phones
  let httpsServer;
  const certPath = path.join(__dirname, 'certs');
  try {
    const key = fs.readFileSync(path.join(certPath, 'key.pem'));
    const cert = fs.readFileSync(path.join(certPath, 'cert.pem'));
    httpsServer = https.createServer({ key, cert }, app);
  } catch (e) {}

  const io = new Server(server, { cors: { origin: '*' } });
  if (httpsServer) io.attach(httpsServer);

  // Middleware
  app.use(cors());
  app.use(express.json());
  app.use(express.static(path.join(__dirname, '..', 'frontend')));

  // Make db and io accessible in routes
  app.locals.db = db;
  app.locals.io = io;

  // Routes
  app.use('/api/auth', require('./routes/auth'));
  app.use('/api/products', require('./routes/products'));
  app.use('/api/categories', require('./routes/categories'));
  app.use('/api/sales', require('./routes/sales'));
  app.use('/api/reports', require('./routes/reports'));
  app.use('/api/inventory', require('./routes/inventory'));

  // Serve frontend pages
  app.get('/', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'login.html')));
  app.get('/vendedor', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'vendedor.html')));
  app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, '..', 'frontend', 'admin.html')));

  // Error handler global - evita que el servidor se caiga
  app.use((err, req, res, next) => {
    console.error('Error en ruta:', err.message);
    res.status(500).json({ error: 'Error interno del servidor' });
  });

  // Socket.IO - real-time inventory updates
  io.on('connection', (socket) => {
    console.log(`Cliente conectado: ${socket.id}`);
    socket.on('disconnect', () => {
      console.log(`Cliente desconectado: ${socket.id}`);
    });
  });

  // Start server
  const PORT = process.env.PORT || 3000;
  const HTTPS_PORT = 3443;
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`\nServidor POS corriendo en http://localhost:${PORT}`);
    console.log(`  Panel Vendedor:      http://localhost:${PORT}/vendedor`);
    console.log(`  Panel Administrador: http://localhost:${PORT}/admin`);
  });
  if (httpsServer) {
    httpsServer.listen(HTTPS_PORT, '0.0.0.0', () => {
      console.log(`\n  HTTPS (para camara en tablet): https://192.168.0.28:${HTTPS_PORT}/vendedor`);
    });
  }
}

process.on('uncaughtException', (err) => {
  console.error('Error no capturado:', err);
});

process.on('unhandledRejection', (err) => {
  console.error('Promesa no capturada:', err);
});

start().catch(err => {
  console.error('Error al iniciar el servidor:', err);
  process.exit(1);
});
