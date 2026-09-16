# Plan 004: DB 整合性制約の追加とホットパスの性能改善

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: `git diff --stat 90f91f4..HEAD -- prisma/schema.prisma utils/actions.ts components/products/ app/cart/page.tsx`
> Plan 001/003 による `utils/actions.ts` の変更（認可チェック、丸め処理）は
> 想定内のドリフト。それ以外は「Current state」と比較し、不一致は STOP。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: MED（スキーママイグレーションを含む）
- **Depends on**: plans/002-money-path-test-baseline.md（カート計算テストが回帰ゲート）。plans/003 と同一ファイルを触るため 003 の後に実行すること。
- **Category**: tech-debt / perf
- **Planned at**: commit `90f91f4`, 2026-07-05

## Why this matters

1. **重複行が作成可能**: `Favorite` と `CartItem` に複合ユニーク制約がなく、
   カート追加もお気に入りトグルも「find してから create/update」の
   check-then-act パターンのため、ダブルクリックや同時リクエストで重複行が
   でき、カート合計が実態と乖離する。
2. **N+1 クエリ**: 商品一覧は商品カードごとに `auth()` + favorite 検索クエリを
   発行する（30 商品なら 30 クエリ）。
3. **読み取りで書き込みが走る**: `/cart` ページは表示のたびに合計を再計算して
   DB に書き込む。
4. **インデックス欠如**: `clerkId` / `productId` での検索が全テーブルスキャンに
   なる（データ量増加で顕在化）。

## Current state

- `prisma/schema.prisma:34-68` — `Favorite` と `Cart` に `@@unique` なし。Cart は
  user ごとに 1 件であるべきだが `clerkId` が重複可能。
  `prisma/schema.prisma:70-79` — `CartItem`: `@@unique` なし。
  スキーマ全体に `@@index` が 1 つもない。
- `utils/actions.ts:414-447` — `updateOrCreateCartItem`: `findFirst` →
  `update`/`create`（非アトミック）。
- `utils/actions.ts:387-412` — `fetchOrCreateCart`: `findFirst` 後に `create` する
  check-then-act のため、並行リクエストで同一 `clerkId` の Cart を複数作成できる。
- `utils/actions.ts:490-504` — `addToCartAction`: fetchProduct →
  fetchOrCreateCart → updateOrCreateCartItem → updateCart の 4 連続書き込みで
  `$transaction` なし。
- `utils/actions.ts:203-234` — `toggleFavoriteAction`: favoriteId の有無での
  check-then-act（Plan 001 で delete に clerkId スコープが追加済みの想定）。
- `components/products/FavoriteToggleButton.tsx:8-14` — カードごとに
  `await auth()` + `fetchFavoriteId({ productId })`（= 1 商品 1 クエリ）。
  呼び出し元: `components/products/ProductsGrid.tsx:43`,
  `components/products/ProductsList.tsx:45`。
- `components/products/ProductsGrid.tsx:28` / `ProductsList.tsx:26` —
  ループ内の全 `next/image` に `priority` 指定（遅延読み込みが全滅）。
- `app/cart/page.tsx:11-12` — レンダー中に `updateCart(previousCart)` を呼び
  DB 書き込み。
- マイグレーションコマンド（CLAUDE.md）: `bunx prisma migrate dev`。
  DB は Supabase PostgreSQL（`DATABASE_URL` / `DIRECT_URL` 環境変数）。

## Commands you will need

| Purpose   | Command                    | Expected on success |
|-----------|----------------------------|---------------------|
| Install   | `bun install`              | exit 0              |
| Migration | `bunx prisma migrate dev --name <name>` | マイグレーション適用、exit 0 |
| Prisma 検証 | `bunx prisma validate`   | schema valid        |
| Tests     | `bun run test`             | 全パス              |
| Typecheck | `bunx tsc --noEmit`        | exit 0              |

## Scope

**In scope**:
- `prisma/schema.prisma`（制約・インデックス追加のみ。カラム型変更禁止）
- `utils/actions.ts`（`updateOrCreateCartItem`, `addToCartAction`, `toggleFavoriteAction`, `fetchFavoriteId` 周辺）
- `components/products/FavoriteToggleButton.tsx`, `ProductsGrid.tsx`, `ProductsList.tsx`, `ProductsContainer.tsx`
- `app/cart/page.tsx`
- `__tests__/` 配下（回帰テスト更新・追加)

