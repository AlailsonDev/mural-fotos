export default function NotFound() {
  return (
    <main className="grid min-h-dvh place-items-center bg-[#0b0b12] p-6 text-center text-white">
      <div>
        <p className="text-6xl font-extrabold brand-text">404</p>
        <p className="mt-3 text-white/70">Página não encontrada.</p>
        <a href="/" className="mt-6 inline-block rounded-xl bg-white/10 px-5 py-2.5 font-semibold hover:bg-white/20">Enviar fotos</a>
      </div>
    </main>
  );
}
