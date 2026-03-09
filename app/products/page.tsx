import ProductsContainer from "@/components/products/ProductsContainer";

async function ProductsPage({
	searchParams,
}: {
	searchParams: Promise<{ layout?: string; search?: string }>;
}) {
	const { layout: layoutParam, search: searchParam } = await searchParams;
	const layout = layoutParam || "grid";
	const search = searchParam || "";

	return <ProductsContainer layout={layout} search={search} />;
}

export default ProductsPage;
