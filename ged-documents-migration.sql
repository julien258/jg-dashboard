-- Migration : Création table ged_documents
-- À exécuter dans Supabase SQL Editor : 
-- https://supabase.com/dashboard/project/uqpgwypgkwlvrpxtxhia/sql/new

CREATE TABLE IF NOT EXISTS ged_documents (
  id              uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  created_at      timestamptz DEFAULT now(),

  -- Identification
  company_id      text NOT NULL,           -- sas-living | sarl-guiraud | meulette | real-gains | spv-monikaza | perso
  doc_type        text NOT NULL,           -- facture_recue | recommande | recouvrement | releve | fiscal | social | contrat | assurance | juridique | compte_rendu | autre
  dossier         text,                    -- dossier libre (ex: "Carrefour", "URSSAF 2026")

  -- Données document
  file_name       text NOT NULL,           -- nom normalisé : FOURNISSEUR_DATE_SOCIETE_objet.pdf
  from_name       text,                    -- expéditeur / fournisseur
  doc_date        date,                    -- date du document
  amount          numeric,                 -- montant si applicable

  -- Stockage
  drive_url       text,                    -- lien Google Drive (webViewLink)
  drive_id        text,                    -- ID fichier Google Drive
  drive_pending   boolean DEFAULT false,   -- true si upload Drive en attente (retry via ged-drive-sync)
  storage_path    text,                    -- chemin Supabase Storage (bucket documents)
  file_url        text,                    -- URL publique ou signée

  -- Statut & actions
  status          text DEFAULT 'actif',    -- actif | archivé | action_requise
  action_required boolean DEFAULT false,
  action_notes    text,
  deadline_date   date,

  -- OCR brut
  ocr_data        jsonb
);

-- Index utiles
CREATE INDEX IF NOT EXISTS ged_documents_company_id_idx ON ged_documents(company_id);
CREATE INDEX IF NOT EXISTS ged_documents_doc_type_idx   ON ged_documents(doc_type);
CREATE INDEX IF NOT EXISTS ged_documents_doc_date_idx   ON ged_documents(doc_date);
CREATE INDEX IF NOT EXISTS ged_documents_drive_pending_idx ON ged_documents(drive_pending) WHERE drive_pending = true;

-- RLS désactivé (accès via service key Netlify)
ALTER TABLE ged_documents DISABLE ROW LEVEL SECURITY;

COMMENT ON TABLE ged_documents IS 'GED Groupe Guiraud — documents classés par société et type';
