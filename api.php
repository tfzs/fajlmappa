<?php
/**
 * Fájl-Kaland – Backend API  (verzió: 0.6 beta)
 * PHP 8+ és SQLite3 (PDO). Zero-config: első futáskor létrehozza az adatbázist és a táblákat.
 * Minden kérés és válasz JSON. A művelet neve az "action" paraméterben érkezik
 * (GET query stringben vagy a JSON törzsben).
 */

declare(strict_types=1);

// ---------------------------------------------------------------------------
// Alapbeállítások
// ---------------------------------------------------------------------------

ini_set('display_errors', '0');
error_reporting(E_ALL);

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store, no-cache, must-revalidate');
header('X-Content-Type-Options: nosniff');

session_set_cookie_params([
    'lifetime' => 0,
    'path'     => '/',
    'httponly' => true,
    'samesite' => 'Lax',
]);
session_start();

const APP_VERSION = '0.6 beta';

const DB_FILE = __DIR__ . '/adatbazis.sqlite';

// Az alapértelmezett tanári fiók. Csak az adatbázis LEGELSŐ létrehozásakor használjuk:
// éles szerveren az első feltöltés ELŐTT érdemes saját jelszóra cserélni.
const DEFAULT_TEACHER_USERNAME = 'tanar';
const DEFAULT_TEACHER_PASSWORD = 'tanar123';

// Játékok száma és nehézségi szintek határai
const GAME_MIN       = 1;
const GAME_MAX       = 6;
const LEVEL_MIN      = 1;
const LEVEL_MAX      = 5;
const STREAK_TO_UP   = 3;   // ennyi egymás utáni siker után nő a nehézség
const ERRORS_TO_DOWN = 2;   // ha egy feladatban ennyi vagy több hiba van, csökken a nehézség

// Egy mentésnél maximálisan jóváírható jutalom (csalás elleni védelem)
const MAX_XP_PER_SAVE    = 100;
const MAX_COINS_PER_SAVE = 50;

// Szintlépési bónusz (nehézségi szint növekedésekor a szerver írja jóvá)
const LEVEL_UP_BONUS_XP    = 25;
const LEVEL_UP_BONUS_COINS = 15;

/**
 * A virtuális bolt katalógusa. Az árakat mindig a szerver határozza meg,
 * a kliens csak az azonosítót küldi.
 * type: 'bg' (asztali háttér) vagy 'folder' (mappa-ikon stílus)
 */
const SHOP_ITEMS = [
    'default'      => ['type' => 'both',   'name' => 'Alapértelmezett', 'price' => 0],
    'bg_station'   => ['type' => 'bg',     'name' => 'Űrállomás',       'price' => 80],
    'bg_cyber'     => ['type' => 'bg',     'name' => 'Cyberpunk',       'price' => 120],
    'bg_cats'      => ['type' => 'bg',     'name' => 'Cicás',           'price' => 60],
    'bg_jungle'    => ['type' => 'bg',     'name' => 'Dzsungel',        'price' => 70],
    'bg_football'  => ['type' => 'bg',     'name' => 'Focipálya',       'price' => 90],
    'folder_gold'  => ['type' => 'folder', 'name' => 'Arany kincses',   'price' => 150],
    'folder_neon'  => ['type' => 'folder', 'name' => 'Neon kék',        'price' => 100],
    'folder_pixel' => ['type' => 'folder', 'name' => 'Pixeles',         'price' => 80],
];

/**
 * Kitűzők (achievementek). A megszerzett kitűzők "ach_<azonosító>" formában
 * kerülnek a felhasználó unlocked_items_json tömbjébe.
 */
const ACHIEVEMENTS = [
    'first_steps'    => ['icon' => '👣', 'name' => 'Első lépések',     'desc' => 'Teljesítsd az első feladatodat!'],
    'flawless'       => ['icon' => '🎯', 'name' => 'Hibátlan sorozat', 'desc' => 'Oldj meg 3 feladatot zsinórban hiba nélkül!'],
    'folder_master'  => ['icon' => '📁', 'name' => 'Mappa-mester',     'desc' => 'Érd el az 5. nehézségi szintet egy játékban!'],
    'rich_collector' => ['icon' => '💰', 'name' => 'Gazdag gyűjtő',    'desc' => 'Gyűjts össze egyszerre 300 Bájt-érmét!'],
    'first_purchase' => ['icon' => '🛍️', 'name' => 'Első vásárlás',    'desc' => 'Vásárolj valamit a Bájt-Boltban!'],
    'explorer'       => ['icon' => '🧭', 'name' => 'Felfedező',        'desc' => 'Próbáld ki mind a 6 játékot!'],
    'diligent'       => ['icon' => '🏅', 'name' => 'Szorgalmas diák',  'desc' => 'Teljesíts összesen 50 feladatot!'],
    'xp_hunter'      => ['icon' => '⭐', 'name' => 'XP-vadász',        'desc' => 'Érd el az 5. játékosszintet!'],
];

// ---------------------------------------------------------------------------
// Segédfüggvények
// ---------------------------------------------------------------------------

/** JSON válasz küldése és a futás befejezése. */
function respond(array $data, int $status = 200): never
{
    http_response_code($status);
    echo json_encode($data, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES);
    exit;
}

/** Sikeres válasz. */
function ok(array $data = []): never
{
    respond(['success' => true] + $data);
}

/** Hibás válasz magyar üzenettel. */
function fail(string $message, int $status = 400): never
{
    respond(['success' => false, 'error' => $message], $status);
}

/** Bemenet összegyűjtése: JSON törzs + POST + GET. */
function read_input(): array
{
    $input = [];
    $raw = file_get_contents('php://input');
    if (is_string($raw) && $raw !== '') {
        $decoded = json_decode($raw, true);
        if (is_array($decoded)) {
            $input = $decoded;
        }
    }
    return array_merge($_GET, $_POST, $input);
}

