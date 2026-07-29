# INTERFACES.md — Contrato de módulos «Zona Dos»

**Este fichero es el contrato CONGELADO entre `web/js/app.js` (ya escrito) y los
módulos que se implementan en paralelo. No cambies firmas, nombres ni ids: si un
módulo necesita algo distinto, se adapta el módulo, no el contrato.**

Spec de diseño (única fuente de verdad visual): `docs/superpowers/specs/2026-07-23-zona-dos-redesign-design.md`.
Chart.js 4.4.9 es global (`window.Chart`, cargado por `<script src="vendor/chart.umd.min.js">` antes de los módulos). No lo importes.

---

## 0. El objeto `ctx` (contexto de render)

Todos los constructores de render reciben **un único parámetro `ctx`** creado por `state.buildCtx()`:

```js
ctx = {
  data: {                    // datos COMPLETOS (histórico), ya ordenados asc por date
    runs:          Array|null,   // runs.json      (34 carreras)
    runsDetail:    Object|null,  // runs_detail.json — mapa id(string) → {splits, zones, weather}
    daily:         Array|null,   // daily.json     (145 días)
    allActivities: Array|null,   // all_activities.json (42: running|walking|strength_training)
    status:        Object|null,  // status.json
    meta:          Object|null,  // meta.json {first_date, updated}
  },
  fRuns:  Array,             // runs filtrados por el rango activo, ordenados asc (nunca null)
  fDaily: Array,             // daily filtrados por el rango activo, ordenados asc (nunca null)
  range:  7 | 30 | 90 | 'all',
}
```

Reglas obligatorias para TODO render:
1. **Guard de nulos**: cualquier clave de `ctx.data` puede ser `null` (degradación
   parcial). Si falta lo esencial → `emptyState(card, 'mensaje explicativo')` y return.
2. **Sin datos en rango** → `emptyState(card, 'Sin carreras en este rango · prueba 90d')`
   (adapta el texto). Nunca canvas en blanco, nunca `display:none` inline.
3. Al empezar un render con datos: `clearEmptyState(card)`.
4. Cada chart de Chart.js se registra: `registerChart('<canvasId>', new Chart(...))`.
   `registerChart` ya destruye la instancia anterior — no llames `destroyChart` a mano.
5. Los renders deben ser **re-ejecutables** (idempotentes): app.js los vuelve a llamar
   al cambiar el rango.
6. Colores SOLO de las constantes de `helpers.js`. Texto siempre en tokens de tinta.
   Prohibido doble eje Y. Leyenda solo si hay ≥2 series. Ejes con `suggestedMin/Max`,
   jamás `min/max` fijos.

### Campos de datos exactos (verificados contra `data/*.json`)

- `runs[]`: `id` (number), `date` ('YYYY-MM-DD'), `start` (ISO local), `start_hour` (float),
  `km`, `dur_s`, `pace_s` (s/km), `hr`, `hr_max`, `cadence`, `ef`, `calories`, `temp_c`,
  `type` ('running'), y previas nocturnas: `sleep_score_prev`, `sleep_hours_prev`,
  `rem_pct_prev`, `bedtime_prev`, `hrv_morning` — **cualquiera puede ser `null`**.
- `daily[]`: `date` siempre; el resto opcional/null: `sleep_hours`, `sleep_score`,
  `deep_pct`, `rem_pct`, `sleep_stress`, `bedtime` (horas decimales, p.ej. 1.65 = 01:39),
  `party` (bool), `hrv`, `hrv_status`, `bb_charged`, `bb_drained`, `weight_kg` (solo 4 filas).
- `runsDetail[String(id)]` = `{ splits: [{km, dur_s, hr, hr_max, cadence, power, elev_gain, elev_loss}],
  zones: [{zone:1..5, low, secs}], weather: {temp_c, humidity} }` — puede faltar un id.
- `status`: `acute_load`, `chronic_load`, `vo2max`,
  `hrv_baseline: {balancedLow: 51, balancedUpper: 91, lowUpper, markerValue}`, `status_feedback`.
