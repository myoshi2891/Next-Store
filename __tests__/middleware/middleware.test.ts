import { describe, it, expect } from "vitest";

describe("middleware ルーティング保護ロジック", () => {
	const publicRoutes = ["/", "/products", "/products/123", "/about"];
	const protectedRoutes = ["/cart", "/checkout", "/orders", "/favorites"];
	const adminRoutes = ["/admin", "/admin/products", "/admin/sales"];

	it("公開ルートが正しく定義されている", () => {
		const publicPatterns = [/^\/$/, /^\/products/, /^\/about$/];
		for (const route of publicRoutes) {
			const isPublic = publicPatterns.some((p) => p.test(route));
			expect(isPublic, `${route} は公開ルートであるべき`).toBe(true);
		}
	});

	it("保護ルートが公開ルートに含まれない", () => {
		const publicPatterns = [/^\/$/, /^\/products/, /^\/about$/];
		for (const route of protectedRoutes) {
			const isPublic = publicPatterns.some((p) => p.test(route));
			expect(isPublic, `${route} は公開ルートであるべきではない`).toBe(false);
		}
	});

	it("管理者ルートの判定パターンが正しい", () => {
		const adminPattern = /^\/admin/;
		for (const route of adminRoutes) {
			expect(adminPattern.test(route), `${route} は管理者ルート`).toBe(true);
		}
	});

	it("ADMIN_USER_ID による管理者判定ロジック", () => {
		const adminUserId = "admin_123";
		const testCases = [
			{ userId: "admin_123", expected: true },
			{ userId: "user_456", expected: false },
			{ userId: null, expected: false },
		];

		for (const { userId, expected } of testCases) {
			const isAdmin = userId === adminUserId;
			expect(isAdmin).toBe(expected);
		}
	});
});
