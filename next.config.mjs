/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		// NAT64 環境（開発環境）で Cloudflare CDN (Supabase) の IPv6 アドレスが
		// RFC 6052 (64:ff9b::/96) に該当し "private IP" と判定されるため有効化。
		// SSRF リスクを避けるため本番ビルドでは無効化する。
		dangerouslyAllowLocalIP: process.env.NODE_ENV !== "production",
		remotePatterns: [
			{
				protocol: "https",
				hostname: "images.pexels.com",
				pathname: "/photos/**",
			},
			{
				protocol: "https",
				hostname: "xkzfmkppybdjypejgoft.supabase.co",
				pathname: "/storage/v1/object/public/**",
			},
			{
				protocol: "https",
				hostname: "img.clerk.com",
				// Clerk の画像 URL はホスト直下の単一の不透明トークン
				// （base64url エンコード、"/" を含まない）なので "/*" で十分絞れる
				pathname: "/*",
			},
		],
	},
};

export default nextConfig;
