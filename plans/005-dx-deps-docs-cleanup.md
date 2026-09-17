# Plan 005: 開発体験・依存関係・ドキュメントの整備

> **Executor instructions**: このプランをステップ順に実行すること。各ステップの
> 検証コマンドを実行し、期待結果を確認してから次に進む。「STOP conditions」の
> いずれかが発生したら、即座に停止して報告する。完了したら `plans/README.md` の
> ステータス行を更新する。
>
> **Drift check (最初に実行)**: `git diff --stat 90f91f4..HEAD -- package.json README.md .eslintrc.json eslint.config.mjs app/checkout/page.tsx utils/actions.ts`
> 他プランによる `utils/actions.ts` の変更は想定内。`eslint.config.mjs` に既存の変更がある場合は
> 「Current state」と比較して内容を把握してから Step 5 を実行すること。それ以外の in-scope 変更は
> 「Current state」と比較し、不一致は STOP。

## Status

- **Priority**: P2
- **Effort**: M
- **Risk**: LOW-MED（eslint 9 移行のみ MED）
- **Depends on**: none（どのプランとも独立して実行可。ただし CI 追加は 002 完了後が望ましい）
- **Category**: dx / migration / docs
- **Planned at**: commit `90f91f4`, 2026-07-05

## Why this matters

- README がフレームワークのメジャーバージョンを 2 つ誤って記載しており
  （Next.js 14 / React 18 と記載、実際は 16 / 19）、存在しない
  `.env.example` を参照するためセットアップ手順が最初のステップで破綻する。
- eslint 8 は EOL であり、`eslint-config-next@16` の peer 要件（>=9）を満たして
  いない。クリーン再インストールで壊れ得る潜在的リスク。
- typecheck スクリプトも CI もなく、型・リント・テストの検証は人力頼み。
- axios は 1 箇所の POST のためだけに依存に入っている。

## Current state

- `package.json:5-11` — scripts: dev / build / start / lint / test / test:watch。
  `typecheck` なし。`build` は `npx prisma generate && next build`（bun 標準の
  リポジトリで npx を使用 — bun.lock と異なる Prisma を解決し得る）。
- `package.json` — `"eslint": "^8"`（EOL）、`"axios": "^1.9.0"`、
  `"zod": "^3.24.3"`（v4 GA だが移行は deferred）、`"tailwindcss": "^3.4.1"`
  （v4 GA だが移行は deferred）、`"sharp": "^0.34.1"`（import なしだが
  **Next.js の画像最適化がランタイムで自動使用するため削除禁止**）。
- `.eslintrc.json` — legacy eslintrc 形式（`extends: "next/core-web-vitals"`）。
  eslint 9 は flat config（`eslint.config.mjs`）がデフォルト。
- `app/checkout/page.tsx:3,22` — axios の唯一の使用箇所
  （`axios.post("/api/payment", ...)`）。リポジトリ内に他の HTTP クライアント
  利用なし。
- `README.md` — 「Next.js 14」「React 18」の記載が複数箇所（技術スタック表、
  アーキテクチャ説明）。セットアップ手順に `cp .env.example .env.local` が
  あるが `.env.example` は存在しない。
- `.github/` / `.husky/` ディレクトリなし（CI・pre-commit フックなし）。
- コード中で参照される環境変数（`.env.example` に列挙すべきキー名）:
  `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_KEY`, `ADMIN_USER_ID`,
  `STRIPE_SECRET_KEY`, `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`,
  `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `APP_URL`
  （Clerk 系は `@clerk/nextjs` が規約名で読む。実際に使われているキーは
  CLAUDE.md「環境変数」セクションも参照。`APP_URL` は Plan 003 が
  `app/api/payment/route.ts` の return URL 生成で参照する canonical origin ―
  Plan 003 のドリフトチェック対象パスに含まれないため、この Plan 005 の
  `.env.example` 作成が唯一の記載場所になる）。
- デッドコード / デバッグ残骸:
  - `utils/actions.ts:82` — `console.log(validatedFile)`
  - `utils/actions.ts:77` — コメントアウトされた旧検証コード
  - `utils/actions.ts:136` — コメントアウトされた戻り値型
  - `utils/schemas.ts:16` — `// image: z.string(),`
  - `components/products/ProductsContainer.tsx:8` — 未使用 import `Heading5`（lucide-react）

## Commands you will need

| Purpose   | Command             | Expected on success |
|-----------|---------------------|---------------------|
| Install   | `bun install`       | exit 0              |
| Lint      | `bun run lint`      | exit 0              |
| Tests     | `bun run test`      | 全パス              |
| Typecheck | `bunx tsc --noEmit` | exit 0（Step 1 以降は `bun run typecheck`） |

