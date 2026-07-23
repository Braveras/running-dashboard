# SPEC FINAL — «Zona Dos» · Rediseño del dashboard de running de Alejandro

**Base:** propuesta ganadora "ZONA DOS — Cuaderno de entrenamiento" (2 de 3 jueces), con injertos consensuados de "Cabina Z2" y "Base 142" y correcciones obligatorias verificadas contra `data/*.json`.

---

## 1. Visión

El dashboard deja de ser un muro de 14 cards idénticas y se convierte en el **parte diario de un entrenador**: una página editorial en columna única con 6 actos que responden en orden las preguntas de un corredor Z2 de bajo volumen:

**¿Corro hoy? → ¿Cómo va la semana? → ¿Progreso? → ¿Controlo la intensidad? → ¿Me recupero? → Archivo.**

Cada acto abre con un **insight en texto generado de los datos reales** («En julio corres al ritmo de marzo con 10 ppm menos de FC») y las gráficas actúan como evidencia de la frase, no al revés. Mucho aire, jerarquía tipográfica fuerte, cero dobles ejes, cero ejes que recortan datos, cero notas que mienten.

Stack: **estático sin build** en GitHub Pages. Chart.js 4 **vendorizado** en `web/vendor/chart.umd.min.js` (muere el CDN; guard `typeof Chart === 'undefined'` → banner). ES modules nativos. Idioma: español. Tema: **solo oscuro en v1**, diseñado (no invertido).

---

## 2. Paleta exacta (hex validados por script)

Todos los valores ejecutados contra
`node .../dataviz/scripts/validate_palette.js --mode dark --surface "#161b24"` el 2026-07-23.

### 2.1 Tokens de superficie y texto
| Token | Hex | Uso |
|---|---|---|
| `--bg` | `#0e1116` | fondo página, `meta theme-color` |
| `--card` | `#161b24` | superficie de card/gráfica |
| `--card2` | `#1c2330` | superficie elevada (chips, celda vacía heatmap) |
| `--border` / `--grid` | `#232b3a` | bordes, grid recesivo (solo horizontal, al 50%) |
| `--txt` | `#e8edf4` | texto primario |
| `--muted` | `#94a0b3` | texto secundario (~7:1 sobre bg, AA holgado) |

### 2.2 Series categóricas — orden FIJO, nunca cicladas ✅ ALL PASS
Validadas sobre `#161b24` **y** `#0e1116`: banda L 0.48–0.67 ✓, chroma ✓, CVD peor par adyacente ΔE 16.0 (deutan) ✓, visión normal 19.7 ✓, contraste ≥3:1 ✓.

| Slot | Hex | Asignación fija |
|---|---|---|
| S1 azul | `#3987e5` | volumen (km/semana), ritmo, desacople, scatter, sparklines |
| S2 verde-aqua | `#199e70` | EF Z2 (protagonista), HRV, medias móviles de S1 |
| S3 violeta | `#9085e9` | FC, sueño, «otra actividad» en heatmap |
| S4 magenta | `#d55181` | cadencia |

### 2.3 Estado — RESERVADO, siempre icono+texto, jamás como serie
`verde #4dd0a6` · `ámbar #f6a35b` · `rojo #ef6b6b` — solo semáforo, umbrales etiquetados, badges de frescura y flechas de tendencia (▲▼ + texto). Nunca colorean barras/líneas de datos.

### 2.4 Rampas secuenciales — un solo tono, claro→oscuro ✅ ALL PASS (`--ordinal`)
**CORRECCIÓN sobre la propuesta original:** su rampa azul terminaba en `#104281`, que **FALLA** el validador (1.74:1 vs `#161b24`, suelo 2:1). Rampas corregidas y validadas:

- **Zonas FC (5 pasos, Z1 claro → Z5 oscuro):** `#b7d3f6 · #86b6ef · #5598e7 · #2f7bd9 · #1e60b0` — monotonía ✓, ΔL≥0.06 ✓, extremo 2.76:1 ✓, hue spread 3° ✓.
- **Heatmap calendario (4 pasos, poco→mucho km = oscuro→claro):** `#1e60b0 · #2f7bd9 · #5598e7 · #9ec4f2` — mismas comprobaciones PASS. Celda vacía: `#1c2330`. Nota: la rampa ya **no comparte hex** con S1 `#3987e5` (resuelve la colisión de roles señalada por los jueces).
- **Fases de sueño (3 pasos violeta):** `#b9b0f4 (ligero) · #9085e9 (REM) · #6b5fd0 (profundo)` — PASS (extremo oscuro 3.43:1).

