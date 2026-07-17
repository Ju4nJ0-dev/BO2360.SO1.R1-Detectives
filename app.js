/* =====================================================================
   Quiz tipo Kahoot — Seguridad/EDUCO — PWA
   Lectura de preguntas: Google Sheets export CSV (sin backend, como el Runner).
   Guardado de puntaje: Apps Script (única forma de ESCRIBIR en el Sheet).
   ===================================================================== */

const CONFIG = {
  // 👉 URL /exec del Apps Script (solo para GUARDAR puntajes y leer posiciones).
  //    Ver README, Paso 3. Si lo dejas vacío, el juego funciona igual pero
  //    no guardará puntajes en el Sheet.
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbxSEmywhQzsdVgr5ZkbL8NE04FIjkRvePvfS5o3GRyqohqkvxK5IPBBMnaRKmjIgXvvlA/exec',

  // Sheet de preguntas por defecto (se sobreescribe con ?sheet= o modo facilitador).
  DEFAULT_SHEET_ID: '1V614VVpOQamsbAlklmn7fPnxY0U1-Dac_c_uiEudcwo',
  DEFAULT_GID: '0',

  PISO_PUNTAJE: 1,   // un acierto da entre 50% y 100% de los puntos según rapidez = valores 0.5 para 50% y 1 para 100%
  MS_FEEDBACK: 1800,   // cuánto se ve el ✓/✘ entre preguntas

  LS_CONFIG: 'kahoot_sheet_config',
  LS_CACHE: 'kahoot_preguntas_',   // + sheetId_gid
  LS_COLA: 'kahoot_cola_envios'
};

/* Formas/colores clásicos por posición de opción */
const CLAVES = ['a', 'b', 'c', 'd'];
const FORMAS = {
  a: '<svg viewBox="0 0 24 24"><path d="M12 2 22 21H2z"/></svg>',
  b: '<svg viewBox="0 0 24 24"><path d="M12 1 23 12 12 23 1 12z"/></svg>',
  c: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="10"/></svg>',
  d: '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="3"/></svg>'
};

const estado = {
  grupo: '', config: null,
  preguntas: [], indice: 0,
  puntaje: 0, correctas: 0, detalle: [],
  temporizador: null, tiempoTotal: 20, tiempoRestante: 20, respondida: false
};

const $ = (id) => document.getElementById(id);

/* ---------------------------------------------------------------------
   Configuración del Sheet (reutilizado del Runner):
   Prioridad: ?sheet= en la URL  >  localStorage  >  valor por defecto.
   --------------------------------------------------------------------- */
function getActiveSheetConfig() {
  const params = new URLSearchParams(location.search);
  const urlSheet = params.get('sheet');
  if (urlSheet) return { id: urlSheet, gid: params.get('gid') || '0', source: 'url' };

  try {
    const g = JSON.parse(localStorage.getItem(CONFIG.LS_CONFIG) || 'null');
    if (g && g.id) return { id: g.id, gid: g.gid || '0', source: 'stored' };
  } catch (e) {}

  return { id: CONFIG.DEFAULT_SHEET_ID, gid: CONFIG.DEFAULT_GID, source: 'default' };
}

