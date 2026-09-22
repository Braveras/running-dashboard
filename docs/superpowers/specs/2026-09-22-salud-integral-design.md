# SPEC FINAL — «Zona Dos: salud integral» · De cuaderno de running a panel de salud en 5 pestañas

**Fecha:** 2026-09-22 · **Rama:** `sonda-salud` (≈ master) · **Base:** gana la propuesta «Consulta abierta» (ángulo médico de cabecera), con injertos consensuados de «Atlas» y «Coach 360» y las debilidades señaladas por los tres veredictos corregidas.

**Verificación:** todos los endpoints y campos citados están contrastados contra `scratchpad/probe-salud/probe_result.json` (sondeo real 2026-09-22) y contra los ficheros reales de `data/` (`daily.json` con 206 días, `runs_detail.json` con `pct_z2` operativo, `status_history.json` con el bug de nulls confirmado). Los hex nuevos están validados ejecutando `validate_palette.js` (salida literal en §6). No hay ningún campo inventado.

---

## 1. Visión y pestañas

El dashboard deja de ser un cuaderno de running en 6 actos y pasa a ser la **historia clínica personal** de Alejandro: el médico de cabecera que le ve cada día. Las señales duraderas (FC en reposo, SpO2 del sueño, respiración, estrés crónico, edad fitness, peso, actividad basal) son protagonistas; el running es **un tratamiento más**, encapsulado en su pestaña.

Cuatro principios de diseño:

1. **Bandas de referencia poblacionales en gris neutro**, etiquetadas («60–100 lpm: rango adulto habitual»), nunca coloreadas como estado — la banda informa, no juzga. **Y además** percentiles personales (injerto de «Atlas», corregido): el valor de hoy se sitúa contra la **ventana móvil de 90 días** del propio Alejandro, no contra el histórico completo, para que la mejora por entrenamiento (RHR que baja mes a mes) no convierta cada día en falsa anomalía.
2. **Honestidad clínica explícita**: nota fija de no-diagnóstico en Cuerpo; lo que Garmin no da, no se promete (§8).
3. **Insights solo con guardas** (n mínimo, magnitud, frescura) y fallback neutro; wording prudente en lo médico. **Regla nueva transversal:** prohibido presentar como hallazgo la correlación entre una métrica y sus propios insumos algorítmicos (sueño→readiness, estrés→readiness, temperatura→sweatLoss son tautologías del modelo Garmin) — el explorador las etiqueta «relación por construcción» y el precálculo de destacadas las excluye.
4. **El semáforo propio sigue mandando**; el Training Readiness de Garmin es «segunda opinión» etiquetada, jamás fusionada en un solo veredicto.

**Pestañas:** `Hoy · Entrenar · Recuperar · Cuerpo · Archivo` — render bajo demanda por pestaña, rango global (7d/30d/90d/Todo) y tema compartidos, deep-link por hash, identidad visual Zona Dos intacta (tokens, S1–S4 en orden fijo, monospace tabular, tema dual validado).

**Prerequisito absoluto (primer commit, antes que nada):** fix del bug real de `status_history.json` — verificado ahora mismo: la fila `{"date":"2026-09-22","acute_load":null,"chronic_load":null,"vo2max":null}` convive con un `status.json` del mismo día que SÍ trae `acute_load:67, chronic_load:137, vo2max:44.5`. Causa: un run anterior del día apendó nulls (API vacía en ese momento) y el guard «fecha ya existe» de `append_status_history` impidió que el run bueno la corrigiera. Fix doble: (a) no apendar si `acute_load`, `chronic_load` y `vo2max` son todos `None`; (b) si la fila de hoy existe con todo `None` y el status nuevo trae datos, **sobrescribirla**. Re-sembrar el punto de hoy en el mismo commit. Sin esto, las series VO2max y ACWR nacen muertas.

---

## 2. Secciones, pestaña a pestaña

Convención: **[existente]** = card actual reubicada sin cambios de diseño; **[nueva]**. Toda card exenta del rango global lleva badge («⟳ hoy» / «⟳ histórico completo» / «serie en construcción»). Toda gráfica: tooltips; leyenda si ≥2 series; `emptyState()` si faltan datos (nunca `display:none`).

### Pestaña HOY — «¿cómo estoy y qué hago?» (toda la pestaña ignora el rango: badge «⟳ hoy»)

**2.1 Semáforo hero [existente + adición]**
La card `cardSemaforo` reubicada tal cual (lógica HRV/sueño/party/ACWR/balance BB del spec base §5-Acto 1, intacta), con dos adiciones:
- Bajo el mensaje, línea textual etiquetada: «**Garmin opina:** readiness 58 · moderado — buena recuperación» (score + `level` traducido + `feedbackShort` por diccionario parcial; código no mapeado → texto genérico «recuperación correcta», jamás la constante cruda). Si no hay entrada de readiness de hoy (sin sync matinal): «**Garmin aún no ha puntuado hoy**» y no se declara acuerdo ni desacuerdo.
- KPI discreto bajo la card: «semáforo y Garmin coinciden N de M días» — mapa verde↔HIGH/PRIME, ámbar↔MODERATE, rojo↔LOW; **guarda n≥20 días con ambos veredictos** o se omite. Contextualiza el doble discurso sin fusionarlo.
- El bullet de ACWR gana el dato real como lectura textual junto al cálculo propio por km: «Garmin: carga al 100 %» (`acwr_pct`).
- *Tipo:* panel de estado sin canvas + 3 bullet bars SVG existentes (`today.js`).
- *Datos:* `daily.json`, `status.json` (existentes) + `health.json` del día: `readiness_score` (`score`), `readiness_level` (`level`), `readiness_feedback` (`feedbackShort`), `acwr_pct` (`acwrFactorPercent`) — de `get_training_readiness` (verificado: score 58, level MODERATE, feedbackShort GOOD_RECOVERY).

