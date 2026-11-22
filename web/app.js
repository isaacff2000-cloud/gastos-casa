import { h, render } from './vendor/preact.js';
import { useState, useEffect, useRef } from './vendor/hooks.js';
import htm from './vendor/htm.js';
import * as N from './nucleo.js';
import { S, suscribir, iniciar, hacer, nuevoId, mensaje, cerrarAviso } from './almacen.js';

const html = htm.bind(h);
const mesHoy = () => N.mesDe(N.hoy());

function useAlmacen() {
  const [, set] = useState(0);
  useEffect(() => {
    const quitar = suscribir(() => set((n) => n + 1));
    set((n) => n + 1); // por si algo cambió antes de empezar a escuchar
    return quitar;
  }, []);
  return S;
}
function useGuardado(clave, inicial) {
  const [v, set] = useState(() => { try { return JSON.parse(sessionStorage.getItem(clave)) ?? inicial; } catch { return inicial; } });
  return [v, (x) => { set(x); try { sessionStorage.setItem(clave, JSON.stringify(x)); } catch { /* */ } }];
}

/* ---------- Piezas comunes ---------- */
function Hoja({ titulo, cerrar, children, pie }) {
  useEffect(() => {
    const esc = (ev) => { if (ev.key === 'Escape') cerrar(); };
    addEventListener('keydown', esc);
    document.body.classList.add('con-hoja');
    return () => { removeEventListener('keydown', esc); document.body.classList.remove('con-hoja'); };
  }, []);
  return html`<div class="velo" onClick=${(ev) => ev.target === ev.currentTarget && cerrar()}>
    <section class="hoja" role="dialog" aria-modal="true" aria-label=${titulo}>
      <header class="hoja-cab"><h2>${titulo}</h2><button class="icono" aria-label="Cerrar" onClick=${cerrar}>✕</button></header>
      <div class="hoja-cuerpo">${children}</div>
      ${pie && html`<footer class="hoja-pie">${pie}</footer>`}
    </section>
  </div>`;
}
const Chip = ({ activo, onClick, children }) => html`<button type="button" class=${'chip' + (activo ? ' activo' : '')} aria-pressed=${!!activo} onClick=${onClick}>${children}</button>`;

function NavMes({ mes, poner }) {
  const actual = mesHoy();
  return html`<div class="nav-mes">
    <button class="icono" aria-label="Mes anterior" onClick=${() => poner(N.sumarMes(mes, -1))}>‹</button>
    <button class="mes" onClick=${() => poner(actual)} aria-label=${'Ir al mes actual'}>
      <strong class="cap">${N.etiquetaMes(mes)}</strong>
      <small>${mes === actual ? 'este mes' : mes < actual ? 'pasado' : 'más adelante'}</small>
    </button>
    <button class="icono" aria-label="Mes siguiente" onClick=${() => poner(N.sumarMes(mes, 1))}>›</button>
  </div>`;
}

/**
 * Casilla de importe: mientras tiene el foco, lo que llega de fuera no pisa lo que se escribe.
 * onBorrador(céntimos) en cada tecla; onConfirmar(céntimos) al salir si cambió.
 */
function CampoImporte({ valor, gris, etiqueta, onBorrador, onConfirmar, desactivado }) {
  const [txt, setTxt] = useState(N.enCasilla(valor));
  const [mal, setMal] = useState(false);
  const foco = useRef(false);
  useEffect(() => { if (!foco.current) { setTxt(N.enCasilla(valor)); setMal(false); } }, [valor]);
  const salir = () => {
    foco.current = false;
    const c = N.aCentimos(txt);
    if (c === null) { setTxt(N.enCasilla(valor)); setMal(false); onBorrador(undefined); mensaje('Importe no válido: escribe por ejemplo 1250 o 12,50', 'error'); return; }
    if (c !== (valor ?? 0) || (valor == null && txt.trim() !== '')) onConfirmar(c);
    else onBorrador(undefined);
    setTxt(N.enCasilla(c === 0 && valor == null ? null : c));
  };
  return html`<input class=${'importe' + (gris ? ' gris' : '') + (mal ? ' mal' : '')} type="text" inputmode="decimal" autocomplete="off"
    aria-label=${etiqueta} placeholder="—" value=${txt} disabled=${desactivado}
    onFocus=${(ev) => { foco.current = true; ev.target.select(); }}
    onInput=${(ev) => { setTxt(ev.target.value); const c = N.aCentimos(ev.target.value); setMal(c === null); onBorrador(c === null ? undefined : c); }}
    onKeyDown=${(ev) => { if (ev.key === 'Enter') ev.target.blur(); }}
    onBlur=${salir} />`;
}

/* ---------- Transferir ---------- */
function Transferir({ e, yo, mes }) {
  const c = N.cuadre(e, mes);
  const [transf, setTransf] = useState(null);
  const trs = N.transferenciasDelMes(e, mes);
  return html`<div>
    ${!c.hay ? html`<div class="banda">Pon las nóminas del mes en la pestaña <b>Mes</b> para ver cuánto transferir.</div>` : html`
    <section class="tarjeta">
      <div class="cifras">
        <div><small>Ingresos</small><b>${N.eur(c.inc.a + c.inc.b)}</b></div>
        <div><small>Gastos</small><b>${N.eur(c.E)}</b></div>
        <div><small>Libre c/u</small><b class=${c.F < 0 ? 'neg' : ''}>${N.eur(Math.round(c.F / 2))}</b></div>
      </div>
      ${c.F < 0 && html`<p class="alerta">Los gastos superan los ingresos este mes en ${N.eur(-c.F)}.</p>`}
      <p class="nota">Se pagan todos los gastos y lo que sobra se reparte a partes iguales: los dos acabáis con el mismo saldo libre.</p>
    </section>
    <section class="tarjeta">
      <h3>Transferir a la cuenta conjunta</h3>
      ${c.hecho.a + c.hecho.b > 0 && trs.length > 0 && html`<p class="nota">Este mes ya tiene transferencias apuntadas: si cambias importes, el pendiente se recalcula.</p>`}
      <div class="dos">${['a', 'b'].map((p) => html`<${Persona} key=${p} e=${e} c=${c} p=${p} yo=${yo} />`)}</div>
      ${c.pendiente[yo] > 0 && html`<button class="boton" onClick=${() => setTransf(c.pendiente[yo])}>Ya he transferido ${N.eur(c.pendiente[yo])}</button>`}
      ${c.pendiente[yo] < 0 && html`<button class="boton" onClick=${() => setTransf(c.pendiente[yo])}>La conjunta me ha devuelto ${N.eur(-c.pendiente[yo])}</button>`}
      <button class="boton suave" onClick=${() => setTransf(0)}>Apuntar otra transferencia</button>
    </section>`}
    ${trs.length > 0 && html`<h2 class="seccion">Transferencias hechas</h2>
      <section class="tarjeta lista">${trs.map((t) => html`<div class="fila" key=${t.id}>
        <span class="ico">🏦</span>
        <div class="texto"><strong>${t.importe > 0 ? N.nombre(e, t.de) + ' a la conjunta' : 'La conjunta a ' + N.nombre(e, t.de)}</strong><small>${N.etiquetaDia(t.fecha)}</small></div>
        <b>${N.eur(Math.abs(t.importe))}</b>
        <button class="icono" aria-label=${'Borrar transferencia de ' + N.eur(Math.abs(t.importe))} onClick=${() => hacer({ tipo: 'transferencia.borrar', transferencia: t.id },
          { deshacer: { texto: 'Transferencia borrada', ops: [{ tipo: 'transferencia.registrar', transferencia: { ...t } }] } })}>🗑</button>
      </div>`)}</section>`}
    <${PorCategoria} e=${e} lista=${c.fijos} total=${c.E} titulo="Gastos fijos del mes por categoría" />
    ${transf !== null && html`<${HojaTransferencia} e=${e} yo=${yo} mes=${mes} importe=${transf} cerrar=${() => setTransf(null)} />`}
  </div>`;
}

