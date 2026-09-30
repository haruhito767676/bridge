#!/usr/bin/env python3
"""film7.html → film8.html
 - Slack「自分だけ」: 3 件とも同じアイコン
 - 往復カード: ブラウザ (信号機・アドレスバー) とドキュメント (青いタイトルバー) に見えるデザイン
 - 議事録の文言 / 曜日
 - iMac: 2 回目 (ポップアップで検索 → 貼り付け → 送信) を追加。Slack はスクロールして 2 件目が入る
 - 南京錠: 軌跡が尾を引いて消える + 「あなただけに、届く。」
 - エンディング: 「macOS / Windows · 無料」 + GitHub の URL、最後の絵を長く止める
 - 導入のクラウドを速く
"""
import re, sys
src = open('film7.html', encoding='utf8').read()

def rep(old, new, n=1):
    global src
    c = src.count(old)
    assert c == n, f'{c} != {n}: {old[:70]!r}'
    src = src.replace(old, new)

# ---------------------------------------------------------------- タイムライン
rep('<title>Bridge Multi-Device Film v7</title>', '<title>Bridge Multi-Device Film v8</title>')
rep('max="42.3"', 'max="45.6"')
rep('const W = 1920, H = 1080, DUR = 42.3;', 'const W = 1920, H = 1080, DUR = 45.6;')
rep('const FL0 = 12.9; ', 'const FL0 = 12.3; ')
rep('const TH0 = TP0 + 5.45;  ', 'const TH0 = TP0 + 8.35;  ')
rep('const OPEN_T0 = [1.7, 3.5, 5.0, 7.35];', 'const OPEN_T0 = [1.7, 3.5, 5.0, 6.75];')
rep('const SWAP = 10.25, SK0 = 12.0;', 'const SWAP = 9.65, SK0 = 11.4;')
# クラウドを 1.35 倍速に
rep("    const tok = e.q('.ftok'), ring = e.q('.cring'), fill = e.q('.dfill');\n",
    "    c *= 1.35;\n    const tok = e.q('.ftok'), ring = e.q('.cring'), fill = e.q('.dfill');\n")

# ---------------------------------------------------------------- Slack「自分だけ」
rep('<span># 自分だけ</span>${LOCKS}</div>\n   <div class="smsg" style="top:70px"><i class="av" style="background:#5b8cff;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:80px"></span>',
    '<span># 自分だけ</span>${LOCKS}</div>\n   <div class="smsg" style="top:70px"><i class="av" style="background:#5b8cff;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:80px"></span>')
rep('<i class="av" style="background:#ff8a4c;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:100px"></span>',
    '<i class="av" style="background:#5b8cff;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:80px"></span>')
rep('<i class="av" style="background:#34c759;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:70px"></span><span class="urlt">',
    '<i class="av" style="background:#5b8cff;width:40px;height:40px;border-radius:8px"></i><div><span class="pln" style="width:80px"></span><span class="urlt">')

