const initSqlJs = require('sql.js');
const fs = require('fs');
const path = require('path');
const bcrypt = require('bcryptjs');

const DB_PATH = path.join(__dirname, 'pos.db');

let rawDbRef = null;

// Save database to disk
function saveDB() {
  if (rawDbRef) {
    const data = rawDbRef.export();
    fs.writeFileSync(DB_PATH, Buffer.from(data));
  }
}

// Wrapper to make sql.js API compatible with better-sqlite3 style
function wrapDB(rawDb) {
  const wrapper = {
    _db: rawDb,
    _inTransaction: false,

    exec(sql) {
      rawDb.run(sql);
      saveDB();
    },

    prepare(sql) {
      return {
        get(...params) {
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return row;
          }
          stmt.free();
          return undefined;
        },
        all(...params) {
          const results = [];
          const stmt = rawDb.prepare(sql);
          stmt.bind(params);
          while (stmt.step()) {
            results.push(stmt.getAsObject());
          }
          stmt.free();
          return results;
        },
        run(...params) {
          rawDb.run(sql, params);
          if (!wrapper._inTransaction) saveDB();
          const lastId = rawDb.exec("SELECT last_insert_rowid() as id")[0];
          const changes = rawDb.getRowsModified();
          return {
            lastInsertRowid: lastId ? lastId.values[0][0] : 0,
            changes
          };
        }
      };
    },

    transaction(fn) {
      return function(...args) {
        wrapper._inTransaction = true;
        rawDb.run("BEGIN TRANSACTION");
        try {
          const result = fn(...args);
          rawDb.run("COMMIT");
          wrapper._inTransaction = false;
          saveDB();
          return result;
        } catch (err) {
          wrapper._inTransaction = false;
          try { rawDb.run("ROLLBACK"); } catch(e) {}
          throw err;
        }
      };
    },

    pragma(str) {
      try { rawDb.run(`PRAGMA ${str}`); } catch(e) {}
    }
  };

  return wrapper;
}

async function initDatabase() {
  const SQL = await initSqlJs();

  let rawDb;
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    rawDb = new SQL.Database(fileBuffer);
  } else {
    rawDb = new SQL.Database();
  }

  rawDbRef = rawDb;
  const db = wrapDB(rawDb);

  db.pragma('foreign_keys = ON');

  // --- USERS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      name TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('admin', 'vendedor')),
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // --- CATEGORIES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT UNIQUE NOT NULL,
      description TEXT
    )
  `);

  // --- PRODUCTS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      barcode TEXT UNIQUE NOT NULL,
      name TEXT NOT NULL,
      description TEXT,
      category_id INTEGER,
      cost_price REAL NOT NULL DEFAULT 0,
      sale_price REAL NOT NULL DEFAULT 0,
      stock INTEGER NOT NULL DEFAULT 0,
      min_stock INTEGER DEFAULT 5,
      active INTEGER DEFAULT 1,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )
  `);

  // --- SALES ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS sales (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      invoice_number TEXT UNIQUE NOT NULL,
      customer_name TEXT NOT NULL DEFAULT 'Cliente General',
      seller_id INTEGER NOT NULL,
      seller_name TEXT NOT NULL,
      total REAL NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (seller_id) REFERENCES users(id)
    )
  `);

  // --- SALE ITEMS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS sale_items (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sale_id INTEGER NOT NULL,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      barcode TEXT NOT NULL,
      quantity INTEGER NOT NULL,
      unit_price REAL NOT NULL,
      subtotal REAL NOT NULL,
      FOREIGN KEY (sale_id) REFERENCES sales(id),
      FOREIGN KEY (product_id) REFERENCES products(id)
    )
  `);

  // --- INVENTORY MOVEMENTS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS inventory_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      product_id INTEGER NOT NULL,
      product_name TEXT NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('entrada', 'salida', 'ajuste', 'devolucion')),
      quantity INTEGER NOT NULL,
      reason TEXT,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (product_id) REFERENCES products(id),
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // --- CASH CLOSINGS ---
  db.exec(`
    CREATE TABLE IF NOT EXISTS cash_closings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL,
      user_name TEXT NOT NULL,
      period_start DATETIME NOT NULL,
      period_end DATETIME NOT NULL,
      total_sales INTEGER DEFAULT 0,
      total_revenue REAL DEFAULT 0,
      cash_sales REAL DEFAULT 0,
      card_sales REAL DEFAULT 0,
      transfer_sales REAL DEFAULT 0,
      expected_cash REAL DEFAULT 0,
      actual_cash REAL DEFAULT 0,
      difference REAL DEFAULT 0,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY (user_id) REFERENCES users(id)
    )
  `);

  // --- Migrations for existing databases ---
  try { db.exec('ALTER TABLE sales ADD COLUMN payment_method TEXT DEFAULT "Efectivo"'); } catch(e) {}
  try { db.exec('ALTER TABLE sales ADD COLUMN discount_percent REAL DEFAULT 0'); } catch(e) {}
  try { db.exec('ALTER TABLE sales ADD COLUMN subtotal REAL DEFAULT 0'); } catch(e) {}

  // --- Seed default admin user if no users exist ---
  const userCount = db.prepare('SELECT COUNT(*) as count FROM users').get();
  if (userCount.count === 0) {
    const adminPass = bcrypt.hashSync('lebron2020', 10);
    const vendedorPass = bcrypt.hashSync('papeluan2026', 10);

    db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)')
      .run('admin', adminPass, 'Administrador', 'admin');
    db.prepare('INSERT INTO users (username, password, name, role) VALUES (?, ?, ?, ?)')
      .run('vendedor', vendedorPass, 'Vendedor 1', 'vendedor');

    console.log('Usuarios por defecto creados:');
    console.log('  Admin    -> usuario: admin     | clave: lebron2020');
    console.log('  Vendedor -> usuario: vendedor  | clave: papeluan2026');
  }

  // Seed de categorias/productos desactivado — el inventario se gestiona manualmente

  return db;
}

module.exports = { initDatabase, DB_PATH };
