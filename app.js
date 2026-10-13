import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm';
import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const sb = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const $ = s => document.querySelector(s), app = $('#app');
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = n => '₹' + Number(n).toFixed(2);
const foodUrl = p => p ? sb.storage.from('food').getPublicUrl(p).data.publicUrl : '';

let me = null, menu = [], orders = [], urls = {}, settings = {}, cart = {};
let view = 'menu', cat = 'All', q = '', authTab = 'in', msg = '', pay = 'Cash', note = '', shotBlob = null, shotPrev = null;
let flt = 'Pending', busy = false, chan = null, side = false, editId = null, foodBlob = null;

const cats = () => ['All', ...new Set(menu.map(m => m.cat))];
const total = () => Object.entries(cart).reduce((s, [id, n]) => s + (menu.find(m => m.id === id)?.price || 0) * n, 0);
const count = () => Object.values(cart).reduce((a, b) => a + b, 0);
const err = e => e?.message || 'Something went wrong';
function flash(m) { msg = m; const el = $('.msg'); if (el) el.textContent = m; else render(); }


/* ---------- alerts ---------- */
let ac = null;
function beep() { try { ac = ac || new (window.AudioContext || window.webkitAudioContext)(); const o = ac.createOscillator(), g = ac.createGain(); o.connect(g); g.connect(ac.destination); o.frequency.value = 880; g.gain.setValueAtTime(.2, ac.currentTime); g.gain.exponentialRampToValueAtTime(.001, ac.currentTime + .7); o.start(); o.stop(ac.currentTime + .7); } catch (e) { } }
function toast(t) { const d = document.createElement('div'); d.className = 'toast'; d.textContent = t; document.body.appendChild(d); setTimeout(() => d.remove(), 7000); d.onclick = () => d.remove(); }
function notify(p) {
  if (!me) return; const n = p.new || {};
  if (me.role === 'admin' && p.eventType === 'INSERT') {
    const t = `New order from ${n.cust_name || 'student'} · ${money(n.total)}`; beep(); toast('🛎 ' + t);
    try { if (Notification.permission === 'granted') new Notification('BiteSite', { body: t }); } catch (e) { }
  } else if (me.role !== 'admin' && p.eventType === 'UPDATE' && n.user_id === me.id && n.status !== 'Pending') {
    beep(); toast(`Your order #${String(n.id).slice(0, 5)} was ${n.status.toLowerCase()}${n.comment ? ': ' + n.comment : ''}`);
  }
}

/* ---------- soft background ---------- */
(function bg() { const d = document.createElement('div'); d.id = 'bg'; d.innerHTML = '<i></i><i></i><i></i>'; document.body.prepend(d); })();

/* ---------- data ---------- */
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
    if (!me) { await sb.auth.signOut(); msg = 'Login worked but your profile is missing. Run the profile-backfill SQL (see README).'; }
    if (me) {
      await loadAll();
      view = me.role === 'admin' ? 'orders' : 'menu';
      if (!chan) chan = sb.channel('orders-live').on('postgres_changes', { event: '*', schema: 'public', table: 'orders' }, async p => {
        await loadAll(); notify(p); if (!['TEXTAREA', 'INPUT'].includes(document.activeElement?.tagName)) render();
      }).subscribe();
    }
  }
  render();
}

