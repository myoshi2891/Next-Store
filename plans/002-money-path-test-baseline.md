# Plan 002: 金額・注文・決済パスの挙動テスト基盤を確立する

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: `git diff --stat 90f91f4..HEAD -- utils/actions.ts app/api/payment/route.ts app/api/confirm/route.ts __tests__/`
> in-scope 対象のソースが変わっていたら「Current state」の抜粋と比較し、
> 不一致は STOP condition として扱う。

## Status

- **Priority**: P1
- **Effort**: L
- **Risk**: LOW（テスト追加のみ — プロダクションコードは変更しない）
- **Depends on**: plans/001-security-authorization-hardening.md（payment ルートの 401/403 契約をテストするため）。Plan 003 はこのプランの完了が前提。
- **Category**: tests
- **Planned at**: commit `90f91f4`, 2026-07-05

## Why this matters

e-commerce アプリの収益クリティカルなロジック — カート合計計算、注文作成、
Stripe 決済セッション、支払い確定（`isPaid` 遷移）— に自動テストが 1 件もない。
既存の 38 テストの大半はソースファイルを `readFileSync` して文字列を grep する
「見せかけのテスト」で、挙動を検証していない。Plan 003（決済フロー修正）は
金額計算を変更するため、**先にこのプランで現在の挙動を固定（characterization）
しないと、修正の正しさを機械的に検証できない**。

## Current state

- テストは `__tests__/` に 10 ファイル / 38 テスト。`bun run test` で全パス（~2秒）。
- 文字列 grep 型のテスト（挙動を検証していない）:
  - `__tests__/migration/async-auth.test.ts` — ソースに `await` が含まれるかを `toContain` で確認
  - `__tests__/migration/react19-compat.test.ts` — 同様のソース文字列検査
  - `__tests__/utils/actions-type-safety.test.ts` — 型注釈の文字列を正規表現で検査
  - `__tests__/security/vulnerability-fixes.test.ts` — package.json のバージョン文字列を検査
- テスト対象となる金額ロジック（**このプランでは変更しない — 読むだけ**）:
  - `utils/actions.ts:449-488` — `updateCart`: cartItems を集計し
    `cartTotal`（`amount * product.price` の合計）、`tax = cart.taxRate * cartTotal`、
    `shipping = cartTotal ? cart.shipping : 0`、`orderTotal = cartTotal + tax + shipping`
    を計算して `db.cart.update` で永続化する。**注意: line 482 で `shipping` の
    永続化がコメントアウトされている。また `tax` は Float になり得るが
    `Cart.tax` は Int 型（prisma/schema.prisma:63）** — これは既知の問題で
    Plan 003 が修正する。characterization テストは現在の計算式を記録すること。
  - `utils/actions.ts:561-597` — `createOrderAction`: 未払い注文を `deleteMany` で
    削除後、cart の保存済み合計値から Order を作成し `/checkout` へ redirect。
    `user.emailAddresses[0].emailAddress`（587）は要素 0 の存在を仮定している。
  - `utils/actions.ts:414-447` — `updateOrCreateCartItem`: findFirst → update/create。
  - `app/api/payment/route.ts:39-51` — Stripe line_items は
    `unit_amount: cartItem.product.price * 100` で **商品小計のみ**（tax/shipping なし）。
  - `app/api/confirm/route.ts:11-30` — `session.status === "complete"` で
    `isPaid: true` に更新。**cart 削除（26-30）は if の外で無条件実行**。
- 価格の単位: コードの実挙動は「`Product.price` はドル整数」
  （`utils/format.ts:1-7` の `formatCurrency` が値をそのまま USD 表示、
  Stripe 送信時に ×100）。CLAUDE.md の「セント単位で保存」という記載は
  実態と不一致（Plan 003 がドキュメントを修正する）。
- モック方針の参考: `vitest.setup.ts` と `__tests__/components/form/FormContainer.test.tsx`
  が既存のモックパターン（`vi.mock`）の手本。
- テスト設定: `vitest.config.ts`（jsdom、`@` エイリアス設定済み）。

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `bun install`       | exit 0              |
| Tests     | `bun run test`      | 全パス（ベースライン: 10 files / 38 tests） |
| 単一ファイル | `bunx vitest run __tests__/utils/cart-calculations.test.ts` | 対象のみ実行され全パス |
| Typecheck | `bunx tsc --noEmit` | exit 0              |

## Scope

**In scope**（作成・変更してよいファイル）:
- `__tests__/utils/cart-calculations.test.ts`（新規）
- `__tests__/utils/order-actions.test.ts`（新規）
- `__tests__/api/payment-route.test.ts`（新規）
- `__tests__/api/confirm-route.test.ts`（新規）
- `__tests__/utils/schemas.test.ts`（新規）

**Out of scope**（触らない）:
- `utils/actions.ts`, `app/api/**` などプロダクションコード全般 —
  **このプランは 1 行たりともプロダクションコードを変更しない**。
  テストを通すためにソースを直したくなったら、それは Plan 003 の発見事項として
  STOP して報告する。
- 既存の文字列 grep 型テストの削除・書き換え — 挙動テストが揃った後の
  別作業（plans/README.md の deferred 事項）。

## Git workflow

- ブランチ: `advisor/002-money-path-tests`
- コミット形式: `test(<scope>): <subject>`（例: `test(actions): updateCart の合計計算テストを追加`）
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: Prisma クライアントのモックヘルパーを用意する

`utils/db.ts` は Prisma クライアントのシングルトンを default export している。
各テストファイルで `vi.mock("@/utils/db")` し、使用するモデルメソッド
（`cart.update`, `cartItem.findMany`, `order.create` 等)を `vi.fn()` で差し替える。
共通化が必要なら `__tests__/helpers/mock-db.ts` を作ってよい（in scope に追加）。

