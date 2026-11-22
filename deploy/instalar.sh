#!/usr/bin/env bash
# Instala (o actualiza) «Gastos a dos» en este portátil con Bazzite / Fedora Atomic.
# Convive con la app del menú sin tocarla: otro puerto (8788), otro contenedor y HTTPS en el 8443.
#
# Uso (como el usuario normal, NO como root):
#   bash instalar.sh                         instala o actualiza
#   bash instalar.sh hoja.xlsx [--desde AAAA-MM]
#        además importa la hoja de Google (Archivo › Descargar › Microsoft Excel), solo la primera vez.
#        --desde: mes desde el que valen los importes importados (por defecto, el actual)
# Se puede volver a ejecutar sin miedo: no borra datos.
set -euo pipefail

PROPIETARIO="${GASTOS_PROPIETARIO:-isaacff2000-cloud}"
APP=gastos-casa
IMAGEN="ghcr.io/${PROPIETARIO}/${APP}:latest"
DATOS="$HOME/.local/share/${APP}"
QUADLET_DIR="$HOME/.config/containers/systemd"
PUERTO=8788
HTTPS=8443
MENU_PUERTO=8787   # la app del menú: solo se comprueba que sigue igual

azul() { printf '\n\033[1;34m%s\033[0m\n' "$*"; }
ok() { printf '  \033[32m✓\033[0m %s\n' "$*"; }
aviso() { printf '  \033[33m!\033[0m %s\n' "$*"; }
fallo() { printf '\n\033[31mError:\033[0m %s\n' "$*" >&2; exit 1; }

[[ $EUID -eq 0 ]] && fallo "Ejecútalo con tu usuario, no como root (el servicio es de usuario). Desde root:
  sudo -u <usuario> XDG_RUNTIME_DIR=/run/user/<uid> DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/<uid>/bus bash $0 $*"

XLSX="" DESDE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --desde) DESDE="${2:-}"; shift 2 ;;
    *) XLSX="$1"; shift ;;
  esac
done
if [[ -n "$XLSX" ]]; then
  [[ -f "$XLSX" ]] || fallo "No encuentro el archivo $XLSX"
  XLSX="$(readlink -f "$XLSX")"
fi
[[ -z "$DESDE" || "$DESDE" =~ ^[0-9]{4}-(0[1-9]|1[0-2])$ ]] || fallo "--desde tiene que ser AAAA-MM"

menu_ok() { curl -fs "http://127.0.0.1:${MENU_PUERTO}/api/salud" >/dev/null 2>&1; }
serve_estado() { tailscale serve status 2>/dev/null || true; }

azul "1/6 Comprobaciones"
command -v podman >/dev/null || fallo "Falta podman (en Bazzite viene instalado)."
systemctl --user show-environment >/dev/null 2>&1 || fallo "No hay sesión de systemd de usuario (¿falta XDG_RUNTIME_DIR?)."
ok "podman $(podman --version | awk '{print $3}')"
TS=0
if command -v tailscale >/dev/null && tailscale status >/dev/null 2>&1; then TS=1; ok "Tailscale conectado"; else aviso "Tailscale no está activo: la app funcionará solo en este portátil hasta activarlo."; fi
MENU_ANTES=0; menu_ok && MENU_ANTES=1
SERVE_ANTES="$(serve_estado)"
[[ $MENU_ANTES == 1 ]] && ok "La app del menú responde (no se va a tocar)" || aviso "La app del menú no responde ahora mismo (no se toca igualmente)"
if ss -ltnH "sport = :${PUERTO}" 2>/dev/null | grep -q . && ! podman container exists "$APP" 2>/dev/null; then
  fallo "El puerto ${PUERTO} ya lo usa otro programa. No sigo para no pisar nada."
fi

azul "2/6 Descargando la app"
mkdir -p "$QUADLET_DIR"
mkdir -p -m 700 "$DATOS"
chmod 700 "$DATOS"
podman pull "$IMAGEN" >/dev/null || fallo "No se pudo descargar $IMAGEN (¿el paquete de ghcr.io es público?)"
ok "Imagen al día"

