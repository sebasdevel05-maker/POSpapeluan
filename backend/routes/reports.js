const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

function getColombiaNow() {
  const now = new Date();
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

function getLocalDateStr() {
  return getColombiaNow();
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

function getStartOfMonth() {
  const dateStr = getColombiaNow();
  return dateStr.substring(0, 8) + '01';
}

// GET /api/reports/dashboard
router.get('/dashboard', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const todayStr = getLocalDateStr();
  const weekAgo = getDateDaysAgo(7);
  const monthStart = getStartOfMonth();

  try {
    const today = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) = $1', [todayStr]
    );

    const week = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) >= $1', [weekAgo]
    );

    const month = await pool.query(
      'SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total FROM sales WHERE DATE(created_at) >= $1', [monthStart]
    );

    const lowStock = await pool.query(
      'SELECT COUNT(*) as count FROM products WHERE stock <= min_stock AND active = 1'
    );

    const totalProducts = await pool.query('SELECT COUNT(*) as count FROM products WHERE active = 1');

    const topProducts = await pool.query(`
      SELECT si.product_name, SUM(si.quantity) as total_sold, SUM(si.subtotal) as revenue
      FROM sale_items si
      JOIN sales s ON si.sale_id = s.id
      WHERE DATE(s.created_at) >= $1
      GROUP BY si.product_name
      ORDER BY total_sold DESC
      LIMIT 5
    `, [monthStart]);

    const salesByDay = await pool.query(`
      SELECT DATE(created_at) as date, COUNT(*) as count, SUM(total) as total
      FROM sales
      WHERE DATE(created_at) >= $1
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `, [weekAgo]);

    const salesByMethod = await pool.query(`
      SELECT COALESCE(payment_method, 'Efectivo') as method, COUNT(*) as count, SUM(total) as total
      FROM sales WHERE DATE(created_at) = $1
      GROUP BY payment_method
    `, [todayStr]);

    const lowStockProducts = await pool.query(`
      SELECT name, barcode, stock, min_stock FROM products
      WHERE stock <= min_stock AND active = 1
      ORDER BY stock ASC LIMIT 10
    `);

    res.json({
      today: { count: parseInt(today.rows[0].count), total: parseFloat(today.rows[0].total) },
      week: { count: parseInt(week.rows[0].count), total: parseFloat(week.rows[0].total) },
      month: { count: parseInt(month.rows[0].count), total: parseFloat(month.rows[0].total) },
      lowStock: parseInt(lowStock.rows[0].count),
      totalProducts: parseInt(totalProducts.rows[0].count),
      topProducts: topProducts.rows.map(r => ({ ...r, total_sold: parseInt(r.total_sold), revenue: parseFloat(r.revenue) })),
      salesByDay: salesByDay.rows.map(r => ({ ...r, count: parseInt(r.count), total: parseFloat(r.total) })),
      salesByMethod: salesByMethod.rows.map(r => ({ ...r, count: parseInt(r.count), total: parseFloat(r.total) })),
      lowStockProducts: lowStockProducts.rows
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/sales
router.get('/sales', authMiddleware, adminOnly, async (req, res) => {
  const pool = req.app.locals.db;
  const { period, from, to } = req.query;

  let whereClause = '';
  let params = [];
  let paramIdx = 1;

  if (period === 'today') {
    whereClause = `WHERE DATE(s.created_at) = $${paramIdx++}`;
    params = [getLocalDateStr()];
  } else if (period === 'week') {
    whereClause = `WHERE DATE(s.created_at) >= $${paramIdx++}`;
    params = [getDateDaysAgo(7)];
  } else if (period === 'month') {
    whereClause = `WHERE DATE(s.created_at) >= $${paramIdx++}`;
    params = [getStartOfMonth()];
  } else if (from && to) {
    whereClause = `WHERE DATE(s.created_at) BETWEEN $${paramIdx++} AND $${paramIdx++}`;
    params = [from, to];
  }

  try {
    const sales = await pool.query(`
      SELECT s.*,
        (SELECT STRING_AGG(si.product_name || ' x' || si.quantity, ', ')
         FROM sale_items si WHERE si.sale_id = s.id) as items_summary
      FROM sales s
      ${whereClause}
      ORDER BY s.created_at DESC
    `, params);

    const summary = await pool.query(`
      SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_revenue
      FROM sales s ${whereClause}
    `, params);

    const byMethod = await pool.query(`
      SELECT COALESCE(payment_method, 'Efectivo') as method, COUNT(*) as count, SUM(total) as total
      FROM sales s ${whereClause}
      GROUP BY payment_method
    `, params);

    res.json({
      sales: sales.rows.map(s => ({ ...s, total: parseFloat(s.total), subtotal: parseFloat(s.subtotal), discount_percent: parseFloat(s.discount_percent) })),
      summary: { total_sales: parseInt(summary.rows[0].total_sales), total_revenue: parseFloat(summary.rows[0].total_revenue) },
      byMethod: byMethod.rows.map(r => ({ ...r, count: parseInt(r.count), total: parseFloat(r.total) }))
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/reports/cash-closing
router.post('/cash-closing', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  const { actual_cash, notes } = req.body;

  try {
    const lastClosing = await pool.query('SELECT period_end FROM cash_closings ORDER BY id DESC LIMIT 1');
    const periodStart = lastClosing.rows[0] ? lastClosing.rows[0].period_end : getDateDaysAgo(1) + ' 00:00:00';
    const nowCo = new Date();
    const coDate = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' }).format(nowCo);
    const coTime = new Intl.DateTimeFormat('en-GB', { timeZone: 'America/Bogota', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(nowCo);
    const periodEnd = `${coDate} ${coTime}`;

    const salesData = await pool.query(`
      SELECT
        COUNT(*) as total_sales,
        COALESCE(SUM(total), 0) as total_revenue,
        COALESCE(SUM(CASE WHEN COALESCE(payment_method,'Efectivo') = 'Efectivo' THEN total ELSE 0 END), 0) as cash_sales,
        COALESCE(SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END), 0) as card_sales,
        COALESCE(SUM(CASE WHEN payment_method IN ('Transferencia','Nequi') THEN total ELSE 0 END), 0) as transfer_sales
      FROM sales WHERE created_at > $1 AND created_at <= $2
    `, [periodStart, periodEnd]);

    const sd = salesData.rows[0];
    const expectedCash = parseFloat(sd.cash_sales);
    const actualCashAmount = parseFloat(actual_cash) || 0;
    const difference = actualCashAmount - expectedCash;

    const result = await pool.query(`
      INSERT INTO cash_closings (user_id, user_name, period_start, period_end, total_sales, total_revenue,
        cash_sales, card_sales, transfer_sales, expected_cash, actual_cash, difference, notes)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING id
    `, [
      req.user.id, req.user.name, periodStart, periodEnd,
      parseInt(sd.total_sales), parseFloat(sd.total_revenue),
      parseFloat(sd.cash_sales), parseFloat(sd.card_sales), parseFloat(sd.transfer_sales),
      expectedCash, actualCashAmount, difference, notes || ''
    ]);

    res.status(201).json({
      id: result.rows[0].id,
      total_sales: parseInt(sd.total_sales),
      total_revenue: parseFloat(sd.total_revenue),
      cash_sales: parseFloat(sd.cash_sales),
      card_sales: parseFloat(sd.card_sales),
      transfer_sales: parseFloat(sd.transfer_sales),
      expected_cash: expectedCash,
      actual_cash: actualCashAmount,
      difference,
      period_start: periodStart,
      period_end: periodEnd
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/reports/cash-closings
router.get('/cash-closings', authMiddleware, async (req, res) => {
  const pool = req.app.locals.db;
  try {
    const { rows } = await pool.query('SELECT * FROM cash_closings ORDER BY created_at DESC LIMIT 30');
    const closings = rows.map(c => ({
      ...c,
      total_revenue: parseFloat(c.total_revenue),
      cash_sales: parseFloat(c.cash_sales),
      card_sales: parseFloat(c.card_sales),
      transfer_sales: parseFloat(c.transfer_sales),
      expected_cash: parseFloat(c.expected_cash),
      actual_cash: parseFloat(c.actual_cash),
      difference: parseFloat(c.difference),
    }));
    res.json(closings);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
