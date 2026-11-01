"""Seeded Monte Carlo estimates using exact integer-weight sampling."""

import math
import random
from dataclasses import dataclass
from fractions import Fraction

from .probabilities import Exact, nonnegative, validate_probabilities


@dataclass(frozen=True)
class SimulationSummary:
    trials: int
    seed: int
    estimated_return: Fraction
    sample_variance: Fraction
    standard_error: float
    counts: tuple[int, ...]


def simulate(
    probabilities: tuple[Exact, ...],
    payouts: tuple[Exact, ...],
    *,
    trials: int,
    seed: int,
    cost: Exact = 1,
) -> SimulationSummary:
    values = validate_probabilities(probabilities)
    if len(values) != len(payouts):
        raise ValueError("Probability and payout counts must match")
    if isinstance(trials, bool) or not isinstance(trials, int) or trials < 2:
        raise ValueError("At least two integer trials are required to estimate variance")
    if isinstance(seed, bool) or not isinstance(seed, int):
        raise TypeError("Seed must be an integer")
    validated_cost = nonnegative(cost)
    if validated_cost == 0:
        raise ValueError("Cost must be positive")
    returns = tuple(nonnegative(payout) / validated_cost for payout in payouts)
    scale = math.lcm(*(p.denominator for p in values))
    weights = tuple(int(p * scale) for p in values)
    counts = [0] * len(weights)
    rng = random.Random(seed)
    for _ in range(trials):
        draw = rng.randrange(scale)
        for index, weight in enumerate(weights):
            if draw < weight:
                counts[index] += 1
                break
            draw -= weight
    mean = (
        sum((count * win for count, win in zip(counts, returns, strict=True)), Fraction()) / trials
    )
    variance = sum(
        (count * (win - mean) ** 2 for count, win in zip(counts, returns, strict=True)),
        Fraction(),
    ) / (trials - 1)
    return SimulationSummary(
        trials, seed, mean, variance, math.sqrt(float(variance / trials)), tuple(counts)
    )
