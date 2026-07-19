package postgres

import (
	"context"
	"fmt"
	"strings"
	"time"
)

func (s *Service) ListDatabases(connectionID string) ([]DatabaseSummary, error) {
	conn, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	rows, err := conn.pool.Query(ctx, `
		select d.datname,
		       pg_catalog.pg_get_userbyid(d.datdba),
		       coalesce(pg_database_size(d.oid), 0),
		       d.datallowconn,
		       d.datistemplate,
		       d.datname = current_database()
		from pg_database d
		where d.datallowconn
		  and not d.datistemplate
		order by case when d.datname = current_database() then 0 else 1 end,
		         case when d.datname = 'postgres' then 2 else 3 end,
		         d.datname`)
	if err != nil {
		return nil, fmt.Errorf("could not list databases: %w", err)
	}
	defer rows.Close()
	result := make([]DatabaseSummary, 0)
	for rows.Next() {
		var item DatabaseSummary
		if err := rows.Scan(&item.Name, &item.Owner, &item.SizeBytes, &item.AllowConnections, &item.IsTemplate, &item.IsCurrent); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

// EnsureDatabase opens (or reuses) a pool for another database on the same server
// as connectionID, using the parent connection's session credentials.
func (s *Service) EnsureDatabase(connectionID, databaseName string) (*ConnectionSummary, error) {
	databaseName = strings.TrimSpace(databaseName)
	if databaseName == "" {
		return nil, fmt.Errorf("database name is required")
	}

	parent, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}

	s.mu.RLock()
	for _, conn := range s.connections {
		if conn.summary.Host == parent.summary.Host &&
			conn.summary.Port == parent.summary.Port &&
			conn.summary.Username == parent.summary.Username &&
			conn.summary.Database == databaseName {
			summary := conn.summary
			s.mu.RUnlock()
			return &summary, nil
		}
	}
	credentials := parent.credentials
	s.mu.RUnlock()

	if credentials.Host == "" {
		return nil, fmt.Errorf("cannot open database %q: session credentials are unavailable for this connection", databaseName)
	}

	input := credentials
	input.Database = databaseName
	if input.Name == credentials.Database || input.Name == "" {
		input.Name = databaseName
	} else {
		input.Name = fmt.Sprintf("%s / %s", credentials.Name, databaseName)
	}
	return s.Connect(input)
}

func (s *Service) ListSchemas(connectionID string) ([]SchemaSummary, error) {
	conn, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	rows, err := conn.pool.Query(ctx, `
		select n.nspname,
		       count(c.oid) filter (where c.relkind in ('r','p','v','m','f')) as relation_count,
		       coalesce(sum(pg_total_relation_size(c.oid)) filter (where c.relkind in ('r','p','m')), 0) as size_bytes
		from pg_namespace n
		left join pg_class c on c.relnamespace = n.oid
		where n.nspname <> 'information_schema'
		  and n.nspname not like 'pg\_%' escape '\'
		group by n.nspname
		order by case when n.nspname = 'public' then 0 else 1 end, n.nspname`)
	if err != nil {
		return nil, fmt.Errorf("could not inspect schemas: %w", err)
	}
	defer rows.Close()
	result := make([]SchemaSummary, 0)
	for rows.Next() {
		var item SchemaSummary
		if err := rows.Scan(&item.Name, &item.RelationCount, &item.SizeBytes); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) ListRelations(connectionID, schema string) ([]RelationSummary, error) {
	conn, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()
	rows, err := conn.pool.Query(ctx, `
		select n.nspname, c.relname,
		       case c.relkind when 'r' then 'table' when 'p' then 'partitioned table' when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else c.relkind::text end,
		       greatest(c.reltuples, 0),
		       case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) else 0 end,
		       coalesce(obj_description(c.oid, 'pg_class'), ''),
		       greatest(st.last_vacuum, st.last_autovacuum)::text
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		left join pg_stat_all_tables st on st.relid = c.oid
		where n.nspname = $1 and c.relkind in ('r','p','v','m','f')
		order by c.relname`, schema)
	if err != nil {
		return nil, fmt.Errorf("could not inspect relations: %w", err)
	}
	defer rows.Close()
	result := make([]RelationSummary, 0)
	for rows.Next() {
		var item RelationSummary
		if err := rows.Scan(&item.Schema, &item.Name, &item.Kind, &item.EstimatedRows, &item.SizeBytes, &item.Description, &item.LastVacuum); err != nil {
			return nil, err
		}
		result = append(result, item)
	}
	return result, rows.Err()
}

func (s *Service) DescribeRelation(connectionID, schema, relation string) (*RelationDetail, error) {
	conn, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 15*time.Second)
	defer cancel()

	var summary RelationSummary
	err = conn.pool.QueryRow(ctx, `
		select n.nspname, c.relname,
		       case c.relkind when 'r' then 'table' when 'p' then 'partitioned table' when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else c.relkind::text end,
		       greatest(c.reltuples, 0),
		       case when c.relkind in ('r','p','m') then pg_total_relation_size(c.oid) else 0 end,
		       coalesce(obj_description(c.oid, 'pg_class'), ''),
		       greatest(st.last_vacuum, st.last_autovacuum)::text
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		left join pg_stat_all_tables st on st.relid = c.oid
		where n.nspname = $1 and c.relname = $2 and c.relkind in ('r','p','v','m','f')`, schema, relation).
		Scan(&summary.Schema, &summary.Name, &summary.Kind, &summary.EstimatedRows, &summary.SizeBytes, &summary.Description, &summary.LastVacuum)
	if err != nil {
		return nil, fmt.Errorf("could not inspect %s.%s: %w", schema, relation, err)
	}

	columnRows, err := conn.pool.Query(ctx, `
		select a.attname, pg_catalog.format_type(a.atttypid, a.atttypmod), not a.attnotnull,
		       pg_get_expr(d.adbin, d.adrelid), coalesce(col_description(a.attrelid, a.attnum), ''),
		       exists(select 1 from pg_index i where i.indrelid = a.attrelid and i.indisprimary and a.attnum = any(i.indkey))
		from pg_attribute a
		join pg_class c on c.oid = a.attrelid
		join pg_namespace n on n.oid = c.relnamespace
		left join pg_attrdef d on d.adrelid = a.attrelid and d.adnum = a.attnum
		where n.nspname = $1 and c.relname = $2 and a.attnum > 0 and not a.attisdropped
		order by a.attnum`, schema, relation)
	if err != nil {
		return nil, err
	}
	columns := make([]ColumnDetail, 0)
	for columnRows.Next() {
		var column ColumnDetail
		if err := columnRows.Scan(&column.Name, &column.DataType, &column.Nullable, &column.DefaultValue, &column.Description, &column.IsPrimaryKey); err != nil {
			columnRows.Close()
			return nil, err
		}
		columns = append(columns, column)
	}
	if err := columnRows.Err(); err != nil {
		columnRows.Close()
		return nil, err
	}
	columnRows.Close()

	indexRows, err := conn.pool.Query(ctx, `
		select ci.relname, pg_get_indexdef(i.indexrelid), pg_relation_size(i.indexrelid), coalesce(si.idx_scan, 0),
		       i.indisunique, i.indisprimary,
		       coalesce(array_agg(a.attname order by keys.ordinality) filter (where a.attname is not null), '{}')
		from pg_index i
		join pg_class ct on ct.oid = i.indrelid
		join pg_namespace n on n.oid = ct.relnamespace
		join pg_class ci on ci.oid = i.indexrelid
		left join pg_stat_user_indexes si on si.indexrelid = i.indexrelid
		left join lateral unnest(i.indkey) with ordinality keys(attnum, ordinality) on true
		left join pg_attribute a on a.attrelid = ct.oid and a.attnum = keys.attnum
		where n.nspname = $1 and ct.relname = $2
		group by ci.relname, i.indexrelid, i.indisunique, i.indisprimary, si.idx_scan
		order by i.indisprimary desc, ci.relname`, schema, relation)
	if err != nil {
		return nil, err
	}
	defer indexRows.Close()
	indexes := make([]IndexDetail, 0)
	for indexRows.Next() {
		var item IndexDetail
		if err := indexRows.Scan(&item.Name, &item.Definition, &item.SizeBytes, &item.Scans, &item.IsUnique, &item.IsPrimary, &item.Columns); err != nil {
			return nil, err
		}
		item.Definition = strings.TrimSpace(item.Definition)
		indexes = append(indexes, item)
	}
	if err := indexRows.Err(); err != nil {
		return nil, err
	}
	return &RelationDetail{Relation: summary, Columns: columns, Indexes: indexes}, nil
}

func (s *Service) GetCompletionCatalog(connectionID string) (*CompletionCatalog, error) {
	conn, err := s.connection(connectionID)
	if err != nil {
		return nil, err
	}
	ctx, cancel := context.WithTimeout(s.ctx, 20*time.Second)
	defer cancel()

	rows, err := conn.pool.Query(ctx, `
		select n.nspname, c.relname,
		       case c.relkind
		         when 'r' then 'table'
		         when 'p' then 'partitioned table'
		         when 'v' then 'view'
		         when 'm' then 'materialized view'
		         when 'f' then 'foreign table'
		         else c.relkind::text
		       end,
		       a.attname,
		       pg_catalog.format_type(a.atttypid, a.atttypmod)
		from pg_class c
		join pg_namespace n on n.oid = c.relnamespace
		join pg_attribute a on a.attrelid = c.oid
		where n.nspname <> 'information_schema'
		  and n.nspname not like 'pg\_%' escape '\'
		  and c.relkind in ('r','p','v','m','f')
		  and a.attnum > 0
		  and not a.attisdropped
		order by case when n.nspname = 'public' then 0 else 1 end, n.nspname, c.relname, a.attnum`)
	if err != nil {
		return nil, fmt.Errorf("could not load completion catalog: %w", err)
	}
	defer rows.Close()

	schemaIndex := map[string]int{}
	relationIndex := map[string]int{}
	catalog := &CompletionCatalog{Schemas: make([]CompletionSchema, 0)}

	for rows.Next() {
		var schemaName, relationName, kind, columnName, dataType string
		if err := rows.Scan(&schemaName, &relationName, &kind, &columnName, &dataType); err != nil {
			return nil, err
		}
		schemaPos, ok := schemaIndex[schemaName]
		if !ok {
			schemaPos = len(catalog.Schemas)
			schemaIndex[schemaName] = schemaPos
			catalog.Schemas = append(catalog.Schemas, CompletionSchema{Name: schemaName, Relations: make([]CompletionRelation, 0)})
		}
		relationKey := schemaName + "." + relationName
		relPos, ok := relationIndex[relationKey]
		if !ok {
			relPos = len(catalog.Schemas[schemaPos].Relations)
			relationIndex[relationKey] = relPos
			catalog.Schemas[schemaPos].Relations = append(catalog.Schemas[schemaPos].Relations, CompletionRelation{
				Schema:  schemaName,
				Name:    relationName,
				Kind:    kind,
				Columns: make([]CompletionColumn, 0, 8),
			})
		}
		catalog.Schemas[schemaPos].Relations[relPos].Columns = append(
			catalog.Schemas[schemaPos].Relations[relPos].Columns,
			CompletionColumn{Name: columnName, DataType: dataType},
		)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	return catalog, nil
}
