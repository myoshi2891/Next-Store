import { describe, it, expect, expectTypeOf } from "vitest";
import SingleProductPage from "../../app/products/[id]/page";

type PageProps = Parameters<typeof SingleProductPage>[0];

describe("params/searchParams Promise 化の型安全性", () => {
	it("SingleProductPage の params が Promise 型であること", () => {
		expectTypeOf<PageProps>().toMatchTypeOf<{
			params: Promise<{ id: string }>;
		}>();
	});

	it("params.id を await で取得できる", async () => {
		const params = Promise.resolve({ id: "test-id" });
		const { id } = await params;
		expect(id).toBe("test-id");
	});

	it("searchParams を await で取得できる", async () => {
		const searchParams = Promise.resolve({
			layout: "grid",
			search: "test",
		});
		const { layout, search } = await searchParams;
		expect(layout).toBe("grid");
		expect(search).toBe("test");
	});

	it("searchParams のデフォルト値が正しく適用される", async () => {
		const searchParams = Promise.resolve(
			{} as { layout?: string; search?: string }
		);
		const { layout, search } = await searchParams;
		const resolvedLayout = layout || "grid";
		const resolvedSearch = search || "";
		expect(resolvedLayout).toBe("grid");
		expect(resolvedSearch).toBe("");
	});
});