**Contrato:** si algún día se cambia un hex o se añade tema claro, re-ejecutar el validador (`--mode light` con la superficie clara) antes de publicar. Las rampas no se usan fuera de su gráfica asignada.

---

## 3. Tipografía

Sin fuentes externas (0 KB, sin FOUT):

- **Texto/UI:** `system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', sans-serif` (arregla el fallback roto actual fuera de Windows).
- **Cifras (injerto de Cabina Z2):** números héroe, ticks de eje, tablas y stat-tiles en `ui-monospace, 'Cascadia Mono', 'SF Mono', Consolas, monospace` con `font-variant-numeric: tabular-nums`. Solo en cifras, nunca en UI.
- **Escala:** display 32/700 (−0.5px) header · acto (h2) 22/700 · insight 19–20/500 en `--txt` · h3 de card 15/600 · KPI 28/700 · cuerpo/notas 13px mínimo · labels mínimos 11px.
- Texto SIEMPRE en tokens de tinta, jamás en color de serie.

**Marcas:** líneas 2px · barras finas con extremos redondeados 4px anclados a la baseline · gap 2px entre segmentos apilados · puntos ≥3px (8px de hit-area; scatter 8px con anillo 2px de color de superficie) · grid recesivo sin líneas verticales ni borde de eje · leyenda siempre que haya ≥2 series, nunca con 1.

---

## 4. Layout

Columna única editorial, `max-width: 1060px`, padding 32/24 (14px móvil), 64px de aire entre actos, 18px entre cards. Cards: radio 12px, padding 20px (14 móvil), borde 1px `--border`, sin sombras duras.

**Header:** `<header>` con h1 «Zona Dos» 32/700, subtítulo muted («Cuaderno de entrenamiento · Madrid») y el **INSIGHT DEL DÍA** en 20px (frase generada con guardas; fallback neutro).

**Barra sticky** (bajo el header, backdrop-blur con fallback sólido, borde inferior `--border`):
- Anclas de los 6 actos con scroll-spy (chips scrollables en móvil).
- Selector de rango **7d/30d/90d/Todo** con `aria-pressed`, min-height 44px táctil.
- **Chip de frescura** (injerto Cabina): «datos: hoy 21:02» desde `meta.json:updated`; si >24h → ámbar con icono y texto «datos de hace N días».
- **Regla sin excepciones:** toda card que ignore el rango lleva badge «⟳ histórico completo» junto al título.

Breakpoints: grids internos 2→1 col a ≤760px; a ≤600px canvas a altura fija 220px (`maintainAspectRatio:false`), targets ≥44px, selects ≥16px (mata el auto-zoom iOS). `matchMedia` unificado a 600px con listener de `change`. Semántica: `<main>`, `<section id>` por acto, `<nav>`, `<meta name="theme-color" content="#0e1116">`.

---

## 5. Secciones (completas, con datos fuente)

