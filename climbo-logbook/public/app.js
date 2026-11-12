/* Climbo Pisa Logbook – frontend vanilla JS */
const $ = s => document.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const today = () => new Date().toISOString().slice(0, 10);
const fmtDate = d => new Date(d + 'T12:00:00').toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
const cap = s => s[0].toUpperCase() + s.slice(1);
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

const api = async (url, opt = {}) => {
  const r = await fetch('/api' + url, opt);
  const d = r.status === 204 ? {} : await r.json().catch(() => ({}));
  if (r.status === 401 && !url.startsWith('/auth/')) { ME = null; showAuth(); throw new Error(d.error || 'Accedi per continuare'); }
  if (!r.ok) throw new Error(d.error || 'Qualcosa è andato storto');
  return d;
};
const send = (url, body) => api(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const put = (url, body) => api(url, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const del = url => api(url, { method: 'DELETE' });

let toastTimer;
const toast = msg => {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 2800);
};
const sheet = html => { $('#dlg').innerHTML = html; $('#dlg').showModal(); };
$('#dlg').addEventListener('click', e => { if (e.target.id === 'dlg') e.target.close(); });

const HEX = { start: '#30d158', mid: '#0a84ff', top: '#ff453a' };
const TOOLS = { start: 'Start', mid: 'Intermedia', top: 'Top' };
const STYLE = { flash: 'Flash', top: 'Top', fail: 'Tentativo' };
const GCOL = { bianco: '#f5f5f7', verde: '#30d158', blu: '#0a84ff', giallo: '#ffd60a', arancione: '#ff9f0a', rosso: '#ff453a', viola: '#bf5af2' };
const TRASH = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>';

let META = { font: [], colors: [], registration: false };
let ME = null;
let OPEN = null;
let PREV = 'tracer';
const TABS = { sessions: 'Sessioni', tracer: 'Traccia', vie: 'Le tue vie', stats: 'Statistiche', contest: 'Contest' };
const T = { wallId: null, tool: 'start', holds: [], mode: 'wall', photo: null, photoUrl: null, wall: null };

const grade = g => GCOL[g] ? `<span class="grade"><i style="background:${GCOL[g]}"></i>${cap(g)}</span>` : `<span class="grade">${esc(g)}</span>`;
const gradeOpts = (sel = '') =>
  `<option value="" disabled ${sel ? '' : 'selected'}>Grado</option>
   <optgroup label="Scala Font">${META.font.map(g => `<option ${g === sel ? 'selected' : ''}>${g}</option>`).join('')}</optgroup>
   <optgroup label="Colori palestra">${META.colors.map(g => `<option value="${g}" ${g === sel ? 'selected' : ''}>${cap(g)}</option>`).join('')}</optgroup>`;
const attemptOpts = Array.from({ length: 30 }, (_, i) => `<option value="${i + 1}">${plural(i + 1, 'tentativo', 'tentativi')}</option>`).join('');
const head = (title, right = '') => `<div class="flex items-end justify-between gap-3 mb-5"><h1 class="title">${title}</h1>${right}</div>`;
const canManage = () => !!ME?.isAdmin;
const canEditBoulder = b => !!ME && (ME.isAdmin || b.author_id === ME.id);

const markers = holds => holds.map((h, i) =>
  `<span class="marker" data-i="${i}" style="left:${h.x}%;top:${h.y}%;border-color:${HEX[h.type]};background:${HEX[h.type]}55"></span>`).join('');

const boulderCard = (b, withWall = false) => `
  <a href="#boulder/${b.id}" class="card overflow-hidden block" style="text-decoration:none;color:inherit">
    <div class="thumb relative"><img src="${esc(b.image_url)}" alt="" class="block w-full h-auto"><div class="absolute inset-0">${markers(b.holds)}</div></div>
    <div class="p-3"><div class="flex items-center gap-2">${grade(b.grade)}<span class="flex-1 truncate text-sm font-medium">${esc(b.name)}</span></div>
      <div class="flex items-center gap-2 mt-2"><span class="chip ${b.best || 'fail'}">${b.best ? STYLE[b.best] : 'Da fare'}</span>
        <span class="sub text-xs truncate">@${esc(b.author || 'anonimo')}</span>
        ${withWall ? `<span class="sub text-xs truncate">· ${esc(b.wall_name)}</span>` : ''}</div></div></a>`;

/* ===================== SESSIONI ===================== */
async function viewSessions() {
  const [sessions, boulders] = await Promise.all([api('/sessions'), api('/boulders')]);

  const row = l => `
    <li class="sep flex items-center gap-3 py-3">
      ${grade(l.grade)}
      <div class="flex-1 min-w-0">
        <div class="truncate font-medium">${l.boulder_id
          ? `<a class="link" href="#boulder/${l.boulder_id}">${esc(l.name)} ›</a>`
          : (esc(l.name) || '<span class="sub">Blocco libero</span>')}</div>
        <div class="flex items-center gap-2 mt-1"><span class="chip ${l.style}">${STYLE[l.style]}</span>
          <span class="sub text-xs">${plural(l.attempts, 'tentativo', 'tentativi')}</span></div>
      </div>
      <button class="icon" data-del-log="${l.id}" aria-label="Elimina blocco">${TRASH}</button>
    </li>`;

  const card = s => `
  <article class="card p-5">
    <div class="flex items-start justify-between gap-3">
      <div><h2 class="text-xl font-bold capitalize" style="letter-spacing:-.025em">${fmtDate(s.date)}</h2>
        <p class="sub text-sm mt-0.5">${esc(s.gym)}${s.notes ? ' · ' + esc(s.notes) : ''}</p></div>
      <button class="icon" data-del-session="${s.id}" aria-label="Elimina sessione">${TRASH}</button>
    </div>
    <ul class="mt-3">${s.logs.map(row).join('') || '<li class="sep py-3 sub text-sm">Nessun blocco registrato.</li>'}</ul>
    <details class="sep pt-3" ${OPEN === s.id ? 'open' : ''}>
      <summary class="link">+ Aggiungi blocco</summary>
      <form data-log="${s.id}" class="grid gap-2 mt-3">
        <select name="boulder_id" class="field" aria-label="Blocco">
          <option value="">Blocco libero</option>
          ${boulders.map(b => `<option value="${b.id}" data-grade="${b.grade}">${esc(b.name)} · @${esc(b.author || 'anonimo')} (${GCOL[b.grade] ? cap(b.grade) : b.grade})</option>`).join('')}
        </select>
        <div data-freename><input name="name" class="field" placeholder="Nome della via (facoltativo)" maxlength="80" aria-label="Nome della via"></div>
        <select name="grade" class="field" aria-label="Grado">${gradeOpts()}</select>
        <div class="grid grid-cols-2 gap-2">
          <select name="style" class="field" aria-label="Stile"><option value="flash">Flash</option><option value="top" selected>Top</option><option value="fail">Tentativo</option></select>
          <select name="attempts" class="field" aria-label="Numero di tentativi">${attemptOpts}</select>
        </div>
        <button class="btn mt-1">Aggiungi alla sessione</button>
      </form>
    </details>
  </article>`;

  $('#app').innerHTML = head('Sessioni', '<button class="btn sm" data-new-session>Nuova sessione</button>') +
    `<div class="grid gap-4">${sessions.map(card).join('') ||
      '<div class="card p-8 text-center sub">Nessuna sessione. Creane una e registra i tuoi blocchi.</div>'}</div>`;
}

const newSessionSheet = () => sheet(`
  <form data-session class="grid gap-3">
    <h2 class="text-xl font-bold">Nuova sessione</h2>
    <input name="date" type="date" value="${today()}" required class="field" aria-label="Data">
    <input name="gym" value="Climbo Pisa" placeholder="Palestra / settore" class="field" aria-label="Palestra">
    <input name="notes" placeholder="Note" class="field" aria-label="Note">
    <div class="flex gap-2 mt-1"><button type="button" class="btn sec flex-1" data-close>Annulla</button><button class="btn flex-1">Crea</button></div>
  </form>`);

/* ===================== TRACCIA BLOCCO ===================== */
async function viewTracer() {
  const [walls, boulders] = await Promise.all([api('/walls'), api('/boulders')]);
  if (!walls.find(w => w.id === T.wallId)) { T.wallId = walls[0]?.id; T.holds = []; }
  const wall = walls.find(w => w.id === T.wallId);
  const mine = boulders.filter(b => b.wall_id === T.wallId);

  $('#app').innerHTML = head('Traccia') + `
  <div class="grid lg:grid-cols-[1fr_330px] gap-5">
    <section class="grid gap-3 content-start">
      <div class="flex gap-2 flex-wrap">
        <select id="wallSel" class="field flex-1 min-w-[160px]" aria-label="Parete">${walls.map(w => `<option value="${w.id}" ${w.id === T.wallId ? 'selected' : ''}>${esc(w.name)}</option>`).join('')}</select>
        ${canManage()
          ? `<button class="btn sec sm whitespace-nowrap" data-new-wall>Nuova parete</button>
             <button class="btn sec sm whitespace-nowrap" data-rephoto-wall="${T.wallId}">Cambia foto</button>`
          : ''}
        ${canManage() && wall && wall.image_url.startsWith('/uploads/')
          ? `<button class="icon" data-del-wall="${wall.id}" aria-label="Elimina parete">${TRASH}</button>` : ''}
      </div>
      ${canManage() ? '<p class="sub text-xs px-1">Solo admin: puoi caricare la foto della parete e ritracciarla. Le vie con foto personale non vengono cancellate al cambio foto.</p>' : ''}
      <div class="seg" role="group" aria-label="Foto da usare">
        <button data-mode="wall" class="${T.mode === 'wall' ? 'on' : ''}">Parete intera</button>
        <button data-mode="own" class="${T.mode === 'own' ? 'on' : ''}">Foto della via</button>
      </div>
      <div class="seg" role="group" aria-label="Tipo di presa">
        ${Object.entries(TOOLS).map(([k, l]) => `<button data-tool="${k}" class="${T.tool === k ? 'on' : ''}"><i style="background:${HEX[k]}"></i>${l}</button>`).join('')}
      </div>
      <div id="stageWrap"></div>
      <p class="sub text-sm px-1">Tocca la foto per posizionare la presa. Tocca un cerchio per rimuoverlo. <span id="count"></span></p>
    </section>
    <aside class="card p-5 grid gap-3 content-start">
      <input id="bName" class="field" placeholder="Nome del blocco" maxlength="80" aria-label="Nome blocco">
      <select id="bGrade" class="field" aria-label="Grado stimato">${gradeOpts()}</select>
      <div class="flex gap-2"><button id="undo" class="btn sec sm flex-1">Annulla ultima</button><button id="clear" class="btn sec sm flex-1">Svuota</button></div>
      <button id="save" class="btn">Salva blocco</button>
      <p class="sub text-xs">La via sarà pubblica e visibile a tutti con il tuo username.</p>
    </aside>
  </div>
  <h2 class="text-2xl font-bold mt-10 mb-4" style="letter-spacing:-.025em">Vie su ${wall ? esc(wall.name) : 'questa parete'} <span class="sub font-medium text-lg">${mine.length}</span></h2>
  <div class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3">
    ${mine.map(b => boulderCard(b)).join('')
      || '<p class="sub col-span-full">Nessuna via su questa parete. Posiziona le prese qui sopra e salva il blocco.</p>'}
  </div>`;
  T.wall = wall; drawStage();
}

function drawStage() {
  const own = T.mode === 'own', src = own ? T.photoUrl : T.wall?.image_url;
  $('#stageWrap').innerHTML = src
    ? `<div id="stage" class="relative rounded-3xl overflow-hidden" style="background:var(--card)">
         <img src="${esc(src)}" alt="" class="block w-full h-auto pointer-events-none" draggable="false"><div id="mk"></div></div>
       ${own ? '<label class="link text-sm px-1 cursor-pointer inline-block">Cambia foto<input id="ownPhoto" type="file" accept="image/jpeg,image/png,image/webp" class="hidden"></label>' : ''}`
    : `<label class="card p-10 grid place-items-center text-center gap-3 cursor-pointer">
         <span class="font-semibold">${own ? 'Scegli la foto della via' : 'Nessuna parete disponibile'}</span>
         <span class="sub text-sm">Inquadra solo questo blocco: le prese risultano più grandi e facili da segnare.</span>
         ${own ? '<span class="btn sm">Scegli foto</span><input id="ownPhoto" type="file" accept="image/jpeg,image/png,image/webp" class="hidden">' : ''}</label>`;
  drawMarkers();
}

async function shrink(file, max = 2000) {
  try {
    const bmp = await createImageBitmap(file);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.85));
    return blob ? new File([blob], 'via.jpg', { type: 'image/jpeg' }) : file;
  } catch { return file; }
}
const clearPhoto = () => { if (T.photoUrl) URL.revokeObjectURL(T.photoUrl); T.photo = T.photoUrl = null; };

