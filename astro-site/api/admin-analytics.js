export const runtime = 'nodejs';

const SUPABASE_ADMIN_URL = 'https://syzlvsfhdmegmebsvscm.supabase.co/functions/v1/admin-leads';
const SUPABASE_ANON_KEY = 'sb_publishable_aF6YEQBB5UrjOrNo9RTMjw_SM3MPKvM';
const VERCEL_ANALYTICS_URL = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';
const ALLOWED_RANGES = new Set([7, 30]);

function json(body, status = 200) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function normalizeRows(payload) {
  return Array.isArray(payload?.data) ? payload.data : [];
}

function dimensionValue(row, key, fallback) {
  const value = row?.[key];
  return typeof value === 'string' && value.trim() ? value.trim() : fallback;
}

async function verifyAdmin(body) {
  const response = await fetch(SUPABASE_ADMIN_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      apikey: SUPABASE_ANON_KEY,
      Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
    },
    body: JSON.stringify({
      password: body.password,
      username: body.username || undefined,
    }),
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || 'Identifiants incorrects');
    error.status = response.status === 401 ? 401 : 502;
    throw error;
  }
  return data;
}

async function queryAnalytics({ token, projectId, since, until, by, limit }) {
  const url = new URL(VERCEL_ANALYTICS_URL);
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('since', since);
  url.searchParams.set('until', until);
  url.searchParams.set('by', by);
  url.searchParams.set('limit', String(limit));

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Vercel Analytics HTTP ${response.status}`;
    throw new Error(message);
  }
  return normalizeRows(data);
}

export default async function handler(request) {
  if (request.method !== 'POST') {
    return json({ error: 'Méthode non autorisée' }, 405);
  }

  try {
    const body = await request.json().catch(() => ({}));
    if (!body.password) return json({ error: 'Identifiants manquants' }, 401);

    const range = Number(body.range);
    if (!ALLOWED_RANGES.has(range)) return json({ error: 'Période non prise en charge' }, 400);

    const token = process.env.VERCEL_ANALYTICS_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    if (!token || !projectId) return json({ error: 'Analytics serveur non configuré' }, 503);

    const adminData = await verifyAdmin(body);
    const untilDate = new Date();
    const sinceDate = new Date();
    sinceDate.setUTCDate(untilDate.getUTCDate() - (range - 1));
    sinceDate.setUTCHours(0, 0, 0, 0);
    const since = dateOnly(sinceDate);
    const until = dateOnly(untilDate);
    const queryBase = { token, projectId, since, until };

    const [trendRows, pageRows, countryRows, referrerRows, deviceRows] = await Promise.all([
      queryAnalytics({ ...queryBase, by: 'day', limit: range }),
      queryAnalytics({ ...queryBase, by: 'requestPath', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'country', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'referrerHostname', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'deviceType', limit: 6 }),
    ]);

    const trend = trendRows.map((row) => ({
      date: String(row.timestamp || '').slice(0, 10),
      pageviews: Number(row.pageviews) || 0,
      visitors: Number(row.visitors) || 0,
    }));
    const pageviews = trend.reduce((sum, row) => sum + row.pageviews, 0);
    const visitors = trend.reduce((sum, row) => sum + row.visitors, 0);
    const leads = Array.isArray(adminData.leads)
      ? adminData.leads.filter((lead) => {
          const createdAt = Date.parse(lead?.created_at || '');
          return Number.isFinite(createdAt) && createdAt >= sinceDate.getTime() && createdAt <= untilDate.getTime();
        }).length
      : 0;

    return json({
      range,
      generatedAt: new Date().toISOString(),
      role: adminData.role || 'admin',
      metrics: {
        visitors,
        pageviews,
        leads,
        conversionRate: visitors > 0 ? (leads / visitors) * 100 : 0,
        pagesPerVisitor: visitors > 0 ? pageviews / visitors : 0,
      },
      trend,
      pages: pageRows.map((row) => ({
        label: dimensionValue(row, 'requestPath', 'Page inconnue'),
        pageviews: Number(row.pageviews) || 0,
        visitors: Number(row.visitors) || 0,
      })),
      countries: countryRows.map((row) => ({
        label: dimensionValue(row, 'country', 'Inconnu'),
        pageviews: Number(row.pageviews) || 0,
        visitors: Number(row.visitors) || 0,
      })),
      referrers: referrerRows.map((row) => ({
        label: dimensionValue(row, 'referrerHostname', 'Accès direct'),
        pageviews: Number(row.pageviews) || 0,
        visitors: Number(row.visitors) || 0,
      })),
      devices: deviceRows.map((row) => ({
        label: dimensionValue(row, 'deviceType', 'Inconnu'),
        pageviews: Number(row.pageviews) || 0,
        visitors: Number(row.visitors) || 0,
      })),
    });
  } catch (error) {
    const status = Number(error?.status) || 502;
    return json({ error: error?.message || 'Impossible de charger les statistiques' }, status);
  }
}
