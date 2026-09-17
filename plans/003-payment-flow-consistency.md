# Plan 003: 決済フローの金額整合性と状態遷移を修正する

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: 以下の 4 コマンドをすべて Scope 記載パス
> （`utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md prisma/schema.prisma prisma/migrations __tests__/utils/cart-calculations.test.ts __tests__/api/payment-route.test.ts __tests__/api/confirm-route.test.ts __tests__/utils/order-actions.test.ts`）
> に対して実行する:
>
> ```sh
> git diff --stat 90f91f4..HEAD -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md prisma/schema.prisma prisma/migrations __tests__/utils/cart-calculations.test.ts __tests__/api/payment-route.test.ts __tests__/api/confirm-route.test.ts __tests__/utils/order-actions.test.ts
> git diff --cached --stat -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md prisma/schema.prisma prisma/migrations __tests__/utils/cart-calculations.test.ts __tests__/api/payment-route.test.ts __tests__/api/confirm-route.test.ts __tests__/utils/order-actions.test.ts
> git diff --stat -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md prisma/schema.prisma prisma/migrations __tests__/utils/cart-calculations.test.ts __tests__/api/payment-route.test.ts __tests__/api/confirm-route.test.ts __tests__/utils/order-actions.test.ts
> git ls-files --others --exclude-standard -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md prisma/schema.prisma prisma/migrations __tests__/utils/cart-calculations.test.ts __tests__/api/payment-route.test.ts __tests__/api/confirm-route.test.ts __tests__/utils/order-actions.test.ts
> ```
>
> 1つ目はベース SHA 以降のコミット済み変更、2つ目はステージ済み未コミット変更、
> 3つ目は未ステージの変更、4つ目は未追跡の対象領域ファイルを検出する。
> `git status` 単独では不十分（コミット済みドリフトを検出できない）。
> Plan 001・Plan 002 の完了により生じる以下の変更は想定内のドリフトとして扱い、
> STOP しない: `app/api/payment/route.ts` の所有権/認可チェック追加、
> `createProductAction` の admin 認可チェック追加、レビューの重複投稿・
> なりすまし対策（`reviewSchema`／`Review` の `@@unique([clerkId, productId])`
> 制約）、画像バリデーション強化、`renderError` の変更、および Plan 002 が
> `__tests__/` 配下に追加する characterization テスト。それ以外で、いずれかの
> コマンドが Scope 内パスの変更を報告した場合は「Current state」と比較し、
> 不一致は STOP。

## Status

- **Priority**: P1
- **Effort**: M
- **Risk**: MED（金額計算の変更 — テストゲート必須）
- **Depends on**: plans/002-money-path-test-baseline.md（characterization テストが前提）
- **Category**: bug
- **Planned at**: commit `90f91f4`, 2026-07-05

## Why this matters

監査で確認された決済フローの整合性問題:

1. **顧客への請求額が注文記録より少ない**: Stripe には商品小計のみ請求され、
   カート/注文画面に表示される税・送料は一度も請求されない。全注文で
   `Order.orderTotal` と実際の Stripe 請求額が恒常的に乖離する。
2. **未完了セッションでもカートが消える**: confirm ルートは `session.status` が
   complete でなくても cart を無条件削除する。
3. **税計算が Float を Int カラムに書き込む**: `tax = 0.1 * cartTotal` は
   `cartTotal` が 10 の倍数でない場合に非整数となり、`Cart.tax`（Int）への
   書き込みで Prisma が実行時エラーを投げる。
4. **注文が古い合計値から作られ得る**: `createOrderAction` は保存済みの cart 合計を
   信頼し、作成時に再計算しない。
5. **注文とカートの対応を検証できない**: `Order` は Cart への関係を保持せず、payment
   ルートはクライアント指定の `orderId` と `cartId` が属する組か検証しない。
6. **return URL がリクエストヘッダを信頼する**: 任意の非 null `Origin` が Stripe の
   `return_url` に使われ、外部サイトへリダイレクトさせ得る。
7. **ドキュメントと実装の価格単位が不一致**: CLAUDE.md は「セント単位で保存」と
   記すが、実装はドル整数（表示はそのまま、Stripe 送信時に ×100）。

## Current state

- `utils/actions.ts:449-488` — `updateCart`:

  ```ts
  const tax = cart.taxRate * cartTotal;          // :470 Float になり得る
  const shipping = cartTotal ? cart.shipping : 0; // :471
  const orderTotal = cartTotal + tax + shipping;  // :472
  // db.cart.update の data: { numItemsInCart, cartTotal, tax, /* shipping コメントアウト :482 */ orderTotal }
  ```

  `prisma/schema.prisma:56-68` — `Cart.tax` / `Cart.orderTotal` / `Cart.shipping` は
  すべて `Int`、`taxRate` のみ `Float @default(0.1)`。
- `utils/actions.ts:561-597` — `createOrderAction`: `fetchOrCreateCart` の戻り値
  （前回永続化された合計）をそのまま `db.order.create` に転記。再計算なし。
  `user.emailAddresses[0].emailAddress`（:587）は空配列で TypeError。
- `prisma/schema.prisma:56-92` — `Cart` と `Order` の間に関係または Order 側の
  `cartId` がなく、作成時のカートを永続的に結び付けられない。
- `app/api/payment/route.ts:39-51` — line_items は商品のみ:

  ```ts
  unit_amount: cartItem.product.price * 100, // price in cents
  ```

  tax / shipping の line item なし。`origin` ヘッダ（:8）は null チェックなしで
  `return_url` に埋め込まれる。`orderId` と `cartId` の対応も未検証。
