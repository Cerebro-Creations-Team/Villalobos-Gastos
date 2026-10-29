// Lectura de CFDI 3.3 / 4.0 (XML) y de texto de PDFs (representaciones impresas).
(function (global) {
  const RFC_VILLALOBOS = 'AAV2011279Q7';

  const num = (v) => {
    const n = parseFloat(String(v ?? '').replace(/,/g, ''));
    return Number.isFinite(n) ? n : 0;
  };

  // Primer elemento con ese nombre local, sin importar el prefijo (cfdi:, tfd:, compac:...)
  const uno = (raiz, nombre) => raiz.getElementsByTagNameNS('*', nombre)[0] || null;
  const todos = (raiz, nombre) => Array.from(raiz.getElementsByTagNameNS('*', nombre));
  const attr = (el, nombre) => (el ? el.getAttribute(nombre) || '' : '');

  // "47-2043-6200087", "2043-6200087", "26 47 2043 6200087" -> "2043-6200087"
  function buscarPedimento(texto) {
    const m = texto.match(/PEDIMENTO[^\d]{0,20}(?:\d{2}[\s-]+)?(?:\d{2}[\s-]+)?(\d{4})[\s-]+(\d{7})\b/i)
      || texto.match(/\b(\d{4})-(\d{7})\b/);
    return m ? `${m[1]}-${m[2]}` : '';
  }

  function leerCFDI(xmlTexto) {
    const doc = new DOMParser().parseFromString(xmlTexto, 'application/xml');
    if (doc.getElementsByTagName('parsererror').length) throw new Error('El archivo no es un XML válido');
    const comp = uno(doc, 'Comprobante');
    if (!comp) throw new Error('El XML no es un CFDI (no tiene Comprobante)');

    const emisor = uno(comp, 'Emisor');
    const receptor = uno(comp, 'Receptor');
    const timbre = uno(comp, 'TimbreFiscalDigital');
    const tipoCambio = num(attr(comp, 'TipoCambio')) || 1;
    const moneda = attr(comp, 'Moneda') || 'MXN';
    const aMXN = (v) => (moneda === 'MXN' ? v : Math.round(v * tipoCambio * 100) / 100);

    // Impuestos a nivel comprobante (hijo directo, no los de cada concepto)
    const impuestos = Array.from(comp.children).find((e) => e.localName === 'Impuestos');
    const ivaTotal = impuestos ? num(attr(impuestos, 'TotalImpuestosTrasladados')) : 0;
    const retenciones = impuestos ? num(attr(impuestos, 'TotalImpuestosRetenidos')) : 0;

    const conceptos = todos(comp, 'Concepto').map((c) => ({
      clave: attr(c, 'ClaveProdServ'),
      noIdentificacion: attr(c, 'NoIdentificacion'),
      descripcion: attr(c, 'Descripcion'),
      importe: aMXN(num(attr(c, 'Importe')) - num(attr(c, 'Descuento'))),
      iva: aMXN(todos(c, 'Traslado').reduce((s, t) => s + num(attr(t, 'Importe')), 0)),
    }));

    // Observaciones: en las facturas de Villalobos vienen en la addenda de CONTPAQi (cObserva01)
    const addenda = uno(comp, 'Addenda');
    const observaciones = addenda
      ? Array.from(addenda.getElementsByTagName('*')).map((e) => e.getAttribute('cObserva01')).filter(Boolean).join('\n')
      : '';
    const cuentaGastos = (observaciones.match(/COMPROBANTE DE GASTOS\s*(?:NO\.?\s*)?(\d+)/i) || [])[1] || '';

    // Domicilio fiscal del cliente (addenda CONTPAQi), si viene
    const dir = addenda ? Array.from(addenda.getElementsByTagName('*')).find((e) => e.localName === 'DirCteFis') : null;
    const domicilio = dir ? {
      calle: attr(dir, 'cNombreC01'), numero: attr(dir, 'cNumeroE01'), interior: attr(dir, 'cNumeroI01'),
      colonia: attr(dir, 'cColonia'), cp: attr(dir, 'cCodigoP01'), ciudad: attr(dir, 'cCiudad'),
      municipio: attr(dir, 'cMunicipio'), estado: attr(dir, 'cEstado'),
    } : null;

    const rfcEmisor = attr(emisor, 'Rfc').toUpperCase();
    return {
      esVillalobos: rfcEmisor === RFC_VILLALOBOS,
      tipoComprobante: attr(comp, 'TipoDeComprobante'),
      serie: attr(comp, 'Serie'),
      folio: attr(comp, 'Folio'),
      fecha: attr(comp, 'Fecha'),
      uuid: attr(timbre, 'UUID').toUpperCase(),
      moneda, tipoCambio,
      emisor: { rfc: rfcEmisor, nombre: attr(emisor, 'Nombre') },
      receptor: { rfc: attr(receptor, 'Rfc').toUpperCase(), nombre: attr(receptor, 'Nombre') },
      subtotal: aMXN(num(attr(comp, 'SubTotal'))),
      total: aMXN(num(attr(comp, 'Total'))),
      iva: aMXN(ivaTotal),
      retenciones: aMXN(retenciones),
      conceptos,
      observaciones,
      cuentaGastos,
      pedimento: buscarPedimento(observaciones),
      domicilio,
    };
  }

  // Datos de la operación que traen algunas representaciones impresas (TME, MCH, pedimento en texto)
  function datosDeTextoPDF(texto) {
    const t = texto.replace(/​/g, '');
    const primero = (...res) => {
      for (const re of res) { const m = t.match(re); if (m) return m[1].trim(); }
      return '';
    };
    const pedimento = buscarPedimento(t.replace(/Pedimento:\s*0\s*-\s*0+/i, ''));
    // El propio pedimento (forma simplificada o completa) trae el cuadro de liquidación y los datos de la guía
    const esPedimento = /CUADRO DE LIQUIDACI[OÓ]N/i.test(t) && /NUM\.?\s*PEDIMENTO/i.test(t);
    const guiaPed = esPedimento ? t.match(/GUIA\/ORDEN EMBARQUE\)\/ID:\s*([0-9A-Z-]+)\s+M\b(?:\s+([0-9A-Z-]+)\s+H\b)?/i) : null;
    const guia = guiaPed ? guiaPed[1] : primero(/Gu[ií]a\s+Master:\s*([\d][\d\s-]{6,}\d)/i, /Mawb:\s*([\d-]{8,})/i, /Gu[ií]a\s+No\.?\s*:?\s*([\d-]{8,})/i);
    const impuestos = esPedimento ? primero(/CUADRO DE LIQUIDACI[OÓ]N[\s\S]{0,800}?\bTOTAL\s+([\d,]+(?:\.\d+)?)/i) : '';
    // País de origen: columna P. O/D de las partidas (la segunda clave antes de IGI/IGE)
    const paises = esPedimento ? [...t.matchAll(/\b[A-Z]{3}\s+([A-Z]{3})\s+(?:[\d.]+\s+)?IGI\/IGE/g)].map((m) => m[1]) : [];
    // Valor aduana del pedimento: suma de la columna VAL. ADU de las partidas (renglón "499870.00000 499870 14282.01000");
    // la etiqueta "VALOR ADUANA:" no siempre queda en el mismo renglón que su número
    const valoresPartida = esPedimento ? [...t.matchAll(/^(\d+\.\d{5})\s+\d+(?:\.\d+)?\s+\d+\.\d+\s*$/gm)].map((m) => num(m[1])) : [];
    const vaPartidas = valoresPartida.length ? String(Math.round(valoresPartida.reduce((s, v) => s + v, 0) * 100) / 100) : '';
    // RFC del importador (el primero que aparece; el del agente aduanal viene después) y referencia interna (REF: A91)
    const rfcImportador = esPedimento ? (t.match(/Clave en el RFC:\s*([A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3})/) || [])[1] || '' : '';
    const referencia = esPedimento ? (t.match(/\bREF:\s*([A-Z0-9]+)/) || [])[1] || '' : '';
    // Nombre del importador: en el pedimento completo va en el renglón de CURP (vacía en personas morales);
    // en el acuse de la manifestación de valor viene como "Nombre o Razón Social del importador:"
    const nombrePed = (t.match(/RAZON SOCIAL:[ \t]*\n[ \t]*CURP:[ \t]*(?:[A-Z]{4}\d{6}[A-Z0-9]{8}[ \t]+)?([^\n]{3,})/) || [])[1] || '';
    const nombreAcuse = (t.match(/Raz[oó]n Social del importador:[ \t]*([^\n]{3,})/i) || [])[1] || '';
    const nombreImportador = (nombrePed || nombreAcuse).trim();
    return {
      pedimento,
      esPedimento,
      rfcImportador,
      referencia,
      nombreImportador,
      nombreDe: nombrePed ? 'pedimento' : nombreAcuse ? 'acuse de la manifestación de valor' : '',
      impuestos: impuestos ? num(impuestos) : 0,
      pais: [...new Set(paises)].join('/'),
      guia: guia ? normalizarGuia(guia) : '',
      bultos: primero(/Bultos:\s*(\d+)/i, /Piezas:\s*(\d+)/i, /TOTAL DE BULTOS:[^\n]*?(\d+)[ \t]*$/im),
      peso: primero(/Peso\s*\(Kgs\):\s*([\d.,]+)/i, /PESO BRUTO:\s*([\d.,]+)/i, /Peso:\s*([\d.,]+)/i),
      valorAduana: vaPartidas || primero(/Valor\s+Aduana:\s*(\d[\d,]{2,}(?:\.\d+)?)/i),
      guiaHouse: guiaPed && guiaPed[2] ? guiaPed[2] : primero(/Gu[ií]a\s+House:[ \t]*(\d[0-9A-Z/-]{3,})/),
      // En el formato el COVE se escribe sin el prefijo: COVE268CCTKB3 -> 268CCTKB3
      cove: primero(/\bCOVE([0-9A-Z]{9})\b/),
    };
  }

  // "074-4675 9285" -> "074-46759285"
  function normalizarGuia(g) {
    const d = g.replace(/[^\d]/g, '');
    return d.length === 11 ? `${d.slice(0, 3)}-${d.slice(3)}` : g.replace(/\s+/g, '');
  }

  const api = { leerCFDI, datosDeTextoPDF, buscarPedimento, normalizarGuia, RFC_VILLALOBOS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.CFDI = api;
})(this);
