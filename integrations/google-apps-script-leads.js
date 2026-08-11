// Code à déployer dans le Google Apps Script relié au classeur Eleven Lease.
// Les colonnes existantes sont conservées et les nouvelles sont ajoutées
// automatiquement à droite, ce qui évite de casser l'historique du Sheet.

const ADMIN_EMAIL = 'admin@elevenlease.fr';

const LEAD_HEADERS = [
  'Date', 'Vehicule', 'ModeRecherche', 'Prenom', 'Nom', 'Telephone', 'Email',
  'Profil', 'Entreprise', 'StatutJuridique', 'SIREN', 'Financement',
  'Carrosserie', 'Motorisation', 'BudgetSouhaite', 'NeufOccasion',
  'KilometrageAnnuel', 'DureeContrat', 'Apport', 'DateLivraison', 'VehiculeReprise',
  'VehiculeRepriseDetails', 'StatutPro', 'Revenus', 'Charges', 'Anciennete',
  'ChiffreAffaires', 'AncienneteEntreprise', 'Age', 'FICP', 'Eligible',
  'CriteresRisque', 'ConsentementRecontact', 'Message'
];

function ensureHeaders(sheet, requiredHeaders) {
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(requiredHeaders);
    return requiredHeaders;
  }
  const existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  const missing = requiredHeaders.filter(function (header) {
    return existing.indexOf(header) === -1;
  });
  if (missing.length) {
    sheet.getRange(1, existing.length + 1, 1, missing.length).setValues([missing]);
  }
  return existing.concat(missing);
}

function appendMappedRow(sheet, requiredHeaders, valuesByHeader) {
  const headers = ensureHeaders(sheet, requiredHeaders);
  sheet.appendRow(headers.map(function (header) {
    return Object.prototype.hasOwnProperty.call(valuesByHeader, header)
      ? valuesByHeader[header]
      : '';
  }));
}

function doPost(e) {
  const data = JSON.parse(e.postData.contents);
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();

  if (data.formType === 'contact') {
    let contacts = spreadsheet.getSheetByName('Contacts');
    if (!contacts) contacts = spreadsheet.insertSheet('Contacts');
    appendMappedRow(contacts, ['Date', 'Nom', 'Email', 'Telephone', 'Message'], {
      Date: new Date(),
      Nom: data.nom || '',
      Email: data.email || '',
      Telephone: data.telephone || '',
      Message: data.message || ''
    });
    MailApp.sendEmail({
      to: ADMIN_EMAIL,
      subject: 'Nouveau message Eleven Lease : ' + (data.nom || 'Sans nom'),
      body: [
        'Nom : ' + (data.nom || '-'),
        'Email : ' + (data.email || '-'),
        'Téléphone : ' + (data.telephone || '-'),
        'Message : ' + (data.message || '-'),
        '',
        'Voir le classeur : ' + spreadsheet.getUrl()
      ].join('\n')
    });
    return jsonOk();
  }

  let leads = spreadsheet.getSheetByName('Leads');
  if (!leads) leads = spreadsheet.getActiveSheet();
  appendMappedRow(leads, LEAD_HEADERS, {
    Date: new Date(),
    Vehicule: data.vehicule || '',
    ModeRecherche: data.rechercheVehicule || '',
    Prenom: data.prenom || '',
    Nom: data.nom || '',
    Telephone: data.telephone || '',
    Email: data.email || '',
    Profil: data.profil || '',
    Entreprise: data.entreprise || '',
    StatutJuridique: data.statutJuridique || '',
    SIREN: data.siren || '',
    Financement: data.financement || '',
    Carrosserie: data.typeVehiculeSouhaite || '',
    Motorisation: data.motorisation || '',
    BudgetSouhaite: data.budgetSouhaite || '',
    NeufOccasion: data.neufOccasion || '',
    KilometrageAnnuel: data.kilometrageAnnuel || '',
    DureeContrat: data.dureeContrat || '',
    Apport: data.apport || '',
    DateLivraison: data.dateLivraison || '',
    VehiculeReprise: data.vehiculeReprise || '',
    VehiculeRepriseDetails: data.vehiculeRepriseDetails || '',
    StatutPro: data.statutPro || '',
    Revenus: data.revenus || '',
    Charges: data.charges || '',
    Anciennete: data.anciennete || '',
    ChiffreAffaires: data.chiffreAffaires || '',
    AncienneteEntreprise: data.ancienneteEntreprise || '',
    Age: data.age || '',
    FICP: data.ficp || '',
    Eligible: data.eligible || '',
    CriteresRisque: data.criteresRisque || '',
    ConsentementRecontact: data.consentRecontact === true ? 'Oui' : 'Non',
    Message: data.message || ''
  });

  MailApp.sendEmail({
    to: ADMIN_EMAIL,
    subject: 'Nouveau lead Eleven Lease — ' + (data.prenom || '') + ' ' + (data.nom || ''),
    body: [
      'Éligibilité estimée : ' + (data.eligible || '-'),
      data.criteresRisque ? 'Points à étudier : ' + data.criteresRisque : '',
      '',
      'Client : ' + [data.prenom, data.nom].filter(Boolean).join(' '),
      'Téléphone : ' + (data.telephone || '-'),
      'Email : ' + (data.email || '-'),
      'Profil : ' + (data.profil || '-'),
      data.entreprise ? 'Entreprise : ' + data.entreprise : '',
      '',
      'Recherche : ' + (data.rechercheVehicule || '-'),
      'Véhicule : ' + (data.vehicule || data.typeVehiculeSouhaite || '-'),
      'Motorisation : ' + (data.motorisation || '-'),
      'Financement : ' + (data.financement || '-'),
      'Budget : ' + (data.budgetSouhaite || '-'),
      'Livraison : ' + (data.dateLivraison || '-'),
      '',
      'Voir toutes les demandes : ' + spreadsheet.getUrl()
    ].filter(Boolean).join('\n')
  });

  return jsonOk();
}

function jsonOk() {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
