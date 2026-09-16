import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import FormContainer from "@/components/form/FormContainer";

const mockToast = vi.fn();

// useToast のモック
vi.mock("@/hooks/use-toast", () => ({
	useToast: () => ({ toast: mockToast }),
}));

describe("FormContainer", () => {
	const mockAction = vi.fn() as unknown as (
		prevState: { message: string },
		formData: FormData
	) => Promise<{ message: string }>;

	beforeEach(() => {
		mockToast.mockClear();
		(mockAction as ReturnType<typeof vi.fn>).mockReset();
	});

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

	it("state.message が更新されたら toast が呼ばれる", async () => {
		(mockAction as ReturnType<typeof vi.fn>).mockResolvedValue({
			message: "保存しました",
		});
		render(
			<FormContainer action={mockAction}>
				<button type="submit">送信</button>
			</FormContainer>
		);

		await userEvent.click(screen.getByText("送信"));

		await waitFor(() => {
			expect(mockToast).toHaveBeenCalledWith({ description: "保存しました" });
		});
	});

	it("state.message が空のままなら toast は呼ばれない", async () => {
		(mockAction as ReturnType<typeof vi.fn>).mockResolvedValue({ message: "" });
		render(
			<FormContainer action={mockAction}>
				<button type="submit">送信</button>
			</FormContainer>
		);

		await userEvent.click(screen.getByText("送信"));

		await waitFor(() => {
			expect(mockAction).toHaveBeenCalled();
		});
		expect(mockToast).not.toHaveBeenCalled();
	});
});
