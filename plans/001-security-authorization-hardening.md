# Plan 001: Server Action と決済 API の認可・入力検証を強化する

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する — 独自判断で回避しないこと。
> 完了したら `plans/README.md` の該当ステータス行を更新する。
>
> **Drift check (最初に実行)**: 以下の 4 コマンドをすべて Scope 記載パス
> （`utils/actions.ts utils/schemas.ts utils/supabase.ts app/api/payment/route.ts app/api/confirm/route.ts components/reviews/SubmitReview.tsx prisma/schema.prisma prisma/migrations __tests__/security/`）
> に対して実行する:
>
> ```sh
> git diff --stat 90f91f4..HEAD -- utils/actions.ts utils/schemas.ts utils/supabase.ts app/api/payment/route.ts app/api/confirm/route.ts components/reviews/SubmitReview.tsx prisma/schema.prisma prisma/migrations __tests__/security/
> git diff --cached --stat -- utils/actions.ts utils/schemas.ts utils/supabase.ts app/api/payment/route.ts app/api/confirm/route.ts components/reviews/SubmitReview.tsx prisma/schema.prisma prisma/migrations __tests__/security/
> git diff --stat -- utils/actions.ts utils/schemas.ts utils/supabase.ts app/api/payment/route.ts app/api/confirm/route.ts components/reviews/SubmitReview.tsx prisma/schema.prisma prisma/migrations __tests__/security/
> git ls-files --others --exclude-standard -- utils/actions.ts utils/schemas.ts utils/supabase.ts app/api/payment/route.ts app/api/confirm/route.ts components/reviews/SubmitReview.tsx prisma/schema.prisma prisma/migrations __tests__/security/
> ```
>
> 1つ目はベース SHA 以降のコミット済み変更、2つ目はステージ済み未コミット変更、
> 3つ目は未ステージの変更、4つ目は未追跡の対象領域ファイルを検出する。
> `git status` 単独では不十分（コミット済みドリフトを検出できない）。
> いずれかのコマンドが in-scope ファイルの変更を報告した場合は
> 「Current state」の抜粋と実コードを比較し、不一致があれば STOP condition として扱う。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: LOW-MED
- **Depends on**: none
- **Category**: security
- **Planned at**: commit `90f91f4`, 2026-07-05

## Why this matters

このアプリの Server Actions は `utils/actions.ts` に集約されており、Next.js の
Server Action は「そのモジュールを import するどのページからでも POST で起動できる」
ため、ミドルウェアのルート保護だけでは認可の防御にならない。監査で以下が確認された:

1. **商品作成に管理者チェックがない**: 一般認証ユーザーが商品作成（画像アップロード込み）を実行できる。
2. **お気に入り削除の IDOR**: 他ユーザーの Favorite 行を id 指定で削除できる。
3. **レビューのなりすまし**: 表示名・アバター URL がクライアント入力のまま保存され、重複投稿チェックも UI 側のみ。
4. **決済 API の所有権チェック欠如**: 他ユーザーの orderId/cartId で Stripe セッションを作成できる。
5. **エラー詳細の漏洩**: Prisma 等の内部エラーメッセージがそのままクライアントに返る。

## Current state

対象ファイルと現状:

- `utils/actions.ts` — 全 Server Action の集約点（625行）。
  - `utils/actions.ts:16-26` — `getAuthUser()`（未認証→リダイレクト）と `getAdminUser()`（`ADMIN_USER_ID` 環境変数と比較）。
  - `utils/actions.ts:68-98` — `createProductAction` は **`getAuthUser()` のみ**（line 72）。同種の admin 操作 `deleteProductAction:112`, `updateProductAction:138`, `updateProductImageAction:163`, `fetchAdminProducts:101` はすべて `getAdminUser()` を呼んでいる。この 1 箇所だけ規約違反。
  - `utils/actions.ts:203-234` — `toggleFavoriteAction`。削除分岐（211-216）は:

    ```ts
    await db.favorite.delete({ where: { id: favoriteId } });
    ```

    `clerkId` によるスコープなし。対照的に `deleteReviewAction`（325-330）は `where: { id: reviewId, clerkId: user.id }` と正しくスコープしている — これが従うべきパターン。
  - `utils/actions.ts:249-269` — `createReviewAction` は `validatedFields`（`authorName`, `authorImageUrl` を含む）をそのまま `db.review.create` に展開。`findExistingReview`（338-345）はアクション内では呼ばれず、`app/products/[id]/page.tsx` の表示制御にのみ使用。
  - `utils/actions.ts:28-33` — `renderError` は `error.message`（Prisma の内部エラー文字列を含む）をそのまま返す。