- `meta`: `first_date`, `updated` (ISO con hora).

---

## 1. helpers.js (YA ESCRITO — importa de `./helpers.js`)

Constantes:

| Export | Valor / forma |
|---|---|
| `TOKENS` | `{bg:'#0e1116', card:'#161b24', card2:'#1c2330', border:'#232b3a', grid:'rgba(35,43,58,0.5)', txt:'#e8edf4', muted:'#94a0b3'}` |
| `SERIES` | `{s1:'#3987e5', s2:'#199e70', s3:'#9085e9', s4:'#d55181'}` — orden fijo, nunca cicladas |
| `ESTADO` | `{verde:'#4dd0a6', ambar:'#f6a35b', rojo:'#ef6b6b'}` — solo semáforo/umbrales/flechas, siempre icono+texto |
| `RAMPA_ZONAS` | `['#b7d3f6','#86b6ef','#5598e7','#2f7bd9','#1e60b0']` (Z1→Z5) |
| `RAMPA_HEATMAP` | `['#1e60b0','#2f7bd9','#5598e7','#9ec4f2']` (poco→mucho km); celda vacía `TOKENS.card2` |
| `RAMPA_SUENO` | `['#b9b0f4','#9085e9','#6b5fd0']` = [ligero, REM, profundo] |
| `MONTH_ES` | `['ene',…,'dic']` (índice 0 = enero) |
| `FONT_MONO`, `FONT_UI` | strings de font-family (para ticks/etiquetas en canvas usa `FONT_MONO` en cifras) |

Funciones:

| Firma | Contrato |
|---|---|
| `paceFmt(secPerKm: number): string` | `'m:ss'`; redondea el TOTAL primero (jamás `6:60`); no finito/≤0 → `'–'` |
| `fmtDur(sec: number): string` | reloj `'mm:ss'` o `'h:mm:ss'` si ≥1h |
| `fmtDurLargo(sec: number): string` | `'5 h 42 min'` / `'34 min'` (para tiles) |
| `fmtDateEs(iso: string, conAnio?=false): string` | `'12 mar'` / `'12 mar 26'` — por slicing, sin Date |
| `isoAddDays(iso: string, delta: number): string` | aritmética UTC, devuelve ISO |
| `isoToday(): string` | hoy local como 'YYYY-MM-DD' |
| `isoWeekKey(iso: string): string` | semana ISO-8601 `'2026-W30'` (año ISO) |
| `movingAvg(values: number[], n: number): (number\|null)[]` | misma longitud; ventana parcial al inicio; ignora no-finitos; ventana sin válidos → null |
| `expMovingAvg(values: number[], alpha?=0.3): (number\|null)[]` | null/no finito → emite null sin actualizar la EMA |
| `linreg(xs: number[], ys: number[]): {slope,intercept,r,r2,n} \| null` | ignora pares no finitos; null si n<2 o var(x)=0 |
| `makeBandPlugin({from?, to?, y?, color?, lineColor?, dash?, label?, labelColor?, scaleID?}): ChartPlugin` | banda horizontal translúcida (from/to) y/o línea discontinua (y) con etiqueta 11px mono alineada a la derecha. Pasar en `plugins:[...]` del chart. ÚNICO plugin de banda: úsalo en HRV (51–91), cadencia (160–165) y FC (línea y=142, label `'techo Z2 · 142'`) |
| `emptyState(cardEl: HTMLElement, msg: string): HTMLElement` | oculta el contenido de datos de la card (`[hidden]`) y muestra `div.empty-state` con el mensaje |
| `clearEmptyState(cardEl: HTMLElement): void` | revierte lo anterior; llamar al inicio de todo render con datos |

## 2. state.js (YA ESCRITO — importa de `./state.js`)

