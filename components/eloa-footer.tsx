export function EloaFooter() {
  return (
    <footer className="mt-10 bg-[#093e29] text-[#fffaf1]">
      <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 sm:px-8 md:grid-cols-[1.35fr_1fr_1fr] md:py-12">
        <section aria-label="Eloá">
          <div className="flex items-center gap-3">
            <img
              src="/eloa-logo-marca-invertida.png"
              alt="Símbolo da Eloá"
              className="h-14 w-12 object-contain"
            />
            <div>
              <p className="font-serif text-3xl leading-none">Eloá</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.19em] text-[#c9dec9]">
                Sua assistente financeira
              </p>
            </div>
          </div>
          <p className="mt-5 max-w-sm text-sm leading-6 text-[#d8e7d6]">
            Suas compras, seu limite, suas escolhas.
          </p>
        </section>

        <section aria-labelledby="footer-contato">
          <h2 id="footer-contato" className="text-sm font-semibold text-[#fffaf1]">
            Fale com a Eloá
          </h2>
          <div className="mt-4 space-y-2 text-sm text-[#d8e7d6]">
            <a
              href="https://wa.me/5588994505719"
              className="block transition hover:text-white hover:underline"
            >
              WhatsApp: +55 (88) 99450-5719
            </a>
            <a
              href="mailto:charles22bolsonaro@gmail.com"
              className="block break-all transition hover:text-white hover:underline"
            >
              charles22bolsonaro@gmail.com
            </a>
          </div>
        </section>

        <section aria-labelledby="footer-sobre">
          <h2 id="footer-sobre" className="text-sm font-semibold text-[#fffaf1]">
            Conheça a Eloá
          </h2>
          <a
            href="#sobre-nos"
            className="mt-4 inline-flex text-sm font-semibold text-[#c9dec9] transition hover:text-white hover:underline"
          >
            Sobre nós
          </a>
          <p className="mt-2 text-sm leading-6 text-[#d8e7d6]">
            Saiba mais sobre a assistente e a proposta da Eloá.
          </p>
        </section>
      </div>

      <section
        id="sobre-nos"
        className="border-t border-[#b8d0b6]/30 bg-[#073521]"
        aria-labelledby="sobre-nos-titulo"
      >
        <div className="mx-auto max-w-7xl px-5 py-8 sm:px-8">
          <h2 id="sobre-nos-titulo" className="font-serif text-2xl text-[#fffaf1]">
            Sobre nós
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-[#d8e7d6]">
            Este espaço está reservado para apresentar a história e os valores da Eloá.
          </p>
        </div>
      </section>

      <div className="border-t border-[#b8d0b6]/20 px-5 py-4 text-center text-xs text-[#b8d0b6] sm:px-8">
        Eloá · Sua Assistente Financeira
      </div>
    </footer>
  );
}