/* ---------- views ---------- */
let lastKey = '';
function render() {
  const key = me ? view : 'auth' + authTab, enter = key !== lastKey ? ' enter' : ''; lastKey = key;
  if (me?.role === 'admin') { const n = orders.filter(o => o.status === 'Pending').length; document.title = (n ? `(${n}) ` : '') + 'BiteSite – College Canteen'; }
  app.innerHTML = !me ? authV(enter) : topbar() + `<main class="${enter}">` + body() + '</main>' + fab();
}
function body() {
  if (view === 'support') return supportV();
  if (view === 'about') return aboutV();
  return me.role === 'admin' ? adminV() : studentV();
}
function authV(enter = '') {
  const up = authTab === 'up';
  return `<div class="authwrap${enter}"><section class="authhero"><div class="brandrow"><span class="logo">🍛𝐉𝐒⃝𝐄𝐂</span><span class="brand">Bite The Site</span></div>
  <h1>Student's canteen♨.<br>Fast Delivery.</h1><p>Order ahead from your JSEC campus canteen, pay once and collect the moment it is ready.<br>⚡𝔻𝕖𝕡𝕒𝕣𝕥𝕞𝕖𝕟𝕥 𝕆𝕗 ℂ𝕪𝕓𝕖𝕣 𝕊𝕖𝕔𝕦𝕣𝕚𝕥𝕪⚡<br></p>
  <ul><li>Browse the full menu with photos</li><li>Pay by cash or UPI</li><li>Track your order live ﹏𓊝﹏𓂁﹏</li></ul></section>
  <section class="authform"><div class="panel"><h2 style="margin-bottom:4px">${up ? 'Create your account' : 'Welcome back'}</h2><p class="mut" style="margin:0 0 14px">${up ? 'Join your campus food community.' : 'Sign in to continue.'}</p>
  <div class="row start" style="margin-bottom:12px"><button class="tab ${!up ? 'on' : ''}" data-a="tab" data-v="in">Sign in</button><button class="tab ${up ? 'on' : ''}" data-a="tab" data-v="up">Create account</button></div>
  ${up ? `<label>Full name</label><input id="n" maxlength="80"><label>Roll number</label><input id="r" maxlength="40" placeholder="e.g. CS-2024-001"><label>Department</label><input id="d" maxlength="40" placeholder="CSE"><label>Phone number</label><input id="p" inputmode="numeric" maxlength="10">` : ''}
  <label>Email</label><input id="e" type="email" autocomplete="username"><label>Password</label><input id="w" type="password" autocomplete="${up ? 'new-password' : 'current-password'}">
  <div class="msg">${esc(msg)}</div><button class="btn" style="width:100%" data-a="${up ? 'signup' : 'login'}" ${busy ? 'disabled' : ''}>${up ? 'Create account' : 'Sign in'}</button></div></section></div>`;
}
function topbar() {
  const items = me.role === 'admin' ? [['orders', 'Orders'], ['menuA', 'Manage Menu'], ['settings', 'Settings']] : [['menu', 'Menu'], ['my', 'My Orders']];
  items.push(['support', 'Support'], ['about', 'About']);
  return `<header class="nav"><div class="nb"><span class="logo">𝐉𝐒⃝𝐄𝐂</span><span class="brand">BiteTheSite</span></div>
  <nav class="nl">${items.map(([k, l]) => `<button class="${view === k || (k === 'menu' && view === 'checkout') ? 'on' : ''}" data-a="go" data-v="${k}">${l}</button>`).join('')}</nav>
  <div class="nr"><span class="who">${esc(me.name)}</span><button class="btn alt sm" data-a="logout">Logout</button></div></header>`;
}
const fab = () => (me.role !== 'admin' && view === 'menu' && count()) ? `<div class="fab"><button class="btn" data-a="go" data-v="checkout">Cart · ${count()} items · ${money(total())} →</button></div>` : '';