**2.2 Desglose de readiness [nueva]**
Los 6 factores de hoy como barras horizontales 0–100 en **orden fijo** (sueño de anoche, historial de sueño, HRV, tiempo de recuperación, historial de estrés, carga ACWR). Una sola serie S1 (mismo indicador, no categorías), sin leyenda, etiqueta directa del % al final de cada barra, feedback Garmin traducido («muy bueno») como texto muted junto a la barra — jamás coloreando la barra. Tooltip con el feedback de cada factor.
- *Tipo:* barras horizontales Chart.js, 1 serie S1.
- *Datos:* `health.json` (día más reciente): `factor_sleep_pct` (`sleepScoreFactorPercent`), `factor_sleep_hist_pct` (`sleepHistoryFactorPercent`), `factor_hrv_pct` (`hrvFactorPercent`), `factor_recovery_pct` (`recoveryTimeFactorPercent`), `factor_stress_pct` (`stressHistoryFactorPercent`), `acwr_pct` (`acwrFactorPercent`) + `*FactorFeedback` — todos verificados en el sondeo (47/49/100/99/62/100).

**2.3 Constantes de hoy [nueva]**
Fila de stat-tiles (componente tile+sparkline existente, `sparkline.js`), sparkline SVG 14 días en S1, placeholder «— sin dato» si falta el día:
- FC reposo hoy + delta vs media 7d (`rhr`, `rhr_7d`) + **badge de percentil personal**: «p10 de tus últimos 90 días» vía `percentileRank()` (§5), en tinta con ▲▼+texto, solo si n≥60 días con dato en la ventana.
- SpO2 media del sueño (`spo2_sleep`).
- Respiración del sueño en rpm (`resp_sleep`).
- Estrés medio de ayer + qualifier traducido (`stress_avg`, `stress_qualifier`: STRESSFUL→«estresante», BALANCED→«equilibrado», CALM→«tranquilo»…).
- Pasos de ayer vs objetivo dinámico (`steps`, `step_goal`).
- Minutos de intensidad de la semana vs 150 OMS (`intensity_mod` + `intensity_vig`; el tooltip muestra también el equivalente ponderado moderados + 2×vigorosos, que es como cuentan Garmin y la OMS).
- *Datos:* todo de `health.json`; campos origen verificados: `restingHeartRate`, `lastSevenDaysAvgRestingHeartRate`, `averageStressLevel`, `stressQualifier`, `totalSteps`, `dailyStepGoal`, `moderateIntensityMinutes`, `vigorousIntensityMinutes` (get_stats); `avgSleepSpO2` (get_spo2_data); `avgSleepRespirationValue` (get_respiration_data).

### Pestaña ENTRENAR — el capítulo running completo (actos 2+3+4 sin pérdidas + capa Garmin)

**2.4 Esta semana en cifras + Km por semana [existentes]** — cards 2.1 y 2.2 actuales tal cual (tiles con sparklines; barras S1 por semana ISO + media móvil 4 sem S2, semana en curso al 40 %). Único cambio: **el tile de peso emigra a Cuerpo**.

**2.5 Eficiencia aeróbica (EF) · Ritmo y FC · Desacople [existentes]** — las tres cards de Progreso intactas (EF con serie Z2 protagonista y ajuste por temperatura etiquetado «estimación»; small multiples con eje invertido y techo 142; desacople con umbrales 5/10 % etiquetados). Corazón de la pestaña, en este orden.

**2.6 Zonas FC · Control de intensidad · Cadencia · Mes a mes [existentes, 1 mejora]** — las cuatro cards del acto 4 + tabla mensual reubicadas. Mejora: el KPI lateral de Zonas añade «% tiempo real ≤142: X %» como **media ponderada por duración** de las carreras del rango desde `runs_detail.json:pct_z2` (verificado: 35.1 en la última carrera; carreras con `pct_z2:null` se excluyen del ponderado y se cuenta cuántas). La nota obsoleta «requiere un export futuro» **muere**. La tabla mensual gana columna «% Z2 real».

**2.7 Récords oficiales Garmin [nueva]**
Sustituye la lista de 6 PRs computados en cliente por los **9 PRs oficiales** (verificado: `get_personal_record` devuelve list[9]): etiqueta por `typeId` mapeada en JS con **fallback «Récord tipo N»** (verificado: `prTypeLabelKey` llega `null`; mapping candidato 1=1 km, 2=1 mi, 3=5 km, 4=10 km, 7=carrera más larga, 8=media, 9=maratón — **verificar contra la app Connect el primer día**, coherente con el sondeo: typeId 1 → value 367.09 s ≈ 6:07 el mejor km), valor formateado (segundos o metros según tipo), fecha y nombre de actividad; click abre el modal si la carrera está en `runs.json` (`if (!run) return`). Los badges 🏆 del historial pasan a alimentarse de `prs.json`. Riegel y la equivalencia VO2max sobreviven como complemento, cada uno etiquetado con su origen. Badge «⟳ histórico completo».
- *Datos:* `data/prs.json` (nuevo): `type_id` (`typeId`), `value`, `date` (`activityStartDateTimeLocalFormatted[:10]`), `activity_id`, `activity_name` (`activityName`).

**2.8 Predicciones de carrera Garmin [nueva]**
Cuatro KPI monospace formateados desde segundos (verificado: `time5K:1863`→31:03 · `time10K:4024`→1:07:04 · `timeHalfMarathon:9264`→2:34:24 · `timeMarathon:21044`→5:50:44) con el Riegel existente al lado, dos columnas etiquetadas («Garmin (modelo Firstbeat, extrapola de tu VO2max)» vs «Riegel sobre tu mejor esfuerzo real»). Debajo, línea de tendencia por distancia (selector, 1 serie S1) activada cuando `trends.json` acumule **≥14 puntos**; hasta entonces, estado con badge «serie en construcción desde sep 2026» — Garmin no expone histórico (`max_metrics` verificado vacío). Badge «⟳ histórico completo».
- *Datos:* `data/trends.json`: `pred_5k_s`, `pred_10k_s`, `pred_half_s`, `pred_marathon_s` — de `get_race_predictions()`.