function drawMarkers() {
  const mk = $('#mk'); if (!mk) return;
  mk.innerHTML = markers(T.holds);
  const c = k => T.holds.filter(h => h.type === k).length;
  $('#count').textContent = `${c('start')} start · ${c('mid')} intermedie · ${c('top')} top`;
}

function handleStageClick(e) {
  const stage = e.target.closest('#stage');
  const m = e.target.closest('.marker');
  if (m) { T.holds.splice(+m.dataset.i, 1); return drawMarkers(); }
  const r = stage.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width) * 100;
  const y = ((e.clientY - r.top) / r.height) * 100;
  if (x < 0 || x > 100 || y < 0 || y > 100) return;
  T.holds.push({ type: T.tool, x: +x.toFixed(2), y: +y.toFixed(2) });
  drawMarkers();
}

async function saveBoulder() {
  const name = $('#bName').value.trim(), g = $('#bGrade').value;
  if (!name) return toast('Dai un nome al blocco');
  if (!g) return toast('Scegli il grado');
  if (!T.holds.some(h => h.type === 'start') || !T.holds.some(h => h.type === 'top')) return toast('Servono almeno una presa Start e una Top');
  if (T.mode === 'own' && !T.photo) return toast('Scegli la foto della via');
  const fd = new FormData();
  fd.append('wall_id', T.wallId); fd.append('name', name); fd.append('grade', g); fd.append('holds', JSON.stringify(T.holds));
  if (T.mode === 'own') fd.append('image', T.photo);
  await api('/boulders', { method: 'POST', body: fd });
  T.holds = []; clearPhoto(); toast('Blocco salvato'); viewTracer();
}

