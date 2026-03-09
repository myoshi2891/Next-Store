import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import FormContainer from "@/components/form/FormContainer";

// useToast のモック
vi.mock("@/hooks/use-toast", () => ({
	useToast: () => ({ toast: vi.fn() }),
}));

// useFormState / useActionState のモック（React バージョンに依存しないテスト）
vi.mock("react-dom", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react-dom")>();
	return {
		...actual,
		useFormState: (action: unknown, initialState: unknown) => [
			initialState,
			action,
		],
	};
});

vi.mock("react", async (importOriginal) => {
	const actual = await importOriginal<typeof import("react")>();
	return {
		...actual,
		useActionState: (action: unknown, initialState: unknown) => [
			initialState,
			action,
		],
	};
});

describe("FormContainer", () => {
	const mockAction = vi
		.fn()
		.mockResolvedValue({ message: "" }) as unknown as (
		prevState: { message: string },
		formData: FormData
	) => Promise<{ message: string }>;

	it("children をレンダリングする", () => {
		render(
			<FormContainer action={mockAction}>
				<button type="submit">送信</button>
			</FormContainer>
		);
		expect(screen.getByText("送信")).toBeInTheDocument();
	});

	it("form 要素をレンダリングする", () => {
		const { container } = render(
			<FormContainer action={mockAction}>
				<span>content</span>
			</FormContainer>
		);
		expect(container.querySelector("form")).toBeInTheDocument();
	});

	it("複数の children を正しくレンダリングする", () => {
		render(
			<FormContainer action={mockAction}>
				<input type="text" placeholder="名前" />
				<button type="submit">保存</button>
			</FormContainer>
		);
		expect(screen.getByPlaceholderText("名前")).toBeInTheDocument();
		expect(screen.getByText("保存")).toBeInTheDocument();
	});
});
