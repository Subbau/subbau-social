# Rozhodnutí UI (SubBau Social Manager)

Co SPEC neříká přesně, kde si odporuje s tím, co napsal DB agent, a co jsem zvolil.
SPEC.md jsem neměnil.

## Rozpory a nejasnosti SPEC

1. **fingerprint, „≤ 50 MB“** — SPEC píše u hranice „MB“ a u hlavy „MiB“. Beru obojí
   binárně: hranice = 50 × 1024 × 1024 B, hlava = 8 × 1024 × 1024 B
   (`src/lib/fingerprint.ts`). Fingerprint počítá jen UI, takže to stačí sjednotit tady.
   Kdyby DB/Edge někdy fingerprint přepočítávaly, musí použít totéž.
2. **`post_series.generated_until`** — ve SPEC chybí, DB agent ho přidal (0001, 0004).
   V `db-types.ts` je jako volitelný sloupec, UI ho nepoužívá.
3. **Opakování a kontrola duplicit.** Výskyty série kopírují `content_hash` šablony,
   takže podle SPEC by publikační smyčka každý další výskyt odmítla jako
   `duplicate_suspected`. UI proto při založení série nastaví šabloně
   `platform_options.allow_duplicate = true`. DB funkce tuhle hodnotu kopíruje do výskytů.
   DB agent navíc v `pravidla.ts` výskyty téže série z kontroly vyjímá (to ve SPEC není).
   Teď jsou tedy pojistky dvě. Kdyby se jedna odebrala, druhá pořád stačí.
4. **Šablona série nemá `series_id`.** DB funkce ho šabloně nenastavuje a kvůli
   `unique(series_id, scheduled_at)` by se šablona srazila s výskytem ve stejný čas.
   Šablonu poznáme podle `post_series.template_post_id`.
   - **Kalendář:** šablony jsou **skryté**. Jsou to koncepty, které se samy
     nepublikují, a jinak by se v kalendáři zdvojovaly s výskyty. Výskyty mají
     na kartičce ikonu ↻.
   - **Seznam:** šablona má fialový štítek „šablona opakování“ a výskyty ↻.
   - **Editor:** fialový rámeček s popisem opakování a tlačítkem „Ukončit opakování“.
     U výskytu je navíc odkaz „Otevřít šablonu“.
5. **Změna naplánovaného příspěvku** (přechody povoluje trigger) se dělá ve třech krocích
   (podrobněji a s opravami po kontrole viz bod 34).
   Nejdřív `scheduled → draft`, pak obsah a `post_media`, nakonec `draft → scheduled`.
   Publikační smyčka tak nechytne příspěvek napůl uložený, třeba bez médií.
   - U `failed` se obsah mění přímo ve stavu `failed` a pak `failed → scheduled`.
     DB přitom vynuluje `attempt_count`.
   - Každý update má podmínku `eq('status', známý stav)`. Když mezitím začalo
     publikování, uživatel dostane hlášku „Příspěvek se mezitím změnil“.
6. **Přetažení v kalendáři:**
   - jde jen u `draft`, `scheduled` a `failed`;
   - koncept smí jít i do minulosti, naplánovaný příspěvek ani chyba ne;
   - **chyba se přetažením znovu zařadí** (`failed → scheduled`) až po potvrzení,
     u `unknown_outcome` s důrazným varováním.
   - **Týden:** nová hodina, minuty zůstávají. **Měsíc:** nový den, hodina i minuty
     zůstávají. Příspěvek bez času dostane 9:00.
7. **Duplicita při plánování** (aktualizováno, viz bod 42).
   - **Blokuje** jen tehdy, když existuje *zveřejněný* příspěvek téhož účtu se stejným
     hashem a není zaškrtnuté „Opravdu zveřejnit znovu“. Publikační smyčka by ho
     stejně odmítla, takže UI to řekne dřív.
   - Shoda s konceptem nebo naplánovaným příspěvkem je jen žluté varování.
   - Okno 30 dní se počítá podle `published_at`, `scheduled_at` nebo `created_at`.
