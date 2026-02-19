
export interface ExtensionMeta {
    name: string;
    category: 'AI' | 'Admin' | 'Audit' | 'Crypto' | 'DataType' | 'Geo' | 'Index' | 'Lang' | 'Net' | 'Search' | 'Time' | 'Util';
    description: string;
    featured?: boolean;
    tier: 0 | 1 | 2 | 3 | 'shared';
    weight: string;
}

export const EXTENSIONS_CATALOG: ExtensionMeta[] = [
    // --- AI & VECTOR ---
    { name: 'vector', category: 'AI', description: 'Store and query vector embeddings. Essential for AI/RAG applications.', featured: true, tier: 1, weight: '~5 MB' },

    // --- GEO (Shared via FDW or Isolated via INCLUDE_POSTGIS=true) ---
    { name: 'postgis', category: 'Geo', description: 'Spatial and geographic objects. Available via shared sidecar (FDW) or isolated (INCLUDE_POSTGIS=true).', featured: true, tier: 'shared', weight: '~300 MB' },
    { name: 'postgis_tiger_geocoder', category: 'Geo', description: 'Tiger Geocoder for PostGIS.', tier: 'shared', weight: '~0 MB' },
    { name: 'postgis_topology', category: 'Geo', description: 'Topology spatial types and functions.', tier: 'shared', weight: '~0 MB' },
    { name: 'address_standardizer', category: 'Geo', description: 'Parse addresses into elements. Useful for geocoding normalization.', tier: 'shared', weight: '~0 MB' },
    { name: 'address_standardizer_data_us', category: 'Geo', description: 'US dataset for address standardizer.', tier: 'shared', weight: '~50 MB' },
    { name: 'earthdistance', category: 'Geo', description: 'Calculate great circle distances on the surface of the Earth.', tier: 0, weight: '0 MB' },
    { name: 'pgrouting', category: 'Geo', description: 'Geospatial routing functionality.', tier: 'shared', weight: '~50 MB' },

    // --- CRYPTO & SECURITY ---
    { name: 'pgcrypto', category: 'Crypto', description: 'Cryptographic functions (hashing, encryption, UUID generation).', featured: true, tier: 0, weight: '0 MB' },
    { name: 'pgsodium', category: 'Crypto', description: 'Modern cryptography using libsodium (encryption, signatures, hashing).', tier: 2, weight: '~3 MB' },
    { name: 'pgjwt', category: 'Crypto', description: 'JSON Web Token API for PostgreSQL.', tier: 2, weight: '~1 MB' },
    { name: 'anon', category: 'Crypto', description: 'Data anonymization tools.', tier: 2, weight: '~5 MB' },

    // --- SEARCH & TEXT ---
    { name: 'pg_trgm', category: 'Search', description: 'Text similarity measurement and index searching based on trigrams.', featured: true, tier: 0, weight: '0 MB' },
    { name: 'fuzzystrmatch', category: 'Search', description: 'Determine similarities and distances between strings (Levenshtein, Soundex).', tier: 0, weight: '0 MB' },
    { name: 'unaccent', category: 'Search', description: 'Text search dictionary that removes accents.', tier: 0, weight: '0 MB' },
    { name: 'dict_int', category: 'Search', description: 'Text search dictionary template for integers.', tier: 0, weight: '0 MB' },
    { name: 'dict_xsyn', category: 'Search', description: 'Text search dictionary template for extended synonym processing.', tier: 0, weight: '0 MB' },
    { name: 'btree_gin', category: 'Index', description: 'Support for indexing common data types in GIN.', tier: 0, weight: '0 MB' },
    { name: 'btree_gist', category: 'Index', description: 'Support for indexing common data types in GiST.', tier: 0, weight: '0 MB' },
    { name: 'rum', category: 'Index', description: 'RUM index method (faster full text search).', tier: 2, weight: '~3 MB' },
    { name: 'pgroonga', category: 'Search', description: 'Fast full text search for all languages based on Groonga.', tier: 3, weight: '~100 MB' },

    // --- DATA TYPES ---
    { name: 'uuid-ossp', category: 'DataType', description: 'Functions to generate universally unique identifiers (UUIDs).', featured: true, tier: 0, weight: '0 MB' },
    { name: 'hstore', category: 'DataType', description: 'Data type for storing sets of (key, value) pairs.', tier: 0, weight: '0 MB' },
    { name: 'citext', category: 'DataType', description: 'Case-insensitive character string type.', tier: 0, weight: '0 MB' },
    { name: 'ltree', category: 'DataType', description: 'Hierarchical tree-like data structure.', tier: 0, weight: '0 MB' },
    { name: 'isn', category: 'DataType', description: 'Data types for international product numbering standards (ISBN, EAN, UPC).', tier: 0, weight: '0 MB' },
    { name: 'cube', category: 'DataType', description: 'Data type for multidimensional cubes.', tier: 0, weight: '0 MB' },
    { name: 'seg', category: 'DataType', description: 'Data type for line segments or floating point intervals.', tier: 0, weight: '0 MB' },
    { name: 'intarray', category: 'DataType', description: 'Functions, operators, and indexes for 1-D arrays of integers.', tier: 0, weight: '0 MB' },

    // --- UTILITY & ADMIN ---
    { name: 'pg_cron', category: 'Util', description: 'Job scheduler for PostgreSQL (run SQL on a schedule).', featured: true, tier: 1, weight: '~2 MB' },
    { name: 'pg_net', category: 'Net', description: 'Async HTTP client (GET, POST) directly from SQL.', tier: 2, weight: '~3 MB' },
    { name: 'http', category: 'Net', description: 'HTTP client for PostgreSQL, allows retrieving web pages.', tier: 2, weight: '~2 MB' },
    { name: 'pg_stat_statements', category: 'Audit', description: 'Track execution statistics of all SQL statements executed.', tier: 0, weight: '0 MB' },
    { name: 'pgaudit', category: 'Audit', description: 'Provide auditing functionality.', tier: 2, weight: '~2 MB' },
    { name: 'pg_graphql', category: 'Util', description: 'GraphQL support for PostgreSQL.', tier: 3, weight: '~20 MB' },
    { name: 'pg_jsonschema', category: 'Util', description: 'JSON Schema validation for JSONB columns.', tier: 3, weight: '~10 MB' },
    { name: 'pg_hashids', category: 'Util', description: 'Short unique IDs from integers (like YouTube IDs).', tier: 2, weight: '~1 MB' },
    { name: 'timescaledb', category: 'Time', description: 'Scalable inserts and complex queries for time-series data.', tier: 3, weight: '~50 MB' },
    { name: 'postgres_fdw', category: 'Admin', description: 'Foreign-data wrapper for remote PostgreSQL servers.', tier: 0, weight: '0 MB' },
    { name: 'dblink', category: 'Admin', description: 'Connect to other PostgreSQL databases from within a database.', tier: 0, weight: '0 MB' },
    { name: 'amcheck', category: 'Admin', description: 'Functions for verifying relation integrity.', tier: 0, weight: '0 MB' },
    { name: 'pageinspect', category: 'Admin', description: 'Inspect the contents of database pages at a low level.', tier: 0, weight: '0 MB' },
    { name: 'pg_buffercache', category: 'Admin', description: 'Examine the shared buffer cache.', tier: 0, weight: '0 MB' },
    { name: 'pg_freespacemap', category: 'Admin', description: 'Examine the free space map (FSM).', tier: 0, weight: '0 MB' },
    { name: 'pg_visibility', category: 'Admin', description: 'Examine the visibility map (VM) and page-level visibility information.', tier: 0, weight: '0 MB' },
    { name: 'pg_walinspect', category: 'Admin', description: 'Inspect the contents of Write-Ahead Log.', tier: 0, weight: '0 MB' },
    { name: 'pg_repack', category: 'Admin', description: 'Reorganize tables in PostgreSQL databases with minimal locks.', tier: 2, weight: '~2 MB' },
    { name: 'moddatetime', category: 'Util', description: 'Functions for tracking last modification time.', tier: 0, weight: '0 MB' },
    { name: 'autoinc', category: 'Util', description: 'Functions for autoincrementing fields.', tier: 0, weight: '0 MB' },
    { name: 'insert_username', category: 'Util', description: 'Functions for tracking who changed a table.', tier: 0, weight: '0 MB' },

    // --- LANGUAGES ---
    { name: 'plpgsql', category: 'Lang', description: 'PL/pgSQL procedural language.', tier: 0, weight: '0 MB' },
    { name: 'plv8', category: 'Lang', description: 'PL/JavaScript (v8) trusted procedural language.', tier: 3, weight: '~100 MB' },
    { name: 'pljava', category: 'Lang', description: 'PL/Java procedural language.', tier: 3, weight: '~200 MB' },
    { name: 'plpython3u', category: 'Lang', description: 'PL/Python procedural language.', tier: 3, weight: '~80 MB' }
];

export const getExtensionMeta = (name: string): ExtensionMeta => {
    const found = EXTENSIONS_CATALOG.find(e => e.name === name);
    return found || {
        name,
        category: 'Util',
        description: 'No description available for this extension.',
        tier: 0,
        weight: '0 MB'
    };
};