function studentV() { return view === 'my' ? myV() : view === 'checkout' ? checkoutV() : menuV(); }
function gridV() {
  const items = menu.filter(m => m.available && (cat === 'All' || m.cat === cat) && m.name.toLowerCase().includes(q.toLowerCase()));
  return items.map((m, i) => `<div class="card" style="--i:${i % 12}"><div class="img">${m.image_path ? `<img src="${esc(foodUrl(m.image_path))}" alt="${esc(m.name)}" loading="lazy">` : esc(m.emoji)}</div><div class="in"><div class="b" style="font-size:15px">${esc(m.name)}</div>
  ${m.description ? `<div class="d">${esc(m.description)}</div>` : ''}<div class="price">${money(m.price)}</div>
  ${cart[m.id] ? `<div class="q"><button data-a="chg" data-id="${m.id}" data-d="-1">−</button><span>${cart[m.id]}</span><button data-a="chg" data-id="${m.id}" data-d="1">+</button></div>` : `<button class="btn" data-a="chg" data-id="${m.id}" data-d="1">+ Add</button>`}</div></div>`).join('') || '<p class="mut">No items found.</p>';
}
function menuV() {
  return `<section class="hero"><p class="eyebrow">Welcome back, ${esc(me.name.split(' ')[0])}</p><h1>What are you craving today?</h1><p class="sub">WelCome our Student Canteen... Fresh from the canteen kitchen. Order ahead and collect it when it is ready. </p>
  <div class="hstats"><span>Skip the queue</span><span>Cash or UPI</span><span>Live order status</span></div></section>
  <input id="search" data-in="search" placeholder="Search delicious food…" value="${esc(q)}">
  <div class="chips">${cats().map(c => `<button class="chip ${c === cat ? 'on' : ''}" data-a="cat" data-v="${esc(c)}">${esc(c)}</button>`).join('')}</div><div class="grid" id="grid">${gridV()}</div>`;
}
function checkoutV() {
  const rows = Object.entries(cart).map(([id, n]) => { const m = menu.find(x => x.id === id); return m ? `<tr><td>${esc(m.name)}</td><td>${n}</td><td>${money(m.price * n)}</td></tr>` : ''; }).join('');
  if (!rows) return `<div class="panel">Cart is empty. <button class="btn sm" data-a="go" data-v="menu">Back to menu</button></div>`;
  return `<h2>Your cart</h2><div class="panel scroll"><table><tr><th>Item</th><th>Qty</th><th>Price</th></tr>${rows}<tr><td class="b">Total</td><td></td><td class="price">${money(total())}</td></tr></table></div>
  <div class="panel"><label>Note for the canteen (optional)</label><textarea data-in="note" rows="2" maxlength="200" placeholder="e.g. Delivery Room No(208,303), pack separately, pick-up at 10:05 PM">${esc(note)}</textarea>
  <h3 style="margin:6px 0 10px">Payment method</h3><div class="row start"><button class="chip ${pay === 'Cash' ? 'on' : ''}" data-a="pay" data-v="Cash">Cash</button><button class="chip ${pay === 'Online' ? 'on' : ''}" data-a="pay" data-v="Online">Online (UPI)</button></div>
  ${pay === 'Online' ? `<p>Pay <b>${money(total())}</b> to:<br>UPI ID: <b>${esc(settings.upi || '(not set by admin yet)')}</b><br>Phone: <b>${esc(settings.phone || '-')}</b></p><label>Upload payment screenshot (required)</label><input type="file" accept="image/*" data-in="shot">${shotPrev ? `<img class="shot" src="${shotPrev}" alt="screenshot preview">` : ''}` : '<p class="mut">Pay cash when you collect your order.</p>'}
  <div class="msg">${esc(msg)}</div><div class="row start"><button class="btn alt" data-a="go" data-v="menu">← Back</button><button class="btn ok" data-a="place" ${busy ? 'disabled' : ''}>Place order</button></div></div>`;
}
function ordCard(o, adm) {
  return `<div class="panel"><div class="row"><span class="b">#${o.id.slice(0, 5)} · ${new Date(o.created_at).toLocaleString()}</span><span class="tag ${o.status}">${o.status}</span></div>
  ${adm ? `<p><b>${esc(o.cust_name)}</b> · ${esc(o.cust_roll)} · ${esc(o.cust_dept)} · ${esc(o.cust_phone)}</p>` : ''}
  <p>${o.items.map(i => esc(i.name) + ' ×' + Number(i.qty)).join(', ')}</p><p><span class="price">${money(o.total)}</span> · ${o.method}</p>
  ${o.note ? `<p>📝 <b>Note:</b> ${esc(o.note)}</p>` : ''}
  ${o.shot_path && urls[o.shot_path] ? `<a href="${urls[o.shot_path]}" target="_blank" rel="noopener"><img class="shot" src="${urls[o.shot_path]}" alt="payment screenshot"></a>` : ''}
  ${o.comment ? `<p class="mut">Admin: ${esc(o.comment)}</p>` : ''}
  ${adm && o.status === 'Pending' ? `<textarea id="c${o.id}" rows="2" maxlength="300" placeholder="Reply / comment (optional)"></textarea><div class="row start"><button class="btn ok sm" data-a="decide" data-id="${o.id}" data-v="Accepted">Accept</button><button class="btn sm" data-a="decide" data-id="${o.id}" data-v="Rejected">Reject</button></div>` : ''}</div>`;
}
const myV = () => `<h2 style="margin-bottom:16px">My orders</h2>` + (orders.filter(o => o.user_id === me.id).map(o => ordCard(o)).join('') || '<p class="mut">No orders yet.</p>');