Clerk は `vi.mock("@clerk/nextjs/server")` で `auth`/`currentUser` をモック、
`next/navigation` の `redirect` と `next/cache` の `revalidatePath` もモックする
（redirect は Next.js 実装では throw するため、`vi.fn()` で throw する実装を推奨）。

**Verify**: `bun run test` → 既存 38 テストが引き続き全パス

### Step 2: updateCart の合計計算テスト（characterization）

`__tests__/utils/cart-calculations.test.ts` を作成。`updateCart` を対象に:

- 空カート: `cartTotal=0`, `shipping=0`, `orderTotal=0`
- 単品 (price=100, amount=2): `cartTotal=200`, `tax=20`（taxRate=0.1）, `orderTotal=225`（shipping=5）
- **税が非整数になるケース (price=25, amount=1)**: `tax=2.5` — 現挙動では
  Float が `db.cart.update` に渡ることを記録する（モック引数を assert）。
  このテストには「Plan 003 で丸め方針決定後に期待値を更新する」コメントを付ける。
- `db.cart.update` に渡る data に `shipping` キーが**含まれない**こと（line 482 のコメントアウトの記録）

**Verify**: `bunx vitest run __tests__/utils/cart-calculations.test.ts` → 全パス

### Step 3: createOrderAction のテスト

`__tests__/utils/order-actions.test.ts` を作成:

- 正常系: cart の保存値（numItemsInCart/orderTotal/tax/shipping）が
  `db.order.create` の data に転記される。未払い注文の `deleteMany` が
  `{ clerkId, isPaid: false }` で呼ばれる。redirect が `/checkout?orderId=...&cartId=...` で呼ばれる。
- 異常系: `emailAddresses` が空配列のユーザー → 現挙動では TypeError が
  renderError に捕捉され `{ message }` が返ることを記録する。

**Verify**: `bunx vitest run __tests__/utils/order-actions.test.ts` → 全パス

### Step 4: payment ルートのテスト

`__tests__/api/payment-route.test.ts` を作成。`stripe` パッケージを `vi.mock` し、
`checkout.sessions.create` の呼び出し引数を検証する:

- 認証済み fixture は `auth()` の `userId`、`order.clerkId`、`cart.clerkId` を同じ値にして、既存の正常系・引数検証・404 ケースを所有権チェックの前提で実行する
- line_items の `unit_amount` が `product.price * 100` であること
- **line_items の合計が商品小計のみで、cart.tax / cart.shipping が含まれない**こと
  （現挙動の記録 — Plan 003 が修正後にこの期待値を「orderTotal と一致」に反転させる）
- order または cart が見つからない場合に 404 が返ること
- `auth()` が userId を返さない未認証リクエストは 401 を返すこと
- 認証済みでも order または cart の `clerkId` が userId と一致しない場合は 403 を返し、Stripe セッションを作成しないこと

**Verify**: `bunx vitest run __tests__/api/payment-route.test.ts` → 全パス

### Step 5: confirm ルートのテスト

`__tests__/api/confirm-route.test.ts` を作成:

- `session.status === "complete"` → `db.order.update` が `isPaid: true` で呼ばれ、
  cart が削除され、`/orders` へ redirect
- **`session.status !== "complete"`（例: "open"）→ 現挙動では order は更新されないが
  `db.cart.delete` は呼ばれてしまう**ことを記録（Plan 003 修正対象のバグの固定）

**Verify**: `bunx vitest run __tests__/api/confirm-route.test.ts` → 全パス

### Step 6: 画像・商品スキーマの検証テスト

`__tests__/utils/schemas.test.ts` を作成:

- `imageSchema`: 1MB 超のファイルで失敗、`image/*` 以外の type で失敗、正常ファイルで成功
- `productSchema`: price に負数・小数で失敗、description 10 語未満で失敗
- `validateWithZodSchema`: 失敗時にメッセージが結合された Error を throw

**Verify**: `bun run test` → 全パス（38 + 新規テスト）

## Test plan

このプラン自体がテスト作成プラン。全ステップ完了後:

- `bun run test` → 全パス、テスト総数 38 + 15 件以上
- 新規テストはすべて AAA パターン、`describe` はテスト対象の関数名/ルート名

## Done criteria

- [ ] `bun run test` が exit 0、テスト総数が 53 件以上
- [ ] `bunx tsc --noEmit` が exit 0
- [ ] `git diff --name-only` に `__tests__/` 配下（と必要なら helpers）以外のファイルがない
- [ ] 現挙動のバグ記録テスト（Step 2 の Float tax、Step 5 の無条件 cart 削除）に
      Plan 003 参照コメントが付いている
- [ ] `plans/README.md` のステータス行を更新済み

## STOP conditions

- テストを書く過程で「プロダクションコードを変更しないとテスト不能」な構造が
  見つかった場合（例: モジュールトップレベルの副作用でモックが効かない）。
  該当箇所と理由を報告する。
- `updateCart` 等の実挙動が「Current state」の記述と食い違う場合
  （= コードがドリフトしたか、このプランの分析が誤っている）。
- 既存 38 テストのいずれかが新規モック追加の影響で落ち、2 回の試行で直らない場合。

## Maintenance notes

- Plan 003 のマネーパス修正時、Step 2/4/5 の「現挙動記録」テストは期待値を
  修正後の仕様に更新すること（コメントで明示済み）。
- 既存の文字列 grep 型テスト（migration/, security/vulnerability-fixes）は
  挙動テストが安定した後に削除候補。plans/README.md の deferred 事項参照。
- 新しい Server Action を追加する際は、このプランのモックパターンを踏襲した
  挙動テストを同時に追加すること。
