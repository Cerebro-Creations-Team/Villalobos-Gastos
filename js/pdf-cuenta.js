// Genera el comprobante de gastos en PDF (carta, una página) a partir del mismo diseño que el Excel.
(function (global) {
  const PT_POR_PX = 0.75;
  const CARTA = { ancho: 612, alto: 792 };
  const MARGEN = { izq: 31, der: 22, arr: 34, aba: 29 }; // los márgenes de impresión del libro de cuentas

  // Ancho de columna de Excel (caracteres) a puntos
  const anchoColumna = (w) => Math.round(7 * w) * PT_POR_PX;

  function construirPDF(c) {
    const { jsPDF } = global.jspdf;
    const E = global.ExcelCuenta;
    const d = E.diseno(c);

    // Posiciones de columnas (A..L) y filas en puntos, sin escalar
    const anchos = Object.values(E.ANCHOS).map(anchoColumna);
    const xCol = [0];
    anchos.forEach((w, i) => xCol.push(xCol[i] + w));
    const altoFila = (f) => d.alturas[f] ?? E.ALTO_FILA;
    const yFila = [0, 0]; // yFila[f] = borde superior de la fila f (base 1)
    for (let f = 1; f <= d.ultimaFila; f++) yFila[f + 1] = yFila[f] + altoFila(f);

    // Todo en una página: se escala como "ajustar a una página"
    const anchoTotal = xCol[xCol.length - 1];
    const altoTotal = yFila[d.ultimaFila + 1];
    const s = Math.min((CARTA.ancho - MARGEN.izq - MARGEN.der) / anchoTotal, (CARTA.alto - MARGEN.arr - MARGEN.aba) / altoTotal);
    const X = (pt) => MARGEN.izq + pt * s;
    const Y = (pt) => MARGEN.arr + pt * s;

    const doc = new jsPDF({ unit: 'pt', format: 'letter', compress: true });
    doc.setProperties({ title: `Comprobante de gastos ${c.numero || ''}`.trim(), author: 'Agencia Aduanal Villalobos' });

    if (global.LOGO_PNG_BASE64) {
      const L = E.LOGO;
      doc.addImage(`data:image/png;base64,${global.LOGO_PNG_BASE64}`, 'PNG',
        X(xCol[L.col]), Y(L.fila * altoFila(1)), L.ancho * PT_POR_PX * s, L.alto * PT_POR_PX * s);
    }

    const RELLENO = 2 * PT_POR_PX; // margen interno de la celda
    for (const { fila, col, valor, estilo } of d.celdas) {
      const v = valor && typeof valor === 'object' && 'result' in valor ? valor.result : valor;
      if (v === '' || v == null) continue;
      doc.setFont('helvetica', estilo.b ? 'bold' : 'normal');
      doc.setFontSize(estilo.tam * s);
      const izq = xCol[col - 1], der = xCol[col];
      // Alineación vertical abajo, como en Excel; las celdas centradas van al centro de la fila
      const base = estilo.al ? yFila[fila] + altoFila(fila) / 2 + estilo.tam * 0.35 : yFila[fila + 1] - 3;

      if (estilo.fmt === E.FMT_PESOS) {
        // Formato contable: "$" pegado a la izquierda, importe a la derecha; cero se muestra como "-"
        const pad = 7;
        doc.text('$', X(izq + pad), Y(base));
        const n = Number(v) || 0;
        if (Math.abs(n) < 0.005) doc.text('-', X(der - pad - 12), Y(base), { align: 'right' });
        else doc.text(Cuenta.dinero(n), X(der - pad), Y(base), { align: 'right' });
        continue;
      }
      const texto = String(v);
      if (estilo.al === 'center') doc.text(texto, X((izq + der) / 2), Y(base), { align: 'center' });
      else if (typeof v === 'number') doc.text(texto, X(der - RELLENO), Y(base), { align: 'right' });
      else doc.text(texto, X(izq + RELLENO), Y(base));
    }

    doc.setLineWidth(1.5 * s);
    for (const { f1, c1, f2, c2 } of d.recuadros) {
      doc.rect(X(xCol[c1 - 1]), Y(yFila[f1]), (xCol[c2] - xCol[c1 - 1]) * s, (yFila[f2 + 1] - yFila[f1]) * s);
    }
    return doc;
  }

  function descargarPDF(c) {
    const nombre = global.ExcelCuenta.nombreArchivo(c, 'pdf');
    global.ExcelCuenta.bajarBlob(construirPDF(c).output('blob'), nombre);
    return nombre;
  }

  global.PdfCuenta = { construirPDF, descargarPDF };
})(this);
