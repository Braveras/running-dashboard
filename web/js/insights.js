/* ==========================================================================
   insights.js — módulo PURO: datos → frases en español (§6.6 del spec).

   Contrato (INTERFACES.md §4.7):
   - Cada función recibe `data` = ctx.data COMPLETO (histórico) y devuelve UNA
     frase en español (string). El que pinta es app.js.
   - GUARDAS obligatorias por plantilla: n mínimo, magnitud mínima del efecto,
     comparación válida y campos null. Si ninguna plantilla pasa → fallback
     neutro. «Una frase incorrecta destruye más confianza que diez gráficas.»
   - JAMÁS lanzan (todo envuelto en try/catch → fallback) y JAMÁS inventan
     datos no derivables (p.ej. nivel absoluto de Body Battery).
   - Sin DOM, sin Chart: solo importa funciones/constantes puras de helpers.js.
   ========================================================================== */

import { paceFmt, MONTH_ES, isoWeekKey, isoAddDays, isoToday } from './helpers.js';

/* ---------- Constantes del dominio ---------- */

const Z2_TECHO = 142;            // techo de FC para Z2 (ppm)
const CADENCIA_OBJ = [160, 165]; // banda objetivo de cadencia (spm)
const CADENCIA_MIN = 120;        // por debajo se considera outlier (caminando)

// Nombres largos de mes SOLO para prosa (las etiquetas de gráficas usan MONTH_ES).
const MES_LARGO = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

/* ---------- Utilidades puras internas ---------- */

const fin = Number.isFinite;

/** Media de los valores finitos; null si no hay ninguno. */
function media(valores) {
  const v = valores.filter(fin);
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
}

/** Número con coma decimal española. num(6.06) → '6,1'. */
function num(x, dec = 1) {
  return fin(x) ? x.toFixed(dec).replace('.', ',') : '–';
}

/** 'YYYY-MM-DD' → índice de mes 0–11, o null si no parsea. */
function idxMes(iso) {
  const m = parseInt(String(iso).slice(5, 7), 10) - 1;
  return m >= 0 && m <= 11 ? m : null;
}

/** Nombre largo del mes de una fecha ISO ('2026-07-14' → 'julio'). */
function mesLargo(iso) {
  const m = idxMes(iso);
  return m === null ? null : MES_LARGO[m];
}

/** Nombre corto del mes (para cifras compactas): '2026-07-14' → 'jul'. */
function mesCorto(iso) {
  const m = idxMes(iso);
  return m === null ? null : MONTH_ES[m];
}

/** ¿Es un array con al menos n elementos? */
function esArray(a, n = 1) {
  return Array.isArray(a) && a.length >= n;
}

