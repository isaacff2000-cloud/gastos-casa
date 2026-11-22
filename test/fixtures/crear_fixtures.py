"""Crea test/fixtures/hoja.xlsx: una hoja «Gastos a dos» inventada con el mismo formato que la de Google
(pestaña "datos": ruta | datos_json | actualizado). Uso: python3 test/fixtures/crear_fixtures.py"""
import json, os
from openpyxl import Workbook

filas = [
    ('fixed/alquiler', {'desc': 'Alquiler', 'amount': 90000, 'src': 'j', 'cat': 'casa', 'order': 1, 'createdAt': 1}),
    ('fixed/luz', {'desc': 'Luz y agua', 'amount': 12000, 'src': 'j', 'cat': 'suministros', 'order': 2, 'createdAt': 2}),
    ('fixed/movil-uno', {'desc': 'Móvil Uno', 'amount': 1500, 'src': 'a', 'cat': 'suscripciones', 'order': 3, 'createdAt': 3}),
    ('fixed/raro id!', {'desc': 'Clases de baile', 'amount': 4000, 'src': 'b', 'cat': 'inventada', 'order': 4, 'createdAt': 4}),
    ('fixed/cero', {'desc': 'Ahorro', 'amount': 0, 'src': 'b', 'cat': 'otros', 'order': 5, 'createdAt': 5}),
    ('members/a', {'uid': 'uno@ejemplo.test', 'name': 'Uno'}),
    ('members/b', {'uid': 'dos@ejemplo.test', 'name': 'Dos'}),
    ('months/2026-09', {'incA': 150000, 'incB': 140000}),
    ('months/2026-10', {'incA': 160000, 'incB': 140000}),
    # La luz se cambió en octubre: debe importarse el importe más reciente
    ('expenses/fx-2026-09-luz', {'type': 'expense', 'desc': 'Luz y agua', 'amount': 11000, 'src': 'j', 'cat': 'suministros', 'date': '2026-09-01', 'fixedId': 'luz'}),
    ('expenses/fx-2026-10-luz', {'type': 'expense', 'desc': 'Luz y agua', 'amount': 13500, 'src': 'j', 'cat': 'suministros', 'date': '2026-10-01', 'fixedId': 'luz'}),
    ('expenses/g1', {'type': 'expense', 'desc': 'Cena', 'amount': 4550, 'src': 'a', 'cat': 'restaurante', 'date': '2026-10-12'}),
    ('expenses/t1', {'type': 'transfer', 'payer': 'a', 'amount': 50000, 'date': '2026-10-02'}),
]
wb = Workbook()
ws = wb.active
ws.title = 'datos'
ws.append(['ruta', 'datos_json', 'actualizado'])
for ruta, d in filas:
    ws.append([ruta, json.dumps(d, ensure_ascii=False), 46343])
ws.append(['fixed/roto', '{esto no es json', 46343])
wb.save(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'hoja.xlsx'))
print('hoja.xlsx creada')
