-- ============================================================
-- AJOUT pièces jointes à expense_requests
-- (factures, justificatifs, garanties pour entretien maison + matériel)
-- ============================================================

ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS file_url   text,
  ADD COLUMN IF NOT EXISTS file_name  text,
  ADD COLUMN IF NOT EXISTS file_path  text,
  ADD COLUMN IF NOT EXISTS drive_url  text,
  ADD COLUMN IF NOT EXISTS drive_id   text;

CREATE INDEX IF NOT EXISTS idx_expreq_has_file ON expense_requests(file_path) WHERE file_path IS NOT NULL;

COMMENT ON COLUMN expense_requests.file_url   IS 'URL publique/signée Supabase Storage';
COMMENT ON COLUMN expense_requests.file_name  IS 'Nom original du fichier (ex: facture_piscine.pdf)';
COMMENT ON COLUMN expense_requests.file_path  IS 'Chemin Supabase Storage (bucket: documents)';
COMMENT ON COLUMN expense_requests.drive_url  IS 'URL Google Drive si sync OK (best-effort)';
COMMENT ON COLUMN expense_requests.drive_id   IS 'ID fichier Drive pour récupération directe';
