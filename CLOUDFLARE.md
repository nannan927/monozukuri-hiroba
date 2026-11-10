# Cloudflare Pages公開設定

- プロジェクト: `monozukuri-hiroba-tomo`
- 公開URL: https://monozukuri-hiroba-tomo.pages.dev/
- production branch: `main`
- 配信ファイル: `dist/`（Pages Functionsの `_worker.js` を含む）
- D1: `monozukuri-hiroba-content` / `3c284235-a1ab-4ea6-8b13-f9234b337ad9`
- 管理画面: https://monozukuri-hiroba-tomo.pages.dev/admin/
- 元ソース: `ed91a5b102e26cecb090bfde7d3a42dfe8cb32ff`

このフォルダーはCloudflare用の独立したコピーです。`tomooooo.com` のDNSと既存のSites版には変更を加えていません。

## 初回公開の確認

2026-11-05に本番公開済み。デプロイID: `c69ba3e9-5926-4e0b-bded-f30395618fb5`。トップ・絵画・音楽・両作品詳細・元コード・RSSのHTTP 200、存在しないページのHTTP 404を確認しました。ブラウザーの自動操作は環境設定で無効のため、公開後の対話操作は未検証です。

## 更新・公開

Node.js 24を使用します。

```sh
nvm use
npm ci
npm run deploy
```

`deploy` は型チェック・Astro/Workerビルド・CMSと連合配信のテストを行い、配信用Workerと既存のPagesプロジェクトに公開します。ActivityPubの初回導入は [FEDERATION.md](FEDERATION.md) の手順が先に必要です。`astro.config.mjs` に正式なPages URLを設定しているため、通常は環境変数の指定は不要です。移転時のみ `SITE_URL` で上書きできます。

認証の期限が切れた場合は、次を実行し、表示された認証URLとコードでログインします。

```sh
npx wrangler@4.157.0 login --device --browser=false --scopes account:read user:read pages:write d1:write workers:write workers_scripts:write workers_kv:write queues:write
```

記事や作品は管理画面から編集します。初回移行後はD1を正として扱います。詳細は [ADMIN.md](ADMIN.md) を参照してください。元のSites版との自動同期はありません。初版は `../monozukuri-hiroba/`、Sites改訂版は `../monozukuri-hiroba-geek/` に保持しています。

## 公開方式

Direct Uploadを使用しています。Cloudflare内蔵のGit連携への切り替えには別プロジェクトが必要です。プロジェクトは作成済みなので、今後は `pages project create` を繰り返さず、`npm run deploy` で更新してください。

## 無料枠

管理機能の追加後は、Pages FunctionsとD1を使用します。有料プランへの変更は行いません。Functionsのリクエスト数・D1の読み書きと保存容量はそれぞれの無料枠の対象です。Pagesの静的ファイルは20,000ファイル、1ファイル25 MiBまで。

- https://developers.cloudflare.com/pages/functions/pricing/
- https://developers.cloudflare.com/d1/platform/pricing/

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/platform/limits/

## 管理機能の公開

2026-11-05にデプロイ `28ae92aa` で管理画面・D1連携を公開しました。既存38件を取り込み済み。管理画面・公開ページのHTTP 200、未認証の管理APIのHTTP 401を確認しています。初回パスワード設定は所有者が一度限りのリンクから行います。

## 分類の更新

2026-11-05にデプロイ `938aeeaf` で「仕事」「映像」「研究」を公開し、管理画面の分野選択を更新しました。D1の `0002_categories.sql` を適用し、「地図上の海」を「文章」へ移動しました。移行前の内容は保存履歴に保持し、旧分類のURLは新分類へ転送します。管理画面から追加された投稿を含め、本番39件は保持しています。

## Glyphsデザインの反映

2026-11-07、承認済みプレビューを公開版へ移植。デプロイ `3753385b`、ソース `db5f5f4`。旧デザインはGitタグ `before-glyphs-design` に保持。PC・スマートフォンの表示とスクロール、CMSテスト8件、公開ページ・検索・作品コード・管理APIの認証を確認。本番39投稿を保持し、D1の更新は行っていません。

## 外部からのフォローと新作配信

2026-11-10にActivityPubを導入しました。アドレスは `@hiroba@monozukuri-hiroba-tomo.pages.dev`、案内は `/follow/`。既存39作品を保持しています。D1の `0003_federation.sql` を適用し、KV・Queue・配信用Workerを追加しました。有料プランへの変更は行っていません。動作と運用手順は [FEDERATION.md](FEDERATION.md) を参照してください。