### ACTO 1 · HOY
**1.1 Semáforo hero** — panel de estado (sin canvas)
- Card ancho completo, borde izquierdo 3px + fondo teñido al 8% del color de estado; icono en círculo 40px (✓/!/✕) + mensaje 20/700 («Sal a correr — Z2 suave») + lista de razones 13.5px. Estado **gris neutro mientras carga** (nunca ámbar hardcodeado en HTML). Texto sr-only «Semáforo: verde».
- **Lógica documentada en comentario:** (1) guard de frescura: si `daily[último].date !== hoy` → «datos de hace N días» + degradar a ámbar; (2) HRV (`daily.hrv`) vs banda `status.json:hrv_baseline.balancedLow/balancedUpper` (51–91): por debajo → penaliza; (3) `sleep_hours`/`sleep_score` bajos → penaliza; (4) `party:true` → ámbar, rojo solo si además HRV < baseline; (5) ACWR < 0.8 **refuerza verde** («carga muy baja: hoy toca salir» — hoy 35/137 = 0.26); (6) **Body Battery — CORRECCIÓN obligatoria:** `daily.json` NO trae nivel absoluto (verificado: solo `bb_charged`/`bb_drained`). Regla v1: balance `bb_charged − bb_drained` del día previo muy negativo → ámbar, etiquetado «balance Body Battery». El nivel absoluto exigiría exportarlo desde `scripts/fetch_data.py` (fase 2); no prometerlo antes.
- Derecha (columna 320px, apila en móvil): **3 bullet bars SVG** (injerto Base 142, más legibles que chips planos): HRV vs banda 51–91 · balance Body Battery · **ACWR** con bandas <0.8 / 0.8–1.3 / >1.5 y marcador — calculado por km propio de `runs.json` día a día (suavizado con media exponencial) + ratio Garmin (`status.json:acute_load/chronic_load`) como segunda lectura textual.
- **Mueren:** la gráfica de carga de 2 barras y la card Body Battery (sus datos viven aquí).
- Datos: `daily.json` (hrv, sleep_*, party, bb_*), `status.json` (acute_load, chronic_load, hrv_baseline), `runs.json` (km/día).

### ACTO 2 · ESTA SEMANA
**2.1 Stat-tiles con sparklines** — 4 tiles (auto-fit minmax(160px,1fr)): Km semana ISO + delta vs media 4 sem · **Racha real** (semanas consecutivas con ≥1 carrera) · Carreras/4 sem · Tiempo total del rango. Valor 28/700 monospace tabular-nums **en `--txt`**, marca de color 8px al lado, delta con flecha+texto, **sparkline SVG inline** 90×24px en S1 (helper propio ~40 líneas, sin Chart.js). El peso vive como tile («último: 88.0 kg + delta», placeholder si no hay dato — **nunca `display:none`**; solo hay 4 pesajes `weight_kg` en `daily.json`, no merece gráfica). Datos: `runs.json`, `daily.json`.

**2.2 Km por semana** — barras S1 finas por semana ISO + línea media móvil 4 sem S2 2px; semana en curso con relleno al 40% y etiqueta «en curso». Respeta rango. Datos: `runs.json` (date, km). *La gráfica que faltaba.*

**2.3 Récords personales + Predicciones** — lista densa de 6 PRs computados en cliente con fecha y click→modal: mejor ritmo (7:11/km · 07-07) · mejor km de splits (6:38, de `runs_detail.json:splits`) · más larga (6.06 km · 19-05) · mejor EF (0.98) · mejor semana (8.75 km) · mejor mes (abril, 28.8 km). Debajo: **Riegel** (exp 1.06) 5k/10k desde el mejor esfuerzo real + equivalencia del `status.json:vo2max` 45, mostrando el gap potencial-vs-actual como motivación. 🏆 también en filas de la tabla. Datos: `runs.json`, `runs_detail.json`, `status.json`.

### ACTO 3 · PROGRESO
**3.1 Eficiencia aeróbica (EF)** — ancho completo, la métrica estrella arriba. Tres series (leyenda visible): EF todas las carreras (S1, puntos 3px al 40%) · **EF solo Z2 (FC≤142)** (S2, línea 2px protagonista + tendencia lineal discontinua en muted, badge «Z2: +X% desde abril») · **EF ajustado por temperatura** (injerto Cabina, línea punteada S1 al 60%, etiquetada **«ajustado (estimación)»**: ~1.5%/5°C sobre 15°C usando `temp_c`). Carreras `temp_c>24` con icono ☀ y nota «el calor de Madrid infla la FC: no es retroceso». Eje con `suggestedMin/Max` — **jamás min/max fijos** (regla global: hoy el 0.98 real queda recortado por el max 0.9). Datos: `runs.json` (ef, hr, temp_c, date).

**3.2 Ritmo y FC media — small multiples** — **MUERE el doble eje.** Dos paneles apilados (~170px c/u) con eje X común (fechas de carrera): arriba ritmo (S1, eje invertido — más rápido arriba —, ticks `paceFmt` corregido, nunca «6:60»), abajo FC media (S3) con línea discontinua **142 «techo Z2»** en gris muted etiquetada. Crosshair vertical sincronizado + tooltip conjunto (plugin propio ~40 líneas; fallback si se complica: tooltips `mode:index` independientes por panel). Datos: `runs.json` (pace_s, hr, date).

