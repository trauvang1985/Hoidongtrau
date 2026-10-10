// Zalo Bot webhook cho Hội Pink Pumper (Vercel serverless function)
const { createClient } = require("@supabase/supabase-js");
const BASE = "https://bot-api.zaloplatforms.com";
const ROUND = 1000; // làm tròn lên mỗi khoản chuyển tới 1.000đ
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });

const norm = s => String(s || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
const vnd = n => Math.round(n).toLocaleString("vi-VN") + "đ";

function money(s) {
  const t = norm(s).replace(/\s/g, "").replace(/(vnd|dong|d)$/, "");
  let m;
  if ((m = t.match(/^(\d+)(tr|trieu|m)(\d+)$/))) return Math.round(+m[1] * 1e6 + Number("0." + m[3]) * 1e6);
  if ((m = t.match(/^(\d+(?:[.,]\d+)?)(tr|trieu|m)$/))) return Math.round(parseFloat(m[1].replace(",", ".")) * 1e6);
  if ((m = t.match(/^(\d+(?:[.,]\d+)?)(k|nghin|ngan)$/))) return Math.round(parseFloat(m[1].replace(",", ".")) * 1e3);
  if (/^\d{1,3}([.,]\d{3})+$/.test(t)) return +t.replace(/[.,]/g, "");
  if (/^\d+$/.test(t)) return +t;
  return null;
}

function settle(members, exps) {
  const total = exps.reduce((a, e) => a + e.amount, 0), n = members.length, share = total / n, paid = {};
  exps.forEach(e => (paid[e.payer_id] = (paid[e.payer_id] || 0) + e.amount));
  const net = {};
  new Set([...members, ...Object.keys(paid)]).forEach(u => (net[u] = (paid[u] || 0) - (members.includes(u) ? share : 0)));
  const cr = Object.entries(net).filter(([, v]) => v > 0.5).map(([u, v]) => ({ u, v })).sort((a, b) => b.v - a.v);
  const de = Object.entries(net).filter(([, v]) => v < -0.5).map(([u, v]) => ({ u, v: -v }));
  const tr = [];
  for (const d of de) for (const c of cr) {
    if (d.v <= 0.5) break;
    if (c.v <= 0.5) continue;
    const a = Math.min(d.v, c.v);
    tr.push({ from: d.u, to: c.u, amt: Math.ceil(a / ROUND) * ROUND });
    d.v -= a; c.v -= a;
  }
  return { total, n, share, paid, tr };
}

async function send(chatId, text) {
  for (let i = 0; i < text.length; i += 1900) {
    const r = await fetch(`${BASE}/bot${(process.env.ZALO_BOT_TOKEN || "").trim()}/sendMessage`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text: text.slice(i, i + 1900) }),
    });
    const t = await r.text();
    if (!r.ok || /"ok"\s*:\s*false/.test(t)) console.error("SEND FAIL", r.status, t.slice(0, 300));
    else console.log("SEND OK", r.status);
  }
}

const CMD = { vote: "vote", tonghop: "vote", sukien: "sukien", tao: "sukien", thamgia: "join", join: "join", thoat: "leave", roi: "leave",
  chi: "chi", ung: "chi", chia: "chia", tinh: "chia", ketthuc: "end", dong: "end", stk: "stk", taikhoan: "stk",
  lienket: "link", link: "link", huylienket: "unlink", ds: "ds", danhsach: "ds", help: "help", huongdan: "help", menu: "help" };

const HELP = `🤖 Bot Hội Pink Pumper
• vote: tổng hợp các bình chọn
• tag bot (hoặc gõ sukien): bot hỏi từng bước để tạo sự kiện, ghi khoản chi, chia tiền
• sukien <tên>: tạo nhanh sự kiện
• thamgia [tên bạn bè, cách nhau dấu phẩy]: tham gia / thêm người
• thoat: rời sự kiện
• chi <số tiền> [nội dung]: ghi khoản bạn đã trả (VD: chi 1tr2 ăn tối, chi 350k)
• ds: xem người tham gia và các khoản đã chi
• chia: chia đều tiền, báo ai chuyển cho ai
• ketthuc: đóng sự kiện
• stk <ngân hàng> <số tài khoản>: lưu tài khoản nhận tiền
• lienket <mã>: liên kết Zalo với tài khoản web (nhắn riêng cho bot)
• Nhắn chào hỏi hoặc chúc mừng sinh nhật để bot trò chuyện
Trong nhóm hãy @ tên bot rồi gõ lệnh.`;

