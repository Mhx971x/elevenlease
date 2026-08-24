import { jsPDF } from 'jspdf';
import { LEGAL } from '../config/legal';

export interface InvoicePdfData {
  id: string;
  document_type: 'invoice' | 'credit_note';
  invoice_number: string;
  status: 'issued' | 'paid' | 'credited';
  issue_date: string;
  service_date?: string | null;
  due_date?: string | null;
  customer_name: string;
  customer_email?: string | null;
  customer_address_line1?: string | null;
  customer_address_line2?: string | null;
  customer_postal_code?: string | null;
  customer_city?: string | null;
  customer_country?: string | null;
  service_label: string;
  quantity: number;
  unit_price_ht: number;
  vat_rate: number;
  total_ht: number;
  vat_amount: number;
  total_ttc: number;
  payment_method?: string | null;
  notes?: string | null;
  issuer_snapshot: Record<string, unknown>;
}

const PINK: [number, number, number] = [255, 0, 127];
const BLACK: [number, number, number] = [17, 17, 19];
const GREY: [number, number, number] = [92, 92, 101];
const LIGHT: [number, number, number] = [246, 246, 247];
const BORDER: [number, number, number] = [226, 226, 230];

function text(value: unknown) {
  return value == null ? '' : String(value).trim();
}

function formatDate(value?: string | null) {
  if (!value) return '-';
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString('fr-FR');
}

function formatMoney(value: number) {
  return `${Number(value || 0).toLocaleString('fr-FR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} EUR`;
}

function paymentLabel(value?: string | null) {
  const labels: Record<string, string> = {
    virement: 'Virement bancaire',
    carte: 'Carte bancaire',
    especes: 'Espèces',
    cheque: 'Chèque',
    autre: 'Autre',
  };
  return labels[value || ''] || text(value) || 'À convenir';
}

