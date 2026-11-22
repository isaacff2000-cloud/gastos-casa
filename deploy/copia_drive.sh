#!/usr/bin/env bash
# Opcional: sube cada día a Google Drive las copias MENSUALES que hace la app (no borra nada allí).
# Usa la imagen oficial de rclone, así que no hay que instalar nada en el portátil.
# El permiso de Google se queda en ~/.config/rclone (nunca en el repositorio) y solo da acceso a
# los archivos que crea rclone (permiso drive.file).
#
#   bash copia_drive.sh configurar   una vez: autoriza Drive (abre un enlace en el navegador del portátil)
#   bash copia_drive.sh activar      instala el temporizador diario (04:30, o al encender si estaba apagado)
#   bash copia_drive.sh ahora        sube las copias ahora
#   bash copia_drive.sh estado       última ejecución y próximos pasos
#   bash copia_drive.sh quitar       desactiva el temporizador (no borra nada en Drive)
set -euo pipefail
[[ $EUID -eq 0 ]] && { echo "Ejecútalo con tu usuario, no como root." >&2; exit 1; }

IMAGEN=docker.io/rclone/rclone:latest
CONF="$HOME/.config/rclone"
COPIAS="$HOME/.local/share/gastos-casa/copias/mensual"
REMOTO="gastos-drive"
DESTINO="${REMOTO}:Gastos a dos/copias mensuales"
UNIDADES="$HOME/.config/systemd/user"
# label=disable: sin cambiar las etiquetas de SELinux de la carpeta de datos (la usa también la app)
RCLONE=(podman run --rm --security-opt label=disable -v "$CONF:/config/rclone" -v "$COPIAS:/copias:ro" "$IMAGEN")

case "${1:-}" in
  configurar)
    mkdir -p -m 700 "$CONF" "$COPIAS"
    echo "Se abrirá la autorización de Google. Copia en el navegador de este portátil el enlace http://127.0.0.1:53682/… que aparezca."
    podman run --rm -it --network host --security-opt label=disable -v "$CONF:/config/rclone" "$IMAGEN" \
      config create "$REMOTO" drive scope=drive.file
    chmod 600 "$CONF/rclone.conf"
    echo "Hecho. Ahora: bash $0 activar"
    ;;
  activar)
    [[ -f "$CONF/rclone.conf" ]] || { echo "Primero: bash $0 configurar"; exit 1; }
    mkdir -p "$UNIDADES"
    cat > "$UNIDADES/gastos-copia-drive.service" <<EOF
[Unit]
Description=Gastos a dos: copias mensuales a Google Drive
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
ExecStart=/usr/bin/podman run --rm --security-opt label=disable -v $CONF:/config/rclone -v $COPIAS:/copias:ro $IMAGEN copy /copias "$DESTINO" --include "gastos-*.db"
EOF
    cat > "$UNIDADES/gastos-copia-drive.timer" <<'EOF'
[Unit]
Description=Gastos a dos: copias mensuales a Google Drive (cada día)

[Timer]
OnCalendar=*-*-* 04:30
Persistent=true
RandomizedDelaySec=15m

[Install]
WantedBy=timers.target
EOF
    systemctl --user daemon-reload
    systemctl --user enable --now gastos-copia-drive.timer
    echo "Activado. Prueba ahora con: bash $0 ahora"
    ;;
  ahora) "${RCLONE[@]}" copy /copias "$DESTINO" --include "gastos-*.db" -v ;;
  estado)
    systemctl --user list-timers gastos-copia-drive.timer --no-pager || true
    journalctl --user -u gastos-copia-drive.service -n 15 --no-pager || true
    ;;
  quitar)
    systemctl --user disable --now gastos-copia-drive.timer || true
    echo "Desactivado. Lo que ya está en Drive no se toca."
    ;;
  *) sed -n '2,13p' "$0" | sed 's/^# \{0,1\}//'; exit 1 ;;
esac
