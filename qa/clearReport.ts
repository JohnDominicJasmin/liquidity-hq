import { rmSync } from 'node:fs';

/** A REPORT FROM AN EARLIER RUN MUST NOT OUTLIVE THE START OF THE NEXT ONE (#1185 item 84). A JSON reporter writes only when a run
 *  ends, so a run that is refused, crashes or is stopped leaves the previous file in place, looking current. Removed by the main
 *  process only: workers load the config again while the run is going. */
export function clearOldReport(path: string, env: Record<string, string | undefined> = process.env): void {
  if (env.TEST_WORKER_INDEX !== undefined) return;
  rmSync(path, { force: true });
}
