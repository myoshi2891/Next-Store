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
		if (checkoutPage.includes("useSearchParams")) {
			expect(
				checkoutPage,
				"useSearchParams を使うページには Suspense が必要です"
			).toContain("Suspense");
		}
	});
});
