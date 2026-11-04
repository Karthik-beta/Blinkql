import type { RecordBatch, Table } from "apache-arrow";
import type { ResultStream } from "@/engine/engine";

/** `table` as the engine streams it: its schema, then its record batches one at a time. */
export function streamOf(table: Table): ResultStream {
  return { schema: table.schema, batches: batchesOf(table.batches) };
}

async function* batchesOf(batches: readonly RecordBatch[]): AsyncGenerator<RecordBatch> {
  yield* batches;
}