const newWallSheet = () => sheet(`
  <form data-wall class="grid gap-3">
    <h2 class="text-xl font-bold">Nuova parete</h2>
    <p class="sub text-sm">Operazione riservata all'admin.</p>
    <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required class="field" aria-label="Foto della parete">
    <input name="name" placeholder="Nome della parete o settore" class="field" maxlength="80" aria-label="Nome parete">
    <div class="flex gap-2 mt-1"><button type="button" class="btn sec flex-1" data-close>Annulla</button><button class="btn flex-1">Carica</button></div>
  </form>`);

const rephotoSheet = wallId => sheet(`
  <form data-rephoto="${wallId}" class="grid gap-3">
    <h2 class="text-xl font-bold">Cambia foto della parete</h2>
    <p class="sub text-sm">Le vie tracciate direttamente sulla parete verranno <strong>eliminate</strong>. Le vie con foto personale restano.</p>
    <input name="image" type="file" accept="image/jpeg,image/png,image/webp" required class="field" aria-label="Nuova foto parete">
    <div class="flex gap-2 mt-1"><button type="button" class="btn sec flex-1" data-close>Annulla</button><button class="btn danger flex-1">Sostituisci</button></div>
  </form>`);

/* ===================== LE TUE VIE ===================== */
const VIE = { q: '', wall: '', grade: '', status: 'all' };
let ALLVIE = [];
async function viewVie() {
  ALLVIE = await api('/boulders');
  const walls = [...new Map(ALLVIE.map(b => [String(b.wall_id), b.wall_name]))];
  if (!walls.some(([id]) => id === VIE.wall)) VIE.wall = '';
  const sel = (v, cur) => (v === cur ? 'selected' : '');
  $('#app').innerHTML = head('Tutte le vie', '<span id="vieCount" class="sub pb-1"></span>') + `
  <div class="grid gap-3 mb-5">
    <input id="vq" type="search" class="field" placeholder="Cerca una via o un autore" value="${esc(VIE.q)}" aria-label="Cerca una via">
    <div class="grid grid-cols-2 gap-2">
      <select id="vwall" class="field" aria-label="Parete"><option value="">Tutte le pareti</option>
        ${walls.map(([id, n]) => `<option value="${id}" ${sel(id, VIE.wall)}>${esc(n)}</option>`).join('')}</select>
      <select id="vgrade" class="field" aria-label="Grado"><option value="">Tutti i gradi</option>
        <optgroup label="Scala Font">${META.font.map(g => `<option ${sel(g, VIE.grade)}>${g}</option>`).join('')}</optgroup>
        <optgroup label="Colori palestra">${META.colors.map(g => `<option value="${g}" ${sel(g, VIE.grade)}>${cap(g)}</option>`).join('')}</optgroup></select>
    </div>
    <div class="seg" role="group" aria-label="Stato">
      ${[['all', 'Tutte'], ['todo', 'Da fare'], ['done', 'Chiuse'], ['mine', 'Mie']].map(([k, l]) => `<button data-vstatus="${k}" class="${VIE.status === k ? 'on' : ''}">${l}</button>`).join('')}
    </div>
  </div>
  <div id="vieList" class="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-3"></div>`;
  renderVie();
}

