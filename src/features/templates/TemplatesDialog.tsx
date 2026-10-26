// The template gallery and, once a template is chosen, the form that maps the user's table and
// columns to the ones it needs. Running it puts its SQL in the editor and runs it there, so the
// query can be read, changed and rerun like any other.
import { ArrowLeft, LayoutTemplate } from "lucide-react";
import { type FormEvent, useId, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { getCatalog, subscribeToCatalog } from "@/features/catalog/catalog";
import { setChartPreset } from "@/features/charts/chart-preset";
import { replaceEditorContents } from "@/features/editor/insert";
import { runQuery } from "@/features/results/query-run";
import { loadSample } from "@/features/samples/samples";
import { templates } from "./registry";
import {
  autoMap,
  autoMapColumns,
  type CatalogTable,
  type Mapping,
  type MappingProblem,
  mappingProblems,
  renderTemplate,
  type Template,
  type TemplateTable,
} from "./template";

const fieldClass =
  "h-7 min-w-0 rounded-md border border-input bg-background px-1.5 outline-none focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30 aria-invalid:border-destructive";

function Gallery({ onChoose }: { onChoose: (template: Template) => void }) {
  return (
    <>
      <DialogTitle>Templates</DialogTitle>
      <DialogDescription>
        Ready-made analyses. Choose one, then match its columns to your table's.
      </DialogDescription>
      <ul className="flex flex-col gap-1">
        {templates.map((template) => (
          <li key={template.id}>
            <button
              type="button"
              className="flex w-full flex-col gap-0.5 rounded-md border px-3 py-2 text-left outline-none hover:bg-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
              onClick={() => onChoose(template)}
            >
              <span className="font-medium">{template.title}</span>
              <span className="text-muted-foreground">{template.description}</span>
            </button>
          </li>
        ))}
      </ul>
    </>
  );
}

/** A problem's message under the field it's about, which names it as its description. */
function Problem({ id, problem }: { id: string; problem: MappingProblem | undefined }) {
  return problem ? (
    <p id={id} className="text-destructive">
      {problem.message}
    </p>
  ) : null;
}

function TableFields({
  wanted,
  mapped,
  tables,
  problems,
  onChange,
}: {
  wanted: TemplateTable;
  mapped: Mapping[string] | undefined;
  tables: readonly CatalogTable[];
  problems: MappingProblem[];
  onChange: (mapped: Mapping[string] | undefined) => void;
}) {
  const id = useId();
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const table = tables.find(({ name }) => name === mapped?.table);
  const tableProblem = problems.find(({ column }) => column === undefined);

  const choose = (name: string) => {
    const next = tables.find((candidate) => candidate.name === name);
    onChange(next && { table: next.name, columns: autoMapColumns(wanted, next) });
  };

  const load = async () => {
    setLoading(true);
    setLoadError(null);
    try {
      await loadSample(wanted.sample);
      const sample = getCatalog().tables.find(({ name }) => name === wanted.sample);
      if (sample) onChange({ table: sample.name, columns: autoMapColumns(wanted, sample) });
    } catch (error) {
      setLoadError(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <fieldset className="flex flex-col gap-2 rounded-md border p-3">
      <legend className="px-1 font-medium">{wanted.label}</legend>
      <div className="grid grid-cols-[8rem_1fr] items-center gap-x-2 gap-y-1">
        <label htmlFor={`${id}-table`}>Table</label>
        <select
          id={`${id}-table`}
          className={fieldClass}
          value={mapped?.table ?? ""}
          aria-invalid={tableProblem !== undefined}
          aria-describedby={tableProblem && `${id}-table-problem`}
          onChange={(event) => choose(event.target.value)}
        >
          <option value="">Choose a table</option>
          {tables.map(({ name }) => (
            <option key={name} value={name}>
              {name}
            </option>
          ))}
        </select>
        <div className="col-start-2">
          <Problem id={`${id}-table-problem`} problem={tableProblem} />
        </div>
        {wanted.columns.map((column) => {
          const fieldId = `${id}-${column.key}`;
          const problem = problems.find((candidate) => candidate.column === column.key);
          return (
            <div key={column.key} className="col-span-2 grid grid-cols-subgrid items-center">
              <label htmlFor={fieldId}>
                {column.label}
                {column.optional && <span className="text-muted-foreground"> (optional)</span>}
              </label>
              <select
                id={fieldId}
                className={fieldClass}
                disabled={!table}
                value={mapped?.columns[column.key] ?? ""}
                aria-invalid={problem !== undefined}
                aria-describedby={problem && `${fieldId}-problem`}
                onChange={(event) => {
                  if (!mapped) return;
                  const columns = { ...mapped.columns };
                  if (event.target.value) columns[column.key] = event.target.value;
                  else delete columns[column.key];
                  onChange({ ...mapped, columns });
                }}
              >
                <option value="">{column.optional ? "None" : "Choose a column"}</option>
                {table?.columns.map(({ name, type }) => (
                  <option key={name} value={name}>
                    {name} ({type})
                  </option>
                ))}
              </select>
              <div className="col-start-2">
                <Problem id={`${fieldId}-problem`} problem={problem} />
              </div>
            </div>
          );
        })}
      </div>
      {!tables.some(({ name }) => name === wanted.sample) && (
        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={loading}
            aria-describedby={loadError === null ? undefined : `${id}-load-error`}
            onClick={() => void load()}
          >
            {loading ? "Loading sample data…" : "Load sample data"}
          </Button>
          <span className="text-muted-foreground">to try it on {wanted.sample}</span>
          {loadError !== null && (
            <p id={`${id}-load-error`} className="w-full text-destructive">
              {loadError}
            </p>
          )}
        </div>
      )}
    </fieldset>
  );
}

function TemplateForm({
  template,
  onBack,
  onRun,
}: {
  template: Template;
  onBack: () => void;
  onRun: () => void;
}) {
  const id = useId();
  const catalog = useSyncExternalStore(subscribeToCatalog, getCatalog);
  const [mapping, setMapping] = useState(() => autoMap(template, getCatalog().tables));
  const [params, setParams] = useState(() =>
    Object.fromEntries((template.params ?? []).map((param) => [param.key, String(param.default)])),
  );

  const problems = mappingProblems(template, mapping, catalog.tables);
  let sql: string | null = null;
  let reason = problems[0]?.message ?? null;
  if (reason === null) {
    try {
      sql = renderTemplate(template, mapping, params);
    } catch (error) {
      reason = error instanceof Error ? error.message : String(error);
    }
  }

  const run = (event: FormEvent) => {
    event.preventDefault();
    if (sql === null) return;
    replaceEditorContents(sql);
    setChartPreset(template.chart ? { sql, ...template.chart } : null);
    void runQuery(sql);
    onRun();
  };

  return (
    <>
      <DialogTitle>{template.title}</DialogTitle>
      <DialogDescription>{template.description}</DialogDescription>
      <form noValidate className="flex flex-col gap-3" onSubmit={run}>
        {template.tables.map((wanted) => (
          <TableFields
            key={wanted.key}
            wanted={wanted}
            mapped={mapping[wanted.key]}
            tables={catalog.tables}
            problems={problems.filter(({ table }) => table === wanted.key)}
            onChange={(mapped) =>
              setMapping((current) => {
                const next = { ...current };
                if (mapped) next[wanted.key] = mapped;
                else delete next[wanted.key];
                return next;
              })
            }
          />
        ))}
        {template.params?.map((param) => (
          <div key={param.key} className="grid grid-cols-[8rem_1fr] items-center gap-x-2 gap-y-1">
            <label htmlFor={`${id}-${param.key}`}>{param.label}</label>
            <input
              id={`${id}-${param.key}`}
              type={param.type === "number" ? "number" : "text"}
              className={fieldClass}
              value={params[param.key] ?? ""}
              aria-describedby={param.description && `${id}-${param.key}-description`}
              onChange={(event) => {
                const value = event.currentTarget.value;
                setParams((current) => ({ ...current, [param.key]: value }));
              }}
            />
            {param.description && (
              <p
                id={`${id}-${param.key}-description`}
                className="col-start-2 text-muted-foreground"
              >
                {param.description}
              </p>
            )}
          </div>
        ))}
        <div className="flex items-center justify-end gap-2">
          {reason !== null && (
            <p id={`${id}-reason`} className="mr-auto text-muted-foreground">
              {reason}
            </p>
          )}
          <Button variant="outline" size="sm" onClick={onBack}>
            <ArrowLeft data-icon="inline-start" aria-hidden />
            All templates
          </Button>
          <Button
            type="submit"
            size="sm"
            disabled={sql === null}
            aria-describedby={reason === null ? undefined : `${id}-reason`}
          >
            Run
          </Button>
        </div>
      </form>
    </>
  );
}

/** The "Templates" button and the dialog it opens. */
export function TemplatesDialog() {
  const [open, setOpen] = useState(false);
  const [chosen, setChosen] = useState<Template | null>(null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button
        variant="outline"
        size="sm"
        onClick={() => {
          // Back to the gallery each time; not on close, so it doesn't flash while closing.
          setChosen(null);
          setOpen(true);
        }}
      >
        <LayoutTemplate data-icon="inline-start" aria-hidden />
        Templates
      </Button>
      <DialogContent className="max-h-[85dvh] max-w-xl overflow-y-auto">
        {chosen ? (
          <TemplateForm
            key={chosen.id}
            template={chosen}
            onBack={() => setChosen(null)}
            onRun={() => setOpen(false)}
          />
        ) : (
          <Gallery onChoose={setChosen} />
        )}
      </DialogContent>
    </Dialog>
  );
}