# ---------------------------------------------------------------- 往復カード
rep('/* ---------- S2 : multi-device ---------- */', '''.pw .t b{display:block;width:10px;height:10px;border-radius:5px;background:#ff5f57;flex:none}
.pw .t b.y{background:#febc2e}.pw .t b.g{background:#28c840}
.pw .t i.tab{width:112px;height:24px;margin-left:8px;border-radius:8px 8px 0 0;background:rgba(255,255,255,.16);align-self:flex-end}
.pw .addr{position:absolute;left:0;right:0;top:34px;height:36px;padding:0 12px;display:flex;align-items:center;background:rgba(255,255,255,.08)}
.pw .addr .u{flex:1;height:22px;border-radius:11px;background:rgba(255,255,255,.1);display:flex;align-items:center;gap:8px;padding:0 10px}
.pw .addr .u em{display:block;height:8px;width:96px;border-radius:4px;background:rgba(255,255,255,.3)}
.pw .img{position:absolute;left:24px;top:88px;width:282px;height:84px;border-radius:8px;background:linear-gradient(135deg,rgba(10,132,255,.55),rgba(191,90,242,.5))}
.pw .rg{position:absolute;left:0;top:0;right:0;bottom:0;border-radius:14px;box-shadow:inset 0 0 0 2.5px rgba(10,132,255,.95);opacity:0;pointer-events:none;z-index:3}
.pw.dc{background:#2a2c33}
.pw.dc .tb{height:34px;background:#2b579a;display:flex;align-items:center;gap:10px;padding:0 12px}
.pw.dc .tb .ic{width:16px;height:16px;border-radius:3px;background:#fff;opacity:.92}
.pw.dc .tb .tt{width:96px;height:8px;border-radius:4px;background:rgba(255,255,255,.55)}
.pw.dc .rb{position:absolute;left:0;right:0;top:34px;height:30px;background:#f0f1f5;display:flex;align-items:center;gap:14px;padding:0 14px}
.pw.dc .rb b{display:block;height:9px;width:44px;border-radius:5px;background:#c3c8d6}
.pw.dc .pgw{position:absolute;left:58px;top:80px;width:214px;height:240px;background:#fff;border-radius:2px;box-shadow:0 8px 24px rgba(0,0,0,.35);padding:24px 22px}
.pw.dc .pgw .h{height:12px;width:120px;border-radius:6px;background:#1b1b1f;margin-bottom:18px}
.pw.dc .pgw .l2{height:8px;border-radius:4px;background:#d9dce4;margin-bottom:12px}

/* ---------- S2 : multi-device ---------- */''')

old_c4 = src[src.index('  // 4 : ブラウザとドキュメントを往復'):src.index('const OPEN_T0')]
new_c4 = '''  // 4 : ブラウザとドキュメントを往復
  `<div class="pw wl" style="left:36px;top:54px;width:330px;height:300px"><div class="t"><b></b><b class="y"></b><b class="g"></b><i class="tab"></i></div>
     <div class="addr"><div class="u">${LOCKS}<em></em></div></div><div class="img"></div>
     <span class="ln" style="top:194px;width:230px"></span><span class="ln" style="top:220px;width:190px"></span><span class="ln" style="top:246px;width:250px"></span><span class="ln" style="top:272px;width:150px"></span><i class="rg"></i></div>
   <div class="pw wr dc" style="left:394px;top:54px;width:330px;height:300px"><div class="tb"><span class="ic"></span><span class="tt"></span></div>
     <div class="rb"><b></b><b style="width:30px"></b><b style="width:60px"></b><b></b><b style="width:36px"></b></div>
     <div class="pgw"><div class="h"></div><div class="l2" style="width:100%"></div><div class="l2" style="width:86%"></div><div class="l2" style="width:94%"></div><div class="l2" style="width:60%"></div></div><i class="rg"></i></div>
   <div class="snip"><span class="pln" style="width:86px;background:rgba(255,255,255,.75)"></span></div>`,
];
'''
src = src.replace(old_c4, new_c4)
rep("    wl.style.boxShadow = side === 0 ? 'inset 0 0 0 2px rgba(10,132,255,.9)' : 'inset 0 0 0 1.5px rgba(255,255,255,.14)';\n    wr.style.boxShadow = side === 1 ? 'inset 0 0 0 2px rgba(10,132,255,.9)' : 'inset 0 0 0 1.5px rgba(255,255,255,.14)';\n",
    "    wl.querySelector('.rg').style.opacity = side === 0 ? 1 : 0; wr.querySelector('.rg').style.opacity = side === 1 ? 1 : 0;\n")

# ---------------------------------------------------------------- 議事録の文言
rep('<span style="margin-left:14px">キックオフ議事録</span></div>\n            <h1>キックオフ議事録</h1>',
    '<span style="margin-left:14px">定例会議メモ</span></div>\n            <h1>定例会議メモ</h1>')
