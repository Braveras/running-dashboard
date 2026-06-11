# Garmin Running Dashboard — Design

**Fecha:** 2026-06-11
**Usuario:** Alejandro (Braveras) — corredor, Madrid, datos desde 2026-03-12
**Objetivo:** Dashboard web auto-actualizado a diario con todos sus datos de Garmin Connect, con análisis interactivos, hospedado en GitHub Pages.

## Decisiones tomadas con el usuario

- **Privacidad:** repo **privado** + GitHub Pages público (solo la web final es visible; URL semi-privada). Si la cuenta no tiene GitHub Pro y Pages falla en repo privado → fallback acordado: repo público.
- **Auth Garmin:** tokens OAuth (garth) generados una vez en local, guardados como GitHub Actions secret en base64. NO se guarda la contraseña. Tokens duran ~1 año.
- **Contenido:** todo lo disponible — carreras con detalle, sueño, HRV, body battery, carga de entrenamiento, VO2max, peso.
- **Interactividad (las 6 aprobadas):** drill-down por carrera, explorador de correlaciones, curva de eficiencia aeróbica, heatmap de consistencia, selector de rango temporal global, panel "estado de hoy".
- **Idioma:** español. Estilo: tema oscuro igual a `progreso.html` (paleta verde/azul sobre #0e1116).

## Arquitectura

```
running-dashboard/  (repo privado github.com/Braveras/running-dashboard)
├── scripts/
│   ├── login.py          # one-time local: email+pass+MFA → tokens garth → instrucciones gh secret set
│   └── fetch_data.py     # diario en CI: descarga incremental → data/*.json
├── data/                 # JSON commiteados (histórico acumulado)
│   ├── runs.json         # lista carreras: fecha, km, dur, pace, FC avg/max, cadencia, calorías
│   ├── all_activities.json # todas las actividades (fecha, tipo, duración) — para el heatmap
│   ├── runs_detail.json  # por activity_id: splits, zonas FC, clima, potencia
│   ├── daily.json        # por fecha: sueño (score, horas, fases, hora dormir), HRV (+baseline), body battery, estrés, peso
│   ├── status.json       # training status actual: cargas, VO2max, ACWR
│   └── meta.json         # last_updated, rango de datos
├── web/                  # estático, Chart.js 4 por CDN, sin build
│   ├── index.html
│   ├── app.js
│   └── style.css
└── .github/workflows/update.yml
```

**Flujo diario (GitHub Actions, cron 08:00 UTC = 10:00 Madrid verano):**
1. checkout → setup Python → pip install garminconnect
2. restaura tokens desde secret `GARMIN_TOKENS` (base64 → ~/.garminconnect)
3. `fetch_data.py`: incremental — re-fetch últimos 7 días de dailies + solo actividades nuevas (detalle se descarga una vez por activity_id)
4. commit de `data/` si hay cambios
5. build artifact (web/ + data/) → deploy a GitHub Pages
6. workflow_dispatch habilitado para forzar actualización manual

**Manejo de errores en CI:** si Garmin API falla (rate limit, token caducado), el workflow falla con log claro; la web sigue sirviendo los últimos datos buenos. Token caducado → regenerar con login.py local (documentado en README).

## Componentes de la web

### Secciones estáticas (filtradas por el selector de rango)
1. **Tarjetas resumen:** km totales, nº carreras, tiempo, VO2max, racha (carreras/semana últimas 4), km mes actual vs anterior
2. **Distancia por carrera** + media móvil 4
3. **Ritmo vs FC media** (doble eje, eje ritmo invertido)
4. **FC máx por carrera** con techo Z2 (142)
5. **Volumen mensual** (km + nº carreras)
6. **Sueño diario:** score (color por calificación) + horas + REM% — con noches de fiesta detectables (estrés nocturno >40 marcadas distinto)
7. **HRV nocturno** con banda baseline (45-83) sombreada
8. **Body battery:** cargado vs drenado por día
9. **Carga entrenamiento:** aguda vs crónica con zona óptima (110-205) sombreada
10. **Cadencia por carrera** con objetivo 160-165 marcado
11. **Peso** (si hay weigh-ins)
12. **Tabla últimas 10 carreras** con todas las métricas

### Interactivos
- **Selector de rango global:** 7d / 30d / 90d / todo — re-filtra todas las gráficas
- **Drill-down por carrera:** click en punto/barra/fila → panel modal con splits km a km (pace+FC+cadencia), tiempo en zonas, clima del momento (temp, humedad), sueño de la noche anterior y HRV de esa mañana
- **Explorador de correlaciones:** scatter con dropdowns X/Y + línea de regresión + R². Variables: horas sueño, score sueño, REM%, HRV, body battery al salir, temperatura, hora de salida, FC media, pace, EF, hora de acostarse. Pares destacados sugeridos como presets: "sueño→rendimiento", "calor→FC", "hora acostarse→calidad sueño"
- **Curva EF (eficiencia aeróbica):** velocidad(m/min)/FC media por carrera, línea de tendencia. La métrica de progreso principal
- **Heatmap consistencia:** calendario tipo GitHub, color por día = carrera (intensidad por km) / sin actividad
- **Panel "estado de hoy":** semáforo verde/ámbar/rojo con lógica: HRV vs baseline + score sueño anoche + body battery + días desde última carrera → texto "Corre hoy (Z2 suave)" / "Descansa" / "Opcional: fuerza". Reglas simples documentadas en app.js

### Datos derivados (calculados en fetch_data.py, no en el navegador)
- pace s/km, EF, hora de acostarse (de sleep_start), flag noche-fiesta (estrés nocturno >40 y score <35)
- merge carrera ↔ sueño noche anterior ↔ HRV de esa mañana ↔ clima (para el explorador sin lógica compleja en JS)

## Testing
- `fetch_data.py` probado en local primero (genera los JSON reales antes del primer push)
- Web verificada en local con los JSON reales abriendo index.html
- Primer run del workflow lanzado manualmente (workflow_dispatch) y verificado antes de confiar en el cron

## Fuera de alcance (YAGNI)
- Mapas GPS de rutas (privacidad + peso)
- Comparador manual de 2 carreras (el scatter lo cubre)
- Race predictions de Garmin
- Backend/BD — todo estático
- Otros deportes (solo running; fuerza aparecerá en heatmap si se registra en Garmin)
