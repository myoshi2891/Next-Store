import { describe, it, expect } from "vitest";

describe("テスト基盤", () => {
	it("Vitestが正常に動作する", () => {
		expect(1 + 1).toBe(2);
	});

	it("文字列マッチングが動作する", () => {
		expect("hello world").toContain("hello");
	});
});
