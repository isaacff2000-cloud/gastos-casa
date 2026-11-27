# Gastos a dos · servidor de casa — documento de diseño

Rehacer la app de gastos de Apps Script (Google Sheets) como la del menú semanal: un servidor
en el portátil de casa y una app instalable en los móviles, sin depender de Google.
Estado (22-nov-2026): **instalada en el portátil y funcionando** en el puerto 8443 de Tailscale, junto al
menú (que sigue intacto). Repositorio público `isaacff2000-cloud/gastos-casa`; GitHub pasó las pruebas,
la prueba con dos móviles y construyó la imagen. Importados los 14 conceptos (2.705 €/mes) desde
noviembre de 2026. Pendiente: que cada uno elija «Soy …» en su móvil, poner las nóminas en la pestaña
Mes y, cuando os fiéis, dejar de usar la app de Apps Script. La fase 3 (copia a Drive) está escrita pero
sin probar.

## 1. Qué se mantiene y qué cambia

**Se mantiene igual (lo que ya validaste):** el reparto (todo es común; lo que sobra se divide a
partes iguales y los dos acabáis con el mismo saldo libre), las cuatro pestañas **Transferir · Mes ·
Gastos · Paga**, el cálculo en tiempo real al escribir, los conceptos fijos con nombre y cuenta
fijos, las nóminas e importes que se arrastran de un mes a otro, la gráfica de Paga por semanas y
meses, los colores validados, el modo oscuro y los nombres de las pestañas.

**Cambia por dentro:**

| Antes (Apps Script) | Ahora (portátil) |
|---|---|
| Datos en una hoja de Google, un JSON por fila | SQLite en el portátil: un registro de operaciones con id propio |
| Si dos editáis a la vez, gana el último que guarda (documento entero) | Cada cambio es una operación pequeña; no se pierden ni se repiten |
| Lectura cada 5 s (sondeo) | Avisos en directo (SSE) |
| Sin cobertura no funciona | Funciona sin cobertura; los cambios esperan y se envían al volver |
| «Soy Isaac / Ana» y el correo de Google | La identidad la pone Tailscale; quedáis ligados a vuestra cuenta |
| El importe heredado se deduce mirando meses anteriores | Cada importe tiene fecha de inicio explícita («desde nov») |
| Dependéis de Google y de Apps Script | Solo del portátil y de Tailscale |

## 2. Decisiones de diseño (revisables)

Las he tomado yo; dime cuáles quieres cambiar.

1. **Registro de operaciones + un único módulo de reglas.** El servidor guarda la lista de cambios
   (cada uno con id propio, orden global y autor) y el estado se obtiene aplicándolos en orden con
   el mismo código en el servidor y en el móvil (`src/nucleo.js`). *Se aparta de menu-casa en un
   punto:* allí el servidor aplica los cambios con SQL y el móvil los reimplementa aparte
   (`local.js`), lo que obliga a mantener dos copias de la misma lógica. Aquí los datos son pocos
   (unos miles de operaciones en años), así que compensa tener una sola. Se conserva el resto:
   operaciones idempotentes, SQLite, SSE, cola sin cobertura.
2. **Dinero en céntimos enteros**, nunca decimales. Fechas como texto `AAAA-MM-DD`, meses `AAAA-MM`.
3. **Importes con vigencia.** Cada serie (un gasto fijo o la nómina de cada uno) es una lista
   «desde el mes X vale Y». El importe de un mes es el de la entrada más reciente con inicio ≤ ese
   mes. Meses anteriores a la primera entrada: «sin datos». Puede haber además un **cambio puntual**
   para un solo mes, que gana a lo anterior.
   - Al editar un importe en el mes M, el valor por defecto es **desde M en adelante**; un
     interruptor «solo este mes» crea el cambio puntual (tu respuesta).
   - Los meses posteriores que ya tuvieran su propia entrada la conservan.