- `components/reviews/SubmitReview.tsx:33-42` — `authorName` / `authorImageUrl` を hidden input でクライアントから送信。
- `utils/schemas.ts:33-52` — `reviewSchema` は `authorName`/`authorImageUrl` を「空でない」ことしか検証しない（URL 形式チェックなし）。
- `utils/schemas.ts:54-68` — `validateImageFile` はクライアント申告の MIME（`file.type`）と 1MB 上限のみ検証。
- `utils/supabase.ts:10-20` — `uploadImage` はストレージキーを `${timestamp}-${image.name}` で生成（クライアント由来ファイル名を未サニタイズで使用）。
- `app/api/payment/route.ts:6-35` — POST ハンドラ。`orderId`/`cartId` をリクエストボディから受け取り `findUnique` するだけで、呼び出しユーザーとの所有権照合なし。認証チェック自体もなし（`auth()` を呼んでいない）。
- `app/api/confirm/route.ts:7-39` — GET ハンドラ。Stripe セッションの metadata から orderId/cartId を取得して更新（このルートは Stripe セッション ID を知っている必要があるため優先度は下がるが、payment 側は必須）。
- `prisma/schema.prisma:43-54` — `Review` は `clerkId` と `productId` を保持するが、複合ユニーク制約はない。

リポジトリ規約（CLAUDE.md より）:
- 「admin 操作の Server Action 冒頭で必ず `await getAdminUser()` を呼ぶ」
- `any` 禁止、prevState は `{ message: string }`

## Commands you will need

| Purpose   | Command                | Expected on success |
|-----------|------------------------|---------------------|
| Install   | `bun install`          | exit 0              |
| Typecheck | `bunx tsc --noEmit`    | exit 0, no errors   |
| Tests     | `bun run test`         | 全テストパス（ベースライン: 10 files / 38 tests, ~2s） |
| Lint      | `bun run lint`         | exit 0              |

## Scope

**In scope**（変更してよいファイル）:
- `utils/actions.ts`
- `utils/schemas.ts`
- `utils/supabase.ts`
- `app/api/payment/route.ts`
- `components/reviews/SubmitReview.tsx`
- `prisma/schema.prisma` と、この変更で生成される `prisma/migrations/` 配下のマイグレーション
- `__tests__/security/` 配下（テスト追加）

**Out of scope**（触らない）:
- `app/api/confirm/route.ts` の決済状態遷移ロジック — Plan 003 の担当。ここで直すと衝突する。
- `middleware.ts` — 現状の挙動は正しい。
- Stripe の line_items / 金額計算 — Plan 003 の担当。

## Git workflow

- ブランチ: `advisor/001-security-hardening`（`development` から分岐）
- コミット形式: `<type>(<scope>): <subject>`（例: `fix(actions): createProductAction に管理者チェックを追加`）
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: createProductAction に管理者チェックを追加

`utils/actions.ts:72` の `const user = await getAuthUser();` を
`const user = await getAdminUser();` に変更する。`getAdminUser` は内部で
`getAuthUser` を呼ぶため、`user` の型・後続の `user.id` 利用はそのまま動く。

**Verify**: `bunx tsc --noEmit` → exit 0

### Step 2: toggleFavoriteAction の削除を所有者スコープにする

`utils/actions.ts:211-216` の delete を `deleteReviewAction`（325-330）と同じ
パターンに変更する:

