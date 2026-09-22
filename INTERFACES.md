# INTERFACES.md — Contrato de módulos «Zona Dos · Salud» (v2, 2026-09-22)

**Este fichero es el contrato CONGELADO entre `web/js/app.js`, `web/js/state.js`,
`web/js/helpers.js`, `web/index.html`, `web/style.css` (YA ESCRITOS, rama
`sonda-salud`) y los módulos que 6 constructores implementan/amplían en
paralelo. No cambies firmas, nombres ni ids: si un módulo necesita algo
distinto, se adapta el módulo, no el contrato.**

Specs (única fuente de verdad visual y de datos):
- Base: `docs/superpowers/specs/2026-07-23-zona-dos-redesign-design.md`
- Salud integral (manda sobre la base donde difieren): `docs/superpowers/specs/2026-09-22-salud-integral-design.md` — las referencias «§N» de este documento apuntan a ella.

Chart.js 4.4.9 es global (`window.Chart`, cargado antes de los módulos). No lo importes.

## Reparto entre los 6 constructores

| Constructor | Ficheros | Alcance |
|---|---|---|
| C1 | `web/js/today.js` (amplía) | §2.1 adición Garmin al hero · §2.2 desglose readiness · §2.3 constantes · renderStatTiles pierde el tile de peso |
| C2 | `web/js/entrenar-garmin.js` (NUEVO) | §2.7 PRs oficiales · §2.8 predicciones · §2.9 umbral · §2.10 carga/VO2max |
| C3 | `web/js/recuperar.js` (NUEVO) | §2.12 readiness en el tiempo · §2.13 estrés diario · §2.14 reparto estrés · §2.15 Body Battery · §2.16 mes a mes recuperación |
| C4 | `web/js/cuerpo.js` (NUEVO) | §2.17–§2.23 (pestaña Cuerpo completa) |
| C5 | `web/js/charts.js` + `web/js/scatter.js` + `web/js/modal.js` (amplían) | §2.6 KPI % Z2 real + columna mensual · §2.25 ejes nuevos + regla anti-tautología · §2.26 filas del modal + badges 🏆 oficiales |
| C6 | `web/js/insights.js` (amplía) | §5: insights por pestaña con guardas |

**Cómo se activa tu módulo**: app.js carga `entrenar-garmin.js`, `recuperar.js`
y `cuerpo.js` con `import()` dinámico en try/catch, y accede a los módulos
existentes como namespace (`import * as Today from './today.js'`). Mientras un
export no exista, su card muestra `emptyState('En construcción…')` y el resto
de la web funciona. En cuanto tu export existe con la firma de aquí, se activa
solo — no toques app.js, index.html, state.js, helpers.js ni style.css.

---

## 0. El objeto `ctx` (contexto de render)

Todos los constructores de render reciben **un único parámetro `ctx`** creado por `state.buildCtx()`:

```js
ctx = {
  data: {                    // datos COMPLETOS (histórico), arrays ordenados asc por date
    runs:          Array|null,   // runs.json
    runsDetail:    Object|null,  // runs_detail.json — mapa id(string) → {splits, zones, weather, pct_z2}
    daily:         Array|null,   // daily.json (~206 días)
    allActivities: Array|null,   // all_activities.json
    status:        Object|null,  // status.json
    meta:          Object|null,  // meta.json {first_date, updated}
    statusHistory: Array|null,   // status_history.json (opcional)
    health:        Array|null,   // data/health.json  (opcional, NUEVO §3.2)
    trends:        Array|null,   // data/trends.json  (opcional, NUEVO §3.3)
    prs:           Array|null,   // data/prs.json     (opcional, NUEVO §3.4)
  },
  fRuns:   Array,            // runs filtrados por el rango activo, ordenados asc (nunca null)
  fDaily:  Array,            // daily filtrados por el rango activo (nunca null)
  fHealth: Array,            // health filtrados por el rango activo (nunca null) — NUEVO
  range:   7 | 30 | 90 | 'all',
}
```

Reglas obligatorias para TODO render (sin cambios + una nueva):
1. **Guard de nulos**: cualquier clave de `ctx.data` puede ser `null` y cualquier
   campo de una fila puede ser `null` (§3.9: si falta `health.json` degradan
   Cuerpo/Recuperar; si falta `trends.json` degradan predicciones/fitness age/umbral;
   si falta `prs.json` degradan los récords oficiales). Sin lo esencial →
   `emptyState(card, 'mensaje explicativo')` y return.
2. **Sin datos en rango** → `emptyState` con texto adaptado. Nunca canvas en
   blanco, nunca `display:none` inline.
3. Al empezar un render con datos: `clearEmptyState(card)`.
4. Cada chart: `registerChart('<canvasId>', new Chart(...))` (destruye el anterior solo).
5. Renders re-ejecutables (idempotentes): se re-llaman al cambiar rango/tema/pestaña.
6. Colores SOLO de constantes de `helpers.js`. Prohibido doble eje Y. Leyenda solo
   con ≥2 series. Ejes con `suggestedMin/Max`, jamás `min/max` fijos.
7. **NUEVA (§2.1 salud)**: jamás pintar una constante Garmin cruda (`MODERATE`,
   `GOOD_RECOVERY`…): traducir con los diccionarios de helpers.js; código no
   mapeado → el fallback que indique tu card. Bandas de referencia SIEMPRE en
   gris neutro etiquetado («referencia, no estado»), nunca colores de estado.

### 0.1 Campos de los ficheros EXISTENTES (verificados)

