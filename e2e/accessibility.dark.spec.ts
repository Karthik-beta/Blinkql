import { accessibilityTests } from "./accessibility.tests";
import { colorSchemeOptions, test } from "./fixtures";

test.use(colorSchemeOptions("dark"));

accessibilityTests("dark");
