# Bridge 技術仕様書 (SPEC)

本書は Bridge の内部仕様（アーキテクチャ、ウインドウ挙動、データモデル、IPC API、クリップボード監視、一時ファイル管理、同期プロトコル、UI 仕様）を定義する。対象バージョン: 0.1.0。

> **NOTE**: マウス共有機能（他デバイスのカーソルを遠隔操作する KVM 風機能）は Bridge の製品スコープから外し、`feature/input-sharing` ブランチへ退避した。本書からも関連仕様を削除済み。

---

## 1. アーキテクチャ概要

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Main プロセス (main.js)                                          │
│  ├─ ウインドウ管理 (右端ドック / スライド展開・格納 / マルチモニター)   │
│  ├─ カーソル監視ポーリング (右端滞留で出現 / 離脱格納, 50ms)          │
│  ├─ クリップボード監視 (テキスト / 画像 / ファイルコピー, 500ms)      │
│  ├─ 一時ファイル管理 (生成・追跡・自動削除)                          │
│  ├─ bridge:// URL スキームハンドラ                                 │
│  ├─ 同期サブシステム                                               │
│  │  ├─ HTTP サーバー (node:http, 0.0.0.0:9095)                    │
│  │  ├─ ピア発見 (静的設定 + /24 サブネットスキャン + 受信時自動登録)   │
│  │  ├─ 即時プッシュ (POST /push) + 差分ポーリング (GET /items)       │
│  │  └─ 実体ファイルのストリーム転送 (GET /file)                     │
│                    ▲                                             │
│                    │ IPC (ipcMain / ipcRenderer)                  │
│                    ▼                                             │
│  preload.js — contextBridge で window.bridge.* を公開             │
│  (contextIsolation: true / nodeIntegration: false)               │
│                    ▲                                             │
│                    ▼                                             │
│  Renderer プロセス (シェルフ)                                       │
│  └─ renderer.js + index.html + styles.css                        │
│     ├─ アイテムリスト (表示の唯一の真実 / 最新順)                    │
│     ├─ スマート検索 (フィルターバッジ + サジェスト)                  │
│     ├─ 選択 (クリック / Shift / ⌘ / 矩形選択 / ⌘A)                 │
│     └─ D&D (受け入れ / OS ネイティブドラッグアウト)                  │
└──────────────────────────────────────────────────────────────────┘
```

- 外部依存パッケージなし。Main は Node 標準モジュール（`http`, `net`, `fs`, `crypto`, `os`, `child_process` 等）と Electron API のみ使用する。同期もクラウドを介さない LAN 内 P2P で完結する。
- **状態の分担**: 表示リストの真実は Renderer の `items` 配列が持つ。Main は同期台帳 (`syncStore`)・一時ファイル追跡 (`sessionTempFiles`)・クリップボード履歴の Main 側コピー (`clipHistory`) を持つ。

### 1.1 プロセス起動シーケンス

1. シングルインスタンスロック取得（失敗時は何も起動せず `app.quit()`。第 2 インスタンスがウォッチャーや同期サーバーを一瞬でも起動しないようフラグでガード）
2. `bridge://` プロトコルのデフォルトクライアント登録（開発時は `process.execPath` + エントリパス付き）
3. `app.whenReady()` 後: `app.dock.hide()`（macOS）→ `createWindow()` → `createTray()` → `registerToggleShortcut()` → `startClipboardWatcher()` → `startEdgeRevealWatcher()` → `startDeviceSync()`
4. メニューバーアイコン: 左クリック = 表示 / 非表示のトグル、右クリック = メニュー（表示 / 隠す・ログイン時に起動・設定…・Bridge を終了）
5. Windows/Linux で `bridge://` から直接起動された場合は `process.argv` の URL を処理

---

## 2. ウインドウ仕様

### 2.1 形状・配置

| 定数 | 値 | 意味 |
|---|---|---|
| `SHELTER_WIDTH` | 320px | 展開時の幅 |
| `TAB_WIDTH` | 15px | 格納時に画面端へ残す「つまみ」の幅 |
| `SHELTER_HEIGHT` | 600px | 高さ（ディスプレイ作業領域より大きい場合は縮小） |

- `BrowserWindow` オプション: `frame: false` / `resizable: false` / `alwaysOnTop: true` / `fullscreenable: false` / `vibrancy: 'sidebar'`（macOS すりガラス）/ `backgroundMaterial: 'acrylic'`（Windows 11）/ 背景透過。macOS では `type: 'panel'`（NSPanel）として生成し、クリックしても作業中のアプリを背面に下げない
- macOS では `app.dock.hide()` によりメニューバー常駐のユーティリティとして振る舞う（Dock・⌘Tab に出ない）。Windows では `type: 'toolbar'` + `skipTaskbar` でタスクバーと Alt+Tab に出さない

### 2.1.1 Windows の開閉方式（フライアウト）と常駐ヘルパー

Windows では Electron から触れない Win32 API を **常駐 PowerShell ヘルパー** (`winShellRun`) に任せる。`powershell.exe -Command <読み取りループ>` を 1 つ起動しっぱなしにし、命令を Base64 の 1 行で標準入力へ、応答を `<<END>>` 番兵まで標準出力から受け取る（直列実行、8 秒でタイムアウトして作り直し）。初期化で `user32` の `GetForegroundWindow` / `SetForegroundWindow` / `AttachThreadInput` / `GetClipboardSequenceNumber` と `System.Windows.Forms` を読み込む。用途: 前面アプリの取得、ファイルのクリップボード書き込み (`Set-Clipboard -LiteralPath`)、コピーされた全ファイルの列挙 (`Get-Clipboard -Format FileDropList`)、クリップボード連番、ペースト先の復帰 + `SendKeys ^v`。毎回 PowerShell を起動していた頃の数百 ms の待ちとコンソール窓のちらつきが無くなる。

Windows では macOS 向けの「毎フレームの `setBounds`」と「カーソル座標のポーリング」を**一切使わない**。DPI の異なるマルチモニターでは DIP 座標系が食い違い、展開 → 強制格納 → 再展開の無限ループ（暴れ）になるため。

