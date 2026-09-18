import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

export const isPublicRoute = createRouteMatcher(["/", "/products(.*)", "/about"]);
export const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export function isAdminUser(userId: string | null) {
	return userId === process.env.ADMIN_USER_ID;
}

export default clerkMiddleware(async (auth, req) => {
	const { userId } = await auth();

	if (isAdminRoute(req) && !isAdminUser(userId)) {
		return NextResponse.redirect(new URL("/", req.url));
	}

	if (!isPublicRoute(req)) {
		await auth.protect();
	}

	return NextResponse.next();
});

export const config = {
	matcher: ["/((?!.*\\..*|_next).*)", "/", "/(api|trpc)(.*)"],
};