- `runs[]`: `id`, `date`, `start`, `start_hour`, `km`, `dur_s`, `pace_s`, `hr`,
  `hr_max`, `cadence`, `ef`, `calories`, `temp_c`, `type`, `sleep_score_prev`,
  `sleep_hours_prev`, `rem_pct_prev`, `bedtime_prev`, `hrv_morning` — cualquiera null.
  **El pipeline añadirá (§3.5)**: `rhr_dia`, `stress_prev` (día anterior),
  `readiness_dia` (matinal), `spo2_prev` (noche previa) — trátalos como opcionales:
  hasta que el pipeline corra pueden NO existir en las filas.
- `daily[]`: `date` + opcionales `sleep_hours`, `sleep_score`, `deep_pct`, `rem_pct`,
  `sleep_stress`, `bedtime`, `party`, `hrv`, `hrv_status`, `bb_charged`, `bb_drained`,
  `bb_high`, `bb_low`, `bb_last`, `weight_kg`.
- `runsDetail[String(id)]` = `{splits, zones, weather, pct_z2}` — `pct_z2` = % de
  tiempo real ≤142 de esa carrera (float 0–100 o null). Puede faltar un id.
- `status`: `acute_load`, `chronic_load`, `vo2max`, `optimal_min`, `optimal_max`,
  `hrv_baseline {balancedLow, balancedUpper, lowUpper, markerValue}`, `status_feedback`.
- `statusHistory[]`: `{date, acute_load, chronic_load, vo2max}` — tras el fix F0
  sin filas todo-null, pero guarda igualmente (histórico con huecos).

### 0.2 `data/health.json` (NUEVO, §3.2) — lista diaria, una entrada por fecha

Cualquier campo puede ser null (sentinel: clave presente con null = día consultado sin dato).

| clave | significado |
|---|---|
| `date` | 'YYYY-MM-DD' (siempre) |
| `rhr`, `rhr_7d` | FC reposo del día · media 7d |
| `hr_min`, `hr_max` | FC mín/máx del día |
| `spo2_avg`, `spo2_min`, `spo2_sleep` | SpO2 media día · mínima día · media del sueño |
| `resp_waking`, `resp_sleep`, `resp_low`, `resp_high` | respiración rpm |
| `stress_avg`, `stress_max`, `stress_qualifier` | estrés 0–100 · qualifier (constante Garmin) |
| `stress_rest_pct`, `stress_low_pct`, `stress_med_pct`, `stress_high_pct` | reparto — **NO suman 100** (§2.14: normalizar sobre su propia suma) |
| `steps`, `step_goal`, `dist_m` | pasos · objetivo dinámico · distancia m |
| `active_kcal`, `bmr_kcal` | kcal activas · basales |
| `intensity_mod`, `intensity_vig` | minutos intensidad (ponderado OMS = mod + 2×vig) |
| `floors_up`, `sedentary_s`, `bb_wake` | pisos · s sedentario · BB al despertar |
| `readiness_score`, `readiness_level`, `readiness_feedback` | 0–100 · LOW/MODERATE/HIGH/PRIME · feedbackShort |
| `acwr_pct`, `acute_load` | factor carga % · carga aguda |
| `factor_sleep_pct`, `factor_sleep_hist_pct`, `factor_hrv_pct`, `factor_recovery_pct`, `factor_stress_pct` | factores 0–100 del readiness |
| `factor_sleep_fb`, `factor_sleep_hist_fb`, `factor_hrv_fb`, `factor_recovery_fb`, `factor_stress_fb`, `acwr_fb` | feedback por factor (constantes) — **léelos defensivamente**: si el pipeline aún no los exporta, omite el texto de feedback, no rompas |
| `recovery_time_h`, `hrv_weekly`, `sweat_ml` | h de recuperación · HRV media semanal · sudor estimado ml (solo días con actividad) |

Readiness solo existe desde ~2026-03-10 (registro del reloj): días previos null y es correcto.

### 0.3 `data/trends.json` (NUEVO, §3.3) — snapshots diarios con dedupe

Lista asc por `date`. **Nace 2026-09: sin backfill posible** (verificado). Las cards
que dependen de su serie llevan guarda de nº de puntos y badge «serie en construcción».

`{date, pred_5k_s, pred_10k_s, pred_half_s, pred_marathon_s,`
` fitness_age, fitness_age_achievable, chrono_age,`
` comp_bmi:{value,targetValue,potentialAge,priority,stale},`
` comp_rhr:{value,stale},`                      ← **solo value+stale, NO inventar targetValue/potentialAge (§2.20)**
` comp_vig_days:{value,targetValue,potentialAge,priority,stale},`
` comp_vig_min:{value,targetValue,potentialAge,priority,stale},`
` last_updated,`
` lt_hr, lt_speed_raw, lt_speed_unit_verified, lt_date, ftp_w, ftp_origin, ftp_wkg}`

**`lt_speed_raw` NO se pinta como ritmo** mientras `lt_speed_unit_verified` sea false (§2.9/§8.2).

### 0.4 `data/prs.json` (NUEVO, §3.4) — 9 PRs oficiales

`[{type_id, value, date, activity_id, activity_name}]`.
Mapping candidato de `type_id` (verificar contra la app el primer día, §2.7):
`1`=1 km · `2`=1 milla · `3`=5 km · `4`=10 km · `7`=carrera más larga · `8`=media maratón · `9`=maratón.
`value` = segundos (tiempos) o metros (distancias, typeId 7). No mapeado → **«Récord tipo N»**, jamás ocultar.

---

## 1. helpers.js (YA ESCRITO — importa de `./helpers.js`)

Constantes (las de v1 sin cambios: `TOKENS`, `SERIES`, `ESTADO`, `RAMPA_ZONAS`,
`RAMPA_HEATMAP`, `RAMPA_SUENO`, `MONTH_ES`, `FONT_MONO`, `FONT_UI`) más las NUEVAS:

