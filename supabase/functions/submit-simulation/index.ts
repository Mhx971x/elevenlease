// Eleven Lease — point d'entrée serveur du simulateur.
// Valide et enregistre le lead, prévient l'administration via le Google Sheet
// historique, puis envoie au client une confirmation transactionnelle Brevo.
//
// Déploiement :
//   supabase functions deploy submit-simulation --no-verify-jwt
//
// Secret requis :
//   BREVO_API_KEY

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const ALLOWED_ORIGINS = new Set([
  'https://elevenlease.fr',
  'https://www.elevenlease.fr',
  'http://localhost:4321',
  'http://127.0.0.1:4321',
])

const GOOGLE_LEADS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbz4VdDWwJoaqpudvU3Y2pGNyBt0zkYRSYKaZ9syNELViJdWoIoeDtb9Axu0ecA5B4bU/exec'
const BREVO_ENDPOINT = 'https://api.brevo.com/v3/smtp/email'
const SENDER = { name: 'Eleven Lease', email: 'contact@elevenlease.fr' }
const RATE_LIMIT_MAX = 5
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000

type LeadPayload = {
  submissionId: string
  formStartedAt: number
  website?: string
  prenom: string
  nom: string
  telephone: string
  email: string
  vehicule: string
  rechercheVehicule: string
  profil: string
  entreprise: string
  financement: string
  typeVehiculeSouhaite: string
  motorisation: string
  budgetSouhaite: string
  neufOccasion: string
  kilometrageAnnuel: string
  dureeContrat: string
  apport: string
  dateLivraison: string
  vehiculeReprise: string
  vehiculeRepriseDetails: string
  statutPro: string
  revenus: string
  charges: string
  anciennete: string
  age: string
  ficp: string
  statutJuridique: string
  siren: string
  chiffreAffaires: string
  ancienneteEntreprise: string
  message: string
  consentRecontact: boolean
  eligible?: string
  criteresRisque?: string
}

type StoredLead = {
  id: string | number
  submission_id: string
  confirmation_email_status: 'pending' | 'sent' | 'failed' | null
  email: string
}

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

