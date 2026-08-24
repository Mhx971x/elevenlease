export const BUSINESS = {
  tradeName: 'ELEVEN LEASE',
  operatorName: 'DJAFFAR Mehdi',
  legalIdentity: 'DJAFFAR Mehdi – Entrepreneur individuel / micro-entreprise',
  legalStatus: 'Entrepreneur individuel / micro-entreprise',
  siren: '931 287 908',
  siret: '931 287 908 00020',
  addressLine1: '60 rue François 1er',
  postalCode: '75008',
  city: 'Paris',
  country: 'France',
  email: 'contact@elevenlease.fr',
  siteUrl: 'https://elevenlease.fr',
  activity: "Accompagnement commercial, qualification des besoins clients, mise en relation et apport d’affaires dans le secteur automobile.",
  vatMode: 'exempt',
  vatRate: 0,
  vatInvoiceNotice: 'TVA non applicable, art. 293 B du CGI',
  roleDisclosure: "ELEVEN LEASE réalise un pré-check commercial et met le client en relation avec ses partenaires. ELEVEN LEASE n’accorde aucun financement et ne garantit aucune acceptation. L’étude définitive et la décision appartiennent exclusivement au partenaire sollicité.",
  serviceFeeDisclosure: "La demande en ligne et le pré-check commercial initial sont gratuits. Si un dossier est lancé, le contenu et le prix de la prestation ELEVEN LEASE sont communiqués par écrit au client et acceptés avant le début de la prestation payante. Les honoraires ne deviennent exigibles qu’après l’acceptation définitive du dossier par le partenaire et la réception effective du véhicule par le client.",
} as const

export const EMAIL_SENDER = { name: BUSINESS.tradeName, email: BUSINESS.email }

export function emailLegalFooter() {
  return `${BUSINESS.tradeName} · ${BUSINESS.legalIdentity} · SIREN ${BUSINESS.siren} · ${BUSINESS.addressLine1}, ${BUSINESS.postalCode} ${BUSINESS.city}`
}