**3.3 Desacople aeróbico** — NUEVO. Barras S1 del drift % por carrera (EF 1ª vs 2ª mitad desde `runs_detail.json:splits`; solo carreras ≥3 km — evita falsos positivos). Umbrales 5% y 10% como líneas discontinuas ámbar/rojo **etiquetadas texto+icono** (el estado vive en el umbral, nunca en la barra); ☀ si `temp_c>24`. Media real actual 11.6%, picos 17–19% en julio. También en el modal. Datos: `runs_detail.json`, `runs.json`.

**3.4 Mes a mes** — tabla compacta sin canvas: km / ritmo / FC / EF / cadencia por mes con flechas ▲▼ (icono+texto en verde/rojo de estado — legítimo, ES juicio). Verificado: mar 505 s/km @ FC 146.5, EF .813 → jul 501 @ 136.7, EF .880. Etiquetas «Mar 26» (a prueba de 2027). Badge «histórico completo». Datos: `runs.json`.

### ACTO 4 · INTENSIDAD Y TÉCNICA
**4.1 Tiempo en zonas FC** — NUEVO. Barras apiladas 100% por semana agregando `runs_detail.json:zones`, rampa azul validada de §2.4 (Z1 claro → Z5 oscuro), gap 2px entre segmentos. KPI lateral «% tiempo Z1-Z2: ~53% · referencia 80/20». **Etiquetado honesto: «zonas Garmin»** — el techo 142 cae dentro de la Z3 Garmin (134–153), el «% exacto ≤142» requiere export futuro en `fetch_data.py`; no prometerlo. **Sustituye y mata «FC máxima por carrera»** (34/34 superan 142: no discrimina). Badge «histórico completo».

**4.2 Control de intensidad** — puntos de FC media por carrera (S3, ≥8px) contra línea 142; puntos por encima con **anillo 2px de color de superficie** (injerto Base 142 — sin gastar el rojo). Contador «20/34 carreras dentro de Z2 (59%)». Datos: `runs.json:hr`.

**4.3 Cadencia** — línea S4 magenta (fuera el naranja de aviso) + media móvil 4 carreras, **banda objetivo 160–165** en gris translúcido 10% etiquetada (fin de la contradicción «>170» de `index.html:168`), outliers <120 spm excluidos con contador. KPI: «gap al objetivo: −20 spm · estancada desde marzo (140.4 → 140.6)». Datos: `runs.json:cadence`.

### ACTO 5 · RECUPERACIÓN
**5.1 Sueño** — cumple por fin lo que la nota prometía: barras apiladas de **fases reales** (profundo/REM/ligero desde `daily.json:deep_pct, rem_pct`, resto ligero) con la rampa violeta validada de §2.4, horas como altura; score y `bedtime` en tooltip. **Muere** la línea REM% con eje invisible y el tercer eje.

**5.2 HRV nocturno** — se conserva (lo mejor del actual): línea S2 2px + banda baseline 51–91 en gris neutro translúcido 10% (banda = referencia, no estado), último valor con etiqueta directa. Plugin único `makeBandPlugin()` compartido con cadencia y FC (adiós al triple copy-paste). Datos: `daily.json:hrv`, `status.json:hrv_baseline`.

### ACTO 6 · ARCHIVO
**6.1 Calendario de actividad** — heatmap SVG propio: rampa azul validada de §2.4 (vacío `#1c2330`, primer paso `#1e60b0` a 2.76:1 — por fin distinguible), etiquetas de fila L/X/V y meses, **otras actividades** de `all_activities.json` (4 fuerza, 4 caminatas) como **rombo violeta S3 (forma+color, CVD-safe — la forma es codificación primaria)** con tipo traducido ({strength_training:'fuerza', walking:'caminata'}), celdas 16px, tooltip propio tap-friendly, tabindex+Enter, click abre modal si es carrera (**guard `if(!run) return`**). Contador «sesiones de fuerza este mes». Limitado a últimos 12 meses con paginación por año. Badge «histórico completo».

