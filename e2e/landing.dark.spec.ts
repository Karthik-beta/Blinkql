import { colorSchemeOptions, test } from "./fixtures";
import { landingTests } from "./landing.tests";

test.use(colorSchemeOptions("dark"));

landingTests("dark");
