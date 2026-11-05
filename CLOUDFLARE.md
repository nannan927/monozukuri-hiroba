# Cloudflare Pages公開設定

- プロジェクト: `monozukuri-hiroba-tomo`
- 公開URL: https://monozukuri-hiroba-tomo.pages.dev/
- production branch: `main`
- 配信ファイル: `dist/`
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

`deploy` は型チェック・静的ビルドを行い、既存のPagesプロジェクトに公開します。`astro.config.mjs` に正式なPages URLを設定しているため、通常は環境変数の指定は不要です。移転時のみ `SITE_URL` で上書きできます。

認証の期限が切れた場合は、次を実行し、表示された認証URLとコードでログインします。

```sh
npx wrangler@4.157.0 login --device --browser=false --scopes account:read user:read pages:write
```

記事や作品は、このフォルダーの `src/content/works/` などを編集します。元のSites版との自動同期はありません。初版は `../monozukuri-hiroba/`、Sites改訂版は `../monozukuri-hiroba-geek/` に保持しています。

## 公開方式

Direct Uploadを使用しています。Cloudflare内蔵のGit連携への切り替えには別プロジェクトが必要です。プロジェクトは作成済みなので、今後は `pages project create` を繰り返さず、`npm run deploy` で更新してください。

## 無料枠

静的ファイルのみを配信します。Functionsや有料ストレージは使用していません。Pages無料枠は20,000ファイル、1ファイル25 MiBまで。音源追加時も1ファイルの上限内に収めてください。

- https://developers.cloudflare.com/pages/get-started/direct-upload/
- https://developers.cloudflare.com/pages/platform/limits/