azul "3/6 Datos"
ejecutar() { podman run --rm --userns=keep-id:uid=1000,gid=1000 -v "$DATOS:/datos:Z" "$@"; }
if [[ -f "$DATOS/gastos.db" ]]; then
  ok "Ya hay datos en $DATOS (no se tocan)"
  [[ -n "$XLSX" ]] && aviso "Se ignora $XLSX: la importación solo se hace la primera vez"
elif [[ -n "$XLSX" ]]; then
  systemctl --user stop "${APP}.service" 2>/dev/null || true
  ejecutar -v "$XLSX:/importar.xlsx:ro,Z" "$IMAGEN" node --disable-warning=ExperimentalWarning src/cli.js importar /importar.xlsx ${DESDE:+--desde "$DESDE"}
  ok "Hoja importada"
else
  aviso "Sin datos: la app empezará vacía. Para importar la hoja antigua: bash instalar.sh ruta/a/la/hoja.xlsx"
fi

azul "4/6 Servicio"
curl -fsSL "https://raw.githubusercontent.com/${PROPIETARIO}/${APP}/main/deploy/${APP}.container" \
  | sed "s/IMAGEN_PROPIETARIO/${PROPIETARIO}/" > "$QUADLET_DIR/${APP}.container.nuevo" \
  || fallo "No se pudo descargar la definición del servicio"
mv "$QUADLET_DIR/${APP}.container.nuevo" "$QUADLET_DIR/${APP}.container"
systemctl --user daemon-reload
systemctl --user restart "${APP}.service"      # solo este servicio
systemctl --user enable --now podman-auto-update.timer >/dev/null 2>&1 || aviso "No se pudo activar la actualización automática"
if [[ "$(loginctl show-user "$USER" -p Linger --value 2>/dev/null)" == "yes" ]]; then ok "Arranca solo al encender"; else aviso "Falta: sudo loginctl enable-linger $USER  (para que arranque sin iniciar sesión)"; fi
for _ in $(seq 1 30); do curl -fs "http://127.0.0.1:${PUERTO}/api/salud" >/dev/null 2>&1 && break; sleep 2; done
curl -fs "http://127.0.0.1:${PUERTO}/api/salud" >/dev/null || fallo "El servicio no responde. Mira: journalctl --user -u ${APP} -n 50"
ok "En marcha en http://127.0.0.1:${PUERTO} ($(curl -fs "http://127.0.0.1:${PUERTO}/api/salud" | sed -n 's/.*"version":"\([^"]*\)".*/\1/p'))"

azul "5/6 Acceso desde los móviles (Tailscale, solo vuestra red)"
NOMBRE=""
if [[ $TS == 1 ]]; then
  if serve_estado | grep -q "127.0.0.1:${PUERTO}"; then
    ok "Ya publicada en el puerto ${HTTPS}"
  else
    tailscale serve --bg --https=${HTTPS} "http://127.0.0.1:${PUERTO}" >/dev/null \
      || fallo "tailscale serve falló. ¿Está «tailscale set --operator=$USER»? Prueba: tailscale serve --bg --https=${HTTPS} http://127.0.0.1:${PUERTO}"
    ok "Publicada en el puerto ${HTTPS}"
  fi
  NOMBRE="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)\.".*/\1/p' | head -1)"
else
  aviso "Activa Tailscale y vuelve a ejecutar este script para publicarla."
fi

azul "6/6 La app del menú sigue igual"
if [[ $MENU_ANTES == 1 ]]; then menu_ok && ok "El menú sigue respondiendo" || aviso "¡El menú no responde! Mira: systemctl --user status menu-casa"; fi
if [[ -n "$SERVE_ANTES" ]] && echo "$SERVE_ANTES" | grep -q "127.0.0.1:${MENU_PUERTO}"; then
  serve_estado | grep -q "127.0.0.1:${MENU_PUERTO}" && ok "Tailscale sigue publicando el menú" || aviso "¡Tailscale ya no publica el menú! Repite: tailscale serve --bg --https=443 http://127.0.0.1:${MENU_PUERTO}"
fi

azul "Listo"
[[ -n "$NOMBRE" ]] && echo "  Dirección para los móviles:  https://${NOMBRE}:${HTTPS}"
echo "  Ver el estado:     systemctl --user status ${APP}"
echo "  Ver los mensajes:  journalctl --user -u ${APP} -f"
echo "  Datos y copias:    $DATOS"