| Firma | Contrato |
|---|---|
| `loadData(): Promise<{data, errores: string[]}>` | fetch de los 6 JSON con `res.ok` por fichero; caídos → `null` + nombre en `errores`; arrays ordenados asc por `date` |
| `setData(data)`, `getData()` | estado global de datos |
| `setRange(r: 7\|30\|90\|'all')`, `getRange()` | rango global (por defecto 90) |
| `filterByRange(rows, range): Array` | filtra por `date >= ref-(range-1)d`; ref = fecha de `meta.updated` (fallback: último daily/run, hoy) |
| `buildCtx(): ctx` | construye el objeto `ctx` de §0 (filtra y ordena UNA vez) |
| `registerChart(id: string, chart: Chart)` | registra destruyendo la instancia previa del mismo id — usa el id del canvas |
| `destroyChart(id: string)` | destroy + desregistro (normalmente no hace falta) |
| `getChart(id: string): Chart\|undefined` | acceso a instancias (p.ej. crosshair sincronizado) |
| `applyChartDefaults(): boolean` | ya la llama app.js; los módulos NO la llaman |

## 3. app.js (YA ESCRITO — no importa nada de los módulos que no esté aquí)

- Importa y llama con `ctx`:
  - **Dependientes del rango** (se re-llaman al cambiar 7d/30d/90d/Todo):
    `renderStatTiles, renderKmSemana, renderEF, renderRitmoFc, renderDesacople,
    renderIntensidad, renderCadencia, renderSueno, renderHrv`.
  - **Exentas** (solo al init; sus cards llevan badge «⟳ histórico completo» ya puesto en el HTML):
    `renderSemaforo, renderPRs, renderMensual, renderZonas, renderHeatmap,
    renderCorrelaciones, renderHistorial` + `initModal(ctx)` e `initExplorador(ctx)` una vez.
- Cada llamada va envuelta en try/catch: si tu módulo lanza, cae solo tu card.
- app.js ya gestiona: banner de error, chip de frescura, footer, insights, scroll-spy,
  selector de rango (`aria-pressed`). Los módulos NO tocan nada de eso.

---

## 4. Módulos a implementar (firmas EXACTAS)

### 4.1 `web/js/today.js`

```js
export function renderSemaforo(ctx): void
export function renderStatTiles(ctx): void
```

**`renderSemaforo(ctx)`** — card `#cardSemaforo` (Acto 1). Usa `ctx.data` (ignora rango).
- Calcula el estado con la lógica del spec §5-1.1 (documéntala en comentario):
  frescura de `daily` (último `date` ≠ hoy → ámbar + razón «datos de hace N días»),
  HRV vs `status.hrv_baseline.balancedLow/balancedUpper`, sueño bajo, `party`
  (ámbar; rojo solo si además HRV < balancedLow), ACWR < 0.8 refuerza verde,
  balance `bb_charged − bb_drained` del día previo muy negativo → ámbar
  («balance Body Battery» — NO existe nivel absoluto, no lo inventes).
- DOM que escribe:
  - `#cardSemaforo`: sustituir la clase `estado-neutro` por una de
    `estado-verde | estado-ambar | estado-rojo` (clases ya estiladas en CSS).
  - `#semaforoIcono`: `'✓'`, `'!'` o `'✕'`.
  - `#semaforoMensaje`: mensaje 20/700, p.ej. `'Sal a correr — Z2 suave'`.
  - `#semaforoSr`: texto sr-only `'Semáforo: verde'` (o ámbar/rojo).
  - `#semaforoRazones`: `<li>` por razón (13.5px, ya estilado).
  - Bullet bars SVG (inline, sin Chart.js) en `#bulletHrv`, `#bulletBB`, `#bulletAcwr`:
    estructura sugerida `div.bullet-label` (nombre + `<strong>` valor) + `<svg>`.
    HRV vs banda 51–91 · balance Body Battery del día previo · ACWR con bandas
    <0.8 / 0.8–1.3 / >1.5 y marcador (ACWR propio: km/día de `runs.json`, aguda 7d
    vs crónica 28d con `expMovingAvg`).
  - `#acwrNota`: segunda lectura textual con el ratio Garmin
    `status.acute_load / status.chronic_load` (hoy 35/137 ≈ 0.26) + etiqueta cualitativa.
