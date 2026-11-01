"""Theoretical expectations, expressed as exact return ratios, not percentages."""

from fractions import Fraction

from .probabilities import Exact, nonnegative, validate_probabilities


def expected_return(
    probabilities: tuple[Exact, ...], payouts: tuple[Exact, ...], *, cost: Exact = 1
) -> Fraction:
    values = validate_probabilities(probabilities)
    if len(values) != len(payouts):
        raise ValueError("Probability and payout counts must match")
    validated_cost = nonnegative(cost)
    if validated_cost == 0:
        raise ValueError("Cost must be positive")
    returns = tuple(nonnegative(payout) for payout in payouts)
    return (
        sum((p * win for p, win in zip(values, returns, strict=True)), Fraction()) / validated_cost
    )