4. **Conceptos fijos:** nombre, categoría y cuenta de pago (conjunta / Isaac / Ana). Eliminar un
   concepto lo **archiva desde un mes**: los meses anteriores siguen mostrándolo. Cambiar la cuenta o
   la categoría de un concepto afecta a todos los meses (como en la app actual); la app lo avisa.
5. **Gastos sueltos («Paga») y fijos entran en el mismo cuadre**, como ahora.
6. **Transferencias:** se registran por mes y persona. «Pendiente» = lo que toca − lo ya hecho. Si
   el resultado es negativo (alguien pagó mucho de su bolsillo), se muestra «la conjunta te debe X»
   en lugar de un importe con signo menos.
7. **Categorías:** las 11 actuales, fijas y con los colores validados, **más las que añadáis**
   (nombre y emoji). Cada categoría nueva se asigna a uno de los 8 grupos de color de la gráfica
   (por defecto «Otros»), así los colores siguen validados. Las nuevas se pueden renombrar o borrar
   si no están en uso; las 11 originales no.
8. **Un mes con transferencias ya hechas** no se bloquea: si cambias importes, se recalcula y
   aparece el aviso «este mes ya tiene transferencias; el pendiente ha cambiado».
9. **Borrar** cualquier cosa muestra «Deshacer» durante unos segundos (es una operación inversa).
10. **Cualquiera de los dos puede editarlo todo**, como ahora.

## 3. Reparto: la fórmula (sin cambios)

Por mes: `I = nómina A + nómina B`, `E = gastos fijos + sueltos`, `F = I − E`,
`Pa, Pb` = lo que cada uno paga desde su cuenta personal.
`ta = redondeo(nóminaA − F/2 − Pa)`, `tb = (E − Pa − Pb) − ta`.
Dejar en cuenta personal = `nómina − transferencia`; de ello, **recibos pagados desde ella** = `P`
y **libre** = `F/2` (diferencia máxima entre los dos: 1 céntimo, por el redondeo).
La prueba de equivalencia usa miles de casos aleatorios contra la fórmula actual de `index.html`.

## 4. Arquitectura

Copia la de menu-casa:

```
gastos-casa/
  src/
    nucleo.js      reglas: fechas, dinero, validar/aplicar operaciones, cuadre del mes (servidor + móvil)
    db.js          SQLite (node:sqlite): tablas meta y op; estado en memoria
    servidor.js    http + SSE + estáticos + cabeceras de seguridad
    importar.js    .xlsx de Google → operaciones
    xlsx.js        lector mínimo de .xlsx (copiado de menu-casa)
    tareas.js      copias nocturnas y mensuales
    cli.js         servir | importar | copia | restaurar | csv | resumen
  web/             PWA: Preact + htm en vendor/, sin compilar
    index.html, app.js, app.css, almacen.js (estado, cola, SSE), sw.js, manifest, iconos/
  deploy/          Containerfile, gastos-casa.container, instalar.sh, comprobar_limpio.sh
  test/            node:test + e2e_app.py (Playwright, dos móviles) + fixtures inventadas
  .github/workflows/ci.yml
```

Node 22.13+, **sin dependencias**. Datos fuera del repo, en `~/.local/share/gastos-casa`.

### Tablas
```
meta(clave, valor)
op(seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, ts, por, tipo, datos JSON)
```
El estado se reconstruye al arrancar aplicando las operaciones y se mantiene en memoria.
`validar()` puede rechazar una operación nueva; `aplicar()` nunca falla, para que al reproducir
el historial con una versión nueva no se rompa nada. Cada operación lleva versión de esquema.

### Estado (lo que recibe el móvil)
```
personas {a:{nombre}, b:{nombre}}      yo: 'a' | 'b' | null (el login no sale del servidor)
conceptos [{id, nombre, cat, cuenta, orden, hasta?}]
series { 'c:alquiler': {desde:[{mes,importe}], puntual:{mes:importe}}, 'n:a': …, 'n:b': … }
gastos [{id, fecha, desc, importe, cuenta, cat}]
transferencias [{id, mes, de, importe, fecha}]
categorias [{id, nombre, emoji, grupo}]   // solo las añadidas
```