function adminV() {
  if (view === 'menuA') return menuAV();
  if (view === 'settings') return `<h2 style="margin-bottom:16px">Settings</h2><div class="panel"><h3 style="margin-bottom:10px">Payment</h3><label>UPI ID</label><input id="su" maxlength="60" value="${esc(settings.upi)}"><label>Phone number (GPay/PhonePe)</label><input id="sp" maxlength="15" value="${esc(settings.phone)}">
  <h3 style="margin:6px 0 10px">Support contacts (shown to students)</h3><label>Support phone</label><input id="sc" maxlength="15" value="${esc(settings.support_phone)}"><label>WhatsApp number (with country code, e.g. 919876543210)</label><input id="sw" maxlength="15" value="${esc(settings.whatsapp)}"><label>Support email</label><input id="se" maxlength="80" value="${esc(settings.support_email)}">
  <div class="msg">${esc(msg)}</div><button class="btn" data-a="saveSet">Save</button></div>`;
  const o = orders.filter(x => flt === 'All' || x.status === flt);
  return `<div class="row" style="margin-bottom:12px"><h2>Orders</h2><button class="btn alt sm" data-a="alerts">🔔 Enable alerts</button></div><div class="chips">${['Pending', 'Accepted', 'Rejected', 'All'].map(f => `<button class="chip ${f === flt ? 'on' : ''}" data-a="flt" data-v="${f}">${f}</button>`).join('')}</div>` + (o.map(x => ordCard(x, 1)).join('') || '<p class="mut">No orders here.</p>');
}
function menuAV() {
  const e = editId ? menu.find(x => x.id === editId) : null, v = e || {};
  return `<h2 style="margin-bottom:16px">Manage menu</h2><div class="panel"><h3 style="margin-bottom:10px">${e ? 'Edit item' : 'Add new item'}</h3>
  <div class="two"><div><label>Name</label><input id="an" maxlength="60" value="${esc(v.name)}"></div><div><label>Category</label><input id="ac" list="cl" maxlength="40" value="${esc(v.cat)}"><datalist id="cl">${cats().slice(1).map(c => `<option value="${esc(c)}">`).join('')}</datalist></div>
  <div><label>Price ₹</label><input id="ap" type="number" min="0" step="0.5" value="${v.price ?? ''}"></div><div><label>Emoji (if no photo)</label><input id="ae" maxlength="4" value="${esc(v.emoji)}"></div></div>
  <label>Description / details</label><textarea id="ad" rows="2" maxlength="200" placeholder="e.g. Crispy, served with green chutney">${esc(v.description)}</textarea>
  <label>Food photo (optional)</label><input type="file" accept="image/*" data-in="food"><img id="pv" class="shot" alt="preview" ${v.image_path ? `src="${esc(foodUrl(v.image_path))}"` : 'hidden'}>
  <div class="msg">${esc(msg)}</div><div class="row start"><button class="btn" data-a="saveItem" ${busy ? 'disabled' : ''}>${e ? 'Save changes' : 'Add item'}</button>${e ? '<button class="btn alt" data-a="cancelEdit">Cancel</button>' : ''}</div></div>
  <div class="panel scroll"><table><tr><th></th><th>Item</th><th>Category</th><th>Price</th><th>Available</th><th></th></tr>${menu.map(m => `<tr><td>${m.image_path ? `<img class="th" src="${esc(foodUrl(m.image_path))}" alt="">` : esc(m.emoji)}</td><td><b>${esc(m.name)}</b><div class="mut">${esc(m.description)}</div></td><td>${esc(m.cat)}</td><td>${money(m.price)}</td><td><input type="checkbox" style="width:auto;margin:0" data-in="tgl" data-id="${m.id}" ${m.available ? 'checked' : ''}></td><td><button class="btn alt sm" data-a="edit" data-id="${m.id}">Edit</button> <button class="btn sm" data-a="delItem" data-id="${m.id}">Del</button></td></tr>`).join('')}</table></div>`;
}
function supportV() {
  const s = settings, tel = (s.support_phone || '').replace(/[^\d+]/g, ''), wa = (s.whatsapp || '').replace(/\D/g, ''), mail = (s.support_email || '').trim();
  const btns = [tel && `<a class="btn" href="tel:${esc(tel)}">📞 Call</a>`, wa && `<a class="btn ok" href="https://wa.me/${esc(wa)}" target="_blank" rel="noopener">💬 WhatsApp</a>`, mail && `<a class="btn alt" href="mailto:${esc(mail)}">✉️ Email</a>`].filter(Boolean).join(' ');
  const faq = [['How do I pay online?', 'At checkout choose Online (UPI), pay the shown UPI ID / phone, then upload the payment screenshot. The canteen verifies it and accepts your order.'],
    ['My order was rejected. Why?', 'Check the admin comment on the order in My Orders. Common reasons: item sold out or payment not received.'],
    ['Can I cancel an order?', 'Contact support quickly with your order number (the # code on the order). Accepted orders may already be in preparation.'],
    ['Refunds?', 'If an online payment was made for a rejected order, contact support with the order number and screenshot.'],
    ['I forgot my password', 'Ask support to help you reset it, or sign up again with another email if needed.']];
  return `<h2 style="margin-bottom:16px">Support</h2><div class="panel"><p>Need help with an order? Contact the canteen team.</p><div class="row start">${btns || '<span class="mut">Support contact not set yet. Admin can add it in Settings.</span>'}</div></div>
  <div class="panel"><h3 style="margin-bottom:8px">FAQ</h3>${faq.map(([a, b]) => `<details><summary>${esc(a)}</summary><p>${esc(b)}</p></details>`).join('')}</div>`;
}
const aboutV = () => `<h2 style="margin-bottom:16px">About </h2><div class="panel"><p><b>Created by Student's</b><br>BiteSite is a JSEC Campus canteen ordering platform built by a student, for students. Pick your food, pay once and collect it the moment it is ready, no more standing in the queue.
<pre>
  ‼️IMPORTANT‼️
(づ ᴗ _ᴗ)づ        𝗦𝗨𝗣𝗣𝗢𝗥𝗧 𝗢𝗡  
 🅾 𝐈𝐧𝐬𝐭𝐚𝐠𝐫𝐚𝐦 ★ : <b><a href="https://www.instagram.com/student_canteen_jsec">𝗦𝗧𝗨𝗗𝗘𝗡𝗧_𝗖𝗔𝗡𝗧𝗘𝗘𝗡</a></b>
</pre>
</p></div>
  <div class="panel"><h3 style="margin-bottom:8px">How it works</h3><p>1️⃣ Browse the menu and add items to your cart.<br>2️⃣ Add a note if you want (less spicy, pickup time…)ᯓ.<br>3️⃣ Pay by cash or UPI (upload the screenshot).<br>4️⃣ The canteen accepts your order and you collect it.</p></div>
  <div class="panel"><h3 style="margin-bottom:8px">Your data</h3><p class="mut">Passwords are securely hashed. Payment screenshots are private and visible only to you and the canteen admin. 
  <hr>
  <pre>
🔨<B>𝐓𝐇𝐀𝐌𝐈𝐙𝐇 𝐃𝐄𝐕𝐄𝐋𝐎𝐏𝐄𝐑'𝐒</B>🔨

 📜 𝙵-𝙴-𝙳 𝚊𝚗𝚍 𝙳𝚎𝚜𝚒𝚐𝚗𝚎𝚛  : 𝐁𝐚𝐫𝐤𝐚𝐯𝐢 𝐤
 📶 𝙱-𝙴-𝙳 𝙽𝚎𝚝𝚠𝚘𝚛𝚔𝚒𝚗𝚐    : 𝐊𝐢𝐬𝐡𝐨𝐫𝐞 𝐒
 🦋 𝙸𝚗𝚏𝚕𝚞𝚎𝚗𝚌𝚎𝚛          : 𝐑𝐚𝐬𝐢𝐠𝐚𝐚𝐏𝐫𝐢𝐲𝐚 𝐁
 💜 𝙿𝚛𝚘𝚖𝚘𝚝𝚒𝚗𝚐  𝙷𝚎𝚊𝚍     : 𝐏𝐨𝐨𝐫𝐚𝐧𝐢 𝐊
 💛 𝙲𝚘𝚍𝚎 𝙷𝚊𝚗𝚍𝚕𝚎𝚛        : 𝐇𝐞𝐦𝐚𝐥𝐚𝐭𝐡𝐚 𝐊
 🛡️ 𝙳𝚎𝚏𝚎𝚗𝚌𝚎 𝙼𝚊𝚗𝚊𝚐𝚎𝚛     : 𝐊𝐞𝐧𝐧𝐲 𝐈
 💥 𝙳𝚎𝚟𝚎𝚕𝚘𝚙𝚒𝚗𝚐 𝚖𝚊𝚗𝚊𝚐𝚎𝚛  : 𝐃𝐢𝐧𝐞𝐬𝐡 𝐁𝐚𝐛𝐮
 🪶 𝙿𝚛𝚘𝚍𝚞𝚌𝚎𝚛             : 𝐃𝐡𝐚𝐫𝐬𝐡𝐢𝐧𝐢 𝐒
 💹 𝙰𝚌𝚌𝚘𝚞𝚗𝚝 𝙼𝚊𝚗𝚊𝚐𝚎𝚖𝚎𝚗𝚝  : 𝐏𝐨𝐨𝐣𝐚 𝐒
 🌼 𝙽𝚎𝚝𝚠𝚘𝚛𝚔𝚒𝚗𝚐 𝙷𝚎𝚊𝚍     : 𝐇𝐚𝐫𝐢𝐧𝐢 𝐌
 💵 𝚂𝚝𝚞𝚍𝚎𝚗𝚝 𝚂𝚙𝚘𝚗𝚜𝚘𝚛     : 𝗔𝗺𝗶𝗿𝘁𝗵 
 <hr>
 <b>𝐃𝐞𝐩𝐚𝐫𝐭𝐦𝐞𝐧𝐭 𝐎𝐟 𝐀𝐈-𝐃𝐒</b>
 
 📟 𝚃𝚎𝚌𝚑𝚗𝚒𝚌𝚊𝚕 𝚂𝚞𝚙𝚙𝚘𝚛𝚝       : 𝐕𝐢𝐬𝐡𝐚𝐥
 👥 𝚃𝚎𝚊𝚖 𝚂𝚞𝚙𝚙𝚘𝚛𝚝𝚎𝚛          : 𝐕𝐚𝐧𝐢𝐬𝐡𝐚 𝐒
 🛠 𝙳𝚊𝚝𝚊𝚋𝚊𝚜𝚎 𝙼𝚊𝚗𝚊𝚐𝚎𝚛        : 𝐍𝐢𝐬𝐡𝐚𝐧𝐭𝐡 𝐀
 🪽 𝚂𝚞𝚙𝚙𝚘𝚛𝚝𝚒𝚗𝚐 𝙲𝚘𝚖𝚖𝚞𝚗𝚒𝚝𝚢   : 𝐘𝐮𝐰𝐚𝐬𝐡𝐫𝐞𝐞 𝐊
 🔗 𝙶.𝙷𝚘𝚜𝚝𝚊𝚕 𝙲𝚘𝚕𝚕𝚊𝚋𝚘𝚛𝚊𝚝𝚒𝚘𝚗 : 𝐒𝐢𝐯𝐚𝐫𝐚𝐧𝐣𝐚𝐧𝐢
<hr><h3 align="center">𝗢𝗻𝗲 𝗠𝗮𝗻 𝗛𝗲𝗮𝗱 𝐍𝐒⃝</h3></b><hr>
</pre>
  </p></div>  <h4 align="center">
  <pre> 𝘾𝙤𝙫𝙚𝙧𝙚𝙙 𝙗𝙮 
                𝙉𝐒 𝐜𝐨𝐫𝐩𝐨𝐫𝐚𝐭𝐞🪷
        𝘾𝙤𝙫𝙚𝙧𝙚𝙙 𝙗𝙮 
                𝙉𝐒 𝙘𝙤𝙥𝙤𝙧𝙖𝙩𝙚🪷</pre></h4>
             `;

