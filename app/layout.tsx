import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import Navbar from "@/components/navbar/Navbar";
import Container from "@/components/global/Container";
import Providers from "./providers";
import { ClerkProvider } from "@clerk/nextjs";
import DisclaimerBanner from "@/components/global/DisclaimerBanner";

const inter = Inter({ subsets: ["latin"] });

export const metadata: Metadata = {
	title: "Next Store",
	description: "A nifty store built with Next.js",
};

export default function RootLayout({
	children,
}: Readonly<{
	children: React.ReactNode;
}>) {
	return (
		<ClerkProvider>
			<html lang="en" suppressHydrationWarning>
				<body className={`${inter.className} flex flex-col min-h-screen`}>
					<Providers>
						<Navbar />
						<Container className="py-20">{children}</Container>
						<DisclaimerBanner />
					</Providers>
				</body>
			</html>
		</ClerkProvider>
	);
}
