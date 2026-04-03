// db-migrate.js — Migration schéma recurring_charges
// Appel : GET /api/db-migrate
// Utilise SUPABASE_SERVICE_KEY pour vérifier les colonnes et guider la migration

export default async (req) => {
  const H = { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' };
  const SB_URL = 'https://uqpgwypgkwlvrpxtxhia.supabase.co';
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!serviceKey) return Response.json({ ok: false, error: 'SUPABASE_SERVICE_KEY manquant' }, { status: 500, headers: H });

  // Vérifier quelles colonnes existent déjà
  const check = await fetch(`${SB_URL}/rest/v1/recurring_charges?select=resiliation_notice_days,auto_renewal,contract_duration_months&limit=1`, {
    headers: { 'Authorization': `Bearer ${serviceKey}`, 'apikey': serviceKey }
  });

  const columnsExist = check.ok;

  const migrationSQL = `
-- Migration recurring_charges — nouveaux champs contrat
-- À coller dans Supabase Dashboard > SQL Editor

ALTER TABLE recurring_charges
  ADD COLUMN IF NOT EXISTS resiliation_notice_days integer DEFAULT 30,
  ADD COLUMN IF NOT EXISTS auto_renewal boolean DEFAULT true,
  ADD COLUMN IF NOT EXISTS contract_duration_months integer DEFAULT 12;

-- Vérification
SELECT column_name, data_type FROM information_schema.columns
WHERE table_name = 'recurring_charges'
  AND column_name IN ('resiliation_notice_days', 'auto_renewal', 'contract_duration_months');
`.trim();

  return Response.json({
    ok: true,
    columns_exist: columnsExist,
    message: columnsExist
      ? '✅ Colonnes déjà présentes — aucune migration nécessaire'
      : '⚠️ Colonnes manquantes — copiez le SQL ci-dessous dans Supabase SQL Editor',
    migration_sql: columnsExist ? null : migrationSQL,
    supabase_sql_editor: 'https://supabase.com/dashboard/project/uqpgwypgkwlvrpxtxhia/sql/new'
  }, { headers: H });
};

export const config = { path: '/api/db-migrate' };
