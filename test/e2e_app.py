"""La app en dos móviles a la vez (Uno y Dos), con los datos inventados de test/fixtures.
Uso: python3 test/e2e_app.py      (necesita Python con playwright y Chromium)"""
import asyncio, json, os, subprocess, sys, tempfile, time, urllib.request

RAIZ = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PUERTO = 8812
URL = f'http://127.0.0.1:{PUERTO}'
NODE = ['node', '--disable-warning=ExperimentalWarning', os.path.join(RAIZ, 'src/cli.js')]
UNO, DOS = 'uno@ejemplo.test', 'dos@ejemplo.test'
ok = 0


def comprobar(cond, msg):
    global ok
    if not cond:
        raise AssertionError(msg)
    ok += 1
    print('  ✓', msg)


def api(ruta, datos=None, quien=UNO):
    req = urllib.request.Request(URL + ruta, data=json.dumps(datos).encode() if datos is not None else None,
                                 headers={'Content-Type': 'application/json', 'x-quien': quien})
    return json.load(urllib.request.urlopen(req))


async def esperar(cond, ms=5000):
    t = time.time()
    while time.time() - t < ms / 1000:
        r = cond()
        if asyncio.iscoroutine(r):
            r = await r
        if r:
            return True
        await asyncio.sleep(0.1)
    return False


async def hay(loc, n):
    return await loc.count() == n


async def texto(pg, sel):
    return await pg.locator(sel).inner_text()


