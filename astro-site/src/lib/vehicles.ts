// ============================================================
// SOURCE DES DONNÉES : Google Sheet publié en CSV, lu au moment du
// build (génération statique). Voir le commentaire historique dans
// l'ancien vehicules.html pour le détail des colonnes attendues.
// ============================================================
const SHEET_CSV_URL =
  'https://docs.google.com/spreadsheets/d/e/2PACX-1vRcPk7ROWwg42D6Iwos4AdvE66hiSEX3vw4mM3d2s6e72meg6qaZ7AClW8M3Tj8j7-qHYccrLL9Id2r/pub?output=csv';

export interface Vehicle {
  brand: string;
  name: string;
  type: string;
  condition: string;
  price: number;
  km: string;
  duration: string;
  fuel: string;
  photos: string[];
  photo: string;
  transmission: string;
  places: string;
  finition: string;
  description: string;
  options: {
    Confort: string[];
    Extérieur: string[];
    Intérieur: string[];
    Technologie: string[];
  };
  annee: string;
  puissance: string;
  moteur: string;
  autonomieElec: string;
  autonomieCumulee: string;
  rechargeDC: string;
  rechargeAC: string;
  tempsCharge: string;
  consommation: string;
  co2: string;
  coffre: string;
  slug: string;
}

function stripAccents(s: unknown): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
function normalizeKey(s: unknown): string {
  return stripAccents(s).toLowerCase().trim();
}
function normalizeValue(s: unknown): string {
  return stripAccents(s).toLowerCase().trim();
}
export function slugify(s: unknown): string {
  return stripAccents(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}
function parseOptionsList(s: unknown): string[] {
  return String(s || '').split(',').map(x => x.trim()).filter(Boolean);
}

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], field = '', inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else inQuotes = false;
      } else field += c;
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\r') { /* ignore */ }
      else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  return rows.filter(r => r.some(f => f.trim() !== ''));
}

export function parseDureeMonths(s: string | undefined): number {
  const m = String(s || '').match(/\d+/);
  return m ? parseInt(m[0], 10) : 37;
}

export function computeIndicativePrice(basePrice: number, baseDuree: number, duree: number, apport: number): number {
  if (!basePrice) return 0;
  let price = basePrice * (baseDuree / duree);
  price = price - apport / duree;
  price = Math.max(price, basePrice * 0.35);
  return Math.round(price);
}

let cachedVehicles: Vehicle[] | null = null;

export async function fetchVehicles(): Promise<Vehicle[]> {
  if (cachedVehicles) return cachedVehicles;

  const res = await fetch(SHEET_CSV_URL);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const text = await res.text();
  const rows = parseCSV(text);
  if (rows.length < 2) throw new Error('Feuille vide');

  const headers = rows[0].map(normalizeKey);
  const idx = (name: string) => headers.indexOf(name);
  const iMarque = idx('marque'), iModele = idx('modele'), iType = idx('type'),
    iEtat = idx('etat'), iPrix = idx('prix'), iKm = idx('km'),
    iDuree = idx('duree'), iCarburant = idx('carburant'), iPhoto = idx('photo'),
    iPhoto2 = idx('photo2'), iPhoto3 = idx('photo3'), iPhoto4 = idx('photo4'), iPhoto5 = idx('photo5'),
    iTransmission = idx('transmission'), iPlaces = idx('places'), iFinition = idx('finition'),
    iDescription = idx('description'),
    iOptConfort = idx('optionsconfort'), iOptExterieur = idx('optionsexterieur'),
    iOptInterieur = idx('optionsinterieur'), iOptTechnologie = idx('optionstechnologie'),
    iActif = idx('actif'),
    iAnnee = idx('annee'), iPuissance = idx('puissance'), iMoteur = idx('moteur'),
    iAutonomieElec = idx('autonomieelectrique'), iAutonomieCumulee = idx('autonomiecumulee'),
    iRechargeDC = idx('rechargedc'), iRechargeAC = idx('rechargeac'),
    iTempsCharge = idx('tempscharge'), iConsommation = idx('consommation'),
    iCO2 = idx('co2'), iCoffre = idx('coffre');

  const vehicles = rows.slice(1).map((r): Vehicle | null => {
    const actif = iActif >= 0 ? normalizeValue(r[iActif]) : 'oui';
    if (actif === 'non') return null;
    const priceRaw = (iPrix >= 0 ? r[iPrix] : '') || '';
    const price = parseFloat(priceRaw.replace(',', '.').replace(/[^\d.]/g, ''));
    const brand = (iMarque >= 0 ? r[iMarque] : '').trim();
    const name = (iModele >= 0 ? r[iModele] : '').trim();
    const photos = [iPhoto, iPhoto2, iPhoto3, iPhoto4, iPhoto5]
      .map(i => (i >= 0 ? (r[i] || '').trim() : ''))
      .filter(Boolean);
    return {
      brand, name,
      type: normalizeValue(iType >= 0 ? r[iType] : ''),
      condition: normalizeValue(iEtat >= 0 ? r[iEtat] : ''),
      price: isNaN(price) ? 0 : price,
      km: (iKm >= 0 ? r[iKm] : '').trim(),
      duration: (iDuree >= 0 ? r[iDuree] : '').trim(),
      fuel: (iCarburant >= 0 ? r[iCarburant] : '').trim(),
      photos,
      photo: photos[0] || '',
      transmission: (iTransmission >= 0 ? r[iTransmission] : '').trim(),
      places: (iPlaces >= 0 ? r[iPlaces] : '').trim(),
      finition: (iFinition >= 0 ? r[iFinition] : '').trim(),
      description: (iDescription >= 0 ? r[iDescription] : '').trim(),
      options: {
        Confort: parseOptionsList(iOptConfort >= 0 ? r[iOptConfort] : ''),
        Extérieur: parseOptionsList(iOptExterieur >= 0 ? r[iOptExterieur] : ''),
        Intérieur: parseOptionsList(iOptInterieur >= 0 ? r[iOptInterieur] : ''),
        Technologie: parseOptionsList(iOptTechnologie >= 0 ? r[iOptTechnologie] : ''),
      },
      annee: (iAnnee >= 0 ? r[iAnnee] : '').trim(),
      puissance: (iPuissance >= 0 ? r[iPuissance] : '').trim(),
      moteur: (iMoteur >= 0 ? r[iMoteur] : '').trim(),
      autonomieElec: (iAutonomieElec >= 0 ? r[iAutonomieElec] : '').trim(),
      autonomieCumulee: (iAutonomieCumulee >= 0 ? r[iAutonomieCumulee] : '').trim(),
      rechargeDC: (iRechargeDC >= 0 ? r[iRechargeDC] : '').trim(),
      rechargeAC: (iRechargeAC >= 0 ? r[iRechargeAC] : '').trim(),
      tempsCharge: (iTempsCharge >= 0 ? r[iTempsCharge] : '').trim(),
      consommation: (iConsommation >= 0 ? r[iConsommation] : '').trim(),
      co2: (iCO2 >= 0 ? r[iCO2] : '').trim(),
      coffre: (iCoffre >= 0 ? r[iCoffre] : '').trim(),
      slug: slugify(brand + ' ' + name),
    };
  }).filter((v): v is Vehicle => !!v && !!v.brand);

  cachedVehicles = vehicles;
  return vehicles;
}
