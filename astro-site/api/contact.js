const SUPABASE_URL = process.env.SUPABASE_URL || 'https://syzlvsfhdmegmebsvscm.supabase.co';
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_ANON_KEY || 'sb_publishable_aF6YEQBB5UrjOrNo9RTMjw_SM3MPKvM';
const LEADS_SCRIPT_URL = process.env.LEADS_SCRIPT_URL || 'https://script.google.com/macros/s/AKfycbz4VdDWwJoaqpudvU3Y2pGNyBt0zkYRSYKaZ9syNELViJdWoIoeDtb9Axu0ecA5B4bU/exec';
const WINDOW_MS = 10 * 60 * 1000;
const MAX_REQUESTS = 5;
const rateBuckets = new Map();
const submissions = new Map();

function json(response, body, status = 200) {
  response.setHeader('Cache-Control', 'no-store');
  return response.status(status).json(body);
}

function parseBody(request) {
  if (request.body && typeof request.body === 'object') return request.body;
  if (typeof request.body !== 'string') return {};
  try {
    return JSON.parse(request.body);
  } catch {
    return {};
  }
}

function clientIp(request) {
  const forwarded = String(request.headers['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

function isRateLimited(ip, now) {
  const recent = (rateBuckets.get(ip) || []).filter((time) => now - time < WINDOW_MS);
  recent.push(now);
  rateBuckets.set(ip, recent);
  return recent.length > MAX_REQUESTS;
}

function clean(value, maxLength) {
  return String(value || '').trim().slice(0, maxLength);
}

function validEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

async function storeInSupabase(payload) {
  const result = await fetch(`${SUPABASE_URL}/rest/v1/contact_messages`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      nom: payload.nom,
      email: payload.email,
      telephone: payload.telephone,
      message: payload.message,
    }),
  });
  if (!result.ok) throw new Error(`Supabase HTTP ${result.status}`);
}

async function notifyOperations(payload) {
  const result = await fetch(LEADS_SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ ...payload, formType: 'contact' }),
  });
  if (!result.ok) throw new Error(`Notification HTTP ${result.status}`);
}

export default async function handler(request, response) {
  if (request.method !== 'POST') return json(response, { error: 'Méthode non autorisée' }, 405);

  const now = Date.now();
  const ip = clientIp(request);
  if (isRateLimited(ip, now)) return json(response, { error: 'Trop de tentatives. Merci de patienter quelques minutes.' }, 429);

  const body = parseBody(request);
  const payload = {
    nom: clean(body.nom, 100),
    email: clean(body.email, 160).toLowerCase(),
    telephone: clean(body.telephone, 40),
    message: clean(body.message, 3000),
    website: clean(body.website, 200),
    submissionId: clean(body.submissionId, 80),
    startedAt: Number(body.startedAt),
  };

  if (payload.website) return json(response, { ok: true });
  if (!payload.submissionId || !Number.isFinite(payload.startedAt)) return json(response, { error: 'Requête invalide' }, 400);
  if (now - payload.startedAt < 1800 || now - payload.startedAt > 2 * 60 * 60 * 1000) return json(response, { error: 'Merci de recharger la page puis de réessayer.' }, 400);
  if (payload.nom.length < 2) return json(response, { error: 'Nom invalide' }, 400);
  if (!validEmail(payload.email)) return json(response, { error: 'Adresse email invalide' }, 400);
  if (payload.message.length < 5) return json(response, { error: 'Message trop court' }, 400);

  const previousState = submissions.get(payload.submissionId);
  if (previousState === 'complete') return json(response, { ok: true });

  try {
    if (previousState !== 'stored') {
      await storeInSupabase(payload);
      submissions.set(payload.submissionId, 'stored');
    }
    await notifyOperations(payload);
    submissions.set(payload.submissionId, 'complete');
    return json(response, { ok: true });
  } catch (error) {
    console.error('Contact submission failed:', error);
    return json(response, { error: "Votre message n'a pas pu être confirmé. Merci de réessayer." }, 502);
  }
}
