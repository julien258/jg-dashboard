// Debug temporaire — voir le format brut des factures Pennylane
export default async (req) => {
  const PENNYLANE_API = 'https://app.pennylane.com/api/external/v2';
  const token = Netlify.env.get('PENNYLANE_LIVING_TOKEN');
  if (!token) return Response.json({ error: 'Token manquant' });

  const res = await fetch(`${PENNYLANE_API}/customer_invoices?per_page=5&sort=-date`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  const data = await res.json();
  const liste = data.invoices || data.customer_invoices || data.items || [];
  
  // Retourner les champs de date bruts des 5 premières factures
  return Response.json({
    ok: true,
    count: liste.length,
    fields_sample: liste.slice(0, 3).map(f => ({
      id: f.id,
      date: f.date,
      invoice_date: f.invoice_date,
      created_at: f.created_at,
      invoice_number: f.invoice_number,
      status: f.status,
      all_keys: Object.keys(f)
    }))
  });
};
export const config = { path: '/api/pennylane-debug' };