8. **Zkopírovat týden:**
   - přeskočí šablony i výskyty sérií (série si další výskyty vytvoří sama);
   - je idempotentní: když už existuje kopie se stejným `copied_from_id` a cílovým
     časem, přeskočí ji;
   - **neodnáší `allow_duplicate`**, povolení duplicity se musí potvrdit znovu;
   - drží místní čas i přes změnu letního a zimního času (9:00 zůstane 9:00);
   - kopie z jedné skupiny dostanou novou společnou `group_id`;
   - `content_hash` se zkopíruje, protože účet i obsah jsou stejné.
9. **Duplikovat:**
   - nový koncept s `copied_from_id`;
   - když cílová síť formát nemá (třeba IG karusel → FB), použije se `feed`;
   - `allow_duplicate` se odebere a hash se přepočítá pro cílový účet.
10. **Časová pásma.** Mřížka kalendáře je vždy v Europe/Prague (`APP_TZ`). Editor,
    Seznam a Chyby ukazují čas v pásmu účtu (`social_accounts.timezone`).
    - Neexistující čas při jarním posunu (29. 3. 2026 2:30) se posune na 3:30.
    - Dvojznačný čas při podzimním posunu (25. 10. 2026 2:30) se bere v prvním
      výskytu, tedy ještě letního času.
11. **Mřížka týdne 6–23.** Příspěvky před 6:00 spadnou do prvního řádku, označeného „≤6:00“.
    Kartička ukazuje přesný čas.
12. **Koncepty bez času** v kalendáři nejsou, protože nemají kam padnout. Najdete je
    v Seznamu (zaškrtávátko „i koncepty bez času“, výchozí stav zapnuto).
13. **Počítání znaků:** po znacích (kódových bodech), emoji = 1. Meta to nepopisuje
    přesně. Limit je 2200 (IG) a 63 206 (FB).
14. **Kontroly navíc** proti SPEC, protože by jinak selhaly až u Mety:
    - **IG, blokující:**
      - obrázek musí být JPEG;
      - obrázek nad 8 MB;
      - feed s víc médii (má být karusel);
      - story = právě jedno médium.
    - **IG, varování:** video ve feedu vyjde jako reel; odkaz u IG není klikací.
    - **FB, blokující:** prázdný příspěvek; video spolu s fotkami.
    - Koncept jde uložit vždy. Kontroly blokují jen „Naplánovat“.

## Média

15. **Stejný soubor znovu:** když už v knihovně je soubor se stejným `fingerprint`
    (kdekoli), znovu se nenahrává a použije se existující.
16. **Náhledy** (JPEG, 480 px) se dělají i pro obrázky, ne jen pro videa, aby mřížky
    nestahovaly originály.
    - Cesta náhledu je `thumbs/{account_id|shared}/{yyyy}/{mm}/{uuid}.jpg`.
    - Rok a měsíc v cestě jsou podle pražského času.
17. **Videa jen MP4 a MOV**, stejně jako `allowed_mime_types` bucketu
    v `supabase/setup/01_bucket_media.sql`. `video/x-m4v` se nahraje jako `video/mp4`.
    - HEIC: Chrome ho nepřečte, appka řekne „uložte jako JPEG“. Safari ho převede.
18. **Velké soubory (TUS):**
    - endpoint je přesně podle SPEC: `${URL}/storage/v1/upload/resumable`, kus 6 MB;
    - Supabase doporučuje u velkých souborů přímý host `…storage.supabase.co`, který je
      rychlejší — dá se přepnout na jednom místě v `src/lib/nahravani.ts`;
    - token se bere na začátku nahrávání a platí hodinu. U extrémně dlouhého
      nahrávání by mohl vypršet.
19. **Mazání média:** jen když ho nepoužívá žádný `post_media`. Nejdřív se smaže řádek
    (tam případně zaskočí FK restrict), pak soubor a náhled ve Storage.

## Editor