```ts
await db.favorite.delete({
    where: { id: favoriteId, clerkId: user.id },
});
```

**Verify**: `bunx tsc --noEmit` → exit 0

### Step 3: createReviewAction の作者情報をサーバー側で確定し、重複投稿を拒否する

`prisma/schema.prisma` の `Review` に `@@unique([clerkId, productId])` を追加し、
生成された Prisma マイグレーションをコミットする。適用前に既存の Review の
`(clerkId, productId)` 重複を確認し、存在する場合は STOP して解消方針をメンテナーに
確認する。

`utils/actions.ts:249-269` を変更:
1. `db.review.create` の `data` で `...validatedFields` に頼らず、`authorName`/`authorImageUrl` を認証済み `user` から明示的に設定する:

   ```ts
   await db.review.create({
       data: {
           ...validatedFields,
           clerkId: user.id,
           authorName: user.firstName ?? "user",
           authorImageUrl: user.imageUrl,
       },
   });
   ```

2. `findExistingReview` は表示制御のために残してよいが、作成可否の唯一の防御にはしない。`db.review.create` の `P2002`（`clerkId` と `productId` の複合ユニーク制約違反）をアクション内で捕捉し、`{ message: "You have already reviewed this product" }` を返す。ほかのエラーは従来どおり `renderError` に渡す。

`utils/schemas.ts:33-52` の `reviewSchema` から `authorName`/`authorImageUrl` を削除し、
`components/reviews/SubmitReview.tsx:33-42` の該当 hidden input 2 つを削除する。

**Verify**: `bunx prisma validate` と `bunx tsc --noEmit` → exit 0（スキーマ変更により型エラーが出た場合、
`reviewSchema` の利用箇所は `createReviewAction` のみのはず — 他で使われていたら STOP）

### Step 4: payment ルートに認証と所有権チェックを追加

`app/api/payment/route.ts` の POST 冒頭に追加:

```ts
import { auth } from "@clerk/nextjs/server";
// ...
const { userId } = await auth();
if (!userId) {
    return Response.json(null, { status: 401, statusText: "Unauthorized" });
}
```

order/cart 取得後（line 30 の null チェック内 or 直後）に所有権を照合:

```ts
if (order.clerkId !== userId || cart.clerkId !== userId) {
    return Response.json(null, { status: 403, statusText: "Forbidden" });
}
if (order.isPaid) {
    return Response.json(null, { status: 403, statusText: "Forbidden" });
}
```

`order.isPaid` チェックは Stripe セッション作成前（`stripe.checkout.sessions.create` 呼び出しより前）に
行い、支払い済み注文への再チャージセッション発行を防ぐ。これは粗い一次防御であり、
`orderId`/`cartId` の対応関係の厳密な検証（永続化された関連付けの照合）や
チェックアウトの冪等性制御は、`Order` に `cartId` を永続化するスキーマ変更を前提とする
ため plans/003-payment-flow-consistency.md の責務とし、本プランでは扱わない
（plans/003 の「Why this matters」項目 5、Step 2〜4 を参照）。

**Verify**: `bunx tsc --noEmit` → exit 0

Step 7 で追加する決済フロー関連テストに、`isPaid: true` の Order で payment ルートを
呼ぶと 403 が返り、`stripe.checkout.sessions.create` が呼ばれないことを検証する
ケースを追加する。

### Step 5: 画像アップロードのストレージキーをサーバー生成にする

`utils/supabase.ts:10-12` — `newName` を `${timestamp}-${image.name}` から
`crypto.randomUUID()` ベース（例: `${crypto.randomUUID()}`）に変更する。
拡張子は付けない（公開 URL は Content-Type で配信される。拡張子を残したい場合は
`image.name` から `/[^a-zA-Z0-9.]/g` を除去した末尾拡張子のみ許可する）。

