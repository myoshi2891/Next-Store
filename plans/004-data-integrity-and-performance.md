# Plan 004: DB 整合性制約の追加とホットパスの性能改善

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: 以下の allowlist（Done criteria の drift check も
> この同一 allowlist を再利用する）に対して、**pathspec を付けずにリポジトリ全体を
> 対象**に次の 4 コマンドを `--name-only` で実行する（pathspec を付けると allowlist
> 外の変更がそもそも出力に現れず検出できないため、意図的に付けない）:
>
> **allowlist**: `prisma/schema.prisma`、`utils/actions.ts`、`components/products/` 配下、
> `app/cart/page.tsx`
>
> ```sh
> git diff --name-only 90f91f4..HEAD
> git diff --cached --name-only
> git diff --name-only
> git ls-files --others --exclude-standard
> ```
>
> `git status` 単独では不十分（コミット済みドリフトを検出できない）。出力に
> allowlist 外のパスが1件でも含まれれば STOP condition として扱う。
> Plan 001/003 による `utils/actions.ts` の変更（認可チェック、丸め処理）は
> allowlist 内の想定内のドリフト。それ以外の allowlist 内の変更は
> 「Current state」と比較し、不一致は STOP。

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
- `prisma/schema.prisma`（制約・インデックス追加、および Serializable 分離レベルが
  使えない場合のフォールバックとして `Cart.version Int @default(0)` カラムの追加
  （下記ステップ参照）。既存カラムの型変更は禁止）と、この変更で生成される
  `prisma/migrations/` 配下のマイグレーション（plans/001 の Scope と同じ扱い）
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

### Step 1: Serializable 対応確認とスキーマへの制約・インデックス追加

**まず Serializable 分離レベルが実際に使えるか確認する**（この結果で、下記の
スキーマ変更に `Cart.version` を含めるかどうかが決まる。Step 3 で一度だけ
マイグレーションを実行するため、判定はスキーマ編集より前に行うこと）。

Supabase 環境で Serializable が使えるかどうかは、実際に使う **Prisma Client の
interactive transaction** で確認する（`bunx prisma db execute` は単発の raw SQL
実行であり、PgBouncer のトランザクションプーリングモード配下で
`db.$transaction` が直面する接続経路とは異なるため、これだけでは正しく検証
できない）。同一の `DATABASE_URL` を使う Prisma Client で以下のような
使い捨てスクリプトを実行し、エラーなく完了するか確認する:

```ts
await db.$transaction(async (tx) => {
  await tx.cart.findMany({ take: 1 });
}, { isolationLevel: "Serializable" });
```

Serializable が未対応であることを明示するエラー（例: 分離レベル自体を拒否する
PostgreSQL/PgBouncer のエラーメッセージ）が返った場合のみフォールバック方式
（`Cart.version` 楽観的ロック、Step 4 で使用）を選択する。接続断・認証失敗・
pooler 障害など、Serializable 対応可否を判定できないエラーが発生した場合は
フォールバックへ切り替えず、STOP して報告し、オペレーターに接続設定の確認を
求めること（判定不能なエラーを「未対応」と誤認してフォールバックに切り替えると、
実際には使える Serializable を放棄し、不要な `Cart.version` カラムをスキーマに
追加してしまう）。このプリフライト確認を省略する場合も同様に、Step 4 で最初に
実行される実際の interactive transaction が Serializable 未対応を明示するエラーで
失敗した時点でのみフォールバック方式へ切り替え、それ以外のエラーは STOP して
報告する（未検証のまま Serializable ありきで進めない）。

`prisma/schema.prisma` に追加:

- `Favorite`: `@@unique([clerkId, productId])`
- `CartItem`: `@@unique([cartId, productId])`, `@@index([productId])`
- `Cart`: `@@unique([clerkId])`。**上記の確認で Serializable が使えないと判明した
  場合はここで `version Int @default(0)` も追加する**（Step 4 の楽観的ロック
  フォールバックで使用。Step 3 のマイグレーションに含めるため、ここで追加しないと
  後から別マイグレーションが必要になる）。
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

