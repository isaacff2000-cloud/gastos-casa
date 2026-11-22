// Reglas de la app, sin dependencias: las usan el servidor y el móvil (este mismo archivo).
// El estado es el resultado de aplicar en orden la lista de operaciones guardadas.

/* ---------- Categorías ---------- */
// Grupos de la gráfica de Paga: 8 colores validados (web/app.css, --g0…--g7). Orden fijo.
export const GRUPOS = ['Comida', 'Restaurantes', 'Salidas y ocio', 'Transporte', 'Viajes', 'Salud y deporte', 'Casa y hogar', 'Otros'];
export const CATS = [
  { id: 'casa', nombre: 'Casa', emoji: '🏠', grupo: 6 },
  { id: 'suministros', nombre: 'Suministros', emoji: '💡', grupo: 6 },
  { id: 'compra', nombre: 'Comida', emoji: '🛒', grupo: 0 },
  { id: 'restaurante', nombre: 'Restaurantes', emoji: '🍽️', grupo: 1 },
  { id: 'salidas', nombre: 'Salidas y ocio', emoji: '🎉', grupo: 2 },
  { id: 'transporte', nombre: 'Transporte', emoji: '🚗', grupo: 3 },
  { id: 'mascotas', nombre: 'Mascotas', emoji: '🐱', grupo: 6 },
  { id: 'salud', nombre: 'Salud y deporte', emoji: '💊', grupo: 5 },
  { id: 'suscripciones', nombre: 'Suscripciones y móvil', emoji: '📱', grupo: 7 },
  { id: 'viajes', nombre: 'Viajes', emoji: '✈️', grupo: 4 },
  { id: 'otros', nombre: 'Otros', emoji: '📦', grupo: 7 },
];
const CAT_BASE = new Map(CATS.map((c) => [c.id, c]));
export const CUENTAS = ['j', 'a', 'b']; // conjunta, persona a, persona b
export const MAX_IMPORTE = 100_000_000_00; // 100 millones de euros, en céntimos

/* ---------- Dinero (siempre céntimos enteros) ---------- */
/** "1.234,56" → 123456 · "2.220" → 222000 · "12,5" → 1250 · "" → 0 · texto no válido → null */
export function aCentimos(s) {
  let t = String(s ?? '').replace(/[\s€]/g, '');
  if (t === '') return 0;
  if (t.includes(',')) t = t.replace(/\./g, '').replace(',', '.');
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, '');
  if (!/^\d+(\.\d{0,2})?$/.test(t)) return null;
  const n = Math.round(Number(t) * 100);
  return Number.isSafeInteger(n) && n <= MAX_IMPORTE ? n : null;
}
const FMT = new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' });
export const eur = (c) => FMT.format((c || 0) / 100);
export const eur0 = (c) => Math.round((c || 0) / 100).toLocaleString('es-ES') + ' €';
/** Para una casilla: 125000 → "1250", 12345 → "123,45" */
export const enCasilla = (c) => (c == null ? '' : String(c / 100).replace('.', ','));

/* ---------- Fechas: días "AAAA-MM-DD", meses "AAAA-MM" ---------- */
export const RE_MES = /^\d{4}-(0[1-9]|1[0-2])$/;
export const RE_FECHA = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const pad = (n) => String(n).padStart(2, '0');
export const hoy = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const mesDe = (f) => String(f || '').slice(0, 7);
export function sumarMes(m, n) {
  const [a, b] = m.split('-').map(Number);
  const d = new Date(a, b - 1 + n, 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}
export const diasDelMes = (m) => { const [a, b] = m.split('-').map(Number); return new Date(a, b, 0).getDate(); };
export function etiquetaMes(m) {
  const [a, b] = m.split('-').map(Number);
  return new Date(a, b - 1, 1).toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}
export const mesCorto = (m) => { const [a, b] = m.split('-').map(Number); return new Date(a, b - 1, 1).toLocaleDateString('es-ES', { month: 'short' }).replace('.', ''); };
export function etiquetaDia(f) {
  const [a, b, c] = f.split('-').map(Number);
  return new Date(a, b - 1, c).toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'short' });
}
function fechaValida(f) {
  if (!RE_FECHA.test(f || '')) return false;
  return Number(f.slice(8, 10)) <= diasDelMes(f.slice(0, 7));
}