- `app/api/confirm/route.ts:11-30` — `session.status === "complete"` で
  `isPaid: true`。`session.payment_status` は未検証。`db.cart.delete`（:26-30）は
  if の**外**で無条件実行。`session_id`（:9）は `as string` キャストのみで
  欠落時のガードなし。
- 価格単位の実態: `Product.price` はドル整数。`utils/format.ts:1-7` の
  `formatCurrency` は値をそのまま USD 表示。CLAUDE.md の「価格は**セント単位の
  整数**（`Int`）で保存」という記載が実装と矛盾。
- Plan 002 で以下の characterization テストが存在するはず（依存関係）:
  `__tests__/utils/cart-calculations.test.ts`, `__tests__/api/payment-route.test.ts`,
  `__tests__/api/confirm-route.test.ts`, `__tests__/utils/order-actions.test.ts`

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `bun install`       | exit 0              |
| Tests     | `bun run test`      | 全パス              |
| Typecheck | `bunx tsc --noEmit` | exit 0              |
| Lint      | `bun run lint`      | exit 0              |

## Scope

**In scope**:
- `utils/actions.ts`（`updateCart`, `createOrderAction` のみ）
- `app/api/payment/route.ts`
- `app/api/confirm/route.ts`
- `prisma/schema.prisma` と、この変更で生成される `prisma/migrations/` 配下のマイグレーション
- `CLAUDE.md`（価格単位の記載修正のみ）
- Plan 002 で作成されたテストファイルの期待値更新

**Out of scope**:
- `prisma/schema.prisma` — Cart と Order の関係追加以外の型変更（Int→Float 等）はしない。丸めで整数を維持する。
- Stripe Webhook の新設 — Plan 006（direction）の設計スパイク対象。
  このプランは既存のリダイレクト方式の中での最小修正に留める。
- `utils/format.ts` — 表示ロジックは現状維持。
- カート操作アクション（add/remove/update）の構造変更 — Plan 004 の担当。

## Git workflow

- ブランチ: `advisor/003-payment-consistency`
- コミット形式: `fix(<scope>): <subject>`（例: `fix(payment): 税・送料を Stripe line_items に追加`）
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: updateCart の税を整数に丸め、shipping を永続化する

`utils/actions.ts:470-483`:
- `const tax = Math.round(cart.taxRate * cartTotal);`
- `:482` のコメントアウトを解除し `shipping` を `db.cart.update` の data に含める。
- `orderTotal` は丸め後の tax を使用（整数のまま）。

Plan 002 の `cart-calculations.test.ts` の期待値を更新:
price=25 のケースは `tax=3`（2.5 → round）、data に `shipping` キーが含まれる。

**Verify**: `bunx vitest run __tests__/utils/cart-calculations.test.ts` → 全パス

### Step 2: OrderItem スキーマを追加しマイグレーションを生成する

`prisma/schema.prisma` に `OrderItem` モデル（`productId`、`productName`、`orderId`、
`quantity`、`unitPrice` を保持、`Product`/`Order` への外部キー）と Cart-to-Order 関係
（`Order.cartId`）を追加する。この `cartId` への接続自体は Step 3 の
`createOrderAction` で行う。confirm ルートが Cart を削除しても注文履歴を削除しない
よう、既存注文に対応できる optional relation と `onDelete: SetNull` を使う。
`OrderItem.productId` の `Product` への外部キーも同様に `onDelete: SetNull`
（optional relation）にする。`productName`/`unitPrice` が作成時点のスナップショット
として `OrderItem` 自身に保存されるため、参照先の `Product` が削除されても注文履歴の
表示・Stripe への請求内容生成（Step 4）は影響を受けない。生成された Prisma
マイグレーションをコミットする。

**OrderItem ↔ Order 間の削除制約**: `createOrderAction` は同一トランザクション内で
未払い Order を削除してから新しい Order を作成する（Step 3）。この削除が
外部キー制約で失敗しないよう、以下のいずれかを選択して実装し、
選択した方針をスキーマとマイグレーションに反映すること:

- **Option A — Cascade 削除**: `OrderItem` の `orderId` フィールドに
  `onDelete: Cascade` を設定する（`Order` を削除すると子の `OrderItem` も
  自動削除される）。未払い注文の再注文シナリオに適合する。
- **Option B — 明示的削除**: スキーマは変更せず、`createOrderAction` の
  同一トランザクション内で `tx.orderItem.deleteMany({ where: { orderId } })` を
  `tx.order.delete` より**前**に実行する。

選択した方針で再注文テストを `__tests__/utils/order-actions.test.ts` に追加すること:
既存の未払い Order（OrderItem あり）が存在する状態で `createOrderAction` を呼ぶと、
古い Order と OrderItem が削除されて新しい Order が作成され、外部キー制約エラーが
発生しないことを確認する。

**既存 Order の取り扱い（移行方針を選択して実施すること）**:  
スキーマ追加前に作成された Order は `cartId` も `OrderItem` も持たない。
このような legacy Order が新しい checkout フローに到達した場合、以下のいずれかを
選択して実装し、選んだ方針を `createOrderAction`（Step 3）と Step 4 の
Checkout Session 作成処理の冒頭に STOP 条件として明記すること:

- **Option A — Backfill migration**: `cartId` と `OrderItem` を復元できる
  backfill データマイグレーション（`prisma/migrations/` に追加）を作成し、
  既存 Order を新仕様に移行する。復元できない Order（Cart が既に削除済みなど）は
  `cartId = null` のまま残し、Option B の STOP 条件で捕捉する。