| Export | Valor / contrato |
|---|---|
| `RAMPA_ESTRES` | 4 pasos ordinales familia S2, `[0]`=reposo (claro) → `[3]`=alto (oscuro). dark `['#b5e6d4','#7cccae','#3aa981','#147a57']` · light `['#56b38e','#2f9268','#14724c','#085234']` — validados 2026-09-22 (§6). SOLO para §2.14. Muta con el tema como el resto de rampas. |
| `NIVEL_READINESS` | `{LOW:'bajo', MODERATE:'moderado', HIGH:'alto', PRIME:'óptimo'}` |
| `QUALIFIER_ESTRES` | mapa stressQualifier→español; no listado → `'sin calificar'` |
| `FEEDBACK_FACTOR` | `{VERY_GOOD:'muy bueno', GOOD:'bueno', MODERATE:'moderado', POOR:'flojo', VERY_POOR:'muy flojo', NONE:'—'}` |
| `FEEDBACK_READINESS` | diccionario PARCIAL de feedbackShort (`GOOD_RECOVERY:'buena recuperación'`); no mapeado → **«recuperación correcta»** (§2.1) |

Funciones (las de v1 sin cambios: `paceFmt`, `fmtDur`, `fmtDurLargo`, `fmtDateEs`,
`isoAddDays`, `isoToday`, `isoWeekKey`, `movingAvg`, `expMovingAvg`, `linreg`,
`makeBandPlugin`, `emptyState`, `clearEmptyState`) más la NUEVA:

| Firma | Contrato |
|---|---|
| `percentileRank(serie: (number\|null)[], valor: number): {pct:number, n:number} \| null` | Percentil (0–100, rango medio en empates) de `valor` contra `serie`. **El llamante recorta la ventana** (últimos 90 días CON dato) antes de llamar. No-finitos se descartan; serie vacía o valor no finito → null. **Guarda de n mínimo del llamante**: n≥60 métricas diarias, n≥20 métricas de carrera — sin n suficiente NO se pinta badge (§5). Presentación: tinta ▲▼+texto, jamás color de estado. |

`emptyState` ahora también oculta: `.kpi-grid`, `.ef-cifras`, `.ef-bullets`,
`.pred-controls` (además de `.chart-wrap`, `.table-wrap`, `.tiles-grid`,
`.heatmap-container`, `.pr-list`, `.predicciones`, `.pager`, `.zonas-layout`).
`.explorer-controls` a secas sigue FUERA (los selects del scatter deben sobrevivir al vacío).

## 2. state.js (YA ESCRITO — importa de `./state.js`)

Sin cambios: `loadData`, `setData`, `getData`, `setRange`, `getRange`,
`filterByRange`, `registerChart`, `destroyChart`, `getChart`, `applyChartDefaults`, `mqMovil`.

Cambios/nuevos:

| Firma | Contrato |
|---|---|
| `loadData()` | además de los 6 obligatorios, intenta `status_history.json`, `health.json`, `trends.json`, `prs.json` como OPCIONALES (su ausencia no es error ni banner; clave a null). `health` y `trends` llegan ordenados asc por `date`. |
| `buildCtx()` | añade `fHealth` (health filtrado por rango, nunca null) |
| `TAB_IDS` | `['hoy','entrenar','recuperar','cuerpo','archivo']` — ids lógicos = hashes |
| `setTabRenders(tabId, {dependientes, exentos})` | define los renders de una pestaña (los puebla app.js; los módulos NO llaman esto) |
| `getTab(tabId)` | `{dependientes, exentos, rendered, dirty}` |
| `markDirtyExcept(tabId)` / `invalidateTabs()` | gobierno del render bajo demanda (solo app.js) |
| `resizeVisibleCharts()` | resize de charts con canvas visible (solo app.js, al mostrar pestaña) |

## 3. app.js (YA ESCRITO — no toques nada de esto desde los módulos)

- **Shell §4**: tab bar `role=tablist` (click + flechas ←/→ + Home/End, roving
  tabindex), routing `#hoy|#entrenar|#recuperar|#cuerpo|#archivo` con
  `history.replaceState`, hash desconocido → `#hoy`, listener de `hashchange`.
- **Render bajo demanda**: primera activación de una pestaña ejecuta sus renders;
  cambio de rango re-renderiza SOLO los dependientes de la pestaña visible y marca
  `dirty` las demás (se ponen al día al activarse); cambio de tema invalida todas y
  repinta la visible. **Tu render corre solo con su pestaña visible**: no dependas
  de correr en init global; no midas el DOM de otras pestañas.
- Los charts NO se destruyen al ocultar una pestaña; `registerChart` sigue
  gobernando el re-render.
- **Partición por pestaña** (dependientes del rango / exentos): tabla en §5 de este
  doc — tu función debe respetar su columna (una exenta usa `ctx.data`, una
  dependiente usa `fRuns`/`fDaily`/`fHealth`).
- **Transición PRs**: mientras `entrenar-garmin.js` no exporte `renderPRsOficiales`
  Y `renderPredicciones`, la card legada `#cardPRs` sigue viva con
  `charts.renderPRs`. Cuando ambos exports existan, app.js la oculta y deja de
  llamar a `renderPRs` (no borres `renderPRs` de charts.js todavía).
- **Insights**: app.js pinta `#insightDia` + 5 insights de pestaña con cadena de
  fallback (ver §4.7). Cada llamada envuelta en try/catch: si tu módulo lanza, cae solo tu card.
- app.js gestiona banner de error, chip de frescura, footer, tema, rango. Los módulos NO tocan eso.

---

## 4. Módulos: firmas EXACTAS

### 4.1 `web/js/today.js` (C1 — amplía; conserva los exports actuales)

```js
export function renderSemaforo(ctx): void            // ampliada (§2.1)
export function renderStatTiles(ctx): void           // modificada: 4 tiles (peso muere)
export function renderDesgloseReadiness(ctx): void   // NUEVA (§2.2)
export function renderConstantes(ctx): void          // NUEVA (§2.3)
```

