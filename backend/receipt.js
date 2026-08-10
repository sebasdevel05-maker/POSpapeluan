const PRINT_W = 400; // ~50mm usable at SIZE 80mm

function generateReceipt(sale) {
  let y = 10;
  let body = '';

  // Header
  body += centerText(y, '4', 'PAPELUAN'); y += 38;
  body += centerText(y, '2', 'Sistema POS'); y += 28;
  body += sep(y); y += 18;

  // Invoice info
  body += text(y, '3', sale.invoice_number); y += 26;
  body += text(y, '2', `Fecha: ${sale.created_at}`); y += 22;
  body += text(y, '2', `Cliente: ${trunc(sale.customer_name, 24)}`); y += 22;
  body += text(y, '2', `Vendedor: ${trunc(sale.seller_name, 22)}`); y += 22;
  body += text(y, '2', `Metodo: ${sale.payment_method}`); y += 24;
  body += sep(y); y += 16;

  // Column header
  body += line1(y, 'PRODUCTO', 'CANT', 'TOTAL'); y += 16;
  body += sep(y); y += 16;

  // Items
  for (const item of sale.items) {
    const name = trunc(item.product_name, 32);
    body += text(y, '2', name); y += 20;

    const unitPrice = fmtNum(item.unit_price);
    const qty = `x${item.quantity}`;
    const subtotal = fmtNum(item.subtotal);
    const left = `  ${unitPrice} ${qty}`;
    const pad = Math.max(1, 32 - left.length - subtotal.length);
    body += text(y, '2', left + ' '.repeat(pad) + subtotal); y += 24;
  }

  body += sep(y); y += 18;

  // Subtotal
  const subLabel = 'SUBTOTAL:';
  const subVal = fmtNum(sale.subtotal) + ' COP';
  const subPad = Math.max(1, 48 - subLabel.length - subVal.length);
  body += text(y, '1', subLabel + ' '.repeat(subPad) + subVal); y += 18;

  if (sale.discount_percent > 0) {
    const discAmt = sale.subtotal * (sale.discount_percent / 100);
    const dLabel = `DESCUENTO (${sale.discount_percent}%):`;
    const dVal = '-' + fmtNum(discAmt) + ' COP';
    const dPad = Math.max(1, 48 - dLabel.length - dVal.length);
    body += text(y, '1', dLabel + ' '.repeat(dPad) + dVal); y += 18;
  }

  // Total big
  body += sep(y); y += 16;
  body += centerText(y, '4', `TOTAL: ${fmtNum(sale.total)}`); y += 38;
  body += centerText(y, '3', 'COP'); y += 30;
  body += sep(y); y += 20;

  // Footer
  body += centerText(y, '2', 'Gracias por su compra!'); y += 24;
  body += centerText(y, '3', 'PAPELUAN'); y += 20;

  // Calculate height in mm (y dots / 8 dots per mm) + small margin
  const heightMm = Math.ceil(y / 8) + 3;

  let tspl = '';
  tspl += `SIZE 80 mm, ${heightMm} mm\r\n`;
  tspl += 'GAP 0 mm, 0 mm\r\n';
  tspl += 'DIRECTION 0,0\r\n';
  tspl += 'CLS\r\n';
  tspl += body;
  tspl += 'PRINT 1,1\r\n';

  return tspl;
}

function text(y, font, content) {
  const clean = content.replace(/"/g, "'");
  return `TEXT 0,${y},"${font}",0,1,1,"${clean}"\r\n`;
}

function centerText(y, font, content) {
  const fontWidths = { '1': 8, '2': 12, '3': 16, '4': 24, '5': 32 };
  const charW = fontWidths[font] || 12;
  const textW = content.length * charW;
  const x = Math.max(0, Math.floor((PRINT_W - textW) / 2));
  const clean = content.replace(/"/g, "'");
  return `TEXT ${x},${y},"${font}",0,1,1,"${clean}"\r\n`;
}

function line1(y, col1, col2, col3) {
  const c = col1 + ' '.repeat(Math.max(1, 30 - col1.length)) + col2 + ' '.repeat(Math.max(1, 10 - col2.length)) + col3;
  return text(y, '1', c);
}

function sep(y) {
  return `TEXT 0,${y},"1",0,1,1,"${'_'.repeat(50)}"\r\n`;
}

function trunc(str, max) {
  if (!str) return '';
  return str.length > max ? str.substring(0, max) : str;
}

function fmtNum(n) {
  return Math.round(n).toLocaleString('es-CO');
}

module.exports = { generateReceipt };