- **Option B — Explicit rejection**: backfill を行わず、
  `createOrderAction` と Checkout Session 作成処理で `order.cartId == null ||
  orderItems.length === 0` を検出したら処理を中断し、ユーザーに明示的なエラーを返す。
  カートを削除したり Stripe を呼び出したりしない。

**STOP 条件**: 両 Option とも実装途中で想定外の状態（例: 複数 Cart が同一 Order に
紐づいている等）を検出したら、ロールバックして報告すること。

**Checkout Session 重複防止フィールド（Step 4 で選択する Option を先取りして追加）**:
Step 3 の未払い Order 削除条件は、Step 4 で選択する重複防止方式（Option A: 冪等キー /
Option B: 処理中フラグ）が使うフィールドを参照する。そのため Step 4 で選ぶ方針を
このステップで決め、対応するフィールドを `Order` モデルに追加してマイグレーションを
生成すること（Step 4 では新規フィールド追加を行わず、このステップで追加済みのものを使う）:

- Step 4 で **Option A**（冪等キー）を選ぶ場合: `stripeSessionId String?` と
  `checkoutAttempt Int @default(0)` を追加する。
- Step 4 で **Option B**（処理中フラグ）を選ぶ場合: `isPending Boolean @default(false)` と
  `stripeSessionId String?` を追加する。

**Verify**: `bunx prisma generate` → exit 0（`OrderItem` 型と、選択した Option の
フィールド（`stripeSessionId` / `checkoutAttempt` または `isPending`）が生成されること）

### Step 3: createOrderAction で合計を再計算する

`utils/actions.ts:561-597`:
- カートの再計算、合計の永続化、未払い注文の削除、Order 作成を同一の
  `db.$transaction` で実行する。`updateCart` はトランザクションクライアントを受け取れる
  ようにし、その `tx` で最新の cartItems/product を再読込して計算・更新する。作成する
  Order はその `currentCart` スナップショットの `numItemsInCart`、`orderTotal`、`tax`、
  `shipping` だけを使う。再計算と Order 作成の間に別リクエストの変更を取り込まないこと。
  Step 2 で追加した Cart-to-Order 関係を使い、作成する Order に現在の Cart を接続して
  `cartId` を永続化する。
- **未払い Order 削除の除外条件（Step 4 の Option A・B いずれを選択した場合も適用）**:
  削除対象の `where` に、Option B（`isPending` フィールドあり）なら `isPending: false` を、
  Option A（`isPending` フィールドを持たない）なら `checkoutAttempt: 0` を追加し
  （`stripeSessionId: null` 単独では不十分 — 下記の通り Option A は Stripe 呼び出し
  「前」に `checkoutAttempt` をインクリメントして予約するため、Stripe 応答待ちの間は
  `stripeSessionId` がまだ null のままになる。`checkoutAttempt: 0` を除外条件に使うことで
  この予約中ウィンドウの Order も削除対象から外れる）、
  Stripe Checkout が進行中の Order（Option B は `isPending: true` かつ `stripeSessionId`
  非 null、Option A は `checkoutAttempt` が 0 より大きい）を削除しない。このような Order が
  存在する場合は、`stripe.checkout.sessions.retrieve(stripeSessionId)` で状態を確認し、
  `status === 'open'` なら既存 Order と Cart 接続をそのまま再利用して redirect する
  （新規 Order を作らない）。`status` が `'expired'`/`'complete'` 以外の中断状態であれば
  Stripe 側のセッションを安全に終了させてから通常の削除・再作成フローに進む。
  こうすることで、confirm ルートが後から参照する Order を削除して外部キー・404 エラーを
  起こす事態を防ぐ。
- `updateCart` の再計算と Order 作成を含むトランザクションが、confirm ルートの
  `isPaid` 更新や別リクエストの `createOrderAction` と競合しないことを検証する
  並行実行テストを `__tests__/utils/order-actions.test.ts` に追加する。
- Prisma が対応する場合はこのトランザクションを `Serializable` で実行し、競合による
  シリアライズ失敗は安全に再試行するか、注文を作成せず明示的なエラーを返す。これが
  利用できない場合は、更新条件にカートの `updatedAt` を含める等の同等のバージョン検証を
  行い、不一致時は Order を作成しない。
- `:587` を `user.emailAddresses[0]?.emailAddress` にし、undefined の場合は
  `throw new Error("No email address found for user")` する。Plan 001 Step 6 で
  `renderError` が `ValidationError` 以外のメッセージを握りつぶす契約に変更される
  場合（`error instanceof ValidationError ? error.message : "there was an error"`）、
  この throw も `ValidationError`（Plan 001 で定義するカスタムクラス）を使うこと。
  そうしないとユーザーには汎用メッセージしか返らない。Plan 001 未実施の場合は
  通常の `Error` のままでよい。
- Order 作成時に、再計算した `currentCart.cartItems` の各行から `OrderItem`
  （Step 2 で追加済みのスキーマを使用）を同一トランザクションで作成する。各 `OrderItem`
  には `productId`、`productName`（作成時点の `product.name`）、`quantity`（cartItem の
  `amount`）、`unitPrice`（作成時点の `product.price`）を保存する。これが注文当時の
  商品構成・単価・商品名のスナップショットになり、以後カートや商品価格・商品名が
  変わっても注文内容は変化しない。`app/api/payment/route.ts:45` は現在
  `cartItem.product.name` を Stripe の `product_data.name` にそのまま使っているが、
  Step 4 でこれを `OrderItem.productName` から生成するように置き換える（商品が削除・
  改名されても注文当時の表示名が保たれる）。