20. **Víc účtů najednou:** každý účet má vlastní záložku s vlastním textem, médii,
    formátem a časem.
    - Nově přidaný účet převezme jen čas aktivní záložky. Text a média začínají
      prázdné, protože každá stránka má jiné.
    - Tlačítko „převzít text z jiné záložky“ jsem nedělal.
21. **„Uložit koncept“ a „Naplánovat“ platí pro všechny upravitelné záložky skupiny**
    (na liště je počet účtů). Zveřejněné a publikující se záložky jsou jen ke čtení.
22. **Skupina:** `group_id` vzniká při uložení, když jsou ve skupině aspoň dva účty.
    Přidáním účtu k existujícímu samostatnému příspěvku dostanou společnou `group_id`
    oba příspěvky.
23. **„Zkusit znovu“ v editoru:** bez úprav jde přes `zkusitZnovu` (jen
    `failed → scheduled` a čas), tedy stejně jako na stránce Chyby. Jen když je
    obsah upravený, nejdřív se uloží. Čas je vždy `max(původní, teď + 2 min)`.
24. **„Opakovat“:**
    - příspěvek se nejdřív uloží jako koncept (stane se šablonou);
    - založí se `post_series` s pásmem účtu a zavolá se
      `rpc('generate_series_occurrences')`.
    - Horizont je výchozích 8 týdnů z DB a sérii dál prodlužuje cron DB agenta.
25. **Hromadný posun v Seznamu** mění jen čas. Chyba zůstane chybou, na rozdíl od
    přetažení v kalendáři, kde se s potvrzením znovu zařadí. Posun o dny drží místní
    čas, posun o hodiny a minuty je přesný.

## Technika

26. **Next.js 16.4:** middleware se teď jmenuje Proxy (`src/proxy.ts`). Šablona
    create-next-app zapínala `cacheComponents` a `partialPrefetching`, obojí jsem
    vypnul, protože appka je klientská a interaktivní.
    - Layout `(app)` volá `connection()`, aby se nic nepředgenerovalo při buildu
      bez env. Bez toho Next stránky vyrenderoval staticky s hláškou „Appka není
      nastavená“.
27. **Env bez pádu:** bez env build projde (ověřeno) a proxy pošle všechno na /login.
    `NEXT_PUBLIC_*` se ale do klienta vkládají **při buildu**, takže na Vercelu musí
    být nastavené před buildem.
28. **Service role** se v appce nepoužívá nikde. Všechno jde přes přihlášeného
    uživatele a RLS, Edge funkce přes `supabase.functions.invoke('meta-sync')`.
    Odpověď meta-sync (`{ nacteno: [...], odpojeno }` / `{ error }`) je přečtená
    z kódu DB agenta.
29. **Přístup:**
    - Přihlášený, ale není v `app_users` → layout ukáže „Účet nemá přístup“
      s tlačítkem Odhlásit.
    - Přihlášený na /login → přesměruje na /kalendar.
    - Parametr `?next=` po přihlášení přijímá jen cesty uvnitř appky.
30. **Obnovování:** realtime není. Kalendář se obnoví při návratu do okna a každou
    minutu, počet chyb v menu každou minutu a po každé akci.
31. **Přetahování (HTML5 DnD) na dotykových telefonech nefunguje.** Na telefonu je
    týden seznam dnů pod sebou a měsíc tečky s výběrem dne. Čas se mění v editoru,
    pořadí médií šipkami.
32. **Filtr účtů v kalendáři** se pamatuje v `localStorage` (přes
    `useSyncExternalStore`, kvůli hydrataci).
33. `eslint` i `tsc` ignorují složku `supabase/` (má vlastní Deno a testy DB agenta).

## Opravy po kontrole (12. 10.)

34. **Dvojí publikace.** Smazání a nové vložení `post_media` spustí v DB trigger, který
    vynuluje `remote_state`. Publikační smyčka by pak poslala znovu příspěvek, který už
    na síti napůl nebo celý je.
    - `ulozVariantu` si teď nejdřív načte stav z DB (obsah + média seřazená podle
      `position`). Přepíše jen to, co se opravdu liší (`src/lib/ukladani.ts`).
    - Média se přepíší, jen když se liší seřazený seznam `asset_id`.
    - Obsah se zapíše, jen když se liší. Čas se porovnává jako okamžik,
      `platform_options` bez ohledu na pořadí klíčů.
    - Když se nezměnilo nic, přepne se nanejvýš stav.
