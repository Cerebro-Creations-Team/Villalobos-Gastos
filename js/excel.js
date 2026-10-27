// Diseño del comprobante de gastos con el mismo acomodo que el bloque de "CUENTAS AGENCIA ADUANAL V.xlsx"
// (columnas B a K, mismos anchos, fuentes y bordes medianos). El diseño se arma una sola vez y de él
// salen el Excel (aquí) y el PDF (pdf.js), para que los dos queden idénticos.
(function (global) {
  const FMT_PESOS = '_-"$"* #,##0.00_-;\\-"$"* #,##0.00_-;_-"$"* "-"??_-;_-@_-';
  const ANCHOS = { A: 5.14, B: 3.29, C: 13.29, D: 21.14, E: 14.57, F: 11.29, G: 17.43, H: 5.86, I: 14.71, J: 10.86, K: 19, L: 3.43 };
  const ALTO_FILA = 12.75;
  const LOGO = { col: 2, fila: 0.3, ancho: 92, alto: 89 }; // posición en celdas (base 0) y tamaño en px

  const columna = (letra) => letra.charCodeAt(0) - 64; // A -> 1

  // Devuelve { celdas, alturas, recuadros, ultimaFila }. Cada celda: { fila, col, valor, estilo }.
  function diseno(c) {
    const t = Cuenta.calcular(c);
    const celdas = [];
    const alturas = {};
    const recuadros = [];

    const poner = (ref, valor, estilo = {}) => {
      const [, letra, fila] = ref.match(/^([A-Z])(\d+)$/);
      celdas.push({ fila: Number(fila), col: columna(letra), valor, estilo: { fuente: 'Arial', tam: 9, b: true, ...estilo } });
    };
    const dinero = (ref, valor, tam = 9) => poner(ref, valor, { fmt: FMT_PESOS, tam });
    const alto = (fila, h) => { alturas[fila] = h; };
    const recuadro = (f1, c1, f2, c2) => recuadros.push({ f1, c1, f2, c2 });

    // ---------- Encabezado de la agencia ----------
    let r = 2;
    alto(r - 1, 32.25);
    alto(r, 33);
    poner(`E${r}`, 'AGENCIA ADUANAL VILLALOBOS S.C.', { tam: 18 });
    poner(`F${r + 1}`, ' A.A. Constantino Villalobos Sánchez', { tam: 10 });
    poner(`G${r + 2}`, 'Patente 2043', { tam: 10 });
    const dirAgencia = ['Sinaloa No 129 Desp 401', 'Col. Peñón de los Baños', 'Del. Venustiano Carranza', 'CP 15520 México, D.F.', 'RFC AAV2011279Q7'];
    dirAgencia.forEach((txt, i) => poner(`B${r + 3 + i}`, txt, { fuente: 'Albertus Medium', tam: 8 }));
    poner(`J${r + 4}`, '                               ISO 9001: 2008', { tam: 7, b: false });
    poner(`J${r + 5}`, '                            No de Cert 84876', { tam: 7, b: false });
    poner(`J${r + 6}`, 'Teléfonos : ', { fuente: 'Albertus Medium', tam: 7 });
    ['55 5784 2327', '55 5762 3141', '55 5784 2264'].forEach((tel, i) => poner(`K${r + 6 + i}`, tel, { tam: 8, b: false }));
    poner(`B${r + 8}`, 'COMPROBANTE DE GASTOS NO', { tam: 8 });
    alto(r + 9, 18);
    poner(`C${r + 9}`, numeroOTexto(c.numero), { tam: 14, al: 'center', fmt: '0' });
    poner(`F${r + 10}`, `${c.lugar} ${c.fecha}`.trim(), { tam: 10, b: false });
    poner(`J${r + 10}`, 'Contacto : información@jargeco.com.mx', { tam: 8, b: false });
    alto(r + 11, 13.5);

    // ---------- Datos del cliente ----------
    r += 12; // fila del borde superior
    recuadro(r, 2, r + 6, 11);
    alto(r + 6, 13.5);
    poner(`C${r + 1}`, 'Comprobación de Gastos a Favor de :', { tam: 8, b: false });
    poner(`J${r + 1}`, 'R.F.C. :', { fuente: 'Verdana', tam: 7, b: false });
    poner(`K${r + 1}`, c.cliente.rfc, { tam: 9 });
    poner(`C${r + 3}`, c.cliente.nombre, { tam: 9 });
    poner(`J${r + 3}`, 'Guía No. :', { tam: 7, b: false });
    poner(`K${r + 3}`, c.guia, { tam: 9, al: 'left' });
    poner(`C${r + 4}`, c.cliente.dom1, { tam: 9 });
    if (c.guiaHouse) poner(`K${r + 4}`, c.guiaHouse, { tam: 9, al: 'left' });
    poner(`C${r + 5}`, c.cliente.dom2, { tam: 9 });
    poner(`J${r + 5}`, 'COVE:', { tam: 7, b: false });
    poner(`K${r + 5}`, c.cove, { tam: 9, al: 'left' });

    // ---------- Gastos pagados a nombre del cliente ----------
    r += 8;
    poner(`C${r}`, `REGIMEN: ${c.regimen}`, { tam: 9 });
    if (c.mercancia) poner(`C${r + 1}`, c.mercancia, { tam: 9, al: 'left' });
    r += 3;
    const primeraGasto = r;
    poner(`C${r}`, 'IMPUESTOS Y DER SOBRE PEDIMENTO', { tam: 9 });
    poner(`F${r}`, c.pedimento, { tam: 9 });
    dinero(`K${r}`, Number(c.impuestos) || 0);
    for (const fila of Cuenta.renglonesGastos(c)) {
      r += 1;
      poner(`C${r}`, fila.concepto, { tam: 9 });
      if (fila.referencia) poner(`F${r}`, fila.referencia, { tam: 9 });
      dinero(`K${r}`, fila.importe);
    }
    const ultimaGasto = r;
    r += 2;
    poner(`D${r}`, 'GASTOS PAGADOS A NOMBRE DEL CLIENTE SIN IVA', { tam: 9 });
    dinero(`I${r}`, t.sinIva);
    poner(`D${r + 1}`, 'TOTAL DE IVA PAGADO A NOMBRE DEL CLIENTE', { tam: 9 });
    dinero(`I${r + 1}`, t.iva);
    poner(`D${r + 2}`, 'SUMA DE GASTOS PAGADOS A NOMBRE DEL CLIENTE', { tam: 9 });
    dinero(`I${r + 2}`, { formula: `SUM(K${primeraGasto}:K${ultimaGasto})`, result: t.sumaGastos });
    const filaSumaGastos = r + 2;

    // ---------- Ingresos de la agencia (honorarios) ----------
    r += 5;
    alto(r - 1, 13.5);
    const iniHon = r;
    poner(`C${r + 1}`, 'Ingresos de Agencia Aduanal Villalobos S.C. CFDI    No.', { tam: 8, b: false });
    alto(r + 1, 15.75);
    poner(`I${r + 1}`, numeroOTexto(c.cfdiNo), { tam: 12, al: 'center', fmt: '0' });
    r += 3;
    const primeraHon = r;
    for (const h of Cuenta.HONORARIOS) {
      const v = c.honorarios[h.clave];
      poner(`C${r}`, h.etiqueta, { tam: 9 });
      if (v.ref) poner(`F${r}`, v.ref, { tam: 9 });
      dinero(`K${r}`, Number(v.importe) || 0);
      r += 1;
    }
    const ultimaHon = r - 1;
    poner(`E${r}`, 'SUMA DE HONORARIOS Y COMPLEMENTARIOS', { tam: 9 });
    dinero(`I${r + 1}`, { formula: `SUM(K${primeraHon}:K${ultimaHon})`, result: t.honorarios });
    const filaSumaHon = r + 1;
    r += 2;
    alto(r, 13.5);
    recuadro(iniHon, 2, r, 11);

    // ---------- Pie: resumen, importe con letra y totales ----------
    r += 2;
    poner(`B${r}`, c.lineaResumen || Cuenta.lineaResumen(c, t), { tam: 9 });
    poner(`B${r + 1}`, c.lineaLetra || Letras.importeConLetra(t.total), { tam: 9 });
    alto(r + 1, 13.5);
    r += 2;
    const iniTot = r;
    const fSub = r + 1, fIva = r + 2, fTot = r + 4, fAnt = r + 5, fSaldo = r + 6;
    poner(`I${fSub}`, 'SUBTOTAL:', { tam: 9 });
    dinero(`K${fSub}`, { formula: `I${filaSumaHon}+I${filaSumaGastos}`, result: t.subtotal });
    poner(`F${fIva}`, 'Oficinas en :', { tam: 9 });
    poner(`I${fIva}`, 'I.V.A.:16%', { tam: 9 });
    dinero(`K${fIva}`, { formula: `ROUND(I${filaSumaHon}*0.16,2)`, result: t.ivaHonorarios });
    poner(`I${r + 3}`, '-------------------', { tam: 9 });
    poner(`I${fTot}`, 'TOTAL', { tam: 9 });
    dinero(`K${fTot}`, { formula: `K${fIva}+K${fSub}`, result: t.total });
    poner(`I${fAnt}`, 'ANTICIPO', { tam: 9 });
    dinero(`K${fAnt}`, Number(c.anticipo) || 0);
    poner(`I${fSaldo}`, 'SALDO', { tam: 9 });
    dinero(`K${fSaldo}`, { formula: `K${fTot}-K${fAnt}`, result: t.saldo });
    c.oficinas.forEach((of, i) => { if (of) poner(`F${fTot + i}`, of, { tam: 9 }); });
    recuadro(iniTot, 8, fSaldo + 1, 11);
    alto(fSaldo + 1, 13.5);

    return { celdas, alturas, recuadros, ultimaFila: fSaldo + 2 };
  }

  function construirLibro(c) {
    const d = diseno(c);
    const wb = new ExcelJS.Workbook();
    wb.creator = 'Agencia Aduanal Villalobos';
    const ws = wb.addWorksheet(`CUENTA ${c.numero || ''}`.trim(), {
      views: [{ showGridLines: false }],
      pageSetup: {
        paperSize: 1, orientation: 'portrait', fitToPage: true, fitToWidth: 1, fitToHeight: 0,
        margins: { left: 0.43, right: 0.3, top: 0.47, bottom: 0.4, header: 0.3, footer: 0.3 },
      },
    });
    for (const [col, w] of Object.entries(ANCHOS)) ws.getColumn(col).width = w;
    for (const [fila, h] of Object.entries(d.alturas)) ws.getRow(Number(fila)).height = h;

    if (global.LOGO_PNG_BASE64) {
      const img = wb.addImage({ base64: global.LOGO_PNG_BASE64, extension: 'png' });
      ws.addImage(img, { tl: { col: LOGO.col, row: LOGO.fila }, ext: { width: LOGO.ancho, height: LOGO.alto } });
    }
    for (const { fila, col, valor, estilo } of d.celdas) {
      const cel = ws.getCell(fila, col);
      cel.value = valor;
      cel.font = { name: estilo.fuente, size: estilo.tam, bold: estilo.b };
      if (estilo.fmt) cel.numFmt = estilo.fmt;
      if (estilo.al) cel.alignment = { horizontal: estilo.al, vertical: 'middle' };
    }
    // Recuadros con borde mediano
    const borde = { style: 'medium' };
    for (const { f1, c1, f2, c2 } of d.recuadros) {
      for (let f = f1; f <= f2; f++) {
        for (let col = c1; col <= c2; col++) {
          const b = {};
          if (f === f1) b.top = borde;
          if (f === f2) b.bottom = borde;
          if (col === c1) b.left = borde;
          if (col === c2) b.right = borde;
          if (Object.keys(b).length) ws.getCell(f, col).border = { ...ws.getCell(f, col).border, ...b };
        }
      }
    }
    ws.pageSetup.printArea = `A1:L${d.ultimaFila}`;
    return wb;
  }

  // El número de cuenta y el folio van como número cuando son solo dígitos (igual que en el formato)
  function numeroOTexto(v) {
    const s = String(v ?? '').trim();
    return /^\d+$/.test(s) ? Number(s) : s;
  }

  function nombreArchivo(c, extension) {
    const nombreCliente = (c.cliente.nombre || 'cliente').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, ' ').trim();
    return `Cuenta ${c.numero || 'sin numero'} ${nombreCliente}.${extension}`;
  }

  function bajarBlob(blob, nombre) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = nombre;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }

  async function descargar(c) {
    const buffer = await construirLibro(c).xlsx.writeBuffer();
    const nombre = nombreArchivo(c, 'xlsx');
    bajarBlob(new Blob([buffer], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), nombre);
    return nombre;
  }

  global.ExcelCuenta = { construirLibro, descargar, diseno, nombreArchivo, bajarBlob, ANCHOS, ALTO_FILA, LOGO, FMT_PESOS };
})(this);
