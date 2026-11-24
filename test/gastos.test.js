import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { request } from 'node:http';
import * as N from '../src/nucleo.js';
import { Base } from '../src/db.js';
import { leerXlsx } from '../src/xlsx.js';
import { importar, prepararImportacion } from '../src/importar.js';
import { crearServidor } from '../src/servidor.js';
import { hacerCopias, programar } from '../src/tareas.js';

const AQUI = dirname(fileURLToPath(import.meta.url));
const XLSX = readFileSync(join(AQUI, 'fixtures/hoja.xlsx'));
const SIS = { por: 'sistema' };
const tmp = () => mkdtempSync(join(tmpdir(), 'gastos-'));

/** Base con dos personas ligadas y unos conceptos. */
function baseLista() {
  const b = new Base(':memory:');
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'uno@x' });
  b.aplicar([{ tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }], { login: 'dos@x' });
  const r = b.aplicar([
    { tipo: 'concepto.guardar', concepto: { id: 'alq', nombre: 'Alquiler', cat: 'casa', cuenta: 'j' }, mes: '2026-01' },
    { tipo: 'valor.desde', serie: 'c:alq', mes: '2026-01', importe: 100000 },
    { tipo: 'concepto.guardar', concepto: { id: 'gato', nombre: 'Gato', cat: 'mascotas', cuenta: 'a' }, mes: '2026-01' },
    { tipo: 'valor.desde', serie: 'c:gato', mes: '2026-01', importe: 5000 },
    { tipo: 'valor.desde', serie: 'n:a', mes: '2026-01', importe: 200000 },
    { tipo: 'valor.desde', serie: 'n:b', mes: '2026-01', importe: 150000 },
  ], { por: 'a' });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  return b;
}

test('importes en céntimos con el formato español', () => {
  const casos = { '1.234,56': 123456, '2.220': 222000, '12,5': 1250, '12.5': 1250, '1250': 125000, '0,07': 7, '': 0, ' 30 € ': 3000, '1.2.3': null, 'abc': null, '-5': null, '1,234': null };
  for (const [t, v] of Object.entries(casos)) assert.equal(N.aCentimos(t), v, t);
  assert.equal(N.enCasilla(12345), '123,45');
  assert.equal(N.enCasilla(null), '');
});

test('meses y semanas', () => {
  assert.equal(N.sumarMes('2026-12', 1), '2027-01');
  assert.equal(N.sumarMes('2026-01', -1), '2025-12');
  assert.equal(N.diasDelMes('2028-02'), 29);
  const s = N.semanasDelMes('2026-11'); // 1 nov 2026 es domingo
  assert.deepEqual(s[0], { desde: 1, hasta: 1 });
  assert.deepEqual(s[1], { desde: 2, hasta: 8 });
  assert.equal(s[s.length - 1].hasta, 30);
});

test('vigencias: desde un mes, heredado y solo un mes', () => {
  const b = baseLista(), e = b.e;
  assert.deepEqual(N.importe(e, 'c:alq', '2025-12'), { v: null, tipo: null, base: null });
  assert.equal(N.importe(e, 'c:alq', '2026-01').tipo, 'propio');
  assert.deepEqual(N.importe(e, 'c:alq', '2026-07'), { v: 100000, tipo: 'heredado', base: 100000 });
  b.aplicar([{ tipo: 'valor.desde', serie: 'c:alq', mes: '2026-05', importe: 110000 }], { por: 'b' });
  assert.equal(N.importe(e, 'c:alq', '2026-04').v, 100000);
  assert.equal(N.importe(e, 'c:alq', '2026-09').v, 110000);
  // Cambio puntual en agosto: no afecta a septiembre
  b.aplicar([{ tipo: 'valor.puntual', serie: 'c:alq', mes: '2026-08', importe: 0 }], { por: 'b' });
  assert.deepEqual(N.importe(e, 'c:alq', '2026-08'), { v: 0, tipo: 'puntual', base: 110000 });
  assert.equal(N.importe(e, 'c:alq', '2026-09').v, 110000);
  // Un «desde» en ese mismo mes sustituye al puntual
  b.aplicar([{ tipo: 'valor.desde', serie: 'c:alq', mes: '2026-08', importe: 120000 }], { por: 'b' });
  assert.deepEqual(N.importe(e, 'c:alq', '2026-08'), { v: 120000, tipo: 'propio', base: 120000 });
  // Un mes posterior con su propio importe lo conserva al cambiar uno anterior
  b.aplicar([{ tipo: 'valor.desde', serie: 'c:alq', mes: '2026-06', importe: 99000 }], { por: 'a' });
  assert.equal(N.importe(e, 'c:alq', '2026-07').v, 99000);
  assert.equal(N.importe(e, 'c:alq', '2026-10').v, 120000);
});

