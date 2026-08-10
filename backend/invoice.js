const PDFDocument = require('pdfkit');

function generateInvoicePDF(sale, stream) {
  const doc = new PDFDocument({ size: 'LETTER', margin: 50 });
  doc.pipe(stream);

  // Header
  doc.fontSize(24).font('Helvetica-Bold').text('PAPELUAN', { align: 'center' });
  doc.moveDown(0.2);
  doc.fontSize(10).font('Helvetica').text('Papeleria y Variedades', { align: 'center' });
  doc.moveDown(0.3);
  doc.fontSize(16).font('Helvetica-Bold').fillColor('#2563eb').text('FACTURA DE VENTA', { align: 'center' });
  doc.fillColor('#000000');
  doc.moveDown(0.5);

  // Line separator
  doc.moveTo(50, doc.y).lineTo(562, doc.y).lineWidth(2).stroke('#2563eb');
  doc.moveDown(0.5);

  // Invoice details
  const detailsTop = doc.y;
  doc.fontSize(10).font('Helvetica-Bold');
  doc.text('Factura:', 50, detailsTop);
  doc.font('Helvetica').text(sale.invoice_number, 140, detailsTop);

  doc.font('Helvetica-Bold').text('Fecha:', 50, detailsTop + 18);
  const saleDate = new Date(sale.created_at);
  const dateStr = saleDate.toLocaleDateString('es-ES', {
    year: 'numeric', month: 'long', day: 'numeric'
  });
  const timeStr = saleDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  doc.font('Helvetica').text(`${dateStr} - ${timeStr}`, 140, detailsTop + 18);

  doc.font('Helvetica-Bold').text('M. Pago:', 50, detailsTop + 36);
  doc.font('Helvetica').text(sale.payment_method || 'Efectivo', 140, detailsTop + 36);

  doc.font('Helvetica-Bold').text('Cliente:', 350, detailsTop);
  doc.font('Helvetica').text(sale.customer_name || 'Cliente General', 420, detailsTop);

  doc.font('Helvetica-Bold').text('Vendedor:', 350, detailsTop + 18);
  doc.font('Helvetica').text(sale.seller_name, 420, detailsTop + 18);

  doc.moveDown(4);

  // Table header
  const tableTop = doc.y;
  doc.font('Helvetica-Bold').fontSize(9);

  doc.rect(50, tableTop - 5, 512, 22).fill('#2563eb');
  doc.fillColor('#ffffff');
  doc.text('#', 55, tableTop, { width: 25 });
  doc.text('Producto', 80, tableTop, { width: 200 });
  doc.text('Cod. Barras', 280, tableTop, { width: 90 });
  doc.text('Cant.', 370, tableTop, { width: 40, align: 'center' });
  doc.text('P. Unit.', 410, tableTop, { width: 70, align: 'right' });
  doc.text('Subtotal', 480, tableTop, { width: 80, align: 'right' });
  doc.fillColor('#000000');

  // Table rows
  let y = tableTop + 25;
  doc.font('Helvetica').fontSize(9);

  sale.items.forEach((item, i) => {
    if (y > 700) {
      doc.addPage();
      y = 50;
    }

    if (i % 2 === 0) {
      doc.rect(50, y - 4, 512, 20).fill('#f8fafc');
      doc.fillColor('#000000');
    }

    doc.text(String(i + 1), 55, y, { width: 25 });
    doc.text(item.product_name, 80, y, { width: 200 });
    doc.text(item.barcode, 280, y, { width: 90 });
    doc.text(String(item.quantity), 370, y, { width: 40, align: 'center' });
    doc.text(`$${item.unit_price.toFixed(2)}`, 410, y, { width: 70, align: 'right' });
    doc.text(`$${item.subtotal.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
    y += 22;
  });

  // Totals section
  doc.moveTo(350, y + 5).lineTo(562, y + 5).lineWidth(1).stroke('#e2e8f0');
  y += 15;

  const subtotalValue = sale.subtotal || sale.total;
  const discountPct = sale.discount_percent || 0;

  if (discountPct > 0) {
    doc.font('Helvetica').fontSize(10);
    doc.text('Subtotal:', 390, y, { width: 80, align: 'right' });
    doc.text(`$${subtotalValue.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
    y += 18;

    doc.fillColor('#dc2626');
    doc.text(`Descuento (${discountPct}%):`, 390, y, { width: 80, align: 'right' });
    doc.text(`-$${(subtotalValue - sale.total).toFixed(2)}`, 480, y, { width: 80, align: 'right' });
    doc.fillColor('#000000');
    y += 20;
  }

  doc.moveTo(350, y).lineTo(562, y).lineWidth(2).stroke('#2563eb');
  y += 8;

  doc.font('Helvetica-Bold').fontSize(14);
  doc.text('TOTAL:', 390, y, { width: 80, align: 'right' });
  doc.fillColor('#2563eb').text(`$${sale.total.toFixed(2)}`, 480, y, { width: 80, align: 'right' });
  doc.fillColor('#000000');

  // Footer
  doc.moveDown(5);
  doc.font('Helvetica').fontSize(8).fillColor('#94a3b8');
  doc.text('Gracias por su compra. Este documento es su comprobante de venta.', 50, doc.y, { align: 'center' });
  doc.text('PAPELUAN - Sistema POS', 50, doc.y + 12, { align: 'center' });

  doc.end();
}

module.exports = { generateInvoicePDF };
