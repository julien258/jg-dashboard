-- ============================================================
-- CYCLE DEVIS / FACTURE / ACQUITTÉE sur expense_requests
-- ============================================================

-- Type du document principal joint
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS doc_type              text,
  ADD COLUMN IF NOT EXISTS needs_invoice         boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS expected_invoice_date date,
  ADD COLUMN IF NOT EXISTS invoice_received      boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS reminder_count        int     DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_reminder_at      timestamptz,
  ADD COLUMN IF NOT EXISTS supplier_email        text,
  ADD COLUMN IF NOT EXISTS supplier_name         text;

-- 6 colonnes pour la facture finale (en plus du justificatif initial)
ALTER TABLE expense_requests
  ADD COLUMN IF NOT EXISTS invoice_file_url      text,
  ADD COLUMN IF NOT EXISTS invoice_file_name     text,
  ADD COLUMN IF NOT EXISTS invoice_file_path     text,
  ADD COLUMN IF NOT EXISTS invoice_drive_url     text,
  ADD COLUMN IF NOT EXISTS invoice_drive_id      text,
  ADD COLUMN IF NOT EXISTS invoice_uploaded_at   timestamptz;

-- Index pour le bloc "factures à réclamer"
CREATE INDEX IF NOT EXISTS idx_expreq_pending_invoice
  ON expense_requests(expected_invoice_date)
  WHERE needs_invoice = true AND invoice_received = false;

COMMENT ON COLUMN expense_requests.doc_type IS 'devis, bon_commande, facture, facture_acquittee, ticket, livraison, autre';
COMMENT ON COLUMN expense_requests.needs_invoice IS 'true = facture finale à recevoir (devis ou bon de commande initial)';
COMMENT ON COLUMN expense_requests.expected_invoice_date IS 'Date à partir de laquelle relancer (par défaut: date_prevue + 15j)';
COMMENT ON COLUMN expense_requests.invoice_received IS 'true quand la facture finale est uploadée';
COMMENT ON COLUMN expense_requests.reminder_count IS 'Nombre de relances effectuées';
COMMENT ON COLUMN expense_requests.supplier_email IS 'Email du fournisseur pour mailto: relance';