function renderVie() {
  const q = VIE.q.trim().toLowerCase();
  const list = ALLVIE.filter(b =>
    (!q || b.name.toLowerCase().includes(q) || (b.author || '').toLowerCase().includes(q)) &&
    (!VIE.wall || String(b.wall_id) === VIE.wall) &&
    (!VIE.grade || b.grade === VIE.grade) &&
    (VIE.status === 'all'
      || (VIE.status === 'done' ? ['flash', 'top'].includes(b.best)
        : VIE.status === 'mine' ? b.author_id === ME?.id
        : !['flash', 'top'].includes(b.best))));
  $('#vieCount').textContent = plural(list.length, 'via', 'vie');
  $('#vieList').innerHTML = list.map(b => boulderCard(b, true)).join('') ||
    `<div class="card p-8 text-center sub col-span-full">${ALLVIE.length
      ? 'Nessuna via con questi filtri.'
      : 'Non hai ancora creato nessuna via. Vai su <a class="link" href="#tracer">Traccia</a> per crearne una.'}</div>`;
}

/* ===================== DETTAGLIO BLOCCO ===================== */
async function viewBoulder(id) {
  const b = await api('/boulders/' + id);
  const editable = canEditBoulder(b);
  $('#app').innerHTML = `
  <a href="#${PREV}" class="link inline-block mb-3">‹ ${TABS[PREV]}</a>
  <div class="grid lg:grid-cols-[1fr_330px] gap-5">
    <div class="view relative rounded-3xl overflow-hidden" style="background:var(--card)">
      <img src="${esc(b.image_url)}" alt="${esc(b.name)}" class="block w-full h-auto"><div class="absolute inset-0">${markers(b.holds)}</div>
    </div>
    <div class="grid gap-4 content-start">
      <div class="card p-5">
        <h1 class="title" style="font-size:28px">${esc(b.name)}</h1>
        <div class="flex items-center gap-3 mt-3">${grade(b.grade)}
          <span class="sub text-sm">${esc(b.wall_name)}</span>
          <span class="sub text-sm">· @${esc(b.author || 'anonimo')}</span></div>
        <div class="seg mt-4" style="pointer-events:none">${Object.entries(TOOLS).map(([k, l]) =>
          `<button><i style="background:${HEX[k]}"></i>${l} ${b.holds.filter(h => h.type === k).length}</button>`).join('')}</div>
      </div>
      <div class="card p-5">
        <h2 class="font-bold mb-1">Le tue salite</h2>
        <ul>${b.logs.map(l => `<li class="sep py-3 flex items-center gap-3">
          <div class="flex-1"><div class="text-sm capitalize">${fmtDate(l.date)}</div><div class="sub text-xs">${esc(l.gym)}</div></div>
          <span class="chip ${l.style}">${STYLE[l.style]}</span><span class="sub text-xs">${plural(l.attempts, 'tentativo', 'tentativi')}</span></li>`).join('')
          || '<li class="sep py-3 sub text-sm">Non l’hai ancora registrato in nessuna sessione.</li>'}</ul>
      </div>
      ${editable ? `<button class="btn sec" style="color:var(--red)" data-del-boulder="${b.id}">Elimina via</button>` : ''}
    </div>
  </div>`;
}

