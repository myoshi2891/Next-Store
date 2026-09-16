import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("React 19 互換性チェック", () => {
	it("useFormState が使われていないこと", () => {
		const formContainer = readFileSync(
			resolve(__dirname, "../../components/form/FormContainer.tsx"),
			"utf-8"
		);
		expect(formContainer).not.toContain("useFormState");
	});

	it("useActionState が react からインポートされていること", () => {
		const formContainer = readFileSync(
			resolve(__dirname, "../../components/form/FormContainer.tsx"),
			"utf-8"
		);
		expect(formContainer).toContain("useActionState");
		// react-dom からではなく react からインポート
		expect(formContainer).not.toMatch(
			/from\s+["']react-dom["'].*useActionState/
		);
		expect(formContainer).toMatch(/from\s+["']react["']/);
	});

	it("actionFunction の prevState に any が含まれないこと", () => {
		const typesContent = readFileSync(
			resolve(__dirname, "../../utils/types.ts"),
			"utf-8"
		);
		// actionFunction 型定義の範囲を抽出
		const actionFunctionMatch = typesContent.match(
			/export type actionFunction[\s\S]*?;/
		);
		expect(actionFunctionMatch).not.toBeNull();
		expect(actionFunctionMatch![0]).not.toContain(": any");
	});

	it("auth() が全ファイルで await されていること", () => {
		const filesToCheck = [
			"components/navbar/LinksDropdown.tsx",
			"components/products/FavoriteToggleButton.tsx",
			"app/cart/page.tsx",
			"app/products/[id]/page.tsx",
		];

		for (const file of filesToCheck) {
			const content = readFileSync(
				resolve(__dirname, "../../", file),
				"utf-8"
			);
			// auth() がインポートされている場合、await auth() で呼び出されていること
			if (content.includes("auth()")) {
				expect(
					content,
					`${file} で auth() が await なしで呼び出されています`
				).toContain("await auth()");
			}
		}
	});

	it("useSearchParams() が Suspense boundary 内で使用されていること", () => {
		const checkoutPage = readFileSync(
			resolve(__dirname, "../../app/checkout/page.tsx"),
			"utf-8"
		);
		if (!checkoutPage.includes("useSearchParams")) return;

		// CheckoutContent（useSearchParams を呼ぶコンポーネント）が
		// Suspense の直接子として JSX 上に配置されていることを検証する。
		// 単純な文字列存在チェックではなく構造を検証するため、
		// <Suspense ...> の開始タグより後に <CheckoutContent が現れ、
		// かつその間に </Suspense> が存在しないことを確認する。
		// CheckoutContent を Suspense 外に移動するとこのアサーションが失敗する。
		const suspenseStart = checkoutPage.indexOf("<Suspense");
		const suspenseEnd = checkoutPage.indexOf("</Suspense>");
		expect(
			suspenseStart,
			"Suspense タグが見つかりません"
		).toBeGreaterThanOrEqual(0);
		expect(
			suspenseEnd,
			"</Suspense> 閉じタグが見つかりません"
		).toBeGreaterThanOrEqual(0);

		const insideSuspense = checkoutPage.slice(suspenseStart, suspenseEnd);
		expect(
			insideSuspense,
			"CheckoutContent が Suspense boundary の内側に配置されていません — " +
				"useSearchParams() を呼ぶコンポーネントは必ず <Suspense> 内に置いてください"
		).toContain("<CheckoutContent");
	});
});
