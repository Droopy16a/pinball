"""Payouts in caller-defined integer monetary units, without implicit rounding."""

from .probabilities import Exact, nonnegative


def validate_units(units: int) -> int:
    if isinstance(units, bool) or not isinstance(units, int):
        raise TypeError("Monetary units must be an integer")
    if units < 0:
        raise ValueError("Monetary units must be nonnegative")
    return units


def payout_units(stake_units: int, multiplier: Exact) -> int:
    amount = validate_units(stake_units) * nonnegative(multiplier)
    if amount.denominator != 1:
        raise ValueError("Payout requires fractional units; define an explicit rounding policy")
    return amount.numerator
