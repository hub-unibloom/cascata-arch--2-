# docker build --build-arg EXTENSION_TIER=3 --build-arg INCLUDE_POSTGIS=true -t cascata-db-full ./database/
###############################################################################

# ─────────────────────────────────────────────────────────────────────────────
FROM postgres:17-alpine AS builder-c

RUN apk add --no-cache \
    build-base clang llvm-dev git cmake \
    openssl-dev krb5-dev

# TimescaleDB
RUN cd /tmp && \
    git clone --branch 2.17.2 --depth 1 https://github.com/timescale/timescaledb.git && \
    cd timescaledb && \
    ./bootstrap -DREGRESS_CHECKS=OFF -DWARNINGS_AS_ERRORS=OFF \
    -DCMAKE_BUILD_TYPE=RelWithDebInfo \
    -DAPACHE_ONLY=1 && \
    cd build && make -j$(nproc) && make install && \
    rm -rf /tmp/timescaledb

# ─────────────────────────────────────────────────────────────────────────────
FROM postgres:17-alpine AS builder-rust

RUN apk add --no-cache \
    build-base clang llvm-dev git curl \
    openssl-dev pkgconf

# Install Rust toolchain
ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:$PATH
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain stable

# Install pgrx (the Rust PostgreSQL extension framework)
RUN cargo install cargo-pgrx --version 0.12.9 --locked && \
    cargo pgrx init --pg17 /usr/local/bin/pg_config

# pg_jsonschema
RUN cd /tmp && \
    git clone --branch v0.3.3 --depth 1 https://github.com/supabase/pg_jsonschema.git && \
    cd pg_jsonschema && \
    cargo pgrx install --release --pg-config /usr/local/bin/pg_config && \
    rm -rf /tmp/pg_jsonschema

# pg_graphql
RUN cd /tmp && \
    git clone --branch v1.5.9 --depth 1 https://github.com/supabase/pg_graphql.git && \
    cd pg_graphql && \
    cargo pgrx install --release --pg-config /usr/local/bin/pg_config && \
    rm -rf /tmp/pg_graphql

# ─────────────────────────────────────────────────────────────────────────────
FROM postgres:17-alpine AS builder-v8

RUN apk add --no-cache \
    build-base clang llvm-dev git cmake python3 \
    gn ninja icu-dev readline-dev

# plv8 — compiles V8 engine from source (heavy but self-contained)
RUN cd /tmp && \
    git clone --branch v3.2.3 --depth 1 --recurse-submodules https://github.com/plv8/plv8.git && \
    cd plv8 && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/plv8

# ─────────────────────────────────────────────────────────────────────────────
FROM postgis/postgis:17-3.5-alpine AS postgis-source

# ─────────────────────────────────────────────────────────────────────────────
FROM postgres:17-alpine AS final

ARG EXTENSION_TIER=1
ARG INCLUDE_POSTGIS=false

# ── Common build dependencies for Tier 1 & 2 (compiled in-place) ──
RUN apk add --no-cache --virtual .build-deps \
    build-base clang llvm-dev git curl

###############################################################################

# TIER 1 — Essential (pgvector + pg_cron) — compiled in final stage
###############################################################################

# --- pgvector ---
RUN if [ "$EXTENSION_TIER" -ge 1 ]; then \
    cd /tmp && \
    git clone --branch v0.8.0 --depth 1 https://github.com/pgvector/pgvector.git && \
    cd pgvector && \
    make OPTFLAGS="" PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgvector; \
    fi

# --- pg_cron ---
RUN if [ "$EXTENSION_TIER" -ge 1 ]; then \
    cd /tmp && \
    git clone --branch v1.6.4 --depth 1 https://github.com/citusdata/pg_cron.git && \
    cd pg_cron && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pg_cron; \
    fi

###############################################################################

# TIER 2 — Extended (http, pgjwt, pgsodium, pgaudit, pg_repack, pg_hashids, rum)
###############################################################################

# --- http (requires libcurl) ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    apk add --no-cache curl-dev && \
    cd /tmp && \
    git clone --branch v1.6.2 --depth 1 https://github.com/pramsey/pgsql-http.git && \
    cd pgsql-http && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgsql-http; \
    fi

# --- pgjwt ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    cd /tmp && \
    git clone --depth 1 https://github.com/michelp/pgjwt.git && \
    cd pgjwt && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgjwt; \
    fi

# --- pgsodium (requires libsodium) ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    apk add --no-cache libsodium-dev && \
    cd /tmp && \
    git clone --branch v3.1.9 --depth 1 https://github.com/michelp/pgsodium.git && \
    cd pgsodium && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgsodium; \
    fi

# --- pgaudit ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    cd /tmp && \
    git clone --branch 17.0 --depth 1 https://github.com/pgaudit/pgaudit.git && \
    cd pgaudit && \
    make USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    make install USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgaudit; \
    fi

# --- pg_repack ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    apk add --no-cache zlib-dev lz4-dev readline-dev && \
    cd /tmp && \
    git clone --branch ver_1.5.1 --depth 1 https://github.com/reorg/pg_repack.git && \
    cd pg_repack && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pg_repack; \
    fi

# --- pg_hashids ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    cd /tmp && \
    git clone --depth 1 https://github.com/iCyberon/pg_hashids.git && \
    cd pg_hashids && \
    make USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    make install USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pg_hashids; \
    fi

# --- rum ---
RUN if [ "$EXTENSION_TIER" -ge 2 ]; then \
    cd /tmp && \
    git clone --depth 1 https://github.com/postgrespro/rum.git && \
    cd rum && \
    make USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    make install USE_PGXS=1 PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/rum; \
    fi

###############################################################################

