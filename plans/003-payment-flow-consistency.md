# Plan 003: 決済フローの金額整合性と状態遷移を修正する

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: `git diff --stat 90f91f4..HEAD -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts CLAUDE.md`
> Plan 001 による `app/api/payment/route.ts` の認可チェック追加は想定内のドリフト。
> それ以外の in-scope 変更は「Current state」と比較し、不一致は STOP。

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

### Step 2: createOrderAction で合計を再計算する

`utils/actions.ts:561-597`:
- カートの再計算、合計の永続化、未払い注文の削除、Order 作成を同一の
  `db.$transaction` で実行する。`updateCart` はトランザクションクライアントを受け取れる
  ようにし、その `tx` で最新の cartItems/product を再読込して計算・更新する。作成する
  Order はその `currentCart` スナップショットの `numItemsInCart`、`orderTotal`、`tax`、
  `shipping` だけを使う。再計算と Order 作成の間に別リクエストの変更を取り込まないこと。
- Prisma が対応する場合はこのトランザクションを `Serializable` で実行し、競合による
  シリアライズ失敗は安全に再試行するか、注文を作成せず明示的なエラーを返す。これが
  利用できない場合は、更新条件にカートの `updatedAt` を含める等の同等のバージョン検証を
  行い、不一致時は Order を作成しない。
- `:587` を `user.emailAddresses[0]?.emailAddress` にし、undefined の場合は
  `throw new Error("No email address found for user")`（renderError 経由で
  ユーザーにメッセージが返る）。

**Verify**: `bunx vitest run __tests__/utils/order-actions.test.ts` → 全パス
（Step 内で期待値を新仕様に更新すること）

### Step 3: Stripe セッションの請求額を orderTotal に一致させる

`prisma/schema.prisma` に Cart-to-Order 関係を追加し、`createOrderAction` で作成する
Order に現在の Cart を接続して `cartId` を永続化する。confirm ルートが Cart を削除しても
注文履歴を削除しないよう、既存注文に対応できる optional relation と `onDelete: SetNull`
を使う。生成された Prisma マイグレーションをコミットする。

`app/api/payment/route.ts`:
- `orderId` と `cartId` を取得した後、Order が永続化した `cartId` と取得した Cart の id
  が一致することを Stripe セッション作成前に検証する。一致しなければ 400 を返し、
  line_items の生成・Stripe 呼び出しは行わない。
- `Origin` ヘッダは return URL の基準に使わない。デプロイ設定で管理する canonical
  origin（例: `APP_URL`）を `new URL` で検証し、許可した scheme/host のみを使って
  `return_url` を組み立てる。設定が欠落・不正なら 400 を返す。null Origin の 400
  ハンドリングは維持するが、任意の Origin を受け入れる根拠にはしない。
- line_items に tax と shipping の項目を追加する（cart の保存値を使用）:
  ```ts
  if (cart.tax > 0) line_items.push({ quantity: 1, price_data: {
      currency: "usd", product_data: { name: "Tax" },
      unit_amount: cart.tax * 100 } });
  if (cart.shipping > 0 && cart.cartItems.length > 0) line_items.push({ /* 同様に Shipping */ });
  ```
  ※ `cart.shipping` はスキーマ上「カートが空でなければ 5（ドル）」の固定送料。
  Step 1 で shipping が永続化されるようになったため cart の保存値を使ってよい。
- セッション作成前にアサーションを追加: line_items の合計
  （`sum(unit_amount * quantity)`）が `order.orderTotal * 100` と一致しない場合は
  500 を返し `console.error` する（金額乖離の早期検知）。

Plan 002 の `payment-route.test.ts` の期待値を「line_items 合計 = orderTotal × 100」に更新し、
Order と Cart の関係が一致しない 400、無効/未許可の origin で Stripe が呼ばれないことを
追加する。

**Verify**: `bunx vitest run __tests__/api/payment-route.test.ts` → 全パス