- ウインドウは「つまみ幅」と「全幅」の 2 状態を即時に切り替える。滑る動きは Renderer の CSS（`body.expanded #shell` に 250ms の減速スライドイン、`body.collapsing #shell` に 150ms のスライドアウト）が担い、Main は格納時に 170ms 待ってから幅を縮める（`animateDock` の `IS_WINDOWS` 分岐）
- **つまみはモニターごとに別ウインドウ** (`tab.html`、15px 幅・透明・`focusable: false`・`toolbar`)。全ディスプレイの右端中央に 1 枚ずつ置き、`display-added` / `removed` / `metrics-changed` で作り直す。つまみへの 250ms 滞留 / クリック / `dragenter` で `tab-activate` (displayId) を送り、Main はそのディスプレイにシェルフを出す (`expandShelter({ display })`)。シェルフ本体は格納 = `hide()`、展開 = 全幅で `showInactive()`（ホットキー等は `focus()`）
- 格納は Renderer の `mouseleave` から 220ms 後（その間に再進入があれば取り消し）。カーソル座標による強制格納と離脱判定は行わない（`startEdgeRevealWatcher` は Windows では起動しない）
- 見た目は `body.platform-win32` の Fluent スキン（§ 9.4）
- Windows で起動する PowerShell（前面アプリ取得・ファイルのクリップボード書き込み・zip 化・⌘V 送信）はすべて `windowsHide: true` で、コンソール窓を一瞬も出さない
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` により仮想デスクトップ・フルスクリーンアプリ上でも追従
- 配置は常に「**マウスカーソルがあるディスプレイ**の `workArea` 右端・垂直中央」。表示前に必ず `placeDockInstantly` で座標を確定し、OS の自動復元によるモニター跨ぎを防ぐ
- **開閉はスプリングアニメーション**（`animateDock`）: 通常は幅 320px を保ったまま画面外へスライド（移動のみなので Chromium の再レイアウト・再描画が起きない）し、格納が終わった時点で幅を `TAB_WIDTH` へ縮める。「滑り出す矩形」が他のディスプレイと交差する場合（`hasDisplayToTheRight`、DPI 差による数 px の隙間を許容するため 32px の余裕付き）だけ、はみ出しが見えないよう右端固定の幅変更方式にフォールバックする。展開時の「別ディスプレイに居るか」の判定は、アニメーション中の矩形ではなく現在ドックしているディスプレイ (`dockSpring.display`) と比べる（滑り出した瞬間に隣のディスプレイと誤判定して閉じ直す暴れを防ぐ）。毎フレーム（60fps）`setBounds` し、減衰比 1.0 / 応答 0.32s の臨界減衰スプリングで、途中で目標が変わってもその場の値と速度から滑らかに反転する（中断可能）。Renderer 側は `#root` を右寄せ・固定幅 320px にしているため、幅が縮んでも中身は再レイアウトされない。`nativeTheme.getAnimationSettings().prefersReducedMotion` が真なら即時に切り替える

### 2.2 展開・格納の状態遷移

```
[格納 (つまみ 15px)] ──(a)(b)(c)──▶ [展開 (320px)] ──(d)(e)──▶ [格納]
```

**展開トリガー**
- (a) Main のカーソルポーリング（50ms 間隔）が「任意のディスプレイの右端つまみゾーン」に **`EDGE_DWELL_MS`（250ms）以上滞留**したことを検知（通り過ぎ・一瞬の接触では開かない。展開後は居続けても再展開しない）
- (b) Renderer のつまみクリック / `dragenter` → IPC `shelter-expand`（即時）
- (c) グローバルホットキー（macOS: ⌥Space / Windows・Linux: Ctrl+Shift+Space）、メニューバーアイコンのクリック、`bridge://` 受信・`second-instance` などの明示的な呼び出し → `expandShelter({ focus: true })`

展開時はカーソルのあるディスプレイをその都度再判定し、別ディスプレイにいた場合はアニメーションなしで隠れ位置へワープしてから展開する。最前面レベルは `floating`（`screen-saver` にすると OS のドラッグ中アイコン描画より手前に出てしまうため）。展開のたびに Renderer へ `shelter-expanded` (`{ focus }`) を通知し、検索状態のリセット（残っているときだけ）とスクロール位置の先頭復帰を行わせる。

**フォーカス方針**: ホバー（a）(b) による展開では**キーボードフォーカスを奪わない**（作業中のアプリへの入力を乗っ取らない）。(c) の明示的な呼び出しのときだけ `win.focus()` し、Renderer は検索バーへフォーカスする。格納時は `releaseFocus()`（`win.blur()`）で元のアプリへ返し、履歴クリック後にそのまま ⌘V できる状態にする。

**格納トリガー**
- (d) Renderer の `mouseleave` / ウインドウ外への `dragleave` → IPC `shelter-collapse`（220ms のディレイ付き。ディレイ中の再展開でキャンセル。発火時点でカーソルがまだウインドウ内なら空振りとみなして格納しない）
- (e) 即時格納 `collapseShelterNow()`: 履歴クリック（Renderer がチェックマークを 320ms 見せてから `shelter-collapse-now`）、Esc、ホットキーのトグル、および Main ポーリングによる強制格納（カーソルがウインドウ領域 + マージン 48px から完全離脱。Windows でのマウス高速移動による `mouseleave` 取りこぼし対策）。ただし展開直後 1 秒間（`EXPAND_GRACE_MS`）の猶予、ウインドウにフォーカスがある間、Renderer が矩形選択でボタンを押し続けている間（`shelter-hold-pointer`）は強制格納しない

### 2.3 耐障害性

- `render-process-gone`（`clean-exit` 以外）: `rendererReady` を落として自動リロード。復帰までの IPC はキューへ退避
- Renderer 準備前に届いたアイテムは `pendingFiles` / `pendingClipItems` にキューイングし、`did-finish-load` で一括送出。キュー上限は各 200 件（FIFO で最古から破棄）
- ウインドウ破棄中の IPC 送信は `canSendToRenderer()`（win 生存 + rendererReady + webContents 生存）でガード

---

## 3. データモデル

### 3.1 Renderer のアイテム (`items` 配列、最新順)

```js
{
  kind: 'file' | 'clip-text' | 'clip-image',
  path: string | null,       // 実体ファイルの絶対パス (ダウンロード中は null)
  name: string,              // 表示名 (clip-text は本文の冒頭 200 文字プレビュー)
  text: string | null,       // clip-text の生本文
  icon: string | null,       // OS ファイルアイコンの Data URL
  isImage: boolean,          // 実物サムネイル表示の対象か (拡張子判定)
  downloading: boolean,      // Web ダウンロード / テキスト保存の進行中
  removing: boolean,         // フェードアウト中
  timestamp: number,
  fileKind: string | undefined, // Finder 純正の種類名 (mdls、非同期付与)
  fromDevice: string | null,    // 出身デバイス名 (null = ローカル生まれ)
  fromPlatform: string | null,  // 出身 OS ('darwin' | 'win32' 等)
}
```

