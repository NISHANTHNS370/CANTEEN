import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + Number(n).toFixed(2);

let me = null, menu = [], orders = [], urls = {}, settings = {}, cart = {};
let view = 'menu', cat = 'All', q = '', authTab = 'in', msg = '', pay = 'Cash', shotBlob = null, shotPrev = null, flt = 'Pending', busy = false, chan = null;

const cats = () => ['All', ...new Set(menu.map(m => m.cat))];
const total = () => Object.entries(cart).reduce((s, [id, n]) => s + (menu.find(m => m.id === id)?.price || 0) * n, 0);
const count = () => Object.values(cart).reduce((a, b) => a + b, 0);

async function loadAll() {
  const [m, s, o] = await Promise.all([
    sb.from('menu_items').select('*').order('cat').order('name'),
    sb.from('settings').select('*').eq('id', 1).maybeSingle(),
    sb.from('orders').select('*').order('created_at', { ascending: false }).limit(200)]);
  menu = m.data || []; settings = s.data || {}; orders = o.data || [];
  const paths = orders.filter(x => x.shot_path).map(x => x.shot_path);
  urls = {};
  if (paths.length) {
    const { data } = await sb.storage.from('screenshots').createSignedUrls(paths, 3600);
    (data || []).forEach(d => { if (d.signedUrl) urls[d.path] = d.signedUrl; });
  }
}
async function boot() {
  const { data: { session } } = await sb.auth.getSession();
  me = null;
  if (session) {
    const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
    me = data;
    if (me) {
      await loadAll();
      view = me.role === 'admin' ? 'orders' : 'menu';
      if (!chan) chan = sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async () => {
        await loadAll(); if (document.activeElement?.tagName !== 'TEXTAREA') render();
      }).subscribe();
    }
  }
  render();
}

function render() {
  app.innerHTML = !me ? authV() : nav() + '<main>' + (me.role === 'admin' ? adminV() : studentV()) + '</main>' + fab();
}
function authV() {
  const up = authTab === 'up';
  return `<div class="auth"><h1 style="font-size:40px;color:var(--red)">BiteSite</h1><p class="b" style="margin:6px 0 16px">Order ahead, skip the queue.</p>
  <div class="panel"><div class="row start"><button class="tab ${!up ? 'on' : ''}" data-a="tab" data-v="in">Sign in</button><button class="tab ${up ? 'on' : ''}" data-a="tab" data-v="up">Create account</button></div>
  ${up ? `<label>Full name</label><input id="n" maxlength="80"><label>Roll number</label><input id="r" maxlength="40" placeholder="e.g. CS-2024-001"><label>Department</label><input id="d" maxlength="40" placeholder="CSE"><label>Phone number</label><input id="p" inputmode="numeric" maxlength="10">` : ''}
  <label>Email</label><input id="e" type="email" autocomplete="username"><label>Password</label><input id="w" type="password" autocomplete="${up ? 'new-password' : 'current-password'}">
  <div class="msg">${esc(msg)}</div><button class="btn" data-a="${up ? 'signup' : 'login'}" ${busy ? 'disabled' : ''}>${up ? 'Create account' : 'Sign in'}</button></div></div>`;
}
function nav() {
  const t = me.role === 'admin' ? [['orders', 'Orders'], ['menuA', 'Menu'], ['settings', 'Settings']] : [['menu', 'Menu'], ['my', 'My Orders']];
  return `<nav><span class="b" style="color:var(--red)">BiteSite</span>${t.map(([k, l]) => `<button class="tab ${view === k ? 'on' : ''}" data-a="view" data-v="${k}">${l}</button>`).join('')}<span class="sp"></span><span class="mut">${esc(me.name)}</span><button class="btn alt sm" data-a="logout">Logout</button></nav>`;
}
const fab = () => (me.role !== 'admin' && view === 'menu' && count()) ? `<div class="fab"><button class="btn" data-a="view" data-v="checkout">Cart · ${count()} items · ${money(total())} →</button></div>` : '';