function requiredString(value: unknown, label: string, max = 160) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} manquant`)
  const clean = value.trim()
  if (clean.length > max) throw new Error(`${label} trop long`)
  return clean
}

function optionalString(value: unknown, label: string, max = 500) {
  if (value == null || value === '') return ''
  if (typeof value !== 'string') throw new Error(`${label} invalide`)
  const clean = value.trim()
  if (clean.length > max) throw new Error(`${label} trop long`)
  return clean
}

function oneOf(value: unknown, label: string, allowed: string[]) {
  const clean = requiredString(value, label)
  if (!allowed.includes(clean)) throw new Error(`${label} invalide`)
  return clean
}

function nonNegativeNumber(value: string, label: string) {
  if (!/^\d+(?:[.,]\d+)?$/.test(value) || Number(value.replace(',', '.')) < 0) {
    throw new Error(`${label} invalide`)
  }
}

function normalizePayload(input: Record<string, unknown>): LeadPayload {
  const submissionId = requiredString(input.submissionId, 'Identifiant de soumission', 36)
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(submissionId)) {
    throw new Error('Identifiant de soumission invalide')
  }

  const prenom = requiredString(input.prenom, 'Prénom', 80)
  const nom = requiredString(input.nom, 'Nom', 100)
  const email = requiredString(input.email, 'Email', 254).toLowerCase()
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new Error('Email invalide')

  const telephone = requiredString(input.telephone, 'Téléphone', 40)
  if (!/^[+\d\s().-]+$/.test(telephone)) throw new Error('Téléphone invalide')
  const phoneDigits = telephone.replace(/\D/g, '')
  if (phoneDigits.length < 8 || phoneDigits.length > 15) throw new Error('Téléphone invalide')

  const rechercheVehicule = oneOf(input.rechercheVehicule, 'Mode de recherche', [
    'Modèle précis',
    'Besoin de conseil',
    'Ouvert à plusieurs modèles',
  ])
  const profil = oneOf(input.profil, 'Profil', ['Particulier', 'Professionnel'])
  const vehicule = optionalString(input.vehicule, 'Véhicule', 160)
  const typeVehiculeSouhaite = optionalString(input.typeVehiculeSouhaite, 'Carrosserie', 80)
  const motorisation = optionalString(input.motorisation, 'Motorisation', 80)
  if (rechercheVehicule === 'Modèle précis' && !vehicule) throw new Error('Véhicule manquant')
  if (rechercheVehicule !== 'Modèle précis' && (!typeVehiculeSouhaite || !motorisation)) {
    throw new Error('Préférences véhicule incomplètes')
  }

  if (input.consentRecontact !== true) throw new Error('Consentement manquant')

  const formStartedAt = Number(input.formStartedAt)
  if (!Number.isFinite(formStartedAt)) throw new Error('Horodatage du formulaire invalide')

  const payload: LeadPayload = {
    submissionId,
    formStartedAt,
    website: optionalString(input.website, 'Champ de contrôle', 200),
    prenom,
    nom,
    telephone,
    email,
    vehicule,
    rechercheVehicule,
    profil,
    entreprise: optionalString(input.entreprise, 'Entreprise', 160),
    financement: 'Leasing (LOA/LLD)',
    typeVehiculeSouhaite,
    motorisation,
    budgetSouhaite: oneOf(input.budgetSouhaite, 'Budget', [
      'Moins de 300 €/mois',
      '300 à 500 €/mois',
      '500 à 700 €/mois',
      '700 à 1 000 €/mois',
      'Plus de 1 000 €/mois',
    ]),
    neufOccasion: oneOf(input.neufOccasion, 'État du véhicule', ['Neuf', 'Occasion', 'Peu importe']),
    kilometrageAnnuel: oneOf(input.kilometrageAnnuel, 'Kilométrage annuel', [
      '10 000 km/an',
      '15 000 km/an',
      '20 000 km/an',
      '30 000 km/an',
      'Kilométrage illimité (Crédit-bail)',
    ]),
    dureeContrat: oneOf(input.dureeContrat, 'Durée du contrat', ['36 mois', '48 mois', '60 mois', 'À définir']),
    apport: oneOf(input.apport, 'Apport', ['0 €', 'Moins de 2 000 €', '2 000 à 5 000 €', 'Plus de 5 000 €']),
    dateLivraison: oneOf(input.dateLivraison, 'Date de livraison', [
      'Dès que possible',
      'Dans 1 mois',
      'Dans 3 mois',
      'Plus tard',
    ]),
    vehiculeReprise: oneOf(input.vehiculeReprise, 'Reprise', ['Oui', 'Non']),
    vehiculeRepriseDetails: optionalString(input.vehiculeRepriseDetails, 'Détails de reprise', 220),
    statutPro: optionalString(input.statutPro, 'Statut professionnel', 80),
    revenus: optionalString(input.revenus, 'Revenus', 30),
    charges: optionalString(input.charges, 'Charges', 30),
    anciennete: optionalString(input.anciennete, 'Ancienneté', 80),
    age: optionalString(input.age, 'Âge', 3),
    ficp: optionalString(input.ficp, 'Situation FICP', 80),
    statutJuridique: optionalString(input.statutJuridique, 'Statut juridique', 100),
    siren: optionalString(input.siren, 'SIREN', 9),
    chiffreAffaires: optionalString(input.chiffreAffaires, 'Chiffre d’affaires', 30),
    ancienneteEntreprise: optionalString(input.ancienneteEntreprise, 'Ancienneté entreprise', 80),
    message: optionalString(input.message, 'Message', 1500),
    consentRecontact: true,
  }

  if (payload.vehiculeReprise === 'Oui' && !payload.vehiculeRepriseDetails) {
    throw new Error('Détails de reprise manquants')
  }

  if (profil === 'Professionnel') {
    payload.entreprise = requiredString(input.entreprise, 'Entreprise', 160)
    payload.statutJuridique = oneOf(input.statutJuridique, 'Statut juridique', [
      'Micro-entreprise',
      'EI / EIRL',
      'SAS / SASU',
      'SARL / EURL',
      'Association',
      'Autre',
    ])
    payload.chiffreAffaires = requiredString(input.chiffreAffaires, 'Chiffre d’affaires', 30)
    nonNegativeNumber(payload.chiffreAffaires, 'Chiffre d’affaires')
    payload.ancienneteEntreprise = oneOf(input.ancienneteEntreprise, 'Ancienneté entreprise', [
      'Moins de 1 an',
      '1 à 3 ans',
      'Plus de 3 ans',
    ])
    if (payload.siren && !/^\d{9}$/.test(payload.siren)) throw new Error('SIREN invalide')
  } else {
    payload.statutPro = oneOf(input.statutPro, 'Statut professionnel', [
      'CDI',
      'CDD',
      'Indépendant',
      'Retraité',
      'Étudiant',
      'Sans emploi',
    ])
    payload.revenus = requiredString(input.revenus, 'Revenus', 30)
    payload.charges = requiredString(input.charges, 'Charges', 30)
    nonNegativeNumber(payload.revenus, 'Revenus')
    nonNegativeNumber(payload.charges, 'Charges')
    payload.anciennete = oneOf(input.anciennete, 'Ancienneté', [
      'Moins de 6 mois',
      '6 mois à 2 ans',
      'Plus de 2 ans',
    ])
    payload.ficp = oneOf(input.ficp, 'Situation FICP', [
      'Non, pas fiché',
      'Oui, fiché',
      "Je n'ai pas vérifié",
    ])
    payload.age = requiredString(input.age, 'Âge', 3)
    if (!/^\d{1,3}$/.test(payload.age) || Number(payload.age) < 18 || Number(payload.age) > 100) {
      throw new Error('Âge invalide')
    }
  }

  return payload
}

function computeEligibility(payload: LeadPayload) {
  if (payload.profil === 'Professionnel') {
    return {
      eligible: 'Étude professionnelle',
      criteresRisque:
        payload.ancienneteEntreprise === 'Moins de 1 an'
          ? 'Entreprise créée depuis moins d’un an'
          : '',
    }
  }

  const reasons: string[] = []
  const income = Number(payload.revenus)
  const charges = Number(payload.charges)
  const age = Number(payload.age)
  const budgetEstimate: Record<string, number> = {
    'Moins de 300 €/mois': 300,
    '300 à 500 €/mois': 400,
    '500 à 700 €/mois': 600,
    '700 à 1 000 €/mois': 850,
    'Plus de 1 000 €/mois': 1000,
  }
  if (payload.ficp === 'Oui, fiché') reasons.push('Interdit bancaire (FICP)')
  if (!Number.isFinite(income) || income < 1200) reasons.push('Revenus inférieurs à 1 200 €')
  if (!Number.isFinite(age) || age < 18 || age > 75) reasons.push('Âge hors critères indicatifs')
  if (payload.statutPro === 'Étudiant' || payload.statutPro === 'Sans emploi') {
    reasons.push(`Statut professionnel (${payload.statutPro})`)
  }
  if (payload.anciennete === 'Moins de 6 mois') {
    reasons.push('Ancienneté professionnelle inférieure à 6 mois')
  }
  if (income > 0 && (charges + budgetEstimate[payload.budgetSouhaite]) / income > 0.35) {
    reasons.push('Taux d’endettement estimé supérieur à 35 %')
  }
  return { eligible: reasons.length ? 'Non' : 'Oui', criteresRisque: reasons.join(', ') }
}

function toDatabaseRow(payload: LeadPayload) {
  const evaluation = computeEligibility(payload)
  return {
    submission_id: payload.submissionId,
    prenom: payload.prenom,
    nom: payload.nom,
    telephone: payload.telephone,
    email: payload.email,
    vehicule: payload.vehicule,
    recherche_vehicule: payload.rechercheVehicule,
    profil: payload.profil,
    entreprise: payload.entreprise,
    financement: 'Leasing (LOA/LLD)',
    type_vehicule_souhaite:
      payload.rechercheVehicule === 'Modèle précis' ? '' : payload.typeVehiculeSouhaite,
    motorisation: payload.rechercheVehicule === 'Modèle précis' ? '' : payload.motorisation,
    budget_souhaite: payload.budgetSouhaite,
    neuf_occasion: payload.neufOccasion,
    kilometrage_annuel: payload.kilometrageAnnuel,
    duree_contrat: payload.dureeContrat,
    apport: payload.apport,
    date_livraison: payload.dateLivraison,
    vehicule_reprise: payload.vehiculeReprise,
    vehicule_reprise_details:
      payload.vehiculeReprise === 'Oui' ? payload.vehiculeRepriseDetails : '',
    statut_pro: payload.profil === 'Professionnel' ? '' : payload.statutPro,
    revenus: payload.profil === 'Professionnel' ? '' : payload.revenus,
    charges: payload.profil === 'Professionnel' ? '' : payload.charges,
    anciennete: payload.profil === 'Professionnel' ? '' : payload.anciennete,
    age: payload.profil === 'Professionnel' ? '' : payload.age,
    ficp: payload.profil === 'Professionnel' ? '' : payload.ficp,
    statut_juridique: payload.profil === 'Professionnel' ? payload.statutJuridique : '',
    siren: payload.profil === 'Professionnel' ? payload.siren : '',
    chiffre_affaires: payload.profil === 'Professionnel' ? payload.chiffreAffaires : '',
    anciennete_entreprise:
      payload.profil === 'Professionnel' ? payload.ancienneteEntreprise : '',
    eligible: evaluation.eligible,
    criteres_risque: evaluation.criteresRisque,
    message: payload.message,
    consent_recontact: true,
    confirmation_email_status: 'pending',
  }
}

function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!)
}

function projectVehicle(payload: LeadPayload) {
  if (payload.rechercheVehicule === 'Modèle précis') return payload.vehicule
  return [payload.typeVehiculeSouhaite, payload.motorisation].filter(Boolean).join(' · ')
}

function emailHtml(payload: LeadPayload) {
  const firstName = escapeHtml(payload.prenom)
  const vehicle = escapeHtml(projectVehicle(payload))
  const rows = [
    ['Véhicule recherché', vehicle],
    ['État', escapeHtml(payload.neufOccasion)],
    ['Budget mensuel', escapeHtml(payload.budgetSouhaite)],
    ['Kilométrage annuel', escapeHtml(payload.kilometrageAnnuel)],
    ['Durée envisagée', escapeHtml(payload.dureeContrat)],
    ['Apport', escapeHtml(payload.apport)],
    ['Livraison souhaitée', escapeHtml(payload.dateLivraison)],
  ]
    .map(([label, value]) =>
      `<tr>
        <td style="padding:9px 0;color:#77777f;font-size:13px;vertical-align:top;">${label}</td>
        <td style="padding:9px 0 9px 18px;color:#17171a;font-size:13px;font-weight:600;text-align:right;vertical-align:top;">${value}</td>
      </tr>`
    )
    .join('')

  return `<!doctype html>
