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
const DOCUMENT_BUCKET = 'lead-documents'
const DOCUMENT_PORTAL_URL = 'https://elevenlease.fr/dossier-documents'
const DOCUMENT_PORTAL_DURATION_MS = 30 * 24 * 60 * 60 * 1000

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
      'vehicule', 'recherche_vehicule', 'type_vehicule_souhaite', 'motorisation',
      'budget_souhaite', 'financement',
      'neuf_occasion', 'kilometrage_annuel', 'duree_contrat', 'apport', 'date_livraison',
      'vehicule_reprise', 'vehicule_reprise_details',
      'entreprise', 'statut_juridique', 'siren', 'chiffre_affaires', 'anciennete_entreprise',
      'statut_pro', 'anciennete', 'revenus', 'charges', 'age', 'ficp',
      'message', 'status',
    ],
  },
  messages: {
    table: 'contact_messages',
    listKey: 'messages',
    editableFields: ['nom', 'email', 'telephone', 'message', 'status'],
  },
}

function createPortalToken() {
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
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
    const documentActions = [
      'create-document-portal',
      'revoke-document-portal',
      'document-download',
      'delete-document',
    ]
    const isWriteAction = [
      'update-status',
      'update-details',
      'delete',
      'create-document-portal',
      'revoke-document-portal',
      'delete-document',
    ].includes(body.action)
    if (role === 'partner' && isWriteAction) {
      return new Response(JSON.stringify({ error: 'Accès en lecture seule' }), {
        status: 403,
        headers: jsonHeaders,
      })
    }
    if (role === 'partner' && documentActions.includes(body.action)) {
      return new Response(JSON.stringify({ error: 'Documents réservés à l’administrateur' }), {
        status: 403,
        headers: jsonHeaders,
      })
    }

    const resourceKey = body.resource === 'messages' ? 'messages' : 'leads'
    const { table, editableFields, listKey } = RESOURCES[resourceKey]

    if (body.action === 'create-document-portal') {
      if (!body.id) throw new Error('id manquant')
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, prenom, nom')
        .eq('id', body.id)
        .maybeSingle()
      if (leadError) throw leadError
      if (!lead) {
        return new Response(JSON.stringify({ error: 'Lead introuvable' }), {
          status: 404,
          headers: jsonHeaders,
        })
      }

      const leadId = String(lead.id)
      const now = new Date().toISOString()
      const { error: revokeError } = await supabase
        .from('document_portals')
        .update({ revoked_at: now })
        .eq('lead_id', leadId)
        .is('revoked_at', null)
      if (revokeError) throw revokeError

      const token = createPortalToken()
      const expiresAt = new Date(Date.now() + DOCUMENT_PORTAL_DURATION_MS).toISOString()
      const { data: portal, error: portalError } = await supabase
        .from('document_portals')
        .insert({
          lead_id: leadId,
          token_hash: await sha256(token),
          expires_at: expiresAt,
        })
        .select('id, expires_at, created_at')
        .single()
      if (portalError) throw portalError
      const { error: moveDocumentsError } = await supabase
        .from('lead_documents')
        .update({ portal_id: portal.id })
        .eq('lead_id', leadId)
      if (moveDocumentsError) throw moveDocumentsError

      return new Response(JSON.stringify({
        ok: true,
        role,
        portal,
        url: `${DOCUMENT_PORTAL_URL}#${token}`,
      }), { headers: jsonHeaders })
    }

    if (body.action === 'revoke-document-portal') {
      if (!body.id) throw new Error('id manquant')
      const { error } = await supabase
        .from('document_portals')
        .update({ revoked_at: new Date().toISOString() })
        .eq('lead_id', String(body.id))
        .is('revoked_at', null)
      if (error) throw error
      return new Response(JSON.stringify({ ok: true, role }), { headers: jsonHeaders })
    }

    if (body.action === 'document-download') {
      if (!body.documentId) throw new Error('documentId manquant')
      const { data: document, error: documentError } = await supabase
        .from('lead_documents')
        .select('storage_path, original_name')
        .eq('id', body.documentId)
        .maybeSingle()
      if (documentError) throw documentError
      if (!document) {
        return new Response(JSON.stringify({ error: 'Document introuvable' }), {
          status: 404,
          headers: jsonHeaders,
        })
      }
      const { data: signed, error: signedError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .createSignedUrl(document.storage_path, 300, {
          download: document.original_name,
        })
      if (signedError) throw signedError
      return new Response(JSON.stringify({
        ok: true,
        role,
        url: signed.signedUrl,
      }), { headers: jsonHeaders })
    }

    if (body.action === 'delete-document') {
      if (!body.documentId) throw new Error('documentId manquant')
      const { data: document, error: documentError } = await supabase
        .from('lead_documents')
        .select('id, portal_id, storage_path')
        .eq('id', body.documentId)
        .maybeSingle()
      if (documentError) throw documentError
      if (!document) {
        return new Response(JSON.stringify({ error: 'Document introuvable' }), {
          status: 404,
          headers: jsonHeaders,
        })
      }
      const { error: storageError } = await supabase.storage
        .from(DOCUMENT_BUCKET)
        .remove([document.storage_path])
      if (storageError) throw storageError
      const { error: deleteError } = await supabase
        .from('lead_documents')
        .delete()
        .eq('id', document.id)
      if (deleteError) throw deleteError
      const { error: completionError } = await supabase
        .from('document_portals')
        .update({ completed_at: null })
        .eq('id', document.portal_id)
      if (completionError) throw completionError
      return new Response(JSON.stringify({ ok: true, role }), { headers: jsonHeaders })
    }

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
      if (resourceKey === 'leads') {
        const leadId = String(body.id)
        const { data: documents, error: documentsError } = await supabase
          .from('lead_documents')
          .select('storage_path')
          .eq('lead_id', leadId)
        if (documentsError) throw documentsError
        const paths = (documents || []).map((document) => document.storage_path)
        if (paths.length) {
          const { error: storageError } = await supabase.storage
            .from(DOCUMENT_BUCKET)
            .remove(paths)
          if (storageError) throw storageError
        }
        const { error: portalsError } = await supabase
          .from('document_portals')
          .delete()
          .eq('lead_id', leadId)
        if (portalsError) throw portalsError
      }
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

    if (resourceKey === 'leads' && role === 'admin' && data?.length) {
      const leadIds = data.map((lead) => String(lead.id))
      const { data: portals, error: portalsError } = await supabase
        .from('document_portals')
        .select('id, lead_id, expires_at, revoked_at, completed_at, created_at')
        .in('lead_id', leadIds)
        .order('created_at', { ascending: false })
      if (portalsError) throw portalsError

      const portalByLead = new Map<string, any>()
      for (const portal of portals || []) {
        if (!portalByLead.has(portal.lead_id)) portalByLead.set(portal.lead_id, portal)
      }
      const portalIds = Array.from(portalByLead.values()).map((portal) => portal.id)
      let documents: Array<Record<string, unknown>> = []
      if (portalIds.length) {
        const { data: documentRows, error: documentsError } = await supabase
          .from('lead_documents')
          .select('id, portal_id, document_type, original_name, mime_type, size_bytes, uploaded_at')
          .in('portal_id', portalIds)
          .order('uploaded_at', { ascending: false })
        if (documentsError) throw documentsError
        documents = documentRows || []
      }

      const enriched = data.map((lead) => {
        const portal = portalByLead.get(String(lead.id))
        if (!portal) return { ...lead, document_portal: null }
        return {
          ...lead,
          document_portal: {
            ...portal,
            expired: new Date(portal.expires_at).getTime() <= Date.now(),
            documents: documents.filter((document) => document.portal_id === portal.id),
          },
        }
      })
      return new Response(JSON.stringify({ [listKey]: enriched, role }), {
        headers: jsonHeaders,
      })
    }

    return new Response(JSON.stringify({ [listKey]: data, role }), { headers: jsonHeaders })
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err) }), {
      status: 500,
      headers: jsonHeaders,
    })
  }
})