**Verify**: `bunx vitest run __tests__/utils/order-actions.test.ts` → 全パス
（Step 内で期待値を新仕様に更新すること）

### Step 4: Stripe セッションの請求額を orderTotal に一致させる

`app/api/payment/route.ts`:
- `orderId` と `cartId` を取得した後、Order が永続化した `cartId` と取得した Cart の id
  が一致することを Stripe セッション作成前に検証する。一致しなければ 400 を返し、
  line_items の生成・Stripe 呼び出しは行わない。
- **Checkout Session 重複作成の扱い**（同一 `orderId` + `cartId` に対する二重リクエスト）:
  ネットワーク再試行やページリロードで同一 Order に対して payment ルートが複数回
  呼ばれると、Stripe に複数の Checkout Session が作成される可能性がある。
  この問題を本 Step で解消するために、以下の **2 つのアプローチのいずれかを選択**する:
  - **Option A — Stripe 冪等キー（推奨）**: `Order` の `stripeSessionId String?` と
    `checkoutAttempt Int @default(0)`（Step 2 で追加済み）を使い、
    `stripe.checkout.sessions.create` の第 2 引数に
    `{ idempotencyKey: \`checkout-${orderId}-${checkoutAttempt}\` }` を渡す。
    冪等キーは Stripe 側で**最低 24 時間**保持され、同一キーでの再リクエストには
    最初のセッションがそのまま返る。ただし Checkout Session 自体は 24 時間以内に
    `expired` になり得るため、同じキーを使い続けると期限切れセッションが返り続ける
    リスクがある。そこで再リクエスト時は次の手順を踏む:
    0. Stripe を呼び出す前に `order.isPaid` を判定する。`true` なら Stripe 呼び出し・
       `create` はいずれも行わず、支払い済みである旨のエラー（再 Checkout 不可）を
       返して終了する。
    0.5. **予約（Stripe 呼び出し前）**: `stripeSessionId` が未保存（初回リクエスト）
       の場合、Stripe を呼び出す**前**に `checkoutAttempt` をインクリメントする
       アトミックな条件付き更新で Order を予約する:

       ```ts
       const reserved = await db.order.updateMany({
         where: { id: orderId, isPaid: false, checkoutAttempt: readCheckoutAttempt, stripeSessionId: null },
         data: { checkoutAttempt: { increment: 1 } },
       });
       ```

       `reserved.count === 0` の場合は別リクエストが先に予約済みのため、Order を
       再読込して手順 1 からやり直す。`reserved.count === 1` の場合のみ
       `readCheckoutAttempt + 1` を `usedCheckoutAttempt` として Stripe を呼び出す。
       この予約により、`createOrderAction`（Step 3）の未払い Order 削除は
       `checkoutAttempt: 0` を除外条件とするため、Stripe 応答待ちの間
       （`stripeSessionId` がまだ書き込まれていない区間）もこの Order を
       削除対象から除外できる。
    1. `stripeSessionId` が保存済みなら、まず
       `stripe.checkout.sessions.retrieve(stripeSessionId)` で現在の状態を取得する
       （新規 `create` 呼び出しより先に行う）。
    2. `status === 'open'` ならそのセッションをそのまま再利用し `clientSecret` を返す。
       新しい `create` は呼ばない。
    3. `status === 'complete'` の場合は明示的な終端ケースとして扱う。`create` は
       呼ばず、`isPaid` がまだ `false` なら既存の決済確定処理（confirm ルート）へ
       委譲するか、再 Checkout 不可のエラーを返す。新規セッションを作成しない。
    4. `status === 'expired'` と確認できた場合のみ、手順 1 で読み取った
       `stripeSessionId` と `checkoutAttempt` の値を `where` に含めた**アトミック**な
       条件付き更新でリセットする:

       ```ts
       const reset = await db.order.updateMany({
         where: { id: orderId, stripeSessionId: readStripeSessionId, checkoutAttempt: readCheckoutAttempt },
         data: { stripeSessionId: null, checkoutAttempt: { increment: 1 } },
       });
       ```

       `reset.count === 1` の場合のみ、新しい `idempotencyKey`
       （`checkout-${orderId}-${readCheckoutAttempt + 1}`）で新規セッションを作成する。
       `reset.count === 0` の場合は、別リクエストが同じ Order を先にリセット・再作成済み
       であることを意味するため、新規作成せず Order を再読込して手順 1 からやり直す
       （読み取った値が古いまま新規セッションを作成し、他リクエストが直前に保存した
       有効な `stripeSessionId` を上書きする事態を防ぐ）。`expired` を確認する前に
       冪等キーを変えて新規作成しない。
    作成に成功したら、その作成に使った試行世代（新規作成時は手順 0.5 で予約した
    `checkoutAttempt`、手順 4 のリセットを経た場合は `readCheckoutAttempt + 1`）と
    `stripeSessionId: null` を条件にした compare-and-set で保存する:

    ```ts
    const saved = await db.order.updateMany({
      where: { id: orderId, checkoutAttempt: usedCheckoutAttempt, stripeSessionId: null },
      data: { stripeSessionId: session.id },
    });
    ```

    `saved.count === 0` の場合、別リクエストが同じ試行世代の間に既に
    `stripeSessionId` を保存済み（同一 `idempotencyKey` により同一セッションを
    取得し先に保存した等）であることを意味する。この場合は保存済みの値を
    上書きせず、`Order` を再読込して `stripeSessionId`/`checkoutAttempt` を
    最新化してからレスポンスを返す。
    **作成失敗時**: `stripe.checkout.sessions.create` が例外をスローした場合、
    Stripe SDK の例外種別で「セッションが作成された可能性があるか」を分類し、
    分類ごとに異なる扱いをする（`checkoutAttempt` を進めて `idempotencyKey` を
    変えてしまうと、実際には作成済みだったセッションと不整合な新規キーで
    再試行することになり、孤立したセッションや二重作成を招くため）:

    - **接続不明**（`Stripe.errors.StripeConnectionError` やタイムアウトなど、
      Stripe にリクエストが到達したか不明な場合）・**Session 作成済みの可能性が
      ある場合**（`Stripe.errors.StripeAPIError` や 5xx 応答など、Stripe 側で
      処理が進んだ後にエラーが返った場合）: `checkoutAttempt` を進めず、同じ
      `idempotencyKey`（`checkout-${orderId}-${checkoutAttempt}`）を保持したまま
      エラーを呼び出し元に返す（`isPending` のような DB フラグは Option A では
      使わないため解放処理は不要）。次回リクエストは同じ `idempotencyKey` で
      再試行され、実際にはセッションが作成済みだった場合は Stripe が同一
      セッションを返し、未作成だった場合はそのまま新規作成される。冪等キー
      自体が二重作成を防ぐため、追加の DB ロックは不要。
    - **確定的な作成失敗**（`Stripe.errors.StripeInvalidRequestError` や
      `StripeCardError` など、Stripe がリクエストをバリデーション段階で拒否し
      セッションが作成されなかったことが確定している場合）: セッションは
      作成されていないため `checkoutAttempt` はそのまま据え置き、同じ
      `idempotencyKey` を保持したままエラーを呼び出し元に返す（Stripe は
      確定的なバリデーションエラーを冪等キーに紐付けて保存しないため、
      呼び出し元が入力を修正すれば同じキーで再試行しても新規リクエストとして
      扱われる）。このケースは呼び出し元のリクエスト内容に起因するため、
      `checkoutAttempt` の増加（新しい `idempotencyKey` の発行）は不要かつ
      無意味である。
    **並行テスト（Option A）**: 同一 `orderId` に対して 2 つのリクエストを同時に
    送るシナリオのユニットテストを `__tests__/api/payment-route.test.ts` に追加し、
    Stripe に渡される `idempotencyKey` が両リクエストで同一であること、および
    両リクエストが同じ `session.id` を受け取ることを検証する。

    **並行テスト（`createOrderAction` と Stripe 呼び出しの競合）**:
    `__tests__/utils/order-actions.test.ts` に、手順 0.5 の予約（`checkoutAttempt`
    インクリメント）が完了しモックした `stripe.checkout.sessions.create` の
    解決が保留されている間に `createOrderAction` を実行するテストを追加し、
    未払い Order 削除の `deleteMany` の `where` に予約済み Order が一致しない
    （＝削除されない）ことを検証する。
  - **Option B — Order の処理中フラグ**: `Order` モデルの `isPending Boolean @default(false)`
    フィールドと `stripeSessionId String?` フィールド（Step 2 で追加済み）を使う。
    予約の `updateMany` より**先に**、読み込み済みの Order が既に `stripeSessionId` を
    持っていないか確認する。これを怠ると、既に `isPending: true` かつ有効な
    `stripeSessionId` を持つ Order への正当な再リクエスト（ページ再読み込み等）が、
    後述の再利用ロジックに到達する前に予約 `updateMany` の 409 で弾かれてしまう。

    1. `order.stripeSessionId` が既に保存されている場合、
       `stripe.checkout.sessions.retrieve(stripeSessionId)` で現在の状態を取得する
       （予約 `updateMany` は呼ばない）。
       - `status === 'open'` ならそのまま `clientSecret` を返す（重複 Stripe 呼び出し
         なし、予約更新も不要）。
       - `status === 'complete'` の場合は明示的な終端ケースとして扱い、新規作成は
         せず、`isPaid` がまだ `false` なら confirm ルートへ委譲するか再 Checkout
         不可のエラーを返す。
       - `status === 'expired'` の場合のみ、以下の条件付き更新で「処理中」状態を
         解放してから、手順 2 の予約フローに進む:

         ```ts
         await db.order.updateMany({
           where: { id: orderId, isPending: true, isPaid: false },
           data: { isPending: false, stripeSessionId: null },
         });
         // その後、通常の予約・セッション作成フローに戻る（isPending: false に
         // 戻ったため再度 updateMany による予約が可能）
         ```

    2. `order.stripeSessionId` が存在しない場合（初回、または上記の期限切れ回収後）、
       以下の**アトミック**な更新で「処理中」予約を確保してからセッションを作成する:

       ```ts
       const reserved = await db.order.updateMany({
         where: { id: orderId, isPending: false, isPaid: false },
         data: { isPending: true },
       });
       if (reserved.count !== 1) return new Response(null, { status: 409 });
       ```

       `where` に `isPaid: false` を追加することで、決済済み（`isPaid: true`）の Order に
       対しては予約が通らず、再チェックアウトを防止できる。`updateMany` は条件を満たす
       場合のみ更新するため、同時リクエストがゼロ件更新（`count === 0`）となり 409 で
       拒否される。この方式は read-then-write ではなく単一の条件付き write であるため、
       競合状態が生じない。手順 1 で既存の open/expired セッションを先に処理して
       いるため、この 409 は「同時に初回作成を試みた」場合にのみ発生し、正当な
       リトライを誤って拒否しない。

    **払済 Order の競合テスト**: `__tests__/api/payment-route.test.ts` に以下のテスト
    ケースを追加すること: `isPaid: true` の Order に対して payment ルートを呼ぶと
    409（または適切なエラーレスポンス）を返し、Stripe の `checkout.sessions.create` が
    呼ばれず、新しい Checkout Session が作成されないことを確認する。

    **既存セッションの再利用テスト**: `isPending: true` かつ有効な `stripeSessionId`
    を持つ Order に対して payment ルートを呼ぶと、予約 `updateMany`（および 409）を
    経由せず `stripe.checkout.sessions.retrieve` が呼ばれ、`status === 'open'` なら
    既存の `clientSecret` がそのまま返ることを検証する。

    **Stripe セッション ID の保存**: `stripe.checkout.sessions.create` が成功したら、
    返却された `session.id` を `stripeSessionId` フィールドに保存する
    (`data: { stripeSessionId: session.id }`)。

    **Stripe セッション作成失敗時の解放（Option B）**: `stripe.checkout.sessions.create`
    が例外をスローした場合、単純な `finally` による無条件解放は confirm ルートとの
    競合を生じさせるため使用しない。ネットワーク障害など不確定な失敗では
    Stripe 側でセッションが作成済みの可能性があるが、Option B は冪等キーを
    使わないため作成済みセッションの照会手段を持たない。したがって catch 内では
    条件付き解放のみを行い、不確定な失敗時にセッションが作成済みであっても
    `isPending` を解放するリスクを許容する:

      ```ts
      catch (err) {
        await db.order.updateMany({
          where: { id: orderId, isPending: true, isPaid: false },
          data: { isPending: false, stripeSessionId: null },
        });
        throw err; // または適切なエラーレスポンスを返す
      }
      ```

    `isPaid: false` を条件に含めることで、confirm ルートが `isPaid: true` に
    更新した後に誤って `isPending` を解放することを防ぐ。
    **成功時の `stripeSessionId` 保存（`data: { stripeSessionId: session.id }`）と
    上記の条件付き解放は維持すること**。この不確定リスクを避けたい場合は
    Option A（冪等キー）を選ぶこと。

    **決済期限切れ時の回収**: return_url に戻ってきたユーザーが決済を完了せず
    ページを離れただけの場合（いわゆる「キャンセル」）、Checkout Session は
    `expires_at` に達するまで `open` のままであるため、上記の既存セッション確認
    ロジック（`status === 'open'` なら既存の `clientSecret` をそのまま返す）が
    適用され、リセットは不要かつ行ってはならない。Stripe 側が `expires_at` 超過で
    セッションを `expired` へ遷移させた場合に限り、Webhook（Plan 006 Step 1）で
    `checkout.session.expired` イベントを受け取り、上記と同様の条件付き更新で
    `isPending: false` / `stripeSessionId: null` に戻す。Plan 006 が未実装の場合は、
    payment ルートの既存セッション確認時に `status === 'expired'` を検出した段階で
    インラインで回収する（上記の回収手順）。

    **Step 5 のクリーンアップ（Option B のみ）**: confirm ルート（Step 5）で
    `isPaid: true` にする際に `isPending: false` に戻す
    (`data: { isPaid: true, isPending: false }`)。この更新は `isPending: true` を
    条件に含めなくてよい（confirm は最終状態遷移であり、ここでの `isPending` 解放は
    副次的なクリーンアップ）。Option A を選択した場合は `isPending` フィールド自体が
    存在しないため、この Step 5 の変更は不要。

    **並行テスト（Option B）**: 同一 `orderId` に対して 2 つのリクエストを同時に
    送るシナリオのユニットテストを `__tests__/api/payment-route.test.ts` に追加し、
    1 つが 200、もう 1 つが 409 を返すこと、および Stripe が 1 度だけ呼ばれることを
    検証する。また、Stripe 作成失敗後に `isPending` が `false` に戻ること
    （条件付き更新が実行されること）、および期限切れセッション検出後の回収が
    動作することも検証する。
    **注意**: このアプローチはスキーマ変更を伴うため Plan 004 のマイグレーションと
    競合しないよう実行順を調整すること。
  - **STOP 条件**: 両アプローチとも実装困難な事情（環境制約・既存テストとの干渉）が
    ある場合は実装を中断して報告する。重複 Session 問題の解消を Plan 006（Webhook
    実装）の前提として残す場合は、その旨をメンテナーに確認すること。Plan 006 の
    6-1（Stripe Webhook）は本 Step の重複問題が未解消でも着手できるが、Webhook の
    冪等処理と本 Step の重複対策が二重防衛になることを前提として設計すること。
