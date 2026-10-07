#!/usr/bin/env python3
"""README.ja.md を作る: 新しい冒頭 (ヒーロー・機能クリップ・はじめかた) + 旧 README の技術的な内容 (整理して下へ)。
   旧 README はスナップショット (readme_old_ja.md) から読むので、何度実行しても同じ結果になる。"""
import re, subprocess, os
os.chdir(os.path.join(os.path.dirname(__file__), '..', '..'))
old = open('promo/source/readme_old_ja.md', encoding='utf8').read()   # 書き直し前の README (git の HEAD:README.md のスナップショット)
parts = re.split(r'\n(?=## )', old)
sec = {p.split('\n', 1)[0].lstrip('# ').strip(): p.rstrip() + '\n' for p in parts[1:]}
body = lambda t: sec[t].split('\n', 1)[1].strip('\n')

def sub(s, a, b):
    assert a in s, a[:40]
    return s.replace(a, b)

setup = body('セットアップ')
setup = sub(setup, "macOS 向けビルドは Hardened Runtime と公証 (`notarize: true`) を有効にしています。環境変数 `APPLE_ID` / `APPLE_APP_SPECIFIC_PASSWORD` / `APPLE_TEAM_ID` を設定すると公証まで行います。設定しない場合、署名と公証はスキップされます。",
            "macOS 向けビルドは Hardened Runtime を有効にしています。現在の設定 (`package.json` の `mac.notarize`) では Apple の公証は行いません。")
setup = setup.replace('### ビルド', '#### ビルド')

top = '''<div align="center">

<img src="icon.png" width="112" alt="Bridge">

# Bridge

**1 台でコピーしたものが、すべてのデバイスに。**

Mac と Windows をまたいで、ファイルとクリップボードの履歴を同じ LAN 内で自動同期する。<br>
画面の右端に住む、小さなデスクトップアプリです。

[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Windows-0a84ff)](#動作環境)
[![License](https://img.shields.io/badge/license-MIT-lightgrey)](#ライセンス)

[**ダウンロード**](https://github.com/haruhito767676/bridge/releases) · [English](README.md)

</div>

<br>

https://github.com/user-attachments/assets/4f4bfa27-27af-47ce-b0db-c9b4410e2dde

<p align="center"><sub>デモ動画（46 秒）</sub></p>

---

## Bridge でできること

### コピーが、すべてのデバイスに

<p align="center"><img src="docs/media/clip-sync.webp" width="760" alt="Mac でコピーした文が、iMac と Windows の履歴に届き、クリックして貼り付ける"></p>

Mac でコピーしたテキスト・画像・ファイルが、同じ LAN 内の iMac や Windows PC の履歴に並びます。届いた項目は、クリックしてそのまま貼るだけ。デバイス同士が直接つながるので、クラウドにアップロードする必要はありません。どのデバイスから来たかは、項目のバッジで分かります。

### ⌥⌘V で、履歴からその場で貼る

<p align="center"><img src="docs/media/clip-search.webp" width="760" alt="ポップアップで履歴を検索して、Slack にそのまま貼って送信する"></p>

カーソルのそばに履歴が開きます。キーワードで絞り込み、Enter を押すと、その場に貼り付けます（Windows は **Ctrl+Alt+Shift+V**）。

### ファイルも、そのまま

<p align="center"><img src="docs/media/clip-shelf.webp" width="760" alt="Finder のファイルを右端のつまみにドロップし、あとでメールにドラッグして添付する"></p>

Finder やエクスプローラーからファイルを右端のつまみへドロップすると、棚に並びます。あとで別のアプリへドラッグして取り出せます。フォルダは zip にして送り、受信側で自動的に展開します。

### あなただけに、届く

<p align="center"><img src="docs/media/clip-lock.webp" width="760" alt="パネルが南京錠になり、閉じ、運ばれ、相手の画面で開く"></p>

同期の通信は、同期キーから作った鍵で **AES-256-GCM** により暗号化されます（メタデータとファイル本体の両方）。同期キーそのものは通信に流れません。リクエストには、キーを知っている証明（時刻と使い捨ての乱数を含む HMAC）だけを載せ、再送も拒否します。キーが一致しない相手のリクエストは、すべて拒否します。証明書による相手の認証は行わないため、信頼できる LAN での利用を前提としています。設計と実装は、セキュリティの専門家によるレビューを受けていません。（1.x では、同期キーがリクエストのヘッダーに含まれていました。2.0.0 で修正しており、1.x とは同期できません。）

---

## はじめかた

1. **[Releases](https://github.com/haruhito767676/bridge/releases)** から、macOS（DMG）または Windows（インストーラー）をダウンロードして起動します。画面の右端に、細いつまみが現れます
2. **同期するには**、パネル右下の歯車から設定シートを開きます。いつも使っているデバイスで「追加」を、新しいデバイスで「探す」を押し、2 台に同じ 6 桁の確認コードが出たら、両方で「一致」を押します。同期キーは、そのときに自動で渡されます
3. コピーするだけです。つまみにマウスを重ねるか、**⌥Space**（Windows: **Ctrl+Shift+Space**）を押すと、履歴のパネルが開きます

> 現在のビルドは Apple の公証を受けていません。macOS で初回起動時に警告が出た場合は、「システム設定」→「プライバシーとセキュリティ」を開き、「このまま開く」を選んでください（macOS 14 以前なら、アプリを右クリックして「開く」でも開けます）。

---

## 機能の詳細

<details>
<summary>ファイル棚 / クリップボード履歴 / デバイス間の自動同期 / 検索 / キーボード操作</summary>

'''

out = top + body('主な機能').replace('### ', '#### ') + '''

</details>

## 動作環境

''' + body('動作環境') + '''

## 使い方

''' + body('使い方').replace('### bridge:// URL スキーム', '### bridge:// URL スキーム') + '''

## デバイス間同期の設定

''' + body('デバイス間同期の設定') + '''

## 開発

<details>
<summary>セットアップ / ビルド / 開発用の環境変数</summary>

''' + setup.replace('### ', '### ') + '''

</details>

## プロジェクト構成

''' + body('プロジェクト構成') + '''

## 設計方針

''' + body('設計方針') + '''

## 既知の制約

''' + body('既知の制約') + '''

## ライセンス

''' + body('ライセンス') + '\n'

open('README.ja.md', 'w', encoding='utf8').write(out)
print('README.ja.md', len(out.splitlines()), 'lines')