**2.9 Umbral de lactato y potencia [nueva]**
Card KPI sin canvas: **FC umbral 177 lpm** (verificado) con fecha del último recálculo (`calendarDate` 2026-08-21), **FTP running 352 W etiquetado por su origen** (verificado `origin:"weight"` → «estimado por peso, no medido») y 4,24 W/kg. **El ritmo de umbral NO se publica en v1**: el campo `speed` llega en unidad interna sin documentar (verificado 0.29444; hipótesis ×10 → 2,94 m/s ≈ 5:40/km, plausible pero NO confirmada). Se guarda `lt_speed_raw` crudo + flag `lt_speed_unit_verified:false` (patrón `temp_raw` existente) y solo tras verificar contra la app Connect se pinta el ritmo. Nota fija: «lo recalcula el reloj esporádicamente; puede pasar semanas sin cambiar». Tendencia diferida a ≥5 valores distintos en `trends.json`. Badge «⟳ histórico completo».
- *Datos:* `data/trends.json`: `lt_hr` (`speed_and_heart_rate.heartRate`), `lt_speed_raw` (`speed_and_heart_rate.speed`), `lt_date` (`speed_and_heart_rate.calendarDate[:10]`), `ftp_w` (`power.functionalThresholdPower`), `ftp_origin` (`power.origin`), `ftp_wkg` (`power.powerToWeight`) — de `get_lactate_threshold()` (llamada exacta de `probe_health.py`, sin argumentos).

**2.10 Carga y VO2max (Garmin) [nueva — corrige la debilidad «sin serie ACWR ni VO2max» de la ganadora]**
Habilitada por el fix del §1. Small multiples con eje X común (jamás doble eje): arriba `acute_load` (S1) y `chronic_load` (S2) con leyenda; abajo VO2max en línea escalonada S2 con puntos solo en cambios. Banda `optimal_min`–`optimal_max` de `status.json` como referencia gris etiquetada (reutiliza `makeBandPlugin`). Guarda: se pinta con **≥14 puntos no nulos** en `status_history.json` (hoy hay 29 puntos con huecos y 1 fila null — tras el fix, la serie crece a diario); antes, estado vacío explicativo. Badge «⟳ histórico completo».
- *Datos:* `status_history.json` (existente, tras fix) + `status.json` (`optimal_min`, `optimal_max` — verificados: 109.6/205.5).

### Pestaña RECUPERAR — sueño, HRV, estrés crónico y energía

**2.11 Sueño: fases y horas · HRV nocturno [existentes]** — las dos cards del acto 5 intactas (fases con rampa violeta validada; HRV S2 con banda baseline dinámica de `status.json:hrv_baseline` — verificado hoy 48–91 — y `makeBandPlugin`). Abren la pestaña.

**2.12 Training Readiness en el tiempo [nueva]**
Línea del score diario 0–100 (S2, 2 px) + media móvil 7d en muted; el nivel (LOW/MODERATE/HIGH/PRIME) va **en el tooltip traducido**, jamás coloreando la línea. Respeta el rango global. Nota: «el score resume sueño, HRV, recuperación, estrés y carga: es la síntesis de Garmin; el semáforo de Hoy es la nuestra».
- *Datos:* `health.json`: `readiness_score`, `readiness_level` por día; histórico vía backfill (readiness existe desde el registro del FR265, `registeredDate` ≈ 2026-03-10 — verificado en `devices`; días previos quedan `null` y es correcto).

**2.13 Estrés diario [nueva]**
Línea del estrés medio diario (S1) + media móvil 7d (S2), leyenda visible. Tooltip: máximo del día y qualifier traducido. La escala va como **leyenda textual bajo la card** («0–25 reposo · 26–50 bajo · 51–75 medio · 76–100 alto — escala Garmin, estimación propietaria»), no como zonas coloreadas. Respeta rango.
- *Datos:* `health.json`: `stress_avg` (`averageStressLevel`), `stress_max` (`maxStressLevel`), `stress_qualifier` — de get_stats, 0 llamadas extra.

**2.14 Reparto semanal del estrés [nueva — rampa YA validada, §6]**
Barras apiladas 100 % por semana ISO con el % de tiempo en reposo/bajo/medio/alto. **Detalle verificado que ninguna propuesta vio:** los cuatro porcentajes NO suman 100 (sondeo: 24.93+10.21+34.72+16.25 = 86.11; el resto es `activityStressPercentage` 7.43 y `uncategorizedStressPercentage` 6.46). Regla: **normalizar los cuatro sobre su propia suma** y titular «reparto del tiempo con medición de estrés» — honestidad sin categoría basura. Rampa secuencial aqua de 4 pasos **validada en dark y light** (hex en §6), claro=reposo → oscuro=alto, gap 2 px, leyenda. Fallback (si en el futuro cambia la paleta y no valida): barra semanal única «% de tiempo en estrés alto» en S1 — jamás aceptar colisión de rol de color como degradación. Respeta rango.
- *Datos:* `health.json`: `stress_rest_pct`/`stress_low_pct`/`stress_med_pct`/`stress_high_pct` (`restStressPercentage`…`highStressPercentage` — get_stats).

**2.15 Body Battery: rango diario [nueva, con datos que YA existen]**
Barras flotantes high–low por día (S3 al 30 %) + punto del último valor (`bb_last`). Tooltip con cargado/drenado. Cumple la promesa del nivel absoluto (fase 3 del spec base, ya exportado). Respeta rango.
- *Datos:* `daily.json`: `bb_high`, `bb_low`, `bb_last`, `bb_charged`, `bb_drained` (verificados presentes).