**6.2 Correlaciones destacadas + explorador** — 3 tiles precalculados al cargar (top |r| con n≥15): «Tu HRV matinal es tu mejor predictor de eficiencia · r=0.29 · débil-moderada · n=33» **+ la anti-intuición: «el sueño apenas predice tu EF · r=0.06»** (vacuna contra conclusiones espurias). Click configura y hace scroll al explorador. Explorador: pace formateado m:ss en ejes y tooltips, R² con etiqueta cualitativa (débil <0.3 / moderada / fuerte >0.7), aviso «muestra pequeña, orientativo» si n<20, estado vacío explicativo, preset bedtime con estado persistente y selects sincronizados. Datos: `runs.json` (campos `*_prev`, hrv_morning), `daily.json`.

**6.3 Historial + modal** — tabla «últimas 10 de 34 · ver todas», numéricos a la derecha con tabular-nums, badges 🏆 PR y «split −» (7/34), columnas FC máx/EF/Temp ocultas ≤600px (viven en el modal), filas tabindex+Enter. **Modal como `<dialog>` semántico:** `aria-modal`, foco a cierre (44px, `aria-label="Cerrar detalle"`), focus trap, retorno de foco, Escape, scroll-lock; `.splits-table` estilada como `#runsTable` en `overflow-x:auto`; zonas de la carrera como **barra apilada horizontal con la rampa azul** (injerto Base 142); nueva fila «desacople de esta carrera: X%» y comparación 1ª/2ª mitad con texto+icono; estilos inline migrados a clases.

**Footer** con `meta.updated`.

---

## 6. Interacciones y estados

1. **Rango global** 7d/30d/90d/Todo (`aria-pressed`); exentas con badge «histórico completo»; al cambiar rango **solo se re-renderizan las cards dependientes** (hoy/heatmap/zonas/mes-a-mes fuera de `renderAll`; `fRuns` ordenado UNA vez por render).
2. **Tooltips hover en TODAS las gráficas** (`mode:index` en líneas/barras, `nearest` en scatter, tap-friendly); crosshair sincronizado en los small multiples; tooltip propio en heatmap.
3. **Drill-down:** fila de tabla, celda de heatmap, fila de PR y punto de EF → modal (tabindex 0 + Enter/Espacio).
4. **Estados:** helper único `emptyState(card, 'Sin carreras en este rango · prueba 90d')` — nunca canvas en blanco ni `display:none`; **banner de error global** si falla un fetch (con `res.ok` comprobado POR fichero, nombre del JSON caído, botón reintentar, degradación parcial: si solo cae `runs_detail.json` el resto renderiza); semáforo gris mientras carga.
5. **Accesibilidad:** `role="img"` + `aria-label` descriptivo por canvas; landmarks; `prefers-reduced-motion` → `Chart.defaults.animation=false`; targets ≥44px; selects 16px móvil.
6. **Insights:** módulo `insights.js` **puro** (datos → frases en español), testeable sin DOM, con **guardas obligatorias por plantilla**: n mínimo, magnitud mínima del efecto, y fallback neutro («Semana tranquila — los datos siguen acumulándose»). Una frase incorrecta destruye más confianza que diez gráficas buenas.

---

## 7. Estructura de ficheros

```
web/
  index.html            (semántica: header/nav/main/sections + <dialog>)
  style.css             (tokens de §2, tipografía §3)
  vendor/chart.umd.min.js   (Chart.js 4.x fijado; documentar versión y cómo actualizar)
  js/
    app.js        orquestador (~60 líneas: init, fetch con res.ok, wiring)
    helpers.js    paceFmt/fmtDur corregidos (round del total primero), fechas por slicing (sin Date/huso), movingAvg, linreg ÚNICA, MONTH_ES única, makeBandPlugin
    state.js      datos + rango + registry de charts (destroy correcto)
    charts.js     renders de Chart.js (EF, small multiples, km/semana, zonas, cadencia, sueño, HRV, desacople, control intensidad)
    sparkline.js  helper SVG (~40 líneas)
    heatmap.js    calendario SVG propio
    modal.js      <dialog>, splits, zonas horizontales, desacople
    scatter.js    explorador + correlaciones destacadas
    today.js      semáforo + bullet bars + ACWR
    insights.js   PURO: datos → frases con guardas (testeable)
data/  (sin cambios en v1: runs.json, runs_detail.json, daily.json, all_activities.json, status.json, meta.json)
```
`index.html` ya carga con `type="module"`: el troceo no necesita build.

