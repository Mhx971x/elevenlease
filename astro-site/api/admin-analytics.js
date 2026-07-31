const SUPABASE_ADMIN_URL = 'https://syzlvsfhdmegmebsvscm.supabase.co/functions/v1/admin-leads';
const SUPABASE_ANON_KEY = 'sb_publishable_aF6YEQBB5UrjOrNo9RTMjw_SM3MPKvM';
const VERCEL_ANALYTICS_URL = 'https://api.vercel.com/v1/query/web-analytics/visits/aggregate';
const VERCEL_ANALYTICS_COUNT_URL = 'https://api.vercel.com/v1/query/web-analytics/visits/count';
const ALLOWED_RANGES = new Set([1, 7, 30]);

function json(response, body, status = 200) {
  response.setHeader('Cache-Control', 'private, no-store, max-age=0');
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

async function queryAnalyticsCount({ token, projectId, since, until }) {
  const url = new URL(VERCEL_ANALYTICS_COUNT_URL);
  url.searchParams.set('projectId', projectId);
  url.searchParams.set('since', since);
  url.searchParams.set('until', until);

  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || data?.message || `Vercel Analytics HTTP ${response.status}`;
    throw new Error(message);
  }
  return data?.data || {};
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    return json(response, { error: 'Méthode non autorisée' }, 405);
  }

  try {
    const body = parseBody(request);
    if (!body.password) return json(response, { error: 'Identifiants manquants' }, 401);

    const range = Number(body.range);
    if (!ALLOWED_RANGES.has(range)) return json(response, { error: 'Période non prise en charge' }, 400);

    const token = process.env.VERCEL_ANALYTICS_TOKEN;
    const projectId = process.env.VERCEL_PROJECT_ID;
    if (!token || !projectId) return json(response, { error: 'Analytics serveur non configuré' }, 503);

    const adminData = await verifyAdmin(body);
    const untilDate = new Date();
    const sinceDate = new Date();
    if (range === 1) {
      sinceDate.setTime(untilDate.getTime() - 24 * 60 * 60 * 1000);
    } else {
      sinceDate.setUTCDate(untilDate.getUTCDate() - (range - 1));
      sinceDate.setUTCHours(0, 0, 0, 0);
    }
    const since = range === 1 ? sinceDate.toISOString() : dateOnly(sinceDate);
    const until = range === 1 ? untilDate.toISOString() : dateOnly(untilDate);
    const queryBase = { token, projectId, since, until };
    const timeGranularity = range === 1 ? 'hour' : 'day';
    const trendLimit = range === 1 ? 24 : range;

    const [countData, trendRows, pageRows, countryRows, referrerRows, deviceRows] = await Promise.all([
      queryAnalyticsCount(queryBase),
      queryAnalytics({ ...queryBase, by: timeGranularity, limit: trendLimit }),
      queryAnalytics({ ...queryBase, by: 'requestPath', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'country', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'referrerHostname', limit: 8 }),
      queryAnalytics({ ...queryBase, by: 'deviceType', limit: 6 }),
    ]);

    const trend = trendRows.map((row) => ({
      date: range === 1 ? String(row.timestamp || '') : String(row.timestamp || '').slice(0, 10),
      pageviews: Number(row.pageviews) || 0,
      visitors: Number(row.visitors) || 0,
    }));
    const pageviews = Number(countData.pageviews) || 0;
    const visitors = Number(countData.visitors) || 0;
    const leads = Array.isArray(adminData.leads)
      ? adminData.leads.filter((lead) => {
          const createdAt = Date.parse(lead?.created_at || '');
          return Number.isFinite(createdAt) && createdAt >= sinceDate.getTime() && createdAt <= untilDate.getTime();
        }).length
      : 0;

    return json(response, {
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
    return json(response, { error: error?.message || 'Impossible de charger les statistiques' }, status);
  }
}