**2.16 Mes a mes: recuperación [nueva, injerto Atlas]**
Tabla del dominio reutilizando el componente de la tabla mensual de running: por mes, horas de sueño, sleep score, HRV media, estrés medio, readiness medio, BB máximo medio. **▲▼ con dirección de juicio por métrica** (en estrés, bajar es ▲ mejora). Badge «⟳ histórico completo».
- *Datos:* `daily.json` + `health.json` agregados en cliente.

### Pestaña CUERPO — el panel del médico de cabecera

Abre con nota fija bajo el título: «**Estos datos vienen de un sensor de muñeca: son orientativos y NO sustituyen una medición ni un criterio médico.**»

**2.17 FC en reposo [nueva]**
Línea diaria (S1, puntos 3 px al 40 %) + media móvil 7d (S2, protagonista 2 px). Banda de referencia gris translúcida etiquetada texto+icono: «60–100 lpm: rango adulto habitual · corredores habituados: 45–60» (referencia poblacional, no estado — `makeBandPlugin`). Además, **tres líneas horizontales finas muted etiquetadas p10/p50/p90 de tus últimos 90 días** (percentil personal, tinta, no estado). Eje con `suggestedMin/Max`. Nota: «la RHR baja con el entrenamiento aeróbico en semanas-meses: esta es la gráfica lenta del panel». Respeta rango; con «Todo» se ven los ~206 días del backfill.
- *Datos:* `health.json`: `rhr`, `rhr_7d` — 0 llamadas extra; histórico completo vía backfill.

**2.18 SpO2 del sueño [nueva]**
Línea de la media de SpO2 del sueño (S1) + puntos sueltos del mínimo diario al 40 % (misma familia, forma triángulo, **NO unidos con línea**: los mínimos aislados suelen ser artefacto de postura/perfusión). Banda de referencia etiquetada: «≥95 % típico a nivel del mar · Madrid ~660 m puede restar ~1 punto» (coherente con el sondeo: `averageMonitoringEnvironmentAltitude:649`). Nota honesta fija: «el pulsioxímetro de muñeca infravalora con movimiento: un mínimo de 79 aislado (como trae el sondeo) casi nunca es real». Eje sugerido 85–100, nunca desde 0 ni recortando datos. Leyenda con 2 entradas. Respeta rango.
- *Datos:* `health.json`: `spo2_sleep` (`avgSleepSpO2`, get_spo2_data — ojo al camelCase: `avgSleepSpO2`/`averageSpO2` en get_spo2_data pero `averageSpo2` en get_stats), `spo2_avg`, `spo2_min` (`averageSpo2`/`lowestSpo2`, get_stats, gratis).

**2.19 Respiración [nueva]**
Dos líneas con leyenda: vigilia (S1) y sueño (S3), rpm, tooltips `mode:index`. Referencia etiquetada: «12–20 rpm en vigilia: rango adulto habitual». Nota: la divergencia vigilia/sueño estable es lo esperable. Respeta rango.
- *Datos:* `health.json`: `resp_waking` (`avgWakingRespirationValue` — también en get_stats, gratis), `resp_sleep` (`avgSleepRespirationValue`, get_respiration_data).

**2.20 Edad fitness [nueva] — hero de la pestaña**
Tres cifras monospace grandes — edad real 29 · edad fitness 28,1 · alcanzable 21,1 (verificadas: 29 / 28.145 / 21.052) — con frase generada («tu cuerpo funciona 0,9 años más joven que tu DNI; el margen de mejora son 7 años»). Debajo, bullet bars SVG por componente (componente de `today.js`): IMC (`value` vs `targetValue`), días vigorosos/sem (`value` vs `targetValue`), minutos vigorosos/sem (`value` vs `targetValue`) — cada uno con su `potentialAge` en tooltip («solo el IMC te quitaría X años») y flag `stale` como badge «dato antiguo». **FC reposo: solo valor, sin marcador de objetivo** — verificado en el sondeo: `components.rhr` trae únicamente `{value, stale}`, sin `targetValue` ni `potentialAge`; no inventarlos. Insight de palanca: «tu palanca más rentable: [componente con potentialAge más bajo, priority como desempate]». Línea de tendencia diferida a ≥14 puntos en `trends.json`; mientras, badge «serie en construcción desde sep 2026». Badge «⟳ hoy · ignora el rango».
- *Datos:* `data/trends.json`: `fitness_age` (`fitnessAge`), `fitness_age_achievable` (`achievableFitnessAge`), `chrono_age` (`chronologicalAge`), `comp_bmi` (`components.bmi.{value,targetValue,potentialAge,priority,stale}`), `comp_rhr` (`components.rhr.{value,stale}`), `comp_vig_days` y `comp_vig_min` (ídem bmi), `last_updated` (`lastUpdated`) — endpoint `get_fitnessage_data(fecha)` (firma exacta de `probe_health.py`).

**2.21 Peso e IMC [nueva card, tile muere en Entrenar]**
Puntos de pesaje unidos con línea S1 al 40 % (contador honesto «N pesajes desde marzo») + IMC actual como KPI desde `comp_bmi.value`, con bandas OMS etiquetadas texto+icono como referencia gris (18,5–25 normal · 25–30 sobrepeso), nunca coloreadas como estado. Nota de honestidad obligatoria: «tu báscula solo envía peso: % graso, masa muscular y agua llegan vacíos — no se muestran porque no existen» (verificado: `body_composition` con `bodyFat/bodyWater/muscleMass/metabolicAge` = null, solo `weight` 83000 g). Badge «⟳ histórico completo».
- *Datos:* `daily.json`: `weight_kg` (get_weigh_ins, existente) + `trends.json`: `comp_bmi.value`. **NO usar `get_body_composition`**: solo duplica el peso.

