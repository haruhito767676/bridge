#!/usr/bin/env python3
"""film8.html → film_s.html (約 15.7 秒の短縮版)
 - 導入: 4 枚のカードを約 2.5 倍速で連続表示 → 「それ、全部いらなくなります。」→ 青へ
 - 3 台: 0.65 倍の長さ (Windows / iMac の貼り付けは省く)
 - パネル → 南京錠 (0.55 倍の長さ) → 橋 (前半を圧縮)
"""
src = open('film8.html', encoding='utf8').read()

def rep(old, new, n=1):
    global src
    c = src.count(old)
    assert c == n, f'{c} != {n}: {old[:80]!r}'
    src = src.replace(old, new)

# ---- タイムライン
rep('<title>Bridge Multi-Device Film v8</title>', '<title>Bridge Multi-Device Short</title>')
rep('max="45.6"', 'max="15.75"')
rep('DUR = 45.6;', 'DUR = 15.75;')
rep('const K = 1.25; ', 'const K = .65; ')
rep('const FL0 = 12.3; ', 'const FL0 = 4.6; ')
rep('const TP0 = TA0 + 6.28 * K; ', 'const TP0 = TA0 + 4.3 * K; ')
rep('const TH0 = TP0 + 8.35;  ', 'const TH0 = TP0 + .7;  ')
rep('const LK0 = TH0 + 4.3;  ', 'const LK0 = TH0 + .5;  ')
rep('const COL = LK0 + 5.25; ', 'const COL = LK0 + 2.9; ')
rep('const F2 = COL - 10.05; ',
    'const LKS = .55, COLL = LK0 + 5.25;      // 南京錠の場面を LKS 倍に縮める (場面の内部時間は COLL 基準)\n'
    'const bt = u => u <= 1.2 ? 10.05 + 1.875 * u : 12.3 + 1.4 * (u - 1.2);   // COL からの経過 → 橋 (film4) の時間\n'
    'const F2 = COL - 10.05; ')

# ---- 導入 (速く・連続)
rep('const OPEN_T0 = [1.7, 3.5, 5.0, 6.75];', 'const OPEN_T0 = [.55, 1.05, 1.5, 1.9];\nconst SPD = [2.6, 2.6, 2.4, 3.0];               // 各カードの進行速度')
rep('const SWAP = 9.65, SK0 = 11.4;', 'const SWAP = 2.85, SK0 = 3.85;')
rep('cardUpd(i, u);', 'cardUpd(i, u * SPD[i]);')
rep('const a1 = E.out(P(T, .6, 1.4));', 'const a1 = E.out(P(T, .3, .9));')

# ---- 3 台: 貼り付けは省き、引きのまま次へ
rep('    return camAt(VIEW.v2, VIEW.v3, E.soft(P(t, 6.95, 7.85)));', '    return VIEW.v2;')
rep('  if (T < TP0) {\n    if (t < 4.5) return VIEW.v1;', '  if (T < TP0 + 99) {\n    if (t < 4.5) return VIEW.v1;')
rep("  show($('devMac'), T < TP0 + 1.25);", "  show($('devMac'), true);")
rep("  show($('devImac'), (t > 4.7 && t < 7.2) || (T > TP0 - .45 && camOn));", "  show($('devImac'), t > 4.7);")
rep("  show($('devWin'), t > 4.7 && T < TP0 + 1.55);", "  show($('devWin'), t > 4.7);")
rep("const cur = $('cursorW'); show(cur, t > 7.75 && t < 9.4);", "const cur = $('cursorW'); show(cur, false);")
rep("sel: E.out(P(t, 8.28, 8.34)), cop: E.out(P(t, 8.42, 8.5))", "sel: 0, cop: 0")
rep("translate3d(${(340 * E.in(P(T, TP0 + .25, TP0 + .7))).toFixed(1)}px,0,0)", "translate3d(0px,0,0)")

# ---- パネル: 見出し・絞り込み・同期は省き、すぐ南京錠へ
rep("const h = $('hero'), t = tH(T);", "const h = $('hero'), t = tH(T), TT = T < LK0 ? T : LK0 + (T - LK0) / LKS;")
rep("if (!show(h, T > TH0 - .1 && T < LK0 + .7)) return;", "if (!show(h, T > TH0 - .1 && TT < LK0 + .7)) return;")
rep("const m = E.in(P(T, LK0, LK0 + .55))", "const m = E.in(P(TT, LK0, LK0 + .55))")
rep("(1 - E.in(P(T, LK0 + .2, LK0 + .6)))", "(1 - E.in(P(TT, LK0 + .2, LK0 + .6)))")
rep("show(a, t < 11.7); show(c2, t > 11.7);", "show(a, false); show(c2, false);")
rep("const cur = $('cursorH'); show(cur, t > 10.0 && t < 11.05);", "const cur = $('cursorH'); show(cur, false);")

# ---- 南京錠 (内部時間を 1/LKS 倍速に)
rep("function lockScene(T) {\n  const el = $('lockScene');", "function lockScene(T0) {\n  const T = T0 < LK0 ? T0 : LK0 + (T0 - LK0) / LKS;\n  const el = $('lockScene');")
rep("if (!show(el, T > LK0 - .1 && T < COL - .05)) return;", "if (!show(el, T > LK0 - .1 && T < COLL - .05)) return;")
rep("const out = E.in(P(T, COL - .6, COL - .25));", "const out = E.in(P(T, COLL - .6, COLL - .25));")
rep("{ t0: LK0 + 1.75, R: 560,", "{ t0: LK0 + 1.75 * LKS, R: 560,")
rep("{ t0: LK0 + 3.2, R: 300,", "{ t0: LK0 + 3.2 * LKS, R: 300,")
rep("{ t0: 12.3 + F2, R: 1300,", "{ t0: COL + 1.2, R: 1300,")
rep("const SHAKES = [[FL0, 1], [TL(4.06), .3], [LK0 + 1.75, .8], [LK0 + 3.2, .35], [12.3 + F2, 1.1]];",
    "const SHAKES = [[FL0, 1], [TL(4.06), .3], [LK0 + 1.75 * LKS, .8], [LK0 + 3.2 * LKS, .35], [COL + 1.2, 1.1]];")

# ---- 橋
rep("s4(T - F2);", "s4(bt(Math.max(0, T - COL)));")

open('film_s.html', 'w', encoding='utf8').write(src)
print('film_s.html written', len(src))