/* ===================== CONTEST ===================== */
async function viewContest() {
  const list = await api('/contests');
  const admin = canManage();
  const card = c => `
    <article class="card p-5">
      <div class="flex items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-xl font-bold">${esc(c.title)}</h2>
          ${c.reward ? `<p class="mt-2"><span class="chip top">🎁 ${esc(c.reward)}</span></p>` : ''}
          ${c.description ? `<p class="sub text-sm mt-2 whitespace-pre-line">${esc(c.description)}</p>` : ''}
          <p class="sub text-xs mt-3">
            ${c.starts_at ? 'Dal ' + fmtDate(c.starts_at) : 'Sempre'}
            ${c.ends_at ? ' al ' + fmtDate(c.ends_at) : ''}
            ${c.active ? '' : ' · <strong>chiusa</strong>'}
          </p>
        </div>
        ${admin ? `<div class="flex gap-1 shrink-0">
          <button class="icon" data-edit-contest="${c.id}" aria-label="Modifica challenge">✎</button>
          <button class="icon" data-del-contest="${c.id}" aria-label="Elimina challenge">${TRASH}</button>
        </div>` : ''}
      </div>
    </article>`;
  $('#app').innerHTML = head('Contest', admin ? '<button class="btn sm" data-new-contest>Nuova challenge</button>' : '') +
    `<p class="sub text-sm mb-4">Le challenge attive in palestra.${admin ? ' Come admin puoi crearle e gestirle.' : ''}</p>
     <div class="grid gap-4">${list.map(card).join('') ||
      '<div class="card p-8 text-center sub">Nessuna challenge attiva.</div>'}</div>`;
}

let CONTEST_CACHE = [];
async function openContestSheet(id) {
  CONTEST_CACHE = await api('/contests');
  const c = id ? CONTEST_CACHE.find(x => String(x.id) === String(id)) || {} : {};
  sheet(`
    <form data-contest="${c.id || ''}" class="grid gap-3">
      <h2 class="text-xl font-bold">${c.id ? 'Modifica challenge' : 'Nuova challenge'}</h2>
      <label class="grid gap-1"><span class="sub text-sm">Titolo</span>
        <input name="title" class="field" placeholder="Es. Boulder del mese" required maxlength="120" value="${esc(c.title || '')}"></label>
      <label class="grid gap-1"><span class="sub text-sm">Descrizione / regole</span>
        <textarea name="description" class="field" rows="3" placeholder="Spiega come si partecipa" maxlength="2000">${esc(c.description || '')}</textarea></label>
      <label class="grid gap-1"><span class="sub text-sm">Ricompensa</span>
        <input name="reward" class="field" placeholder="Es. magnesite + ingresso gratis" maxlength="200" value="${esc(c.reward || '')}"></label>
      <div class="grid grid-cols-2 gap-2">
        <label class="grid gap-1"><span class="sub text-sm">Inizio</span>
          <input name="starts_at" type="date" class="field" value="${c.starts_at || ''}"></label>
        <label class="grid gap-1"><span class="sub text-sm">Fine</span>
          <input name="ends_at" type="date" class="field" value="${c.ends_at || ''}"></label>
      </div>
      ${c.id ? `<label class="flex items-center gap-2 text-sm mt-1"><input type="checkbox" name="active" ${c.active ? 'checked' : ''}> Challenge attiva</label>` : ''}
      <div class="flex gap-2 mt-2">
        <button type="button" class="btn sec flex-1" data-close>Annulla</button>
        <button class="btn flex-1">${c.id ? 'Salva' : 'Crea'}</button>
      </div>
    </form>`);
}

