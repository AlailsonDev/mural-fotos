import type { Metadata } from 'next';
import QrPrint from '@/components/admin/QrPrint';

export const metadata: Metadata = { title: 'QR Code para impressão – Mural de Fotos' };

export default function QrPrintPage() {
  return <QrPrint />;
}