rep('<span>明日14時、会議室Bでキックオフ</span>', '<span>次回定例は10/15(木) 14:00</span>')
rep("const words = pasted ? '明日14時、会議室Bでキックオフ' : '';", "const words = pasted ? '次回定例は10/15(木) 14:00' : '';")

# ---------------------------------------------------------------- iMac Slack (スクロールする会話)
rep('.slack .msg{display:flex;gap:16px;margin:22px 30px}',
    '.slack .msg{display:flex;gap:16px;margin:22px 30px}\n#slkWrap{position:absolute;left:0;right:0;top:44px;height:376px;overflow:hidden;-webkit-mask-image:linear-gradient(to bottom,transparent 0,#000 34px)}\n#slkScroll{display:flow-root}')
rep('<div class="msg"><div class="av"></div><div style="flex:1"><div class="b1"></div>',
    '<div id="slkWrap"><div id="slkScroll"><div class="msg"><div class="av"></div><div style="flex:1"><div class="b1"></div>')
old_sent = src[src.index('            <div id="slkSent" style="position:absolute'):src.index('            <div class="inp">')]
new_sent = '''            <div id="slkSent" class="msg" style="opacity:0"><div class="av" style="background:#0a84ff"></div><div><div class="b1" style="width:70px"></div><div style="font:600 21px var(--mono);color:#7fb5ff;white-space:nowrap;margin-top:2px">https://github.com/example-team/ec-renewal/pull/42</div></div></div>
            <div id="slkSent2" class="msg" style="opacity:0"><div class="av" style="background:#0a84ff"></div><div><div class="b1" style="width:70px"></div><div class="stxt">レビュー観点：決済まわりの分岐だけ見てください</div></div></div></div></div>
'''
src = src.replace(old_sent, new_sent)
rep('<img id="pop1" src="ui/plates/popup/sel1.png" style="opacity:0"></div>',
    '<img id="pop1" src="ui/plates/popup/sel1.png" style="opacity:0">' + ''.join(f'<img id="popq{i}" src="ui/plates/popup/q{i}.png" style="opacity:0">' for i in range(1, 5)) + '</div>')