/** Carreras válidas ordenadas asc por fecha (defensa extra; state.js ya ordena). */
function carreras(data) {
  if (!esArray(data?.runs)) return [];
  return data.runs
    .filter((r) => r && typeof r.date === 'string' && r.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/** Días válidos ordenados asc por fecha. */
function dias(data) {
  if (!esArray(data?.daily)) return [];
  return data.daily
    .filter((d) => d && typeof d.date === 'string' && d.date.length >= 10)
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

/**
 * Fecha de referencia «hoy» del cuaderno: la de meta.updated (los datos se
 * congelan ahí); fallback: último daily, última carrera, hoy local.
 */
function refHoy(data) {
  const u = data?.meta?.updated;
  if (typeof u === 'string' && u.length >= 10) return u.slice(0, 10);
  const d = dias(data);
  if (d.length) return d[d.length - 1].date;
  const r = carreras(data);
  if (r.length) return r[r.length - 1].date;
  return isoToday();
}

/** Días de diferencia entre dos ISO (b − a), en UTC. */
function diffDias(a, b) {
  const t = (iso) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
  return Math.round((t(b) - t(a)) / 86400000);
}

/** Agrupa carreras por mes 'YYYY-MM' → array de carreras. Orden de claves asc. */
function porMes(runs) {
  const map = new Map();
  for (const r of runs) {
    const k = r.date.slice(0, 7);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(r);
  }
  return map;
}

/**
 * Carreras con % REAL de tiempo con FC ≤142 (fase 3): cruza runs con
 * runsDetail[id].pct_z2. Devuelve copias {…run, pct_z2} SOLO donde el campo
 * es numérico (clave ausente / null → fuera, sin lanzar). Orden asc por fecha.
 */
function carrerasZ2pct(data) {
  const det = data?.runsDetail;
  if (!det || typeof det !== 'object') return [];
  return carreras(data)
    .map((r) => ({ ...r, pct_z2: det[String(r.id)]?.pct_z2 }))
    .filter((r) => fin(r.pct_z2));
}

/**
 * Envuelve una lista de plantillas: devuelve la primera frase no nula;
 * si todas fallan (o lanzan), el fallback neutro. GARANTIZA no lanzar.
 */
function primera(plantillas, data, fallback) {
  for (const p of plantillas) {
    try {
      const frase = p(data);
      if (typeof frase === 'string' && frase.length) return frase;
    } catch { /* una plantilla rota nunca tumba el insight */ }
  }
  return fallback;
}

/* ==========================================================================
   PLANTILLAS (cada una con sus guardas; devuelven string o null)
   ========================================================================== */

/**
 * «En julio corres al ritmo de marzo con 10 ppm menos de FC media.»
 * Compara el primer mes con ≥3 carreras contra el último mes con ≥3.
 * Guardas: meses distintos y separados ≥2 meses naturales, medias finitas,
 * FC baja ≥4 ppm y ritmo igual o mejor (≤ +3 %).
 */
function tplRitmoIgualFc(data) {
  const runs = carreras(data).filter((r) => fin(r.pace_s) && fin(r.hr));
  if (runs.length < 8) return null;
  const meses = [...porMes(runs).entries()].filter(([, rs]) => rs.length >= 3);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[0];
  const [k1, rs1] = meses[meses.length - 1];
  // Comparación válida: al menos 2 meses de distancia entre ambos.
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep < 2) return null;
  const pace0 = media(rs0.map((r) => r.pace_s));
  const pace1 = media(rs1.map((r) => r.pace_s));
  const hr0 = media(rs0.map((r) => r.hr));
  const hr1 = media(rs1.map((r) => r.hr));
  if (![pace0, pace1, hr0, hr1].every(fin)) return null;
  const bajadaFc = hr0 - hr1;
  if (bajadaFc < 4) return null;                 // magnitud mínima del efecto
  if (pace1 > pace0 * 1.03) return null;         // el ritmo no puede haber empeorado
  const m0 = mesLargo(`${k0}-01`);
  const m1 = mesLargo(`${k1}-01`);
  if (!m0 || !m1) return null;
  const ritmo = pace1 <= pace0 * 0.97
    ? `corres más rápido que en ${m0} (${paceFmt(pace1)} vs ${paceFmt(pace0)})`
    : `corres al ritmo de ${m0}`;
  return `En ${m1} ${ritmo} con ${Math.round(bajadaFc)} ppm menos de FC media.`;
}

/**
 * «Tu eficiencia en Z2 ha subido un 8 % desde abril.»
 * Compara el primer mes con ≥3 carreras Z2 (FC≤142) contra las últimas 4 Z2.
 * Guardas: n≥3 por lado, mejora ≥3 %, la comparación no solapa carreras.
 */
function tplEfZ2(data) {
  const z2 = carreras(data).filter((r) => fin(r.hr) && r.hr <= Z2_TECHO && fin(r.ef) && r.ef > 0);
  if (z2.length < 7) return null;
  const meses = [...porMes(z2).entries()].filter(([, rs]) => rs.length >= 3);
  if (!meses.length) return null;
  const [kBase, rsBase] = meses[0];
  const ultimas = z2.slice(-4);
  if (ultimas[0].date.slice(0, 7) === kBase) return null; // solaparía la base
  const efBase = media(rsBase.map((r) => r.ef));
  const efAhora = media(ultimas.map((r) => r.ef));
  if (!fin(efBase) || !fin(efAhora) || efBase <= 0) return null;
  const pct = ((efAhora - efBase) / efBase) * 100;
  if (pct < 3) return null;                      // magnitud mínima del efecto
  const mes = mesLargo(`${kBase}-01`);
  if (!mes) return null;
  return `Tu eficiencia aeróbica en Z2 ha subido un ${Math.round(pct)} % desde ${mes} — más metros por latido.`;
}

/**
 * «Cadencia media 140 spm: a −20 spm del objetivo 160–165.»
 * Guardas: ≥10 carreras con cadencia válida (≥120 spm), gap ≥5 spm.
 * Detecta estancamiento comparando primeras 5 vs últimas 5.
 */
function tplGapCadencia(data) {
  const conCad = carreras(data).filter((r) => fin(r.cadence) && r.cadence >= CADENCIA_MIN);
  if (conCad.length < 10) return null;
  const ult = media(conCad.slice(-10).map((r) => r.cadence));
  if (!fin(ult)) return null;
  const gap = CADENCIA_OBJ[0] - ult;
  if (gap < 5) return null;                      // magnitud mínima
  const ini = media(conCad.slice(0, 5).map((r) => r.cadence));
  const fin5 = media(conCad.slice(-5).map((r) => r.cadence));
  let estanc = '';
  if (fin(ini) && fin(fin5) && Math.abs(fin5 - ini) < 2) {
    const mes = mesLargo(conCad[0].date);
    if (mes) estanc = ` y estancada desde ${mes} (${num(ini)} → ${num(fin5)})`;
  }
  return `Cadencia media ${Math.round(ult)} spm: a −${Math.round(gap)} spm del objetivo ${CADENCIA_OBJ[0]}–${CADENCIA_OBJ[1]}${estanc}.`;
}

/**
 * «20 de 34 carreras dentro de Z2 (59 %).»
 * Guardas: ≥10 carreras con FC media válida.
 */
function tplDisciplinaZ2(data) {
  const conHr = carreras(data).filter((r) => fin(r.hr));
  if (conHr.length < 10) return null;
  const dentro = conHr.filter((r) => r.hr <= Z2_TECHO).length;
  const pct = Math.round((dentro / conHr.length) * 100);
  const calurosas = conHr.filter((r) => r.hr > Z2_TECHO && fin(r.temp_c) && r.temp_c > 24).length;
  const coda = calurosas >= 3
    ? ' — el calor de Madrid infla la FC, no es falta de control'
    : '';
  return `${dentro} de ${conHr.length} carreras con la FC media dentro de Z2 (${pct} %)${coda}.`;
}

/* ---------- Plantillas de DISCIPLINA Z2 (fase 3: runsDetail[id].pct_z2) ---------- */
/* pct_z2 = % de tiempo REAL con FC ≤142 (no la FC media): mide cuánto de cada
   carrera se corrió de verdad bajo el techo. Las tres plantillas siguientes
   son ALTERNATIVAS por prioridad (solo una se pinta por acto), no duplicados. */

/**
 * «Disciplina al alza: 62 % del tiempo por debajo de 142 ppm en tus últimas
 * 5 carreras, 14 puntos más que en las 5 anteriores.»
 * Guardas: ≥10 carreras con pct_z2 (dos ventanas de 5 SIN solape) y cambio
 * ≥10 puntos — por debajo es ruido entre salidas, no tendencia (§6.6).
 * Habla de «tus últimas 5 carreras» (relativo al histórico registrado), así
 * que sigue siendo cierta aunque los datos se congelen.
 */
function tplZ2Tendencia5(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 10) return null;               // n mínimo: 5 + 5 sin solape
  const ult = media(rs.slice(-5).map((r) => r.pct_z2));
  const prev = media(rs.slice(-10, -5).map((r) => r.pct_z2));
  if (!fin(ult) || !fin(prev)) return null;
  const delta = ult - prev;
  if (Math.abs(delta) < 10) return null;         // magnitud mínima: 10 puntos
  if (delta > 0) {
    return `Disciplina al alza: ${Math.round(ult)} % del tiempo por debajo de 142 ppm en tus últimas 5 carreras, ${Math.round(delta)} puntos más que en las 5 anteriores.`;
  }
  return `Tus últimas 5 carreras bajan al ${Math.round(ult)} % del tiempo por debajo de 142 ppm, ${Math.round(-delta)} puntos menos que las 5 anteriores — vuelve a frenar desde el primer kilómetro.`;
}

/**
 * «En julio has pasado el 59 % del tiempo por debajo de 142 ppm, 12 puntos
 * más que en junio.»
 * Compara los DOS últimos meses con base suficiente, y solo si son meses
 * naturales consecutivos (mayo vs marzo confundiría al lector).
 * Guardas: ≥4 carreras con pct_z2 por mes, meses consecutivos, cambio ≥10
 * puntos. Nombra los meses explícitamente → cierta también con datos viejos.
 */
function tplZ2Meses(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 8) return null;                // n mínimo global (4 + 4)
  const meses = [...porMes(rs).entries()].filter(([, v]) => v.length >= 4);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[meses.length - 2];
  const [k1, rs1] = meses[meses.length - 1];
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep !== 1) return null;                    // solo meses consecutivos
  const m0 = media(rs0.map((r) => r.pct_z2));
  const m1 = media(rs1.map((r) => r.pct_z2));
  if (!fin(m0) || !fin(m1)) return null;
  const delta = m1 - m0;
  if (Math.abs(delta) < 10) return null;         // magnitud mínima: 10 puntos
  const n0 = mesLargo(`${k0}-01`);
  const n1 = mesLargo(`${k1}-01`);
  if (!n0 || !n1) return null;
  if (delta > 0) {
    return `En ${n1} has pasado el ${Math.round(m1)} % del tiempo por debajo de 142 ppm, ${Math.round(delta)} puntos más que en ${n0} — la disciplina va a mejor.`;
  }
  return `En ${n1} el tiempo por debajo de 142 ppm cae al ${Math.round(m1)} % (${n0}: ${Math.round(m0)} %) — el freno se está soltando.`;
}