function studentV() { return view === 'my' ? myV() : view === 'checkout' ? checkoutV() : menuV(); }
function gridV() {
  const items = menu.filter(m => m.available && (cat === 'All' || m.cat === cat) && m.name.toLowerCase().includes(q.toLowerCase()));
  return items.map(m => `<div class="card"><div class="img">${esc(m.emoji)}</div><div class="in"><div class="b" style="font-size:15px">${esc(m.name)}</div><div class="price">${money(m.price)}</div>
  ${cart[m.id] ? `<div class="q"><button data-a="chg" data-id="${m.id}" data-d="-1">−</button><span>${cart[m.id]}</span><button data-a="chg" data-id="${m.id}" data-d="1">+</button></div>` : `<button class="btn" data-a="chg" data-id="${m.id}" data-d="1">+ Add</button>`}</div></div>`).join('') || '<p class="mut">No items found.</p>';
}
function menuV() {
  return `<h1 class="big">Hi ${esc(me.name.split(' ')[0])}</h1><p style="color:var(--red);font-weight:700;font-size:18px;margin:8px 0">What are you craving today?</p>
  <div class="ticker">FRESH · FAST · FIERCE · FRESH · FAST · FIERCE · FRESH · FAST · FIERCE</div>
  <input id="search" data-in="search" placeholder="Search delicious food…" value="${esc(q)}">
  <div class="chips">${cats().map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-a="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><div class="grid" id="grid">${gridV()}</div>`;
}
function checkoutV() {
  const rows = Object.entries(cart).map(([id, n]) => { const m = menu.find(x => x.id === id); return m ? `<tr><td>${esc(m.name)}</td><td>${n}</td><td>${money(m.price * n)}</td></tr>` : ''; }).join('');
  if (!rows) return `<div class="panel">Cart is empty. <button class="btn sm" data-a="view" data-v="menu">Back to menu</button></div>`;
  return `<h2>Your cart</h2><div class="panel scroll"><table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${rows}<tr><td class="b">Total</td><td></td><td class="price">${money(total())}</td></tr></table></div>
  <div class="panel"><h3 style="margin-bottom:10px">Payment method</h3><div class="row start"><button class="chip ${pay === 'Cash' ? 'on' : ''}" data-a="pay" data-v="Cash">Cash</button><button class="chip ${pay === 'Online' ? 'on' : ''}" data-a="pay" data-v="Online">Online (UPI)</button></div>
  ${pay === 'Online' ? `<p>Pay <b>${money(total())}</b> to:<br>UPI ID: <b>${esc(settings.upi || '(not set by admin yet)')}</b><br>Phone: <b>${esc(settings.phone || '-')}</b></p><label>Upload payment screenshot (required)</label><input type="file" accept="image/*" data-in="shot">${shotPrev ? `<img class="shot" src="${shotPrev}" alt="screenshot preview">` : ''}` : '<p class="mut">Pay cash when you collect your order.</p>'}
  <div class="msg">${esc(msg)}</div><div class="row start"><button class="btn alt" data-a="view" data-v="menu">← Back</button><button class="btn ok" data-a="place" ${busy ? 'disabled' : ''}>Place order</button></div></div>`;
}
function ordCard(o, adm) {
  return `<div class="panel"><div class="row"><span class="b">#${o.id.slice(0, 5)} · ${new Date(o.created_at).toLocaleString()}</span><span class="tag ${o.status}">${o.status}</span></div>
  ${adm ? `<p><b>${esc(o.cust_name)}</b> · ${esc(o.cust_roll)} · ${esc(o.cust_dept)} · ${esc(o.cust_phone)}</p>` : ''}
  <p>${o.items.map(i => esc(i.name) + ' ×' + Number(i.qty)).join(', ')}</p><p><span class="price">${money(o.total)}</span> · ${o.method}</p>
  ${o.shot_path && urls[o.shot_path] ? `<a href="${urls[o.shot_path]}" target="_blank" rel="noopener"><img class="shot" src="${urls[o.shot_path]}" alt="payment screenshot"></a>` : ''}
  ${o.comment ? `<p class="mut">Admin: ${esc(o.comment)}</p>` : ''}
  ${adm && o.status === 'Pending' ? `<textarea id="c${o.id}" rows="2" maxlength="300" placeholder="Comment (optional)"></textarea><div class="row start"><button class="btn ok sm" data-a="decide" data-id="${o.id}" data-v="Accepted">Accept</button><button class="btn sm" data-a="decide" data-id="${o.id}" data-v="Rejected">Reject</button></div>` : ''}</div>`;
}
const myV = () => `<h2 style="margin-bottom:12px">My orders</h2>` + (orders.filter(o => o.user_id === me.id).map(o => ordCard(o)).join('') || '<p class="mut">No orders yet.</p>');
function adminV() {
  if (view === 'menuA') return menuAV();
  if (view === 'settings') return `<h2 style="margin-bottom:12px">Payment settings</h2><div class="panel"><label>UPI ID</label><input id="su" maxlength="60" value="${esc(settings.upi)}"><label>Phone number (GPay/PhonePe)</label><input id="sp" maxlength="15" value="${esc(settings.phone)}"><div class="msg">${esc(msg)}</div><button class="btn" data-a="saveSet">Save</button></div>`;
  const o = orders.filter(x => flt === 'All' || x.status === flt);
  return `<h2 style="margin-bottom:12px">Orders</h2><div class="chips">${['Pending', 'Accepted', 'Rejected', 'All'].map(f => `<button class="chip ${f === flt ? 'on' : ''}" data-a="flt" data-v="${f}">${f}</button>`).join('')}</div>` + (o.map(x => ordCard(x, 1)).join('') || '<p class="mut">No orders here.</p>');
}
function menuAV() {
  return `<h2 style="margin-bottom:12px">Manage menu</h2><div class="panel"><div class="row"><div><label>Name</label><input id="an" maxlength="60"></div><div><label>Category</label><input id="ac" list="cl" maxlength="40"><datalist id="cl">${cats().slice(1).map(c => `<option value="${esc(c)}">`).join('')}</datalist></div><div><label>Price ₹</label><input id="ap" type="number" min="0"></div><div><label>Emoji</label><input id="ae" maxlength="4" style="width:70px"></div><button class="btn" data-a="addItem">Add item</button></div><div class="msg">${esc(msg)}</div></div>
  <div class="panel scroll"><table><tr><th>Item</th><th>Category</th><th>Price</th><th>Available</th><th></th></tr>${menu.map(m => `<tr><td>${esc(m.emoji)} ${esc(m.name)}</td><td>${esc(m.cat)}</td><td>${money(m.price)}</td><td><input type="checkbox" style="width:auto;margin:0" data-in="tgl" data-id="${m.id}" ${m.available ? 'checked' : ''}></td><td><button class="btn alt sm" data-a="edit" data-id="${m.id}">Edit</button> <button class="btn sm" data-a="delItem" data-id="${m.id}">Del</button></td></tr>`).join('')}</table></div>`;
}

