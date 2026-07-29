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
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const EMAIL_SENDER = { name: 'Eleven Lease', email: 'contact@elevenlease.fr' }

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

function escapeHtml(value: unknown) {
  return String(value || '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

async function createDocumentPortal(supabase: any, leadId: string) {
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

  return {
    portal,
    url: `${DOCUMENT_PORTAL_URL}#${token}`,
  }
}

function documentRequestEmailHtml(lead: Record<string, unknown>, portalUrl: string) {
  const firstName = escapeHtml(lead.prenom || '')
  const vehicle = escapeHtml(lead.vehicule || lead.type_vehicule_souhaite || 'votre projet automobile')
  const professional = String(lead.profil || '').toLowerCase().includes('profession')
  const documents = professional
    ? [
      'Pièce d’identité du dirigeant et permis de conduire',
      'Extrait Kbis récent et statuts de l’entreprise',
      'RIB professionnel',
      'Bilans ou liasses fiscales disponibles',
      'Relevés bancaires professionnels récents',
    ]
    : [
      'Pièce d’identité et permis de conduire',
      'Justificatif de domicile récent',
      'RIB',
      'Justificatifs de revenus et dernier avis d’imposition',
      'Relevés bancaires récents',
    ]
  const documentRows = documents
    .map((document) =>
      `<tr><td style="padding:7px 0;color:#55555d;font-size:14px;line-height:1.5;">
        <span style="display:inline-block;width:7px;height:7px;margin-right:10px;border-radius:50%;background:#ff007f;"></span>${escapeHtml(document)}
      </td></tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Documents nécessaires à votre dossier Eleven Lease</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#17171a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Ajoutez vos justificatifs dans votre espace sécurisé Eleven Lease.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;">
      <tr>
        <td align="center" style="padding:30px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;">
            <tr><td style="height:5px;background:#ff007f;font-size:0;">&nbsp;</td></tr>
            <tr>
              <td style="padding:32px 34px 12px;">
                <img src="https://elevenlease.fr/eleven-lease-logo-light.png" width="145" alt="Eleven Lease" style="display:block;width:145px;max-width:100%;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:24px 34px 36px;">
                <div style="margin-bottom:10px;color:#ff007f;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Finalisation de votre dossier</div>
                <h1 style="margin:0 0 18px;font-size:27px;line-height:1.18;letter-spacing:-.5px;">Vos documents sont nécessaires.</h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.65;">Bonjour ${firstName},</p>
                <p style="margin:0 0 22px;color:#55555d;font-size:15px;line-height:1.65;">
                  Afin de poursuivre l’étude de votre dossier pour <strong style="color:#17171a;">${vehicle}</strong>,
                  merci d’ajouter vos justificatifs dans votre espace privé Eleven Lease.
                </p>
                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;padding:16px 19px;background:#f7f7f9;border-radius:14px;">
                  <tr><td style="padding-bottom:7px;color:#17171a;font-size:13px;font-weight:700;">Documents généralement demandés</td></tr>
                  ${documentRows}
                </table>
                <a href="${escapeHtml(portalUrl)}" style="display:inline-block;padding:14px 23px;border-radius:999px;background:#ff007f;color:#fff;font-size:14px;font-weight:700;text-decoration:none;">
                  Déposer mes documents
                </a>
                <p style="margin:18px 0 0;color:#77777f;font-size:12px;line-height:1.55;">
                  Ce lien personnel est valable 30 jours. Ne le partagez pas. Les formats PDF et photo sont acceptés.
                </p>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 34px;background:#17171a;color:#b8b8bd;font-size:11px;line-height:1.55;">
                Eleven Lease · <a href="mailto:contact@elevenlease.fr" style="color:#fff;text-decoration:none;">contact@elevenlease.fr</a><br>
                Une question ? Répondez simplement à cet email.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function documentRequestEmailText(lead: Record<string, unknown>, portalUrl: string) {
  return [
    `Bonjour ${String(lead.prenom || '')},`,
    '',
    'Afin de poursuivre l’étude de votre dossier Eleven Lease, merci d’ajouter vos justificatifs dans votre espace privé :',
    portalUrl,
    '',
    'Ce lien personnel est valable 30 jours. Ne le partagez pas.',
    'Les formats PDF et photo sont acceptés.',
    '',
    'L’équipe Eleven Lease',
    'contact@elevenlease.fr',
  ].join('\n')
}

async function sendDocumentRequestEmail(lead: Record<string, unknown>, portalUrl: string) {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  if (!apiKey) throw new Error('BREVO_API_KEY non configurée')
  const email = String(lead.email || '').trim()
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error('Adresse email client invalide')
  }

  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: EMAIL_SENDER,
      to: [{
        email,
        name: `${String(lead.prenom || '')} ${String(lead.nom || '')}`.trim(),
      }],
      replyTo: EMAIL_SENDER,
      subject: 'Documents nécessaires pour votre dossier Eleven Lease',
      htmlContent: documentRequestEmailHtml(lead, portalUrl),
      textContent: documentRequestEmailText(lead, portalUrl),
      tags: ['document-request'],
      headers: {
        'X-Mailin-custom': `lead_id:${String(lead.id)}`,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`Brevo HTTP ${response.status}`)
  return typeof data.messageId === 'string' ? data.messageId : ''
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
      'send-document-request',
      'revoke-document-portal',
      'document-download',
      'delete-document',
    ]
    const isWriteAction = [
      'update-status',
      'update-details',
      'delete',
      'create-document-portal',
      'send-document-request',
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

    if (body.action === 'send-document-request') {
      if (!body.id) throw new Error('id manquant')
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, prenom, nom, email, vehicule, type_vehicule_souhaite, profil')
        .eq('id', body.id)
        .maybeSingle()
      if (leadError) throw leadError
      if (!lead) {
        return new Response(JSON.stringify({ error: 'Lead introuvable' }), {
          status: 404,
          headers: jsonHeaders,
        })
      }

      const created = await createDocumentPortal(supabase, String(lead.id))
      let messageId = ''
      try {
        messageId = await sendDocumentRequestEmail(lead, created.url)
      } catch (emailError) {
        const message = emailError instanceof Error ? emailError.message : 'Erreur Brevo'
        await supabase
          .from('leads')
          .update({
            document_request_email_status: 'failed',
            document_request_email_error: message,
          })
          .eq('id', lead.id)
        throw emailError
      }
      const sentAt = new Date().toISOString()
      const { error: trackingError } = await supabase
        .from('leads')
        .update({
          status: 'documents',
          document_request_email_status: 'sent',
          document_request_email_id: messageId || null,
          document_request_email_sent_at: sentAt,
          document_request_email_error: null,
        })
        .eq('id', lead.id)
      if (trackingError) console.error('Suivi email documents non enregistré', trackingError)
      return new Response(JSON.stringify({
        ok: true,
        role,
        portal: created.portal,
        emailStatus: 'sent',
        messageId,
        sentAt,
      }), { headers: jsonHeaders })
    }

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

      const created = await createDocumentPortal(supabase, String(lead.id))
      return new Response(JSON.stringify({
        ok: true,
        role,
        portal: created.portal,
        url: created.url,
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
