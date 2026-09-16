import ProductsContainer from "@/components/products/ProductsContainer";

function firstValue(value: string | string[] | undefined): string | undefined {
	return Array.isArray(value) ? value[0] : value;
}

async function ProductsPage({
	searchParams,
}: {
	searchParams: Promise<{
		layout?: string | string[];
		search?: string | string[];
	}>;
}) {
	const { layout: layoutParam, search: searchParam } = await searchParams;
	// layout は "list" 以外すべて grid 扱い（重複クエリで配列になっても未対応値として grid にフォールバック）
	const layout = firstValue(layoutParam) === "list" ? "list" : "grid";
	const search = firstValue(searchParam) || "";

	return <ProductsContainer layout={layout} search={search} />;
}

export default ProductsPage;