function Persona({ e, c, p, yo }) {
  const pend = c.pendiente[p], arr = c.arrastre[p], tot = c.total[p];
  return html`<div class=${'persona' + (p === yo ? ' mia' : '')}>
    <small>${N.nombre(e, p)}${p === yo ? ' (tú)' : ''}</small>
    ${tot >= 0 ? html`<b class="grande">${N.eur(tot)}</b>` : html`<b class="grande">0,00 €</b><small class="pos">La conjunta te devuelve ${N.eur(-tot)}</small>`}
    ${arr !== 0 && html`<small class="arrastre">Este mes ${N.eur(c.t[p])} · ${arr > 0 ? 'pendiente de antes ' + N.eur(arr) : 'a tu favor de antes ' + N.eur(-arr)}</small>`}
    <small>Hecho: ${N.eur(c.hecho[p])}</small>
    <small class=${'estado ' + (pend > 0 ? 'neg' : 'pos')}>${pend > 0 ? 'Pendiente: ' + N.eur(pend) : pend < 0 ? 'A tu favor: ' + N.eur(-pend) : 'Al día ✓'}</small>
    <div class="dejar">
      <small>Dejar en tu cuenta personal</small>
      <b>${N.eur(c.dejar[p])}</b>
      <div class="par"><small>Recibos que pagas desde ella</small><small>${N.eur(c.P[p])}</small></div>
      <div class="par"><small>Libre para ti</small><small class="pos"><b>${N.eur(c.libre[p])}</b></small></div>
    </div>
  </div>`;
}