35. **Nedokončené uložení.** Když po přepnutí naplánovaného příspěvku do konceptu
    (nebo u konceptu, který se měl naplánovat) selže další krok, appka vyhodí
    `UlozeniNedokonceno` s hláškou „Příspěvek se nepodařilo uložit a je teď koncept —
    nevyjde, dokud ho znovu nenaplánujete.“
    - Editor ho pak ukáže jako koncept.
    - U nově založeného řádku si editor pamatuje jeho id, takže další uložení ho
      nezaloží podruhé.
    - Kalendář čte stav z DB, takže je tam taky koncept.
    - U příspěvku ve stavu chyba zůstává chyba chybou (do konceptu se nepřepíná).
36. **Šablona série** (aktivní i ukončené) nejde naplánovat.
    - Editor místo „Naplánovat“ ukáže vysvětlení. `ulozVse` to hlídá i samostatně.
    - DB to podle koordinátora zakáže taky.
    - „Opakovat“ jde u šablony **ukončené** série, ne u aktivní. Tak se mění čas
      opakování: ukončit a založit nové.
37. **Opakování obsah kontroluje.** Před `zalozSerii` proběhne `zkontrolujVariantu`
    v režimu „opakovani“ (jako „Naplánovat“, ale bez kontroly času). Při blokující
    chybě se série nezaloží a tlačítko je zakázané.
38. **„Ukončit opakování“ maže všechny `scheduled` výskyty série** bez ohledu na čas,
    tedy i ty, které čekají na další pokus. Ostatní stavy zůstávají.
39. **Typy srovnané s migracemi:**
    - `media_assets.kind` může být null — validace u takového média varuje;
    - `publish_attempts.started_at` není null;
    - `post_series.generated_until` je povinný sloupec (může být null).
    - Ostatní sloupce jsem prošel a sedí. Hlídá to `src/lib/__tests__/db-types.test.ts`
      (kontrola typů při `tsc`).

## Opravy po 2. kontrole

40. **Nový řádek a chyba po vložení.** Když po vložení nového příspěvku selže
    připojení médií nebo naplánování, `provedPoVlozeni` (`src/lib/ukladani.ts`)
    vždy vyhodí `UlozeniNedokonceno` s id řádku. Platí to i pro koncept a pro
    uložení z „Opakovat“.
    - Editor si přes `vysledekZChyby` id vždy zapamatuje (v `ulozVse`, „Zkusit znovu“
      i `ulozitAktivniKoncept`), takže další uložení nezaloží druhý řádek a jen
      doplní média.
    - Hláška odpovídá stavu:
      - koncept bez médií: „Koncept se uložil, ale bez médií — přidejte je znovu
        a uložte.“;
      - měl se naplánovat a média selhala: „Příspěvek se uložil jen jako koncept bez
        médií — nevyjde, dokud média nepřidáte a znovu ho nenaplánujete.“;
      - média prošla, selhalo naplánování: původní hláška o konceptu.
    - Neřešil jsem: `duplikuj` a `kopirujTyden` vkládají média stejným způsobem.
      Když tam média selžou, zůstane nový koncept bez médií a zobrazí se obyčejná
      chyba. Ty řádky ale editor nedrží, takže druhý řádek nevznikne.
41. **„Vyřešeno“ jen u stavu chyba.** `oznacVyresene` má `.eq("status", "failed")`.
    Když se nic neoznačí, vyhodí „Příspěvek už mezitím změnil stav.“
    - Stránka Chyby tu hlášku (i jiné chyby akcí) ukáže zvlášť, aby ji znovunačtení
      nesmazalo, a seznam načte znovu.

## Úprava podle majitele (kopie týdne se vždy upravují)

