const express = require('express');
const router = express.Router();
const { authMiddleware, adminOnly } = require('./auth');

function getLocalDateStr() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
}

function getDateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

function getStartOfMonth() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
}

// GET /api/reports/dashboard
router.get('/dashboard', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const todayStr = getLocalDateStr();
  const weekAgo = getDateDaysAgo(7);
  const monthStart = getStartOfMonth();

  const today = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
    FROM sales WHERE date(created_at) = ?
  `).get(todayStr);

  const week = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
    FROM sales WHERE date(created_at) >= ?
  `).get(weekAgo);

  const month = db.prepare(`
    SELECT COUNT(*) as count, COALESCE(SUM(total), 0) as total
    FROM sales WHERE date(created_at) >= ?
  `).get(monthStart);

  const lowStock = db.prepare(`
    SELECT COUNT(*) as count FROM products WHERE stock <= min_stock AND active = 1
  `).get();

  const totalProducts = db.prepare(`SELECT COUNT(*) as count FROM products WHERE active = 1`).get();

  const topProducts = db.prepare(`
    SELECT si.product_name, SUM(si.quantity) as total_sold, SUM(si.subtotal) as revenue
    FROM sale_items si
    JOIN sales s ON si.sale_id = s.id
    WHERE date(s.created_at) >= ?
    GROUP BY si.product_id
    ORDER BY total_sold DESC
    LIMIT 5
  `).all(monthStart);

  const salesByDay = db.prepare(`
    SELECT date(created_at) as date, COUNT(*) as count, SUM(total) as total
    FROM sales
    WHERE date(created_at) >= ?
    GROUP BY date(created_at)
    ORDER BY date ASC
  `).all(weekAgo);

  const salesByMethod = db.prepare(`
    SELECT COALESCE(payment_method, 'Efectivo') as method, COUNT(*) as count, SUM(total) as total
    FROM sales WHERE date(created_at) = ?
    GROUP BY payment_method
  `).all(todayStr);

  const lowStockProducts = db.prepare(`
    SELECT name, barcode, stock, min_stock FROM products
    WHERE stock <= min_stock AND active = 1
    ORDER BY stock ASC LIMIT 10
  `).all();

  res.json({
    today, week, month,
    lowStock: lowStock.count,
    totalProducts: totalProducts.count,
    topProducts,
    salesByDay,
    salesByMethod,
    lowStockProducts
  });
});

// GET /api/reports/sales - Filtered sales report
router.get('/sales', authMiddleware, adminOnly, (req, res) => {
  const db = req.app.locals.db;
  const { period, from, to } = req.query;

  let whereClause = '';
  let params = [];

  if (period === 'today') {
    whereClause = "WHERE date(s.created_at) = ?";
    params = [getLocalDateStr()];
  } else if (period === 'week') {
    whereClause = "WHERE date(s.created_at) >= ?";
    params = [getDateDaysAgo(7)];
  } else if (period === 'month') {
    whereClause = "WHERE date(s.created_at) >= ?";
    params = [getStartOfMonth()];
  } else if (from && to) {
    whereClause = "WHERE date(s.created_at) BETWEEN ? AND ?";
    params = [from, to];
  }

  const sales = db.prepare(`
    SELECT s.*,
      (SELECT GROUP_CONCAT(si.product_name || ' x' || si.quantity, ', ')
       FROM sale_items si WHERE si.sale_id = s.id) as items_summary
    FROM sales s
    ${whereClause}
    ORDER BY s.created_at DESC
  `).all(...params);

  const summary = db.prepare(`
    SELECT COUNT(*) as total_sales, COALESCE(SUM(total), 0) as total_revenue
    FROM sales s ${whereClause}
  `).get(...params);

  const byMethod = db.prepare(`
    SELECT COALESCE(payment_method, 'Efectivo') as method, COUNT(*) as count, SUM(total) as total
    FROM sales s ${whereClause}
    GROUP BY payment_method
  `).all(...params);

  res.json({ sales, summary, byMethod });
});

// POST /api/reports/cash-closing - Create cash closing
router.post('/cash-closing', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const { actual_cash, notes } = req.body;

  const lastClosing = db.prepare('SELECT period_end FROM cash_closings ORDER BY id DESC LIMIT 1').get();
  const periodStart = lastClosing ? lastClosing.period_end : getDateDaysAgo(1) + ' 00:00:00';
  const periodEnd = new Date().toISOString();

  const salesData = db.prepare(`
    SELECT
      COUNT(*) as total_sales,
      COALESCE(SUM(total), 0) as total_revenue,
      COALESCE(SUM(CASE WHEN COALESCE(payment_method,'Efectivo') = 'Efectivo' THEN total ELSE 0 END), 0) as cash_sales,
      COALESCE(SUM(CASE WHEN payment_method = 'Tarjeta' THEN total ELSE 0 END), 0) as card_sales,
      COALESCE(SUM(CASE WHEN payment_method IN ('Transferencia','Nequi') THEN total ELSE 0 END), 0) as transfer_sales
    FROM sales WHERE created_at > ? AND created_at <= ?
  `).get(periodStart, periodEnd);

  const expectedCash = salesData.cash_sales;
  const actualCashAmount = parseFloat(actual_cash) || 0;
  const difference = actualCashAmount - expectedCash;

  const result = db.prepare(`
    INSERT INTO cash_closings (user_id, user_name, period_start, period_end, total_sales, total_revenue,
      cash_sales, card_sales, transfer_sales, expected_cash, actual_cash, difference, notes)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    req.user.id, req.user.name, periodStart, periodEnd,
    salesData.total_sales, salesData.total_revenue,
    salesData.cash_sales, salesData.card_sales, salesData.transfer_sales,
    expectedCash, actualCashAmount, difference, notes || ''
  );

  res.status(201).json({
    id: result.lastInsertRowid,
    ...salesData,
    expected_cash: expectedCash,
    actual_cash: actualCashAmount,
    difference,
    period_start: periodStart,
    period_end: periodEnd
  });
});

// GET /api/reports/cash-closings - List cash closings
router.get('/cash-closings', authMiddleware, (req, res) => {
  const db = req.app.locals.db;
  const closings = db.prepare('SELECT * FROM cash_closings ORDER BY created_at DESC LIMIT 30').all();
  res.json(closings);
});

module.exports = router;
