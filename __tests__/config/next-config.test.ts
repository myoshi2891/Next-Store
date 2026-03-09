import { describe, it, expect, beforeAll } from "vitest";

type RemotePattern = {
	protocol: string;
	hostname: string;
	pathname?: string;
};

type NextConfig = {
	images: {
		remotePatterns: RemotePattern[];
	};
};

describe("next.config.mjs remotePatterns", () => {
	let nextConfig: NextConfig;

	beforeAll(async () => {
		const mod = await import("@/next.config.mjs");
		nextConfig = mod.default as NextConfig;
	});

	it("全ての remotePatterns に pathname 制限が設定されている", () => {
		for (const pattern of nextConfig.images.remotePatterns) {
			expect(
				pattern.pathname,
				`${pattern.hostname} に pathname 制限がありません（Image Optimizer DoS 対策）`
			).toBeDefined();
			expect(pattern.pathname!.length).toBeGreaterThan(0);
		}
	});

	it("pexels.com は /photos/** のみ許可", () => {
		const pexels = nextConfig.images.remotePatterns.find(
			(p) => p.hostname === "images.pexels.com"
		);
		expect(pexels).toBeDefined();
		expect(pexels?.pathname).toBe("/photos/**");
	});

	it("supabase は特定のパスのみ許可", () => {
		const supabase = nextConfig.images.remotePatterns.find((p) =>
			p.hostname.includes("supabase.co")
		);
		expect(supabase).toBeDefined();
		expect(supabase?.pathname).toBeDefined();
		expect(supabase?.pathname).toMatch(/^\/storage/);
	});

	it("clerk は特定のパスのみ許可", () => {
		const clerk = nextConfig.images.remotePatterns.find(
			(p) => p.hostname === "img.clerk.com"
		);
		expect(clerk).toBeDefined();
		expect(clerk?.pathname).toBeDefined();
	});

	it("全エントリが HTTPS を使用している", () => {
		for (const pattern of nextConfig.images.remotePatterns) {
			expect(pattern.protocol).toBe("https");
		}
	});
});