- Sin datos (`daily` y `status` null) → `emptyState` de la card.

**`renderStatTiles(ctx)`** — card `#cardTiles`, contenedor `#statTiles` (vacío en HTML).
- Crea **5 tiles** `div.tile` (estructura CSS: `.tile-head` con `span.tile-mark`
  (8px, color de serie) + label, `.tile-value` (monospace, en `--txt`, nunca color
  de serie), `.tile-delta` (flecha ▲▼ + texto; clases `delta-mejor`/`delta-peor`),
  `.tile-spark` con el SVG de `sparkline.js` en `SERIES.s1`):
  1. **Km esta semana** (semana ISO en curso, `isoWeekKey`) + delta vs media 4 semanas + sparkline km/semana.
  2. **Racha** — semanas ISO consecutivas (hacia atrás desde la semana en curso) con ≥1 carrera.
  3. **Carreras / 4 sem** — número de carreras en los últimos 28 días.
  4. **Tiempo total del rango** — suma `dur_s` de `ctx.fRuns`, formato `fmtDurLargo`. (Único tile que depende del rango.)
  5. **Peso** — último `weight_kg` de `daily` + delta vs el anterior; si no hay dato
     en 30 días, tile placeholder (`div.tile.tile--placeholder`) con «sin pesajes
     recientes» — **nunca ocultarlo**.
- Re-ejecutable: vacía `#statTiles` y reconstruye.

### 4.2 `web/js/sparkline.js`

```js
export function sparklineSvg(values: number[], opts?: {
  width?: number,   // por defecto 90
  height?: number,  // por defecto 24
  color?: string,   // por defecto SERIES.s1
}): SVGSVGElement
```
- SVG inline puro (~40 líneas), sin Chart.js: polyline 1.5–2px del array (null/no
  finitos se saltan), sin ejes ni puntos (opcional: punto 2px en el último valor).
  `aria-hidden="true"` (decorativa). Devuelve el nodo listo para `append`.

### 4.3 `web/js/charts.js`

Todas reciben `ctx`, registran con `registerChart('<canvasId>', chart)` y aplican
las reglas de §0. Tooltips en TODAS (`mode:'index'` en líneas/barras).

```js
export function renderKmSemana(ctx): void    // canvas #chartKmSemana · card #cardKmSemana · RANGO
export function renderPRs(ctx): void         // #prList + #predicciones · card #cardPRs · HISTÓRICO
export function renderEF(ctx): void          // canvas #chartEF · card #cardEF · RANGO (+ #efBadge)
export function renderRitmoFc(ctx): void     // canvas #chartRitmo + #chartFc · card #cardRitmoFc · RANGO
export function renderDesacople(ctx): void   // canvas #chartDesacople · card #cardDesacople · RANGO
export function renderMensual(ctx): void     // tbody #tablaMensualBody · card #cardMensual · HISTÓRICO
export function renderZonas(ctx): void       // canvas #chartZonas + aside #kpiZonas · card #cardZonas · HISTÓRICO
export function renderIntensidad(ctx): void  // canvas #chartIntensidad + p #kpiIntensidad · card #cardIntensidad · RANGO
export function renderCadencia(ctx): void    // canvas #chartCadencia + p #kpiCadencia · card #cardCadencia · RANGO
export function renderSueno(ctx): void       // canvas #chartSueno · card #cardSueno · RANGO (usa fDaily)
export function renderHrv(ctx): void         // canvas #chartHrv · card #cardHrv · RANGO (usa fDaily)
```

Detalle por función (colores/series según spec §5):
- **renderKmSemana**: barras S1 finas (bordes redondeados 4px) por semana ISO de
  `ctx.fRuns` + línea S2 2px media móvil 4 sem (`movingAvg`). Semana en curso:
  relleno al 40% de opacidad + label «en curso». Etiquetas X: `'S30'` o rango de fechas cortas.
