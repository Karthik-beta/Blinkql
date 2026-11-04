import { colorSchemeOptions, test } from "./fixtures";
import { smallScreenTests } from "./small-screens.tests";

test.use(colorSchemeOptions("dark"));

smallScreenTests("dark");
