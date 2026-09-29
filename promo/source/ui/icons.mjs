import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
const APPS = { Excel: '/Applications/Microsoft Excel.app', Notion: '/Applications/Notion.app', Figma: '/Applications/Figma.app', Pages: '/Applications/Pages.app', Numbers: '/Applications/Numbers.app', Chrome: '/Applications/Google Chrome.app', Slack: '/Applications/Slack.app', Terminal: '/System/Applications/Utilities/Terminal.app', Word: '/Applications/Microsoft Word.app', Outlook: '/Applications/Microsoft Outlook.app', Teams: '/Applications/Microsoft Teams.app', PowerPoint: '/Applications/Microsoft PowerPoint.app' };
for (const [n, p] of Object.entries(APPS)) {
  if (!existsSync(p)) { console.log('missing', n); continue; }
  let icon = '';
  try { icon = execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print :CFBundleIconFile', p + '/Contents/Info.plist']).toString().trim(); } catch { }
  if (icon && !icon.endsWith('.icns')) icon += '.icns';
  let f = icon && p + '/Contents/Resources/' + icon;
  if (!f || !existsSync(f)) { const l = readdirSync(p + '/Contents/Resources').filter(x => x.endsWith('.icns')); f = l[0] && p + '/Contents/Resources/' + l[0]; }
  if (!f) { console.log('noicon', n); continue; }
  execFileSync('sips', ['-s', 'format', 'png', '-Z', '128', f, '--out', `appicons/${n}.png`], { stdio: 'ignore' });
  console.log('ok', n);
}