- `kind: 'file'` = ユーザーが明示的に置いた一時保存ファイル（先頭に OS のファイルアイコン / 画像サムネイル）。`clip-*` = コピー監視の自動ログ（先頭にクリップボードのグリフ）。`syncing: true` は他拠点からの実体待ち（名前・時刻・出身は確定、`syncId` で差し替え先を特定。触れない・ドラッグできない・永続化しない）。`originKind: 'folder'` はフォルダ由来。**`timestamp` は他拠点由来でも「送信元でシェルフに置かれた時刻」**（`add-file` / `clipboard-item` の `timestamp`）で、受信時刻ではない。表示は常に `timestamp` の新しい順に並べ替え、日付ごとに「今日 / 昨日 / M月D日」のセクション見出しを挟む（見出しは sticky にせず一緒にスクロールする）
- **上限**: file 100 件 / clip-text 100 件 / clip-image 30 件。あふれた最古アイテムはリストから外し、裏生成ファイルなら Main へ実体削除を依頼する

### 3.2 重複スタック化

同一内容の再追加はカードを増やさず、既存カードを最上位へ移動して時刻のみ更新する (`bumpExistingItem`)。

| 種別 | 同一判定 |
|---|---|
| file | 同一パス **または** 同一ファイル名 |
| clip-text | 本文の全文一致（重複時、新規用に裏生成された snippet はディスクから即削除） |
| clip-image | 保存 PNG のファイル名一致 |

### 3.3 Main の同期台帳エントリ (`syncStore`、上限 500)

```js
{
  id: string,          // crypto.randomUUID() — 重複同期・循環中継の防止キー
  type: 'text' | 'image' | 'file',
  name: string | null,
  text: string | null, // type === 'text' のみ
  path: string | null, // ローカル実体。削除済みなら null (hasFile: false で通知)
  timestamp: number,   // 生成元デバイスの時計で付与
  fromDevice: string,
  fromPlatform: string,
}
```

---

## 4. IPC API（preload.js が公開する `window.bridge.*`）

### Renderer → Main

| API | チャンネル | 方式 | 内容 |
|---|---|---|---|
| `getPathForFile(file)` | — | 同期 | `webUtils.getPathForFile` で File の絶対パス取得（Electron 32+ の `File.path` 廃止対応） |
| `startDrag(paths)` | `ondragstart` | send | OS ネイティブドラッグアウト（複数可、先頭ファイルのアイコン付与） |
| `getFileIcon(path)` | `get-file-icon` | invoke | OS 標準ファイルアイコンの Data URL（失敗時 null） |
| `getFileKind(path)` | `get-file-kind` | invoke | 種類ラベル。フォルダ → `"フォルダ"`、macOS → `mdls kMDItemKind`、他 → 拡張子から生成 |
| `downloadUrl(url)` | `download-url` | invoke | http(s) を `userData/downloads/` へ保存 → `{ path, name }`。拡張子欠落は Content-Type から補完 |
| `saveTextSnippet(text)` | `save-text-snippet` | invoke | `snippet_<ts>.txt` として保存（一時ファイル追跡対象） |
| `getDeviceInfo()` | `get-device-info` | invoke | `{ device, platform }`（バッジのローカル判定用） |
| `registerSyncFile(path, name)` | `sync-register-file` | send | ローカル生まれファイルの同期台帳登録。フォルダは zip 化してから登録。重複パスは無視 |
| `previewFile(path, name)` | `preview-file` | send | macOS クイックルック（`previewFile`） |
| `expandShelter()` / `collapseShelter()` | `shelter-expand` / `-collapse` | send | 展開 / 遅延格納 |
| `writeClipboardText(text)` | `clipboard-write-text` | send | 生テキストを書き戻し + 自己検知スルー設定 + 即時格納 |
| `writeClipboardImage(path)` | `clipboard-write-image` | send | 画像を書き戻し（書き戻し後を読み直して基準値化、再検知防止）+ 即時格納 |
| `writeClipboardFile(path)` | `clipboard-write-file` | send | mac: `public.file-url` / Win: PowerShell `Set-Clipboard -LiteralPath`（CF_HDROP）で「本物のファイル」として書き込み + 即時格納 |
| `dragClipboardText({ text, path })` | `drag-clipboard-text` | send | 生成済み snippet でドラッグアウト（無ければその場で生成） |
| `deleteTempFile(path)` | `delete-temp-file` | send | 裏生成ファイルの実体削除。**`sessionTempFiles` に含まれるパスのみ削除**（ユーザー実ファイル保護）。同期台帳の該当 path も null 化 |
| `reportRetainedPaths(paths)` | `report-retained-paths` | send | 現在リスト保持中のパス一覧（終了時クリーンアップの除外判定用、render のたびに送信） |
| `persistItems(items)` | `persist-items` | send | 保存用の一覧。Main が 0.5 秒デバウンスして `history.json` に原子的に書く |
| `statPaths(paths)` | `stat-paths` | invoke | 存在しないパスを返す（「見つかりません」表示） |
| `confirmAddFile(path)` | `confirm-add-file` | send | bridge:// の確認に「追加」で応答（確認待ちのパスのみ受理） |
| `ensureClipboardTextFile({ text, path })` | `ensure-clipboard-text-file` | invoke | テキスト履歴の `.txt` を遅延生成して返す |
| `openExternal(url)` | `open-external` | send | http(s) のみ `shell.openExternal` |
| `scanPeersNow()` / `revealLog()` | `scan-peers-now` / `reveal-log` | invoke / send | 「いま探す」/「ログを表示」 |
| `popupChoose(choice)` / `popupClose()` | `popup-choose` / `popup-close` | send | ペースト用ポップアップの選択 / 閉じる |
| `collapseShelterNow()` | `shelter-collapse-now` | send | ディレイなしの即時格納（コピー確認表示後・Esc） |
| `holdPointer(bool)` | `shelter-hold-pointer` | send | 矩形選択中は強制格納を保留 |
| `revealInFinder(path)` / `openFile(path)` | `reveal-in-finder` / `open-file` | send | `shell.showItemInFolder` / `shell.openPath` |
| `copyPlainText(text)` | `clipboard-copy-plain` | send | テキストをそのままクリップボードへ（履歴には載せない） |
| `getSyncStatus()` | `get-sync-status` | invoke | 同期状態のスナップショット |
| `getSettings()` / `saveSettings(s)` | `get-settings` / `save-settings` | invoke | 設定シート。デバイス名・同期キー・自動スキャン・手動ピア・ログイン時起動を `sync-config.json` へ書き戻し、メモリ上の状態にも即時反映 |

### Main → Renderer