# TIER 3 — Heavy extensions via COPY --from builder stages
###############################################################################

# --- TimescaleDB (from builder-c) ---
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    echo "TimescaleDB will be copied from builder stage"; \
    fi
COPY --from=builder-c /usr/local/lib/postgresql/timescaledb*.so /tmp/tier3/tsdb/lib/
COPY --from=builder-c /usr/local/share/postgresql/extension/timescaledb* /tmp/tier3/tsdb/ext/
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    cp /tmp/tier3/tsdb/lib/*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/tier3/tsdb/ext/* /usr/local/share/postgresql/extension/ 2>/dev/null || true; \
    fi && rm -rf /tmp/tier3/tsdb

# --- pg_graphql + pg_jsonschema (from builder-rust) ---
COPY --from=builder-rust /usr/local/lib/postgresql/pg_graphql*.so /tmp/tier3/rust/lib/
COPY --from=builder-rust /usr/local/share/postgresql/extension/pg_graphql* /tmp/tier3/rust/ext/
COPY --from=builder-rust /usr/local/lib/postgresql/pg_jsonschema*.so /tmp/tier3/rust/lib/
COPY --from=builder-rust /usr/local/share/postgresql/extension/pg_jsonschema* /tmp/tier3/rust/ext/
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    cp /tmp/tier3/rust/lib/*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/tier3/rust/ext/* /usr/local/share/postgresql/extension/ 2>/dev/null || true; \
    fi && rm -rf /tmp/tier3/rust

# --- plv8 (from builder-v8) ---
COPY --from=builder-v8 /usr/local/lib/postgresql/plv8*.so /tmp/tier3/v8/lib/
COPY --from=builder-v8 /usr/local/share/postgresql/extension/plv8* /tmp/tier3/v8/ext/
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    cp /tmp/tier3/v8/lib/*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/tier3/v8/ext/* /usr/local/share/postgresql/extension/ 2>/dev/null || true; \
    fi && rm -rf /tmp/tier3/v8

# --- plpython3u (via apk) ---
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    apk add --no-cache python3 python3-dev; \
    fi

# --- pgroonga (via apk — groonga has Alpine packages) ---
RUN if [ "$EXTENSION_TIER" -ge 3 ]; then \
    apk add --no-cache --repository=https://packages.groonga.org/alpine/v3.21 groonga groonga-dev && \
    cd /tmp && \
    git clone --branch 3.2.5 --depth 1 https://github.com/pgroonga/pgroonga.git && \
    cd pgroonga && \
    make PG_CONFIG=/usr/local/bin/pg_config && \
    make install PG_CONFIG=/usr/local/bin/pg_config && \
    rm -rf /tmp/pgroonga; \
    fi

###############################################################################

# OPTIONAL: PostGIS directly in image (via INCLUDE_POSTGIS flag)
###############################################################################

COPY --from=postgis-source /usr/local/lib/postgresql/ /tmp/postgis/lib/
COPY --from=postgis-source /usr/local/share/postgresql/extension/ /tmp/postgis/ext/
COPY --from=postgis-source /usr/lib/ /tmp/postgis/usrlib/

RUN if [ "$INCLUDE_POSTGIS" = "true" ]; then \
    echo ">>> Installing PostGIS directly into image..." && \
    # Runtime dependencies for PostGIS
    apk add --no-cache \
    gdal geos proj protobuf-c json-c libxml2 && \
    # Copy compiled PostGIS files
    cp /tmp/postgis/lib/postgis*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/postgis/lib/address_standardizer*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/postgis/lib/postgis_topology*.so /usr/local/lib/postgresql/ 2>/dev/null || true && \
    cp /tmp/postgis/ext/postgis* /usr/local/share/postgresql/extension/ 2>/dev/null || true && \
    cp /tmp/postgis/ext/address_standardizer* /usr/local/share/postgresql/extension/ 2>/dev/null || true && \
    # Copy shared libraries PostGIS depends on
    cp /tmp/postgis/usrlib/libSFCGAL* /usr/lib/ 2>/dev/null || true && \
    cp /tmp/postgis/usrlib/librttopo* /usr/lib/ 2>/dev/null || true && \
    echo ">>> PostGIS installed successfully"; \
    fi
RUN rm -rf /tmp/postgis

###############################################################################

# CLEANUP
###############################################################################

RUN apk del .build-deps 2>/dev/null || true && \
    rm -rf /tmp/* /var/cache/apk/*

###############################################################################

# CONFIGURATION
###############################################################################

COPY postgresql.conf.append /etc/postgresql/postgresql.conf.append
COPY init.sql /docker-entrypoint-initdb.d/01-init.sql

# Dynamic config: append shared_preload_libraries based on what's installed
COPY <<'EOF' /docker-entrypoint-initdb.d/00-config.sh

# !/bin/bash
set -e

# Start with base libraries
LIBS="pg_stat_statements,pg_cron"

# Check if TimescaleDB is installed
if [ -f /usr/local/lib/postgresql/timescaledb.so ]; then
    LIBS="$LIBS,timescaledb"
fi

# Check if pgaudit is installed
if [ -f /usr/local/lib/postgresql/pgaudit.so ]; then
    LIBS="$LIBS,pgaudit"
fi

# Write the dynamic config
cat /etc/postgresql/postgresql.conf.append >> /var/lib/postgresql/data/postgresql.conf

# Override shared_preload_libraries with dynamic value
sed -i "s/^shared_preload_libraries.*/shared_preload_libraries = '$LIBS'/" \
    /var/lib/postgresql/data/postgresql.conf

echo ">>> Cascata DB configured with shared_preload_libraries = $LIBS"
EOF

RUN chmod +x /docker-entrypoint-initdb.d/00-config.sh

EXPOSE 5432
