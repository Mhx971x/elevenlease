// Eleven Lease - facturation clients privee.
// Authentification identique aux autres fonctions admin, avec acces reserve
// au role administrateur. Les partenaires ne peuvent ni consulter ni emettre
// de factures.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { authenticate } from '../_shared/auth.ts'
import { BUSINESS } from '../_shared/business.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SETTINGS_FIELDS = [
  'business_name', 'legal_status', 'address_line1', 'address_line2', 'postal_code',
  'city', 'country', 'siren', 'registration_number', 'rcs', 'vat_mode', 'vat_number',
  'default_vat_rate', 'email', 'phone', 'iban', 'bic', 'payment_terms_days',
] as const

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json; charset=utf-8' },
  })
}

function cleanText(value: unknown) {
  return typeof value === 'string' ? value.trim() : ''
}

function money(value: unknown) {
  if (value == null || String(value).trim() === '') return NaN
  const parsed = Number(value)
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : NaN
}

function dateValue(value: unknown, fallback = new Date().toISOString().slice(0, 10)) {
  const text = cleanText(value)
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : fallback
}

function validateSettings(settings: Record<string, unknown>) {
  const missing: string[] = []
  if (!cleanText(settings.business_name)) missing.push('raison sociale')
  if (!cleanText(settings.address_line1)) missing.push('adresse')
  if (!cleanText(settings.postal_code)) missing.push('code postal')
  if (!cleanText(settings.city)) missing.push('ville')
  if (!cleanText(settings.siren)) missing.push('SIREN')
  if (!cleanText(settings.registration_number)) missing.push('SIRET')
  if (!['standard', 'exempt'].includes(cleanText(settings.vat_mode))) missing.push('régime de TVA')
  if (settings.vat_mode === 'standard' && !cleanText(settings.vat_number)) missing.push('numéro de TVA')
  if (settings.default_vat_rate == null || !Number.isFinite(Number(settings.default_vat_rate))) missing.push('taux de TVA')
  if (missing.length) throw new Error(`Paramètres de facturation incomplets : ${missing.join(', ')}`)
}

function issuerSnapshot(settings: Record<string, unknown>) {
  const snapshot: Record<string, unknown> = {}
  for (const field of SETTINGS_FIELDS) snapshot[field] = settings[field] ?? null
  return snapshot
}