**Out of scope**:
- ページネーション（`fetchAllProducts` 等への take/skip 追加）— 価値はあるが
  UI 変更を伴うため deferred（plans/README.md 参照）。
- Suspense ストリーミング（商品詳細ページ）— 同上。
- `app/api/**` — Plan 003 の領域。
- `utils/actions.ts` のファイル分割（DEBT-02）— deferred。

## Git workflow

- ブランチ: `advisor/004-data-integrity-perf`
- コミット形式: `fix(db): ...` / `perf(products): ...` 等、変更単位でコミット
- **マイグレーションファイル（`prisma/migrations/`）は生成されたものをそのままコミット**する。
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: スキーマに制約とインデックスを追加

`prisma/schema.prisma` に追加:

- `Favorite`: `@@unique([clerkId, productId])`
- `CartItem`: `@@unique([cartId, productId])`, `@@index([productId])`
- `Cart`: `@@unique([clerkId])`
- `Review`: `@@index([productId])`, `@@index([clerkId])`
- `Order`: `@@index([clerkId, isPaid])`

**Verify**: `bunx prisma validate` → schema valid

### Step 2: マイグレーション適用前の重複データ確認

ユニーク制約はテーブルに重複行があると適用に失敗する。適用前に確認:

```
bunx prisma db execute --stdin <<'SQL'
SELECT "clerkId", "productId", COUNT(*) FROM "Favorite" GROUP BY 1,2 HAVING COUNT(*) > 1;
SQL
```

同様に `CartItem` の `(cartId, productId)` と Cart の `clerkId` も確認。**重複が存在した場合は STOP**
（重複解消の方針 — 最新行を残す等 — はオペレーターの判断が必要）。

**Verify**: 各クエリとも 0 行

### Step 3: マイグレーション実行

`bunx prisma migrate dev --name add-unique-constraints-and-indexes`

**Verify**: exit 0、`prisma/migrations/` に新規ディレクトリが生成される

### Step 4: check-then-act を upsert に置換

- `fetchOrCreateCart` を `db.cart.upsert({ where: { clerkId: userId }, create: { clerkId: userId }, update: {}, include: includeProductClause })` に置き換える。Step 1 の `@@unique([clerkId])` とこの upsert を、同一ユーザーの Cart 作成を並行リクエストでも 1 件に保つ一次対策として使う。`addToCartAction` のトランザクション化だけに依存しない。
- `utils/actions.ts` の `updateOrCreateCartItem`（414-447）を
  `db.cartItem.upsert` に書き換える（Step 1 の `@@unique([cartId, productId])` により
  `cartId_productId` 複合キーが where に使える）。同時に、`updateOrCreateCartItem` が
  `addToCartAction` のトランザクション外で呼ばれても動作するよう、オプショナルな
  トランザクションクライアント引数 `client` を追加しデフォルト値を `db` とする:

  ```ts
  async function updateOrCreateCartItem(
    cartId: string,
    productId: string,
    amount: number,
    client: Prisma.TransactionClient | typeof db = db,
  ) {
    await client.cartItem.upsert({
        where: { cartId_productId: { cartId, productId } },
        update: { amount: { increment: amount } },
        create: { cartId, productId, amount },
    });
  }
  ```

  既存の呼び出し元（`addToCartAction` 以外）は引数なしで呼べるため後方互換が維持される。

- `toggleFavoriteAction` の create 分岐は、重複時に P2002 エラーとなるため
  try-catch で「既に追加済み」として扱うか、`upsert` に変更する。
