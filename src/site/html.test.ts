// @vitest-environment node
import { describe, expect, it } from "vitest";
import { escapeHtml, highlightSql } from "./html.ts";

describe("SQL highlighting", () => {
  it("colours keywords, functions, strings, numbers and comments", () => {
    const html = highlightSql("SELECT SUM(x) FROM t WHERE d >= '2026-10-01' AND n > 60.0 -- note");
    expect(html).toContain('<span class="sql-keyword">SELECT</span>');
    expect(html).toContain('<span class="sql-function">SUM</span>(x)');
    expect(html).toContain('<span class="sql-string">&#39;2026-10-01&#39;</span>');
    expect(html).toContain('<span class="sql-number">60.0</span>');
    expect(html).toContain('<span class="sql-comment">-- note</span>');
    expect(html).toContain(" t ");
  });

  it("keeps a keyword a keyword before a bracket", () => {
    const html = highlightSql("WITH t AS (SELECT 1) SELECT * FROM t WHERE x IN (1, 2)");
    expect(html).toContain('<span class="sql-keyword">AS</span> (');
    expect(html).toContain('<span class="sql-keyword">IN</span> (');
  });

  it("escapes markup", () => {
    expect(highlightSql("x <> '<b>'")).not.toContain("<b>");
    expect(escapeHtml(`<a href="x">&'`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;");
  });
});
