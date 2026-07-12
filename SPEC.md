# Bridge 技術仕様書 (SPEC)

本書は Bridge の内部仕様（アーキテクチャ、ウインドウ挙動、データモデル、IPC API、クリップボード監視、一時ファイル管理、同期プロトコル、UI 仕様）を定義する。対象バージョン: 0.1.0。

---

## 1. アーキテクチャ概要

```
┌──────────────────────────── Electron ────────────────────────────┐
│                                                                  │
│  Main プロセス (main.js)                                          │
│  ├─ ウインドウ管理 (右端ドック / スライド展開・格納 / マルチモニター)   │
│  ├─ カーソル監視ポーリング (エッジ出現 / 離脱格納, 100ms)             │
│  ├─ クリップボード監視 (テキスト / 画像 / ファイルコピー, 500ms)      │
│  ├─ 一時ファイル管理 (生成・追跡・自動削除)                          │
│  ├─ bridge:// URL スキームハンドラ                                 │
│  └─ 同期サブシステム                                               │
│     ├─ HTTP サーバー (node:http, 0.0.0.0:9095)                    │
│     ├─ ピア発見 (静的設定 + /24 サブネットスキャン + 受信時自動登録)   │
│     ├─ 即時プッシュ (POST /push) + 差分ポーリング (GET /items)       │
│     └─ 実体ファイルのストリーム転送 (GET /file)                     │
│                    ▲                                             │
│                    │ IPC (ipcMain / ipcRenderer)                  │
│                    ▼                                             │
│  preload.js — contextBridge で window.bridge.* を公開             │
│  (contextIsolation: true / nodeIntegration: false)               │
│                    ▲                                             │
│                    ▼                                             │
│  Renderer プロセス (renderer.js + index.html + styles.css)        │
│  ├─ アイテムリスト (表示の唯一の真実 / 最新順)                       │
│  ├─ スマート検索 (フィルターバッジ + サジェスト)                     │
│  ├─ 選択 (クリック / Shift / ⌘ / 矩形選択 / ⌘A)                    │
│  └─ D&D (受け入れ / OS ネイティブドラッグアウト)                     │
└──────────────────────────────────────────────────────────────────┘
```

- 外部依存パッケージなし。Main は Node 標準モジュール（`http`, `fs`, `crypto`, `os`, `child_process` 等）と Electron API のみ使用する。
- **状態の分担**: 表示リストの真実は Renderer の `items` 配列が持つ。Main は同期台帳 (`syncStore`)・一時ファイル追跡 (`sessionTempFiles`)・クリップボード履歴の Main 側コピー (`clipHistory`) を持つ。

### 1.1 プロセス起動シーケンス

1. シングルインスタンスロック取得（失敗時は何も起動せず `app.quit()`。第 2 インスタンスがウォッチャーや同期サーバーを一瞬でも起動しないようフラグでガード）
2. `bridge://` プロトコルのデフォルトクライアント登録（開発時は `process.execPath` + エントリパス付き）
3. `app.whenReady()` 後: `createWindow()` → `startClipboardWatcher()` → `startEdgeRevealWatcher()` → `startDeviceSync()`
4. Windows/Linux で `bridge://` から直接起動された場合は `process.argv` の URL を処理

---

## 2. ウインドウ仕様

### 2.1 形状・配置

| 定数 | 値 | 意味 |
|---|---|---|
| `SHELTER_WIDTH` | 320px | 展開時の幅 |
| `TAB_WIDTH` | 15px | 格納時に画面端へ残す「つまみ」の幅 |
| `SHELTER_HEIGHT` | 600px | 高さ（ディスプレイ作業領域より大きい場合は縮小） |

- `BrowserWindow` オプション: `frame: false` / `resizable: false` / `alwaysOnTop: true` / `fullscreenable: false` / `vibrancy: 'under-window'`（macOS すりガラス）/ 背景透過
- `setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })` により仮想デスクトップ・フルスクリーンアプリ上でも追従
- 配置は常に「**マウスカーソルがあるディスプレイ**の `workArea` 右端・垂直中央」。表示前に必ず `setBounds` で座標を確定し、OS の自動復元によるモニター跨ぎを防ぐ

