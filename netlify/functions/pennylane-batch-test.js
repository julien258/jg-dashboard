// pennylane-batch-test.js — test minimal
export default async (req) => {
  return Response.json({ ok: true, msg: "alive", ts: Date.now() });
};
export const config = { path: '/api/pennylane-batch-test' };