- **`renderSemaforo`** — lógica del semáforo INTACTA. Adiciones (§2.1):
  - `#garminOpina`: «**Garmin opina:** readiness 58 · moderado — buena recuperación»
    desde la ÚLTIMA entrada de `data.health` con `readiness_score` de la fecha de
    referencia (día de `meta.updated`); `level` → `NIVEL_READINESS`,
    `readiness_feedback` → `FEEDBACK_READINESS` (fallback «recuperación correcta»).
    Sin entrada de hoy → texto exacto «**Garmin aún no ha puntuado hoy**» y no se
    declara acuerdo ni desacuerdo. Sin `data.health` → `#garminOpina` queda vacío
    (la card no degrada por esto).
  - `#kpiAcuerdo`: «semáforo y Garmin coinciden N de M días» — mapa
    verde↔HIGH/PRIME · ámbar↔MODERATE · rojo↔LOW sobre los días con ambos
    veredictos; **guarda n≥20** o se deja vacío (`''`).
  - `#acwrNota` gana la lectura Garmin textual: «Garmin: carga al 100 %» (`acwr_pct` del día).
- **`renderStatTiles`** — el tile de peso MUERE aquí (vive como card §2.21 en
  Cuerpo): quedan 4 tiles (km semana, racha, carreras/4sem, tiempo total del rango).
- **`renderDesgloseReadiness`** — card `#cardDesgloseReadiness`, canvas
  `chartDesgloseReadiness`. Barras horizontales 0–100, UNA serie S1, orden FIJO:
  sueño de anoche (`factor_sleep_pct`), historial de sueño (`factor_sleep_hist_pct`),
  HRV (`factor_hrv_pct`), tiempo de recuperación (`factor_recovery_pct`),
  historial de estrés (`factor_stress_pct`), carga ACWR (`acwr_pct`) — del día más
  reciente de `data.health` con `readiness_score` no null. Sin leyenda; % como
  etiqueta directa al final de la barra; feedback traducido (`FEEDBACK_FACTOR`) como
  texto muted junto a la barra, **jamás coloreando la barra**; tooltip con el
  feedback. Sin día con readiness → `emptyState`.
- **`renderConstantes`** — card `#cardConstantes`, contenedor `#constantesTiles`.
  6 stat-tiles (reusa `.tile` + `sparklineSvg`, sparkline = últimos 14 días de
  `data.health`): ① RHR hoy + delta vs `rhr_7d` + **badge percentil personal**
  («p10 de tus últimos 90 días», `percentileRank` sobre los últimos 90 días con
  dato, guarda n≥60, tinta ▲▼); ② SpO2 sueño (`spo2_sleep`); ③ respiración sueño
  (`resp_sleep`); ④ estrés medio de ayer + qualifier (`QUALIFIER_ESTRES`);
  ⑤ pasos de ayer vs `step_goal`; ⑥ minutos intensidad de la semana vs 150 OMS
  (tooltip: ponderado mod+2×vig). Día sin dato → placeholder «— sin dato»
  (`.tile--placeholder`), nunca ocultar el tile. Sin `data.health` → `emptyState`.

### 4.2 `web/js/sparkline.js` (sin cambios)

```js
export function sparklineSvg(values, opts?): SVGSVGElement   // {width=90, height=24, color=SERIES.s1}
```

### 4.3 `web/js/charts.js` (C5 — amplía; los 11 exports actuales conservan firma)

```js
export function renderKmSemana(ctx)    // sin cambios
export function renderPRs(ctx)         // sin cambios — NO borrar hasta que muera #cardPRs
export function renderEF(ctx)          // sin cambios
export function renderRitmoFc(ctx)     // sin cambios
export function renderDesacople(ctx)   // sin cambios
export function renderMensual(ctx)     // AMPLIADA: columna «% Z2»
export function renderZonas(ctx)       // AMPLIADA: KPI «% tiempo real ≤142»
export function renderIntensidad(ctx)  // sin cambios
export function renderCadencia(ctx)    // sin cambios
export function renderSueno(ctx)       // sin cambios
export function renderHrv(ctx)         // sin cambios (banda dinámica de status.hrv_baseline)
```

- **`renderZonas`** (§2.6): `#kpiZonas` añade «% tiempo real ≤142: X %» = media
  **ponderada por duración** de `runsDetail[id].pct_z2` de las carreras del
  histórico; carreras con `pct_z2:null` se excluyen del ponderado y se dice
  cuántas. Sin ningún `pct_z2` → KPI actual intacto (sin línea nueva).
- **`renderMensual`** (§2.6): la tabla `#tablaMensual` YA tiene el `<th>` «% Z2»
  (7 columnas): emite la celda `td.num` con el % Z2 real ponderado del mes (o '–').

### 4.4 `web/js/heatmap.js` (sin cambios)

```js
export function renderHeatmap(ctx): void
```

### 4.5 `web/js/modal.js` (C5 — amplía; firmas intactas)

```js
export function initModal(ctx): void
export function openRunModal(runId: number): void   // GUARD: carrera inexistente → return
export function renderHistorial(ctx): void
```

Adiciones (§2.26):
- `openRunModal`: fila «readiness esa mañana: N (nivel traducido)» si el run trae
  `readiness_dia` (o lookup en `data.health` por `date`); fila «sudor estimado:
  X ml» si `data.health[date].sweat_ml` existe. Ambas se omiten en silencio si faltan.
- `renderHistorial`: los badges 🏆 pasan a alimentarse de `data.prs` oficial
  (match por `activity_id` ↔ `run.id`; tooltip/aria con el tipo de récord).
  **Fallback de paridad**: con `data.prs` null, conserva la lógica computada actual.