// ===== Trò chuyện phiếm (miễn phí, không dùng AI) =====
function vnNow() {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit", hourCycle: "h23" }).formatToParts(new Date());
  const g = t => +p.find(x => x.type === t).value;
  return { h: g("hour") % 24, min: g("minute"), d: g("day"), mo: g("month") };
}
const pick = a => a[Math.floor(Math.random() * a.length)];
async function chat(m, N) {
  const now = vnNow(), t = N.join(" ");
  let profs = [], me = null;
  try { profs = await one(sb.from("profiles").select("id,name,bday")); } catch (e) {}
  try {
    const lk = await one(sb.from("zalo_links").select("user_id").eq("zalo_id", String(m.from.id)).maybeSingle());
    if (lk) me = profs.find(p => p.id === lk.user_id);
  } catch (e) {}
  const name = (me && me.name) || m.from.display_name || "bạn";
  const today = profs.filter(p => p.bday && +p.bday.slice(5, 7) === now.mo && +p.bday.slice(8, 10) === now.d).map(p => p.name);
  const has = (...w) => w.some(x => t.includes(x));
  if (has("sinh nhat", "hpbd", "happy birthday", "birthday")) {
    const named = profs.filter(p => p.name && (" " + t + " ").includes(" " + norm(p.name) + " ")).map(p => p.name), who = named.length ? named : today;
    return `🎂🎉 ${pick(["Chúc mừng sinh nhật", "Happy birthday", "Sinh nhật vui vẻ"])}${who.length ? " " + who.join(", ") : ""}! ${pick(["Chúc luôn khỏe mạnh, hạnh phúc và thật nhiều niềm vui nhé!", "Tuổi mới thật nhiều sức khỏe, may mắn và bình an!", "Tuổi mới vui hơn, trẻ hơn và đầy năng lượng nhé!"])} 🥳`;
  }
  const greet = /(^| )(xin chao|chao|hello|hi|hey|alo|halo)( |$)/.test(t);
  const bd = greet && today.length ? `\n🎂 Hôm nay là sinh nhật của ${today.join(", ")}, nhớ gửi lời chúc nhé!` : "";
  if (now.h < 5) return "Má ơi cày đêm vừa thôi!";
  if (now.h < 8 || (now.h === 8 && now.min < 30)) return `☀️ Chào ngày mới, ${name}!${bd}`;
  if (now.h >= 23) return "🌙 Ngủ đi bạn ơi!";
  if (greet) return `👋 ${pick(["Chào", "Xin chào", "Hello"])} ${name}! Chúc bạn một ngày vui vẻ.${bd}`;
  return null;
}

const one = async q => { const { data, error } = await q; if (error) throw error; return data; };
const curEvent = () => one(sb.from("events").select("*").eq("closed", false).order("created_at", { ascending: false }).limit(1).maybeSingle());

// ===== Hỏi đáp từng bước để tạo sự kiện =====
const SES_MS = 30 * 60 * 1000;
const SKIP = new Set(["vote", "help", "ds", "chia", "end", "stk", "link", "unlink"]);
const sKey = m => `${m.chat.id}:${m.from.id}`;
const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
function clean(t) { // bỏ phần @tên bot ở đầu tin
  let s = String(t || "").trim();
  const bn = (process.env.BOT_NAME || "").trim();
  if (bn) s = s.replace(new RegExp("^@?\\s*" + reEsc(bn) + "[\\s,:]*", "i"), "");
  return s.replace(/^(@\S+\s*)+/, "").trim();
}
function parseNames(str, profs, uid) {
  const ids = [], bad = [];
  str.split(/[,;]+|\s+và\s+/i).map(s => s.trim()).filter(Boolean).forEach(s => {
    const n = norm(s);
    if (/^(minh|toi|tui|me)$/.test(n)) { ids.push(uid); return; }
    const hit = profs.filter(p => norm(p.name) === n), h2 = hit.length ? hit : profs.filter(p => norm(p.name).includes(n));
    h2.length === 1 ? ids.push(h2[0].id) : bad.push(s);
  });
  return { ids: [...new Set(ids)], bad };
}
function chiaText(ev, members, exps, P, nm) {
  const s = settle(members, exps), to = [...new Set(s.tr.map(t => t.to))];
  let out = `💰 CHIA TIỀN: ${ev.title}\nTổng chi ${vnd(s.total)} · ${s.n} người → mỗi người ${vnd(s.share)} (chuyển làm tròn lên ${vnd(ROUND)})\n`;
  if (!to.length) return out + "Không ai cần chuyển thêm.";
  for (const c of to) {
    const p = P[c], got = s.tr.filter(t => t.to === c);
    out += `\n👤 ${nm(c)} đã ứng ${vnd(s.paid[c] || 0)}\n🏦 ${p && p.bank_account ? `${p.bank_name} · ${p.bank_account} · ${p.name}` : "chưa có STK (nhắn: stk <ngân hàng> <số TK>)"}\n➡️ Cần chuyển cho ${nm(c)}:\n` +
      got.map(t => `• ${nm(t.from)}: ${vnd(t.amt)}`).join("\n") + "\n";
  }
  return out.trim();
}
const saveSes = (m, step, data) => one(sb.from("bot_sessions").upsert({ skey: sKey(m), step, data, updated_at: new Date().toISOString() }));
const delSes = m => one(sb.from("bot_sessions").delete().eq("skey", sKey(m)));