- **renderPRs**: 6 PRs de `ctx.data.runs` (+`runsDetail` para mejor km de splits):
  mejor ritmo, mejor km de splits, más larga, mejor EF, mejor semana (km), mejor mes (km).
  Filas `div.pr-row` (`span` etiqueta+fecha, `span.pr-valor`) con `tabindex="0"`,
  click/Enter → `openRunModal(id)` cuando el PR corresponde a una carrera concreta.
  En `#predicciones`: Riegel exp 1.06 → 5k/10k desde el mejor esfuerzo real + marca
  equivalente del `status.vo2max` (45) con el gap como texto motivador.
- **renderEF**: 3 series sobre fechas de carrera (`fRuns`): (1) EF todas — S1,
  solo puntos 3px al 40% de opacidad; (2) **EF Z2 (hr≤142)** — S2 línea 2px
  protagonista + tendencia `linreg` como línea discontinua en `TOKENS.muted`;
  (3) EF ajustado por temperatura — S1 al 60%, punteada, label de leyenda
  `'ajustado (estimación)'` (fórmula: +1.5%/5°C sobre 15°C con `temp_c`).
  Leyenda visible (≥2 series). Y con `suggestedMin/Max` (~0.7/1.0). ☀ en tooltip
  si `temp_c > 24`. Escribe `#efBadge`: `'Z2: +X% desde abril'` (o '' si no computable).
- **renderRitmoFc**: dos charts apilados, MISMAS fechas X (fRuns): `#chartRitmo`
  ritmo S1 con `reverse:true` en Y y ticks `paceFmt`; `#chartFc` FC media S3 +
  `makeBandPlugin({y:142, label:'techo Z2 · 142'})`. Crosshair vertical sincronizado
  vía `getChart('chartRitmo')/getChart('chartFc')` (plugin propio ~40 líneas);
  fallback aceptado: tooltips `mode:'index'` independientes.
- **renderDesacople**: barras S1 del drift% por carrera de `ctx.fRuns` con
  `runsDetail[String(id)].splits` (EF 1ª vs 2ª mitad; solo km≥3; sin detail → se omite).
  Umbrales 5%/10%: `makeBandPlugin` ×2 (líneas `y:5` ámbar y `y:10` rojo de `ESTADO`,
  con label texto+icono `'⚠ 5%'` / `'✕ 10%'`) — el estado vive en el umbral, NUNCA en la barra.
  Si `runsDetail` es null → `emptyState`.
- **renderMensual**: agrega `ctx.data.runs` por mes → filas en `#tablaMensualBody`:
  `<td>` Mes (`'mar 26'`), Km, Ritmo (`paceFmt`), FC, EF, Cadencia — celdas numéricas
  con `class="num"`. Flechas ▲▼ vs mes anterior como `<span>` con color de `ESTADO`
  + `aria-label` («mejor»/«peor»; ojo: ritmo y FC mejoran al BAJAR).
- **renderZonas**: barras apiladas 100% por semana ISO desde
  `runsDetail[*].zones[].secs` (agrupa por semana de la carrera; usa TODAS las
  carreras — card histórico). Colores `RAMPA_ZONAS` en orden Z1→Z5, gap 2px
  (borderWidth/borderColor `TOKENS.card`), leyenda `'Z1'..'Z5'`.
  `#kpiZonas`: `<strong>` con `'~53 %'` + texto `'tiempo en Z1-Z2 · referencia 80/20'`
  y la aclaración «zonas Garmin».
- **renderIntensidad**: puntos FC media (S3, radio ≥4, hit 8) por carrera de `fRuns`
  + `makeBandPlugin({y:142,...})`. Puntos con `hr > 142`: `pointBorderColor: TOKENS.card`
  y `pointBorderWidth: 2` (anillo de superficie — sin gastar el rojo).
  `#kpiIntensidad`: `'20/34 carreras dentro de Z2 (59 %)'` con `<strong>` (calculado).
