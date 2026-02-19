-- =============================================================================
-- Cascata PostGIS Shared Sidecar — Initialization Script
-- 
-- This container provides PostGIS capabilities shared across projects.
-- Each project connects via FDW and gets its own schema for isolation.
-- =============================================================================

-- Enable PostGIS extensions
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS postgis_topology;
CREATE EXTENSION IF NOT EXISTS postgis_tiger_geocoder;
CREATE EXTENSION IF NOT EXISTS address_standardizer;
CREATE EXTENSION IF NOT EXISTS address_standardizer_data_us;

-- Create a helper schema for shared functions
CREATE SCHEMA IF NOT EXISTS cascata_geo;

-- Function to create an isolated schema for a project
CREATE OR REPLACE FUNCTION cascata_geo.setup_project(
    p_project_id TEXT,
    p_password TEXT
) RETURNS VOID AS $$
DECLARE
    v_schema TEXT := 'geo_' || replace(p_project_id, '-', '_');
    v_role TEXT := 'geo_' || replace(p_project_id, '-', '_') || '_role';
BEGIN
    -- Create schema for this project
    EXECUTE format('CREATE SCHEMA IF NOT EXISTS %I', v_schema);
    
    -- Create a dedicated role for this project
    IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = v_role) THEN
        EXECUTE format('CREATE ROLE %I LOGIN PASSWORD %L', v_role, p_password);
    ELSE
        EXECUTE format('ALTER ROLE %I PASSWORD %L', v_role, p_password);
    END IF;
    
    -- Grant access ONLY to this project's schema
    EXECUTE format('GRANT USAGE ON SCHEMA %I TO %I', v_schema, v_role);
    EXECUTE format('GRANT ALL ON ALL TABLES IN SCHEMA %I TO %I', v_schema, v_role);
    EXECUTE format('ALTER DEFAULT PRIVILEGES IN SCHEMA %I GRANT ALL ON TABLES TO %I', v_schema, v_role);
    
    -- Grant access to PostGIS functions (read-only on public schema)
    EXECUTE format('GRANT USAGE ON SCHEMA public TO %I', v_role);
    EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO %I', v_role);
    
    -- Set search_path so project sees its own schema first
    EXECUTE format('ALTER ROLE %I SET search_path TO %I, public', v_role, v_schema);
    
    RAISE NOTICE 'PostGIS schema % ready for project %', v_schema, p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Function to teardown a project's geo resources
CREATE OR REPLACE FUNCTION cascata_geo.teardown_project(p_project_id TEXT) 
RETURNS VOID AS $$
DECLARE
    v_schema TEXT := 'geo_' || replace(p_project_id, '-', '_');
    v_role TEXT := 'geo_' || replace(p_project_id, '-', '_') || '_role';
BEGIN
    EXECUTE format('DROP SCHEMA IF EXISTS %I CASCADE', v_schema);
    EXECUTE format('DROP ROLE IF EXISTS %I', v_role);
    RAISE NOTICE 'PostGIS resources cleaned for project %', p_project_id;
END;
$$ LANGUAGE plpgsql;