### 2.2 展開・格納の状態遷移

```
[格納 (つまみ 15px)] ──(a)(b)(c)──▶ [展開 (320px)] ──(d)(e)──▶ [格納]
```

**展開トリガー**
- (a) Main のカーソルポーリング（100ms 間隔）が「任意のディスプレイの右端つまみゾーン」への**進入エッジ**を検知（居続けでは再展開しない）
- (b) Renderer の `mouseenter` / `dragenter` → IPC `shelter-expand`
- (c) `bridge://` 受信・`second-instance` などプログラム的表示

展開時はカーソルのあるディスプレイをその都度再判定し、別ディスプレイにいた場合はアニメーションなしで隠れ位置へワープしてから展開する。最前面レベルは `floating`（`screen-saver` にすると OS のドラッグ中アイコン描画より手前に出てしまうため）。展開のたびに Renderer へ `shelter-expanded` を通知し、検索状態の完全リセット + 検索バーへの自動フォーカスを行わせる。

**格納トリガー**
- (d) Renderer の `mouseleave` / ウインドウ外への `dragleave` → IPC `shelter-collapse`（220ms のディレイ付き。ディレイ中の再展開でキャンセル）
- (e) 即時格納 `collapseShelterNow()`: 履歴クリック（コピー完了 → 即ペーストへ移行させる）、および Main ポーリングによる強制格納（カーソルがウインドウ領域 + マージン 48px から完全離脱。Windows でのマウス高速移動による `mouseleave` 取りこぼし対策）。ただし展開直後 1 秒間（`EXPAND_GRACE_MS`）はプログラム的展開を誤って閉じないための猶予がある

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

- `kind: 'file'`（ゴールド系カード）= ユーザーが明示的に置いた一時保存ファイル。`clip-*`（グリーン系カード）= コピー監視の自動ログ
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

### Main → Renderer

| API | チャンネル | 内容 |
|---|---|---|
| `onAddFile(cb)` | `add-file` | ファイル追加。payload: `{ path, name, fromDevice, fromPlatform }`（旧形式のパス文字列にも Renderer 側で後方互換対応） |
| `onClipboardItem(cb)` | `clipboard-item` | クリップボード履歴。`{ type: 'clipboard-text'|'clipboard-image', text, path, timestamp, fromDevice, fromPlatform }` |
| `onShelterExpanded(cb)` | `shelter-expanded` | 展開通知（検索リセット + 自動フォーカス） |

---

## 5. アイテムの入力経路

| 経路 | 処理 |
|---|---|
| ローカルファイルの D&D | `webUtils.getPathForFile` でパス取得 → `addLocalFile` |
| Web 画像 / リンクの D&D | `text/html` の `<img src>` → `text/uri-list` → `text/plain` の順に http(s) URL を抽出 → Main でダウンロード（プレースホルダ表示 → 完了で差し替え、失敗は 1.5 秒後に自動消滅） |
| 選択テキストの D&D | URL でなければ `snippet_<ts>.txt` 化して追加 |
| `bridge://add?path=` | そのままファイル追加（ウインドウを show / focus / 展開して通知） |
| `bridge://add?text=` | http(s) ならダウンロード、それ以外は `.txt` 化 |
| クリップボード監視 | § 6 参照（ウインドウを奪わない `addFileQuietly` / `sendClipboardItem`） |
| 他拠点からの同期 | § 7 参照（同上） |

ファイル名の衝突は `reserveDest` により `name-1.ext`, `name-2.ext`… と連番回避する。

---

## 6. クリップボード監視

- ポーリング間隔 500ms。再入防止フラグ付き（画像保存中に次 tick が重ならない）
- 起動時の内容は履歴に入れず基準値としてのみ記録
- 自己書き戻し（履歴クリックによる再コピー）は、書き戻し時に基準値 (`lastClipText` / `lastClipImageKey` / `lastClipFileKey`) を更新して検知をスルー