### Operaciones (todas con `id` único; el servidor pone `por` y `ts`)
`valor.desde` · `valor.puntual` · `valor.quitarPuntual` · `concepto.guardar` ·
`concepto.archivar` · `concepto.reordenar` · `gasto.guardar` · `gasto.borrar` ·
`transferencia.registrar` · `transferencia.borrar` · `categoria.guardar` · `categoria.borrar` ·
`persona.reclamar` · `persona.renombrar`.
Un id repetido se confirma sin aplicarse otra vez. Una operación inválida se rechaza con mensaje
claro y se descarta de la cola del móvil.

### API
`GET /api/salud` · `GET /api/estado` (ETag = versión de la app + último `seq`) · `POST /api/ops` ·
`GET /api/eventos` (SSE) · `GET /api/copia` (descarga de la base) · `GET /api/csv`.

### Sin cobertura y escritura
Igual que menu-casa: estado y cola en el móvil, operaciones aplicadas al instante y reenviadas al
volver la red. **Ningún campo en edición se sobrescribe** por cambios que lleguen de fuera: cada
casilla guarda su borrador mientras tiene el foco y confirma al salir. Hay prueba específica.

## 5. Pantallas

- **Transferir.** Mes, tres cifras (ingresos, gastos, libre c/u), tarjeta por persona: transferir a
  la conjunta, hecho, pendiente, y «dejar en tu cuenta personal» = recibos que pagas desde ella +
  libre. Botón «Ya he transferido X». Lista de transferencias. Gasto por categoría.
- **Mes.** La hoja viva: nóminas y todos los conceptos con casillas; resultado fijo arriba que se
  recalcula mientras escribes; en gris lo heredado; al cambiar una cifra aparece «desde este mes /
  solo este mes». Añadir, editar y archivar conceptos.
- **Gastos.** Gastos sueltos por día, botón +, editar, borrar con deshacer.
- **Paga.** Cifra libre y medidor de margen, semanas/meses, gráfica apilada con leyenda filtrable,
  tabla alternativa, detalle por categoría y mayores gastos.
- **Ajustes** (botón con tu nombre): nombre, categorías añadidas, descargar copia, copiar CSV,
  estado de la sincronización y versión.

## 6. Seguridad

- **Nada en internet.** `tailscale serve` (no Funnel). El servidor escucha solo en
  `127.0.0.1:8788` dentro del contenedor.
- **Quién eres:** cabecera `Tailscale-User-Login` que añade Serve. Escribe solo quien esté ligado
  como Isaac o Ana; el primer acceso de cada uno elige «Soy Isaac/Ana» y queda ligado a su cuenta de
  Tailscale. Una tercera persona ve «Ya sois dos». **Sin identidad no se ve ningún dato** (cambiado
  respecto a la primera versión del diseño, que proponía solo lectura: es más seguro).
  *Mejora sobre menu-casa:* la cabecera `x-quien` (que cualquiera podía poner) **solo existe con
  `GASTOS_PRUEBAS=1`**, que se usa en las pruebas y nunca en el servicio.
- **Contra webs maliciosas:** `POST` solo con `Content-Type: application/json` y comprobación de
  `Origin`/`Sec-Fetch-Site`; cabeceras `Content-Security-Policy` estricta (solo recursos propios),
  `nosniff`, `no-referrer`, `frame-ancestors 'none'`. Nada de `innerHTML`.
- **Límites:** cuerpo 256 KB, ≤500 operaciones por envío, textos acotados, importes y fechas
  validados.
- **Contenedor:** sistema de archivos de solo lectura, sin capacidades, `NoNewPrivileges`, usuario
  1000, solo el volumen de datos.
- **Repositorio público sin datos:** `deploy/comprobar_limpio.sh` en CI (correos, claves,
  `.db`, `.xlsx`, nombre de tu red `…ts.net`, identificadores de hojas de Google). La documentación
  usa `<nombre>.<tu-red>.ts.net`.
