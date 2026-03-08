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
			},
			{
				protocol: "https",
				hostname: "img.clerk.com",
			},
		],
	},
};

export default nextConfig;
