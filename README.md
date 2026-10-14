# Quiz tipo Kahoot — PWA (preguntas desde Google Sheets)

Página HTML + JavaScript, **PWA**, que carga preguntas desde un Google Sheet
(lectura por CSV público, sin backend — la misma técnica de tu Runner) y guarda
el puntaje de cada grupo en otra hoja del mismo Sheet.

```
Navegador (PWA)                         Google
  ├─ leer preguntas ──── CSV público ──▶ Hoja "Preguntas"   (sin script)
  └─ guardar puntaje ─── Apps Script ──▶ Hoja "Resultados"  (mini script)
```

> **Sobre "sin backend":** leer es 100 % del lado del navegador. Pero **escribir**
> en un Sheet no se puede desde JS puro (Google no lo permite). La forma estándar
> sin servidor propio es un Apps Script de 30 líneas — de los que tú ya usas. Es
> lo único que necesita despliegue, y solo para guardar el puntaje.

---

## 1) Estructura del Google Sheet

### Hoja de preguntas (la llenas tú)

Una fila por pregunta. Los encabezados van en la **fila 1** y se leen **por
nombre** (el orden de las columnas no importa). Solo se cargan filas que tengan
un **número** en la columna `#`.

| Columna | Obligatoria | Qué va |
|---|:--:|---|
| `#` | ✅ | ID numérico de la pregunta (1, 2, 3…). Sin número → la fila se ignora. |
| `tipo` | ✅ | `multiple` (opción múltiple) o `vf` (verdadero/falso). |
| `Titulo_pregunta` | ⬜ | Rótulo corto encima de la pregunta (ej. "Escena 1"). Vacío = no se muestra. |
| `detalle_pregunta` | ✅ | El enunciado de la pregunta. |
| `imagen` | ⬜ | **URL pública** de una imagen. Si está vacía, la pregunta va sin imagen. |
| `opcion_1` | ✅ | Primera opción. En `vf`: *Verdadero*. |
| `opcion_2` | ✅ | Segunda opción. En `vf`: *Falso*. |
| `opcion_3` | ⬜ | Tercera opción (solo `multiple`). |
| `opcion_4` | ⬜ | Cuarta opción (solo `multiple`). |
| `respuesta_correcta` | ✅ | El **texto exacto** de la opción correcta (ej: `Bloquear`, `Verdadero`). |
| `tiempo` | ⬜ | Segundos para responder. Por defecto 20. |
| `puntos` | ⬜ | Puntaje base de la pregunta. Por defecto 1000. |
| `retroalimentacion_correcta` | ⬜ | Mensaje que se muestra si acierta. |
| `retroalimentacion_incorrecta` | ⬜ | Mensaje que se muestra si falla. |

Puedes importar `ejemplo-preguntas.csv` (Archivo ▸ Importar ▸ Subir) para partir
de una plantilla ya armada.

**Sobre la imagen:** debe ser un enlace **directo** a la imagen. Si usas Google
Drive, comparte el archivo como "cualquiera con el enlace" y usa el formato
`https://lh3.googleusercontent.com/d/ID_DEL_ARCHIVO`. También sirve cualquier URL
de imagen pública (por ejemplo de tu VPS o de un hosting de imágenes).

**Compartir el Sheet:** botón *Compartir* ▸ "Cualquier persona con el enlace" ▸
rol **Lector**. (Necesario para que el navegador pueda leer el CSV.)

### Hoja de resultados (se crea sola)

Cuando un grupo envía su puntaje, el script crea (si no existe) la hoja
**`Resultados`** con estas columnas:

| fecha | grupo | integrantes | puntaje | correctas | total | P1 | P2 | … | Pn |
|---|---|---|---|---|---|---|---|---|---|

`fecha` es la **fecha y hora de envío** de ese grupo. `integrantes` lleva los
nombres y apellidos separados por coma (hasta 7). Cada `Pn` es el puntaje que el
grupo sacó en la pregunta con `#` = n; esas columnas se crean solas a medida que
aparecen preguntas. Si la hoja `Resultados` ya existía con el formato anterior,
el script inserta la columna `integrantes` sin mover lo que ya estaba guardado.

## 2) Publicar el Apps Script (para guardar puntajes)

1. En tu Sheet: **Extensiones ▸ Apps Script**. Pega el contenido de `Codigo.gs`. Guarda.
2. **Implementar ▸ Nueva implementación ▸ Aplicación web**.
   - *Ejecutar como*: **Yo**
   - *Quién tiene acceso*: **Cualquier persona**
3. Autoriza los permisos. Copia la **URL /exec**.
4. Abre `app.js` y pega esa URL en `CONFIG.SCRIPT_URL`.

Si actualizas el `Codigo.gs`, crea una **implementación nueva** (no edites la
vieja) y reemplaza la URL en `SCRIPT_URL`.

Si dejas `SCRIPT_URL` sin configurar, el juego funciona igual pero no guardará
puntajes (te avisará al intentar enviar).

## 3) Conectar tu Sheet de preguntas

Dos maneras (ambas del estilo de tu Runner):

- **Rápida:** abre el enlace del juego agregando **`/#facilitador`** al final (por ejemplo `https://tu-sitio.netlify.app/#facilitador`). No hay botón visible, así los estudiantes no lo encuentran. Ahí pega el link de tu
  Sheet, *Guardar y cargar*. Se genera un **QR**; los grupos lo escanean y entran
  con tus preguntas ya cargadas (viaja en la URL como `?sheet=ID`).
- **Fija:** cambia `CONFIG.DEFAULT_SHEET_ID` (y `DEFAULT_GID`) en `app.js` por los
  de tu Sheet, para que sea el predeterminado sin configurar nada.

## 4) Publicar la PWA

Sube la carpeta a un hosting estático con **HTTPS** (requisito PWA). En **Netlify**
arrastra la carpeta a netlify.com/drop, igual que tus simuladores EDUCO. En el
celular saldrá "Agregar a pantalla de inicio".

Para probar en local (el service worker no corre con `file://`):

```bash
python3 -m http.server 8000   # y abre http://localhost:8000
```

---

## Cómo funciona

- **Puntaje estilo Kahoot:** un acierto da entre 50 % y 100 % de los puntos base
  según la rapidez. Fallar o quedarse sin tiempo = 0. Ajustable en
  `CONFIG.PISO_PUNTAJE`.
- **Offline:** el shell se cachea (abre sin internet) y las preguntas se guardan
  en `localStorage` tras la primera carga con red. Si un grupo termina sin
  conexión, su puntaje se **encola** y se envía solo al reconectar.
- **Tipos de pregunta:** `multiple` muestra hasta 4 opciones con las formas/colores
  clásicos; `vf` muestra dos botones grandes (Verdadero / Falso).

## Notas

- Al **instalar** la PWA, el ícono abre sin `?sheet=`, así que usa el Sheet
  guardado en ese dispositivo o el predeterminado. Para repartir Sheets distintos
  por grupo, usa el QR en el navegador (no instalado).
- Si cambias archivos, sube la versión del cache en `sw.js`
  (ahora va en `kahoot-pwa-v3`; la próxima sería `-v4`) y sube `styles.css`,
  `app.js` **y** `sw.js` juntos. Si no, los celulares con la PWA instalada siguen
  viendo la versión vieja por el caché.
- El `SCRIPT_URL` es único (uno tuyo). El puntaje se guarda en el **mismo Sheet**
  del que salieron las preguntas, porque el script abre ese Sheet por su ID.
  Requisito: tu cuenta (dueña del script) debe tener acceso de edición a ese Sheet.
