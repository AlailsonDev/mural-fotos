import type { Metadata } from 'next';
import AdminApp from '@/components/admin/AdminApp';

export const metadata: Metadata = { title: 'Administração – Mural de Fotos' };

export default function AdminPage() {
  return <AdminApp />;
}
