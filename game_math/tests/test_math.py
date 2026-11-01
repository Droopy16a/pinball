from fractions import Fraction

import pytest

from game_math.payouts import payout_units
from game_math.probabilities import normalize, validate_probabilities
from game_math.rtp import expected_return
from game_math.simulation import simulate


def test_normalization() -> None:
    assert normalize((1, 3, 0)) == (Fraction(1, 4), Fraction(3, 4), Fraction(0))
    assert sum(normalize((2, 3, 7))) == 1


@pytest.mark.parametrize("weights", [(), (0, 0), (-1, 2)])
def test_invalid_weights(weights: tuple[int, ...]) -> None:
    with pytest.raises(ValueError):
        normalize(weights)


def test_validation() -> None:
    with pytest.raises(ValueError):
        validate_probabilities((Fraction(1, 3), Fraction(1, 3)))
    with pytest.raises(TypeError):
        normalize((True, 1))


def test_exact_payouts() -> None:
    assert payout_units(1_000_000, Fraction(3, 2)) == 1_500_000
    assert payout_units(0, 10) == 0
    with pytest.raises(ValueError):
        payout_units(1, Fraction(1, 3))
    with pytest.raises(ValueError):
        payout_units(-1, 1)


def test_theoretical_return() -> None:
    assert expected_return((Fraction(1, 4), Fraction(3, 4)), (0, 2), cost=2) == Fraction(3, 4)
    with pytest.raises(ValueError):
        expected_return((1,), (1, 2))
    with pytest.raises(ValueError):
        expected_return((1,), (1,), cost=0)


def test_reproducibility_and_sampling() -> None:
    args = (Fraction(1, 4), Fraction(3, 4))
    first = simulate(args, (0, 2), trials=10_000, seed=42)
    assert first == simulate(args, (0, 2), trials=10_000, seed=42)
    assert sum(first.counts) == 10_000
    assert abs(first.estimated_return - Fraction(3, 2)) < Fraction(1, 20)
    assert first.standard_error > 0
    assert first != simulate(args, (0, 2), trials=10_000, seed=43)


def test_deterministic_distribution() -> None:
    result = simulate((0, 1), (100, 2), trials=20, seed=0, cost=2)
    assert result.counts == (0, 20)
    assert result.estimated_return == 1
    assert result.standard_error == 0


def test_invalid_simulation() -> None:
    with pytest.raises(ValueError):
        simulate((1,), (1,), trials=1, seed=0)
    with pytest.raises(ValueError):
        simulate((1,), (-1,), trials=10, seed=0)
    with pytest.raises(ValueError):
        simulate((1,), (1,), trials=10, seed=0, cost=0)