/* ===================== STATISTICHE ===================== */
let STATS = { tab: 'me' };
let SDATA = null;
async function viewStats() {
  SDATA = await Promise.all([api('/stats'), api('/leaderboard')]);
  renderStats();
}

function renderStats() {
  const [s, lb] = SDATA;
  const kpi = (v, l) => `<div class="card p-5"><div style="font-size:38px;font-weight:700;letter-spacing:-.04em;line-height:1">${v}</div><div class="sub text-sm mt-2">${l}</div></div>`;
  const pyramid = (rows, max) => rows.map(r => {
    const n = r.flash + r.top;
    return `<div class="flex items-center gap-3 py-1">${grade(r.grade)}
      <div class="flex-1 flex justify-center"><div class="flex h-7 rounded-lg overflow-hidden" style="width:${Math.max((n / max) * 100, 5)}%">
        <div style="background:var(--green);width:${n ? (r.flash / n) * 100 : 0}%"></div><div class="flex-1" style="background:var(--orange)"></div></div></div>
      <span class="w-14 text-sm sub text-right">${n}${r.fail ? ` +${r.fail}` : ''}</span></div>`;
  }).join('');
  const used = s.byGrade.filter(r => r.flash + r.top + r.fail > 0);
  const max = Math.max(1, ...used.map(r => r.flash + r.top));
  const font = used.filter(r => !GCOL[r.grade]).reverse(), colors = used.filter(r => GCOL[r.grade]).reverse();
  const block = (t, rows) => rows.length ? `<h2 class="text-2xl font-bold mt-8 mb-3" style="letter-spacing:-.025em">${t}</h2><div class="card p-4">${pyramid(rows, max)}</div>` : '';

  const personal = `
  <div class="grid grid-cols-2 md:grid-cols-4 gap-3">
    ${kpi(s.sessions, 'sessioni')}${kpi(s.sends, 'blocchi chiusi')}${kpi(s.flashRate + '%', 'flash sui blocchi provati')}
    ${kpi(s.hardest ? (GCOL[s.hardest] ? cap(s.hardest) : s.hardest) : '–', 'grado massimo chiuso')}
  </div>
  <p class="sub text-sm mt-5"><span style="color:var(--green)">●</span> Flash &nbsp; <span style="color:var(--orange)">●</span> Top / lavorato &nbsp; <span>+n = tentativi falliti</span></p>
  ${block('Piramide gradi Font', font)}${block('Piramide colori', colors)}
  ${used.length ? '' : '<div class="card p-8 text-center sub mt-6">Registra qualche blocco in una sessione per vedere la tua piramide.</div>'}`;

  const MEDALS = ['🥇', '🥈', '🥉'];
  const lbRow = (r, i) => `
    <li class="sep flex items-center gap-3 py-2.5 ${r.id === ME?.id ? 'font-semibold' : ''}">
      <span class="w-7 text-center sub text-sm">${MEDALS[i] || (i + 1)}</span>
      <span class="flex-1 truncate">@${esc(r.username || '?')}${r.id === ME?.id ? ' <span class="sub text-xs font-normal">(tu)</span>' : ''}</span>
      <span class="chip ${r.id === ME?.id ? 'top' : 'fail'}">${plural(r.n, 'blocco', 'blocchi')}</span>
    </li>`;
  const board = (title, rows, empty) => `
    <section class="card p-5">
      <h2 class="font-bold">${title}</h2>
      <ul class="mt-2">${rows.map(lbRow).join('') || `<li class="sep py-3 sub text-sm">${empty}</li>`}</ul>
    </section>`;
  const leaderboard = `
  <div class="grid md:grid-cols-2 gap-4">
    ${board('🧗 Blocchi creati', lb.creators, 'Nessuna via creata. Vai su <a class="link" href="#tracer">Traccia</a> per tracciarne una.')}
    ${board('🏁 Blocchi chiusi', lb.senders, 'Nessun blocco chiuso. Flash e top registrati nelle sessioni valgono per la classifica.')}
  </div>
  <p class="sub text-xs mt-3 px-1">La classifica considera i blocchi con foto personale come creazioni dell'autore registrato. Flash e top valgono entrambi come "chiuso".</p>`;

  $('#app').innerHTML = head('Statistiche') + `
  <div class="seg mb-6" role="group" aria-label="Tipo di statistiche">
    <button data-stab="me" class="${STATS.tab === 'me' ? 'on' : ''}">Personali</button>
    <button data-stab="board" class="${STATS.tab === 'board' ? 'on' : ''}">Classifica</button>
  </div>
  ${STATS.tab === 'me' ? personal : leaderboard}`;
}