/**
 * «Tu carrera más disciplinada de julio: 68 % del tiempo por debajo de
 * 142 ppm el día 14 (3,1 km).»
 * Guardas: ≥5 carreras con pct_z2 en total, ≥3 en el mes de referencia,
 * salidas ≥2 km (un trote de 1 km no representa disciplina) y la mejor ≥60 %
 * — elogiar un «mejor» del 40 % sonaría a burla. Nombra el mes explícitamente
 * (el de refHoy, es decir, el de los propios datos) → no miente si envejecen.
 */
function tplZ2MejorMes(data) {
  const rs = carrerasZ2pct(data).filter((r) => fin(r.km) && r.km >= 2);
  if (rs.length < 5) return null;                // n mínimo global
  const mesRef = refHoy(data).slice(0, 7);
  const delMes = rs.filter((r) => r.date.slice(0, 7) === mesRef);
  if (delMes.length < 3) return null;            // n mínimo del mes
  const mejor = delMes.reduce((a, r) => (r.pct_z2 > a.pct_z2 ? r : a));
  if (mejor.pct_z2 < 60) return null;            // magnitud mínima del elogio
  const mes = mesLargo(mejor.date);
  if (!mes) return null;
  return `Tu carrera más disciplinada de ${mes}: ${Math.round(mejor.pct_z2)} % del tiempo por debajo de 142 ppm el día ${+mejor.date.slice(8, 10)} (${num(mejor.km)} km).`;
}

