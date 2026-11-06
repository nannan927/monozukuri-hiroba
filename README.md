# ものづくり広場 — Cloudflare公開用

Cloudflare Pages向けの独立したコピーです。`tomooooo.com` のDNSは変更しません。公開手順は [CLOUDFLARE.md](CLOUDFLARE.md) を参照してください。

文章・仕事・絵画・音楽・映像・研究・開発をまとめる、AstroとCloudflare D1による個人サイトです。青紫の文字、レトロPCのイラスト、サイドバーと点線区切りの記事一覧を使っています。

## 投稿・編集

[管理画面](https://monozukuri-hiroba-tomo.pages.dev/admin/) から、投稿・編集・下書き保存・公開・ごみ箱への移動ができます。使い方とデータの保存先は [ADMIN.md](ADMIN.md) を参照してください。

本番の投稿はCloudflare D1に保存します。下記のMarkdownファイルは初回移行元・開発用です。管理画面からの編集がMarkdownに自動で戻ることはありません。

## 起動

Node.js 24以上を使います（`.nvmrc`あり）。

```sh
nvm use
npm ci
npm run dev
```

Astroだけのプレビューは http://localhost:4321/ です。管理APIと現在の投稿表示には、D1をバインドしたWranglerの実行環境が必要です。

```sh
npm run check
npm run build
npm run preview
```

ビルド結果は `dist/`。静的アセットとPages Workerを含み、公開ページ・管理APIにはCloudflare D1のバインドが必要です。ドメインを変更したときは `astro.config.mjs` の `site` も更新してください。

## 開発用の作品データ

`src/content/works/` にMarkdownファイルを追加します。ファイル名がURLになります。例：`my-first-work.md` → `/works/my-first-work/`。

```yaml
---
title: "作品の名前"
description: "一覧に表示する短い紹介文。"
category: writing
date: 2026-11-05
tags: [日々のこと]
sample: false
draft: false
---

ここに本文を書きます。
```

- `category`: `writing`（文章）、`work`（仕事）、`art`（絵画）、`music`（音楽）、`video`（映像）、`research`（研究）、`development`（開発）。
- `cover`: 絵や写真のパス。例 `/images/my-art.jpg`。画像は `public/images/` へ。
- `coverAlt`: 画像の内容を説明する日本語。画像を入れる場合に設定してください。
- `audio`: 音源のパス。例 `/audio/my-song.mp3`。音源は `public/audio/` へ。
- `duration`: 表示用の再生時間。例 `"3:24"`。
- `sample: true`: 見本表示を付けます。実際の作品は `false` に。
- `draft: true`: ビルド時に一覧・詳細・検索・RSSから除外します。

Markdownの変更は開発用プレビューと初期投入用データに反映されます。本番の投稿は管理画面で更新してください。通常の再ビルド・デプロイはD1の投稿を上書きしません。

## 動く絵画「秋の余白」

`/works/autumn-dusk/` には、提供されたProcessing作品をCanvasに移植したブラウザー版を掲載しています。再生ボタンで開始し、停止・速度変更・構図変更・PNG保存ができます。音声はありません。Java版とは描画方式が異なるため、細部に差があります。

- 元ファイル（変更なし）：`public/artworks/autumn-dusk/AutumnDusk.pde`
- 描画：`src/lib/autumn-dusk.ts`、操作：`src/components/AutumnDusk.astro`
- 紹介文・掲載日：`src/content/works/autumn-dusk.md`
- プレビュー画像を再生成：`npm run render:autumn`
- 描画の再現性・時間変化・元ファイルの保持を検証：`npm run test:autumn`

プレビュー生成だけに開発依存の `@napi-rs/canvas` を使用します。ブラウザー版は標準のCanvas APIで動作します。

## Sonic Pi作品「午後の余白」

`/works/afternoon-space/` にコードのコピー・ダウンロードと曲の構成を掲載しています。提供されたコードは `public/music/afternoon-space/afternoon-space.rb` に保存し、表示・コピーも同じファイルから生成します。紹介文は `src/content/works/afternoon-space.md`、表示は `src/components/AfternoonSpace.astro` です。

現在はコードの展示のみです。録音音源を追加する場合は、作品の `audio` にそのファイルのパスを指定してください。Sonic Piでの実行・試聴はこの環境では未検証です。

## 編集場所

- トップページ：`src/pages/index.astro`
- 自己紹介：`src/pages/about.astro`
- 近況：`src/pages/now.astro`
- 青い文字などの色：`src/styles/global.css` 冒頭のCSS変数
- 共通ヘッダー・フッター：`src/layouts/Layout.astro`
- 分野名・説明：`src/lib/content.ts`

## 含まれる機能

カテゴリ別一覧、作品詳細、種類による絞り込み、日本語全文検索、ネイティブ音声プレイヤー、昼夜の配色切り替え、RSS、404ページ、レスポンシブ表示。配色の選択のみブラウザーのlocalStorageに保存します。アクセス解析や外部フォントへの通信はありません。

## 移行済みの内容

現在は tomooooo.com の記事36件を掲載しています。旧サイトのタイトル・日付・本文・分類を保持し、初期見本は `archive/sample-works/` に退避しました。

仕事・映像・研究・開発・創作・文学のページもあります。外部サービスへのリンクは `src/data/external-links.ts` で管理します。移行の範囲と検証方法は [移行記録](migration/README.md)、各記事の対応表は `migration/tomooooo.json` を参照してください。

新しい記事には `source` などの移行用情報は不要です。既存記事の `source` は元URL、`sourceCategory` は元の分類、`sourceOrder` は同日の並び順を示します。

PC・カセットなどのSVGはこのサイト向けのオリジナル素材です。見出しのZen Maru Gothicは自己ホストし、SIL Open Font Licenseに基づいて利用しています。

## ホスティング

Cloudflare Pagesの無料サブドメインで公開します。公開URLは https://monozukuri-hiroba-tomo.pages.dev/ です。設定済みなので `npm run deploy` で更新できます。公開URLを変更するときだけ `SITE_URL` で上書きします。

元の改訂版は `../monozukuri-hiroba-geek/`、初版は `../monozukuri-hiroba/` に保持しています。このコピーにはSitesのプロジェクトIDを含めていません。

## GitHubで管理する範囲

サイトのソースコード、画像などの公開素材、依存関係、DBスキーマ・移行処理を管理します。管理画面のパスワード、認証トークン、初期設定リンク、ローカルDB、生成物は含めません。本番の投稿と保存履歴はD1にあるため、GitHubのコード保存とは別に管理画面から書き出してください。
