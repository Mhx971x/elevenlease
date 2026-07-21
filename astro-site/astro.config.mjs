// @ts-check
import { defineConfig } from 'astro/config';

// https://astro.build/config
export default defineConfig({
  site: 'https://elevenlease.fr',
  // Génère /loa.html, /contact.html, etc. (au lieu de /loa/index.html) pour
  // conserver exactement les mêmes URLs que le site statique actuel — aucun
  // lien existant ni entrée d'index ne casse lors de la migration.
  build: {
    format: 'file',
  },
});
