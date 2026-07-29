// Eleven Lease — portail public et sécurisé de dépôt des justificatifs.
// Le navigateur ne reçoit que des URLs d'upload signées et temporaires.
// Le bucket reste privé et le jeton du dossier est comparé à son hash.
//
// Déploiement :
//   supabase functions deploy document-portal --no-verify-jwt

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const BUCKET = 'lead-documents'
const MAX_FILE_SIZE = 15 * 1024 * 1024
const ALLOWED_ORIGINS = new Set([
  'https://elevenlease.fr',
  'https://www.elevenlease.fr',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
])
const ALLOWED_MIME_TYPES = new Set([
  'application/pdf',
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/heic',
  'image/heif',
])

type Requirement = {
  id: string
  label: string
  description: string
  multiple?: boolean
}

type Portal = {
  id: string
  lead_id: string
  expires_at: string
  revoked_at: string | null
}

type Lead = {
  id: string | number
  prenom: string | null
  nom: string | null
  profil: string | null
  vehicule: string | null
  type_vehicule_souhaite: string | null
}

type LeadDocument = {
  id: string
  document_type: string
  original_name: string
  mime_type: string
  size_bytes: number
  uploaded_at: string
  storage_path?: string
}

const INDIVIDUAL_REQUIREMENTS: Requirement[] = [
  {
    id: 'piece_identite',
    label: 'Pièce d’identité',
    description: 'Carte nationale d’identité ou passeport en cours de validité.',
  },
  {
    id: 'permis_conduire',
    label: 'Permis de conduire',
    description: 'Recto et verso du permis du futur conducteur.',
  },
  {
    id: 'justificatif_domicile',
    label: 'Justificatif de domicile',
    description: 'Document récent de moins de 3 mois.',
  },
  {
    id: 'rib',
    label: 'RIB',
    description: 'Relevé d’identité bancaire au nom du demandeur.',
  },
  {
    id: 'justificatifs_revenus',
    label: 'Justificatifs de revenus',
    description: 'Vos 3 derniers bulletins de salaire ou justificatifs équivalents.',
    multiple: true,
  },
  {
    id: 'avis_imposition',
    label: 'Dernier avis d’imposition',
    description: 'Toutes les pages du dernier avis disponible.',
  },
  {
    id: 'releves_bancaires',
    label: 'Relevés bancaires',
    description: 'Les 3 derniers relevés du compte principal.',
    multiple: true,
  },
]

const PROFESSIONAL_REQUIREMENTS: Requirement[] = [
  {
    id: 'piece_identite',
    label: 'Pièce d’identité du dirigeant',
    description: 'Carte nationale d’identité ou passeport en cours de validité.',
  },
  {
    id: 'permis_conduire',
    label: 'Permis de conduire',
    description: 'Recto et verso du permis du futur conducteur.',
  },
  {
    id: 'kbis',
    label: 'Extrait Kbis',
    description: 'Extrait récent de moins de 3 mois.',
  },
  {
    id: 'statuts',
    label: 'Statuts de l’entreprise',
    description: 'Statuts à jour et signés.',
  },
  {
    id: 'rib',
    label: 'RIB professionnel',
    description: 'Relevé d’identité bancaire de l’entreprise.',
  },
  {
    id: 'bilans',
    label: 'Bilans ou liasses fiscales',
    description: 'Les 2 derniers exercices disponibles.',
    multiple: true,
  },
  {
    id: 'releves_bancaires',
    label: 'Relevés bancaires professionnels',
    description: 'Les 3 derniers relevés du compte professionnel.',
    multiple: true,
  },
]

function corsHeaders(req: Request) {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': ALLOWED_ORIGINS.has(origin)
      ? origin
      : 'https://elevenlease.fr',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Vary': 'Origin',
  }
}

function json(req: Request, body: Record<string, unknown>, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'Content-Type': 'application/json' },
  })
}

