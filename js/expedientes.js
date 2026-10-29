// Modo servidor: inicio de sesión, expedientes por Cliente → Pedimento y cuentas compartidas.
// Si la app se abre sin servidor (GitHub Pages), /api no existe y este módulo no hace nada.
(function () {
  const $ = (sel) => document.querySelector(sel);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const aviso = (m) => window.App.aviso(m);

  let expedientes = [];
  let abierto = null; // expediente que se está viendo en el panel
  let enCuenta = null; // expediente al que pertenece la cuenta que se está capturando

  // ---------- API ----------
  async function api(ruta, opciones = {}) {
    const r = await fetch(`/api${ruta}`, { credentials: 'same-origin', ...opciones });
    if (r.status === 401) { pedirLogin(); throw new Error('La sesión terminó; vuelve a entrar.'); }
    const tipo = r.headers.get('content-type') || '';
    const datos = tipo.includes('json') ? await r.json() : null;
    if (!r.ok) throw new Error(datos?.error || `Error ${r.status}`);
    return datos;
  }
  const json = (metodo, cuerpo) => ({ method: metodo, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });

  async function subirArchivos(expedienteId, archivos, etapa) {
    const fd = new FormData();
    for (const f of archivos) fd.append('archivos', f, f.name);
    return api(`/expedientes/${expedienteId}/archivos?etapa=${etapa}`, { method: 'POST', body: fd });
  }

  async function archivoComoFile(a) {
    const r = await fetch(`/api/archivos/${a.id}`, { credentials: 'same-origin' });
    if (!r.ok) throw new Error(`No se pudo leer ${a.nombre}`);
    return new File([await r.blob()], a.nombre, { type: a.tipo === 'xml' ? 'application/xml' : 'application/pdf' });
  }

  // ---------- Inicio de sesión ----------
  function pedirLogin() {
    const dlg = $('#login');
    if (!dlg.open) dlg.showModal();
    dlg.querySelector('input[name="correo"]').focus();
  }

  async function iniciar() {
    let r;
    try { r = await fetch('/api/yo', { credentials: 'same-origin' }); } catch { return; }
    if (r.status === 404 || !(r.headers.get('content-type') || '').includes('json')) return; // sin servidor
    activarModoServidor();
    if (r.status === 401) { pedirLogin(); return; }
    entrar(await r.json());
  }

  function activarModoServidor() {
    $('#pestanas').hidden = false;
    $('#panel-expedientes').hidden = false;
    $('.nota-privacidad').textContent = 'Los archivos que subas a la cuenta se guardan en el expediente del pedimento abierto.';
    // El respaldo en archivo es para el modo sin servidor; aquí el historial ya es compartido
    $('#historial-exportar').hidden = true;
    $('#historial-importar').closest('label').hidden = true;
    $('#historial > p').textContent = 'Cuentas guardadas en el servidor, compartidas por todo el equipo. Se guardan al descargar una cuenta en Excel o PDF.';
    cambiarPestana('expedientes');

    // Historial compartido en el servidor
    window.App.ganchos.historial = {
      listar: () => api('/cuentas'),
      guardar: (registro) => api(`/cuentas/${encodeURIComponent(registro.id)}`, json('PUT', { cuenta: registro.cuenta, expediente_id: enCuenta?.id })),
      borrar: (id) => api(`/cuentas/${encodeURIComponent(id)}`, { method: 'DELETE' }),
    };
    window.App.ganchos.nombreCliente = (rfc) => (enCuenta && enCuenta.rfc === rfc ? enCuenta.cliente : null);
    // Lo que se suba a la cuenta queda guardado en su expediente. Si todavía no se sabe cuál es,
    // se guardan después de leer la factura de Villalobos (cliente + pedimento).
    window.App.ganchos.alSubirArchivos = (archivos) => {
      if (!enCuenta) { pendientes.push(...archivos); return; }
      guardarEnExpediente(enCuenta, archivos);
    };
    window.App.ganchos.despuesDeCargar = ligarPorPedimento;
  }

  let pendientes = [];
  function guardarEnExpediente(exp, archivos) {
    return subirArchivos(exp.id, archivos, 'cuenta')
      .then(() => cargarExpedientes())
      .catch((e) => aviso(`No se pudieron guardar en el expediente: ${e.message}`));
  }

  // Si la cuenta se empezó sin abrir el expediente, se busca por el RFC del cliente y el pedimento
  // que traen las facturas, y se toma de ahí el pedimento que se subió en la primera etapa.
  async function ligarPorPedimento() {
    if (enCuenta) return;
    const c = window.App.estado();
    if (!c.cliente.rfc || !c.pedimento) return; // aún no llega la factura de Villalobos
    await cargarExpedientes().catch(() => {});
    const exp = expedientes.find((e) => e.rfc === c.cliente.rfc.toUpperCase() && e.pedimento === c.pedimento);
    if (!exp) {
      aviso(`No hay expediente del pedimento ${c.pedimento} para ${c.cliente.rfc}. Créalo en la pestaña Expedientes para que se guarden los archivos.`);
      return;
    }
    try {
      enCuenta = await api(`/expedientes/${exp.id}`);
    } catch (e) { aviso(e.message); return; }
    pintarExpedienteActual();
    const archivos = pendientes;
    pendientes = [];
    if (archivos.length) guardarEnExpediente(enCuenta, archivos);
    // Pedimento de la primera etapa (solo si no se subió también en esta)
    const yaHayPedimento = window.App.documentos().some((d) => d.pdf?.datos?.esPedimento);
    const n = yaHayPedimento ? 0 : await window.App.cargarDelExpediente(
      await Promise.all(enCuenta.archivos.filter((a) => a.etapa === 'expediente' && a.tipo === 'pdf').map(archivoComoFile)), []);
    aviso(n
      ? `Cuenta ligada al expediente ${enCuenta.pedimento}: se tomó el pedimento de la primera etapa.`
      : `Cuenta ligada al expediente ${enCuenta.pedimento}.`);
  }

  async function entrar(usuario) {
    $('#usuario').textContent = usuario.nombre;
    $('#usuario').hidden = false;
    $('#btn-salir').hidden = false;
    await cargarExpedientes();
  }

  // ---------- Pestañas ----------
  function cambiarPestana(cual) {
    document.querySelector('.col-docs').classList.toggle('ver-exp', cual === 'expedientes');
    for (const b of document.querySelectorAll('#pestanas [data-pestana]')) {
      b.setAttribute('aria-selected', String(b.dataset.pestana === cual));
    }
  }

  // ---------- Árbol Cliente → Pedimento ----------
  async function cargarExpedientes() {
    expedientes = await api('/expedientes');
    pintarArbol();
    if (abierto) abrirExpediente(abierto.id, { silencioso: true });
  }

  function pintarArbol() {
    const q = Cuenta.normalizar($('#exp-buscar').value);
    const visibles = expedientes.filter((e) => !q || Cuenta.normalizar(`${e.cliente} ${e.rfc} ${e.pedimento} ${e.referencia}`).includes(q));
    const porCliente = new Map();
    for (const e of visibles) {
      if (!porCliente.has(e.rfc)) porCliente.set(e.rfc, { cliente: e.cliente, lista: [] });
      porCliente.get(e.rfc).lista.push(e);
    }
    $('#arbol-expedientes').innerHTML = porCliente.size
      ? [...porCliente.entries()].map(([rfc, g]) => `
        <details class="arbol__cliente" ${q || porCliente.size === 1 || g.lista.some((e) => e.id === abierto?.id) ? 'open' : ''}>
          <summary><strong>${esc(g.cliente)}</strong> <span class="muted">${esc(rfc)} · ${g.lista.length}</span></summary>
          <ul>${g.lista.map((e) => `
            <li class="arbol__ped${e.id === abierto?.id ? ' sel' : ''}" data-id="${e.id}">
              <span>${esc(e.pedimento)}${e.referencia ? ` <span class="chip">${esc(e.referencia)}</span>` : ''}</span>
              <span class="muted">${e.archivos_expediente || 0} doc.${e.cuenta ? ` · cuenta ${esc(e.cuenta)}` : ''}</span>
            </li>`).join('')}
          </ul>
        </details>`).join('')
      : `<p class="muted">${expedientes.length ? 'Ningún expediente coincide.' : 'Todavía no hay expedientes. Crea el primero con «+ Nuevo expediente».'}</p>`;
  }

  async function abrirExpediente(id, { silencioso = false } = {}) {
    try {
      abierto = await api(`/expedientes/${id}`);
    } catch (e) { if (!silencioso) aviso(e.message); return; }
    pintarArbol();
    const tam = (b) => (b > 1024 * 1024 ? `${(b / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(b / 1024))} KB`);
    const filas = (etapa) => abierto.archivos.filter((a) => a.etapa === etapa).map((a) => `
      <li data-id="${a.id}">
        <span class="exp-arch__nombre">${esc(a.nombre)}<span class="muted"> · ${tam(a.tamano)} · ${esc(a.subido_por || '')}</span></span>
        <span class="exp-arch__acc">
          <a class="btn btn--chico" href="/api/archivos/${a.id}" target="_blank" rel="noopener">Ver</a>
          <a class="btn btn--chico" href="/api/archivos/${a.id}?descargar=1">Descargar</a>
          <button type="button" class="btn-x" data-borrar-archivo="${a.id}" aria-label="Quitar ${esc(a.nombre)}">×</button>
        </span>
      </li>`).join('') || '<li class="muted">Sin archivos</li>';
    const d = $('#detalle-expediente');
    d.hidden = false;
    d.innerHTML = `
      <div class="exp-detalle__cab">
        <div>
          <strong>${esc(abierto.cliente)}</strong>
          <div class="muted">${esc(abierto.rfc)} · Pedimento ${esc(abierto.pedimento)}${abierto.referencia ? ` · Ref. ${esc(abierto.referencia)}` : ''}</div>
          <div class="muted">Creado por ${esc(abierto.creado_por_nombre || '—')}${abierto.cuenta ? ` · Cuenta de gastos ${esc(abierto.cuenta)}` : ''}</div>
        </div>
        <button type="button" class="btn-x" id="exp-cerrar" aria-label="Cerrar expediente">×</button>
      </div>
      <h3>Expediente (primera etapa)</h3>
      <ul class="exp-arch">${filas('expediente')}</ul>
      <label class="btn btn--chico">+ Agregar archivos al expediente<input type="file" id="exp-agregar" multiple accept=".pdf,.xml,application/pdf" hidden></label>
      <h3>Cuenta de gastos (segunda etapa)</h3>
      <ul class="exp-arch">${filas('cuenta')}</ul>
      <button type="button" class="btn btn--oro" id="exp-hacer-cuenta">${abierto.cuenta ? 'Abrir la cuenta de gastos de este pedimento' : 'Hacer la cuenta de gastos de este pedimento'}</button>`;
  }

  // Abre la pestaña de la cuenta con el pedimento del expediente ya leído
  async function hacerCuenta() {
    const exp = abierto;
    if (window.App.hayCaptura() && enCuenta?.id !== exp.id
      && !confirm('Se va a empezar la cuenta de este pedimento y se reemplaza lo que tienes capturado. ¿Continuar?')) return;
    window.App.reiniciarCuenta();
    pendientes = [];
    enCuenta = exp;
    pintarExpedienteActual();
    cambiarPestana('cuenta');
    aviso('Leyendo los documentos del expediente…');
    try {
      // Si ya se guardó la cuenta de este pedimento, se abre con lo que se capturó (anticipo, referencias…)
      if (exp.cuenta) {
        const guardadas = await api('/cuentas');
        const previa = guardadas.find((h) => h.expediente_id === exp.id);
        if (previa) window.App.abrirCuenta(previa.cuenta);
      }
      const deExpediente = await Promise.all(exp.archivos.filter((a) => a.etapa === 'expediente').map(archivoComoFile));
      const deCuenta = await Promise.all(exp.archivos.filter((a) => a.etapa === 'cuenta').map(archivoComoFile));
      const n = await window.App.cargarDelExpediente(deExpediente, deCuenta);
      aviso(n
        ? `Pedimento leído del expediente. Ahora sube la factura de Villalobos y las de los proveedores.`
        : 'El expediente no tiene un pedimento en PDF con texto; los impuestos se capturan a mano.');
    } catch (e) {
      aviso(e.message);
    }
  }

  function pintarExpedienteActual() {
    const el = $('#expediente-actual');
    el.hidden = !enCuenta;
    if (!enCuenta) return;
    el.innerHTML = `Cuenta del expediente <strong>${esc(enCuenta.cliente)}</strong> · Pedimento ${esc(enCuenta.pedimento)}
      <button type="button" class="btn btn--chico" id="exp-volver">Ver expediente</button>`;
  }

  // ---------- Nuevo expediente ----------
  let archivosNuevo = [];

  async function elegirArchivosNuevo(lista) {
    archivosNuevo = Array.from(lista).filter((f) => /\.(pdf|xml)$/i.test(f.name));
    $('#dlg-exp-lista').textContent = archivosNuevo.length ? `${archivosNuevo.length} archivo(s): ${archivosNuevo.map((f) => f.name).join(', ')}` : 'Ningún archivo elegido';
    // Si entre ellos viene el pedimento con texto, se llenan los datos. El nombre del cliente se toma
    // del catálogo (como lo escriben en sus cuentas) o, si no está, del pedimento o del acuse de valor.
    const poner = (sel, v) => { if (v && !$(sel).value) $(sel).value = v; };
    let ped = null;
    let nombre = null; // { texto, de }
    for (const f of archivosNuevo.filter((x) => /\.pdf$/i.test(x.name))) {
      const d = await window.App.leerPedimento(f);
      if (!d) continue;
      if (d.esPedimento && !ped) ped = d;
      if (d.nombreImportador && (!nombre || (d.nombreDe === 'pedimento' && nombre.de !== 'pedimento'))) {
        nombre = { texto: d.nombreImportador, de: d.nombreDe };
      }
      if (ped && nombre?.de === 'pedimento') break;
    }
    if (ped) {
      poner('#dlg-exp-pedimento', ped.pedimento);
      poner('#dlg-exp-rfc', ped.rfcImportador);
      poner('#dlg-exp-ref', ped.referencia);
    }
    const cat = window.App.clientes()[$('#dlg-exp-rfc').value.trim().toUpperCase()];
    const campo = $('#dlg-exp-cliente');
    const nota = $('#dlg-exp-nota');
    if (!campo.value && (cat?.nombre || nombre)) {
      campo.value = cat?.nombre || nombre.texto;
      campo.classList.add('auto');
      nota.textContent = cat?.nombre
        ? 'Nombre tomado del catálogo de clientes. Revisa que sea correcto antes de crear el expediente.'
        : `Nombre leído del ${nombre.de}. Revisa que sea correcto (por ejemplo «S.A.» o «S.A. de C.V.») antes de crear el expediente.`;
    }
  }

  async function guardarNuevo() {
    const err = $('#dlg-exp-error');
    err.textContent = '';
    const cuerpo = {
      rfc: $('#dlg-exp-rfc').value.trim().toUpperCase(),
      cliente: $('#dlg-exp-cliente').value.trim(),
      pedimento: $('#dlg-exp-pedimento').value.trim(),
      referencia: $('#dlg-exp-ref').value.trim().toUpperCase(),
    };
    const boton = $('#dlg-exp-guardar');
    boton.disabled = true;
    try {
      const exp = await api('/expedientes', json('POST', cuerpo));
      if (archivosNuevo.length) await subirArchivos(exp.id, archivosNuevo, 'expediente');
      $('#dlg-expediente').close();
      abierto = exp;
      await cargarExpedientes();
      aviso(`Expediente ${exp.pedimento} de ${exp.cliente} guardado con ${archivosNuevo.length} archivo(s).`);
    } catch (e) {
      err.textContent = e.message;
    } finally {
      boton.disabled = false;
    }
  }

  function abrirDialogoNuevo() {
    archivosNuevo = [];
    for (const id of ['#dlg-exp-rfc', '#dlg-exp-cliente', '#dlg-exp-pedimento', '#dlg-exp-ref']) $(id).value = '';
    $('#dlg-exp-cliente').classList.remove('auto');
    $('#dlg-exp-nota').textContent = '';
    $('#dlg-exp-lista').textContent = 'Ningún archivo elegido';
    $('#dlg-exp-error').textContent = '';
    $('#dlg-expediente').showModal();
  }

  // ---------- Eventos ----------
  $('#form-login').addEventListener('submit', async (e) => {
    e.preventDefault();
    const f = new FormData(e.target);
    $('#login-error').textContent = '';
    try {
      const usuario = await api('/login', json('POST', { correo: f.get('correo'), contrasena: f.get('contrasena') }));
      e.target.reset();
      $('#login').close();
      await entrar(usuario);
    } catch (err) {
      $('#login-error').textContent = err.message;
    }
  });
  $('#login').addEventListener('cancel', (e) => e.preventDefault()); // sin sesión no se puede cerrar

  $('#btn-salir').addEventListener('click', async () => {
    await api('/logout', { method: 'POST' }).catch(() => {});
    location.reload();
  });

  $('#pestanas').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pestana]');
    if (b) cambiarPestana(b.dataset.pestana);
  });
  $('#exp-buscar').addEventListener('input', pintarArbol);
  $('#arbol-expedientes').addEventListener('click', (e) => {
    const li = e.target.closest('.arbol__ped');
    if (li) abrirExpediente(Number(li.dataset.id));
  });
  $('#detalle-expediente').addEventListener('click', async (e) => {
    if (e.target.closest('#exp-cerrar')) { abierto = null; $('#detalle-expediente').hidden = true; pintarArbol(); return; }
    if (e.target.closest('#exp-hacer-cuenta')) { hacerCuenta(); return; }
    const b = e.target.closest('[data-borrar-archivo]');
    if (b) {
      const nombre = b.closest('li').querySelector('.exp-arch__nombre').firstChild.textContent;
      if (!confirm(`¿Quitar «${nombre}» del expediente? Se borra del servidor para todos.`)) return;
      try { await api(`/archivos/${b.dataset.borrarArchivo}`, { method: 'DELETE' }); await cargarExpedientes(); } catch (err) { aviso(err.message); }
    }
  });
  $('#detalle-expediente').addEventListener('change', async (e) => {
    if (e.target.id !== 'exp-agregar' || !abierto) return;
    const archivos = Array.from(e.target.files);
    e.target.value = '';
    try {
      await subirArchivos(abierto.id, archivos, 'expediente');
      await cargarExpedientes();
      aviso(`${archivos.length} archivo(s) agregados al expediente.`);
    } catch (err) { aviso(err.message); }
  });
  $('#expediente-actual').addEventListener('click', (e) => {
    if (!e.target.closest('#exp-volver') || !enCuenta) return;
    cambiarPestana('expedientes');
    abrirExpediente(enCuenta.id);
  });
  // "Nueva cuenta" suelta la cuenta del expediente
  document.addEventListener('vg:cuenta-nueva', () => { enCuenta = null; pendientes = []; pintarExpedienteActual(); });

  $('#btn-exp-nuevo').addEventListener('click', abrirDialogoNuevo);
  $('#dlg-exp-cerrar').addEventListener('click', () => $('#dlg-expediente').close());
  $('#dlg-exp-archivos').addEventListener('change', (e) => elegirArchivosNuevo(e.target.files));
  const dropNuevo = $('#dlg-exp-drop');
  ['dragenter', 'dragover'].forEach((ev) => dropNuevo.addEventListener(ev, (e) => { e.preventDefault(); e.stopPropagation(); dropNuevo.classList.add('activo'); }));
  ['dragleave', 'drop'].forEach((ev) => dropNuevo.addEventListener(ev, () => dropNuevo.classList.remove('activo')));
  dropNuevo.addEventListener('drop', (e) => { e.preventDefault(); e.stopPropagation(); elegirArchivosNuevo(e.dataTransfer.files); });
  $('#dlg-exp-guardar').addEventListener('click', guardarNuevo);
  // Si la persona corrige el nombre, deja de marcarse como leído automáticamente
  $('#dlg-exp-cliente').addEventListener('input', (e) => { e.target.classList.remove('auto'); $('#dlg-exp-nota').textContent = ''; });

  iniciar();
})();