async function startWizard(m) {
  const lk = await one(sb.from("zalo_links").select("user_id").eq("zalo_id", String(m.from.id)).maybeSingle());
  if (!lk) return "Bạn chưa liên kết tài khoản. Vào web → tab Hồ sơ lấy mã, rồi nhắn riêng cho bot: lienket MÃ";
  await saveSes(m, "title", {});
  const grp = String(m.chat.chat_type || "").toUpperCase() === "GROUP";
  return "Có sự kiện gì à bạn? 🎉 Nhắn tên hoặc nội dung sự kiện nhé (gõ “huy” để hủy)." + (grp ? "\n(Trong nhóm, bạn hãy trả lời trực tiếp vào tin này của bot.)" : "");
}

async function wizard(m, N) {
  const ses = await one(sb.from("bot_sessions").select("*").eq("skey", sKey(m)).maybeSingle());
  if (!ses) return null;
  if (Date.now() - Date.parse(ses.updated_at) > SES_MS) { await delSes(m); return null; }
  const i = N.findIndex(t => CMD[t]);
  if (i >= 0 && SKIP.has(CMD[N[i]])) return null;
  const txt = clean(m.text), tn = norm(txt);
  if (/^(huy|cancel)$/.test(tn)) { await delSes(m); return "Đã hủy. Tag bot để bắt đầu lại nhé."; }
  const lk = await one(sb.from("zalo_links").select("user_id").eq("zalo_id", String(m.from.id)).maybeSingle());
  if (!lk) { await delSes(m); return null; }
  const uid = lk.user_id, d = ses.data || {};
  const profs = await one(sb.from("profiles").select("id,name,bank_name,bank_account"));
  const P = Object.fromEntries(profs.map(p => [p.id, p])), nm = id => (P[id] && P[id].name) || "Ẩn danh";
  const toMembers = async () => { await saveSes(m, "members", { eid: d.eid }); return "Ai tham gia sự kiện? Gõ tên cách nhau bằng dấu phẩy (VD: An, Bình), hoặc “tất cả”."; };

  if (ses.step === "title") {
    if (!txt) return "Bạn nhắn tên sự kiện giúp mình nhé.";
    const ev = await one(sb.from("events").insert({ title: txt.slice(0, 100), created_by: uid }).select().single());
    await saveSes(m, "amount", { eid: ev.id });
    return `🎉 Sự kiện “${ev.title}”.\nĐã chi bao nhiêu rồi bạn? (VD: 1tr2, 350k, hoặc kèm nội dung: “1tr2 ăn lẩu”). Chưa chi thì nhắn “chưa”.`;
  }
  if (ses.step === "amount") {
    if (/^(chua|khong|ko|het|xong|thoi)( |$)/.test(tn)) return toMembers();
    const toks = txt.replace(/^chi\s+/i, "").split(/\s+/), amt = money(toks[0] || "");
    if (!amt) return "Mình chưa hiểu số tiền. Bạn nhắn dạng 1tr2, 350k hoặc 1.200.000 nhé (hoặc “hết”).";
    await saveSes(m, "payer", { eid: d.eid, amt, note: toks.slice(1).join(" ") });
    return `Ai là người chi ${vnd(amt)}? (gõ tên, hoặc “mình”)`;
  }
  if (ses.step === "payer") {
    const r = parseNames(txt, profs, uid);
    if (r.ids.length !== 1) return `Mình chưa xác định được người chi “${txt}”. Gõ đúng tên hiển thị trên web (một người), hoặc “mình”.`;
    await one(sb.from("expenses").insert({ event_id: d.eid, payer_id: r.ids[0], amount: d.amt, note: d.note || null }));
    await saveSes(m, "amount", { eid: d.eid });
    return `✅ Đã ghi: ${nm(r.ids[0])} chi ${vnd(d.amt)}${d.note ? " (" + d.note + ")" : ""}.\nCòn khoản chi nào khác không? Nhắn số tiền, hoặc “hết”.`;
  }
  if (ses.step === "members") {
    let ids;
    if (/^(tat ca|moi nguoi|ca nhom|ca hoi|all)$/.test(tn)) ids = profs.map(p => p.id);
    else {
      const r = parseNames(txt, profs, uid);
      if (r.bad.length || !r.ids.length) return `Mình chưa xác định được: ${r.bad.join(", ") || txt}. Gõ đúng tên hiển thị trên web, cách nhau dấu phẩy, hoặc “tất cả”.`;
      ids = r.ids;
    }
    await one(sb.from("event_members").upsert(ids.map(u => ({ event_id: d.eid, user_id: u })), { ignoreDuplicates: true }));
    await delSes(m);
    const ev = await one(sb.from("events").select("*").eq("id", d.eid).maybeSingle());
    const exps = await one(sb.from("expenses").select("*").eq("event_id", d.eid));
    const head = `✅ Đã tạo “${ev.title}” với ${ids.length} người: ${ids.map(nm).join(", ")}.\n\n`;
    return exps.length ? head + chiaText(ev, ids, exps, P, nm) : head + "Chưa có khoản chi nào. Khi có, người trả tiền nhắn: chi <số tiền>. Sau đó nhắn “chia” để tính tiền.";
  }
  await delSes(m);
  return null;
}