function HojaTransferencia({ e, yo, mes, importe, cerrar }) {
  const [txt, setTxt] = useState(importe ? N.enCasilla(Math.abs(importe)) : '');
  const [sentido, setSentido] = useState(importe < 0 ? -1 : 1);
  const [de, setDe] = useState(yo);
  const [fecha, setFecha] = useState(N.mesDe(N.hoy()) === mes ? N.hoy() : `${mes}-${String(N.diasDelMes(mes)).padStart(2, '0')}`);
  const guardar = () => {
    const c = N.aCentimos(txt);
    if (!c) return mensaje('Escribe un importe mayor que 0', 'error');
    const t = { id: nuevoId(), mes, de, importe: c * sentido, fecha };
    if (hacer({ tipo: 'transferencia.registrar', transferencia: t }, { deshacer: { texto: 'Transferencia apuntada', ops: [{ tipo: 'transferencia.borrar', transferencia: t.id }] } })) cerrar();
  };
  return html`<${Hoja} titulo="Transferencia" cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>Guardar</button>`}>
    <div class="segmento" role="group" aria-label="Sentido">
      <${Chip} activo=${sentido === 1} onClick=${() => setSentido(1)}>A la conjunta</${Chip}>
      <${Chip} activo=${sentido === -1} onClick=${() => setSentido(-1)}>La conjunta devuelve</${Chip}>
    </div>
    <label>Importe (€)<input class="grande" type="text" inputmode="decimal" value=${txt} onInput=${(ev) => setTxt(ev.target.value)} /></label>
    <div class="campo"><span>${sentido === 1 ? 'Quién transfiere' : 'A quién'}</span><div class="chips">${['a', 'b'].map((p) => html`<${Chip} activo=${de === p} onClick=${() => setDe(p)}>${N.nombre(e, p)}${p === yo ? ' (tú)' : ''}</${Chip}>`)}</div></div>
    <label>Fecha<input type="date" value=${fecha} onInput=${(ev) => ev.target.value && setFecha(ev.target.value)} /></label>
    <p class="nota">Cuenta para ${N.etiquetaMes(mes)}. Lo que quede pendiente pasa a los meses siguientes.</p>
  </${Hoja}>`;
}

function PorCategoria({ e, lista, total, titulo }) {
  const filas = N.porCategoria(lista);
  if (!filas.length || !total) return null;
  return html`<section class="tarjeta"><h3>${titulo}</h3>
    ${filas.map((f) => { const k = N.catDe(e, f.cat); return html`<div class="barra" key=${f.cat}>
      <div class="par"><span>${k.emoji} ${k.nombre}</span><span>${N.eur(f.importe)} · ${Math.round(f.importe * 100 / total)}%</span></div>
      <div class="pista"><div class="relleno" style=${{ width: (f.importe * 100 / total) + '%' }}></div></div>
    </div>`; })}
  </section>`;
}

/* ---------- Mes: la hoja viva ---------- */
function Mes({ e, yo, mes, abrirConcepto }) {
  const [borr, setBorr] = useState({});
  const [modo, setModo] = useState('desde');
  const [verQuitados, setVerQuitados] = useState(false);
  const c = N.cuadre(e, mes, borr);
  const ponBorrador = (s) => (v) => setBorr((b) => { const n = { ...b }; if (v === undefined) delete n[s]; else n[s] = v; return n; });

  const confirmar = (s, v) => {
    ponBorrador(s)(undefined);
    const ser = e.series[s] || { desde: {}, puntual: {} };
    const antesDesde = mes in ser.desde ? ser.desde[mes] : undefined, antesPuntual = mes in ser.puntual ? ser.puntual[mes] : undefined;
    const vuelta = [];
    if (modo === 'puntual') {
      vuelta.push(antesPuntual === undefined ? { tipo: 'valor.quitarPuntual', serie: s, mes } : { tipo: 'valor.puntual', serie: s, mes, importe: antesPuntual });
      hacer({ tipo: 'valor.puntual', serie: s, mes, importe: v }, { deshacer: { texto: 'Cambiado solo en ' + N.etiquetaMes(mes), ops: vuelta } });
    } else {
      vuelta.push(antesDesde === undefined ? { tipo: 'valor.borrarDesde', serie: s, mes } : { tipo: 'valor.desde', serie: s, mes, importe: antesDesde });
      if (antesPuntual !== undefined) vuelta.push({ tipo: 'valor.puntual', serie: s, mes, importe: antesPuntual });
      hacer({ tipo: 'valor.desde', serie: s, mes, importe: v }, { deshacer: { texto: 'Cambiado desde ' + N.etiquetaMes(mes), ops: vuelta } });
    }
  };

  const fila = (s, titulo, sub, ico, extra) => {
    const im = N.importe(e, s, mes);
    return html`<div class="fila" key=${s}>
      ${ico && html`<span class="ico">${ico}</span>`}
      <div class="texto"><strong>${titulo}</strong>${sub && html`<small>${sub}</small>`}
        ${im.tipo === 'puntual' && html`<button class="etiqueta" onClick=${() => hacer({ tipo: 'valor.quitarPuntual', serie: s, mes },
          { deshacer: { texto: 'Vuelve al importe normal', ops: [{ tipo: 'valor.puntual', serie: s, mes, importe: im.v }] } })}
          aria-label=${'Quitar el cambio de solo este mes de ' + titulo}>solo este mes · normal ${N.eur(im.base || 0)} ✕</button>`}
      </div>
      <${CampoImporte} valor=${im.v} gris=${im.tipo === 'heredado' || im.tipo === null} etiqueta=${'Importe de ' + titulo}
        onBorrador=${ponBorrador(s)} onConfirmar=${(v) => confirmar(s, v)} />
      ${extra}
    </div>`;
  };

  const quitados = N.conceptosQuitados(e, mes);
  return html`<div>
    <div class="fijo-arriba">
      ${c.hay ? html`<div class="dos">${['a', 'b'].map((p) => html`<div class=${'mini' + (p === yo ? ' mia' : '')} key=${p}>
        <small>${N.nombre(e, p)} transfiere</small><b>${N.eur(Math.max(0, c.total[p]))}</b>
        ${c.arrastre[p] !== 0 && html`<small>${c.arrastre[p] > 0 ? 'incl. ' + N.eur(c.arrastre[p]) + ' de antes' : 'descontado ' + N.eur(-c.arrastre[p]) + ' a favor'}</small>`}</div>`)}</div>`
        : html`<div class="mini"><small>Pon las nóminas para ver el reparto</small></div>`}
      <div class="segmento" role="group" aria-label="A qué meses afecta un cambio">
        <${Chip} activo=${modo === 'desde'} onClick=${() => setModo('desde')}>Desde este mes</${Chip}>
        <${Chip} activo=${modo === 'puntual'} onClick=${() => setModo('puntual')}>Solo este mes</${Chip}>
      </div>
    </div>
    <section class="tarjeta lista">
      <h4>Ingresos</h4>
      ${['a', 'b'].map((p) => fila('n:' + p, 'Nómina ' + N.nombre(e, p), null, null))}
      <h4>Gastos fijos</h4>
      ${c.fijos.length === 0 && html`<p class="vacio">No hay conceptos este mes. Añade el primero abajo.</p>`}
      ${c.fijos.map(({ concepto: k }) => fila('c:' + k.id, k.nombre, N.nombreCuenta(e, k.cuenta), N.catDe(e, k.cat).emoji,
        html`<button class="icono" aria-label=${'Editar ' + k.nombre} onClick=${() => abrirConcepto(k)}>✎</button>`))}
      <div class="par total"><span>Total fijos</span><b>${N.eur(c.totalFijos)}</b></div>
    </section>
    <p class="nota">En gris, lo que viene del mes anterior. Se recalcula al escribir y se guarda al salir de la casilla. «Desde este mes» cambia también los meses siguientes que no tengan su propio importe.</p>
    <button class="boton suave" onClick=${() => abrirConcepto(null)}>＋ Añadir concepto</button>
    ${quitados.length > 0 && html`<button class="enlace" onClick=${() => setVerQuitados(!verQuitados)}>Conceptos quitados (${quitados.length})</button>
      ${verQuitados && html`<section class="tarjeta lista">${quitados.map((k) => html`<div class="fila" key=${k.id}>
        <span class="ico">${N.catDe(e, k.cat).emoji}</span><div class="texto"><strong>${k.nombre}</strong><small>quitado desde ${N.etiquetaMes(k.hasta)}</small></div>
        <button class="chip" onClick=${() => hacer({ tipo: 'concepto.recuperar', concepto: k.id })}>Recuperar</button></div>`)}</section>`}`}
  </div>`;
}

function HojaConcepto({ e, mes, concepto, cerrar }) {
  const nuevo = !concepto;
  const [k, setK] = useState(() => concepto ? { ...concepto } : { nombre: '', cat: 'casa', cuenta: 'j' });
  const [txt, setTxt] = useState('');
  const pon = (c, v) => setK({ ...k, [c]: v });
  const guardar = () => {
    if (nuevo) {
      const id = nuevoId();
      const imp = N.aCentimos(txt);
      if (imp === null) return mensaje('Importe no válido', 'error');
      const ops = [{ tipo: 'concepto.guardar', concepto: { id, nombre: k.nombre, cat: k.cat, cuenta: k.cuenta }, mes }, { tipo: 'valor.desde', serie: 'c:' + id, mes, importe: imp }];
      if (hacer(ops)) cerrar();
    } else if (hacer({ tipo: 'concepto.guardar', concepto: { id: k.id, nombre: k.nombre, cat: k.cat, cuenta: k.cuenta } })) cerrar();
  };
  const mover = (d) => {
    const ids = N.conceptosDelMes(e, mes).map((x) => x.id), i = ids.indexOf(k.id), j = i + d;
    if (i < 0 || j < 0 || j >= ids.length) return;
    [ids[i], ids[j]] = [ids[j], ids[i]];
    hacer({ tipo: 'concepto.reordenar', orden: ids });
  };
  const quitar = () => {
    if (hacer({ tipo: 'concepto.archivar', concepto: k.id, mes }, { deshacer: { texto: `«${k.nombre}» quitado desde ${N.etiquetaMes(mes)}`, ops: [{ tipo: 'concepto.recuperar', concepto: k.id }] } })) cerrar();
  };
  return html`<${Hoja} titulo=${nuevo ? 'Nuevo concepto' : 'Editar concepto'} cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>${nuevo ? 'Añadir' : 'Guardar'}</button>`}>
    <label>Nombre<input type="text" maxlength="40" value=${k.nombre} placeholder="Ej. Alquiler" onInput=${(ev) => pon('nombre', ev.target.value)} /></label>
    ${nuevo && html`<label>Importe desde ${N.etiquetaMes(mes)} (€)<input type="text" inputmode="decimal" value=${txt} placeholder="0" onInput=${(ev) => setTxt(ev.target.value)} /></label>`}
    <div class="campo"><span>Categoría</span><div class="chips">${N.categorias(e).map((x) => html`<${Chip} key=${x.id} activo=${k.cat === x.id} onClick=${() => pon('cat', x.id)}>${x.emoji} ${x.nombre}</${Chip}>`)}</div></div>
    <div class="campo"><span>Se paga desde</span><div class="chips">${N.CUENTAS.map((x) => html`<${Chip} key=${x} activo=${k.cuenta === x} onClick=${() => pon('cuenta', x)}>${x === 'j' ? 'Cuenta conjunta' : N.nombre(e, x)}</${Chip}>`)}</div></div>
    ${!nuevo && html`<p class="nota">Cambiar la cuenta o la categoría afecta a todos los meses.</p>
      <div class="dos"><button class="boton suave" onClick=${() => mover(-1)}>↑ Subir</button><button class="boton suave" onClick=${() => mover(1)}>↓ Bajar</button></div>
      <button class="boton peligro" onClick=${quitar}>Quitar desde ${N.etiquetaMes(mes)}</button>
      <p class="nota">Los meses anteriores lo siguen mostrando.</p>`}
  </${Hoja}>`;
}

