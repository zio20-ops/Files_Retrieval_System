export const SCHEMA_VERSION = 1

/**
 * `names_fts` and `chunks_fts` are external-content FTS5 tables: the searchable
 * text is stored (already Arabic-normalized) in `files` / `chunks`, and the FTS
 * index only holds the term dictionary. Triggers keep the two in sync, so a
 * cascade delete from `folders` cannot leave orphaned index rows behind.
 *
 * Snippets are not taken from FTS (`snippet()` would return normalized text,
 * which drops Arabic diacritics and rewrites hamza forms). Search uses FTS only
 * for matching and ranking; the snippet is rebuilt from `chunks.text_raw`.
 */
export const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS folders (
  id              INTEGER PRIMARY KEY,
  path            TEXT NOT NULL,
  path_key        TEXT NOT NULL UNIQUE,
  added_at        INTEGER NOT NULL,
  last_indexed_at INTEGER,
  ocr_enabled     INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS files (
  id           INTEGER PRIMARY KEY,
  folder_id    INTEGER NOT NULL REFERENCES folders(id) ON DELETE CASCADE,
  path         TEXT NOT NULL,
  path_key     TEXT NOT NULL UNIQUE,
  name         TEXT NOT NULL,
  name_norm    TEXT NOT NULL,
  parent_path  TEXT NOT NULL,
  parent_norm  TEXT NOT NULL,
  ext          TEXT NOT NULL,
  size         INTEGER NOT NULL,
  mtime        INTEGER NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  skip_reason  TEXT,
  indexed_at   INTEGER
);

CREATE INDEX IF NOT EXISTS idx_files_folder ON files(folder_id);
CREATE INDEX IF NOT EXISTS idx_files_ext    ON files(ext);
CREATE INDEX IF NOT EXISTS idx_files_mtime  ON files(mtime);
CREATE INDEX IF NOT EXISTS idx_files_status ON files(status);

CREATE TABLE IF NOT EXISTS chunks (
  id        INTEGER PRIMARY KEY,
  file_id   INTEGER NOT NULL REFERENCES files(id) ON DELETE CASCADE,
  seq       INTEGER NOT NULL,
  text_raw  TEXT NOT NULL,
  text_norm TEXT NOT NULL,
  source    TEXT NOT NULL DEFAULT 'text',
  UNIQUE(file_id, seq)
);

CREATE INDEX IF NOT EXISTS idx_chunks_file ON chunks(file_id);

CREATE TABLE IF NOT EXISTS index_log (
  id      INTEGER PRIMARY KEY,
  ts      INTEGER NOT NULL,
  level   TEXT NOT NULL,
  path    TEXT,
  code    TEXT,
  message TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_log_ts ON index_log(ts DESC);

CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS names_fts USING fts5(
  name_norm,
  parent_norm,
  content='files',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2"
);

CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
  text_norm,
  content='chunks',
  content_rowid='id',
  tokenize="unicode61 remove_diacritics 2"
);

CREATE TRIGGER IF NOT EXISTS files_ai AFTER INSERT ON files BEGIN
  INSERT INTO names_fts(rowid, name_norm, parent_norm)
  VALUES (new.id, new.name_norm, new.parent_norm);
END;

CREATE TRIGGER IF NOT EXISTS files_ad AFTER DELETE ON files BEGIN
  INSERT INTO names_fts(names_fts, rowid, name_norm, parent_norm)
  VALUES ('delete', old.id, old.name_norm, old.parent_norm);
END;

CREATE TRIGGER IF NOT EXISTS files_au AFTER UPDATE OF name_norm, parent_norm ON files BEGIN
  INSERT INTO names_fts(names_fts, rowid, name_norm, parent_norm)
  VALUES ('delete', old.id, old.name_norm, old.parent_norm);
  INSERT INTO names_fts(rowid, name_norm, parent_norm)
  VALUES (new.id, new.name_norm, new.parent_norm);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ai AFTER INSERT ON chunks BEGIN
  INSERT INTO chunks_fts(rowid, text_norm) VALUES (new.id, new.text_norm);
END;

CREATE TRIGGER IF NOT EXISTS chunks_ad AFTER DELETE ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text_norm)
  VALUES ('delete', old.id, old.text_norm);
END;

CREATE TRIGGER IF NOT EXISTS chunks_au AFTER UPDATE OF text_norm ON chunks BEGIN
  INSERT INTO chunks_fts(chunks_fts, rowid, text_norm)
  VALUES ('delete', old.id, old.text_norm);
  INSERT INTO chunks_fts(rowid, text_norm) VALUES (new.id, new.text_norm);
END;
`