`utils/schemas.ts:54-68` — `acceptedFileTypes` を具体的な MIME の許可リストに変更:
`["image/jpeg", "image/png", "image/webp", "image/gif"]`、判定を `includes` に変更する。
`file.type` はクライアントが送る自己申告値であり偽装可能なため、これだけでは不十分。
`validateImageFile`（またはアップロード直前の共有境界）に、ファイル内容そのものを
検証するチェックを追加する: (1) 先頭バイトが許可した画像形式のマジックナンバーと
一致すること、(2) 画像として実際にデコードできること（例: `sharp` や `image-size`
などで寸法取得を試み、失敗したら拒否）。この検証は `uploadImage` を呼ぶすべての
呼び出し元（`utils/actions.ts:84`, `utils/actions.ts:172`）が通る共有スキーマ
（`validateImageFile`）内に実装し、個別の呼び出し元での重複実装を避ける。

`file.arrayBuffer()` の読み取りや `sharp`/`image-size` によるデコードは非同期処理の
ため、この内容チェックは `z.refine` の非同期版（`refine` に async 関数を渡す）で
実装する。`imageSchema`（`utils/schemas.ts:29-30`）が非同期 `refine` を含むことに
なるため、`validateWithZodSchema`（`utils/schemas.ts:70-80`）を汎用のまま同期
（`schema.safeParse`）で使い続けると非同期 refine が正しく評価されない
（zod は同期パースの途中で非同期 refine に遭遇するとエラーを投げる）。
`productSchema`/`reviewSchema` など他スキーマの呼び出し元（`utils/actions.ts:78`,
`142`, `257`）を不要に非同期化しないよう、`imageSchema` 専用の非同期検証経路
（例: `validateWithZodSchemaAsync` を新設し内部で `schema.safeParseAsync` を使う、
または `imageSchema.safeParseAsync` を直接呼ぶ）を用意し、`utils/actions.ts:79`,
`169` の 2 箇所の画像検証呼び出しのみを `await` 付きの非同期呼び出しに変更する。

この非同期経路は次の Step 6 で `ValidationError` 契約に接続する（本 Step ではまだ
接続しない — `ValidationError` クラスが存在しないため）。

**Verify**: `bunx tsc --noEmit` → exit 0

### Step 6: renderError の情報漏洩を抑制する

`utils/actions.ts:28-33` を変更: Zod 検証エラー（`validateWithZodSchema` が投げる
`Error`）は意図したユーザー向けメッセージなので通し、それ以外は汎用メッセージを返す
方針にする。最小実装として、`validateWithZodSchema`（`utils/schemas.ts:70-80`）が
投げる Error をカスタムクラス（例: `ValidationError extends Error`）にし、
`renderError` は `error instanceof ValidationError ? error.message : "there was an error"`
を返す。`console.log(error)` は `console.error(error)` に変更（サーバーログには残す）。

Step 5 で新設した非同期画像検証経路（`validateWithZodSchemaAsync` または
`imageSchema.safeParseAsync` を呼ぶ側）も同じ契約に接続する: `safeParseAsync`
失敗時に `validateWithZodSchema` と同じ `ValidationError`（メッセージを結合した
もの）を throw し、`renderError` が汎用メッセージにフォールバックしないように
する。`utils/actions.ts:79`, `169` の 2 箇所それぞれについて、不正な画像入力で
`{ message }` に具体的な検証メッセージが返ることを検証するテストを追加する。

**Verify**: `bun run test` → 全パス（既存 38 テスト + このプランで追加したテスト）

### Step 7: セキュリティテストを追加

`__tests__/security/authorization.test.ts` を新規作成（既存の
`__tests__/utils/actions-type-safety.test.ts` の構成を参考に、ただし
**ソース文字列の grep ではなく挙動を検証する**）。Prisma / Clerk / Supabase は
`vi.mock` でモックする。最低限のケース:

- createProductAction: 非 admin ユーザー（`currentUser` モックが ADMIN_USER_ID 以外を返す）で
  呼ぶと商品が作成されない。**`db.product.create` のモックが一切呼ばれていないことを
  スパイのアサーション（`expect(db.product.create).not.toHaveBeenCalled()`）で明示的に
  検証する**（戻り値やレコード有無の確認だけでは、認可チェックより前に create が
  呼ばれてから握りつぶされるケースを見逃す）
