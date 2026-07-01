# Makefile con atajos para photonne-tools.
# Uso: make <target>

.PHONY: help init init-local up update down logs restart rebuild clean check

help:
	@echo "photonne-tools — comandos disponibles:"
	@echo ""
	@echo "  make init         Crea .env desde .env.example (para NAS)"
	@echo "  make init-local   Crea .env desde .env.local.example (para Mac)"
	@echo "  make check        Valida configuración antes de arrancar"
	@echo "  make up           Levanta el contenedor (imagen de GHCR)"
	@echo "  make update       Baja la última imagen de GHCR y recrea el contenedor"
	@echo "  make down         Detiene el contenedor"
	@echo "  make restart      Reinicia el contenedor"
	@echo "  make rebuild      Construye la imagen en local (desde el código) y levanta"
	@echo "  make logs         Muestra logs en vivo"
	@echo "  make clean        Detiene y elimina volúmenes de datos (borra jobs)"
	@echo ""

init:
	@if [ -f .env ]; then \
		echo "ERROR: .env ya existe. Bórralo primero si quieres recrearlo."; \
		exit 1; \
	fi
	cp .env.example .env
	@echo "OK: .env creado desde .env.example."
	@echo "-> Edita .env y ajusta PHOTONNE_TOOLS_PASS y las rutas."

init-local:
	@if [ -f .env ]; then \
		echo "ERROR: .env ya existe. Bórralo primero si quieres recrearlo."; \
		exit 1; \
	fi
	cp .env.local.example .env
	@echo "OK: .env creado desde .env.local.example."
	@echo "-> Edita .env y reemplaza TU_USUARIO por tu usuario real."

check:
	@if [ ! -f .env ]; then \
		echo "ERROR: falta .env. Ejecuta 'make init' o 'make init-local'."; \
		exit 1; \
	fi
	@echo "OK: .env presente."
	@if grep -v "^\#" .env | grep -q "^PHOTONNE_TOOLS_PASS=changeme"; then \
		echo "AVISO: PHOTONNE_TOOLS_PASS sigue siendo 'changeme' (default). Cambialo."; \
	else \
		echo "OK: PHOTONNE_TOOLS_PASS personalizada."; \
	fi
	@if grep -v "^\#" .env | grep -q "TU_USUARIO"; then \
		echo "AVISO: encontrado 'TU_USUARIO' en .env sin reemplazar."; \
	else \
		echo "OK: no hay 'TU_USUARIO' sin reemplazar."; \
	fi

up: check
	docker compose up -d
	@echo ""
	@echo "OK: photonne-tools levantado."

update: check
	docker compose pull
	docker compose up -d
	@echo ""
	@echo "OK: photonne-tools actualizado a la última imagen de GHCR."
	@echo "-> Si el navegador muestra el diseño viejo, recarga con Cmd/Ctrl+Shift+R."

down:
	docker compose down

restart:
	docker compose restart

rebuild: check
	docker compose -f docker-compose.yml -f docker-compose.build.yml up -d --build

logs:
	docker compose logs -f photonne-tools

clean:
	@echo "AVISO: esto borrara TODOS tus jobs y logs. Continuar? [y/N]"
	@read ans && [ "$$ans" = "y" ] || exit 1
	docker compose down
	rm -rf data/
	@echo "OK: limpiado."
