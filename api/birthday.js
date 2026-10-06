// Bot tự chúc mừng sinh nhật mỗi sáng (Vercel Cron gọi /api/birthday)
const { createClient } = require("@supabase/supabase-js");
const BASE = "https://bot-api.zaloplatforms.com";
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
const one = async q => { const { data, error } = await q; if (error) throw error; return data; };

async function send(chatId, text) {
  const r = await fetch(`${BASE}/bot${(process.env.ZALO_BOT_TOKEN || "").trim()}/sendMessage`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text }),
  });
  const t = await r.text();
  const ok = r.ok && !/"ok"\s*:\s*false/.test(t);
  if (!ok) console.error("BDAY SEND FAIL", chatId, r.status, t.slice(0, 200));
  return ok;
}

module.exports = async (req, res) => {
  const sec = (process.env.ZALO_WEBHOOK_SECRET || "").trim(), cs = process.env.CRON_SECRET;
  const byKey = req.query.key && String(req.query.key).trim() === sec;
  const byCron = cs ? req.headers.authorization === `Bearer ${cs}` : String(req.headers["user-agent"] || "").startsWith("vercel-cron");
  if (!byKey && !byCron) return res.status(401).send("Không có quyền");
  const dry = req.query.dry !== undefined;

  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Ho_Chi_Minh", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(new Date());
  const g = t => p.find(x => x.type === t).value;
  const ymd = `${g("year")}-${g("month")}-${g("day")}`, md = `${g("month")}-${g("day")}`;

  try {
    if (!dry && !(req.query.force !== undefined && byKey)) {
      const st = await one(sb.from("bot_state").select("value").eq("key", "birthday_sent").maybeSingle());
      if (st && st.value === ymd) return res.status(200).send("Hôm nay đã chúc rồi (" + ymd + ")");
    }
    const profs = await one(sb.from("profiles").select("id,name,bday,hide_year"));
    const list = profs.filter(x => x.bday && x.bday.slice(5) === md);
    if (!list.length) { if (!dry) await one(sb.from("bot_state").upsert({ key: "birthday_sent", value: ymd })); return res.status(200).send("Hôm nay không có ai sinh nhật (" + ymd + ")"); }

    const names = list.map(x => { const age = !x.hide_year ? +ymd.slice(0, 4) - +x.bday.slice(0, 4) : null; return age ? `${x.name} (tròn ${age} tuổi)` : x.name; });
    const groupText = `🎂🎉 Hôm nay là sinh nhật của ${names.join(", ")}! Cả nhóm cùng chúc mừng nhé, chúc ${list.length > 1 ? "các bạn" : "bạn"} thật nhiều sức khỏe, niềm vui và may mắn! 🥳`;

    const chats = await one(sb.from("bot_chats").select("chat_id,chat_type"));
    const links = await one(sb.from("zalo_links").select("user_id,zalo_id"));
    const bdayZalo = new Set(list.map(x => (links.find(l => l.user_id === x.id) || {}).zalo_id).filter(Boolean));
    const groups = chats.filter(c => c.chat_type === "GROUP").map(c => c.chat_id);
    const privates = chats.filter(c => c.chat_type !== "GROUP").map(c => c.chat_id);
    const targets = [];
    if (groups.length) groups.forEach(id => targets.push([id, groupText]));
    else privates.filter(id => !bdayZalo.has(id)).forEach(id => targets.push([id, groupText]));
    list.forEach(x => {
      const z = (links.find(l => l.user_id === x.id) || {}).zalo_id;
      if (z && privates.includes(z)) targets.push([z, `🎂 Chúc mừng sinh nhật ${x.name}! Cả nhóm Pink Pumper gửi lời chúc tốt đẹp nhất tới bạn 🥳`]);
    });

    let sent = 0;
    if (!dry) for (const [id, t] of targets) { try { if (await send(id, t)) sent++; } catch (e) { console.error(e); } }
    if (!dry) await one(sb.from("bot_state").upsert({ key: "birthday_sent", value: ymd }));
    return res.status(200).send(`${dry ? "[THỬ] " : ""}Sinh nhật: ${list.map(x => x.name).join(", ")}. Nhóm đã biết: ${groups.length}, chat riêng: ${privates.length}. ${dry ? "Sẽ gửi" : "Đã gửi"}: ${dry ? targets.length : sent}/${targets.length} tin.`);
  } catch (e) { console.error(e); return res.status(500).send("Lỗi: " + String((e && e.message) || e).slice(0, 200)); }
};