/** La fórmula de la app de Apps Script (index.html), tal cual, como referencia. */
function calcAntiguo(incA, incB, gastos) {
  let E = 0; const P = { a: 0, b: 0 };
  gastos.forEach((x) => { E += x.amount; if (x.src === 'a' || x.src === 'b') P[x.src] += x.amount; });
  const F = incA + incB - E;
  const ta = Math.round(incA - F / 2 - P.a);
  const t = { a: ta, b: (E - P.a - P.b) - ta };
  return { E, P, F, t, leave: { a: incA - t.a, b: incB - t.b } };
}

test('el cuadre da lo mismo que la app antigua (2000 meses al azar), sin contar los gastos sueltos, y el libre es igual para los dos', () => {
  let semilla = 7;
  const azar = (n) => { semilla = (semilla * 1103515245 + 12345) % 2147483648; return semilla % n; };
  for (let k = 0; k < 2000; k++) {
    const b = new Base(':memory:'), mes = '2026-03';
    const incA = azar(400000), incB = azar(400000);
    const ops = [{ tipo: 'valor.desde', serie: 'n:a', mes, importe: incA }, { tipo: 'valor.desde', serie: 'n:b', mes, importe: incB }];
    const gastos = [];
    for (let i = 0, n = azar(12); i < n; i++) {
      const src = N.CUENTAS[azar(3)], amount = azar(200000);
      gastos.push({ src, amount });
      ops.push({ tipo: 'concepto.guardar', concepto: { id: 'c' + i, nombre: 'C' + i, cat: 'casa', cuenta: src }, mes: '2026-01' });
      ops.push({ tipo: 'valor.desde', serie: 'c:c' + i, mes: '2026-02', importe: amount });
    }
    for (let i = 0, n = azar(6); i < n; i++) {
      const src = N.CUENTAS[azar(3)], amount = 1 + azar(30000);
      // Los gastos sueltos ya no entran en el reparto mensual: no se suman a la referencia
      ops.push({ tipo: 'gasto.guardar', gasto: { id: 'g' + i, fecha: '2026-03-' + String(1 + azar(28)).padStart(2, '0'), desc: '', importe: amount, paga: src === 'b' ? 'b' : 'a', parte: azar(101), cat: 'compra' } });
    }
    const r = b.aplicar(ops, SIS);
    assert.ok(r.every((x) => x.ok), JSON.stringify(r.find((x) => !x.ok)));
    const c = N.cuadre(b.e, mes), viejo = calcAntiguo(incA, incB, gastos);
    assert.equal(c.E, viejo.E);
    assert.deepEqual(c.t, viejo.t);
    assert.deepEqual(c.dejar, viejo.leave);
    assert.ok(Math.abs(c.libre.a - c.libre.b) <= 1, `libre ${c.libre.a} / ${c.libre.b}`);
    assert.equal(c.t.a + c.t.b + c.P.a + c.P.b, c.E); // la conjunta recibe justo lo que paga
  }
});

test('cuadre: borrador al escribir, transferencias y gastos sueltos', () => {
  const b = baseLista();
  const c = N.cuadre(b.e, '2026-01');
  // I = 3500, E = 1050, F = 2450, libre 1225 c/u; Uno paga el gato (50) de su cuenta
  assert.deepEqual(c.t, { a: 72500, b: 27500 });
  assert.deepEqual(c.libre, { a: 122500, b: 122500 });
  const d = N.cuadre(b.e, '2026-01', { 'n:b': 250000 });
  assert.equal(d.libre.a, 172500);
  b.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 't1', mes: '2026-01', de: 'a', importe: 50000, fecha: '2026-01-02' } },
    { tipo: 'gasto.guardar', gasto: { id: 'g1', fecha: '2026-01-10', desc: 'Cena', importe: 6000, paga: 'b', parte: 50, cat: 'restaurante' } }], { por: 'a' });
  const e = N.cuadre(b.e, '2026-01');
  assert.equal(e.pendiente.a, e.t.a - 50000);
  assert.equal(e.totalSueltos, 6000);  // se ven en el mes…
  assert.equal(e.P.b, 0);              // …pero no entran en el reparto mensual
  assert.deepEqual(e.t, c.t);
  assert.equal(b.e.gastos.g1.por, 'a');
});