42. **Duplicity v editoru podle `claim_due_posts`.** Pravidlo je stejné jako
    v 0005_publikace.sql a je v čisté funkci `rozdelDuplicity` (`src/lib/duplicity.ts`).
    - **„zastaví“** = jiný příspěvek téhož účtu se stejným `content_hash`, který je:
      - `publishing` (bez ohledu na stáří), nebo
      - `published` ≤ 30 dní, nebo
      - `unknown_outcome` ve stavu `scheduled`/`failed` s `updated_at` ≤ 30 dní.
      Taková duplicita blokuje „Naplánovat“, dokud není zaškrtnuté
      „Opravdu zveřejnit znovu“. Dřív blokovalo jen `published`.
    - **„čeká“** = originál je koncept nebo naplánovaný, jen žluté varování.
    - Výskyty téže série se nepočítají. Starší zveřejněné a obyčejné chyby taky ne.
    - Dotaz bere kandidáty široce a třídí je až ta funkce. Nově jsou mezi nimi
      i publikující se příspěvky a příspěvky s nejistým výsledkem, které dřív chyběly.
43. **Žluté varování, když originál ještě nevyšel** (je naplánovaný): „Jakmile originál
    vyjde, tato kopie bez úprav nevyjde — upravte text nebo grafiku, nebo zaškrtněte
    ‚Opravdu zveřejnit znovu‘.“ Po zaškrtnutí zmizí. Zaškrtávátko zůstává jen
    v editoru u varianty.
44. **Potvrzení „Zkopírovat týden“** obsahuje: „Kopie jsou koncepty. Když kopii před
    naplánováním neupravíte (text nebo grafiku), v den zveřejnění ji appka zastaví jako
    duplicitu, protože stejný obsah na stejném účtu už vyšel.“
    - Zaškrtávátko pro povolení duplicity v dialogu není (majitel ho nechce).
    - `allow_duplicate` se do kopií dál nepřenáší.

## Limit nahrávání (Free plán Supabase)

45. **Limit velikosti souboru je na jednom místě**: `src/lib/limit-nahravani.ts`.
    - Výchozích 50 MB = 52 428 800 B.
    - Jde přepsat přes `NEXT_PUBLIC_MAX_UPLOAD_MB` (je v `.env.example`). Vkládá se
      při buildu, takže po změně je potřeba nový build. Nesmyslná hodnota → 50.
    - Po přechodu na Pro je potřeba zvednout i limit bucketu a projektu v Supabase,
      ne jen tuhle proměnnou.
46. **Kontrola:**
    - **Při výběru** (`rozdelPodleLimitu` v `NahravaciPanel`, takže platí v knihovně
      médií i v editoru) se video a jiné neobrázky nad limit odmítnou hned, před
      nahráváním. Hláška: „Soubor má X MB, limit je 50 MB. Zkraťte nebo zmenšete video
      (např. v telefonu při sdílení zvolte nižší kvalitu).“ Ostatní soubory z dávky
      se nahrají.
    - **Obrázky** se kontrolují až po převodu na JPEG (`nahrajDoKnihovny`, po
      `pripravSoubor`). Velký PNG, který se převodem zmenší, tedy projde.
    - Hláška u obrázku je stejná, i když mluví o videu, protože takové bylo zadání.
    - `nahrajDoKnihovny` kontroluje neobrázky ještě jednou sám (pojistka pro jiná
      volání) a má teď vstříknutelné závislosti kvůli testům.
    - MB v hlášce = 1 048 576 B, desetinná čárka.

## Skupiny (SPEC-SKUPINY.md)

47. **Nic se do skupin neposílá automaticky.** Appka jen připraví dávky, pošle
    upozornění a na `/skupiny/dnes` jedním klepnutím zkopíruje text a otevře sdílení.