/* ---------- Estado ---------- */
export function estadoVacio() {
  return {
    personas: { a: { nombre: null, ligada: false }, b: { nombre: null, ligada: false } },
    logins: { a: null, b: null },      // solo en el servidor (publico() lo quita)
    conceptos: {},                      // id → { id, nombre, cat, cuenta, orden, desde, hasta }
    series: {},                         // 'n:a' | 'n:b' | 'c:<concepto>' → { desde: {mes: importe}, puntual: {mes: importe} }
    gastos: {},                         // id → { id, fecha, desc, importe, paga, parte, cat, carpeta, por }
                                        //   paga: quién lo pagó (a | b); parte: % que le toca a «a» (0–100)
    pagos: {},                          // id → { id, de, importe, fecha, por }  (uno le paga al otro para saldar)
    transferencias: {},                 // id → { id, mes, de, importe, fecha, por }
    categorias: {},                     // id → { id, nombre, emoji, grupo }   (las añadidas)
    carpetas: {},                       // id → { id, nombre, emoji, cerrada }  (viajes, salidas…)
  };
}
/** Lo que puede ver el móvil: todo menos las cuentas de Tailscale. */
export function publico(e) {
  const { logins: _l, ...resto } = e;
  return structuredClone(resto);
}

/* ---------- Operaciones ---------- */
export class ErrorOp extends Error {}
const exigir = (cond, msg) => { if (!cond) throw new ErrorOp(msg); };
const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const textoOk = (s, max) => typeof s === 'string' && s.trim().length > 0 && s.trim().length <= max;
const entero = (n, min = 0) => Number.isSafeInteger(n) && n >= min && n <= MAX_IMPORTE;
const esPersona = (p) => p === 'a' || p === 'b';
const deUno = (o) => exigir(esPersona(o.por) || o.por === 'sistema', 'Antes de cambiar nada, di quién eres');
function serieOk(e, s) {
  exigir(typeof s === 'string', 'Falta qué importe se cambia');
  if (s === 'n:a' || s === 'n:b') return;
  exigir(s.startsWith('c:') && e.conceptos[s.slice(2)], 'Ese concepto no existe');
}
function catOk(e, id) { exigir(CAT_BASE.has(id) || e.categorias[id], 'Esa categoría no existe'); }
const serie = (e, s) => e.series[s] || (e.series[s] = { desde: {}, puntual: {} });