/* Extrae id y gid de un link completo de Google Sheets (reutilizado del Runner). */
function parseSheetLink(input) {
  if (!input) return null;
  const t = input.trim();
  const idMatch = t.match(/\/d\/([a-zA-Z0-9_-]+)/);
  const id = idMatch ? idMatch[1] : (/^[a-zA-Z0-9_-]{20,}$/.test(t) ? t : null);
  if (!id) return null;
  const gidMatch = t.match(/[#&?]gid=(\d+)/);
  return { id, gid: gidMatch ? gidMatch[1] : '0' };
}

/* Parser CSV robusto (comillas, comas y saltos dentro de campos). */
function parseCSV(text) {
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i], n = text[i + 1];
    if (q) {
      if (c === '"' && n === '"') { field += '"'; i++; }
      else if (c === '"') { q = false; }
      else { field += c; }
    } else {
      if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/* ---------------------------------------------------------------------
   Descarga el CSV del Sheet probando dos endpoints:
   1) gviz  → Google lo sirve CON cabeceras CORS para hojas públicas.
   2) export → respaldo (a veces bloquea CORS).
   Requisito: el Sheet debe estar compartido como "Cualquiera con el enlace".
   --------------------------------------------------------------------- */
async function descargarPreguntas(cfg) {
  const urls = [
    `https://docs.google.com/spreadsheets/d/${cfg.id}/gviz/tq?tqx=out:csv&gid=${cfg.gid}`,
    `https://docs.google.com/spreadsheets/d/${cfg.id}/export?format=csv&gid=${cfg.gid}`
  ];
  let ultimoError;
  for (const url of urls) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('HTTP ' + res.status);
      const preguntas = mapearPreguntas(parseCSV(await res.text()));
      if (preguntas.length) return preguntas;
      ultimoError = new Error('El Sheet no tiene preguntas válidas (revisa la columna #)');
    } catch (e) { ultimoError = e; }
  }
  throw ultimoError || new Error('No se pudo leer el Sheet');
}

/* ---------------------------------------------------------------------
   Carga de preguntas desde el Sheet con caché offline.
   --------------------------------------------------------------------- */
async function cargarPreguntas() {
  const cfg = getActiveSheetConfig();
  estado.config = cfg;
  const cacheKey = CONFIG.LS_CACHE + cfg.id + '_' + cfg.gid;
  const estadoEl = $('estado-carga');
  const btn = $('btn-empezar');
  btn.disabled = true;

  try {
    const preguntas = await descargarPreguntas(cfg);

    estado.preguntas = preguntas;
    try { localStorage.setItem(cacheKey, JSON.stringify(preguntas)); } catch (e) {}
    listo(estadoEl, btn, preguntas.length, false);
  } catch (err) {
    console.error('Error cargando Sheet:', err);
    let cache = null;
    try { cache = JSON.parse(localStorage.getItem(cacheKey) || 'null'); } catch (e) {}
    if (cache && cache.length) {
      estado.preguntas = cache;
      listo(estadoEl, btn, cache.length, true);
    } else {
      estadoEl.textContent = 'No se pudieron cargar las preguntas. Revisa el link del Sheet o tu conexión.';
      estadoEl.classList.add('error');
    }
  }
}

function listo(estadoEl, btn, n, offline) {
  estadoEl.classList.remove('error');
  estadoEl.textContent = offline
    ? `Sin conexión — usando ${n} pregunta${n === 1 ? '' : 's'} guardadas.`
    : `${n} pregunta${n === 1 ? '' : 's'} listas.`;
  $('conteo-preguntas').textContent = n;
  btn.disabled = false;
}

/* Convierte filas del CSV al formato del quiz.
   Columnas (por nombre, orden libre):
   # | tipo | detalle_pregunta | imagen | opcion_1..4 |
   respuesta_correcta | tiempo | puntos |
   retroalimentacion_correcta | retroalimentacion_incorrecta            */
function mapearPreguntas(filas) {
  if (filas.length < 2) return [];
  const enc = filas[0].map((h) => h.trim().toLowerCase());
  const col = (nombre) => enc.indexOf(nombre);

  const iId = col('#');
  const iTipo = col('tipo');
  const iPreg = col('detalle_pregunta');
  const iImg = col('imagen');
  const iOp = [col('opcion_1'), col('opcion_2'), col('opcion_3'), col('opcion_4')];
  const iCorr = col('respuesta_correcta');
  const iTiempo = col('tiempo');
  const iPuntos = col('puntos');
  const iFbOk = col('retroalimentacion_correcta');
  const iFbBad = col('retroalimentacion_incorrecta');

  const get = (fila, i) => (i < 0 ? '' : String(fila[i] == null ? '' : fila[i]).trim());

  const out = [];
  for (let f = 1; f < filas.length; f++) {
    const fila = filas[f];
    const rawId = get(fila, iId);
    if (!rawId || isNaN(parseInt(rawId, 10))) continue; // solo filas con ID numérico

    let tipo = (get(fila, iTipo) || 'multiple').toLowerCase();
    let textos;

    if (tipo === 'vf' || tipo === 'verdadero_falso' || tipo === 'boolean') {
      tipo = 'vf';
      textos = [get(fila, iOp[0]) || 'Verdadero', get(fila, iOp[1]) || 'Falso'];
    } else {
      tipo = 'multiple';
      textos = iOp.map((i) => get(fila, i)).filter((t) => t !== '');
    }
    if (textos.length < 2) continue;

    const opciones = textos.map((t, i) => ({ clave: CLAVES[i], texto: t }));

    // respuesta correcta = TEXTO que coincide con una de las opciones
    const correctaTexto = get(fila, iCorr).toLowerCase();
    let idxCorr = textos.findIndex((t) => t.toLowerCase() === correctaTexto);
    if (idxCorr < 0) idxCorr = 0; // si no coincide, asume la primera (evita romper)

    out.push({
      id: parseInt(rawId, 10),
      tipo,
      pregunta: get(fila, iPreg),
      imagen: get(fila, iImg),
      opciones,
      correcta: CLAVES[idxCorr],
      tiempo: Number(get(fila, iTiempo)) || 20,
      puntos: Number(get(fila, iPuntos)) || 1000,
      fbOk: get(fila, iFbOk).replace(/\\n/g, '\n'),
      fbBad: get(fila, iFbBad).replace(/\\n/g, '\n')
    });
  }
  return out;
}

/* ---------------------------------------------------------------------
   Flujo del juego
   --------------------------------------------------------------------- */
function empezar() {
  const nombre = $('input-grupo').value.trim();
  if (!nombre) { $('input-grupo').focus(); return; }
  if (!estado.preguntas.length) return;
  estado.grupo = nombre;
  estado.indice = 0; estado.puntaje = 0; estado.correctas = 0; estado.detalle = [];
  cambiarPantalla('pantalla-juego');
  mostrarPregunta();
}

function mostrarPregunta() {
  estado.respondida = false;
  const p = estado.preguntas[estado.indice];

  $('hud-num').textContent = estado.indice + 1;
  $('hud-total').textContent = estado.preguntas.length;
  $('hud-puntaje').textContent = estado.puntaje;
  $('pregunta-texto').textContent = p.pregunta;

  const wrap = $('pregunta-imagen-wrap');
  const img = $('pregunta-imagen');
  if (p.imagen) {
    img.src = p.imagen; img.alt = p.pregunta; wrap.hidden = false;
    img.onerror = () => { wrap.hidden = true; };
  } else { wrap.hidden = true; img.removeAttribute('src'); }

  const cont = $('opciones');
  cont.className = 'opciones' + (p.tipo === 'vf' ? ' vf' : '');
  cont.innerHTML = '';
  p.opciones.forEach((op) => {
    const b = document.createElement('button');
    b.className = 'opcion';
    b.dataset.clave = op.clave;
    b.innerHTML = `<span class="forma">${FORMAS[op.clave] || ''}</span><span class="txt">${escapar(op.texto)}</span>`;
    b.addEventListener('click', () => responder(op.clave));
    cont.appendChild(b);
  });

  iniciarTemporizador(p.tiempo);
}

function iniciarTemporizador(segundos) {
  clearInterval(estado.temporizador);
  estado.tiempoTotal = segundos;
  estado.tiempoRestante = segundos;
  const reloj = $('hud-reloj');
  const aguja = $('reloj-aguja');
  const CIRC = 119.38;

  const pintar = () => {
    $('reloj-num').textContent = estado.tiempoRestante;
    const frac = estado.tiempoRestante / estado.tiempoTotal;
    aguja.style.strokeDashoffset = String(CIRC * (1 - frac));
    reloj.classList.toggle('urgente', estado.tiempoRestante <= 5);
  };
  pintar();

  estado.temporizador = setInterval(() => {
    estado.tiempoRestante--;
    pintar();
    if (estado.tiempoRestante <= 0) {
      clearInterval(estado.temporizador);
      if (!estado.respondida) responder(null);
    }
  }, 1000);
}

function responder(clave) {
  if (estado.respondida) return;
  estado.respondida = true;
  clearInterval(estado.temporizador);

  const p = estado.preguntas[estado.indice];
  const acierto = clave === p.correcta;

  let ganados = 0;
  if (acierto) {
    const frac = estado.tiempoRestante / estado.tiempoTotal;
    ganados = Math.round(p.puntos * (CONFIG.PISO_PUNTAJE + (1 - CONFIG.PISO_PUNTAJE) * frac));
    estado.puntaje += ganados;
    estado.correctas++;
  }

  estado.detalle.push({ id: p.id, elegida: clave, correcta: p.correcta, acierto, puntos: ganados });

  const cont = $('opciones');
  cont.classList.add('bloqueado');
  cont.querySelectorAll('.opcion').forEach((b) => {
    if (b.dataset.clave === p.correcta) b.classList.add('correcta');
    if (b.dataset.clave === clave && !acierto) b.classList.add('elegida-mal');
  });

  mostrarFeedback(acierto, ganados, clave === null, p);
}

function mostrarFeedback(acierto, puntos, seAcabo, p) {
  const fb = $('feedback');
  fb.hidden = false;
  fb.className = 'feedback ' + (acierto ? 'ok' : 'mal');
  $('feedback-icono').textContent = acierto ? '✓' : '✕';
  const base = acierto ? '¡Correcto!' : (seAcabo ? 'Se acabó el tiempo' : 'Incorrecto');
  const extra = acierto ? (p.fbOk || '') : (p.fbBad || '');
  $('feedback-texto').textContent = base;
  $('feedback-extra').textContent = extra;
  $('feedback-extra').hidden = !extra;
  $('feedback-puntos').textContent = acierto ? `+${puntos}` : '';

  setTimeout(() => {
    fb.hidden = true;
    estado.indice++;
    if (estado.indice < estado.preguntas.length) mostrarPregunta();
    else terminar();
  }, CONFIG.MS_FEEDBACK);
}

function terminar() {
  $('final-grupo').textContent = estado.grupo;
  $('final-puntaje-num').textContent = estado.puntaje;
  $('final-aciertos').textContent = `${estado.correctas} de ${estado.preguntas.length} correctas`;
  $('estado-envio').hidden = true;
  $('tabla-posiciones').hidden = true;
  $('btn-enviar').disabled = false;
  cambiarPantalla('pantalla-final');
}

/* ---------------------------------------------------------------------
   Envío del puntaje (Apps Script) + cola offline
   --------------------------------------------------------------------- */
async function enviarResultado() {
  if (!CONFIG.SCRIPT_URL || CONFIG.SCRIPT_URL.startsWith('PEGA_AQUI')) {
    const est = $('estado-envio');
    est.hidden = false; est.className = 'estado-envio error';
    est.textContent = 'Falta configurar SCRIPT_URL en app.js para guardar puntajes.';
    return;
  }
  const btn = $('btn-enviar');
  const est = $('estado-envio');
  btn.disabled = true;
  est.hidden = false; est.className = 'estado-envio'; est.textContent = 'Enviando…';

  const payload = {
    sheetId: estado.config ? estado.config.id : '',
    grupo: estado.grupo,
    puntaje: estado.puntaje,
    correctas: estado.correctas,
    total: estado.preguntas.length,
    detalle: estado.detalle
  };

  try {
    const ok = await postResultado(payload);
    if (!ok) throw new Error('respuesta no OK');
    est.classList.add('ok');
    est.textContent = '¡Puntaje guardado!';
    cargarPosiciones();
  } catch (err) {
    encolar(payload);
    est.classList.add('error');
    est.textContent = 'Sin conexión: se guardó localmente y se enviará al reconectar.';
    btn.disabled = false;
  }
}

async function postResultado(payload) {
  const body = JSON.stringify(payload);
  try {
    const res = await fetch(CONFIG.SCRIPT_URL, { method: 'POST', body });
    const data = await res.json();
    return data.ok === true;
  } catch (e) {
    // Respaldo sin CORS (guarda pero no confirma).
    await fetch(CONFIG.SCRIPT_URL, { method: 'POST', mode: 'no-cors', body });
    return true;
  }
}

function encolar(p) {
  const cola = JSON.parse(localStorage.getItem(CONFIG.LS_COLA) || '[]');
  cola.push(p);
  localStorage.setItem(CONFIG.LS_COLA, JSON.stringify(cola));
}

async function reintentarCola() {
  const cola = JSON.parse(localStorage.getItem(CONFIG.LS_COLA) || '[]');
  if (!cola.length || CONFIG.SCRIPT_URL.startsWith('PEGA_AQUI')) return;
  const pendientes = [];
  for (const p of cola) {
    try { await postResultado(p); } catch (e) { pendientes.push(p); }
  }
  localStorage.setItem(CONFIG.LS_COLA, JSON.stringify(pendientes));
}

async function cargarPosiciones() {
  if (CONFIG.SCRIPT_URL.startsWith('PEGA_AQUI')) return;
  try {
    const sheetId = estado.config ? estado.config.id : '';
    const res = await fetch(`${CONFIG.SCRIPT_URL}?action=resultados&sheet=${encodeURIComponent(sheetId)}`);
    const data = await res.json();
    if (!data.ok || !Array.isArray(data.resultados)) return;

    const lista = $('tabla-lista');
    lista.innerHTML = '';
    data.resultados.slice(0, 10).forEach((r, i) => {
      const li = document.createElement('li');
      if (r.grupo === estado.grupo && r.puntaje === estado.puntaje) li.classList.add('propio');
      li.innerHTML = `<span class="pos">${i + 1}</span>` +
        `<span class="nombre">${escapar(r.grupo)}</span>` +
        `<span class="pts">${r.puntaje}</span>`;
      lista.appendChild(li);
    });
    $('tabla-posiciones').hidden = data.resultados.length === 0;
  } catch (e) {}
}

/* ---------------------------------------------------------------------
   Modo facilitador + QR (reutilizado del Runner)
   --------------------------------------------------------------------- */
function abrirFacilitador() {
  cambiarPantalla('pantalla-facilitador');
  const cfg = getActiveSheetConfig();
  $('game-url').textContent = location.origin + location.pathname;
  $('fuente-actual').textContent =
    `Sheet actual: ${cfg.id.slice(0, 12)}…  (origen: ${cfg.source})`;
  pintarCompartir(cfg);
}

function guardarSheet() {
  const parsed = parseSheetLink($('input-sheet-link').value);
  const res = $('resultado-guardar');
  if (!parsed) {
    res.innerHTML = '<span class="error">Link no válido. Pega el enlace completo del Sheet.</span>';
    return;
  }
  localStorage.setItem(CONFIG.LS_CONFIG, JSON.stringify(parsed));
  res.innerHTML = '<span class="ok">Guardado. Recargando preguntas…</span>';
  pintarCompartir(parsed);
  cargarPreguntas().then(() => {
    res.innerHTML = `<span class="ok">Listo: ${estado.preguntas.length} preguntas cargadas.</span>`;
  });
}

function restaurarSheet() {
  localStorage.removeItem(CONFIG.LS_CONFIG);
  $('resultado-guardar').innerHTML = '<span class="ok">Restaurado al Sheet predeterminado.</span>';
  const cfg = getActiveSheetConfig();
  pintarCompartir(cfg);
  cargarPreguntas();
}

function pintarCompartir(cfg) {
  const url = `${location.origin}${location.pathname}?sheet=${cfg.id}&gid=${cfg.gid || '0'}`;
  $('url-compartible').textContent = url;

  const cont = $('qr-code');
  cont.innerHTML = '';
  if (typeof QRCode !== 'undefined') {
    new QRCode(cont, { text: url, width: 200, height: 200, correctLevel: QRCode.CorrectLevel.M });
  } else {
    cont.textContent = 'Conéctate a internet una vez para generar el QR.';
  }
}

function copiarUrl() {
  const url = $('url-compartible').textContent;
  navigator.clipboard.writeText(url).then(
    () => { $('resultado-copiar').innerHTML = '<span class="ok">Link copiado.</span>'; },
    () => { $('resultado-copiar').innerHTML = '<span class="error">No se pudo copiar.</span>'; }
  );
}

/* --------------------------------------------------------------------- */
function cambiarPantalla(id) {
  document.querySelectorAll('.pantalla').forEach((p) => p.classList.remove('activa'));
  $(id).classList.add('activa');
  window.scrollTo(0, 0);
}

function escapar(t) {
  const d = document.createElement('div');
  d.textContent = t == null ? '' : t;
  return d.innerHTML;
}

function registrarSW() {
  if (!location.protocol.startsWith('http')) return; // no aplica en file://
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW:', e));
  }
}