/* ---------- Gastos sueltos y carpetas ---------- */
/** Lo que uno le debe al otro por los gastos sueltos, y los pagos para saldarlo. */
function Deudas({ e, yo }) {
  const [hojaPago, setHojaPago] = useState(null);
  const [verPagos, setVerPagos] = useState(false);
  const s = N.saldo(e); // positivo: «b» le debe a «a»
  const deudor = s > 0 ? 'b' : 'a', acreedor = s > 0 ? 'a' : 'b';
  const pagos = N.pagosEntreVosotros(e);
  const quien = (p) => N.nombre(e, p) + (p === yo ? ' (tú)' : '');
  return html`<section class="tarjeta deudas">
    ${s === 0 ? html`<small class="nota">Deudas entre vosotros</small><b class="total-grande pos">Estáis en paz ✓</b>`
      : html`<small class="nota">${deudor === yo ? 'Le debes a ' + N.nombre(e, acreedor) : quien(deudor) + ' le debe a ' + quien(acreedor)}</small>
        <b class="total-grande">${N.eur(Math.abs(s))}</b>`}
    <p class="nota">Por los gastos sueltos: quien paga adelanta y el otro le debe su parte.</p>
    <div class="dos">
      <button class="boton${s === 0 ? ' suave' : ''}" onClick=${() => setHojaPago({ de: s === 0 ? yo : deudor, importe: Math.abs(s) })}>${s === 0 ? 'Apuntar un pago' : 'Saldar'}</button>
      ${pagos.length > 0 && html`<button class="boton suave" onClick=${() => setVerPagos(!verPagos)}>${verPagos ? 'Ocultar pagos' : `Pagos (${pagos.length})`}</button>`}
    </div>
    ${verPagos && html`<div class="lista">${pagos.map((p) => html`<div class="fila" key=${p.id}><span class="ico">🤝</span>
      <div class="texto"><strong>${N.nombre(e, p.de)} pagó a ${N.nombre(e, p.de === 'a' ? 'b' : 'a')}</strong><small>${N.etiquetaDia(p.fecha)} ${p.fecha.slice(0, 4)}</small></div>
      <b>${N.eur(p.importe)}</b>
      <button class="icono" aria-label=${'Borrar pago de ' + N.eur(p.importe)} onClick=${() => hacer({ tipo: 'pago.borrar', pago: p.id },
        { deshacer: { texto: 'Pago borrado', ops: [{ tipo: 'pago.registrar', pago: { ...p } }] } })}>🗑</button></div>`)}</div>`}
    ${hojaPago && html`<${HojaPago} e=${e} yo=${yo} inicial=${hojaPago} cerrar=${() => setHojaPago(null)} />`}
  </section>`;
}
function HojaPago({ e, yo, inicial, cerrar }) {
  const [de, setDe] = useState(inicial.de);
  const [txt, setTxt] = useState(inicial.importe ? N.enCasilla(inicial.importe) : '');
  const [fecha, setFecha] = useState(N.hoy());
  const otro = de === 'a' ? 'b' : 'a';
  const guardar = () => {
    const c = N.aCentimos(txt);
    if (!c) return mensaje('Escribe un importe mayor que 0', 'error');
    const p = { id: nuevoId(), de, importe: c, fecha };
    if (hacer({ tipo: 'pago.registrar', pago: p }, { deshacer: { texto: 'Pago apuntado', ops: [{ tipo: 'pago.borrar', pago: p.id }] } })) cerrar();
  };
  return html`<${Hoja} titulo="Pago entre vosotros" cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>Guardar</button>`}>
    <div class="campo"><span>Quién paga</span><div class="chips">${['a', 'b'].map((p) => html`<${Chip} key=${p} activo=${de === p} onClick=${() => setDe(p)}>${N.nombre(e, p)}${p === yo ? ' (tú)' : ''}</${Chip}>`)}</div></div>
    <label>Importe (€)<input class="grande" type="text" inputmode="decimal" value=${txt} onInput=${(ev) => setTxt(ev.target.value)} /></label>
    <label>Fecha<input type="date" value=${fecha} onInput=${(ev) => ev.target.value && setFecha(ev.target.value)} /></label>
    <p class="nota">${N.nombre(e, de)} le paga a ${N.nombre(e, otro)} (Bizum, transferencia…). Solo se apunta aquí: no mueve dinero.</p>
  </${Hoja}>`;
}

function Gastos({ e, yo, mes, abrirGasto, carpeta, setCarpeta }) {
  const [verCerradas, setVerCerradas] = useState(false);
  const [hojaCarpeta, setHojaCarpeta] = useState(null);
  const abiertas = N.carpetas(e), cerradas = N.carpetas(e, { cerradas: true }).filter((c) => c.cerrada);
  const actual = carpeta && e.carpetas && e.carpetas[carpeta];
  const lista = actual ? N.gastosDeCarpeta(e, carpeta) : N.gastosDelMes(e, mes);
  const total = lista.reduce((s, g) => s + g.importe, 0);
  const dias = [];
  for (const g of lista) { const d = dias[dias.length - 1]; if (d && d.fecha === g.fecha) d.items.push(g); else dias.push({ fecha: g.fecha, items: [g] }); }
  const chipCarpeta = (c) => html`<${Chip} key=${c.id} activo=${carpeta === c.id} onClick=${() => setCarpeta(carpeta === c.id ? null : c.id)}>${c.emoji} ${c.nombre}</${Chip}>`;
  const borrar = () => hacer({ tipo: 'carpeta.borrar', carpeta: actual.id }) && setCarpeta(null);
  return html`<div>
    <${Deudas} e=${e} yo=${yo} />
    <div class="chips carpetas" role="group" aria-label="Carpetas">
      <${Chip} activo=${!actual} onClick=${() => setCarpeta(null)}>Este mes</${Chip}>
      ${abiertas.map(chipCarpeta)}
      ${verCerradas && cerradas.map(chipCarpeta)}
      ${cerradas.length > 0 && html`<button class="chip suave" onClick=${() => setVerCerradas(!verCerradas)}>${verCerradas ? 'Ocultar cerradas' : `Cerradas (${cerradas.length})`}</button>`}
      <button class="chip suave" onClick=${() => setHojaCarpeta({})}>＋ Carpeta</button>
    </div>
    ${actual ? html`<section class="tarjeta">
        <small class="nota">${actual.emoji} Carpeta${actual.cerrada ? ' (cerrada)' : ''} · todas las fechas</small>
        <b class="total-grande">${N.eur(total)}</b>
        <p class="nota"><strong>${actual.nombre}</strong> · ${lista.length} ${lista.length === 1 ? 'gasto' : 'gastos'}${lista.length ? ` · del ${N.etiquetaDia(lista[lista.length - 1].fecha)} al ${N.etiquetaDia(lista[0].fecha)}` : ''}</p>
        <div class="dos">
          <button class="boton suave" onClick=${() => setHojaCarpeta({ ...actual })}>Cambiar nombre</button>
          <button class="boton suave" onClick=${() => hacer({ tipo: 'carpeta.cerrar', carpeta: actual.id, cerrada: !actual.cerrada })}>${actual.cerrada ? 'Reabrir' : 'Cerrar carpeta'}</button>
        </div>
        ${!lista.length && html`<button class="boton peligro" onClick=${borrar}>Borrar carpeta</button>`}
        ${actual.cerrada && html`<p class="nota">Cerrada: ya no se ofrece al apuntar gastos, pero sus gastos siguen contando.</p>`}
      </section>
      <${PorCategoria} e=${e} lista=${lista} total=${total} titulo="Por categoría" />`
    : html`<section class="tarjeta"><small class="nota">Gastos sueltos del mes</small><b class="total-grande">${N.eur(total)}</b>
      <p class="nota">Salidas, compras puntuales… Van aparte del reparto mensual: solo cuentan para las deudas entre vosotros. Agrupa viajes o salidas en carpetas.</p></section>`}
    ${!lista.length && html`<p class="vacio">${actual ? 'Esta carpeta aún no tiene gastos. Pulsa ＋ para añadir uno.' : 'Aún no hay gastos sueltos este mes. Pulsa ＋ para añadir uno.'}</p>`}
    ${dias.map((d) => html`<div key=${d.fecha}><h2 class="seccion cap">${N.etiquetaDia(d.fecha)}${actual ? ' ' + d.fecha.slice(0, 4) : ''}</h2>
      <section class="tarjeta lista">${d.items.map((g) => html`<${FilaGasto} key=${g.id} e=${e} g=${g} abrir=${abrirGasto} />`)}</section></div>`)}
    ${hojaCarpeta && html`<${HojaCarpeta} c=${hojaCarpeta} cerrar=${(id) => { setHojaCarpeta(null); if (id) setCarpeta(id); }} />`}
  </div>`;
}
const FilaGasto = ({ e, g, abrir }) => {
  const k = N.catDe(e, g.cat), cp = g.carpeta && e.carpetas && e.carpetas[g.carpeta];
  return html`<button class="fila pulsable" onClick=${() => abrir(g)}>
    <span class="ico">${k.emoji}</span><span class="texto"><strong>${g.desc || k.nombre}</strong><small>${g.paga === 'j' ? 'Cuenta conjunta' : 'Pagó ' + N.nombre(e, g.paga) + ' · ' + N.textoReparto(e, g)}${cp ? ` · ${cp.emoji} ${cp.nombre}` : ''}</small></span><b>${N.eur(g.importe)}</b></button>`;
};
function HojaCarpeta({ c, cerrar }) {
  const [k, setK] = useState({ nombre: '', emoji: '📁', ...c });
  const guardar = () => {
    const id = k.id || nuevoId();
    if (hacer({ tipo: 'carpeta.guardar', carpeta: { id, nombre: k.nombre, emoji: k.emoji } })) cerrar(id);
  };
  return html`<${Hoja} titulo=${c.id ? 'Cambiar nombre' : 'Nueva carpeta'} cerrar=${() => cerrar(null)} pie=${html`<button class="boton" onClick=${guardar}>Guardar</button>`}>
    <label>Nombre<input type="text" maxlength="40" value=${k.nombre} placeholder="Ej. Viaje a Roma, Salidas" onInput=${(ev) => setK({ ...k, nombre: ev.target.value })} /></label>
    <label>Emoji<input type="text" maxlength="8" value=${k.emoji} onInput=${(ev) => setK({ ...k, emoji: ev.target.value })} /></label>
    <div class="chips sugerencias">${['✈️', '🏖️', '🎉', '🍻', '🎁', '🏠', '🚗', '📁'].map((x) => html`<${Chip} key=${x} activo=${k.emoji === x} onClick=${() => setK({ ...k, emoji: x })}>${x}</${Chip}>`)}</div>
    <p class="nota">Los gastos de una carpeta siguen contando en su mes y en su categoría; la carpeta solo los agrupa.</p>
  </${Hoja}>`;
}

function HojaGasto({ e, yo, mes, gasto, cerrar }) {
  const nuevo = !gasto.id;
  const [g, setG] = useState(() => {
    const x = { desc: '', cat: 'compra', paga: yo, parte: 50, fecha: N.mesDe(N.hoy()) === mes ? N.hoy() : `${mes}-01`, ...gasto };
    if (x.paga !== 'a' && x.paga !== 'b') x.paga = yo; // gastos antiguos de la conjunta: hay que elegir quién pagó
    return x;
  });
  const [otroPct, setOtroPct] = useState(String(gasto.parte ?? 50));
  const [txt, setTxt] = useState(gasto.importe ? N.enCasilla(gasto.importe) : '');
  const ref = useRef(null);
  useEffect(() => { if (nuevo && ref.current) ref.current.focus(); }, []);
  const pon = (c, v) => setG({ ...g, [c]: v });
  const opcionesCarpeta = N.carpetas(e, { cerradas: true }).filter((c) => !c.cerrada || c.id === g.carpeta);
  const guardar = () => {
    const imp = N.aCentimos(txt);
    if (!imp) return mensaje('Escribe un importe mayor que 0', 'error');
    const datos = { id: g.id || nuevoId(), fecha: g.fecha, desc: g.desc.trim(), importe: imp, paga: g.paga, parte: g.parte, cat: g.cat, carpeta: g.carpeta || null };
    const vuelta = nuevo ? [{ tipo: 'gasto.borrar', gasto: datos.id }] : [{ tipo: 'gasto.guardar', gasto: { ...gasto } }];
    if (hacer({ tipo: 'gasto.guardar', gasto: datos }, { deshacer: { texto: nuevo ? 'Gasto añadido' : 'Gasto cambiado', ops: vuelta } })) cerrar();
  };
  const borrar = () => {
    if (hacer({ tipo: 'gasto.borrar', gasto: gasto.id }, { deshacer: { texto: 'Gasto borrado', ops: [{ tipo: 'gasto.guardar', gasto: { ...gasto } }] } })) cerrar();
  };
  return html`<${Hoja} titulo=${nuevo ? 'Nuevo gasto' : 'Editar gasto'} cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>${nuevo ? 'Añadir gasto' : 'Guardar cambios'}</button>`}>
    <label>Importe (€)<input ref=${ref} class="grande" type="text" inputmode="decimal" placeholder="0,00" value=${txt} onInput=${(ev) => setTxt(ev.target.value)} /></label>
    <label>Descripción<input type="text" maxlength="60" placeholder="Ej. Mercadona, cena…" value=${g.desc} onInput=${(ev) => pon('desc', ev.target.value)} /></label>
    <div class="campo"><span>Categoría</span><div class="chips">${N.categorias(e).map((x) => html`<${Chip} key=${x.id} activo=${g.cat === x.id} onClick=${() => pon('cat', x.id)}>${x.emoji} ${x.nombre}</${Chip}>`)}</div></div>
    <div class="campo"><span>Lo ha pagado</span><div class="chips">${['a', 'b'].map((x) => html`<${Chip} key=${x} activo=${g.paga === x} onClick=${() => pon('paga', x)}>${N.nombre(e, x)}${x === yo ? ' (tú)' : ''}</${Chip}>`)}</div></div>
    <${Reparto} e=${e} g=${g} txt=${txt} poner=${(v) => pon('parte', v)} otroPct=${otroPct} setOtroPct=${setOtroPct} />
    <label>Fecha<input type="date" value=${g.fecha} onInput=${(ev) => ev.target.value && pon('fecha', ev.target.value)} /></label>
    ${opcionesCarpeta.length > 0 && html`<div class="campo"><span>Carpeta</span><div class="chips">
      <${Chip} activo=${!g.carpeta} onClick=${() => pon('carpeta', null)}>Ninguna</${Chip}>
      ${opcionesCarpeta.map((c) => html`<${Chip} key=${c.id} activo=${g.carpeta === c.id} onClick=${() => pon('carpeta', c.id)}>${c.emoji} ${c.nombre}</${Chip}>`)}</div></div>`}
    ${!nuevo && html`<button class="boton peligro" onClick=${borrar}>Borrar gasto</button>`}
  </${Hoja}>`;
}