- `Origin` ヘッダは return URL の基準に使わない。デプロイ設定で管理する canonical
  origin（例: `APP_URL`）を `new URL` で検証し、許可した scheme/host のみを使って
  `return_url` を組み立てる。設定が欠落・不正なら 400 を返す。null Origin の 400
  ハンドリングは維持するが、任意の Origin を受け入れる根拠にはしない。
- line_items の商品行を、`cart.cartItems`（現在のカート内容・現在の商品価格）ではなく
  Order に紐づく `OrderItem`（Step 3 で保存した注文時点のスナップショット）から生成する。
  `product_data.name` には `orderItem.productName` を使い、`Product` テーブルを
  再読込しない（現在の `app/api/payment/route.ts:45` の `cartItem.product.name` 参照を
  置き換える）。こうすることで、注文作成後にカートの中身・商品価格・商品名が変わっても、
  また商品が削除されても、Stripe への請求内容が注文時点のまま保たれる。
- tax と shipping の line item は、Cart の現在値ではなく Order 自身が保持する
  `order.tax` / `order.shipping`（`Order` モデルに既存のフィールド。作成時に
  Step 3 で永続化済み）を使う:

  ```ts
  if (order.tax > 0) line_items.push({ quantity: 1, price_data: {
      currency: "usd", product_data: { name: "Tax" },
      unit_amount: order.tax * 100 } });
  if (order.shipping > 0) line_items.push({ /* 同様に Shipping、order.shipping を使用 */ });
  ```

