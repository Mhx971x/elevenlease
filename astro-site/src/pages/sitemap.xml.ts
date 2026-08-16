import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { fetchVehicles } from '../lib/vehicles';
import { execFileSync } from 'node:child_process';

export const prerender = true;

interface SitemapEntry {
  loc: string;
  changefreq: string;
  priority: string;
  lastmod: string;
}

function gitLastmod(sourcePath: string, fallback: string): string {
  try {
    const date = execFileSync('git', ['log', '-1', '--format=%ad', '--date=short', '--', sourcePath], {
      cwd: process.cwd(),
      encoding: 'utf8',
    }).trim();
    return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : fallback;
  } catch {
    return fallback;
  }
}

const staticEntry = (loc: string, sourcePath: string, changefreq: string, priority: string, fallback = '2026-08-17'): SitemapEntry => ({
  loc,
  changefreq,
  priority,
  lastmod: gitLastmod(sourcePath, fallback),
});

const STATIC_ENTRIES: SitemapEntry[] = [
  staticEntry('/', 'src/pages/index.astro', 'weekly', '1.0'),
  staticEntry('/simulation', 'src/pages/simulation.astro', 'monthly', '0.9'),
  staticEntry('/contact', 'src/pages/contact.astro', 'monthly', '0.8'),
  staticEntry('/vehicules', 'src/pages/vehicules.astro', 'weekly', '0.9', '2026-08-16'),
  staticEntry('/loa', 'src/pages/loa.astro', 'monthly', '0.8'),
  staticEntry('/articles', 'src/pages/articles.astro', 'weekly', '0.7', '2026-07-22'),
  staticEntry('/leasing-sans-apport', 'src/pages/leasing-sans-apport.astro', 'monthly', '0.8'),
  staticEntry('/leasing-gros-rouleur', 'src/pages/leasing-gros-rouleur.astro', 'monthly', '0.8'),
  staticEntry('/leasing-professionnel', 'src/pages/leasing-professionnel.astro', 'monthly', '0.8'),
  staticEntry('/leasing-auto-entrepreneur', 'src/pages/leasing-auto-entrepreneur.astro', 'monthly', '0.8'),
  staticEntry('/a-propos', 'src/pages/a-propos.astro', 'monthly', '0.6'),
  staticEntry('/bio', 'src/pages/bio.astro', 'monthly', '0.4', '2026-07-22'),
  staticEntry('/mentions-legales', 'src/pages/mentions-legales.astro', 'yearly', '0.2', '2026-07-22'),
  staticEntry('/confidentialite', 'src/pages/confidentialite.astro', 'yearly', '0.2', '2026-07-22'),
  staticEntry('/cgu', 'src/pages/cgu.astro', 'yearly', '0.2', '2026-07-22'),
];

export const GET: APIRoute = async () => {
  let vehicleEntries: SitemapEntry[] = [];
  try {
    const vehicles = await fetchVehicles();
    vehicleEntries = vehicles.map(v => ({
      loc: `/vehicule/${v.slug}`,
      changefreq: 'weekly',
      priority: '0.7',
      lastmod: /^\d{4}-\d{2}-\d{2}/.test(v.updatedAt)
        ? v.updatedAt.slice(0, 10)
        : /^\d{4}-\d{2}-\d{2}/.test(v.createdAt)
          ? v.createdAt.slice(0, 10)
          : gitLastmod('src/pages/vehicule/[slug].astro', '2026-08-16'),
    }));
  } catch (e) {
    console.error('Erreur de chargement des véhicules pour le sitemap :', e);
  }

  const articles = await getCollection('articles');
  const articleEntries: SitemapEntry[] = articles.map(a => ({
    loc: `/articles/${a.id}`,
    changefreq: 'monthly',
    priority: '0.6',
    lastmod: (a.data.updatedDate || a.data.publishDate).toISOString().slice(0, 10),
  }));

  const entries = [...STATIC_ENTRIES, ...vehicleEntries, ...articleEntries];

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${entries.map(e => `  <url>
    <loc>https://elevenlease.fr${e.loc}</loc>
    <lastmod>${e.lastmod}</lastmod>
    <changefreq>${e.changefreq}</changefreq>
    <priority>${e.priority}</priority>
  </url>`).join('\n')}
</urlset>
`;

  return new Response(body, {
    headers: { 'Content-Type': 'application/xml' },
  });
};
