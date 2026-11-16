import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // O servidor customizado (server/index.ts) cuida das rotas de API, uploads e Socket.IO.
  // Estes pacotes nunca devem ir para o bundle do navegador.
  serverExternalPackages: ['sharp'],
  eslint: { ignoreDuringBuilds: true },
  devIndicators: false,
};

export default nextConfig;
