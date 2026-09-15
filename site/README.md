# サイト素材

紹介・配布用のページを2種類、ローカルで作り込むための場所。Artifactに都度アップロードして確認する代わりに、ここで普通にHTML/CSSを編集してブラウザで直接プレビューできる。

```
site/
├── portfolio/   就活ポートフォリオ向け（ダーク、設計判断のログを見せる構成）
│   ├── index.html
│   └── *.png    実機スクリーンショット + アイコン
└── public/      一般ユーザー向けの紹介ページ（ライト、機能・FAQ中心）
    ├── index.html
    └── *.png
```

## プレビュー

`index.html` は普通の完結したHTML文書（`<!DOCTYPE html>` 〜 `</html>`）なので、ブラウザで直接開くか、VSCodeの「Go Live」等どんな方法でプレビューしても問題ない（外部ビルドツール不要、Google Fontsの読み込みだけネット接続が要る）。

```bash
open site/portfolio/index.html
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
