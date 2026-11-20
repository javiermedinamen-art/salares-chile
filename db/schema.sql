-- Esquema de la base de datos de Salares Chile (SQLite).
-- Diseñado para migrar tal cual a PostgreSQL/PostGIS más adelante.
--
-- Capas:
--   1. Inventario geográfico (salares)  -> viene del SNGM 2023, se regenera con `npm run db:build`
--   2. Contenido de la fundación        -> ciencia, divulgación, galería, publicaciones
--      (se carga desde data/content.json; en producción se editaría con un CMS/panel admin)

PRAGMA foreign_keys = ON;

-- ───────────────────────── 1. Inventario geográfico ─────────────────────────

CREATE TABLE salares (
  id              INTEGER PRIMARY KEY,
  code            TEXT NOT NULL UNIQUE,          -- Código SNGM: S-25, LS-08...
  slug            TEXT NOT NULL UNIQUE,          -- para URLs: salar-de-atacama
  name            TEXT NOT NULL,
  kind            TEXT NOT NULL CHECK (kind IN ('salar', 'laguna')),
  environment     TEXT,                          -- Andino | PreAndino | Costero
  region          TEXT NOT NULL,                 -- "Antofagasta", "Atacama"...
  elevation_m     REAL,                          -- cota promedio (msnm)
  area_km2        REAL NOT NULL,
  centroid_lon    REAL NOT NULL,
  centroid_lat    REAL NOT NULL,
  bbox_w          REAL NOT NULL,
  bbox_s          REAL NOT NULL,
  bbox_e          REAL NOT NULL,
  bbox_n          REAL NOT NULL,
  geom_simple     TEXT NOT NULL,                 -- GeoJSON geometry simplificada (para el mapa general)
  geom_full       TEXT NOT NULL,                 -- GeoJSON geometry original (para el detalle)
  source_dataset  TEXT NOT NULL DEFAULT 'SNGM 2023',
  source_authors  TEXT,                          -- Elaborado / Revisado
  source_date     TEXT,                          -- fecha de elaboración (ISO)
  summary         TEXT,                          -- texto editorial propio de la fundación (opcional)
  is_demo         INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_salares_region ON salares(region);
CREATE INDEX idx_salares_kind   ON salares(kind);

-- ─────────────────────── 2. Ciencia ───────────────────────

CREATE TABLE projects (
  id           INTEGER PRIMARY KEY,
  slug         TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL,
  discipline   TEXT NOT NULL,                    -- microbiologia | hidrologia | geologia | biodiversidad | geoquimica | teledeteccion | sociedad
  status       TEXT NOT NULL DEFAULT 'activo' CHECK (status IN ('activo', 'finalizado', 'planificado')),
  start_year   INTEGER,
  end_year     INTEGER,
  lead         TEXT,
  institution  TEXT,
  funding      TEXT,
  url          TEXT,
  is_demo      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE project_salares (
  project_id INTEGER NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  salar_id   INTEGER NOT NULL REFERENCES salares(id)  ON DELETE CASCADE,
  PRIMARY KEY (project_id, salar_id)
);
CREATE INDEX idx_project_salares_salar ON project_salares(salar_id);

CREATE TABLE publications (
  id       INTEGER PRIMARY KEY,
  title    TEXT NOT NULL,
  authors  TEXT,
  year     INTEGER,
  venue    TEXT,                                 -- revista / editorial
  doi      TEXT,
  url      TEXT,
  kind     TEXT NOT NULL DEFAULT 'articulo' CHECK (kind IN ('articulo', 'libro', 'tesis', 'informe', 'divulgacion')),
  project_id INTEGER REFERENCES projects(id) ON DELETE SET NULL,
  is_demo  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE publication_salares (
  publication_id INTEGER NOT NULL REFERENCES publications(id) ON DELETE CASCADE,
  salar_id       INTEGER NOT NULL REFERENCES salares(id)      ON DELETE CASCADE,
  PRIMARY KEY (publication_id, salar_id)
);
CREATE INDEX idx_publication_salares_salar ON publication_salares(salar_id);

-- ─────────────────────── 3. Divulgación ───────────────────────

CREATE TABLE activities (
  id          INTEGER PRIMARY KEY,
  slug        TEXT NOT NULL UNIQUE,
  title       TEXT NOT NULL,
  description TEXT NOT NULL,
  type        TEXT NOT NULL,                     -- taller | charla | terreno | exposicion | escuela | medios | comunidad
  date        TEXT,                              -- ISO yyyy-mm-dd
  place       TEXT,                              -- localidad / institución
  audience    TEXT,                              -- escolares, comunidad, público general...
  url         TEXT,
  is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_activities_date ON activities(date);

CREATE TABLE activity_salares (
  activity_id INTEGER NOT NULL REFERENCES activities(id) ON DELETE CASCADE,
  salar_id    INTEGER NOT NULL REFERENCES salares(id)    ON DELETE CASCADE,
  PRIMARY KEY (activity_id, salar_id)
);
CREATE INDEX idx_activity_salares_salar ON activity_salares(salar_id);

-- ─────────────────────── 4. Galería (fotos, video, audio) ───────────────────────

CREATE TABLE media (
  id          INTEGER PRIMARY KEY,
  salar_id    INTEGER NOT NULL REFERENCES salares(id)    ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'foto' CHECK (kind IN ('foto', 'video', 'audio', 'dron')),
  url         TEXT,                              -- NULL => se dibuja un placeholder
  thumb_url   TEXT,
  caption     TEXT,
  credit      TEXT,                              -- autor/a de la imagen
  license     TEXT,
  taken_at    TEXT,
  lon         REAL,                              -- punto exacto dentro del salar (opcional)
  lat         REAL,
  project_id  INTEGER REFERENCES projects(id)    ON DELETE SET NULL,
  activity_id INTEGER REFERENCES activities(id)  ON DELETE SET NULL,
  is_demo     INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX idx_media_salar ON media(salar_id);