const err = e => e?.message || 'Something went wrong';
async function refresh(m = '') { msg = m; await loadAll(); render(); }
const acts = {
  tab: d => { authTab = d.v; msg = ''; render(); },
  view: d => { view = d.v; msg = ''; render(); },
  cat: d => { cat = d.v; render(); },
  pay: d => { pay = d.v; msg = ''; render(); },
  flt: d => { flt = d.v; render(); },
  chg: d => { const n = (cart[d.id] || 0) + +d.d; if (n <= 0) delete cart[d.id]; else cart[d.id] = n; render(); },
  async login() {
    busy = true; msg = ''; const { error } = await sb.auth.signInWithPassword({ email: $('#e').value.trim(), password: $('#w').value });
    busy = false; if (error) { msg = 'Wrong email or password'; render(); } else boot();
  },
  async signup() {
    const g = x => $('#' + x).value.trim(), pw = $('#w').value;
    if (g('n').length < 2 || !g('r') || !g('d') || !g('e')) { msg = 'Fill all fields'; return render(); }
    if (!/^\d{10}$/.test(g('p'))) { msg = 'Phone must be 10 digits'; return render(); }
    if (pw.length < 8) { msg = 'Password must be at least 8 characters'; return render(); }
    busy = true; render();
    const { data, error } = await sb.auth.signUp({ email: g('e'), password: pw, options: { data: { name: g('n'), roll: g('r'), dept: g('d'), phone: g('p') } } });
    busy = false;
    if (error) { msg = err(error); render(); } else if (!data.session) { msg = 'Check your email to confirm, then sign in.'; authTab = 'in'; render(); } else boot();
  },
  async logout() { await sb.auth.signOut(); if (chan) { sb.removeChannel(chan); chan = null; } me = null; cart = {}; orders = []; render(); },
  async place() {
    if (busy) return; msg = '';
    if (pay === 'Online' && !shotBlob) { msg = 'Please upload the payment screenshot'; return render(); }
    busy = true; render();
    try {
      let path = null;
      if (pay === 'Online') {
        path = `${me.id}/${Date.now()}.jpg`;
        const up = await sb.storage.from('screenshots').upload(path, shotBlob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
      }
      const { error } = await sb.rpc('place_order', { p_items: Object.entries(cart).map(([id, qty]) => ({ id, qty })), p_method: pay, p_shot: path });
      if (error) throw error;
      cart = {}; shotBlob = shotPrev = null; pay = 'Cash'; view = 'my'; await loadAll();
    } catch (e) { msg = err(e); }
    busy = false; render();
  },
  async decide(d) { const c = document.getElementById('c' + d.id)?.value.trim().slice(0, 300) || ''; const { error } = await sb.from('orders').update({ status: d.v, comment: c }).eq('id', d.id); await refresh(error ? err(error) : ''); },
  async addItem() {
    const name = $('#an').value.trim(), c = $('#ac').value.trim(), p = parseFloat($('#ap').value);
    if (!name || !c || !(p >= 0)) { msg = 'Fill name, category, price'; return render(); }
    const { error } = await sb.from('menu_items').insert({ name, cat: c, price: p, emoji: $('#ae').value || '🍴' }); await refresh(error ? err(error) : '');
  },
  async edit(d) {
    const m = menu.find(x => x.id === d.id), n = prompt('Name', m.name); if (n === null) return;
    const p = prompt('Price', m.price); if (p === null) return; const c = prompt('Category', m.cat); if (c === null) return;
    const { error } = await sb.from('menu_items').update({ name: n || m.name, price: +p >= 0 ? +p : m.price, cat: c || m.cat }).eq('id', d.id); await refresh(error ? err(error) : '');
  },
  async delItem(d) { if (!confirm('Delete this item?')) return; const { error } = await sb.from('menu_items').delete().eq('id', d.id); await refresh(error ? err(error) : ''); },
  async saveSet() { const { error } = await sb.from('settings').update({ upi: $('#su').value.trim(), phone: $('#sp').value.trim() }).eq('id', 1); await refresh(error ? err(error) : 'Saved ✓'); }
};
const ins = {
  search: el => { q = el.value; $('#grid').innerHTML = gridV(); },
  async tgl(el, d) { await sb.from('menu_items').update({ available: el.checked }).eq('id', d.id); await refresh(); },
  shot: el => {
    const f = el.files[0]; if (!f) return; const im = new Image(); const u = URL.createObjectURL(f);
    im.onload = () => { const k = Math.min(1, 900 / im.width), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u);
      c.toBlob(b => { shotBlob = b; shotPrev = c.toDataURL('image/jpeg', .7); render(); }, 'image/jpeg', .75); };
    im.src = u;
  }
};
app.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && acts[b.dataset.a]) acts[b.dataset.a](b.dataset); });
app.addEventListener('input', e => { const t = e.target.closest('[data-in="search"]'); if (t) ins.search(t); });
app.addEventListener('change', e => { const t = e.target.closest('[data-in]'); if (t && t.dataset.in !== 'search') ins[t.dataset.in](t, t.dataset); });
boot();
