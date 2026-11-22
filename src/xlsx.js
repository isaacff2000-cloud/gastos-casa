// Lector mínimo de .xlsx (sin dependencias): devuelve { pestaña: [[celda, ...], ...] }.
// Basta para importar la hoja descargada de Google Sheets.
import { inflateRawSync } from 'node:zlib';

function entradasZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('El archivo no es un .xlsx válido');
  const n = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = {};
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('Índice del .xlsx dañado');
    const metodo = buf.readUInt16LE(p + 10);
    const tamComp = buf.readUInt32LE(p + 20);
    const lNombre = buf.readUInt16LE(p + 28), lExtra = buf.readUInt16LE(p + 30), lCom = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const nombre = buf.toString('utf8', p + 46, p + 46 + lNombre);
    const ini = local + 30 + buf.readUInt16LE(local + 26) + buf.readUInt16LE(local + 28);
    const datos = buf.subarray(ini, ini + tamComp);
    out[nombre] = () => (metodo === 0 ? datos : inflateRawSync(datos)).toString('utf8');
    p += 46 + lNombre + lExtra + lCom;
  }
  return out;
}

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" };
function texto(s) {
  return s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) =>
    e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : +e.slice(1)) : (ENT[e] ?? m));
}
function attr(tag, nombre) {
  const m = tag.match(new RegExp('\\s' + nombre + '="([^"]*)"'));
  return m ? texto(m[1]) : null;
}
function textosT(xml) {
  let s = '';
  for (const m of xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>|<t(?:\s[^>]*)?\/>/g)) s += m[1] ? texto(m[1]) : '';
  return s;
}
function columna(ref) {
  let n = 0;
  for (const c of ref.replace(/\d+$/, '')) n = n * 26 + (c.charCodeAt(0) - 64);
  return n - 1;
}

export function leerXlsx(buf) {
  const z = entradasZip(buf);
  const leer = (n) => (z[n] ? z[n]() : null);
  const compartidas = [];
  const ss = leer('xl/sharedStrings.xml');
  if (ss) for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) compartidas.push(textosT(m[1]));
  const rels = {};
  for (const m of (leer('xl/_rels/workbook.xml.rels') || '').matchAll(/<Relationship\b[^>]*>/g)) {
    rels[attr(m[0], 'Id')] = attr(m[0], 'Target');
  }
  const libro = {};
  for (const m of (leer('xl/workbook.xml') || '').matchAll(/<sheet\b[^>]*>/g)) {
    const nombre = attr(m[0], 'name');
    let destino = rels[attr(m[0], 'r:id')] || '';
    destino = destino.startsWith('/') ? destino.slice(1) : 'xl/' + destino.replace(/^\.\//, '');
    const xml = leer(destino);
    if (!xml) continue;
    const filas = [];
    for (const fm of xml.matchAll(/<row\b([^>]*)>([\s\S]*?)<\/row>/g)) {
      const r = Number(attr(fm[0].slice(0, fm[0].indexOf('>') + 1), 'r')) - 1;
      const fila = [];
      for (const cm of fm[2].matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const cab = '<c' + cm[1] + '>';
        const ref = attr(cab, 'r'), t = attr(cab, 't');
        const cuerpo = cm[2] || '';
        const v = (cuerpo.match(/<v>([\s\S]*?)<\/v>/) || [])[1];
        let val = null;
        if (t === 's') val = compartidas[+v] ?? '';
        else if (t === 'inlineStr') val = textosT(cuerpo);
        else if (t === 'str' || t === 'e') val = v != null ? texto(v) : '';
        else if (t === 'b') val = v === '1';
        else if (v != null) val = Number(v);
        fila[ref ? columna(ref) : fila.length] = val;
      }
      for (let i = 0; i < fila.length; i++) if (fila[i] === undefined) fila[i] = null;
      filas[r] = fila;
    }
    for (let i = 0; i < filas.length; i++) if (!filas[i]) filas[i] = [];
    libro[nombre] = filas;
  }
  return libro;
}
