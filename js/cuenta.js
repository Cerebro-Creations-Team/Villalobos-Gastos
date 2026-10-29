// Modelo de la cuenta de gastos: catálogos, cálculo de totales y orden de renglones.
(function (global) {
  const CONCEPTOS_GASTO = ['FLETE AEREO', 'FLETE', 'FLETE TERRESTRE', 'ALMACENAJES', 'GASTOS DE MANIOBRAS', 'OTROS GASTOS'];

  const HONORARIOS = [
    { clave: 'honorarios', etiqueta: 'HONORARIOS AGENTE ADUANAL', palabras: ['HONORARIO'] },
    { clave: 'complementarios', etiqueta: 'SERVICIO COMPLEMENTARIOS', palabras: ['COMPLEMENTARIO'] },
    { clave: 'preferente', etiqueta: 'SERVICIO PREFERENTE', palabras: ['PREFERENTE'] },
    { clave: 'asesoria', etiqueta: 'ASESORIA TECNICA', palabras: ['ASESORIA'] },
    { clave: 'pedimento', etiqueta: 'DOCUMENTO-PEDIMENTO-ADUANAL', palabras: ['PEDIMENTO', 'DOCUMENTO'] },
    { clave: 'contraprestacion', etiqueta: 'CONTRAPRESTACION', palabras: ['CONTRAPRESTACION'] },
    { clave: 'varios', etiqueta: 'GASTOS VARIOS', palabras: ['GASTOS VARIOS'] },
    { clave: 'otros', etiqueta: 'OTROS CARGOS', palabras: [] },
  ];

  const REGIMENES = [
    'IMPORTACION DEFINITIVA', 'EXPORTACION DEFINITIVA', 'IMPORTACION TEMPORAL',
    'RETORNO DE MERCANCIA', 'IMPORTACION RECINTO FISCALIZADO',
  ];

  // Proveedores conocidos: en qué renglón van y qué referencia llevan.
  // ref: 'folio' -> "Serie-Folio" de la factura; cualquier otro texto se usa tal cual.
  // TME aparece igual de seguido en ALMACENAJES (con su folio) que en GASTOS DE MANIOBRAS ("TME04").
  // La clave es el RFC, o "RFC|SERIE" cuando un mismo proveedor manda facturas que van a renglones distintos
  // (FedEx: MEXIFA es revalidación de guía, BTLC es el tránsito desde Toluca).
  const PROVEEDORES_BASE = {
    BTC920330IPA: { nombre: 'TALMA SERVICIOS DE CARGA', concepto: 'ALMACENAJES', ref: 'TALMA' },
    'FEH940630UG2|MEXIFA': { nombre: 'FEDERAL EXPRESS HOLDINGS (MEXICO)', concepto: 'GASTOS DE MANIOBRAS', ref: 'REVALIDACION' },
    'FEH940630UG2|BTLC': { nombre: 'FEDERAL EXPRESS HOLDINGS (MEXICO)', concepto: 'OTROS GASTOS', ref: 'TRANSITO' },
    AAM401115988: { nombre: 'TME RECINTO FISCALIZADO', concepto: 'ALMACENAJES', ref: 'folio' },
    MCH070116DN9: { nombre: 'MEXICO CARGO HANDLING', concepto: 'GASTOS DE MANIOBRAS', ref: 'DESCONSOLIDACION' },
    DIBN800222GL7: { nombre: 'NORMAN DIAZ BERRY', concepto: 'OTROS GASTOS', ref: 'CUSTODIA' },
    SER170905QZ7: { nombre: 'SERMANTRAN', concepto: 'OTROS GASTOS', ref: 'MONTACARGAS' },
  };

  // Preferencias del acomodo que cambian de una cuenta a otra; la app recuerda las últimas usadas.
  // Valores iniciales tomados de la cuenta más reciente de referencia (127, Coramex, octubre 2026)
  const FORMATO_BASE = {
    etiquetaFlete: 'FLETE',
    minOtros: 2,
    oficinas: ['Ciudad de México, Pantaco', 'AIFA, Estado de México', 'Veracruz, Veracruz'],
  };

  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto',
    'septiembre', 'octubre', 'noviembre', 'diciembre'];

  const normalizar = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().trim();
  const centavos = (v) => Math.round((Number(v) || 0) * 100);
  const pesos = (c) => c / 100;

  function cuentaVacia(formato = FORMATO_BASE) {
    return {
      numero: '', lugar: 'Ciudad de México', fecha: '',
      cliente: { nombre: '', rfc: '', dom1: '', dom2: '' },
      guia: '', guiaHouse: '', cove: '', regimen: 'IMPORTACION DEFINITIVA', mercancia: '',
      pedimento: '', impuestos: 0,
      gastos: [],
      honorarios: Object.fromEntries(HONORARIOS.map((h) => [h.clave, { importe: 0, ref: '' }])),
      cfdiNo: '', cfdiTotal: null,
      bultos: '', peso: '', pais: '', valorAduana: '',
      anticipo: 0,
      modoIva: 'actual',
      lineaResumen: '', lineaLetra: '', // vacías = se generan solas
      etiquetaFlete: formato.etiquetaFlete,
      minOtros: formato.minOtros,
      oficinas: [...formato.oficinas],
    };
  }

  function claveHonorario(descripcion) {
    const d = normalizar(descripcion);
    const h = HONORARIOS.find((x) => x.palabras.some((p) => d.includes(p)));
    return h ? h.clave : 'otros';
  }

  // "2026-10-29T12:49:02" -> "29 de octubre del 2026"
  function fechaLarga(iso) {
    const m = String(iso || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    return `${Number(m[3])} de ${MESES[Number(m[2]) - 1]} del ${m[1]}`;
  }

  function calcular(c) {
    const gastosC = c.gastos.reduce((s, g) => s + centavos(g.importe), 0);
    const ivaRealC = c.gastos.reduce((s, g) => s + centavos(g.iva), 0);
    const impuestosC = centavos(c.impuestos);
    const sumaGastosC = impuestosC + gastosC;

    // Método actual del formato: los gastos (sin el pedimento) se tratan como si todos llevaran 16%,
    // truncando el importe sin IVA al centavo. Así salen 9,296.89 / 1,487.51 en la cuenta 118.
    const sinIvaActualC = Math.floor((gastosC * 100) / 116);
    const sinIvaC = c.modoIva === 'real' ? gastosC - ivaRealC : sinIvaActualC;
    const ivaC = gastosC - sinIvaC;

    const honorariosC = HONORARIOS.reduce((s, h) => s + centavos(c.honorarios[h.clave].importe), 0);
    const subtotalC = honorariosC + sumaGastosC;
    const ivaHonC = Math.round(honorariosC * 0.16);
    const totalC = subtotalC + ivaHonC;
    const saldoC = totalC - centavos(c.anticipo);

    return {
      gastos: pesos(gastosC), // sin pedimento
      sinIva: pesos(sinIvaC), iva: pesos(ivaC),
      ivaReal: pesos(ivaRealC), sinIvaActual: pesos(sinIvaActualC), ivaActual: pesos(gastosC - sinIvaActualC),
      sumaGastos: pesos(sumaGastosC),
      honorarios: pesos(honorariosC), ivaHonorarios: pesos(ivaHonC),
      subtotal: pesos(subtotalC), total: pesos(totalC), saldo: pesos(saldoC),
    };
  }

  // Renglones de gastos en el orden del formato. Siempre aparecen flete, almacenajes y maniobras
  // (en ceros si no hay), y al menos c.minOtros renglones de OTROS GASTOS.
  function renglonesGastos(c) {
    const filas = [];
    const grupos = [
      { nombres: ['FLETE AEREO', 'FLETE', 'FLETE TERRESTRE'], vacio: c.etiquetaFlete || 'FLETE AEREO', minimo: 1 },
      { nombres: ['ALMACENAJES'], vacio: 'ALMACENAJES', minimo: 1 },
      { nombres: ['GASTOS DE MANIOBRAS'], vacio: 'GASTOS DE MANIOBRAS', minimo: 1 },
      { nombres: ['OTROS GASTOS'], vacio: 'OTROS GASTOS', minimo: Number(c.minOtros) || 0 },
    ];
    for (const g of grupos) {
      const del = c.gastos.filter((x) => g.nombres.includes(x.concepto));
      for (const x of del) filas.push({ concepto: x.concepto, referencia: x.referencia, importe: Number(x.importe) || 0 });
      for (let i = del.length; i < g.minimo; i++) filas.push({ concepto: g.vacio, referencia: '', importe: 0 });
    }
    return filas;
  }

  const dinero = (v) => (Number(v) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  // Formato de la cuenta 127: 02B* 18.400KG* "ITA" VM. $499,870.00MN* IMP. $85,001.00MN* GTOS $13,431.60MN*
  function lineaResumen(c, t) {
    const bultos = String(parseInt(c.bultos, 10) || 0).padStart(2, '0');
    const peso = (parseFloat(String(c.peso).replace(/,/g, '')) || 0).toFixed(3);
    const pais = (c.pais || '').trim().toUpperCase();
    const va = parseFloat(String(c.valorAduana).replace(/,/g, '')) || 0;
    return `${bultos}B* ${peso}KG* ${pais ? `"${pais}" ` : ''}VM. $${dinero(va)}MN* IMP. $${dinero(c.impuestos)}MN* GTOS $${dinero(t.gastos)}MN*`;
  }

  const api = {
    CONCEPTOS_GASTO, HONORARIOS, REGIMENES, PROVEEDORES_BASE, FORMATO_BASE,
    cuentaVacia, claveHonorario, fechaLarga, calcular, renglonesGastos, lineaResumen, normalizar, dinero,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.Cuenta = api;
})(this);
