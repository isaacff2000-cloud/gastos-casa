// Importa la hoja de Google de la app antigua (Archivo › Descargar › Microsoft Excel).
// Pestaña "datos": ruta | datos_json | actualizado.  Se traen los conceptos con su último importe,
// los nombres y las nóminas del último mes guardado. Gastos sueltos y transferencias se descartan
// (se empieza de cero). Solo sobre una base vacía.
import { CATS, CUENTAS, RE_MES, eur } from './nucleo.js';

const RE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,39}$/;
const slug = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'concepto';

/** Lee el libro y prepara las operaciones. No toca la base. */
export function prepararImportacion(libro, { desde }) {
  if (!RE_MES.test(desde || '')) throw new Error('Mes de inicio no válido (AAAA-MM)');
  const pestana = libro.datos || Object.values(libro).find((f) => String(f?.[0]?.[0]).trim() === 'ruta');
  if (!pestana) throw new Error('No encuentro la pestaña "datos" en el .xlsx');
  const docs = {};
  const avisos = [];
  for (const fila of pestana.slice(1)) {
    const ruta = fila && fila[0] ? String(fila[0]).trim() : '';
    if (!ruta) continue;
    try { docs[ruta] = JSON.parse(String(fila[1])); } catch { avisos.push(`Fila ${ruta}: JSON no válido, se salta`); }
  }
  const de = (col) => Object.entries(docs).filter(([r]) => r.startsWith(col + '/')).map(([r, d]) => ({ id: r.slice(col.length + 1), ...d }));

  // Importe más reciente de cada concepto: el último mes en que se cambió (fx-AAAA-MM-<id>) o el inicial
  const gastos = de('expenses');
  const ultimo = {};
  for (const g of gastos) {
    if (!g.fixedId || g.type === 'transfer') continue;
    const mes = String(g.date || '').slice(0, 7);
    if (!ultimo[g.fixedId] || mes > ultimo[g.fixedId].mes) ultimo[g.fixedId] = { mes, importe: Math.round(Number(g.amount) || 0) };
  }

  const ops = [];
  const conceptos = [];
  const usados = new Set();
  const cats = new Set(CATS.map((c) => c.id));
  for (const f of de('fixed').sort((x, y) => (x.order || 0) - (y.order || 0) || (x.createdAt || 0) - (y.createdAt || 0))) {
    let id = RE_ID.test(f.id) ? f.id : slug(f.desc || f.id);
    while (usados.has(id)) id = id.slice(0, 37) + '-' + usados.size;
    usados.add(id);
    let cat = f.cat;
    if (!cats.has(cat)) { avisos.push(`«${f.desc}»: categoría desconocida (${cat}), pasa a Otros`); cat = 'otros'; }
    let cuenta = f.src || 'j';
    if (!CUENTAS.includes(cuenta)) { avisos.push(`«${f.desc}»: cuenta desconocida (${cuenta}), pasa a la conjunta`); cuenta = 'j'; }
    const u = ultimo[f.id];
    const importe = u ? u.importe : Math.round(Number(f.amount) || 0);
    const nombre = String(f.desc || id).trim().slice(0, 40);
    conceptos.push({ id, nombre, cat, cuenta, importe, origen: u ? `cambiado en ${u.mes}` : 'importe inicial' });
    ops.push({ tipo: 'concepto.guardar', concepto: { id, nombre, cat, cuenta }, mes: desde });
    ops.push({ tipo: 'valor.desde', serie: 'c:' + id, mes: desde, importe });
  }

  // Nóminas del último mes con datos
  const meses = de('months').filter((m) => RE_MES.test(m.id) && (m.incA || m.incB)).sort((x, y) => y.id.localeCompare(x.id));
  let nominas = null;
  if (meses.length) {
    const m = meses[0];
    nominas = { mes: m.id, a: Math.round(m.incA || 0), b: Math.round(m.incB || 0) };
    ops.push({ tipo: 'valor.desde', serie: 'n:a', mes: desde, importe: nominas.a });
    ops.push({ tipo: 'valor.desde', serie: 'n:b', mes: desde, importe: nominas.b });
  }

  // Nombres (sin las cuentas de Google: cada uno vuelve a elegir quién es)
  const nombres = {};
  for (const m of de('members')) {
    if ((m.id === 'a' || m.id === 'b') && m.name) {
      nombres[m.id] = String(m.name).trim().slice(0, 24);
      ops.unshift({ tipo: 'persona.nombrar', persona: m.id, nombre: nombres[m.id] });
    }
  }

  const descartados = {
    gastos: gastos.filter((g) => !g.fixedId && g.type !== 'transfer').length,
    transferencias: gastos.filter((g) => g.type === 'transfer').length,
    importesPorMes: gastos.filter((g) => g.fixedId).length,
    mesesConNominas: meses.length,
  };
  if (!conceptos.length) throw new Error('El .xlsx no tiene conceptos (filas fixed/…): ¿es la hoja «Gastos a dos»?');
  return { ops, conceptos, nominas, nombres, descartados, avisos };
}

/** Aplica la importación en una base vacía. */
export function importar(base, libro, opciones) {
  if (!base.vacia) throw new Error('La base ya tiene datos: la importación solo se hace una vez');
  const r = prepararImportacion(libro, opciones);
  const res = base.aplicar(r.ops.map((o, i) => ({ ...o, id: `importacion-${i}` })), { por: 'sistema' });
  const mal = res.filter((x) => !x.ok);
  if (mal.length) throw new Error('No se pudo importar: ' + mal.map((x) => x.error).join('; '));
  return r;
}

/** Informe legible de lo que se importa. */
export function informe(r, desde) {
  const l = [`Conceptos (${r.conceptos.length}), con importe desde ${desde}:`];
  const cuenta = { j: 'conjunta', a: r.nombres.a || 'persona 1', b: r.nombres.b || 'persona 2' };
  for (const c of r.conceptos) l.push(`  ${c.nombre.padEnd(22)} ${eur(c.importe).padStart(12)}  ${cuenta[c.cuenta].padEnd(10)} ${c.cat.padEnd(14)} (${c.origen})`);
  l.push(`  ${'Total'.padEnd(22)} ${eur(r.conceptos.reduce((s, c) => s + c.importe, 0)).padStart(12)}`);
  l.push(r.nominas ? `Nóminas (de ${r.nominas.mes}): ${eur(r.nominas.a)} y ${eur(r.nominas.b)}` : 'Nóminas: no había ninguna guardada; se ponen en la pestaña Mes.');
  l.push('Nombres: ' + (Object.entries(r.nombres).map(([k, v]) => `${k} = ${v}`).join(', ') || 'ninguno'));
  const d = r.descartados;
  l.push(`Se descartan (empezar de cero): ${d.gastos} gastos sueltos, ${d.transferencias} transferencias, ${d.importesPorMes} importes por mes ya incluidos arriba.`);
  for (const a of r.avisos) l.push('Aviso: ' + a);
  return l.join('\n');
}