async function handle(m) {
  const O = m.text.trim().split(/\s+/), N = O.map(norm), i = N.findIndex(t => CMD[t]);
  if (N.includes("ping")) return "pong 🏓 Bot đang hoạt động.";
  const w = await wizard(m, N);
  if (w) return w;
  const t0 = norm(clean(m.text));
  if (!t0 || /^(su kien|tao su kien)$/.test(t0)) return startWizard(m);
  if (i < 0) return (await chat(m, N)) || startWizard(m);
  const cmd = CMD[N[i]], arg = O.slice(i + 1), zid = String(m.from.id);
  if (cmd === "sukien" && !arg.length) return startWizard(m);

  if (cmd === "help") return HELP;
  if (cmd === "link") {
    const code = (arg[0] || "").toUpperCase();
    if (!code) return "Cú pháp: lienket MÃ. Lấy mã ở web, tab Hồ sơ, mục Liên kết Zalo Bot. Nên nhắn riêng cho bot.";
    const row = await one(sb.from("zalo_links").select("user_id").eq("code", code).maybeSingle());
    if (!row) return "Mã không đúng hoặc đã dùng rồi.";
    await one(sb.from("zalo_links").update({ zalo_id: null }).eq("zalo_id", zid));
    await one(sb.from("zalo_links").update({ zalo_id: zid, code: null }).eq("user_id", row.user_id));
    const p = await one(sb.from("profiles").select("name").eq("id", row.user_id).maybeSingle());
    return `✅ Đã liên kết với tài khoản ${p?.name || "của bạn"}.`;
  }
  const lk = await one(sb.from("zalo_links").select("user_id").eq("zalo_id", zid).maybeSingle());
  if (!lk) return "Bạn chưa liên kết tài khoản. Vào web → tab Hồ sơ lấy mã, rồi nhắn riêng cho bot: lienket MÃ";
  const uid = lk.user_id;
  if (cmd === "unlink") { await one(sb.from("zalo_links").update({ zalo_id: null }).eq("user_id", uid)); return "Đã hủy liên kết. Lấy mã mới ở web để liên kết lại."; }

  const profs = await one(sb.from("profiles").select("id,name,bank_name,bank_account"));
  const P = Object.fromEntries(profs.map(p => [p.id, p])), nm = id => P[id]?.name || "Ẩn danh";

  if (cmd === "stk") {
    const acct = arg.find(t => /^\d{6,20}$/.test(t)), bank = arg.filter(t => t !== acct).join(" ");
    if (!acct || !bank) return "Cú pháp: stk <ngân hàng> <số tài khoản>. VD: stk Vietcombank 0123456789";
    await one(sb.from("profiles").update({ bank_name: bank, bank_account: acct }).eq("id", uid));
    return `✅ Đã lưu: ${bank} ${acct}. Khi bạn là người ứng tiền, thông tin này sẽ hiện cho cả nhóm.`;
  }

  if (cmd === "vote") {
    const [polls, votes] = await Promise.all([one(sb.from("polls").select("*").order("created_at", { ascending: false })), one(sb.from("votes").select("*"))]);
    if (!polls.length) return "Chưa có bình chọn nào.";
    const ICON = { time: "🕒", place: "📍", both: "🕒📍" };
    return "🗳️ TỔNG HỢP BÌNH CHỌN\n" + [...polls].sort((a, b) => a.closed - b.closed).map(p => {
      const groups = p.kind === "both" ? [["time", "🕒 Thời gian"], ["place", "📍 Địa điểm"]] : [["main", ""]];
      const sect = groups.map(([g, t]) => {
        const gv = votes.filter(v => v.poll_id === p.id && (v.grp || "main") === g), done = new Set(gv.map(v => v.user_id));
        const os = p.kind === "both" ? p.options.filter(o => o.g === g) : p.options, win = p.kind === "both" ? (p.winners || {})[g] : p.winner;
        const lines = os.map(o => {
          const who = gv.filter(v => v.option_id === o.id).map(v => nm(v.user_id));
          return `${win === o.id ? "✅" : "•"} ${o.label}: ${who.length}${who.length ? " (" + who.join(", ") + ")" : ""}`;
        });
        const miss = profs.filter(x => !done.has(x.id)).map(x => x.name);
        return (t ? t + "\n" : "") + lines.join("\n") + (!win && !p.closed && miss.length ? "\nChưa vote: " + miss.join(", ") : "");
      }).join("\n");
      return `\n${ICON[p.kind] || ""} ${p.title} ${p.closed ? "[ĐÃ CHỐT]" : "[đang mở]"}\n${sect}`;
    }).join("\n");
  }

  if (cmd === "sukien") {
    const title = arg.join(" ").trim() || "Sự kiện";
    const ev = await one(sb.from("events").insert({ title, created_by: uid }).select().single());
    await one(sb.from("event_members").insert({ event_id: ev.id, user_id: uid }));
    return `🎉 Đã tạo sự kiện “${title}”. Mọi người nhắn “thamgia” để tham gia, “chi <số tiền>” khi trả tiền, “chia” để tính tiền.`;
  }

  const ev = await curEvent();
  if (!ev) return "Chưa có sự kiện nào đang mở. Nhắn “sukien <tên>” để tạo.";
  const mem = async () => (await one(sb.from("event_members").select("user_id").eq("event_id", ev.id))).map(r => r.user_id);

  if (cmd === "join") {
    let ids = [uid];
    if (arg.length) {
      ids = []; const bad = [];
      arg.join(" ").split(/[,;]+/).map(s => s.trim()).filter(Boolean).forEach(s => {
        const hit = profs.filter(p => norm(p.name) === norm(s)), h2 = hit.length ? hit : profs.filter(p => norm(p.name).includes(norm(s)));
        h2.length === 1 ? ids.push(h2[0].id) : bad.push(s);
      });
      if (bad.length) return `Không xác định được: ${bad.join(", ")}. Hãy gõ đúng tên hiển thị trên web.`;
    }
    await one(sb.from("event_members").upsert(ids.map(u => ({ event_id: ev.id, user_id: u })), { ignoreDuplicates: true }));
    const all = await mem();
    return `✅ ${ids.map(nm).join(", ")} tham gia “${ev.title}”. Hiện có ${all.length} người.`;
  }
  if (cmd === "leave") { await one(sb.from("event_members").delete().eq("event_id", ev.id).eq("user_id", uid)); return `Đã rời “${ev.title}”.`; }
  if (cmd === "end") { await one(sb.from("events").update({ closed: true }).eq("id", ev.id)); return `🔒 Đã đóng sự kiện “${ev.title}”.`; }

  if (cmd === "chi") {
    const amt = money(arg[0] || "");
    if (!amt) return "Cú pháp: chi <số tiền> [nội dung]. VD: chi 1tr2 ăn tối, chi 350k, chi 1.200.000";
    await one(sb.from("expenses").insert({ event_id: ev.id, payer_id: uid, amount: amt, note: arg.slice(1).join(" ") || null }));
    const ex = await one(sb.from("expenses").select("amount").eq("event_id", ev.id));
    return `✅ Đã ghi: ${nm(uid)} chi ${vnd(amt)}${arg[1] ? " (" + arg.slice(1).join(" ") + ")" : ""}. Tổng đã chi của sự kiện: ${vnd(ex.reduce((a, e) => a + e.amount, 0))}.`;
  }

  const [members, exps] = await Promise.all([mem(), one(sb.from("expenses").select("*").eq("event_id", ev.id).order("created_at"))]);
  if (cmd === "ds") {
    return `📋 ${ev.title}\nNgười tham gia (${members.length}): ${members.map(nm).join(", ") || "chưa có"}\n` +
      (exps.length ? "Các khoản đã chi:\n" + exps.map(e => `• ${nm(e.payer_id)}: ${vnd(e.amount)}${e.note ? " – " + e.note : ""}`).join("\n") : "Chưa có khoản chi nào.");
  }
  if (cmd === "chia") {
    if (!members.length) return "Chưa có ai tham gia. Nhắn “thamgia” trước.";
    if (!exps.length) return "Chưa có khoản chi nào. Người trả tiền nhắn “chi <số tiền>”.";
    return chiaText(ev, members, exps, P, nm);
  }
  return HELP;
}