**1 tick の判定順序**:

1. **ファイルコピー検知**（最優先）。検知したらその tick のテキスト / 画像判定はスキップ（ファイルコピーに付随するパス文字列テキストを偽履歴にしない）
   - macOS: `NSFilenamesPboardType`（XML plist、複数対応）→ フォールバック `public.file-url`（単一）
   - Windows: `FileNameW`（CF_FILENAMEW、**仕様上 1 件のみ**）→ `Chromium Web Custom MIME Data` → `text/uri-list` → プレーンテキスト中の `file://` / `C:\...` パス抽出。最後に `fs.existsSync` で実在確認して誤検知を排除
   - 検知したファイルは `addFileQuietly` でシェルフへ追加（ウインドウは奪わない）
2. **テキスト**: 前回と異なる非空テキストなら履歴化。生テキストを保持しつつ、裏で `snippet_<ts>.txt` も生成（ドラッグアウト用の「二刀流」。生成失敗時は生テキストのみで続行）。同期台帳へ登録 → ピアへ即時プッシュ
3. **画像**: `availableFormats()` に `image/*` がある場合のみデコード。同一判定キーは「サイズ + ピクセル bitmap の MD5」。新規なら `clipboard_<ts>.png` として即ファイル化 → 履歴化・同期登録

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
| `GET /ping` | 自己紹介。`{ app: "bridge", device, platform, port }`。ピア発見のプローブ（タイムアウト 800ms） |
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
2. **サブネットスキャン**: 全 IPv4 インターフェースの /24 範囲（`x.y.z.1`〜`254`）へ `GET /ping`。並列度 32、起動時 + 5 分間隔。`autoScan: false` で無効化
3. **受信時自動登録**: `POST /push` してきた相手の `remoteAddress` + 申告ポートを登録

自分自身（ローカルアドレス + 同一ポート）は除外。発見した瞬間に一度差分ポーリングを走らせる（再接続直後の取り込みを最速化）。

### 7.4 伝播モデル

- **即時プッシュ**: ローカルでアイテムが生まれた瞬間、オンラインの全ピアへ `POST /push`。失敗したピアは `online: false` へ降格（以後は差分ポーリングで回復）
- **差分ポーリング**: 20 秒間隔で各ピアへ `GET /items?since=<lastSyncedTs>`。`lastSyncedTs` は「**ピア側の時計で付いたタイムスタンプ**」の最大値を採用するため、デバイス間の時計ズレで取りこぼしは起きない
- **中継 (メッシュ)**: 受信したエントリはローカル台帳へ載せた上で自分のピアへも再プッシュ。`id` の既読管理 (`seenSyncIds`、FIFO 上限 5,000) で循環と重複を防止。任意の 2 台が到達可能なら全体が収束する
- **再試行**: ファイル転送失敗時は `seenSyncIds` に入れず `lastSyncedTs` も進めない → 次回ポーリングで同じ地点から自動再取得
- 自分発 (`fromDevice` 一致)・既読 `id` は取り込みスキップ。未知の `type` は黙って読み飛ばす（前方互換）

### 7.5 受信時の取り込み

| type | 処理 |
|---|---|
| `text` | snippet を裏生成（失敗しても本文のみで取り込み）→ Renderer へ `clipboard-item` |
| `image` | `/file` からダウンロード → `clipboard-item`（画像履歴として表示） |
| `file` | `/file` からダウンロード → `add-file`（ファイルカードとして表示、ウインドウは奪わない） |

受信ファイル名は Windows 禁止文字を `_` に置換してサニタイズ。ダウンロード途中のエラーは両ストリームを閉じ欠損ファイルを削除してから reject。受信実体は `sessionTempFiles` へ追跡登録される。

### 7.6 フォルダの扱い