- `fetchOrCreateCart` の `errorOnFailure` 契約を**維持**しながら並行安全にする。
  現行実装のデフォルトは `errorOnFailure = false` であり、この既定値は変更しない:
  - `errorOnFailure: true` の呼び出しでは、既存の
    `findFirst` → 未存在時に例外スロー、という既存の分岐をそのまま残す
    （Cart を新規作成しない経路）。
  - `errorOnFailure: false`（省略時のデフォルト）では、
    `db.cart.upsert({ where: { clerkId: userId }, create: { clerkId: userId }, update: {}, include: includeProductClause })`
    に置き換える。Step 1 の `@@unique([clerkId])` と組み合わせることで、
    同一ユーザーの Cart 作成を並行リクエストでも 1 件に保つ一次対策になる。
  - `addToCartAction` は `fetchOrCreateCart({ userId: user.id })` と呼んでいる
    （`errorOnFailure` 未指定）。この呼び出しに **`errorOnFailure: false`** を
    明示的に渡すよう変更する。
  - `createOrderAction` は既に `fetchOrCreateCart({ userId: user.id, errorOnFailure: true })`
    を呼んでいる（`utils/actions.ts:567-570`）。この呼び出しは変更しない
    （空の Cart を新規作成せず、既存の findFirst → 例外スロー経路を維持する）。
- `utils/actions.ts` の `updateOrCreateCartItem`（414-447）を
  `db.cartItem.upsert` に書き換える（Step 1 の `@@unique([cartId, productId])` により
  `cartId_productId` 複合キーが where に使える）。同時に、`updateOrCreateCartItem` が
  `addToCartAction` のトランザクション外で呼ばれても動作するよう、オプショナルな
  トランザクションクライアント引数 `client` を追加しデフォルト値を `db` とする。
  `Prisma.TransactionClient` 型を参照するため、`utils/actions.ts` 冒頭の
  `import { Cart } from "@prisma/client";` に `Prisma` を追加する
  （`import { Cart, Prisma } from "@prisma/client";`）:

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

  **これは破壊的なシグネチャ変更である**: 現状の `updateOrCreateCartItem` は
  オブジェクト引数 `{ productId, cartId, amount }`（`utils/actions.ts:414-422`）を
  取るが、上記の書き換え後は位置引数 `(cartId, productId, amount, client)` に
  変わる。現時点での呼び出し元は `addToCartAction`（`utils/actions.ts:498`、
  `await updateOrCreateCartItem({ productId, cartId: cart.id, amount });`）の
  **1 箇所のみ**であり、それ以外に後方互換を保つべき既存呼び出し元は存在しない。
  この 1 箇所は、本 Step で `addToCartAction` をトランザクション化する際に
  下記の位置引数呼び出し（`updateOrCreateCartItem(cart.id, productId, amount, tx)`）
  へ合わせて更新すること。

- `toggleFavoriteAction` の create 分岐は、重複時に P2002 エラーとなるため
  try-catch で「既に追加済み」として扱うか、`upsert` に変更する。