- toggleFavoriteAction: delete の `where` に `clerkId` が含まれる（モックの呼び出し引数を検証）
- createReviewAction: `P2002` を返す create モックで重複投稿メッセージを返す（単体テスト。
  モックは実際の並行実行を検証しない）
- 並行リクエストの排他性検証（可能なら追加）: マイグレーション済みのテスト用 DB に対し、
  同一 `clerkId`・`productId` で `createReviewAction` を 2 回同時実行し、片方のみ成功
  （もう一方は Step 3 で追加する `@@unique([clerkId, productId])` 制約により `P2002` で
  失敗）することを検証する統合テストを追加する。テスト用 DB の用意（`DIRECT_URL` を
  使った別スキーマ/別 DB でのマイグレーション適用）が本プランのスコープで用意できない
  場合はこの統合テストを省略してよいが、その場合は上記の `P2002` モック単体テストのみで
  「重複投稿を拒否する」ことの検証範囲とし、並行実行時の排他性そのものは未検証である旨を
  Done criteria の該当項目に明記する
- renderError 相当: 非 ValidationError で内部メッセージが返らない
- payment ルート: `isPaid: true` の Order で呼ぶと 403 が返り、`stripe.checkout.sessions.create` が呼ばれない（Step 4 参照）

**Verify**: `bun run test` → 全パス、新規テストが 5 件以上含まれる

## Test plan

- 新規: `__tests__/security/authorization.test.ts`（Step 7 のケース一覧）
- 構成パターン: AAA（Arrange-Act-Assert）。モック方針は `vitest.setup.ts` と
  既存テストに従う。
- 検証: `bun run test` → 全パス（43 テスト以上）

## Done criteria

すべて満たすこと:

- [ ] `bunx tsc --noEmit` が exit 0
- [ ] `bunx prisma validate` が exit 0。`Review` に `@@unique([clerkId, productId])` を含むマイグレーションがある
- [ ] `bun run lint` が exit 0
- [ ] `bun run test` が exit 0、新規セキュリティテスト 5 件以上を含む
- [ ] Step 7 の `createProductAction`（非 admin）テストが `db.product.create` の
  未呼び出しを spy アサーションで検証しており、`bun run test` でパスする
  （ソース全体の grep による呼び出し順序チェックはこの挙動テストで代替済みのため行わない）
- [ ] `grep -n "authorName" components/reviews/SubmitReview.tsx` が 0 件
- [ ] Drift check の 4 コマンド（`git diff --stat 90f91f4..HEAD`、`git diff --cached --stat`、
  `git diff --stat`、`git ls-files --others --exclude-standard`、いずれも同じ in-scope パス指定）
  のいずれにも in-scope 外のファイルが含まれない（`git status` 単独では
  コミット済み・ステージ済みドリフトを見落とすため使わない）
- [ ] `plans/README.md` のステータス行を更新済み

## STOP conditions

以下の場合は停止して報告する:

- 「Current state」の抜粋と実コードが一致しない（プラン作成後にコードが変わった）。
- `reviewSchema` の `authorName`/`authorImageUrl` が `createReviewAction` 以外から参照されている。
- Step 4 で `auth()` の追加により payment ルートの既存テストや checkout フローの
  型が壊れ、2 回の修正試行で解消しない。
- 修正が `app/api/confirm/route.ts` のロジック変更を必要とすると判明した場合
  （Plan 003 とのスコープ衝突 — 統合判断が必要）。

## Maintenance notes

- 今後 Server Action を追加する際は必ず所有権スコープ（`clerkId: user.id`）を
  `where` に含めること。レビュー観点: `db.<model>.delete/update` の `where` に
  id 単独指定がないか。
- Plan 004 で `Favorite(clerkId, productId)` にユニーク制約を追加すると、
  Step 2 の削除は `(clerkId, productId)` 複合キーでの delete に置き換え可能になる。
- 画像の MIME 許可リストを増やす場合は `next.config.mjs` の画像設定との整合を確認。
