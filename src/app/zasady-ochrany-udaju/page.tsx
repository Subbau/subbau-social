export const metadata = { title: "Zásady ochrany osobních údajů — SubBau Social Manager" };

const AKTUALIZACE = "13. 10. 2026";

export default function ZasadyOchranyUdaju() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-10 text-slate-800">
      <h1 className="mb-1 text-2xl font-semibold">Zásady ochrany osobních údajů</h1>
      <p className="mb-8 text-sm text-slate-500">
        Aplikace SubBau Social Manager · poslední aktualizace {AKTUALIZACE}
      </p>

      <Oddil nadpis="Kdo údaje zpracovává">
        <p>
          Správcem je SubBau s.r.o., IČO 23549190, Plzeňská 3352/156, 150 00 Praha 5.
          Kontakt: <a className="underline" href="mailto:info@subbau.cz">info@subbau.cz</a>.
        </p>
      </Oddil>

      <Oddil nadpis="K čemu aplikace slouží">
        <p>
          SubBau Social Manager je interní nástroj společnosti SubBau. Slouží k plánování a
          zveřejňování příspěvků na vlastních facebookových stránkách a instagramovém účtu firmy.
          Aplikaci nepoužívá veřejnost a nepřihlašují se do ní uživatelé Facebooku ani Instagramu.
        </p>
      </Oddil>

      <Oddil nadpis="Jaké údaje zpracováváme">
        <ul className="list-disc space-y-1 pl-5">
          <li>přihlašovací e-mail a jméno pracovníka SubBau, který aplikaci používá;</li>
          <li>texty, obrázky a videa připravených příspěvků a časy jejich zveřejnění;</li>
          <li>
            údaje o firemních stránkách a účtu z Meta (ID, název, profilový obrázek, odkazy na
            zveřejněné příspěvky, stav limitu zveřejňování);
          </li>
          <li>přístupový klíč k Meta, uložený šifrovaně a dostupný jen serveru aplikace.</li>
        </ul>
        <p className="mt-2">
          Aplikace nezpracovává údaje o fanoušcích ani sledujících, nečte komentáře, zprávy ani
          statistiky jednotlivých lidí.
        </p>
      </Oddil>

      <Oddil nadpis="Proč a na jakém základě">
        <p>
          Údaje zpracováváme z oprávněného zájmu správce na správě vlastní komunikace na
          sociálních sítích (čl. 6 odst. 1 písm. f GDPR).
        </p>
      </Oddil>

      <Oddil nadpis="Kde jsou údaje uložené">
        <p>
          Databáze a soubory jsou u Supabase v datovém centru v EU (Irsko), aplikace běží na
          hostingu Vercel. Příspěvky se odesílají společnosti Meta Platforms Ireland Ltd.
          prostřednictvím jejího oficiálního rozhraní. Údaje neprodáváme ani nepředáváme dalším
          stranám.
        </p>
      </Oddil>

      <Oddil nadpis="Jak dlouho">
        <p>
          Po dobu používání aplikace. Záznamy o pokusech o zveřejnění a historii změn mažeme,
          jakmile přestanou být potřeba, nejpozději na žádost.
        </p>
      </Oddil>

      <Oddil nadpis="Vaše práva">
        <p>
          Máte právo na přístup k údajům, jejich opravu, výmaz, omezení zpracování a vznést
          námitku. Stížnost můžete podat u Úřadu pro ochranu osobních údajů (uoou.gov.cz).
        </p>
      </Oddil>

      <Oddil nadpis="Smazání údajů" id="smazani">
        <p>
          O smazání údajů požádejte e-mailem na{" "}
          <a className="underline" href="mailto:info@subbau.cz?subject=Smaz%C3%A1n%C3%AD%20dat%20%E2%80%93%20SubBau%20Social">
            info@subbau.cz
          </a>{" "}
          s předmětem „Smazání dat – SubBau Social“. Údaje smažeme do 30 dnů a potvrdíme vám to.
          Přístup aplikace k firemním stránkám lze kdykoli odebrat v Meta Business Suite
          (Nastavení firmy → Aplikace).
        </p>
      </Oddil>

      <Oddil nadpis="In English" id="en">
        <p className="text-sm">
          SubBau Social Manager is an internal tool of SubBau s.r.o. (Plzeňská 3352/156, 150 00
          Prague 5, Czech Republic) used only by its staff to schedule and publish posts on the
          company&apos;s own Facebook Pages and Instagram account. It stores the staff login e-mail,
          post content and basic Page data (ID, name, picture, links to published posts). It does
          not process data of followers or other Facebook users. Data is stored in the EU and is
          not sold or shared. To request deletion of your data, e-mail{" "}
          <a className="underline" href="mailto:info@subbau.cz">info@subbau.cz</a>; we delete it
          within 30 days.
        </p>
      </Oddil>
    </main>
  );
}

function Oddil({ nadpis, id, children }: { nadpis: string; id?: string; children: React.ReactNode }) {
  return (
    <section id={id} className="mb-6">
      <h2 className="mb-2 text-lg font-semibold">{nadpis}</h2>
      <div className="space-y-2 leading-relaxed">{children}</div>
    </section>
  );
}
