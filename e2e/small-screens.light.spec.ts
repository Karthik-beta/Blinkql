import { colorSchemeOptions, test } from "./fixtures";
import { smallScreenTests } from "./small-screens.tests";

test.use(colorSchemeOptions("light"));

smallScreenTests("light");
