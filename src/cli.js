#!/usr/bin/env node
// Uso: node src/cli.js <orden>
//   servir                                   arranca la app (puerto 8788)
//   importar <hoja.xlsx> [--desde AAAA-MM]   importa la hoja de Google (solo sobre una base vacía)
//   importar <hoja.xlsx> --prueba            enseña lo que importaría, sin guardar nada
//   copia                                    hace ahora la copia de seguridad
//   restaurar <copia.db>                     sustituye los datos por una copia (con el servicio parado)
//   desligar <a|b>                           olvida la cuenta de Tailscale de esa persona (para volver a elegir)
//   resumen                                  cuenta lo que hay
import { readFileSync, copyFileSync, renameSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { Base } from './db.js';
import { leerXlsx } from './xlsx.js';
import { importar, prepararImportacion, informe } from './importar.js';
import { crearServidor } from './servidor.js';
import { programar, hacerCopias } from './tareas.js';
import { hoy, mesDe } from './nucleo.js';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const DATOS = process.env.GASTOS_DATOS || join(RAIZ, 'datos');
const RUTA_DB = join(DATOS, 'gastos.db');
const COPIAS = join(DATOS, 'copias');
const VERSION = process.env.GASTOS_VERSION || JSON.parse(readFileSync(join(RAIZ, 'package.json'), 'utf8')).version;
const log = (...a) => console.log(new Date().toISOString(), ...a);

const args = process.argv.slice(2);
const orden = args[0];
const opcion = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };

const ordenes = {
  async servir() {
    const base = new Base(RUTA_DB);
    const puerto = Number(process.env.PUERTO || 8788);
    const host = process.env.HOST || '127.0.0.1';
    const pruebas = process.env.GASTOS_PRUEBAS === '1';
    const s = crearServidor({ base, carpetaWeb: join(RAIZ, 'web'), carpetaTmp: join(DATOS, 'tmp'), version: VERSION, log, pruebas });
    if (pruebas) log('AVISO: modo de pruebas (acepta la cabecera x-quien). No usar en el servicio.');
    programar({ base, carpetaCopias: COPIAS, log });
    s.listen(puerto, host, () => log(`Gastos a dos ${VERSION} en http://${host}:${puerto}`));
    const salir = () => { log('Parando…'); s.close(); base.cerrar(); process.exit(0); };
    process.on('SIGTERM', salir);
    process.on('SIGINT', salir);
  },
  async importar() {
    const ruta = args[1];
    if (!ruta || ruta.startsWith('--')) throw new Error('Falta la ruta del .xlsx');
    const desde = opcion('--desde') || mesDe(hoy());
    const libro = leerXlsx(readFileSync(ruta));
    if (args.includes('--prueba')) {
      console.log(informe(prepararImportacion(libro, { desde }), desde));
      console.log('\n(Prueba: no se ha guardado nada.)');
      return;
    }
    const base = new Base(RUTA_DB);
    try { console.log(informe(importar(base, libro, { desde }), desde)); console.log('\nImportado.'); } finally { base.cerrar(); }
  },
  async copia() {
    const base = new Base(RUTA_DB);
    try { log('Copia:', hacerCopias(base, COPIAS).join(', ')); } finally { base.cerrar(); }
  },
  async restaurar() {
    const origen = args[1];
    if (!origen || !existsSync(origen)) throw new Error('Indica la copia a restaurar (archivo .db)');
    const prueba = new DatabaseSync(origen, { readOnly: true });
    const n = prueba.prepare('SELECT COUNT(*) AS n FROM op').get().n;
    prueba.close();
    if (existsSync(RUTA_DB)) {
      const aparte = `${RUTA_DB}.antes-${new Date().toISOString().replace(/[:.]/g, '-')}`;
      renameSync(RUTA_DB, aparte);
      for (const x of ['-wal', '-shm']) rmSync(RUTA_DB + x, { force: true });
      log('Los datos que había se guardan en', aparte);
    }
    copyFileSync(origen, RUTA_DB);
    log(`Restaurada la copia (${n} operaciones). Arranca de nuevo el servicio.`);
  },
  async desligar() {
    const p = args[1];
    if (p !== 'a' && p !== 'b') throw new Error('Indica a o b');
    const base = new Base(RUTA_DB);
    try {
      const [r] = base.aplicar([{ tipo: 'persona.desligar', persona: p }], { por: 'sistema' });
      if (!r.ok) throw new Error(r.error);
      log(`Hecho: ${p} puede volver a elegir quién es desde su móvil. Reinicia el servicio si está en marcha.`);
    } finally { base.cerrar(); }
  },
  async resumen() {
    const base = new Base(RUTA_DB);
    const e = base.e;
    log('operaciones', base.seq);
    log('personas', JSON.stringify(Object.fromEntries(Object.entries(e.personas).map(([k, v]) => [k, `${v.nombre || '-'}${v.ligada ? ' (ligada)' : ''}`]))));
    for (const k of ['conceptos', 'gastos', 'transferencias', 'categorias']) log(k.padEnd(15), Object.keys(e[k]).length);
    base.cerrar();
  },
};

const fn = ordenes[orden];
if (!fn) { console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 10).join('\n').replace(/^\/\/ ?/gm, '')); process.exit(orden ? 1 : 0); }
fn().catch((e) => { console.error('Error:', e.message); process.exit(1); });
