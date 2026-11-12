const express = require('express');
const multer = require('multer');
const { Pool } = require('pg');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const UPLOAD_DIR = process.env.UPLOAD_DIR || '/data/uploads';
const MAX_MB = Number(process.env.MAX_UPLOAD_MB || 10);
const ALLOW_REG = (process.env.ALLOW_REGISTRATION ?? 'true') !== 'false';
const SECURE_COOKIE = process.env.COOKIE_SECURE === 'true';
const SESSION_DAYS = 30;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const pool = new Pool(); // legge PGHOST, PGUSER, PGPASSWORD, PGDATABASE dall'ambiente

const COLORS = ['bianco', 'verde', 'blu', 'giallo', 'arancione', 'rosso', 'viola'];
const FONT = ['4', '5', '5+', '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+', '8a'];
const GRADES = [...COLORS, ...FONT];
const STYLES = ['flash', 'top', 'fail'];
const HOLD_TYPES = ['start', 'mid', 'top'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL, password_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash TEXT PRIMARY KEY, user_id INT NOT NULL REFERENCES users ON DELETE CASCADE,
  expires_at TIMESTAMPTZ NOT NULL);
CREATE TABLE IF NOT EXISTS walls (
  id SERIAL PRIMARY KEY, name TEXT NOT NULL, image_url TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS boulders (
  id SERIAL PRIMARY KEY, wall_id INT NOT NULL REFERENCES walls ON DELETE CASCADE,
  name TEXT NOT NULL, grade TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS holds (
  id SERIAL PRIMARY KEY, boulder_id INT NOT NULL REFERENCES boulders ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('start','mid','top')),
  x DOUBLE PRECISION NOT NULL CHECK (x BETWEEN 0 AND 100),
  y DOUBLE PRECISION NOT NULL CHECK (y BETWEEN 0 AND 100),
  seq INT NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (
  id SERIAL PRIMARY KEY, date DATE NOT NULL, gym TEXT NOT NULL DEFAULT 'Climbo Pisa',
  notes TEXT NOT NULL DEFAULT '', created_at TIMESTAMPTZ NOT NULL DEFAULT now());
CREATE TABLE IF NOT EXISTS logs (
  id SERIAL PRIMARY KEY, session_id INT NOT NULL REFERENCES sessions ON DELETE CASCADE,
  boulder_id INT REFERENCES boulders ON DELETE SET NULL,
  name TEXT NOT NULL DEFAULT '', grade TEXT NOT NULL,
  style TEXT NOT NULL CHECK (style IN ('flash','top','fail')),
  attempts INT NOT NULL DEFAULT 1 CHECK (attempts >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now());
-- multi-utente (migrazione sicura per database creati prima del login)
ALTER TABLE walls    ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users ON DELETE CASCADE;
ALTER TABLE boulders ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users ON DELETE CASCADE;
ALTER TABLE boulders ADD COLUMN IF NOT EXISTS image_url TEXT; -- foto dedicata alla singola via (facoltativa)
ALTER TABLE sessions ADD COLUMN IF NOT EXISTS user_id INT REFERENCES users ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS idx_logs_session ON logs(session_id);
CREATE INDEX IF NOT EXISTS idx_holds_boulder ON holds(boulder_id);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_boulders_user ON boulders(user_id);
`;

async function initDb() {
  for (let i = 1; i <= 20; i++) {
    try {
      await pool.query(SCHEMA);
      await pool.query('DELETE FROM auth_sessions WHERE expires_at < now()');
      const { rows } = await pool.query('SELECT 1 FROM walls WHERE user_id IS NULL LIMIT 1');
      if (!rows.length) { // parete demo condivisa (user_id NULL): visibile a tutti
        await pool.query("INSERT INTO walls(name, image_url) VALUES ('Parete demo', '/samples/wall-demo.svg')");
      }
      return;
    } catch (e) {
      console.log(`DB non pronto (${i}/20): ${e.message}`);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
  throw new Error('Database non raggiungibile');
}

const bad = (msg, status = 400) => Object.assign(new Error(msg), { status });
const wrap = fn => (req, res, next) => fn(req, res, next).catch(next);
const str = (v, max) => String(v ?? '').trim().slice(0, max);
const rmFile = async url => {
  if (url && url.startsWith('/uploads/')) await fs.promises.unlink(path.join(UPLOAD_DIR, path.basename(url))).catch(() => {});
};

/* ---------- Autenticazione: password scrypt + cookie di sessione httpOnly ---------- */
const sha = t => crypto.createHash('sha256').update(t).digest('hex');
const scrypt = (pw, salt) => new Promise((ok, ko) => crypto.scrypt(pw, salt, 64, (e, k) => (e ? ko(e) : ok(k))));
const hashPw = async pw => { const salt = crypto.randomBytes(16); return salt.toString('hex') + ':' + (await scrypt(pw, salt)).toString('hex'); };
const checkPw = async (pw, stored) => {
  const [s, h] = stored.split(':'); const k = await scrypt(pw, Buffer.from(s, 'hex')); const hb = Buffer.from(h, 'hex');
  return hb.length === k.length && crypto.timingSafeEqual(hb, k);
};
const parseCookies = h => Object.fromEntries((h || '').split(';').map(c => c.trim().split('=')).filter(p => p[0])
  .map(([k, ...v]) => [k, decodeURIComponent(v.join('='))]));
const setCookie = (res, token, maxAge) => res.setHeader('Set-Cookie',
  `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${maxAge}${SECURE_COOKIE ? '; Secure' : ''}`);

async function startSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  await pool.query(`INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ($1, $2, now() + interval '${SESSION_DAYS} days')`, [sha(token), userId]);
  setCookie(res, token, SESSION_DAYS * 86400);
}

const requireAuth = wrap(async (req, res, next) => {
  const t = parseCookies(req.headers.cookie).sid;
  if (t) {
    const { rows } = await pool.query(
      'SELECT u.id, u.name, u.email FROM auth_sessions a JOIN users u ON u.id = a.user_id WHERE a.token_hash = $1 AND a.expires_at > now()', [sha(t)]);
    if (rows[0]) { req.user = rows[0]; return next(); }
  }
  res.status(401).json({ error: 'Accedi per continuare' });
});

// limite tentativi di login: 10 errori / 15 minuti per IP+email
const attempts = new Map();
const recent = k => (attempts.get(k) || []).filter(t => Date.now() - t < 15 * 60 * 1000);
setInterval(() => attempts.clear(), 15 * 60 * 1000).unref();

const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (req, file, cb) => {
      const ext = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp' }[file.mimetype];
      cb(null, crypto.randomUUID() + ext);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024 },
  fileFilter: (req, file, cb) =>
    ['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype) ? cb(null, true) : cb(bad('Formato non valido: usa JPG, PNG o WebP')),
});

const app = express();
app.use(express.json({ limit: '1mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/meta', (req, res) => res.json({ font: FONT, colors: COLORS, styles: STYLES, registration: ALLOW_REG }));

app.post('/api/auth/register', wrap(async (req, res) => {
  if (!ALLOW_REG) throw bad('Le registrazioni sono chiuse', 403);
  const name = str(req.body.name, 60), email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password ?? '');
  if (!name) throw bad('Inserisci il tuo nome');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw bad('Email non valida');
  if (password.length < 8 || password.length > 200) throw bad('La password deve avere almeno 8 caratteri');
  const first = (await pool.query('SELECT 1 FROM users LIMIT 1')).rowCount === 0;
  let user;
  try {
    user = (await pool.query('INSERT INTO users(email, name, password_hash) VALUES ($1,$2,$3) RETURNING id, name, email',
      [email, name, await hashPw(password)])).rows[0];
  } catch (e) { if (e.code === '23505') throw bad('Esiste già un account con questa email'); throw e; }
  if (first) { // il primo account eredita i dati creati prima dell'introduzione del login
    await pool.query("UPDATE walls SET user_id = $1 WHERE user_id IS NULL AND image_url LIKE '/uploads/%'", [user.id]);
    await pool.query('UPDATE boulders SET user_id = $1 WHERE user_id IS NULL', [user.id]);
    await pool.query('UPDATE sessions SET user_id = $1 WHERE user_id IS NULL', [user.id]);
  }
  await startSession(res, user.id);
  res.status(201).json({ user });
}));

app.post('/api/auth/login', wrap(async (req, res) => {
  const email = str(req.body.email, 120).toLowerCase(), password = String(req.body.password ?? '');
  const key = req.ip + '|' + email;
  if (recent(key).length >= 10) throw bad('Troppi tentativi. Riprova tra qualche minuto', 429);
  const u = (await pool.query('SELECT * FROM users WHERE email = $1', [email])).rows[0];
  if (!u || !(await checkPw(password, u.password_hash))) {
    attempts.set(key, [...recent(key), Date.now()]);
    throw bad('Email o password non corretti', 401);
  }
  attempts.delete(key);
  await startSession(res, u.id);
  res.json({ user: { id: u.id, name: u.name, email: u.email } });
}));

app.post('/api/auth/logout', wrap(async (req, res) => {
  const t = parseCookies(req.headers.cookie).sid;
  if (t) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [sha(t)]);
  setCookie(res, '', 0);
  res.status(204).end();
}));

app.get('/api/auth/me', requireAuth, (req, res) => res.json({ user: req.user }));

// Da qui in poi tutto richiede il login (foto comprese)
app.use('/uploads', requireAuth, express.static(UPLOAD_DIR, { maxAge: '7d', immutable: true }));
app.use('/api', requireAuth);

// ---------- Pareti (foto) ----------
app.get('/api/walls', wrap(async (req, res) => {
  res.json((await pool.query('SELECT id, name, image_url FROM walls WHERE user_id = $1 OR user_id IS NULL ORDER BY id', [req.user.id])).rows);
}));

app.post('/api/walls', upload.single('image'), wrap(async (req, res) => {
  if (!req.file) throw bad('Nessuna immagine ricevuta');
  const name = str(req.body.name, 80) || 'Parete senza nome';
  const { rows } = await pool.query(
    'INSERT INTO walls(name, image_url, user_id) VALUES ($1, $2, $3) RETURNING id, name, image_url', [name, '/uploads/' + req.file.filename, req.user.id]);
  res.status(201).json(rows[0]);
}));

app.delete('/api/walls/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Parete non valida');
  const { rows } = await pool.query('SELECT image_url FROM walls WHERE id = $1 AND user_id = $2', [id, req.user.id]);
  if (!rows.length) throw bad('Parete non trovata o non eliminabile', 404);
  const own = (await pool.query('SELECT image_url FROM boulders WHERE wall_id = $1 AND image_url IS NOT NULL', [id])).rows;
  await pool.query('DELETE FROM walls WHERE id = $1', [id]); // a cascata blocchi e prese; le salite restano nelle sessioni
  await Promise.all([rows[0].image_url, ...own.map(b => b.image_url)].map(rmFile)); // foto parete + foto delle singole vie
  res.status(204).end();
}));

// ---------- Blocchi personalizzati con prese (x,y in %) ----------
const boulderQuery = (id, uid) => pool.query(`
  SELECT b.id, b.wall_id, b.name, b.grade, COALESCE(b.image_url, w.image_url) AS image_url,
    (b.image_url IS NOT NULL) AS own_photo, w.name AS wall_name,
    COALESCE(json_agg(json_build_object('type', h.type, 'x', h.x, 'y', h.y) ORDER BY h.seq)
             FILTER (WHERE h.id IS NOT NULL), '[]') AS holds,
    (SELECT count(*)::int FROM logs l WHERE l.boulder_id = b.id) AS n_logs,
    (SELECT CASE WHEN bool_or(l.style = 'flash') THEN 'flash' WHEN bool_or(l.style = 'top') THEN 'top'
                 WHEN count(*) > 0 THEN 'fail' END FROM logs l WHERE l.boulder_id = b.id) AS best
  FROM boulders b JOIN walls w ON w.id = b.wall_id LEFT JOIN holds h ON h.boulder_id = b.id
  WHERE b.user_id = $2 AND ($1::int IS NULL OR b.id = $1::int)
  GROUP BY b.id, w.id ORDER BY b.id DESC`, [id, uid]);

app.get('/api/boulders', wrap(async (req, res) => res.json((await boulderQuery(null, req.user.id)).rows)));

app.get('/api/boulders/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Blocco non valido');
  const b = (await boulderQuery(id, req.user.id)).rows[0];
  if (!b) throw bad('Blocco non trovato', 404);
  b.logs = (await pool.query(`
    SELECT l.id, l.style, l.attempts, to_char(s.date, 'YYYY-MM-DD') AS date, s.gym
    FROM logs l JOIN sessions s ON s.id = l.session_id
    WHERE l.boulder_id = $1 AND s.user_id = $2 ORDER BY s.date DESC, l.id DESC`, [id, req.user.id])).rows;
  res.json(b);
}));

app.post('/api/boulders', upload.single('image'), wrap(async (req, res) => {
  // multipart: campi di testo + holds (JSON) + foto opzionale della singola via
  const photo = req.file ? '/uploads/' + req.file.filename : null;
  try {
    let holds = req.body.holds;
    if (typeof holds === 'string') { try { holds = JSON.parse(holds); } catch { throw bad('Prese non valide'); } }
    const wall_id = Number(req.body.wall_id);
    const name = str(req.body.name, 80), grade = str(req.body.grade, 12);
    if (!name) throw bad('Dai un nome al blocco');
    if (!GRADES.includes(grade)) throw bad('Grado non valido');
    if (!Number.isInteger(wall_id)) throw bad('Parete inesistente');
    if (!Array.isArray(holds) || holds.length < 2 || holds.length > 60) throw bad('Posiziona almeno una presa di partenza e una di arrivo');
    for (const h of holds) {
      if (!HOLD_TYPES.includes(h.type) || !(h.x >= 0 && h.x <= 100) || !(h.y >= 0 && h.y <= 100)) throw bad('Presa non valida');
    }
    if (!holds.some(h => h.type === 'start') || !holds.some(h => h.type === 'top')) throw bad('Servono almeno una presa Start e una Top');

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const wall = await client.query('SELECT 1 FROM walls WHERE id = $1 AND (user_id = $2 OR user_id IS NULL)', [wall_id, req.user.id]);
      if (!wall.rowCount) throw bad('Parete inesistente');
      const b = await client.query('INSERT INTO boulders(wall_id, name, grade, user_id, image_url) VALUES ($1,$2,$3,$4,$5) RETURNING id',
        [wall_id, name, grade, req.user.id, photo]);
      for (const [i, h] of holds.entries()) {
        await client.query('INSERT INTO holds(boulder_id, type, x, y, seq) VALUES ($1,$2,$3,$4,$5)', [b.rows[0].id, h.type, h.x, h.y, i]);
      }
      await client.query('COMMIT');
      res.status(201).json({ id: b.rows[0].id });
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  } catch (e) { await rmFile(photo); throw e; } // niente foto orfane se qualcosa va storto
}));

app.delete('/api/boulders/:id', wrap(async (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) throw bad('Blocco non valido');
  const { rows } = await pool.query('DELETE FROM boulders WHERE id = $1 AND user_id = $2 RETURNING image_url', [id, req.user.id]);
  if (rows[0]) await rmFile(rows[0].image_url); // elimina anche la foto dedicata alla via
  res.status(204).end();
}));

// ---------- Sessioni e log ----------
app.get('/api/sessions', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT s.id, to_char(s.date, 'YYYY-MM-DD') AS date, s.gym, s.notes,
      COALESCE((SELECT json_agg(l ORDER BY l.id) FROM logs l WHERE l.session_id = s.id), '[]') AS logs
    FROM sessions s WHERE s.user_id = $1 ORDER BY s.date DESC, s.id DESC`, [req.user.id]);
  res.json(rows);
}));