test('operaciones: se validan, no se repiten y el historial se rehace igual', () => {
  const dir = tmp(), ruta = join(dir, 'g.db');
  let b = new Base(ruta);
  const r1 = b.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'Uno@X' });
  assert.ok(r1[0].ok);
  assert.equal(b.e.logins.a, 'uno@x');
  const op = { id: 'op-1', tipo: 'gasto.guardar', gasto: { id: 'g1', fecha: '2026-02-30', desc: '', importe: 100, paga: 'a', parte: 50, cat: 'compra' } };
  assert.match(b.aplicar([op], { por: 'a' })[0].error, /Fecha no válida/);
  op.gasto.fecha = '2026-02-28';
  assert.ok(b.aplicar([op], { por: 'a' })[0].ok);
  assert.deepEqual(b.aplicar([{ ...op, gasto: { ...op.gasto, importe: 999 } }], { por: 'a' })[0], { id: 'op-1', ok: true, repetida: true });
  assert.equal(b.e.gastos.g1.importe, 100);
  const malas = b.aplicar([
    { tipo: 'nada' },
    { tipo: 'gasto.guardar', gasto: { id: 'g2', fecha: '2026-02-01', desc: '', importe: 0, paga: 'a', parte: 50, cat: 'compra' } },
    { tipo: 'gasto.guardar', gasto: { id: 'g3', fecha: '2026-02-01', desc: '', importe: 5, paga: 'x', parte: 50, cat: 'compra' } },
    { tipo: 'gasto.guardar', gasto: { id: 'g4', fecha: '2026-02-01', desc: '', importe: 5, paga: 'a', parte: 50, cat: 'no-existe' } },
    { tipo: 'valor.desde', serie: 'c:nada', mes: '2026-01', importe: 5 },
    { tipo: 'valor.desde', serie: 'n:a', mes: '2026-13', importe: 5 },
    { tipo: 'valor.desde', serie: 'n:a', mes: '2026-01', importe: 1.5 },
    { tipo: 'persona.desligar', persona: 'a' },
    { tipo: 'persona.reclamar', persona: 'a', nombre: 'Otro' },
  ], { por: 'a' });
  assert.ok(malas.every((x) => !x.ok), JSON.stringify(malas));
  assert.match(b.aplicar([{ tipo: 'gasto.guardar', gasto: { id: 'g9', fecha: '2026-02-01', desc: '', importe: 5, paga: 'a', parte: 50, cat: 'compra' } }], { por: null })[0].error, /di quién eres/);
  b.aplicar([{ tipo: 'categoria.guardar', categoria: { id: 'regalos', nombre: 'Regalos', emoji: '🎁', grupo: 2 } },
    { tipo: 'gasto.guardar', gasto: { id: 'g5', fecha: '2026-02-03', desc: 'Libro', importe: 2000, paga: 'a', parte: 50, cat: 'regalos' } }], { por: 'a' });
  assert.match(b.aplicar([{ tipo: 'categoria.borrar', categoria: 'regalos' }], { por: 'a' })[0].error, /en uso/);
  assert.match(b.aplicar([{ tipo: 'categoria.guardar', categoria: { id: 'otra', nombre: 'COMIDA', emoji: '', grupo: 0 } }], { por: 'a' })[0].error, /Ya hay/);
  assert.match(b.aplicar([{ tipo: 'categoria.borrar', categoria: 'casa' }], { por: 'a' })[0].error, /no se puede/);
  assert.equal(N.grupoDe(b.e, 'regalos'), 2);
  const antes = JSON.stringify(b.e), seq = b.seq;
  b.cerrar();
  b = new Base(ruta);
  assert.equal(JSON.stringify(b.e), antes);
  assert.equal(b.seq, seq);
  b.cerrar();
});

test('conceptos: quitar desde un mes, recuperar y reordenar', () => {
  const b = baseLista();
  b.aplicar([{ tipo: 'concepto.archivar', concepto: 'gato', mes: '2026-06' }], { por: 'a' });
  assert.deepEqual(N.conceptosDelMes(b.e, '2026-05').map((c) => c.id), ['alq', 'gato']);
  assert.deepEqual(N.conceptosDelMes(b.e, '2026-06').map((c) => c.id), ['alq']);
  assert.equal(N.cuadre(b.e, '2026-06').E, 100000);
  assert.deepEqual(N.conceptosQuitados(b.e, '2026-06').map((c) => c.id), ['gato']);
  assert.equal(N.conceptosDelMes(b.e, '2025-12').length, 0); // antes de existir
  b.aplicar([{ tipo: 'concepto.recuperar', concepto: 'gato' }, { tipo: 'concepto.reordenar', orden: ['gato', 'alq'] }], { por: 'b' });
  assert.deepEqual(N.conceptosDelMes(b.e, '2026-06').map((c) => c.id), ['gato', 'alq']);
});