- セッション作成前にアサーションを追加: line_items の合計
  （`sum(unit_amount * quantity)`）が `order.orderTotal * 100` と一致しない場合は
  500 を返し `console.error` する（金額乖離の早期検知）。OrderItem/order.tax/
  order.shipping から組み立てている限り、この合計は常に `order.orderTotal` と
  一致するはずであり、不一致はスナップショットの取り違えを示す。

Plan 002 の `payment-route.test.ts` の期待値を「line_items 合計 = orderTotal × 100」に更新し、
Order と Cart の関係が一致しない 400、無効/未許可の origin で Stripe が呼ばれないことを
追加する。冪等キー（Option A 選択時）または isPending フラグ（Option B 選択時）の
動作テストを追加すること。

**Verify**: `bunx vitest run __tests__/api/payment-route.test.ts` → 全パス

### Step 5: confirm ルートの状態遷移を修正する

`app/api/confirm/route.ts`:
- `session_id` が null なら 400 を返す（`as string` キャスト除去）。
- 支払い確認を `const paymentConfirmed = session.status === "complete" &&
  session.payment_status === "paid";` として算出する。
- Stripe セッション取得後、**database 更新より前**に `session.metadata.orderId` と
  `session.metadata.cartId` がともに空でない文字列であることを runtime で検証する。
  欠落・空文字列・文字列以外なら 400 を返し、order 更新も cart 削除も行わない。