app.post('/api/sessions', wrap(async (req, res) => {
  const date = str(req.body.date, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw bad('Data non valida');
  const { rows } = await pool.query(
    'INSERT INTO sessions(date, gym, notes, user_id) VALUES ($1,$2,$3,$4) RETURNING id',
    [date, str(req.body.gym, 80) || 'Climbo Pisa', str(req.body.notes, 1000), req.user.id]);
  res.status(201).json(rows[0]);
}));

app.delete('/api/sessions/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  res.status(204).end();
}));

app.post('/api/sessions/:id/logs', wrap(async (req, res) => {
  const grade = str(req.body.grade, 12), style = str(req.body.style, 5);
  if (!GRADES.includes(grade)) throw bad('Grado non valido');
  if (!STYLES.includes(style)) throw bad('Stile non valido');
  let attempts = Math.max(1, Math.min(999, parseInt(req.body.attempts, 10) || 1));
  if (style === 'flash') attempts = 1;
  const s = await pool.query('SELECT 1 FROM sessions WHERE id = $1 AND user_id = $2', [req.params.id, req.user.id]);
  if (!s.rowCount) throw bad('Sessione inesistente', 404);
  let name = str(req.body.name, 80), boulderId = null;
  if (req.body.boulder_id) {
    const b = await pool.query('SELECT id, name FROM boulders WHERE id = $1 AND user_id = $2', [req.body.boulder_id, req.user.id]);
    if (b.rowCount) { boulderId = b.rows[0].id; name = b.rows[0].name; }
  }
  const { rows } = await pool.query(
    'INSERT INTO logs(session_id, boulder_id, name, grade, style, attempts) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
    [req.params.id, boulderId, name, grade, style, attempts]);
  res.status(201).json(rows[0]);
}));