---

## 8. Plan de implementación por fases (mitigación del riesgo big-bang)

- **FASE 0 — fixes de raíz, PR aparte y verificable** (≤1 día): quitar min/max fijos de ejes (`suggestedMin/Max`) — EF 0.6–0.9, FC 125–160, FC máx 130–185, monthly max 15; `paceFmt` 6:60; restaurar `weightCard.style.display=''`; guard `if(!run)` en `openRunModal`; `res.ok` en todos los fetch + banner; corregir las 3 notas mentirosas (cadencia 160–165, sueño, body battery); `aria-pressed`; `.splits-table` con CSS base.
- **FASE 1 — layout y secciones nuevas:** actos, sticky bar, hero HOY, km/semana, PRs, zonas, desacople, mes a mes, tiles; muertes (doble eje, FC máx, BB, carga 2 barras, peso-gráfica, REM% flotante).
- **FASE 2 — modularización** a `web/js/` al final, con verificación visual chart a chart (no hay tests).
- **FASE 3 (futuro, requiere pipeline):** export de «% tiempo ≤142» y nivel absoluto de Body Battery desde `scripts/fetch_data.py`; histórico diario de `status.json` para la serie ACWR; tema claro (re-validar paleta con `--mode light`).

---

## 9. Análisis nuevos priorizados (todos en cliente, JSON existentes)

1. **EF solo Z2 (FC≤142)** con tendencia — el progreso oculto (+~12% desde abril). `runs.json`.
2. **Km por semana ISO** + media móvil 4 sem. `runs.json`.
3. **Desacople aeróbico** por carrera ≥3 km (media 11.6%, picos 19% jul). `runs_detail.json:splits`.
4. **Tiempo en zonas semanal** + KPI % Z1-Z2 (53% vs 80/20). `runs_detail.json:zones`.
5. **PRs + racha real** + Riegel/VO2max. `runs.json`, `runs_detail.json`, `status.json`.
6. **ACWR** propio por km (suavizado) + ratio Garmin 0.26 en el semáforo. `runs.json`, `status.json`.
7. **Gap de cadencia** −20 spm con detección de estancamiento. `runs.json`.
8. **EF ajustado por temperatura** (estimación etiquetada). `runs.json:temp_c`.
9. **Correlaciones destacadas** precalculadas (HRV→EF r=0.29; sueño→EF r=0.06). `runs.json`.
10. **Splits negativos** (7/34) como badge + contador. `runs_detail.json`.
11. **Entrenamiento cruzado** en heatmap + contador de fuerza. `all_activities.json`.
12. *Pospuesto:* monotonía/strain de Foster (ruido a 2 sesiones/semana).

---

## 10. Reglas no negociables y riesgos aceptados

**Reglas:** prohibido doble eje Y · colores categóricos en orden fijo · secuencial = un tono claro→oscuro validado · estado reservado con icono+texto · texto en tokens de tinta · líneas 2px, tooltips en todas, grid recesivo, leyenda si ≥2 series · toda card exenta del rango lleva badge, sin excepciones · cualquier cambio de paleta re-pasa el validador.

**Riesgos:** (1) insights = mayor activo y mayor riesgo → guardas + fallback neutro obligatorios; (2) ACWR por km con 1–7 km/sem es volátil → media exponencial + doble lectura + etiqueta cualitativa; (3) «% ≤142» y nivel de Body Battery NO derivables hoy → etiquetar honesto, fase 3; (4) crosshair sincronizado ~40 líneas con fallback definido; (5) n=34 → avisos de muestra pequeña en todo lo inferencial; (6) rombo del heatmap es codificación primaria para CVD — no perderlo en implementación; (7) vendorizar Chart.js añade ~200KB repo (65KB gzip) — fijar versión y documentar actualización.

---

**Ficheros de referencia:** `G:/Temp/claude/C--Users-braveras-desktop/beb15bf1-2893-4a7f-b330-9e3fe7e46500/scratchpad/running-dashboard/web/{index.html,app.js,style.css}` · `data/{runs,runs_detail,daily,all_activities,status,meta}.json` · validador: `G:/Temp/claude/bundled-skills/2.1.218/35871b9bce4785c65793e18894b1ff7e/dataviz/scripts/validate_palette.js`.