/** Cómo se reparte un gasto: a medias, todo para uno, todo para el otro u otro porcentaje. */
function Reparto({ e, g, txt, poner, otroPct, setOtroPct }) {
  const otro = g.paga === 'a' ? 'b' : 'a';
  const parteDe = (p) => (p === 'a' ? 100 : 0); // «todo para p» en % de «a»
  const opciones = [[50, 'A medias'], [parteDe(otro), 'Todo para ' + N.nombre(e, otro)], [parteDe(g.paga), 'Todo para ' + N.nombre(e, g.paga)]];
  const enOpciones = opciones.some(([v]) => v === g.parte);
  const [libre, setLibre] = useState(!enOpciones);
  const imp = N.aCentimos(txt) || 0;
  const pt = N.partes({ importe: imp, parte: g.parte });
  const debe = otro === 'a' ? pt.a : pt.b;
  return html`<div class="campo"><span>Cómo se reparte</span>
    <div class="chips">
      ${opciones.map(([v, t]) => html`<${Chip} key=${t} activo=${!libre && g.parte === v} onClick=${() => { setLibre(false); poner(v); }}>${t}</${Chip}>`)}
      <${Chip} activo=${libre} onClick=${() => { setLibre(true); const n = Number(otroPct); if (Number.isInteger(n) && n >= 0 && n <= 100) poner(n); }}>Otro %</${Chip}>
    </div>
    ${libre && html`<label>Le toca a ${N.nombre(e, 'a')} (%)<input type="text" inputmode="numeric" value=${otroPct}
      onInput=${(ev) => { setOtroPct(ev.target.value); const n = Number(ev.target.value); if (ev.target.value !== '' && Number.isInteger(n) && n >= 0 && n <= 100) poner(n); }} />
      <small class="nota">${N.nombre(e, 'b')}: ${100 - g.parte} %</small></label>`}
    ${imp > 0 && html`<p class="nota resumen-reparto">${(debe > 0 ? `${N.nombre(e, otro)} le deberá ${N.eur(debe)} a ${N.nombre(e, g.paga)}` : 'No genera deuda') + ` · le toca a ${N.nombre(e, 'a')} ${N.eur(pt.a)} y a ${N.nombre(e, 'b')} ${N.eur(pt.b)}`}</p>`}
  </div>`;
}