- `addToCartAction`（490-504）の `updateOrCreateCartItem` + `updateCart` を
  `db.$transaction` で包む。トランザクション内では `updateOrCreateCartItem` と
  `updateCart` の**両方**に `tx` を渡し、すべての書き込みが同一トランザクションの
  スコープ内で実行されるようにする。**Step 1 の判定結果で分岐する**: Serializable
  対応環境（Step 1 で確認済み）では第 2 引数に `{ isolationLevel: "Serializable" }`
  を渡し、これにより異なる商品を同時追加した場合の競合による `numItemsInCart` /
  `cartTotal` / `orderTotal` の不整合を防ぐ。Serializable 非対応環境（Step 1 で
  `Cart.version` フォールバックを選択済み）では第 2 引数を渡さず（デフォルトの
  分離レベルで実行し）、下記フォールバックの `Cart.version` 楽観的ロックで整合性を
  保証する。以下の再試行ループ・ロールバック・（フォールバック時の）楽観的ロック
  処理は両分岐で共通のまま維持する:

  ```ts
  const isSerializableSupported = await getIsSerializableSupported();
  const txOptions = isSerializableSupported
    ? { isolationLevel: "Serializable" as const }
    : undefined;
  await db.$transaction(async (tx) => {
    const cart = await tx.cart.findFirst({ where: { clerkId: user.id }, include: includeProductClause });
    if (!cart) throw new Error("Cart not found");
    await updateOrCreateCartItem(cart.id, productId, amount, tx);
    await updateCart(cart, tx);
  }, txOptions);
  ```

  `isSerializableSupported` は Step 1 のプリフライト確認結果をプロセス内で 1 度だけ
  確定してキャッシュする値であり、毎リクエスト再判定しない。実装は例えば
  `utils/db.ts` に `let cached: Promise<boolean> | undefined;` を持つ
  `getIsSerializableSupported()` を追加し、初回呼び出し時のみ Step 1 と同じ
  interactive transaction プローブを実行してその `Promise` をキャッシュする形にする。
  Serializable 未対応を明示するエラーなら `false`、成功なら `true` を返す。
  接続断・認証失敗など判定不能なエラーが発生した場合は `false` にフォールバックせず、
  そのエラーを再 throw して呼び出し元（`addToCartAction` / `updateProductAction` /
  `deleteProductAction`）を失敗させる（Step 1 の「判定不能なエラーを『未対応』と
  誤認してフォールバックに切り替えると実際には使える Serializable を放棄する」という
  方針を、実行時の判定でも一貫させるため）。この関数は Step 4・7b・7c のすべての
  `db.$transaction` 呼び出し箇所から共通で呼び出す。
  `user` は `addToCartAction` 冒頭の `const user = await getAuthUser();`（`utils/actions.ts:491`）を指す。

  `cart` オブジェクトを `updateCart` に渡すことで既存の `updateCart(cart: Cart)` シグネチャと
  整合する。`updateCart(cartId, tx)` のように `cartId` を直接渡す形は、`updateCart` の
  シグネチャとすべての呼び出し元を意図的に変更しない限り使用しないこと。

  `updateCart` が `db` を直接参照しているため、トランザクションクライアント `tx` を
  引数で受け取れるようシグネチャを拡張する（デフォルト値 `db` で後方互換を維持）。
  **単に引数を追加するだけでなく、関数本体内の `db.cartItem.findMany(...)` と
  `db.cart.update(...)` の呼び出しを、受け取った引数（`client` などの名前、
  デフォルト値 `db`）経由の呼び出しに置き換えること**。この置き換えを行わないと、
  `addToCartAction` のトランザクション内で `updateCart(cart, tx)` を呼んでも
  内部の読み書きが `tx` の外（別コネクション）で実行され、Serializable
  分離レベルによる競合検出も `Cart.version` 楽観的ロックの再読込も機能しない。

  **シリアライズ失敗時の再試行**: PostgreSQL が直列化失敗（`P2034` /
  `SQLSTATE 40001`）を返した場合は安全に再試行できる。呼び出し箇所を
  `for (let i = 0; i < 3; i++)` のループで包み、トランザクションが成功したら
  `break`/`return` で即座にループを抜ける。`P2034`（または `SQLSTATE 40001`）の
  場合のみ次のイテレーションへ `continue` し、それ以外のエラーは即座に `throw`
  する。成功後もループを継続する実装は、`CartItem` の increment や集計値の更新が
  複数回適用される不整合を招くため避けること。

  **Serializable を利用できない環境向けのフォールバック**（Step 1 で Serializable
  が使えないと判定した場合のみ実施。判定と `Cart.version` カラムの追加は
  Step 1 で完了済みであることが前提）:
  Supabase PgBouncer のトランザクションプーリングモード等で Serializable が
  使えない場合は、`updateCart` を上記の再試行ループの**各イテレーション内**で
  以下のように実装する:
  1. `tx` を使って Cart と CartItem を再読込し、現在の `version` と最新の
     `cartItems`/`product` から `numItemsInCart`/`cartTotal`/`orderTotal` を
     その場で再計算する（呼び出し元から渡された古い `cart` オブジェクトの値は
     使わない）。
  2. `count` を返す `tx.cart.updateMany({ where: { id: cart.id, version: currentVersion }, data: { version: { increment: 1 }, ...sums } })`
     で更新する（`count` を持たない `update` は使わない）。
  3. `result.count === 0`（別トランザクションが先に `version` を進めていた場合）は
     `P2034` とは別の `OptimisticLockConflictError` を投げ、呼び出し箇所の再試行
     ループでこれも `P2034` と同様にキャッチして次のイテレーションに進む。
  4. `result.count === 1` なら成功として、再読込した `version + 1` と再計算済みの
     集計値をそのイテレーションの戻り値とする。

  `Cart.version` カラムの追加と Serializable 可否の判定は Step 1 で完了済み
  （このカラムは Step 3 のマイグレーションに含まれている）。

  **回帰テスト**: 異なる商品 A と B を同時追加した場合（2 並列の `addToCartAction` を
  モックで再現）に CartItem が 2 件、`numItemsInCart` が 2、`cartTotal` が
  `priceA + priceB`、`orderTotal` が `cartTotal + tax + shipping` と一致することを
  確認するモックベースの単体テストを `__tests__/utils/cart-concurrent.test.ts` に
  追加する。**加えて**、実際の PostgreSQL に対して 2 つの `addToCartAction` 呼び出しを
  本物の Prisma Client で並行実行する統合テストを追加し、モックでは検証できない
  トランザクション分離レベルの実際の挙動（Serializable 使用時の直列化失敗
  `P2034` とその再試行、失敗時のロールバック、フォールバック選択時は
  `Cart.version` の楽観的ロック衝突）を確認する。このテストも同じ 2 件の
  CartItem / `numItemsInCart` / `cartTotal` / `orderTotal` の一致を検証する。
  実 DB 接続が必要なテストのため、`DATABASE_URL` が利用できる環境でのみ実行する
  構成（別ファイル・別スクリプトへの分離等）にしてよい。


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