test('importa la hoja antigua: conceptos con su último importe, nóminas y nombres', () => {
  const b = new Base(':memory:');
  const r = importar(b, leerXlsx(XLSX), { desde: '2026-12' });
  assert.equal(r.conceptos.length, 5);
  const c = Object.fromEntries(r.conceptos.map((x) => [x.nombre, x]));
  assert.equal(c['Luz y agua'].importe, 13500); // el de octubre, no el inicial
  assert.equal(c['Clases de baile'].cat, 'otros');
  assert.equal(c['Clases de baile'].id, 'clases-de-baile');
  assert.deepEqual(r.nominas, { mes: '2026-10', a: 160000, b: 140000 });
  assert.deepEqual(r.nombres, { a: 'Uno', b: 'Dos' });
  assert.equal(r.descartados.gastos, 1);
  assert.equal(r.descartados.transferencias, 1);
  assert.ok(r.avisos.some((a) => a.includes('JSON')));
  assert.ok(r.avisos.some((a) => a.includes('inventada')));
  // Nadie queda ligado: cada uno vuelve a elegir
  assert.equal(b.e.personas.a.ligada, false);
  assert.equal(b.e.personas.a.nombre, 'Uno');
  assert.deepEqual(b.e.logins, { a: null, b: null });
  const q = N.cuadre(b.e, '2026-12');
  assert.equal(q.E, 90000 + 13500 + 1500 + 4000);
  assert.equal(q.inc.a, 160000);
  assert.equal(N.cuadre(b.e, '2026-11').hay, false);
  assert.throws(() => importar(b, leerXlsx(XLSX), { desde: '2026-12' }), /ya tiene datos/);
  assert.throws(() => prepararImportacion({ otra: [['x']] }, { desde: '2026-12' }), /pestaña/);
});

test('exporta CSV con nóminas, fijos, gastos y transferencias', () => {
  const b = baseLista();
  b.aplicar([{ tipo: 'gasto.guardar', gasto: { id: 'g1', fecha: '2026-01-10', desc: 'Cena "rica"', importe: 6000, paga: 'b', parte: 50, cat: 'restaurante' } }], { por: 'a' });
  const t = N.csv(b.e);
  assert.match(t, /"2026-01-01";"nomina";"Nómina Uno";"";"2000,00";"Cuenta de Uno"/);
  assert.match(t, /"Cena ""rica"""/);
  assert.match(t, /"fijo";"Alquiler";"Casa";"1000,00";"Cuenta conjunta"/);
});

/* ---------- Servidor ---------- */
function pedir(puerto, metodo, ruta, { cuerpo, cab = {} } = {}) {
  return new Promise((ok, mal) => {
    const datos = cuerpo === undefined ? null : typeof cuerpo === 'string' ? cuerpo : JSON.stringify(cuerpo);
    const req = request({ host: '127.0.0.1', port: puerto, method: metodo, path: ruta,
      headers: { ...(datos ? { 'Content-Type': 'application/json' } : {}), ...cab } }, (res) => {
      const trozos = [];
      res.on('data', (t) => trozos.push(t));
      res.on('end', () => { const s = Buffer.concat(trozos).toString(); let j = null; try { j = JSON.parse(s); } catch { /* */ } ok({ codigo: res.statusCode, cab: res.headers, json: j, texto: s }); });
    });
    req.on('error', mal);
    if (datos) req.write(datos);
    req.end();
  });
}
async function arrancar(base, opciones = {}) {
  const dir = tmp();
  const s = crearServidor({ base, carpetaWeb: join(AQUI, '../web'), carpetaTmp: join(dir, 'tmp'), log: () => {}, ...opciones });
  await new Promise((ok) => s.listen(0, '127.0.0.1', ok));
  return { s, puerto: s.address().port };
}
const TS = (login) => ({ 'tailscale-user-login': login });

test('servidor: identidad de Tailscale, alta, permisos y ETag', async () => {
  const base = new Base(':memory:');
  base.aplicar([{ tipo: 'persona.nombrar', persona: 'a', nombre: 'Uno' }], SIS);
  const { s, puerto } = await arrancar(base);
  try {
    let r = await pedir(puerto, 'GET', '/api/estado');
    assert.equal(r.json.modo, 'sin-identidad');
    assert.equal(r.json.datos, undefined);
    // x-quien no vale fuera del modo de pruebas
    r = await pedir(puerto, 'GET', '/api/estado', { cab: { 'x-quien': 'uno@x' } });
    assert.equal(r.json.modo, 'sin-identidad');
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('uno@x') });
    assert.equal(r.json.modo, 'alta');
    assert.equal(r.json.personas.a.nombre, 'Uno');
    assert.equal(r.json.datos, undefined);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ id: 'x1', tipo: 'gasto.borrar', gasto: 'g' }] } });
    assert.match(r.json.resultados[0].error, /elige quién eres/);
    r = await pedir(puerto, 'POST', '/api/ops', { cuerpo: { ops: [{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }] } });
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ id: 'r1', tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }] } });
    assert.ok(r.json.resultados[0].ok);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'r2', tipo: 'persona.reclamar', persona: 'a', nombre: 'Intruso' }] } });
    assert.match(r.json.resultados[0].error, /otra persona/);
    await pedir(puerto, 'POST', '/api/ops', { cab: TS('dos@x'), cuerpo: { ops: [{ id: 'r3', tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }] } });
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('tres@x') });
    assert.equal(r.json.modo, 'completo');
    r = await pedir(puerto, 'GET', '/api/estado', { cab: TS('UNO@X') });
    assert.equal(r.json.modo, 'ok');
    assert.equal(r.json.yo, 'a');
    assert.equal(r.json.datos.logins, undefined); // las cuentas no salen del servidor
    assert.equal(r.json.datos.personas.b.nombre, 'Dos');
    const etag = r.cab.etag;
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { ...TS('uno@x'), 'if-none-match': etag } })).codigo, 304);
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { ...TS('dos@x'), 'if-none-match': etag } })).codigo, 200); // otra persona, otra respuesta
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ id: 'r4', tipo: 'persona.reclamar', persona: 'b', nombre: 'X' }, { id: 'n1', tipo: 'persona.renombrar', nombre: 'Uno bis' }] } });
    assert.match(r.json.resultados[0].error, /Ya estás/);
    assert.ok(r.json.resultados[1].ok);
    assert.equal(base.e.personas.a.nombre, 'Uno bis');
  } finally { s.close(); }
});