**2.22 Actividad diaria y recomendación OMS [nueva]**
Dos paneles: (a) barras de pasos/día S1 + línea escalonada muted del objetivo dinámico (`step_goal` cambia a diario — etiquetada «objetivo (dinámico)»), tooltip con kcal activas y pisos; (b) barras semanales de **minutos de intensidad ponderados** (moderados + 2×vigorosos, como cuentan Garmin/OMS — verificado `intensityMinutesGoal:150`) con línea de referencia etiquetada «150 min/sem · recomendación OMS». Aquí el running se ve literalmente como tratamiento. Respeta rango.
- *Datos:* `health.json` (todo get_stats, gratis): `steps`, `step_goal`, `active_kcal` (`activeKilocalories`), `bmr_kcal` (`bmrKilocalories`), `floors_up` (`floorsAscended`), `intensity_mod`, `intensity_vig`, `sedentary_s` (`sedentarySeconds`).

**2.23 Mes a mes: cuerpo [nueva, injerto Atlas]**
Tabla del dominio: peso medio, RHR media, VO2max fin de mes, pasos/día medios, minutos intensidad/sem. ▲▼ con dirección de juicio por métrica (RHR: bajar es ▲). Badge «⟳ histórico completo».
- *Datos:* `daily.json` + `health.json` + `status_history.json` agregados en cliente.

### Pestaña ARCHIVO — memoria y laboratorio

**2.24 Calendario de actividad [existente]** — heatmap SVG sin cambios (rampa azul, rombos violeta, paginación anual, modal al click).

**2.25 Correlaciones destacadas + explorador [existentes, ampliados]**
Mecánica íntegra (tiles top |r| con anti-intuición, explorador con selects, R² cualitativo, avisos n<20). Ejes nuevos: **FC reposo del día, estrés medio del día previo, readiness matinal, SpO2 del sueño previo** — el join runs×health se hace **en pipeline**, no en cliente: `merge_runs_with_dailies` añade `rhr_dia`, `stress_prev`, `readiness_dia`, `spo2_prev` a `runs.json` (mismo patrón `*_prev` existente, injerto Coach 360 aprobado por el jurado — evita duplicar lógica en `scatter.js`). Los 3 tiles precalculados se recalculan incluyendo las variables nuevas (top |r| con n≥15), conservando la anti-intuición. **Regla anti-tautología (§1.3):** los pares métrica↔insumo de su propio algoritmo (p.ej. `sleep_score`→`readiness_dia`) quedan excluidos del precálculo de destacadas y, si el usuario los configura a mano en el explorador, se muestran con la etiqueta «relación por construcción: Garmin calcula una con la otra».

**2.26 Historial + modal [existentes, 3 adiciones]**
Tabla y `<dialog>` sin cambios estructurales. Adiciones: badges 🏆 alimentados por `prs.json` oficial (tooltip con el tipo); en el modal, fila «readiness esa mañana: N (nivel)» si existe y «sudor estimado: X ml» si existe (`sweat_ml`).

---

## 3. Spec del pipeline (`scripts/fetch_data.py`)

**Principio rector (verificado):** `get_stats(ds)` YA se llama por cada día de la ventana en `add_bb_level()` — la mayoría de campos nuevos sale de esa misma respuesta a coste API **cero**.

### 3.0 Commit 0 — fixes previos obligatorios
1. **`append_status_history`**: guard «no apendar si `acute_load`, `chronic_load` y `vo2max` son todos None» + sobrescribir la fila de hoy si existe con todo None y llegan datos. Re-sembrar el punto de hoy.
2. **`dump_token` también en fallo**: envolver `main()` en `try/finally` con `dump_token(g)` en el `finally` (hoy solo corre al final; crítico durante las semanas de backfill a ~170 llamadas — si el run aborta a mitad, el token rotado no se pierde).

### 3.1 Refactor de `add_bb_level` → `harvest_stats(entry, health_entry, ds, cache)`
Una sola llamada `get_stats(ds)` cacheada por fecha alimenta **ambos** ficheros:
- `daily.json` sigue tomando `bb_high`/`bb_low`/`bb_last` del mismo objeto, **claves idénticas** — verificación obligatoria: **diff de `daily.json` antes/después en el primer run** (criterio del jurado).
- `health.json` recibe los campos de §3.2.

### 3.2 `data/health.json` (NUEVO) — lista diaria, una entrada por fecha (patrón `daily.json`)
Claves (origen exacto verificado en el sondeo):

| clave | campo API | endpoint |
|---|---|---|
| `rhr`, `rhr_7d` | `restingHeartRate`, `lastSevenDaysAvgRestingHeartRate` | get_stats |
| `hr_min`, `hr_max` | `minHeartRate`, `maxHeartRate` | get_stats |
| `spo2_avg`, `spo2_min` | `averageSpo2`, `lowestSpo2` | get_stats |
| `resp_waking` | `avgWakingRespirationValue` | get_stats |
| `stress_avg`, `stress_max`, `stress_qualifier` | `averageStressLevel`, `maxStressLevel`, `stressQualifier` | get_stats |
| `stress_rest_pct`, `stress_low_pct`, `stress_med_pct`, `stress_high_pct` | `restStressPercentage`…`highStressPercentage` | get_stats |
| `steps`, `step_goal`, `dist_m` | `totalSteps`, `dailyStepGoal`, `totalDistanceMeters` | get_stats |
| `active_kcal`, `bmr_kcal` | `activeKilocalories`, `bmrKilocalories` | get_stats |
| `intensity_mod`, `intensity_vig` | `moderateIntensityMinutes`, `vigorousIntensityMinutes` | get_stats |
| `floors_up` (round 1), `sedentary_s` | `floorsAscended`, `sedentarySeconds` | get_stats |
| `bb_wake` | `bodyBatteryAtWakeTime` | get_stats |
| `spo2_sleep` | `avgSleepSpO2` | get_spo2_data(ds) — 1 llamada/día |
| `resp_sleep`, `resp_low`, `resp_high` | `avgSleepRespirationValue`, `lowestRespirationValue`, `highestRespirationValue` | get_respiration_data(ds) — 1 llamada/día |
| `readiness_score`, `readiness_level`, `readiness_feedback`, `acwr_pct`, `acute_load`, `factor_sleep_pct`, `factor_sleep_hist_pct`, `factor_hrv_pct`, `factor_recovery_pct`, `factor_stress_pct`, `recovery_time_h`, `hrv_weekly` | `score`, `level`, `feedbackShort`, `acwrFactorPercent`, `acuteLoad`, `sleepScoreFactorPercent`, `sleepHistoryFactorPercent`, `hrvFactorPercent`, `recoveryTimeFactorPercent`, `stressHistoryFactorPercent`, `recoveryTime`, `hrvWeeklyAverage` | get_training_readiness(ds) — 1 llamada/día |
| `sweat_ml` | `sweatLossInML` | get_hydration_data(ds) — **SOLO días con actividad** en `all_activities.json` (verificado: 46.0 ml en día con actividad; `valueInML:0` siempre — el usuario no registra ingesta, NO exportar goal/ingesta) |

