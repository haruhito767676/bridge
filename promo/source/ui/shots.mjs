import { open, shot, ev, sleep, APP } from './harness.mjs';
import path from 'node:path';
const D = (n) => path.join(APP, 'assets/demo', n);
const icon = (n) => 'file://' + path.join(new URL('.', import.meta.url).pathname, 'appicons', n + '.png');
const MIN = 60000, HOUR = 3600000, DAY = 24 * HOUR;
const app = (n) => ({ name: n, icon: icon(n) });

async function seed(platform) {
  const now = Date.now();
  const file = (name, ago, dev, plat, a) => ({ path: D(name), name, fromDevice: dev, fromPlatform: plat, timestamp: now - ago, sourceApp: a ? app(a) : null });
  const F = [
    file('見積書_ECサイト改修_v2.pdf', 40 * MIN, '会社用PC', 'win32', 'Excel'),
    file('議事録_1010_定例MTG.txt', 4 * HOUR, null, null, 'Notion'),
    file('ロゴ差分_v3.png', DAY + 5 * HOUR, '会社用PC', 'win32', 'Figma'),
    file('検収書_9月分.pdf', 3 * DAY + 4 * HOUR, '自宅iMac', 'darwin', 'Pages'),
    file('進行スケジュール.csv', 2 * DAY, null, null, 'Numbers'),
    file('契約書_業務委託.docx', DAY + 2 * HOUR, null, null, 'Word'),
    file('経費精算_9月.xlsx', 2 * DAY + 3 * HOUR, '会社用PC', 'win32', 'Excel'),
    file('納品リスト_10月.xlsx', DAY + 8 * HOUR, '自宅iMac', 'darwin', 'Excel'),
    file('バナー案_A案.png', 3 * DAY + HOUR, '自宅iMac', 'darwin', 'Pages'),
  ];
  const T = [
    ['会議室Bを10:00〜11:00で予約しました。プロジェクターの予約も忘れずに。', MIN, null, null, 'Notion'],
    ['https://github.com/example-team/ec-renewal/pull/42', 8 * MIN, null, null, 'Chrome'],
    ['本日17時までにデザイン差し戻しをお願いします🙏', 35 * MIN, '自宅iMac', 'darwin', 'Slack'],
    ['在庫アラートのしきい値を10→15に変更してもらえますか？', 80 * MIN, '会社用PC', 'win32', 'Slack'],
    ['ssh deploy@192.168.1.42 -p 2222', DAY + 4 * HOUR, '会社用PC', 'win32', 'Terminal'],
    ['本日15:00〜Teams会議です。 https://teams.microsoft.com/l/meetup-join/xxxx', 3 * HOUR, '自宅iMac', 'darwin', 'Teams'],
  ];
  await ev(`(async()=>{
    const F=${JSON.stringify(F)}, T=${JSON.stringify(T)}, now=${now};
    F.forEach(f=>window.__emit('add-file',f));
    T.forEach(([text,ago,dev,plat,a])=>window.__emit('clipboard-item',{type:'clipboard-text',text,timestamp:now-ago,fromDevice:dev||undefined,fromPlatform:plat||undefined,sourceApp:${JSON.stringify(Object.fromEntries(['Excel', 'Notion', 'Figma', 'Pages', 'Numbers', 'Chrome', 'Slack', 'Terminal', 'Word', 'Outlook', 'Teams', 'PowerPoint'].map((n) => [n, app(n)])))}[a]}));
    window.__emit('shelter-expanded',{focus:false});
  })()`);
  await sleep(1500);
}
for (const platform of ['darwin', 'win32']) {
  await open(platform);
  await seed(platform);
  await shot(`${platform}-list`);
}
process.exit(0);
