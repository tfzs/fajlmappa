# Fájl-Kaland 🗂️

Játékos webalkalmazás 10–11 éves diákoknak a Windows fájl- és mappakezelés gyakorlására.
Hat játék, beépített Windows 11-szerű Fájlkezelő, alkalmazkodó nehézség (1–5. szint),
Biti, a segítő robot, Bájt-Bolt, kitűzők és tanári felület.

## Fájlok

| Fájl | Szerepe |
|---|---|
| `index.html` | Az egyetlen oldal: belépés/regisztráció, tanári felület, diák-asztal |
| `style.css` | Megjelenés (háttérképek, ablakok, Biti, animációk) |
| `core.js` | Belépés, tanári felület, asztal, ablakkezelő, AdaptiveEngine, Biti, bolt, profil |
| `explorer.js` | Virtuális fájlrendszer (`FK.VFS`) és Fájlkezelő (`FK.Explorer`, álnéven `FK.VirtualExplorer`) |
| `games_1.js` | 1. Kiterjesztés-párosító, 2. Útvonal-labirintus, 3. Billentyűparancs-nindzsa + közös játékkeret (`FK.GameKit`) |
| `games_2.js` | 4. Káosz Kapitány Szobája, 5. Lomtár-mentő és Vírusvadász, 6. A Digitális Detektív |
| `api.php` | PHP 8 + SQLite háttér; első futáskor magától létrehozza az `adatbazis.sqlite` fájlt |
| `.htaccess` | Apache alatt megtiltja az adatbázis letöltését böngészőből |

A szkriptek betöltési sorrendje fontos (az `index.html` már így tölti be):
`core.js` → `explorer.js` → `games_1.js` → `games_2.js`.

## Telepítési és használati útmutató tanároknak

1. **Feltöltés a szerverre.** Kell egy PHP 8 (vagy újabb) tárhely bekapcsolt `pdo_sqlite`
   bővítménnyel. Ez a legtöbb iskolai és olcsó tárhelyen alapból megvan. Másold fel az összes
   fájlt (a `.htaccess`-t is!) egy mappába, például `public_html/fajlkaland/`. Az oldal címe ezután
   `https://iskolad.hu/fajlkaland/`. Adatbázist nem kell kézzel létrehozni: az első megnyitáskor
   az `api.php` magától elkészíti.

2. **Mappa-jogosultság az SQLite-nak.** A webszervernek (pl. `www-data`) **írási joggal** kell
   rendelkeznie a Fájl-Kaland mappájára. Az SQLite ide írja az `adatbazis.sqlite` fájlt és a mellé
   tartozó ideiglenes napló-fájlokat. Linuxon: `chmod 775 fajlkaland` (szükség esetén
   `chown www-data fajlkaland`). FTP-programban: a mappa jogai legyenek 775 (vagy ha csak így
   működik, 777). Ha nincs írási jog, a belépéskor ez az üzenet jelenik meg: „Az adatbázis nem
   írható…”. Az adatbázist a `.htaccess` védi a letöltéstől. Ha a szerver nginx, kérd meg a
   rendszergazdát, hogy tiltsa le a `*.sqlite` fájlok kiszolgálását.

3. **Belépés tanárként.** Felhasználónév: **`tanar`**, jelszó: **`tanar123`**. Éles használat
   előtt az `api.php` elején lévő `DEFAULT_TEACHER_PASSWORD` értékét írd át saját jelszóra.
   Ezt az **első feltöltés előtt** tedd meg, mert a fiók csak az adatbázis első létrehozásakor
   jön létre. Ha már létrejött, töröld az `adatbazis.sqlite` fájlt, és nyisd meg újra az oldalt:
   így újra létrejön, de minden adat elvész. Az alap osztályok (4.a–6.a) mellé a tanári
   felületen újakat is felvehetsz.

4. **Diákok regisztrációja és jóváhagyása.** A diákok a nyitóoldalon a „Regisztráció” fülön
   adják meg a nevüket, az osztályukat, a felhasználónevüket és a jelszavukat. Ezután a fiókjuk
   **függőben** van: belépéskor ezt látják: „A fiókod még tanári jóváhagyásra vár!”. Te a tanári
   felület „Jóváhagyásra váró diákok” listájában egyenként, kijelölve vagy a „Mind jóváhagyása” gombbal
   engedélyezheted őket, a hibás regisztrációkat pedig elutasíthatod (ez törli a fiókot). Ha
   egy diák elfelejti a jelszavát, a tanári felületen új jelszót adhatsz neki.

5. **Használat az órán.** A jóváhagyott diák belépés után egy Windows 11-szerű asztalt lát. A
   játékokat az asztal ikonjaival (dupla kattintás, tableten egy koppintás) vagy a Start menüből
   indíthatja. Minden játék magától igazodik a diákhoz. Három hibátlan kör után eggyel nehezebb
   szint jön, egy körben elkövetett két hiba után eggyel könnyebb, és ilyenkor Biti segít. Az
   XP-t és a Bájt-érméket a szerver menti, az érmékből a Bájt-Boltban háttereket és mappastílusokat
   vehetnek. Te a tanári felület statisztikájában osztályonként látod, ki melyik játékban hányas
   szinten jár, és hány hibát ejtett. Az oldal PC-n és tableten is működik.

## Gyors kipróbálás saját gépen

```bash
php -S localhost:8000
# majd böngészőben: http://localhost:8000/index.html
```
