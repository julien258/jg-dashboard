-- Table de suivi des factures Management Fees GUIRAUD JULIEN → SAS LIVING
-- À exécuter sur : https://supabase.com/dashboard/project/uqpgwypgkwlvrpxtxhia/sql/new

CREATE TABLE IF NOT EXISTS management_fees_invoices (
  mois           TEXT        PRIMARY KEY,           -- ex: "2026-01"
  invoice_id     TEXT,                              -- ID Pennylane
  invoice_number TEXT,                              -- numéro facture Pennylane (ex: F-2026-042)
  invoice_date   DATE,                              -- date d'émission réelle (date du jour Pennylane)
  amount_ht      NUMERIC     DEFAULT 60000,
  tva            NUMERIC     DEFAULT 12000,
  amount_ttc     NUMERIC     DEFAULT 72000,
  status         TEXT        DEFAULT 'emise',       -- emise | payee | annulee
  pennylane_url  TEXT,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  updated_at     TIMESTAMPTZ DEFAULT NOW()
);

-- RLS : lecture publique (anon), écriture via service_role uniquement
ALTER TABLE management_fees_invoices ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lecture anon mf_invoices"
  ON management_fees_invoices FOR SELECT
  USING (true);

CREATE POLICY "ecriture service_role mf_invoices"
  ON management_fees_invoices FOR ALL
  USING (auth.role() = 'service_role');

-- Trigger updated_at
CREATE OR REPLACE FUNCTION update_mf_invoices_updated_at()
RETURNS TRIGGER AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER mf_invoices_updated_at
  BEFORE UPDATE ON management_fees_invoices
  FOR EACH ROW EXECUTE FUNCTION update_mf_invoices_updated_at();

-- Commentaire
COMMENT ON TABLE management_fees_invoices IS
  'Suivi des factures mensuelles Management Fees GUIRAUD JULIEN → SAS LIVING (60 000 € HT / mois)';