- **renderCadencia**: línea S4 de `cadence` (excluye <120 spm; cuenta excluidos) +
  media móvil 4 carreras (S4 al 50% o `TOKENS.muted`) + banda objetivo
  `makeBandPlugin({from:160, to:165, label:'objetivo 160–165'})`.
  `#kpiCadencia`: gap al objetivo + estancamiento («140.4 → 140.6 desde marzo»).
- **renderSueno**: barras apiladas por noche de `ctx.fDaily` (con `sleep_hours`):
  horas profundo = `sleep_hours*deep_pct/100`, REM = `*rem_pct/100`, ligero = resto.
  Colores `RAMPA_SUENO` invertida en el apilado visual (profundo abajo `#6b5fd0`,
  REM `#9085e9`, ligero arriba `#b9b0f4`), gap 2px. Tooltip: score y `bedtime`
  (decimal → `'01:39'`).
- **renderHrv**: línea S2 2px de `ctx.fDaily.hrv` + `makeBandPlugin({from:51, to:91,
  label:'baseline 51–91'})` (banda gris = referencia, no estado) + etiqueta directa
  del último valor (plugin propio o tooltip fijo).

### 4.4 `web/js/heatmap.js`

```js
export function renderHeatmap(ctx): void   // #heatmapContainer + #heatmapPager + #kpiFuerza · card #cardHeatmap · HISTÓRICO
```
- Heatmap calendario SVG propio (sin Chart.js): columnas = semanas, filas = L-D,
  celdas 16×16 con radio 3, gap 3. Etiquetas de fila `'L'`, `'X'`, `'V'` y meses arriba.
- Km de carrera/día (`ctx.data.runs`): `RAMPA_HEATMAP` en 4 cuartiles poco→mucho;
  día sin actividad `TOKENS.card2`.
- Otras actividades (`ctx.data.allActivities` con `type !== 'running'`): **rombo**
  violeta `SERIES.s3` (la FORMA es la codificación primaria, CVD-safe), tipo
  traducido `{strength_training:'fuerza', walking:'caminata'}` en tooltip.
- Últimos 12 meses visibles; si hay más histórico, botones por año en `#heatmapPager`
  (`aria-pressed`).
- Interacción: tooltip propio `div.heatmap-tip` (posicionado, tap-friendly);
  celdas con carrera: `tabindex="0"`, Enter/click → `openRunModal(id)` de modal.js
  con **guard `if (!run) return`**.
- `#kpiFuerza`: `'N sesiones de fuerza este mes'`.

### 4.5 `web/js/modal.js`

```js
export function initModal(ctx): void            // wiring del <dialog>; app.js la llama UNA vez ANTES que el resto
export function openRunModal(runId: number): void  // abre el detalle; GUARD: si no existe la carrera → return silencioso
export function renderHistorial(ctx): void      // tbody #runsTableBody + botón #verTodasBtn · card #cardHistorial · HISTÓRICO
```
- `initModal(ctx)`: guarda `ctx.data` en el módulo (para `openRunModal`), wiring de
  `#modalClose`, Escape (nativo de `<dialog>` + `cancel`), scroll-lock del body,
  focus al botón cerrar al abrir, retorno de foco al invocador, focus trap.
- `openRunModal(runId)`: busca en `data.runs` por `id`; **`if (!run) return;`**.
  `showModal()` de `#runModal`. Rellena `#modalTitle` (`fmtDateEs(date, true)` + km)
  y `#modalBody`: métricas de la carrera; tabla de splits (`div.splits-table` +
  `<table>`, mismas clases que el resto de tablas, `td.num`); zonas como **barra
  apilada horizontal** `div.modal-zonas` con `<span>` por zona (width % del tiempo,
  colores `RAMPA_ZONAS`); fila «desacople de esta carrera: X %» + comparación
  1ª/2ª mitad con texto+icono. Sin `runsDetail[id]` → solo métricas + nota.
