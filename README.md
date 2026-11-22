# Gastos a dos · servidor de casa

Reparto de los gastos de casa entre dos personas, en un portátil que está siempre encendido.
Los móviles usan una app web instalable a través de Tailscale: nada queda publicado en internet.

Este repositorio solo tiene código: ningún dato, correo ni clave. Los datos viven en
`~/.local/share/gastos-casa` del portátil.

## Qué hace

- **Transferir:** cuánto pasa cada uno a la cuenta conjunta y cuánto deja en su cuenta personal
  (recibos que paga desde ella + libre). Todo es común y lo que sobra se reparte a partes iguales.
  Lo que no se transfiere en un mes se arrastra a los siguientes (y lo transferido de más, también).
- **Mes:** nóminas y gastos fijos del mes (lo único que entra en el reparto con la conjunta), que se arrastran solos de un mes a otro. Cada cambio vale
  «desde este mes» o «solo este mes». El resultado se recalcula mientras se escribe.
- **Gastos:** gastos sueltos del día a día. Cada uno dice quién lo pagó y cómo se reparte (a medias
  por defecto, todo para uno u otro porcentaje); arriba sale quién le debe a quién y se salda con un
  pago. Van aparte del reparto mensual. Se pueden agrupar en **carpetas** (un viaje, salidas…).
- **Paga:** lo gastado en sueltos y lo que le toca a cada uno; gráfica por semanas o meses y por
  categoría, tabla y mayores gastos.
- **Ajustes:** categorías propias, descarga de una copia de seguridad, CSV.
- Funciona sin cobertura (los cambios esperan y se envían al volver la red) y lo que hace uno le
  aparece al otro al momento. Lo que se está escribiendo nunca se borra por cambios del otro.
- Copia de seguridad cada noche (30 días) y una cada mes que no se borra; opcionalmente, a Google Drive.

## Cómo funciona

- Node 22 sin dependencias: `node:sqlite`, `http` y avisos en directo (SSE).
- Los cambios llegan como **operaciones con id propio** (si llegan dos veces, se aplican una) y se
  guardan en orden. El estado se obtiene aplicándolas con las reglas de `src/nucleo.js`, el mismo
  archivo que usa el móvil, así que servidor y app no pueden calcular distinto.
- App web con Preact y htm copiados en `web/vendor` (sin compilación).
- Quién es quién lo dice Tailscale (cabecera `Tailscale-User-Login`): cada persona elige una vez
  «Soy …» y queda unida a su cuenta. Sin esa cabecera no se ve ningún dato.

## Instalar en el portátil (Bazzite / Fedora Atomic)

Convive con otras apps del portátil: usa el puerto local 8788 y el HTTPS 8443 de Tailscale.

1. Tailscale activo, con `tailscale set --operator=$USER` y HTTPS activado en la consola de Tailscale.
2. (Opcional) Descargar la hoja de Google antigua como Excel (Archivo › Descargar › Microsoft Excel).
3. Como tu usuario (no root):
   ```bash
   curl -fsSLO https://raw.githubusercontent.com/isaacff2000-cloud/gastos-casa/main/deploy/instalar.sh
   bash instalar.sh ~/Descargas/hoja.xlsx
   ```
4. En cada móvil (con Tailscale activo): abrir `https://<portátil>.<tu-red>.ts.net:8443`, añadir a la
   pantalla de inicio y elegir «Soy …».

El servicio de Podman arranca solo, se reinicia si falla y se actualiza solo con cada versión nueva.
Copia a Drive (opcional): `bash deploy/copia_drive.sh configurar` y después `activar`.

## Mantenimiento

```bash
systemctl --user status gastos-casa                      # estado
journalctl --user -u gastos-casa -f                      # mensajes
podman exec gastos-casa node src/cli.js resumen          # qué hay guardado
podman exec gastos-casa node src/cli.js desligar b && systemctl --user restart gastos-casa   # que una persona vuelva a elegir
# Restaurar una copia (con el servicio parado):
systemctl --user stop gastos-casa
podman run --rm --userns=keep-id:uid=1000,gid=1000 -v ~/.local/share/gastos-casa:/datos:Z \
  ghcr.io/isaacff2000-cloud/gastos-casa node src/cli.js restaurar /datos/copias/mensual/gastos-AAAA-MM.db
systemctl --user start gastos-casa
```

## Desarrollo

```bash
npm test                                               # pruebas (Node 22.13 o superior, sin dependencias)
node src/cli.js importar hoja.xlsx --prueba            # qué importaría, sin guardar
node src/cli.js importar hoja.xlsx --desde 2026-12     # datos en ./datos
GASTOS_PRUEBAS=1 node src/cli.js servir                # http://127.0.0.1:8788 (acepta la cabecera x-quien)
bash deploy/comprobar_limpio.sh                        # que no se cuele nada privado
python3 test/e2e_app.py                                # la app en dos móviles a la vez (Playwright)
```

El diseño completo está en [docs/DISENO.md](docs/DISENO.md).