module.exports = async (req, res) => {
  if (req.method === "GET") { // đăng ký webhook: /api/zalo?setup=<ZALO_WEBHOOK_SECRET>
    if (req.query.me !== undefined) { // kiểm tra token: /api/zalo?me=<ZALO_WEBHOOK_SECRET>
      if (String(req.query.me).trim() !== (process.env.ZALO_WEBHOOK_SECRET || "").trim()) return res.status(200).send("SAI secret");
      const r = await fetch(`${BASE}/bot${(process.env.ZALO_BOT_TOKEN || "").trim()}/getMe`);
      return res.status(200).send("getMe (" + r.status + "): " + (await r.text()));
    }
    if (req.query.setup === undefined) return res.status(200).send("ok");
    const sec = (process.env.ZALO_WEBHOOK_SECRET || "").trim(), tok = (process.env.ZALO_BOT_TOKEN || "").trim();
    const miss = ["ZALO_BOT_TOKEN", "ZALO_WEBHOOK_SECRET", "SUPABASE_URL", "SUPABASE_SERVICE_KEY"].filter(k => !(process.env[k] || "").trim());
    if (miss.length) return res.status(200).send("THIẾU biến: " + miss.join(", ") + ". Kiểm tra tên biến, rồi Redeploy.");
    if (String(req.query.setup).trim() !== sec) return res.status(200).send(`SAI secret. Bạn nhập ${String(req.query.setup).length} ký tự, trên Vercel có ${sec.length} ký tự.`);
    const r = await fetch(`${BASE}/bot${tok}/setWebhook`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: `https://${req.headers.host}/api/zalo`, secret_token: sec }),
    });
    return res.status(200).send("Zalo trả về (" + r.status + "): " + (await r.text()));
  }
  if (req.headers["x-bot-api-secret-token"] !== (process.env.ZALO_WEBHOOK_SECRET || "").trim()) return res.status(403).json({ message: "Unauthorized" });
  let body = req.body;
  if (Buffer.isBuffer(body)) body = body.toString("utf8");
  if (typeof body === "string") { try { body = JSON.parse(body); } catch (e) { body = {}; } }
  body = body || {};
  console.log("BODY", JSON.stringify(body).slice(0, 600));
  let m = null;
  try {
    const r = body.result || body;
    m = r.message || (r.text ? r : null);
    if (m && m.text && !(m.from && m.from.is_bot) && m.chat && m.chat.id) {
      try { await sb.from("bot_chats").upsert({ chat_id: String(m.chat.id), chat_type: String(m.chat.chat_type || "PRIVATE").toUpperCase(), seen_at: new Date().toISOString() }); } catch (e) {}
      const out = await handle(m);
      if (out) await send(m.chat.id, out);
    }
  } catch (e) {
    console.error(e);
    try { if (m && m.chat) await send(m.chat.id, "⚠️ Lỗi: " + String((e && e.message) || e).slice(0, 150)); } catch (_) {}
  }
  res.status(200).json({ message: "Success" });
};
module.exports._t = { money, settle, handle };
