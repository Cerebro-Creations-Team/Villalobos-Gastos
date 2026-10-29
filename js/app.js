// Interfaz: carga de documentos, llenado automático, revisión y descarga.
(function () {
  const PDF_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
  const CLAVE_BORRADOR = 'vg-borrador';
  const CLAVE_CLIENTES = 'vg-clientes';
  const CLAVE_PROVEEDORES = 'vg-proveedores';
  const CLAVE_FORMATO = 'vg-formato';
  const CLAVE_HISTORIAL = 'vg-historial';

  const $ = (sel, raiz = document) => raiz.querySelector(sel);
  const $$ = (sel, raiz = document) => Array.from(raiz.querySelectorAll(sel));
  let contador = 0;
  const nuevoId = () => `${Date.now().toString(36)}-${(contador++).toString(36)}`;

  // ---------- Almacenamiento local (puede no estar disponible) ----------
  const leerLocal = (clave, def) => {
    try { const v = localStorage.getItem(clave); return v ? JSON.parse(v) : def; } catch { return def; }
  };
  const guardarLocal = (clave, valor) => {
    try { localStorage.setItem(clave, JSON.stringify(valor)); } catch { /* sin almacenamiento */ }
  };

  const formato = () => Object.assign({}, Cuenta.FORMATO_BASE, leerLocal(CLAVE_FORMATO, {}));
  const recordarFormato = () => guardarLocal(CLAVE_FORMATO, {
    etiquetaFlete: cuenta.etiquetaFlete, minOtros: cuenta.minOtros, oficinas: cuenta.oficinas,
  });

  let cuenta = Object.assign(Cuenta.cuentaVacia(formato()), leerLocal(CLAVE_BORRADOR, {}));
  let docs = [];
  let docSeleccionado = null;
  const camposAuto = new Set();

  const clientes = () => leerLocal(CLAVE_CLIENTES, {});
  const proveedores = () => Object.assign({}, Cuenta.PROVEEDORES_BASE, leerLocal(CLAVE_PROVEEDORES, {}));

  // ---------- Utilidades ----------
  const aNumero = (v) => {
    const n = parseFloat(String(v ?? '').replace(/[$,\s]/g, ''));
    return Number.isFinite(n) ? n : 0;
  };
  const fmt = (v) => Cuenta.dinero(v);
  const fmtCampo = (v) => (aNumero(v) ? fmt(v) : '');
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));

  function leerRuta(obj, ruta) {
    return ruta.split('.').reduce((o, k) => (o == null ? o : o[k]), obj);
  }
  function ponerRuta(obj, ruta, valor) {
    const partes = ruta.split('.');
    const ultimo = partes.pop();
    const destino = partes.reduce((o, k) => o[k], obj);
    destino[ultimo] = valor;
  }
  const vacio = (v) => v === '' || v == null || v === 0;
  function ponerSiVacio(ruta, valor) {
    if (vacio(valor) || !vacio(leerRuta(cuenta, ruta))) return;
    ponerRuta(cuenta, ruta, valor);
    camposAuto.add(ruta);
  }

  let temporizadorAviso;
  function aviso(msg) {
    const el = $('#aviso');
    // Con la ventana del historial abierta, el aviso tiene que ir dentro de ella para verse encima
    const dlg = $('#historial');
    (dlg.open ? dlg : document.body).appendChild(el);
    el.textContent = msg;
    el.classList.add('ver');
    clearTimeout(temporizadorAviso);
    temporizadorAviso = setTimeout(() => el.classList.remove('ver'), 3500);
  }

  // ---------- PDF (texto con pdf.js) ----------
  let pdfListo = null;
  function prepararPdf() {
    if (!window.pdfjsLib) return Promise.resolve(false);
    if (!pdfListo) {
      // El worker se carga como blob para que funcione igual abriendo el archivo local o desde un servidor
      pdfListo = fetch(PDF_WORKER)
        .then((r) => r.text())
        .then((codigo) => { pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([codigo], { type: 'text/javascript' })); })
        .catch(() => { pdfjsLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; })
        .then(() => true);
    }
    return pdfListo;
  }

  async function textoDePDF(archivo) {
    if (!(await prepararPdf())) return null;
    const pdf = await pdfjsLib.getDocument({ data: await archivo.arrayBuffer() }).promise;
    let texto = '';
    for (let p = 1; p <= pdf.numPages; p++) {
      const contenido = await (await pdf.getPage(p)).getTextContent();
      texto += lineasPorPosicion(contenido.items) + '\n';
    }
    return { texto, paginas: pdf.numPages };
  }

  // pdf.js entrega el texto en el orden en que se dibujó, que en formatos como el pedimento separa
  // cada etiqueta de su valor. Se rearma por renglones según la posición en la página.
  function lineasPorPosicion(items) {
    const piezas = items.filter((i) => i.str && i.str.trim())
      .map((i) => ({ x: i.transform[4], y: i.transform[5], alto: Math.abs(i.transform[3]) || i.height || 8, str: i.str }))
      .sort((a, b) => b.y - a.y || a.x - b.x);
    const renglones = [];
    for (const pz of piezas) {
      const r = renglones[renglones.length - 1];
      if (r && Math.abs(r.y - pz.y) <= Math.min(r.alto, pz.alto) * 0.5) r.piezas.push(pz);
      else renglones.push({ y: pz.y, alto: pz.alto, piezas: [pz] });
    }
    return renglones.map((r) => r.piezas.sort((a, b) => a.x - b.x).map((pz) => pz.str.trim()).join(' ')).join('\n');
  }

  // ---------- Carga de archivos ----------
  const baseNombre = (n) => n.replace(/\.[^.]+$/, '').toLowerCase();

  async function cargarArchivos(lista) {
    const archivos = Array.from(lista).filter((f) => /\.(xml|pdf)$/i.test(f.name));
    if (!archivos.length) { aviso('Solo se aceptan archivos XML y PDF'); return; }
    // Los XML primero: así la factura de Villalobos y los gastos se aplican antes que los datos de los PDF
    archivos.sort((a, b) => (/\.xml$/i.test(a.name) ? 0 : 1) - (/\.xml$/i.test(b.name) ? 0 : 1));
    for (const archivo of archivos) {
      const base = baseNombre(archivo.name);
      let doc = docs.find((d) => d.base === base);
      if (!doc) { doc = { id: nuevoId(), base, xml: null, pdf: null, avisos: [] }; docs.push(doc); }
      try {
        if (/\.xml$/i.test(archivo.name)) await cargarXML(doc, archivo);
        else await cargarPDF(doc, archivo);
      } catch (e) {
        if (docs.includes(doc)) doc.avisos.push(`${archivo.name}: ${e.message}`);
        else aviso(`${archivo.name}: ${e.message}`);
      }
      pintarDocs();
    }
    pintarTodo();
  }

  async function cargarXML(doc, archivo) {
    const cfdi = CFDI.leerCFDI(await archivo.text());
    if (cfdi.uuid && docs.some((d) => d !== doc && d.xml && d.xml.cfdi.uuid === cfdi.uuid)) {
      docs = docs.filter((d) => d !== doc || d.pdf);
      throw new Error('esta factura ya estaba cargada');
    }
    doc.xml = { nombre: archivo.name, cfdi };
    if (cfdi.tipoComprobante !== 'I') {
      doc.avisos.push(`No es factura de ingreso (tipo ${cfdi.tipoComprobante}); no se agregó a la cuenta`);
      return;
    }
    if (cfdi.esVillalobos) aplicarFacturaVillalobos(cfdi);
    else agregarGasto(cfdi, doc.id);
  }

  async function cargarPDF(doc, archivo) {
    const url = URL.createObjectURL(archivo);
    doc.pdf = { nombre: archivo.name, archivo, url, texto: '', escaneado: false, datos: null };
    if (!docSeleccionado) mostrarDoc(doc.id);
    let r = null;
    try { r = await textoDePDF(archivo); } catch { r = null; }
    if (!r) { doc.pdf.sinLectura = true; return; }
    doc.pdf.texto = r.texto;
    doc.pdf.escaneado = r.texto.replace(/\s/g, '').length < 40 * r.paginas;
    // Si el PDF es la representación impresa de un XML ya cargado con otro nombre, se juntan por UUID
    const textoMayus = r.texto.replace(/​/g, '').toUpperCase();
    const gemelo = !doc.xml && docs.find((d) => d !== doc && d.xml && !d.pdf && d.xml.cfdi.uuid && textoMayus.includes(d.xml.cfdi.uuid));
    if (gemelo) {
      gemelo.pdf = doc.pdf;
      docs = docs.filter((d) => d !== doc);
      if (docSeleccionado === doc.id) docSeleccionado = gemelo.id;
      doc = gemelo;
    }
    if (doc.pdf.escaneado) return;
    const d = CFDI.datosDeTextoPDF(r.texto);
    doc.pdf.datos = d;
    ponerSiVacio('impuestos', d.impuestos);
    ponerSiVacio('pais', d.pais);
    ponerSiVacio('guia', d.guia);
    ponerSiVacio('guiaHouse', d.guiaHouse);
    ponerSiVacio('bultos', d.bultos);
    ponerSiVacio('peso', d.peso);
    ponerSiVacio('valorAduana', d.valorAduana);
    ponerSiVacio('pedimento', d.pedimento);
    ponerSiVacio('cove', d.cove);
  }

  function aplicarFacturaVillalobos(f) {
    ponerSiVacio('numero', f.cuentaGastos || f.folio);
    ponerSiVacio('cfdiNo', f.folio);
    ponerSiVacio('fecha', Cuenta.fechaLarga(f.fecha));
    ponerSiVacio('pedimento', f.pedimento);

    const rfc = f.receptor.rfc;
    if (cuenta.cliente.rfc !== rfc) {
      const guardado = clientes()[rfc];
      const dom = f.domicilio;
      const n = Cuenta.normalizar;
      cuenta.cliente = {
        rfc,
        nombre: guardado?.nombre || f.receptor.nombre,
        // Sin catálogo se arma como en la cuenta 127: "LAURO VILLAR NO.94-B COL. PROVIDENCIA" / "AZCAPOTZALCO CIUDAD DE MEXICO C.P.02440"
        dom1: guardado?.dom1 || (dom ? n(`${dom.calle} NO.${dom.numero}${dom.interior ? '-' + dom.interior : ''} COL. ${dom.colonia}`) : ''),
        dom2: guardado?.dom2 || (dom ? n([dom.municipio, dom.estado || dom.ciudad, `C.P.${dom.cp}`].filter(Boolean).join(' ')) : ''),
      };
      ['cliente.rfc', 'cliente.nombre', 'cliente.dom1', 'cliente.dom2'].forEach((c) => camposAuto.add(c));
    }

    // Honorarios: se reemplazan con lo que trae la factura; las referencias capturadas se conservan
    for (const h of Cuenta.HONORARIOS) cuenta.honorarios[h.clave].importe = 0;
    const otros = [];
    for (const c of f.conceptos) {
      const clave = Cuenta.claveHonorario(c.descripcion);
      cuenta.honorarios[clave].importe = Math.round((cuenta.honorarios[clave].importe + c.importe) * 100) / 100;
      // Un concepto que no es de los renglones fijos se anota como referencia de OTROS CARGOS (salvo que se llame así)
      if (clave === 'otros' && Cuenta.normalizar(c.descripcion) !== 'OTROS CARGOS') otros.push(Cuenta.normalizar(c.descripcion));
      camposAuto.add(`honorarios.${clave}.importe`);
    }
    if (otros.length) cuenta.honorarios.otros.ref = otros.join(', ');
    // Referencias más comunes en su libro de cuentas: honorarios de $5,000 llevan "TARIFA MINIMA" (82%)
    // y gastos varios con importe llevan "VUCEM" (78%). Se proponen solo si el campo está vacío.
    const h = cuenta.honorarios;
    if (!h.honorarios.ref && h.honorarios.importe === 5000) h.honorarios.ref = 'TARIFA MINIMA';
    if (!h.varios.ref && h.varios.importe > 0) h.varios.ref = 'VUCEM';
    cuenta.cfdiTotal = f.total;
    cuenta.cfdiRfcCliente = rfc;
  }

  function adivinarConcepto(f) {
    const texto = Cuenta.normalizar(f.conceptos.map((c) => c.descripcion).join(' '));
    if (texto.includes('ALMACENAJE')) return 'ALMACENAJES';
    if (texto.includes('FLETE')) return 'FLETE';
    if (/MANIOBRA|DESCONSOLIDA|MANEJO/.test(texto)) return 'GASTOS DE MANIOBRAS';
    return 'OTROS GASTOS';
  }

  const folioTexto = (f) => (f.serie ? `${f.serie}-${f.folio}` : `F/${f.folio}`);

  function agregarGasto(f, docId) {
    if (cuenta.gastos.some((g) => g.uuid && g.uuid === f.uuid)) return;
    const catalogo = proveedores();
    const prov = catalogo[claveProveedor(f.emisor.rfc, f.serie)] || catalogo[f.emisor.rfc];
    cuenta.gastos.push({
      id: nuevoId(), docId, uuid: f.uuid,
      concepto: prov?.concepto || adivinarConcepto(f),
      referencia: !prov || prov.ref === 'folio' ? folioTexto(f) : prov.ref,
      importe: f.total, iva: f.iva,
      origen: `${f.emisor.nombre} ${folioTexto(f)}`,
      nombreEmisor: f.emisor.nombre, rfcEmisor: f.emisor.rfc, folio: f.folio, serie: f.serie, rfcReceptor: f.receptor.rfc,
    });
  }

  const claveProveedor = (rfc, serie) => (serie ? `${rfc}|${String(serie).toUpperCase()}` : rfc);

  // Si el usuario cambia el renglón o la referencia de una factura, se recuerda para ese proveedor y serie
  function recordarProveedor(g) {
    if (!g.rfcEmisor) return;
    const guardados = leerLocal(CLAVE_PROVEEDORES, {});
    const usaFolio = g.folio && g.referencia.includes(g.folio);
    guardados[claveProveedor(g.rfcEmisor, g.serie)] = { nombre: g.nombreEmisor || g.origen, concepto: g.concepto, ref: usaFolio ? 'folio' : g.referencia };
    guardarLocal(CLAVE_PROVEEDORES, guardados);
  }

  function quitarDoc(id) {
    const doc = docs.find((d) => d.id === id);
    if (!doc) return;
    if (doc.pdf) URL.revokeObjectURL(doc.pdf.url);
    cuenta.gastos = cuenta.gastos.filter((g) => g.docId !== id);
    docs = docs.filter((d) => d.id !== id);
    if (docSeleccionado === id) cerrarVisor();
    pintarTodo();
  }

  // ---------- Pintar documentos y visor ----------
  function pintarDocs() {
    $('#lista-docs').innerHTML = docs.map((d) => {
      const chips = [];
      let info = '';
      const f = d.xml?.cfdi;
      if (f) {
        chips.push(f.esVillalobos ? '<span class="chip chip--oro">Factura Villalobos</span>' : '<span class="chip">Gasto</span>');
        info = `${esc(f.emisor.nombre)} · ${esc(folioTexto(f))} · $${fmt(f.total)}`;
      }
      if (d.pdf) {
        if (d.pdf.escaneado) chips.push('<span class="chip chip--alerta">PDF escaneado · revisar a mano</span>');
        else if (d.pdf.sinLectura) chips.push('<span class="chip chip--alerta">PDF sin leer</span>');
        else chips.push('<span class="chip">PDF</span>');
      }
      if (d.avisos.length) chips.push('<span class="chip chip--error">Aviso</span>');
      const nombre = [d.xml?.nombre, d.pdf?.nombre].filter(Boolean).join(' + ');
      return `<li class="doc${docSeleccionado === d.id ? ' sel' : ''}" data-id="${d.id}">
        <span class="doc__nombre">${esc(nombre)}</span>
        <span class="doc__info">${chips.join('')} ${info}${d.avisos.map((a) => `<br>${esc(a)}`).join('')}</span>
        <span class="doc__acc"><button type="button" class="btn-x" data-quitar="${d.id}" aria-label="Quitar">×</button></span>
      </li>`;
    }).join('');
  }

  function mostrarDoc(id) {
    const d = docs.find((x) => x.id === id);
    if (!d) return;
    docSeleccionado = id;
    $('#visor').hidden = false;
    $('#visor-nombre').textContent = d.pdf?.nombre || d.xml?.nombre || '';
    const paginas = $('#visor-paginas');
    const pre = $('#visor-xml');
    const abrir = $('#visor-abrir');
    if (d.pdf) {
      paginas.hidden = false; pre.hidden = true; abrir.hidden = false;
      abrir.href = d.pdf.url;
      dibujarPDF(d.pdf.archivo, paginas);
    } else {
      paginas.hidden = true; pre.hidden = false; abrir.hidden = true;
      paginas.innerHTML = '';
      const f = d.xml.cfdi;
      pre.textContent = [
        `Emisor:   ${f.emisor.nombre} (${f.emisor.rfc})`,
        `Receptor: ${f.receptor.nombre} (${f.receptor.rfc})`,
        `Factura:  ${folioTexto(f)}   Fecha: ${f.fecha}`,
        `UUID:     ${f.uuid}`,
        '',
        ...f.conceptos.map((c) => `${c.descripcion.padEnd(34)} ${fmt(c.importe).padStart(12)}  IVA ${fmt(c.iva)}`),
        '',
        `Subtotal ${fmt(f.subtotal)}   IVA ${fmt(f.iva)}   Total ${fmt(f.total)} ${f.moneda}`,
        f.observaciones ? `\nObservaciones:\n${f.observaciones}` : '',
      ].join('\n');
    }
    pintarDocs();
  }

  // Dibuja cada página como imagen (no depende del visor de PDF del navegador)
  let dibujoActual = 0;
  async function dibujarPDF(archivo, contenedor) {
    const turno = ++dibujoActual;
    contenedor.innerHTML = '<p>Cargando…</p>';
    if (!(await prepararPdf())) {
      contenedor.innerHTML = '<p>No se pudo cargar el visor. Usa «Abrir en pestaña».</p>';
      return;
    }
    try {
      const pdf = await pdfjsLib.getDocument({ data: await archivo.arrayBuffer() }).promise;
      if (turno !== dibujoActual) return;
      contenedor.innerHTML = '';
      const ancho = Math.max(contenedor.clientWidth - 16, 300);
      for (let p = 1; p <= pdf.numPages; p++) {
        const pagina = await pdf.getPage(p);
        if (turno !== dibujoActual) return;
        const base = pagina.getViewport({ scale: 1 });
        const vista = pagina.getViewport({ scale: (ancho / base.width) * (window.devicePixelRatio || 1) * 1.5 });
        const canvas = document.createElement('canvas');
        canvas.width = vista.width;
        canvas.height = vista.height;
        contenedor.appendChild(canvas);
        await pagina.render({ canvasContext: canvas.getContext('2d'), viewport: vista }).promise;
      }
    } catch {
      if (turno === dibujoActual) contenedor.innerHTML = '<p>No se pudo mostrar este PDF. Usa «Abrir en pestaña».</p>';
    }
  }

  function cerrarVisor() {
    docSeleccionado = null;
    dibujoActual++;
    $('#visor').hidden = true;
    $('#visor-paginas').innerHTML = '';
    pintarDocs();
  }

  // ---------- Pintar formulario ----------
  function llenarCampos() {
    for (const el of $$('[data-bind]')) {
      const ruta = el.dataset.bind;
      const v = leerRuta(cuenta, ruta);
      if (document.activeElement !== el) el.value = 'num' in el.dataset ? fmtCampo(v) : (v ?? '');
      el.classList.toggle('auto', camposAuto.has(ruta));
    }
    for (const r of $$('input[name="modoIva"]')) r.checked = r.value === cuenta.modoIva;
  }

  function pintarGastos() {
    const tbody = $('#tabla-gastos tbody');
    if (!cuenta.gastos.length) {
      tbody.innerHTML = '<tr class="vacio"><td colspan="5">Sube las facturas XML de los proveedores (almacenaje, maniobras…) o agrega renglones a mano.</td></tr>';
      return;
    }
    const opciones = (sel) => Cuenta.CONCEPTOS_GASTO.map((c) => `<option${c === sel ? ' selected' : ''}>${c}</option>`).join('');
    tbody.innerHTML = cuenta.gastos.map((g, i) => `<tr data-i="${i}">
      <td><select data-campo="concepto">${opciones(g.concepto)}</select></td>
      <td><input data-campo="referencia" value="${esc(g.referencia)}"><span class="origen">${esc(g.origen || 'Captura manual')}</span></td>
      <td><input data-campo="importe" class="num" inputmode="decimal" value="${fmtCampo(g.importe)}"></td>
      <td><input data-campo="iva" class="num" inputmode="decimal" value="${fmtCampo(g.iva)}"></td>
      <td><button type="button" class="btn-x" data-borrar="${i}" aria-label="Quitar renglón">×</button></td>
    </tr>`).join('');
  }

  function pintarHonorarios() {
    $('#tabla-hon tbody').innerHTML = Cuenta.HONORARIOS.map((h) => `<tr>
      <td class="etiqueta">${h.etiqueta}</td>
      <td><input data-bind="honorarios.${h.clave}.ref" placeholder="${h.clave === 'honorarios' ? 'TARIFA MINIMA' : h.clave === 'varios' ? 'VUCEM' : ''}"></td>
      <td><input data-bind="honorarios.${h.clave}.importe" data-num class="num" inputmode="decimal"></td>
    </tr>`).join('');
  }

  function pintarCalculos() {
    const t = Cuenta.calcular(cuenta);
    const filas = [
      ['Impuestos del pedimento', cuenta.impuestos],
      ['Otros gastos pagados (con IVA)', t.gastos],
      ['· Gastos sin IVA', t.sinIva],
      ['· IVA de los gastos', t.iva],
      ['Suma de gastos pagados', t.sumaGastos, 'fuerte'],
      ['Honorarios y complementarios', t.honorarios],
      ['Subtotal', t.subtotal],
      ['IVA 16% (sobre honorarios)', t.ivaHonorarios],
      ['Total', t.total, 'fuerte'],
      ['Anticipo', cuenta.anticipo],
      ['Saldo', t.saldo, 'fuerte'],
    ];
    $('#totales').innerHTML = filas.map(([k, v, c]) => `<dt class="${c || ''}">${k}</dt><dd class="${c || ''}">$${fmt(v)}</dd>`).join('');
    $('#linea-resumen').placeholder = Cuenta.lineaResumen(cuenta, t);
    $('#linea-letra').placeholder = Letras.importeConLetra(t.total);
    $('#iva-actual').textContent = `sin IVA $${fmt(t.sinIvaActual)} · IVA $${fmt(t.ivaActual)}`;
    $('#iva-real').textContent = `sin IVA $${fmt(t.gastos - t.ivaReal)} · IVA $${fmt(t.ivaReal)}`;
    pintarRevision(t);
  }

  function pintarRevision(t) {
    const checks = [];
    const ok = (m) => checks.push(['ok', m]);
    const alerta = (m) => checks.push(['alerta', m]);
    const error = (m) => checks.push(['error', m]);

    if (!String(cuenta.numero).trim()) error('Falta el número de comprobante de gastos.');
    if (!cuenta.cliente.rfc) error('Falta el RFC del cliente.');

    if (cuenta.cfdiTotal == null) {
      alerta('No se ha cargado el XML de la factura de Villalobos: captura los honorarios a mano.');
    } else {
      const totalHon = Math.round((t.honorarios + t.ivaHonorarios) * 100) / 100;
      if (Math.abs(totalHon - cuenta.cfdiTotal) < 0.01) ok(`Honorarios + IVA ($${fmt(totalHon)}) coinciden con la factura de Villalobos.`);
      else error(`Honorarios + IVA dan $${fmt(totalHon)}, pero la factura de Villalobos es por $${fmt(cuenta.cfdiTotal)}.`);
    }

    if (!aNumero(cuenta.impuestos)) alerta('Faltan los impuestos del pedimento (cuadro de liquidación → TOTAL).');

    const rfcCliente = cuenta.cliente.rfc.toUpperCase();
    for (const g of cuenta.gastos) {
      if (g.rfcReceptor && rfcCliente && g.rfcReceptor !== rfcCliente) {
        error(`La factura ${g.origen} está a nombre de ${g.rfcReceptor}, no del cliente (${rfcCliente}).`);
      }
    }
    const desdeXML = cuenta.gastos.filter((g) => g.uuid).length;
    if (desdeXML) ok(`${desdeXML} factura(s) de proveedores tomadas de XML.`);

    const pedimentos = new Set([cuenta.pedimento, ...docs.map((d) => d.pdf?.datos?.pedimento)].filter(Boolean));
    if (pedimentos.size > 1) alerta(`Los documentos traen pedimentos distintos: ${[...pedimentos].join(', ')}.`);
    const guias = new Set([cuenta.guia, ...docs.map((d) => d.pdf?.datos?.guia)].filter(Boolean));
    if (guias.size > 1) alerta(`Los documentos traen guías distintas: ${[...guias].join(', ')}.`);

    for (const d of docs) {
      if (d.pdf?.escaneado && !d.xml) alerta(`«${d.pdf.nombre}» es una imagen escaneada: revisa sus importes y captúralos (pedimento, recibos de derechos…).`);
    }

    if (cuenta.modoIva === 'actual' && desdeXML && Math.abs(t.ivaActual - t.ivaReal) >= 0.01) {
      alerta(`El IVA real de las facturas es $${fmt(t.ivaReal)}; con el método actual el formato muestra $${fmt(t.ivaActual)}.`);
    }
    if (!aNumero(cuenta.anticipo)) alerta('No hay anticipo capturado.');
    if (!cuenta.pais) alerta('Falta el país de origen para la línea de resumen.');

    $('#checks').innerHTML = checks.length
      ? checks.map(([c, m]) => `<li class="${c}">${esc(m)}</li>`).join('')
      : '<li>Sube los documentos de la cuenta para revisarla.</li>';
  }

  function pintarTodo() {
    const sel = $('#sel-regimen');
    const regs = Cuenta.REGIMENES.includes(cuenta.regimen) || !cuenta.regimen ? Cuenta.REGIMENES : [...Cuenta.REGIMENES, cuenta.regimen];
    sel.innerHTML = regs.map((r) => `<option${r === cuenta.regimen ? ' selected' : ''}>${r}</option>`).join('');
    pintarDocs();
    pintarGastos();
    llenarCampos();
    pintarCalculos();
    guardarLocal(CLAVE_BORRADOR, cuenta);
  }

  function cambio() {
    pintarCalculos();
    guardarLocal(CLAVE_BORRADOR, cuenta);
  }

  // ---------- Historial de cuentas descargadas ----------
  // Se guardan los datos de la cuenta (no los archivos); el Excel y el PDF se vuelven a generar al pedirlos.
  const historial = () => leerLocal(CLAVE_HISTORIAL, []);
  const idCuenta = (c) => `${(c.cliente.rfc || 'SINRFC').toUpperCase()}-${String(c.numero || '').trim() || 'SN'}`;

  function guardarEnHistorial() {
    const lista = historial();
    const id = idCuenta(cuenta);
    const copia = JSON.parse(JSON.stringify(cuenta));
    const registro = { id, guardado: new Date().toISOString(), cuenta: copia };
    const i = lista.findIndex((h) => h.id === id);
    if (i >= 0) lista.splice(i, 1);
    lista.unshift(registro);
    try {
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(lista));
    } catch {
      aviso('No se pudo guardar en el historial (almacenamiento lleno o bloqueado). Exporta un respaldo.');
    }
  }

  const fechaCorta = (iso) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? '' : d.toLocaleDateString('es-MX', { day: '2-digit', month: '2-digit', year: 'numeric' });
  };

  function pintarHistorial() {
    const lista = historial();
    const q = Cuenta.normalizar($('#historial-buscar').value);
    const visibles = lista.filter((h) => {
      if (!q) return true;
      const c = h.cuenta;
      return Cuenta.normalizar([c.numero, c.cliente.nombre, c.cliente.rfc, c.pedimento, c.fecha].join(' ')).includes(q);
    });
    $('#tabla-historial tbody').innerHTML = visibles.length
      ? visibles.map((h) => {
        const c = h.cuenta;
        return `<tr data-id="${esc(h.id)}">
          <td class="etiqueta">${esc(c.numero)}</td>
          <td>${esc(c.cliente.nombre)}<span class="origen">${esc(c.cliente.rfc)}</span></td>
          <td>${esc(c.pedimento)}</td>
          <td>${esc(c.fecha)}<span class="origen">Guardada ${fechaCorta(h.guardado)}</span></td>
          <td class="num">$${fmt(Cuenta.calcular(c).total)}</td>
          <td class="acciones">
            <button type="button" class="btn btn--chico" data-accion="pdf">PDF</button>
            <button type="button" class="btn btn--chico" data-accion="excel">Excel</button>
            <button type="button" class="btn btn--chico" data-accion="abrir">Abrir</button>
            <button type="button" class="btn-x" data-accion="borrar" aria-label="Borrar del historial">×</button>
          </td>
        </tr>`;
      }).join('')
      : `<tr class="vacio"><td colspan="6">${lista.length ? 'Ninguna cuenta coincide con la búsqueda.' : 'Todavía no hay cuentas guardadas. Se agregan solas al descargar una cuenta en Excel o PDF.'}</td></tr>`;
    $('#historial-info').textContent = `${lista.length} cuenta(s) guardadas`;
  }

  async function accionHistorial(id, accion) {
    const lista = historial();
    const h = lista.find((x) => x.id === id);
    if (!h) return;
    // Las cuentas guardadas con versiones anteriores reciben los campos nuevos con su valor por omisión
    const c = Object.assign(Cuenta.cuentaVacia(formato()), JSON.parse(JSON.stringify(h.cuenta)));
    if (accion === 'pdf') aviso(`Descargado: ${PdfCuenta.descargarPDF(c)}`);
    else if (accion === 'excel') aviso(`Descargado: ${await ExcelCuenta.descargar(c)}`);
    else if (accion === 'abrir') {
      if (!confirm(`¿Abrir la cuenta ${c.numero}? Se reemplaza lo que tienes capturado ahora.`)) return;
      docs.forEach((d) => d.pdf && URL.revokeObjectURL(d.pdf.url));
      docs = [];
      cuenta = c;
      camposAuto.clear();
      cerrarVisor();
      pintarTodo();
      $('#historial').close();
      aviso(`Cuenta ${c.numero} abierta. Los documentos originales no se guardan; vuelve a subirlos si los necesitas.`);
    } else if (accion === 'borrar') {
      if (!confirm(`¿Borrar la cuenta ${c.numero} del historial de esta computadora?`)) return;
      guardarLocal(CLAVE_HISTORIAL, lista.filter((x) => x.id !== id));
      pintarHistorial();
    }
  }

  function exportarRespaldo() {
    const datos = { app: 'villalobos-gastos', version: 1, exportado: new Date().toISOString(), cuentas: historial() };
    const hoy = new Date().toISOString().slice(0, 10);
    ExcelCuenta.bajarBlob(new Blob([JSON.stringify(datos, null, 1)], { type: 'application/json' }), `Respaldo cuentas de gastos ${hoy}.json`);
  }

  async function importarRespaldo(archivo) {
    let datos;
    try { datos = JSON.parse(await archivo.text()); } catch { aviso('El archivo no es un respaldo válido.'); return; }
    const entrantes = Array.isArray(datos?.cuentas) ? datos.cuentas.filter((h) => h && h.id && h.cuenta && h.cuenta.cliente) : null;
    if (datos?.app !== 'villalobos-gastos' || !entrantes) { aviso('El archivo no es un respaldo de esta app.'); return; }
    // Se juntan con lo que ya hay; si la misma cuenta está en los dos, se queda la guardada más reciente
    const porId = new Map(historial().map((h) => [h.id, h]));
    let nuevas = 0;
    for (const h of entrantes) {
      const actual = porId.get(h.id);
      if (!actual) nuevas++;
      if (!actual || String(h.guardado) > String(actual.guardado)) porId.set(h.id, h);
    }
    const lista = [...porId.values()].sort((a, b) => String(b.guardado).localeCompare(String(a.guardado)));
    try {
      localStorage.setItem(CLAVE_HISTORIAL, JSON.stringify(lista));
      aviso(`Respaldo importado: ${nuevas} cuenta(s) nuevas, ${entrantes.length} en el archivo.`);
    } catch {
      aviso('No se pudo guardar el respaldo en esta computadora.');
    }
    pintarHistorial();
  }

  // ---------- Catálogo de clientes desde el Excel de cuentas ----------
  function textoCelda(v) {
    if (v == null) return '';
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((t) => t.text).join('');
      if ('result' in v) return String(v.result ?? '');
      if (v.text) return String(v.text);
    }
    return String(v);
  }

  async function importarClientes(archivo) {
    aviso('Leyendo el Excel de cuentas…');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(await archivo.arrayBuffer());
    const cat = clientes();
    let nuevos = 0;
    wb.eachSheet((ws) => {
      for (let r = 1; r <= ws.rowCount; r++) {
        if (!textoCelda(ws.getCell(r, 3).value).startsWith('Comprobación de Gastos a Favor')) continue;
        const rfc = textoCelda(ws.getCell(r, 11).value).replace(/[\s-]/g, '').toUpperCase();
        if (!/^[A-ZÑ&]{3,4}\d{6}[A-Z0-9]{3}$/.test(rfc) || cat[rfc]) continue;
        cat[rfc] = {
          nombre: textoCelda(ws.getCell(r + 2, 3).value).trim(),
          dom1: textoCelda(ws.getCell(r + 3, 3).value).trim(),
          dom2: textoCelda(ws.getCell(r + 4, 3).value).trim(),
        };
        nuevos++;
      }
    });
    guardarLocal(CLAVE_CLIENTES, cat);
    pintarInfoCatalogos();
    aviso(`${nuevos} cliente(s) nuevos importados`);
  }

  function pintarInfoCatalogos() {
    const nCli = Object.keys(clientes()).length;
    const nProv = Object.keys(proveedores()).length;
    $('#info-catalogos').textContent = `${nCli} cliente(s) y ${nProv} proveedor(es) guardados.`;
  }

  // ---------- Eventos ----------
  function engancharEventos() {
    const drop = $('#drop');
    $('#archivos').addEventListener('change', (e) => { cargarArchivos(e.target.files); e.target.value = ''; });
    ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('activo'); }));
    ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove('activo')));
    drop.addEventListener('drop', (e) => { e.preventDefault(); cargarArchivos(e.dataTransfer.files); });
    // Evita que el navegador abra el archivo si se suelta fuera de la zona
    window.addEventListener('dragover', (e) => e.preventDefault());
    window.addEventListener('drop', (e) => { e.preventDefault(); if (e.target.closest('.drop') == null) cargarArchivos(e.dataTransfer.files); });

    $('#lista-docs').addEventListener('click', (e) => {
      const quitar = e.target.closest('[data-quitar]');
      if (quitar) { quitarDoc(quitar.dataset.quitar); return; }
      const li = e.target.closest('.doc');
      if (li) mostrarDoc(li.dataset.id);
    });
    $('#visor-cerrar').addEventListener('click', cerrarVisor);

    // Campos con data-bind
    document.addEventListener('input', (e) => {
      const el = e.target.closest('[data-bind]');
      if (!el) return;
      const ruta = el.dataset.bind;
      let v = el.value;
      if (el.classList.contains('mayus')) v = v.toUpperCase();
      ponerRuta(cuenta, ruta, 'num' in el.dataset ? aNumero(v) : 'entero' in el.dataset ? parseInt(v, 10) : v);
      camposAuto.delete(ruta);
      el.classList.remove('auto');
      cambio();
    });
    document.addEventListener('change', (e) => {
      if (e.target.matches('[data-bind]') && e.target.tagName === 'SELECT') cambio();
      if (e.target.name === 'modoIva') { cuenta.modoIva = e.target.value; cambio(); }
    });
    document.addEventListener('focusout', (e) => {
      const el = e.target;
      if (el.matches('[data-bind][data-num]')) el.value = fmtCampo(leerRuta(cuenta, el.dataset.bind));
    });

    // Tabla de gastos
    const tbody = $('#tabla-gastos tbody');
    tbody.addEventListener('input', (e) => {
      const tr = e.target.closest('tr[data-i]');
      if (!tr) return;
      const g = cuenta.gastos[Number(tr.dataset.i)];
      const campo = e.target.dataset.campo;
      g[campo] = campo === 'importe' || campo === 'iva' ? aNumero(e.target.value) : e.target.value;
      if (campo === 'concepto' || campo === 'referencia') recordarProveedor(g);
      cambio();
    });
    tbody.addEventListener('focusout', (e) => {
      const campo = e.target.dataset.campo;
      const tr = e.target.closest('tr[data-i]');
      if (tr && (campo === 'importe' || campo === 'iva')) e.target.value = fmtCampo(cuenta.gastos[Number(tr.dataset.i)][campo]);
    });
    tbody.addEventListener('click', (e) => {
      const b = e.target.closest('[data-borrar]');
      if (!b) return;
      cuenta.gastos.splice(Number(b.dataset.borrar), 1);
      pintarGastos();
      cambio();
    });
    const agregarManual = (concepto, referencia) => {
      cuenta.gastos.push({ id: nuevoId(), concepto, referencia, importe: 0, iva: 0, origen: '' });
      pintarGastos();
      cambio();
      const filas = $$('#tabla-gastos tbody tr');
      filas[filas.length - 1]?.querySelector('[data-campo="importe"]')?.focus();
    };
    $('#btn-derechos').addEventListener('click', () => agregarManual('OTROS GASTOS', 'DERECHOS'));
    $('#btn-gasto').addEventListener('click', () => agregarManual('OTROS GASTOS', ''));

    $('#btn-nueva').addEventListener('click', () => {
      if (!confirm('¿Empezar una cuenta nueva? Se borran los datos capturados y los documentos cargados.')) return;
      docs.forEach((d) => d.pdf && URL.revokeObjectURL(d.pdf.url));
      docs = [];
      cuenta = Cuenta.cuentaVacia(formato());
      camposAuto.clear();
      cerrarVisor();
      pintarTodo();
    });

    // Al descargar se recuerdan el cliente y el acomodo usado
    const recordarAlDescargar = () => {
      if (cuenta.cliente.rfc) {
        const cat = clientes();
        const { nombre, dom1, dom2 } = cuenta.cliente;
        cat[cuenta.cliente.rfc.toUpperCase()] = { nombre, dom1, dom2 };
        guardarLocal(CLAVE_CLIENTES, cat);
        pintarInfoCatalogos();
      }
      recordarFormato();
      guardarEnHistorial();
    };
    $('#btn-excel').addEventListener('click', async () => {
      if (!window.ExcelJS) { aviso('No se pudo cargar la librería de Excel. Revisa la conexión a internet.'); return; }
      recordarAlDescargar();
      const nombre = await ExcelCuenta.descargar(cuenta);
      aviso(`Descargado: ${nombre}`);
    });
    $('#btn-pdf').addEventListener('click', () => {
      if (!window.jspdf) { aviso('No se pudo cargar la librería de PDF. Revisa la conexión a internet.'); return; }
      recordarAlDescargar();
      const nombre = PdfCuenta.descargarPDF(cuenta);
      aviso(`Descargado: ${nombre}`);
    });

    const dlg = $('#historial');
    $('#btn-historial').addEventListener('click', () => {
      $('#historial-buscar').value = '';
      pintarHistorial();
      dlg.showModal();
    });
    $('#historial-cerrar').addEventListener('click', () => dlg.close());
    dlg.addEventListener('click', (e) => { if (e.target === dlg) dlg.close(); }); // clic fuera de la ventana
    $('#historial-buscar').addEventListener('input', pintarHistorial);
    $('#tabla-historial tbody').addEventListener('click', (e) => {
      const b = e.target.closest('[data-accion]');
      if (b) accionHistorial(b.closest('tr').dataset.id, b.dataset.accion).catch((err) => aviso(`No se pudo: ${err.message}`));
    });
    $('#historial-exportar').addEventListener('click', exportarRespaldo);
    $('#historial-importar').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importarRespaldo(f);
    });

    $('#importar-clientes').addEventListener('change', (e) => {
      const f = e.target.files[0];
      e.target.value = '';
      if (f) importarClientes(f).catch((err) => aviso(`No se pudo leer el Excel: ${err.message}`));
    });
  }

  pintarHonorarios();
  engancharEventos();
  pintarTodo();
  pintarInfoCatalogos();

  // Para pruebas desde la consola
  window.App = { cargarArchivos, estado: () => cuenta, documentos: () => docs };
})();