### 4.6 `web/js/scatter.js` (C5 — amplía; firmas intactas)

```js
export function renderCorrelaciones(ctx): void
export function initExplorador(ctx): void
```

Adiciones (§2.25):
- Ejes X nuevos (campos que el pipeline añade a `runs.json`; pueden no existir aún —
  degrada omitiendo la opción si NINGUNA carrera trae el campo): `rhr_dia`
  («FC reposo del día»), `stress_prev` («estrés medio del día previo»),
  `readiness_dia` («readiness matinal»), `spo2_prev` («SpO2 del sueño previo»).
- Los 3 tiles destacados se recalculan incluyendo las variables nuevas (top |r|, n≥15),
  conservando la anti-intuición.
- **Regla anti-tautología (§1.3)**: pares métrica↔insumo de su propio algoritmo
  quedan EXCLUIDOS del precálculo de destacadas; si el usuario los configura a mano,
  `#scatterInfo` añade la etiqueta exacta «relación por construcción: Garmin calcula
  una con la otra». Pares tautológicos: `readiness_dia` ↔ cualquiera de
  {`sleep_score_prev`, `sleep_hours_prev`, `hrv_morning`, `stress_prev`}.

### 4.7 `web/js/insights.js` (C6 — amplía; PURO: sin DOM, sin Chart, testeable en Node)

```js
// Se conservan: insightDelDia, insightHoy, insightArchivo (y los antiguos de acto
// mientras convenga: app.js los usa como fallback y tolera su desaparición).
export function insightEntrenar(data): string    // NUEVA → #insightEntrenar
export function insightRecuperar(data): string   // NUEVA → #insightRecuperar
export function insightCuerpo(data): string      // NUEVA → #insightCuerpo
```

app.js pinta con cadenas de fallback (primera función existente que devuelva texto):
`insightEntrenar → insightSemana → insightProgreso` · `insightRecuperar →
insightRecuperacion` · `insightCuerpo → (vacío)`.

Plantillas y guardas EXACTAS (§5 — fallback neutro si ninguna pasa; jamás lanzan):

| destino | plantilla | guardas |
|---|---|---|
| insightHoy (amplía) | «Llevas N días con readiness ≥70» | racha ≥3 días con dato; frescura <2d |
| insightHoy (amplía) | «Tu FC en reposo de hoy está en tu p10 de 90 días» | n≥60 en ventana; dato de hoy o ayer; percentil ≤15 o ≥85 |
| insightEntrenar | «Garmin estima tu 5K en 31:03, X min menos que hace un mes» | ≥28 días de snapshots en trends y Δ≥60 s |
| insightRecuperar | «Tu estrés medio de [mes] (X) supera al de [mes-1] (Y)» | ≥21 días con dato en cada mes y Δ≥5 puntos |
| insightCuerpo | «Tu RHR lleva ≥3 días ≥5 lpm sobre tu media de 30 días — posible fatiga o incubando algo» | Δ≥5 lpm y ≥3 días consecutivos |
| insightCuerpo | «Semana pasada: X/150 min de intensidad (recomendación OMS)» | factual; frescura <7d |
| insightCuerpo | «Tu edad fitness (28,1) ya es menor que tu edad real (29)» | factual; frescura <7d |
| insightCuerpo (SpO2) | «Media de sueño baja sostenida: el sensor de muñeca puede infravalorar; coméntalo con tu médico si se mantiene» | SOLO media de sueño <90 % durante ≥7 días consecutivos; jamás por un mínimo aislado; jamás rojo |

**Prohibidos** (tautologías Garmin): sueño→readiness, estrés→readiness,
temperatura→sweatLoss como «hallazgos».

### 4.8 `web/js/entrenar-garmin.js` (C2 — NUEVO)

```js
export function renderPRsOficiales(ctx): void   // #prOficialesList · card #cardPRsOficiales · HISTÓRICO
export function renderPredicciones(ctx): void   // #prediccionesGarmin + #predDistancia + canvas #chartPredicciones (+#predBadge) · card #cardPredicciones · HISTÓRICO
export function renderUmbral(ctx): void         // #umbralKpis (+#umbralBadge) · card #cardUmbral · HISTÓRICO
export function renderCargaGarmin(ctx): void    // canvas #chartCarga + #chartVo2max · card #cardCargaGarmin · HISTÓRICO
```

- **`renderPRsOficiales`** (§2.7): filas `.pr-row` desde `data.prs` (9), etiqueta por
  mapping de `type_id` (§0.4) con fallback «Récord tipo N»; valor formateado
  (`fmtDur` para tiempos, km con 2 decimales para typeId 7), fecha (`fmtDateEs`) y
  nombre de actividad; click/Enter → `openRunModal(activity_id)` (el guard interno
  del modal ya hace `if (!run) return`). `data.prs` null → `emptyState`.
- **`renderPredicciones`** (§2.8): `#prediccionesGarmin` = 4 KPIs `.kpi-item`
  (5K/10K/media/maratón, `fmtDur` desde `pred_*_s` del ÚLTIMO snapshot de
  `data.trends`) en columna etiquetada «Garmin (modelo Firstbeat, extrapola de tu
  VO₂max)» + columna «Riegel sobre tu mejor esfuerzo real» (reusa el cálculo Riegel
  exp 1.06 sobre `data.runs`). Selector `#predDistancia` + `chartPredicciones`:
  línea S1 de la distancia elegida SOLO con **≥14 snapshots**; con menos, oculta el
  chart-wrap con `[hidden]`… NO: usa `#predBadge.textContent = 'serie en construcción
  desde sep 2026'` y deja el canvas fuera vía `emptyState` parcial — regla práctica:
  si hay <14 snapshots pinta los KPIs y escribe el badge; el `.chart-wrap` y
  `.pred-controls` se ocultan con el atributo `hidden` (nunca display:none inline).
  `data.trends` null/vacío → `emptyState` de toda la card.
