const test = require("node:test");
const assert = require("node:assert");
const { PRESETS, bondDipole, resultant, clampAngle } = require("../../docs/sandbox.js");

function approx(actual, expected, tol) {
  assert.ok(
    Math.abs(actual - expected) <= tol,
    `expected ${actual} to be within ${tol} of ${expected}`
  );
}

test("bond dipole uses 1.34·Δχ·length", () => approx(bondDipole("H2O"), 1.34 * 1.24 * 0.958, 1e-9));
test("water at 104.5° ≈ 1.95 D", () => approx(resultant("H2O", 104.5), 1.949, 0.005));
test("linear molecules cancel", () => { approx(resultant("CO2", 180), 0, 1e-9); approx(resultant("BeF2", 180), 0, 1e-9); });
test("bending CO2 makes it polar", () => assert.ok(resultant("CO2", 120) > 1));
test("NF3 rule overshoots ~10x", () => { approx(resultant("NF3", 102.2), 2.263, 0.005); assert.ok(resultant("NF3", 102.2) > 5 * PRESETS.NF3.measured); });
test("NH3 rule ≈ 1.29 D", () => approx(resultant("NH3", 106.7), 1.287, 0.02));
test("planar pyramidal = 0", () => approx(resultant("NH3", 120), 0, 1e-9));
test("clampAngle respects preset range", () => { assert.equal(clampAngle("NH3", 150), 120); assert.equal(clampAngle("H2O", 60), 90); });