async function loadLogoDataUrl() {
  try {
    const response = await fetch('/eleven-lease-logo.png');
    if (!response.ok) return null;
    const blob = await response.blob();
    return await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

function addressLines(source: Record<string, unknown>, prefix = '') {
  const line1 = text(source[`${prefix}address_line1`]);
  const line2 = text(source[`${prefix}address_line2`]);
  const city = [text(source[`${prefix}postal_code`]), text(source[`${prefix}city`])].filter(Boolean).join(' ');
  const country = text(source[`${prefix}country`]);
  return [line1, line2, city, country].filter(Boolean);
}

export async function createInvoicePdf(invoice: InvoicePdfData, options: { logoDataUrl?: string } = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'a4', compress: true });
  const issuer = invoice.issuer_snapshot || {};
  const isCredit = invoice.document_type === 'credit_note';
  const title = isCredit ? 'AVOIR' : 'FACTURE';

  doc.setProperties({
    title: `${title} ${invoice.invoice_number}`,
    subject: invoice.service_label,
    author: text(issuer.business_name) || 'Eleven Lease',
    creator: 'Eleven Lease - Espace admin',
  });

  doc.setFillColor(...BLACK);
  doc.rect(0, 0, 210, 33, 'F');
  doc.setFillColor(...PINK);
  doc.rect(0, 33, 210, 2.2, 'F');

  const logo = options.logoDataUrl || await loadLogoDataUrl();
  if (logo) {
    try { doc.addImage(logo, 'PNG', 16, 7, 43, 19, undefined, 'FAST'); } catch { /* texte de secours ci-dessous */ }
  }
  if (!logo) {
    doc.setTextColor(255, 255, 255);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(18);
    doc.text('ELEVEN LEASE', 16, 20);
  }

  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(20);
  doc.text(title, 194, 16, { align: 'right' });
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.5);
  doc.text(invoice.invoice_number, 194, 23, { align: 'right' });

  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('ÉMETTEUR', 16, 48);
  doc.text('FACTURÉ À', 111, 48);

  doc.setFont('helvetica', 'bold');
  doc.setFontSize(11.5);
  doc.text(text(issuer.business_name) || 'Eleven Lease', 16, 55);
  doc.text(invoice.customer_name, 111, 55);

  doc.setFont('helvetica', 'normal');
  doc.setFontSize(8.7);
  doc.setTextColor(...GREY);
  const issuerLines = [
    text(issuer.legal_status),
    ...addressLines(issuer),
    text(issuer.siren) ? `SIREN ${text(issuer.siren)}` : '',
    text(issuer.registration_number) ? `SIRET ${text(issuer.registration_number)}` : '',
    text(issuer.rcs) ? `RCS ${text(issuer.rcs)}` : '',
    text(issuer.vat_number) ? `TVA ${text(issuer.vat_number)}` : '',
    text(issuer.email),
  ].filter(Boolean);
  issuerLines.slice(0, 8).forEach((line, index) => doc.text(line, 16, 61 + index * 3.35));

  const customerLines = [
    invoice.customer_address_line1,
    invoice.customer_address_line2,
    [invoice.customer_postal_code, invoice.customer_city].filter(Boolean).join(' '),
    invoice.customer_country,
    invoice.customer_email,
  ].filter(Boolean) as string[];
  customerLines.slice(0, 6).forEach((line, index) => doc.text(line, 111, 61 + index * 4.2));

  doc.setDrawColor(...BORDER);
  doc.line(16, 86, 194, 86);
  doc.setTextColor(...GREY);
  doc.setFontSize(8);
  doc.text('Date d’émission', 16, 92);
  doc.text('Date de prestation', 72, 92);
  doc.text('Échéance', 132, 92);
  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  doc.text(formatDate(invoice.issue_date), 16, 98);
  doc.text(formatDate(invoice.service_date), 72, 98);
  doc.text(formatDate(invoice.due_date), 132, 98);

  doc.setFillColor(...LIGHT);
  doc.roundedRect(16, 108, 178, 10, 2, 2, 'F');
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.setTextColor(...GREY);
  doc.text('PRESTATION', 20, 114.5);
  doc.text('QTÉ', 129, 114.5, { align: 'right' });
  doc.text('PU HT', 158, 114.5, { align: 'right' });
  doc.text('TOTAL HT', 190, 114.5, { align: 'right' });

  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(9.2);
  const serviceLines = doc.splitTextToSize(invoice.service_label, 93);
  doc.text(serviceLines.slice(0, 2), 20, 126);
  doc.text(Number(invoice.quantity).toLocaleString('fr-FR'), 129, 126, { align: 'right' });
  doc.text(formatMoney(invoice.unit_price_ht), 158, 126, { align: 'right' });
  doc.text(formatMoney(invoice.total_ht), 190, 126, { align: 'right' });
  doc.setDrawColor(...BORDER);
  doc.line(16, 137, 194, 137);

  const totalsX = 130;
  doc.setFontSize(9);
  doc.setTextColor(...GREY);
  doc.text('Total HT', totalsX, 146);
  doc.text(`TVA ${Number(invoice.vat_rate).toLocaleString('fr-FR')} %`, totalsX, 154);
  doc.setTextColor(...BLACK);
  doc.text(formatMoney(invoice.total_ht), 190, 146, { align: 'right' });
  doc.text(formatMoney(invoice.vat_amount), 190, 154, { align: 'right' });
  doc.setFillColor(...BLACK);
  doc.roundedRect(126, 160, 68, 14, 2, 2, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(10.5);
  doc.text(isCredit ? 'TOTAL AVOIR' : 'TOTAL TTC', 131, 169);
  doc.text(formatMoney(invoice.total_ttc), 190, 169, { align: 'right' });

  if (invoice.status === 'paid' && !isCredit) {
    doc.setDrawColor(...PINK);
    doc.setTextColor(...PINK);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(10);
    doc.roundedRect(16, 145, 45, 13, 2, 2, 'S');
    doc.text('FACTURE ACQUITTÉE', 38.5, 153.3, { align: 'center' });
  }

  doc.setTextColor(...BLACK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9);
  doc.text('RÈGLEMENT', 16, 188);
  doc.setFont('helvetica', 'normal');
  doc.setTextColor(...GREY);
  doc.setFontSize(8.5);
  doc.text(`Mode de paiement : ${paymentLabel(invoice.payment_method)}`, 16, 195);
  if (text(issuer.iban)) doc.text(`IBAN : ${text(issuer.iban)}`, 16, 201);
  if (text(issuer.bic)) doc.text(`BIC : ${text(issuer.bic)}`, 16, 207);

  let detailY = 218;
  if (text(invoice.notes)) {
    doc.setTextColor(...BLACK);
    doc.setFont('helvetica', 'bold');
    doc.text('NOTE', 16, detailY);
    doc.setTextColor(...GREY);
    doc.setFont('helvetica', 'normal');
    const noteLines = doc.splitTextToSize(text(invoice.notes), 178).slice(0, 3);
    doc.text(noteLines, 16, detailY + 6);
    detailY += 6 + noteLines.length * 4;
  }

  doc.setDrawColor(...BORDER);
  doc.line(16, 256, 194, 256);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.4);
  doc.setTextColor(...GREY);
  const vatNotice = text(issuer.vat_mode) === 'exempt'
    ? `${LEGAL.vatInvoiceNotice}. Aucun escompte pour paiement anticipé.`
    : 'Montants exprimés en euros. Aucun escompte pour paiement anticipé.';
  doc.text(vatNotice, 16, 263);
  doc.text(`${text(issuer.business_name) || 'ELEVEN LEASE'} - SIREN ${text(issuer.siren)} - SIRET ${text(issuer.registration_number)}`, 16, 268);
  doc.text('Page 1 / 1', 194, 268, { align: 'right' });
  doc.setTextColor(...PINK);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('elevenlease.fr', 194, 263, { align: 'right' });

  return doc;
}

export async function downloadInvoicePdf(invoice: InvoicePdfData) {
  const doc = await createInvoicePdf(invoice);
  const safeNumber = invoice.invoice_number.replace(/[^A-Za-z0-9-]+/g, '-');
  doc.save(`${safeNumber}-${invoice.customer_name.replace(/[^A-Za-z0-9À-ÿ-]+/g, '-').replace(/-+/g, '-')}.pdf`);
}

export async function invoicePdfBlob(invoice: InvoicePdfData) {
  const doc = await createInvoicePdf(invoice);
  return doc.output('blob');
}