/**
 * «4 carreras seguidas con más del 70 % del tiempo por debajo de 142 ppm.»
 * Racha VIVA (contada desde la última carrera hacia atrás), con el récord
 * histórico como coda. Misma convención que tplRacha: habla de carreras
 * registradas, no del calendario, así que no necesita guarda de frescura.
 * Guardas: ≥5 carreras con pct_z2 y racha ≥3 (2 seguidas no es racha).
 */
function tplZ2RachaViva(data) {
  const rs = carrerasZ2pct(data);
  if (rs.length < 5) return null;                // n mínimo
  let racha = 0;
  for (let i = rs.length - 1; i >= 0 && rs[i].pct_z2 > 70; i--) racha++;
  if (racha < 3) return null;                    // magnitud mínima
  let mejor = 0;
  let cur = 0;
  for (const r of rs) {
    cur = r.pct_z2 > 70 ? cur + 1 : 0;
    if (cur > mejor) mejor = cur;
  }
  const coda = racha >= mejor ? ' — tu mejor racha del histórico' : ` (récord: ${mejor})`;
  return `${racha} carreras seguidas con más del 70 % del tiempo por debajo de 142 ppm${coda}.`;
}

/**
 * «Llevas 5,2 km esta semana, un 30 % por encima de tu media de 4 semanas.»
 * Guardas: histórico ≥28 días, media previa > 0, desviación ≥20 %.
 */