const OPS = {
  'persona.reclamar': {
    validar(e, o) {
      exigir(esPersona(o.persona), 'Persona no válida');
      exigir(!o.por, 'Ya estás dado de alta');
      exigir(!e.personas[o.persona].ligada, 'Ese hueco ya lo ha elegido otra persona');
      exigir(textoOk(o.nombre, 24), 'Escribe tu nombre (máximo 24 letras)');
    },
    aplicar(e, o) {
      e.personas[o.persona] = { nombre: o.nombre.trim(), ligada: true };
      if (o.login) e.logins[o.persona] = String(o.login).toLowerCase();
    },
  },
  'persona.renombrar': {
    validar(e, o) { exigir(esPersona(o.por), 'Antes de cambiar nada, di quién eres'); exigir(textoOk(o.nombre, 24), 'Escribe tu nombre (máximo 24 letras)'); },
    aplicar(e, o) { if (e.personas[o.por]) e.personas[o.por].nombre = o.nombre.trim(); },
  },
  // Solo desde el portátil (cli.js): nombre inicial y deshacer la unión con una cuenta.
  'persona.nombrar': {
    validar(e, o) { exigir(o.por === 'sistema', 'Solo desde el servidor'); exigir(esPersona(o.persona) && textoOk(o.nombre, 24), 'Nombre no válido'); },
    aplicar(e, o) { e.personas[o.persona].nombre = o.nombre.trim(); },
  },
  'persona.desligar': {
    validar(e, o) { exigir(o.por === 'sistema', 'Solo desde el servidor'); exigir(esPersona(o.persona), 'Persona no válida'); },
    aplicar(e, o) { e.personas[o.persona].ligada = false; e.logins[o.persona] = null; },
  },

  'concepto.guardar': {
    validar(e, o) {
      deUno(o);
      const c = o.concepto || {};
      exigir(RE_ID.test(c.id || ''), 'Identificador de concepto no válido');
      exigir(textoOk(c.nombre, 40), 'El concepto necesita un nombre (máximo 40 letras)');
      catOk(e, c.cat);
      exigir(CUENTAS.includes(c.cuenta), 'Cuenta no válida');
      if (!e.conceptos[c.id]) exigir(RE_MES.test(o.mes || ''), 'Falta desde qué mes existe');
    },
    aplicar(e, o) {
      const c = o.concepto, antes = e.conceptos[c.id];
      if (antes) Object.assign(antes, { nombre: c.nombre.trim(), cat: c.cat, cuenta: c.cuenta });
      else {
        const orden = Object.values(e.conceptos).reduce((m, x) => Math.max(m, x.orden), 0) + 1;
        e.conceptos[c.id] = { id: c.id, nombre: c.nombre.trim(), cat: c.cat, cuenta: c.cuenta, orden, desde: o.mes, hasta: null };
      }
    },
  },
  'concepto.archivar': {
    validar(e, o) { deUno(o); exigir(e.conceptos[o.concepto], 'Ese concepto no existe'); exigir(RE_MES.test(o.mes || ''), 'Mes no válido'); },
    aplicar(e, o) { if (e.conceptos[o.concepto]) e.conceptos[o.concepto].hasta = o.mes; },
  },
  'concepto.recuperar': {
    validar(e, o) { deUno(o); exigir(e.conceptos[o.concepto], 'Ese concepto no existe'); },
    aplicar(e, o) { if (e.conceptos[o.concepto]) e.conceptos[o.concepto].hasta = null; },
  },
  'concepto.reordenar': {
    validar(e, o) { deUno(o); exigir(Array.isArray(o.orden) && o.orden.length <= 500 && o.orden.every((x) => typeof x === 'string'), 'Orden no válido'); },
    aplicar(e, o) {
      const resto = Object.values(e.conceptos).filter((c) => !o.orden.includes(c.id)).sort((x, y) => x.orden - y.orden);
      let n = 1;
      for (const id of o.orden) if (e.conceptos[id]) e.conceptos[id].orden = n++;
      for (const c of resto) c.orden = n++;
    },
  },

  'valor.desde': {
    validar(e, o) { deUno(o); serieOk(e, o.serie); exigir(RE_MES.test(o.mes || ''), 'Mes no válido'); exigir(entero(o.importe), 'Importe no válido'); },
    aplicar(e, o) { const s = serie(e, o.serie); s.desde[o.mes] = o.importe; delete s.puntual[o.mes]; },
  },
  'valor.borrarDesde': {
    validar(e, o) { deUno(o); serieOk(e, o.serie); exigir(RE_MES.test(o.mes || ''), 'Mes no válido'); },
    aplicar(e, o) { const s = e.series[o.serie]; if (s) delete s.desde[o.mes]; },
  },
  'valor.puntual': {
    validar(e, o) { deUno(o); serieOk(e, o.serie); exigir(RE_MES.test(o.mes || ''), 'Mes no válido'); exigir(entero(o.importe), 'Importe no válido'); },
    aplicar(e, o) { serie(e, o.serie).puntual[o.mes] = o.importe; },
  },
  'valor.quitarPuntual': {
    validar(e, o) { deUno(o); serieOk(e, o.serie); exigir(RE_MES.test(o.mes || ''), 'Mes no válido'); },
    aplicar(e, o) { const s = e.series[o.serie]; if (s) delete s.puntual[o.mes]; },
  },

  'gasto.guardar': {
    validar(e, o) {
      deUno(o);
      const g = o.gasto || {};
      exigir(RE_ID.test(g.id || ''), 'Identificador de gasto no válido');
      exigir(fechaValida(g.fecha), 'Fecha no válida');
      exigir(entero(g.importe, 1), 'Escribe un importe mayor que 0');
      exigir(typeof g.desc === 'string' && g.desc.length <= 60, 'La descripción es demasiado larga (máximo 60)');
      exigir(esPersona(g.paga), 'Falta quién lo ha pagado');
      exigir(Number.isInteger(g.parte) && g.parte >= 0 && g.parte <= 100, 'Reparto no válido (porcentaje de 0 a 100)');
      catOk(e, g.cat);
      if (g.carpeta != null) exigir(e.carpetas && e.carpetas[g.carpeta], 'Esa carpeta no existe');
    },
    aplicar(e, o) {
      const g = o.gasto, antes = e.gastos[g.id];
      // Los gastos de antes llevaban «cuenta» (a | b | j): pagó esa persona, a medias; los de la conjunta no generan deuda
      const paga = esPersona(g.paga) ? g.paga : esPersona(g.cuenta) ? g.cuenta : 'j';
      const parte = Number.isInteger(g.parte) ? g.parte : 50;
      e.gastos[g.id] = { id: g.id, fecha: g.fecha, desc: g.desc.trim(), importe: g.importe, paga, parte, cat: g.cat, carpeta: g.carpeta || null, por: antes ? antes.por : o.por };
    },
  },
  'gasto.borrar': {
    validar(e, o) { deUno(o); exigir(e.gastos[o.gasto], 'Ese gasto ya no existe'); },
    aplicar(e, o) { delete e.gastos[o.gasto]; },
  },
  'transferencia.registrar': {
    validar(e, o) {
      deUno(o);
      const t = o.transferencia || {};
      exigir(RE_ID.test(t.id || ''), 'Identificador no válido');
      exigir(RE_MES.test(t.mes || '') && fechaValida(t.fecha), 'Fecha no válida');
      exigir(esPersona(t.de), 'Falta quién transfiere');
      // Positivo: de la persona a la conjunta. Negativo: la conjunta le devuelve.
      exigir(Number.isSafeInteger(t.importe) && t.importe !== 0 && entero(Math.abs(t.importe), 1), 'Escribe un importe distinto de 0');
    },
    aplicar(e, o) { const t = o.transferencia; e.transferencias[t.id] = { id: t.id, mes: t.mes, de: t.de, importe: t.importe, fecha: t.fecha, por: o.por }; },
  },
  'transferencia.borrar': {
    validar(e, o) { deUno(o); exigir(e.transferencias[o.transferencia], 'Esa transferencia ya no existe'); },
    aplicar(e, o) { delete e.transferencias[o.transferencia]; },
  },

  'categoria.guardar': {
    validar(e, o) {
      deUno(o);
      const c = o.categoria || {};
      exigir(RE_ID.test(c.id || '') && !CAT_BASE.has(c.id), 'Identificador de categoría no válido');
      exigir(textoOk(c.nombre, 30), 'La categoría necesita un nombre (máximo 30 letras)');
      exigir(typeof c.emoji === 'string' && c.emoji.length <= 16, 'Emoji no válido');
      exigir(Number.isInteger(c.grupo) && c.grupo >= 0 && c.grupo < GRUPOS.length, 'Grupo no válido');
      const n = norm(c.nombre);
      exigir(!categorias(e).some((x) => x.id !== c.id && norm(x.nombre) === n), `Ya hay una categoría llamada «${c.nombre.trim()}»`);
    },
    aplicar(e, o) { const c = o.categoria; e.categorias[c.id] = { id: c.id, nombre: c.nombre.trim(), emoji: c.emoji || '🏷️', grupo: c.grupo }; },
  },
  'categoria.borrar': {
    validar(e, o) {
      deUno(o);
      exigir(e.categorias[o.categoria], 'Esa categoría no se puede borrar');
      const usada = Object.values(e.gastos).some((g) => g.cat === o.categoria) || Object.values(e.conceptos).some((c) => c.cat === o.categoria);
      exigir(!usada, 'Esa categoría está en uso: cambia antes los gastos o conceptos que la usan');
    },
    aplicar(e, o) { delete e.categorias[o.categoria]; },
  },

  'pago.registrar': {
    validar(e, o) {
      deUno(o);
      const p = o.pago || {};
      exigir(RE_ID.test(p.id || ''), 'Identificador no válido');
      exigir(esPersona(p.de), 'Falta quién paga');
      exigir(entero(p.importe, 1), 'Escribe un importe mayor que 0');
      exigir(fechaValida(p.fecha), 'Fecha no válida');
    },
    aplicar(e, o) { const p = o.pago; (e.pagos || (e.pagos = {}))[p.id] = { id: p.id, de: p.de, importe: p.importe, fecha: p.fecha, por: o.por }; },
  },
  'pago.borrar': {
    validar(e, o) { deUno(o); exigir(e.pagos && e.pagos[o.pago], 'Ese pago ya no existe'); },
    aplicar(e, o) { if (e.pagos) delete e.pagos[o.pago]; },
  },

  'carpeta.guardar': {
    validar(e, o) {
      deUno(o);
      const c = o.carpeta || {};
      exigir(RE_ID.test(c.id || ''), 'Identificador de carpeta no válido');
      exigir(textoOk(c.nombre, 40), 'La carpeta necesita un nombre (máximo 40 letras)');
      exigir(c.emoji == null || (typeof c.emoji === 'string' && c.emoji.length <= 16), 'Emoji no válido');
      const n = norm(c.nombre);
      exigir(!Object.values(e.carpetas || {}).some((x) => x.id !== c.id && norm(x.nombre) === n), `Ya hay una carpeta llamada «${c.nombre.trim()}»`);
    },
    aplicar(e, o) {
      const c = o.carpeta, antes = (e.carpetas || (e.carpetas = {}))[c.id];
      e.carpetas[c.id] = { id: c.id, nombre: c.nombre.trim(), emoji: (c.emoji || '').trim() || '📁', cerrada: antes ? antes.cerrada : false };
    },
  },
  'carpeta.cerrar': {
    validar(e, o) { deUno(o); exigir(e.carpetas && e.carpetas[o.carpeta], 'Esa carpeta no existe'); },
    aplicar(e, o) { if (e.carpetas && e.carpetas[o.carpeta]) e.carpetas[o.carpeta].cerrada = o.cerrada !== false; },
  },
  'carpeta.borrar': {
    validar(e, o) {
      deUno(o);
      exigir(e.carpetas && e.carpetas[o.carpeta], 'Esa carpeta no existe');
      exigir(!Object.values(e.gastos).some((g) => g.carpeta === o.carpeta), 'La carpeta tiene gastos: ciérrala en lugar de borrarla');
    },
    aplicar(e, o) { if (e.carpetas) delete e.carpetas[o.carpeta]; },
  },
};
export const TIPOS = Object.keys(OPS);