`removeCartItemAction`（`utils/actions.ts:506-529`）と `updateCartItemAction`
（`utils/actions.ts:531-559`）は現状、`db.cartItem.delete`/`update` と
`updateCart(cart)` を別々の呼び出しとして実行しており（`$transaction` で
包まれていない）、Step 4 で `addToCartAction` に適用したのと同じ非アトミック性の
問題を抱える。この 2 つのアクションも Step 4 と同じパターンに変更する:
CartItem の変更（delete/update）と `updateCart(cart, tx)` 呼び出しを同一の
`db.$transaction(async (tx) => { ... })` に包み、`await getIsSerializableSupported()`
で取得した `isSerializableSupported` に応じて `{ isolationLevel: "Serializable" }` を渡すか `Cart.version` の
compare-and-set フォールバックを使う。`P2034` / `OptimisticLockConflictError` は
Step 4 と同じ再試行ループ（最大 3 回）で捕捉する。CartItem だけが保存されて
集計更新が失われる、または逆に集計更新だけが古い値で残る経路を許可しない。

**7b — 商品価格変更後のカート再計算**

`utils/actions.ts` の `updateProductAction`（商品更新アクション）内で、
商品価格が変更された場合（`data.price !== undefined`）に以下の処理を追加する:

1. 商品更新・Cart 再計算・合計更新をすべて同一の `db.$transaction(async (tx) => { ... })`
   で囲む。**Step 4 で `addToCartAction` に適用した並行制御と同じ方式を、ここでも
   使うこと**: `await getIsSerializableSupported()` で取得した
   `isSerializableSupported`（Step 1 のプリフライト確認結果をキャッシュした値）が
   true なら第 2 引数に `{ isolationLevel: "Serializable" }` を渡し、false なら
   Step 4 と同じ `Cart.version` 楽観的ロック（`updateCart` 内で `tx.cart.updateMany`
   による compare-and-set、`count === 0` は再試行）で実行する。いずれの分岐でも
   Step 4 と同じ `P2034`（`SQLSTATE 40001`）再試行ループ（最大 3 回、成功したら
   即座に抜ける）で呼び出し全体を包む。これを怠ると、商品価格更新中に別リクエストの
   `addToCartAction` が同じ Cart に書き込んだ場合、どちらか一方の更新が古い集計値で
   上書きされ、`numItemsInCart`/`cartTotal`/`orderTotal` が実際の CartItem と
   食い違う。トランザクション内での処理順:

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

   **回帰テスト**: `updateProductAction` による価格変更と、同じ Cart への
   `addToCartAction` を同時実行（モックで再現、可能なら Step 4 と同様に実 DB での
   並行実行テストも追加）し、実行後の CartItem・`numItemsInCart`・`cartTotal`・
   `orderTotal` が整合していることを確認するテストを追加する。

3. **表示の一貫性**: `CartItemsList`（カート内商品一覧）と `CartTotals`（合計欄）は
   ともに `fetchOrCreateCart`（7a で write-on-read を除去済み）の戻り値に依存するため、
   `updateCart` で永続化した最新の `cartTotal`/`orderTotal` を両コンポーネントが
   同じデータソースから表示できる。現在価格（変更後の `product.price`）は
   CartItem の `product.price` として自然に反映される。

**7c — 商品削除後のカート再計算**