function tplKmSemana(data) {
  const runs = carreras(data).filter((r) => fin(r.km));
  if (runs.length < 4) return null;
  const hoy = refHoy(data);
  // Guarda de frescura: «llevas X km esta semana» habla en presente; con datos
  // congelados >1 día la frase mentiría (§6.6) → cede el turno a otra plantilla.
  if (diffDias(hoy, isoToday()) > 1) return null;
  if (diffDias(runs[0].date, hoy) < 28) return null; // comparación aún no válida
  const porSemana = new Map();
  for (const r of runs) {
    const k = isoWeekKey(r.date);
    porSemana.set(k, (porSemana.get(k) || 0) + r.km);
  }
  const semActual = isoWeekKey(hoy);
  const kmAhora = porSemana.get(semActual) || 0;
  // Las 4 semanas ANTERIORES (las sin carreras cuentan 0: es volumen real).
  const previas = [1, 2, 3, 4].map((i) => porSemana.get(isoWeekKey(isoAddDays(hoy, -7 * i))) || 0);
  const media4 = media(previas);
  if (!fin(media4) || media4 <= 0) return null;
  const delta = ((kmAhora - media4) / media4) * 100;
  if (Math.abs(delta) < 20) return null;         // magnitud mínima
  if (delta > 0) {
    return `Llevas ${num(kmAhora)} km esta semana, un ${Math.round(delta)} % por encima de tu media de 4 semanas.`;
  }
  return `Semana suave: ${num(kmAhora)} km frente a los ${num(media4)} km de media — hay margen para otra salida.`;
}

/**
 * «4 semanas seguidas corriendo al menos una vez.»
 * Guardas: racha ≥3 semanas (contada hacia atrás; la semana en curso puede
 * estar aún vacía sin romperla).
 */
function tplRacha(data) {
  const runs = carreras(data);
  if (runs.length < 3) return null;
  const semanas = new Set(runs.map((r) => isoWeekKey(r.date)));
  const hoy = refHoy(data);
  let racha = 0;
  let i = semanas.has(isoWeekKey(hoy)) ? 0 : 1; // la semana en curso no rompe la racha
  for (; i < 260; i++) {
    if (semanas.has(isoWeekKey(isoAddDays(hoy, -7 * i)))) racha++;
    else break;
  }
  if (racha < 3) return null;
  return `${racha} semanas seguidas corriendo al menos una vez — la constancia es la base.`;
}

/* ---------- Plantillas de HOY (estado del día) ---------- */

/** Frescura: si los datos del reloj no son de hoy/ayer, avisar sin inventar.
 *  El atraso se mide contra la fecha REAL (isoToday), no contra meta.updated:
 *  el pipeline escribe daily y meta el mismo día, así que compararlos entre sí
 *  daría siempre ~0 y esta guarda jamás dispararía con datos congelados.
 *  Además, al ir primera bloquea las plantillas de HOY en presente (§6.6),
 *  coherente con el semáforo (today.js usa isoToday). */
function tplHoyFrescura(data) {
  const d = dias(data);
  if (!d.length) return null;
  const atraso = diffDias(d[d.length - 1].date, isoToday());
  if (atraso <= 1) return null;
  return `Los datos del reloj tienen ${atraso} días — tómate el semáforo con cautela y decide por sensaciones.`;
}

/** Fiesta anoche + HRV bajo: la combinación que pide descanso. */
function tplHoyFiesta(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  if (hoy.party !== true) return null;
  const low = data?.status?.hrv_baseline?.balancedLow;
  if (fin(hoy.hrv) && fin(low) && hoy.hrv < low) {
    return `Noche de fiesta y HRV en ${hoy.hrv} ms, por debajo de tu banda: hoy toca descansar de verdad.`;
  }
  return 'Anoche hubo fiesta: si sales, que sea corto, suave y con agua.';
}