/* ---------------------------------------------------------------------
   Arranque
   --------------------------------------------------------------------- */
document.addEventListener('DOMContentLoaded', () => {
  registrarSW();
  cargarPreguntas();
  reintentarCola();

  $('btn-empezar').addEventListener('click', empezar);
  $('input-grupo').addEventListener('keydown', (e) => { if (e.key === 'Enter') empezar(); });
  $('btn-facilitador').addEventListener('click', abrirFacilitador);
  $('btn-cerrar-facilitador').addEventListener('click', () => cambiarPantalla('pantalla-inicio'));
  $('btn-guardar-sheet').addEventListener('click', guardarSheet);
  $('btn-restaurar-sheet').addEventListener('click', restaurarSheet);
  $('btn-copiar-url').addEventListener('click', copiarUrl);
  $('btn-enviar').addEventListener('click', enviarResultado);
  $('btn-reiniciar').addEventListener('click', () => location.reload());

  window.addEventListener('online', reintentarCola);
});

/* ===== Modal para ver la imagen completa ===== */
document.addEventListener('DOMContentLoaded', () => {
  const img = document.getElementById('pregunta-imagen');
  const modal = document.getElementById('imagen-modal');
  if (!img || !modal) return;
  const foto = document.getElementById('img-modal-foto');
  const abrir = () => { if (img.getAttribute('src')) { foto.src = img.src; modal.hidden = false; } };
  const cerrar = () => { modal.hidden = true; };
  img.style.cursor = 'zoom-in';
  img.addEventListener('click', abrir);
  document.getElementById('img-modal-cerrar').addEventListener('click', cerrar);
  modal.addEventListener('click', (e) => { if (e.target === modal) cerrar(); });
});