async def main():
    from playwright.async_api import async_playwright
    datos = tempfile.mkdtemp()
    env = {**os.environ, 'GASTOS_DATOS': datos, 'PUERTO': str(PUERTO), 'GASTOS_PRUEBAS': '1'}
    subprocess.run(NODE + ['importar', os.path.join(RAIZ, 'test/fixtures/hoja.xlsx'), '--desde', '2026-12'], env=env, check=True, capture_output=True)
    srv = subprocess.Popen(NODE + ['servir'], env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        for _ in range(50):
            try:
                urllib.request.urlopen(URL + '/api/salud'); break
            except Exception:
                time.sleep(0.1)
        async with async_playwright() as p:
            b = await p.chromium.launch()
            errores = []

            async def movil(quien, sw='block'):
                ctx = await b.new_context(viewport={'width': 390, 'height': 844}, extra_http_headers={'x-quien': quien}, service_workers=sw)
                pg = await ctx.new_page()
                pg.on('pageerror', lambda e: errores.append(f'{quien}: {e}'))
                pg.on('console', lambda m: errores.append(f'{quien}: {m.text}') if m.type == 'error' or 'Content Security Policy' in m.text else None)
                await pg.clock.set_fixed_time('2026-12-10T12:00:00')
                await pg.goto(URL)
                return ctx, pg

            cu, uno = await movil(UNO)
            cd, dos = await movil(DOS)

            print('Alta')
            await uno.get_by_role('button', name='Soy Uno').click()
            await uno.wait_for_selector('.pestanas')
            async def solo_dos():
                return await dos.get_by_role('button', name='Soy Uno').count() == 0 and await dos.get_by_role('button', name='Soy Dos').count() == 1
            comprobar(await esperar(solo_dos),
                      'a Dos ya no le ofrece el hueco de Uno')
            await dos.get_by_role('button', name='Soy Dos').click()
            await dos.wait_for_selector('.pestanas')
            comprobar(api('/api/estado', quien='tres@ejemplo.test')['modo'] == 'completo', 'una tercera cuenta no ve nada')

            print('Transferir')
            # I = 3000, E = 1090, F = 1910 → 955 c/u. Uno paga 15 de su cuenta, Dos 40.
            comprobar('1910' not in await texto(uno, 'main') and '955,00' in await texto(uno, 'main'), 'libre de 955 € cada uno')
            comprobar('630,00' in await texto(uno, '.persona.mia'), 'Uno transfiere 630 € (1600 − 955 − 15)')

            print('Mes: escribir y recalcular')
            for pg in (uno, dos):
                await pg.get_by_role('button', name='Mes', exact=True).click()
            alq = uno.get_by_label('Importe de Alquiler')
            await alq.fill('950')
            comprobar('655,00' in await texto(uno, '.fijo-arriba'), 'recalcula mientras se escribe, antes de guardar')
            await alq.press('Enter')
            comprobar(await esperar(lambda: asyncio.sleep(0, api('/api/estado')['datos']['series']['c:alquiler']['desde'].get('2026-12') == 95000)), 'el cambio llega al servidor')
            await dos.get_by_role('button', name='Transferir', exact=True).click()
            comprobar(await esperar(lambda: dos.get_by_text('655,00 €').count()), 'Dos lo ve sin recargar')
            await dos.get_by_role('button', name='Mes', exact=True).click()

            # Escribir mientras llega un cambio de la otra persona: lo tecleado no se borra
            nom = uno.get_by_label('Importe de Nómina Uno')
            await nom.click()
            await nom.press('Control+a')
            await nom.type('17', delay=40)
            luz = dos.get_by_label('Importe de Luz y agua')
            await luz.fill('140')
            await luz.press('Enter')
            api('/api/ops', {'ops': [{'tipo': 'gasto.guardar', 'gasto': {'id': 'api1', 'fecha': '2026-12-05', 'desc': 'Pan', 'importe': 250, 'paga': 'b', 'parte': 50, 'cat': 'compra'}}]}, quien=DOS)
            await uno.wait_for_timeout(900)
            await nom.type('00', delay=40)
            comprobar(await nom.input_value() == '1700', 'lo que se escribe no se borra con cambios del otro')
            comprobar(await uno.get_by_label('Importe de Luz y agua').input_value() == '140', 'y aun así ve el cambio del otro en la otra casilla')
            await nom.press('Tab')
            comprobar(await esperar(lambda: asyncio.sleep(0, api('/api/estado')['datos']['series']['n:a']['desde'].get('2026-12') == 170000)), 'la nómina se guarda al salir')

            print('Solo este mes')
            await uno.get_by_role('button', name='Solo este mes').click()
            g = uno.get_by_label('Importe de Clases de baile')
            await g.fill('0')
            await g.press('Enter')
            comprobar(await esperar(lambda: uno.get_by_text('solo este mes · normal 40,00 €').count()), 'marca el cambio puntual')
            await uno.get_by_role('button', name='Mes siguiente').click()
            comprobar(await uno.get_by_label('Importe de Clases de baile').input_value() == '40', 'en enero vuelve a 40')
            comprobar('gris' in await uno.get_by_label('Importe de Clases de baile').get_attribute('class'), 'y se ve en gris (heredado)')
            comprobar(await uno.get_by_label('Importe de Alquiler').input_value() == '950', 'el alquiler de diciembre se arrastra a enero')
            await uno.get_by_role('button', name='Mes anterior').click()

            print('Los dos cambian la misma cifra')
            a1 = uno.get_by_label('Importe de Móvil Uno')
            a2 = dos.get_by_label('Importe de Móvil Uno')
            await a1.fill('20'); await a2.fill('25')
            await a1.press('Enter'); await a2.press('Enter')
            await uno.wait_for_timeout(800)
            v1, v2 = await a1.input_value(), await a2.input_value()
            comprobar(v1 == v2 and v1 in ('20', '25'), f'los dos acaban viendo lo mismo ({v1})')

            print('Gastos y deshacer')
            await dos.get_by_role('button', name='Gastos', exact=True).click()
            await dos.get_by_role('button', name='Añadir gasto').click()
            await dos.get_by_label('Importe (€)').fill('32,40')
            await dos.get_by_label('Descripción').fill('Cine')
            await dos.get_by_role('button', name='🎉 Salidas y ocio').click()
            await dos.get_by_role('button', name='Añadir gasto', exact=True).last.click()
            comprobar(await esperar(lambda: dos.locator('.fila', has_text='Cine').count()), 'Dos añade un gasto suelto')
            await uno.get_by_role('button', name='Gastos', exact=True).click()
            comprobar(await esperar(lambda: uno.locator('.fila', has_text='Cine').count()), 'Uno lo ve al momento')
            # Dos pagó Pan (2,50) y Cine (32,40), a medias: Uno le debe 17,45
            comprobar(await esperar(lambda: uno.get_by_text('Le debes a Dos').count()), 'Uno ve que le debe a Dos')
            comprobar('17,45' in await texto(uno, '.deudas'), 'la deuda es la mitad de lo que pagó Dos (17,45 €)')
            comprobar('Pagó Dos · a medias' in await texto(uno, 'main'), 'cada gasto dice quién pagó y cómo se reparte')
            await uno.locator('.fila', has_text='Pan').click()
            await uno.get_by_role('button', name='Borrar gasto').click()
            comprobar(await esperar(lambda: hay(uno.locator('.fila', has_text='Pan'), 0)), 'borrar un gasto')
            await uno.get_by_role('button', name='Deshacer').click()
            comprobar(await esperar(lambda: hay(uno.locator('.fila', has_text='Pan'), 1)), 'deshacer lo recupera')

            print('Reparto y saldar')
            await uno.get_by_role('button', name='Añadir gasto').click()
            await uno.get_by_label('Importe (€)').fill('40')
            await uno.get_by_label('Descripción').fill('Regalo')
            await uno.locator('.hoja').get_by_role('button', name='Todo para Dos').click()
            comprobar('Dos le deberá 40,00' in await texto(uno, '.hoja'), 'avisa de la deuda antes de guardar')
            await uno.get_by_role('button', name='Añadir gasto', exact=True).last.click()
            comprobar(await esperar(lambda: dos.locator('.deudas', has_text='22,55').count()), 'Dos ve que ahora le debe 22,55 € a Uno')
            await dos.locator('.deudas').get_by_role('button', name='Saldar').click()
            await dos.locator('.hoja').get_by_role('button', name='Guardar').click()
            comprobar(await esperar(lambda: uno.get_by_text('Estáis en paz').count()), 'tras saldar, los dos están en paz')

            print('Sin cobertura')
            await cd.set_offline(True)
            await dos.get_by_role('button', name='Añadir gasto').click()
            await dos.get_by_label('Importe (€)').fill('9')
            await dos.get_by_label('Descripción').fill('Helado')
            await dos.get_by_role('button', name='Añadir gasto', exact=True).last.click()
            comprobar(await dos.locator('.fila', has_text='Helado').count() == 1, 'sin conexión se apunta igual')
            comprobar(await esperar(lambda: dos.get_by_text('sin conexión').count()), 'y avisa de que está sin conexión')
            await uno.wait_for_timeout(600)
            comprobar(await uno.locator('.fila', has_text='Helado').count() == 0, 'Uno aún no lo tiene')
            await cd.set_offline(False)
            await dos.evaluate("dispatchEvent(new Event('online'))")
            comprobar(await esperar(lambda: uno.locator('.fila', has_text='Helado').count(), 8000), 'al volver la red se envía y Uno lo ve')
            gastos = api('/api/estado')['datos']['gastos']
            comprobar(sum(1 for g in gastos.values() if g['desc'] == 'Helado') == 1, 'y no se duplica')

            print('Operación repetida')
            op = {'id': 'misma-op', 'tipo': 'transferencia.registrar', 'transferencia': {'id': 'tx', 'mes': '2026-12', 'de': 'b', 'importe': 100, 'fecha': '2026-12-03'}}
            api('/api/ops', {'ops': [op]}, quien=DOS)
            r = api('/api/ops', {'ops': [op]}, quien=DOS)
            comprobar(r['resultados'][0].get('repetida'), 'la misma operación dos veces se aplica una')

            print('Transferencias')
            await uno.get_by_role('button', name='Transferir', exact=True).click()
            await uno.get_by_role('button', name='Ya he transferido').click()
            await uno.get_by_role('button', name='Guardar').click()
            comprobar(await esperar(lambda: uno.locator('.persona.mia', has_text='Al día').count()), 'tras transferir queda al día')
            await dos.get_by_role('button', name='Transferir', exact=True).click()
            comprobar(await esperar(lambda: dos.locator('.persona:not(.mia)', has_text='Al día').count()), 'Dos lo ve')

            print('Arrastre al mes siguiente')
            # Dos no ha transferido nada en diciembre: en enero le aparece lo pendiente de antes
            await dos.get_by_role('button', name='Mes siguiente').click()
            tarjeta_dos = dos.locator('.persona.mia')
            comprobar(await esperar(lambda: tarjeta_dos.get_by_text('pendiente de antes').count()), 'a Dos le aparece lo pendiente de diciembre en enero')
            await dos.get_by_role('button', name='Mes anterior').click()

            print('Carpetas')
            await uno.get_by_role('button', name='Gastos', exact=True).click()
            await uno.get_by_role('button', name='＋ Carpeta').click()
            await uno.locator('.hoja').get_by_label('Nombre').fill('Viaje a Roma')
            await uno.locator('.hoja').get_by_role('button', name='Guardar').click()
            comprobar(await esperar(lambda: uno.get_by_text('Carpeta · todas las fechas').count()), 'crea una carpeta y la abre')
            await uno.get_by_role('button', name='Añadir gasto').click()
            comprobar(await uno.locator('.hoja .chip.activo', has_text='Viaje a Roma').count() == 1, 'el gasto nuevo va a la carpeta abierta')
            await uno.get_by_label('Importe (€)').fill('120')
            await uno.get_by_label('Descripción').fill('Vuelos')
            await uno.get_by_role('button', name='Añadir gasto', exact=True).last.click()
            comprobar(await esperar(lambda: uno.locator('.fila', has_text='Vuelos').count()), 'aparece dentro de la carpeta')
            comprobar('120,00' in await uno.locator('.total-grande').nth(1).inner_text(), 'con el total de la carpeta')
            await dos.get_by_role('button', name='Gastos', exact=True).click()
            comprobar(await esperar(lambda: dos.locator('.fila', has_text='Vuelos').filter(has_text='Viaje a Roma').count()), 'Dos lo ve en el mes con la etiqueta de la carpeta')

            print('Deudas por carpeta')
            # Sin carpeta: Dos pagó el helado (Uno le debe 4,50). En Roma: Uno pagó los vuelos (Dos le debe 60)
            deudas_uno = await texto(uno, '.deudas')
            comprobar('60,00' in deudas_uno and '4,50' not in deudas_uno, 'dentro de la carpeta solo cuenta lo de la carpeta')
            await uno.get_by_role('button', name='Este mes').click()
            comprobar(await esperar(lambda: uno.locator('.deudas .fila', has_text='Gastos sin carpeta').filter(has_text='4,50').count()), 'fuera, cada apartado sale por separado: sin carpeta')
            comprobar(await uno.locator('.deudas .fila', has_text='Viaje a Roma').filter(has_text='60,00').count() == 1, 'y la carpeta con lo suyo')
            comprobar(await uno.locator('.deudas').get_by_role('button', name='Saldar todo').count() == 1, 'con un botón para saldarlo todo')
            await dos.locator('.deudas .fila', has_text='Viaje a Roma').get_by_role('button', name='Saldar').click()
            comprobar('60,00' in await dos.locator('.hoja').get_by_label('Importe (€)').input_value(), 'saldar una carpeta propone lo de esa carpeta')
            await dos.locator('.hoja').get_by_role('button', name='Guardar').click()
            comprobar(await esperar(lambda: hay(uno.locator('.deudas', has_text='Viaje a Roma'), 0)), 'saldada la carpeta, desaparece de las deudas')
            comprobar('4,50' in await texto(uno, '.deudas'), 'y lo de fuera de la carpeta sigue pendiente')

            print('Paga')
            await dos.get_by_role('button', name='Paga', exact=True).click()
            comprobar(await dos.locator('.grafico svg path').count() >= 1, 'pinta la gráfica apilada')
            comprobar(await dos.locator('.ley', has_text='Salidas y ocio').count() == 1, 'con leyenda por categoría')
            await dos.locator('.grafico rect.zona').nth(1).click()
            comprobar('Del 7 al 13' in await texto(dos, 'main'), 'tocar una columna muestra su detalle')
            await dos.get_by_role('button', name='Ver tabla').click()
            comprobar(await dos.locator('table.tabla tbody tr').count() == 5, 'tabla de semanas')

            print('Ajustes')
            await dos.get_by_role('button', name='Ajustes').click()
            await dos.get_by_role('button', name='＋ Añadir categoría').click()
            await dos.locator('.hoja').last.get_by_label('Nombre').fill('Regalos')
            await dos.locator('.hoja').last.get_by_role('button', name='Salidas y ocio').click()
            await dos.locator('.hoja').last.get_by_role('button', name='Guardar').click()
            comprobar(await esperar(lambda: asyncio.sleep(0, any(c['nombre'] == 'Regalos' for c in api('/api/estado')['datos']['categorias'].values()))), 'crea una categoría propia')
            comprobar(await dos.get_by_role('link', name='Descargar copia de seguridad').count() == 1, 'botón de copia')

            print('Instalable y sin red')
            ci, ins = await movil(UNO, sw='allow')
            try:
                await ins.wait_for_selector('.pestanas', timeout=8000)
            except Exception:
                print('DEPURAR', repr(await ins.locator('body').inner_text())[:500], errores[-5:])
                raise
            await ins.evaluate('navigator.serviceWorker.ready')
            await ins.reload()
            await ins.wait_for_selector('.pestanas')
            await ci.set_offline(True)
            await ins.reload()
            comprobar(await esperar(lambda: ins.locator('.pestanas').count()), 'abre sin red desde lo guardado')
            manifest = json.load(urllib.request.urlopen(URL + '/manifest.webmanifest'))
            comprobar(manifest['display'] == 'standalone' and len(manifest['icons']) == 3, 'manifiesto de app instalable')

            reales = [e for e in errores if 'Service Worker registration blocked' not in e and 'Failed to load resource' not in e and 'ERR_INTERNET_DISCONNECTED' not in e]
            comprobar(not reales, 'sin errores ni bloqueos de seguridad en la consola: ' + '; '.join(reales))
            await b.close()
    finally:
        srv.terminate()
    print(f'\n{ok} comprobaciones correctas')


asyncio.run(main())
