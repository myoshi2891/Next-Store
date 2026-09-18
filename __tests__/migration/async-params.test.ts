import { describe, it, expect, expectTypeOf } from "vitest";
import SingleProductPage from "../../app/products/[id]/page";
import ProductsPage from "../../app/products/page";
import type { ReactElement } from "react";

type SingleProductPageProps = Parameters<typeof SingleProductPage>[0];
type ProductsPageProps = Parameters<typeof ProductsPage>[0];

describe("params/searchParams Promise 化の型安全性", () => {
	it("SingleProductPage の params が Promise 型であること", () => {
		expectTypeOf<SingleProductPageProps>().toMatchTypeOf<{
			params: Promise<{ id: string }>;
		}>();
	});

	it("params.id を await で取得できる", async () => {
		const params = Promise.resolve({ id: "test-id" });
		const { id } = await params;
		expect(id).toBe("test-id");
	});

	it("ProductsPage の searchParams が Promise 型であること", () => {
		expectTypeOf<ProductsPageProps>().toMatchTypeOf<{
			searchParams: Promise<{
				layout?: string | string[];
				search?: string | string[];
			}>;
		}>();
	});

	it("ProductsPage が searchParams を await して layout/search に反映する", async () => {
		const element = (await ProductsPage({
			searchParams: Promise.resolve({ layout: "list", search: "test" }),
		})) as ReactElement<{ layout: string; search: string }>;
		expect(element.props.layout).toBe("list");
		expect(element.props.search).toBe("test");
	});

	it("ProductsPage が searchParams 未指定時に grid / 空文字のデフォルト値を適用する", async () => {
		const element = (await ProductsPage({
			searchParams: Promise.resolve({}),
		})) as ReactElement<{ layout: string; search: string }>;
		expect(element.props.layout).toBe("grid");
		expect(element.props.search).toBe("");
	});
});
