import sharp from 'sharp';
import { fileURLToPath } from 'node:url';

const publicDir = new URL('../public/', import.meta.url);
const generatedOgSource = process.argv[2];
if (!generatedOgSource) {
  throw new Error('Usage: node scripts/generate-marketing-assets.mjs /chemin/vers/fond-og.png');
}

const heroAssets = [
  'hero-premium-coupe-shadow-v3',
  'hero-cupra-formentor-shadow-v2',
  'hero-clio-alpine-black-shadow-v3',
  'hero-tesla-model-3-shadow-v2',
  'hero-premium-coupe-v2',
  'hero-sport-compact',
];

await Promise.all(heroAssets.map(async (name) => {
  await sharp(fileURLToPath(new URL(`${name}.png`, publicDir)))
    .webp({ quality: 82, alphaQuality: 90, effort: 6 })
    .toFile(fileURLToPath(new URL(`${name}.webp`, publicDir)));
}));

const ogOverlay = Buffer.from(`
  <svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
    <defs>
      <linearGradient id="copyPanel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#ffffff" stop-opacity="0.98"/>
        <stop offset="0.7" stop-color="#ffffff" stop-opacity="0.86"/>
        <stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
      </linearGradient>
    </defs>
    <rect width="710" height="630" fill="url(#copyPanel)"/>
    <rect x="72" y="196" width="50" height="5" rx="2.5" fill="#e0006d"/>
    <text x="72" y="268" fill="#111113" font-family="Arial, Helvetica, sans-serif" font-size="57" font-weight="700" letter-spacing="-2">Le leasing qui s'adapte</text>
    <text x="72" y="332" fill="#111113" font-family="Arial, Helvetica, sans-serif" font-size="57" font-weight="700" letter-spacing="-2">à votre budget.</text>
    <text x="72" y="388" fill="#555761" font-family="Arial, Helvetica, sans-serif" font-size="23">Toutes marques · Particuliers et professionnels</text>
    <rect x="72" y="440" width="305" height="58" rx="14" fill="#111113"/>
    <text x="224.5" y="477" text-anchor="middle" fill="#ffffff" font-family="Arial, Helvetica, sans-serif" font-size="20" font-weight="700">elevenlease.fr</text>
  </svg>
`);

const logo = await sharp(fileURLToPath(new URL('eleven-lease-logo-light.png', publicDir)))
  .resize({ width: 190 })
  .png()
  .toBuffer();

await sharp(generatedOgSource)
  .resize(1200, 630, { fit: 'cover', position: 'centre' })
  .composite([
    { input: ogOverlay, left: 0, top: 0 },
    { input: logo, left: 72, top: 62 },
  ])
  .jpeg({ quality: 88, progressive: true, mozjpeg: true })
  .toFile(fileURLToPath(new URL('og-eleven-lease-1200x630.jpg', publicDir)));

console.log('Hero WebP and 1200x630 Open Graph assets generated.');