- **Riesgo residual que acepto con AutoUpdate:** quien controlara tu cuenta de GitHub podría
  publicar una imagen maliciosa que el portátil instalaría sola. Mitigación: verificación en dos
  pasos en GitHub. Es el mismo riesgo que ya tiene menu-casa.
- **Copias:** contienen vuestras finanzas; carpeta de datos `0700`.

## 7. Copias de seguridad

1. **Cada noche** (03:30, o al arrancar si estaba apagado): copia consistente (`VACUUM INTO`),
   se guardan 30. **El día 1 de cada mes** se guarda además una copia **mensual** que no se borra.
2. **Botón «Descargar copia»** en Ajustes (con aviso si hace más de 40 días que no la bajas).
3. **Copia mensual a Drive** (tu petición, opcional y aparte): las copias mensuales se suben a una
   carpeta de tu Drive con `rclone` (imagen oficial en un contenedor, nada que instalar) y un
   temporizador de usuario: `deploy/copia_drive.sh configurar | activar | ahora | estado | quitar`. Se autoriza **una vez** en el
   portátil (`rclone config`, permiso «drive.file»: solo ve los archivos que crea él). El token se
   queda en el portátil, nunca en el repositorio, y la app no depende de esto para funcionar. Si
   prefieres no dejar un permiso de Google en el portátil, la alternativa es solo el botón.
4. **Restaurar:** `node src/cli.js restaurar copia.db` con el servicio parado (se documenta).

## 8. Convivencia con la app del menú (no se toca)

| | Menú (ya instalada) | Gastos (nueva) |
|---|---|---|
| Puerto local | 8787 | **8788** |
| HTTPS de Tailscale | 443 | **8443** → `https://bazzite.<red>.ts.net:8443` |
| Contenedor | `menu-casa` | `gastos-casa` |
| Quadlet | `menu-casa.container` | `gastos-casa.container` |
| Datos | `~/.local/share/menu-casa` | `~/.local/share/gastos-casa` |
| Imagen | `ghcr.io/…/menu-casa` | `ghcr.io/…/gastos-casa` |

Reglas del instalador: **no reinicia ni modifica** `menu-casa`; no usa `tailscale serve reset`;
publica con `tailscale serve --bg --https=8443 http://127.0.0.1:8788` (sin `sudo`, porque
`--operator=isaac`); **no repite** lo de la suspensión; comprueba antes y después que
`tailscale serve status` sigue mostrando el 443 → 8787 y que `menu-casa` responde en `/api/salud`;
se detiene si el 8788 ya estuviera ocupado. Cada puerto es un origen distinto para el navegador, así
que las dos apps no comparten almacenamiento ni cachés.

## 9. Migración

Según tu respuesta: **solo los conceptos y empezar de cero.**
- Descargas «Gastos a dos» como `.xlsx`; el instalador lo importa con
  `importar hoja.xlsx --desde AAAA-MM`.
- Se importan los **14 conceptos** (nombre, categoría, cuenta, orden, importe) como entrada
  «desde AAAA-MM», y las **nóminas del último mes con datos** como su entrada inicial (*suposición:
  dímelo si prefieres introducirlas tú*).
- Se descartan gastos sueltos, transferencias y la lista de miembros de la hoja; cada uno se liga
  de nuevo con «Soy Isaac/Ana».
- **Prueba con tus datos reales (hecha, 22-nov):** exporté la hoja «Gastos a dos» de tu Drive como
  `.xlsx` (solo lectura) y la importé aquí, fuera del repositorio. Resultado: 14 conceptos, 2.705 €
  al mes, nombre de Isaac; no había nóminas guardadas (se ponen en la pestaña Mes) y se descarta 1
  gasto suelto de prueba. Cuadra concepto a concepto con la hoja. Ojo: «Móvil Ana» figura en tu hoja
  como pagado desde la cuenta de Isaac; se ha respetado. Se repetirá con la descarga del día del cambio.

## 10. Fases (cada una se puede usar al terminar)

La app de Apps Script **sigue funcionando y no se toca** hasta el paso de cambio.

