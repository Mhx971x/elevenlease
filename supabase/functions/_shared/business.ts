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
  roleDisclosure: "ELEVEN LEASE réalise un pré-check commercial et met le client en relation avec ses partenaires. ELEVEN LEASE n’accorde aucun financement et ne garantit aucune acceptation. L’étude définitive et la décision appartiennent exclusivement au partenaire sollicité.",
} as const

export const EMAIL_SENDER = { name: BUSINESS.tradeName, email: BUSINESS.email }

export function emailLegalFooter() {
  return `${BUSINESS.tradeName} · ${BUSINESS.legalIdentity} · SIREN ${BUSINESS.siren} · ${BUSINESS.addressLine1}, ${BUSINESS.postalCode} ${BUSINESS.city}`
}
