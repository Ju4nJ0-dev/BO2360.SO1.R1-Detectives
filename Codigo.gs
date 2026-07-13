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
 *
 * La hoja "Resultados" se crea sola con columnas:
 *   fecha | grupo | puntaje | correctas | total
 * (La "fecha" es la fecha/hora de envío de cada grupo.)
 */

var HOJA_RESULTADOS = 'Resultados';

/** GET ?action=resultados&sheet=ID → posiciones (para la tabla final). */
function doGet(e) {
  try {
    var ss = abrir(e && e.parameter ? e.parameter.sheet : '');
    return _json({ ok: true, resultados: leerResultados(ss) });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/** POST {sheetId, grupo, puntaje, correctas, total} → guarda una fila. */
function doPost(e) {
  try {
    var d = JSON.parse(e.postData.contents);
    var ss = abrir(d.sheetId);
    var hoja = ss.getSheetByName(HOJA_RESULTADOS);
    if (!hoja) {
      hoja = ss.insertSheet(HOJA_RESULTADOS);
      hoja.appendRow(['fecha', 'grupo', 'puntaje', 'correctas', 'total']);
      hoja.getRange('A1:E1').setFontWeight('bold');
    }
    hoja.appendRow([
      new Date(),
      String(d.grupo || 'Sin nombre'),
      Number(d.puntaje) || 0,
      Number(d.correctas) || 0,
      Number(d.total) || 0
    ]);
    return _json({ ok: true, fila: hoja.getLastRow() });
  } catch (err) {
    return _json({ ok: false, error: String(err) });
  }
}

/* ------------------------------------------------------------------ */

/** Abre por ID el mismo Sheet de las preguntas; si no llega ID, usa el contenedor. */
function abrir(sheetId) {
  if (sheetId) return SpreadsheetApp.openById(sheetId);
  return SpreadsheetApp.getActiveSpreadsheet();
}

function leerResultados(ss) {
  var hoja = ss.getSheetByName(HOJA_RESULTADOS);
  if (!hoja || hoja.getLastRow() < 2) return [];
  var v = hoja.getRange(2, 1, hoja.getLastRow() - 1, 5).getValues();
  return v.map(function (r) {
    return { fecha: r[0], grupo: r[1], puntaje: Number(r[2]) || 0,
             correctas: Number(r[3]) || 0, total: Number(r[4]) || 0 };
  }).sort(function (a, b) { return b.puntaje - a.puntaje; });
}

function _json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