/** Szöveges paraméter kiolvasása, levágott szélekkel. */
function str_param(array $in, string $key, string $default = ''): string
{
    if (!isset($in[$key]) || is_array($in[$key])) {
        return $default;
    }
    return trim((string)$in[$key]);
}

/** Egész szám paraméter kiolvasása. */
function int_param(array $in, string $key, int $default = 0): int
{
    if (!isset($in[$key]) || is_array($in[$key]) || !is_numeric($in[$key])) {
        return $default;
    }
    return (int)$in[$key];
}

/** Szöveg hossza UTF-8 karakterekben. */
function ulen(string $s): int
{
    return mb_strlen($s, 'UTF-8');
}

/** Adatbázis-kapcsolat (egyetlen példány), szükség esetén séma létrehozással. */
function db(): PDO
{
    static $pdo = null;
    if ($pdo instanceof PDO) {
        return $pdo;
    }

    $isNew = !file_exists(DB_FILE);

    if (!extension_loaded('pdo_sqlite')) {
        fail('A szerveren nincs bekapcsolva a PHP pdo_sqlite bővítménye. Kérd meg a rendszergazdát, hogy kapcsolja be!', 500);
    }
    // Az SQLite a mappába is ír (napló- és zárolási fájlok), ezért a mappának és a fájlnak is írhatónak kell lennie
    if (!is_writable(__DIR__) || (!$isNew && !is_writable(DB_FILE))) {
        fail('Az adatbázis nem írható. Adj írási jogot a webszervernek a Fájl-Kaland mappájára és az adatbazis.sqlite fájlra (pl. chmod 775)!', 500);
    }

    try {
        $pdo = new PDO('sqlite:' . DB_FILE);
    } catch (PDOException $e) {
        fail('Nem sikerült megnyitni az adatbázist. Ellenőrizd, hogy a mappa írható-e!', 500);
    }

    $pdo->setAttribute(PDO::ATTR_ERRMODE, PDO::ERRMODE_EXCEPTION);
    $pdo->setAttribute(PDO::ATTR_DEFAULT_FETCH_MODE, PDO::FETCH_ASSOC);
    $pdo->exec('PRAGMA foreign_keys = ON');
    $pdo->exec('PRAGMA journal_mode = WAL');
    $pdo->exec('PRAGMA busy_timeout = 5000');

    init_schema($pdo, $isNew);

    return $pdo;
}

