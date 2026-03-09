/** @type {import('next').NextConfig} */
const nextConfig = {
	images: {
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
