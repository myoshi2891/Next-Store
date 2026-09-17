import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { isPublicRoute, isAdminRoute, isAdminUser } from "@/middleware";

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

	describe("ADMIN_USER_ID による管理者判定ロジック", () => {
		const originalAdminUserId = process.env.ADMIN_USER_ID;

		beforeEach(() => {
			process.env.ADMIN_USER_ID = "admin_123";
		});

		afterEach(() => {
			process.env.ADMIN_USER_ID = originalAdminUserId;
		});

		it("ADMIN_USER_ID と一致する userId を管理者と判定する", () => {
			expect(isAdminUser("admin_123")).toBe(true);
		});

		it("ADMIN_USER_ID と一致しない userId は管理者と判定しない", () => {
			expect(isAdminUser("user_456")).toBe(false);
		});

		it("userId が null の場合は管理者と判定しない", () => {
			expect(isAdminUser(null)).toBe(false);
		});
	});
});
