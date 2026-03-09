import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse } from "next/server";

const isPublicRoute = createRouteMatcher(["/", "/products(.*)", "/about"]);
const isAdminRoute = createRouteMatcher(["/admin(.*)"]);

export default clerkMiddleware(async (auth, req) => {
	const { userId } = await auth();
	const isAdminUser = userId === process.env.ADMIN_USER_ID;

	if (isAdminRoute(req) && !isAdminUser) {
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