**Fase 1 — «El cuadre en el portátil».** Núcleo con pruebas de equivalencia, servidor, importador,
PWA con **Transferir, Mes y Gastos**, identidad por Tailscale, sin cobertura, contenedor, CI, quadlet
e instalador. *Se puede usar* para todo el ritual mensual (nóminas, importes, gastos, transferencias).
Hasta la fase 2 no tiene gráficas de Paga.

**Fase 2 — «Paga y Ajustes».** Pestaña Paga completa (medidor, semanas/meses, leyenda, tabla,
detalle), Ajustes (categorías nuevas, descargar copia, CSV), copias nocturnas y mensuales,
«Deshacer». **Aquí la nueva iguala a la actual** y toca hacer el cambio: importación final, probar
una semana en paralelo con datos de prueba y dejar la hoja antigua archivada.

**Fase 3 — «Copia mensual a Drive» (opcional) y pulido.** Temporizador de `rclone`, avisos de
copia, revisión de accesibilidad y de iPhone, README final.

**Paso de cambio (tras la fase 2).** Último `.xlsx`, importación, ambos eligen «Soy …», se comprueba
el primer mes completo y se archiva la app antigua. No se apunta nada en las dos a la vez.

## 11. Pruebas

- `node:test`: equivalencia del cuadre con la fórmula actual (casos aleatorios), vigencias y
  cambios puntuales, idempotencia y orden de operaciones, reproducción determinista del historial,
  validaciones, límites, CSRF y cabeceras, identidad, importador con un `.xlsx` inventado, copias y
  rotación, API y SSE.
- `test/e2e_app.py` (Playwright, **dos móviles a la vez**): cambios del otro sin recargar, escribir
  sin que se borre lo tecleado, sin cobertura y reconexión, misma operación enviada dos veces, los
  dos editando la misma cifra, «solo este mes», transferencias, deshacer, instalación y caché.
- **Límites de lo que puedo probar aquí:** hay Chromium, pero **no WebKit (iPhone) ni Podman**.
  El contenedor se construye y prueba en GitHub Actions y se valida de verdad al instalarlo en el
  portátil. Lo que dependa de Safari en iPhone lo tendrá que comprobar quien lo use.

## 12. Lo que tienes que hacer tú (y cuándo)

1. **Ahora:** decirme si el diseño te vale o qué cambiar, y confirmar las suposiciones del apartado 13.
2. **Al acabar la fase 1 (te aviso):** crear el repositorio **vacío y público**
   `github.com/isaacff2000-cloud/gastos-casa` (sin README ni licencia). Yo lo conecto y subo el código.
3. **Tras el primer push:** en GitHub → Packages → `gastos-casa` → *Package settings* → visibilidad
   **Public** (y enlazarlo al repositorio).
4. **Para la prueba con datos reales:** adjuntar aquí el `.xlsx` de «Gastos a dos».
5. **Instalar en el portátil:** pegarle a Claude Code el texto que te prepararé (lo escribo cuando
   la imagen exista).
6. **Ana:** abrir `https://bazzite.<tu-red>.ts.net:8443` en su móvil (con Tailscale activo), añadirlo a
   la pantalla de inicio y elegir «Soy Ana».
7. **Fase 3, solo si quieres la copia a Drive:** ejecutar una vez `rclone config` en el portátil
   (te guío paso a paso; abre el navegador para autorizar).
8. Activar la verificación en dos pasos de GitHub si aún no la tienes.

Confirmación: **no creo ni borro nada fuera de mi espacio de trabajo sin pedírtelo antes**
(repositorio, paquetes, Drive, hojas, portátil).

## 13. Suposiciones (tomadas como buenas el 22-nov)

- Ana ya está en vuestra red de Tailscale y entra con su propia cuenta.
- Los dos móviles pueden ser Android o iPhone; no se ha podido probar Safari.
- Se importan las nóminas del último mes si existen (en vuestra hoja no hay ninguna).
- Las categorías nuevas se asignan a uno de los 8 grupos de color existentes.
- Repositorio y app: `gastos-casa` (la app sigue llamándose «Gastos a dos»).
- Desde un dispositivo sin cuenta de Tailscale (o etiquetado) la app no muestra datos.

