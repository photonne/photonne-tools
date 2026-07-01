# photonne-tools v0.2

Web app ligera para ejecutar operaciones de mantenimiento del NAS (rsync, exiftool) con UI, logs en vivo, persistencia de jobs, file browser integrado y configuración vía `.env`.

## Novedades v0.2

- **Ver la config de cada job:** botón "Ver config" en cada tarjeta para saber exactamente qué copia (origen, destino, flags…).
- **Comando exacto por ejecución:** cada run guarda y muestra el comando que se lanzó, así sabes qué se copió realmente.
- **Barra de progreso en vivo:** las ejecuciones de `rsync` muestran el porcentaje mientras copian (además del log en streaming).
- **El proceso no depende de la ventana:** las tareas corren en el servidor; si cierras la pestaña la copia sigue, y puedes reconectarte con "Ver progreso" desde el panel de Jobs.
- **Estado siempre visible:** el panel de Jobs se autoactualiza y marca las tareas en ejecución.
- **Runs huérfanas tras un reinicio:** las ejecuciones que quedaron a medias se marcan como `interrupted` en lugar de aparecer eternamente como `running`.

## Novedades v0.1

Primera versión. Incluye:

- **Ejecución de operaciones del NAS:** lanza tareas de `rsync` y `exiftool` desde la UI.
- **Logs en vivo:** salida en streaming de cada job mientras se ejecuta.
- **Persistencia de jobs:** el historial de tareas sobrevive a reinicios.
- **File browser integrado:** elige rutas con clicks, sin escribir paths a mano.
- **Configuración vía `.env`:** ajustes por plantillas `.env.*.example`, listas para copiar.
- **Despliegue con Docker:** imagen publicada en GHCR y `docker-compose` listo para usar.

## Arranque rápido en Mac (para probar)

```bash
# 1. Descomprime
unzip photonne-tools-v0.2.zip -d photonne-tools/
cd photonne-tools/

# 2. Crea .env desde plantilla local
make init-local

# 3. Edita .env — reemplaza TU_USUARIO por tu usuario real de Mac.
#    Puedes verlo con: echo $USER
nano .env

# 4. Crea las carpetas de prueba
mkdir -p ~/Desktop/test-photonne/{origen,destino}
# (opcional) copia alguna foto:
cp ~/Pictures/*.jpg ~/Desktop/test-photonne/origen/ 2>/dev/null

# 5. Levanta
make up

# 6. Abre en el navegador
open http://localhost:8765
# usuario: admin
# password: admin123 (o la que pusiste en .env)
```

## Arranque en el NAS ZimaOS

```bash
# En tu Mac
scp -r photonne-tools/ usuario@192.168.1.150:/DATA/AppData/

# En el NAS
ssh usuario@192.168.1.150
cd /DATA/AppData/photonne-tools/

# Genera .env
make init

# Password fuerte
openssl rand -base64 24
# Ponla en .env
nano .env

# Ajusta rutas si tu NAS tiene otras (por defecto /media/HDD, /DATA, /home, /tmp)

# Levanta
make up

# Túnel SSH desde tu Mac para acceder a la UI:
ssh -L 8765:localhost:8765 usuario@192.168.1.150
# Y abre http://localhost:8765 en tu Mac
```

## Comandos del Makefile

```bash
make help          # Muestra todos los comandos
make init          # Crea .env desde plantilla NAS
make init-local    # Crea .env desde plantilla Mac
make check         # Valida .env antes de arrancar
make up            # Levanta el contenedor
make down          # Detiene
make restart       # Reinicia
make rebuild       # Reconstruye imagen (necesario tras cambios en código)
make logs          # Muestra logs en vivo
make clean         # Detiene y BORRA todos los datos
```

Si tienes problemas con `make`, siempre puedes usar docker directo:

```bash
docker compose up -d
docker compose logs -f
docker compose down
docker compose up -d --build   # para rebuild
```

## Estructura de configuración

```
.env.example          # plantilla NAS (safe to commit)
.env.local.example    # plantilla Mac (safe to commit)
.env                  # tu config REAL con credenciales (NO commitear, ya está en .gitignore)
```

## Variables del `.env`

| Variable | Descripción |
|---|---|
| `PHOTONNE_TOOLS_USER` | Usuario UI |
| `PHOTONNE_TOOLS_PASS` | Password UI (genera fuerte con `openssl rand -base64 24`) |
| `PHOTONNE_TOOLS_ALLOWED_ROOTS` | Rutas permitidas separadas por coma |
| `HOST_PATH_1..4` | Rutas del host a montar como volúmenes |
| `BIND_ADDR` | `127.0.0.1` (localhost) o `0.0.0.0` (LAN) |
| `BIND_PORT` | Puerto en el host |

**Regla:** cada ruta en `PHOTONNE_TOOLS_ALLOWED_ROOTS` debe estar en algún `HOST_PATH_N`. Si necesitas más de 4, añade `HOST_PATH_5=...` en `.env` y una línea nueva de volumen en `docker-compose.yml`.

## Uso de la app

1. Abre la UI.
2. "new job".
3. Herramienta: rsync o exiftool.
4. Rellena paths usando el botón **"browse"** (no tienes que teclear).
5. Marca "dry-run" para la primera vez.
6. Crear.
7. En "jobs" → botón "run".

## File browser

Cada campo de path tiene un botón "browse":
- Ves las raíces permitidas.
- Navegas por click.
- Toggle "terminar en '/'" para semántica rsync (contenido vs carpeta completa).
- "usar esta carpeta" rellena el input.
- `Esc` cierra el modal.

## Seguridad

- Acceso solo por localhost del NAS por defecto.
- HTTP Basic Auth.
- Credenciales en `.env` (no en código).
- Validación de allowlist en TODA operación.
- Flags peligrosos de rsync se filtran automáticamente.
- Comandos construidos programáticamente.
- Containerizado.

## Datos y backup

- BD: `./data/photonne-tools.db`
- Logs: `./data/logs/<run-id>.log`

## Troubleshooting

**"yaml: line X: mapping values are not allowed":**
Si aparece con una versión de compose editada, comprueba que las variables con caracteres especiales están entre comillas dobles: `PHOTONNE_TOOLS_PASS: "${PHOTONNE_TOOLS_PASS}"`.

**"define PHOTONNE_TOOLS_PASS en .env":**
No has creado `.env` o no tiene esa variable. `make init` o `make init-local`.

**"Path fuera de directorios permitidos":**
La ruta no está en `PHOTONNE_TOOLS_ALLOWED_ROOTS`, o está pero no montada como volumen.

**Cambios en código no se aplican:**
`make rebuild`. Solo `restart` no reconstruye la imagen.

**"encontrado 'TU_USUARIO' en .env sin reemplazar":**
Edita `.env` y sustituye `TU_USUARIO` por tu usuario real de Mac.

## Añadir nuevas herramientas

1. Añade builder en `app/main.py`.
2. Añade modelo Pydantic.
3. Añade en `JobCreate.validate_tool`.
4. Añade campos en `index.html` y lógica en `app.js`.
5. Instala en `Dockerfile`.
6. `make rebuild`.

## Limitaciones actuales

- Sin scheduling.
- Sin notificaciones.
- Un solo usuario.
- Sin edición de jobs.