- **`renderUmbral`** (§2.9): 3 KPIs `.kpi-item` en `#umbralKpis` desde el último
  snapshot: «FC umbral 177 lpm» + fecha `lt_date` («último recálculo: 21 ago»);
  «FTP running 352 W» + etiqueta por `ftp_origin` (`'weight'` → «estimado por peso,
  no medido»); «4,24 W/kg» (`ftp_wkg`). **El ritmo de umbral NO se pinta** salvo
  `lt_speed_unit_verified === true` (entonces `lt_speed_raw`×10 → m/s → `paceFmt`).
  `#umbralBadge`: «serie en construcción» si <5 valores distintos de `lt_hr` (§2.9,
  tendencia diferida). Sin trends → `emptyState`.
- **`renderCargaGarmin`** (§2.10): small multiples con eje X común (fechas de
  `data.statusHistory`, filas con carga no null): arriba `chartCarga` — `acute_load`
  S1 + `chronic_load` S2, leyenda, banda `optimal_min`–`optimal_max` de
  `data.status` con `makeBandPlugin` (gris, etiquetada «rango óptimo»); abajo
  `chartVo2max` — línea escalonada (`stepped: true`) S2 con puntos SOLO en cambios
  de valor. **Guarda: ≥14 puntos no nulos** o `emptyState` explicativo. Jamás doble eje.

### 4.9 `web/js/recuperar.js` (C3 — NUEVO)

```js
export function renderReadinessTiempo(ctx): void      // canvas #chartReadiness · card #cardReadinessTiempo · RANGO (fHealth)
export function renderEstresDiario(ctx): void         // canvas #chartEstres · card #cardEstresDiario · RANGO (fHealth)
export function renderEstresSemanal(ctx): void        // canvas #chartEstresSemanal · card #cardEstresSemanal · RANGO (fHealth)
export function renderBodyBattery(ctx): void          // canvas #chartBodyBattery · card #cardBodyBattery · RANGO (fDaily)
export function renderMensualRecuperacion(ctx): void  // tbody #tablaRecuperacionBody · card #cardMensualRecuperacion · HISTÓRICO
```

- **`renderReadinessTiempo`** (§2.12): línea `readiness_score` S2 2px + media móvil
  7d en `TOKENS.muted` (`movingAvg`); nivel traducido (`NIVEL_READINESS`) en el
  TOOLTIP, jamás coloreando la línea. Días null (pre-registro) → huecos
  (`spanGaps: false`). Eje `suggestedMin:0, suggestedMax:100`.
- **`renderEstresDiario`** (§2.13): línea `stress_avg` S1 + media móvil 7d S2,
  leyenda visible (2 series). Tooltip: `stress_max` y qualifier traducido. La escala
  vive en la nota bajo la card (ya escrita en el HTML), NO como zonas coloreadas.
- **`renderEstresSemanal`** (§2.14): barras apiladas 100 % por semana ISO
  (`isoWeekKey`): los 4 `stress_*_pct` **normalizados sobre su propia suma** (no
  suman 100 en crudo: actividad y sin clasificar quedan fuera — no inventar 5.ª
  categoría). Colores `RAMPA_ESTRES` [reposo→alto], gap 2px (border `TOKENS.card`),
  leyenda («reposo/bajo/medio/alto»).
- **`renderBodyBattery`** (§2.15): barras flotantes `[bb_low, bb_high]` por día
  (S3 al 30 % — formato Chart.js `data: [[low,high],…]`) + scatter del `bb_last`
  (punto S3). Tooltip: `bb_charged`/`bb_drained`. Eje 0–100 sugerido.
- **`renderMensualRecuperacion`** (§2.16): tabla por mes (mismas clases que
  `#tablaMensual`; thead YA escrito: Mes · Sueño · Score · HRV · Estrés · Readiness ·
  BB máx): medias mensuales de `daily` (sueño h, sleep_score, hrv, bb_high) +
  `health` (stress_avg, readiness_score). ▲▼ vs mes anterior con **dirección de
  juicio por métrica: en estrés, bajar es ▲ mejora** (color de `ESTADO` +
  `aria-label` mejor/peor).

Todos: sin `data.health` (o sin filas con el campo en el rango) → `emptyState`
explicativo («los datos de salud aún se están recolectando» durante el backfill).

### 4.10 `web/js/cuerpo.js` (C4 — NUEVO)

```js
export function renderRhr(ctx): void           // canvas #chartRhr · card #cardRhr · RANGO (fHealth)
export function renderSpo2(ctx): void          // canvas #chartSpo2 · card #cardSpo2 · RANGO (fHealth)
export function renderRespiracion(ctx): void   // canvas #chartRespiracion · card #cardRespiracion · RANGO (fHealth)
export function renderEdadFitness(ctx): void   // #edadFitnessCifras/#edadFitnessFrase/#edadFitnessBullets/#edadFitnessPalanca/#edadFitnessBadge + canvas #chartEdadFitness · card #cardEdadFitness · EXENTA (data.trends)
export function renderPeso(ctx): void          // canvas #chartPeso + #kpiImc · card #cardPeso · HISTÓRICO (data.daily + trends)
export function renderActividad(ctx): void     // canvas #chartPasos + #chartIntensidadSemanal · card #cardActividad · RANGO (fHealth)
export function renderMensualCuerpo(ctx): void // tbody #tablaCuerpoBody · card #cardMensualCuerpo · HISTÓRICO
```

