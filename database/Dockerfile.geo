###############################################################################
# Cascata PostGIS Shared Sidecar
#
# Runs as a separate container, accessed via FDW from main DB.
# Each project gets its own schema + user for isolation.
#
# Usage: docker compose --profile geo up --build -d
###############################################################################

FROM postgis/postgis:17-3.5-alpine

# Copy initialization script
COPY init-geo.sql /docker-entrypoint-initdb.d/01-init-geo.sql

EXPOSE 5432