- `addToCartAction`（490-504）の `updateOrCreateCartItem` + `updateCart` を
  `db.$transaction(async (tx) => { ... }, { isolationLevel: "Serializable" })`
  で包む。Serializable 分離レベルを指定することで、異なる商品を同時追加した場合の
  競合による `numItemsInCart` / `cartTotal` / `orderTotal` の不整合を防ぐ。
  トランザクション内では `updateOrCreateCartItem` と `updateCart` の**両方**に
  `tx` を渡し、すべての書き込みが同一トランザクションのスコープ内で実行されるようにする:

  ```ts
  await db.$transaction(async (tx) => {
    await updateOrCreateCartItem(cartId, productId, amount, tx);
    await updateCart(cartId, tx);
  }, { isolationLevel: "Serializable" });
  ```

  `updateCart` が `db` を直接参照しているため、トランザクションクライアント `tx` を
  引数で受け取れるようシグネチャを拡張する（デフォルト値 `db` で後方互換を維持）。

  **シリアライズ失敗時の再試行**: PostgreSQL が直列化失敗（`P2034` /
  `SQLSTATE 40001`）を返した場合は安全に再試行できる。呼び出し箇所を
  `for (let i = 0; i < 3; i++)` のループで包み、`P2034` なら continue、
  それ以外は throw するパターンを実装する。

  **Serializable を利用できない環境向けのフォールバック**:
  Supabase PgBouncer のトランザクションプーリングモード等で Serializable が
  使えない場合は、`updateCart` 内で `db.cart.update({ where: { id: cartId, version: currentVersion }, data: { version: { increment: 1 }, ...sums } })` の
  楽観的ロック（Cart にバージョンカラムを追加）を行い、
  `count === 0`（別トランザクションが先に更新済み）なら `P2034` と同様に再試行する。
  バージョンカラム追加には Plan 004 Step 1/3 のマイグレーションと同じ
  `bunx prisma migrate dev` を使うこと（Step 1 と同一マイグレーションファイルにまとめても可）。

  **STOP 条件**: Supabase 環境で Serializable が実際に使えるかどうかは
  実行前に `bunx prisma db execute --stdin <<'SQL'
  BEGIN ISOLATION LEVEL SERIALIZABLE; ROLLBACK;
  SQL` で確認すること。エラーが返る場合はフォールバック方式を選択する。

  **回帰テスト**: 異なる商品 A と B を同時追加した場合（2 並列の `addToCartAction` をモックで再現）に
  CartItem が 2 件、`numItemsInCart` が 2、`cartTotal` が `priceA + priceB`、
  `orderTotal` が `cartTotal + tax + shipping` と一致することを確認するテストを
  `__tests__/utils/cart-concurrent.test.ts` に追加する。


**Verify**: `bun run test` → 全パス（Plan 002 のカート計算テスト含む）

### Step 5: 商品一覧の favorite N+1 を解消

- `utils/actions.ts` に一括取得関数を追加:

  ```ts
  export const fetchFavoriteIdsForProducts = async (productIds: string[]) => { ... };
  // 未認証時は空 Map、認証時は findMany + Map<productId, favoriteId> を返す
  ```

- `components/products/ProductsContainer.tsx` で一覧の productId 群に対して
  1 回だけ呼び、`ProductsGrid` / `ProductsList` 経由で
  `FavoriteToggleButton` に `favoriteId` を prop として渡す。
- `FavoriteToggleButton` から `auth()` / `fetchFavoriteId` の呼び出しを除去
  （props 受け取りに変更）。`fetchFavoriteId` は商品詳細ページ
  （`app/products/[id]/page.tsx`）で引き続き使用されるため削除しない。

**Verify**: `bunx tsc --noEmit` → exit 0、`bun run test` → 全パス

### Step 6: 一覧画像の priority を除去

`components/products/ProductsGrid.tsx:28` と `ProductsList.tsx:26` の
`priority` プロパティを削除する（`sizes` は維持）。

**Verify**: `grep -n "priority" components/products/ProductsGrid.tsx components/products/ProductsList.tsx` → 0 件

### Step 7: カートページの write-on-read を解消 / 商品価格変更後のカート再計算

**7a — write-on-read の除去**

前提: `addToCartAction`、`removeCartItemAction`、`updateCartItemAction` はいずれも
変更後に `updateCart(cart)` を呼んで永続化された合計を更新する。Plan 003 Step 3 は
`createOrderAction` で注文作成前に合計を再計算する。今後のカート変更パスも、完了前に
必ず永続化された合計を更新しなければならない。

`app/cart/page.tsx:11-12` — `updateCart(previousCart)` の呼び出しを除去し、
`fetchOrCreateCart` の戻り値（保存済み totals + cartItems）をそのまま表示に使う。
`CartTotals` / `CartItemsList` へ渡す props の形を合わせる。