## Scope

**In scope**:
- `package.json`（scripts、eslint / axios の依存変更のみ）
- `.eslintrc.json` → `eslint.config.mjs`（eslint 9 移行）
- `.env.example`（新規 — **キー名のみ、値はすべて空またはプレースホルダ**）
- `README.md`
- `.github/workflows/ci.yml`（新規）
- `app/checkout/page.tsx`（axios → fetch）
- デッドコード除去: `utils/actions.ts`, `utils/schemas.ts`, `components/products/ProductsContainer.tsx` の上記列挙箇所のみ

**Out of scope**:
- Zod 4 / Tailwind 4 / eslint 以外のメジャーアップグレード — 別プランで扱う
  （plans/README.md の deferred 事項）。
- `sharp` の削除 — 禁止（画像最適化のランタイム依存）。
- `middleware.ts` → `proxy.ts` の改名 — Next.js 側の deprecation 対応は
  現時点で警告のみのため deferred。
- ロジック変更を伴うリファクタリング全般。

## Git workflow

- ブランチ: `advisor/005-dx-cleanup`
- コミット形式: `chore(deps): ...` / `docs(readme): ...` / `ci: ...` を変更単位で分ける
- push / PR 作成はオペレーターの指示があるまで行わない。

## Steps

### Step 1: typecheck スクリプトと build の bunx 化

`package.json` の scripts に `"typecheck": "tsc --noEmit"` を追加し、
`build` を `"bunx prisma generate && next build"` に変更する。

**Verify**: `bun run typecheck` → exit 0

### Step 2: .env.example を作成

「Current state」に列挙した環境変数キーを記載した `.env.example` を作成する。
**値はすべて空欄またはダミー形式の説明**（例: `STRIPE_SECRET_KEY=` のみ、
または `# Stripe ダッシュボード > API キーから取得` のコメント付き）。
**実際の値・実在の URL・実在の ID は絶対に書かない。**

**Verify**:
1. `test -f .env.example && ! grep -nE '^[[:space:]]*[A-Za-z_][A-Za-z0-9_]*=[^[:space:]].*$' .env.example` → exit 0
   （`test -f` でファイルの存在を先に必須化する — 存在しない場合は `grep` が
   「非0終了かつ0件ヒット」を返し `!` 否定で見かけ上パスしてしまうため、存在チェックを
   先に置いて検証をすり抜けさせない。コメントと空の代入は許可し、`KEY=x` を含む
   任意の非空値のみ検出する）
2. 「Current state」に列挙した 10 個のキーがすべて存在することをキー単位で確認する:
   `for k in DATABASE_URL DIRECT_URL SUPABASE_URL SUPABASE_KEY ADMIN_USER_ID STRIPE_SECRET_KEY NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY CLERK_SECRET_KEY APP_URL; do grep -q "^${k}=" .env.example || echo "MISSING: $k"; done`
   → 出力が空（全キーが空値またはコメント付きで存在すること。値が空欄なのは許可、
   欠落しているキーのみ `MISSING` として検出する）

### Step 3: README の記載を実態に合わせる

- 「Next.js 14」→「Next.js 16」、「React 18」→「React 19」（全出現箇所）
- 技術スタック表を package.json の実バージョン系列に合わせる
  （Clerk v7、Prisma 6、Tailwind 3、Vitest 4）
- `cp .env.example .env.local` の手順は Step 2 でファイルが存在するようになる
  ため記述としては有効化される。前後の手順（bun install / bun dev）が
  実際のコマンドと一致しているか通読して確認する。

**Verify**: `grep -n "Next.js 14\|React 18" README.md` → 0 件

### Step 4: axios を fetch に置換して依存から削除

`app/checkout/page.tsx` の `axios.post("/api/payment", body)` を:

```ts
const res = await fetch("/api/payment", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId, cartId }),
});
if (!res.ok) throw new Error("Failed to create checkout session");
const data = await res.json();
```

に置換（呼び出し元の `data.clientSecret` 参照形を維持）。その後
`bun remove axios`。

**Verify**: `grep -rn "axios" app/ components/ utils/ package.json` → 0 件、
`bun run typecheck` → exit 0

### Step 5: eslint 9 + flat config への移行

