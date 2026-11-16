import type { DB } from "./types";
// All column/path names come from repository SQL, never request input.
export function jsonField(db: DB, column: string, path: string) {
  return db.dialect === "postgres"
    ? `(${column}::jsonb #>> '{${path.split(".").join(",")}}')`
    : `json_extract(${column},'$.${path}')`;
}