old_imac = src[src.index("    // ---- 自宅iMac: その場でペースト → Enter で送信 ----"):src.index("    $('s2gA').style.transform")]
new_imac = '''    // ---- 自宅iMac: ① その場でペースト → Enter で送信 ② 検索して貼る → 送信 ----
    const S2 = TP0 + 4.55, r2 = T >= S2 - .1;
    const pop = $('popIm'), tOpen = r2 ? S2 : TP0 + 1.5, tClose = r2 ? S2 + 1.75 : TP0 + 2.97;
    const pIn = spring(T - tOpen, 150, 16), pOut = E.in(P(T, tClose, tClose + .22));
    const popO = P(T, tOpen, tOpen + .15) * (1 - pOut);
    show(pop, T > tOpen - .05 && T < tClose + .28);
    if (pop.style.display !== 'none') {
      pop.style.opacity = popO.toFixed(3);
      pop.style.transform = `translate3d(0,${(24 * (1 - pIn) - 10 * pOut).toFixed(1)}px,0) scale(${((.92 + .08 * pIn) * (1 - .04 * pOut)).toFixed(4)})`;
      const sw = r2 ? 0 : E.out(P(T, TP0 + 2.3, TP0 + 2.42));
      const nq = r2 ? QT.filter(x => T >= S2 + x).length : 0;
      $('pop0').style.opacity = (r2 ? (nq === 0 ? 1 : 0) : 1 - sw).toFixed(3); $('pop1').style.opacity = sw.toFixed(3);
      for (let i = 1; i <= 4; i++) $('popq' + i).style.opacity = nq === i ? 1 : 0;
    }
    const ip = T > TP0 + 3.07 && T < TP0 + 3.7, ip2 = T > S2 + 1.85 && T < S2 + 2.45, iw = ip ? URL_PASTE : ip2 ? RV_TEXT : '';
    if ($('slkWords')._v !== iw) { $('slkWords').textContent = iw; $('slkWords')._v = iw; }
    $('slkHl').style.opacity = ip ? (.9 * (1 - P(T, TP0 + 3.15, TP0 + 3.7))).toFixed(3) : ip2 ? (.9 * (1 - P(T, S2 + 1.93, S2 + 2.45))).toFixed(3) : 0;
    $('slkCaret').style.opacity = (ip || ip2 || Math.floor(T * 2.4) % 2 === 0) ? 1 : 0;
    const sent = E.out(P(T, TP0 + 3.7, TP0 + 4.05)), sn = $('slkSent');
    sn.style.opacity = P(T, TP0 + 3.7, TP0 + 3.85).toFixed(3); sn.style.transform = `translate3d(0,${((1 - sent) * 70).toFixed(1)}px,0)`;
    const sent2 = E.out(P(T, S2 + 2.45, S2 + 2.8)), sn2 = $('slkSent2');
    sn2.style.opacity = P(T, S2 + 2.45, S2 + 2.6).toFixed(3); sn2.style.transform = `translate3d(0,${((1 - sent2) * 70).toFixed(1)}px,0)`;
    $('slkScroll').style.transform = `translate3d(0,${(-78 * E.out(P(T, S2 + 2.45, S2 + 2.85))).toFixed(1)}px,0)`;
'''
src = src.replace(old_imac, new_imac)
rep("const URL_PASTE = 'https://github.com/example-team/ec-renewal/pull/42';",
    "const URL_PASTE = 'https://github.com/example-team/ec-renewal/pull/42';\nconst RV_TEXT = 'レビュー観点：決済まわりの分岐だけ見てください';\nconst QT = [.5, .68, .86, 1.04];   // 「レ」「ビ」「ュ」「ー」を打つ時刻 (2 回目の開始から)")

# ---------------------------------------------------------------- 南京錠: 尾を引く軌跡 + 文字
old_trail_svg = src[src.index('      <path id="trailG"'):src.index('    </svg>\n    <div id="rcv"')]
src = src.replace(old_trail_svg, '      <g id="trailGg" filter="url(#trb)"></g><g id="trailPg"></g>\n')
rep("{ const d = `M${LK_S[0]} ${LK_S[1]} C${lkC1[0]} ${lkC1[1]} ${lkC2[0]} ${lkC2[1]} ${LK_A[0]} ${LK_A[1]}`; $('trailG').setAttribute('d', d); $('trailP').setAttribute('d', d); }",
    """const TRN = 28, TAIL = .55, trG = [], trP = [];
for (let j = 0; j < TRN; j++) for (const [arr, host] of [[trG, 'trailGg'], [trP, 'trailPg']]) {
  const p = document.createElementNS(NS, 'path'); p.setAttribute('fill', 'none'); p.setAttribute('stroke', '#fff'); p.setAttribute('stroke-linecap', 'round'); p.style.display = 'none'; $(host).appendChild(p); arr.push(p);
}
function trail(h, tail, alpha) {
  for (let j = 0; j < TRN; j++) {
    const u0 = clamp(h - tail * (1 - j / TRN)), u1 = clamp(h - tail * (1 - (j + 1) / TRN)), k = (j + 1) / TRN;
    const on = alpha > .01 && u1 - u0 > 1e-4 && u1 > 0;
    trG[j].style.display = trP[j].style.display = on ? '' : 'none';
    if (!on) continue;
    const a = CURVE_PT(LK_S, lkC1, lkC2, LK_A, u0), b = CURVE_PT(LK_S, lkC1, lkC2, LK_A, u1), d = `M${a[0].toFixed(1)} ${a[1].toFixed(1)} L${b[0].toFixed(1)} ${b[1].toFixed(1)}`;
    trG[j].setAttribute('d', d); trP[j].setAttribute('d', d);
    trG[j].setAttribute('stroke-width', (8 + 30 * k).toFixed(1)); trP[j].setAttribute('stroke-width', (2 + 7 * k).toFixed(1));
    trG[j].setAttribute('stroke-opacity', (.62 * alpha * Math.pow(k, 1.4)).toFixed(3)); trP[j].setAttribute('stroke-opacity', (.95 * alpha * Math.pow(k, 1.25)).toFixed(3));
  }
}""")
old_tr = src[src.index("  // 軌跡\n"):src.index("  $('gLock').style.opacity")]
new_tr = """  // 軌跡: 錠のすぐ後ろが濃く、後ろへ行くほど消える (着いたら尾が錠に吸い込まれて消える)
  trail(T >= tTr0 ? pr : 0, TAIL * (1 - E.in(P(T, tArr, tArr + .55))), T >= tTr0 ? 1 : 0);
  // 文字: 施錠と同時に「あなただけに、」 → 相手の画面で開く瞬間に「届く。」
  HLD.c.forEach((ch, i) => { const t0 = i < 7 ? tClick + .12 + i * .04 : tArr + .02 + (i - 7) * .06, e = spring(T - t0, 130, 19); ch.style.transform = `translate3d(0,${(115 * (1 - e)).toFixed(2)}%,0)`; ch.style.opacity = P(T, t0, t0 + .07); });
"""
src = src.replace(old_tr, new_tr)
rep('    <div id="rcv" style="position:absolute', '    <div id="hlD" class="hl2" style="left:150px;top:852px;font-size:84px"></div>\n    <div id="rcv" style="position:absolute')
rep("const BR = chars($('brand'), 'Bridge');", "const HLD = chars($('hlD'), 'あなただけに、届く。');\nconst BR = chars($('brand'), 'Bridge');")