/** Lanza ErrorOp con un mensaje para la persona si la operación no se puede hacer. */
export function validarOp(e, o) {
  const d = OPS[o && o.tipo];
  exigir(d, `Operación desconocida: ${o && o.tipo}`);
  d.validar(e, o);
}
/** Aplica una operación ya validada. Nunca debe romper al reproducir el historial. */
export function aplicarOp(e, o) {
  const d = OPS[o && o.tipo];
  if (d) d.aplicar(e, o);
}

/* ---------- Consultas ---------- */
export const norm = (x) => String(x || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
export const categorias = (e) => [...CATS, ...Object.values(e.categorias || {}).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'))];
export function catDe(e, id) {
  return CAT_BASE.get(id) || (e.categorias && e.categorias[id]) || { id, nombre: 'Otros', emoji: '📦', grupo: 7 };
}
export const grupoDe = (e, id) => catDe(e, id).grupo;
export const nombre = (e, p) => (e.personas[p] && e.personas[p].nombre) || (p === 'a' ? 'Persona 1' : 'Persona 2');
export const nombreCuenta = (e, c) => (c === 'j' ? 'Cuenta conjunta' : 'Cuenta de ' + nombre(e, c));

/**
 * Importe de una serie en un mes: el cambio puntual de ese mes, o si no el último «desde» anterior o igual.
 * tipo: 'puntual' | 'propio' (se puso en este mes) | 'heredado' | null (sin datos)
 */
export function importe(e, s, mes) {
  const x = e.series[s];
  if (!x) return { v: null, tipo: null, base: null };
  let k = null;
  for (const m in x.desde) if (m <= mes && (k === null || m > k)) k = m;
  const base = k === null ? null : x.desde[k];
  if (mes in x.puntual) return { v: x.puntual[mes], tipo: 'puntual', base };
  return { v: base, tipo: k === null ? null : k === mes ? 'propio' : 'heredado', base };
}

export const activo = (c, mes) => (!c.desde || mes >= c.desde) && (!c.hasta || mes < c.hasta);
export const conceptosDelMes = (e, mes) => Object.values(e.conceptos).filter((c) => activo(c, mes)).sort((x, y) => x.orden - y.orden);
export const conceptosQuitados = (e, mes) => Object.values(e.conceptos).filter((c) => c.hasta && c.hasta <= mes).sort((x, y) => x.orden - y.orden);
const porFecha = (x, y) => y.fecha.localeCompare(x.fecha) || y.id.localeCompare(x.id);
export const gastosDelMes = (e, mes) => Object.values(e.gastos).filter((g) => mesDe(g.fecha) === mes).sort(porFecha);
export const transferenciasDelMes = (e, mes) => Object.values(e.transferencias).filter((t) => t.mes === mes).sort(porFecha);

/**
 * Cuadre del mes (misma fórmula que el Excel): se pagan las nóminas y los gastos fijos y lo que sobra se
 * reparte a partes iguales, de forma que los dos acaban con el mismo saldo libre. Los gastos sueltos no
 * entran aquí: cada uno dice quién lo pagó y cómo se reparte, y generan deudas entre los dos (saldo()).
 * borrador: { serie: céntimos } para recalcular mientras se escribe.
 */
function cuadreMes(e, mes, borrador = {}) {
  const val = (s) => (s in borrador ? borrador[s] : importe(e, s, mes).v) || 0;
  const inc = { a: val('n:a'), b: val('n:b') };
  const fijos = conceptosDelMes(e, mes).map((c) => ({ concepto: c, importe: val('c:' + c.id), cuenta: c.cuenta, cat: c.cat }));
  const sueltos = gastosDelMes(e, mes); // solo informativo: los gastos sueltos van aparte, como deudas entre los dos
  let E = 0;
  const P = { a: 0, b: 0 };
  for (const x of fijos) {
    E += x.importe;
    if (x.cuenta === 'a' || x.cuenta === 'b') P[x.cuenta] += x.importe;
  }
  const F = inc.a + inc.b - E;
  const ta = Math.round(inc.a - F / 2 - P.a);
  const t = { a: ta, b: E - P.a - P.b - ta };
  const hecho = { a: 0, b: 0 };
  for (const x of transferenciasDelMes(e, mes)) hecho[x.de] += x.importe;
  const dejar = { a: inc.a - t.a, b: inc.b - t.b };
  return {
    mes, inc, fijos, sueltos, E, P, F, t, hecho, dejar,
    libre: { a: dejar.a - P.a, b: dejar.b - P.b },
    hay: inc.a + inc.b > 0,
    totalFijos: fijos.reduce((s, x) => s + x.importe, 0),
    totalSueltos: sueltos.reduce((s, x) => s + x.importe, 0),
  };
}

/** Primer mes con algún dato (importe, gasto o transferencia). */
export function primerMes(e) {
  let m = null;
  const ver = (k) => { if (RE_MES.test(k) && (m === null || k < m)) m = k; };
  for (const s of Object.values(e.series)) { for (const k in s.desde) ver(k); for (const k in s.puntual) ver(k); }
  for (const g of Object.values(e.gastos)) ver(mesDe(g.fecha));
  for (const t of Object.values(e.transferencias)) ver(t.mes);
  return m;
}

/**
 * Lo que cada uno arrastra de los meses anteriores: lo que le tocaba transferir y no transfirió
 * (positivo) o lo que transfirió de más (negativo). Los meses sin nóminas no generan deuda,
 * pero sus transferencias sí cuentan.
 */
export function arrastre(e, mes) {
  const r = { a: 0, b: 0 };
  let m = primerMes(e);
  for (let n = 0; m && m < mes && n < 600; n++, m = sumarMes(m, 1)) {
    const c = cuadreMes(e, m);
    for (const p of ['a', 'b']) r[p] += (c.hay ? c.t[p] : 0) - c.hecho[p];
  }
  return r;
}

/**
 * Cuadre del mes con lo arrastrado: total = lo del mes + lo de antes; pendiente = total − lo hecho.
 * dejar y libre tienen en cuenta lo arrastrado (quien debe de antes, ese mes tiene menos libre).
 */
export function cuadre(e, mes, borrador = {}) {
  const c = cuadreMes(e, mes, borrador);
  const arr = arrastre(e, mes);
  const total = { a: c.t.a + arr.a, b: c.t.b + arr.b };
  const dejar = { a: c.inc.a - total.a, b: c.inc.b - total.b };
  return {
    ...c, arrastre: arr, total,
    pendiente: { a: total.a - c.hecho.a, b: total.b - c.hecho.b },
    dejar, libre: { a: dejar.a - c.P.a, b: dejar.b - c.P.b },
  };
}

/* ---------- Deudas entre los dos (gastos sueltos) ---------- */
/** Lo que le toca pagar a cada uno de un gasto suelto. */
export function partes(g) {
  const a = Math.round(g.importe * g.parte / 100);
  return { a, b: g.importe - a };
}
/** Deuda que crea un gasto: positivo = «b» le debe a «a»; negativo = «a» le debe a «b». */
export function deudaDe(g) {
  if (g.paga === 'a') return partes(g).b;
  if (g.paga === 'b') return -partes(g).a;
  return 0; // gastos antiguos de la cuenta conjunta
}
/** Saldo entre los dos: positivo = «b» le debe a «a». */
export function saldo(e) {
  let s = 0;
  for (const g of Object.values(e.gastos)) s += deudaDe(g);
  for (const p of Object.values(e.pagos || {})) s += p.de === 'b' ? -p.importe : p.importe;
  return s;
}
export const pagosEntreVosotros = (e) => Object.values(e.pagos || {}).sort(porFecha);
/** Texto del reparto: «a medias», «70 % / 30 %», «todo para Ana»… */
export function textoReparto(e, g) {
  if (g.paga === 'j') return 'cuenta conjunta';
  if (g.parte === 50) return 'a medias';
  if (g.parte === 100) return 'todo para ' + nombre(e, 'a');
  if (g.parte === 0) return 'todo para ' + nombre(e, 'b');
  return `${nombre(e, 'a')} ${g.parte} % · ${nombre(e, 'b')} ${100 - g.parte} %`;
}

/** Gastos de una carpeta (todas las fechas), del más reciente al más antiguo. */
export const gastosDeCarpeta = (e, id) => Object.values(e.gastos).filter((g) => g.carpeta === id).sort(porFecha);
export const carpetas = (e, { cerradas = false } = {}) => Object.values(e.carpetas || {}).filter((c) => cerradas || !c.cerrada).sort((x, y) => x.nombre.localeCompare(y.nombre, 'es'));

/** Gasto del mes por categoría, de mayor a menor: [{ cat, importe }] */
export function porCategoria(lista) {
  const m = new Map();
  for (const x of lista) if (x.importe > 0) m.set(x.cat, (m.get(x.cat) || 0) + x.importe);
  return [...m].map(([cat, importe]) => ({ cat, importe })).sort((x, y) => y.importe - x.importe);
}

/* ---------- Paga: gastos sueltos por semana o por mes ---------- */
export function semanasDelMes(mes) {
  const [a, b] = mes.split('-').map(Number), ult = diasDelMes(mes), out = [];
  let ini = 1;
  while (ini <= ult) {
    const dow = (new Date(a, b - 1, ini).getDay() + 6) % 7; // lunes = 0
    const fin = Math.min(ult, ini + 6 - dow);
    out.push({ desde: ini, hasta: fin });
    ini = fin + 1;
  }
  return out;
}
/** Periodos con el gasto suelto por grupo de color: [{ etiqueta, titulo, vals[8], items }] */
export function datosPaga(e, mes, gran) {
  const cero = () => GRUPOS.map(() => 0);
  const gastos = Object.values(e.gastos);
  const out = [];
  if (gran === 'semana') {
    for (const w of semanasDelMes(mes)) {
      out.push({ desde: w.desde, hasta: w.hasta, etiqueta: w.desde === w.hasta ? String(w.desde) : `${w.desde}–${w.hasta}`,
        titulo: w.desde === w.hasta ? `Día ${w.desde}` : `Del ${w.desde} al ${w.hasta}`, vals: cero(), items: [] });
    }
    for (const g of gastos) {
      if (mesDe(g.fecha) !== mes) continue;
      const d = Number(g.fecha.slice(8, 10)), p = out.find((x) => d >= x.desde && d <= x.hasta);
      if (p) { p.items.push(g); p.vals[grupoDe(e, g.cat)] += g.importe; }
    }
  } else {
    for (let i = 5; i >= 0; i--) { const k = sumarMes(mes, -i); out.push({ mes: k, etiqueta: mesCorto(k), titulo: etiquetaMes(k), vals: cero(), items: [] }); }
    for (const g of gastos) {
      const p = out.find((x) => x.mes === mesDe(g.fecha));
      if (p) { p.items.push(g); p.vals[grupoDe(e, g.cat)] += g.importe; }
    }
  }
  for (const p of out) p.items.sort(porFecha);
  return out;
}

/* ---------- Exportar ---------- */
export function csv(e) {
  const q = (s) => '"' + String(s ?? '').replace(/"/g, '""') + '"';
  const num = (c) => (c / 100).toFixed(2).replace('.', ',');
  const filas = [['fecha', 'tipo', 'descripcion', 'categoria', 'importe', 'cuenta o quien paga', 'carpeta', 'le toca a ' + nombre(e, 'a'), 'le toca a ' + nombre(e, 'b')].map(q).join(';')];
  const carpeta = (g) => (g.carpeta && e.carpetas && e.carpetas[g.carpeta] ? e.carpetas[g.carpeta].nombre : '');
  const meses = new Set([...Object.values(e.gastos).map((g) => mesDe(g.fecha)), ...Object.values(e.transferencias).map((t) => t.mes)]);
  for (const s of Object.values(e.series)) for (const m of [...Object.keys(s.desde), ...Object.keys(s.puntual)]) meses.add(m);
  for (const p of Object.values(e.pagos || {})) meses.add(mesDe(p.fecha));
  for (const mes of [...meses].sort()) {
    const c = cuadreMes(e, mes);
    for (const p of ['a', 'b']) if (c.inc[p]) filas.push([mes + '-01', 'nomina', 'Nómina ' + nombre(e, p), '', num(c.inc[p]), nombreCuenta(e, p)].map(q).join(';'));
    for (const f of c.fijos) if (f.importe) filas.push([mes + '-01', 'fijo', f.concepto.nombre, catDe(e, f.cat).nombre, num(f.importe), nombreCuenta(e, f.cuenta)].map(q).join(';'));
    for (const g of [...c.sueltos].reverse()) {
      const pt = g.paga === 'j' ? { a: 0, b: 0 } : partes(g);
      filas.push([g.fecha, 'gasto', g.desc, catDe(e, g.cat).nombre, num(g.importe), g.paga === 'j' ? 'Cuenta conjunta' : 'Pagó ' + nombre(e, g.paga), carpeta(g), num(pt.a), num(pt.b)].map(q).join(';'));
    }
    for (const t of transferenciasDelMes(e, mes).reverse()) {
      const texto = t.importe > 0 ? nombre(e, t.de) + ' a la conjunta' : 'La conjunta a ' + nombre(e, t.de);
      filas.push([t.fecha, 'transferencia', texto, '', num(t.importe), nombreCuenta(e, t.de), ''].map(q).join(';'));
    }
    for (const p of pagosEntreVosotros(e).filter((x) => mesDe(x.fecha) === mes).reverse()) {
      filas.push([p.fecha, 'pago entre vosotros', nombre(e, p.de) + ' paga a ' + nombre(e, p.de === 'a' ? 'b' : 'a'), '', num(p.importe), '', ''].map(q).join(';'));
    }
  }
  return filas.join('\n') + '\n';
}
