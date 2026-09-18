import { describe, it, expect } from "vitest";
import type { actionFunction } from "@/utils/types";

describe("actionFunction 型", () => {
	it("prevState と FormData を受け取り Promise<{ message: string }> を返す", async () => {
		const mockAction: actionFunction = async (_prevState, formData) => {
			return { message: formData.get("test") as string };
		};

		const formData = new FormData();
		formData.set("test", "hello");
		const result = await mockAction({ message: "" }, formData);
		expect(result.message).toBe("hello");
	});

	it("prevState.message が空文字でも動作する", async () => {
		const mockAction: actionFunction = async (prevState, _formData) => {
			return { message: prevState.message || "default" };
		};

		const result = await mockAction({ message: "" }, new FormData());
		expect(result.message).toBe("default");
	});

	it("常に { message: string } を返す", async () => {
		const mockAction: actionFunction = async () => {
			return { message: "success" };
		};

		const result = await mockAction({ message: "" }, new FormData());
		expect(result).toHaveProperty("message");
		expect(typeof result.message).toBe("string");
	});
});