/* ---------- actions ---------- */
function compress(f, maxW, cb) {
  const im = new Image(), u = URL.createObjectURL(f);
  im.onload = () => { const k = Math.min(1, maxW / im.width), c = document.createElement('canvas'); c.width = im.width * k; c.height = im.height * k;
    c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); URL.revokeObjectURL(u); c.toBlob(b => cb(b, c.toDataURL('image/jpeg', .75)), 'image/jpeg', .78); };
  im.onerror = () => URL.revokeObjectURL(u); im.src = u;
}
async function refresh(m = '') { msg = m; await loadAll(); render(); }
const acts = {
  tab: d => { authTab = d.v; msg = ''; render(); },
  go: d => { view = d.v; side = false; msg = ''; render(); scrollTo(0, 0); },
  async alerts() { beep(); try { await Notification.requestPermission(); } catch (e) { } toast('Alerts enabled: you will hear a beep for new orders'); },
  cat: d => { cat = d.v; render(); },
  pay: d => { pay = d.v; msg = ''; render(); },
  flt: d => { flt = d.v; render(); },
  chg: d => { const n = (cart[d.id] || 0) + +d.d; if (n <= 0) delete cart[d.id]; else cart[d.id] = n; render(); },
  async login() {
    busy = true; msg = ''; const { error } = await sb.auth.signInWithPassword({ email: $('#e').value.trim(), password: $('#w').value });
    busy = false; if (error) { msg = /invalid login/i.test(error.message) ? 'Wrong email or password (or email not confirmed yet)' : err(error); render(); } else boot();
  },
  async signup() {
    const g = x => $('#' + x).value.trim(), pw = $('#w').value;
    const v = { name: g('n'), roll: g('r'), dept: g('d'), phone: g('p'), email: g('e') };
    if (v.name.length < 2 || !v.roll || !v.dept || !v.email) { msg = 'Fill all fields'; return render(); }
    if (!/^\d{10}$/.test(v.phone)) { msg = 'Phone must be 10 digits'; return render(); }
    if (pw.length < 8) { msg = 'Password must be at least 8 characters'; return render(); }
    busy = true; msg = ''; render();
    const { data, error } = await sb.auth.signUp({ email: v.email, password: pw, options: { data: { name: v.name, roll: v.roll, dept: v.dept, phone: v.phone } } });
    busy = false;
    if (error) { msg = err(error); render(); } else if (!data.session) { msg = 'Check your email to confirm, then sign in.'; authTab = 'in'; render(); } else boot();
  },
  async logout() { await sb.auth.signOut(); if (chan) { sb.removeChannel(chan); chan = null; } me = null; cart = {}; orders = []; side = false; msg = ''; render(); },
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
      const { error } = await sb.rpc('place_order', { p_items: Object.entries(cart).map(([id, qty]) => ({ id, qty })), p_method: pay, p_shot: path, p_note: note.trim().slice(0, 200) });
      if (error) throw error;
      cart = {}; shotBlob = shotPrev = null; pay = 'Cash'; note = ''; view = 'my'; await loadAll();
    } catch (e) { msg = err(e); }
    busy = false; render();
  },
  async decide(d) { const c = document.getElementById('c' + d.id)?.value.trim().slice(0, 300) || ''; const { error } = await sb.from('orders').update({ status: d.v, comment: c }).eq('id', d.id); await refresh(error ? err(error) : ''); },
  edit: d => { editId = d.id; foodBlob = null; msg = ''; render(); scrollTo(0, 0); },
  cancelEdit: () => { editId = null; foodBlob = null; msg = ''; render(); },
  async saveItem() {
    const name = $('#an').value.trim(), c = $('#ac').value.trim(), p = parseFloat($('#ap').value);
    if (!name || !c || !(p >= 0)) return flash('Fill name, category and price');
    busy = true; flash('Saving…');
    try {
      const old = editId ? menu.find(x => x.id === editId) : null; let image_path = old?.image_path || null;
      if (foodBlob) {
        const path = `${crypto.randomUUID()}.jpg`;
        const up = await sb.storage.from('food').upload(path, foodBlob, { contentType: 'image/jpeg' }); if (up.error) throw up.error;
        if (image_path) await sb.storage.from('food').remove([image_path]); image_path = path;
      }
      const row = { name, cat: c, price: p, emoji: $('#ae').value.trim() || '🍴', description: $('#ad').value.trim().slice(0, 200), image_path };
      const { error } = editId ? await sb.from('menu_items').update(row).eq('id', editId) : await sb.from('menu_items').insert(row);
      if (error) throw error;
      editId = null; foodBlob = null; busy = false; await refresh('');
    } catch (e) { busy = false; flash(err(e)); }
  },
  async delItem(d) {
    if (!confirm('Delete this item?')) return; const m = menu.find(x => x.id === d.id);
    const { error } = await sb.from('menu_items').delete().eq('id', d.id);
    if (!error && m?.image_path) await sb.storage.from('food').remove([m.image_path]);
    await refresh(error ? err(error) : '');
  },
  async saveSet() {
    const { error } = await sb.from('settings').update({ upi: $('#su').value.trim(), phone: $('#sp').value.trim(), support_phone: $('#sc').value.trim(), whatsapp: $('#sw').value.trim(), support_email: $('#se').value.trim() }).eq('id', 1);
    if (error) return flash(err(error)); await loadAll(); flash('Saved ✓');
  }
};
const inp = { search: el => { q = el.value; $('#grid').innerHTML = gridV(); }, note: el => { note = el.value; } };
const chg = {
  async tgl(el, d) { await sb.from('menu_items').update({ available: el.checked }).eq('id', d.id); await refresh(); },
  shot: el => { const f = el.files[0]; if (f) compress(f, 900, (b, p) => { shotBlob = b; shotPrev = p; render(); }); },
  food: el => { const f = el.files[0]; if (f) compress(f, 800, (b, p) => { foodBlob = b; const pv = $('#pv'); pv.src = p; pv.hidden = false; }); }
};
app.addEventListener('click', e => { const b = e.target.closest('[data-a]'); if (b && acts[b.dataset.a]) acts[b.dataset.a](b.dataset); });
app.addEventListener('input', e => { const t = e.target.closest('[data-in]'); if (t && inp[t.dataset.in]) inp[t.dataset.in](t); });
app.addEventListener('change', e => { const t = e.target.closest('[data-in]'); if (t && chg[t.dataset.in]) chg[t.dataset.in](t, t.dataset); });
boot();