/** Táblák létrehozása és alapadatok feltöltése. Többször is biztonságosan futtatható. */
function init_schema(PDO $pdo, bool $isNew): void
{
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS classes (
            id   INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE
        )
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS users (
            id                  INTEGER PRIMARY KEY AUTOINCREMENT,
            name                TEXT NOT NULL,
            username            TEXT NOT NULL UNIQUE COLLATE NOCASE,
            password_hash       TEXT NOT NULL,
            class_id            INTEGER NULL REFERENCES classes(id) ON DELETE SET NULL,
            role                TEXT NOT NULL DEFAULT 'student' CHECK (role IN ('student', 'teacher')),
            status              TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active')),
            xp                  INTEGER NOT NULL DEFAULT 0,
            coins               INTEGER NOT NULL DEFAULT 50,
            equipped_bg         TEXT NOT NULL DEFAULT 'default',
            equipped_folder     TEXT NOT NULL DEFAULT 'default',
            unlocked_items_json TEXT NOT NULL DEFAULT '[\"default\"]',
            created_at          TEXT NOT NULL DEFAULT (datetime('now', 'localtime'))
        )
    ");

    $pdo->exec("
        CREATE TABLE IF NOT EXISTS progress (
            id               INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            game_id          INTEGER NOT NULL CHECK (game_id BETWEEN 1 AND 6),
            difficulty_level INTEGER NOT NULL DEFAULT 1 CHECK (difficulty_level BETWEEN 1 AND 5),
            streak           INTEGER NOT NULL DEFAULT 0,
            total_completed  INTEGER NOT NULL DEFAULT 0,
            total_errors     INTEGER NOT NULL DEFAULT 0,
            updated_at       TEXT NOT NULL DEFAULT (datetime('now', 'localtime')),
            UNIQUE (user_id, game_id)
        )
    ");

    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_users_class ON users(class_id)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_users_status ON users(status)');
    $pdo->exec('CREATE INDEX IF NOT EXISTS idx_progress_user ON progress(user_id)');

    // Alapértelmezett osztályok
    $classCount = (int)$pdo->query('SELECT COUNT(*) FROM classes')->fetchColumn();
    if ($classCount === 0) {
        $stmt = $pdo->prepare('INSERT INTO classes (name) VALUES (?)');
        foreach (['4.a', '4.b', '5.a', '5.b', '6.a'] as $className) {
            $stmt->execute([$className]);
        }
    }

    // Alapértelmezett tanári fiók
    $teacherExists = $pdo->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
    $teacherExists->execute([DEFAULT_TEACHER_USERNAME]);
    if ((int)$teacherExists->fetchColumn() === 0) {
        $stmt = $pdo->prepare("
            INSERT INTO users (name, username, password_hash, class_id, role, status, xp, coins, unlocked_items_json)
            VALUES (?, ?, ?, NULL, 'teacher', 'active', 0, 0, '[\"default\"]')
        ");
        $stmt->execute(['Tanár', DEFAULT_TEACHER_USERNAME, password_hash(DEFAULT_TEACHER_PASSWORD, PASSWORD_DEFAULT)]);
    }
}

/** A bejelentkezett felhasználó friss adatai, vagy null. */
function current_user(): ?array
{
    if (empty($_SESSION['user_id'])) {
        return null;
    }
    $stmt = db()->prepare('
        SELECT u.*, c.name AS class_name
        FROM users u
        LEFT JOIN classes c ON c.id = u.class_id
        WHERE u.id = ?
    ');
    $stmt->execute([(int)$_SESSION['user_id']]);
    $user = $stmt->fetch();
    if (!$user || $user['status'] !== 'active') {
        $_SESSION = [];
        return null;
    }
    return $user;
}

/** Bejelentkezés megkövetelése. */
function require_login(): array
{
    $user = current_user();
    if ($user === null) {
        fail('Ehhez be kell jelentkezned!', 401);
    }
    return $user;
}

/** Tanári jogosultság megkövetelése. */
function require_teacher(): array
{
    $user = require_login();
    if ($user['role'] !== 'teacher') {
        fail('Ehhez a művelethez tanári jogosultság szükséges!', 403);
    }
    return $user;
}

/** Diák jogosultság megkövetelése. */
function require_student(): array
{
    $user = require_login();
    if ($user['role'] !== 'student') {
        fail('Ez a funkció csak diákoknak érhető el.', 403);
    }
    return $user;
}

/** Feloldott tárgyak listája tömbként. */
function unlocked_items(array $user): array
{
    $items = json_decode((string)$user['unlocked_items_json'], true);
    if (!is_array($items)) {
        $items = [];
    }
    if (!in_array('default', $items, true)) {
        array_unshift($items, 'default');
    }
    return array_values(array_unique(array_map('strval', $items)));
}

/** Szint (level) számítása XP alapján: minden szint 100 XP-vel többet igényel. */
function level_from_xp(int $xp): int
{
    $level = 1;
    $need  = 100;
    while ($xp >= $need) {
        $xp -= $need;
        $level++;
        $need += 50;
    }
    return $level;
}

/** A kliensnek visszaadható (jelszó nélküli) felhasználói adatok. */
function public_user(array $user): array
{
    return [
        'id'              => (int)$user['id'],
        'name'            => $user['name'],
        'username'        => $user['username'],
        'role'            => $user['role'],
        'class_id'        => $user['class_id'] !== null ? (int)$user['class_id'] : null,
        'class_name'      => $user['class_name'] ?? null,
        'xp'              => (int)$user['xp'],
        'level'           => level_from_xp((int)$user['xp']),
        'coins'           => (int)$user['coins'],
        'equipped_bg'     => $user['equipped_bg'],
        'equipped_folder' => $user['equipped_folder'],
        'unlocked_items'  => array_values(array_filter(unlocked_items($user), fn($i) => !str_starts_with($i, 'ach_'))),
        'achievements'    => achievements_for($user),
    ];
}

/** A kitűzők teljes listája, jelölve, hogy a felhasználó melyiket szerezte meg. */
function achievements_for(array $user): array
{
    $owned = unlocked_items($user);
    $list = [];
    foreach (ACHIEVEMENTS as $id => $a) {
        $list[] = [
            'id'     => $id,
            'icon'   => $a['icon'],
            'name'   => $a['name'],
            'desc'   => $a['desc'],
            'earned' => in_array('ach_' . $id, $owned, true),
        ];
    }
    return $list;
}

/**
 * Kitűzők ellenőrzése és jóváírása. Visszaadja az újonnan megszerzett kitűzőket.
 * Minden feltétel a tárolt adatokból számolható, így a régebbi fiókok is utólag megkapják őket.
 */
function check_achievements(int $userId): array
{
    $pdo = db();
    $stmt = $pdo->prepare('SELECT xp, coins, unlocked_items_json FROM users WHERE id = ?');
    $stmt->execute([$userId]);
    $user = $stmt->fetch();
    if (!$user) {
        return [];
    }
    $owned = unlocked_items($user);

    $stmt = $pdo->prepare('
        SELECT
            COALESCE(SUM(total_completed), 0) AS completed,
            COALESCE(MAX(difficulty_level), 1) AS max_level,
            COALESCE(SUM(CASE WHEN total_completed > 0 THEN 1 ELSE 0 END), 0) AS games_played
        FROM progress WHERE user_id = ?
    ');
    $stmt->execute([$userId]);
    $p = $stmt->fetch();

    $boughtSomething = count(array_filter($owned, fn($i) => $i !== 'default' && !str_starts_with($i, 'ach_'))) > 0;

    $conditions = [
        'first_steps'    => (int)$p['completed'] >= 1,
        'flawless'       => (int)$p['max_level'] >= 2, // szintet lépni csak 3 hibátlan feladattal lehet
        'folder_master'  => (int)$p['max_level'] >= LEVEL_MAX,
        'rich_collector' => (int)$user['coins'] >= 300,
        'first_purchase' => $boughtSomething,
        'explorer'       => (int)$p['games_played'] >= GAME_MAX,
        'diligent'       => (int)$p['completed'] >= 50,
        'xp_hunter'      => level_from_xp((int)$user['xp']) >= 5,
    ];

    $new = [];
    foreach ($conditions as $id => $met) {
        if ($met && !in_array('ach_' . $id, $owned, true)) {
            $owned[] = 'ach_' . $id;
            $a = ACHIEVEMENTS[$id];
            $new[] = ['id' => $id, 'icon' => $a['icon'], 'name' => $a['name'], 'desc' => $a['desc']];
        }
    }
    if (!empty($new)) {
        $upd = $pdo->prepare('UPDATE users SET unlocked_items_json = ? WHERE id = ?');
        $upd->execute([json_encode(array_values($owned), JSON_UNESCAPED_UNICODE), $userId]);
    }
    return $new;
}

/** Egy diák összes játékának előrehaladása (1–6), hiányzó játékok alapértékkel. */
function progress_for_user(int $userId): array
{
    $stmt = db()->prepare('SELECT * FROM progress WHERE user_id = ? ORDER BY game_id');
    $stmt->execute([$userId]);
    $rows = [];
    foreach ($stmt->fetchAll() as $row) {
        $rows[(int)$row['game_id']] = $row;
    }
    $result = [];
    for ($g = GAME_MIN; $g <= GAME_MAX; $g++) {
        $row = $rows[$g] ?? null;
        $result[] = [
            'game_id'          => $g,
            'difficulty_level' => $row ? (int)$row['difficulty_level'] : LEVEL_MIN,
            'streak'           => $row ? (int)$row['streak'] : 0,
            'total_completed'  => $row ? (int)$row['total_completed'] : 0,
            'total_errors'     => $row ? (int)$row['total_errors'] : 0,
            'started'          => $row !== null,
        ];
    }
    return $result;
}

/** Felhasználónév formai ellenőrzése. */
function validate_username(string $username): ?string
{
    if (ulen($username) < 3 || ulen($username) > 30) {
        return 'A felhasználónév 3–30 karakter hosszú legyen!';
    }
    if (!preg_match('/^[a-zA-Z0-9._\-áéíóöőúüűÁÉÍÓÖŐÚÜŰ]+$/u', $username)) {
        return 'A felhasználónévben csak betűk, számok, pont, kötőjel és aláhúzás lehet (szóköz nem)!';
    }
    return null;
}

/** Jelszó formai ellenőrzése. */
function validate_password(string $password): ?string
{
    if (ulen($password) < 4) {
        return 'A jelszó legalább 4 karakter hosszú legyen!';
    }
    if (ulen($password) > 72) {
        return 'A jelszó túl hosszú (legfeljebb 72 karakter)!';
    }
    return null;
}

/** Egész számok listájának kiolvasása (pl. csoportos jóváhagyáshoz). */
function int_list(array $in, string $key): array
{
    $value = $in[$key] ?? [];
    if (!is_array($value)) {
        $value = explode(',', (string)$value);
    }
    $ids = [];
    foreach ($value as $v) {
        if (is_numeric($v) && (int)$v > 0) {
            $ids[] = (int)$v;
        }
    }
    return array_values(array_unique($ids));
}

// ---------------------------------------------------------------------------
// Végpontok
// ---------------------------------------------------------------------------

/** Osztályok listája (regisztrációhoz nyilvános). */
function action_get_classes(): never
{
    $rows = db()->query('SELECT id, name FROM classes ORDER BY name COLLATE NOCASE')->fetchAll();
    $classes = array_map(fn($r) => ['id' => (int)$r['id'], 'name' => $r['name']], $rows);
    ok(['classes' => $classes]);
}

/** Diák regisztráció – 'pending' státusszal. */
function action_register(array $in): never
{
    $name     = preg_replace('/\s+/u', ' ', str_param($in, 'name')) ?? '';
    $username = str_param($in, 'username');
    $password = isset($in['password']) && is_string($in['password']) ? $in['password'] : '';
    $classId  = int_param($in, 'class_id');

    if (ulen($name) < 3 || ulen($name) > 60) {
        fail('Kérlek, add meg a teljes nevedet (3–60 karakter)!');
    }
    if (!str_contains($name, ' ')) {
        fail('Kérlek, a teljes nevedet írd be (vezetéknév és keresztnév)!');
    }
    if ($err = validate_username($username)) {
        fail($err);
    }
    if ($err = validate_password($password)) {
        fail($err);
    }

    $stmt = db()->prepare('SELECT id FROM classes WHERE id = ?');
    $stmt->execute([$classId]);
    if (!$stmt->fetch()) {
        fail('Kérlek, válaszd ki az osztályodat!');
    }

    $stmt = db()->prepare('SELECT COUNT(*) FROM users WHERE username = ?');
    $stmt->execute([$username]);
    if ((int)$stmt->fetchColumn() > 0) {
        fail('Ez a felhasználónév már foglalt. Válassz másikat!');
    }

    $stmt = db()->prepare("
        INSERT INTO users (name, username, password_hash, class_id, role, status, xp, coins, equipped_bg, equipped_folder, unlocked_items_json)
        VALUES (?, ?, ?, ?, 'student', 'pending', 0, 50, 'default', 'default', '[\"default\"]')
    ");
    $stmt->execute([$name, $username, password_hash($password, PASSWORD_DEFAULT), $classId]);

    ok(['message' => 'Sikeres regisztráció! Most várj, amíg a tanárod jóváhagyja a fiókodat.']);
}

/** Bejelentkezés. */
function action_login(array $in): never
{
    $username = str_param($in, 'username');
    $password = isset($in['password']) && is_string($in['password']) ? $in['password'] : '';

    if ($username === '' || $password === '') {
        fail('Add meg a felhasználónevedet és a jelszavadat!');
    }

    // Egyszerű védelem a próbálgatás ellen: munkamenetenként rövid várakoztatás sok hiba után
    $_SESSION['failed_logins'] = (int)($_SESSION['failed_logins'] ?? 0);
    if ($_SESSION['failed_logins'] >= 5) {
        $last = (int)($_SESSION['last_failed_login'] ?? 0);
        if (time() - $last < 30) {
            fail('Túl sok sikertelen próbálkozás. Várj fél percet, aztán próbáld újra!', 429);
        }
        $_SESSION['failed_logins'] = 0;
    }

    $stmt = db()->prepare('
        SELECT u.*, c.name AS class_name
        FROM users u
        LEFT JOIN classes c ON c.id = u.class_id
        WHERE u.username = ?
    ');
    $stmt->execute([$username]);
    $user = $stmt->fetch();

    if (!$user || !password_verify($password, $user['password_hash'])) {
        $_SESSION['failed_logins']++;
        $_SESSION['last_failed_login'] = time();
        fail('Hibás felhasználónév vagy jelszó!', 401);
    }

    if ($user['status'] === 'pending') {
        fail('A fiókod még tanári jóváhagyásra vár!', 403);
    }

    if (password_needs_rehash($user['password_hash'], PASSWORD_DEFAULT)) {
        $upd = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
        $upd->execute([password_hash($password, PASSWORD_DEFAULT), $user['id']]);
    }

    session_regenerate_id(true);
    $_SESSION['user_id'] = (int)$user['id'];
    $_SESSION['failed_logins'] = 0;

    $data = ['user' => public_user($user)];
    if ($user['role'] === 'student') {
        $data['progress'] = progress_for_user((int)$user['id']);
    }
    ok($data);
}

/** Kijelentkezés. */
function action_logout(): never
{
    $_SESSION = [];
    if (ini_get('session.use_cookies')) {
        $p = session_get_cookie_params();
        setcookie(session_name(), '', [
            'expires'  => time() - 42000,
            'path'     => $p['path'],
            'domain'   => $p['domain'],
            'secure'   => $p['secure'],
            'httponly' => $p['httponly'],
            'samesite' => $p['samesite'] ?? 'Lax',
        ]);
    }
    session_destroy();
    ok(['message' => 'Sikeresen kijelentkeztél. Viszlát!']);
}

/** Munkamenet ellenőrzése (oldalbetöltéskor). */
function action_check_session(): never
{
    $user = current_user();
    if ($user === null) {
        ok(['logged_in' => false]);
    }
    $newAchievements = [];
    if ($user['role'] === 'student') {
        $newAchievements = check_achievements((int)$user['id']);
        if (!empty($newAchievements)) {
            $user = current_user();
        }
    }
    $data = ['logged_in' => true, 'user' => public_user($user), 'new_achievements' => $newAchievements];
    if ($user['role'] === 'student') {
        $data['progress'] = progress_for_user((int)$user['id']);
    }
    ok($data);
}

/** Tanári műveletek – a konkrét műveletet a "sub" paraméter adja meg. */
function action_teacher_actions(array $in): never
{
    require_teacher();
    $sub = str_param($in, 'sub');

    switch ($sub) {

        // Függőben lévő diákok listája (opcionálisan osztályra szűrve)
        case 'list_pending': {
            $classId = int_param($in, 'class_id');
            $sql = "
                SELECT u.id, u.name, u.username, u.class_id, c.name AS class_name, u.created_at
                FROM users u
                LEFT JOIN classes c ON c.id = u.class_id
                WHERE u.role = 'student' AND u.status = 'pending'
            ";
            $params = [];
            if ($classId > 0) {
                $sql .= ' AND u.class_id = ?';
                $params[] = $classId;
            }
            $sql .= ' ORDER BY u.created_at ASC, u.name COLLATE NOCASE';
            $stmt = db()->prepare($sql);
            $stmt->execute($params);
            $rows = array_map(fn($r) => [
                'id'         => (int)$r['id'],
                'name'       => $r['name'],
                'username'   => $r['username'],
                'class_id'   => $r['class_id'] !== null ? (int)$r['class_id'] : null,
                'class_name' => $r['class_name'],
                'created_at' => $r['created_at'],
            ], $stmt->fetchAll());
            ok(['students' => $rows]);
        }

        // Jóváhagyás – egy vagy több diák (ids tömb vagy id)
        case 'approve': {
            $ids = int_list($in, 'ids');
            if (empty($ids) && int_param($in, 'id') > 0) {
                $ids = [int_param($in, 'id')];
            }
            if (empty($ids)) {
                fail('Nem választottál ki egyetlen diákot sem!');
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = db()->prepare("
                UPDATE users SET status = 'active'
                WHERE role = 'student' AND status = 'pending' AND id IN ($placeholders)
            ");
            $stmt->execute($ids);
            $count = $stmt->rowCount();
            ok([
                'approved' => $count,
                'message'  => $count === 1 ? '1 diák jóváhagyva.' : "$count diák jóváhagyva.",
            ]);
        }

        // Jóváhagyás minden függő diákra (opcionálisan egy osztályon belül)
        case 'approve_all': {
            $classId = int_param($in, 'class_id');
            $sql = "UPDATE users SET status = 'active' WHERE role = 'student' AND status = 'pending'";
            $params = [];
            if ($classId > 0) {
                $sql .= ' AND class_id = ?';
                $params[] = $classId;
            }
            $stmt = db()->prepare($sql);
            $stmt->execute($params);
            $count = $stmt->rowCount();
            ok(['approved' => $count, 'message' => "$count diák jóváhagyva."]);
        }

        // Függő regisztráció elutasítása (törlése)
        case 'reject': {
            $ids = int_list($in, 'ids');
            if (empty($ids) && int_param($in, 'id') > 0) {
                $ids = [int_param($in, 'id')];
            }
            if (empty($ids)) {
                fail('Nem választottál ki egyetlen diákot sem!');
            }
            $placeholders = implode(',', array_fill(0, count($ids), '?'));
            $stmt = db()->prepare("
                DELETE FROM users
                WHERE role = 'student' AND status = 'pending' AND id IN ($placeholders)
            ");
            $stmt->execute($ids);
            $count = $stmt->rowCount();
            ok(['rejected' => $count, 'message' => "$count regisztráció elutasítva."]);
        }

        // Osztályok listája létszámokkal
        case 'list_classes': {
            $rows = db()->query("
                SELECT c.id, c.name,
                    (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student' AND u.status = 'active') AS active_count,
                    (SELECT COUNT(*) FROM users u WHERE u.class_id = c.id AND u.role = 'student' AND u.status = 'pending') AS pending_count
                FROM classes c
                ORDER BY c.name COLLATE NOCASE
            ")->fetchAll();
            $classes = array_map(fn($r) => [
                'id'            => (int)$r['id'],
                'name'          => $r['name'],
                'active_count'  => (int)$r['active_count'],
                'pending_count' => (int)$r['pending_count'],
            ], $rows);
            ok(['classes' => $classes]);
        }

        // Új osztály felvétele
        case 'add_class': {
            $name = preg_replace('/\s+/u', '', str_param($in, 'name')) ?? '';
            if (ulen($name) < 1 || ulen($name) > 20) {
                fail('Az osztály neve 1–20 karakter legyen (pl. 5.c)!');
            }
            $stmt = db()->prepare('SELECT COUNT(*) FROM classes WHERE name = ? COLLATE NOCASE');
            $stmt->execute([$name]);
            if ((int)$stmt->fetchColumn() > 0) {
                fail('Ilyen nevű osztály már létezik!');
            }
            $stmt = db()->prepare('INSERT INTO classes (name) VALUES (?)');
            $stmt->execute([$name]);
            ok([
                'class'   => ['id' => (int)db()->lastInsertId(), 'name' => $name],
                'message' => "A(z) $name osztály létrehozva.",
            ]);
        }

        // Aktív diákok listája (jelszó-resethez, szűrhető osztályra)
        case 'list_students': {
            $classId = int_param($in, 'class_id');
            $sql = "
                SELECT u.id, u.name, u.username, u.class_id, c.name AS class_name
                FROM users u
                LEFT JOIN classes c ON c.id = u.class_id
                WHERE u.role = 'student' AND u.status = 'active'
            ";
            $params = [];
            if ($classId > 0) {
                $sql .= ' AND u.class_id = ?';
                $params[] = $classId;
            }
            $sql .= ' ORDER BY c.name COLLATE NOCASE, u.name COLLATE NOCASE';
            $stmt = db()->prepare($sql);
            $stmt->execute($params);
            $rows = array_map(fn($r) => [
                'id'         => (int)$r['id'],
                'name'       => $r['name'],
                'username'   => $r['username'],
                'class_id'   => $r['class_id'] !== null ? (int)$r['class_id'] : null,
                'class_name' => $r['class_name'],
            ], $stmt->fetchAll());
            ok(['students' => $rows]);
        }

        // Diák jelszavának visszaállítása
        case 'reset_password': {
            $studentId   = int_param($in, 'student_id');
            $newPassword = isset($in['new_password']) && is_string($in['new_password']) ? $in['new_password'] : '';
            if ($err = validate_password($newPassword)) {
                fail($err);
            }
            $stmt = db()->prepare("SELECT id, name FROM users WHERE id = ? AND role = 'student'");
            $stmt->execute([$studentId]);
            $student = $stmt->fetch();
            if (!$student) {
                fail('A kiválasztott diák nem található!', 404);
            }
            $stmt = db()->prepare('UPDATE users SET password_hash = ? WHERE id = ?');
            $stmt->execute([password_hash($newPassword, PASSWORD_DEFAULT), $studentId]);
            ok(['message' => $student['name'] . ' jelszava sikeresen megváltozott.']);
        }

        // Részletes statisztika osztályonként (class_id = 0 → minden osztály)
        case 'class_stats': {
            $classId = int_param($in, 'class_id');
            $sql = "
                SELECT u.id, u.name, u.username, u.xp, u.coins, u.class_id, c.name AS class_name
                FROM users u
                LEFT JOIN classes c ON c.id = u.class_id
                WHERE u.role = 'student' AND u.status = 'active'
            ";
            $params = [];
            if ($classId > 0) {
                $sql .= ' AND u.class_id = ?';
                $params[] = $classId;
            }
            $sql .= ' ORDER BY c.name COLLATE NOCASE, u.name COLLATE NOCASE';
            $stmt = db()->prepare($sql);
            $stmt->execute($params);
            $students = $stmt->fetchAll();

            // Az összes érintett előrehaladás egyetlen lekérdezéssel
            $progressByUser = [];
            if (!empty($students)) {
                $ids = array_map(fn($s) => (int)$s['id'], $students);
                $placeholders = implode(',', array_fill(0, count($ids), '?'));
                $pstmt = db()->prepare("SELECT * FROM progress WHERE user_id IN ($placeholders)");
                $pstmt->execute($ids);
                foreach ($pstmt->fetchAll() as $p) {
                    $progressByUser[(int)$p['user_id']][(int)$p['game_id']] = $p;
                }
            }

            $result = [];
            $summary = [
                'student_count' => count($students),
                'total_xp'      => 0,
                'total_coins'   => 0,
                'avg_xp'        => 0,
                'games'         => [],
            ];
            for ($g = GAME_MIN; $g <= GAME_MAX; $g++) {
                $summary['games'][$g] = ['level_sum' => 0, 'errors' => 0, 'completed' => 0, 'players' => 0];
            }

            foreach ($students as $s) {
                $uid = (int)$s['id'];
                $games = [];
                for ($g = GAME_MIN; $g <= GAME_MAX; $g++) {
                    $p = $progressByUser[$uid][$g] ?? null;
                    $games[] = [
                        'game_id'          => $g,
                        'difficulty_level' => $p ? (int)$p['difficulty_level'] : LEVEL_MIN,
                        'streak'           => $p ? (int)$p['streak'] : 0,
                        'total_completed'  => $p ? (int)$p['total_completed'] : 0,
                        'total_errors'     => $p ? (int)$p['total_errors'] : 0,
                        'started'          => $p !== null,
                    ];
                    if ($p) {
                        $summary['games'][$g]['level_sum'] += (int)$p['difficulty_level'];
                        $summary['games'][$g]['errors']    += (int)$p['total_errors'];
                        $summary['games'][$g]['completed'] += (int)$p['total_completed'];
                        $summary['games'][$g]['players']++;
                    }
                }
                $summary['total_xp']    += (int)$s['xp'];
                $summary['total_coins'] += (int)$s['coins'];
                $result[] = [
                    'id'         => $uid,
                    'name'       => $s['name'],
                    'username'   => $s['username'],
                    'class_id'   => $s['class_id'] !== null ? (int)$s['class_id'] : null,
                    'class_name' => $s['class_name'],
                    'xp'         => (int)$s['xp'],
                    'level'      => level_from_xp((int)$s['xp']),
                    'coins'      => (int)$s['coins'],
                    'games'      => $games,
                ];
            }

            if ($summary['student_count'] > 0) {
                $summary['avg_xp'] = (int)round($summary['total_xp'] / $summary['student_count']);
            }
            $gamesSummary = [];
            foreach ($summary['games'] as $g => $gs) {
                $gamesSummary[] = [
                    'game_id'   => $g,
                    'players'   => $gs['players'],
                    'avg_level' => $gs['players'] > 0 ? round($gs['level_sum'] / $gs['players'], 1) : 0,
                    'errors'    => $gs['errors'],
                    'completed' => $gs['completed'],
                ];
            }
            $summary['games'] = $gamesSummary;

            ok(['students' => $result, 'summary' => $summary]);
        }

        default:
            fail('Ismeretlen tanári művelet!');
    }
}

/**
 * Játékeredmény mentése.
 * Paraméterek: game_id (1–6), success (bool), errors (int), xp (int), coins (int)
 * Adaptív nehézség: STREAK_TO_UP egymás utáni hibátlan siker → szintlépés felfelé,
 * sikertelen kör vagy sok hiba → a sorozat nullázódik, és nagyon sok hibánál visszalép egy szintet.
 */
function action_save_progress(array $in): never
{
    $user    = require_student();
    $userId  = (int)$user['id'];
    $gameId  = int_param($in, 'game_id');
    $success = filter_var($in['success'] ?? false, FILTER_VALIDATE_BOOLEAN);
    $errors  = max(0, min(999, int_param($in, 'errors')));
    $xp      = max(0, min(MAX_XP_PER_SAVE, int_param($in, 'xp')));
    $coins   = max(0, min(MAX_COINS_PER_SAVE, int_param($in, 'coins')));

    if ($gameId < GAME_MIN || $gameId > GAME_MAX) {
        fail('Érvénytelen játék azonosító!');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        $stmt = $pdo->prepare('SELECT * FROM progress WHERE user_id = ? AND game_id = ?');
        $stmt->execute([$userId, $gameId]);
        $row = $stmt->fetch();

        if (!$row) {
            $ins = $pdo->prepare('INSERT INTO progress (user_id, game_id, difficulty_level, streak, total_completed, total_errors) VALUES (?, ?, 1, 0, 0, 0)');
            $ins->execute([$userId, $gameId]);
            $row = ['difficulty_level' => 1, 'streak' => 0, 'total_completed' => 0, 'total_errors' => 0];
        }

        $level     = (int)$row['difficulty_level'];
        $streak    = (int)$row['streak'];
        $completed = (int)$row['total_completed'];
        $totalErr  = (int)$row['total_errors'] + $errors;
        $levelUp   = false;
        $levelDown = false;

        if ($success) {
            $completed++;
            if ($errors === 0) {
                $streak++;
            } else {
                $streak = 0;
            }
            if ($streak >= STREAK_TO_UP && $level < LEVEL_MAX) {
                $level++;
                $streak = 0;
                $levelUp = true;
            }
        } else {
            $streak = 0;
            $xp     = 0;
            $coins  = 0;
        }

        if ($errors >= ERRORS_TO_DOWN && $level > LEVEL_MIN && !$levelUp) {
            $level--;
            $levelDown = true;
        }

        $upd = $pdo->prepare("
            UPDATE progress
            SET difficulty_level = ?, streak = ?, total_completed = ?, total_errors = ?,
                updated_at = datetime('now', 'localtime')
            WHERE user_id = ? AND game_id = ?
        ");
        $upd->execute([$level, $streak, $completed, $totalErr, $userId, $gameId]);

        // Szintlépési bónusz: a szerver írja jóvá, a mentési korláton felül
        $bonusXp    = $levelUp ? LEVEL_UP_BONUS_XP : 0;
        $bonusCoins = $levelUp ? LEVEL_UP_BONUS_COINS : 0;

        $oldLevel = level_from_xp((int)$user['xp']);
        $uupd = $pdo->prepare('UPDATE users SET xp = xp + ?, coins = coins + ? WHERE id = ?');
        $uupd->execute([$xp + $bonusXp, $coins + $bonusCoins, $userId]);

        $pdo->commit();
    } catch (Throwable $e) {
        $pdo->rollBack();
        fail('Nem sikerült menteni az eredményt. Próbáld újra!', 500);
    }

    $newAchievements = check_achievements($userId);
    $fresh = current_user();
    $newPlayerLevel = level_from_xp((int)$fresh['xp']);

    ok([
        'user'             => public_user($fresh),
        'progress'         => progress_for_user($userId),
        'earned'           => ['xp' => $xp, 'coins' => $coins],
        'bonus'            => ['xp' => $bonusXp, 'coins' => $bonusCoins],
        'difficulty_level' => $level,
        'difficulty_up'    => $levelUp,
        'difficulty_down'  => $levelDown,
        'player_level_up'  => $newPlayerLevel > $oldLevel,
        'player_level'     => $newPlayerLevel,
        'new_achievements' => $newAchievements,
    ]);
}

/** Saját előrehaladás lekérése (diák). */
function action_get_progress(): never
{
    $user = require_student();
    ok([
        'user'     => public_user($user),
        'progress' => progress_for_user((int)$user['id']),
    ]);
}

/** A bolt kínálata a diák szemszögéből (mi van már megvéve, mi van felszerelve). */
function action_shop_items(): never
{
    $user = require_student();
    $owned = unlocked_items($user);
    $items = [];
    foreach (SHOP_ITEMS as $id => $item) {
        if ($id === 'default') {
            continue;
        }
        $items[] = [
            'id'       => $id,
            'type'     => $item['type'],
            'name'     => $item['name'],
            'price'    => $item['price'],
            'owned'    => in_array($id, $owned, true),
            'equipped' => $user['equipped_bg'] === $id || $user['equipped_folder'] === $id,
        ];
    }
    ok(['items' => $items, 'coins' => (int)$user['coins']]);
}

/** Tárgy megvásárlása (és opcionálisan azonnali felszerelése). */
function action_buy_item(array $in): never
{
    $user   = require_student();
    $itemId = str_param($in, 'item_id');
    $equip  = filter_var($in['equip'] ?? true, FILTER_VALIDATE_BOOLEAN);

    if (!isset(SHOP_ITEMS[$itemId]) || $itemId === 'default') {
        fail('Ilyen tárgy nincs a boltban!');
    }
    $item  = SHOP_ITEMS[$itemId];
    $owned = unlocked_items($user);

    if (in_array($itemId, $owned, true)) {
        fail('Ez már a tiéd! A felszereléshez használd a „Felszerelem” gombot.');
    }

    $pdo = db();
    $pdo->beginTransaction();
    try {
        // Friss egyenleg a tranzakción belül (dupla kattintás ellen)
        $stmt = $pdo->prepare('SELECT coins, unlocked_items_json FROM users WHERE id = ?');
        $stmt->execute([(int)$user['id']]);
        $row = $stmt->fetch();
        $coins = (int)$row['coins'];
        $ownedNow = unlocked_items(['unlocked_items_json' => $row['unlocked_items_json']]);

        if (in_array($itemId, $ownedNow, true)) {
            $pdo->rollBack();
            fail('Ez már a tiéd!');
        }
        if ($coins < $item['price']) {
            $pdo->rollBack();
            fail('Nincs elég Bájt-érméd! Még ' . ($item['price'] - $coins) . ' érme hiányzik.');
        }

        $ownedNow[] = $itemId;
        $sql = 'UPDATE users SET coins = coins - ?, unlocked_items_json = ?';
        $params = [$item['price'], json_encode(array_values($ownedNow))];
        if ($equip && $item['type'] === 'bg') {
            $sql .= ', equipped_bg = ?';
            $params[] = $itemId;
        } elseif ($equip && $item['type'] === 'folder') {
            $sql .= ', equipped_folder = ?';
            $params[] = $itemId;
        }
        $sql .= ' WHERE id = ?';
        $params[] = (int)$user['id'];
        $upd = $pdo->prepare($sql);
        $upd->execute($params);

        $pdo->commit();
    } catch (Throwable $e) {
        if ($pdo->inTransaction()) {
            $pdo->rollBack();
        }
        fail('A vásárlás nem sikerült. Próbáld újra!', 500);
    }

    $newAchievements = check_achievements((int)$user['id']);

    ok([
        'user'             => public_user(current_user()),
        'message'          => 'Megvetted: ' . $item['name'] . '!',
        'new_achievements' => $newAchievements,
    ]);
}

/** Már megvásárolt tárgy felszerelése (vagy visszaállítás alapértelmezettre). */
function action_equip_item(array $in): never
{
    $user   = require_student();
    $itemId = str_param($in, 'item_id');
    $slot   = str_param($in, 'slot'); // 'bg' vagy 'folder' – az alapértelmezetthez kell

    if (!isset(SHOP_ITEMS[$itemId])) {
        fail('Ilyen tárgy nem létezik!');
    }
    if (!in_array($itemId, unlocked_items($user), true)) {
        fail('Ezt még nem vásároltad meg!');
    }

    $type = SHOP_ITEMS[$itemId]['type'];
    if ($type === 'both') {
        $type = $slot;
    }
    if ($type === 'bg') {
        $stmt = db()->prepare('UPDATE users SET equipped_bg = ? WHERE id = ?');
    } elseif ($type === 'folder') {
        $stmt = db()->prepare('UPDATE users SET equipped_folder = ? WHERE id = ?');
    } else {
        fail('Add meg, hogy hátteret vagy mappát szeretnél beállítani!');
    }
    $stmt->execute([$itemId, (int)$user['id']]);

    ok(['user' => public_user(current_user()), 'message' => 'Beállítva!']);
}

// ---------------------------------------------------------------------------
// Útválasztás
// ---------------------------------------------------------------------------

$input  = read_input();
$action = str_param($input, 'action');

// Az írási műveletek csak POST kéréssel engedélyezettek
$postOnly = ['register', 'login', 'logout', 'teacher_actions', 'save_progress', 'buy_item', 'equip_item'];
if (in_array($action, $postOnly, true) && ($_SERVER['REQUEST_METHOD'] ?? 'GET') !== 'POST') {
    fail('Ezt a műveletet csak POST kéréssel lehet meghívni.', 405);
}

try {
    switch ($action) {
        case 'get_classes':     action_get_classes();
        case 'register':        action_register($input);
        case 'login':           action_login($input);
        case 'logout':          action_logout();
        case 'check_session':   action_check_session();
        case 'teacher_actions': action_teacher_actions($input);
        case 'save_progress':   action_save_progress($input);
        case 'get_progress':    action_get_progress();
        case 'shop_items':      action_shop_items();
        case 'buy_item':        action_buy_item($input);
        case 'equip_item':      action_equip_item($input);
        default:                fail('Ismeretlen művelet: ' . ($action === '' ? '(üres)' : $action), 404);
    }
} catch (PDOException $e) {
    error_log('Fájl-Kaland adatbázis hiba: ' . $e->getMessage());
    fail('Adatbázis hiba történt. Kérlek, szólj a tanárodnak!', 500);
} catch (Throwable $e) {
    error_log('Fájl-Kaland hiba: ' . $e->getMessage());
    fail('Váratlan hiba történt. Próbáld újra!', 500);
}
