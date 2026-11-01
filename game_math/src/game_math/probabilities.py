"""Exact finite distributions. Float inputs are intentionally unsupported."""

from fractions import Fraction

type Exact = int | Fraction


def nonnegative(value: Exact) -> Fraction:
    if isinstance(value, bool) or not isinstance(value, (int, Fraction)):
        raise TypeError("Use integers or Fraction for exact values")
    if value < 0:
        raise ValueError("Value must be nonnegative")
    return Fraction(value)


def normalize(weights: tuple[Exact, ...]) -> tuple[Fraction, ...]:
    values = tuple(nonnegative(weight) for weight in weights)
    total = sum(values, Fraction())
    if total <= 0:
        raise ValueError("At least one positive weight is required")
    return tuple(value / total for value in values)


def validate_probabilities(probabilities: tuple[Exact, ...]) -> tuple[Fraction, ...]:
    values = tuple(nonnegative(value) for value in probabilities)
    if not values or sum(values, Fraction()) != 1:
        raise ValueError("Probabilities must sum exactly to one")
    return values
