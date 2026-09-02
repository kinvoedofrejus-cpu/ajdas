-- Table unique pour tout le contenu géré depuis l'espace administrateur :
-- projets, documents et images de la galerie.
CREATE TABLE IF NOT EXISTS items (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL,           -- 'project' | 'document' | 'image' | 'report'
  title TEXT NOT NULL,
  description TEXT,
  filename TEXT,                -- nom d'origine du fichier (documents/images/rapports)
  r2_key TEXT,                  -- clé du fichier dans le bucket R2
  mime_type TEXT,
  downloadable INTEGER NOT NULL DEFAULT 1, -- 1 = téléchargement autorisé, 0 = interdit
  group_id TEXT,                -- fichiers publiés ensemble (même lot) partagent cet identifiant
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_items_type ON items(type, created_at DESC);

-- Réglages de l'association, notamment le code d'accès à l'espace admin
-- (modifiable depuis l'espace admin lui-même, sans redéploiement).
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT OR IGNORE INTO settings (key, value) VALUES ('admin_code', '1234');