- リポジトリの規約（`const { userId } = await auth()`、`utils/actions.ts` 参照）
  に従い、`@clerk/nextjs/server` の `auth()` を `await` し `userId` を分割代入で
  取得する。未認証（`userId` が falsy）なら 401 を返す。
  `orderId` の検証後、database 更新より前に `db.order.findUnique` で Order を読み込み、
  存在しない、または `order.clerkId !== userId` の場合は 403 を返し、`db.order.update`
  と `db.cart.delete` のいずれも実行しない（Plan 001 で payment ルートに追加する
  所有権チェックと同じパターン — セッション ID を知っている第三者が他ユーザーの
  注文/カートを操作できないようにする）。
- **冪等性**: 読み込んだ Order が既に `order.isPaid === true` かつ所有者が一致する
  場合（決済完了後の再訪・二重送信などで cart が既に削除済みのケースを含む）は、
  Cart の存在チェックを行わずに成功として扱う（`db.order.update` は呼ばず、
  cart が null でも 403 にせずそのまま `/orders` へ redirect）。
  **注意**: 支払い済み（`isPaid === true`）の Order に対しては、以下の `cartId`
  一致検証（未完了 Order 分岐）を適用しない。
- Order がまだ `isPaid !== true`（未完了）の場合、まず `paymentConfirmed` を検査する:
  偽（未完了・未払いの Session）なら `db.$transaction` を実行せず、Order 更新も
  Cart 削除も一切行わずに終了し、400（または適切なエラーレスポンス）を返す。
  以下の `cartId` 一致検証とトランザクション処理は `paymentConfirmed` が真の
  場合にのみ実施する: `paymentConfirmed` が真と判定された直後、`db.$transaction`
  を開始する前に、`session.amount_total` と `order.orderTotal * 100` を照合する。
  一致しない場合は 400 を返し、Order・Cart のいずれも変更せずに終了する
  （Order 作成後に商品価格が変わった、またはセッションが別注文のものである
  ケースの早期検知 — Step 4 で追加するセッション作成時のアサーションと対になる）。
  金額が一致した場合のみ、Cart を取得した後かつ
  `db.$transaction` 実行前に、`order.cartId`（DB に永続化済み）と
  `session.metadata.cartId`（Stripe メタデータ由来）が一致することを検証する。
  不一致の場合は 400 を返し、Order 更新も Cart 削除も行わない。
  その後、従来どおり `db.cart.findUnique` で Cart を読み込み、存在し
  `cart.clerkId === userId` であることを確認してから未完了 Order 分岐内で
  `db.order.update` と `db.cart.delete` を実行する。
  **この 2 操作は必ず `db.$transaction(async (tx) => { ... })` で包むこと**:
  どちらかが失敗した場合に両方がロールバックされ、「Order が paid になったが Cart が
  残る」または「Cart が消えたが Order が unpaid のまま」という不整合が生じない。
  実装例:

  ```ts
  await db.$transaction(async (tx) => {
    await tx.order.update({ where: { id: orderId }, data: { isPaid: true } });
    await tx.cart.deleteMany({ where: { id: cartId } });
  });
  ```

  Cart が存在しない、または所有者が一致しない場合は 403 を返し、更新・削除のいずれも行わない。
- `db.cart.delete` は上記の未完了 Order 分岐の**内側**の `$transaction` ブロックに移動する
  （未完了セッションでカートを消さない）。cart が既に削除済み（リロード等での再訪）の場合に
  Prisma の P2025 エラーで 500 にならないよう `deleteMany({ where: { id: cartId } })` を
  使う（冪等化）。`deleteMany` はゼロ件削除でも例外を投げない。

