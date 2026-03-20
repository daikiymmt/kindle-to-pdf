# Kindle to PDF

Kindle Cloud Reader のページを自動スクリーンショットして PDF 化する Chrome 拡張機能。

## 機能

- Kindle Cloud Reader の各ページを自動でキャプチャ
- キャプチャした画像を PDF にまとめてダウンロード
- 大量ページ対応（IndexedDB による画像永続化）
- PDF 分割出力（指定ページ数ごとにファイル分割）
- 本の末尾を自動検知して正常終了
- プログレスバーによる進捗表示

## インストール

1. このリポジトリをクローンまたはダウンロード
   ```
   git clone https://github.com/daikiymmt/kindle-to-pdf.git
   ```
2. Chrome で `chrome://extensions` を開く
3. 右上の「デベロッパーモード」を有効にする
4. 「パッケージ化されていない拡張機能を読み込む」をクリック
5. クローンしたフォルダを選択

## 使い方

1. [Kindle Cloud Reader](https://read.amazon.co.jp/) で本を開く
2. キャプチャを開始したいページを表示する
3. 拡張機能アイコンをクリックしてポップアップを開く
4. 設定を入力する
   - **キャプチャ枚数** — 取得するページ数（本の末尾に達した場合は自動で停止）
   - **最大待機時間 (ms)** — ページ読み込みの最大待機時間（デフォルト: 2000ms）
   - **PDF分割単位 (ページ)** — 1ファイルあたりのページ数（デフォルト: 50）
5. 「キャプチャ開始」をクリック
6. 完了後「PDF ダウンロード」をクリック

## 必要な権限

| 権限 | 用途 |
|---|---|
| `activeTab` | 表示中のタブのスクリーンショット取得 |
| `debugger` | ページ送りのキー入力送信・ネットワーク監視 |
| `unlimitedStorage` | 大量のキャプチャ画像を IndexedDB に保存 |

## 技術構成

- **Manifest V3** Chrome Extension
- **IndexedDB** — キャプチャ画像の永続化（Service Worker 終了によるデータ消失を防止）
- **Chrome Debugger Protocol** — ネットワークアイドル検知・キー入力
- **jsPDF** — クライアントサイドでの PDF 生成

## ライセンス

MIT
