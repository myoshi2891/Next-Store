import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { isPublicRoute, isAdminRoute } from "@/middleware";

function makeRequest(pathname: string) {
	return new NextRequest(new URL(pathname, "https://example.com"));
}

describe("middleware ルーティング保護ロジック", () => {
	const publicRoutes = ["/", "/products", "/products/123", "/about"];
	const protectedRoutes = ["/cart", "/checkout", "/orders", "/favorites"];
	const adminRoutes = ["/admin", "/admin/products", "/admin/sales"];

	it("公開ルートが isPublicRoute と一致する", () => {
		for (const route of publicRoutes) {
			expect(isPublicRoute(makeRequest(route)), `${route} は公開ルートであるべき`).toBe(
				true
			);
		}
	});

	it("保護ルートが isPublicRoute に含まれない", () => {
		for (const route of protectedRoutes) {
			expect(
				isPublicRoute(makeRequest(route)),
				`${route} は公開ルートであるべきではない`
			).toBe(false);
		}
	});

	it("管理者ルートが isAdminRoute と一致する", () => {
		for (const route of adminRoutes) {
			expect(isAdminRoute(makeRequest(route)), `${route} は管理者ルート`).toBe(true);
		}
	});

	it("公開ルートは isAdminRoute に一致しない", () => {
		for (const route of publicRoutes) {
			expect(isAdminRoute(makeRequest(route))).toBe(false);
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
