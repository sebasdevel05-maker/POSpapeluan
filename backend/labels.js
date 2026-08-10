const PDFDocument = require('pdfkit');
const JsBarcode = require('jsbarcode');
const { createCanvas } = require('canvas');

const MM_TO_PT = 2.83465;
const LABEL_W = 40 * MM_TO_PT;
const LABEL_H = 30 * MM_TO_PT;

function generateBarcode(text) {
  const canvas = createCanvas(200, 80);
  JsBarcode(canvas, text, {
    format: 'CODE128',
    width: 1.5,
    height: 50,
    displayValue: false,
    margin: 0,
  });
  return canvas.toBuffer('image/png');
}

function generateLabels(products, res) {
  const doc = new PDFDocument({
    size: [LABEL_W, LABEL_H],
    margins: { top: 4, bottom: 2, left: 4, right: 4 },
    autoFirstPage: false,
  });

  doc.pipe(res);

  for (const item of products) {
    for (let i = 0; i < item.quantity; i++) {
      doc.addPage({ size: [LABEL_W, LABEL_H], margins: { top: 4, bottom: 2, left: 4, right: 4 } });

      const usable = LABEL_W - 8;

      doc.fontSize(6).font('Helvetica-Bold')
        .text('PAPELUAN', 4, 4, { width: usable, align: 'center' });

      const name = item.name.length > 28 ? item.name.substring(0, 28) + '...' : item.name;
      doc.fontSize(5.5).font('Helvetica')
        .text(name, 4, 12, { width: usable, align: 'center' });

      try {
        const barcodeImg = generateBarcode(item.barcode);
        doc.image(barcodeImg, 8, 20, { width: usable - 8, height: 32 });
      } catch {
        doc.fontSize(7).text(item.barcode, 4, 28, { width: usable, align: 'center' });
      }

      doc.fontSize(5).font('Helvetica')
        .text(item.barcode, 4, 54, { width: usable, align: 'center' });

      const price = `$${item.sale_price.toLocaleString('es-CO')}`;
      doc.fontSize(8).font('Helvetica-Bold')
        .text(price, 4, 62, { width: usable, align: 'center' });
    }
  }

  doc.end();
}

function generateTSPL(products) {
  let tspl = '';

  for (const item of products) {
    const name = item.name.length > 20 ? item.name.substring(0, 20) : item.name;
    const barcode = item.barcode.replace(/-/g, '');
    const price = Math.round(item.sale_price).toLocaleString('es-CO') + ' COP';

    for (let i = 0; i < item.quantity; i++) {
      tspl += 'SIZE 40 mm, 30 mm\r\n';
      tspl += 'GAP 2 mm, 0 mm\r\n';
      tspl += 'DIRECTION 0,0\r\n';
      tspl += 'CLS\r\n';
      tspl += `TEXT 85,25,"4",0,1,1,"PAPELUAN"\r\n`;
      tspl += `TEXT 10,62,"3",0,1,1,"${name}"\r\n`;
      tspl += `BARCODE 15,92,"128",40,0,0,2,2,"${barcode}"\r\n`;
      tspl += `TEXT 55,138,"2",0,1,1,"${item.barcode}"\r\n`;
      tspl += `TEXT 45,168,"4",0,1,1,"${price}"\r\n`;
      tspl += 'PRINT 1,1\r\n\r\n';
    }
  }

  return tspl;
}

module.exports = { generateLabels, generateTSPL };
