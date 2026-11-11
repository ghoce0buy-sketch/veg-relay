#!/usr/bin/env python3
"""抓農業部農產品交易行情（蔬菜 N04），輸出 public/veg.json，格式對應 index.html 的 vegRelay()。
邏輯移植自 index.html 的 parseVeg()：從今天（臺灣時間）往前找最多 7 天，
取最近一個有交易資料的日子；依交易量取前 10 名，價格為交易量加權平均。"""
import json, re, sys, time, urllib.request
from datetime import datetime, timedelta, timezone

TW = timezone(timedelta(hours=8))
OUT = "public/veg.json"
URLS = [
    "https://data.moa.gov.tw/api/v1/AgriProductsTransType/?Start_time={r}&End_time={r}&TcType=N04",
    "https://data.moa.gov.tw/Service/OpenData/FromM/FarmTransData.aspx?TcType=N04&StartDate={r}&EndDate={r}&$top=5000",
]

def roc(d):
    return f"{d.year - 1911}.{d.month:02d}.{d.day:02d}"

def get_json(url, tries=3):
    last = None
    for i in range(tries):
        try:
            req = urllib.request.Request(url, headers={"User-Agent": "Mozilla/5.0 (veg-relay)"})
            with urllib.request.urlopen(req, timeout=40) as r:
                return json.loads(r.read().decode("utf-8", "replace"))
        except Exception as e:
            last = e
            time.sleep(3 * (i + 1))
    raise last

def num(v):
    try:
        return float(v)
    except (TypeError, ValueError):
        return float("nan")

def parse(j, d):
    a = j if isinstance(j, list) else (j.get("Data") or j.get("data") or []) if isinstance(j, dict) else []
    if not isinstance(a, list):
        a = []
    want = (d.year - 1911, d.month, d.day)
    m = {}
    for x in a:
        if not isinstance(x, dict):
            continue
        tc = x.get("TcType") or x.get("種類代碼")
        if tc and tc != "N04":
            continue
        nm = str(x.get("CropName") or x.get("作物名稱") or "")
        avg = num(x.get("Avg_Price", x.get("平均價")))
        qt = num(x.get("Trans_Quantity", x.get("交易量")))
        ds = str(x.get("TransDate") or x.get("Trans_Date") or x.get("交易日期") or "")
        dt = re.search(r"(\d{2,3})\D*(\d{2})\D*(\d{2})$", ds)
        if dt and tuple(int(g) for g in dt.groups()) != want:
            continue
        b = re.split(r"[-－(（]", nm)[0].strip()
        if not b or re.search(r"其他|其它|休市", nm) or not (avg > 0) or not (qt > 0):
            continue
        o = m.setdefault(b, [0.0, 0.0])
        o[0] += avg * qt
        o[1] += qt
    rows = [[k, v[0] / v[1], v[1]] for k, v in m.items()]
    rows.sort(key=lambda r: r[2], reverse=True)
    rows = rows[:10]
    if not rows:
        raise ValueError("no veg")
    return [[n, round(p, 1), round(q)] for n, p, q in rows]

def main():
    today = datetime.now(TW).replace(hour=12, minute=0, second=0, microsecond=0)
    for i in range(7):
        d = today - timedelta(days=i)
        for u in URLS:
            try:
                lst = parse(get_json(u.format(r=roc(d))), d)
            except Exception as e:
                print(f"[{d:%Y-%m-%d}] {u.split('?')[0].split('/')[-2] or u[:40]} 失敗：{e}", file=sys.stderr)
                continue
            out = {"date": f"{d:%Y-%m-%d}", "list": lst}
            with open(OUT, "w", encoding="utf-8") as f:
                json.dump(out, f, ensure_ascii=False, separators=(",", ":"))
            print(f"OK {out['date']}：{len(lst)} 項，第一名 {lst[0]}")
            return 0
    print("7 天內都沒有取得資料，保留舊的 veg.json", file=sys.stderr)
    return 1

if __name__ == "__main__":
    sys.exit(main())