- **`renderRhr`** (§2.17): línea diaria `rhr` S1 (puntos 3px al 40 %) + media móvil
  7d S2 protagonista 2px. Banda gris `makeBandPlugin({from:60, to:100,
  label:'60–100 lpm · rango adulto habitual'})` (referencia, no estado). Tres líneas
  horizontales finas muted p10/p50/p90 de los ÚLTIMOS 90 días con dato
  (calcúlalas con la serie recortada; puedes usar `makeBandPlugin({y:…})` ×3 con
  labels 'p10'/'p50'/'p90'). `suggestedMin/Max` ceñidos.
- **`renderSpo2`** (§2.18): línea `spo2_sleep` S1 + puntos sueltos `spo2_min` al
  40 % en la MISMA familia, forma `pointStyle:'triangle'`, `showLine:false` (NO
  unidos). Banda etiquetada «≥95 % típico a nivel del mar» (from:95,to:100).
  Eje `suggestedMin:85, suggestedMax:100` — nunca desde 0 ni recortando datos.
  Leyenda 2 entradas.
- **`renderRespiracion`** (§2.19): 2 líneas con leyenda: `resp_waking` S1 y
  `resp_sleep` S3, tooltips `mode:'index'`. Banda «12–20 rpm en vigilia».
- **`renderEdadFitness`** (§2.20): del ÚLTIMO snapshot de `data.trends`:
  `#edadFitnessCifras` = 3 `div.cifra` («edad real 29» `chrono_age` · «edad fitness
  28,1» `fitness_age` · «alcanzable 21,1» `fitness_age_achievable`);
  `#edadFitnessFrase` generada («tu cuerpo funciona 0,9 años más joven que tu DNI;
  el margen de mejora son 7 años»); `#edadFitnessBullets` = bullet bars SVG (mismo
  patrón `.bullet`/`.bullet-label` de today.js) por componente: IMC, días
  vigorosos/sem, min vigorosos/sem (`value` vs `targetValue`, `potentialAge` en
  tooltip, flag `stale` → badge textual «dato antiguo») y **FC reposo SOLO valor,
  sin marcador de objetivo** (comp_rhr no trae targetValue/potentialAge — no
  inventarlos); `#edadFitnessPalanca` = «tu palanca más rentable: [componente con
  potentialAge más bajo; priority como desempate]»; `chartEdadFitness` = tendencia
  de `fitness_age` SOLO con ≥14 snapshots — con menos, `#edadFitnessBadge` =
  «serie en construcción desde sep 2026» y el `.chart-wrap` de la card con
  `[hidden]`. Sin trends → `emptyState`.
- **`renderPeso`** (§2.21): puntos de `daily[].weight_kg` no null unidos con línea
  S1 al 40 %; `#kpiImc` = «IMC actual: X (normal)» desde `comp_bmi.value` del
  último snapshot de trends + contador honesto «N pesajes desde marzo». Bandas OMS
  grises etiquetadas (18,5–25 normal · 25–30 sobrepeso) con `makeBandPlugin` sobre
  un eje… ojo: las bandas OMS son de IMC y la serie es kg — pinta las bandas en kg
  equivalentes (IMC×altura²; altura derivable de peso/IMC actuales) o limita las
  bandas al texto del KPI si prefieres no mezclar unidades; lo que NO puede pasar
  es un segundo eje. Sin pesajes → `emptyState`.
- **`renderActividad`** (§2.22): (a) `chartPasos`: barras `steps` S1 + línea
  escalonada muted de `step_goal` etiquetada «objetivo (dinámico)» en leyenda;
  tooltip con `active_kcal` y `floors_up`. (b) `chartIntensidadSemanal`: barras por
  semana ISO de minutos PONDERADOS (`intensity_mod` + 2×`intensity_vig`) +
  `makeBandPlugin({y:150, label:'150 min/sem · OMS'})`.
- **`renderMensualCuerpo`** (§2.23): tabla por mes (thead YA escrito: Mes · Peso ·
  RHR · VO₂max · Pasos/día · Min int/sem): peso medio (`daily`), RHR media
  (`health`), VO2max de FIN de mes (`statusHistory`), pasos/día medios, min
  intensidad ponderados/sem. ▲▼ con dirección de juicio (RHR: bajar es ▲).

Todos: guard de `data.health`/`data.trends` null → `emptyState` explicativo.
La nota médica fija del panel NO se toca desde JS.

---

## 5. Partición por pestaña (la implementa app.js — referencia)

| Pestaña | Dependientes del rango | Exentos (badge ya en el HTML) |
|---|---|---|
| hoy | — | renderSemaforo, renderDesgloseReadiness, renderConstantes |
| entrenar | renderStatTiles, renderKmSemana, renderEF, renderRitmoFc, renderDesacople, renderIntensidad, renderCadencia | renderZonas, renderMensual, [renderPRs mientras viva], renderPRsOficiales, renderPredicciones, renderUmbral, renderCargaGarmin |
| recuperar | renderSueno, renderHrv, renderReadinessTiempo, renderEstresDiario, renderEstresSemanal, renderBodyBattery | renderMensualRecuperacion |
| cuerpo | renderRhr, renderSpo2, renderRespiracion, renderActividad | renderEdadFitness, renderPeso, renderMensualCuerpo |
| archivo | — | renderHeatmap, renderCorrelaciones, initExplorador, renderHistorial |

`initModal(ctx)` se llama UNA vez en init global (antes de cualquier render).

## 6. Inventario de ids del DOM (index.html YA ESCRITO)