48. **Rozpis dávek** (`src/lib/skupiny/rozpis.ts`) je ověřený proti
    `create_group_campaign` v 0008:
    - neaktivní skupiny se přeskočí;
    - stejná skupina v poli se bere jen při prvním výskytu;
    - `variant_index = pořadí od 0 % počet variant`;
    - `batch_no = pořadí / velikost + 1`;
    - `due_at = start + (batch_no − 1) × odstup` v pevných minutách.
    Náhled v `/skupiny/nova` tak ukazuje totéž, co vytvoří DB.
49. **Pořadí skupin v nové rozesílce:** nejdřív ty, kam se nikdy neposílalo, pak podle
    `last_sent_at` od nejstaršího, při shodě podle jména. Rozkládá to zátěž po skupinách.
50. **Import ze zkopírované stránky:**
    - vynechá řádky ze SPEC a pár dalších běžných řádků FB stránky („Zobrazit skupinu“,
      „Vaše skupiny“, „Objevit“, „Vytvořit novou skupinu“ …);
    - řádek `název<TAB>url` se rozdělí na název a odkaz;
    - samotný odkaz na dalším řádku patří ke jménu nad ním;
    - odkazy se normalizují na `https://www.facebook.com/groups/<id>`; cizí domény nejsou skupina.
    - Duplicitní jména — **nahrazeno bodem 60** (původní slučování ztrácelo skupiny).
51. **„Otevřít skupinu“** použije uloženou URL, jen když je to `https://…facebook.com/…`.
    Jinak otevře `https://www.facebook.com/search/groups/?q=<název>` (URL-encode).
    Brání to i podvrženým `javascript:` odkazům.
52. **„Sdílet do skupiny“:**
    - obrázek rozesílky (první obrázek, jinak první médium) se stáhne jako `File`
      **předem**, protože sdílení musí proběhnout hned po klepnutí;
    - po klepnutí appka zapíše text do schránky a hned zavolá `navigator.share({ files, text })`;
    - kde sdílení souborů nejde, obrázek se stáhne;
    - hláška je podle SPEC.
53. **Fronta „Dnes“** (`src/lib/skupiny/fronta.ts`):
    - jen čekající úkoly splatných dávek aktivních rozesílek;
    - řazení podle času a čísla dávky, v dávce podle názvu (úkoly v DB nemají pořadí);
    - počítadla „x / y v dávce · x / y celkem“ = hotové + pozice ve frontě.
    - „Zpět o jednu“ vrátí poslední úkol mezi čekající; DB pak hotovou kampaň vrátí
      na `active`.
54. **Cron route `/api/cron/skupiny`** (POST, Node runtime):
    - chybí `VERCEL_CRON_SECRET` → 500;
    - špatný, chybějící nebo krátký (< 32 znaků) Bearer → 401, porovnání
      `timingSafeEqual` na sha256 otiscích;
    - chybí jiná env → 500 se jmény proměnných (bez hodnot);
    - používá `due_group_batches(10)` a počty z jeho výsledku (`batch_count`,
      `pending_count`; kdyby chyběly, dopočítají se);
    - odběry s 404/410 smaže a v dalších dávkách je už nezkouší;
    - odpověď obsahuje jen počty;
    - proxy (přihlašování) na `/api/cron/`, `/sw.js` a `/manifest.webmanifest`
      nesahá, jinak by cron skončil přesměrováním na /login.
55. **Text upozornění:** „Skupiny: dávka X z Y — N skupin čeká“, česky skloňované
    (1 skupina čeká / 2–4 skupiny čekají / 5+ skupin čeká).
    - Klik otevře `/skupiny/dnes` (service worker otevře jen URL vlastní domény).
    - `tag` podle kampaně, aby se upozornění na telefonu nehromadila.
56. **PWA:**
    - `manifest.webmanifest` začíná na `/skupiny/dnes`;
    - ikony 192/512 + apple-touch jsou jednoduché modré „S“ (generované, bez knihoven);
    - `sw.js` nemá posluchač `fetch`, tedy žádné cachování, a posílá se s `no-cache`.
    - Panel „Upozornění v telefonu“ je na `/skupiny`. Na iPhonu mimo plochu ukáže
      návod „Sdílet → Přidat na plochu“.
    - Opakované zapnutí ve stejném prohlížeči smaže starý řádek podle endpointu a vloží nový.
