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

/**
 * Application root layout that provides global context, navigation, and the main page container.
 *
 * @param children - The page content to render inside the main container.
 * @returns The root layout JSX element composing global providers, the navbar, the main content container, and the disclaimer banner.
 */
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