test('servidor: protección contra otras webs, límites y cabeceras', async () => {
  const base = baseLista();
  const { s, puerto } = await arrancar(base);
  try {
    const op = { ops: [{ id: 'z1', tipo: 'gasto.guardar', gasto: { id: 'g', fecha: '2026-01-02', desc: '', importe: 5, paga: 'a', parte: 50, cat: 'compra' } }] };
    let r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'Content-Type': 'text/plain' }, cuerpo: JSON.stringify(op) });
    assert.equal(r.codigo, 415);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'cross-site' }, cuerpo: op });
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'same-site' }, cuerpo: op }); // p. ej. la app del menú
    assert.equal(r.codigo, 403);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: { ...TS('uno@x'), 'sec-fetch-site': 'same-origin' }, cuerpo: op });
    assert.ok(r.json.resultados[0].ok);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: 'x'.repeat(300 * 1024) });
    assert.equal(r.codigo, 413);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: Array.from({ length: 501 }, () => ({})) } });
    assert.equal(r.codigo, 413);
    r = await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: '{roto' });
    assert.equal(r.codigo, 400);
    r = await pedir(puerto, 'GET', '/');
    assert.match(r.cab['content-security-policy'], /script-src 'self'/);
    assert.match(r.cab['content-security-policy'], /frame-ancestors 'none'/);
    assert.equal(r.cab['x-content-type-options'], 'nosniff');
    assert.match(r.texto, /Gastos a dos/);
    assert.match((await pedir(puerto, 'GET', '/nucleo.js')).texto, /export function cuadre/);
    assert.equal((await pedir(puerto, 'GET', '/no-existe.js')).codigo, 404);
    assert.equal((await pedir(puerto, 'GET', '/../src/db.js')).codigo, 404);
    assert.ok([403, 404].includes((await pedir(puerto, 'GET', '/%2e%2e/src/db.js')).codigo));
    assert.ok([403, 404].includes((await pedir(puerto, 'GET', '/..%2fsrc%2fdb.js')).codigo));
    assert.equal((await pedir(puerto, 'GET', '/api/nada')).codigo, 404);
    assert.equal((await pedir(puerto, 'GET', '/api/csv')).codigo, 403);
    r = await pedir(puerto, 'GET', '/api/csv', { cab: TS('dos@x') });
    assert.match(r.texto, /Alquiler/);
    r = await pedir(puerto, 'GET', '/api/copia', { cab: TS('dos@x') });
    assert.equal(r.codigo, 200);
    assert.equal(r.texto.slice(0, 15), 'SQLite format 3');
    assert.ok(base.meta('copia_descargada'));
  } finally { s.close(); }
});

test('servidor: avisos en directo y modo de pruebas', async () => {
  const base = baseLista();
  const { s, puerto } = await arrancar(base, { pruebas: true });
  try {
    assert.equal((await pedir(puerto, 'GET', '/api/estado', { cab: { 'x-quien': 'uno@x' } })).json.yo, 'a');
    const eventos = [];
    const req = request({ host: '127.0.0.1', port: puerto, path: '/api/eventos', headers: TS('dos@x') }, (res) => res.on('data', (t) => eventos.push(t.toString())));
    req.end();
    await new Promise((ok) => setTimeout(ok, 100));
    await pedir(puerto, 'POST', '/api/ops', { cab: TS('uno@x'), cuerpo: { ops: [{ tipo: 'valor.desde', serie: 'n:a', mes: '2026-02', importe: 1 }] } });
    await new Promise((ok) => setTimeout(ok, 100));
    req.destroy();
    const todo = eventos.join('');
    assert.match(todo, /event: hola/);
    assert.match(todo, new RegExp(`event: cambio\\ndata: {"seq":${base.seq}}`));
  } finally { s.close(); }
});