- フォルダはストリーム配信できないため、同期登録時にバックグラウンドで **`フォルダ名.zip` へ自動圧縮**してから台帳登録する（ローカルのカードはフォルダのまま、相手には zip が届く。自動展開はしない）
  - Windows: `Compress-Archive` / macOS: `ditto -c -k --sequesterRsrc --keepParent` / その他: `zip -r`
  - zip 化失敗時は登録を取り消し、再ドロップで再挑戦可能にする
- `registerLocalSyncEntry` と `/file` 配信の双方にフォルダ除外ガードがある（多重防御）

---

## 8. 一時ファイル管理（ディスク保護）

**保存場所**: `<userData>/downloads/`

| 生成物 | 命名 | 追跡 |
|---|---|---|
| Web ダウンロード | 元ファイル名（衝突時は連番） | 追跡しない（ユーザー資産扱い） |
| ドロップ / コピーされたテキスト | `text-<ts>.txt` / `snippet_<ts>.txt` | snippet のみ追跡 |
| コピー画像 | `clipboard_<ts>.png` | 追跡 |
| 同期受信ファイル | 元名をサニタイズ | 追跡 |
| フォルダの自動 zip | `<フォルダ名>.zip` | 追跡 |

**削除の 3 原則**:

1. **履歴あふれ時**: Renderer がリストから外したパスを `delete-temp-file` で依頼 → Main は `sessionTempFiles` に含まれる場合のみ `unlinkSync`。同期台帳の該当エントリは `path: null` 化（ピアには `hasFile: false` で通知され、404 の永久再試行を防ぐ）
2. **終了時 (`will-quit`)**: 追跡中のうち `retainedPaths`（Renderer が最後に報告したリスト保持分）に**含まれない残骸のみ**同期 API で削除
3. **ユーザーがドロップした実ファイルは追跡対象に入らないため、いかなる経路でも削除されない**

---

## 9. UI 仕様（Renderer）

### 9.1 スマート検索

- 展開のたびに状態を完全リセットし検索バーへ自動フォーカス
- `:` 入力で `file` / `clip` のサジェストを表示。Tab / ↑↓ でハイライト移動、Enter / mousedown で**バッジ化**（入力欄左端に吸着、後続キーワードは入力欄に残る）
- フィルターは**バッジ確定時のみ**有効（生入力に `:file` が含まれていても解釈しない誤検知回避）。`file` = ファイルカードのみ / `clip` = クリップボード履歴のみ
- キーワードはファイル名・パス・本文への部分一致（小文字化）
- 空入力での Backspace = バッジ解除、Esc = 全リセット + blur

### 9.2 選択

- クリック（修飾なし）= 選択ではなく「**コピー & 即時格納**」（§ 4 の `writeClipboard*`）
- ⌘ / Ctrl + クリック = 個別トグル、Shift + クリック = 範囲選択、⌘ / Ctrl + A = 表示中全選択
- 空白部の左ドラッグ = Finder ライクの矩形選択（修飾キー押下で既存選択へ追加）。ウインドウ外でボタンが離された場合も `e.buttons === 0` 検知で終了
- 添字は常に**フィルター適用後の表示リスト** (`visibleItems`) 基準
- Space = 先頭選択アイテムをクイックルック（macOS）

### 9.3 ドラッグアウト

- HTML5 ドラッグは `preventDefault` し、Main の `webContents.startDrag` による OS ネイティブドラッグへ置換
- ファイルカード: 未選択カードのドラッグ開始で単独選択に切替（Finder と同挙動）→ 選択中の全ファイルを一括ドラッグ → 開始と同時にフェードアウトしてリストから削除
- クリップボード履歴: ファイル（snippet / PNG）としてドラッグアウトするが**リストには残す**（履歴のため）
- ドラッグアウト中は `draggingOut` フラグでドロップモード（受け入れ UI）への切替を抑止

### 9.4 表示