| API | チャンネル | 内容 |
|---|---|---|
| `onAddFile(cb)` | `add-file` | ファイル追加。payload: `{ path, name, fromDevice, fromPlatform }`（旧形式のパス文字列にも Renderer 側で後方互換対応） |
| `onClipboardItem(cb)` | `clipboard-item` | クリップボード履歴。`{ type: 'clipboard-text'|'clipboard-image', text, path, timestamp, fromDevice, fromPlatform }` |
| `onShelterExpanded(cb)` | `shelter-expanded` | 展開通知 `{ focus }`（検索リセット。`focus` が真のときだけ検索バーへフォーカス） |
| `onShelterCollapsed(cb)` | `shelter-collapsed` | 格納通知（選択・ツールチップ・メニュー・設定シートを閉じる） |
| `onSyncStatus(cb)` | `sync-status` | ピアのオンライン状態が変わったとき `{ peers: [{ device, host, port, online, lastSyncedAt, lastError }], onlineCount, clipboardPaused, syncPaused }` |
| `onPastePermissionNeeded(cb)` | `paste-permission-needed` | 自動ペーストにアクセシビリティの許可が無い（macOS） |
| `onOpenSettings(cb)` | `open-settings` | メニューバーの「設定…」 |
| `onRestoreItems(cb)` | `restore-items` | 起動時 / Renderer 再起動時に前回の一覧を復元 |
| `onConfirmAddFile(cb)` | `confirm-add-file` | bridge://add?path= の確認依頼 `{ path, name }` |
| `onUpdateAvailable(cb)` / `onUpdateNone(cb)` | `update-available` / `update-none` | アップデート確認の結果 |
| `onPopupItems(cb)` | `popup-items` | ポップアップに出す一覧（popup.html のみ） |

---

## 5. アイテムの入力経路

| 経路 | 処理 |
|---|---|
| ローカルファイルの D&D | `webUtils.getPathForFile` でパス取得 → `addLocalFile` |
| Web 画像 / リンクの D&D | `text/html` の `<img src>` → `text/uri-list` → `text/plain` の順に http(s) URL を抽出 → Main で**ストリーム**ダウンロード（`Readable.fromWeb` → `createWriteStream`、上限 2GB、`text/html` は拒否）。プレースホルダ表示 → 完了で差し替え、失敗はトーストで通知 |
| 選択テキストの D&D | URL でなければ `snippet_<ts>.txt` 化して追加 |
| `bridge://add?path=` | パネルを展開して**確認トースト**を出し、「追加」を押したときだけ追加する（Web ページのリンクから任意のローカルファイルが無確認で同期されるのを防ぐ。15 秒で失効） |
| `bridge://add?text=` | http(s) ならダウンロード、それ以外は `.txt` 化 |
| クリップボード監視 | § 6 参照（ウインドウを奪わない `addFileQuietly` / `sendClipboardItem`） |
| 他拠点からの同期 | § 7 参照（同上） |

ファイル名の衝突は `reserveDest` により `name-1.ext`, `name-2.ext`… と連番回避する。

---

## 6. クリップボード監視

- ポーリング間隔 500ms。再入防止フラグ付き（画像保存中に次 tick が重ならない）
- **隠されたコピーは無視**: `org.nspasteboard.ConcealedType` / `TransientType` / `AutoGeneratedType`（macOS、パスワードマネージャーの慣習）、`ExcludeClipboardContentFromMonitorProcessing` / `CanIncludeInClipboardHistory`（Windows）が付いていれば履歴に載せず同期もしない（基準値だけ更新）
- **一時停止**: メニューバーの「クリップボードの監視を一時停止」中は履歴に載せない（基準値は追従させ、再開時に停止中の内容がまとめて載らない）
- 起動時の内容は履歴に入れず基準値としてのみ記録
- 自己書き戻し（履歴クリックによる再コピー）は、書き戻し時に基準値 (`lastClipText` / `lastClipImageKey` / `lastClipFileKey`) を更新して検知をスルー

**1 tick の判定順序**:

1. **ファイルコピー検知**（最優先）。検知したらその tick のテキスト / 画像判定はスキップ（ファイルコピーに付随するパス文字列テキストを偽履歴にしない）
   - macOS: `NSFilenamesPboardType`（XML plist、複数対応）→ フォールバック `public.file-url`（単一）
   - Windows: `FileNameW`（CF_FILENAMEW）で「ファイルがコピーされた」ことを検知し、常駐ヘルパーの `Get-Clipboard -Format FileDropList` で**選択された全ファイル**を列挙する（同じコピーが載り続けている間は前回の結果を再利用）→ `Chromium Web Custom MIME Data` → `text/uri-list` → プレーンテキストは**全体が 1 行 1 パスのときだけ**（`extractWholeTextPaths`。プロンプト行に作業フォルダのパスが混じるだけのコピーをファイルと誤認しない）。最後に `fs.existsSync` で実在確認
   - 検知したファイルは `addFileQuietly` でシェルフへ追加（ウインドウは奪わない）
2. **テキスト**: 前回と異なる非空テキストなら履歴化。`.txt` はこの時点では作らず、ドラッグアウト / クイックルック時に `ensure-clipboard-text-file` で**遅延生成**する（コピーのたびにディスクへ書かない）。同期台帳へ登録 → ピアへ即時プッシュ
3. **画像**: `availableFormats()` に `image/*` がある場合を対象にする。**Windows は毎 tick まず OS のクリップボード連番（`GetClipboardSequenceNumber`、常駐ヘルパー経由）を読み、前回と同じなら何も読まずに終える**。連番が変わった tick は形式一覧に `image/*` が無くても `readImage()` を試す（Snipping Tool など WinRT 経由の遅延レンダリングは一覧に出ないことがある）。既知のファイルキーと同じでファイル判定が return してしまうと連番変化を握りつぶすため、連番が変わっているときはファイルキー一致でも return せず画像判定まで進む。それでも空なら 4 tick だけ読み直し、そのときの形式一覧・テキスト・ファイル数を必ず `bridge.log` の `[clip]` に残す（起動 1.5 秒後には連番機構自体の疎通確認も `[winshell]` に 1 行出す）。この tick が例外で失敗した場合も `[clip]` にメッセージを残す（`console.error` はパッケージ版では表示先が無く消えるため）。macOS はまず**安価な署名**（フォーマット一覧 + macOS は `public.tiff` / Windows は `PNG` バッファの長さ。Windows で `PNG` が無いとき（Snipping Tool など）はクリップボード連番 `GetClipboardSequenceNumber` を署名に加える）を前回と比べ、同じならデコードもハッシュもしない（スクリーンショットが載ったまま放置されても CPU を使わない）。変わっていたら `readImage()` し、同一判定キーは「サイズ + バイト数 + bitmap の等間隔サンプル（最大 256KB）の MD5」。新規なら `clipboard_<ts>.png` として即ファイル化 → 履歴化・同期登録

Main 側履歴 (`clipHistory`) の上限はテキスト 100 / 画像 30。**Main はディスク削除を行わず配列長のみ管理**する（表示の真実を持つ Renderer 側のトリミング → `delete-temp-file` IPC が削除を担う。両者の並びズレによる「表示中ファイルの誤削除」を防ぐための設計）。