/** HRV por debajo de la banda personal. */
function tplHoyHrvBajo(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  const low = data?.status?.hrv_baseline?.balancedLow;
  if (!fin(hoy.hrv) || !fin(low) || hoy.hrv >= low) return null;
  return `HRV en ${hoy.hrv} ms, por debajo de tu banda (${low}+): escucha al cuerpo y suaviza o descansa.`;
}

/** Sueño muy corto anoche. */
function tplHoySuenoCorto(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  if (!fin(hoy.sleep_hours) || hoy.sleep_hours >= 5.5) return null;
  return `Solo ${num(hoy.sleep_hours)} h de sueño anoche — si corres, que sea corto y bien por debajo de 142.`;
}

/** Todo en orden: HRV en banda (+ carga baja si el ratio Garmin lo confirma). */
function tplHoyVerde(data) {
  const d = dias(data);
  if (!d.length) return null;
  const hoy = d[d.length - 1];
  const b = data?.status?.hrv_baseline;
  if (!fin(hoy.hrv) || !fin(b?.balancedLow) || !fin(b?.balancedUpper)) return null;
  if (hoy.hrv < b.balancedLow || hoy.hrv > b.balancedUpper) return null;
  const a = data?.status?.acute_load;
  const c = data?.status?.chronic_load;
  const cargaBaja = fin(a) && fin(c) && c > 0 && a / c < 0.8;
  const coda = cargaBaja ? ' y la carga aguda está muy baja: hoy toca salir' : '';
  return `HRV en ${hoy.hrv} ms, dentro de tu banda ${b.balancedLow}–${b.balancedUpper}${coda} — buen día para rodar en Z2.`;
}

/* ---------- Plantillas de RECUPERACIÓN ---------- */

/** HRV semanal vs banda personal (media de los últimos 7 días con dato). */
function tplRecupHrv(data) {
  const d = dias(data);
  const b = data?.status?.hrv_baseline;
  if (!fin(b?.balancedLow) || !fin(b?.balancedUpper)) return null;
  const ult7 = d.slice(-7).map((x) => x.hrv).filter(fin);
  if (ult7.length < 4) return null;              // n mínimo
  const m = media(ult7);
  if (!fin(m)) return null;
  if (m < b.balancedLow) {
    return `Tu HRV medio de la última semana (${Math.round(m)} ms) está por debajo de tu banda ${b.balancedLow}–${b.balancedUpper}: prioriza dormir.`;
  }
  if (m > b.balancedUpper) return null;          // fuera por arriba: sin plantilla fiable
  return `HRV medio de la última semana: ${Math.round(m)} ms, estable dentro de tu banda ${b.balancedLow}–${b.balancedUpper}.`;
}

/** Sueño medio semanal por debajo de lo razonable. */
function tplRecupSueno(data) {
  const d = dias(data);
  const ult7 = d.slice(-7).map((x) => x.sleep_hours).filter(fin);
  if (ult7.length < 4) return null;              // n mínimo
  const m = media(ult7);
  if (!fin(m) || m >= 6) return null;            // magnitud mínima del déficit
  return `Duermes ${num(m)} h de media esta semana — la adaptación al entrenamiento se fabrica durmiendo.`;
}

/* ---------- Plantillas de RECUPERACIÓN · Body Battery (fase 3) ---------- */
/* daily.bb_high = pico diario de Body Battery (0–100), alcanzado tras la
   recarga nocturna. Son datos DERIVADOS de Garmin, nunca inventados aquí. */

/**
 * «Tu pico diario de Body Battery baja de 72 a 61 de media semanal.»
 * Guardas: ≥14 días con bb_high (dos ventanas de 7 con dato), cambio ≥8
 * puntos (menos es vaivén normal del día a día) y FRESCURA: «esta semana»
 * habla en presente — con datos congelados >1 día mentiría (§6.6).
 */
