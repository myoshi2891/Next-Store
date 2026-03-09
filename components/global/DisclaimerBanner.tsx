/**
 * Renders a centered, footer-style disclaimer banner indicating the site is a portfolio project and not actively operated.
 *
 * @returns The JSX element for the disclaimer banner.
 */
function DisclaimerBanner() {
	return (
		<div className="bg-muted py-4 mt-auto border-t">
			<p className="text-center text-xs text-muted-foreground max-w-4xl mx-auto px-8">
				This website is a portfolio project and is not actively operated.
				We do not take any responsibility for the handling of personal
				information or provided data.
			</p>
		</div>
	);
}

export default DisclaimerBanner;