---

## 7. マルチデバイス同期プロトコル

### 7.1 トランスポートと認証

- 各デバイスが `node:http` サーバーを `0.0.0.0:<port>`（既定 9095）で待ち受ける平文 HTTP
- 全リクエストにヘッダー `x-bridge-token: <secretToken>` を必須とし、`crypto.timingSafeEqual` で厳格照合。不一致は**全エンドポイント 401**
- `secretToken` は `sync-config.json` に保存。未設定なら初回起動時に 32 バイトの暗号学的乱数（hex）を自動生成して書き戻す。**同期させたいデバイス間では手動で同一値に揃える**のが前提
- ボディ / レスポンスのサイズ上限 10MB（`/file` のストリーム転送を除く）

### 7.2 エンドポイント

| メソッド / パス | 役割 |
|---|---|
| `GET /ping` | 自己紹介。`{ app: "bridge", device, platform, port, iconType }`。ピア発見のプローブ（タイムアウト 800ms） |
| `GET /items?since=T` | タイムスタンプ `T` より新しい台帳エントリの**メタデータ**一覧（差分同期） |
| `GET /file?id=<uuid>` | エントリ実体のストリーム配信（`application/octet-stream`）。実体なし / フォルダは 404。受信側切断で読み取りを即中止 |
| `POST /push` | 新着メタデータの即時受信。送信元を known peer として自動登録（自動ブートストラップ） |

メタデータ形式:

```json
{
  "id": "uuid", "type": "text | image | file",
  "name": "...", "text": "text のときのみ",
  "timestamp": 1720000000000,
  "fromDevice": "...", "fromPlatform": "darwin",
  "hasFile": true
}
```

実体ファイルはメタデータに含めず、`hasFile: true` のとき受信側が `GET /file?id=` で別途取得する（送受信ともストリーミングでメモリ非圧迫）。

### 7.3 ピア発見

1. **静的設定**: `sync-config.json` の `peers`（`host` / `host:port`）
2. **UDP マルチキャストの自己紹介**（既定）: `239.255.77.77:9096` へ 30 秒ごと（起動直後は 0 / 2 / 6 秒後にも）`{ app, v, port, device, platform, tokenId }` を送る。`tokenId` は同期キーの SHA-256 先頭 16 文字で、一致した相手だけを `addPeer` し、直接ユニキャストで名乗り返す（TTL 1 = 同一セグメント限定）。`autoScan: false` で無効化
3. **サブネットスキャン**（フォールバック）: 全 IPv4 インターフェースの /24 範囲へ `GET /ping`、並列度 32。起動 15 秒後に誰も見つかっていないときに 1 回、および設定シートの「いま探す」で実行する。定期実行はしない（ネットワークに静かにする）
4. **受信時自動登録**: `POST /push` してきた相手の `remoteAddress` + 申告ポートを登録

ピアには `lastSyncedAt`（最後に成功した時刻）と `lastError`（最後の失敗理由。401 は「同期キーが一致しません」）を持たせ、設定シートに表示する。オンライン / オフラインの遷移と失敗は `bridge.log` に記録する。

自分自身（ローカルアドレス + 同一ポート）は除外。発見した瞬間に一度差分ポーリングを走らせる（再接続直後の取り込みを最速化）。

### 7.4 伝播モデル

- **即時プッシュ**: ローカルでアイテムが生まれた瞬間、オンラインの全ピアへ `POST /push`。失敗したピアは `online: false` へ降格（以後は差分ポーリングで回復）
- **差分ポーリング**: 20 秒間隔で各ピアへ `GET /items?since=<lastSyncedTs>`。`lastSyncedTs` は「**ピア側の時計で付いたタイムスタンプ**」の最大値を採用するため、デバイス間の時計ズレで取りこぼしは起きない
- **中継 (メッシュ)**: 受信したエントリはローカル台帳へ載せた上で自分のピアへも再プッシュ。`id` の既読管理 (`seenSyncIds`、FIFO 上限 5,000) で循環と重複を防止。任意の 2 台が到達可能なら全体が収束する
- **再試行**: ファイル転送失敗時は `seenSyncIds` に入れず `lastSyncedTs` も進めない → 次回ポーリングで同じ地点から自動再取得
- 自分発 (`fromDevice` 一致)・既読 `id` は取り込みスキップ。未知の `type` は黙って読み飛ばす（前方互換）
- **同期の一時停止**（メニューバー）中は、登録・プッシュ・ポーリングを止め、サーバーは `/ping` 以外に 503 を返す。停止中に生まれたアイテムは再開後も同期しない

### 7.5 受信時の取り込み

| type | 処理 |
|---|---|
| `text` | 本文のみで取り込み → Renderer へ `clipboard-item`（`.txt` は必要になったときに遅延生成） |
| `image` / `file`（共通） | ダウンロード開始**前に** `sync-pending`（`syncId` / 種別 / 名前 / 送信元の時刻 / 出身）を Renderer へ送り、「同期中」の行を先に出す。実体が届いたら `clipboard-item` / `add-file` に同じ `syncId` を添えて送り、Renderer はその行を差し替える（新しい行は作らない）。404 で届かないと分かったら `sync-pending-remove` で取り下げる。転送失敗（再試行待ち）の間は行を残す |
| `image` | `/file` からダウンロード → `clipboard-item`（画像履歴として表示） |
| `file` | `/file` からダウンロード → `originKind: 'folder'` なら § 7.6 の展開 → `add-file`（ファイルカードとして表示、ウインドウは奪わない） |

受信ファイル名は Windows 禁止文字を `_` に置換してサニタイズ。ダウンロード途中のエラーは両ストリームを閉じ欠損ファイルを削除してから reject。受信実体は `sessionTempFiles` へ追跡登録される。

### 7.6 フォルダの扱い