# ---------------------------------------------------------------- エンディング
rep("const TG = chars($('tag'), 'macOS / Windows  ·  無料ダウンロード');",
    "const TG = chars($('tag'), 'macOS / Windows  ·  無料');\nconst UR = chars($('url'), 'github.com/haruhito767676/bridge');")
rep('    <div id="tag"></div>', '    <div id="tag"></div>\n    <div id="url"></div>')
rep('#flash{background', '#url{position:absolute;left:960px;top:832px;font:500 34px/1 var(--display);letter-spacing:.03em;color:rgba(235,235,245,.5);white-space:nowrap;transform:translate(-50%,-50%)}\n#flash{background')
rep("  TG.c.forEach((ch, i) => {", "  UR.c.forEach((ch, i) => { const e = E.out(P(t, 14.1 + i * .012, 14.6 + i * .012)); ch.style.transform = `translate3d(0,${(30 * (1 - e)).toFixed(2)}px,0)`; ch.style.opacity = e; ch.style.filter = e < .98 ? `blur(${(6 * (1 - e)).toFixed(1)}px)` : ''; });\n  TG.c.forEach((ch, i) => {")


# ---------------------------------------------------------------- 細部: Dock (Finder・区切り・ゴミ箱・起動中の点) / タスクバーの起動中の線 / Windows のウィンドウボタン
rep('/* ---------- S2 : multi-device ---------- */', """.dock .di{position:relative;width:64px;height:64px;flex:none}
.dock .di img{width:64px;height:64px}
.dock .di.run::after{content:"";position:absolute;left:50%;bottom:-8px;width:5px;height:5px;margin-left:-2.5px;border-radius:3px;background:rgba(255,255,255,.88)}
.dock .sep{width:1.5px;height:56px;border-radius:1px;background:rgba(255,255,255,.3);flex:none;margin:0 2px}
.taskbar .ti{position:relative;width:34px;height:34px;flex:none}
.taskbar .ti img{width:34px;height:34px}
.taskbar .ti.run::after{content:"";position:absolute;left:50%;bottom:-8px;width:8px;height:3px;margin-left:-4px;border-radius:2px;background:rgba(255,255,255,.55)}
.taskbar .ti.act::after{content:"";position:absolute;left:50%;bottom:-8px;width:16px;height:3px;margin-left:-8px;border-radius:2px;background:#4cc2ff}
.caps{margin-left:auto;display:flex;align-self:stretch}
.caps i{width:46px;display:flex;align-items:center;justify-content:center}
.caps svg{width:11px;height:11px;stroke:#fff;fill:none;stroke-width:1.1}
/* ---------- S2 : multi-device ---------- */""")

