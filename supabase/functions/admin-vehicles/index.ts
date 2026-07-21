// Eleven Lease — fonction admin : gère le catalogue véhicules (table
// `vehicles` + bucket Storage `vehicle-photos`), en remplacement du Google
// Sheet. Même patron que admin-leads : mot de passe vérifié ici, côté
// serveur, et seule cette fonction détient la clé service_role capable
// d'écrire sur `vehicles` / le bucket Storage.
//
// Deux rôles : "admin" (mot de passe seul, accès complet) et "partner"
// (identifiant + mot de passe, table `partners`, accès en LECTURE SEULE —
// voir supabase/functions/_shared/auth.ts).
//
// Déploiement : supabase functions deploy admin-vehicles
// Secrets requis :
//   supabase secrets set ADMIN_PASSWORD=votre-mot-de-passe (déjà utilisé par admin-leads)
//   supabase secrets set VERCEL_DEPLOY_HOOK_URL=https://api.vercel.com/v1/integrations/deploy/...

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticate } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const BUCKET = 'vehicle-photos'

// Colonnes qu'un admin peut créer/modifier depuis le formulaire véhicule.
// `slug` n'y figure jamais : calculé à la création, immuable ensuite pour
// ne pas casser une URL de fiche véhicule déjà indexée/partagée. `active`
// se gère via l'action dédiée `update-status`.
const EDITABLE_FIELDS = [
  'brand', 'name', 'type', 'condition', 'price', 'km', 'duration', 'fuel',
  'photos', 'transmission', 'places', 'finition', 'description',
  'options_confort', 'options_exterieur', 'options_interieur', 'options_technologie',
  'annee', 'puissance', 'moteur', 'autonomie_elec', 'autonomie_cumulee',
  'recharge_dc', 'recharge_ac', 'temps_charge', 'consommation', 'co2', 'coffre',
]

function stripAccents(s: unknown): string {
  return String(s == null ? '' : s).normalize('NFD').replace(/[\u0300-\u036f]/g, '')
}
function slugify(s: unknown): string {
  return stripAccents(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

async function triggerRebuild() {
  const hookUrl = Deno.env.get('VERCEL_DEPLOY_HOOK_URL')
  if (!hookUrl) return
  try {
    await fetch(hookUrl, { method: 'POST' })
  } catch (err) {
    console.error('Erreur déclenchement rebuild Vercel (non bloquant) :', err)
  }
}

function storagePathFromPublicUrl(url: string): string | null {
  const marker = `/storage/v1/object/public/${BUCKET}/`
  const i = url.indexOf(marker)
  return i === -1 ? null : url.slice(i + marker.length)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  const jsonHeaders = { ...corsHeaders, 'Content-Type': 'application/json' }

  try {
    const body = await req.json()

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    )

    const role = await authenticate(supabase, body)
    if (!role) {
      return new Response(JSON.stringify({ error: 'Identifiants incorrects' }), {
        status: 401,
        headers: jsonHeaders,
      })
    }
    const isWriteAction = ['create-upload-url', 'create', 'update-details', 'update-status', 'delete'].includes(body.action)
    if (role === 'partner' && isWriteAction) {
      return new Response(JSON.stringify({ error: 'Accès en lecture seule' }), {
        status: 403,
        headers: jsonHeaders,
      })
    }

    if (body.action === 'create-upload-url') {
      const folder = String(body.folder || '').replace(/[^a-zA-Z0-9-]/g, '')
      const filename = String(body.filename || 'photo').replace(/[^a-zA-Z0-9.\-_]/g, '_')
      if (!folder) throw new Error('folder manquant')
      const path = `${folder}/${Date.now()}-${filename}`

      const { data, error } = await supabase.storage.from(BUCKET).createSignedUploadUrl(path)
      if (error) throw error

      const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path)
      return new Response(JSON.stringify({
        path,
        token: data.token,
        publicUrl: pub.publicUrl,
      }), { headers: jsonHeaders })
    }

    if (body.action === 'create') {
      const fields = body.fields || {}
      const insert: Record<string, unknown> = {}
      for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          insert[key] = fields[key]
        }
      }
      if (!insert.brand || !insert.name) throw new Error('Marque et modèle sont requis')

      const base = slugify(`${insert.brand} ${insert.name}`)
      if (!base) throw new Error('Impossible de générer un slug depuis marque/modèle')

      let lastError: unknown = null
      for (let attempt = 0; attempt < 20; attempt++) {
        const slug = attempt === 0 ? base : `${base}-${attempt + 1}`
        const { data, error } = await supabase
          .from('vehicles')
          .insert({ ...insert, slug })
          .select()
          .single()
        if (!error) {
          await triggerRebuild()
          return new Response(JSON.stringify({ vehicle: data }), { headers: jsonHeaders })
        }
        // 23505 = violation de contrainte unique (slug déjà pris) : on retente avec un suffixe
        if (error.code !== '23505') throw error
        lastError = error
      }
      throw lastError
    }

    if (body.action === 'update-details') {
      if (!body.id) throw new Error('id manquant')
      const fields = body.fields || {}
      const update: Record<string, unknown> = {}
      for (const key of EDITABLE_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          update[key] = fields[key]
        }
      }
      if (Object.keys(update).length === 0) throw new Error('Aucun champ à mettre à jour')
      update.updated_at = new Date().toISOString()

      const { error } = await supabase.from('vehicles').update(update).eq('id', body.id)
      if (error) throw error
      await triggerRebuild()
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders })
    }

    if (body.action === 'update-status') {
      if (!body.id) throw new Error('id manquant')
      const { error } = await supabase
        .from('vehicles')
        .update({ active: !!body.active, updated_at: new Date().toISOString() })
        .eq('id', body.id)
      if (error) throw error
      await triggerRebuild()
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders })
    }

    if (body.action === 'delete') {
      if (!body.id) throw new Error('id manquant')

      const { data: existing, error: fetchError } = await supabase
        .from('vehicles')
        .select('photos')
        .eq('id', body.id)
        .single()
      if (fetchError) throw fetchError

      const paths = ((existing?.photos as string[]) || [])
        .map(storagePathFromPublicUrl)
        .filter((p): p is string => !!p)
      if (paths.length > 0) {
        await supabase.storage.from(BUCKET).remove(paths)
      }

      const { error } = await supabase.from('vehicles').delete().eq('id', body.id)
      if (error) throw error
      await triggerRebuild()
      return new Response(JSON.stringify({ ok: true }), { headers: jsonHeaders })
    }

    // Par défaut : liste complète (actifs + inactifs — vue admin)
    const { data, error } = await supabase
      .from('vehicles')
      .select('*')
      .order('created_at', { ascending: false })
    if (error) throw error

    return new Response(JSON.stringify({ vehicles: data, role }), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