app.delete('/api/logs/:id', wrap(async (req, res) => {
  await pool.query('DELETE FROM logs WHERE id = $1 AND session_id IN (SELECT id FROM sessions WHERE user_id = $2)', [req.params.id, req.user.id]);
  res.status(204).end();
}));

// ---------- Statistiche ----------
app.get('/api/stats', wrap(async (req, res) => {
  const { rows } = await pool.query(`
    SELECT l.grade, count(*) FILTER (WHERE l.style='flash')::int AS flash,
           count(*) FILTER (WHERE l.style='top')::int AS top,
           count(*) FILTER (WHERE l.style='fail')::int AS fail
    FROM logs l JOIN sessions s ON s.id = l.session_id WHERE s.user_id = $1 GROUP BY l.grade`, [req.user.id]);
  const byGrade = GRADES.map(g => rows.find(r => r.grade === g) || { grade: g, flash: 0, top: 0, fail: 0 });
  const sum = k => byGrade.reduce((a, r) => a + r[k], 0);
  const sessions = (await pool.query('SELECT count(*)::int AS n FROM sessions WHERE user_id = $1', [req.user.id])).rows[0].n;
  const flash = sum('flash'), top = sum('top'), fail = sum('fail');
  const tried = flash + top + fail;
  res.json({
    sessions, flash, top, fail, tried, sends: flash + top,
    flashRate: tried ? Math.round((flash / tried) * 100) : 0,
    hardest: [...byGrade].reverse().find(r => r.flash + r.top > 0)?.grade || null,
    byGrade,
  });
}));

app.use('/api', (req, res) => res.status(404).json({ error: 'Rotta non trovata' }));
app.use((err, req, res, next) => {
  const status = err.status || (err.code === 'LIMIT_FILE_SIZE' ? 400 : 500);
  if (status === 500) console.error(err);
  res.status(status).json({ error: err.code === 'LIMIT_FILE_SIZE' ? `Immagine troppo grande (max ${MAX_MB} MB)` : status === 500 ? 'Errore interno' : err.message });
});

initDb().then(() => app.listen(3000, () => console.log('Climbo Logbook su :3000'))).catch(e => { console.error(e); process.exit(1); });
