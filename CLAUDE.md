# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# 開発サーバー起動
bun dev

# ビルド（Prisma generateも含む）
bun run build

# Lintチェック
bun lint

# DBマイグレーション
bunx prisma migrate dev

# DBシード実行
bunx prisma db seed

# Prisma Studio（DB GUI）
bunx prisma studio
```

## Architecture

Next.js 14 App Router を使用した e-commerce アプリ（"Next Store"）。

### 技術スタック

| 役割 | ライブラリ |
|---|---|
| フレームワーク | Next.js 14 (App Router) |
| 認証 | Clerk (`@clerk/nextjs`) |
| DB ORM | Prisma + PostgreSQL (Supabase) |
| ストレージ | Supabase Storage（商品画像） |
| 決済 | Stripe Embedded Checkout |
| UI | shadcn/ui (Radix UI + Tailwind CSS) |
| バリデーション | Zod |

### データモデル（`prisma/schema.prisma`）

`Product` → `CartItem` → `Cart` → `Order` の購買フロー。
`Product` は `Favorite` と `Review` とも 1:N。
`clerkId` フィールドでユーザーを識別（DBにユーザーテーブルなし）。
価格は **セント単位の整数**（`Int`）で保存。

### Server Actions（`utils/actions.ts`）

すべてのDB操作・ミューテーションはここに集約（`"use server"`）。
- `getAuthUser()` / `getAdminUser()`: 認証ガード（未認証はリダイレクト）
- `renderError()`: エラーを `{ message: string }` に正規化
- `validateWithZodSchema()`: Zodスキーマの検証ヘルパー（`utils/schemas.ts`）

### 認証・認可（`middleware.ts`）

- パブリックルート: `/`, `/products(.*)`, `/about`
- 管理者ルート: `/admin(.*)` → `ADMIN_USER_ID` 環境変数と一致するClerkユーザーIDのみ許可

### 決済フロー

1. `/checkout` ページで `createOrderAction` を実行 → `Order` レコード生成
2. `POST /api/payment` で Stripe Embedded Checkout セッションを作成
3. `GET /api/confirm` で決済完了を受け取り、Order を `isPaid: true` に更新・カートをクリア

### ディレクトリ構成

```
app/                   # Next.js App Router ページ
  admin/               # 管理者画面（商品CRUD、売上）
  api/payment|confirm/ # Stripe決済API
  cart|checkout|orders # 購買フロー
  products/[id]/       # 商品詳細
components/
  cart/                # カート画面コンポーネント
  form/                # 再利用フォーム部品（FormContainer, Buttons等）
  global/              # Container, EmptyList等の汎用コンポーネント
  navbar/              # ナビゲーションバー一式
  products/            # 商品一覧・お気に入り
  reviews/             # レビュー表示・投稿
  single-product/      # 商品詳細画面
  ui/                  # shadcn/ui 自動生成コンポーネント
utils/
  actions.ts           # Server Actions（DB操作の唯一の窓口）
  db.ts                # Prismaクライアントシングルトン
  schemas.ts           # Zodスキーマ定義
  supabase.ts          # Supabase Storage 画像アップロード/削除
  types.ts             # 共有型定義
  format.ts            # 価格フォーマット等のユーティリティ
  links.ts             # ナビゲーションリンク定義
lib/utils.ts           # shadcn/ui の cn() ユーティリティ
```

## 環境変数

```
DATABASE_URL        # Prisma接続URL（Supabase pooler）
DIRECT_URL          # Prismaマイグレーション用直接接続URL
SUPABASE_URL        # Supabase プロジェクトURL
SUPABASE_KEY        # Supabase サービスロールキー
ADMIN_USER_ID       # 管理者のClerk User ID
STRIPE_SECRET_KEY   # Stripe シークレットキー
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY  # Stripe 公開キー
NEXT_PUBLIC_CLERK_*  # Clerk 設定（publishable key等）
```

## コーディング規約

- **フォームの状態管理**: `useFormState` (React) + Server Action のパターンで統一
- **画像バリデーション**: 最大1MB、`image/*` のみ（`utils/schemas.ts` の `imageSchema`）
- **価格**: DB・Stripe通信ともにセント整数。表示時は `utils/format.ts` でフォーマット
- **管理者確認**: admin操作の Server Action 冒頭で必ず `await getAdminUser()` を呼ぶ