test('copias: diaria con rotación y mensual que no se borra', () => {
  const base = baseLista(), dir = tmp();
  for (let d = 1; d <= 33; d++) hacerCopias(base, dir, { ahora: { fecha: `2026-01-${String(d).padStart(2, '0')}`, mes: '2026-01' } });
  hacerCopias(base, dir, { ahora: { fecha: '2026-02-01', mes: '2026-02' } });
  const diarias = readdirSync(dir).filter((f) => f.endsWith('.db'));
  assert.equal(diarias.length, 30);
  assert.ok(!diarias.includes('gastos-2026-01-01.db'));
  assert.deepEqual(readdirSync(join(dir, 'mensual')).sort(), ['gastos-2026-01.db', 'gastos-2026-02.db']);
  const copia = new Base(join(dir, 'gastos-2026-02-01.db'));
  assert.deepEqual(copia.e, base.e);
  copia.cerrar();
});

test('tareas: la copia mensual se hace al arrancar aunque no sea la hora', () => {
  const base = baseLista(), dir = tmp();
  const t = programar({ base, carpetaCopias: dir, log: () => {}, hora: 24 * 60 + 1 });
  t.revisar();
  t.parar();
  assert.equal(readdirSync(join(dir, 'mensual')).length, 1);
  assert.equal(base.meta('tarea_copia'), null);
  assert.ok(existsSync(dir));
});

test('arrastre: lo que no se transfiere pasa a los meses siguientes (y lo de más, también)', () => {
  const b = baseLista(); // t = { a: 72500, b: 27500 } cada mes desde enero
  let c = N.cuadre(b.e, '2026-01');
  assert.deepEqual(c.arrastre, { a: 0, b: 0 });
  assert.deepEqual(c.total, c.t);
  // Enero: Uno transfiere 50000 de 72500; Dos transfiere 30000 (2500 de más)
  b.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 't1', mes: '2026-01', de: 'a', importe: 50000, fecha: '2026-01-05' } },
    { tipo: 'transferencia.registrar', transferencia: { id: 't2', mes: '2026-01', de: 'b', importe: 30000, fecha: '2026-01-05' } }], { por: 'a' });
  c = N.cuadre(b.e, '2026-02');
  assert.deepEqual(c.arrastre, { a: 22500, b: -2500 });
  assert.deepEqual(c.total, { a: 95000, b: 25000 });
  assert.deepEqual(c.pendiente, { a: 95000, b: 25000 });
  // Lo arrastrado reduce el libre de quien debe ese mes
  assert.equal(c.libre.a, 122500 - 22500);
  assert.equal(c.libre.b, 122500 + 2500);
  // Febrero sin tocar: en marzo se acumula
  assert.deepEqual(N.cuadre(b.e, '2026-03').arrastre, { a: 22500 + 72500, b: -2500 + 27500 });
  // Se pone al día en marzo pagando todo lo pendiente
  const p = N.cuadre(b.e, '2026-03').pendiente;
  b.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 't3', mes: '2026-03', de: 'a', importe: p.a, fecha: '2026-03-02' } },
    { tipo: 'transferencia.registrar', transferencia: { id: 't4', mes: '2026-03', de: 'b', importe: p.b, fecha: '2026-03-02' } }], { por: 'a' });
  assert.deepEqual(N.cuadre(b.e, '2026-03').pendiente, { a: 0, b: 0 });
  assert.deepEqual(N.cuadre(b.e, '2026-04').arrastre, { a: 0, b: 0 });
  // Un mes sin nóminas no genera deuda, pero sus transferencias cuentan
  const v = new Base(':memory:');
  v.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 'x', mes: '2026-05', de: 'a', importe: 1000, fecha: '2026-05-01' } }], SIS);
  assert.deepEqual(N.cuadre(v.e, '2026-06').arrastre, { a: -1000, b: 0 });
});

test('devoluciones de la conjunta (transferencia negativa)', () => {
  const b = baseLista();
  b.aplicar([{ tipo: 'concepto.guardar', concepto: { id: 'nevera', nombre: 'Nevera', cat: 'casa', cuenta: 'a' }, mes: '2026-01' },
    { tipo: 'valor.puntual', serie: 'c:nevera', mes: '2026-01', importe: 200000 }], { por: 'a' });
  const c = N.cuadre(b.e, '2026-01');
  assert.ok(c.t.a < 0); // Uno pagó tanto de su bolsillo que la conjunta le debe
  const r = b.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 'dv', mes: '2026-01', de: 'a', importe: c.t.a, fecha: '2026-01-20' } }], { por: 'b' });
  assert.ok(r[0].ok, JSON.stringify(r));
  assert.equal(N.cuadre(b.e, '2026-01').pendiente.a, 0);
  assert.match(b.aplicar([{ tipo: 'transferencia.registrar', transferencia: { id: 'z', mes: '2026-01', de: 'a', importe: 0, fecha: '2026-01-20' } }], { por: 'b' })[0].error, /distinto de 0/);
  assert.match(N.csv(b.e), /"La conjunta a Uno"/);
});

