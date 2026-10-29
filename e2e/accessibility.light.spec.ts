import { accessibilityTests } from "./accessibility.tests";
import { colorSchemeOptions, test } from "./fixtures";

test.use(colorSchemeOptions("light"));

accessibilityTests("light");