## 14. Qué se ha probado y qué no

| Probado aquí | Pendiente (necesita el portátil o GitHub) |
|---|---|
| 14 pruebas unitarias (cuadre idéntico al de la app actual en 2000 meses al azar, vigencias, operaciones repetidas, validaciones, identidad, protección contra otras webs, cabeceras, importador, copias) | Construir la imagen (GitHub Actions) |
| 36 comprobaciones con dos móviles a la vez en Chromium (alta, tiempo real, escribir sin perder texto, solo este mes, los dos cambiando la misma cifra, deshacer, sin cobertura, transferencias, Paga, Ajustes, app instalada sin red) | Podman, quadlet, `tailscale serve` en el 8443 y convivencia con el menú |
| Importación con la hoja real | Identidad real de Tailscale Serve |
| Sintaxis de los scripts de instalación | Safari en iPhone · copia a Drive con rclone |

## 15. Cambios tras la instalación (22-nov-2026)

- **0.2.0 · Carpetas y arrastre.** Los gastos sueltos se pueden agrupar en carpetas (viajes, salidas…)
  que muestran su total aunque abarquen varios meses; se cierran cuando ya no se usan. Lo que alguien
  no transfiere a la conjunta en un mes se suma a los siguientes (y lo transferido de más se
  descuenta); las devoluciones de la conjunta se apuntan como transferencia en sentido contrario.
- **0.3.0 · Gastos sueltos como deudas entre los dos.** Cada gasto suelto dice quién lo pagó y cómo se
  reparte (a medias por defecto, todo para uno, todo para el otro u otro porcentaje). En la pestaña
  Gastos sale quién le debe a quién y se salda apuntando un pago. **Los gastos sueltos ya no entran en
  el reparto mensual**: Transferir y Mes quedan con nóminas y gastos fijos. Paga pierde el medidor del
  margen libre y muestra lo gastado y lo que le toca a cada uno. No hay opción de cuenta conjunta para
  los gastos sueltos; los antiguos de la conjunta se conservan sin generar deuda.
- **0.3.1 · Copia del móvil tras actualizar.** El ETag de `/api/estado` solo dependía del `seq`: tras
  instalar la 0.3.0 sin ningún cambio nuevo, el móvil recibía «304» y seguía con su copia de la 0.2.0,
  cuyos gastos no traían «paga» ni «parte» (salía «Isaac undefined % · Ana NaN %» y el saldo no los
  contaba). Ahora el ETag lleva también la versión, así que cada actualización trae los datos de nuevo.
- Actualización: el portátil instala solo la versión nueva cada noche (`podman-auto-update.timer`,
  hacia las 00:05); para hacerlo al momento, `podman auto-update` como isaac.
- **0.4.0 · Cada carpeta lleva sus cuentas.** Hasta ahora las carpetas solo agrupaban gastos, pero lo que
  os debéis salía en un único total que lo juntaba todo. Ahora cada carpeta tiene su propio saldo y sus
  propios pagos, y los gastos sin carpeta forman otro apartado. Dentro de una carpeta, la tarjeta de deudas
  muestra solo lo de esa carpeta y «Saldar» apunta el pago en ella. Fuera, sale la lista de apartados con
  algo pendiente (cada uno con su «Saldar»), el total juntándolo todo como referencia y «Saldar todo», que
  apunta un pago por apartado (un solo Bizum, pero cada carpeta queda a cero). Al apuntar un pago se elige
  qué apartado salda. Cerrar una carpeta no borra lo que se debe en ella: sigue en la lista hasta saldarlo,
  y una carpeta con pagos no se puede borrar. **Sin migración:** los pagos de antes no llevaban carpeta y
  cuentan para los gastos sin carpeta, que es lo que saldaban; el historial se rehace igual. El CSV añade
  la carpeta de cada pago.
