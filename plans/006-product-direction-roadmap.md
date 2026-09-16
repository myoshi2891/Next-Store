# Plan 006: プロダクトロードマップ — 根拠に基づく機能拡張の設計スパイク

> **Executor instructions**: これは実装プランではなく**設計スパイクの束**である。
> 各項目は「調査・設計・オープンクエスチョンの解消」を成果物とし、コードの
> 本実装は各スパイク完了後に個別プランを起こして行う。着手する項目は
> オペレーター（メンテナー）が選定する — 全項目を一括で進めないこと。
> 選択範囲と 6-1〜6-6 の状態は `plans/README.md` の「Plan 006 item selection &
> status」表に記録する。選択されていない項目は実施対象ではなく、Plan 006 の完了を
> 妨げない。
>
> **Drift check (最初に実行)**: `git diff --stat 90f91f4..HEAD -- app/ utils/actions.ts utils/links.ts prisma/schema.prisma`
> 対象領域が大きく変わっていたら各項目の Evidence を再確認すること。

## Status

- **Priority**: P3（ただし 6-1 は決済信頼性に直結するため実質 P2）
- **Effort**: 項目ごとに記載（粗い見積もり）
- **Risk**: 項目ごとに記載
- **Depends on**: 6-1 は plans/003 完了後に着手すること（同じコードを触る）
- **Category**: direction
- **Planned at**: commit `90f91f4`, 2026-07-05
- **Selection policy**: 実施する項目を README の表で `Selected: Yes` にしてから開始する。
  Plan 006 は、少なくとも 1 項目が選択され、その**全選択項目**が完了した時点で DONE に
  できる。選択されていない項目は将来の候補として `Selected: No` のまま残し、DONE の
  条件には含めない。

## Why this matters

監査の direction カテゴリで、**リポジトリ内の証拠に基づく**機能拡張候補を 6 件
特定した。いずれも「データモデルは既に対応しているのに表面が未実装」という
非対称性、またはナビゲーションが約束しているのに実装が伴っていないギャップに
根拠を持つ。汎用的な「あったら良い」機能は含めていない。

## 候補一覧（推奨順）

### 6-1. Stripe Webhook による決済確定（信頼性の根本対策）

- **Evidence**: `app/api/confirm/route.ts` の GET リダイレクトが注文を
  `isPaid: true` にする唯一の経路。`app/api/` に webhook ルートは存在しない。
- **Value**: 買い手がリダイレクト完了前にタブを閉じる/通信断になると、
  **課金済みなのに注文が未払い扱いのまま残る**。`checkout.session.completed`
  Webhook が Stripe 推奨の唯一信頼できる確定手段であり、リトライと冪等性も得られる。
- **Effort**: M / **Risk**: MED（マネーパス変更）
- **スパイクの成果物**:
  - Webhook エンドポイント設計（`app/api/webhook/stripe/route.ts`）、
    署名検証（`STRIPE_WEBHOOK_SECRET` 環境変数の追加）
  - `orderId` をキーとした冪等処理の方式決定
  - 既存 confirm ルートの縮退方針（UX リダイレクト専用化）
  - ローカル検証手順（Stripe CLI の `stripe listen`）
- **Open questions**: デプロイ先で Webhook URL をどう固定するか。
  confirm ルートとの併存期間を設けるか。

### 6-2. 注文詳細ページ（CRUD の欠けた 1 辺）

- **Evidence**: `app/orders/` は `page.tsx`（一覧）と `loading.tsx` のみで
  `[id]/` ルートがない。admin 商品には詳細/編集ルートが揃っている
  （`app/admin/products/[id]/edit`）のと非対称。注文一覧から個別注文への
  リンクも存在しない。
- **Value**: 顧客が注文の明細（何を・いくつ・いくらで）を確認できない。
  ※ 現状 `Order` モデルは集計値のみで**明細行を持たない**
  （`prisma/schema.prisma:81-92` — products は個数の Int）。明細表示には
  `OrderItem` モデルの追加が必要 — これがこのスパイクの主設計項目。
- **Effort**: M（OrderItem 追加を含む）/ **Risk**: LOW-MED（スキーマ拡張）
- **スパイクの成果物**: `OrderItem` スキーマ案（product スナップショット方式 —
  価格改定に耐えるよう注文時点の価格・商品名を複製保存するか、Product 参照に
  するかの決定）、`createOrderAction` の拡張方針、`app/orders/[id]/page.tsx` の
  所有権ガード設計（`clerkId` 照合）。
- **Open questions**: 過去注文（明細なし）の表示互換をどうするか。

### 6-3. 注文確認メール（取得済みデータの未活用）

- **Evidence**: `Order.email` は全注文で保存されている
  （`prisma/schema.prisma:88`、`utils/actions.ts:587`）が、メール送信ライブラリは
  リポジトリに存在しない（resend / nodemailer / sendgrid いずれも依存になし）。
- **Value**: 支払い後に領収書/確認メールが届かないのは EC として基本体験の欠落。
  データは既に揃っており追加コストが小さい。