- フォルダはストリーム配信できないため、同期登録時にバックグラウンドで **`フォルダ名.zip` へ自動圧縮**してから台帳登録する。台帳とメタデータに `originKind: 'folder'` と `folderName` を付け、ユーザーが本当に置いた `.zip` と区別する（時刻は zip 化の完了時ではなく「置いた時」）。**圧縮が終わるまでは同期そのものが始まらない**（相手には zip 完成後に初めてメタデータが届く）ため、大きい・ファイル数の多いフォルダほど「同期中」表示が出るまでの時間も延びる。圧縮 (`zipFolder`)・展開 (`extractFolderZip`)・受信 (`downloadEntryFile`) はいずれも所要時間とサイズ（圧縮はおおよそのファイル数も）を `bridge.log` の `[sync]` に記録し、遅さがファイルサイズ・ファイル数・ネットワークのどこに起因するか切り分けられるようにしている
- Windows の zip 化は Windows 10 1803 以降に同梱の `tar`（bsdtar、`.zip` も作れる）を優先し、ファイル数の多いフォルダで著しく遅い `.NET` の `Compress-Archive` は失敗時のフォールバックに格下げした
- **受信側は上限（`FOLDER_AUTO_EXTRACT_MAX_BYTES` = 1GB）以内なら自動で展開**し、zip を消してフォルダの行にする（macOS: `ditto -x -k` / Windows: 同梱の `tar -xf`、無ければヘルパーの `Expand-Archive` / その他: `unzip`）。作業ディレクトリへ展開してから最上位フォルダを衝突しない名前で `downloads/` に移す。展開したフォルダは `sessionTempFiles` に載せ、上限あふれ・終了時に `rmSync` で片付ける
- 上限超え・展開失敗のときは zip のまま残し、行の種別を「フォルダ (zip)」と表示して、右クリックの「フォルダとして展開」(`extract-folder-zip`) で手動展開できる
  - Windows: `Compress-Archive` / macOS: `ditto -c -k --sequesterRsrc --keepParent` / その他: `zip -r`
  - zip 化失敗時は登録を取り消し、再ドロップで再挑戦可能にする
- `registerLocalSyncEntry` と `/file` 配信の双方にフォルダ除外ガードがある（多重防御）

---

## 8. 一時ファイル管理（ディスク保護）

**保存場所**: `<userData>/downloads/`

| 生成物 | 命名 | 追跡 |
|---|---|---|
| Web ダウンロード | 元ファイル名（衝突時は連番） | 追跡しない（ユーザー資産扱い） |
| ドロップ / コピーされたテキスト | `text-<ts>.txt` / `snippet_<ts>.txt`（snippet はドラッグ / プレビュー時に遅延生成） | snippet のみ追跡 |
| コピー画像 | `clipboard_<ts>.png` | 追跡 |
| 同期受信ファイル | 元名をサニタイズ | 追跡 |
| フォルダの自動 zip | `<フォルダ名>.zip` | 追跡 |

**削除の 3 原則**:

1. **履歴あふれ時**: Renderer がリストから外したパスを `delete-temp-file` で依頼 → Main は `sessionTempFiles` に含まれる場合のみ `unlinkSync`。同期台帳の該当エントリは `path: null` 化（ピアには `hasFile: false` で通知され、404 の永久再試行を防ぐ）
2. **終了時 (`will-quit`)**: 追跡中のうち `retainedPaths`（Renderer が最後に報告したリスト保持分）に**含まれない残骸のみ**同期 API で削除
3. **ユーザーがドロップした実ファイルは追跡対象に入らないため、いかなる経路でも削除されない**

---

### 8.1 履歴の永続化（`history.json`）

- Renderer は描画のたびに保存用の一覧（`kind` / `path` / `name` / `text` / `timestamp` / 出身 / `sourceApp` / `pinned`。アイコンは含めない）を `persist-items` で送り、Main が 0.5 秒デバウンスして `<userData>/history.json` へ一時ファイル + rename で書く。`sessionTempFiles` も一緒に保存する
- 起動時（`did-finish-load`）は `restore-items` で復元し、`sessionTempFiles` を読み戻した上で、`downloads/` にある `clipboard_*.png` / `snippet_*.txt` のうち履歴にも追跡にも無い孤児を削除する。同一セッション内の Renderer 再起動ではディスクではなくメモリ上の最新一覧から復元する（クラッシュ復帰）
- 終了時は最新の一覧を必ず書き出してから、リストに残っていない裏生成ファイルだけを削除する（リストにあるものは次回も使うので残す）
- **ピン留め** (`pinned`) は上限トリミングと「すべて消去」の対象外で、常にリスト先頭の「ピン留め」セクションに出る

### 8.1.1 ショートカットキーの変更（設定シート）

プリセットから選ぶのではなく、OS 標準の設定アプリと同じ「フィールドをクリックして押したいキーを押す」方式（`startHotkeyCapture` / `eventToAccelerator`）。`KeyboardEvent.code`（レイアウト非依存の物理キー）から Electron の accelerator 文字列を組み立て、Ctrl / Alt / ⌘ のいずれか（Shift 単独は不可）を必須にする。Esc でキャンセル、フィールドからのフォーカス外れでもキャンセル、リセットボタンで既定値に戻す。

保存時 (`save-settings`) は `applyHotkeys` が新旧それぞれ独立に `globalShortcut.unregister` → `register` を試み、失敗（他アプリ・OS 予約済み）した方だけ元のキーへ登録し直してから `hotkeyError: 'toggle' | 'paste' | null` を返す。Renderer は失敗した方だけ元のラベルに戻して赤枠を明滅させ、成功した設定は保存済みのまま設定シートを開いたままにする（もう一度試せるように閉じない）。

### 8.2 ペースト用ポップアップ（`popup.html`）

- `⌘⇧V`（Windows: `Ctrl+Shift+V`）でカーソルの右下に 300×380 のパネルを出す。中身は `history.json` 用の最新一覧（テキスト / 画像 / 実体のあるファイル、ピン留め先頭、最大 60 件）
- 打ち始めると絞り込み、↑↓ / 1〜9 キー / クリックで選択、⏎ でクリップボードへ書いて閉じる。`⌘⏎` は URL をブラウザで開く。フォーカスを失うと閉じる
- 「選んだあと自動でペースト」(`autoPaste`、既定 on)。macOS: 閉じた 150ms 後に `osascript` の `keystroke` で ⌘V（アクセシビリティ未許可なら OS の許可ダイアログ + トーストで案内し、その回はコピーだけ）。Windows: ポップアップを出す**前に**前面ウインドウの HWND を控えておき、選択後はポップアップを出したまま常駐ヘルパーで `SetForegroundWindow(HWND)`（拒否されたら `AttachThreadInput` で再試行）→ `SendKeys ^v` → 完了後にポップアップを隠す（先に隠すと Electron が前面プロセスでなくなり前面復帰が拒否される）。結果は `bridge.log` の `[paste]` に残す

### 8.3 診断ログ（`bridge.log`）

`<userData>/bridge.log` に `ISO時刻 \t [category] \t message` で追記（1MB でローテーション、2 世代）。カテゴリ: `app` / `server` / `discovery` / `peer` / `sync` / `download` / `update`。設定シートの「ログを表示」で Finder に表示する。

### 8.3.1 全画面アプリの上での自動非表示（Windows、設定なし）