- `renderHistorial(ctx)`: usa `ctx.data.runs` (histórico, orden DESC para mostrar).
  Filas `<tr tabindex="0">` → click/Enter/Espacio `openRunModal(id)`. Celdas:
  Fecha (`fmtDateEs`), Km, Duración (`fmtDur`), Ritmo (`paceFmt`), FC — y con clase
  de columna además de `num`: `class="num col-fcmax"`, `"num col-ef"`, `"num col-temp"`
  (el CSS las oculta ≤600px). Última celda `class="col-badges"`: `span.badge-pr` 🏆
  si es PR y `span.badge-split` `'split −'` si la 2ª mitad fue más rápida (de splits).
  Muestra 10; `#verTodasBtn` alterna todas (`aria-expanded`) y actualiza su texto
  (`'Ver todas (34)'` / `'Ver menos'`).

### 4.6 `web/js/scatter.js`

```js
export function renderCorrelaciones(ctx): void  // #corrTiles · card #cardCorrelaciones · HISTÓRICO
export function initExplorador(ctx): void       // #scatterX/#scatterY/#presetBedtime/#chartScatter/#scatterInfo · card #cardExplorador
```
- Métricas del explorador (pares X/Y sobre `ctx.data.runs`, n≥15 para correlaciones):
  `hrv_morning`, `sleep_score_prev`, `sleep_hours_prev`, `rem_pct_prev`,
  `bedtime_prev`, `temp_c`, `start_hour`, `km` → contra `ef`, `pace_s`, `hr`, `cadence`.
  Etiquetas en español (p.ej. `'HRV matinal'`, `'ritmo (min/km)'`).
- `renderCorrelaciones`: top |r| con `linreg` (n≥15) como 3 `button.tile.tile-corr`
  en `#corrTiles` (frase + `.tile-r` con `r=0.29 · débil-moderada · n=33`), incluyendo
  la anti-intuición del sueño (r≈0.06) si sale en el top o forzada como 3.ª.
  Click → configura selects del explorador, re-render del scatter y
  `#cardExplorador.scrollIntoView({behavior:'smooth', block:'start'})`.
- `initExplorador`: puebla `#scatterX`/`#scatterY` con `<option value="campo">`,
  listeners `change` (selects sincronizados con el estado interno), `#presetBedtime`
  configura bedtime_prev→ef y marca `aria-pressed`. Chart scatter: puntos S1 8px con
  `pointBorderColor: TOKENS.card`, `pointBorderWidth: 2`, tooltip `mode:'nearest'`;
  línea de tendencia `linreg` discontinua muted si hay ajuste. Ritmo (`pace_s`)
  SIEMPRE con `paceFmt` en ticks y tooltips (y eje invertido: más rápido arriba).
  `#scatterInfo`: `'r² = 0.08 · débil · n=33'` + `' · muestra pequeña, orientativo'`
  si n<20. Sin pares suficientes → `emptyState` explicando qué falta.
  Registra con `registerChart('chartScatter', ...)`.

### 4.7 `web/js/insights.js` — PURO (sin DOM, sin Chart, testeable en Node)

```js
export function insightDelDia(data): string        // header #insightDia
export function insightHoy(data): string           // #insightHoy
export function insightSemana(data): string        // #insightSemana
export function insightProgreso(data): string      // #insightProgreso
export function insightIntensidad(data): string    // #insightIntensidad
export function insightRecuperacion(data): string  // #insightRecuperacion
export function insightArchivo(data): string       // #insightArchivo
```
- Reciben `data` = `ctx.data` COMPLETO (histórico), devuelven UNA frase en español.
- **Guardas obligatorias por plantilla**: n mínimo, magnitud mínima del efecto, y
  campos null. Si ninguna plantilla pasa sus guardas → fallback neutro
  (`'Semana tranquila — los datos siguen acumulándose.'` o similar por acto).
- **Jamás lanzan** (devuelven el fallback ante cualquier duda) y **jamás inventan**
  datos no derivables (p.ej. nivel absoluto de Body Battery).
- Solo pueden importar de `./helpers.js` (funciones puras).

---