**Regla determinista para readiness (verificada contra el sondeo):** la API devuelve **lista con hasta 2 entradas/día** (verificado: list[2], una `AFTER_POST_EXERCISE_RESET` a las 20:38 y la matinal `AFTER_WAKEUP_RESET` a las 07:44 con `recoveryTime` distinto). Tomar la de `inputContext == 'AFTER_WAKEUP_RESET'` si existe; si no, **la de timestamp más temprano** (la matinal es la fisiológicamente relevante; «la más tardía» contaminaría la serie con resets post-actividad — corrección del jurado a la ganadora). Alternativa equivalente verificada: `get_morning_training_readiness(ds)` devuelve directamente la entrada matinal; el implementador puede usarla si simplifica, manteniendo la misma llamada por día.

**Ventana propia `HEALTH_REFETCH_DAYS = 2`** (estos datos cierran en el día; no necesitan los 7 días de dailies) → 3 días × 3 llamadas nuevas (spo2, respiration, readiness) = **9/run** + hydration solo en días de ventana con actividad (≤3, típico 1).

**Sentinel:** clave `rhr` presente (aunque valga None) = día ya consultado, no reintentar (patrón `pct_z2`/`bb_high` existente). Ídem `readiness_score` presente con None = intentado sin dato.

### 3.3 `data/trends.json` (NUEVO) — snapshot diario con dedupe
Append de una fila `{date, ...}` por run (patrón `append_status_history`), con dos mejoras del jurado: **skip si ya hay fila de hoy** y **skip si la fila nueva es idéntica a la última** (dedupe — predicciones y fitness age cambian a saltos; ahorra churn de commits). Campos: los de §2.8 (`pred_*_s` de `get_race_predictions()`), §2.20 (`fitness_age`, `fitness_age_achievable`, `chrono_age`, `comp_*`, `last_updated` de `get_fitnessage_data(hoy)`) y §2.9 (`lt_hr`, `lt_speed_raw`, `lt_speed_unit_verified`, `lt_date`, `ftp_w`, `ftp_origin`, `ftp_wkg` de `get_lactate_threshold()`). = **3 llamadas/run**. **SIN backfill posible**: Garmin no expone histórico (`max_metrics` verificado list[0]) — la serie nace 2026-09 y la web lo dice con badge.

### 3.4 `data/prs.json` (NUEVO) — sobrescritura completa
`get_personal_record()` → 9 items `{type_id, value, date, activity_id, activity_name}` = **1 llamada/run**.

### 3.5 `merge_runs_with_dailies` — 4 campos nuevos
Añadir al merge (join por fecha con `health.json`): `r["rhr_dia"]`, `r["stress_prev"]` (día anterior), `r["readiness_dia"]`, `r["spo2_prev"]` (noche previa = fecha de la carrera, mismo criterio que `sleep_score_prev`). No tocar nada más del merge.

### 3.6 Backfill de `health.json` con tope
Días desde `FIRST_DATE` (2026-03-01) sin clave `rhr` → **`HEALTH_BACKFILL_MAX = 30` días/run × 4 llamadas/día** (stats, spo2, respiration, readiness) = ≤120 llamadas extra/run; ~206 días pendientes → termina en **~7 runs diarios**. Readiness solo existe desde el registro del reloj (~2026-03-10, verificado `registeredDate`): los días previos quedan None y es correcto. **No verificado** que readiness/spo2 respondan a 6 meses vista (el sondeo solo probó fechas recientes): el sentinel None evita re-quemar llamadas si no responden, y las cards con guarda de n mínimo muestran estado vacío explicativo mientras tanto.

### 3.7 Presupuesto por run
Actual ≈35 llamadas. Régimen estable: +9 ventana +1 hydration +3 snapshots +1 PRs ≈ **49/run**. Pico durante la semana de backfill ≈ **170/run** — secuencial con el mismo `safe()`, sin paralelismo, tope duro ajustable a la baja al primer 429. Tamaños: `health.json` ≈ 206 días × ~30 claves ≈ 120–150 KB, `trends.json` ~50 KB/año, `prs.json` <2 KB — sin riesgo para Pages.

### 3.8 NO tocar / NO construir
No tocar: `fetch_activities`, `fetch_run_details` (`pct_z2` operativo), rotación de token (salvo §3.0.2). No construir (verificado en el sondeo): `endurance_score` y `hill_score` (FR265: `hillScoreAndEnduranceScoreCapable:false`, DTOs null/list[0]), `get_body_composition` (todo null salvo peso duplicado), hidratación registrada (`valueInML:0`), series intradía de estrés/BB/FC/respiración (480–720 puntos/día reventarían el patrón estático; media/máx diarios bastan — decisión explícita, revisable), `max_metrics` y `all_day_events` (vacíos), `running_tolerance` (falló por firma en el sondeo y `runningToleranceCapable:false` — imposible con este reloj, ni siquiera fase 2).

### 3.9 Carga en la web
`state.js` añade `health.json`, `trends.json`, `prs.json` a `FICHEROS_OPCIONALES` (degradación parcial existente por fichero): si falta `health.json`, Cuerpo muestra `emptyState` y el resto vive; si falta `trends.json`, las cards de predicciones/fitness age/umbral muestran su estado vacío; el hero de Hoy funciona entero sin ninguno de los tres.

