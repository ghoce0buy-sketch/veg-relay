// fetch-veg.mjs — 抓農業部「農產品交易行情」蔬菜資料，整理成 veg.json（Node 20+，不需安裝套件）
// 輸出格式：{ date:'YYYY-MM-DD', list:[[品名, 加權平均價(元/公斤), 交易量(公斤)], ...前 10 名], source, fetched }
import fs from 'node:fs';

const OUT = process.env.OUT || 'veg.json';
const pad = n => String(n).padStart(2, '0');

// 以臺灣時間（UTC+8）計算「今天」，避免執行環境是 UTC 造成日期差一天
const twNow = Date.now() + 8 * 3600e3;
function dayAgo(i) { return new Date(twNow - i * 864e5); }
const iso = d => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
const roc = d => `${d.getUTCFullYear() - 1911}.${pad(d.getUTCMonth() + 1)}.${pad(d.getUTCDate())}`;

async function getJSON(url) {
  let err;
  for (let k = 0; k < 3; k++) {
    try {
      const r = await fetch(url, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(30000) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { err = e; await new Promise(r => setTimeout(r, 2000 * (k + 1))); }
  }
  throw err;
}

export function parse(j, d) {
  const a = Array.isArray(j) ? j : (j && (j.Data || j.data)) || [];
  const [wy, wm, wd] = roc(d).split('.').map(Number);
  const m = {};
  for (const x of a) {
    const tc = x.TcType || x['種類代碼'];
    if (tc && tc !== 'N04') continue;                       // N04 = 蔬菜
    const nm = String(x.CropName || x['作物名稱'] || '');
    const avg = parseFloat(x.Avg_Price ?? x['平均價']);
    const qt = parseFloat(x.Trans_Quantity ?? x['交易量']);
    const dt = String(x.TransDate || x.Trans_Date || x['交易日期'] || '').match(/(\d{2,3})\D*(\d{2})\D*(\d{2})$/);
    if (dt && (+dt[1] !== wy || +dt[2] !== wm || +dt[3] !== wd)) continue;
    const base = nm.split(/[-－(（]/)[0].trim();
    if (!base || /其他|其它|休市/.test(nm) || !isFinite(avg) || avg <= 0 || !(qt > 0)) continue;
    const o = m[base] || (m[base] = { s: 0, q: 0 });
    o.s += avg * qt; o.q += qt;
  }
  return Object.entries(m)
    .map(([k, v]) => [k, Math.round(v.s / v.q * 10) / 10, Math.round(v.q)])
    .sort((p, q) => q[2] - p[2])
    .slice(0, 10);
}

async function main() {
  // 從今天往前最多 8 天，找最近一個有交易資料的日子（週一休市、假日會自動退回）
  for (let i = 0; i < 8; i++) {
    const d = dayAgo(i), rs = roc(d);
    const urls = [
      `https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time=${rs}&End_time=${rs}&TcType=N04`,
      `https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx?TcType=N04&StartDate=${rs}&EndDate=${rs}&$top=5000`,
    ];
    for (const u of urls) {
      try {
        const j = await getJSON(u);
        const list = parse(j, d);
        console.log(`${iso(d)} ${u.split('?')[0].split('/').pop()}：${list.length} 項`);
        if (list.length) {
          const out = { date: iso(d), list, source: 'data.moa.gov.tw', fetched: new Date().toISOString() };
          let old = null;
          try { old = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch {}
          // 內容沒變就不改檔，避免每次排程都產生一筆沒意義的提交
          if (old && old.date === out.date && JSON.stringify(old.list) === JSON.stringify(out.list)) {
            console.log('內容與上次相同，不更新檔案');
          } else {
            fs.writeFileSync(OUT, JSON.stringify(out, null, 1) + '\n');
            console.log('已寫入', OUT, out.date);
          }
          return;
        }
      } catch (e) { console.log(`${iso(d)} 失敗：${e.message}（${u.split('?')[0]}）`); }
    }
  }
  console.error('8 天內都沒有取得資料');
  process.exit(1);   // 讓 Actions 顯示失敗；不會覆蓋舊的 veg.json
}

if (process.argv[1] && process.argv[1].endsWith('fetch-veg.mjs')) main();