test('carpetas: agrupan gastos de varios meses, se cierran y solo se borran vacías', () => {
  const b = baseLista();
  const r = b.aplicar([
    { tipo: 'carpeta.guardar', carpeta: { id: 'roma', nombre: 'Viaje a Roma', emoji: '✈️' } },
    { tipo: 'gasto.guardar', gasto: { id: 'v1', fecha: '2026-03-30', desc: 'Vuelos', importe: 30000, paga: 'a', parte: 50, cat: 'viajes', carpeta: 'roma' } },
    { tipo: 'gasto.guardar', gasto: { id: 'v2', fecha: '2026-04-02', desc: 'Hotel', importe: 45000, paga: 'a', parte: 50, cat: 'viajes', carpeta: 'roma' } },
    { tipo: 'gasto.guardar', gasto: { id: 'n1', fecha: '2026-04-03', desc: 'Pan', importe: 200, paga: 'a', parte: 50, cat: 'compra' } },
  ], { por: 'a' });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  assert.deepEqual(N.gastosDeCarpeta(b.e, 'roma').map((g) => g.id), ['v2', 'v1']);
  assert.equal(N.cuadre(b.e, '2026-04').totalSueltos, 45200); // siguen contando en su mes
  assert.equal(b.e.gastos.n1.carpeta, null);
  assert.match(b.aplicar([{ tipo: 'gasto.guardar', gasto: { id: 'n2', fecha: '2026-04-03', desc: '', importe: 1, paga: 'a', parte: 50, cat: 'compra', carpeta: 'nada' } }], { por: 'a' })[0].error, /carpeta no existe/);
  assert.match(b.aplicar([{ tipo: 'carpeta.guardar', carpeta: { id: 'otra', nombre: 'viaje a roma' } }], { por: 'a' })[0].error, /Ya hay/);
  assert.match(b.aplicar([{ tipo: 'carpeta.borrar', carpeta: 'roma' }], { por: 'a' })[0].error, /ciérrala/);
  b.aplicar([{ tipo: 'carpeta.cerrar', carpeta: 'roma', cerrada: true }], { por: 'b' });
  assert.equal(N.carpetas(b.e).length, 0);
  assert.equal(N.carpetas(b.e, { cerradas: true }).length, 1);
  b.aplicar([{ tipo: 'carpeta.guardar', carpeta: { id: 'roma', nombre: 'Roma 2026', emoji: '' } }], { por: 'b' });
  assert.deepEqual(b.e.carpetas.roma, { id: 'roma', nombre: 'Roma 2026', emoji: '📁', cerrada: true }); // renombrar no la reabre
  b.aplicar([{ tipo: 'carpeta.guardar', carpeta: { id: 'vacia', nombre: 'Vacía' } }], { por: 'b' });
  assert.ok(b.aplicar([{ tipo: 'carpeta.borrar', carpeta: 'vacia' }], { por: 'b' })[0].ok);
  assert.match(N.csv(b.e), /"Hotel";"Viajes";"450,00";"Pagó Uno";"Roma 2026";"225,00";"225,00"/);
});

test('un historial de antes de las carpetas se sigue rehaciendo igual', () => {
  const e = N.estadoVacio();
  delete e.carpetas; // como un estado guardado en el móvil con la versión anterior
  N.aplicarOp(e, { tipo: 'gasto.guardar', por: 'a', gasto: { id: 'g', fecha: '2026-01-01', desc: '', importe: 5, cuenta: 'j', cat: 'compra' } });
  N.aplicarOp(e, { tipo: 'gasto.guardar', por: 'a', gasto: { id: 'h', fecha: '2026-01-01', desc: '', importe: 500, cuenta: 'b', cat: 'compra' } });
  assert.equal(e.gastos.g.carpeta, null);
  assert.equal(e.gastos.g.paga, 'j');           // de la conjunta: sin deuda
  assert.deepEqual([e.gastos.h.paga, e.gastos.h.parte], ['b', 50]); // pagó b, a medias
  assert.equal(N.saldo(e), -250);
  assert.deepEqual(N.carpetas(e), []);
});

