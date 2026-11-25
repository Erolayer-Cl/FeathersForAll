// SLI de la API a partir de sus logs (una línea JSON "request" por petición, src/platform/request-context.js).
// Los SLO y cómo se leen están en Documentos/resiliencia/slos.md.
//
//   kubectl logs -n feathersforall -l app.kubernetes.io/name=ffa-api --since=24h --tail=-1 | node scripts/sli.js
//   node scripts/sli.js api.log
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import { fileURLToPath } from 'node:url';

export const SLO = {
  api: { disponibilidad: 0.995, p95Ms: 500 },
  login: { disponibilidad: 0.995, p95Ms: 1000 },
  tutor: { disponibilidad: 0.99, p95Ms: 8000 },
};

// Las sondas de Kubernetes no son tráfico de usuarios.
const SONDAS = new Set(['/livez', '/readyz', '/health']);
const TUTOR = new Set(['/v1/dev/chat', '/v1/courses/:courseId/tutor-conversations/:conversationId/messages']);

export function clasificar(route) {
  if (SONDAS.has(route)) return null;
  if (route === '/v1/auth/login') return 'login';
  if (TUTOR.has(route)) return 'tutor';
  return 'api';
}

export function percentil(valores, p) {
  if (valores.length === 0) return null;
  const orden = [...valores].sort((a, b) => a - b);
  return orden[Math.min(orden.length - 1, Math.ceil(orden.length * p) - 1)];
}

/** @param {Iterable<object>} registros líneas de log ya parseadas */
export function calcular(registros) {
  const grupos = {};
  for (const r of registros) {
    if (r?.msg !== 'request' || typeof r.status !== 'number') continue;
    const clase = clasificar(r.route);
    if (!clase) continue;
    const g = (grupos[clase] ??= { total: 0, malas: 0, limitadas: 0, cortadas: 0, duraciones: [] });
    g.total++;
    if (r.status >= 500) g.malas++;
    else if (r.status === 429) g.limitadas++; // el tope funcionando: no es una falla del servicio
    if (!r.completed) g.cortadas++; // el cliente cerró antes (o se cortó el stream del tutor)
    else if (r.status < 500) g.duraciones.push(r.duration_ms);
  }

  return Object.entries(SLO).map(([clase, slo]) => {
    const g = grupos[clase] ?? { total: 0, malas: 0, limitadas: 0, cortadas: 0, duraciones: [] };
    const disponibilidad = g.total ? 1 - g.malas / g.total : null;
    const p95 = percentil(g.duraciones, 0.95);
    // Presupuesto de error: cuánto del 0,5 % (o 1 %) permitido ya se gastó en esta ventana.
    const permitidas = g.total * (1 - slo.disponibilidad);
    return {
      clase,
      total: g.total,
      malas: g.malas,
      limitadas: g.limitadas,
      cortadas: g.cortadas,
      disponibilidad,
      p95Ms: p95,
      presupuestoUsado: g.total ? g.malas / permitidas : null,
      cumple: g.total === 0 ? null : disponibilidad >= slo.disponibilidad && p95 !== null && p95 <= slo.p95Ms,
    };
  });
}

export async function leer(entrada) {
  const registros = [];
  for await (const linea of createInterface({ input: entrada, crlfDelay: Infinity })) {
    const inicio = linea.indexOf('{');
    if (inicio === -1) continue;
    try {
      registros.push(JSON.parse(linea.slice(inicio)));
    } catch {
      // líneas que no son JSON (avisos de kubectl, etc.)
    }
  }
  return registros;
}

const pct = (v) => (v === null ? '-' : `${(v * 100).toFixed(2)} %`);

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const entrada = process.argv[2] ? createReadStream(process.argv[2]) : process.stdin;
  const filas = calcular(await leer(entrada));
  console.table(filas.map((f) => ({
    clase: f.clase,
    requests: f.total,
    'errores 5xx': f.malas,
    'topes 429': f.limitadas,
    disponibilidad: pct(f.disponibilidad),
    'objetivo disp.': pct(SLO[f.clase].disponibilidad),
    'p95 ms': f.p95Ms === null ? '-' : Math.round(f.p95Ms),
    'objetivo p95': SLO[f.clase].p95Ms,
    'presupuesto usado': pct(f.presupuestoUsado),
    cumple: f.cumple === null ? 'sin datos' : f.cumple ? 'sí' : 'NO',
  })));
}