def trash(n):
    return ('<span class="di"><svg width="64" height="64" viewBox="0 0 64 64"><defs><linearGradient id="tg%s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#eef0f5"/><stop offset="1" stop-color="#9aa0ad"/></linearGradient></defs>'
            '<path d="M18 20h28l-2.5 34a4 4 0 0 1-4 3.6H24.5a4 4 0 0 1-4-3.6z" fill="rgba(255,255,255,.28)" stroke="url(#tg%s)" stroke-width="2.5"/>'
            '<rect x="14" y="14" width="36" height="6" rx="3" fill="url(#tg%s)"/><rect x="26" y="9" width="12" height="6" rx="2.5" fill="url(#tg%s)"/>'
            '<path d="M26 26v24M32 26v24M38 26v24" stroke="rgba(255,255,255,.55)" stroke-width="2" stroke-linecap="round"/></svg></span>') % (n, n, n, n)
def dock(run, n):
    apps = ['Finder', 'Chrome', 'Slack', 'Notion', 'Figma', 'Word', 'Excel']
    ic = ''.join('<span class="di%s"><img src="ui/appicons/%s.png"></span>' % (' run' if a in run else '', a) for a in apps)
    return '<div class="dock">' + ic + '<i class="sep"></i>' + trash(n) + '</div>'
OLD_DOCK = '<div class="dock"><img src="ui/appicons/Chrome.png"><img src="ui/appicons/Slack.png"><img src="ui/appicons/Notion.png"><img src="ui/appicons/Figma.png"><img src="ui/appicons/Word.png"><img src="ui/appicons/Excel.png"></div>'
assert src.count(OLD_DOCK) == 2
src = src.replace(OLD_DOCK, dock({'Finder', 'Chrome', 'Slack'}, 'I'), 1)     # 自宅iMac (Slack を使用中)
src = src.replace(OLD_DOCK, dock({'Finder', 'Chrome', 'Notion'}, 'M'), 1)    # 自分のMac (Notion を使用中)

tb = src[src.index('<div class="taskbar">'):src.index('</div>', src.index('<img src="ui/appicons/Outlook.png">')) + 6]
new_tb = ('<div class="taskbar"><div class="winlogo"><i></i><i></i><i></i><i></i></div>'
          + ''.join('<span class="ti%s"><img src="ui/appicons/%s.png"></span>' % (c, a) for a, c in [('Chrome', ' run'), ('Slack', ' run'), ('Teams', ' run'), ('Word', ' act'), ('Excel', ''), ('Outlook', ' run')])
          + '</div>')
src = src.replace(tb, new_tb)
CAPS = '<div class="caps"><i><svg viewBox="0 0 11 11"><path d="M0 5.5h11"/></svg></i><i><svg viewBox="0 0 11 11"><rect x=".6" y=".6" width="9.8" height="9.8"/></svg></i><i><svg viewBox="0 0 11 11"><path d="M.5.5l10 10M10.5.5l-10 10"/></svg></i></div>'
rep('<div class="bar"><span>議事録.docx – Word</span></div>', '<div class="bar" style="padding-right:0"><span>議事録.docx – Word</span>' + CAPS + '</div>')

open('film8.html', 'w', encoding='utf8').write(src)
print('film8.html written', len(src))