function tplRecupBbTendencia(data) {
  const d = dias(data).filter((x) => fin(x.bb_high));
  if (d.length < 14) return null;                // n mínimo: 7 + 7 con dato
  if (diffDias(d[d.length - 1].date, isoToday()) > 1) return null; // frescura
  const ult = media(d.slice(-7).map((x) => x.bb_high));
  const prev = media(d.slice(-14, -7).map((x) => x.bb_high));
  if (!fin(ult) || !fin(prev)) return null;
  const delta = ult - prev;
  if (Math.abs(delta) < 8) return null;          // magnitud mínima: 8 puntos
  if (delta > 0) {
    return `Tu pico diario de Body Battery sube: media de ${Math.round(ult)} esta semana frente a ${Math.round(prev)} la anterior — la recarga nocturna mejora.`;
  }
  return `Tu pico diario de Body Battery baja de ${Math.round(prev)} a ${Math.round(ult)} de media semanal — vigila sueño y estrés antes de apretar.`;
}

/**
 * «5 noches seguidas recargando la Body Battery a 80 o más.» / «Solo 3 de
 * tus últimas 14 noches han recargado la Body Battery a 80.»
 * Dos ramas EXCLUYENTES de la misma señal (nunca se pintan a la vez):
 * racha buena (≥3 noches seguidas a 80+) o déficit claro (≤4 de las últimas
 * 14 noches). La zona intermedia calla: no hay nada afirmable con confianza.
 * Guardas: ≥14 días con bb_high y frescura ≤1 día («noches seguidas» y
 * «últimas noches» hablan del presente).
 */
function tplRecupBb80(data) {
  const d = dias(data).filter((x) => fin(x.bb_high));
  if (d.length < 14) return null;                // n mínimo para ambas ramas
  if (diffDias(d[d.length - 1].date, isoToday()) > 1) return null; // frescura
  let racha = 0;
  for (let i = d.length - 1; i >= 0 && d[i].bb_high >= 80; i--) racha++;
  if (racha >= 3) {
    return `${racha} noches seguidas recargando la Body Battery a 80 o más — el descanso está haciendo su trabajo.`;
  }
  const noches80 = d.slice(-14).filter((x) => x.bb_high >= 80).length;
  if (noches80 > 4) return null;                 // sin déficit claro → silencio
  if (noches80 === 0) {
    return 'Ninguna de tus últimas 14 noches ha recargado la Body Battery a 80 — prioriza dormir antes que sumar kilómetros.';
  }
  return `Solo ${noches80} de tus últimas 14 noches han recargado la Body Battery a 80 — prioriza dormir antes que sumar kilómetros.`;
}

/* ---------- Plantilla de ARCHIVO ---------- */

/** Totales del histórico (+ fuerza si la hay). Guardas: ≥5 carreras. */
function tplArchivoTotales(data) {
  const runs = carreras(data).filter((r) => fin(r.km));
  if (runs.length < 5) return null;
  const kmTotal = runs.reduce((a, r) => a + r.km, 0);
  const desde = mesLargo(runs[0].date);
  if (!fin(kmTotal) || !desde) return null;
  let fuerza = '';
  if (esArray(data?.allActivities)) {
    const n = data.allActivities.filter((a) => a?.type === 'strength_training').length;
    if (n >= 3) fuerza = ` (y ${n} sesiones de fuerza)`;
  }
  return `${runs.length} carreras y ${num(kmTotal)} km desde ${desde}${fuerza} — cada celda del archivo es una salida hecha.`;
}

/* ---------- Plantilla mensual (variante para PROGRESO) ---------- */

/** Reformulación del ritmo-a-igual-FC para no repetir literal el del header. */
function tplProgresoMeses(data) {
  const runs = carreras(data).filter((r) => fin(r.pace_s) && fin(r.hr));
  if (runs.length < 8) return null;
  const meses = [...porMes(runs).entries()].filter(([, rs]) => rs.length >= 3);
  if (meses.length < 2) return null;
  const [k0, rs0] = meses[0];
  const [k1, rs1] = meses[meses.length - 1];
  const sep = (+k1.slice(0, 4) - +k0.slice(0, 4)) * 12 + (+k1.slice(5, 7) - +k0.slice(5, 7));
  if (sep < 2) return null;
  const pace0 = media(rs0.map((r) => r.pace_s));
  const pace1 = media(rs1.map((r) => r.pace_s));
  const hr0 = media(rs0.map((r) => r.hr));
  const hr1 = media(rs1.map((r) => r.hr));
  if (![pace0, pace1, hr0, hr1].every(fin)) return null;
  if (hr0 - hr1 < 4 || pace1 > pace0 * 1.03) return null;
  const m0 = mesCorto(`${k0}-01`);
  const m1 = mesCorto(`${k1}-01`);
  if (!m0 || !m1) return null;
  return `Mismo ritmo, menos esfuerzo: ${m0} ${paceFmt(pace0)}/km @ ${Math.round(hr0)} ppm → ${m1} ${paceFmt(pace1)}/km @ ${Math.round(hr1)} ppm.`;
}