### Step 4: confirm ルートの状態遷移を修正する

`app/api/confirm/route.ts`:
- `session_id` が null なら 400 を返す（`as string` キャスト除去）。
- 支払い確認を `session.status === "complete" && session.payment_status === "paid"`
  に強化する。
- Stripe セッション取得後、**database 更新より前**に `session.metadata.orderId` と
  `session.metadata.cartId` がともに空でない文字列であることを runtime で検証する。
  欠落・空文字列・文字列以外なら 400 を返し、order 更新も cart 削除も行わない。
- `db.cart.delete` を上記 if の**内側**に移動する（未完了セッションでカートを
  消さない）。cart が既に削除済み（リロード等での再訪）の場合に Prisma の
  P2025 エラーで 500 にならないよう、`deleteMany({ where: { id: cartId } })` に
  変更するか try-catch で P2025 を無視する（冪等化）。

Plan 002 の `confirm-route.test.ts` の期待値を更新:
未完了セッション、および無効な metadata では order 更新も cart 削除も行われない。

**Verify**: `bunx vitest run __tests__/api/confirm-route.test.ts` → 全パス

### Step 5: CLAUDE.md の価格単位の記載を実装に合わせる

CLAUDE.md の「価格は **セント単位の整数**（`Int`）で保存」を以下の趣旨に修正:
「価格（`Product.price` とカート/注文の金額列）は**ドル単位の整数**で保存。
表示は `utils/format.ts` の `formatCurrency` にそのまま渡し、Stripe 送信時のみ
×100 でセントに変換する」。同様の記載が「コーディング規約」セクションにも
あれば合わせて修正する。

**Verify**: `grep -n "セント" CLAUDE.md` → 「Stripe 送信時のみ」の文脈以外に
「セント単位で保存」という記載が残っていない

### Step 6: 全体検証

**Verify**:
- `bun run test` → 全パス
- `bunx tsc --noEmit` → exit 0
- `bun run lint` → exit 0

## Test plan

- Plan 002 の characterization テストの期待値更新が本体（各 Step 内で実施）。
- 追加ケース: Order 作成が同一 transaction 内で更新した cart のスナップショットだけを
  使用し、競合検出時には Order を作成しないこと。
- 追加ケース: line_items 合計と orderTotal の一致アサーション、Order と Cart の関係が
  不一致なら Stripe を呼ばず 400、未許可 origin なら Stripe を呼ばないこと（Step 3）。
- 追加ケース: confirm の冪等性（同一 session_id で 2 回呼んでもエラーにならない）、
  metadata の orderId/cartId が欠落・空・非文字列なら 400 で DB を更新しないこと（Step 4）。

## Done criteria

- [ ] `bun run test` が exit 0（Plan 002 のテスト含む全パス）
- [ ] `bunx tsc --noEmit` / `bun run lint` が exit 0
- [ ] `grep -n "Math.round" utils/actions.ts` が updateCart 内でヒットする
- [ ] `grep -n "payment_status" app/api/confirm/route.ts` がヒットする
- [ ] `grep -c "shipping" app/api/payment/route.ts` が 1 以上
- [ ] payment ルートは Order の永続化済み cartId とリクエスト cartId の一致を確認してから Stripe を呼ぶ
- [ ] confirm ルートは metadata の orderId/cartId を DB 更新前に検証し、無効なら 400 を返す
- [ ] `git status` で in-scope 外のファイルに変更がない
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

- 将来 Stripe Webhook（Plan 006 の DIRECTION-01）を導入する際、Step 4 の
  isPaid 遷移ロジックを webhook ハンドラに移設し、confirm ルートは UX 用の
  リダイレクトのみに縮退させること。
- 税率を変更する場合は `Cart.taxRate` のデフォルト値（schema）と
  characterization テストの期待値を同時に更新すること。
- レビュー観点: 金額に関わる変更は必ず「Stripe 請求額 = Order.orderTotal」の
  アサーション（Step 3）を維持していること。
