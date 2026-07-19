package persistence

var migrations = []string{
	`CREATE TABLE IF NOT EXISTS app_metadata (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS settings (
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL DEFAULT '',
        namespace TEXT NOT NULL,
        key TEXT NOT NULL,
        value_json TEXT NOT NULL,
        value_version INTEGER NOT NULL DEFAULT 1,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (scope, scope_id, namespace, key)
    );
    CREATE TABLE IF NOT EXISTS connection_profiles (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        host TEXT NOT NULL,
        port INTEGER NOT NULL CHECK (port BETWEEN 1 AND 65535),
        database_name TEXT NOT NULL,
        username TEXT NOT NULL,
        ssl_mode TEXT NOT NULL,
        connect_timeout_ms INTEGER NOT NULL,
        color TEXT NOT NULL,
        read_only_default INTEGER NOT NULL DEFAULT 1,
        auto_connect INTEGER NOT NULL DEFAULT 0,
        private_mode INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        last_connected_at TEXT
    );
    CREATE UNIQUE INDEX IF NOT EXISTS connection_profiles_identity_idx
        ON connection_profiles(host, port, database_name, username);
    CREATE TABLE IF NOT EXISTS secret_bindings (
        owner_type TEXT NOT NULL,
        owner_id TEXT NOT NULL,
        purpose TEXT NOT NULL,
        provider TEXT NOT NULL,
        opaque_key TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (owner_type, owner_id, purpose)
    );
    CREATE TABLE IF NOT EXISTS workbooks (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        state TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        revision INTEGER NOT NULL DEFAULT 1,
        active_document_id TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT
    );
    CREATE INDEX IF NOT EXISTS workbooks_updated_idx ON workbooks(deleted_at, updated_at DESC);
    CREATE TABLE IF NOT EXISTS workbook_documents (
        id TEXT PRIMARY KEY,
        workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
        kind TEXT NOT NULL,
        title TEXT NOT NULL,
        position INTEGER NOT NULL,
        profile_id TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
        database_name TEXT,
        content_json TEXT NOT NULL,
        content_version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS workbook_documents_order_idx ON workbook_documents(workbook_id, position);
    CREATE TABLE IF NOT EXISTS workbook_revisions (
        id TEXT PRIMARY KEY,
        workbook_id TEXT NOT NULL REFERENCES workbooks(id) ON DELETE CASCADE,
        revision INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(workbook_id, revision)
    );
    CREATE TABLE IF NOT EXISTS query_runs (
        id TEXT PRIMARY KEY,
        document_id TEXT,
        profile_id TEXT REFERENCES connection_profiles(id) ON DELETE SET NULL,
        database_name TEXT,
        sql_text TEXT NOT NULL,
        query_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        command TEXT,
        duration_ms REAL NOT NULL DEFAULT 0,
        row_count INTEGER NOT NULL DEFAULT 0,
        truncated INTEGER NOT NULL DEFAULT 0,
        error_category TEXT,
        executed_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS query_runs_executed_idx ON query_runs(executed_at DESC);`,
	`DROP INDEX IF EXISTS connection_profiles_identity_idx;`,
}