**7b — 商品価格変更後のカート再計算**

`utils/actions.ts` の `updateProductAction`（商品更新アクション）内で、
商品価格が変更された場合（`data.price !== undefined`）に以下の処理を追加する:

1. 商品更新・Cart 再計算・合計更新をすべて同一の `db.$transaction(async (tx) => { ... })`
   で囲む。トランザクション内での処理順:

   a. `tx.product.update()` で商品を更新する。

   b. 同じ `tx` を使って該当 `productId` を含む `CartItem` を持つ全 Cart を特定する:

   ```ts
   const affectedCarts = await tx.cart.findMany({
     where: { cartItems: { some: { productId } } },
     include: { cartItems: { include: { product: true } } },
   });
   ```

   c. 特定した各 Cart に対して同じ `tx` を渡して `updateCart(cart, tx)` を呼ぶ。

2. `updateCart` がトランザクションクライアント `tx` を受け取れるよう、第2引数として
   Prisma トランザクションクライアントを受け付けるようにシグネチャを更新する（他の
   呼び出し元は `tx` を渡さないため、省略可能な引数とし、省略時は `db` にフォールバック
   するか、非トランザクション呼び出し元を `db.$transaction` でラップする）。

   これにより商品更新・Cart 検索・合計更新の3操作が同一 `tx` を共有し、不可分になる。

3. **表示の一貫性**: `CartItemsList`（カート内商品一覧）と `CartTotals`（合計欄）は
   ともに `fetchOrCreateCart`（7a で write-on-read を除去済み）の戻り値に依存するため、
   `updateCart` で永続化した最新の `cartTotal`/`orderTotal` を両コンポーネントが
   同じデータソースから表示できる。現在価格（変更後の `product.price`）は
   CartItem の `product.price` として自然に反映される。

**STOP 条件**: `updateProductAction` が存在しない、またはシグネチャが
「Current state」の記述と一致しない場合は報告する（コードがドリフトした可能性）。

**Verify**: `bun run test` → 全パス、`bunx tsc --noEmit` → exit 0

## Test plan

- Plan 002 のカート計算テストが回帰ゲート（upsert 化後も合計値の期待が不変）。
- 追加: `fetchFavoriteIdsForProducts` の単体テスト（未認証→空 Map、認証→Map 構築）。
- 追加: upsert の呼び出し引数検証（`cartId_productId` キーが使われること）。
- 追加: `fetchOrCreateCart` の upsert 引数検証（`clerkId` の unique where が使われること）。

## Done criteria

- [ ] `bunx prisma validate` が valid
- [ ] `prisma/migrations/` に新規マイグレーションがコミットされている
- [ ] `grep -n "upsert" utils/actions.ts` がヒットする
- [ ] `grep -rn "fetchFavoriteId(" components/products/FavoriteToggleButton.tsx` → 0 件
- [ ] `bun run test` / `bunx tsc --noEmit` / `bun run lint` がすべて exit 0
- [ ] `git status` で in-scope 外のファイルに変更がない
- [ ] `plans/README.md` のステータス行を更新済み

## STOP conditions

- Step 2 で重複行が見つかった（データクレンジング方針の判断が必要）。
- マイグレーションが本番相当 DB に接続していると判明した場合
  （`DATABASE_URL` の接続先確認ができないなら適用前に STOP して確認を求める）。
- `updateCart` のトランザクション化で Prisma の interactive transaction が
  Supabase pooler（pgbouncer）と衝突する場合（タイムアウト/エラー）。
- Plan 003 が未完了（`Math.round` が `updateCart` にない）— 依存順序違反。

## Maintenance notes

- 以後、新しい「所属確認つき検索」を追加する際は Step 1 のインデックス方針に
  合わせて `@@index` を同時に追加すること。
- `Favorite` のユニーク制約により、二重 favorite は DB レベルで防がれる。
  UI 側のエラーハンドリング（P2002）はトーストで吸収される想定 — レビューで確認。
- ページネーション（deferred）を実装する際は Step 5 の一括取得関数に
  ページ内 productIds を渡す形をそのまま流用できる。
