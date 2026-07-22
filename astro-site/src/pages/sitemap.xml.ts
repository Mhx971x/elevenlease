import type { APIRoute } from 'astro';
import { fetchVehicles } from '../lib/vehicles';

export const prerender = true;

interface SitemapEntry {
  loc: string;
  changefreq: string;
  priority: string;
}

const STATIC_ENTRIES: SitemapEntry[] = [
  { loc: '/', changefreq: 'weekly', priority: '1.0' },
  { loc: '/simulation.html', changefreq: 'monthly', priority: '0.9' },
  { loc: '/contact.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/vehicules.html', changefreq: 'weekly', priority: '0.9' },
  { loc: '/loa.html', changefreq: 'monthly', priority: '0.8' },
  { loc: '/a-propos.html', changefreq: 'monthly', priority: '0.6' },
  { loc: '/bio.html', changefreq: 'monthly', priority: '0.4' },
  { loc: '/mentions-legales.html', changefreq: 'yearly', priority: '0.2' },
  { loc: '/confidentialite.html', changefreq: 'yearly', priority: '0.2' },
  { loc: '/cgu.html', changefreq: 'yearly', priority: '0.2' },
];

export const GET: APIRoute = async () => {
  const lastmod = new Date().toISOString().slice(0, 10);

  let vehicleEntries: SitemapEntry[] = [];
  try {
    const vehicles = await fetchVehicles();
    vehicleEntries = vehicles.map(v => ({
      loc: `/vehicule/${v.slug}.html`,
      changefreq: 'weekly',
      priority: '0.7',
    }));
  } catch (e) {
    console.error('Erreur de chargement des véhicules pour le sitemap :', e);
  }

  const entries = [...STATIC_ENTRIES, ...vehicleEntries];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>https://elevenlease.fr${e.loc}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