1. `bun remove eslint && bun add -d eslint@^9`
2. eslint 9 移行では、既存の設定ファイルの状態を先に確認してから対応を選ぶ:
   - `.eslintrc.json` が存在し `eslint.config.mjs` が**存在しない**場合:
     `.eslintrc.json` を削除し、`eslint.config.mjs` を新規作成する。
   - `eslint.config.mjs` が**既に存在する**場合（drift check で検出済みの想定）:
     既存の `eslint.config.mjs` の内容を確認し、`next/core-web-vitals` の
     flat config が正しく設定されているか検証する。不足があれば追記・修正する。
     `.eslintrc.json` が共存していれば削除する。

   いずれの場合も最終的な `eslint.config.mjs` の内容:

   ```js
   import nextVitals from "eslint-config-next/core-web-vitals";

   export default [...nextVitals];
   ```

   `@eslint/eslintrc` の `FlatCompat` は使わない — `eslint-config-next@16` は
   `./core-web-vitals` エクスポート（`node_modules/eslint-config-next/package.json`
   の `exports` を参照）でネイティブ flat config を提供しているため不要。
3. `bun run lint` を実行し、新たに報告されるエラーを確認する。
   **新規エラーが 10 件を超える場合は修正せず STOP して一覧を報告**
   （ルール調整の判断が必要）。10 件以下の機械的修正（未使用変数等）は行ってよい。
4. `npx eslint --print-config app/layout.tsx` および任意の既存 `.tsx` ファイル
   （例: `components/navbar/Navbar.tsx`）に対して実行し、TypeScript/TSX 用の
   パーサー・ルールが解決されていることを確認する（エラー終了は STOP）。

**Verify**: `bun run lint` → exit 0、上記 `eslint --print-config` の2コマンドが
いずれもエラーなく設定 JSON を出力する

### Step 6: デッドコード・デバッグログの除去

「Current state」のデッドコード列挙箇所（5 箇所）**のみ**を削除する。
`utils/actions.ts:482` の `// shipping,` は Plan 003 が処理するため触らない
（既に解除済みならそのまま）。

**Verify**: `bun run test` → 全パス、`bun run lint` → exit 0

### Step 7: CI ワークフローを追加

`.github/workflows/ci.yml` を新規作成。push / pull_request で:

1. `actions/checkout@v4` でリポジトリを取得
2. `oven-sh/setup-bun` で bun をセットアップ
3. `bun install --frozen-lockfile`
4. `bunx prisma generate`（型生成のため。DB 接続は不要）
5. `bun run lint`
6. `bun run typecheck`
7. `bun run test`

DB・Clerk・Stripe の実キーは不要な構成にする（テストはすべてモック済みの前提。
もしテストが環境変数を要求して落ちる場合はダミー値を env に設定するのではなく
STOP して報告する — テスト側の分離不足が真因のため）。

**Verify**: `bunx yaml-lint .github/workflows/ci.yml` 相当がなければ
`cat .github/workflows/ci.yml | bunx js-yaml` → パースエラーなし
（js-yaml が使えなければ YAML 構文を目視確認し、その旨を報告に含める）

## Test plan

- 既存テストが全パスし続けることが回帰ゲート（このプランは挙動変更なしのはず）。
- axios → fetch 置換（Step 4）は checkout フローの手動確認が望ましい:
  `bun dev` でカート → checkout ページで Stripe Embedded フォームが表示されること。

## Done criteria

- [ ] `bun run typecheck` / `bun run lint` / `bun run test` がすべて exit 0
- [ ] `.env.example` が存在し、値が一切入っていない
- [ ] `grep -n "Next.js 14\|React 18" README.md` → 0 件
- [ ] `grep -rn "axios" package.json` → 0 件
- [ ] eslint のメジャーが 9 系（`bunx eslint --version` → v9.x）
- [ ] `.github/workflows/ci.yml` が存在する
- [ ] `git status` で in-scope 外のファイルに変更がない
- [ ] `plans/README.md` のステータス行を更新済み

## STOP conditions

- Step 5 で eslint 9 の新規エラーが 10 件超（ルール調整の判断が必要）。
- Step 7 でテストが実環境変数を要求して落ちる（テスト分離不足の報告が先）。
- `eslint-config-next@16` が flat config で `next/core-web-vitals` を解決できない
  互換問題が発生し、2 回の試行で解消しない。
- Step 4 の fetch 置換で checkout ページの挙動が変わる兆候
  （clientSecret が取得できない等）。

## Maintenance notes

- `.env.example` は環境変数を追加するたびに更新すること（キー名のみ）。
- CI は今後のプラン（001-004）の Done criteria 検証を自動化する基盤になる。
  可能なら 001-004 より先にこのプランを実行してもよい（依存なし）。
- Zod 4 / Tailwind 4 移行は意図的に見送り（plans/README.md の
  「considered and rejected」参照）。必要になった時点で個別プランを起こすこと。
