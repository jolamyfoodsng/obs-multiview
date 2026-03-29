/**
 * DevDashboard.tsx — Database Inspector for developers
 *
 * A "Prisma Studio"-like page that shows all IndexedDB stores,
 * their record counts, indexes, and sample data in a clean table layout.
 *
 * Route: /dev/db
 */

import { useState, useEffect, useCallback } from "react";
import { inspectDatabase, migrateFromLegacyDatabases, CENTRAL_DB_NAME, CENTRAL_DB_VERSION, type StoreInfo } from "../services/db";
import "./dev-dashboard.css";
import Icon from "../components/Icon";

export default function DevDashboard() {
  const [stores, setStores] = useState<StoreInfo[]>([]);
  const [loading, setLoading] = useState(true);
  const [expandedStore, setExpandedStore] = useState<string | null>(null);
  const [migrationResult, setMigrationResult] = useState<{ migrated: string[]; errors: string[] } | null>(null);
  const [migrating, setMigrating] = useState(false);
  const [jsonView, setJsonView] = useState<Record<string, boolean>>({});

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await inspectDatabase();
      setStores(data);
    } catch (err) {
      console.error("[DevDashboard] Failed to load:", err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const handleMigrate = async () => {
    setMigrating(true);
    try {
      const result = await migrateFromLegacyDatabases();
      setMigrationResult(result);
      await loadData(); // Refresh after migration
    } catch (err) {
      setMigrationResult({ migrated: [], errors: [String(err)] });
    } finally {
      setMigrating(false);
    }
  };

  const toggleExpand = (storeName: string) => {
    setExpandedStore((prev) => (prev === storeName ? null : storeName));
  };

  const toggleJsonView = (storeName: string) => {
    setJsonView((prev) => ({ ...prev, [storeName]: !prev[storeName] }));
  };

  const totalRecords = stores.reduce((sum, s) => sum + s.count, 0);

  // Categorize stores by module
  const categorize = (name: string): string => {
    if (name.startsWith("bible_")) return "Bible";
    if (name.startsWith("worship_")) return "Worship";
    if (name.startsWith("obs_")) return "OBS Registry";
    if (name.startsWith("mv_")) return "Multi-View";
    if (name === "speakers") return "Speakers";
    if (name === "app_settings") return "App Settings";
    return "Other";
  };

  // Group stores by category
  const grouped = stores.reduce<Record<string, StoreInfo[]>>((acc, s) => {
    const cat = categorize(s.name);
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(s);
    return acc;
  }, {});

  const categoryOrder = ["Bible", "Worship", "Speakers", "OBS Registry", "Multi-View", "App Settings", "Other"];
  const categoryIcons: Record<string, string> = {
    Bible: "menu_book",
    Worship: "music_note",
    Speakers: "mic",
    "OBS Registry": "videocam",
    "Multi-View": "view_quilt",
    "App Settings": "settings",
    Other: "folder",
  };

  const truncateValue = (val: unknown, maxLen = 80): string => {
    const str = typeof val === "string" ? val : JSON.stringify(val);
    if (str && str.length > maxLen) return str.slice(0, maxLen) + "…";
    return str ?? "null";
  };

  const renderSampleTable = (store: StoreInfo) => {
    if (store.sampleRecords.length === 0) {
      return <div className="dev-db-empty">No records</div>;
    }

    if (jsonView[store.name]) {
      return (
        <pre className="dev-db-json">
          {JSON.stringify(store.sampleRecords, null, 2)}
        </pre>
      );
    }

    // Extract column names from first record
    const firstRecord = store.sampleRecords[0] as Record<string, unknown>;
    if (!firstRecord || typeof firstRecord !== "object") {
      return (
        <pre className="dev-db-json">
          {JSON.stringify(store.sampleRecords, null, 2)}
        </pre>
      );
    }

    const columns = Object.keys(firstRecord).filter(
      (key) => typeof firstRecord[key] !== "object" || firstRecord[key] === null
    );

    // If there are object fields, show them as a "+data" column
    const objectColumns = Object.keys(firstRecord).filter(
      (key) => typeof firstRecord[key] === "object" && firstRecord[key] !== null
    );

    return (
      <div className="dev-db-table-wrap">
        <table className="dev-db-table">
          <thead>
            <tr>
              <th>#</th>
              {columns.map((col) => (
                <th key={col}>{col}</th>
              ))}
              {objectColumns.length > 0 && <th>+ objects</th>}
            </tr>
          </thead>
          <tbody>
            {store.sampleRecords.map((record, idx) => {
              const row = record as Record<string, unknown>;
              return (
                <tr key={idx}>
                  <td className="dev-db-td-idx">{idx + 1}</td>
                  {columns.map((col) => (
                    <td key={col} title={String(row[col] ?? "")}>
                      {truncateValue(row[col])}
                    </td>
                  ))}
                  {objectColumns.length > 0 && (
                    <td className="dev-db-td-obj">
                      {objectColumns.map((c) => `${c}:{…}`).join(", ")}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    );
  };

  return (
    <div className="dev-db-page">
      {/* Header */}
      <header className="dev-db-header">
        <div className="dev-db-header-info">
          <div className="dev-db-logo">
            <Icon name="storage" size={20} />
          </div>
          <div>
            <h1>Database Inspector</h1>
            <p>
              <code>{CENTRAL_DB_NAME}</code> v{CENTRAL_DB_VERSION} —{" "}
              {stores.length} stores, {totalRecords.toLocaleString()} total records
            </p>
          </div>
        </div>

        <div className="dev-db-header-actions">
          <button className="dev-db-btn" onClick={loadData} disabled={loading}>
            <Icon name={loading ? "sync" : "refresh"} size={20} />
            Refresh
          </button>
          <button
            className="dev-db-btn dev-db-btn--accent"
            onClick={handleMigrate}
            disabled={migrating}
          >
            <Icon name="move_down" size={20} />
            {migrating ? "Migrating…" : "Migrate Legacy DBs"}
          </button>
        </div>
      </header>

      {/* Migration result */}
      {migrationResult && (
        <div className="dev-db-migration-result">
          {migrationResult.migrated.length > 0 && (
            <div className="dev-db-migration-ok">
              <Icon name="check_circle" size={20} />
              <div>
                <strong>Migrated successfully:</strong>
                <ul>
                  {migrationResult.migrated.map((m, i) => (
                    <li key={i}>{m}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {migrationResult.errors.length > 0 && (
            <div className="dev-db-migration-err">
              <Icon name="error" size={20} />
              <div>
                <strong>Errors:</strong>
                <ul>
                  {migrationResult.errors.map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            </div>
          )}
          {migrationResult.migrated.length === 0 && migrationResult.errors.length === 0 && (
            <div className="dev-db-migration-ok">
              <Icon name="info" size={20} />
              <span>Nothing to migrate — legacy data already imported or empty.</span>
            </div>
          )}
          <button
            className="dev-db-dismiss"
            onClick={() => setMigrationResult(null)}
          >
            <Icon name="close" size={20} />
          </button>
        </div>
      )}

      {/* Loading state */}
      {loading && (
        <div className="dev-db-loading">
          <Icon name="sync" size={20} className="spin" />
          <span>Loading database…</span>
        </div>
      )}

      {/* Store list grouped by category */}
      {!loading && (
        <div className="dev-db-body">
          {categoryOrder.map((category) => {
            const categoryStores = grouped[category];
            if (!categoryStores || categoryStores.length === 0) return null;

            return (
              <div key={category} className="dev-db-category">
                <h2 className="dev-db-category-title">
                  <Icon name={categoryIcons[category] ?? "folder"} size={20} />
                  {category}
                  <span className="dev-db-category-count">
                    {categoryStores.reduce((s, st) => s + st.count, 0)} records
                  </span>
                </h2>

                <div className="dev-db-stores">
                  {categoryStores.map((store) => {
                    const isExpanded = expandedStore === store.name;
                    return (
                      <div
                        key={store.name}
                        className={`dev-db-store${isExpanded ? " is-expanded" : ""}`}
                      >
                        <button
                          className="dev-db-store-header"
                          onClick={() => toggleExpand(store.name)}
                        >
                          <Icon name={isExpanded ? "expand_more" : "chevron_right"} size={20} className="dev-db-store-icon" />
                          <code className="dev-db-store-name">{store.name}</code>
                          <span className="dev-db-store-count">{store.count}</span>
                          {store.indexes.length > 0 && (
                            <span className="dev-db-store-indexes">
                              idx: {store.indexes.join(", ")}
                            </span>
                          )}
                        </button>

                        {isExpanded && (
                          <div className="dev-db-store-body">
                            <div className="dev-db-store-toolbar">
                              <span className="dev-db-store-info">
                                Showing first {Math.min(5, store.sampleRecords.length)} of {store.count} records
                              </span>
                              <button
                                className="dev-db-btn dev-db-btn--sm"
                                onClick={() => toggleJsonView(store.name)}
                              >
                                <Icon name={jsonView[store.name] ? "table_chart" : "data_object"} size={14} />
                                {jsonView[store.name] ? "Table" : "JSON"}
                              </button>
                            </div>
                            {renderSampleTable(store)}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
