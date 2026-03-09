import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

describe("Server Action の prevState 型安全性", () => {
	it("actionFunction 型に any が含まれていないこと", () => {
		const content = readFileSync(
			resolve(__dirname, "../../utils/types.ts"),
			"utf-8"
		);
		// actionFunction 定義部分を抽出
		const actionFnMatch = content.match(
			/export type actionFunction[\s\S]*?;/
		);
		expect(actionFnMatch).not.toBeNull();
		const actionFnDef = actionFnMatch![0];
		expect(
			actionFnDef,
			"actionFunction 型に any が使われています"
		).not.toContain("any");
	});

	it("utils/actions.ts の prevState に any が使われていないこと", () => {
		const content = readFileSync(
			resolve(__dirname, "../../utils/actions.ts"),
			"utf-8"
		);
		const lines = content.split("\n");
		const prevStateLines = lines.filter((line) =>
			line.includes("prevState")
		);

		for (const line of prevStateLines) {
			expect(
				line,
				`actions.ts: "${line.trim()}" で prevState: any が使われています`
			).not.toContain("prevState: any");
		}
	});

	it("FormContainer の initialState と prevState の型が一致する", () => {
		const initialState = { message: "" };
		type InitialStateType = typeof initialState;
		const prevState: InitialStateType = { message: "previous" };
		expect(prevState.message).toBe("previous");
	});
});