`prisma/schema.prisma:72` の `CartItem.product` は `onDelete: Cascade` のため、
`deleteProductAction`（`utils/actions.ts:110-123`）が商品を削除すると該当
`CartItem` 行は DB 側で自動削除されるが、親 `Cart` の `numItemsInCart` /
`cartTotal` / `orderTotal`（キャッシュされた集計値）は再計算されず、削除された
商品分だけ過大な値のまま残る。`deleteProductAction` を以下のように変更する。
**7b と同じ並行制御を適用する**: 下記 1〜3 全体を包む `db.$transaction` の
第 2 引数は `await getIsSerializableSupported()` で取得した `isSerializableSupported`
が true なら `{ isolationLevel: "Serializable" }`、
false なら省略（`updateCart(cart, tx)` 内の `Cart.version` compare-and-set に委ねる）。
呼び出し全体を Step 4 と同じ `P2034`（`SQLSTATE 40001`）/ `OptimisticLockConflictError`
再試行ループ（最大 3 回、成功したら即座に抜ける）で包み、競合時は商品削除
（`tx.product.delete`）と Cart 集計更新の両方を同じイテレーションでまとめて
再実行する。これを怠ると、削除自体は成功したのに集計更新だけ古い `CartItem`
一覧を前提に別トランザクションの結果を上書きするケースが起こり得る:

1. `db.product.delete` の**前**に、同一 `db.$transaction(async (tx) => { ... })`
   内で対象 `productId` を含む `CartItem` を持つ全 Cart を特定する（7b と同じ
   クエリパターン）:

   ```ts
   const affectedCarts = await tx.cart.findMany({
     where: { cartItems: { some: { productId } } },
     include: { cartItems: { include: { product: true } } },
   });
   ```

2. 同じ `tx` で `tx.product.delete({ where: { id: productId } })` を実行する
   （Cascade により該当 `CartItem` も削除される）。

3. 削除後、7b で追加する `updateCart(cart, tx)` のトランザクションクライアント
   対応を再利用し、特定した各 Cart に同じ `tx` を渡して呼び出し、
   `numItemsInCart`/`cartTotal`/`orderTotal` を再計算する（削除済み商品を除いた
   残りの `cartItems` から計算されるよう、`updateCart` 内で Cart を再読込する）。

`deleteImage` の呼び出しと `revalidatePath` は従来どおりトランザクション外で行う
（Supabase Storage 操作は DB トランザクションの対象外）。

**STOP 条件**: `updateProductAction` または `deleteProductAction` が存在しない、
またはシグネチャが「Current state」の記述と一致しない場合は報告する
（コードがドリフトした可能性）。

**Verify**: `bun run test` → 全パス、`bunx tsc --noEmit` → exit 0

## Test plan

- Plan 002 のカート計算テストが回帰ゲート（upsert 化後も合計値の期待が不変）。
- 追加: `fetchFavoriteIdsForProducts` の単体テスト（未認証→空 Map、認証→Map 構築）。
- 追加: upsert の呼び出し引数検証（`cartId_productId` キーが使われること）。
- 追加: `fetchOrCreateCart` の upsert 引数検証（`clerkId` の unique where が使われること）。

## Done criteria

- [ ] `bunx prisma validate` が valid
- [ ] `prisma/migrations/` に新規マイグレーションがコミットされている
- [ ] Step 1 で Serializable フォールバックを選択した場合のみ: `Cart.version` が
      `prisma/schema.prisma` と対応するマイグレーションに含まれ、`updateCart` の
      `version` 検証（compare-and-set）テストが追加されている
- [ ] `grep -n "upsert" utils/actions.ts` がヒットする
- [ ] `grep -rn "fetchFavoriteId(" components/products/FavoriteToggleButton.tsx` → 0 件
- [ ] `bun run test` / `bunx tsc --noEmit` / `bun run lint` がすべて exit 0
- [ ] 冒頭の Drift check と同一 allowlist（`prisma/schema.prisma`、`utils/actions.ts`、
      `components/products/` 配下、`app/cart/page.tsx`）を用いて、pathspec なしで
      実行した 4 コマンド（`git diff --name-only 90f91f4..HEAD`、
      `git diff --cached --name-only`、`git diff --name-only`、
      `git ls-files --others --exclude-standard`）の出力に allowlist 外のパスが
      1件も含まれない（`git status` 単独ではコミット済み・ステージ済みドリフトを
      見落とすため使わない）
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