/* ===== Splash de 3 segundos al iniciar ===== */
document.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash');
  if (!splash) return;
  setTimeout(() => {
    splash.classList.add('oculto');
    setTimeout(() => splash.remove(), 400);
  }, 2000);
});

/* ===== Botón "atrás" del celular: retrocede de pantalla en vez de cerrar la app ===== */
(function () {
  if (typeof cambiarPantalla !== 'function') return;
  const original = cambiarPantalla;

  // Estado base = pantalla de inicio
  history.replaceState({ pantalla: 'pantalla-inicio' }, '');

  // Envolvemos el cambio de pantalla para registrar el historial
  cambiarPantalla = function (id) {
    original(id);
    // Solo "juego" y "facilitador" agregan una entrada (se puede retroceder de ellas).
    const apilar = (id === 'pantalla-juego' || id === 'pantalla-facilitador');
    if (apilar && (!history.state || history.state.pantalla !== id)) {
      history.pushState({ pantalla: id }, '');
    } else {
      history.replaceState({ pantalla: id }, '');
    }
  };

  // Al presionar "atrás": si el modal de imagen está abierto, ciérralo primero.
  window.addEventListener('popstate', function (e) {
    const modal = document.getElementById('imagen-modal');
    if (modal && !modal.hidden) {
      modal.hidden = true;
      const activa = document.querySelector('.pantalla.activa');
      history.pushState({ pantalla: activa ? activa.id : 'pantalla-inicio' }, '');
      return;
    }
    const id = (e.state && e.state.pantalla) || 'pantalla-inicio';
    original(id);
  });
})();