test('deudas: quién pagó, cómo se reparte y pagos para saldar', () => {
  const b = baseLista();
  const r = b.aplicar([
    { tipo: 'gasto.guardar', gasto: { id: 'c1', fecha: '2026-01-10', desc: 'Cena', importe: 6000, paga: 'a', parte: 50, cat: 'restaurante' } },     // Dos debe 30
    { tipo: 'gasto.guardar', gasto: { id: 'c2', fecha: '2026-01-11', desc: 'Cine', importe: 2001, paga: 'b', parte: 50, cat: 'salidas' } },          // Uno debe 10,01 (redondeo)
    { tipo: 'gasto.guardar', gasto: { id: 'c3', fecha: '2026-01-12', desc: 'Regalo para Dos', importe: 4000, paga: 'a', parte: 0, cat: 'otros' } }, // todo para Dos: debe 40
    { tipo: 'gasto.guardar', gasto: { id: 'c4', fecha: '2026-01-12', desc: 'Mío', importe: 999, paga: 'a', parte: 100, cat: 'otros' } },           // sin deuda
    { tipo: 'gasto.guardar', gasto: { id: 'c5', fecha: '2026-01-13', desc: 'Súper', importe: 10000, paga: 'b', parte: 70, cat: 'compra' } },        // Uno debe 70
  ], { por: 'a' });
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  assert.deepEqual(N.partes(b.e.gastos.c2), { a: 1001, b: 1000 });
  assert.equal(N.deudaDe(b.e.gastos.c4), 0);
  assert.equal(N.saldo(b.e), 3000 - 1001 + 4000 - 7000); // −1001: Uno le debe 10,01 a Dos
  assert.equal(N.textoReparto(b.e, b.e.gastos.c1), 'a medias');
  assert.equal(N.textoReparto(b.e, b.e.gastos.c3), 'todo para Dos');
  assert.equal(N.textoReparto(b.e, b.e.gastos.c5), 'Uno 70 % · Dos 30 %');
  b.aplicar([{ tipo: 'pago.registrar', pago: { id: 'p1', de: 'a', importe: 1001, fecha: '2026-01-20' } }], { por: 'a' });
  assert.equal(N.saldo(b.e), 0);
  // El reparto mensual no cambia con los gastos sueltos
  assert.deepEqual(N.cuadre(b.e, '2026-01').t, { a: 72500, b: 27500 });
  const malas = b.aplicar([
    { tipo: 'gasto.guardar', gasto: { id: 'x1', fecha: '2026-01-10', desc: '', importe: 100, paga: 'j', parte: 50, cat: 'compra' } },
    { tipo: 'gasto.guardar', gasto: { id: 'x2', fecha: '2026-01-10', desc: '', importe: 100, paga: 'a', parte: 101, cat: 'compra' } },
    { tipo: 'gasto.guardar', gasto: { id: 'x3', fecha: '2026-01-10', desc: '', importe: 100, paga: 'a', parte: 33.3, cat: 'compra' } },
    { tipo: 'pago.registrar', pago: { id: 'x4', de: 'a', importe: 0, fecha: '2026-01-20' } },
    { tipo: 'pago.borrar', pago: 'nada' },
  ], { por: 'a' });
  assert.ok(malas.every((x) => !x.ok), JSON.stringify(malas));
  b.aplicar([{ tipo: 'pago.borrar', pago: 'p1' }], { por: 'b' });
  assert.equal(N.saldo(b.e), -1001);
  assert.match(N.csv(b.e), /"Súper";"Comida";"100,00";"Pagó Dos";"";"70,00";"30,00"/);
});

test('servidor: tras actualizar la app, el móvil no se queda con la copia de la versión anterior', async () => {
  const base = new Base(':memory:');
  base.aplicar([{ tipo: 'persona.nombrar', persona: 'a', nombre: 'Uno' }], SIS);
  base.aplicar([{ tipo: 'persona.reclamar', persona: 'a', nombre: 'Uno' }], { login: 'uno@x' });
  base.aplicar([{ tipo: 'persona.reclamar', persona: 'b', nombre: 'Dos' }], { login: 'dos@x' });
  const antes = await arrancar(base, { version: '1.0.0' });
  let etag;
  try {
    const r = await pedir(antes.puerto, 'GET', '/api/estado', { cab: TS('uno@x') });
    assert.equal(r.json.modo, 'ok');
    etag = r.cab.etag;
    assert.equal((await pedir(antes.puerto, 'GET', '/api/estado', { cab: { ...TS('uno@x'), 'if-none-match': etag } })).codigo, 304);
  } finally { antes.s.close(); }
  const despues = await arrancar(base, { version: '1.0.1' }); // misma base, mismo seq
  try {
    const r = await pedir(despues.puerto, 'GET', '/api/estado', { cab: { ...TS('uno@x'), 'if-none-match': etag } });
    assert.equal(r.codigo, 200);
    assert.ok(r.json.datos);
  } finally { despues.s.close(); }
});