Windows のタスクバー通知や macOS のメニューバー / Dock と同じく、動画・ゲームなどの排他的フルスクリーン表示を Bridge のつまみが邪魔しないことを **OS 標準の振る舞いとして扱い、オンオフの設定は設けない**。1.5 秒ごと（`checkFullscreenAndHide`）に常駐 PowerShell ヘルパーへ問い合わせ、前面ウインドウの矩形がそのモニターの矩形とちょうど一致する（＝排他的フルスクリーン）ときだけ、全モニターのつまみ (`tabWindows`) を隠し、シェルフが開いていれば格納する。全画面が終われば自動で戻る。macOS は `setVisibleOnAllWorkspaces({ visibleOnFullScreen: true })` で最初からフルスクリーン Space と共存できているため対象外。

### 8.4 アップデートの確認

パッケージ版のみ、起動 6 時間後と 24 時間ごとに GitHub Releases の最新タグ（`/repos/haruhito767676/bridge/releases/latest`）と `app.getVersion()` を比べ、新しければトーストで知らせる（自動更新はしない。「ダウンロード」でリリースページを開く）。メニューバーの「アップデートを確認…」で手動実行できる。

---

## 9. UI 仕様（Renderer）

### 9.1 スマート検索

- 展開のたびに状態を完全リセット。ホットキー等の明示的な呼び出しのときだけ検索バーへ自動フォーカス（ホバー展開では奪わない）
- 検索欄にいたまま ↑↓ で結果を選択、Enter で選択中（無ければ先頭）をコピー、⌘Enter で Finder に表示。Esc は入力があれば検索クリア、空ならパネルを閉じる
- `:` 入力で `file` / `clip` のサジェストを表示。Tab / ↑↓ でハイライト移動、Enter / mousedown で**トークン化**（アクセント色のピルとして入力欄左端に吸着、後続キーワードは入力欄に残る）
- フィルターは**バッジ確定時のみ**有効（生入力に `:file` が含まれていても解釈しない誤検知回避）。`file` = ファイルカードのみ / `clip` = クリップボード履歴のみ
- キーワードはファイル名・パス・本文への部分一致（小文字化）
- 空入力での Backspace = トークン解除

### 9.2 選択

- クリック（修飾なし）= 選択ではなく「**コピー & 即時格納**」（§ 4 の `writeClipboard*`）
- ⌘ / Ctrl + クリック = 個別トグル、Shift + クリック = 範囲選択、⌘ / Ctrl + A = 表示中全選択
- 空白部の左ドラッグ = Finder ライクの矩形選択（修飾キー押下で既存選択へ追加）。ウインドウ外でボタンが離された場合も `e.buttons === 0` 検知で終了
- 添字は常に**フィルター適用後の表示リスト** (`visibleItems`) 基準
- キーボード: ↑↓ で行移動（Shift で範囲）、Enter = コピー、⌘Enter = Finder に表示、Space = クイックルック（macOS）、⌫ / Delete = 選択をリストから外す（次の行を自動選択）、⌘P = ピン留め、Esc = 選択解除 → パネルを閉じる、⌘F / `/` = 検索へ。URL のテキストは ⌘⏎ でブラウザで開く
- 右クリック = コンテキストメニュー（コピー / リンクを開く / クイックルック / Finder で表示 / 開く / パスをコピー / ピン留め / リストから外す）
- 元ファイルが移動・削除された行は展開時の `stat-paths` で検知して薄く表示し「見つかりません」を出す。コピーはトーストで拒否し、ドラッグ対象からも外す
- ドラッグアウトでシェルフから消えた後、5 秒間「元に戻す」トーストを出す
- クリック時のフィードバック: 押下で `scale(0.985)`、コピー後は行にチェックマークを 320ms 表示してから格納

### 9.3 ドラッグアウト

- HTML5 ドラッグは `preventDefault` し、Main の `webContents.startDrag` による OS ネイティブドラッグへ置換
- ファイルカード: 未選択カードのドラッグ開始で単独選択に切替（Finder と同挙動）→ 選択中の全ファイルを一括ドラッグ → 開始と同時にフェードアウトしてリストから削除
- クリップボード履歴: ファイル（snippet / PNG）としてドラッグアウトするが**リストには残す**（履歴のため）
- ドラッグアウト中は `draggingOut` フラグでドロップモード（受け入れ UI）への切替を抑止

### 9.4 表示

- デザイントークン（`styles.css` 冒頭）: 地はニュートラルなマテリアル、強調はシステムアクセント 1 色（Chromium の `AccentColor`、非対応環境は `#0a84ff`）。角丸は 6 / 10 / 14px の 3 段、文字は 13px（本文）/ 11px（補助）の 2 段。アイコンは絵文字ではなくインライン SVG グリフ（`GLYPHS`）
- 行: 種別を色ではなく先頭スロット（40px 固定）のグリフ / アイコンで示す。ホバーは薄い塗り、選択はアクセント塗り + 反転文字（Finder のリストと同じ）
- 表示用の純粋関数（`formatFileName` / `sectionLabel` / `urlOfText` / `extractWebUrlFromData` 等）は `lib/format.js` にまとめ、Renderer は `window.BridgeFormat`、テストは `require` で同じ実装を使う。Main 側の純粋関数（`tokensMatch` / `sanitizeSyncFileName` / `syncMetadata` / `compareVersions` 等）は `lib/sync-utils.js`。`npm test` で `node --test` が走る
- ファイル名整形（`formatFileName`）: 視覚幅カウント（全角・英大文字 = 2 / 半角 = 1）で合計 30 を超えるとき、拡張子あり: 「先頭 + `…` + 末尾 6 + 拡張子」の中央省略 / 拡張子なし（フォルダ等）: 末尾 `…`。サロゲートペアはコードポイント単位で分断しない
- メタ行: 「種類 · 時刻 (H:mm)」。種類は macOS では `mdls` の Finder 純正名、他は拡張子から生成。日付はセクション見出し（今日 / 昨日 / M月D日 (曜)）で示す
- 出身デバイス: `fromDevice` が自デバイス名と異なる場合だけ、ノート / デスクトップのグリフ + 名前のニュートラルなピルを 2 段目に出す
- コピー元アプリ: 名前は出さず、テキスト / 画像の行の先頭スロット右下に 16px のアプリアイコンだけを重ねる（名前はツールチップ）。アイコンが取れないときは何も出さない。ファイル行には出さない。取得自体は設定 `showSourceApp`（macOS 既定 on / Windows 既定 off。Windows はコピーのたびに PowerShell を起動する重さがあるため）
- ダウンロード / 保存の進行中は先頭スロットに不定スピナー
- ポップオーバー（サジェスト・ツールチップ・トースト・コンテキストメニュー）はライト / ダーク両対応のトークン色。設定シートは本体と入れ替えて表示する（vibrancy 上では半透明レイヤーの重ね合わせが濁るため）
- スクロールバーは macOS ではネイティブのオーバーレイをそのまま使う（`::-webkit-scrollbar` を触るとコンポジタ駆動のスクロールが効かなくなる）。Windows / Linux のみ細いバーに整える
- macOS 以外と `prefers-reduced-transparency` では不透明の地 (`--panel-fallback`) を敷く。`prefers-reduced-motion` ではトランジションを止める
- フッター: 同期状態ドット（ピアが 1 台以上オンラインで緑）+ 件数 / 「すべて消去」（取り消しトースト付き）/ 設定ボタン
- つまみ (`#handle`) は `#root` の右端に置く（`#root` は右寄せなので、幅 15px に格納したときに見えるのがこの要素になる）。展開中はピルを消す
- **Windows の Fluent スキン** (`body.platform-win32`): Segoe UI Variable、角丸はコントロール 4px / フライアウト 8px、つまみは Windows 11 の選択インジケーターと同じ 3px のアクセントピル、検索欄は下辺だけ線の TextBox（フォーカスで下辺 2px アクセント）、行の選択は薄い塗り + 左端 3px のアクセントバー（文字は反転しない）、ボタンは塗り + 1px 線の Standard Button、通知は左にアクセントの InfoBar、メニューは MenuFlyout（ホバーは塗り）、ぼかしは使わない。Windows 11（ビルド 22000 以降、`isWindows11`）では Acrylic の上に乗るので地を 78% に薄くし、Windows 10 は不透明。キー表記は Enter / Del / Ctrl+、クイックルックは出さない
- 画像ファイルは OS アイコンではなく実物サムネイル（`file://` URL 化は Windows ドライブレター対応済み）
- ツールチップは自作（Electron のフレームレス制約で OS 標準 `title` が機能しないため）。ホバーで全文表示、画面端で位置反転
- ドラッグ進入中は `body.drag-mode` でドロップオーバーレイ（アクセント色の薄い塗り + 枠）表示 + 既存 UI を透過 25% に減光（`pointer-events: none` で OS ドラッグ描画を阻害しない）
- アクセシビリティ: リストは `role="listbox"` / 行は `role="option"` + `aria-selected`、アイコンボタンには `aria-label`