/* ---------- Paga: visualización de los gastos sueltos ---------- */
function Paga({ e, mes, abrirGasto }) {
  const [gran, setGran] = useGuardado('gastos.paga.gran', 'semana');
  const [ocultos, setOcultos] = useState({});
  const [sel, setSel] = useState(null);
  const [tabla, setTabla] = useState(false);
  useEffect(() => setSel(null), [mes, gran]);
  const c = N.cuadre(e, mes);
  const periodos = N.datosPaga(e, mes, gran);
  const usados = new Set();
  for (const p of periodos) p.vals.forEach((v, i) => { if (v > 0) usados.add(i); });
  const sueltosMes = c.totalSueltos;
  const toca = { a: 0, b: 0 };
  for (const g of c.sueltos) if (g.paga !== 'j') { const pt = N.partes(g); toca.a += pt.a; toca.b += pt.b; }

  let ambito, tituloAmbito;
  if (sel != null && periodos[sel]) { ambito = periodos[sel].items; tituloAmbito = periodos[sel].titulo; }
  else if (gran === 'semana') { ambito = periodos.flatMap((p) => p.items); tituloAmbito = N.etiquetaMes(mes); }
  else { ambito = periodos[periodos.length - 1].items; tituloAmbito = N.etiquetaMes(mes); }
  ambito = ambito.filter((g) => !ocultos[N.grupoDe(e, g.cat)]);
  const porGrupo = N.GRUPOS.map(() => 0);
  for (const g of ambito) porGrupo[N.grupoDe(e, g.cat)] += g.importe;
  const totAmb = porGrupo.reduce((s, v) => s + v, 0);
  const orden = porGrupo.map((v, i) => i).filter((i) => porGrupo[i] > 0).sort((x, y) => porGrupo[y] - porGrupo[x]);

  return html`<div>
    <section class="tarjeta">
      <small class="nota">Gastado en sueltos este mes</small>
      <div class="heroe">${N.eur(sueltosMes)}</div>
      ${sueltosMes > 0 && html`<div class="par"><span>Le toca a ${N.nombre(e, 'a')}</span><b>${N.eur(toca.a)}</b></div>
        <div class="par"><span>Le toca a ${N.nombre(e, 'b')}</span><b>${N.eur(toca.b)}</b></div>`}
    </section>
    <section class="tarjeta">
      <div class="segmento"><${Chip} activo=${gran === 'semana'} onClick=${() => setGran('semana')}>Semanas</${Chip}><${Chip} activo=${gran === 'mes'} onClick=${() => setGran('mes')}>Meses</${Chip}></div>
      ${usados.size > 0 && html`<div class="chips leyenda" role="group" aria-label="Categorías (pulsa para ocultar o mostrar)">
        ${N.GRUPOS.map((nom, i) => usados.has(i) && html`<button key=${i} class=${'ley' + (ocultos[i] ? ' apagada' : '')} aria-pressed=${!ocultos[i]}
          onClick=${() => { setOcultos({ ...ocultos, [i]: !ocultos[i] }); setSel(null); }}><i class=${'mu g' + i}></i>${nom}</button>`)}</div>`}
    </section>
    <section class="tarjeta">
      <div class="par"><h3>${gran === 'semana' ? 'Por semana (€)' : 'Por mes (€)'}</h3>
        <button class="chip pequeno" onClick=${() => setTabla(!tabla)}>${tabla ? 'Ver gráfico' : 'Ver tabla'}</button></div>
      ${usados.size === 0 ? html`<p class="vacio">Aún no hay gastos sueltos en este periodo. Pulsa ＋ para apuntar uno.</p>`
        : tabla ? html`<${Tabla} periodos=${periodos} ocultos=${ocultos} />`
        : html`<${Grafico} periodos=${periodos} ocultos=${ocultos} sel=${sel} gran=${gran} elegir=${(i) => setSel(sel === i ? null : i)} />
          <small class="nota">Toca una columna para ver su detalle abajo.</small>`}
    </section>
    ${totAmb > 0 && html`<section class="tarjeta">
      <div class="par"><h3>Por categoría</h3><span class="nota cap">${tituloAmbito}</span></div>
      <div class="heroe2">${N.eur(totAmb)}</div>
      ${orden.map((i) => html`<div class="barra" key=${i}><div class="par"><span><i class=${'mu g' + i}></i>${N.GRUPOS[i]}</span><span>${N.eur(porGrupo[i])} · ${Math.round(porGrupo[i] * 100 / totAmb)}%</span></div>
        <div class="pista"><div class=${'relleno g' + i} style=${{ width: (porGrupo[i] * 100 / porGrupo[orden[0]]) + '%' }}></div></div></div>`)}
    </section>
    <h2 class="seccion">Mayores gastos</h2>
    <section class="tarjeta lista">${[...ambito].sort((x, y) => y.importe - x.importe).slice(0, 6).map((g) => html`<${FilaGasto} key=${g.id} e=${e} g=${g} abrir=${abrirGasto} />`)}</section>`}
  </div>`;
}