Plan 002 の `confirm-route.test.ts` の期待値を更新:
未完了セッション、無効な metadata、`orderId` の所有者が呼び出しユーザーと一致しない
場合では order 更新も cart 削除も行われないこと。加えて、既に `isPaid: true` かつ
所有者が一致する Order に対し cart が既に存在しない状態で再訪した場合は 403 ではなく
成功として扱われること（冪等な再送）。また、`db.order.update` が成功して
`db.cart.deleteMany` が失敗するシナリオ（モックで throwさせる）でも Order の
`isPaid` が true にならないこと（トランザクションのロールバック確認）を追加すること。

**Verify**: `bunx vitest run __tests__/api/confirm-route.test.ts` → 全パス

### Step 6: CLAUDE.md の価格単位の記載を実装に合わせる

CLAUDE.md の「価格は **セント単位の整数**（`Int`）で保存」を以下の趣旨に修正:
「価格（`Product.price` とカート/注文の金額列）は**ドル単位の整数**で保存。
表示は `utils/format.ts` の `formatCurrency` にそのまま渡し、Stripe 送信時のみ
×100 でセントに変換する」。同様の記載が「コーディング規約」セクションにも
あれば合わせて修正する。

**Verify**: `grep -n "セント" CLAUDE.md` → 「Stripe 送信時のみ」の文脈以外に
「セント単位で保存」という記載が残っていない

### Step 7: 全体検証

**Verify**:
- `bun run test` → 全パス
- `bunx tsc --noEmit` → exit 0
- `bun run lint` → exit 0

## Test plan

- Plan 002 の characterization テストの期待値更新が本体（各 Step 内で実施）。
- 追加ケース: Order 作成が同一 transaction 内で更新した cart のスナップショットだけを
  使用し、競合検出時には Order を作成しないこと。
- 追加ケース: line_items 合計と orderTotal の一致アサーション、Order と Cart の関係が
  不一致なら Stripe を呼ばず 400、未許可 origin なら Stripe を呼ばないこと（Step 4）。
- 追加ケース: confirm の冪等性（同一 session_id で 2 回呼んでもエラーにならない。
  既に isPaid かつ所有者が一致する Order に対し cart が既に削除済みでも 403 にならない）、
  metadata の orderId/cartId が欠落・空・非文字列なら 400 で DB を更新しないこと、
  未認証なら 401、Order の所有者が呼び出しユーザーと一致しなければ 403 を返し
  DB を更新しないこと（Step 5）。

## Done criteria

- [ ] `bun run test` が exit 0（Plan 002 のテスト含む全パス）
- [ ] `bunx tsc --noEmit` / `bun run lint` が exit 0
- [ ] `grep -n "Math.round" utils/actions.ts` が updateCart 内でヒットする
- [ ] `grep -n "payment_status" app/api/confirm/route.ts` がヒットする
- [ ] `grep -c "shipping" app/api/payment/route.ts` が 1 以上
- [ ] payment ルートは Order の永続化済み cartId とリクエスト cartId の一致を確認してから Stripe を呼ぶ
- [ ] payment ルートの line_items は `OrderItem`（注文時スナップショット）と
      `order.tax` / `order.shipping` から生成され、`cart.cartItems` の現在価格を
      直接使っていない
- [ ] confirm ルートは metadata の orderId/cartId を DB 更新前に検証し、無効なら 400 を返す
- [ ] confirm ルートは `auth()` の userId と Order の clerkId を DB 更新前に照合し、
      未認証なら 401、Order 所有者不一致なら 403 を返す。未完了 Order では Cart の
      所有者も照合し、不一致なら 403 で `db.order.update`/`db.cart.delete` を実行しない。
      既に isPaid な自分の Order への再訪は cart の有無に関わらず成功として扱う
- [ ] Drift check と同じ 4 コマンド（`git diff --stat <base>..HEAD`, `git diff --cached --stat`,
      `git diff --stat`, `git ls-files --others --exclude-standard`、いずれも Scope パス限定）を
      完了時にも実行し、コミット済み・ステージ済み・未ステージ・未追跡のいずれにも
      in-scope 外のファイルが含まれない（`git status` 単独はコミット済み変更を見逃すため使わない）
- [ ] `plans/README.md` のステータス行を更新済み

## STOP conditions

- Plan 002 のテストファイルが存在しない（依存プラン未完了 — 先に 002 を実行）。
- `updateCart` / confirm ルートの実コードが「Current state」の抜粋と一致しない
  （Plan 001 の payment ルート認可追加を除く）。
- Stripe の Embedded Checkout で line_items 方式の税・送料追加が UI 上の要件と
  衝突すると判明した場合（`automatic_tax` や `shipping_options` への切り替えは
  設計判断が必要 — 報告して指示を待つ）。
- 丸め方針（Math.round）で既存データとの不整合が発覚した場合。

## Maintenance notes

- 将来 Stripe Webhook（Plan 006 の DIRECTION-01）を導入する際、Step 5 の
  isPaid 遷移ロジックを webhook ハンドラに移設し、confirm ルートは UX 用の
  リダイレクトのみに縮退させること。
- 税率を変更する場合は `Cart.taxRate` のデフォルト値（schema）と
  characterization テストの期待値を同時に更新すること。
- レビュー観点: 金額に関わる変更は必ず「Stripe 請求額 = Order.orderTotal」の
  アサーション（Step 4）を維持していること。
