/**
 * Quiz Kahoot PWA — guardado de puntajes (Google Apps Script)
 * ---------------------------------------------------------------------------
 * Las PREGUNTAS se leen desde el navegador por CSV (no tocan este script).
 * Este script SOLO sirve para lo único que el navegador no puede hacer solo:
 * ESCRIBIR el puntaje de cada grupo en una hoja "Resultados".
 *
 * Instalación:
 *   1) Abre tu Google Sheet de preguntas.
 *   2) Extensiones ▸ Apps Script. Pega este código. Guarda.
 *   3) Implementar ▸ Nueva implementación ▸ Aplicación web.
 *        Ejecutar como: Yo   |   Acceso: Cualquier persona
 *   4) Copia la URL /exec y pégala en CONFIG.SCRIPT_URL de app.js.
 *   Si ya tenías una versión anterior publicada, crea una implementación NUEVA.
 *
 * La hoja "Resultados" se crea sola con columnas:
 *   fecha | grupo | integrantes | puntaje | correctas | total | P1 | P2 | … | Pn
 * Cada Pn es el puntaje del grupo en la pregunta con # = n. Las columnas Pn
 * se agregan solas a medida que aparecen preguntas nuevas.
 * Si la hoja ya existía con el formato viejo (sin "integrantes"), se inserta
 * esa columna sin mover los datos que ya estaban.
 */

var HOJA_RESULTADOS = 'Resultados';
var BASE = ['fecha', 'grupo', 'integrantes', 'puntaje', 'correctas', 'total'];

/** GET ?action=resultados&sheet=ID → posiciones (para la tabla final). */
function doGet(e) {
  try {
    var ss = abrir(e && e.parameter ? e.parameter.sheet : '');
    return _json({ ok: true, resultados: leerResultados(ss) });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/** POST {sheetId, grupo, integrantes, puntaje, correctas, total, porPregunta} → guarda una fila. */
function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000); // varios grupos pueden enviar a la vez
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = abrir(d.sheetId);
    var hoja = prepararHoja(ss);

    // Puntaje por pregunta: { "1": 10, "2": 0 } (si llega solo "detalle", se arma desde ahí)
    var porPregunta = d.porPregunta || {};
    if (!d.porPregunta && d.detalle && d.detalle.length) {
      d.detalle.forEach(function (x) { porPregunta[String(x.id)] = Number(x.puntos) || 0; });
    }

    var enc = asegurarColumnasP(hoja, Object.keys(porPregunta));

    var fila = enc.map(function (h) {
      switch (h) {
        case 'fecha': return new Date();
        case 'grupo': return String(d.grupo || 'Sin nombre');
        case 'integrantes': return String(d.integrantes || '');
        case 'puntaje': return Number(d.puntaje) || 0;
        case 'correctas': return Number(d.correctas) || 0;
        case 'total': return Number(d.total) || 0;
      }
      var m = /^P(\d+)$/.exec(h);
      if (m && porPregunta.hasOwnProperty(m[1])) return Number(porPregunta[m[1]]) || 0;
      return '';
    });

    hoja.appendRow(fila);
    return _json({ ok: true, fila: hoja.getLastRow() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  } finally {
    lock.releaseLock();
  }
}

/* ------------------------------------------------------------------ */

/** Abre por ID el mismo Sheet de las preguntas; si no llega ID, usa el contenedor. */
function abrir(sheetId) {
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

/** Crea la hoja si no existe y migra el formato viejo (sin "integrantes"). */
function prepararHoja(ss) {
  var hoja = ss.getSheetByName(HOJA_RESULTADOS);
  if (!hoja) {
    hoja = ss.insertSheet(HOJA_RESULTADOS);
    hoja.appendRow(BASE);
    hoja.getRange(1, 1, 1, BASE.length).setFontWeight('bold');
    hoja.setFrozenRows(1);
    return hoja;
  }
  var enc = encabezados(hoja);
  if (enc.indexOf('integrantes') < 0) {
    var iGrupo = enc.indexOf('grupo');
    var despues = iGrupo >= 0 ? iGrupo + 1 : 2; // columna (1-based) tras "grupo"
    hoja.insertColumnAfter(despues);
    hoja.getRange(1, despues + 1).setValue('integrantes').setFontWeight('bold');
  }
  return hoja;
}

/** Agrega al final las columnas P<n> que falten, en orden numérico. Devuelve el encabezado final. */
function asegurarColumnasP(hoja, ids) {
  var enc = encabezados(hoja);
  var faltan = ids
    .map(function (id) { return Number(id); })
    .filter(function (n) { return !isNaN(n) && enc.indexOf('P' + n) < 0; })
    .sort(function (a, b) { return a - b; })
    .map(function (n) { return 'P' + n; });
  if (faltan.length) {
    hoja.getRange(1, enc.length + 1, 1, faltan.length).setValues([faltan]).setFontWeight('bold');
    enc = enc.concat(faltan);
  }
  return enc;
}

function encabezados(hoja) {
  var n = hoja.getLastColumn();
  if (n < 1) return [];
  return hoja.getRange(1, 1, 1, n).getValues()[0].map(function (h) { return String(h).trim(); });
}

function leerResultados(ss) {
  var hoja = ss.getSheetByName(HOJA_RESULTADOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  var enc = encabezados(hoja);
  var c = function (n) { return enc.indexOf(n); };
  var iF = c('fecha'), iG = c('grupo'), iI = c('integrantes'),
      iP = c('puntaje'), iC = c('correctas'), iT = c('total');
  var v = hoja.getRange(2, 1, hoja.getLastRow() - 1, enc.length).getValues();
  return v.map(function (r) {
    return {
      fecha: iF >= 0 ? r[iF] : '',
      grupo: iG >= 0 ? r[iG] : '',
      integrantes: iI >= 0 ? r[iI] : '',
      puntaje: iP >= 0 ? Number(r[iP]) || 0 : 0,
      correctas: iC >= 0 ? Number(r[iC]) || 0 : 0,
      total: iT >= 0 ? Number(r[iT]) || 0 : 0
    };
  }).sort(function (a, b) { return b.puntaje - a.puntaje; });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