const paso = (x) => { const p = Math.pow(10, Math.floor(Math.log10(x))), f = x / p; return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p; };
function Grafico({ periodos, ocultos, sel, gran, elegir }) {
  const [tip, setTip] = useState(null);
  const W = 340, H = 224, L = 38, T = 24, B = 28, R = 4, pw = W - L - R, ph = H - T - B, n = periodos.length;
  const tots = periodos.map((p) => p.vals.reduce((s, v, i) => s + (ocultos[i] ? 0 : v), 0));
  const mx = Math.max(10, Math.max(...tots) / 100), st = paso(mx / 4), tope = st * Math.ceil(mx / st);
  const y = (c) => T + ph * (1 - c / 100 / tope);
  const banda = pw / n, bw = Math.min(24, banda * 0.6);
  const lineas = [];
  for (let v = 0; v <= tope + 1e-9; v += st) lineas.push(v);
  const mostrar = (i, ev) => {
    const r = ev.currentTarget.getBoundingClientRect();
    setTip({ i, x: ev.clientX ?? r.left + r.width / 2, y: ev.clientY ?? r.top + 20 });
  };
  return html`<div class="grafico">
    <svg viewBox=${`0 0 ${W} ${H}`} width="100%" role="img" aria-label=${`Gasto suelto por ${gran === 'semana' ? 'semana' : 'mes'}, apilado por categoría`}>
      ${lineas.map((v) => html`<g key=${v}><line x1=${L} x2=${W - R} y1=${y(v * 100)} y2=${y(v * 100)} class=${v === 0 ? 'base' : 'guia'} />
        <text x=${L - 6} y=${y(v * 100) + 4} text-anchor="end" class="eje">${Math.round(v)}</text></g>`)}
      ${periodos.map((p, i) => {
        const cx = L + banda * (i + 0.5), x = cx - bw / 2;
        const idx = []; p.vals.forEach((v, g) => { if (!ocultos[g] && v > 0) idx.push(g); });
        let acum = 0;
        const trozos = idx.map((g, k) => {
          const v = p.vals[g], y1 = y(acum + v), y0 = y(acum), alto = Math.max(1, y0 - y1 - (k === 0 ? 0 : 2));
          acum += v;
          if (k === idx.length - 1) {
            const r = Math.min(4, alto / 2, bw / 2);
            return html`<path key=${g} class=${'g' + g} d=${`M${x},${y1 + alto} V${y1 + r} Q${x},${y1} ${x + r},${y1} H${x + bw - r} Q${x + bw},${y1} ${x + bw},${y1 + r} V${y1 + alto} Z`} />`;
          }
          return html`<rect key=${g} class=${'g' + g} x=${x} y=${y1} width=${bw} height=${alto} />`;
        });
        return html`<g key=${i}>
          <g class=${sel != null && sel !== i ? 'atenuado' : ''}>${trozos}</g>
          ${tots[i] > 0 && html`<text x=${cx} y=${y(tots[i]) - 6} text-anchor="middle" class="eje fuerte">${N.eur0(tots[i])}</text>`}
          <text x=${cx} y=${H - 9} text-anchor="middle" class=${'eje' + (sel === i ? ' fuerte' : '')}>${p.etiqueta}</text>
          <rect class="zona" x=${L + banda * i} y=${T} width=${banda} height=${ph + B} tabindex="0" role="button"
            aria-label=${`${p.titulo}: ${N.eur(tots[i])}${sel === i ? ' (seleccionado)' : ''}`}
            onPointerMove=${(ev) => mostrar(i, ev)} onPointerLeave=${() => setTip(null)}
            onFocus=${(ev) => mostrar(i, ev)} onBlur=${() => setTip(null)}
            onClick=${() => { setTip(null); elegir(i); }}
            onKeyDown=${(ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); elegir(i); } }} />
        </g>`;
      })}
    </svg>
    ${tip && html`<${Tip} p=${periodos[tip.i]} ocultos=${ocultos} x=${tip.x} y=${tip.y} />`}
  </div>`;
}
function Tip({ p, ocultos, x, y }) {
  const filas = p.vals.map((v, g) => ({ g, v })).filter((f) => f.v > 0 && !ocultos[f.g]).sort((a, b) => b.v - a.v);
  const tot = filas.reduce((s, f) => s + f.v, 0);
  const ancho = 200, izq = Math.max(8, Math.min(innerWidth - ancho - 8, x - ancho / 2));
  return html`<div class="tip" style=${{ left: izq + 'px', top: Math.max(8, y - 30 - filas.length * 20 - 40) + 'px', width: ancho + 'px' }}>
    <strong class="cap">${p.titulo}</strong>
    ${filas.map((f) => html`<div class="par" key=${f.g}><span><i class=${'mu g' + f.g}></i>${N.GRUPOS[f.g]}</span><b>${N.eur(f.v)}</b></div>`)}
    <div class="par total"><span>Total</span><b>${N.eur(tot)}</b></div>
  </div>`;
}
function Tabla({ periodos, ocultos }) {
  const gs = N.GRUPOS.map((n, i) => i).filter((i) => !ocultos[i] && periodos.some((p) => p.vals[i] > 0));
  return html`<div class="desplazable"><table class="tabla">
    <thead><tr><th>Periodo</th>${gs.map((i) => html`<th key=${i}>${N.GRUPOS[i]}</th>`)}<th>Total</th></tr></thead>
    <tbody>${periodos.map((p, k) => html`<tr key=${k}><td class="cap">${p.titulo}</td>${gs.map((i) => html`<td key=${i}>${p.vals[i] ? N.eur(p.vals[i]) : '–'}</td>`)}
      <td><b>${N.eur(gs.reduce((s, i) => s + p.vals[i], 0))}</b></td></tr>`)}</tbody>
  </table></div>`;
}

/* ---------- Ajustes ---------- */
function Ajustes({ e, yo, cerrar }) {
  const [nom, setNom] = useState(N.nombre(e, yo));
  const [nueva, setNueva] = useState(null);
  const [salud, setSalud] = useState(null);
  useEffect(() => { fetch('/api/salud').then((r) => r.json()).then(setSalud).catch(() => {}); }, []);
  const propias = Object.values(e.categorias);
  const copiarCsv = async () => {
    try {
      const t = await (await fetch('/api/csv')).text();
      await navigator.clipboard.writeText(t.replace(/^﻿/, ''));
      mensaje('Copiado: pégalo en una hoja de cálculo');
    } catch { mensaje('No se pudo copiar (¿sin conexión?)', 'error'); }
  };
  return html`<${Hoja} titulo="Ajustes" cerrar=${cerrar}>
    <label>Tu nombre<input type="text" maxlength="24" value=${nom} onInput=${(ev) => setNom(ev.target.value)}
      onChange=${() => nom.trim() && nom.trim() !== N.nombre(e, yo) && hacer({ tipo: 'persona.renombrar', nombre: nom.trim() })} /></label>
    <h3>Categorías añadidas</h3>
    ${propias.length === 0 && html`<p class="nota">Las 11 de siempre están fijas. Puedes añadir las tuyas.</p>`}
    <div class="lista">${propias.map((c) => html`<div class="fila" key=${c.id}><span class="ico">${c.emoji}</span>
      <div class="texto"><strong>${c.nombre}</strong><small><i class=${'mu g' + c.grupo}></i>se suma a «${N.GRUPOS[c.grupo]}» en Paga</small></div>
      <button class="icono" aria-label=${'Editar ' + c.nombre} onClick=${() => setNueva({ ...c })}>✎</button>
      <button class="icono" aria-label=${'Borrar ' + c.nombre} onClick=${() => hacer({ tipo: 'categoria.borrar', categoria: c.id }, { deshacer: { texto: 'Categoría borrada', ops: [{ tipo: 'categoria.guardar', categoria: { ...c } }] } })}>🗑</button></div>`)}</div>
    <button class="boton suave" onClick=${() => setNueva({ nombre: '', emoji: '🏷️', grupo: 7 })}>＋ Añadir categoría</button>
    ${nueva && html`<${HojaCategoria} c=${nueva} cerrar=${() => setNueva(null)} />`}
    <h3>Copias y datos</h3>
    <a class="boton suave" href="/api/copia" download>Descargar copia de seguridad</a>
    <button class="boton suave" onClick=${copiarCsv}>Copiar todos los datos (CSV)</button>
    <p class="nota">El portátil guarda una copia cada noche (30 días) y una cada mes que no se borra.
      ${salud && salud.copia ? ` Última copia nocturna: ${salud.copia}.` : ''}${salud && salud.copiaError ? ' ⚠ La última copia falló.' : ''}</p>
    <h3>Estado</h3>
    <p class="nota">${S.conectado ? 'Conectado' : 'Sin conexión'}${S.cola.length ? ` · ${S.cola.length} cambios por enviar` : ' · todo enviado'}${salud ? ` · versión ${salud.version}` : ''}</p>
  </${Hoja}>`;
}
function HojaCategoria({ c, cerrar }) {
  const [k, setK] = useState(c);
  const guardar = () => { if (hacer({ tipo: 'categoria.guardar', categoria: { id: k.id || nuevoId(), nombre: k.nombre, emoji: k.emoji.trim() || '🏷️', grupo: k.grupo } })) cerrar(); };
  return html`<${Hoja} titulo=${c.id ? 'Editar categoría' : 'Nueva categoría'} cerrar=${cerrar} pie=${html`<button class="boton" onClick=${guardar}>Guardar</button>`}>
    <label>Nombre<input type="text" maxlength="30" value=${k.nombre} placeholder="Ej. Regalos" onInput=${(ev) => setK({ ...k, nombre: ev.target.value })} /></label>
    <label>Emoji<input type="text" maxlength="8" value=${k.emoji} onInput=${(ev) => setK({ ...k, emoji: ev.target.value })} /></label>
    <div class="campo"><span>En la gráfica de Paga se suma a</span><div class="chips">${N.GRUPOS.map((g, i) => html`<${Chip} key=${i} activo=${k.grupo === i} onClick=${() => setK({ ...k, grupo: i })}><i class=${'mu g' + i}></i>${g}</${Chip}>`)}</div></div>
  </${Hoja}>`;
}