- ファイル名整形（`formatFileName`）: 視覚幅カウント（全角・英大文字 = 2 / 半角 = 1）で、拡張子あり: 本体 14 超過時に「先頭 8 + `⋯` + 末尾 4 + 拡張子」の中央省略 / 拡張子なし（フォルダ等): 28 超過時に末尾 `...`。サロゲートペアはコードポイント単位で分断しない
- カード配色: `user-dropped`（ゴールド）/ `clipboard-history`（グリーン）/ 選択中はブルーを `!important` で強制
- メタ行: 「種類 · 時刻 (H:mm)」。種類は macOS では `mdls` の Finder 純正名、他は拡張子から生成
- 出身デバイスバッジ: `fromDevice` が自デバイス名と異なる場合のみ表示。`win32` = 青系 / `darwin` = シルバー系
- 画像ファイルは OS アイコンではなく実物サムネイル（`file://` URL 化は Windows ドライブレター対応済み）
- ツールチップは自作（Electron のフレームレス制約で OS 標準 `title` が機能しないため）。ホバーで全文表示、画面端で位置反転
- ドラッグ進入中は `body.drag-mode` でドロップオーバーレイ表示 + 既存 UI を透過 30% に減光（`pointer-events: none` で OS ドラッグ描画を阻害しない）

### 9.5 セキュリティ

- `contextIsolation: true` / `nodeIntegration: false`。Renderer から Node API へ直接アクセス不可
- CSP: `default-src 'self'; img-src 'self' data: file:; style-src 'self'`

---

## 10. 定数一覧

| 定数 | 値 | 用途 |
|---|---|---|
| `EDGE_POLL_MS` | 100ms | カーソル監視（エッジ出現 / 離脱格納） |
| `EXPANDED_EXIT_MARGIN` | 48px | 展開中の離脱判定マージン |
| `EXPAND_GRACE_MS` | 1,000ms | プログラム的展開直後の格納猶予 |
| 格納ディレイ | 220ms | `collapseShelter` のタイマー |
| `CLIPBOARD_POLL_MS` | 500ms | クリップボード監視間隔 |
| `MAX_TEXT_HISTORY` / `MAX_IMAGE_HISTORY` | 100 / 30 | クリップ履歴上限（Main / Renderer 共通） |
| `MAX_FILE_ITEMS` | 100 | ファイルカード上限（Renderer） |
| `MAX_PENDING_ITEMS` | 200 | Renderer 準備前キューの上限 |
| `DEFAULT_SYNC_PORT` | 9095 | 同期サーバーポート |
| `SYNC_POLL_MS` | 20s | ピア差分ポーリング間隔 |
| `SUBNET_SCAN_MS` | 5min | サブネット再スキャン間隔 |
| `PROBE_TIMEOUT_MS` | 800ms | `/ping` プローブタイムアウト |
| `SYNC_BODY_LIMIT` | 10MB | 同期リクエスト / レスポンス上限 |
| `MAX_SYNC_STORE` | 500 | 同期台帳の保持件数 |
| `MAX_SEEN_SYNC_IDS` | 5,000 | 既読 id の FIFO 上限 |
| スキャン並列度 | 32 | サブネットスキャンの同時プローブ数 |

---

## 11. 既知の制約・非目標

1. **Windows の複数ファイルコピー検知は先頭 1 件のみ**: エクスプローラーの Ctrl+C は実体パスを `CF_FILENAMEW`（1 件のみ保持）にしか載せず、Electron から `CF_HDROP` を読む手段がないため（実機検証済み。`text/uri-list` 等は列挙されるが読むと空になる）
2. **同期は平文 HTTP**: トークン認証はあるが暗号化はない。信頼できる LAN 内での利用が前提。インターネット越し同期は非目標
3. **クイックルック・`mdls` は macOS 専用**: 他 OS は拡張子ベース表示にフォールバック
4. **履歴は永続化されない**: リスト・履歴はメモリ上のみで、再起動で消える（裏生成ファイルは終了時に掃除される）。永続化は現時点で非目標
5. **サブネットスキャンは /24 固定**: それより広いネットワークのピアは `peers` への静的登録が必要
6. `secretToken` の共有は手動運用（設定ファイルの値を各デバイスで揃える）
