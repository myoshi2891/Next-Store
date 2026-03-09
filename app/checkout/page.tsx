"use client";

import axios from "axios";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback } from "react";
import { loadStripe } from "@stripe/stripe-js";
import {
	EmbeddedCheckoutProvider,
	EmbeddedCheckout,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
	process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY as string
);

function CheckoutContent() {
	const searchParams = useSearchParams();
	const orderId = searchParams.get("orderId");
	const cartId = searchParams.get("cartId");

	const fetchClientSecret = useCallback(async () => {
		const response = await axios.post(`/api/payment`, {
			orderId,
			cartId,
		});
		return response.data.clientSecret;
	}, [orderId, cartId]);

	const options = { fetchClientSecret };

	return (
		<div id="checkout">
			<EmbeddedCheckoutProvider stripe={stripePromise} options={options}>
				<EmbeddedCheckout />
			</EmbeddedCheckoutProvider>
		</div>
	);
}

function CheckoutPage() {
	return (
		<Suspense fallback={<div>Loading checkout...</div>}>
			<CheckoutContent />
		</Suspense>
	);
}

export default CheckoutPage;