## 5. Inventario de ids del DOM (index.html YA ESCRITO)

| Zona | Ids |
|---|---|
| Header | `insightDia` |
| Sticky bar | `stickyBar`, `rangeSelector` (botones `.range-btn[data-range]`), `freshChip` |
| Error | `errorBanner`, `errorMsg`, `retryBtn` |
| Actos (section) | `acto-hoy`, `acto-semana`, `acto-progreso`, `acto-intensidad`, `acto-recuperacion`, `acto-archivo` |
| Insights de acto | `insightHoy`, `insightSemana`, `insightProgreso`, `insightIntensidad`, `insightRecuperacion`, `insightArchivo` |
| 1.1 Semáforo | `cardSemaforo`, `semaforoIcono`, `semaforoMensaje`, `semaforoSr`, `semaforoRazones`, `bulletHrv`, `bulletBB`, `bulletAcwr`, `acwrNota` |
| 2.1 Tiles | `cardTiles`, `statTiles` |
| 2.2 Km/semana | `cardKmSemana`, `chartKmSemana` |
| 2.3 PRs | `cardPRs`, `prList`, `predicciones` |
| 3.1 EF | `cardEF`, `chartEF`, `efBadge` |
| 3.2 Ritmo/FC | `cardRitmoFc`, `chartRitmo`, `chartFc` |
| 3.3 Desacople | `cardDesacople`, `chartDesacople` |
| 3.4 Mensual | `cardMensual`, `tablaMensual`, `tablaMensualBody` |
| 4.1 Zonas | `cardZonas`, `chartZonas`, `kpiZonas` |
| 4.2 Intensidad | `cardIntensidad`, `chartIntensidad`, `kpiIntensidad` |
| 4.3 Cadencia | `cardCadencia`, `chartCadencia`, `kpiCadencia` |
| 5.1 Sueño | `cardSueno`, `chartSueno` |
| 5.2 HRV | `cardHrv`, `chartHrv` |
| 6.1 Heatmap | `cardHeatmap`, `heatmapPager`, `heatmapContainer`, `kpiFuerza` |
| 6.2a Correlaciones | `cardCorrelaciones`, `corrTiles` |
| 6.2b Explorador | `cardExplorador`, `scatterX`, `scatterY`, `presetBedtime`, `chartScatter`, `scatterInfo` |
| 6.3 Historial | `cardHistorial`, `runsTable`, `runsTableBody`, `verTodasBtn` |
| Modal | `runModal`, `modalClose`, `modalTitle`, `modalBody` |
| Footer | `footerUpdated` |

Clases CSS ya estiladas que los módulos deben usar: `.tile`, `.tile-head`, `.tile-mark`,
`.tile-value`, `.tile-delta` (+`.delta-mejor`/`.delta-peor`), `.tile-spark`,
`.tile--placeholder`, `.tile-corr` (+`.tile-r`), `.bullet-label`, `.pr-row` (+`.pr-valor`),
`td.num`, `.col-fcmax`/`.col-ef`/`.col-temp`/`.col-badges`, `.badge-pr`, `.badge-split`,
`.heatmap-tip`, `.modal-zonas`, `.splits-table`, `.empty-state` (solo vía helper),
clases de estado del hero `estado-verde|ambar|rojo|neutro`.

## 6. Reglas transversales (recordatorio de §10 del spec)

- Prohibido doble eje Y. Prohibido `min`/`max` fijos en ejes (usar `suggestedMin/Max`).
- Colores de estado NUNCA en barras/líneas de datos; siempre icono+texto.
- Leyenda solo con ≥2 series. Grid solo horizontal (`grid.display:false` en X).
- Cifras en canvas/tablas/KPI: monospace tabular (`FONT_MONO` / clases ya hechas).
- Toda card exenta del rango ya lleva su badge en el HTML — no lo dupliques.
- `paceFmt` para TODO ritmo visible (ejes, tooltips, tablas, modal).
- Textos de UI y comentarios en español. JS moderno (ES2020+), sin build, sin deps.