async function sha256(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function requirementsFor(profile: string | null) {
  return profile === 'Professionnel' ? PROFESSIONAL_REQUIREMENTS : INDIVIDUAL_REQUIREMENTS
}

function requireString(value: unknown, label: string, max = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} manquant`)
  const clean = value.trim()
  if (clean.length > max) throw new Error(`${label} trop long`)
  return clean
}

function cleanToken(value: unknown) {
  const token = requireString(value, 'Lien sécurisé', 100)
  if (!/^[A-Za-z0-9_-]{43}$/.test(token)) throw new Error('Lien sécurisé invalide')
  return token
}

function normalizeFile(
  originalNameValue: unknown,
  mimeTypeValue: unknown,
  sizeValue: unknown,
) {
  const originalName = requireString(originalNameValue, 'Nom du fichier', 180)
  const mimeType = requireString(mimeTypeValue, 'Type du fichier', 80).toLowerCase()
  const size = Number(sizeValue)

  if (!ALLOWED_MIME_TYPES.has(mimeType)) throw new Error('Format de fichier non accepté')
  if (!Number.isFinite(size) || size <= 0 || size > MAX_FILE_SIZE) {
    throw new Error('Le fichier doit peser moins de 15 Mo')
  }

  const extension = originalName.split('.').pop()?.toLowerCase() || ''
  const allowedExtensions: Record<string, string[]> = {
    'application/pdf': ['pdf'],
    'image/jpeg': ['jpg', 'jpeg'],
    'image/png': ['png'],
    'image/webp': ['webp'],
    'image/heic': ['heic'],
    'image/heif': ['heif'],
  }
  if (!allowedExtensions[mimeType]?.includes(extension)) {
    throw new Error('L’extension du fichier ne correspond pas à son format')
  }

  const base = originalName
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9._-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(-120)
  if (!base) throw new Error('Nom du fichier invalide')

  return { originalName, mimeType, size, safeName: base }
}

async function findPortal(supabase: ReturnType<typeof createClient>, token: string) {
  const tokenHash = await sha256(token)
  const { data, error } = await supabase
    .from('document_portals')
    .select('id, lead_id, expires_at, revoked_at')
    .eq('token_hash', tokenHash)
    .maybeSingle()
  if (error) throw error
  if (!data || data.revoked_at || new Date(data.expires_at).getTime() <= Date.now()) {
    return null
  }
  return data as Portal
}

async function getLead(supabase: ReturnType<typeof createClient>, leadId: string) {
  const { data, error } = await supabase
    .from('leads')
    .select('id, prenom, nom, profil, vehicule, type_vehicule_souhaite')
    .eq('id', leadId)
    .maybeSingle()
  if (error) throw error
  return data as Lead | null
}

async function getDocuments(supabase: ReturnType<typeof createClient>, portalId: string) {
  const { data, error } = await supabase
    .from('lead_documents')
    .select('id, document_type, original_name, mime_type, size_bytes, uploaded_at')
    .eq('portal_id', portalId)
    .order('uploaded_at', { ascending: false })
  if (error) throw error
  return (data || []) as LeadDocument[]
}

async function updateCompletion(
  supabase: ReturnType<typeof createClient>,
  portal: Portal,
  lead: Lead,
) {
  const documents = await getDocuments(supabase, portal.id)
  const uploadedTypes = new Set(documents.map((document) => document.document_type))
  const completed = requirementsFor(lead.profil).every((requirement) =>
    uploadedTypes.has(requirement.id)
  )
  await supabase
    .from('document_portals')
    .update({ completed_at: completed ? new Date().toISOString() : null })
    .eq('id', portal.id)
  return { documents, completed }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders(req) })
  if (req.method !== 'POST') return json(req, { error: 'Méthode non autorisée' }, 405)

  const origin = req.headers.get('origin') || ''
  if (!ALLOWED_ORIGINS.has(origin)) return json(req, { error: 'Origine non autorisée' }, 403)

  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(req, { error: 'Requête invalide' }, 400)
    }

    const token = cleanToken(body.token)
    const action = typeof body.action === 'string' ? body.action : 'portal-info'
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const portal = await findPortal(supabase, token)
    if (!portal) {
      return json(
        req,
        { error: 'Ce lien est invalide, expiré ou a été désactivé.' },
        410,
      )
    }

    const lead = await getLead(supabase, portal.lead_id)
    if (!lead) return json(req, { error: 'Dossier introuvable' }, 404)
    const requirements = requirementsFor(lead.profil)
    const allowedDocumentTypes = new Set([
      ...requirements.map((requirement) => requirement.id),
      'autre',
    ])

    if (action === 'create-upload') {
      const documentType = requireString(body.documentType, 'Type de document', 80)
      if (!allowedDocumentTypes.has(documentType)) {
        return json(req, { error: 'Type de document invalide' }, 400)
      }
      const file = normalizeFile(body.originalName, body.mimeType, body.size)
      const storagePath =
        `${portal.id}/${documentType}/${crypto.randomUUID()}-${file.safeName}`
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUploadUrl(storagePath)
      if (error) throw error
      return json(req, {
        ok: true,
        path: storagePath,
        uploadToken: data.token,
      })
    }

    if (action === 'complete-upload') {
      const storagePath = requireString(body.path, 'Chemin du fichier', 500)
      const documentType = requireString(body.documentType, 'Type de document', 80)
      if (
        !allowedDocumentTypes.has(documentType) ||
        !storagePath.startsWith(`${portal.id}/${documentType}/`)
      ) {
        return json(req, { error: 'Fichier invalide' }, 400)
      }
      const file = normalizeFile(body.originalName, body.mimeType, body.size)
      const slash = storagePath.lastIndexOf('/')
      const folder = storagePath.slice(0, slash)
      const objectName = storagePath.slice(slash + 1)
      const { data: objects, error: listError } = await supabase.storage
        .from(BUCKET)
        .list(folder, { search: objectName, limit: 2 })
      if (listError) throw listError
      const object = objects?.find((item) => item.name === objectName)
      const actualSize = Number(object?.metadata?.size || 0)
      if (!object || actualSize <= 0 || actualSize > MAX_FILE_SIZE) {
        return json(req, { error: 'Le transfert du fichier n’a pas pu être vérifié' }, 400)
      }

      const { error: insertError } = await supabase
        .from('lead_documents')
        .insert({
          portal_id: portal.id,
          lead_id: portal.lead_id,
          document_type: documentType,
          original_name: file.originalName,
          storage_path: storagePath,
          mime_type: file.mimeType,
          size_bytes: actualSize,
        })
      if (insertError && insertError.code !== '23505') throw insertError

      const state = await updateCompletion(supabase, portal, lead)
      return json(req, { ok: true, ...state })
    }

    if (action === 'delete-document') {
      const documentId = requireString(body.documentId, 'Document', 36)
      const { data: document, error: documentError } = await supabase
        .from('lead_documents')
        .select('id, storage_path')
        .eq('id', documentId)
        .eq('portal_id', portal.id)
        .maybeSingle()
      if (documentError) throw documentError
      if (!document) return json(req, { error: 'Document introuvable' }, 404)

      const { error: storageError } = await supabase.storage
        .from(BUCKET)
        .remove([document.storage_path])
      if (storageError) throw storageError
      const { error: deleteError } = await supabase
        .from('lead_documents')
        .delete()
        .eq('id', document.id)
      if (deleteError) throw deleteError

      const state = await updateCompletion(supabase, portal, lead)
      return json(req, { ok: true, ...state })
    }

    if (action !== 'portal-info') {
      return json(req, { error: 'Action inconnue' }, 400)
    }

    await supabase
      .from('document_portals')
      .update({ last_accessed_at: new Date().toISOString() })
      .eq('id', portal.id)
    const state = await updateCompletion(supabase, portal, lead)

    return json(req, {
      ok: true,
      portal: {
        expiresAt: portal.expires_at,
        completed: state.completed,
      },
      client: {
        firstName: lead.prenom || '',
        profile: lead.profil || 'Particulier',
        vehicle: lead.vehicule || lead.type_vehicule_souhaite || '',
      },
      requirements,
      documents: state.documents,
      acceptedFormats: 'PDF, JPG, PNG, WEBP ou HEIC',
      maxFileSize: MAX_FILE_SIZE,
    })
  } catch (error) {
    console.error('Erreur document-portal', error)
    const message = error instanceof Error ? error.message : 'Erreur inattendue'
    const clientError = /manquant|invalide|trop long|accepté|extension|moins de 15 Mo/.test(message)
    return json(
      req,
      { error: clientError ? message : 'Impossible de traiter le document' },
      clientError ? 400 : 500,
    )
  }
})
