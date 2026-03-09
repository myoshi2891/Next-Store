/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
		// NAT64 環境で Cloudflare CDN (Supabase) の IPv6 アドレスが
		// RFC 6052 (64:ff9b::/96) に該当し "private IP" と判定されるため有効化
		dangerouslyAllowLocalIP: true,
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
				pathname: "/**",
			},
		],
	},
};

export default nextConfig;