/* ===================== EVENTI ===================== */
document.addEventListener('click', async e => {
  try {
    if (e.target.closest('#stage')) return handleStageClick(e);
    const t = e.target, d = t.closest('button');
    if (t.id === 'undo') { T.holds.pop(); return drawMarkers(); }
    if (t.id === 'clear') { T.holds = []; return drawMarkers(); }
    if (t.id === 'save') return await saveBoulder();
    if (!d) return;
    if (d.hasAttribute('data-close')) return $('#dlg').close();
    if (d.dataset.authMode) return showAuth(d.dataset.authMode);
    if (d.dataset.mode) {
      T.mode = d.dataset.mode; T.holds = [];
      document.querySelectorAll('[data-mode]').forEach(b => b.classList.toggle('on', b.dataset.mode === T.mode));
      return drawStage();
    }
    if (d.dataset.vstatus) {
      VIE.status = d.dataset.vstatus;
      document.querySelectorAll('[data-vstatus]').forEach(b => b.classList.toggle('on', b.dataset.vstatus === VIE.status));
      return renderVie();
    }
    if (d.dataset.stab) {
      STATS.tab = d.dataset.stab;
      document.querySelectorAll('[data-stab]').forEach(b => b.classList.toggle('on', b.dataset.stab === STATS.tab));
      return renderStats();
    }
    if (d.hasAttribute('data-logout')) {
      await send('/auth/logout', {});
      ME = null; OPEN = null; T.wallId = null; T.holds = []; clearPhoto(); T.mode = 'wall';
      Object.assign(VIE, { q: '', wall: '', grade: '', status: 'all' });
      location.hash = ''; return showAuth();
    }
    if (d.hasAttribute('data-new-session')) return newSessionSheet();
    if (d.hasAttribute('data-new-wall')) return newWallSheet();
    if (d.dataset.rephotoWall) return rephotoSheet(d.dataset.rephotoWall);
    if (d.dataset.tool) {
      T.tool = d.dataset.tool;
      return document.querySelectorAll('[data-tool]').forEach(b => b.classList.toggle('on', b.dataset.tool === T.tool));
    }
    if (d.dataset.delWall) {
      const name = $('#wallSel').selectedOptions[0].textContent;
      if (!confirm(`Eliminare la parete "${name}" e tutte le sue vie? Le salite già registrate restano nelle sessioni.`)) return;
      await del('/walls/' + d.dataset.delWall);
      T.wallId = null; T.holds = []; toast('Parete eliminata'); return viewTracer();
    }
    if (d.dataset.newContest !== undefined) return openContestSheet();
    if (d.dataset.editContest) return openContestSheet(d.dataset.editContest);
    if (d.dataset.delContest) {
      if (!confirm('Eliminare questa challenge?')) return;
      await del('/contests/' + d.dataset.delContest);
      toast('Challenge eliminata'); return viewContest();
    }
    if (!(d.dataset.delSession || d.dataset.delLog || d.dataset.delBoulder)) return;
    if (!confirm('Eliminare definitivamente?')) return;
    if (d.dataset.delSession) { await del('/sessions/' + d.dataset.delSession); OPEN = null; viewSessions(); }
    if (d.dataset.delLog) { await del('/logs/' + d.dataset.delLog); viewSessions(); }
    if (d.dataset.delBoulder) { await del('/boulders/' + d.dataset.delBoulder); location.hash = '#' + PREV; }
  } catch (err) { toast(err.message); }
});

document.addEventListener('submit', async e => {
  e.preventDefault();
  const f = e.target, el = f.elements;
  try {
    if (f.matches('[data-auth]')) {
      const reg = f.dataset.auth === 'register', err = $('#authErr'), b = f.querySelector('.btn');
      const fail = m => { err.textContent = m; err.hidden = false; };
      err.hidden = true;
      if (reg && el.password.value.length < 8) return fail('La password deve avere almeno 8 caratteri.');
      b.disabled = true;
      try {
        const r = await send(reg ? '/auth/register' : '/auth/login', {
          name: reg ? el.name.value : undefined,
          username: reg ? el.username.value : undefined,
          email: el.email.value,
          password: el.password.value,
        });
        ME = r.user; return enter();
      } catch (x) {
        return fail(x instanceof TypeError ? 'Impossibile contattare il server. Controlla che Docker sia avviato.' : x.message);
      } finally { b.disabled = false; }
    }
    if (f.matches('[data-session]')) {
      await send('/sessions', { date: el.date.value, gym: el.gym.value, notes: el.notes.value });
      $('#dlg').close(); toast('Sessione creata'); viewSessions();
    }
    if (f.matches('[data-log]')) {
      if (!el.grade.value) return toast('Scegli il grado');
      const flash = el.style.value === 'flash';
      await send(`/sessions/${f.dataset.log}/logs`, {
        boulder_id: el.boulder_id.value, name: el.name.value, grade: el.grade.value,
        style: el.style.value, attempts: flash ? 1 : +el.attempts.value,
      });
      OPEN = +f.dataset.log; toast('Blocco aggiunto'); viewSessions();
    }
    if (f.matches('[data-wall]')) {
      const w = await api('/walls', { method: 'POST', body: new FormData(f) });
      $('#dlg').close(); T.wallId = w.id; T.holds = []; toast('Parete caricata'); viewTracer();
    }
    if (f.matches('[data-rephoto]')) {
      const w = await api(`/walls/${f.dataset.rephoto}/rephoto`, { method: 'POST', body: new FormData(f) });
      $('#dlg').close(); T.holds = []; toast('Foto parete aggiornata'); viewTracer();
    }
    if (f.matches('[data-contest]')) {
      const body = {
        title: el.title.value,
        description: el.description.value,
        reward: el.reward.value,
        starts_at: el.starts_at.value || null,
        ends_at: el.ends_at.value || null,
        active: el.active ? el.active.checked : true,
      };
      if (f.dataset.contest) await put('/contests/' + f.dataset.contest, body);
      else await send('/contests', body);
      $('#dlg').close(); toast('Challenge salvata'); viewContest();
    }
  } catch (err) { toast(err.message); }
});

