
import { NextFunction } from 'express';
import { CascataRequest } from '../types.js';
import { queryWithRLS, quoteId } from '../utils/index.js';
import { DatabaseService } from '../../services/DatabaseService.js';
import { PostgrestService } from '../../services/PostgrestService.js';
import { OpenApiService } from '../../services/OpenApiService.js';
import { systemPool } from '../config/main.js';

export class DataController {

    // --- HELPER: SCHEMA SECURITY GUARD ---
    private static checkSchemaAccess(req: CascataRequest): boolean {
        // 1. Admin/Dashboard always allowed
        if (req.isSystemRequest) return true;

        // 2. Explicit Opt-in for FlutterFlow/AppSmith/OpenAPI
        if (req.project.metadata?.schema_exposure === true) return true;

        return false;
    }

    // --- EXTENSION TIER METADATA ---
    private static readonly EXTENSION_TIERS: Record<string, { tier: number | 'shared'; weight: string }> = {
        // Tier 0 — Contrib (always available)
        'pgcrypto': { tier: 0, weight: '0 MB' }, 'uuid-ossp': { tier: 0, weight: '0 MB' },
        'pg_trgm': { tier: 0, weight: '0 MB' }, 'fuzzystrmatch': { tier: 0, weight: '0 MB' },
        'unaccent': { tier: 0, weight: '0 MB' }, 'hstore': { tier: 0, weight: '0 MB' },
        'citext': { tier: 0, weight: '0 MB' }, 'ltree': { tier: 0, weight: '0 MB' },
        'isn': { tier: 0, weight: '0 MB' }, 'cube': { tier: 0, weight: '0 MB' },
        'seg': { tier: 0, weight: '0 MB' }, 'intarray': { tier: 0, weight: '0 MB' },
        'btree_gin': { tier: 0, weight: '0 MB' }, 'btree_gist': { tier: 0, weight: '0 MB' },
        'earthdistance': { tier: 0, weight: '0 MB' }, 'dict_int': { tier: 0, weight: '0 MB' },
        'dict_xsyn': { tier: 0, weight: '0 MB' }, 'postgres_fdw': { tier: 0, weight: '0 MB' },
        'dblink': { tier: 0, weight: '0 MB' }, 'amcheck': { tier: 0, weight: '0 MB' },
        'pageinspect': { tier: 0, weight: '0 MB' }, 'pg_buffercache': { tier: 0, weight: '0 MB' },
        'pg_freespacemap': { tier: 0, weight: '0 MB' }, 'pg_visibility': { tier: 0, weight: '0 MB' },
        'pg_walinspect': { tier: 0, weight: '0 MB' }, 'moddatetime': { tier: 0, weight: '0 MB' },
        'autoinc': { tier: 0, weight: '0 MB' }, 'insert_username': { tier: 0, weight: '0 MB' },
        'plpgsql': { tier: 0, weight: '0 MB' }, 'pg_stat_statements': { tier: 0, weight: '0 MB' },
        // Tier 1 — Essential
        'vector': { tier: 1, weight: '~5 MB' }, 'pg_cron': { tier: 1, weight: '~2 MB' },
        // Tier 2 — Extended
        'http': { tier: 2, weight: '~2 MB' }, 'pgjwt': { tier: 2, weight: '~1 MB' },
        'pgsodium': { tier: 2, weight: '~3 MB' }, 'pgaudit': { tier: 2, weight: '~2 MB' },
        'pg_repack': { tier: 2, weight: '~2 MB' }, 'pg_hashids': { tier: 2, weight: '~1 MB' },
        'rum': { tier: 2, weight: '~3 MB' }, 'pg_net': { tier: 2, weight: '~3 MB' },
        'anon': { tier: 2, weight: '~5 MB' },
        // Tier 3 — Heavy
        'plpython3u': { tier: 3, weight: '~80 MB' }, 'plv8': { tier: 3, weight: '~100 MB' },
        'pljava': { tier: 3, weight: '~200 MB' }, 'timescaledb': { tier: 3, weight: '~50 MB' },
        'pg_graphql': { tier: 3, weight: '~20 MB' }, 'pg_jsonschema': { tier: 3, weight: '~10 MB' },
        'pgroonga': { tier: 3, weight: '~100 MB' },
        // Shared Services (via FDW) or Isolated (via INCLUDE_POSTGIS=true → Tier 3)
        'postgis': { tier: 'shared', weight: '~300 MB (shared or isolated)' },
        'postgis_topology': { tier: 'shared', weight: '~0 MB (shared or isolated)' },
        'postgis_tiger_geocoder': { tier: 'shared', weight: '~0 MB (shared or isolated)' },
        'address_standardizer': { tier: 'shared', weight: '~0 MB (shared or isolated)' },
        'address_standardizer_data_us': { tier: 'shared', weight: '~50 MB (shared or isolated)' },
        'pgrouting': { tier: 'shared', weight: '~50 MB (shared or isolated)' },
    };

