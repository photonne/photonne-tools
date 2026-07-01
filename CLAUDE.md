# CLAUDE.md

Instrucciones para trabajar en este repositorio. Léelas antes de crear commits.

## Identidad de git

Todos los commits se hacen con la identidad de Marc:

- **Nombre:** `Marc Caralps Fontrubí`
- **Email:** `marc.caralps.fontrubi@gmail.com`

## Convención de commits

Se sigue [Conventional Commits](https://www.conventionalcommits.org/) con estas reglas:

```
tipo(scope opcional): Descripción
```

- **Idioma:** los mensajes de commit se escriben en **inglés**.
- **Capitalización de la descripción:** *Sentence case* — solo la primera letra en mayúscula. El resto en minúscula salvo nombres propios, siglas o identificadores (`ZimaOS`, `GHCR`, `docker-compose.yml`).
- **Sin punto final** en la descripción.
- **Modo imperativo:** "Add", "Fix", "Remove" — no "Added" ni "Adds".
- **Longitud:** el asunto, idealmente ≤ 72 caracteres.
- El **tipo** va siempre en minúscula.

### Ejemplos válidos

```
feat: Add ZimaOS compose file
fix: Remove Synology references from placeholder
refactor: Rename Ohanatools to Photonne-Tools
ci: Publish Docker image to GHCR on push to main
chore: Update docker-compose.yml
```

### Tipos permitidos

| Tipo       | Uso |
|------------|-----|
| `feat`     | Nueva funcionalidad |
| `fix`      | Corrección de un bug |
| `refactor` | Cambio de código sin alterar comportamiento |
| `docs`     | Solo documentación (README, este archivo, comentarios) |
| `style`    | Formato, espacios, sin cambios de lógica |
| `chore`    | Mantenimiento, dependencias, configuración |
| `ci`       | Pipelines, GitHub Actions, publicación de imágenes |
| `build`    | Sistema de build, Dockerfile, Makefile |
| `test`     | Añadir o ajustar tests |
| `perf`     | Mejoras de rendimiento |

### Scope (opcional)

Usa scope cuando aporte claridad sobre la zona afectada, en minúscula:

```
feat(browser): Add file picker for path selection
fix(rsync): Escape colons in error messages
```

### Cuerpo del commit (opcional)

- Deja una línea en blanco entre el asunto y el cuerpo.
- Explica el **porqué**, no el **qué** (el diff ya muestra el qué).
- Envuelve las líneas alrededor de los 72 caracteres.

### Breaking changes

Marca los cambios incompatibles con `!` tras el tipo/scope y/o un pie `BREAKING CHANGE:`:

```
feat!: Drop support for the legacy .env format

BREAKING CHANGE: Las variables sin prefijo ya no se leen.
```

## Coautoría

Cuando el commit lo genere Claude, añade el trailer al final del mensaje:

```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

## Versionado

- La versión vive en el endpoint `/api/health` de `app/main.py` (`"version": "..."`).
- Mantén sincronizadas todas las referencias de versión: título y sección "Novedades" del `README.md`, comentarios de cabecera de `app/main.py` y `app/static/app.js`, y el nombre del zip en las instrucciones del README.
- Al subir versión, actualiza la sección **Novedades vX.Y** del README describiendo los cambios de cara al usuario.

## Flujo de trabajo

- No hagas commit ni push salvo que se pida explícitamente.
- La rama principal es `main`. Si se te pide reescribir historia (squash, reset), usa `--force-with-lease` al hacer push.