57. **Tajemství:**
    - `SUPABASE_SECRET_KEY`, `VAPID_PRIVATE_KEY` a `VERCEL_CRON_SECRET` čtou jen
      `route.ts` a `src/lib/skupiny/cron-server.ts`. Hlídá to `tajemstvi.test.ts`,
      který zakazuje i `NEXT_PUBLIC_*SECRET/PRIVATE`.
    - Po buildu se zkušebními hodnotami ověří `npm run kontrola:bundl`, že tajné hodnoty
      ani jména v `.next/static` nejsou.
    - Kontrola má pozitivní kontrolu: veřejný VAPID klíč v bundlu být musí, jinak selže.
    - Úvod `.env.example` jsem upravil: výjimkou z „jen RLS“ je cron route.
58. **„Poslat i do skupin“** v editoru předá text a média přes `sessionStorage`
    (i neuložené úpravy, ne v URL). `/skupiny/nova` je načte a smaže; podezřelá id
    se zahodí.
59. **Nový balík:** `web-push` (+ `@types/web-push`), podle zadání.

## Opravy Skupin po kontrole

60. **Import: stejná jména jsou různé skupiny.**
    - V rámci jednoho importu se zachovají všechny výskyty, např. 6× „Práce v Německu“
      a 5× „Práca v Nemecku“.
    - Proti DB se u každého jména bez odkazu odečte tolik výskytů, kolik řádků se
      stejným jménem (i s odkazem) už v DB je. Stejný import podruhé = 0 nových.
    - Řádky s odkazem se dál porovnávají podle odkazu.
    - Náhled ukazuje „6× Práce v Německu — uloží se jako 6 samostatných skupin“, nebo
      „… N už je uloženo, nově se uloží M“.
61. **Import po dávkách** (`ulozImport`) počítá výběr vždy z čerstvě načtené DB.
    - Po chybě v půlce znovu načte skupiny a náhled ukáže, co zbývá.
    - Opakované „Uložit“ tak nic nezdvojí ani se zastaralou stránkou.
62. **Šum „před …“** je jen:
    - přesný časový údaj („před 3 týdny“, „před týdnem“, „před několika sekundami“,
      „před 4 min“, „před 2 lety“), nebo
    - jakýkoli řádek „před …“ hned po řádku „Naposledy jste tu byl(a)“.
    Skupina „Před stavbou – práce“ zůstane.
63. **Upozornění v telefonu** (`src/lib/skupiny/odber.ts`):
    - „Zapnuto“ jen když prohlížeč má odběr a v `push_subscriptions` je k němu
      vlastní řádek.
    - Chybí-li řádek, uloží se znovu (upsert podle endpointu) a ověří. Když to selže,
      panel ukáže „Vypnuto“ s chybou.
    - Vypnutí nejdřív smaže řádek (chyba se ukáže a v prohlížeči se pak neodhlašuje),
      teprve potom odhlásí.
64. **Cron a nedoručená dávka:** když upozornění dávky nedošlo na žádný odběr kvůli
    chybě (odběry nejdou načíst, nebo všechna odeslání skončila 5xx nebo chybou sítě),
    route zavolá `release_group_batch(p_batch_id)` a dávka se zkusí v další minutě.
    - Při nule odběrů, nebo když byly všechny odběry neplatné (404/410, smazané), se
      dávka nevrací (jinak by vznikla nekonečná smyčka); jen se zaloguje.
    - Odpověď má nově počet `vraceno`.
    - `release_group_batch` v migracích zatím nevidím; typ je podle zadání
      (`p_batch_id uuid → boolean`, jen service_role).
65. **`import "server-only"`** je v `cron-server.ts` i `route.ts` (balík `server-only`,
    oficiální značka React/Next).
    - Ve vitestu se aliasuje na jeho prázdný modul, stejně jako to dělá Next.js
      v serverovém kódu.
    - `tajemstvi.test.ts` hlídá, že každý soubor, který čte tajná env, ho má.