### 9.5 セキュリティ

- `contextIsolation: true` / `nodeIntegration: false`。Renderer から Node API へ直接アクセス不可
- CSP: `default-src 'self'; img-src 'self' data: file:; style-src 'self'`

---

## 10. 定数一覧

| 定数 | 値 | 用途 |
|---|---|---|
| `EDGE_POLL_MS` | 50ms | カーソル監視（右端滞留 / 離脱格納） |
| `EDGE_DWELL_MS` | 250ms | つまみゾーンに滞留してから展開するまでの時間 |
| `SPRING_RESPONSE_S` / `SPRING_DAMPING_RATIO` | 0.32s / 1.0 | 開閉スプリングの応答 / 減衰比 |
| `COPIED_FEEDBACK_MS` | 320ms | コピー後のチェックマーク表示（Renderer） |
| `EXPANDED_EXIT_MARGIN` | 48px | 展開中の離脱判定マージン |
| `EXPAND_GRACE_MS` | 1,000ms | プログラム的展開直後の格納猶予 |
| 格納ディレイ | 220ms | `collapseShelter` のタイマー |
| `CLIPBOARD_POLL_MS` | 500ms | クリップボード監視間隔 |
| `IMAGE_HASH_SAMPLE_BYTES` | 256KB | 画像同一判定でハッシュするサンプル量 |
| `FOLDER_AUTO_EXTRACT_MAX_BYTES` | 1GB | 受信したフォルダ zip を自動展開する上限 |
| `MAX_DOWNLOAD_BYTES` | 2GB | Web ダウンロードの上限 |
| `ADD_CONFIRM_TIMEOUT_MS` | 15s | bridge://add?path= の確認トーストの有効期間 |
| `DISCOVERY_GROUP` / `DISCOVERY_PORT` | 239.255.77.77 / 9096 | マルチキャスト発見 |
| `DISCOVERY_ANNOUNCE_MS` | 30s | 自己紹介の送信間隔 |
| `LOG_MAX_BYTES` | 1MB | `bridge.log` のローテーション閾値 |
| `UPDATE_CHECK_INTERVAL_MS` | 24h | アップデート確認の間隔（パッケージ版のみ） |
| `MAX_TEXT_HISTORY` / `MAX_IMAGE_HISTORY` | 100 / 30 | クリップ履歴上限（Main / Renderer 共通） |
| `MAX_FILE_ITEMS` | 100 | ファイルカード上限（Renderer） |
| `MAX_PENDING_ITEMS` | 200 | Renderer 準備前キューの上限 |
| `DEFAULT_SYNC_PORT` | 9095 | 同期サーバーポート |
| `SYNC_POLL_MS` | 20s | ピア差分ポーリング間隔 |
| `PROBE_TIMEOUT_MS` | 800ms | `/ping` プローブタイムアウト |
| `SYNC_BODY_LIMIT` | 10MB | 同期リクエスト / レスポンス上限 |
| `MAX_SYNC_STORE` | 500 | 同期台帳の保持件数 |
| `MAX_SEEN_SYNC_IDS` | 5,000 | 既読 id の FIFO 上限 |
| スキャン並列度 | 32 | サブネットスキャンの同時プローブ数 |

---

## 11. 既知の制約・非目標

1. **Windows のファイルコピー検知は常駐 PowerShell ヘルパーに依存**: Electron からは `CF_HDROP` を読めないため、`CF_FILENAMEW` で検知したうえで `Get-Clipboard -Format FileDropList` で全件を取る。ヘルパーが応答しない環境では先頭 1 件にフォールバックする
2. **同期チャネルは平文**: トークン認証はあるが暗号化はない。信頼できる LAN 内での利用が前提。インターネット越しの利用は非目標
3. **クイックルック・`mdls` は macOS 専用**: 他 OS は拡張子ベース表示にフォールバック
4. **画像履歴の変化検知は安価な署名に依存**: macOS は `public.tiff` の長さ、Windows は `PNG` の長さかクリップボード連番で判別する。連番の取得は常駐ヘルパー経由（応答が無いときは長さのみになり、同じ構成の画像を取りこぼしうる）
5. **マルチキャストが通らないネットワーク**（ゲスト Wi-Fi の AP 分離など）では自動発見できない。「いま探す」のサブネットスキャン（/24 固定）か `peers` への静的登録が必要
6. `secretToken` の共有は手動運用（設定シートの「同期キー」をコピーして各デバイスに貼り付ける。ペアリングコード方式は非目標）
7. `port` の変更は設定ファイルの直接編集が必要で、再起動後に反映される