document.addEventListener('change', async e => {
  const t = e.target, f = t.form;
  if (t.id === 'ownPhoto' && t.files[0]) {
    try { T.photo = await shrink(t.files[0]); } catch (err) { return toast(err.message); }
    if (T.photoUrl) URL.revokeObjectURL(T.photoUrl);
    T.photoUrl = URL.createObjectURL(T.photo); T.holds = []; return drawStage();
  }
  if (t.name === 'boulder_id') {
    f.querySelector('[data-freename]').hidden = !!t.value;
    if (t.value) f.elements.grade.value = t.selectedOptions[0].dataset.grade;
  }
  if (t.name === 'style') {
    f.elements.attempts.disabled = t.value === 'flash';
    if (t.value === 'flash') f.elements.attempts.value = 1;
  }
  if (t.id === 'vwall') { VIE.wall = t.value; renderVie(); }
  if (t.id === 'vgrade') { VIE.grade = t.value; renderVie(); }
  if (t.id === 'wallSel') { T.wallId = +t.value; if (T.mode !== 'own') T.holds = []; viewTracer().catch(err => toast(err.message)); }
});

document.addEventListener('input', e => { if (e.target.id === 'vq') { VIE.q = e.target.value; renderVie(); } });

/* ===================== ROUTER ===================== */
const routes = { sessions: viewSessions, tracer: viewTracer, vie: viewVie, stats: viewStats, boulder: viewBoulder, contest: viewContest };
async function route() {
  if (!ME) return showAuth();
  const [name, arg] = (location.hash.slice(1) || 'sessions').split('/');
  const r = routes[name] ? name : 'sessions';
  if (r !== 'boulder') PREV = r;
  const tab = PREV;
  document.querySelectorAll('[data-r]').forEach(a => a.classList.toggle('active', a.dataset.r === tab));
  try { await routes[r](arg); } catch (err) { toast(err.message); }
}
window.addEventListener('hashchange', () => { window.scrollTo(0, 0); route(); });

/* ===================== LOGIN ===================== */
function showAuth(mode = 'login') {
  const reg = mode === 'register' && META.registration;
  document.body.classList.add('out');
  $('#app').innerHTML = `
  <div class="max-w-sm mx-auto mt-8">
    <div class="text-center mb-7">
      <span class="inline-block w-5 h-5 rounded-full mb-3" style="background:var(--orange)"></span>
      <h1 class="title">Climbo Pisa</h1><p class="sub mt-1.5">${reg ? 'Crea il tuo logbook boulder' : 'Accedi al tuo logbook boulder'}</p>
    </div>
    ${META.registration ? `<div class="seg mb-3"><button data-auth-mode="login" class="${reg ? '' : 'on'}">Accedi</button><button data-auth-mode="register" class="${reg ? 'on' : ''}">Registrati</button></div>` : ''}
    <form data-auth="${reg ? 'register' : 'login'}" class="card p-5 grid gap-3">
      ${reg ? '<input name="name" class="field" placeholder="Nome" required maxlength="60" autocomplete="name">' : ''}
      ${reg ? '<input name="username" class="field" placeholder="Username (pubblico)" required maxlength="30" pattern="[a-z0-9_]{3,30}" autocomplete="username" title="3-30 caratteri: minuscole, numeri, _">' : ''}
      <input name="email" type="email" class="field" placeholder="Email" required autocomplete="email">
      <input name="password" type="password" class="field" placeholder="Password${reg ? ' (almeno 8 caratteri)' : ''}" required autocomplete="${reg ? 'new-password' : 'current-password'}">
      <p id="authErr" role="alert" class="text-sm text-center" style="color:var(--red)" hidden></p>
      <button class="btn mt-1">${reg ? 'Crea account' : 'Accedi'}</button>
    </form>
  </div>`;
}

function enter() {
  document.body.classList.remove('out');
  $('#userbox').hidden = false;
  const isAdm = !!ME.isAdmin;
  $('#uname').innerHTML = `${esc(ME.name)} <span class="sub">· @${esc(ME.username || '')}</span>${isAdm ? ' <span class="badge-admin">admin</span>' : ''}`;
  return route();
}

(async () => {
  try {
    META = await api('/meta');
    ME = (await api('/auth/me')).user;
    await enter();
  } catch { if (!ME) showAuth(); }
})();