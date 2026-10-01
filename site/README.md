# サイト素材

紹介・配布用のページを、ローカルで作り込むための場所。Artifactに都度アップロードして確認する代わりに、ここで普通にHTML/CSSを編集してブラウザで直接プレビューできる。

```
site/
└── public/      公開するサイト一式 (GitHub Pages には、このフォルダだけを公開する)
    ├── index.html, privacy.html, support.html   日本語のページ
    ├── en/      英語版のプライバシーポリシーとサポート
    ├── icons/   アイコン素材（下記「埋め込みデモ」参照）
    └── media/   動画とポスター画像
```

## 埋め込みデモ（実際に動く縮小レプリカ）

ページの「try it」セクションには、本物の `index.html` / `styles.css` / `renderer.js` から検索欄・セグメントコントロール・リスト行（ピン留め・出身デバイスチップ・コピー元アプリバッジ・クリックコピー時のチェックマーク演出まで）の CSS とロジックをそのまま移植したウィジェットが入っている。モックではなく実物のクラス名・DOM構造・挙動を再現したもの。

- OS 依存で再現できない部分（実ファイルアイコンの動的取得・実クリップボード監視・ドラッグアウト）だけ、あらかじめ書き出した静止画とダミー配列に差し替えている。
  - コピー元アプリのアイコン（Notion / Chrome / Slack / Figma / ターミナル）と、ファイル種別の汎用アイコン（PDF/テキスト/CSV）は `site/public/icons/` に実際の `sips` / Electron `app.getFileIcon` で書き出した本物の画像
  - 画像ファイルのサムネイル（`thumb-logo.png` / `thumb-clipboard.png`）も実際のダミーファイルそのもの
- 検索・すべて/ファイル/クリップの切り替え・クリックでのクリップボードコピーは全部本物に動く
- データは `main.js` の `BRIDGE_DEV_SEED` と同じ架空案件の内容を、ページの `<script>` 内 `DATA` 配列にハードコードしている。中身を変えたいときは `DATA` を書き換えること（コピー元アプリ・ファイル種別アイコンを増やす場合は `site/public/icons/` にも追加）

## プレビュー

`index.html` は普通の完結したHTML文書（`<!DOCTYPE html>` 〜 `</html>`）なので、ブラウザで直接開くか、VSCodeの「Go Live」等どんな方法でプレビューしても問題ない（外部ビルドツール不要、Google Fontsの読み込みだけネット接続が要る）。

```bash
open site/public/index.html
```

> 補足: Artifactへpublishする形式は逆に「`<title>`と`<style>`と中身だけ、`<html>`/`<head>`/`<body>`なし」という断片が前提（ツール側が自動でラップする）。なので `<!DOCTYPE>`〜`</html>`のタグは、Artifactに戻すときは無くても動く（ブラウザは二重ラップも許容するので付けたままでも壊れないはず）が、気になる場合は publish 前に外す。

## スクリーンショットの撮り直し方

ダミーの見せかけデータ（`assets/demo/` の見積書・議事録・ロゴ案）は [main.js](../main.js) の `BRIDGE_DEV_SEED` ブロックで差し込んでいる。撮り直すときは:

1. **開発用の履歴を空にする**（過去の実際のクリップボード内容が残っていることがあるため必須）
   ```bash
   pkill -f "bridge/node_modules/electron/dist/Electron.app"
   rm -f ~/Library/Application\ Support/bridge-dev/history.json
   ```
2. `BRIDGE_DEV_SEED=1 npm start` で起動し、`screencapture -R<x>,<y>,320,600 -x <出力先>`（起動ログに出る `BRIDGE_BOUNDS` の座標を使う）で実機ショットを撮る。**`BRIDGE_DEV_SHOT` は使わない**（vibrancy 抜きで撮られてしまい、色がくすんで見える）
3. ライトモードのショットが要るときだけ、`osascript -e 'tell application "System Events" to tell appearance preferences to set dark mode to false'` で一時的に切り替え、撮り終えたら必ず `true` に戻す

見せかけデータの中身自体を変えたいときは `main.js` の `BRIDGE_DEV_SEED` ブロックと `assets/demo/` の中身を編集する。

## 煮詰まったらArtifactへ

このディレクトリの内容がまとまったら、`Artifact` publish でそのまま公開する（`root` にこのディレクトリを指定し、`files` に画像を列挙、`file_path` に `index.html`）。
