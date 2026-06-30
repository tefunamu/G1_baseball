// ⚾ G2 BASEBALL — game server (P0+P1)
// タイミング野球ゲーの"真ん中"。投球(/pitch)とスイング(/swing)を受け、判定し、
// Even G2 へ eventerm /api/push 経由でテキストフレームを表示する。依存ゼロ・bunで起動。
//   起動: bun run ~/g2-baseball/server.mjs   (port 3457)
//   テスト: ブラウザで http://127.0.0.1:3457/  → PITCH/SWING ボタン
//   合流点: POST /pitch (当日G1が叩く) / POST /swing (チームのスマホ検出が叩く)
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const PORT = 3457;
const EVENTERM = "http://127.0.0.1:3456";
let EVENTERM_TOKEN = "";
try { EVENTERM_TOKEN = readFileSync(`${homedir()}/even-g2/even-terminal-bridge/token.txt`, "utf8").trim(); }
catch { console.warn("[warn] eventerm token.txt 読めず＝G2表示はスキップ（ロジックは動く）"); }

// 球速→到達ms（山なりで遅め＝当てる楽しさ優先）
const FLIGHT = { slow: 2000, normal: 1600, fast: 1200 };
// 判定窓（到達時刻との差の絶対値ms）
const WIN = { perfect: 150, good: 350, foul: 600 };

const score = { pitches: 0, homeruns: 0, hits: 0, fouls: 0, misses: 0, strikes: 0 };
let pitch = null;       // {t0, arrival, flight, speed, swung, timers:[]}
let last = "まだプレイしてないよ";

// ---- G2へテキスト表示（eventerm /api/push） ----
async function pushG2(text) {
  if (!EVENTERM_TOKEN) return;
  try {
    await fetch(`${EVENTERM}/api/push`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${EVENTERM_TOKEN}` },
      body: JSON.stringify({ text }),
    });
  } catch (e) { console.warn("[push fail]", String(e)); }
}

function clearPitch() {
  if (pitch?.timers) pitch.timers.forEach(clearTimeout);
  pitch = null;
}

// ---- 投球開始 ----
function startPitch(speed = "normal") {
  if (pitch) return { ok: false, reason: "busy" };
  const flight = FLIGHT[speed] ?? FLIGHT.normal;
  const t0 = Date.now();
  pitch = { t0, arrival: t0 + flight, flight, speed, swung: false, timers: [] };
  score.pitches++;
  console.log(`[pitch] speed=${speed} flight=${flight}ms`);
  // フレーム時間割（低FPSのG2向けに離散フレーム）
  const F = (ms, txt) => pitch.timers.push(setTimeout(() => pushG2(txt), ms));
  pushG2("[投球] ボールが来た！");
  F(flight * 0.35, "      ( o )");
  F(flight * 0.70, "    (  O  )");
  F(flight * 0.90, "  ( O )   → 打て!!");
  // 窓を過ぎてもスイング無し＝見逃しストライク
  pitch.timers.push(setTimeout(() => {
    if (pitch && !pitch.swung) {
      score.strikes++;
      last = "見逃しストライク！";
      console.log("[result] 見逃しストライク");
      pushG2("見逃しストライク！  " + scoreLine());
      clearPitch();
    }
  }, flight + WIN.foul + 50));
  return { ok: true, arrival: pitch.arrival, flight };
}

// ---- スイング ----
function doSwing(tSwing = Date.now()) {
  if (!pitch) { last = "まだ投げてないよ"; return { ok: false, reason: "no_pitch" }; }
  if (pitch.swung) return { ok: false, reason: "already_swung" };
  pitch.swung = true;
  const diff = tSwing - pitch.arrival;      // -=早い +=遅い
  const ad = Math.abs(diff);
  let result, frame;
  if (ad <= WIN.perfect) { result = "homerun"; score.homeruns++; frame = "★ ホームラン!!!  >>>>>>>"; }
  else if (ad <= WIN.good) { result = "hit"; score.hits++; frame = "ヒット! >>>"; }
  else if (ad <= WIN.foul) { result = "foul"; score.fouls++; frame = "ファウル…  (" + (diff < 0 ? "早い" : "遅い") + ")"; }
  else { result = "swing_miss"; score.misses++; frame = "空振り…  (" + (diff < 0 ? "早すぎ" : "遅すぎ") + ")"; }
  last = `${result} (差${diff}ms)`;
  console.log(`[swing] diff=${diff}ms -> ${result}`);
  pushG2(frame + "   " + scoreLine());
  clearPitch();
  return { ok: true, result, diff };
}

const scoreLine = () =>
  `HR${score.homeruns} H${score.hits} F${score.fouls} 空${score.misses} K${score.strikes}`;

// ---- HTTP ----
function json(res, code, obj) {
  res.writeHead(code, { "Content-Type": "application/json", "Access-Control-Allow-Origin": "*" });
  res.end(JSON.stringify(obj));
}
async function readBody(req) {
  let b = ""; for await (const c of req) b += c;
  try { return b ? JSON.parse(b) : {}; } catch { return {}; }
}

const TEST_PAGE = `<!doctype html><meta charset=utf-8><title>G2 BASEBALL</title>
<style>body{font-family:sans-serif;background:#0f1117;color:#eee;text-align:center;padding:6vh}
button{font-size:5vw;margin:1vh;padding:3vh 5vw;border-radius:16px;border:0;cursor:pointer}
.p{background:#7aa2ff}.s{background:#5ad1c4;font-size:9vw;width:80vw}
#r{font-size:6vw;margin:3vh}#sc{color:#aab2c5}</style>
<h2>⚾ G2 BASEBALL テスト台</h2>
<div><button class=p onclick=pitch('slow')>遅球</button>
<button class=p onclick=pitch('normal')>普通</button>
<button class=p onclick=pitch('fast')>速球</button></div>
<div><button class=s onclick=swing()>🏏 SWING</button></div>
<div id=r>-</div><div id=sc></div>
<script>
async function pitch(s){await fetch('/pitch',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({speed:s})});}
async function swing(){const r=await(await fetch('/swing',{method:'POST'})).json();}
setInterval(async()=>{const s=await(await fetch('/state')).json();
document.getElementById('r').textContent=s.last;
document.getElementById('sc').textContent='HR'+s.score.homeruns+' ヒット'+s.score.hits+' ファウル'+s.score.fouls+' 空振り'+s.score.misses+' 見逃し'+s.score.strikes;},300);
</script>`;

createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (req.method === "GET" && u.pathname === "/") {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); return res.end(TEST_PAGE);
  }
  if (req.method === "GET" && u.pathname === "/health") return json(res, 200, { ok: true });
  if (req.method === "GET" && u.pathname === "/state")
    return json(res, 200, { active: !!pitch, last, score });
  if (req.method === "POST" && u.pathname === "/pitch") {
    const b = await readBody(req);
    return json(res, 200, startPitch(b.speed));
  }
  if (req.method === "POST" && u.pathname === "/swing") {
    const b = await readBody(req);
    return json(res, 200, doSwing(b.t ? Number(b.t) : Date.now()));
  }
  if (req.method === "POST" && u.pathname === "/reset") {
    clearPitch(); Object.keys(score).forEach(k => score[k] = 0); last = "リセット"; return json(res, 200, { ok: true });
  }
  json(res, 404, { error: "not found" });
}).listen(PORT, () => console.log(`⚾ G2 BASEBALL server on :${PORT}  (test: http://127.0.0.1:${PORT}/)`));
