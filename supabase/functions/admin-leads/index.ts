// Eleven Lease — fonction admin : lit, met à jour, modifie et supprime les
// demandes (leads) et les messages de contact. Le mot de passe est vérifié
// ici, côté serveur, et seule cette fonction détient la clé service_role
// capable d'écrire sur `leads` / `contact_messages`.
//
// Deux rôles : "admin" (mot de passe seul, accès complet) et "partner"
// (identifiant + mot de passe, table `partners`, accès en LECTURE SEULE —
// voir supabase/functions/_shared/auth.ts).
//
// Déploiement : supabase functions deploy admin-leads
// Secret requis : supabase secrets set ADMIN_PASSWORD=votre-mot-de-passe

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticate } from '../_shared/auth.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Deux ressources gérées par cette même fonction : les demandes du
// simulateur (`leads`, comportement historique, inchangé) et les messages
// du formulaire de contact simple (`messages`). `body.resource` sélectionne
// la ressource ; par défaut 'leads' pour rester rétrocompatible avec les
// appels existants qui ne l'envoient pas.
const RESOURCES: Record<string, { table: string; editableFields: string[]; listKey: string }> = {
  leads: {
    table: 'leads',
    listKey: 'leads',
    // Colonnes qu'un admin est autorisé à modifier depuis la fiche d'un lead.
    // (on n'autorise jamais l'écriture directe de `id` ou `created_at`)
    editableFields: [
      'prenom', 'nom', 'email', 'telephone',
      'vehicule', 'type_vehicule_souhaite', 'budget_souhaite', 'financement',
      'neuf_occasion', 'kilometrage_annuel', 'duree_contrat', 'apport', 'date_livraison',
      'vehicule_reprise', 'vehicule_reprise_details',
      'entreprise', 'statut_pro', 'anciennete', 'revenus', 'charges', 'age', 'ficp',
      'message', 'status',
    ],
  },
  messages: {
    table: 'contact_messages',
    listKey: 'messages',
    editableFields: ['nom', 'email', 'telephone', 'message', 'status'],
  },
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
    const isWriteAction = ['update-status', 'update-details', 'delete'].includes(body.action)
    if (role === 'partner' && isWriteAction) {
      return new Response(JSON.stringify({ error: 'Accès en lecture seule' }), {
        status: 403,
        headers: jsonHeaders,
      })
    }

    const resourceKey = body.resource === 'messages' ? 'messages' : 'leads'
    const { table, editableFields, listKey } = RESOURCES[resourceKey]

    if (body.action === 'update-status') {
      const { error } = await supabase
        .from(table)
        .update({ status: body.status })
        .eq('id', body.id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true, role }), { headers: jsonHeaders })
    }

    if (body.action === 'update-details') {
      if (!body.id) throw new Error('id manquant')
      const fields = body.fields || {}
      const update: Record<string, unknown> = {}
      for (const key of editableFields) {
        if (Object.prototype.hasOwnProperty.call(fields, key)) {
          update[key] = fields[key]
        }
      }
      if (Object.keys(update).length === 0) throw new Error('Aucun champ à mettre à jour')

      const { error } = await supabase
        .from(table)
        .update(update)
        .eq('id', body.id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true, role }), { headers: jsonHeaders })
    }

    if (body.action === 'delete') {
      if (!body.id) throw new Error('id manquant')
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', body.id)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true, role }), { headers: jsonHeaders })
    }

    const { data, error } = await supabase
      .from(table)
      .select('*')
      .order('created_at', { ascending: false })

    if (error) throw error

    return new Response(JSON.stringify({ [listKey]: data, role }), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
