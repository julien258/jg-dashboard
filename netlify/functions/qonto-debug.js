export default async (req, context) => {
  const keys = ['QONTO_GUIRAUD','QONTO_LIVING','QONTO_MEULETTE','QONTO_REAL_GAINS','QONTO_MONIKAZA'];
  const status = {};
  for (const k of keys) {
    const val = Netlify.env.get(k);
    status[k] = val ? 'OK (' + val.substring(0,15) + '...)' : 'MANQUANT';
  }
  return Response.json({ ok: true, env_status: status, ts: new Date().toISOString() });
};
export const config = { path: '/api/qonto-debug' };