/* ---------- Alta: elegir quién eres ---------- */
function Alta({ personas }) {
  const libres = ['a', 'b'].filter((p) => !personas[p].ligada);
  const [noms, setNoms] = useState(() => Object.fromEntries(libres.map((p) => [p, personas[p].nombre || ''])));
  return html`<main class="centro"><h1>¡Hola! 👋</h1><p>¿Quién eres? Solo se elige una vez: queda unido a tu cuenta de Tailscale.</p>
    ${libres.map((p) => html`<div class="tarjeta" key=${p}>
      <label>Nombre<input type="text" maxlength="24" value=${noms[p]} placeholder=${p === 'a' ? 'Persona 1' : 'Persona 2'} onInput=${(ev) => setNoms({ ...noms, [p]: ev.target.value })} /></label>
      <button class="boton" onClick=${() => hacer({ tipo: 'persona.reclamar', persona: p, nombre: (noms[p] || '').trim() || (p === 'a' ? 'Persona 1' : 'Persona 2') })}>Soy ${(noms[p] || '').trim() || (p === 'a' ? 'Persona 1' : 'Persona 2')}</button>
    </div>`)}
  </main>`;
}

/* ---------- App ---------- */
const PESTANAS = [['transferir', '🏦', 'Transferir'], ['mes', '📅', 'Mes'], ['gastos', '🧾', 'Gastos'], ['paga', '📈', 'Paga']];

function App() {
  const s = useAlmacen();
  const [tab, setTab] = useGuardado('gastos.pestana', 'transferir');
  const [mes, setMes] = useGuardado('gastos.mes', mesHoy());
  const [hoja, setHoja] = useState(null); // { tipo, datos }
  const [carpeta, setCarpeta] = useGuardado('gastos.carpeta', null);
  const sv = s.servidor;
  const aviso = s.aviso && html`<div class=${'aviso ' + s.aviso.tipo} role="status">${s.aviso.texto}
    ${s.aviso.accion && html`<button onClick=${s.aviso.accion.fn}>${s.aviso.accion.texto}</button>`}
    <button class="icono" aria-label="Cerrar aviso" onClick=${cerrarAviso}>✕</button></div>`;

  if (!sv) return html`<main class="centro"><h1>Gastos a dos</h1><p>${s.conectado ? 'Cargando…' : 'Sin conexión con el portátil de casa. Comprueba que Tailscale está activo.'}</p></main>`;
  if (sv.modo === 'sin-identidad') return html`<main class="centro"><h1>Gastos a dos</h1><p>Abre la app a través de Tailscale, con tu cuenta, para ver vuestros datos.</p></main>`;
  if (sv.modo === 'completo') return html`<main class="centro"><h1>Ya sois dos</h1><p>Esta app es para dos personas y ya están registradas.</p></main>`;
  if (sv.modo === 'alta') return html`${h(Alta, { personas: sv.personas })}${aviso}`;
  const e = s.estado, yo = sv.yo;
  if (!e) return html`<main class="centro"><p>Cargando…</p></main>`;
  const abrirGasto = (g) => setHoja({ tipo: 'gasto', datos: g || {} });
  const abrirConcepto = (k) => setHoja({ tipo: 'concepto', datos: k });
  const pendientes = s.cola.length;

  return html`<div class="app">
    <header class="cab">
      <h1>Gastos a dos</h1>
      <span class=${'sinc' + (s.conectado ? '' : ' fuera')} title=${s.conectado ? 'Conectado' : 'Sin conexión'}>${s.conectado ? (pendientes ? `↑ ${pendientes}` : '') : `sin conexión${pendientes ? ' · ' + pendientes + ' por enviar' : ''}`}</span>
      <button class="yo" onClick=${() => setHoja({ tipo: 'ajustes' })} aria-label="Ajustes">👤 ${N.nombre(e, yo)}</button>
    </header>
    <main>
      <${NavMes} mes=${mes} poner=${setMes} />
      ${tab === 'transferir' && h(Transferir, { e, yo, mes })}
      ${tab === 'mes' && h(Mes, { key: mes, e, yo, mes, abrirConcepto })}
      ${tab === 'gastos' && h(Gastos, { e, yo, mes, abrirGasto, carpeta, setCarpeta })}
      ${tab === 'paga' && h(Paga, { e, mes, abrirGasto })}
    </main>
    <button class="mas" aria-label=${tab === 'mes' ? 'Añadir concepto' : 'Añadir gasto'} onClick=${() => (tab === 'mes' ? abrirConcepto(null) : abrirGasto(tab === 'gastos' && carpeta && e.carpetas && e.carpetas[carpeta] && !e.carpetas[carpeta].cerrada ? { carpeta } : null))}>＋</button>
    <nav class="pestanas">${PESTANAS.map(([id, ico, nom]) => html`<button key=${id} class=${tab === id ? 'activa' : ''} aria-current=${tab === id ? 'page' : null}
      onClick=${() => { setTab(id); scrollTo(0, 0); }}><span aria-hidden="true">${ico}</span>${nom}</button>`)}</nav>
    ${hoja && hoja.tipo === 'gasto' && h(HojaGasto, { e, yo, mes, gasto: hoja.datos, cerrar: () => setHoja(null) })}
    ${hoja && hoja.tipo === 'concepto' && h(HojaConcepto, { e, mes, concepto: hoja.datos, cerrar: () => setHoja(null) })}
    ${hoja && hoja.tipo === 'ajustes' && h(Ajustes, { e, yo, cerrar: () => setHoja(null) })}
    ${aviso}
  </div>`;
}

render(h(App), document.getElementById('app'));
iniciar();
if ('serviceWorker' in navigator) navigator.serviceWorker.register('/sw.js').catch(() => {});
