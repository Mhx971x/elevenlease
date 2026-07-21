// ============================================================
// SOURCE DES DONNÉES : table Supabase `vehicles`, lue au moment du
// build (génération statique). Le catalogue est géré depuis l'espace
// admin (astro-site/src/pages/admin.astro), qui écrit dans cette même
// table via la fonction edge supabase/functions/admin-vehicles.
// ============================================================
const SUPABASE_URL = 'https://syzlvsfhdmegmebsvscm.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_aF6YEQBB5UrjOrNo9RTMjw_SM3MPKvM';

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

interface VehicleRow {
  brand: string;
  name: string;
  type: string | null;
  condition: string | null;
  price: number | null;
  km: string | null;
  duration: string | null;
  fuel: string | null;
  photos: string[] | null;
  transmission: string | null;
  places: string | null;
  finition: string | null;
  description: string | null;
  options_confort: string[] | null;
  options_exterieur: string[] | null;
  options_interieur: string[] | null;
  options_technologie: string[] | null;
  annee: string | null;
  puissance: string | null;
  moteur: string | null;
  autonomie_elec: string | null;
  autonomie_cumulee: string | null;
  recharge_dc: string | null;
  recharge_ac: string | null;
  temps_charge: string | null;
  consommation: string | null;
  co2: string | null;
  coffre: string | null;
  slug: string;
}

function stripAccents(s: unknown): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
export function slugify(s: unknown): string {
  return stripAccents(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
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

function toVehicle(r: VehicleRow): Vehicle {
  const photos = r.photos || [];
  return {
    brand: r.brand,
    name: r.name,
    type: r.type || '',
    condition: r.condition || '',
    price: r.price || 0,
    km: r.km || '',
    duration: r.duration || '',
    fuel: r.fuel || '',
    photos,
    photo: photos[0] || '',
    transmission: r.transmission || '',
    places: r.places || '',
    finition: r.finition || '',
    description: r.description || '',
    options: {
      Confort: r.options_confort || [],
      Extérieur: r.options_exterieur || [],
      Intérieur: r.options_interieur || [],
      Technologie: r.options_technologie || [],
    },
    annee: r.annee || '',
    puissance: r.puissance || '',
    moteur: r.moteur || '',
    autonomieElec: r.autonomie_elec || '',
    autonomieCumulee: r.autonomie_cumulee || '',
    rechargeDC: r.recharge_dc || '',
    rechargeAC: r.recharge_ac || '',
    tempsCharge: r.temps_charge || '',
    consommation: r.consommation || '',
    co2: r.co2 || '',
    coffre: r.coffre || '',
    slug: r.slug,
  };
}

let cachedVehicles: Vehicle[] | null = null;

export async function fetchVehicles(): Promise<Vehicle[]> {
  if (cachedVehicles) return cachedVehicles;

  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/vehicles?active=eq.true&select=*&order=created_at.desc`,
    {
      headers: {
        apikey: SUPABASE_ANON_KEY,
        Authorization: `Bearer ${SUPABASE_ANON_KEY}`,
      },
    }
  );
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const rows: VehicleRow[] = await res.json();

  const vehicles = rows.filter(r => r && r.brand).map(toVehicle);
  cachedVehicles = vehicles;
  return vehicles;
}
