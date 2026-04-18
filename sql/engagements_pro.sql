-- ============================================================
-- TABLE engagements_pro
-- Engagements de dépenses pro PRÉVUS mais NON ENCORE FACTURÉS
-- (provisions juridiques, frais déplacement futurs, conseil ponctuel, etc.)
-- ============================================================

CREATE TABLE IF NOT EXISTS engagements_pro (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  company_id      text NOT NULL,
  libelle         text NOT NULL,
  categorie       text NOT NULL DEFAULT 'autre',
  fournisseur     text,
  montant_total   numeric(12,2) NOT NULL,
  date_prevue     date NOT NULL,
  duree_mois      int NOT NULL DEFAULT 1,
  statut          text NOT NULL DEFAULT 'prevu',
  notes           text,
  payable_id      uuid,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_eng_pro_company ON engagements_pro(company_id);
CREATE INDEX IF NOT EXISTS idx_eng_pro_date    ON engagements_pro(date_prevue);
CREATE INDEX IF NOT EXISTS idx_eng_pro_statut  ON engagements_pro(statut);

-- RLS désactivé (cohérent avec les autres tables du dashboard)
ALTER TABLE engagements_pro DISABLE ROW LEVEL SECURITY;

-- Trigger auto-update updated_at
CREATE OR REPLACE FUNCTION update_engagements_pro_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_engagements_pro_updated_at ON engagements_pro;
CREATE TRIGGER trg_engagements_pro_updated_at
  BEFORE UPDATE ON engagements_pro
  FOR EACH ROW
  EXECUTE FUNCTION update_engagements_pro_updated_at();

-- Commentaires pour documentation
COMMENT ON TABLE engagements_pro IS 'Engagements de dépenses pro prévus, non encore facturés';
COMMENT ON COLUMN engagements_pro.company_id IS 'sas-living, sarl-guiraud, meulette, real-gains, spv-monikaza';
COMMENT ON COLUMN engagements_pro.categorie IS 'juridique, comptable, conseil_fiscal, deplacement, constitution, expertise, autre';
COMMENT ON COLUMN engagements_pro.duree_mois IS '1 = ponctuel, >1 = étalé en N mensualités à partir de date_prevue';
COMMENT ON COLUMN engagements_pro.statut IS 'prevu, en_cours, converti_payable, annule, solde';
COMMENT ON COLUMN engagements_pro.payable_id IS 'Lien vers payables.id si converti en facture';
