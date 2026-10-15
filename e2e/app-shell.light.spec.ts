import { appShellTests } from "./app-shell.tests";
import { colorSchemeOptions, test } from "./fixtures";

test.use(colorSchemeOptions("light"));

appShellTests("light");
