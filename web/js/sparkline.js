/* ==========================================================================
   sparkline.js — mini-gráfica SVG inline, sin Chart.js (§5-2.1 del spec).
   Decorativa (aria-hidden): la cifra del tile es la información accesible.
   ========================================================================== */

import { SERIES } from './helpers.js';

const NS = 'http://www.w3.org/2000/svg';

/**
 * Crea una sparkline SVG: polyline 1.5px del array + punto 2px en el último
 * valor. Los valores null/no finitos se saltan (rompen el trazo, sin
 * interpolar). Devuelve el nodo <svg> listo para `append`.
 *
 * @param {number[]} values serie a dibujar (puede contener null/NaN)
 * @param {{width?:number, height?:number, color?:string}} [opts]
 * @returns {SVGSVGElement}
 */
export function sparklineSvg(values, { width = 90, height = 24, color = SERIES.s1 } = {}) {
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('aria-hidden', 'true');

  const vals = Array.isArray(values) ? values : [];
  const finitos = vals.filter(Number.isFinite);
  if (finitos.length < 2) return svg; // sin serie suficiente: SVG vacío (hueco estable)

  const min = Math.min(...finitos);
  const max = Math.max(...finitos);
  const span = max - min || 1;               // serie plana → línea centrada
  const pad = 2;                             // que el trazo no toque el borde
  const x = (i) => pad + (i * (width - 2 * pad)) / (vals.length - 1);
  const y = (v) => height - pad - ((v - min) / span) * (height - 2 * pad);

  let d = '';
  let dibujando = false;
  let ultimo = null;                         // {i, v} del último valor válido
  vals.forEach((v, i) => {
    if (!Number.isFinite(v)) { dibujando = false; return; }
    d += `${dibujando ? 'L' : 'M'}${x(i).toFixed(1)} ${y(v).toFixed(1)} `;
    dibujando = true;
    ultimo = { i, v };
  });

  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d.trim());
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '1.5');
  path.setAttribute('stroke-linecap', 'round');
  path.setAttribute('stroke-linejoin', 'round');
  svg.appendChild(path);

  const punto = document.createElementNS(NS, 'circle');
  punto.setAttribute('cx', x(ultimo.i).toFixed(1));
  punto.setAttribute('cy', y(ultimo.v).toFixed(1));
  punto.setAttribute('r', '2');
  punto.setAttribute('fill', color);
  svg.appendChild(punto);

  return svg;
}