function normalizedInvoice(body: Record<string, unknown>, settings: Record<string, unknown>) {
  const quantity = money(body.quantity || 1)
  const unitPrice = money(body.unitPriceHt)
  const requestedVat = money(body.vatRate)
  const vatRate = settings.vat_mode === 'exempt' ? 0 : requestedVat
  if (!Number.isFinite(quantity) || quantity <= 0) throw new Error('La quantité doit être supérieure à zéro')
  if (!Number.isFinite(unitPrice) || unitPrice <= 0) throw new Error('Le montant HT doit être supérieur à zéro')
  if (!Number.isFinite(vatRate) || vatRate < 0 || vatRate > 100) throw new Error('Le taux de TVA est invalide')

  const totalHt = money(quantity * unitPrice)
  const vatAmount = money(totalHt * vatRate / 100)
  const totalTtc = money(totalHt + vatAmount)
  return {
    lead_id: cleanText(body.leadId) || null,
    issue_date: dateValue(body.issueDate),
    service_date: dateValue(body.serviceDate),
    due_date: dateValue(body.dueDate),
    customer_name: cleanText(body.customerName),
    customer_email: cleanText(body.customerEmail) || null,
    customer_address_line1: cleanText(body.customerAddressLine1) || null,
    customer_address_line2: cleanText(body.customerAddressLine2) || null,
    customer_postal_code: cleanText(body.customerPostalCode) || null,
    customer_city: cleanText(body.customerCity) || null,
    customer_country: cleanText(body.customerCountry) || 'France',
    service_label: cleanText(body.serviceLabel),
    quantity,
    unit_price_ht: unitPrice,
    vat_rate: vatRate,
    total_ht: totalHt,
    vat_amount: vatAmount,
    total_ttc: totalTtc,
    payment_method: cleanText(body.paymentMethod) || null,
    notes: cleanText(body.notes) || null,
    issuer_snapshot: issuerSnapshot(settings),
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders })
  if (request.method !== 'POST') return json({ error: 'Méthode non autorisée' }, 405)

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    if (!supabaseUrl || !serviceKey) return json({ error: 'Configuration serveur incomplète' }, 500)

    const body = await request.json().catch(() => ({})) as Record<string, unknown>
    const supabase = createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
    const role = await authenticate(supabase, body)
    if (!role) return json({ error: 'Identifiants incorrects' }, 401)
    if (role !== 'admin') return json({ error: 'Facturation réservée à l’administrateur' }, 403)

    const action = cleanText(body.action) || 'list'

    if (action === 'settings') {
      const { data, error } = await supabase.from('invoice_settings').select('*').eq('id', 1).single()
      if (error) throw error
      return json({ settings: data })
    }

    if (action === 'save-settings') {
      const raw = (body.settings || {}) as Record<string, unknown>
      const values: Record<string, unknown> = { id: 1, updated_at: new Date().toISOString() }
      for (const field of SETTINGS_FIELDS) {
        if (field === 'default_vat_rate') {
          const rate = money(raw[field])
          values[field] = Number.isFinite(rate) && rate >= 0 ? rate : null
        } else if (field === 'payment_terms_days') {
          const days = Math.max(0, Math.min(120, Math.round(Number(raw[field]) || 0)))
          values[field] = days
        } else {
          values[field] = cleanText(raw[field]) || null
        }
      }
      values.business_name = values.business_name || BUSINESS.tradeName
      values.legal_status = values.legal_status || BUSINESS.legalIdentity
      values.address_line1 = values.address_line1 || BUSINESS.addressLine1
      values.postal_code = values.postal_code || BUSINESS.postalCode
      values.city = values.city || BUSINESS.city
      values.country = values.country || BUSINESS.country
      values.siren = values.siren || BUSINESS.siren
      values.registration_number = values.registration_number || BUSINESS.siret
      values.email = values.email || BUSINESS.email
      if (!['standard', 'exempt'].includes(String(values.vat_mode || ''))) values.vat_mode = null
      if (values.vat_mode === 'exempt') values.default_vat_rate = 0
      if (values.vat_mode === 'standard' && (values.default_vat_rate == null || !Number.isFinite(Number(values.default_vat_rate)))) {
        throw new Error('Le taux de TVA doit être confirmé')
      }

      const { data, error } = await supabase.from('invoice_settings').upsert(values).select().single()
      if (error) throw error
      return json({ settings: data })
    }

    const { data: settings, error: settingsError } = await supabase
      .from('invoice_settings').select('*').eq('id', 1).single()
    if (settingsError) throw settingsError

    if (action === 'save-draft') {
      const payload = normalizedInvoice(body, settings)
      if (!payload.customer_name) throw new Error('Le nom du client est obligatoire pour un brouillon')
      if (!payload.service_label) throw new Error('La prestation est obligatoire pour un brouillon')
      const draftId = cleanText(body.draftId)
      if (draftId) {
        const { data, error } = await supabase.from('invoices')
          .update({ ...payload, updated_at: new Date().toISOString() })
          .eq('id', draftId).eq('status', 'draft').eq('document_type', 'invoice')
          .select().single()
        if (error) throw error
        return json({ invoice: data })
      }
      const { data, error } = await supabase.from('invoices')
        .insert({ ...payload, document_type: 'invoice', status: 'draft' })
        .select().single()
      if (error) throw error
      return json({ invoice: data })
    }

    if (action === 'issue') {
      validateSettings(settings)
      const payload = normalizedInvoice(body, settings)
      if (!payload.customer_name || !payload.customer_address_line1 || !payload.customer_postal_code || !payload.customer_city) {
        throw new Error('Le nom et l’adresse complète du client sont obligatoires')
      }
      if (!payload.service_label) throw new Error('La prestation est obligatoire')
      const { data, error } = await supabase.rpc('issue_client_invoice', {
        payload,
        draft_id: cleanText(body.draftId) || null,
      })
      if (error) throw error
      return json({ invoice: data })
    }

    if (action === 'mark-paid') {
      const id = cleanText(body.id)
      const { data, error } = await supabase.from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString(), updated_at: new Date().toISOString() })
        .eq('id', id).eq('document_type', 'invoice').eq('status', 'issued')
        .select().single()
      if (error) throw error
      return json({ invoice: data })
    }

    if (action === 'credit') {
      const { data, error } = await supabase.rpc('create_invoice_credit', {
        source_invoice_id: cleanText(body.id),
        credit_date: dateValue(body.creditDate),
      })
      if (error) throw error
      return json({ invoice: data })
    }

    if (action === 'list') {
      const { data, error } = await supabase.from('invoices')
        .select('*').order('created_at', { ascending: false }).limit(250)
      if (error) throw error
      return json({ invoices: data || [], settings })
    }

    return json({ error: 'Action inconnue' }, 400)
  } catch (error) {
    console.error('admin-invoices', error)
    const message = error instanceof Error ? error.message : 'Erreur de facturation'
    return json({ error: message }, 400)
  }
})