---

## 4. Navegación y migración desde los 6 actos

**Tab bar accesible** en la barra sticky: mueren las 6 anclas con scroll-spy y la numeración «Acto N»; nacen 5 botones `role=tab` en un `role=tablist` (`aria-selected`, flechas ←/→, chips scrollables en móvil con min-height 44 px). Cada pestaña es una `<section role=tabpanel>` que se muestra/oculta con `hidden`.

**Routing por hash:** `#hoy` (default) · `#entrenar` · `#recuperar` · `#cuerpo` · `#archivo`. Listener de `hashchange` y click llaman a `showTab(id)`; hash desconocido → `#hoy`; **`history.replaceState` al clicar tab** (no ensuciar el historial — injerto Atlas).

**Render bajo demanda:** `state.js` gana un registry por pestaña `{renders: [...], rendered: bool, dirty: bool}`. La primera activación ejecuta sus renders; el cambio de rango re-renderiza SOLO las cards dependientes del rango de la pestaña visible (partición por pestaña de las listas `RENDERS_DEPENDIENTES_RANGO`/`RENDERS_EXENTOS` existentes en `app.js`) y marca `dirty` las demás, que se re-renderizan al activarse. Los charts NO se destruyen al cambiar de tab (canvas oculto conserva la instancia; el registry de `destroyChart` existente sigue gobernando los re-render). Test manual obligatorio: cambiar rango en cada pestaña y visitar las otras 4.

**Compartido en la sticky (sin cambios):** rango 7d/30d/90d/Todo (`aria-pressed`), chip de frescura desde `meta.updated`, toggle de tema con el anti-flash actual, banner de error. El header conserva h1 «Zona Dos» + insight del día; `<title>` pasa a «Zona Dos · Salud» y el subtítulo a «Cuaderno de salud · Madrid».

**Redistribución íntegra (0 gráficas perdidas):** Acto 1→Hoy · Actos 2+3+4→Entrenar · Acto 5→Recuperar · Acto 6→Archivo · Cuerpo nace nueva. Mudanzas: tile de peso→Cuerpo (como card); la card «Récords + predicciones» computada se sustituye por PRs oficiales + predicciones Garmin (Riegel sobrevive como columna etiquetada). Muere: el scroll editorial único, el scroll-spy, los ordinales, la nota obsoleta de Zonas FC. Los 6 insights de acto pasan a 1 insight por pestaña (5) + el del header.

---

## 5. Insights nuevos y sus guardas (todos en `insights.js`, fallback neutro intacto)

Helper transversal nuevo en `helpers.js` (injerto Atlas, corregido contra la no-estacionariedad):
`percentileRank(serie90d, valor)` → percentil del valor contra la **ventana móvil de los últimos 90 días con dato**; guarda **n≥60** para métricas diarias, **n≥20** para métricas de carrera; sin n suficiente, no se pinta badge. Siempre en tinta (▲▼ + texto), jamás color de estado.

| pestaña | insight | guardas |
|---|---|---|
| Hoy | «Llevas N días con readiness ≥70» | racha ≥3 días con dato; frescura <2d |
| Hoy | «Tu FC en reposo de hoy está en tu p10 de 90 días» | n≥60 en ventana; dato de hoy o ayer; percentil ≤15 o ≥85 |
| Entrenar | «Garmin estima tu 5K en 31:03, X min menos que hace un mes» | ≥28 días de snapshots en trends.json y Δ≥60 s |
| Recuperar | «Tu estrés medio de [mes] (X) supera al de [mes-1] (Y)» | ≥21 días con dato en cada mes y Δ≥5 puntos |
| Cuerpo | «Tu RHR lleva ≥3 días ≥5 lpm sobre tu media de 30 días — posible fatiga o incubando algo» | Δ≥5 lpm y ≥3 días consecutivos (sustituye al |Δ|≥2 entre medias de 30d de la propuesta original, que dispararía por adaptación normal) |
| Cuerpo | «Semana pasada: X/150 min de intensidad (recomendación OMS)» | factual; frescura <7d |
| Cuerpo | «Tu edad fitness (28,1) ya es menor que tu edad real (29)» | factual; frescura <7d |
| Cuerpo (SpO2) | «Media de sueño baja sostenida: el sensor de muñeca puede infravalorar; coméntalo con tu médico si se mantiene» | **SOLO** con media de sueño <90 % durante ≥7 días consecutivos — nunca por un mínimo aislado (el 79 del sondeo es casi seguro artefacto); jamás rojo |
| Hoy (KPI) | «Semáforo y Garmin coinciden N de M días» | n≥20 días con ambos veredictos |

**Prohibidos** (tautologías del modelo Garmin): sueño→readiness, estrés→readiness, temperatura→sweatLoss como «hallazgos»; en el explorador se etiquetan «relación por construcción».

---

## 6. Paleta

**Reuso total** de la paleta validada (tokens, S1 `#3987e5` azul, S2 `#199e70` aqua, S3 `#9085e9` violeta, S4 `#d55181` magenta, estado reservado, rampas zonas/heatmap/sueño) en sus dos temas de `helpers.js`. Ningún hue categórico nuevo.

**Una rampa secuencial nueva** (`RAMPA_ESTRES`, 4 pasos, tono aqua de la familia S2, claro=reposo → oscuro=alto), justificada por el tercer dominio ordinal (azul=zonas FC, violeta=sueño). **Validada hoy ejecutando el validador** (`G:/Temp/claude/bundled-skills/2.1.278/2dec20675c959d9fbcfa4d3ce4e6d8f5/dataviz/scripts/validate_palette.js` — la ruta versionada cambió respecto a la indicada; localizada con glob):