<html lang="fr">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>Votre demande Eleven Lease</title>
  </head>
  <body style="margin:0;padding:0;background:#f5f5f7;font-family:Arial,Helvetica,sans-serif;color:#17171a;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">
      Votre demande de leasing est bien enregistrée. Un conseiller vous recontacte sous 24h.
    </div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f5f5f7;">
      <tr>
        <td align="center" style="padding:30px 14px;">
          <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border-radius:20px;overflow:hidden;">
            <tr>
              <td style="height:5px;background:#ff007f;font-size:0;">&nbsp;</td>
            </tr>
            <tr>
              <td style="padding:32px 34px 12px;">
                <img src="https://elevenlease.fr/eleven-lease-logo-light.png" width="145" alt="Eleven Lease" style="display:block;width:145px;max-width:100%;height:auto;border:0;">
              </td>
            </tr>
            <tr>
              <td style="padding:24px 34px 34px;">
                <h1 style="margin:0 0 16px;font-size:28px;line-height:1.15;letter-spacing:-.6px;">
                  Votre demande est bien reçue.
                </h1>
                <p style="margin:0 0 12px;font-size:16px;line-height:1.65;">Bonjour ${firstName},</p>
                <p style="margin:0 0 24px;color:#55555d;font-size:15px;line-height:1.65;">
                  Merci pour votre demande. Notre équipe étudie votre projet et un conseiller Eleven Lease vous recontactera sous 24h.
                </p>

                <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 26px;padding:17px 20px;background:#f7f7f9;border-radius:14px;">
                  <tr>
                    <td>
                      <div style="margin-bottom:8px;color:#ff007f;font-size:11px;font-weight:700;letter-spacing:1px;text-transform:uppercase;">Récapitulatif de votre projet</div>
                      <table role="presentation" width="100%" cellspacing="0" cellpadding="0">${rows}</table>
                    </td>
                  </tr>
                </table>

                <div style="margin:0 0 10px;font-size:15px;font-weight:700;">Et maintenant ?</div>
                <p style="margin:0 0 7px;color:#55555d;font-size:14px;line-height:1.55;">1. Nous analysons les informations transmises.</p>
                <p style="margin:0 0 7px;color:#55555d;font-size:14px;line-height:1.55;">2. Nous recherchons l’offre la plus adaptée.</p>
                <p style="margin:0 0 28px;color:#55555d;font-size:14px;line-height:1.55;">3. Un conseiller vous appelle sous 24h.</p>

                <a href="https://taap.it/elevenleasewhatsapp" style="display:inline-block;padding:13px 22px;border-radius:999px;background:#ff007f;color:#fff;font-size:14px;font-weight:700;text-decoration:none;">
                  Une question ? Écrivez-nous
                </a>
              </td>
            </tr>
            <tr>
              <td style="padding:20px 34px;background:#17171a;color:#b8b8bd;font-size:11px;line-height:1.55;">
                Eleven Lease · <a href="mailto:contact@elevenlease.fr" style="color:#fff;text-decoration:none;">contact@elevenlease.fr</a><br>
                Cet email confirme uniquement la réception de votre demande de simulation.
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`
}

function emailText(payload: LeadPayload) {
  return [
    `Bonjour ${payload.prenom},`,
    '',
    'Votre demande de leasing a bien été reçue.',
    'Notre équipe étudie votre projet et un conseiller Eleven Lease vous recontactera sous 24h.',
    '',
    `Véhicule recherché : ${projectVehicle(payload)}`,
    `État : ${payload.neufOccasion}`,
    `Budget mensuel : ${payload.budgetSouhaite}`,
    `Kilométrage annuel : ${payload.kilometrageAnnuel}`,
    `Durée envisagée : ${payload.dureeContrat}`,
    `Apport : ${payload.apport}`,
    `Livraison souhaitée : ${payload.dateLivraison}`,
    '',
    'Une question ? Répondez simplement à cet email.',
    '',
    'L’équipe Eleven Lease',
    'contact@elevenlease.fr',
  ].join('\n')
}

async function sendBrevoConfirmation(payload: LeadPayload) {
  const apiKey = Deno.env.get('BREVO_API_KEY')
  if (!apiKey) throw new Error('BREVO_API_KEY non configurée')

  const response = await fetch(BREVO_ENDPOINT, {
    method: 'POST',
    headers: {
      'accept': 'application/json',
      'api-key': apiKey,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      sender: SENDER,
      to: [{ email: payload.email, name: `${payload.prenom} ${payload.nom}` }],
      replyTo: SENDER,
      subject: 'Votre demande Eleven Lease a bien été reçue',
      htmlContent: emailHtml(payload),
      textContent: emailText(payload),
      tags: ['simulation-confirmation'],
      headers: {
        'X-Mailin-custom': `submission_id:${payload.submissionId}`,
        'Idempotency-Key': payload.submissionId,
      },
    }),
    signal: AbortSignal.timeout(15_000),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    throw new Error(`Brevo HTTP ${response.status}`)
  }
  return typeof data.messageId === 'string' ? data.messageId : ''
}

async function hashIp(ip: string, secret: string) {
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(ip))
  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders(req) })
  }
  if (req.method !== 'POST') return json(req, { error: 'Méthode non autorisée' }, 405)

  const origin = req.headers.get('origin') || ''
  if (!ALLOWED_ORIGINS.has(origin)) return json(req, { error: 'Origine non autorisée' }, 403)

  const contentLength = Number(req.headers.get('content-length') || 0)
  if (contentLength > 24_000) return json(req, { error: 'Requête trop volumineuse' }, 413)

  try {
    const body = await req.json()
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      return json(req, { error: 'Corps de requête invalide' }, 400)
    }

    const payload = normalizePayload(body as Record<string, unknown>)

    // Champ invisible rempli par les robots : réponse neutre sans enregistrer
    // de lead ni consommer un crédit email.
    if (payload.website) return json(req, { ok: true })

    const elapsed = Date.now() - payload.formStartedAt
    if (elapsed < 2_000 || elapsed > 24 * 60 * 60 * 1000) {
      return json(req, { error: 'Session du formulaire expirée' }, 400)
    }

    const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const supabase = createClient(Deno.env.get('SUPABASE_URL')!, serviceRoleKey)

    const { data: existingData, error: existingError } = await supabase
      .from('leads')
      .select('id, submission_id, confirmation_email_status, email')
      .eq('submission_id', payload.submissionId)
      .maybeSingle()
    if (existingError) throw existingError
    const existing = existingData as StoredLead | null

    if (existing?.confirmation_email_status === 'sent') {
      return json(req, { ok: true, duplicate: true, emailSent: true })
    }
    if (existing && existing.email !== payload.email) {
      return json(req, { error: 'Soumission invalide' }, 409)
    }

    if (!existing) {
      const forwardedFor = req.headers.get('x-forwarded-for')?.split(',')[0]?.trim()
      if (forwardedFor) {
        const ipHash = await hashIp(forwardedFor, serviceRoleKey)
        const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS).toISOString()
        const { count, error: countError } = await supabase
          .from('simulation_submission_attempts')
          .select('id', { count: 'exact', head: true })
          .eq('ip_hash', ipHash)
          .gte('created_at', windowStart)
        if (countError) throw countError
        if ((count || 0) >= RATE_LIMIT_MAX) {
          return json(req, { error: 'Trop de demandes. Merci de réessayer dans quelques minutes.' }, 429)
        }
        const { error: rateError } = await supabase
          .from('simulation_submission_attempts')
          .insert({ ip_hash: ipHash })
        if (rateError) throw rateError
      }
    }

    let leadId = existing?.id
    let newlyCreated = false
    if (!existing) {
      const { data: inserted, error: insertError } = await supabase
        .from('leads')
        .insert(toDatabaseRow(payload))
        .select('id')
        .single()
      if (insertError) {
        if (insertError.code === '23505') {
          return json(req, { ok: true, duplicate: true, emailSent: false }, 202)
        }
        throw insertError
      }
      leadId = inserted.id
      newlyCreated = true
    }

    const emailResult = await sendBrevoConfirmation(payload)
      .then((messageId) => ({ status: 'sent' as const, messageId, error: '' }))
      .catch((error) => ({
        status: 'failed' as const,
        messageId: '',
        error: error instanceof Error ? error.message : 'Erreur Brevo',
      }))

    const { error: updateError } = await supabase
      .from('leads')
      .update({
        confirmation_email_status: emailResult.status,
        confirmation_email_id: emailResult.messageId || null,
        confirmation_email_sent_at:
          emailResult.status === 'sent' ? new Date().toISOString() : null,
        confirmation_email_error: emailResult.error || null,
      })
      .eq('id', leadId)
    if (updateError) console.error('Suivi email non enregistré', updateError)

    // Conservation du Sheet et de la notification admin historiques. Une
    // relance idempotente n'ajoute jamais une deuxième ligne au classeur.
    if (newlyCreated) {
      const evaluation = computeEligibility(payload)
      await fetch(GOOGLE_LEADS_SCRIPT_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body: JSON.stringify({
            ...payload,
            eligible: evaluation.eligible,
            criteresRisque: evaluation.criteresRisque,
          }),
          signal: AbortSignal.timeout(10_000),
        })
        .then((response) => {
          if (!response.ok) throw new Error(`Google Apps Script HTTP ${response.status}`)
        })
        .catch((error) => console.error('Google Apps Script indisponible', error))
    }

    return json(
      req,
      {
        ok: true,
        emailSent: emailResult.status === 'sent',
        emailStatus: emailResult.status,
      },
      newlyCreated ? 201 : 200,
    )
  } catch (error) {
    console.error('Erreur submit-simulation', error)
    const message = error instanceof Error ? error.message : 'Erreur inattendue'
    const clientError = /manquant|invalide|incomplètes|trop long/.test(message)
    return json(
      req,
      { error: clientError ? message : 'Impossible d’enregistrer la demande' },
      clientError ? 400 : 500,
    )
  }
})
