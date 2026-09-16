# Implementation Plans

improve スキル（アドバイザー監査）により 2026-07-05 に生成。監査コミット: `90f91f4`。

実行者へ: 依存関係が許す限り下表の順に実行すること。**着手前にプラン全文を読み、
STOP conditions を厳守し、完了時に自分の行のステータスを更新する。**
各プランは自己完結しており、このリポジトリを初見のエージェントでも実行できるよう
書かれている。

## Execution order & status

| Plan | Title | Priority | Effort | Depends on | Status |
|------|-------|----------|--------|------------|--------|
| [001](001-security-authorization-hardening.md) | Server Action と決済 API の認可・入力検証強化 | P1 | M | — | TODO |
| [002](002-money-path-test-baseline.md) | 金額・注文・決済パスの挙動テスト基盤 | P1 | L | 001 | TODO |
| [003](003-payment-flow-consistency.md) | 決済フローの金額整合性と状態遷移の修正 | P1 | M | 002 | TODO |
| [004](004-data-integrity-and-performance.md) | DB 整合性制約とホットパス性能改善 | P2 | M | 002, 003 | TODO |
| [005](005-dx-deps-docs-cleanup.md) | DX・依存関係・ドキュメント整備 | P2 | M | — | TODO |
| [006](006-product-direction-roadmap.md) | プロダクトロードマップ（設計スパイク束） | P3 | 項目別 | 項目ごとに個別評価（下表参照） | TODO — selected scope: none |

Status values: TODO | IN PROGRESS | DONE | BLOCKED（理由 1 行）| REJECTED（理由 1 行）| NOT SELECTED（意図的に対象外 — Plan 006 の未選択スパイク項目に使用）

## Plan 006 item selection & status

Select an item by changing `Selected` to `Yes` and its status to `IN PROGRESS`
before its spike begins. `NOT SELECTED` items are intentionally out of scope.
Plan 006 is DONE when at least one item is selected and every selected item is
DONE; unselected items do not block completion.

| Item | Title | Selected | Status | Notes |
|------|-------|----------|--------|-------|
| 6-1 | Stripe Webhook による決済確定 | No | NOT SELECTED | Requires Plan 003 |
| 6-2 | 注文詳細ページ | No | NOT SELECTED | — |
| 6-3 | 注文確認メール | No | NOT SELECTED | Prefer after 6-1 |
| 6-4 | 管理ダッシュボードの実体化 | No | NOT SELECTED | — |
| 6-5 | レビュー編集 | No | NOT SELECTED | — |
| 6-6 | 商品ディスカバリの拡張 | No | NOT SELECTED | — |

## Dependency notes

- **006 は dispatch 対象として直接実行しない**: 006 は複数スパイクの束であり、
  依存関係は選択された項目ごとに異なる（例: 6-1 は 003 完了後）。`execute` する際は
  選択済みの項目に対応する個別プラン（1xx 番台）が別途作成されていることを前提とし、
  006 自体を executor に渡さない。
- **003 は 002 が前提**: 金額計算を変更するため、先に characterization テストで
  現挙動を固定しないと修正の正しさを機械検証できない。
- **004 は 003 の後**: 同じ `utils/actions.ts` の `updateCart` 周辺を触るため
  順序を固定して衝突を防ぐ。また 004 のトランザクション化は 003 の丸め修正済み
  コードを前提とする。
- **002 は 001 の後**: 002 の payment-route テストは 001 で追加する認証・所有権
  チェックの 401/403 契約を検証する。001 未完了の状態でこれらのテストを追加しても
  現行ルートでは通らない。
- **005 は完全に独立** — CI（005 Step 7）を先に入れると他プランの検証が
  自動化されるため、順序を繰り上げてもよい。
- **006 の 6-1（Stripe Webhook）は 003 完了後** — confirm ルートを両方が触る。

## 監査サマリー（2026-07-05, standard レベル）

- 監査範囲: リポジトリ全体（node_modules, components/ui, .next, public を除く）。
  9 カテゴリ（correctness / security / perf / tests / tech-debt / deps / dx /
  docs / direction）を 3 並列サブエージェント + アドバイザー本人の検証で実施。
- **未監査領域**: Supabase 側のバケットポリシー・RLS 設定（コードからは見えない）、
  Clerk ダッシュボード設定、実データベースのデータ品質、デプロイ環境の設定。
- 検証ベースライン: `bun run test` → 10 files / 38 tests 全パス（~2 秒）。
  typecheck スクリプトは未整備（005 で追加予定、それまでは `bunx tsc --noEmit`）。

## Findings considered and rejected

再監査の重複を防ぐため、検討のうえ見送った事項を記録する:

- **`next.config.mjs` の `dangerouslyAllowLocalIP: true`**: NAT64 環境対応として
  コミット `a2e66ac` に文書化された意図的トレードオフ。by-design であり finding
  ではない。ただし本番デプロイ環境が NAT64 でなくなった際は無効化を推奨。
- **`middleware` → `proxy` 改名**: 既知（CLAUDE.md 記載済み）。現状は警告のみで
  動作するため、Next.js が削除期限を告知した時点でプラン化する。
- **`sharp` が import されていない件**: Next.js 画像最適化のランタイム依存であり
  デッドウェイトではない。削除禁止（005 の out of scope に明記）。
- **Zod 3→4 / Tailwind 3→4 メジャー移行**: EOL・セキュリティ圧力が現時点でなく、
  破壊的変更の割に得るものが少ない。必要が生じた時点で個別プランを起こす。
- **`app/about` 等の静的ページ最適化**: 測定可能な効果なし。
- **ページネーション / Suspense ストリーミング**: 価値はあるが UI 変更を伴うため
  004 から意図的に除外（deferred）。カタログ/注文数が増えた時点で優先度再評価。
- **`utils/actions.ts` のドメイン別ファイル分割（DEBT-01/02/04）**: 625 行の
  god-module 化と action シグネチャの不統一は実在するが、002 のテスト基盤と
  001/003/004 の修正が全部載った後に行うのが安全。deferred（実施時は
  `actions/products.ts` 等への分割 + `withAuth` 高階関数の導入を推奨）。
- **文字列 grep 型テストの削除**: 002 で挙動テストが揃った後の後続作業。
  それまでは害が小さいため残置。

## セキュリティ注記

- 監査中に秘密情報の値がプラン文書に転記されていないこと、および文書内の
  ファイル参照がすべてリポジトリ相対パスであることを確認済み。
- `SUPABASE_KEY` がサービスロールキーか anon キーかはコードから判別できない。
  サービスロールキーの場合、サーバー専用モジュール（`utils/supabase.ts`）以外に
  漏れていないかの確認と、可能なら anon キー + バケットポリシーへの移行を推奨
  （001 の実行者は対象外 — メンテナーへの確認事項）。
