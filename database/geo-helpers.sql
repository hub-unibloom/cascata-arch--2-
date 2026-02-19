-- =============================================================================
-- Cascata Geo Helpers — FDW Materialization & Write Optimization
--
-- These functions help bridge the gap between FDW's read-optimized nature
-- and the need for local write performance on geo data.
-- =============================================================================

-- Schema for geo helper functions
CREATE SCHEMA IF NOT EXISTS cascata_geo;

-- ─────────────────────────────────────────────────────────────────────────────
-- materialize: Execute a query on the remote geo server and store results locally
--
-- Usage:
--   SELECT cascata_geo.materialize(
--     'SELECT id, ST_AsGeoJSON(geom) as geom_json, name FROM cities WHERE population > 1000000',
--     'local_big_cities'
--   );
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cascata_geo.materialize(
    source_query TEXT,
    local_table TEXT,
    target_schema TEXT DEFAULT 'public'
) RETURNS TABLE(rows_created BIGINT, table_name TEXT) AS $$
DECLARE
    full_table TEXT := quote_ident(target_schema) || '.' || quote_ident(local_table);
    row_count BIGINT;
BEGIN
    -- Drop existing table if it exists
    EXECUTE format('DROP TABLE IF EXISTS %s', full_table);
    
    -- Create table from query results
    EXECUTE format('CREATE TABLE %s AS %s', full_table, source_query);
    
    -- Get row count
    EXECUTE format('SELECT count(*) FROM %s', full_table) INTO row_count;
    
    -- Store metadata for refresh
    INSERT INTO cascata_geo.materialized_tables (table_name, source_query, schema_name, row_count, last_refresh)
    VALUES (local_table, source_query, target_schema, row_count, NOW())
    ON CONFLICT (table_name, schema_name) DO UPDATE 
    SET source_query = EXCLUDED.source_query, 
        row_count = EXCLUDED.row_count,
        last_refresh = NOW();
    
    RETURN QUERY SELECT row_count, local_table;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- refresh: Re-execute the original query and replace local table contents
--
-- Usage:
--   SELECT cascata_geo.refresh('local_big_cities');
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cascata_geo.refresh(
    p_table_name TEXT,
    p_schema TEXT DEFAULT 'public'
) RETURNS TABLE(rows_refreshed BIGINT, duration_ms BIGINT) AS $$
DECLARE
    v_query TEXT;
    v_full_table TEXT;
    v_start TIMESTAMPTZ;
    v_count BIGINT;
BEGIN
    v_start := clock_timestamp();
    
    -- Look up the original query
    SELECT source_query INTO v_query
    FROM cascata_geo.materialized_tables
    WHERE table_name = p_table_name AND schema_name = p_schema;
    
    IF v_query IS NULL THEN
        RAISE EXCEPTION 'Table "%" not found in materialized tables registry. Use cascata_geo.materialize() first.', p_table_name;
    END IF;
    
    v_full_table := quote_ident(p_schema) || '.' || quote_ident(p_table_name);
    
    -- Atomic refresh: truncate + insert in a single transaction
    EXECUTE format('TRUNCATE %s', v_full_table);
    EXECUTE format('INSERT INTO %s %s', v_full_table, v_query);
    EXECUTE format('SELECT count(*) FROM %s', v_full_table) INTO v_count;
    
    -- Update metadata
    UPDATE cascata_geo.materialized_tables 
    SET row_count = v_count, last_refresh = NOW(), refresh_count = refresh_count + 1
    WHERE table_name = p_table_name AND schema_name = p_schema;
    
    RETURN QUERY SELECT v_count, EXTRACT(MILLISECONDS FROM clock_timestamp() - v_start)::BIGINT;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- list_materialized: Show all materialized geo tables and their status
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cascata_geo.list_materialized()
RETURNS TABLE(
    table_name TEXT, 
    schema_name TEXT, 
    row_count BIGINT, 
    last_refresh TIMESTAMPTZ,
    refresh_count INT,
    age_minutes DOUBLE PRECISION
) AS $$
    SELECT 
        t.table_name, t.schema_name, t.row_count, t.last_refresh, t.refresh_count,
        EXTRACT(EPOCH FROM NOW() - t.last_refresh) / 60.0 AS age_minutes
    FROM cascata_geo.materialized_tables t
    ORDER BY t.last_refresh DESC;
$$ LANGUAGE sql;

-- ─────────────────────────────────────────────────────────────────────────────
-- drop_materialized: Remove a materialized table and its metadata
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION cascata_geo.drop_materialized(
    p_table_name TEXT,
    p_schema TEXT DEFAULT 'public'
) RETURNS VOID AS $$
BEGIN
    EXECUTE format('DROP TABLE IF EXISTS %I.%I CASCADE', p_schema, p_table_name);
    DELETE FROM cascata_geo.materialized_tables 
    WHERE table_name = p_table_name AND schema_name = p_schema;
END;
$$ LANGUAGE plpgsql;

-- ─────────────────────────────────────────────────────────────────────────────
-- Metadata table for tracking materialized geo tables
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cascata_geo.materialized_tables (
    table_name TEXT NOT NULL,
    schema_name TEXT NOT NULL DEFAULT 'public',
    source_query TEXT NOT NULL,
    row_count BIGINT DEFAULT 0,
    last_refresh TIMESTAMPTZ DEFAULT NOW(),
    refresh_count INT DEFAULT 0,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (table_name, schema_name)
);
