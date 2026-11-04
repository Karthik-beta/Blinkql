import { docsTests } from "./docs.tests";
import { colorSchemeOptions, test } from "./fixtures";

test.use(colorSchemeOptions("dark"));

docsTests("dark");
