/**
 * Dashboard Running — Alejandro
 * Task 7: Data load, range filter, cards, charts.
 * Interactive features (drill-down modal, scatter, heatmap, today panel) → Task 8.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Chart.js global defaults  (dark theme)
// ─────────────────────────────────────────────────────────────────────────────
Chart.defaults.color = "#8b97a8";
Chart.defaults.font.family = "'Segoe UI', system-ui, sans-serif";
Chart.defaults.font.size = 11;
const GRID = "#222b3a";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────
const paceFmt = (s) =>
  Math.floor(s / 60) + ":" + String(Math.round(s % 60)).padStart(2, "0");

const fmtDate = (isoStr) => {
  const d = new Date(isoStr);
  return (
    String(d.getDate()).padStart(2, "0") +
    "/" +
    String(d.getMonth() + 1).padStart(2, "0")
  );
};

const fmtDatetime = (isoStr) => {
  const d = new Date(isoStr);
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  const hh = String(d.getHours()).padStart(2, "0");
  const min = String(d.getMinutes()).padStart(2, "0");
  return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
};

/** Format duration seconds → "mm:ss" or "h:mm:ss" */
const fmtDur = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.round(s % 60);
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
};

/** Format total seconds → "Xh Ym" */
const fmtTotalTime = (s) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${h}h ${m}m`;
};

/** Return "YYYY-MM" for a date string */
const ym = (dateStr) => dateStr.slice(0, 7);

/** Moving average over an array (window = n items) */
const movingAvg = (arr, n) =>
  arr.map((_, i) => {
    const window = arr.slice(Math.max(0, i - n + 1), i + 1);
    return +(window.reduce((a, v) => a + v, 0) / window.length).toFixed(2);
  });

// ─────────────────────────────────────────────────────────────────────────────
// Chart registry — keeps references so we can destroy before re-render
// ─────────────────────────────────────────────────────────────────────────────
const chartRegistry = {};

function destroyChart(id) {
  if (chartRegistry[id]) {
    chartRegistry[id].destroy();
    delete chartRegistry[id];
  }
}

function registerChart(id, instance) {
  chartRegistry[id] = instance;
  return instance;
}

// ─────────────────────────────────────────────────────────────────────────────
// Range state
// ─────────────────────────────────────────────────────────────────────────────
let rangeDays = null; // null = all

function localTodayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function cutoffStr(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function inRange(dateStr) {
  if (rangeDays === null) return true;
  return dateStr >= cutoffStr(rangeDays);
}

// ─────────────────────────────────────────────────────────────────────────────
// Module-level data stores (populated after fetch)
// ─────────────────────────────────────────────────────────────────────────────
let runs = [];
let daily = [];
let status = {};
let allActivities = [];
let runsDetail = {};
let meta = {};

// ─────────────────────────────────────────────────────────────────────────────
// Boot
// ─────────────────────────────────────────────────────────────────────────────
async function init() {
  try {
    const [runsRes, dailyRes, statusRes, allActRes, detailRes, metaRes] =
      await Promise.all([
        fetch("data/runs.json"),
        fetch("data/daily.json"),
        fetch("data/status.json"),
        fetch("data/all_activities.json"),
        fetch("data/runs_detail.json"),
        fetch("data/meta.json"),
      ]);

    [runs, daily, status, allActivities, runsDetail, meta] = await Promise.all([
      runsRes.json(),
      dailyRes.json(),
      statusRes.json(),
      allActRes.json(),
      detailRes.json(),
      metaRes.json(),
    ]);

    // Defensive sort: ensure chronological order for all range/streak logic
    runs.sort((a, b) => a.date.localeCompare(b.date));
    daily.sort((a, b) => a.date.localeCompare(b.date));

    // Header: updated timestamp
    const updatedEl = document.getElementById("updated");
    if (updatedEl && meta.updated) {
      updatedEl.textContent = fmtDatetime(meta.updated);
    }

    // Footer: date range
    const footRangeEl = document.getElementById("footRange");
    if (footRangeEl && meta.first_date) {
      footRangeEl.textContent = `${fmtDate(meta.first_date)} → hoy`;
    }

    // Wire range buttons
    document.querySelectorAll(".range-btn").forEach((btn) => {
      btn.addEventListener("click", () => {
        document
          .querySelectorAll(".range-btn")
          .forEach((b) => b.classList.remove("active"));
        btn.classList.add("active");
        const val = btn.dataset.days;
        rangeDays = val === "all" ? null : Number(val);
        renderAll();
      });
    });

    renderAll();
  } catch (err) {
    console.error("Dashboard init error:", err);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// renderAll — central re-render (called on range change)
// ─────────────────────────────────────────────────────────────────────────────
function renderAll() {
  const fRuns = runs.filter((r) => inRange(r.date));
  const fDaily = daily.filter((d) => inRange(d.date));

  renderCards(fRuns);
  renderDist(fRuns);
  renderPaceHr(fRuns);
  renderMaxHr(fRuns);
  renderMonthly(); // always uses full data
  renderEF(fRuns);
  renderHrv(fDaily);
  renderSleep(fDaily);
  renderBB(fDaily);
  renderLoad();
  renderCadence(fRuns);
  renderWeight(fDaily);
  renderRunsTable(fRuns);
  renderScatter();
  renderHeatmap();
  renderToday();
}

// ─────────────────────────────────────────────────────────────────────────────
// CARDS
// ─────────────────────────────────────────────────────────────────────────────
function renderCards(fRuns) {
  // Total km
  const totalKm = fRuns.reduce((a, r) => a + r.km, 0);
  setText("cardKm", totalKm.toFixed(1) + " km");

  // Nº carreras
  setText("cardRuns", fRuns.length);

  // Total time
  const totalSec = fRuns.reduce((a, r) => a + r.dur_s, 0);
  setText("cardTime", fmtTotalTime(totalSec));

  // VO2max (always from status snapshot)
  setText("cardVo2", status.vo2max != null ? status.vo2max.toFixed(1) : "—");

  // Streak: runs in last 28 days / 4 (use full runs list, not range-filtered)
  const runs28 = runs.filter((r) => r.date >= cutoffStr(28));
  setText("cardStreak", (runs28.length / 4).toFixed(1) + "/sem");

  // This month vs previous month (use full runs list)
  const todayStr = localTodayStr();
  const curYM = todayStr.slice(0, 7);
  const prevDate = new Date();
  prevDate.setDate(1);
  prevDate.setMonth(prevDate.getMonth() - 1);
  const prevYM =
    prevDate.getFullYear() +
    "-" +
    String(prevDate.getMonth() + 1).padStart(2, "0");

  const kmCur = runs
    .filter((r) => ym(r.date) === curYM)
    .reduce((a, r) => a + r.km, 0);
  const kmPrev = runs
    .filter((r) => ym(r.date) === prevYM)
    .reduce((a, r) => a + r.km, 0);
  setText("cardMonth", `${kmCur.toFixed(1)} vs ${kmPrev.toFixed(1)} km`);
}

function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val;
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 1: Distancia por carrera (bars + 4-run MA line)
// MA is computed on FULL runs list; then we slice/align for the filtered range.
// ─────────────────────────────────────────────────────────────────────────────
function renderDist(fRuns) {
  destroyChart("dist");
  if (!fRuns.length) return;

  // Compute MA on the full sorted runs list
  const sortedAll = [...runs].sort((a, b) => a.date.localeCompare(b.date));
  const maFull = movingAvg(sortedAll.map((r) => r.km), 4);
  // Build a map id → ma value
  const maById = {};
  sortedAll.forEach((r, i) => (maById[r.id] = maFull[i]));

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));
  const kmData = sorted.map((r) => r.km);
  const maData = sorted.map((r) => maById[r.id] ?? null);

  registerChart(
    "dist",
    new Chart(document.getElementById("dist"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "km",
            data: kmData,
            backgroundColor: "#4dd0a644",
            borderColor: "#4dd0a6",
            borderWidth: 1.5,
            borderRadius: 5,
          },
          {
            label: "media móvil (4)",
            data: maData,
            type: "line",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 0,
            tension: 0.35,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "km" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 2: Ritmo vs FC media (dual axis)
// ─────────────────────────────────────────────────────────────────────────────
function renderPaceHr(fRuns) {
  destroyChart("pacehr");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  registerChart(
    "pacehr",
    new Chart(document.getElementById("pacehr"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Ritmo (min/km)",
            data: sorted.map((r) => r.pace_s / 60),
            yAxisID: "y",
            borderColor: "#4dd0a6",
            backgroundColor: "#4dd0a622",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.3,
            fill: true,
          },
          {
            label: "FC media (ppm)",
            data: sorted.map((r) => r.hr),
            yAxisID: "y2",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.3,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                if (ctx.dataset.yAxisID === "y") {
                  return "Ritmo: " + paceFmt(ctx.parsed.y * 60) + "/km";
                }
                return "FC: " + ctx.parsed.y + " ppm";
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            reverse: true,
            grid: { color: GRID },
            title: { display: true, text: "min/km (↑ = más rápido)" },
            ticks: { callback: (v) => paceFmt(v * 60) },
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "FC ppm" },
            min: 125,
            max: 160,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 3: FC máxima por carrera + techo Z2 dashed line at 142
// ─────────────────────────────────────────────────────────────────────────────
function renderMaxHr(fRuns) {
  destroyChart("maxhr");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  registerChart(
    "maxhr",
    new Chart(document.getElementById("maxhr"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "FC máx",
            data: sorted.map((r) => r.hr_max),
            borderColor: "#f6a35b",
            backgroundColor: "#f6a35b22",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true,
          },
          {
            label: "Techo Z2 (142)",
            data: sorted.map(() => 142),
            borderColor: "#ef6b6b88",
            borderWidth: 1.5,
            borderDash: [6, 4],
            pointRadius: 0,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: GRID }, min: 130, max: 185 },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 4: Volumen mensual — ALWAYS full data (not range-filtered)
// ─────────────────────────────────────────────────────────────────────────────
function renderMonthly() {
  destroyChart("monthly");
  if (!runs.length) return;

  // Group by calendar month
  const monthMap = {};
  for (const r of runs) {
    const key = ym(r.date);
    if (!monthMap[key]) monthMap[key] = { km: 0, count: 0 };
    monthMap[key].km += r.km;
    monthMap[key].count += 1;
  }

  const keys = Object.keys(monthMap).sort();
  const MONTH_ES = [
    "Ene", "Feb", "Mar", "Abr", "May", "Jun",
    "Jul", "Ago", "Sep", "Oct", "Nov", "Dic",
  ];
  const labels = keys.map((k) => {
    const [, m] = k.split("-");
    return MONTH_ES[parseInt(m, 10) - 1];
  });

  registerChart(
    "monthly",
    new Chart(document.getElementById("monthly"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "km",
            data: keys.map((k) => +monthMap[k].km.toFixed(1)),
            backgroundColor: "#4dd0a644",
            borderColor: "#4dd0a6",
            borderWidth: 1.5,
            borderRadius: 6,
          },
          {
            label: "carreras",
            data: keys.map((k) => monthMap[k].count),
            type: "line",
            yAxisID: "y2",
            borderColor: "#e8edf4",
            borderWidth: 2,
            pointRadius: 4,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "km" },
          },
          y2: {
            position: "right",
            grid: { display: false },
            min: 0,
            max: 15,
            title: { display: true, text: "nº carreras" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 5: EF — Efficiency Factor line + linear-regression trend (Task 8)
// ─────────────────────────────────────────────────────────────────────────────
function renderEF(fRuns) {
  destroyChart("ef");
  const sorted = [...fRuns]
    .filter((r) => r.ef != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!sorted.length) return;

  const labels = sorted.map((r) => fmtDate(r.date));
  const efData = sorted.map((r) => r.ef);

  // Least-squares trend line over index
  const n = sorted.length;
  let sx = 0, sy = 0, sxx = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i; sy += efData[i];
    sxx += i * i; sxy += i * efData[i];
  }
  const denom = n * sxx - sx * sx;
  let trendData = null;
  if (denom !== 0) {
    const b = (n * sxy - sx * sy) / denom;
    const a = (sy - b * sx) / n;
    trendData = efData.map((_, i) => +(a + b * i).toFixed(4));
  }

  const datasets = [
    {
      label: "EF",
      data: efData,
      borderColor: "#4dd0a6",
      backgroundColor: "#4dd0a622",
      borderWidth: 2,
      pointRadius: 3,
      tension: 0.3,
      fill: true,
    },
  ];
  if (trendData) {
    datasets.push({
      label: "Tendencia",
      data: trendData,
      borderColor: "#f6a35b",
      borderWidth: 1.5,
      borderDash: [5, 4],
      pointRadius: 0,
      tension: 0,
    });
  }

  registerChart(
    "ef",
    new Chart(document.getElementById("ef"), {
      type: "line",
      data: { labels, datasets },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const r = sorted[ctx.dataIndex];
                if (ctx.dataset.label === "EF") {
                  return `EF: ${ctx.parsed.y.toFixed(2)} · ${fmtDate(r.date)}`;
                }
                return `Tendencia: ${ctx.parsed.y.toFixed(3)}`;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "EF (velocidad/FC)" },
            min: 0.6,
            max: 0.9,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 6: Sueño nocturno (score bars + sleep_hours line + rem_pct)
// ─────────────────────────────────────────────────────────────────────────────
function renderSleep(fDaily) {
  destroyChart("sleep");

  const data = fDaily
    .filter((d) => d.sleep_score != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));

  // Bar color by score
  const barColors = data.map((d) => {
    if (d.sleep_score < 50) return "#ef6b6b";
    if (d.sleep_score < 70) return "#f6a35b";
    return "#4dd0a6";
  });

  // Party nights get distinct border
  const borderColors = data.map((d) =>
    d.party ? "#b86bef" : "transparent"
  );
  const borderWidths = data.map((d) => (d.party ? 2 : 0));

  registerChart(
    "sleep",
    new Chart(document.getElementById("sleep"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Score sueño",
            data: data.map((d) => d.sleep_score),
            backgroundColor: barColors,
            borderColor: borderColors,
            borderWidth: borderWidths,
            yAxisID: "y",
          },
          {
            label: "Horas sueño",
            data: data.map((d) => d.sleep_hours),
            type: "line",
            yAxisID: "y2",
            borderColor: "#5b9cf6",
            borderWidth: 2,
            pointRadius: 1.5,
            tension: 0.3,
          },
          {
            label: "REM %",
            data: data.map((d) => d.rem_pct),
            type: "line",
            yAxisID: "y3",
            borderColor: "#b86bef55",
            borderWidth: 1.5,
            pointRadius: 0,
            tension: 0.3,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => {
                const d = data[ctx.dataIndex];
                const suffix = d.party ? " 🍺 fiesta" : "";
                return ctx.dataset.label + ": " + ctx.parsed.y + suffix;
              },
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Score" },
            min: 0,
            max: 100,
          },
          y2: {
            position: "right",
            grid: { display: false },
            title: { display: true, text: "Horas" },
            min: 0,
            max: 12,
          },
          y3: {
            display: false,
            grid: { display: false },
            min: 0,
            max: 40,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 7: HRV + baseline band
// Band drawn via a custom plugin that fills a rect between balancedLow / balancedUpper.
// ─────────────────────────────────────────────────────────────────────────────
function renderHrv(fDaily) {
  destroyChart("hrv");

  const data = fDaily
    .filter((d) => d.hrv != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));
  const low = status.hrv_baseline?.balancedLow ?? 45;
  const upper = status.hrv_baseline?.balancedUpper ?? 83;

  // Custom plugin: draws a translucent band between low and upper
  const bandPlugin = {
    id: "hrvBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(upper);
      const yBot = yScale.getPixelForValue(low);
      ctx.save();
      ctx.fillStyle = "rgba(91, 156, 246, 0.10)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      // border lines
      ctx.strokeStyle = "rgba(91, 156, 246, 0.30)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "hrv",
    new Chart(document.getElementById("hrv"), {
      type: "line",
      plugins: [bandPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "HRV (ms)",
            data: data.map((d) => d.hrv),
            borderColor: "#4dd0a6",
            backgroundColor: "#4dd0a618",
            borderWidth: 2,
            pointRadius: 2.5,
            tension: 0.35,
            fill: true,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: { mode: "index", intersect: false },
        },
        scales: {
          x: { grid: { display: false } },
          y: { grid: { color: GRID }, title: { display: true, text: "ms" } },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 8: Body Battery (charged/drained paired bars)
// ─────────────────────────────────────────────────────────────────────────────
function renderBB(fDaily) {
  destroyChart("bb");

  const data = fDaily
    .filter((d) => d.bb_charged != null || d.bb_drained != null)
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!data.length) return;

  const labels = data.map((d) => fmtDate(d.date));

  registerChart(
    "bb",
    new Chart(document.getElementById("bb"), {
      type: "bar",
      data: {
        labels,
        datasets: [
          {
            label: "Cargado",
            data: data.map((d) => d.bb_charged),
            backgroundColor: "#4dd0a655",
            borderColor: "#4dd0a6",
            borderWidth: 1,
            borderRadius: 3,
          },
          {
            label: "Drenado",
            data: data.map((d) => d.bb_drained),
            backgroundColor: "#ef6b6b44",
            borderColor: "#ef6b6b",
            borderWidth: 1,
            borderRadius: 3,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Battery points" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 9: Carga de entrenamiento
// status.json is a current snapshot — no history.
// Render 2 bars (Aguda / Crónica) + band plugin for optimal range.
// ─────────────────────────────────────────────────────────────────────────────
function renderLoad() {
  destroyChart("load");

  const acute = status.acute_load ?? 0;
  const chronic = status.chronic_load ?? 0;
  const optMin = status.optimal_min ?? 0;
  const optMax = status.optimal_max ?? 0;

  const bandPlugin = {
    id: "loadBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(optMax);
      const yBot = yScale.getPixelForValue(optMin);
      ctx.save();
      ctx.fillStyle = "rgba(77, 208, 166, 0.10)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      ctx.strokeStyle = "rgba(77, 208, 166, 0.30)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "load",
    new Chart(document.getElementById("load"), {
      type: "bar",
      plugins: [bandPlugin],
      data: {
        labels: ["Aguda (7d)", "Crónica (28d)"],
        datasets: [
          {
            label: "Carga",
            data: [acute, chronic],
            backgroundColor: ["#f6a35b88", "#5b9cf688"],
            borderColor: ["#f6a35b", "#5b9cf6"],
            borderWidth: 1.5,
            borderRadius: 6,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              afterLabel: () => `Rango óptimo: ${optMin.toFixed(0)}–${optMax.toFixed(0)}`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "Carga (snapshot actual)" },
            min: 0,
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 10: Cadencia + target band 160–165
// ─────────────────────────────────────────────────────────────────────────────
function renderCadence(fRuns) {
  destroyChart("cadence");
  if (!fRuns.length) return;

  const sorted = [...fRuns].sort((a, b) => a.date.localeCompare(b.date));
  const labels = sorted.map((r) => fmtDate(r.date));

  const bandPlugin = {
    id: "cadenceBand",
    beforeDraw(chart) {
      const { ctx, chartArea, scales } = chart;
      if (!chartArea) return;
      const yScale = scales.y;
      const yTop = yScale.getPixelForValue(165);
      const yBot = yScale.getPixelForValue(160);
      ctx.save();
      ctx.fillStyle = "rgba(246, 163, 91, 0.12)";
      ctx.fillRect(chartArea.left, yTop, chartArea.width, yBot - yTop);
      ctx.strokeStyle = "rgba(246, 163, 91, 0.35)";
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yTop);
      ctx.lineTo(chartArea.right, yTop);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(chartArea.left, yBot);
      ctx.lineTo(chartArea.right, yBot);
      ctx.stroke();
      ctx.restore();
    },
  };

  registerChart(
    "cadence",
    new Chart(document.getElementById("cadence"), {
      type: "line",
      plugins: [bandPlugin],
      data: {
        labels,
        datasets: [
          {
            label: "Cadencia (spm)",
            data: sorted.map((r) => r.cadence),
            borderColor: "#f6a35b",
            backgroundColor: "#f6a35b22",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: false,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: true },
          tooltip: {
            callbacks: {
              label: (ctx) => `Cadencia: ${ctx.parsed.y} spm`,
            },
          },
        },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "spm" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// CHART 11: Peso corporal
// Hide weightCard if fewer than 2 data points.
// ─────────────────────────────────────────────────────────────────────────────
function renderWeight(fDaily) {
  destroyChart("weight");

  const data = fDaily
    .filter((d) => d.weight_kg != null)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (data.length < 2) {
    const wCard = document.getElementById("weightCard");
    if (wCard) wCard.style.display = "none";
    return;
  }

  const labels = data.map((d) => fmtDate(d.date));

  registerChart(
    "weight",
    new Chart(document.getElementById("weight"), {
      type: "line",
      data: {
        labels,
        datasets: [
          {
            label: "Peso (kg)",
            data: data.map((d) => d.weight_kg),
            borderColor: "#5b9cf6",
            backgroundColor: "#5b9cf622",
            borderWidth: 2,
            pointRadius: 3,
            tension: 0.3,
            fill: true,
          },
        ],
      },
      options: {
        plugins: { legend: { display: true } },
        scales: {
          x: { grid: { display: false } },
          y: {
            grid: { color: GRID },
            title: { display: true, text: "kg" },
          },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// RUNS TABLE — last 10 filtered runs, newest first
// ─────────────────────────────────────────────────────────────────────────────
function renderRunsTable(fRuns) {
  const tbody = document.querySelector("#runsTable tbody");
  if (!tbody) return;
  tbody.innerHTML = "";

  const sorted = [...fRuns]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 10);

  for (const r of sorted) {
    const tr = document.createElement("tr");
    tr.dataset.id = r.id;
    tr.style.cursor = "pointer";
    tr.addEventListener("click", () => openRunModal(r.id));

    const cells = [
      fmtDate(r.date),
      r.km.toFixed(2),
      fmtDur(r.dur_s),
      paceFmt(r.pace_s) + "/km",
      r.hr != null ? Math.round(r.hr) : "—",
      r.hr_max != null ? Math.round(r.hr_max) : "—",
      r.cadence != null ? r.cadence : "—",
      r.ef != null ? r.ef.toFixed(2) : "—",
      r.temp_c != null ? r.temp_c + "°" : "—",
    ];

    for (const cell of cells) {
      const td = document.createElement("td");
      td.textContent = cell;
      tr.appendChild(td);
    }

    tbody.appendChild(tr);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// openRunModal — drill-down modal for individual run (Task 8)
// ─────────────────────────────────────────────────────────────────────────────
function openRunModal(id) {
  const strId = String(id);
  const run = runs.find((r) => String(r.id) === strId);
  const detail = runsDetail[strId] || {};
  const modal = document.getElementById("modal");
  const body = document.getElementById("modalBody");
  if (!modal || !body) return;

  // ── Format bedtime decimal → "HH:MM" ──────────────────────────────────────
  function fmtBedtime(dec) {
    if (dec == null) return "—";
    // decimal hours (e.g. 1.25 → "01:15", 23.5 → "23:30")
    const h = Math.floor(dec);
    const m = Math.round((dec - h) * 60);
    return String(h).padStart(2, "0") + ":" + String(m).padStart(2, "0");
  }

  // ── Zone colours Z1→Z5 ────────────────────────────────────────────────────
  const ZONE_COLORS = ["#8b97a8", "#4dd0a6", "#f6a35b", "#ef6b6b", "#b86bef"];
  const ZONE_LABELS = ["Z1", "Z2", "Z3", "Z4", "Z5"];

  // ── Build HTML ─────────────────────────────────────────────────────────────
  let html = "";

  // Title
  html += `<h3>${fmtDate(run.date)} · ${run.km.toFixed(2)} km · ${fmtDur(run.dur_s)}</h3>`;

  // Splits table
  if (detail.splits && detail.splits.length) {
    html += `<table class="splits-table">
      <thead><tr><th>Km</th><th>Ritmo</th><th>FC</th><th>Cad</th><th>Desnivel</th></tr></thead>
      <tbody>`;
    detail.splits.forEach((s, i) => {
      const pace = s.dur_s && s.km ? paceFmt(s.dur_s / s.km) + "/km" : "—";
      const hr = s.hr != null ? Math.round(s.hr) : "—";
      const cad = s.cadence != null ? s.cadence : "—";
      const elev = (s.elev_gain != null || s.elev_loss != null)
        ? `+${(s.elev_gain || 0).toFixed(0)}/-${(s.elev_loss || 0).toFixed(0)} m`
        : "—";
      html += `<tr><td>${i + 1}</td><td>${pace}</td><td>${hr}</td><td>${cad}</td><td>${elev}</td></tr>`;
    });
    html += `</tbody></table>`;
  }

  // HR zones (horizontal CSS bars)
  if (detail.zones && detail.zones.length) {
    const totalSecs = detail.zones.reduce((a, z) => a + z.secs, 0) || 1;
    html += `<div style="margin:16px 0"><strong style="font-size:13px;color:var(--mut)">ZONAS FC</strong>`;
    for (const z of detail.zones) {
      const pct = ((z.secs / totalSecs) * 100).toFixed(1);
      const mins = Math.floor(z.secs / 60);
      const secs = z.secs % 60;
      const label = ZONE_LABELS[z.zone - 1] || `Z${z.zone}`;
      const color = ZONE_COLORS[z.zone - 1] || "#8b97a8";
      const timeStr = `${mins}:${String(secs).padStart(2, "0")} min`;
      html += `<div style="margin:6px 0">
        <div style="display:flex;justify-content:space-between;font-size:11px;margin-bottom:2px">
          <span style="color:${color}">${label} (≥${z.low} ppm)</span>
          <span style="color:var(--mut)">${timeStr}</span>
        </div>
        <div style="background:var(--card2);border-radius:3px;height:8px;overflow:hidden">
          <div style="background:${color};width:${pct}%;height:100%;border-radius:3px"></div>
        </div>
      </div>`;
    }
    html += `</div>`;
  }

  // Weather
  if (detail.weather) {
    const w = detail.weather;
    html += `<div style="margin:12px 0;font-size:13px;color:var(--mut)">
      <strong style="color:var(--txt)">Clima</strong>:
      ${w.temp_c != null ? w.temp_c + "°C" : ""}
      ${w.humidity != null ? "· " + w.humidity + "% humedad" : ""}
    </div>`;
  }

  // Sleep / noche anterior
  html += `<div style="margin:16px 0"><strong style="font-size:13px;color:var(--mut)">NOCHE ANTERIOR</strong>
    <div class="detail-grid" style="margin-top:8px">`;

  const sleepFields = [
    ["Score sueño", run.sleep_score_prev],
    ["Horas sueño", run.sleep_hours_prev != null ? run.sleep_hours_prev + " h" : null],
    ["REM", run.rem_pct_prev != null ? run.rem_pct_prev + "%" : null],
    ["Acostarse", fmtBedtime(run.bedtime_prev)],
    ["HRV matinal", run.hrv_morning != null ? run.hrv_morning + " ms" : null],
  ];
  for (const [label, val] of sleepFields) {
    html += `<div class="detail-item">
      <div class="dl">${label}</div>
      <div class="dv">${val != null ? val : "—"}</div>
    </div>`;
  }
  html += `</div></div>`;

  body.innerHTML = html;
  modal.classList.remove("hidden");

  // Close handlers
  const onKey = (e) => { if (e.key === "Escape") closeModal(); };
  const closeModal = () => {
    document.removeEventListener("keydown", onKey);
    modal.classList.add("hidden");
  };
  document.getElementById("modalClose").onclick = closeModal;
  modal.onclick = (e) => { if (e.target === modal) closeModal(); };
  document.addEventListener("keydown", onKey);
}

// ─────────────────────────────────────────────────────────────────────────────
// linreg helper
// ─────────────────────────────────────────────────────────────────────────────
function linreg(pts) {
  const n = pts.length;
  const sx = pts.reduce((a, p) => a + p.x, 0);
  const sy = pts.reduce((a, p) => a + p.y, 0);
  const sxy = pts.reduce((a, p) => a + p.x * p.y, 0);
  const sxx = pts.reduce((a, p) => a + p.x * p.x, 0);
  const syy = pts.reduce((a, p) => a + p.y * p.y, 0);
  const b = (n * sxy - sx * sy) / (n * sxx - sx * sx);
  const a = (sy - b * sx) / n;
  const r = (n * sxy - sx * sy) / Math.sqrt((n * sxx - sx * sx) * (n * syy - sy * sy));
  return { a, b, r2: r * r };
}

// ─────────────────────────────────────────────────────────────────────────────
// renderScatter — correlation explorer (Task 8)
// ─────────────────────────────────────────────────────────────────────────────
let _scatterSelectsPopulated = false;

const SCATTER_VARS = [
  { label: "Temperatura °C",        key: "temp_c" },
  { label: "Hora de salida",         key: "start_hour" },
  { label: "Horas sueño (noche previa)", key: "sleep_hours_prev" },
  { label: "Score sueño",            key: "sleep_score_prev" },
  { label: "REM %",                  key: "rem_pct_prev" },
  { label: "Hora acostarse",         key: "bedtime_prev" },
  { label: "HRV matinal",            key: "hrv_morning" },
  { label: "FC media",               key: "hr" },
  { label: "Ritmo (s/km)",           key: "pace_s" },
  { label: "EF",                     key: "ef" },
  { label: "Km",                     key: "km" },
];

function renderScatter(xKey, yKey, isBedtimePreset) {
  const selX = document.getElementById("scatterX");
  const selY = document.getElementById("scatterY");
  if (!selX || !selY) return;

  // Populate selects once
  if (!_scatterSelectsPopulated) {
    SCATTER_VARS.forEach((v) => {
      const ox = document.createElement("option");
      ox.value = v.key; ox.textContent = v.label;
      selX.appendChild(ox);
      const oy = document.createElement("option");
      oy.value = v.key; oy.textContent = v.label;
      selY.appendChild(oy);
    });
    // Defaults: X=temp_c, Y=hr
    selX.value = "temp_c";
    selY.value = "hr";
    _scatterSelectsPopulated = true;

    // Wire change events
    selX.addEventListener("change", () => renderScatter());
    selY.addEventListener("change", () => renderScatter());

    // Wire preset buttons
    document.querySelectorAll(".preset[data-preset]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const p = btn.dataset.preset;
        if (p === "heat") {
          selX.value = "temp_c"; selY.value = "hr";
          renderScatter("temp_c", "hr", false);
        } else if (p === "sleep") {
          selX.value = "sleep_score_prev"; selY.value = "ef";
          renderScatter("sleep_score_prev", "ef", false);
        } else if (p === "bedtime") {
          renderScatter("bedtime", "sleep_score", true);
        }
      });
    });
  }

  const usedXKey = xKey || selX.value;
  const usedYKey = yKey || selY.value;
  const r2El = document.getElementById("scatterR2");

  let pts;
  if (isBedtimePreset) {
    // Special case: use dailies — (bedtime, sleep_score)
    const fDaily = daily.filter((d) => inRange(d.date));
    pts = fDaily
      .filter((d) => d.bedtime != null && d.sleep_score != null)
      .map((d) => ({ x: d.bedtime, y: d.sleep_score }));
  } else {
    const fRuns = runs.filter((r) => inRange(r.date));
    pts = fRuns
      .filter((r) => r[usedXKey] != null && r[usedYKey] != null)
      .map((r) => ({ x: r[usedXKey], y: r[usedYKey] }));
  }

  destroyChart("scatter");

  if (pts.length < 3) {
    if (r2El) r2El.textContent = "datos insuficientes";
    return;
  }

  // Linear regression
  const reg = linreg(pts);
  const xVals = pts.map((p) => p.x);
  const xMin = Math.min(...xVals);
  const xMax = Math.max(...xVals);
  const trendPts = [
    { x: xMin, y: reg.a + reg.b * xMin },
    { x: xMax, y: reg.a + reg.b * xMax },
  ];

  if (r2El) r2El.textContent = `R² = ${reg.r2.toFixed(2)} · n=${pts.length}`;

  registerChart(
    "scatter",
    new Chart(document.getElementById("scatter"), {
      type: "scatter",
      data: {
        datasets: [
          {
            label: "datos",
            data: pts,
            backgroundColor: "#4dd0a688",
            pointRadius: 5,
          },
          {
            label: "tendencia",
            data: trendPts,
            type: "line",
            borderColor: "#f6a35b",
            borderWidth: 1.5,
            borderDash: [5, 4],
            pointRadius: 0,
            tension: 0,
          },
        ],
      },
      options: {
        plugins: {
          legend: { display: false },
          tooltip: {
            callbacks: {
              label: (ctx) => `(${ctx.parsed.x.toFixed(2)}, ${ctx.parsed.y.toFixed(2)})`,
            },
          },
        },
        scales: {
          x: { grid: { color: GRID }, title: { display: true, text: isBedtimePreset ? "Hora acostarse" : (SCATTER_VARS.find((v) => v.key === usedXKey) || {}).label || usedXKey } },
          y: { grid: { color: GRID }, title: { display: true, text: isBedtimePreset ? "Score sueño" : (SCATTER_VARS.find((v) => v.key === usedYKey) || {}).label || usedYKey } },
        },
      },
    })
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// renderHeatmap — GitHub-style activity calendar (Task 8)
// Uses full allActivities (no range filter), from meta.first_date to today.
// ─────────────────────────────────────────────────────────────────────────────
function renderHeatmap() {
  const container = document.getElementById("heatmap");
  if (!container) return;
  container.innerHTML = "";

  let firstDate;
  if (meta.first_date) {
    const [y, m, dd] = meta.first_date.split("-").map(Number);
    firstDate = new Date(y, m - 1, dd);
  } else {
    firstDate = new Date();
  }
  const today = new Date();

  // Build day→activity map
  // { dateStr: { km: number, type: 'running'|'other', ids: [] } }
  const dayMap = {};
  for (const act of allActivities) {
    const ds = act.date;
    if (!dayMap[ds]) dayMap[ds] = { km: 0, types: new Set(), ids: [] };
    if (act.type === "running" && act.km) dayMap[ds].km += act.km;
    dayMap[ds].types.add(act.type);
    if (act.type === "running" && act.id) dayMap[ds].ids.push(act.id);
  }

  // Determine start (Monday of first week) and end (Sunday of last week)
  // We'll show from Monday of the week containing firstDate to today
  const startMonday = new Date(firstDate);
  // getDay(): 0=Sun, 1=Mon ... 6=Sat → offset to Monday
  const dow = startMonday.getDay(); // 0=Sun
  const offsetToMon = dow === 0 ? -6 : 1 - dow;
  startMonday.setDate(startMonday.getDate() + offsetToMon);

  // Build array of ISO weeks (each week = [Mon..Sun] dates)
  const weeks = [];
  const cur = new Date(startMonday);
  while (cur <= today) {
    const week = [];
    for (let d = 0; d < 7; d++) {
      week.push(new Date(cur));
      cur.setDate(cur.getDate() + 1);
    }
    weeks.push(week);
  }

  // Month label row
  // We need one <div class="hm-row"> for month labels, one row per weekday
  // Layout: columns = weeks, rows = Mon(0)..Sun(6)
  // We'll build a grid: first a label row (month names at first week of each month),
  // then 7 day rows.

  // Wrapper uses CSS grid (columns = number of weeks)
  const grid = document.createElement("div");
  grid.style.display = "grid";
  grid.style.gridTemplateColumns = `repeat(${weeks.length}, 16px)`;
  grid.style.gap = "3px 3px";
  grid.style.rowGap = "3px";
  grid.style.overflowX = "auto";

  // Month-label row (row 1)
  const MONTH_ES = ["Ene","Feb","Mar","Abr","May","Jun","Jul","Ago","Sep","Oct","Nov","Dic"];
  for (let wi = 0; wi < weeks.length; wi++) {
    const monDay = weeks[wi][0]; // Monday of this week
    const label = document.createElement("div");
    label.className = "hm-label";
    label.style.gridColumn = `${wi + 1}`;
    label.style.gridRow = "1";
    // Show month label only on first week of each month
    if (monDay.getDate() <= 7) {
      label.textContent = MONTH_ES[monDay.getMonth()];
    }
    grid.appendChild(label);
  }

  // Day rows (rows 2–8: Mon=2, Tue=3, ..., Sun=8)
  for (let wi = 0; wi < weeks.length; wi++) {
    for (let di = 0; di < 7; di++) {
      const day = weeks[wi][di];
      if (day > today) continue; // don't render future days

      const dayKey = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const ds = dayKey(day);
      const act = dayMap[ds];

      const cell = document.createElement("div");
      cell.className = "hm-cell";
      cell.style.gridColumn = `${wi + 1}`;
      cell.style.gridRow = `${di + 2}`;

      const ddmm = `${String(day.getDate()).padStart(2,"0")}/${String(day.getMonth()+1).padStart(2,"0")}`;

      if (act) {
        const hasRun = act.types.has("running");
        const hasOther = [...act.types].some((t) => t !== "running");
        if (hasRun) {
          if (act.km < 3) cell.classList.add("hm-run1");
          else if (act.km < 5) cell.classList.add("hm-run2");
          else cell.classList.add("hm-run3");
          cell.title = `${ddmm} · ${act.km.toFixed(1)} km`;
          // Click → open modal if exactly one run that day
          if (act.ids.length === 1) {
            cell.style.cursor = "pointer";
            const runId = act.ids[0];
            cell.addEventListener("click", () => openRunModal(runId));
          }
        } else if (hasOther) {
          cell.classList.add("hm-other");
          const firstType = [...act.types][0];
          cell.title = `${ddmm} · ${firstType}`;
        }
      }

      grid.appendChild(cell);
    }
  }

  container.appendChild(grid);
}

// ─────────────────────────────────────────────────────────────────────────────
// renderToday — semáforo / training recommendation (Task 8)
// ─────────────────────────────────────────────────────────────────────────────
function renderToday() {
  const lightEl = document.getElementById("todayLight");
  const msgEl = document.getElementById("todayMsg");
  const reasonsEl = document.getElementById("todayReasons");
  if (!lightEl || !msgEl || !reasonsEl) return;

  const today = daily[daily.length - 1] || {};
  const lastRun = runs[runs.length - 1];
  const daysSince = lastRun
    ? (() => {
        const [y2, m2, d2] = lastRun.date.split("-").map(Number);
        return Math.round((new Date().setHours(0, 0, 0, 0) - new Date(y2, m2 - 1, d2).getTime()) / 864e5);
      })()
    : 99;
  const low = (status.hrv_baseline || {}).balancedLow ?? 45;

  let color = "verde";
  let msg = "Corre hoy (Z2 suave)";
  const reasons = [];

  // Rojo conditions (highest priority)
  if (today.party) {
    color = "rojo";
    msg = "Descansa hoy";
    reasons.push("noche de fiesta detectada");
  } else if (today.hrv != null && today.hrv < low) {
    color = "rojo";
    msg = "Descansa hoy";
    reasons.push(`HRV ${today.hrv} bajo baseline (${low})`);
  } else if (today.sleep_score != null && today.sleep_score < 40) {
    color = "rojo";
    msg = "Descansa hoy";
    reasons.push(`sueño ${today.sleep_score} POOR`);
  }

  // Ámbar conditions (if not already rojo)
  if (color !== "rojo") {
    if (daysSince === 0) {
      color = "ambar";
      msg = "Ya corriste hoy — descansa";
    } else if (
      (today.sleep_score != null && today.sleep_score < 55) ||
      (today.hrv != null && today.hrv < low + 7)
    ) {
      color = "ambar";
      msg = "Suave u opcional: fuerza";
      reasons.push("recuperación a medias");
    }
  }

  // Verde bonus: hasn't run in 3+ days
  if (color === "verde" && daysSince >= 3) {
    reasons.push(`${daysSince} días sin correr — toca salir`);
  }

  // Apply to DOM
  const dot = lightEl.querySelector(".light") || lightEl;
  if (dot.classList) {
    dot.classList.remove("verde", "ambar", "rojo");
    dot.classList.add(color);
  }
  msgEl.textContent = msg;
  reasonsEl.innerHTML = "";
  for (const r of reasons) {
    const li = document.createElement("li");
    li.textContent = r;
    reasonsEl.appendChild(li);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Kick off
// ─────────────────────────────────────────────────────────────────────────────
init();