| Zona | Ids |
|---|---|
| Header | `insightDia` |
| Sticky bar | `stickyBar`, `tabBar` (botones `.tab-btn[data-tab]`, ids `tab-hoy…tab-archivo`), `rangeSelector` (`.range-btn[data-range]`), `freshChip`, `themeToggle` |
| Error | `errorBanner`, `errorMsg`, `retryBtn` |
| Paneles (section[role=tabpanel]) | `panel-hoy`, `panel-entrenar`, `panel-recuperar`, `panel-cuerpo`, `panel-archivo` |
| Insights de pestaña | `insightHoy`, `insightEntrenar`, `insightRecuperar`, `insightCuerpo`, `insightArchivo` |
| 2.1 Semáforo | `cardSemaforo`, `semaforoIcono`, `semaforoMensaje`, `semaforoSr`, `semaforoRazones`, `bulletHrv`, `bulletBB`, `bulletAcwr`, `acwrNota`, **`garminOpina`**, **`kpiAcuerdo`** |
| 2.2 Desglose readiness | `cardDesgloseReadiness`, `chartDesgloseReadiness` |
| 2.3 Constantes | `cardConstantes`, `constantesTiles` |
| 2.4 Tiles / Km | `cardTiles`, `statTiles` · `cardKmSemana`, `chartKmSemana` |
| 2.5 Progreso | `cardEF`, `chartEF`, `efBadge` · `cardRitmoFc`, `chartRitmo`, `chartFc` · `cardDesacople`, `chartDesacople` |
| 2.6 Intensidad | `cardZonas`, `chartZonas`, `kpiZonas` · `cardIntensidad`, `chartIntensidad`, `kpiIntensidad` · `cardCadencia`, `chartCadencia`, `kpiCadencia` · `cardMensual`, `tablaMensual`, `tablaMensualBody` |
| PRs legado (transición) | `cardPRs`, `prList`, `predicciones` |
| 2.7 PRs oficiales | `cardPRsOficiales`, `prOficialesList` |
| 2.8 Predicciones | `cardPredicciones`, `prediccionesGarmin`, `predDistancia`, `chartPredicciones`, `predBadge` |
| 2.9 Umbral | `cardUmbral`, `umbralKpis`, `umbralBadge` |
| 2.10 Carga/VO2max | `cardCargaGarmin`, `chartCarga`, `chartVo2max` |
| 2.11 Sueño/HRV | `cardSueno`, `chartSueno` · `cardHrv`, `chartHrv` |
| 2.12 Readiness tiempo | `cardReadinessTiempo`, `chartReadiness` |
| 2.13 Estrés diario | `cardEstresDiario`, `chartEstres` |
| 2.14 Reparto estrés | `cardEstresSemanal`, `chartEstresSemanal` |
| 2.15 Body Battery | `cardBodyBattery`, `chartBodyBattery` |
| 2.16 Mes recuperación | `cardMensualRecuperacion`, `tablaRecuperacion`, `tablaRecuperacionBody` |
| 2.17 RHR | `cardRhr`, `chartRhr` |
| 2.18 SpO2 | `cardSpo2`, `chartSpo2` |
| 2.19 Respiración | `cardRespiracion`, `chartRespiracion` |
| 2.20 Edad fitness | `cardEdadFitness`, `edadFitnessCifras`, `edadFitnessFrase`, `edadFitnessBullets`, `edadFitnessPalanca`, `edadFitnessBadge`, `chartEdadFitness` |
| 2.21 Peso | `cardPeso`, `kpiImc`, `chartPeso` |
| 2.22 Actividad | `cardActividad`, `chartPasos`, `chartIntensidadSemanal` |
| 2.23 Mes cuerpo | `cardMensualCuerpo`, `tablaCuerpo`, `tablaCuerpoBody` |
| 2.24 Heatmap | `cardHeatmap`, `heatmapPager`, `heatmapContainer`, `kpiFuerza` |
| 2.25 Correlaciones | `cardCorrelaciones`, `corrTiles`, `corrN` · `cardExplorador`, `scatterX`, `scatterY`, `presetBedtime`, `chartScatter`, `scatterInfo` |
| 2.26 Historial | `cardHistorial`, `runsTable`, `runsTableBody`, `verTodasBtn` |
| Modal | `runModal`, `modalClose`, `modalTitle`, `modalBody` |
| Footer | `footerUpdated` |

Clases CSS ya estiladas para los módulos: las de v1 (`.tile*`, `.bullet*`,
`.pr-row`/`.pr-valor`, `td.num`, `.col-*`, `.badge-pr`, `.badge-split`,
`.heatmap-tip`, `.modal-zonas`, `.splits-table`, `.empty-state`, `estado-*`)
más las NUEVAS: `.kpi-grid` + `.kpi-item` (KPIs monospace en rejilla),
`.ef-cifras` + `.cifra` (cifras grandes de edad fitness), `.ef-bullets`,
`.garmin-opina`, `.kpi-acuerdo`, `.nota-medica`, `.pred-controls`,
`.tab-bar`/`.tab-btn` (solo app.js).

## 7. Reglas transversales (§8 spec salud + §10 spec base)

- Prohibido doble eje Y. `suggestedMin/Max`, jamás `min/max` fijos.
- Colores de estado NUNCA en barras/líneas de datos; siempre icono+texto.
- Bandas de referencia: gris neutro etiquetado («referencia poblacional, no estado»).
- Percentiles personales: tinta (▲▼+texto), guarda n≥60 diarias / n≥20 carrera.
- Wording médico prudente: SpO2 jamás dispara rojo; nada de diagnóstico.
- Constantes Garmin traducidas por diccionario; no mapeada → fallback de la card.
- Leyenda solo con ≥2 series. Grid solo horizontal. Cifras monospace tabular.
- Toda card exenta del rango YA lleva su badge en el HTML — no lo dupliques.
- `paceFmt` para TODO ritmo visible. Español en UI y comentarios. ES2020+, sin build.
- NO prometer/pintar: endurance/hill score, composición corporal más allá del peso,
  histórico VO2max por API, series intradía, running tolerance, hidratación
  registrada, ritmo de umbral sin verificar (§8).
- Verificación por fichero: `node --input-type=module --check < web/js/tu-modulo.js`.