- **Effort**: M / **Risk**: LOW-MED（プロバイダキー管理と到達性）
- **スパイクの成果物**: プロバイダ選定（Resend が Next.js との親和性で第一候補、
  React Email でテンプレート）、送信トリガー位置の決定（**6-1 の Webhook 内を
  推奨** — リダイレクト経路はタブ閉じで失われるため）、失敗時のリトライ方針。
- **Open questions**: 送信ドメインの用意。6-1 未実装の場合の暫定トリガー。

### 6-4. 管理ダッシュボードの実体化（ラベルと実装のギャップ）

- **Evidence**: `utils/links.ts` はナビで `/admin/sales` を「dashboard」と
  ラベル付けしているが、`app/admin/sales/page.tsx` は生の注文テーブル
  （email / products / total / 日付）を出すだけで集計・グラフが一切ない。
- **Value**: 売上推移・注文数・平均注文額は `Order` の既存カラム
  （`orderTotal`, `createdAt`, `isPaid`）だけで計算でき、追加データ不要。
- **Effort**: M / **Risk**: LOW（読み取り専用の admin 画面）
- **スパイクの成果物**: 表示メトリクスの決定（月次売上、注文数、AOV）、
  Prisma `groupBy` 集計クエリ案、チャートライブラリ選定
  （Tremor / Recharts / shadcn charts — 既存 shadcn/ui 構成との整合を評価）。
- **Open questions**: 期間フィルタの要否。

### 6-5. レビュー編集（create/delete はあるのに update がない）

- **Evidence**: `utils/actions.ts` に `createReviewAction`（:249）、
  `deleteReviewAction`（:321）はあるが update 系アクションが存在しない。
  `findExistingReview`（:338）で「ユーザーごとに 1 商品 1 レビュー」を既に
  追跡しており、編集対象の特定は実装済みに等しい。
- **Value**: 投稿済みレビューの修正は削除→再投稿しかなく、評価を直したい
  ユーザーの摩擦になる。
- **Effort**: S-M / **Risk**: LOW
- **スパイクの成果物**: 実質不要 — これは小規模のためスパイクを飛ばして
  直接実装プラン化してよい（`updateReviewAction` + `where: { id, clerkId }`
  スコープ + `/reviews` ページの編集 UI）。
- **Open questions**: なし。

### 6-6. 商品ディスカバリの拡張（検索 1 本からファセットへ）

- **Evidence**: `app/products/page.tsx` は `layout` と `search` パラメータのみ
  受け付け、`fetchAllProducts`（`utils/actions.ts:42-54`）は name/company の
  contains 検索だけ。価格・評価・企業でのフィルタやソートは存在しないが、
  データ（price、`fetchProductRating` の groupBy 集計）は既にある。
- **Value**: カタログ成長時の発見性のボトルネック解消。既存データで賄える
  adjacent-possible な拡張。
- **Effort**: M / **Risk**: LOW（クエリパラメータの追加的変更）
- **スパイクの成果物**: ファセット選定（価格帯・企業・最低評価・ソート順）、
  URL パラメータ設計（`useSearchParams` は Suspense boundary 必須 —
  CLAUDE.md 規約）、`fetchAllProducts` の拡張シグネチャ案。
- **Open questions**: 評価フィルタは集計テーブルなしで性能が持つか
  （Plan 004 のインデックスとの整合）。

## 推奨する進め方

1. **6-1（Webhook）を最優先** — 決済信頼性は機能ではなく前提。Plan 003 完了後に着手。
2. 6-3（メール）は 6-1 の Webhook をトリガーにするため直後が効率的。
3. 6-2 / 6-4 / 6-5 / 6-6 はプロダクト判断でどれからでも独立に進められる。
4. 各スパイクの成果物は `plans/` に `1xx-` 番台の実装プランとして起こす
   （このドキュメント自体は更新せず、README のステータスで管理）。

## Done criteria（スパイクごと）

- [ ] 作業開始前に `plans/README.md` で選択範囲を記録し、対象の各項目を `Selected: Yes` と `IN PROGRESS` にする
- [ ] 選択した各項目についてのみ、上記「スパイクの成果物」の各項目が文書化されている
- [ ] 選択した各項目についてのみ、Open questions がすべて「決定」または「メンテナーへの質問リスト」に変換されている
- [ ] 選択した各項目についてのみ、実装プラン（1xx 番台）が plan-template 準拠で作成され、README の項目 status が DONE である
- [ ] Plan 006 全体は、少なくとも 1 項目が選択済みで、その全選択項目が DONE の場合にのみ DONE にする。未選択項目はこの判定を妨げない

## STOP conditions

- スパイク中にスキーマの破壊的変更（既存カラムの型変更・削除）が必要と
  判明した場合 — メンテナーの承認が必要。
- 外部サービス（メールプロバイダ等）の新規契約・キー発行が必要になった時点で
  一旦報告する（コストとアカウント管理の判断はメンテナーに帰属）。

## Maintenance notes

- direction 候補は 2026-07-05 時点のコードベースに基づく。大きな機能追加後は
  `/improve next` の再実行で候補を更新すること。
- 「考慮して見送った」direction 候補は plans/README.md に記録済み。
