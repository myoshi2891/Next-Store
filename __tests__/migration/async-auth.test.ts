import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("auth() 非同期化チェック", () => {
	const filesToCheck = [
		"middleware.ts",
		"components/navbar/LinksDropdown.tsx",
		"components/products/FavoriteToggleButton.tsx",
		"app/cart/page.tsx",
		"app/products/[id]/page.tsx",
		"utils/actions.ts",
	];

	it.each(filesToCheck)(
		"%s で auth() が await されていること",
		(filePath) => {
			const content = readFileSync(resolve(__dirname, "../..", filePath), "utf-8");
			// auth() を呼んでいる行を抽出（import文とコメント行を除外）
			const lines = content.split("\n");
			const authCallLines = lines.filter(
				(line) =>
					line.includes("auth()") &&
					!line.trim().startsWith("import") &&
					!line.trim().startsWith("//") &&
					!line.trim().startsWith("*")
			);

			for (const line of authCallLines) {
				expect(
					line,
					`${filePath}: "${line.trim()}" で auth() が await されていません`
				).toContain("await");
			}
		}
	);
});