```
dark:  ['#b5e6d4', '#7cccae', '#3aa981', '#147a57']
  node validate_palette.js "#b5e6d4,#7cccae,#3aa981,#147a57" --mode dark --surface "#161b24" --ordinal
  → ALL CHECKS PASS (monotone, ΔL≥0.06, contraste 3.25:1, hue spread 7°)

light: ['#56b38e', '#2f9268', '#14724c', '#085234']
  node validate_palette.js "#56b38e,#2f9268,#14724c,#085234" --mode light --surface "#ffffff" --ordinal → ALL CHECKS PASS (2.55:1)
  node validate_palette.js "#56b38e,#2f9268,#14724c,#085234" --mode light --surface "#f6f8fb" --ordinal → ALL CHECKS PASS (2.40:1)
```

Nota: la candidata original de la propuesta ganadora fallaba en modo claro (light-end 1.38:1 < 2:1) — como el resto de rampas del sistema, el tema claro lleva **pasos propios diseñados**, no la inversión de los oscuros. Se añade `rampaEstres` a ambos objetos de `PALETAS` en `helpers.js` con el contrato de §2.4 del spec base (re-validar si se toca un hex). Fallback documentado si el futuro rompe la validación: barra única «% de tiempo en estrés alto» en S1.

---

## 7. Plan de implementación por fases

- **F0 — Fixes de pipeline (1 commit, primero):** guard + sobrescritura en `append_status_history`, re-sembrado del punto de hoy, `dump_token` en `finally`. Verificar: `status_history.json` sin filas todo-null y con el punto de hoy poblado.
- **F1 — `harvest_stats` + `health.json` (ventana):** refactor del get_stats compartido; ventana `HEALTH_REFETCH_DAYS=2` con spo2/respiration/readiness/hydration. **Verificar: diff de `daily.json` antes/después = solo orden/nada.** Activar backfill con `HEALTH_BACKFILL_MAX=30`.
- **F2 — Snapshots:** `trends.json` (con dedupe) + `prs.json`. Verificar unidad de `lt_speed_raw` contra la app Connect y el mapping de `typeId` contra la lista de PRs de la app; anotar resultados en el código.
- **F3 — Shell de pestañas:** tab bar accesible, hash routing, registry por pestaña con `dirty`, redistribución de las cards existentes (0 nuevas). La web debe quedar publicable al final de esta fase con paridad funcional total.
- **F4 — Hoy + Recuperar nuevas:** adición Garmin al hero (+KPI acuerdo, +estado «aún no ha puntuado»), desglose de factores, constantes con percentil, readiness en el tiempo, estrés (línea + reparto con `RAMPA_ESTRES`), BB flotante, tabla mensual recuperación.
- **F5 — Cuerpo completa** + `percentileRank` en helpers.
- **F6 — Entrenar nuevas (PRs, predicciones, umbral, carga/VO2max) + Archivo ampliado** (merge nuevo en pipeline, ejes del explorador, filas del modal, badges 🏆 oficiales) + insights nuevos.
- **F7 — Endurecimiento:** prueba manual de las 5 pestañas con `health.json`/`trends.json`/`prs.json` ausentes (emptyState por card), cambio de rango en cada pestaña visitando las otras 4, tema dual, móvil 360 px, vigilancia de rate-limit durante la semana de backfill.

---

## 8. Riesgos y qué NO prometer

1. **Wording médico** (riesgo mayor del ángulo): bandas siempre «referencia poblacional» en gris, jamás semáforo por valores clínicos; SpO2 nunca dispara rojo y su único insight exige persistencia ≥7 días de media <90; nota de no-diagnóstico fija en Cuerpo.
2. **Unidad del ritmo de umbral sin confirmar** (0.29444; hipótesis ×10→5:40/km): se guarda crudo con flag y **no se publica el ritmo** hasta verificar; en v1 solo FC umbral y FTP (etiquetado «estimado por peso», `origin:weight` verificado).
3. **`trends.json` nace vacío**: predicciones, fitness age y umbral no tienen backfill (`max_metrics` vacío, verificado) — badges «serie en construcción» y guardas n≥14 sin excepciones.
4. **Backfill de readiness/spo2 a 6 meses NO verificado** (sondeo solo probó fechas recientes): sentinel None evita re-quemar llamadas; las cards degradan con estado vacío explicativo.
5. **Doble entrada diaria de readiness**: regla determinista AFTER_WAKEUP_RESET / timestamp más temprano, o la serie baila (verificado: 2 entradas con `recoveryTime` 1 vs 37 el mismo día).
6. **Refactor del get_stats compartido** puede romper el BB existente: diff obligatorio de `daily.json` en F1.
7. **Semana de backfill ≈170 llamadas/run**: topes duros, sin paralelismo, bajar a la mitad al primer 429; `dump_token` en `finally` protege el token si el run aborta.
8. **Mapping de `typeId`** sin documentar (`prTypeLabelKey:null` verificado): fallback «Récord tipo N» + verificación manual el primer día.
9. **Cinco pestañas multiplican estados vacíos**: emptyState por card y prueba manual con cada fichero ausente (F7). El flag `dirty` es superficie nueva de bugs de chart obsoleto: test explícito.
10. **Doble discurso Garmin vs semáforo**: etiquetado siempre («Garmin opina» vs nuestro semáforo), jamás fusionado; el KPI de acuerdo (n≥20) da el contexto.
11. **NO prometer nunca:** endurance score y hill score (el FR265 no es capaz: `hillScoreAndEnduranceScoreCapable:false` — no es fase 2, es imposible con este reloj); composición corporal más allá del peso; histórico de VO2max por API (solo el snapshot propio); series intradía; running tolerance (`runningToleranceCapable:false`); hidratación registrada (el usuario no apunta; `sweatLossInML` sí se captura y queda además como candidato para el tooltip de carreras de verano).
12. **Reparto de estrés no suma 100** (verificado: quedan fuera actividad ~7 % y sin clasificar ~6 %): normalizar sobre las 4 categorías medidas y titularlo honestamente; no inventar una quinta categoría en la rampa.