/* ==========================================================================
   EXPORTS — una función por acto + insight del día (contrato §4.7)
   ========================================================================== */

/** Header #insightDia — la mejor frase disponible del cuaderno. */
export function insightDelDia(data) {
  return primera(
    [tplRitmoIgualFc, tplEfZ2, tplKmSemana, tplRacha],
    data,
    'Semana tranquila — los datos siguen acumulándose.',
  );
}

/** Acto 1 · HOY (#insightHoy) — estado del día, sin inventar Body Battery. */
export function insightHoy(data) {
  return primera(
    [tplHoyFrescura, tplHoyFiesta, tplHoyHrvBajo, tplHoySuenoCorto, tplHoyVerde],
    data,
    'Día normal: decide por sensaciones y mantén la FC por debajo de 142.',
  );
}

/** Acto 2 · ESTA SEMANA (#insightSemana).
 *  La racha viva de disciplina Z2 entra tras el volumen: si la semana no da
 *  titular de kilómetros, una racha en curso es la mejor noticia semanal. */
export function insightSemana(data) {
  return primera(
    [tplKmSemana, tplZ2RachaViva, tplRacha],
    data,
    'Semana tranquila — los datos siguen acumulándose.',
  );
}

/** Acto 3 · PROGRESO (#insightProgreso). */
export function insightProgreso(data) {
  return primera(
    [tplEfZ2, tplProgresoMeses],
    data,
    'El progreso aeróbico es lento por diseño — constancia sobre intensidad.',
  );
}

/** Acto 4 · INTENSIDAD Y TÉCNICA (#insightIntensidad).
 *  Prioridad: cambio reciente (5v5) > cambio mensual > mejor del mes >
 *  foto global (FC media) > cadencia. Lo nuevo y específico manda; el conteo
 *  global queda de red de seguridad (su cifra ya vive en el KPI de zonas).
 *  NOTA fase 3: se DESCARTARON los cruces pct_z2×temp_c y pct_z2×EF — con
 *  los 34 puntos actuales |r|<0,3 (0,21 y −0,29): correlación insuficiente
 *  para afirmar nada sin mentir (§6.6). Reevaluar con más histórico. */
export function insightIntensidad(data) {
  return primera(
    [tplZ2Tendencia5, tplZ2Meses, tplZ2MejorMes, tplDisciplinaZ2, tplGapCadencia],
    data,
    'Rueda suave y deja que la técnica llegue con los kilómetros.',
  );
}

/** Acto 5 · RECUPERACIÓN (#insightRecuperacion).
 *  Prioridad: déficit de sueño (lo más accionable) > movimientos de Body
 *  Battery (fase 3) > HRV semanal como cierre informativo.
 *  NOTA fase 3: statusHistory NO alimenta plantillas todavía — con 1–2
 *  puntos cualquier «tendencia» de VO2max/carga sería inventada; se añadirá
 *  cuando el histórico acumule ≥14 puntos reales. */
export function insightRecuperacion(data) {
  return primera(
    [tplRecupSueno, tplRecupBbTendencia, tplRecupBb80, tplRecupHrv],
    data,
    'Recuperación sin señales de alarma — sigue cuidando el sueño.',
  );
}

/** Acto 6 · ARCHIVO (#insightArchivo). */
export function insightArchivo(data) {
  return primera(
    [tplArchivoTotales],
    data,
    'El archivo se irá llenando salida a salida.',
  );
}
