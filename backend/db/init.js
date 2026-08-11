const { Pool } = require('pg');
const bcrypt = require('bcryptjs');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL && process.env.DATABASE_URL.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
});

pool.on('error', (err) => {
  console.error('Error en pool PostgreSQL:', err.message);
});

async function initDatabase() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username TEXT UNIQUE NOT NULL,
        password TEXT NOT NULL,
        name TEXT NOT NULL,
        role TEXT NOT NULL CHECK(role IN ('admin', 'vendedor')),
        active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS categories (
        id SERIAL PRIMARY KEY,
        name TEXT UNIQUE NOT NULL,
        description TEXT
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS products (
        id SERIAL PRIMARY KEY,
        barcode TEXT UNIQUE NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        category_id INTEGER REFERENCES categories(id),
        cost_price NUMERIC NOT NULL DEFAULT 0,
        sale_price NUMERIC NOT NULL DEFAULT 0,
        stock INTEGER NOT NULL DEFAULT 0,
        min_stock INTEGER DEFAULT 5,
        active INTEGER DEFAULT 1,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sales (
        id SERIAL PRIMARY KEY,
        invoice_number TEXT UNIQUE NOT NULL,
        customer_name TEXT NOT NULL DEFAULT 'Cliente General',
        seller_id INTEGER NOT NULL REFERENCES users(id),
        seller_name TEXT NOT NULL,
        total NUMERIC NOT NULL,
        payment_method TEXT DEFAULT 'Efectivo',
        discount_percent NUMERIC DEFAULT 0,
        subtotal NUMERIC DEFAULT 0,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS sale_items (
        id SERIAL PRIMARY KEY,
        sale_id INTEGER NOT NULL REFERENCES sales(id),
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        barcode TEXT NOT NULL,
        quantity INTEGER NOT NULL,
        unit_price NUMERIC NOT NULL,
        subtotal NUMERIC NOT NULL
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS inventory_movements (
        id SERIAL PRIMARY KEY,
        product_id INTEGER NOT NULL REFERENCES products(id),
        product_name TEXT NOT NULL,
        type TEXT NOT NULL CHECK(type IN ('entrada', 'salida', 'ajuste', 'devolucion')),
        quantity INTEGER NOT NULL,
        reason TEXT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS cash_closings (
        id SERIAL PRIMARY KEY,
        user_id INTEGER NOT NULL REFERENCES users(id),
        user_name TEXT NOT NULL,
        period_start TIMESTAMP NOT NULL,
        period_end TIMESTAMP NOT NULL,
        total_sales INTEGER DEFAULT 0,
        total_revenue NUMERIC DEFAULT 0,
        cash_sales NUMERIC DEFAULT 0,
        card_sales NUMERIC DEFAULT 0,
        transfer_sales NUMERIC DEFAULT 0,
        expected_cash NUMERIC DEFAULT 0,
        actual_cash NUMERIC DEFAULT 0,
        difference NUMERIC DEFAULT 0,
        notes TEXT,
        created_at TIMESTAMP DEFAULT NOW()
      )
    `);

    console.log('Tablas verificadas correctamente.');

    // Seed default users if none exist
    const { rows } = await client.query('SELECT COUNT(*) as count FROM users');
    if (parseInt(rows[0].count) === 0) {
      const adminPass = bcrypt.hashSync('lebron2020', 10);
      const vendedorPass = bcrypt.hashSync('papeluan2026', 10);
      const karenPass = bcrypt.hashSync('karen2026', 10);

      await client.query(
        'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
        ['admin', adminPass, 'Administrador', 'admin']
      );
      await client.query(
        'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
        ['vendedor', vendedorPass, 'Vendedor 1', 'vendedor']
      );
      await client.query(
        'INSERT INTO users (username, password, name, role) VALUES ($1, $2, $3, $4)',
        ['karen', karenPass, 'KAREN', 'vendedor']
      );

      console.log('Usuarios por defecto creados:');
      console.log('  Admin    -> usuario: admin     | clave: lebron2020');
      console.log('  Vendedor -> usuario: vendedor  | clave: papeluan2026');
      console.log('  Karen    -> usuario: karen     | clave: karen2026');
    }
  } finally {
    client.release();
  }

  return pool;
}

module.exports = { initDatabase, pool };