    private static readonly PROTECTED_EXTENSIONS = ['plpgsql', 'pgcrypto', 'uuid-ossp'];

    // --- EXTENSIONS MANAGEMENT ---
    static async listExtensions(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) return res.status(403).json({ error: 'Unauthorized' });
        try {
            // Get available extensions from the actual PostgreSQL instance
            const result = await req.projectPool!.query(`
                SELECT name, default_version, installed_version, comment 
                FROM pg_available_extensions 
                ORDER BY (installed_version IS NOT NULL) DESC, name ASC
            `);

            // Enrich with tier metadata
            const enriched = result.rows.map((row: any) => {
                const meta = DataController.EXTENSION_TIERS[row.name];
                return {
                    ...row,
                    tier: meta?.tier ?? 0,
                    weight: meta?.weight ?? '0 MB',
                    available: true
                };
            });

            res.json(enriched);
        } catch (e: any) { next(e); }
    }

    static async toggleExtension(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) return res.status(403).json({ error: 'Unauthorized' });
        const { name, enable } = req.body;

        // Input validation
        if (!/^[a-zA-Z0-9_]+$/.test(name)) {
            return res.status(400).json({ error: 'Invalid extension name.' });
        }

        try {
            if (enable) {
                const tierMeta = DataController.EXTENSION_TIERS[name];

                // Check if extension is actually available in this PostgreSQL instance
                const availCheck = await req.projectPool!.query(
                    `SELECT name FROM pg_available_extensions WHERE name = $1`, [name]
                );

                // If available locally, just install it (works for INCLUDE_POSTGIS=true mode)
                if (availCheck.rows.length > 0) {
                    await req.projectPool!.query(`CREATE EXTENSION IF NOT EXISTS "${name}" SCHEMA public CASCADE`);
                    return res.json({ success: true });
                }

                // Not available locally — provide actionable guidance
                if (tierMeta?.tier === 'shared') {
                    return res.status(400).json({
                        error: `Extension '${name}' is not in the current image. Options: (1) Use "Setup Shared Geo" for FDW access, or (2) Rebuild with INCLUDE_POSTGIS=true for local install.`,
                        tier: 'shared',
                        action: 'setup_fdw_or_rebuild'
                    });
                }

                // Extension not available and not a shared service
                const tier = tierMeta?.tier ?? 'unknown';
                return res.status(400).json({
                    error: `Extension '${name}' is not available in the current database image. Rebuild with EXTENSION_TIER=${tier} or higher.`,
                    tier,
                    weight: tierMeta?.weight ?? 'unknown'
                });
            } else {
                // Protect core extensions from being dropped
                if (DataController.PROTECTED_EXTENSIONS.includes(name)) {
                    return res.status(400).json({
                        error: `Extension '${name}' is a core extension and cannot be disabled.`
                    });
                }
                await req.projectPool!.query(`DROP EXTENSION IF EXISTS "${name}" CASCADE`);
            }
            res.json({ success: true });
        } catch (e: any) { next(e); }
    }

    // --- SHARED GEO FDW SETUP ---
    static async setupSharedGeoFDW(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) return res.status(403).json({ error: 'Unauthorized' });

        const dbUser = process.env.DB_USER || 'cascata_admin';
        const dbPass = process.env.DB_PASS || 'secure_pass';
        const geoHost = 'shared_geo'; // Docker service name
        const projectId = req.project?.slug || 'default';

        try {
            const pool = req.projectPool!;

            // 1. Create the foreign data wrapper
            await pool.query(`CREATE EXTENSION IF NOT EXISTS postgres_fdw`);

            // 2. Create the foreign server pointing to shared_geo container
            await pool.query(`
                DO $$ BEGIN
                    IF NOT EXISTS (SELECT 1 FROM pg_foreign_server WHERE srvname = 'shared_geo_server') THEN
                        CREATE SERVER shared_geo_server 
                        FOREIGN DATA WRAPPER postgres_fdw 
                        OPTIONS (host '${geoHost}', port '5432', dbname 'cascata_geo');
                    END IF;
                END $$;
            `);

            // 3. Create user mapping
            await pool.query(`
                DO $$ BEGIN
                    BEGIN
                        CREATE USER MAPPING FOR CURRENT_USER 
                        SERVER shared_geo_server 
                        OPTIONS (user '${dbUser}', password '${dbPass}');
                    EXCEPTION WHEN duplicate_object THEN
                        NULL; -- mapping already exists
                    END;
                END $$;
            `);

            // 4. Import the geo schema
            await pool.query(`CREATE SCHEMA IF NOT EXISTS geo_remote`);
            await pool.query(`
                IMPORT FOREIGN SCHEMA public 
                FROM SERVER shared_geo_server 
                INTO geo_remote
            `);

            res.json({
                success: true,
                message: 'PostGIS shared service connected. Geo functions available in schema "geo_remote".',
                schema: 'geo_remote'
            });
        } catch (e: any) { next(e); }
    }

    // --- DATA OPERATIONS ---

    static async listTables(req: CascataRequest, res: any, next: any) {
        if (!DataController.checkSchemaAccess(req)) {
            return res.status(403).json({ error: 'Schema access disabled. Enable "Schema Exposure" in settings.' });
        }
        try {
            const result = await queryWithRLS(req, async (client) => {
                return await client.query(`
                    SELECT table_name as name, table_schema as schema 
                    FROM information_schema.tables 
                    WHERE table_schema = 'public' 
                    AND table_type = 'BASE TABLE' 
                    AND table_name NOT LIKE '_deleted_%'
                    ORDER BY table_name
                `);
            });
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async queryRows(req: CascataRequest, res: any, next: any) {
        try {
            if (!req.params.tableName) throw new Error("Table name required");
            const safeTable = quoteId(req.params.tableName);
            const limit = Math.min(parseInt(req.query.limit as string) || 100, 1000);
            const offset = parseInt(req.query.offset as string) || 0;
            const result = await queryWithRLS(req, async (client) => {
                return await client.query(`SELECT * FROM public.${safeTable} LIMIT $1 OFFSET $2`, [limit, offset]);
            });
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async insertRows(req: CascataRequest, res: any, next: any) {
        try {
            const safeTable = quoteId(req.params.tableName);
            const { data } = req.body;
            if (!data) throw new Error("No data provided");

            const rows = Array.isArray(data) ? data : [data];
            if (rows.length === 0) return res.json([]);

            const allKeys = new Set<string>();
            rows.forEach(row => Object.keys(row).forEach(k => allKeys.add(k)));

            const keysArray = Array.from(allKeys);
            if (keysArray.length === 0) throw new Error("Cannot insert empty objects");

            const columns = keysArray.map(quoteId).join(', ');
            const flatValues: any[] = [];

            const valuesPlaceholder = rows.map((row) => {
                const rowPlaceholders = keysArray.map((key) => {
                    const val = row[key];
                    if (val === undefined) {
                        return 'DEFAULT';
                    } else {
                        flatValues.push(val);
                        return `$${flatValues.length}`;
                    }
                });
                return `(${rowPlaceholders.join(', ')})`;
            }).join(', ');

            if (flatValues.length > 65000) {
                throw new Error("Batch too large. Reduce rows or columns.");
            }

            const result = await queryWithRLS(req, async (client) => {
                return await client.query(`INSERT INTO public.${safeTable} (${columns}) VALUES ${valuesPlaceholder} RETURNING *`, flatValues);
            });
            res.status(201).json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async updateRows(req: CascataRequest, res: any, next: any) {
        try {
            const safeTable = quoteId(req.params.tableName);
            const { data, pkColumn, pkValue } = req.body;
            if (!data || !pkColumn || pkValue === undefined) throw new Error("Missing data or PK");
            const updates = Object.keys(data).map((k, i) => `${quoteId(k)} = $${i + 1}`).join(', ');
            const values = Object.values(data);
            const pkValIndex = values.length + 1;
            const result = await queryWithRLS(req, async (client) => {
                return await client.query(`UPDATE public.${safeTable} SET ${updates} WHERE ${quoteId(pkColumn)} = $${pkValIndex} RETURNING *`, [...values, pkValue]);
            });
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async deleteRows(req: CascataRequest, res: any, next: any) {
        try {
            const tableName = req.params.tableName;
            const safeTable = quoteId(tableName);
            const { ids } = req.body;

            if (!ids || !Array.isArray(ids) || ids.length === 0) throw new Error("Invalid delete request: 'ids' array required");

            const pkQuery = `
                SELECT kcu.column_name 
                FROM information_schema.table_constraints tco
                JOIN information_schema.key_column_usage kcu 
                  ON kcu.constraint_name = tco.constraint_name
                  AND kcu.constraint_schema = tco.constraint_schema
                WHERE tco.constraint_type = 'PRIMARY KEY'
                  AND tco.table_schema = 'public'
                  AND tco.table_name = $1
            `;

            const pkRes = await req.projectPool!.query(pkQuery, [tableName]);

            if (pkRes.rows.length === 0) {
                return res.status(400).json({ error: "Safety Block: Table has no Primary Key. Use SQL Editor." });
            }

            if (pkRes.rows.length > 1) {
                return res.status(400).json({
                    error: "Safety Block: Composite Primary Keys not supported via simple list deletion. Use SQL Editor."
                });
            }

            const realPkColumn = pkRes.rows[0].column_name;

            const result = await queryWithRLS(req, async (client) => {
                return await client.query(`DELETE FROM public.${safeTable} WHERE ${quoteId(realPkColumn)} = ANY($1) RETURNING *`, [ids]);
            });
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    // --- RPC & FUNCTIONS ---

    static async executeRpc(req: CascataRequest, res: any, next: any) {
        const params = req.body || {};
        const namedPlaceholders = Object.keys(params).map((k, i) => `${quoteId(k)} => $${i + 1}`).join(', ');
        const values = Object.values(params);

        try {
            const rows = await queryWithRLS(req, async (client) => {
                const result = await client.query(`SELECT * FROM public.${quoteId(req.params.name)}(${namedPlaceholders})`, values);
                return result.rows;
            });
            res.json(rows);
        } catch (e: any) { next(e); }
    }

    static async listFunctions(req: CascataRequest, res: any, next: any) {
        if (!DataController.checkSchemaAccess(req)) {
            return res.status(403).json({ error: 'Schema access disabled.' });
        }
        try {
            const result = await req.projectPool!.query(`SELECT routine_name as name FROM information_schema.routines WHERE routine_schema = 'public' AND routine_name NOT LIKE 'uuid_%' AND routine_name NOT LIKE 'pgp_%'`);
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async listTriggers(req: CascataRequest, res: any, next: any) {
        if (!DataController.checkSchemaAccess(req)) {
            return res.status(403).json({ error: 'Schema access disabled.' });
        }
        try {
            const result = await req.projectPool!.query("SELECT trigger_name as name FROM information_schema.triggers");
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async getFunctionDefinition(req: CascataRequest, res: any, next: any) {
        if (!DataController.checkSchemaAccess(req)) {
            return res.status(403).json({ error: 'Schema access disabled.' });
        }
        try {
            const defResult = await req.projectPool!.query("SELECT pg_get_functiondef(oid) as def FROM pg_proc WHERE proname = $1", [req.params.name]);
            const argsResult = await req.projectPool!.query(`SELECT parameter_name as name, data_type as type, parameter_mode as mode FROM information_schema.parameters WHERE specific_name = (SELECT specific_name FROM information_schema.routines WHERE routine_name = $1 LIMIT 1) ORDER BY ordinal_position ASC`, [req.params.name]);
            if (defResult.rows.length === 0) return res.status(404).json({ error: 'Function not found' });
            res.json({ definition: defResult.rows[0].def, args: argsResult.rows });
        } catch (e: any) { next(e); }
    }

    // --- SCHEMA & METADATA ---

    static async getColumns(req: CascataRequest, res: any, next: any) {
        if (!DataController.checkSchemaAccess(req)) {
            return res.status(403).json({ error: 'Schema access disabled.' });
        }
        try {
            const result = await req.projectPool!.query(`SELECT column_name as name, data_type as type, is_nullable, column_default as "defaultValue", EXISTS (SELECT 1 FROM information_schema.key_column_usage kcu WHERE kcu.table_name = $1 AND kcu.column_name = c.column_name) as "isPrimaryKey" FROM information_schema.columns c WHERE table_schema = 'public' AND table_name = $1`, [req.params.tableName]);
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async runRawQuery(req: CascataRequest, res: any, next: any) {
        if (req.userRole !== 'service_role') { res.status(403).json({ error: 'Only Service Role can execute raw SQL' }); return; }
        try {
            const start = Date.now();
            const client = await req.projectPool!.connect();
            try {
                await client.query("SET LOCAL statement_timeout = '20s'");
                const result = await client.query(req.body.sql);
                res.json({ rows: result.rows, rowCount: result.rowCount, command: result.command, duration: Date.now() - start });
            } finally {
                client.release();
            }
        } catch (e: any) {
            if (e.code) {
                return res.status(400).json({ error: e.message, code: e.code, position: e.position });
            }
            next(e);
        }
    }

    static async createTable(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) { res.status(403).json({ error: 'Only Dashboard can create tables.' }); return; }
        const { name, columns, description } = req.body;
        try {
            if (req.projectPool) await DatabaseService.validateTableDefinition(req.projectPool, name, columns);
            const safeName = quoteId(name);
            const colDefs = columns.map((c: any) => {
                let def = `${quoteId(c.name)} ${c.type}`;
                if (c.primaryKey) def += ' PRIMARY KEY';
                if (!c.nullable && !c.primaryKey) def += ' NOT NULL';
                if (c.default) def += ` DEFAULT ${c.default}`;
                if (c.isUnique) def += ' UNIQUE';
                if (c.foreignKey) def += ` REFERENCES ${quoteId(c.foreignKey.table)}(${quoteId(c.foreignKey.column)})`;
                return def;
            }).join(', ');
            const sql = `CREATE TABLE public.${safeName} (${colDefs});`;
            await req.projectPool!.query(sql);
            await req.projectPool!.query(`ALTER TABLE public.${safeName} ENABLE ROW LEVEL SECURITY`);
            await req.projectPool!.query(`CREATE TRIGGER ${name}_changes AFTER INSERT OR UPDATE OR DELETE ON public.${safeName} FOR EACH ROW EXECUTE FUNCTION public.notify_changes();`);
            if (description) await req.projectPool!.query(`COMMENT ON TABLE public.${safeName} IS $1`, [description]);
            res.json({ success: true });
        } catch (e: any) { next(e); }
    }

    // --- RECYCLE BIN & SOFT DELETE ---

    static async deleteTable(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) { res.status(403).json({ error: 'Only Dashboard can delete tables.' }); return; }
        const { mode } = req.body;
        try {
            if (mode === 'CASCADE' || mode === 'RESTRICT') {
                const cascadeSql = mode === 'CASCADE' ? 'CASCADE' : '';
                await req.projectPool!.query(`DROP TABLE public.${quoteId(req.params.table)} ${cascadeSql}`);
            } else {
                const deletedName = `_deleted_${Date.now()}_${req.params.table}`;
                await req.projectPool!.query(`ALTER TABLE public.${quoteId(req.params.table)} RENAME TO ${quoteId(deletedName)}`);
            }
            res.json({ success: true });
        } catch (e: any) { next(e); }
    }

    static async listRecycleBin(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) { res.status(403).json({ error: 'Unauthorized' }); return; }
        try {
            const result = await req.projectPool!.query("SELECT table_name as name FROM information_schema.tables WHERE table_schema = 'public' AND table_name LIKE '_deleted_%'");
            res.json(result.rows);
        } catch (e: any) { next(e); }
    }

    static async restoreTable(req: CascataRequest, res: any, next: any) {
        if (!req.isSystemRequest) { res.status(403).json({ error: 'Unauthorized' }); return; }
        try {
            const originalName = req.params.table.replace(/^_deleted_\d+_/, '');
            await req.projectPool!.query(`ALTER TABLE public.${quoteId(req.params.table)} RENAME TO ${quoteId(originalName)}`);
            res.json({ success: true, restoredName: originalName });
        } catch (e: any) { next(e); }
    }

    // --- SYSTEM ASSETS & SETTINGS (GLOBAL via systemPool) ---
    // (Omitted methods remain unchanged for brevity, but are required in full implementation)
    // ... getUiSettings, saveUiSettings, getAssets, upsertAsset, deleteAsset, getAssetHistory ...

    static async getUiSettings(req: CascataRequest, res: any, next: any) { try { const result = await systemPool.query('SELECT settings FROM system.ui_settings WHERE project_slug = $1 AND table_name = $2', [req.params.slug, req.params.table]); res.json(result.rows[0]?.settings || {}); } catch (e: any) { next(e); } }
    static async saveUiSettings(req: CascataRequest, res: any, next: any) { try { await systemPool.query("INSERT INTO system.ui_settings (project_slug, table_name, settings) VALUES ($1, $2, $3) ON CONFLICT (project_slug, table_name) DO UPDATE SET settings = $3", [req.params.slug, req.params.table, req.body.settings]); res.json({ success: true }); } catch (e: any) { next(e); } }
    static async getAssets(req: CascataRequest, res: any, next: any) { try { const result = await systemPool.query('SELECT * FROM system.assets WHERE project_slug = $1', [req.project.slug]); res.json(result.rows); } catch (e: any) { next(e); } }
    static async upsertAsset(req: CascataRequest, res: any, next: any) { const { id, name, type, parent_id, metadata } = req.body; try { let assetId = id; const safeParentId = (parent_id === 'root' || parent_id === '') ? null : parent_id; if (id) { let query = 'UPDATE system.assets SET name=$1, metadata=$2 WHERE id=$3 RETURNING *'; let params = [name, metadata, id]; if (parent_id !== undefined) { query = 'UPDATE system.assets SET name=$1, metadata=$2, parent_id=$4 WHERE id=$3 RETURNING *'; params = [name, metadata, id, safeParentId]; } const upd = await systemPool.query(query, params); assetId = upd.rows[0].id; res.json(upd.rows[0]); } else { const ins = await systemPool.query('INSERT INTO system.assets (project_slug, name, type, parent_id, metadata) VALUES ($1, $2, $3, $4, $5) RETURNING *', [req.project.slug, name, type, safeParentId, metadata]); assetId = ins.rows[0].id; res.json(ins.rows[0]); } if (metadata?.sql) systemPool.query('INSERT INTO system.asset_history (asset_id, project_slug, content, metadata, created_by) VALUES ($1, $2, $3, $4, $5)', [assetId, req.project.slug, metadata.sql, metadata, req.userRole]); } catch (e: any) { next(e); } }
    static async deleteAsset(req: CascataRequest, res: any, next: any) { if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(req.params.id)) return res.json({ success: true }); try { await systemPool.query('DELETE FROM system.assets WHERE id=$1', [req.params.id]); res.json({ success: true }); } catch (e: any) { next(e); } }
    static async getAssetHistory(req: CascataRequest, res: any, next: any) { try { const result = await systemPool.query('SELECT id, created_at, created_by, metadata FROM system.asset_history WHERE asset_id = $1 ORDER BY created_at DESC LIMIT 50', [req.params.id]); res.json(result.rows); } catch (e: any) { next(e); } }

    static async getStats(req: CascataRequest, res: any, next: any) {
        try {
            const logsRes = await systemPool.query(`
                SELECT 
                    to_char(created_at, 'HH24:00') as name, 
                    count(*) as requests,
                    count(CASE WHEN status_code >= 200 AND status_code < 300 THEN 1 END) as success,
                    count(CASE WHEN status_code >= 400 THEN 1 END) as error
                FROM system.api_logs 
                WHERE project_slug = $1 
                  AND created_at > NOW() - INTERVAL '24 hours'
                GROUP BY 1 
                ORDER BY 1
            `, [req.project.slug]);

            const client = await req.projectPool!.connect();
            try {
                await client.query("RESET ROLE");
                const [tables, users, size] = await Promise.all([
                    client.query("SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public' AND table_name NOT LIKE '_deleted_%'"),
                    client.query("SELECT count(*) FROM auth.users"),
                    client.query("SELECT pg_size_pretty(pg_database_size(current_database()))")
                ]);

                res.json({
                    tables: parseInt(tables.rows[0].count),
                    users: parseInt(users.rows[0].count),
                    size: size.rows[0].pg_size_pretty,
                    throughput: logsRes.rows.map(r => ({
                        name: r.name,
                        requests: parseInt(r.requests),
                        success: parseInt(r.success),
                        error: parseInt(r.error)
                    }))
                });
            } finally {
                client.release();
            }
        } catch (e: any) { next(e); }
    }

    // --- POSTGREST COMPATIBILITY ---

    static async handlePostgrest(req: CascataRequest, res: any, next: any) {
        if (!['GET', 'POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) return next();
        try {
            const { text, values, countQuery } = PostgrestService.buildQuery(
                req.params.tableName,
                req.method,
                req.query,
                req.body,
                req.headers
            );

            const result = await queryWithRLS(req, async (client) => {
                if (countQuery) {
                    await client.query("SET LOCAL statement_timeout = '5s'");
                    const countRes = await client.query(countQuery, values);
                    const total = parseInt((countRes.rows[0] as any)?.total || '0');
                    const mainRes = await client.query(text, values);
                    const offset = parseInt(req.query.offset as string || '0');
                    const start = offset;
                    const end = Math.min(offset + mainRes.rows.length - 1, total - 1);
                    res.setHeader('Content-Range', mainRes.rows.length === 0 ? `*/${total}` : `${start}-${end}/${total}`);
                    return mainRes;
                }
                return await client.query(text, values);
            });

            if (req.headers.accept === 'application/vnd.pgrst.object+json') {
                res.json(result.rows[0] || null);
            } else {
                res.json(result.rows);
            }
        } catch (e: any) { next(e); }
    }

    // --- SPEC GENERATION ---

    static async getOpenApiSpec(req: CascataRequest, res: any, next: any) {
        const r = req as CascataRequest;
        const isDiscoveryEnabled = r.project.metadata?.schema_exposure === true;
        if (!r.isSystemRequest && !isDiscoveryEnabled) {
            return res.status(403).json({ error: 'API Schema Discovery is disabled.' });
        }
        try {
            const protocol = req.headers['x-forwarded-proto'] || 'http';
            const host = req.headers.host;
            let baseUrl = '';
            if (r.project.custom_domain && host === r.project.custom_domain) {
                baseUrl = `${protocol}://${host}/rest/v1`;
            } else {
                baseUrl = `${protocol}://${host}/api/data/${r.project.slug}/rest/v1`;
            }
            const spec = await OpenApiService.generatePostgrest(
                r.project.slug,
                r.project.db_name,
                r.projectPool!,
                systemPool,
                baseUrl
            );
            res.json(spec);
        } catch (e: any) { next(e); }
    }
}
