// Authentification partagée entre les fonctions admin-leads et
// admin-vehicles. Deux niveaux d'accès :
//   - "admin" : mot de passe seul (secret ADMIN_PASSWORD), accès complet —
//     comportement historique, inchangé pour ne rien casser.
//   - "partner" : identifiant + mot de passe, vérifiés contre la table
//     `partners` (mot de passe hashé en bcrypt via pgcrypto côté SQL).
//     Accès en LECTURE SEULE : les appelants doivent refuser toute action
//     d'écriture quand le rôle renvoyé est "partner".

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'
import bcrypt from 'https://esm.sh/bcryptjs@2.4.3'

export type Role = 'admin' | 'partner'

export async function authenticate(
  supabase: SupabaseClient,
  body: { username?: string; password?: string }
): Promise<Role | null> {
  const adminPassword = Deno.env.get('ADMIN_PASSWORD')

  // Connexion admin historique : pas d'identifiant, juste le mot de passe.
  if (!body.username) {
    if (adminPassword && body.password === adminPassword) return 'admin'
    return null
  }

  // Connexion partenaire : identifiant + mot de passe, vérifiés en base.
  if (!body.password) return null

  const { data } = await supabase
    .from('partners')
    .select('password_hash, active')
    .eq('username', body.username)
    .maybeSingle()

  if (!data || !data.active) return null

  const valid = await bcrypt.compare(body.password, data.password_hash)
  return valid ? 'partner' : null
}
