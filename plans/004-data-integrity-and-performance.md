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

- `prisma/schema.prisma:34-41` — `Favorite`: `@@unique` なし。
  `prisma/schema.prisma:70-79` — `CartItem`: `@@unique` なし。
  スキーマ全体に `@@index` が 1 つもない。
- `utils/actions.ts:414-447` — `updateOrCreateCartItem`: `findFirst` →
  `update`/`create`（非アトミック）。
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
- `Cart`: `@@index([clerkId])`
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

同様に `CartItem` の `(cartId, productId)` も確認。**重複が存在した場合は STOP**
（重複解消の方針 — 最新行を残す等 — はオペレーターの判断が必要）。

**Verify**: 両クエリとも 0 行

### Step 3: マイグレーション実行

`bunx prisma migrate dev --name add-unique-constraints-and-indexes`

**Verify**: exit 0、`prisma/migrations/` に新規ディレクトリが生成される

### Step 4: check-then-act を upsert に置換

- `utils/actions.ts` の `updateOrCreateCartItem`（414-447）を
  `db.cartItem.upsert` に書き換える（Step 1 の `@@unique([cartId, productId])` により
  `cartId_productId` 複合キーが where に使える）:

  ```ts
  await db.cartItem.upsert({
      where: { cartId_productId: { cartId, productId } },
      update: { amount: { increment: amount } },
      create: { cartId, productId, amount },
  });
  ```

- `toggleFavoriteAction` の create 分岐は、重複時に P2002 エラーとなるため
  try-catch で「既に追加済み」として扱うか、`upsert` に変更する。
- `addToCartAction`（490-504）の `updateOrCreateCartItem` + `updateCart` を
  `db.$transaction(async (tx) => { ... })` で包む。`updateCart` が `db` を直接
  参照しているため、トランザクションクライアント `tx` を引数で受け取れるよう
  シグネチャを拡張する（デフォルト値 `db` で後方互換を維持）。

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

### Step 7: カートページの write-on-read を解消

前提: Plan 003 Step 2 により、合計の再計算はすべてのカート変更アクションと
注文作成時に行われている。

`app/cart/page.tsx:11-12` — `updateCart(previousCart)` の呼び出しを除去し、
`fetchOrCreateCart` の戻り値（保存済み totals + cartItems）をそのまま表示に使う。
`CartTotals` / `CartItemsList` へ渡す props の形を合わせる。

**Verify**: `bun run test` → 全パス、`bunx tsc --noEmit` → exit 0

## Test plan

- Plan 002 のカート計算テストが回帰ゲート（upsert 化後も合計値の期待が不変）。
- 追加: `fetchFavoriteIdsForProducts` の単体テスト（未認証→空 Map、認証→Map 構築）。
- 追加: upsert の呼び出し引数検証（`cartId_productId` キーが使われること）。

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
